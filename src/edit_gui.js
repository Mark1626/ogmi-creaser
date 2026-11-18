import { M } from "./math.js";
import { NOTE } from "./note.js";
import { SVG } from "./svg.js";
import { GUI } from "./gui.js";
import { IO } from "./io.js";
import { ED } from "./edit.js";

// Crease pattern editor interface. While active (between EDIT.start or
// EDIT.resume and EDIT.stop) it owns the left panel (#flat): it draws the
// editor's CP there and turns pointer input into ED edits. Colors follow
// ogmi-creaser's own crease pattern view (GUI.COLORS).
//
// The editing session (CP, undo history, title) outlives EDIT.stop, so after
// Fold hands the pattern to ogmi-creaser and solves it, Edit can resume
// exactly where the user left off. While editing, the middle and right panels
// keep showing the last fold of the pattern (inert, and dimmed once the
// pattern has changed since).

let CP;             // crease pattern being edited (see ED)
let UNDO = [];      // earlier CPs
let REDO = [];      // undone CPs
let TITLE;          // title of the pattern, used for file names
let HANDED;         // FOLD text last handed to ogmi-creaser by Fold
let SHOWN;          // CP shown in the middle and right panels, if any
let ON_FOLD;        // async (file name, FOLD text) => imported and solved?
let ACTIVE;         // AbortController removing the listeners on EDIT.stop
let GESTURE;        // pointer gesture in progress
let VIEW;           // mapping between page and panel for the current CP
let BAD = 0;        // number of vertices failing local flat-foldability
let HELP = true;    // Help panel shown while editing (H toggles it)
let ZOOM;           // view: {z: magnification, fx, fy: centre as fractions
                    // of the page width and height}, kept through Fold
let FACES;          // [CP, FV, VK] for the last CP drawn (redraws reuse it)
let FRAME;          // pending animation frame for a zoom or pan redraw
let HOVER;          // last pointer position over the panel, client pixels
let PAN;            // pan drag in progress: last pointer position, pixels
let SPACE = false;  // Space held over the panel: dragging pans
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
const DEFAULT_ZOOM = {z: 1, fx: 0.5, fy: 0.5};

export const EDIT = {
    PICK_PX: 10,    // radius in screen pixels for picking edges
    MAX_GRID: 128,  // largest grid width or height
    HINT: {
        draw: "Draw (D): click two points, or drag",
        modify: "Modify (M): click or drag across creases to give them the selected type",
        erase: "Erase (E): click or drag across creases",
        move: "Move (V): drag a vertex; its creases follow",
    },
    // Shortcuts as listed in the Help panel (key_down implements them).
    // Keys: combinations of key names, "Mod" is Ctrl (⌘ on a Mac); "swatch"
    // shows the crease colour; the Mouse group lists tools, not keys.
    SHORTCUTS: [
        ["Tools", [
            [[["D"]], "Draw creases"],
            [[["M"]], "Modify creases to the selected type"],
            [[["E"]], "Erase creases"],
            [[["V"]], "Move vertices"]]],
        ["Crease type", [
            [[["1"]], "Mountain", "M"],
            [[["2"]], "Valley", "V"],
            [[["3"]], "Unassigned", "U"],
            [[["4"]], "Flat (not folded)", "F"],
            [[["5"]], "Boundary", "B"]]],
        ["Edit", [
            [[["Esc"]], "Cancel the line or move in progress"],
            [[["Mod", "Z"]], "Undo"],
            [[["Mod", "Shift", "Z"], ["Mod", "Y"]], "Redo"],
            [[["Mod", "S"]], "Save as .fold"]]],
        ["View", [
            [[["+"]], "Zoom in"],
            [[["-"]], "Zoom out"],
            [[["0"]], "Show the whole paper"],
            [[["G"]], "Show or hide the grid"],
            [[["H"]], "Show or hide this help"]]],
        ["Fold", [
            [[["F"]], "Fold and show the folded state"],
            [[["E"]], "Edit again, from the folded view"]]],
        ["Mouse", [
            ["Draw", "Click two points, or drag"],
            ["Modify, Erase", "Click a crease, or drag across creases"],
            ["Move", "Drag a vertex; its creases follow"],
            ["Zoom", MAC ? "Pinch, or ⌘ + scroll" : "Ctrl + scroll"],
            ["Pan", "Scroll when zoomed in, or drag with Space held (or the middle button)"]]],
    ],
    MAC,
    ZOOM_MAX: 64,   // largest magnification
    ZOOM_STEP: Math.SQRT2,  // per +/- key or button press
    MINIMAP_PX: 120,        // longer side of the zoomed-in overview, pixels
    build_help: () => {
        const table = document.getElementById("help_table");
        const add = (parent, tag, text) => {
            const el = document.createElement(tag);
            if (text != undefined) { el.textContent = text; }
            parent.appendChild(el);
            return el;
        };
        for (const [group, rows] of EDIT.SHORTCUTS) {
            const th = add(add(table, "tr"), "th", group);
            th.colSpan = 2;
            for (const [keys, action, swatch] of rows) {
                const tr = add(table, "tr");
                const td = add(tr, "td");
                if (typeof keys == "string") {          // Mouse: a tool name
                    td.textContent = keys;
                } else {
                    td.className = "keys";
                    for (const combo of keys) {         // alternatives: a line each
                        const line = add(td, "span");
                        line.className = "combo";
                        for (const [j, k] of combo.entries()) {
                            if (j > 0 && !EDIT.MAC) { add(line, "span", "+"); }
                            add(line, "kbd", (k != "Mod") ? k
                                : (EDIT.MAC ? "⌘" : "Ctrl"));
                        }
                    }
                }
                const cell = add(tr, "td");
                if (swatch != undefined) {
                    add(cell, "span").className = "swatch";
                    cell.lastChild.dataset.a = swatch;
                }
                cell.append(action);
            }
        }
    },
    toggle_help: () => {
        HELP = !HELP;
        document.getElementById("help_panel").hidden = !HELP;
    },
    ORDER: {F: 0, U: 1, M: 2, V: 2, B: 3},      // drawing order of creases
    setup: (on_fold) => {   // once at startup
        ON_FOLD = on_fold;
        EDIT.build_help();      // before colouring swatches: it has some too
        for (const el of document.querySelectorAll(".swatch")) {
            const a = el.dataset.a;
            el.style.borderTop = `${(a == "B") ? 3 : 2}px solid ${GUI.COLORS.edge[a]}`;
        }
        for (const el of document.querySelectorAll("input[name=edit_mode]")) {
            el.onchange = () => {
                EDIT.cancel();
                EDIT.update_mode();
            };
        }
        document.getElementById("new_button").onclick = () => EDIT.new_pattern();
        document.getElementById("edit_undo").onclick = () => EDIT.undo();
        document.getElementById("edit_redo").onclick = () => EDIT.redo();
        document.getElementById("edit_save").onclick = () => EDIT.save();
        document.getElementById("edit_fold").onclick = () => EDIT.fold();
        const title = document.getElementById("edit_title");
        title.oninput = () => { TITLE = title.value; };
        for (const id of ["edit_width", "edit_height"]) {
            document.getElementById(id).onchange = () => EDIT.regrid(id);
        }
        document.getElementById("edit_fit").onclick = () => EDIT.fit_grid();
        document.getElementById("edit_paper").onclick = () => EDIT.open_paper();
        const dialog = document.getElementById("paper_dialog");
        document.getElementById("paper_close").onclick = () => dialog.close("cancel");
        dialog.onclose = () => {
            if (dialog.returnValue != "ok") { return; }
            EDIT.resize(...["paper_width", "paper_height"]
                .map(id => Number(document.getElementById(id).value)));
        };
        document.getElementById("edit_zoom_in").onclick = () => EDIT.zoom(EDIT.ZOOM_STEP);
        document.getElementById("edit_zoom_out").onclick = () => EDIT.zoom(1/EDIT.ZOOM_STEP);
        document.getElementById("edit_zoom_reset").onclick = () => EDIT.zoom_reset();
        document.getElementById("edit_show_grid").onchange = () => {
            if (EDIT.active()) { EDIT.draw(); }
        };
        for (const op of ["reflect_x", "reflect_y", "rotate_ccw", "rotate_cw"]) {
            document.getElementById(`edit_${op}`).onclick = () => EDIT.transform(op);
        }
        document.getElementById("edit_cleanup").onclick = () => EDIT.cleanup();
        document.getElementById("edit_svg").onclick = () => EDIT.export_svg();
    },
    active: () => ACTIVE != undefined,
    mode: () => document.querySelector("input[name=edit_mode]:checked").value,
    type: () => document.querySelector("input[name=edit_type]:checked").value,
    title: () => {      // file name safe title
        const t = (TITLE ?? "").trim().replace(/[\\/:*?"<>|]+/g, "_");
        return (t.length > 0) ? t : "untitled";
    },

    // ---- entering and leaving
    new_pattern: () => {
        const CP_ = ED.new_CP(8, 8);
        if (EDIT.active()) {        // starting over is undoable
            ZOOM = {...DEFAULT_ZOOM};
            EDIT.apply(CP_);
        } else {
            EDIT.start(CP_, "untitled",
                `Editing new ${CP_.W} x ${CP_.H} crease pattern`, false);
        }
    },
    edit: (source) => {     // Edit button: source = what ogmi-creaser shows
        if (source == undefined) { return; }
        if ((CP != undefined) && (source.doc === HANDED)) {
            EDIT.resume();  // the editor's own pattern: continue the session
            return;
        }
        const CP_ = ED.doc_type_side_n_2_CP(source.doc, source.type, source.side);
        if (CP_ == undefined) {
            NOTE.time("ERROR: could not open this crease pattern in the editor");
            return;
        }
        EDIT.start(CP_, source.name, `Editing ${source.name} ` +
            `(${CP_.V.length} vertices, ${CP_.EV.length} edges)`, true);
    },
    start: (CP_, title, message, keep) => {     // new session; keep: the
        EDIT.stop();                            // panels show this pattern
        [CP, UNDO, REDO, TITLE, HANDED] = [CP_, [], [], title, undefined];
        ZOOM = {...DEFAULT_ZOOM};
        SHOWN = keep ? CP_ : undefined;
        EDIT.activate(message, keep);
    },
    resume: () => EDIT.activate(`Editing ${EDIT.title()} again`, true),
    activate: (message, keep, clear_log = true) => {
        EDIT.stop();
        GESTURE = undefined;
        for (const id of ["flat_controls", "cell_controls", "state_controls",
            "export_button"]) {
            document.getElementById(id).hidden = true;
        }
        for (const id of keep ? ["flat", "export"] : ["flat", "cell", "fold", "export"]) {
            SVG.clear(id);
        }
        if (!keep) { SHOWN = undefined; }
        document.getElementById("main").classList.add("editing");
        document.getElementById("edit_controls").hidden = false;
        document.getElementById("edit_title").value = TITLE;
        document.getElementById("file_name").textContent = `${EDIT.title()} (editing)`;
        document.getElementById("help_panel").hidden = !HELP;
        if (clear_log) { NOTE.clear_log(); }
        NOTE.time(message);
        ACTIVE = new AbortController();
        const opts = {signal: ACTIVE.signal};
        const flat = document.getElementById("flat");
        flat.addEventListener("pointerdown", EDIT.pointer_down, opts);
        flat.addEventListener("pointermove", EDIT.pointer_move, opts);
        flat.addEventListener("pointerup", EDIT.pointer_up, opts);
        flat.addEventListener("pointercancel", EDIT.cancel, opts);
        flat.addEventListener("pointerleave", () => {
            HOVER = undefined;
            EDIT.draw_overlay();
        }, opts);
        flat.addEventListener("wheel", EDIT.wheel, {...opts, passive: false});
        flat.addEventListener("mousedown", (e) => {     // no middle-button
            if (e.button == 1) { e.preventDefault(); }  // autoscroll
        }, opts);
        window.addEventListener("keydown", EDIT.key_down, opts);
        window.addEventListener("keyup", EDIT.key_up, opts);
        window.addEventListener("blur", () => EDIT.set_space(false), opts);
        EDIT.update_mode();
        EDIT.changed();
    },
    stop: () => {
        if (!EDIT.active()) { return; }
        ACTIVE.abort();
        [ACTIVE, GESTURE, HOVER, PAN, SPACE] = [undefined, undefined, undefined, undefined, false];
        if (FRAME != undefined) { cancelAnimationFrame(FRAME); }
        FRAME = undefined;
        document.getElementById("edit_controls").hidden = true;
        document.getElementById("help_panel").hidden = true;
        const flat = document.getElementById("flat");
        flat.classList.remove("editing", "edit_draw", "edit_modify", "edit_erase",
            "edit_move", "edit_pan", "edit_panning");
        SVG.clear("flat");
        document.getElementById("main").classList.remove("editing");
        for (const id of ["cell", "fold"]) { document.getElementById(id).style.opacity = ""; }
    },
    fold: async () => {     // import into ogmi-creaser and solve
        if (!EDIT.active()) { return; }
        HANDED = ED.CP_2_doc(CP, EDIT.title());
        SHOWN = CP;
        let ok;
        try {
            ok = await ON_FOLD(`${EDIT.title()}.fold`, HANDED);
        } catch (e) {
            NOTE.time(`ERROR: ${e.message}`);
            ok = false;
        }
        if (!ok) {      // could not import: back to editing, keeping the log
            SHOWN = undefined;
            EDIT.activate("Could not fold this crease pattern (see above); " +
                "back to editing", false, false);
        }
    },
    save: () => {
        if (!EDIT.active()) { return; }
        IO.download(new Blob([ED.CP_2_doc(CP, EDIT.title())],
            {type: "application/json"}), `${EDIT.title()}.fold`);
        NOTE.time(`Saved ${EDIT.title()}.fold`);
    },
    export_svg: () => {
        if (!EDIT.active()) { return; }
        IO.download(new Blob([ED.CP_2_svg(CP, EDIT.title())],
            {type: "image/svg+xml"}), `${EDIT.title()}.svg`);
        NOTE.time(`Exported ${EDIT.title()}.svg (red mountain, blue valley, ` +
            "seen from the coloured side)");
    },
    transform: (op) => {
        if (EDIT.active()) { EDIT.apply(ED.transform(CP, op)); }
    },
    cleanup: () => {
        if (!EDIT.active()) { return; }
        const CP_ = ED.cleanup(CP);
        const n = (CP_ == undefined) ? 0 : (CP.V.length - CP_.V.length);
        if ((CP_ != undefined) && (n == 0)) {
            NOTE.time("Cleanup: no vertices to remove");
        } else if (EDIT.apply(CP_)) {
            NOTE.time(`Cleanup removed ${n} ${(n == 1) ? "vertex" : "vertices"}`);
        }
    },

    // ---- edits
    apply: (CP_, rejected = "Edit rejected: the result could not be built") => {
        if (CP_ == undefined) {
            if (rejected) { NOTE.time(rejected); }
            return false;
        }
        UNDO.push(CP);
        REDO = [];
        CP = CP_;
        EDIT.changed();
        return true;
    },
    undo: () => {
        if (!EDIT.active() || (UNDO.length == 0)) { return; }
        REDO.push(CP);
        CP = UNDO.pop();
        EDIT.changed();
    },
    redo: () => {
        if (!EDIT.active() || (REDO.length == 0)) { return; }
        UNDO.push(CP);
        CP = REDO.pop();
        EDIT.changed();
    },
    fmt: (x) => String(Math.round(x*1000)/1000),
    show_size: () => {      // grid fields follow the pattern (and undo)
        document.getElementById("edit_width").value = EDIT.fmt(CP.GW);
        document.getElementById("edit_height").value = EDIT.fmt(CP.GH);
    },
    regrid: (id) => {       // grid fields: columns or rows, each on its own;
        if (!EDIT.active()) { return; }     // the paper and creases stay
        const across = (id == "edit_width");
        const old = across ? CP.GW : CP.GH;
        const value = Number(document.getElementById(id).value);
        const ok = (n) => Number.isFinite(n) && (n >= 1) && (n <= EDIT.MAX_GRID);
        if (value == old) {
            EDIT.show_size();
        } else if (!ok(value)) {
            NOTE.time(`The grid must be 1 to ${EDIT.MAX_GRID} squares ` +
                (across ? "across" : "down"));
            EDIT.show_size();
        } else if (EDIT.apply(across ? ED.regrid(CP, value, CP.GH)
                : ED.regrid(CP, CP.GW, value))) {
            NOTE.time(`Grid is now ${EDIT.fmt(CP.GW)} x ${EDIT.fmt(CP.GH)} ` +
                "squares; the paper and creases are unchanged");
        }
    },
    fit_grid: () => {       // Fit grid: the coarsest grid with every vertex on it
        if (!EDIT.active()) { return; }
        const N = ED.fit_grid(CP, 1, EDIT.MAX_GRID);
        if (N == undefined) {
            NOTE.time(`No grid up to ${EDIT.MAX_GRID} squares puts every vertex ` +
                "on a grid point (e.g. a 22.5° design); grid unchanged");
        } else if (N == 1) {        // only paper corners: nothing to go by
            NOTE.time("Every vertex is a corner of the paper, so any grid " +
                "fits; grid unchanged");
        } else {
            const [GW, GH] = ED.fit_grid_size(CP, N);
            if ((Math.abs(GW - CP.GW) < 1e-9) && (Math.abs(GH - CP.GH) < 1e-9)) {
                NOTE.time(`Already on its grid: ${EDIT.fmt(CP.GW)} x ` +
                    `${EDIT.fmt(CP.GH)} squares`);
            } else if (EDIT.apply(ED.regrid(CP, GW, GH))) {
                NOTE.time(`Fitted the grid: every vertex is on the ` +
                    `${EDIT.fmt(CP.GW)} x ${EDIT.fmt(CP.GH)} grid`);
            }
        }
    },
    open_paper: () => {     // Resize paper dialog
        if (!EDIT.active()) { return; }
        const dialog = document.getElementById("paper_dialog");
        document.getElementById("paper_width").value = EDIT.fmt(CP.GW);
        document.getElementById("paper_height").value = EDIT.fmt(CP.GH);
        dialog.returnValue = "";
        dialog.showModal();
    },
    resize: (W, H) => {     // Resize paper dialog: add or remove squares at
        if (!EDIT.active() || ((W == CP.GW) && (H == CP.GH))) { return; } // the
        const ok = (n) => Number.isInteger(n) && (1 <= n) && (n <= EDIT.MAX_GRID);
        if (!ok(W) || !ok(H)) {         // right and bottom (see ED.resize)
            NOTE.time("Grid size must be whole numbers of squares from 1 to " +
                EDIT.MAX_GRID);
            return;
        }
        const cuts = ED.resize_cuts(CP, W, H);
        if (EDIT.apply(ED.resize(CP, W, H), "")) {
            NOTE.time(`Resized the grid to ${W} x ${H} squares` + ((cuts == 0) ? ""
                : `: ${cuts} ${(cuts == 1) ? "crease" : "creases"} cut at the ` +
                  "new edge (Undo brings them back)"));
        } else {
            NOTE.time(`Cannot resize to ${W} x ${H}: this paper is not the ` +
                "whole grid, and some creases would fall outside it");
        }
    },
    changed: () => {
        GESTURE = undefined;
        document.getElementById("edit_undo").disabled = (UNDO.length == 0);
        document.getElementById("edit_redo").disabled = (REDO.length == 0);
        EDIT.draw();
    },
    cancel: () => {
        GESTURE = undefined;
        if (PAN != undefined) { EDIT.end_pan(); }
        if (EDIT.active()) { EDIT.draw_overlay(); }
    },

    // ---- drawing
    view: () => {
        // Page <-> panel mapping. At zoom 1 the page fits the panel like
        // normalize_points; zoomed in, s page units span the panel, centred
        // on the zoom centre, which is kept where the page fills the view.
        const {W, H} = CP;
        const s = Math.max(W, H)/ZOOM.z;
        const centre = (f, size) => (size <= s) ? size/2
            : Math.min(Math.max(f*size, s/2), size - s/2);
        const [cx, cy] = [centre(ZOOM.fx, W), centre(ZOOM.fy, H)];
        return {
            to_panel: ([x, y]) => [
                ((x - cx)/s + 0.5)*SVG.SCALE, ((y - cy)/s + 0.5)*SVG.SCALE],
            to_page: ([x, y]) => [
                (x/SVG.SCALE - 0.5)*s + cx, (y/SVG.SCALE - 0.5)*s + cy],
            s, c: [cx, cy],
        };
    },
    draw: (hover) => {      // hover: pointer position for the overlay
        const flat = SVG.clear("flat");
        const {W, H, V, EV, EA} = CP;
        VIEW = EDIT.view();
        const G = {};
        for (const id of ["catch", "faces", "grid", "edges", "marks", "overlay", "minimap"]) {
            G[id] = SVG.append("g", flat, {id: `edit_${id}`});
        }
        const box = flat.viewBox.baseVal;   // whole panel receives pointer input
        SVG.append("rect", G.catch, {x: box.x, y: box.y, width: box.width,
            height: box.height, fill: "transparent"});
        if (FACES?.[0] !== CP) { FACES = [CP, ...ED.CP_2_FV_VK(CP)]; }
        const [, FV, VK] = FACES;
        const P = V.map(VIEW.to_panel);
        for (const F of FV) {
            if (M.polygon_area2(M.expand(F, V)) <= 0) { continue; }  // not paper
            SVG.append("polygon", G.faces, {fill: GUI.COLORS.face.bottom,
                points: F.map(v => P[v].join(",")).join(" ")});
        }
        const [o, c] = [[0, 0], [W, H]].map(VIEW.to_panel);
        SVG.append("rect", G.grid, {x: o[0], y: o[1], width: c[0] - o[0],
            height: c[1] - o[1], fill: "none", stroke: "#888",
            "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke"});
        if (document.getElementById("edit_show_grid").checked) {
            // Reference grid: dotted, so it never looks like a (solid) crease.
            // Points snap to grid points whether or not it is shown.
            const style = {stroke: "#999", "stroke-width": 0.75,
                "stroke-dasharray": "2 3", "stroke-linecap": "butt"};
            for (let i = 1; i*W/CP.GW < W - 1e-9; ++i) {
                const x = i*W/CP.GW;
                EDIT.draw_line(G.grid, VIEW.to_panel([x, 0]), VIEW.to_panel([x, H]), style);
            }
            for (let j = 1; j*H/CP.GH < H - 1e-9; ++j) {
                const y = j*H/CP.GH;
                EDIT.draw_line(G.grid, VIEW.to_panel([0, y]), VIEW.to_panel([W, y]), style);
            }
        }
        EDIT.show_size();
        document.getElementById("edit_zoom_reset").textContent =
            `${Math.round(ZOOM.z*100)}%`;
        const E = EV.map((_, e) => e)
            .sort((a, b) => EDIT.ORDER[EA[a]] - EDIT.ORDER[EA[b]]);
        for (const e of E) {
            EDIT.draw_line(G.edges, P[EV[e][0]], P[EV[e][1]], {
                stroke: GUI.COLORS.edge[EA[e]],
                "stroke-width": (EA[e] == "B") ? 3 : 1.5, "data-e": e});
        }
        BAD = 0;
        for (const [v, k] of VK.entries()) {
            if (k <= 1/M.EPS) { continue; }
            ++BAD;
            SVG.append("circle", G.marks, {cx: P[v][0], cy: P[v][1], r: 10,
                fill: "red", opacity: 0.7});
        }
        for (const id of ["cell", "fold"]) {    // last fold, dimmed if outdated
            document.getElementById(id).style.opacity = EDIT.outdated() ? 0.35 : "";
        }
        EDIT.draw_minimap(G.minimap);
        EDIT.draw_overlay(hover);
    },
    draw_minimap: (g) => {
        // Zoomed in: an overview of the whole page in the panel's bottom-right
        // corner, the part in view outlined, so it is clear the panel shows
        // only part of the pattern. It ignores the pointer (drawing under it
        // still works) and fades while the pointer is over it.
        if (ZOOM.z <= 1) { return; }
        const {W, H, V, EV, EA} = CP;
        const flat = document.getElementById("flat");
        const box = flat.viewBox.baseVal;
        const ctm = flat.getScreenCTM();
        const px = ((ctm == null) || (ctm.a == 0))  // panel units per pixel
            ? box.width/400 : 1/ctm.a;
        const k = Math.min(EDIT.MINIMAP_PX*px, box.width/4)/Math.max(W, H);
        const [pad, font] = [4*px, 11*px];
        const [bw, bh] = [W*k + 2*pad, H*k + 3*pad + font];
        const [x0, y0] = [box.x + box.width - 8*px - bw, box.y + box.height - 8*px - bh];
        const [ox, oy] = [x0 + pad, y0 + 2*pad + font];     // page origin
        const at = ([x, y]) => [ox + x*k, oy + y*k];
        SVG.append("rect", g, {x: x0, y: y0, width: bw, height: bh,
            fill: "#ECE9D8", stroke: "#808080", "stroke-width": 1,
            "vector-effect": "non-scaling-stroke"});
        const label = SVG.append("text", g, {x: x0 + pad, y: y0 + pad + font*0.85,
            "font-size": font, "font-family": '"Pixelated MS Sans Serif", Arial',
            fill: "#000"});
        label.textContent = `Zoom ${Math.round(ZOOM.z*100)}%`;
        SVG.append("rect", g, {x: ox, y: oy, width: W*k, height: H*k,
            fill: GUI.COLORS.face.bottom});
        const D = {};       // one path per crease type keeps this cheap
        for (const [e, [i, j]] of EV.entries()) {
            const [[x1, y1], [x2, y2]] = [V[i], V[j]].map(at);
            D[EA[e]] = (D[EA[e]] ?? "") +
                `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }
        for (const a of Object.keys(D).sort((a, b) => EDIT.ORDER[a] - EDIT.ORDER[b])) {
            SVG.append("path", g, {d: D[a], fill: "none", stroke: GUI.COLORS.edge[a],
                "stroke-width": (a == "B") ? 1.5 : 1, "vector-effect": "non-scaling-stroke"});
        }
        const clip = ([x, y]) => [Math.min(Math.max(x, 0), W), Math.min(Math.max(y, 0), H)];
        const [p, q] = [[box.x, box.y], [box.x + box.width, box.y + box.height]]
            .map(c => at(clip(VIEW.to_page(c))));
        SVG.append("rect", g, {x: p[0], y: p[1], width: q[0] - p[0], height: q[1] - p[1],
            fill: "darkorange", "fill-opacity": 0.15, stroke: "darkorange",
            "stroke-width": 2, "vector-effect": "non-scaling-stroke"});
    },
    redraw: () => {         // after zooming or panning, at most once a frame
        if (FRAME != undefined) { return; }
        FRAME = requestAnimationFrame(() => {
            FRAME = undefined;
            if (EDIT.active()) { EDIT.draw(EDIT.hover_page()); }
        });
    },

    // ---- zoom and pan
    set_view: (z, [cx, cy]) => {    // zoom z centred on page point (cx, cy)
        ZOOM = {z, fx: cx/CP.W, fy: cy/CP.H};
        VIEW = EDIT.view();         // keeps the page filling the view
        ZOOM.fx = VIEW.c[0]/CP.W;
        ZOOM.fy = VIEW.c[1]/CP.H;
        EDIT.redraw();
    },
    zoom: (factor, p) => {  // p: page point that stays put (default: centre)
        if (!EDIT.active()) { return; }
        const z = Math.min(Math.max(ZOOM.z*factor, 1), EDIT.ZOOM_MAX);
        if (z == ZOOM.z) { return; }
        const [c, k] = [VIEW.c, ZOOM.z/z];
        p = p ?? c;
        EDIT.set_view(z, [p[0] - (p[0] - c[0])*k, p[1] - (p[1] - c[1])*k]);
    },
    zoom_reset: () => {
        if (EDIT.active()) { EDIT.set_view(1, [CP.W/2, CP.H/2]); }
    },
    pan: (dx, dy) => {      // move the view by (dx, dy) screen pixels
        const ctm = document.getElementById("flat").getScreenCTM();
        if ((ctm == null) || (ZOOM.z == 1)) { return; }
        const k = VIEW.s/SVG.SCALE/ctm.a;       // page units per pixel
        EDIT.set_view(ZOOM.z, [VIEW.c[0] + dx*k, VIEW.c[1] + dy*k]);
    },
    hover_page: () => (HOVER == undefined) ? undefined
        : EDIT.pointer_page({clientX: HOVER[0], clientY: HOVER[1]}),
    wheel: (e) => {
        const p = EDIT.pointer_page(e);
        if (p == undefined) { return; }
        const unit = [1, 16, 400][e.deltaMode] ?? 1;    // pixels, lines, pages
        if (e.ctrlKey || e.metaKey) {       // pinch, or Ctrl/⌘ + scroll: zoom
            e.preventDefault();             // (not the browser's page zoom)
            const t = Math.min(Math.max(-e.deltaY*unit*0.01, -1), 1);
            EDIT.zoom(2**t, p);
        } else if (ZOOM.z > 1) {            // scrolling pans a zoomed view
            e.preventDefault();
            EDIT.pan(e.deltaX*unit, e.deltaY*unit);
        }
    },
    set_space: (down) => {  // Space held: dragging pans
        SPACE = down;
        document.getElementById("flat").classList.toggle("edit_pan", down);
    },
    end_pan: () => {
        PAN = undefined;
        document.getElementById("flat").classList.remove("edit_panning");
    },
    outdated: () => (SHOWN != undefined) && (SHOWN !== CP),
    draw_line: (g, [x1, y1], [x2, y2], attrs) => {
        return SVG.append("line", g, {x1, y1, x2, y2, "stroke-linecap": "round",
            "vector-effect": "non-scaling-stroke", ...attrs});
    },
    draw_overlay: (p) => {      // pointer feedback, redrawn on every move
        const g = SVG.clear("edit_overlay");
        if (g == null) { return; }
        const mini = document.getElementById("edit_minimap");
        if (mini?.firstChild != null) {     // fade the overview under the pointer
            const r = mini.getBoundingClientRect();
            mini.classList.toggle("faded", (HOVER != undefined) &&
                (HOVER[0] >= r.left) && (HOVER[0] <= r.right) &&
                (HOVER[1] >= r.top) && (HOVER[1] <= r.bottom));
        }
        const P = VIEW.to_panel;
        if (EDIT.mode() == "draw") {
            const start = GESTURE?.start;
            const end = GESTURE?.end ?? ((p == undefined) ? undefined : ED.snap(CP, p));
            if ((start != undefined) && (end != undefined)) {
                EDIT.draw_line(g, P(start), P(end), {
                    stroke: GUI.COLORS.edge[EDIT.type()], "stroke-width": 2,
                    "stroke-dasharray": "6 4"});
            }
            for (const q of [start, end]) {
                if (q == undefined) { continue; }
                const [cx, cy] = P(q);
                SVG.append("circle", g, {cx, cy, r: 8, fill: "none",
                    stroke: "#000", "stroke-width": 1.5,
                    "vector-effect": "non-scaling-stroke"});
            }
            EDIT.update_status(end);
        } else if (EDIT.mode() == "move") {
            const v = GESTURE?.v ??
                ((p == undefined) ? -1 : ED.pick_vertex(CP, p, EDIT.pick_radius()));
            if (v >= 0) {
                const to = GESTURE?.to ?? CP.V[v];
                if (GESTURE != undefined) {     // dragging: its creases follow
                    for (const [e, [i, j]] of CP.EV.entries()) {
                        if ((i != v) && (j != v)) { continue; }
                        EDIT.draw_line(g, P(CP.V[(i == v) ? j : i]), P(to), {
                            stroke: GUI.COLORS.edge[CP.EA[e]], "stroke-width": 2,
                            "stroke-dasharray": "6 4"});
                    }
                }
                const [cx, cy] = P(to);
                SVG.append("circle", g, {cx, cy, r: 8, fill: GUI.COLORS.active,
                    "fill-opacity": 0.6, stroke: "#000", "stroke-width": 1.5,
                    "vector-effect": "non-scaling-stroke"});
            }
            EDIT.update_status(GESTURE?.to ?? p);
        } else {
            const E = new Set(GESTURE?.E ?? []);
            if ((p != undefined) && !GESTURE?.down) {     // hover
                const e = ED.pick_edge(CP, p, EDIT.pick_radius());
                if (e >= 0) { E.add(e); }
            }
            const modify = (EDIT.mode() == "modify");
            for (const e of E) {
                const [a, b] = CP.EV[e].map(v => P(CP.V[v]));
                EDIT.draw_line(g, a, b, {stroke: GUI.COLORS.active,
                    "stroke-width": 8, opacity: 0.7});
                if (modify) {
                    EDIT.draw_line(g, a, b, {stroke: GUI.COLORS.edge[EDIT.type()],
                        "stroke-width": 2});
                }
            }
            EDIT.update_status(p);
        }
    },
    update_mode: () => {
        const flat = document.getElementById("flat");
        flat.classList.remove("edit_draw", "edit_modify", "edit_erase", "edit_move");
        flat.classList.add("editing", `edit_${EDIT.mode()}`);
        if (VIEW != undefined) { EDIT.draw_overlay(); }
    },
    update_status: (p) => {
        const parts = [EDIT.HINT[EDIT.mode()]];
        if (p != undefined) {   // in grid squares from the top left
            const f = (x) => String(Math.round(x*1000)/1000);
            parts.push(`(${f(p[0]*CP.GW/CP.W)}, ${f(p[1]*CP.GH/CP.H)})`);
        }
        parts.push((BAD == 0) ? "all vertices locally flat-foldable"
            : `${BAD} ${(BAD == 1) ? "vertex" : "vertices"} not locally flat-foldable`);
        if (EDIT.outdated()) { parts.push("folded view is out of date: press Fold"); }
        document.getElementById("num_states").textContent = parts.join(" · ");
    },

    // ---- pointer and keyboard input
    pointer_page: (e) => {      // pointer position in page units
        const ctm = document.getElementById("flat").getScreenCTM();
        if (ctm == null) { return undefined; }
        const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        return VIEW.to_page([q.x, q.y]);
    },
    pick_radius: () => {        // EDIT.PICK_PX in page units
        const ctm = document.getElementById("flat").getScreenCTM();
        const px = (ctm == null) ? 1 : 1/ctm.a;     // panel units per pixel
        return EDIT.PICK_PX*px*VIEW.s/SVG.SCALE;
    },
    pointer_down: (e) => {
        if ((e.button == 1) || ((e.button == 0) && SPACE)) {    // pan
            e.currentTarget.setPointerCapture(e.pointerId);
            PAN = [e.clientX, e.clientY];
            document.getElementById("flat").classList.add("edit_panning");
            return;
        }
        if (e.button != 0) { return; }
        const p = EDIT.pointer_page(e);
        if (p == undefined) { return; }
        e.currentTarget.setPointerCapture(e.pointerId);
        if (EDIT.mode() == "draw") {
            const q = ED.snap(CP, p);
            if (GESTURE?.start == undefined) {      // first point
                GESTURE = {start: q, end: q, down: true, dragged: false};
            } else {                                // second click
                GESTURE.end = q;
                EDIT.commit_line();
            }
        } else if (EDIT.mode() == "move") {
            const v = ED.pick_vertex(CP, p, EDIT.pick_radius());
            GESTURE = (v < 0) ? undefined : {v, to: CP.V[v], down: true};
        } else {
            const e0 = ED.pick_edge(CP, p, EDIT.pick_radius());
            GESTURE = {E: new Set((e0 < 0) ? [] : [e0]), last: p, down: true};
        }
        EDIT.draw_overlay(p);
    },
    pointer_move: (e) => {
        HOVER = [e.clientX, e.clientY];
        if (PAN != undefined) {         // dragging moves the paper with it
            EDIT.pan(PAN[0] - e.clientX, PAN[1] - e.clientY);
            PAN = [e.clientX, e.clientY];
            return;
        }
        const p = EDIT.pointer_page(e);
        if (p == undefined) { return; }
        if (EDIT.mode() == "draw") {
            if (GESTURE?.start != undefined) {
                const q = ED.snap(CP, p);
                if (GESTURE.down && (M.dist(q, GESTURE.start) > 0)) {
                    GESTURE.dragged = true;
                }
                GESTURE.end = q;
            }
        } else if (EDIT.mode() == "move") {
            if (GESTURE?.down) { GESTURE.to = ED.snap(CP, p, GESTURE.v); }
        } else if (GESTURE?.down) {     // painting across creases
            for (const e of ED.edges_crossed(CP, GESTURE.last, p)) {
                GESTURE.E.add(e);
            }
            const e0 = ED.pick_edge(CP, p, EDIT.pick_radius());
            if (e0 >= 0) { GESTURE.E.add(e0); }
            GESTURE.last = p;
        }
        EDIT.draw_overlay(p);
    },
    pointer_up: (e) => {
        if (PAN != undefined) { EDIT.end_pan(); return; }
        if (!GESTURE?.down) { return; }
        GESTURE.down = false;
        const p = EDIT.pointer_page(e);
        if (EDIT.mode() == "draw") {
            if (GESTURE.dragged) { EDIT.commit_line(); }
            // otherwise a click: wait for the second point
        } else if (EDIT.mode() == "move") {
            const {v, to} = GESTURE;
            GESTURE = undefined;
            if (M.dist(to, CP.V[v]) > 0) { EDIT.apply(ED.move_vertex(CP, v, to)); }
        } else {
            const E = Array.from(GESTURE.E);
            GESTURE = undefined;
            if (E.length > 0) {
                EDIT.apply((EDIT.mode() == "modify")
                    ? ED.assign_edges(CP, E, EDIT.type())
                    : ED.erase_edges(CP, E));
            }
        }
        if (EDIT.active()) { EDIT.draw_overlay(p); }
    },
    commit_line: () => {
        const {start, end} = GESTURE;
        GESTURE = undefined;
        if (M.dist(start, end) == 0) { return; }    // same point: cancel
        EDIT.apply(ED.add_lines(CP, [[start, end, EDIT.type()]]));
    },
    key_down: (e) => {
        if (e.target.matches?.("input[type=text], input[type=number]") ||
            (document.querySelector("dialog[open]") != null)) {
            return;     // typing a title or grid size, or in a dialog
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (e.key == "Escape") {
            EDIT.cancel();
        } else if (mod && (key == "z")) {
            e.preventDefault();
            e.shiftKey ? EDIT.redo() : EDIT.undo();
        } else if (mod && (key == "y")) {
            e.preventDefault();
            EDIT.redo();
        } else if (mod && (key == "s")) {
            e.preventDefault();         // instead of saving the web page
            EDIT.save();
        } else if (!mod && !e.altKey) {
            const tool = {d: "draw", m: "modify", e: "erase", v: "move"}[key];
            const type = {1: "M", 2: "V", 3: "U", 4: "F", 5: "B"}[e.key];
            if (tool != undefined) {
                document.getElementById(`edit_${tool}`).click();
            } else if (type != undefined) {
                document.getElementById(`edit_${type}`).click();
            } else if (key == "g") {
                document.getElementById("edit_show_grid").click();
            } else if (key == "h") {
                EDIT.toggle_help();
            } else if ((e.key == "+") || (e.key == "=")) {
                EDIT.zoom(EDIT.ZOOM_STEP, EDIT.hover_page());
            } else if ((e.key == "-") || (e.key == "_")) {
                EDIT.zoom(1/EDIT.ZOOM_STEP, EDIT.hover_page());
            } else if (e.key == "0") {
                EDIT.zoom_reset();
            } else if ((e.key == " ") && (HOVER != undefined)) {
                if (!SPACE) { EDIT.set_space(true); }   // (and no scrolling
            } else if (key == "f") {                    //  or button press)
                EDIT.fold();
            } else {
                return;
            }
            e.preventDefault();     // e.g. a focused list must not jump to
        }                           // an entry starting with that letter
    },
    key_up: (e) => {
        if ((e.key == " ") && SPACE) {
            e.preventDefault();     // a focused button must not be pressed
            EDIT.set_space(false);
        }
    },
};
