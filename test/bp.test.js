import { test } from "node:test";
import assert from "node:assert/strict";
import { edge_set, edge_at } from "./helpers.js";
import { ED } from "../src/edit.js";
import { BP } from "../src/bp.js";

const ok = (CP) => {
    assert.ok(CP, "edit was rejected");
    return CP;
};
const snapshot = (CP) => JSON.parse(JSON.stringify(CP));
const length = (S) => S.reduce((sum, [[x1, y1], [x2, y2]]) =>
    sum + Math.hypot(x2 - x1, y2 - y1), 0);
// A river's squares in a fixed order, to compare rivers painted differently
const sorted = (R) => R.map(s => s.map(c => c + 0)).sort((s, t) =>
    (s[1] - t[1]) || (s[0] - t[0]));
// Paint a stroke from p to q, w squares wide, into river k (-1: a new one)
const paint = (CP, k, w, ...P) => ok(BP.paint(CP, k,
    P.slice(1).flatMap((q, i) => BP.stroke(CP, P[i], q, w))));
const row = (j, from = 0, to = 7) => Array.from({length: to - from + 1},
    (_, i) => [from + i, j, from + i + 1, j + 1]);

// Two circles of radius 1 on an 8 x 8 page, and a river one square wide
// painted along the fourth row, from the left edge to the right edge
const design = () => {
    let CP = ok(BP.add_flap(ED.new_CP(), [2, 2], 1));
    CP = ok(BP.add_flap(CP, [6, 2], 1));
    return paint(CP, -1, 1, [0.5, 3.5], [7.5, 3.5]);
};

test("new patterns have no circles or rivers", () => {
    const CP = ED.new_CP();
    assert.deepEqual(BP.flaps(CP), []);
    assert.deepEqual(BP.rivers(CP), []);
    assert.equal(BP.unit(CP), 1);
    assert.equal(BP.unit(ED.regrid(CP, 16, 16)), 0.5);
});

test("circles are added, moved and removed without touching the creases", () => {
    const CP = ED.new_CP();
    const before = snapshot(CP);
    const A = ok(BP.add_flap(CP, [2, 3], 1.5));
    assert.deepEqual(A.FL, [[2, 3, 1.5]]);
    assert.deepEqual(edge_set(A), edge_set(CP));
    assert.deepEqual(CP, before, "edits never mutate");
    const B = ok(BP.move_flap(A, 0, [4, 4]));
    assert.deepEqual(B.FL, [[4, 4, 1.5]]);
    assert.deepEqual(A.FL, [[2, 3, 1.5]]);
    assert.deepEqual(ok(BP.remove_flap(B, 0)).FL, []);
    for (const r of [0, -1, NaN, Infinity]) {
        assert.equal(BP.add_flap(CP, [2, 2], r), undefined, `radius ${r}`);
    }
    assert.equal(BP.add_flap(CP, [9, 2], 1), undefined, "centre off the page");
    assert.equal(BP.move_flap(A, 1, [2, 2]), undefined, "no circle 1");
    assert.equal(BP.move_flap(A, 0, [2, -1]), undefined, "centre off the page");
    assert.equal(BP.remove_flap(A, 3), undefined);
});

test("a circle replaces the circles it overlaps; touching ones stay", () => {
    let CP = ED.new_CP();
    for (const p of [[2, 2], [4, 2], [6, 6]]) { CP = ok(BP.add_flap(CP, p, 1)); }
    assert.equal(CP.FL.length, 3, "squares that only touch both stay");
    assert.deepEqual(BP.overlaps(CP, [3, 3], 1), [0, 1]);
    assert.deepEqual(BP.overlaps(CP, [3.5, 3.5], 1), [0, 1],
        "squares overlap at a diagonal (circle 0) even where the round circles do not");
    const out = ok(BP.add_flap(CP, [3, 3], 1));
    assert.deepEqual(out.FL, [[6, 6, 1], [3, 3, 1]]);
    assert.equal(CP.FL.length, 3, "the old pattern is kept for undo");
    const moved = ok(BP.move_flap(CP, 2, [5, 3]));      // onto circle 1
    assert.deepEqual(moved.FL, [[2, 2, 1], [5, 3, 1]]);
    assert.deepEqual(ok(BP.move_flap(CP, 0, [1, 2])).FL, [[1, 2, 1], [4, 2, 1], [6, 6, 1]]);
});

test("circles come and go without changing the rivers", () => {
    const CP = design();
    assert.deepEqual(ok(BP.remove_flap(CP, 0)).RV, CP.RV);
    assert.deepEqual(ok(BP.add_flap(CP, [2, 1.5], 1)).RV, CP.RV, "replacing one");
    assert.deepEqual(ok(BP.move_flap(CP, 1, [6, 6])).RV, CP.RV);
});

test("the brush paints whole squares, joined side to side", () => {
    const CP = ED.new_CP();
    assert.deepEqual(sorted(BP.stroke(CP, [0.5, 0.5], [3.5, 0.2], 1)), row(0, 0, 3));
    assert.deepEqual(sorted(BP.stroke(CP, [0.5, 0.5], [2.5, 2.5], 1)),
        [[0, 0, 1, 1], [1, 0, 2, 1], [1, 1, 2, 2], [2, 1, 3, 2], [2, 2, 3, 3]],
        "a diagonal goes round each corner, never through it");
    assert.deepEqual(sorted(BP.stroke(CP, [3.3, 3.3], [3.3, 3.3], 2)),
        [[2, 2, 3, 3], [3, 2, 4, 3], [2, 3, 3, 4], [3, 3, 4, 4]],
        "an even brush centres on the nearest grid point");
    assert.deepEqual(sorted(BP.stroke(CP, [3.3, 3.6], [3.3, 3.6], 3)),
        [...row(2, 2, 4), ...row(3, 2, 4), ...row(4, 2, 4)],
        "an odd brush centres on the square under the cursor");
    assert.equal(BP.stroke(CP, [0.2, 0.2], [0.2, 0.2], 3).length, 4, "cut off at the page");
    assert.deepEqual(BP.stroke(ED.regrid(CP, 16, 16), [0.3, 0.3], [0.3, 0.3], 1),
        [[0, 0, 0.5, 0.5]], "squares of the pattern's grid");
    assert.deepEqual(BP.stroke(CP, [9.5, 3], [9.5, 3], 1), [], "off the page");
});

test("painting skips circles and other rivers, and extends the river it starts on", () => {
    let CP = ok(BP.add_flap(ED.new_CP(), [4, 4], 1));
    CP = paint(CP, -1, 1, [0.5, 4.5], [7.5, 4.5]);
    assert.deepEqual(sorted(CP.RV[0]), [...row(4, 0, 2), ...row(4, 5, 7)],
        "the circle's square is left out");
    assert.deepEqual(BP.river_issues(CP), ["is broken into 2 pieces"]);
    const crossed = paint(CP, -1, 1, [1.5, 0.5], [1.5, 7.5]);
    assert.equal(crossed.RV.length, 2);
    assert.equal(crossed.RV[1].length, 7, "the square of the first river stays its own");
    assert.equal(crossed.RV[0].length, 6);
    const longer = paint(CP, 0, 1, [0.5, 4.5], [0.5, 7.5]);
    assert.equal(longer.RV.length, 1, "extended, not a new river");
    assert.equal(longer.RV[0].length, 9);
    assert.equal(BP.paint(CP, 0, BP.stroke(CP, [0.5, 4.5], [2.5, 4.5], 1)), undefined,
        "nothing new");
    assert.equal(BP.paint(CP, -1, BP.stroke(CP, [4, 4], [4, 4], 1)), undefined,
        "only the circle's square");
    assert.equal(BP.paint(CP, 3, row(0)), undefined, "no river 3");
    assert.equal(BP.river_at(CP, [1.5, 4.5]), 0);
    assert.equal(BP.river_at(CP, [4, 4.5]), -1);
    assert.equal(CP.FL.length, 1, "circles untouched");
});

test("a river from paper edge to paper edge, bending or not, is fine", () => {
    assert.deepEqual(BP.river_issues(design()), [undefined]);
    const L = paint(ED.new_CP(), -1, 1, [0.5, 4.5], [4.5, 4.5], [4.5, 0.5]);
    assert.deepEqual(BP.river_issues(L), [undefined], "from the left edge round to the top");
    // packing_102: small circles on the top edge, a corner circle top right,
    // and a river 3 squares wide from the left edge, round the last small
    // circle and up to the top edge
    let CP = ED.regrid(ED.new_CP(), 16, 16);
    for (const x of [0, 1, 2, 3, 4]) { CP = ok(BP.add_flap(CP, [x, 0], 0.5)); }
    CP = ok(BP.add_flap(CP, [8, 0], 2));
    CP = paint(CP, -1, 3, [0.25, 1.25], [5.25, 1.25], [5.25, 0.25]);
    assert.deepEqual(BP.river_issues(CP), [undefined]);
    assert.equal(CP.RV[0].length, 3*12 + 3, "y 0.5 to 2 from x 0 to 6, and x 4.5 to 6 above");
    assert.deepEqual(BP.river_issues(ED.new_CP()), []);
});

test("broken rivers and rivers not running edge to edge are flagged", () => {
    const issue = (...P) => BP.river_issues(paint(ED.new_CP(), -1, 1, ...P))[0];
    assert.equal(issue([2.5, 4.5], [5.5, 4.5]), "does not reach the paper edge");
    assert.equal(issue([0.5, 4.5], [4.5, 4.5]), "reaches the paper edge at one end only");
    const T = paint(paint(ED.new_CP(), -1, 1, [0.5, 4.5], [7.5, 4.5]), 0, 1,
        [4.5, 4.5], [4.5, 7.5]);
    assert.deepEqual(BP.river_issues(T), ["reaches the paper edge in 3 places, not 2"],
        "a river that forks");
    const two = ok(BP.paint(ED.new_CP(), -1, [[0, 0, 1, 1], [1, 1, 2, 2]]));
    assert.deepEqual(BP.river_issues(two), ["is broken into 2 pieces"],
        "squares meeting only at a corner are not joined");
    assert.deepEqual(BP.band_topology([], [[0, 0, 2, 2]], [0, 0, 2, 2]),
        {pieces: 1, ends: Infinity});
});

test("picking finds a circle first, then a river", () => {
    const CP = design();
    assert.deepEqual(BP.pick(CP, [2, 2.5]), {flap: 0});
    assert.deepEqual(BP.pick(CP, [6.9, 2]), {flap: 1});
    assert.deepEqual(BP.pick(CP, [4, 3.5]), {river: 0});
    assert.equal(BP.pick(CP, [7.5, 7.5]), undefined);
    assert.equal(BP.pick_centre(CP, [2.1, 2], 0.3), 0);
    assert.equal(BP.pick_centre(CP, [4, 2], 0.3), -1);
    assert.deepEqual(ok(BP.remove_river(CP, 0)).RV, []);
    assert.equal(BP.remove_river(CP, 1), undefined);
});

test("outlines trace the boundary of a union of squares", () => {
    assert.equal(length(BP.outline([[0, 0, 2, 2]])), 8);
    assert.equal(length(BP.outline([[0, 0, 2, 2], [1, 1, 3, 3]])), 12, "overlapping");
    assert.equal(length(BP.outline([[0, 0, 4, 4], [1, 1, 2, 2]])), 16, "one inside another");
    assert.equal(length(BP.outline([[0, 0, 1, 1], [1, 0, 2, 1]])), 6, "touching");
    assert.equal(length(BP.outline([[0, 0, 2, 2], [2, 2, 4, 4]])), 16, "corners touching");
    assert.equal(length(BP.outline([[0, 0, 2, 2], [0, 1, 2, 3]])), 10,
        "sides on the same line are drawn once");
    assert.equal(length(BP.outline([[0, 0, 2, 2], [0, 0, 2, 2]])), 8, "the same square twice");
    assert.equal(length(BP.outline(design().RV[0])), 18, "a painted river: one band");
    assert.deepEqual(BP.outline([]), []);
});

test("crease edits keep circles and rivers; page changes carry them along", () => {
    const CP = design();
    const same = (CP_) => {
        assert.deepEqual(ok(CP_).FL, CP.FL);
        assert.deepEqual(CP_.RV, CP.RV);
    };
    const lined = ok(ED.add_lines(CP, [[[0, 4], [8, 4], "M"]]));
    same(lined);
    same(ED.assign_edges(lined, [edge_at(lined, [0, 4], [8, 4])], "V"));
    same(ED.erase_edges(lined, [edge_at(lined, [0, 4], [8, 4])]));
    same(ED.move_vertex(lined, lined.V.findIndex(([x, y]) => (x == 0) && (y == 4)), [0, 3]));
    same(ED.cleanup(lined));
    same(ED.regrid(CP, 16, 16));
    same(ED.resize(CP, 10, 6));
    const turn = (op, FL, R) => {
        const out = ok(ED.transform(CP, op));
        assert.deepEqual(out.FL, FL, op);
        assert.deepEqual(sorted(out.RV[0]), sorted(R), op);
    };
    const column = (i) => row(0).map(([j, , k]) => [i, j, i + 1, k]);
    turn("reflect_x", [[6, 2, 1], [2, 2, 1]], row(3));
    turn("reflect_y", [[2, 6, 1], [6, 6, 1]], row(4));
    turn("rotate_cw", [[6, 2, 1], [6, 6, 1]], column(4));
    turn("rotate_ccw", [[2, 6, 1], [2, 2, 1]], column(3));
    const big = ok(ED.scale(CP, 16));
    assert.deepEqual(big.FL, [[4, 4, 2], [12, 4, 2]]);
    assert.deepEqual(sorted(big.RV[0]), row(3).map(s => s.map(c => 2*c)));
});

test("Save writes circles and rivers to the FOLD file and they open again", () => {
    const CP = design();
    const doc = ED.CP_2_doc(CP, "test");
    const json = JSON.parse(doc);
    assert.deepEqual(json["ogmi-creaser:flaps"], [
        {center: [2, 2], radius: 1}, {center: [6, 2], radius: 1}]);
    assert.deepEqual(json["ogmi-creaser:rivers"], [{cells: CP.RV[0]}]);
    const again = ok(ED.doc_type_side_n_2_CP(doc, "fold", true));
    assert.deepEqual(again.FL, CP.FL);
    assert.deepEqual(again.RV, CP.RV);
    assert.deepEqual(edge_set(again), edge_set(CP));
    const plain = JSON.parse(ED.CP_2_doc(ED.new_CP()));
    assert.ok(!("ogmi-creaser:flaps" in plain), "no circles: no properties");
    assert.ok(!("ogmi-creaser:rivers" in plain));
    assert.equal(ok(ED.doc_type_side_n_2_CP(ED.CP_2_doc(ED.new_CP()), "fold", true)).FL,
        undefined);
});

test("circles and rivers move and scale with a file that has no page", () => {
    // the design's file at half size, moved to (1, 1), without its page
    const json = JSON.parse(ED.CP_2_doc(design()));
    delete json["ogmi-creaser:page"];
    const f = ([x, y]) => [x/2 + 1, y/2 + 1];
    json.vertices_coords = json.vertices_coords.map(f);
    for (const c of json["ogmi-creaser:flaps"]) {
        c.center = f(c.center);
        c.radius /= 2;
    }
    for (const r of json["ogmi-creaser:rivers"]) {
        r.cells = r.cells.map(([x1, y1, x2, y2]) => [...f([x1, y1]), ...f([x2, y2])]);
    }
    const CP = ok(ED.doc_type_side_n_2_CP(JSON.stringify(json), "fold", true));
    assert.equal(CP.W, 8);
    assert.deepEqual(CP.FL, design().FL);
    assert.deepEqual(CP.RV, design().RV);
});

test("opening the other side up turns circles and rivers over with the creases", () => {
    const CP = ok(ED.doc_type_side_n_2_CP(ED.CP_2_doc(design()), "fold", false));
    assert.deepEqual(CP.FL, [[2, 6, 1], [6, 6, 1]]);
    assert.deepEqual(sorted(CP.RV[0]), row(4));
});

test("malformed circles and rivers in a file are skipped", () => {
    const json = JSON.parse(ED.CP_2_doc(design()));
    json["ogmi-creaser:flaps"] = [
        {center: [1, 1], radius: 1},
        {center: [3, 3], radius: -1},           // bad radius
        {center: [3], radius: 1},               // bad centre
        {center: [20, 3], radius: 1},           // off the page
        {center: ["1", 7], radius: 1},          // not a number
        {center: [7, 7], radius: 0.5},
        "nonsense",
    ];
    json["ogmi-creaser:rivers"] = [
        {cells: [[0, 0, 1, 1], [1, 0, 2, 1], [2, 0, 1, 1],     // backwards
            [1, 0, 2], [20, 0, 21, 1], ["0", 1, 1, 2], [1, 0, 2, 1]]},
        {cells: [[30, 30, 31, 31]]},            // nothing left on the page
        {width: 1, flaps: [0]},                 // the old way of saving rivers
        {cells: "nonsense"},
        null,
    ];
    const CP = ok(ED.doc_type_side_n_2_CP(JSON.stringify(json), "fold", true));
    assert.deepEqual(CP.FL, [[1, 1, 1], [7, 7, 0.5]]);
    assert.deepEqual(CP.RV, [[[0, 0, 1, 1], [1, 0, 2, 1]]], "duplicates dropped too");
    json["ogmi-creaser:flaps"] = "nonsense";
    assert.equal(ok(ED.doc_type_side_n_2_CP(JSON.stringify(json), "fold", true)).FL,
        undefined);
});

test("the author is saved as file_author, and read back", () => {
    const doc = ED.CP_2_doc(ED.new_CP(), "t", "  A. Folder ");
    assert.equal(JSON.parse(doc).file_author, "A. Folder");
    assert.ok(!("file_author" in JSON.parse(ED.CP_2_doc(ED.new_CP(), "t", " "))));
    assert.ok(!("file_author" in JSON.parse(ED.CP_2_doc(ED.new_CP(), "t"))));
    assert.equal(ED.doc_2_author(doc, "fold"), "A. Folder");
    assert.equal(ED.doc_2_author(ED.CP_2_doc(ED.new_CP()), "fold"), "");
    assert.equal(ED.doc_2_author("not json", "fold"), "");
    assert.equal(ED.doc_2_author("1 0 0 1 1", "cp"), "");
});

test("the folded view reads circles and rivers as the file is imported", () => {
    const doc = ED.CP_2_doc(design());
    assert.deepEqual(BP.doc_2_FL_RV(doc, "fold", true), [design().FL, design().RV]);
    const [FL, RV] = BP.doc_2_FL_RV(doc, "fold", false);
    assert.deepEqual(FL, [[2, -1, 1], [6, -1, 1]], "turned over like the vertices (y -> 1 - y)");
    assert.deepEqual(sorted(RV[0]), row(-3));
    assert.equal(BP.doc_2_FL_RV(ED.CP_2_doc(ED.new_CP()), "fold", true), undefined);
    assert.equal(BP.doc_2_FL_RV("1 0 0 1 1", "cp", true), undefined);
});

// packing_103_2: a river 2 squares (1 page unit) wide from the left edge to
// the right edge along y = 2 to 3, dipping down between x = 5 and 7 to y = 5
// and back up: a U-turn
const u_turn = () => {
    let CP = ED.regrid(ED.new_CP(), 16, 16);
    CP = paint(CP, -1, 2, [0.25, 2.5], [7.75, 2.5]);
    CP = paint(CP, 0, 2, [5.5, 2.5], [5.5, 4.5], [6.5, 4.5], [6.5, 2.5]);
    return CP;
};
// The ends of a river's curves, as drawn
const arcs = ({line}) => line.filter(([c]) => c == "C").map(([, , , p]) => p);

test("a river's width is its narrowest run of squares", () => {
    assert.equal(BP.river_width(design().RV[0]), 1);
    assert.equal(BP.river_width(u_turn().RV[0]), 1);
    assert.equal(BP.river_width(paint(ED.new_CP(), -1, 3,
        [1.5, 1.5], [6.5, 1.5], [6.5, 6.5]).RV[0]), 3);
});

test("a river's outline runs round it with the river on its right", () => {
    assert.deepEqual(BP.river_loops([[0, 0, 1, 1]]), [[[0, 0], [1, 0], [1, 1], [0, 1]]]);
    assert.deepEqual(BP.river_loops(u_turn().RV[0]),
        [[[0, 2], [8, 2], [8, 3], [7, 3], [7, 5], [5, 5], [5, 3], [0, 3]]]);
    const ring = [...row(0, 0, 2), [0, 1, 1, 2], [2, 1, 3, 2], ...row(2, 0, 2)];
    const loops = BP.river_loops(ring);
    assert.equal(loops.length, 2, "outside and the hole");
    assert.deepEqual(loops.map(P => P.length), [4, 4]);
    assert.equal(BP.river_loops([[0, 0, 1, 1], [1, 1, 2, 2]]).length, 2,
        "squares meeting only at a corner");
});

test("a river's course runs block by block from paper edge to paper edge", () => {
    const at = (CP) => BP.river_course(CP.RV[0], [0, 0, CP.W, CP.H])?.path
        .map(B => B.at.join(","));
    assert.deepEqual(at(u_turn()), ["0,2", "1,2", "2,2", "3,2", "4,2", "5,2", "5,3",
        "5,4", "6,4", "6,3", "6,2", "7,2"], "in, down, round, up and out");
    assert.equal(at(design()).length, 8, "straight across");
    assert.equal(at(paint(ED.new_CP(), -1, 1, [2.5, 4.5], [5.5, 4.5])), undefined,
        "not reaching the paper edge: no course");
    assert.equal(at(paint(paint(ED.new_CP(), -1, 1, [0.5, 4.5], [7.5, 4.5]), 0, 1,
        [4.5, 4.5], [4.5, 7.5])), undefined, "a fork: no course");
    assert.deepEqual(at(ok(BP.paint(ED.new_CP(), -1, [...row(3), [0, 4, 1, 5]]))),
        ["0,4", "0,3", "1,3", "2,3", "3,3", "4,3", "5,3", "6,3", "7,3"],
        "in from the left edge a row lower, then a turn");
    const offset = [...row(2, 0, 3), ...row(3, 0, 3), ...row(3, 4, 7), ...row(4, 4, 7)];
    assert.equal(BP.river_width(offset), 2);
    assert.equal(at(ok(BP.paint(ED.new_CP(), -1, offset))), undefined,
        "two squares wide, its halves a square out of line: no lattice of blocks fits");
});

test("a river curves where it turns, as wide as the river", () => {
    const U = BP.river_shapes(u_turn())[0];
    assert.deepEqual(arcs(U), [[6, 3], [6, 5], [7, 4], [7, 2]],
        "in at the top, round the bottom (a half circle about (6, 4)), out at the top");
    const C = U.line.filter(([c]) => c == "C");
    for (const [[, c1, c2], centre] of C.map((c, i) => [c, [[5, 3], [6, 4], [6, 4], [7, 3]][i]])) {
        for (const p of [c1, c2]) {     // handles of a circle of radius 1
            const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
            assert.ok((d > 1) && (d < 1.2), `handle ${p} near the circle about ${centre}`);
        }
    }
    const between = U.line.some(([c, p], i) => (c == "M") && (p[0] == 6) && (p[1] == 3) &&
        (U.line[i + 1][0] == "L") && (U.line[i + 1][1][0] == 6) && (U.line[i + 1][1][1] == 4));
    assert.ok(between, "a line between the legs, where the river runs beside itself");
    assert.ok(!U.line.some(([c, p]) => (c == "L") && (p[1] == 2) && (p[0] > 5) && (p[0] < 7)),
        "no straight edge left across the top of the dip");
    assert.deepEqual(arcs(BP.river_shapes(design())[0]), [], "a straight river");
    // packing_102's river turns up round the last small circle's corner
    // (4.5, 0.5): an arc of radius 1.5 from (4.5, 2) to (6, 0.5)
    let CP = ED.regrid(ED.new_CP(), 16, 16);
    for (const x of [0, 1, 2, 3, 4]) { CP = ok(BP.add_flap(CP, [x, 0], 0.5)); }
    CP = ok(BP.add_flap(CP, [8, 0], 2));
    CP = paint(CP, -1, 3, [0.25, 1.25], [5.25, 1.25], [5.25, 0.25]);
    const P = BP.river_shapes(CP)[0];
    assert.deepEqual(arcs(P), [[6, 0.5]]);
    assert.ok(P.line.some(([c, p], i) => (c == "M") && (p[0] == 4.5) && (p[1] == 2) &&
        (P.line[i + 1][0] == "C")), "starting at (4.5, 2)");
    // a river with no course still has its outline's corners rounded
    const blob = BP.river_shapes(paint(ED.new_CP(), -1, 1, [2.5, 4.5], [5.5, 4.5]))[0];
    assert.equal(arcs(blob).length, 4);
    assert.deepEqual(blob.line, blob.fill, "drawn as its outline");
    assert.deepEqual(BP.river_shapes(ED.new_CP()), []);
});
