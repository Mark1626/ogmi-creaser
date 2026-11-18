import { M } from "../src/math.js";
import { NOTE } from "../src/note.js";
import { CON } from "../src/constraints.js";
import { X } from "../src/conversion.js";
import { SOLVER } from "../src/solver.js";

NOTE.show = false;      // keep ogmi-creaser's progress log out of test output

// Folded states of a FOLD crease pattern, found without the interface by the
// same steps the app's compute worker takes (CON.build() must have run).
// Returns {states, component_assignments}: the BigInt number of folded states
// and each component's assignment count as "|a|b|...|", up to lim per
// component. Throws a plain Error when there is no folded state, and logs why
// with console.log.
export const solve = async (fold, lim) => {
    const V  = fold.vertices_coords;
    const EV = fold.edges_vertices;
    const EA = fold.edges_assignment;
    const FV = fold.faces_vertices;
    const [EF, ] = X.EV_FV_2_EF_FE(EV, FV);
    const [Vf, Ff] = X.V_FV_EV_EA_2_Vf_Ff(V, FV, EV, EA);
    const L = EV.map((P) => M.expand(P, Vf));
    // keep a point wherever a folded edge ends: merging collinear ends away
    // would list edges that only touch end to end (e.g. at a vertex in the
    // middle of a straight crease or along the paper's edge) on one shared
    // segment, as if they overlapped, giving wrong constraints
    const [P, SP, SE] = X.L_2_V_EV_EL(L, true);
    if (P.length == 0) {
        console.log("(Precision Error: could not find stable graph)");
        throw new Error();
    }
    const [,CP] = X.V_EV_2_VV_FV(P, SP);
    const [SC, ] = X.EV_FV_2_EF_FE(SP, CP);
    const [CF, FC] = X.EF_FV_P_SP_SE_CP_SC_2_CF_FC(EF, FV, P, SP, SE, CP, SC);
    const BF = X.EF_SP_SE_CP_CF_2_BF(EF, SP, SE, CP, CF);
    const BI = new Map();
    for (const [i, F] of BF.entries()) { BI.set(F, i); }
    const BT = X.BF_BI_EF_SE_CF_SC_2_BT(BF, BI, EF, SE, CF, SC);
    const CC = X.FC_BF_BI_BT_2_CC(FC, BF, BI, BT);
    const BA0 = SOLVER.EF_EA_Ff_BF_BI_2_BA0(EF, EA, Ff, BF, BI);
    const trans_count = {all: 0, reduced: 0};
    const out = SOLVER.initial_assignment(BA0, BF, BT, BI, FC, CF, CC, trans_count);
    if ((out.length == 3) && (out[0].length == undefined)) {
        const [type, F] = out;
        console.log(` - Unable to resolve ${CON.names[type]} on faces [${F}]`);
        throw new Error();
    }
    const BA = out;
    const GB = SOLVER.get_components(BI, BF, BT, BA, FC, CF, CC, trans_count);
    const GA = SOLVER.solve(BI, BF, BT, BA, GB, FC, CF, CC, lim);
    if (GA.length == undefined) {
        console.log(`   - Unable to resolve component ${GA}`);
        throw new Error();
    }
    return {
        states: GA.reduce((s, A) => s*BigInt(A.length), BigInt(1)),
        component_assignments: `|${GA.map((A) => A.length).join("|")}|`,
    };
};

// Rounded coordinate key, so geometry can be compared independent of the
// order in which vertices and edges are numbered
export const key = (p) => p.map(c => (Math.round(c*1e6)/1e6 + 0).toFixed(6)).join(",");

// Sorted list of "p q a" strings: the edge set of a CP-like {V, EV, EA}
export const edge_set = ({V, EV, EA}) => EV.map(([i, j], e) => {
    const [a, b] = [key(V[i]), key(V[j])].sort();
    return `${a} ${b} ${EA[e]}`;
}).sort();

export const has_vertex = ({V}, p) => V.some(q => M.dist(p, q) < 1e-9);

// Index of the edge between the vertices at points p and q
export const edge_at = ({V, EV}, p, q) => EV.findIndex(([i, j]) =>
    ((M.dist(V[i], p) < 1e-9) && (M.dist(V[j], q) < 1e-9)) ||
    ((M.dist(V[i], q) < 1e-9) && (M.dist(V[j], p) < 1e-9)));

// Assignments of the edges lying on the horizontal line y, left to right,
// as [x_start, x_end, assignment]
export const along_y = ({V, EV, EA}, y) => EV
    .map(([i, j], e) => [V[i], V[j], EA[e]])
    .filter(([p, q]) => (Math.abs(p[1] - y) < 1e-9) && (Math.abs(q[1] - y) < 1e-9))
    .map(([p, q, a]) => [Math.min(p[0], q[0]), Math.max(p[0], q[0]), a])
    .sort((a, b) => a[0] - b[0]);
