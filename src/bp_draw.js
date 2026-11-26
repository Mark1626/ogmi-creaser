import { SVG } from "./svg.js";
import { BP } from "./bp.js";

// Drawing box pleating circles and rivers (see BP) into an SVG panel, as Box
// Pleating Studio does: each river a tinted band with its outline, curving
// where it turns (BP.river_shapes), each circle (flap) its square with the
// round circle inside it and a dot at its centre. Rivers that break BP's
// rules (BP.river_issues) are drawn in the warning colour with dashed
// outlines.
//
// A pen maps the design into the panel: {at: point -> panel point, len:
// length -> panel length}. It may turn the design by quarter turns and
// reflect it, which keeps squares squares.
export const BPD = {
    COLORS: {flap: "#8E44AD", river: "#138D75", replaced: "#C0392B",
        warning: "#E67E22"},
    LINE: {"vector-effect": "non-scaling-stroke"},
    FADED: 0.4,     // opacity in the folded view, where the creases come first
    rect: (pen, [x1, y1, x2, y2]) => {      // a square -> <rect> attributes
        const [[a, b], [c, d]] = [[x1, y1], [x2, y2]].map(pen.at);
        return {x: Math.min(a, c), y: Math.min(b, d),
            width: Math.abs(c - a), height: Math.abs(d - b)};
    },
    path: (pen, C) => {     // BP.river_shapes' commands as SVG path data
        return C.map(([c, ...P]) => c + P.map(p => pen.at(p).join(" ")).join(" ")).join("");
    },
    outline: (g, pen, S, attrs) => {        // boundary of a union of squares
        const d = BP.outline(S).map(([p, q]) => {
            const [[x1, y1], [x2, y2]] = [p, q].map(pen.at);
            return `M${x1} ${y1}L${x2} ${y2}`;
        }).join("");
        if (d == "") { return; }
        SVG.append("path", g, {d, fill: "none", "stroke-linecap": "square",
            ...BPD.LINE, ...attrs});
    },
    flap: (g, dots, pen, [x, y, r], color, attrs = {}) => {
        const [cx, cy] = pen.at([x, y]);
        SVG.append("rect", g, {...BPD.rect(pen, BP.square([x, y], r)),
            fill: color, "fill-opacity": 0.12, stroke: color, "stroke-width": 1.5,
            ...BPD.LINE, ...attrs});
        SVG.append("circle", g, {cx, cy, r: pen.len(r), fill: "none",
            stroke: color, "stroke-width": 1, ...BPD.LINE, ...attrs});
        SVG.append("circle", dots, {cx, cy, r: 8, fill: color});
    },
    river: (g, pen, {fill, line}, warn = false, strong = false, color) => {
        // A river, from its BP.river_shapes shape; strong: more opaque, for
        // previews and highlights; color: instead of the river colour
        color ??= warn ? BPD.COLORS.warning : BPD.COLORS.river;
        SVG.append("path", g, {d: BPD.path(pen, fill), "fill-rule": "evenodd",
            fill: color, "fill-opacity": (warn ? 0.3 : 0.18) + (strong ? 0.3 : 0)});
        SVG.append("path", g, {d: BPD.path(pen, line), fill: "none", stroke: color,
            "stroke-linecap": "round", ...BPD.LINE, ...(warn
                ? {"stroke-width": 2, "stroke-dasharray": "6 3"} : {"stroke-width": 1.5})});
    },
    design: (g, dots, pen, CP, issues, shapes) => {
        // All of CP's rivers, then its circles; g should be cut off at the
        // paper, and dots (the circles' centres) drawn over the creases.
        // issues: BP.river_issues(CP); shapes: BP.river_shapes(CP)
        for (const [k, shape] of shapes.entries()) {
            BPD.river(g, pen, shape, issues?.[k] != undefined);
        }
        for (const f of BP.flaps(CP)) { BPD.flap(g, dots, pen, f, BPD.COLORS.flap); }
    },
};
