// ogmi-creaser's solver on patterns with a vertex in the middle of a straight
// crease (the editor makes these whenever a crease is drawn in pieces), and
// on bundled examples whose state counts it used to get wrong
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { has_vertex, solve } from "./helpers.js";
import { M } from "../src/math.js";
import { IO } from "../src/io.js";
import { X } from "../src/conversion.js";
import { CON } from "../src/constraints.js";
import { ED } from "../src/edit.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");
CON.build();

const states = async (doc, lim = Infinity) => {
    const [V, , EV, EA, , FV] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, "fold", true);
    const log = console.log;
    console.log = () => {};     // solve logs why a pattern has no state
    try {
        const out = await solve({vertices_coords: V,
            edges_vertices: EV, edges_assignment: EA, faces_vertices: FV}, lim);
        return out.states;
    } finally {
        console.log = log;
    }
};
const example = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Reference state counts recorded with the examples: examples/<folder>_data.csv
// has one row per file in that folder, starting with the file's name
const reference = (f) => {
    const [dir, name] = f.split("/");
    const rows = fs.readFileSync(path.join(ROOT, `${dir}_data.csv`), "utf8").trim().split("\n");
    const col = rows[0].split(",").indexOf("states");
    const row = rows.find(r => r.startsWith(name + ","));
    return BigInt(row.split(",")[col]);
};

// Every line listed on a segment must run along that whole segment
const misplaced = (L, P, SP, SE) => SP.flatMap(([a, b], s) => SE[s].filter(l => {
    const [p, q] = L[l];
    const off = (x) => Math.abs((q[0] - p[0])*(x[1] - p[1]) -
        (q[1] - p[1])*(x[0] - p[0]))/M.dist(p, q);
    return (off(P[a]) > 1e-9) || (off(P[b]) > 1e-9);
}));

test("a crease drawn in two pieces folds", async () => {
    // accordion of horizontal pleats; the crease at y = 3 is drawn as two
    // lines meeting at (7, 3), leaving a vertex in the middle of the crease
    const L = [1, 2, 4, 5, 6, 7].map(y => [[0, y], [8, y], (y % 2) ? "M" : "V"]);
    L.push([[0, 3], [7, 3], "M"], [[7, 3], [8, 3], "M"]);
    const CP = ED.add_lines(ED.new_CP(8, 8), L);
    assert.ok(has_vertex(CP, [7, 3]));
    assert.equal(await states(ED.CP_2_doc(CP)), 1n);
    // the same with every crease split, at different places
    const split = [1, 2, 3, 4, 5, 6, 7].flatMap(y => [[[0, y], [y, y], (y % 2) ? "M" : "V"],
        [[y, y], [8, y], (y % 2) ? "M" : "V"]]);
    assert.equal(await states(ED.CP_2_doc(ED.add_lines(ED.new_CP(8, 8), split))), 1n);
});

test("splitting creases does not change the folded states", async () => {
    const files = ["grids/039_brown_4x4_A17.fold", "grids/040_brown_4x4_A18.fold",
        "grids/192_brown_4x4_C51.fold", "grids/200_brown_4x4_C59.fold",
        "instagram/156_xiao_Makima.fold", "instagram/227_komatsu_Rabbit.fold",
        "instagram/282_kei_Circus.fold", "instagram/290_kei_Hand.fold"];
    const failures = [];
    for (const f of files) {
        const CP = ED.doc_type_side_n_2_CP(example(f), "fold", true);
        const creases = CP.EA.map((a, e) => e).filter(e => CP.EA[e] != "B");
        // split creases spread through the pattern at uneven fractions
        const L = [0.1, 0.35, 0.6, 0.85].map((r, k) => {
            const e = creases[Math.floor(r*creases.length)];
            const [p, q] = CP.EV[e].map(v => CP.V[v]);
            const t = [0.3, 0.45, 0.62, 0.71][k];
            return [p, M.add(p, M.mul(M.sub(q, p), t)), CP.EA[e]];
        });
        const CP2 = ED.add_lines(CP, L);
        if (CP2.V.length != CP.V.length + 4) { failures.push(`${f}: not split`); continue; }
        const [a, b] = [await states(ED.CP_2_doc(CP)), await states(ED.CP_2_doc(CP2))];
        if (a != b) { failures.push(`${f}: ${a} -> ${b}`); }
    }
    assert.deepEqual(failures, []);
});

test("a line passing close to a point is not bent through it", () => {
    // a diagonal ends on a horizontal line just past (2 - d, 2), where other
    // lines end: coarse tolerances snap the diagonal through that point and
    // along the horizontal, without changing how many points or segments
    // there are, so the tolerance search must notice the extra line
    for (const d of [0.08, 0.15]) {
        const L = [[[0, 0], [2, 2]], [[2 - d, 2], [4, 2]],
            [[2 - d, 2], [2 - d, 4]], [[0, 2], [2 - d, 2]]];
        const [P, SP, SE] = X.L_2_V_EV_EL(L, true);
        assert.deepEqual(misplaced(L, P, SP, SE), [], `offset ${d}`);
    }
});

test("examples match their recorded state counts", async () => {
    // the folded graph used to merge points along the paper's edge, making
    // edges that only meet end to end look like they overlap: Skating Girl
    // got twice its states, Raccoon crashed, and A17 crashed or not
    // depending on how its vertices were numbered
    for (const f of ["instagram/288_xiao_Skating_Girl.fold",
            "instagram/347_morisawa_Raccoon.fold", "grids/039_brown_4x4_A17.fold"]) {
        assert.equal(await states(example(f)), reference(f), f);
    }
});

test("results do not depend on how a pattern is numbered", async () => {
    const doc = example("grids/039_brown_4x4_A17.fold");
    const want = reference("grids/039_brown_4x4_A17.fold");
    let seed = 3;
    const rand = () => (seed = (seed*16807) % 2147483647)/2147483647;
    const shuffle = (A) => A.map(x => [rand(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
    for (let t = 0; t < 10; ++t) {
        const F = JSON.parse(doc);
        const perm = shuffle([...F.vertices_coords.keys()]);
        const inv = [];
        perm.forEach((p, i) => inv[p] = i);
        F.vertices_coords = perm.map(p => F.vertices_coords[p]);
        const E = shuffle(F.edges_vertices.map((e, i) => [e.map(v => inv[v]), F.edges_assignment[i]]));
        F.edges_vertices = E.map(e => e[0]);
        F.edges_assignment = E.map(e => e[1]);
        F.faces_vertices = shuffle(F.faces_vertices.map(f => {
            const g = f.map(v => inv[v]);
            const k = Math.floor(rand()*g.length);
            return g.slice(k).concat(g.slice(0, k));
        }));
        assert.equal(await states(JSON.stringify(F)), want, `shuffle ${t}`);
    }
});
