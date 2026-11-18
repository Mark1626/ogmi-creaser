import { M } from "./math.js";
import { X } from "./conversion.js";
import { IO } from "./io.js";

// Crease pattern editor geometry (no DOM).
//
// The editor's crease pattern is a plain object
// CP = {W, H, GW, GH, tol, V, EV, EA}:
//
// W, H | page size; the page is [0, W] x [0, H] with x to the right and y
//      | downward (screen coordinates). A new page is W x H unit squares
// GW,GH| grid columns and rows: grid lines at x = i*W/GW and y = j*H/GH.
//      | Changing them changes only the grid (cells may be rectangles); the
//      | paper and creases stay as they are
// tol  | merge tolerance as a fraction of the page size (see ED.TOLS)
// V    | vertices_coords
// EV   | edges_vertices
// EA   | edges_assignment, one of ED.A, in ogmi-creaser's own convention (the
//      | one GUI draws: paper white side up), so that importing the editor's
//      | output into ogmi-creaser shows exactly what was drawn
//
// CPs are never mutated. Every edit takes a CP and returns a new one, or
// undefined when the edit is invalid or the result cannot be built; the caller
// then keeps the old CP, so each edit is all-or-nothing and undo is just a
// stack of CPs.
//
// The planar graph is never patched in place. Each edit turns the current
// edges back into lines, changes the lines, and rebuilds the graph with the
// same sweep ogmi-creaser uses to import files (X.L_eps_2_V_EV_EL), in its
// keep_ends mode. The sweep splits crossing lines, merges coincident
// vertices, merges overlapping collinear lines, and drops vertices no line
// touches. In keep_ends mode every line end stays a vertex, so dangling
// creases, subdivisions and partly reassigned lines survive later edits.
export const ED = {     // EDITOR
    // Merge tolerances to try, as fractions of the page size; the first is
    // the default for new patterns. A loaded file uses the first one that
    // reproduces ogmi-creaser's graph of it: files differ in precision (some
    // are only accurate to about 1e-6 of the paper, and a tolerance near that
    // noise finds spurious crossings), so no single tolerance fits them all.
    TOLS: [20, 22, 18, 24, 16, 26, 14, 28, 30, 32, 34].map(k => 2**-k),
    A: ["B", "M", "V", "F", "U"],
    eps: (W, H, tol) => tol*Math.max(W, H),
    valid_size: (W, H) => Number.isInteger(W) && Number.isInteger(H) &&
        (W >= 1) && (H >= 1),
    in_page: ([x, y], W, H, eps) => Number.isFinite(x) && Number.isFinite(y) &&
        (-eps <= x) && (x <= W + eps) && (-eps <= y) && (y <= H + eps),

    // ---- building
    L_eps_2_V_EV_EA: (L, eps) => {
        // L is in drawing order. Where lines overlap, an edge takes the
        // assignment of the newest (last) line covering it.
        const L_ = L.filter(([p, q]) => M.dist(p, q) > eps);
        if (L_.length == 0) { return [[], [], []]; }
        const [V, EV, EL] = X.L_eps_2_V_EV_EL(L_, eps, true);   // keep ends
        if (V.length == 0) { return undefined; }    // sweep failed
        const EA = EL.map(Ls => L_[Ls[Ls.length - 1]][2]);
        return [V, EV, EA];
    },
    W_H_L_2_CP: (W, H, L, tol = ED.TOLS[0], GW = W, GH = H) => {
        const out = ED.L_eps_2_V_EV_EA(L, ED.eps(W, H, tol));
        if (out == undefined) { return undefined; }
        const [V, EV, EA] = out;
        return {W, H, GW, GH, tol, V, EV, EA};
    },
    rebuild: (CP, L) => ED.W_H_L_2_CP(CP.W, CP.H, L, CP.tol, CP.GW, CP.GH),
    CP_2_L: ({V, EV, EA}) => EV.map(([i, j], e) => [V[i], V[j], EA[e]]),
    W_H_2_L: (W, H) => {        // boundary of rectangular paper filling page
        const C = [[0, 0], [W, 0], [W, H], [0, H]];
        return C.map((p, i) => [p, C[(i + 1) % 4], "B"]);
    },

    // ---- edits
    new_CP: (W = 8, H = 8) => {
        if (!ED.valid_size(W, H)) { return undefined; }
        return ED.W_H_L_2_CP(W, H, ED.W_H_2_L(W, H));
    },
    add_lines: (CP, L) => {     // L: [[p, q, a], ...]
        const {W, H, tol} = CP;
        const eps = ED.eps(W, H, tol);
        for (const [p, q, a] of L) {
            if (!ED.in_page(p, W, H, eps) || !ED.in_page(q, W, H, eps) ||
                !ED.A.includes(a)) { return undefined; }
        }
        return ED.rebuild(CP, ED.CP_2_L(CP).concat(L));
    },
    erase_edges: (CP, E) => {
        const S = new Set(E);
        return ED.rebuild(CP, ED.CP_2_L(CP).filter((_, e) => !S.has(e)));
    },
    assign_edges: (CP, E, a) => {
        const n = CP.EA.length;
        if (!ED.A.includes(a) ||
            E.some(e => !(Number.isInteger(e) && (0 <= e) && (e < n)))) {
            return undefined;
        }
        const EA = CP.EA.slice();   // geometry is unchanged: no rebuild
        for (const e of E) { EA[e] = a; }
        return {...CP, EA};
    },
    move_vertex: (CP, v, p) => {
        const {W, H, tol, V} = CP;
        if (!Number.isInteger(v) || !(v in V) ||
            !ED.in_page(p, W, H, ED.eps(W, H, tol))) { return undefined; }
        const V_ = V.slice();
        V_[v] = p;
        return ED.rebuild(CP, ED.CP_2_L({...CP, V: V_}));
    },
    cleanup: (CP) => {
        // Merge each vertex of degree 2 whose two edges continue straight
        // through it and have the same assignment.
        const {W, H, tol, V, EV, EA} = CP;
        const eps = ED.eps(W, H, tol);
        const VE = V.map(() => []);
        for (const [e, [i, j]] of EV.entries()) { VE[i].push(e); VE[j].push(e); }
        const parent = EV.map((_, e) => e);     // union-find over edges
        const find = (e) => {
            while (parent[e] != e) { e = parent[e] = parent[parent[e]]; }
            return e;
        };
        const other = (e, v) => (EV[e][0] == v) ? EV[e][1] : EV[e][0];
        for (const [v, E] of VE.entries()) {
            if (E.length != 2) { continue; }
            const [e1, e2] = E;
            if (EA[e1] != EA[e2]) { continue; }
            const [a, b, c] = [V[other(e1, v)], V[other(e2, v)], V[v]];
            const off_line = Math.abs(M.area2(a, b, c))/M.dist(a, b);
            const between = M.dot(M.sub(a, c), M.sub(b, c)) < 0;
            if ((off_line <= eps) && between) { parent[find(e1)] = find(e2); }
        }
        const groups = new Map();   // group root -> vertex -> count
        for (const [e, [i, j]] of EV.entries()) {
            const g = find(e);
            if (!groups.has(g)) { groups.set(g, new Map()); }
            const C = groups.get(g);
            for (const v of [i, j]) { C.set(v, (C.get(v) ?? 0) + 1); }
        }
        const L = [];
        for (const [g, C] of groups) {  // a straight chain: ends seen once
            const ends = [];
            for (const [v, count] of C) { if (count == 1) { ends.push(V[v]); } }
            if (ends.length != 2) { return undefined; }
            L.push([ends[0], ends[1], EA[g]]);
        }
        return ED.rebuild(CP, L);
    },
    transform: (CP, op) => {
        // Reflections and quarter turns of the page; rotations swap W and H
        // (and the grid's columns and rows). Assignments are unchanged (the
        // result is seen from the same side).
        const {W, H, GW, GH, tol, V, EV, EA} = CP;
        const T = {
            reflect_x:  [false, ([x, y]) => [W - x, y]],
            reflect_y:  [false, ([x, y]) => [x, H - y]],
            rotate_cw:  [true, ([x, y]) => [H - y, x]],
            rotate_ccw: [true, ([x, y]) => [y, W - x]],
        }[op];
        if (T == undefined) { return undefined; }
        const [turn, f] = T;
        return {...(turn ? {W: H, H: W, GW: GH, GH: GW} : {W, H, GW, GH}),
            tol, V: V.map(f), EV, EA};
    },
    resize: (CP, GW_, GH_) => {
        // Make the grid GW_ x GH_ squares by adding or removing them at the
        // right and bottom; creases keep their size and place. If the paper is the page rectangle (every B
        // edge lies on the page border), the boundary moves with the page:
        // growing leaves creases that reached the right or bottom edge
        // ending inside the paper, and shrinking cuts creases at the new
        // edge (dropping any wholly outside). Other paper shapes keep their
        // boundary and only the page changes, refused if anything would end
        // up outside it.
        if (!ED.valid_size(GW_, GH_)) { return undefined; }
        const {W, H, tol} = CP;
        const [W_, H_] = ED.grid_2_page(CP, GW_, GH_);
        const eps = ED.eps(Math.max(W, W_), Math.max(H, H_), tol);
        const border = ED.page_border(CP, eps);
        const rect = border.some(b => b) &&
            CP.EA.every((a, e) => (a != "B") || border[e]);
        const L = [];
        for (const [e, [p, q, a]] of ED.CP_2_L(CP).entries()) {
            if (rect && border[e]) { continue; }    // replaced below
            if (ED.in_page(p, W_, H_, eps) && ED.in_page(q, W_, H_, eps)) {
                L.push([p, q, a]);
                continue;
            }
            if (!rect) { return undefined; }
            const pq = ED.clip([p, q], W_, H_, eps);
            if (pq != undefined) { L.push([...pq, a]); }
        }
        return ED.W_H_L_2_CP(W_, H_,
            rect ? L.concat(ED.W_H_2_L(W_, H_)) : L, tol, GW_, GH_);
    },
    grid_2_page: ({W, H, GW, GH}, GW_, GH_) => {   // page size of a grid of
        const f = (n, size, N) => (size == N) ? n : n*size/N;   // GW_ x GH_
        return [f(GW_, W, GW), f(GH_, H, GH)];      // squares of the CP's size
    },
    resize_cuts: (CP, GW_, GH_) => {    // creases resizing would cut or drop
        const [W_, H_] = ED.grid_2_page(CP, GW_, GH_);
        const eps = ED.eps(Math.max(CP.W, W_), Math.max(CP.H, H_), CP.tol);
        return ED.CP_2_L(CP).filter(([p, q, a]) => (a != "B") &&
            !(ED.in_page(p, W_, H_, eps) && ED.in_page(q, W_, H_, eps))).length;
    },
    page_border: ({W, H, V, EV, EA}, eps) => EV.map(([i, j], e) => {
        // whether each edge is a boundary edge along the page border
        const near = (a, b) => Math.abs(a - b) <= eps;
        const [[x1, y1], [x2, y2]] = [V[i], V[j]];
        return (EA[e] == "B") && (
            (near(x1, 0) && near(x2, 0)) || (near(x1, W) && near(x2, W)) ||
            (near(y1, 0) && near(y2, 0)) || (near(y1, H) && near(y2, H)));
    }),
    clip: ([p, q], W, H, eps) => {
        // The part of segment pq inside the page [0, W] x [0, H], or
        // undefined if less than eps of it is inside (Liang-Barsky)
        const d = M.sub(q, p);
        let [t0, t1] = [0, 1];
        for (const [k, size] of [[0, W], [1, H]]) {
            if (d[k] == 0) {        // parallel to these sides
                if ((p[k] < -eps) || (p[k] > size + eps)) { return undefined; }
                continue;
            }
            const [a, b] = [-p[k]/d[k], (size - p[k])/d[k]];
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
        }
        // clamp, so a cut end lies exactly on the page border
        const at = (t) => [Math.min(Math.max(p[0] + t*d[0], 0), W),
                           Math.min(Math.max(p[1] + t*d[1], 0), H)];
        const [a, b] = [at(t0), at(t1)];
        return ((t0 < t1) && (M.dist(a, b) > eps)) ? [a, b] : undefined;
    },
    regrid: (CP, GW_, GH_ = CP.GH) => {
        // A grid of GW_ columns and GH_ rows over the same paper; the paper
        // and creases are unchanged
        const ok = (n) => Number.isFinite(n) && (n > 0);
        return (ok(GW_) && ok(GH_)) ? {...CP, GW: GW_, GH: GH_} : undefined;
    },
    scale: (CP, W_) => {
        // Scale everything so the page is W_ units wide (and proportionally
        // high), with a grid of unit squares: opened designs are put on
        // their own grid this way
        const {W, H, tol, V, EV, EA} = CP;
        if (!Number.isFinite(W_) || !(W_ > 0)) { return undefined; }
        const f = (x) => {      // x*W_/W, landing exactly on whole numbers
            const y = x*W_/W;
            const r = Math.round(y);
            return (Math.abs(y - r) < 1e-9*Math.max(1, Math.abs(y))) ? r : y;
        };
        return {W: f(W), H: f(H), GW: f(W), GH: f(H), tol,
            V: V.map(([x, y]) => [f(x), f(y)]), EV, EA};
    },
    fit_grid: ({W, H, V}, min = 1, max = 128) => {
        // Smallest N in [min, max] such that, with the page N grid squares
        // along its longer side, every vertex lies on a grid point (to within
        // 1e-3 of a square, above the imprecision of real files). The grid
        // is then N*W/L x N*H/L squares (see ED.fit_grid_size)
        const L = Math.max(W, H);
        for (let N = min; N <= max; ++N) {
            const s = N/L;
            if (V.every(p => p.every(c => Math.abs(c*s - Math.round(c*s)) < 1e-3))) {
                return N;
            }
        }
        return undefined;
    },
    fit_grid_size: ({W, H}, N) => {     // grid of N squares on the longer side
        const L = Math.max(W, H);
        const f = (size) => (size == L) ? N : N*size/L;
        return [f(W), f(H)];
    },

    // ---- analysis
    CP_2_VK: (CP) => ED.CP_2_FV_VK(CP)[1],
    CP_2_FV_VK: ({V, EV, EA}) => {
        // Faces, and per vertex deviation from local flat-foldability
        // (Kawasaki, with Maekawa and odd degree scored 1) as ogmi-creaser
        // computes on import; GUI flags values above 1/M.EPS
        if (V.length == 0) { return [[], []]; }
        const [VV, FV] = X.V_EV_2_VV_FV(V, EV);
        return [FV, X.V_VV_EV_EA_2_VK(V, VV, EV, EA)];
    },

    // ---- picking (pointer input from the interface, in page units)
    snap: ({W, H, GW, GH, V}, p, skip = -1) => {
        // Nearest grid point or vertex (always snaps, like cp-editor),
        // ignoring vertex skip (the one being moved)
        const grid = (x, size, N) => {  // nearest grid line, inside the page
            const i = Math.round(x*N/size);
            return Math.max(0, Math.min(size, (size == N) ? i : i*size/N));
        };
        let best = [grid(p[0], W, GW), grid(p[1], H, GH)];
        let best_d = M.dist(p, best);
        for (const [i, v] of V.entries()) {
            if (i == skip) { continue; }
            const d = M.dist(p, v);
            if (d < best_d) { [best, best_d] = [v, d]; }
        }
        return [best[0], best[1]];
    },
    pick_vertex: ({V}, p, r) => {   // nearest vertex within r of p, or -1
        let [best, best_d] = [-1, r];
        for (const [i, v] of V.entries()) {
            const d = M.dist(p, v);
            if (d <= best_d) { [best, best_d] = [i, d]; }
        }
        return best;
    },
    seg_dist: (p, a, b) => {        // distance from point p to segment ab
        const v = M.sub(b, a);
        const vv = M.dot(v, v);
        if (vv == 0) { return M.dist(p, a); }
        const t = Math.max(0, Math.min(1, M.dot(M.sub(p, a), v)/vv));
        return M.dist(p, M.add(a, M.mul(v, t)));
    },
    pick_edge: ({V, EV}, p, r) => {  // nearest edge within r of p, or -1
        let [best, best_d] = [-1, r];
        for (const [e, [i, j]] of EV.entries()) {
            const d = ED.seg_dist(p, V[i], V[j]);
            if (d <= best_d) { [best, best_d] = [e, d]; }
        }
        return best;
    },
    edges_crossed: ({V, EV}, p, q) => {   // edges that segment pq crosses
        const E = [];
        for (const [e, [i, j]] of EV.entries()) {
            const [a, b] = [V[i], V[j]];
            if ((M.area2(p, q, a)*M.area2(p, q, b) < 0) &&
                (M.area2(a, b, p)*M.area2(a, b, q) < 0)) { E.push(e); }
        }
        return E;
    },

    // ---- files
    CP_2_doc: (CP, title = "creasepattern") => {
        // FOLD text with faces. Faces are wound like ogmi-creaser's own files
        // (first face has positive area), so ogmi-creaser imports this with EA
        // as is; files without faces would get M and V swapped on import.
        const {W, H, tol, V, EV, EA} = CP;
        const FOLD = {
            file_spec: 1.1,
            file_creator: "ogmi-creaser editor",
            file_title: title,
            file_classes: ["singleModel"],
            frame_classes: ["creasePattern"],
            vertices_coords: V,
            edges_vertices: EV,
            edges_assignment: EA,
        };
        if (V.length > 0) {
            const [, FV] = X.V_EV_2_VV_FV(V, EV);
            if (FV.length > 0) { FOLD.faces_vertices = FV; }
        }
        FOLD["ogmi-creaser:page"] = {width: W, height: H, tolerance: tol,
            grid: [CP.GW, CP.GH]};
        return JSON.stringify(FOLD, undefined, 2);
    },
    SVG_COLORS: {       // stroke colours of an exported SVG, per EA
        // EA is in ogmi-creaser's white-side-up convention, so its M is a
        // valley seen from the coloured side: export red for V and blue for
        // M, the usual red mountain / blue valley of the coloured side. Line
        // formats are read as the coloured side (IO.SVGstyle_2_A, then M/V
        // swapped on import), so ogmi-creaser reads this back as drawn.
        V: "#ff0000", M: "#0000ff", F: "#808080", B: "#000000",
        U: "#ff8000",   // any other colour reads back as unassigned
    },
    CP_2_svg: (CP, title = "creasepattern") => {
        const {W, H, V, EV, EA} = CP;
        const S = 50;           // pixels per grid unit
        const m = S/4;          // margin
        const esc = (s) => s.replace(/[&<>"]/g,
            c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"})[c]);
        const f = (x) => String(Math.round(x*S*1e6)/1e6);
        const order = {F: 0, U: 1, M: 2, V: 2, B: 3};   // boundary on top
        const lines = EV.map((_, e) => e)
            .sort((a, b) => order[EA[a]] - order[EA[b]])
            .map(e => {
                const [[x1, y1], [x2, y2]] = EV[e].map(v => V[v]);
                const w = (EA[e] == "B") ? 3 : 2;
                return `  <line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" ` +
                    `y2="${f(y2)}" style="stroke:${ED.SVG_COLORS[EA[e]]};` +
                    `stroke-width:${w};stroke-linecap:round"/>`;
            });
        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${W*S + 2*m}" ` +
            `height="${H*S + 2*m}" viewBox="${-m} ${-m} ${W*S + 2*m} ${H*S + 2*m}">`,
            `  <title>${esc(title)}</title>`,
            ...lines,
            "</svg>",
            "",
        ].join("\n");
    },
    doc_type_side_n_2_CP: (doc, type, side, n = 8) => {
        // Load a file through ogmi-creaser's own import, so the editor starts
        // from exactly the graph and assignments ogmi-creaser shows for it
        // (holes removed, outer edges marked B, M/V in ogmi-creaser's
        // convention). A file saved by the editor keeps its page and grid;
        // anything else is moved to the origin and scaled onto its own grid
        // (see fit_grid), or so its longer side spans n grid squares.
        const [V, , EV, EA] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(
            doc, type, side);
        if ((V == undefined) || (V.length == 0)) { return undefined; }
        let page;
        if (type == "fold") {
            try {   // files saved before the rename use "flat-folder:page"
                const json = JSON.parse(doc);
                page = json["ogmi-creaser:page"] ?? json["flat-folder:page"];
            } catch {}
        }
        let W, H, f;
        const size = (x) => Number.isFinite(x) && (x > 0);  // regrid can make
        const has_page = (page != undefined) &&             // fractional sides
            size(page.width) && size(page.height) &&
            V.every(p => ED.in_page(p, page.width, page.height,
                ED.eps(page.width, page.height, ED.TOLS[0])));
        if (has_page) {
            [W, H, f] = [page.width, page.height, p => p];
        } else {
            const [p_min, p_max] = M.bounding_box(V);
            const [w, h] = M.sub(p_max, p_min);
            const s = n/Math.max(w, h);
            const fit = (d) => {        // page side covering d grid units
                const r = Math.round(d);
                return Math.max(1, (Math.abs(d - r) < 1e-6) ? r : Math.ceil(d));
            };
            [W, H, f] = [fit(w*s), fit(h*s), p => M.mul(M.sub(p, p_min), s)];
        }
        const L = EV.map(([i, j], e) => [f(V[i]), f(V[j]),
            ED.A.includes(EA[e]) ? EA[e] : "U"]);
        // Edges only overlap in degenerate files (e.g. a crease drawn on top
        // of the boundary); put boundary lines last so the boundary wins
        L.sort((l1, l2) => (l1[2] == "B") - (l2[2] == "B"));
        // Use the first tolerance whose graph matches ogmi-creaser's (the one
        // saved with the file first); if none does, the file has overlapping
        // edges, which the first tolerance that builds at all merges away
        const nV = new Set(EV.flat()).size;
        const saved = page?.tolerance;
        const tols = (Number.isFinite(saved) && (saved > 0))
            ? [saved, ...ED.TOLS] : ED.TOLS;
        let CP;
        for (const tol of tols) {
            const CP_ = ED.W_H_L_2_CP(W, H, L, tol);
            if (CP_ == undefined) { continue; }
            CP ??= CP_;
            if ((CP_.V.length == nV) && (CP_.EV.length == EV.length)) {
                CP = CP_;
                break;
            }
        }
        if (CP == undefined) { return undefined; }
        if (has_page) {     // its own grid (files saved before grids: W x H)
            const G = page.grid;
            return (Array.isArray(G) && size(G[0]) && size(G[1]))
                ? ED.regrid(CP, G[0], G[1]) : CP;
        }
        // A design on a grid opens on that grid: the smallest one of at least
        // n squares that puts every vertex on a grid point (n otherwise)
        const N = ED.fit_grid(CP, n);
        return ((N == undefined) || (N == n)) ? CP
            : ED.scale(CP, CP.W*N/Math.max(CP.W, CP.H));
    },
};
