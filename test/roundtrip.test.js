// Every bundled example must survive a trip through the editor: load it as
// the editor would, save it, and import the saved file into ogmi-creaser. The
// result must match importing the original directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "./helpers.js";
import { M } from "../src/math.js";
import { IO } from "../src/io.js";
import { CON } from "../src/constraints.js";
import { ED } from "../src/edit.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");
const FILES = fs.readdirSync(ROOT)
    .filter(d => fs.statSync(path.join(ROOT, d)).isDirectory())
    .flatMap(d => fs.readdirSync(path.join(ROOT, d))
        .filter(f => f.endsWith(".fold")).map(f => path.join(d, f)))
    .sort();

const import_doc = (doc) => IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, "fold", true);
const through_editor = (doc) => {
    const CP = ED.doc_type_side_n_2_CP(doc, "fold", true);
    return (CP == undefined) ? undefined : import_doc(ED.CP_2_doc(CP));
};

// Differences between two imports of the same pattern (possibly scaled and
// numbered differently): vertices are matched by position after normalizing
const differences = ([V1, , EV1, EA1, , FV1], [V2, , EV2, EA2, , FV2]) => {
    const D = [];
    for (const [label, a, b] of [["vertices", V1, V2], ["edges", EV1, EV2], ["faces", FV1, FV2]]) {
        if (a.length != b.length) { D.push(`${label} ${a.length} -> ${b.length}`); }
    }
    if (D.length > 0) { return D; }
    const [P1, P2] = [V1, V2].map(V => M.normalize_points(V));
    const tol = 1e-6;
    const cell = (p) => p.map(c => Math.floor(c/tol));
    const grid = new Map();
    for (const [j, p] of P2.entries()) {
        const k = cell(p).join();
        grid.has(k) ? grid.get(k).push(j) : grid.set(k, [j]);
    }
    const map = P1.map(p => {
        const [cx, cy] = cell(p);
        let [best, best_d] = [-1, tol];
        for (const dx of [-1, 0, 1]) {
            for (const dy of [-1, 0, 1]) {
                for (const j of grid.get([cx + dx, cy + dy].join()) ?? []) {
                    const d = M.dist(p, P2[j]);
                    if (d < best_d) { [best, best_d] = [j, d]; }
                }
            }
        }
        return best;
    });
    const moved = map.filter(j => j < 0).length;
    if (moved > 0) { return [`${moved} vertices moved`]; }
    const E2 = new Map(EV2.map((v, e) => [M.encode_order_pair(v), e]));
    let [missing, reassigned] = [0, 0];
    for (const [e, [i, j]] of EV1.entries()) {
        const f = E2.get(M.encode_order_pair([map[i], map[j]]));
        if (f == undefined) { ++missing; } else if (EA2[f] != EA1[e]) { ++reassigned; }
    }
    if (missing > 0) { D.push(`${missing} edges missing`); }
    if (reassigned > 0) { D.push(`${reassigned} edges reassigned`); }
    return D;
};

// Examples whose round trip is expected to differ, with the exact difference
const KNOWN_DIFFERENCES = {
    // In both, an unassigned edge lies on top of boundary edges along the
    // paper's edge, passing through boundary vertices without being split
    // (it borders the same face on both sides). The editor merges the
    // duplicate into the boundary, leaving one edge fewer.
    "instagram/200_shuki_Zoanoid_Dragon_v1.fold": "edges 7953 -> 7952",
    "instagram/208_kei_General_Grievous.fold": "edges 1706 -> 1705",
};

test(`all ${FILES.length} examples load into the editor and back unchanged`, () => {
    const failures = [];
    for (const f of FILES) {
        const doc = fs.readFileSync(path.join(ROOT, f), "utf8");
        const again = through_editor(doc);
        if (again == undefined) { failures.push(`${f}: editor could not load it`); continue; }
        const D = differences(import_doc(doc), again).join(", ");
        if (D != (KNOWN_DIFFERENCES[f] ?? "")) { failures.push(`${f}: ${D || "no difference"}`); }
    }
    assert.deepEqual(failures, []);
});

test("examples fold to the same states after the trip", async () => {
    CON.build();
    const LIMIT = 100;      // states per component; enough to compare
    const MAX_FACES = 300;  // keep the suite fast
    const states = async ([V, , EV, EA, , FV]) => {
        const log = console.log;
        console.log = () => {};     // solve logs why a pattern has no state
        try {
            const out = await solve({vertices_coords: V,
                edges_vertices: EV, edges_assignment: EA, faces_vertices: FV}, LIMIT);
            return `${out.states} ${out.component_assignments}`;
        } catch (e) {       // solve throws a plain Error when unsatisfiable
            return (e instanceof TypeError) ? `crash: ${e.message}` : "no folded state";
        } finally {
            console.log = log;
        }
    };
    const failures = [];
    let checked = 0;
    for (const f of FILES) {
        const doc = fs.readFileSync(path.join(ROOT, f), "utf8");
        const direct = import_doc(doc);
        if (direct[5].length > MAX_FACES) { continue; }
        ++checked;
        const [a, b] = [await states(direct), await states(through_editor(doc))];
        if ((a != b) || a.startsWith("crash")) { failures.push(`${f}: ${a} -> ${b}`); }
    }
    assert.ok(checked > 300, `only ${checked} examples small enough`);
    assert.deepEqual(failures, []);
});
