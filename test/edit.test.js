import { test } from "node:test";
import assert from "node:assert/strict";
import { edge_set, has_vertex, edge_at, along_y, solve } from "./helpers.js";
import { M } from "../src/math.js";
import { IO } from "../src/io.js";
import { CON } from "../src/constraints.js";
import { ED } from "../src/edit.js";

const add = (CP, ...L) => {
    const out = ED.add_lines(CP, L);
    assert.ok(out, "edit was rejected");
    return out;
};
const snapshot = (CP) => JSON.parse(JSON.stringify(CP));

test("new pattern is rectangular paper on the page", () => {
    const CP = ED.new_CP();
    assert.equal(CP.W, 8);
    assert.equal(CP.H, 8);
    assert.equal(CP.V.length, 4);
    assert.deepEqual(CP.EA, ["B", "B", "B", "B"]);
    const R = ED.new_CP(8, 5);
    for (const p of [[0, 0], [8, 0], [8, 5], [0, 5]]) { assert.ok(has_vertex(R, p)); }
    assert.equal(ED.new_CP(0, 8), undefined);
    assert.equal(ED.new_CP(2.5, 8), undefined);
});

test("crossing lines are split where they cross", () => {
    const CP = add(ED.new_CP(), [[0, 0], [8, 8], "M"], [[8, 0], [0, 8], "V"]);
    assert.equal(CP.V.length, 5);
    assert.equal(CP.EV.length, 8);
    assert.ok(has_vertex(CP, [4, 4]));
    assert.equal(CP.EA[edge_at(CP, [0, 0], [4, 4])], "M");
    assert.equal(CP.EA[edge_at(CP, [4, 4], [8, 8])], "M");
    assert.equal(CP.EA[edge_at(CP, [8, 0], [4, 4])], "V");
});

test("a line ending on an edge splits that edge", () => {
    const CP = add(ED.new_CP(), [[4, 0], [4, 4], "M"]);
    assert.equal(CP.V.length, 6);
    assert.equal(CP.EV.length, 6);
    assert.equal(CP.EA[edge_at(CP, [0, 0], [4, 0])], "B");
    assert.equal(CP.EA[edge_at(CP, [4, 0], [8, 0])], "B");
    assert.equal(CP.EA[edge_at(CP, [4, 0], [4, 4])], "M");
});

test("drawing over a crease reassigns only the part drawn over", () => {
    let CP = add(ED.new_CP(), [[0, 4], [8, 4], "M"]);
    CP = add(CP, [[2, 4], [6, 4], "V"]);
    assert.deepEqual(along_y(CP, 4), [[0, 2, "M"], [2, 6, "V"], [6, 8, "M"]]);
});

test("partial reassignments survive later edits", () => {
    let CP = add(ED.new_CP(), [[0, 4], [8, 4], "M"], [[2, 4], [6, 4], "V"]);
    CP = add(CP, [[4, 0], [4, 8], "U"]);           // splits the V part at x=4
    CP = add(CP, [[1, 1], [3, 3], "F"]);
    CP = ED.erase_edges(CP, [edge_at(CP, [1, 1], [3, 3])]);
    assert.deepEqual(along_y(CP, 4),
        [[0, 2, "M"], [2, 4, "V"], [4, 6, "V"], [6, 8, "M"]]);
});

test("erasing removes edges and any vertex left without edges", () => {
    const base = ED.new_CP();
    let CP = add(base, [[2, 2], [6, 6], "M"]);
    CP = ED.erase_edges(CP, [edge_at(CP, [2, 2], [6, 6])]);
    assert.deepEqual(edge_set(CP), edge_set(base));
    CP = add(base, [[4, 0], [4, 8], "M"]);
    CP = ED.erase_edges(CP, [edge_at(CP, [4, 0], [4, 8])]);
    assert.equal(CP.V.length, 6, "split boundary keeps its vertices until cleanup");
    assert.deepEqual(edge_set(ED.cleanup(CP)), edge_set(base));
});

test("assigning changes only the chosen edges and never mutates", () => {
    const CP = add(ED.new_CP(), [[0, 0], [8, 8], "M"]);
    const before = snapshot(CP);
    const e = edge_at(CP, [0, 0], [8, 8]);
    const out = ED.assign_edges(CP, [e], "V");
    assert.equal(out.EA[e], "V");
    assert.equal(out.EA.filter(a => a == "B").length, 4);
    assert.deepEqual(CP, before);
    assert.equal(ED.assign_edges(CP, [e], "X"), undefined);
    assert.equal(ED.assign_edges(CP, [99], "V"), undefined);
});

test("moving a vertex re-splits crossings and merges onto vertices", () => {
    let CP = add(ED.new_CP(), [[0, 4], [8, 4], "M"], [[4, 0], [4, 2], "U"]);
    const v = CP.V.findIndex(p => M.dist(p, [4, 2]) < 1e-9);
    CP = ED.move_vertex(CP, v, [4, 6]);
    assert.ok(has_vertex(CP, [4, 4]));
    assert.equal(CP.EA[edge_at(CP, [4, 0], [4, 4])], "U");
    assert.equal(CP.EA[edge_at(CP, [4, 4], [4, 6])], "U");
    const n = CP.EV.length;
    const w = CP.V.findIndex(p => M.dist(p, [4, 6]) < 1e-9);
    CP = ED.move_vertex(CP, w, [4, 4]);             // collapses that edge
    assert.equal(CP.EV.length, n - 1);
    assert.equal(ED.move_vertex(CP, 0, [9, 4]), undefined, "outside page");
});

test("cleanup merges straight vertices with matching assignments only", () => {
    const base = ED.new_CP();
    let CP = ED.cleanup(add(base, [[0, 4], [4, 4], "M"], [[4, 4], [8, 4], "M"]));
    assert.deepEqual(along_y(CP, 4), [[0, 8, "M"]]);
    CP = ED.cleanup(add(base, [[0, 4], [4, 4], "M"], [[4, 4], [8, 4], "V"]));
    assert.deepEqual(along_y(CP, 4), [[0, 4, "M"], [4, 8, "V"]]);
    CP = ED.cleanup(add(base, [[0, 4], [4, 4], "M"], [[4, 4], [8, 0], "M"]));
    assert.ok(has_vertex(CP, [4, 4]), "bent vertex is kept");
});

test("transforms reflect and rotate the page", () => {
    const CP = add(ED.new_CP(8, 4), [[0, 0], [2, 1], "M"]);
    const R = ED.transform(CP, "rotate_cw");
    assert.equal(R.W, 4);
    assert.equal(R.H, 8);
    assert.equal(R.EA[edge_at(R, [4, 0], [3, 2])], "M");
    let T = CP;
    for (let i = 0; i < 4; ++i) { T = ED.transform(T, "rotate_cw"); }
    assert.deepEqual(edge_set(T), edge_set(CP));
    const back = ED.transform(ED.transform(CP, "rotate_cw"), "rotate_ccw");
    assert.deepEqual(edge_set(back), edge_set(CP));
    const F = ED.transform(CP, "reflect_x");
    assert.equal(F.EA[edge_at(F, [8, 0], [6, 1])], "M");
    assert.deepEqual(edge_set(ED.transform(F, "reflect_x")), edge_set(CP));
    assert.equal(ED.transform(CP, "spin"), undefined);
});

test("resizing adds or removes squares at the right and bottom", () => {
    const CP = add(ED.new_CP(), [[0, 0], [4, 4], "M"]);
    const R = ED.resize(CP, 10, 6);
    assert.equal(R.W, 10);
    assert.equal(R.H, 6);
    const B = R.EV.filter((_, e) => R.EA[e] == "B");
    assert.equal(B.length, 4);
    assert.ok(has_vertex(R, [10, 6]) && !has_vertex(R, [8, 8]));
    assert.equal(R.EA[edge_at(R, [0, 0], [4, 4])], "M");
    assert.equal(ED.resize_cuts(CP, 10, 6), 0);
    // shrinking cuts creases at the new edge and drops those wholly outside
    const P = add(CP, [[7, 0], [8, 1], "U"], [[0, 2], [8, 2], "V"]);
    assert.equal(ED.resize_cuts(P, 3, 8), 3);
    const S = ED.resize(P, 3, 8);
    assert.equal(S.EA[edge_at(S, [0, 0], [2, 2])], "M");
    assert.equal(S.EA[edge_at(S, [2, 2], [3, 3])], "M", "cut where it meets x = 3");
    assert.deepEqual(along_y(S, 2), [[0, 2, "V"], [2, 3, "V"]]);
    assert.ok(!S.EA.includes("U"), "crease outside the new paper dropped");
    assert.deepEqual(along_y(S, 8), [[0, 3, "B"]]);
    const D = add(ED.new_CP(), [[0, 0], [8, 8], "M"]);
    const C = ED.resize(D, 7, 8);
    assert.equal(C.EA[edge_at(C, [0, 0], [7, 7])], "M");
    const G = ED.resize(D, 9, 9);
    assert.ok(has_vertex(G, [8, 8]), "crease now ends inside the paper");
    // a crease along the new edge becomes part of the boundary
    const E = ED.resize(add(ED.new_CP(), [[6, 0], [6, 8], "V"]), 6, 8);
    assert.equal(E.EA[edge_at(E, [6, 0], [6, 8])], "B");
    assert.equal(E.EV.length, 4);
    // paper that is not the page rectangle: only the page changes, and it
    // is never cut
    const tri = ED.W_H_L_2_CP(8, 8,
        [[[0, 0], [6, 0], "B"], [[6, 0], [0, 6], "B"], [[0, 6], [0, 0], "B"]]);
    const T = ED.resize(tri, 6, 7);
    assert.deepEqual(edge_set(T), edge_set(tri));
    assert.equal(ED.resize(tri, 5, 8), undefined);
});

test("changing the grid leaves the paper and creases alone", () => {
    const CP = add(ED.new_CP(8, 6), [[0, 0], [4, 3], "M"], [[2, 0], [2, 6], "V"]);
    assert.deepEqual([CP.GW, CP.GH], [8, 6], "a new page is a grid of unit squares");
    const R = ED.regrid(CP, 10, 6);
    assert.deepEqual([R.W, R.H, R.GW, R.GH], [8, 6, 10, 6], "columns only");
    assert.deepEqual(edge_set(R), edge_set(CP), "creases unchanged");
    assert.deepEqual([CP.GW, CP.GH], [8, 6], "and the old CP is untouched");
    const D = ED.regrid(CP, 8, 12);
    assert.deepEqual([D.GW, D.GH], [8, 12], "rows only");
    // grid points of 10 columns over 8 units: 0.8 apart
    assert.deepEqual(ED.snap(R, [0.85, 0.1]), [0.8, 0]);
    assert.deepEqual(ED.snap(R, [7.9, 5.9]), [8, 6], "the far corner");
    assert.deepEqual(ED.snap(D, [3.1, 0.4]), [3, 0.5], "rows 0.5 apart");
    // Resize Grid counts squares of the current grid
    const S = ED.resize(R, 5, 6);
    assert.deepEqual([S.W, S.H, S.GW, S.GH], [4, 6, 5, 6]);
    assert.equal(ED.resize_cuts(R, 5, 6), 0, "both creases fit in 4 units");
    assert.equal(ED.resize_cuts(R, 2, 6), 4,
        "1.6 units: one mountain edge cut; the other and both valley edges dropped");
    // quarter turns swap columns and rows
    const T = ED.transform(R, "rotate_cw");
    assert.deepEqual([T.W, T.H, T.GW, T.GH], [6, 8, 6, 10]);
    // saved with the file
    const again = ED.doc_type_side_n_2_CP(ED.CP_2_doc(R), "fold", true);
    assert.deepEqual([again.W, again.H, again.GW, again.GH], [8, 6, 10, 6]);
    assert.equal(ED.regrid(CP, 0), undefined);
    assert.equal(ED.regrid(CP, 8, NaN), undefined);
});

test("scaling a pattern onto its grid", () => {
    const CP = add(ED.new_CP(8, 6), [[0, 0], [4, 3], "M"], [[2, 0], [2, 6], "V"]);
    const R = ED.scale(CP, 16);
    assert.deepEqual([R.W, R.H, R.GW, R.GH], [16, 12, 16, 12]);
    // the valley at x = 2 crosses the mountain at (2, 1.5): doubled, (4, 3)
    assert.equal(R.EA[edge_at(R, [0, 0], [4, 3])], "M");
    assert.equal(R.EA[edge_at(R, [4, 3], [8, 6])], "M");
    assert.equal(R.EA[edge_at(R, [4, 3], [4, 12])], "V");
    assert.deepEqual(edge_set(ED.scale(R, 8)), edge_set(CP), "and back");
    const T = ED.scale(CP, 10);
    assert.equal(T.H, 7.5, "squares stay square: the height may be fractional");
    assert.ok(has_vertex(T, [5, 3.75]));
    const there_and_back = ED.scale(ED.scale(CP, 12), 8);
    assert.ok(there_and_back.V.every((p, i) => (p[0] == CP.V[i][0]) && (p[1] == CP.V[i][1])),
        "8 -> 12 -> 8 lands exactly on the old coordinates");
    assert.equal(ED.scale(CP, 0), undefined);
});

test("finding the grid a pattern is drawn on", () => {
    const sixteen = add(ED.new_CP(), [[0, 0], [4.5, 8], "M"]);   // half squares
    assert.equal(ED.fit_grid(sixteen), 16);
    assert.equal(ED.fit_grid(ED.new_CP()), 1, "blank paper fits any grid");
    const thirds = add(ED.new_CP(), [[0, 8/3], [8, 8/3], "V"]);
    assert.equal(ED.fit_grid(thirds), 3);
    assert.equal(ED.fit_grid(thirds, 8), 9, "at least 8 squares");
    const angle = add(ED.new_CP(), [[0, 0], [8, 8*Math.tan(Math.PI/8)], "M"]);
    assert.equal(ED.fit_grid(angle), undefined, "22.5 degree designs are on no grid");
});

test("opening a design picks the grid it is drawn on", () => {
    const fold = (x) => JSON.stringify({   // unit square, crease from (x, 0)
        vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [x, 0], [1 - x, 1]],
        edges_vertices: [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
        edges_assignment: ["B", "B", "B", "B", "B", "B", "M"]});
    assert.equal(ED.doc_type_side_n_2_CP(fold(5/16), "fold", true).W, 16);
    assert.equal(ED.doc_type_side_n_2_CP(fold(3/10), "fold", true).W, 10);
    assert.equal(ED.doc_type_side_n_2_CP(fold(1/4), "fold", true).W, 8, "coarser grids open at 8");
    assert.equal(ED.doc_type_side_n_2_CP(fold(Math.SQRT2 - 1), "fold", true).W, 8, "no grid: 8");
    const T = ED.scale(add(ED.new_CP(8, 6), [[0, 0], [4, 3], "M"]), 10);
    const again = ED.doc_type_side_n_2_CP(ED.CP_2_doc(T), "fold", true);
    assert.deepEqual([again.W, again.H], [10, 7.5], "a saved page, even fractional, is kept");
});

test("invalid edits are rejected and leave the pattern unchanged", () => {
    const CP = ED.new_CP();
    const before = snapshot(CP);
    assert.equal(ED.add_lines(CP, [[[0, 0], [NaN, 4], "M"]]), undefined);
    assert.equal(ED.add_lines(CP, [[[0, 0], [9, 4], "M"]]), undefined);
    assert.equal(ED.add_lines(CP, [[[0, 0], [4, 4], "C"]]), undefined);
    assert.deepEqual(CP, before);
    assert.deepEqual(edge_set(ED.add_lines(CP, [[[1, 1], [1, 1], "M"]])),
        edge_set(CP), "zero-length line is ignored");
});

// Deterministic pseudo-random lines between grid points and edge midpoints
const random_lines = (count, seed) => {
    let s = seed;
    const r = () => (s = (s*16807) % 2147483647)/2147483647;
    const pick = () => [Math.floor(r()*17)/2, Math.floor(r()*17)/2];
    const L = [];
    while (L.length < count) {
        const [p, q] = [pick(), pick()];
        if (M.dist(p, q) > 0) { L.push([p, q, ["M", "V", "U", "F"][L.length % 4]]); }
    }
    return L;
};

test("adding lines one at a time equals building them all at once", () => {
    const L = random_lines(40, 7);
    let CP = ED.new_CP();
    for (const l of L) { CP = add(CP, l); }
    const all = ED.W_H_L_2_CP(8, 8, ED.W_H_2_L(8, 8).concat(L));
    assert.equal(CP.V.length, all.V.length);
    assert.deepEqual(edge_set(CP), edge_set(all));
});

test("repeated rebuilds do not move vertices", () => {
    let CP = add(ED.new_CP(), ...random_lines(40, 11));
    const first = CP;
    for (let i = 0; i < 25; ++i) {
        CP = ED.W_H_L_2_CP(CP.W, CP.H, ED.CP_2_L(CP));
    }
    assert.equal(CP.V.length, first.V.length);
    assert.equal(CP.EV.length, first.EV.length);
    let drift = 0;
    for (const [i, p] of CP.V.entries()) { drift = Math.max(drift, M.dist(p, first.V[i])); }
    assert.ok(drift < 1e-12, `drift ${drift}`);
});

test("flat-foldability markers match ogmi-creaser's checks", () => {
    const bad = (CP) => ED.CP_2_VK(CP)
        .map((k, v) => [k, v]).filter(([k]) => k > 1/M.EPS).map(([, v]) => CP.V[v]);
    const base = add(ED.new_CP(), [[0, 4], [8, 4], "M"]);
    const ok = add(base, [[4, 0], [4, 4], "M"], [[4, 4], [4, 8], "V"]);
    assert.deepEqual(bad(ok), []);
    const maekawa = add(base, [[4, 0], [4, 8], "M"]);       // four M
    assert.deepEqual(bad(maekawa), [[4, 4]]);
    const kawasaki = add(base, [[4, 4], [4, 8], "V"], [[4, 4], [8, 0], "M"]);
    assert.deepEqual(bad(kawasaki), [[4, 4]]);
    const dangling = add(ED.new_CP(), [[0, 4], [4, 4], "M"]);
    assert.deepEqual(bad(dangling), [[4, 4]]);
});

test("pointer positions snap to the nearest grid point or vertex", () => {
    const CP = add(ED.new_CP(8, 6), [[0, 0], [8, 3], "M"], [[0, 3], [8, 0], "V"]);
    assert.deepEqual(ED.snap(CP, [2.2, 0.9]), [2, 1]);
    assert.deepEqual(ED.snap(CP, [4.1, 1.6]), [4, 1.5], "crossing vertex beats grid");
    assert.deepEqual(ED.snap(CP, [-3, 9]), [0, 6], "clamped to the page");
});

test("picking finds the nearest edge and the edges a drag crosses", () => {
    const CP = add(ED.new_CP(), [[0, 4], [8, 4], "M"], [[4, 0], [4, 8], "V"]);
    assert.equal(ED.pick_edge(CP, [2, 4.2], 0.5), edge_at(CP, [0, 4], [4, 4]));
    assert.equal(ED.pick_edge(CP, [2, 5], 0.5), -1);
    const crossed = ED.edges_crossed(CP, [1, 1], [3, 7]).sort();
    assert.deepEqual(crossed, [edge_at(CP, [0, 4], [4, 4])]);
    const both = ED.edges_crossed(CP, [3, 3], [5, 5]).sort((a, b) => a - b);
    assert.equal(both.length, 0, "passing exactly through a vertex crosses no edge interior");
    assert.equal(ED.edges_crossed(CP, [2, 2], [6, 6.5]).length, 2);
});

test("moving vertices picks the nearest vertex and snaps past itself", () => {
    // the crossing at (4, 1.5) is a vertex off the grid
    const CP = add(ED.new_CP(8, 6), [[0, 0], [8, 3], "M"], [[0, 3], [8, 0], "V"]);
    const v = ED.pick_vertex(CP, [4.1, 1.6], 0.5);
    assert.deepEqual(CP.V[v], [4, 1.5]);
    assert.equal(ED.pick_vertex(CP, [5, 5], 0.5), -1);
    assert.deepEqual(ED.snap(CP, [4.05, 1.55]), [4, 1.5], "the vertex itself is nearest");
    assert.deepEqual(ED.snap(CP, [4.05, 1.55], v), [4, 2], "skipping it: the grid point");
    assert.deepEqual(ED.snap(CP, [0.2, 3.3], v), [0, 3], "other vertices still count");
});

test("SVG export: one line per edge, red mountain / blue valley as seen from the coloured side", () => {
    const CP = add(ED.new_CP(8, 4), [[0, 0], [4, 4], "M"], [[4, 0], [8, 4], "V"],
        [[2, 0], [2, 4], "U"], [[6, 0], [6, 4], "F"]);
    const svg = ED.CP_2_svg(CP, "a <test> & more");
    const strokes = [...svg.matchAll(/stroke:(#[0-9a-f]{6})/g)].map(m => m[1]);
    assert.equal(strokes.length, CP.EV.length);
    const count = (c) => strokes.filter(s => s == c).length;
    const edges = (a) => CP.EA.filter(x => x == a).length;   // creases split
    assert.equal(count("#0000ff"), edges("M"), "ogmi-creaser M is blue");
    assert.equal(count("#ff0000"), edges("V"), "ogmi-creaser V is red");
    assert.equal(count("#ff8000"), edges("U"));
    assert.equal(count("#808080"), edges("F"));
    assert.equal(count("#000000"), edges("B"));
    assert.ok(edges("M") > 0 && edges("V") > 0 && edges("U") > 0 && edges("F") > 0);
    assert.ok(svg.includes("<title>a &lt;test&gt; &amp; more</title>"));
    assert.ok(svg.includes('width="425" height="225"'));
    // the last lines drawn (on top) are the boundary
    assert.ok(svg.trim().split("\n").at(-2).includes("#000000"));
});

test("saved files reload with the same page and edges", () => {
    const CP = add(ED.new_CP(8, 6), [[0, 0], [6, 6], "M"], [[8, 0], [2, 6], "V"],
        [[0, 3], [8, 3], "U"], [[4, 0], [4, 3], "F"]);
    const doc = ED.CP_2_doc(CP, "test");
    const again = ED.doc_type_side_n_2_CP(doc, "fold", true);
    assert.equal(again.W, 8);
    assert.equal(again.H, 6);
    assert.deepEqual(edge_set(again), edge_set(CP));
});

test("ogmi-creaser imports the editor's output exactly as drawn", () => {
    const CP = add(ED.new_CP(8, 6), [[0, 0], [6, 6], "M"], [[8, 0], [2, 6], "V"],
        [[0, 3], [8, 3], "U"], [[4, 0], [4, 3], "F"]);
    const doc = ED.CP_2_doc(CP, "test");
    const FOLD = JSON.parse(doc);
    assert.ok(M.polygon_area2(M.expand(FOLD.faces_vertices[0], FOLD.vertices_coords)) > 0);
    const [V, , EV, EA] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, "fold", true);
    assert.deepEqual(edge_set({V, EV, EA}), edge_set(CP));
});

test("line formats load in ogmi-creaser's convention", () => {
    // .cp lines: 1 = B, 2 = M, 3 = V. ogmi-creaser swaps M/V for line formats
    // (side "+"), and the editor must start from what ogmi-creaser shows.
    const doc = ["1 0 0 8 0", "1 8 0 8 8", "1 8 8 0 8", "1 0 8 0 0", "2 0 0 8 8"].join("\n");
    const [V, , EV, EA] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, "cp", true);
    const CP = ED.doc_type_side_n_2_CP(doc, "cp", true);
    assert.equal(CP.EA[edge_at(CP, [0, 0], [8, 8])], "V");
    const direct = edge_set({V: M.normalize_points(V), EV, EA});
    const edited = ED.CP_2_doc(CP);
    const [V2, , EV2, EA2] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(edited, "fold", true);
    assert.deepEqual(edge_set({V: M.normalize_points(V2), EV: EV2, EA: EA2}), direct);
});

test("imported files are scaled so the longer side spans the grid", () => {
    const doc = JSON.stringify({
        vertices_coords: [[10, 10], [30, 10], [30, 20], [10, 20]],
        edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        edges_assignment: ["B", "B", "B", "B", "M"],
        faces_vertices: [[0, 1, 2], [0, 2, 3]],
    });
    const CP = ED.doc_type_side_n_2_CP(doc, "fold", true, 8);
    assert.equal(CP.W, 8);
    assert.equal(CP.H, 4);
    assert.equal(CP.EA[edge_at(CP, [0, 0], [8, 4])], "M");
});

test("patterns drawn in the editor fold in ogmi-creaser", async () => {
    CON.build();
    const states = async (CP) => {
        const doc = ED.CP_2_doc(CP);
        const [V, , EV, EA, , FV] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, "fold", true);
        const out = await solve({vertices_coords: V,
            edges_vertices: EV, edges_assignment: EA, faces_vertices: FV}, Infinity);
        return out.states;
    };
    const accordion = (f) => add(ED.new_CP(8, 4),
        ...[1, 2, 3, 4, 5, 6, 7].map(x => [[x, 0], [x, 4], f(x)]));
    assert.equal(await states(accordion(x => (x % 2) ? "M" : "V")), 1n);
    assert.equal(await states(accordion(() => "U")), 1392n);
});
