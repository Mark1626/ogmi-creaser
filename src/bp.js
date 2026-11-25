// Box pleating circles (flaps) and rivers drawn over the editor's crease
// pattern (no DOM), a design aid as in Box Pleating Studio: each circle is a
// flap of the design's tree and each river a channel of paper between groups
// of flaps. They never change the creases.
//
// A CP (see ED) may carry them in two more arrays; a CP without them has none:
//
// FL   | flaps: [x, y, r], the centre in page units and the radius r (page
//      | units). In box pleating a flap covers the square of side 2r about
//      | its centre (the circle of radius r in the chessboard metric); the
//      | round circle is drawn inside it for reference
// RV   | rivers: each the grid squares it covers, as [x1, y1, x2, y2] in
//      | page units (cut off at the page edge). Rivers are painted square by
//      | square with a brush (see BP.stroke and BP.paint), so a stroke is
//      | unbroken; a river never covers a flap's square or another river's
//      | square
//
// A river should be one unbroken band that runs from the paper's edge to its
// edge, turning as often as it likes: BP.river_issues says which are not
// (warnings only; nothing stops a design from having them). Where a river
// turns, it is drawn curving round the inner corner (BP.river_shapes).
//
// Flaps never overlap: a flap added or moved replaces every other flap whose
// square overlaps its own (squares that only touch, as in a tight packing,
// both stay). Undo brings them back, as the old CP is kept.
//
// Like ED, every edit takes a CP and returns a new one, or undefined when the
// edit is invalid.
//
// FOLD files keep them in two custom properties (in page units, like
// vertices_coords), written only when there are flaps:
//
//   "ogmi-creaser:flaps":  [{"center": [x, y], "radius": r}, ...]
//   "ogmi-creaser:rivers": [{"cells": [[x1, y1, x2, y2], ...]}, ...]
export const BP = {
    flaps: (CP) => CP.FL ?? [],
    rivers: (CP) => CP.RV ?? [],
    unit: ({W, GW}) => W/GW,    // width of a grid square in page units
    carry: (CP, CP_, at = (p) => p, len = (d) => d) => {
        // CP_ (built from CP by an edit, or undefined) with CP's flaps and
        // rivers, centres mapped by at and lengths by len
        if ((CP_ == undefined) || (CP.FL == undefined)) { return CP_; }
        return {...CP_,
            FL: CP.FL.map(([x, y, r]) => [...at([x, y]), len(r)]),
            RV: BP.rivers(CP).map(R => R.map(s => BP.map_square(s, at)))};
    },
    map_square: ([x1, y1, x2, y2], at) => {
        // The square mapped by at, a map that turns by quarter turns,
        // reflects and scales (so squares stay squares)
        const [[a, b], [c, d]] = [at([x1, y1]), at([x2, y2])];
        return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    },
    length_ok: (d) => Number.isFinite(d) && (d > 0),
    eps: ({W, H, tol}) => Math.max((tol ?? 0)*Math.max(W, H), 1e-9),
    in_page: (CP, [x, y]) => {
        const {W, H} = CP;
        const eps = BP.eps(CP);
        return Number.isFinite(x) && Number.isFinite(y) &&
            (-eps <= x) && (x <= W + eps) && (-eps <= y) && (y <= H + eps);
    },
    index_ok: (A, i) => Number.isInteger(i) && (0 <= i) && (i < A.length),

    // ---- edits
    overlaps: (CP, [x, y], r, skip = -1) => {
        // Flaps (other than skip) whose square overlaps the square of
        // radius r about (x, y) by more than touching
        const eps = BP.eps(CP);
        return BP.flaps(CP).flatMap(([x_, y_, r_], i) => ((i != skip) &&
            (Math.max(Math.abs(x - x_), Math.abs(y - y_)) < r + r_ - eps)) ? [i] : []);
    },
    add_flap: (CP, [x, y], r) => {      // replacing the flaps it overlaps
        if (!BP.length_ok(r) || !BP.in_page(CP, [x, y])) { return undefined; }
        const CP_ = BP.remove_flaps(CP, BP.overlaps(CP, [x, y], r));
        return {...CP_, FL: [...BP.flaps(CP_), [x, y, r]], RV: BP.rivers(CP_)};
    },
    move_flap: (CP, i, [x, y]) => {     // replacing the flaps it then overlaps
        const FL = BP.flaps(CP).slice();
        if (!BP.index_ok(FL, i) || !BP.in_page(CP, [x, y])) { return undefined; }
        FL[i] = [x, y, FL[i][2]];
        return BP.remove_flaps({...CP, FL, RV: BP.rivers(CP)},
            BP.overlaps(CP, [x, y], FL[i][2], i));
    },
    remove_flaps: (CP, I) => [...new Set(I)]   // highest first, so the
        .sort((a, b) => b - a)                  // others keep their numbers
        .reduce((CP_, i) => (CP_ == undefined) ? undefined
            : BP.remove_flap(CP_, i), CP),
    remove_flap: (CP, i) => {
        const FL = BP.flaps(CP);
        if (!BP.index_ok(FL, i)) { return undefined; }
        return {...CP, FL: FL.filter((_, j) => j != i), RV: BP.rivers(CP)};
    },
    remove_river: (CP, k) => {
        const RV = BP.rivers(CP);
        if (!BP.index_ok(RV, k)) { return undefined; }
        return {...CP, FL: BP.flaps(CP), RV: RV.filter((_, j) => j != k)};
    },

    // ---- painting rivers (grid squares are cells [i, j] of the CP's grid)
    cell: ({W, H, GW, GH}, [i, j]) => {
        // Grid square [i, j] in page units, cut off at the page edge, or
        // undefined if it is off the page
        const [u, v] = [W/GW, H/GH];
        if ((i < 0) || (j < 0) || (i*u >= W - 1e-9*W) || (j*v >= H - 1e-9*H)) {
            return undefined;
        }
        return [i*u, j*v, Math.min((i + 1)*u, W), Math.min((j + 1)*v, H)];
    },
    brush: ({W, H, GW, GH}, [x, y], w) => {
        // The first grid square [i, j] of a brush w squares wide at (x, y):
        // for w odd it is centred on the square under (x, y), for w even on
        // the grid point nearest (x, y)
        return [Math.round(x*GW/W - w/2), Math.round(y*GH/H - w/2)];
    },
    stroke: (CP, p, q, w) => {
        // The grid squares a brush w squares wide covers moving from p to q:
        // its positions run square by square, never only corner to corner,
        // so what it paints is all one piece
        const [a, b] = [BP.brush(CP, p, w), BP.brush(CP, q, w)];
        const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        const at = [a];
        for (let t = 1; t <= n; ++t) {
            const [i, j] = at[at.length - 1];
            const next = [0, 1].map(k => Math.round(a[k] + (b[k] - a[k])*t/n));
            if ((next[0] != i) && (next[1] != j)) { at.push([next[0], j]); }
            at.push(next);
        }
        const out = new Map();
        for (const [i, j] of at) {
            for (let di = 0; di < w; ++di) {
                for (let dj = 0; dj < w; ++dj) {
                    const s = BP.cell(CP, [i + di, j + dj]);
                    if (s != undefined) { out.set(BP.key(s), s); }
                }
            }
        }
        return [...out.values()];
    },
    key: ([x1, y1]) => `${Math.round(x1*1e6)},${Math.round(y1*1e6)}`,
    paint: (CP, k, S) => {
        // CP with river k (a new river if k < 0) extended by the squares S
        // that are free: not on a flap's square or another river. Undefined
        // if none is new
        const RV = BP.rivers(CP);
        if ((k >= 0) && !BP.index_ok(RV, k)) { return undefined; }
        const eps = BP.eps(CP);
        const flaps = BP.flaps(CP).map(([x, y, r]) => BP.square([x, y], r));
        const taken = new Set(RV.flatMap(R => R.map(BP.key)));
        const R = (k < 0) ? [] : RV[k].slice();
        for (const s of S) {
            const key = BP.key(s);
            if (taken.has(key) || flaps.some(f => BP.overlap(f, s, eps))) { continue; }
            taken.add(key);
            R.push(s);
        }
        if (R.length == ((k < 0) ? 0 : RV[k].length)) { return undefined; }
        const RV_ = RV.slice();
        if (k < 0) { RV_.push(R); } else { RV_[k] = R; }
        return {...CP, FL: BP.flaps(CP), RV: RV_};
    },
    overlap: (s, t, eps = 0) => (s[0] < t[2] - eps) && (t[0] < s[2] - eps) &&
        (s[1] < t[3] - eps) && (t[1] < s[3] - eps),

    // ---- files
    CP_2_fold: (CP) => {        // FOLD properties for CP's flaps and rivers
        const FL = BP.flaps(CP);
        if (FL.length == 0) { return {}; }
        return {
            "ogmi-creaser:flaps": FL.map(([x, y, r]) => ({center: [x, y], radius: r})),
            "ogmi-creaser:rivers": BP.rivers(CP).map(R => ({cells: R})),
        };
    },
    fold_2_FL_RV: (json, at = (p) => p, len = (d) => d, ok = () => true) => {
        // [FL, RV] from a parsed FOLD file, or undefined if it has no flaps;
        // centres and squares mapped by at and lengths by len, as the file's
        // vertices were. Skips anything malformed, flaps whose mapped centre
        // fails ok, and river squares whose mapped middle fails it; drops
        // rivers left empty. Kept as saved otherwise (overlaps included).
        const flaps = json?.["ogmi-creaser:flaps"];
        if (!Array.isArray(flaps)) { return undefined; }
        const num = (x) => (typeof x == "number") && Number.isFinite(x);
        const FL = [];
        for (const f of flaps) {
            const c = f?.center;
            if (!Array.isArray(c) || (c.length != 2) || !c.every(num) ||
                !num(f.radius) || !(f.radius > 0)) { continue; }
            const p = at(c);
            const r = len(f.radius);
            if (ok(p) && BP.length_ok(r)) { FL.push([p[0], p[1], r]); }
        }
        const RV = [];
        const rivers = json["ogmi-creaser:rivers"];
        for (const v of (Array.isArray(rivers) ? rivers : [])) {
            if (!Array.isArray(v?.cells)) { continue; }
            const R = new Map();
            for (const s of v.cells) {
                if (!Array.isArray(s) || (s.length != 4) || !s.every(num) ||
                    !(s[0] < s[2]) || !(s[1] < s[3])) { continue; }
                const t = BP.map_square(s, at);
                if (ok([(t[0] + t[2])/2, (t[1] + t[3])/2])) { R.set(BP.key(t), t); }
            }
            if (R.size > 0) { RV.push([...R.values()]); }
        }
        return [FL, RV];
    },

    doc_2_FL_RV: (doc, type, side) => {
        // [FL, RV] in a file as ogmi-creaser imports it (turned over like its
        // vertices when opened the other side up), or undefined if none
        if (type != "fold") { return undefined; }
        let json;
        try { json = JSON.parse(doc); } catch { return undefined; }
        return BP.fold_2_FL_RV(json, side ? (p) => p : ([x, y]) => [x, 1 - y]);
    },

    // ---- rivers' shape on the paper
    river_issues: (CP, paper = [0, 0, CP.W, CP.H]) => {
        // For each river, undefined if it is one unbroken band running from
        // the edge of the paper rectangle to its edge, else what is wrong
        const eps = BP.eps(CP);
        return BP.rivers(CP).map((R) => {
            const {pieces, ends} = BP.band_topology([], R, paper, eps);
            if (pieces == 0) { return "is not on the paper"; }
            if (pieces > 1) { return `is broken into ${pieces} pieces`; }
            if (ends == 0) { return "does not reach the paper edge"; }
            if (ends == 1) { return "reaches the paper edge at one end only"; }
            if (ends == Infinity) { return "runs all round the paper edge"; }
            if (ends > 2) { return `reaches the paper edge in ${ends} places, not 2`; }
            return undefined;
        });
    },
    band_topology: (inner, outer, [X1, Y1, X2, Y2], eps = 1e-9) => {
        // The band (union of squares outer less union of inner) on the paper
        // [X1, Y1, X2, Y2]: {pieces: how many connected pieces it is in,
        // ends: how many separate stretches of the paper edge it touches
        // (Infinity if all of it)}. Cut along every side of every square,
        // the paper is a grid of cells each wholly in or out of the band;
        // cells meeting only at a corner are not connected (a river cannot
        // flow through a point).
        const lines = (k, lo, hi) => {
            const C = [lo, hi];
            for (const s of [...inner, ...outer]) {
                for (const c of [s[k], s[k + 2]]) {
                    if ((lo + eps < c) && (c < hi - eps)) { C.push(c); }
                }
            }
            C.sort((a, b) => a - b);
            return C.filter((c, i) => (i == 0) || (c - C[i - 1] > eps));
        };
        const [xs, ys] = [lines(0, X1, X2), lines(1, Y1, Y2)];
        const [nx, ny] = [xs.length - 1, ys.length - 1];
        if ((nx < 1) || (ny < 1)) { return {pieces: 0, ends: 0}; }
        const covers = (S, x, y) => S.some(([x1, y1, x2, y2]) =>
            (x1 < x) && (x < x2) && (y1 < y) && (y < y2));
        const band = xs.slice(1).map((x2, i) => ys.slice(1).map((y2, j) => {
            const [x, y] = [(xs[i] + x2)/2, (ys[j] + y2)/2];
            return covers(outer, x, y) && !covers(inner, x, y);
        }));
        let pieces = 0;
        const seen = band.map(col => col.map(() => false));
        for (let i = 0; i < nx; ++i) {
            for (let j = 0; j < ny; ++j) {
                if (!band[i][j] || seen[i][j]) { continue; }
                ++pieces;
                const stack = [[i, j]];
                seen[i][j] = true;
                while (stack.length > 0) {
                    const [a, b] = stack.pop();
                    for (const [c, d] of [[a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]]) {
                        if ((c < 0) || (c >= nx) || (d < 0) || (d >= ny) ||
                            !band[c][d] || seen[c][d]) { continue; }
                        seen[c][d] = true;
                        stack.push([c, d]);
                    }
                }
            }
        }
        const edge = [      // cells along the paper edge, once round
            ...band.map(col => col[0]),                         // top
            ...band[nx - 1],                                    // right
            ...band.map(col => col[ny - 1]).reverse(),          // bottom
            ...band[0].slice().reverse(),                       // left
        ];
        const ends = edge.every(b => b) ? Infinity
            : edge.filter((b, t) => b && !edge.at(t - 1)).length;
        return {pieces, ends};
    },

    // ---- rivers' outlines, with their turns curved
    river_width: (R) => {
        // The narrowest run of river R's squares along a row or a column: its
        // width as painted (the brush's, unless something narrower was)
        const narrowest = (k) => {      // k = 0: along rows, 1: along columns
            const lines = new Map();
            for (const s of R) {
                const key = BP.key([s[1 - k], s[3 - k]]);
                if (!lines.has(key)) { lines.set(key, []); }
                lines.get(key).push([s[k], s[k + 2]]);
            }
            let least = Infinity;
            for (const I of lines.values()) {
                I.sort((a, b) => a[0] - b[0]);
                let [lo, hi] = I[0];
                for (const [a, b] of I.slice(1)) {
                    if (a <= hi + 1e-9) { hi = Math.max(hi, b); continue; }
                    least = Math.min(least, hi - lo);
                    [lo, hi] = [a, b];
                }
                least = Math.min(least, hi - lo);
            }
            return least;
        };
        return Math.min(narrowest(0), narrowest(1));
    },
    river_loops: (R, eps = 1e-9) => {
        // River R's boundary as loops of corner points, each with the river
        // on its right (y down): outer boundaries run clockwise, holes
        // anticlockwise. Squares meeting only at a corner get loops of their
        // own (a river cannot flow through a point).
        const axis = (k) => {
            const C = R.flatMap(s => [s[k], s[k + 2]]).sort((a, b) => a - b);
            return C.filter((c, i) => (i == 0) || (c - C[i - 1] > eps));
        };
        const [xs, ys] = [axis(0), axis(1)];
        const filled = xs.slice(1).map((x2, i) => ys.slice(1).map((y2, j) => {
            const [x, y] = [(xs[i] + x2)/2, (ys[j] + y2)/2];
            return R.some(s => (s[0] < x) && (x < s[2]) && (s[1] < y) && (y < s[3]));
        }));
        const at = (i, j) => (i >= 0) && (j >= 0) && (i < xs.length - 1) &&
            (j < ys.length - 1) && filled[i][j];
        const out = new Map();      // grid point -> edges leaving it
        const add = (a, b) => {
            const key = a.join(",");
            if (!out.has(key)) { out.set(key, []); }
            out.get(key).push({a, b, d: [b[0] - a[0], b[1] - a[1]], used: false});
        };
        for (let i = 0; i < xs.length - 1; ++i) {
            for (let j = 0; j < ys.length - 1; ++j) {
                if (!filled[i][j]) { continue; }
                if (!at(i, j - 1)) { add([i, j], [i + 1, j]); }             // top
                if (!at(i + 1, j)) { add([i + 1, j], [i + 1, j + 1]); }     // right
                if (!at(i, j + 1)) { add([i + 1, j + 1], [i, j + 1]); }     // bottom
                if (!at(i - 1, j)) { add([i, j + 1], [i, j]); }             // left
            }
        }
        const turn = (d, e) => (e[0] == -d[1]) && (e[1] == d[0]) ? 0     // right
            : ((e[0] == d[0]) && (e[1] == d[1])) ? 1 : 2;            // on, left
        const loops = [];
        for (const E of out.values()) {
            for (const first of E) {
                if (first.used) { continue; }
                const P = [];
                let e = first;
                do {
                    e.used = true;
                    P.push(e);
                    e = out.get(e.b.join(",")).filter(f => !f.used || (f == first))
                        .sort((f, g) => turn(e.d, f.d) - turn(e.d, g.d))[0];
                } while ((e != first) && (e != undefined));
                const corners = P.filter((f, t) => {    // where it turns
                    const g = P.at(t - 1);
                    return (f.d[0] != g.d[0]) || (f.d[1] != g.d[1]);
                });
                loops.push(corners.map(({a: [i, j]}) => [xs[i], ys[j]]));
            }
        }
        return loops;
    },
    river_shapes: (CP, paper = [0, 0, CP.W, CP.H]) => {
        // How to draw each river: {fill, line}, lists of path commands
        // ["M", p], ["L", p], ["C", c1, c2, p] (a cubic Bezier) and ["Z"] in
        // page units; fill is filled even-odd, line is stroked. A river that
        // runs as one course from the paper edge to the paper edge
        // (BP.river_course) curves at each turn round the turn's inner
        // corner, a quarter circle as wide as the river, as in circle-river
        // packing, and a line marks where it runs alongside itself (as in a
        // U-turn); any other river has its outline's corners rounded instead
        // (BP.round_loops).
        const eps = BP.eps(CP);
        return BP.rivers(CP).map(R => {
            const course = BP.river_course(R, paper, eps);
            if (course != undefined) { return BP.course_shape(R, course, eps); }
            const loops = BP.round_loops(R, paper, eps).flat();
            return {fill: loops, line: loops};
        });
    },
    river_course: (R, [X1, Y1, X2, Y2], eps = 1e-9) => {
        // River R as a course of blocks as wide as the river, each next to
        // the one before, every block once, from a block on the paper edge to
        // another, or undefined if there is none: {w, path}, the blocks in
        // order, each {b: [x1, y1, x2, y2] (whole, not cut off at the paper),
        // at: [i, j] on the lattice}. The blocks lie on a lattice whose blocks
        // R fills whole or not at all (cut off at the paper edge); the search
        // keeps straight where it can and gives up after a while (a river
        // that is a wide blob has many courses, or none).
        if (R.length == 0) { return undefined; }
        const w = BP.river_width(R);
        const axis = (k) => {
            const C = R.flatMap(s => [s[k], s[k + 2]]).sort((a, b) => a - b);
            return C.filter((c, i) => (i == 0) || (c - C[i - 1] > eps));
        };
        const [xs, ys] = [axis(0), axis(1)];
        const filled = xs.slice(1).map((x2, i) => ys.slice(1).map((y2, j) => {
            const [x, y] = [(xs[i] + x2)/2, (ys[j] + y2)/2];
            return R.some(s => (s[0] < x) && (x < s[2]) && (s[1] < y) && (y < s[3]));
        }));
        const amount = ([x1, y1, x2, y2]) => {  // of the rect in R: 1 all, 0 none, -1 some
            const I = xs.slice(1).flatMap((x, i) =>
                ((xs[i] < x2 - eps) && (x > x1 + eps)) ? [i] : []);
            const J = ys.slice(1).flatMap((y, j) =>
                ((ys[j] < y2 - eps) && (y > y1 + eps)) ? [j] : []);
            const F = I.flatMap(i => J.map(j => filled[i][j]));
            const inside = (x1 >= xs[0] - eps) && (x2 <= xs.at(-1) + eps) &&
                (y1 >= ys[0] - eps) && (y2 <= ys.at(-1) + eps);
            if (!F.some(f => f)) { return 0; }
            return (inside && F.every(f => f)) ? 1 : -1;
        };
        const offsets = (C, lo) => {    // where the lattice lines could be
            const M = C.map(c => {
                const m = (((c - lo) % w) + w) % w;
                return (m > w - eps) ? 0 : m;
            }).sort((a, b) => a - b);
            return M.filter((m, i) => (i == 0) || (m - M[i - 1] > eps));
        };
        for (const ox of offsets(xs, X1)) {
            for (const oy of offsets(ys, Y1)) {
                const blocks = [];
                let whole = true;
                const [I0, I1] = [Math.floor((xs[0] - X1 - ox)/w + 1e-9),
                    Math.ceil((xs.at(-1) - X1 - ox)/w - 1e-9)];
                const [J0, J1] = [Math.floor((ys[0] - Y1 - oy)/w + 1e-9),
                    Math.ceil((ys.at(-1) - Y1 - oy)/w - 1e-9)];
                for (let i = I0; whole && (i < I1); ++i) {
                    for (let j = J0; whole && (j < J1); ++j) {
                        const b = [X1 + ox + i*w, Y1 + oy + j*w,
                            X1 + ox + (i + 1)*w, Y1 + oy + (j + 1)*w];
                        const c = [Math.max(b[0], X1), Math.max(b[1], Y1),
                            Math.min(b[2], X2), Math.min(b[3], Y2)];
                        if ((c[2] - c[0] <= eps) || (c[3] - c[1] <= eps)) { continue; }
                        const a = amount(c);
                        if (a < 0) { whole = false; }
                        if (a > 0) {
                            blocks.push({b, at: [i, j], edge: (c[0] <= X1 + eps) ||
                                (c[1] <= Y1 + eps) || (c[2] >= X2 - eps) || (c[3] >= Y2 - eps)});
                        }
                    }
                }
                if (!whole) { continue; }
                const path = BP.course(blocks);
                if (path != undefined) { return {w, path}; }
            }
        }
        return undefined;
    },
    course: (blocks, limit = 20000) => {
        // An order of blocks (on a lattice) from one on the paper edge to
        // another, each next to the one before, every block once, keeping
        // straight where it can; undefined if none is found in limit steps
        const n = blocks.length;
        const index = new Map(blocks.map((B, k) => [B.at.join(","), k]));
        const next = blocks.map(({at: [i, j]}) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]
            .map(a => index.get(a.join(","))).filter(k => k != undefined));
        const starts = blocks.map((B, k) => k).filter(k => blocks[k].edge)
            .sort((a, b) => next[a].length - next[b].length);
        const seen = blocks.map(() => false);
        const path = [];
        let steps = 0;
        const go = (k) => {
            if (++steps > limit) { return false; }
            seen[k] = true;
            path.push(k);
            if (path.length == n) {
                if (blocks[k].edge) { return true; }
            } else {
                const p = path.at(-2);
                const ahead = (m) => (p != undefined) &&
                    (blocks[m].at[0] - blocks[k].at[0] == blocks[k].at[0] - blocks[p].at[0]) &&
                    (blocks[m].at[1] - blocks[k].at[1] == blocks[k].at[1] - blocks[p].at[1]);
                const N = next[k].filter(m => !seen[m]).sort((a, b) => ahead(b) - ahead(a));
                for (const m of N) {
                    if (go(m)) { return true; }
                }
            }
            seen[k] = false;
            path.pop();
            return false;
        };
        for (const k of starts) {
            if (go(k)) { return path.map(m => blocks[m]); }
            if (steps > limit) { break; }
        }
        return undefined;
    },
    course_shape: (R, {w, path}, eps) => {
        // BP.river_shapes for a river with a course: each block where the
        // course turns is drawn as a quarter circle of radius w about its
        // inner corner (where the sides it enters and leaves by meet); a
        // line marks each side between blocks that are next to each other
        // but not one after the other on the course
        const K = 0.5522847498;     // Bezier handles for a quarter circle
        const key = (B) => B.at.join(",");
        const step = (A, B) => [B.at[0] - A.at[0], B.at[1] - A.at[1]];
        const same = (d, e) => (d[0] == e[0]) && (d[1] == e[1]);
        const side = ([x1, y1, x2, y2], [dx, dy]) => (dx > 0) ? [[x2, y1], [x2, y2]]
            : (dx < 0) ? [[x1, y1], [x1, y2]] : (dy > 0) ? [[x1, y2], [x2, y2]] : [[x1, y1], [x2, y1]];
        const turns = new Map();    // block key -> its turn
        for (let t = 1; t + 1 < path.length; ++t) {
            const [d1, d2] = [step(path[t - 1], path[t]), step(path[t], path[t + 1])];
            if (same(d1, d2)) { continue; }
            const b = path[t].b;
            const c = [(b[0] + b[2])/2 + (d2[0] - d1[0])*w/2, (b[1] + b[3])/2 + (d2[1] - d1[1])*w/2];
            const S = [c[0] - d2[0]*w, c[1] - d2[1]*w];     // where it enters,
            const E = [c[0] + d1[0]*w, c[1] + d1[1]*w];     // and leaves
            turns.set(key(path[t]), {b, c, S, E, d1, d2,
                arc: ["C", [S[0] + d1[0]*K*w, S[1] + d1[1]*K*w],
                    [E[0] - d2[0]*K*w, E[1] - d2[1]*K*w], E]});
        }
        const T = [...turns.values()];
        const outer = (B, d) => {   // is B's side facing d outside its curve?
            const turn = turns.get(key(B));
            return (turn != undefined) && (same(d, turn.d1) || same(d, [-turn.d2[0], -turn.d2[1]]));
        };
        const poly = (P) => [["M", P[0]], ...P.slice(1).map(p => ["L", p]), ["Z"]];
        const fill = [      // even-odd: R, less the turning blocks, plus their curves
            ...BP.river_loops(R, eps).flatMap(poly),
            ...T.flatMap(({b}) => poly([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]])),
            ...T.flatMap(({c, S, arc}) => [["M", c], ["L", S], arc, ["Z"]]),
        ];
        const cut = T.flatMap(({b, d1, d2}) => [side(b, d1), side(b, [-d2[0], -d2[1]])]);
        const lines = BP.outline(R).flatMap(seg => BP.less(seg, cut, eps));
        const order = new Map(path.map((B, t) => [key(B), t]));
        for (const [t, B] of path.entries()) {
            for (const d of [[1, 0], [0, 1]]) {
                const u = order.get([B.at[0] + d[0], B.at[1] + d[1]].join(","));
                if ((u == undefined) || (Math.abs(u - t) == 1) || outer(B, d) ||
                    outer(path[u], [-d[0], -d[1]])) { continue; }
                lines.push(side(B.b, d));
            }
        }
        return {fill, line: [...lines.flatMap(([p, q]) => [["M", p], ["L", q]]),
            ...T.flatMap(({S, arc}) => [["M", S], arc])]};
    },
    less: ([p, q], cut, eps = 1e-9) => {
        // The parts of axis-parallel segment pq not on any segment in cut
        const k = (Math.abs(p[1] - q[1]) <= eps) ? 0 : 1;   // the axis it runs along
        let I = [[Math.min(p[k], q[k]), Math.max(p[k], q[k])]];
        for (const [a, b] of cut) {
            if ((Math.abs(a[1 - k] - p[1 - k]) > eps) || (Math.abs(b[1 - k] - p[1 - k]) > eps)) {
                continue;   // not on the same line
            }
            const [lo, hi] = [Math.min(a[k], b[k]), Math.max(a[k], b[k])];
            I = I.flatMap(([s, t]) => [[s, Math.min(t, lo)], [Math.max(s, hi), t]]
                .filter(([u, v]) => v - u > eps));
        }
        return I.map(([s, t]) => (k == 0) ? [[s, p[1]], [t, p[1]]] : [[p[0], s], [p[0], t]]);
    },
    round_loops: (R, [X1, Y1, X2, Y2], eps = 1e-9) => {
        // River R's outline (BP.river_loops) as loops of path commands, each
        // convex corner off the paper edge a quarter circle as wide as the
        // river (a corner sharing a side with another such corner takes at
        // most half of that side): for a river with no course
        const on_edge = ([x, y]) => (Math.abs(x - X1) <= eps) || (Math.abs(x - X2) <= eps) ||
            (Math.abs(y - Y1) <= eps) || (Math.abs(y - Y2) <= eps);
        const K = 0.5522847498;
        const unit = (p, q) => {
            const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
            return [(q[0] - p[0])/d, (q[1] - p[1])/d, d];
        };
        const w = BP.river_width(R);
        return BP.river_loops(R, eps).map(P => {
            const n = P.length;
            const din = P.map((p, i) => unit(P[(i + n - 1) % n], p));
            const dout = P.map((p, i) => din[(i + 1) % n]);
            const round = P.map((p, i) => !on_edge(p) &&
                (din[i][0]*dout[i][1] - din[i][1]*dout[i][0] > 0));     // right turn
            const r = P.map((p, i) => !round[i] ? 0 : Math.min(w,
                din[i][2]/(round[(i + n - 1) % n] ? 2 : 1),
                dout[i][2]/(round[(i + 1) % n] ? 2 : 1)));
            const go = (p, d, t) => [p[0] + d[0]*t, p[1] + d[1]*t];
            const C = [];
            for (let t = 0; t <= n; ++t) {
                const i = t % n;
                const [S, E] = [go(P[i], din[i], -r[i]), go(P[i], dout[i], r[i])];
                if (t == 0) { C.push(["M", E]); continue; }
                C.push(["L", S]);
                if (r[i] > 0) {
                    C.push(["C", go(S, din[i], K*r[i]), go(E, dout[i], -K*r[i]), E]);
                }
            }
            C.push(["Z"]);
            return C;
        });
    },

    // ---- geometry (squares are [x1, y1, x2, y2] in page units)
    square: ([x, y], a) => [x - a, y - a, x + a, y + a],
    in_squares: (S, [x, y], eps = 0) => S.some(([x1, y1, x2, y2]) =>
        (x1 - eps <= x) && (x <= x2 + eps) && (y1 - eps <= y) && (y <= y2 + eps)),
    outline: (S, eps = 1e-9) => {
        // Boundary of the union of squares S as segments [p, q]: each side
        // of each square, less the parts where another square covers the
        // outside of that side (so squares that only touch lose the side
        // they share), or where an earlier square has a side facing the
        // same way on the same line (so each part is drawn once)
        const out = [];
        const cut = (I, lo, hi) => I.flatMap(([s, t]) =>
            [[s, Math.min(t, lo)], [Math.max(s, hi), t]].filter(([a, b]) => b - a > eps));
        for (const [i, s] of S.entries()) {
            // [axis held fixed (0: x), side, outward direction]
            for (const [k, c, dir] of [[0, s[0], -1], [0, s[2], 1], [1, s[1], -1], [1, s[3], 1]]) {
                const o = 1 - k;    // the axis the side runs along
                let I = [[s[o], s[o + 2]]];
                for (const [j, t] of S.entries()) {
                    if (j == i) { continue; }
                    const [lo, hi] = [t[k], t[k + 2]];
                    const covers = (dir > 0)
                        ? ((lo - eps <= c) && (c < hi - eps))
                        : ((lo + eps < c) && (c <= hi + eps));
                    const twin = (j < i) &&
                        (Math.abs(((dir > 0) ? hi : lo) - c) <= eps);
                    if (covers || twin) { I = cut(I, t[o], t[o + 2]); }
                }
                for (const [a, b] of I) {
                    out.push((k == 0) ? [[c, a], [c, b]] : [[a, c], [b, c]]);
                }
            }
        }
        return out;
    },

    // ---- picking (in page units)
    pick: (CP, p) => {
        // What p is on: {flap: i} inside a flap's square (the one whose
        // centre is nearest), else {river: k} on a river, else undefined
        let [best, best_d] = [-1, Infinity];
        for (const [i, [x, y, r]] of BP.flaps(CP).entries()) {
            const d = Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y));
            if ((d <= r) && (d < best_d)) { [best, best_d] = [i, d]; }
        }
        if (best >= 0) { return {flap: best}; }
        const river = BP.river_at(CP, p);
        return (river < 0) ? undefined : {river};
    },
    river_at: (CP, p) => BP.rivers(CP).findIndex(R => BP.in_squares(R, p)),
    pick_centre: (CP, p, r) => {    // nearest flap centre within r of p, or -1
        let [best, best_d] = [-1, r];
        for (const [i, [x, y]] of BP.flaps(CP).entries()) {
            const d = Math.hypot(p[0] - x, p[1] - y);
            if (d <= best_d) { [best, best_d] = [i, d]; }
        }
        return best;
    },
};
