import { M } from "./math.js";
import { NOTE } from "./note.js";
import { SVG } from "./svg.js";
import { IO } from "./io.js";
import { X } from "./conversion.js";
import { GUI } from "./gui.js";
import { PAR } from "./parallel.js";
import { EX } from "./examples.js";
import { EDIT } from "./edit_gui.js";
import { BP } from "./bp.js";

window.onload = () => MAIN.startup();   // entry point

let FOLD, CELL, COMP;
let SOURCE;     // the imported file shown, {name, doc, type, side}, for Edit
const MAIN = {
    startup: async () => {
        NOTE.clear_log();
        NOTE.start("*** Starting Ogmi-Creaser ***");
        NOTE.time("Initializing interface");
        const [b, s] = [50, SVG.SCALE];
        const main = document.getElementById("main");
        for (const [k, v] of Object.entries({
            xmlns: SVG.NS,
            style: `background: ${GUI.COLORS.background}`,
            viewBox: [0, 0, 3*s, s].join(" "),
        })) {
            main.setAttribute(k, v);
        }
        for (const [i, id] of ["flat", "cell", "fold"].entries()) {
            const svg = document.getElementById(id);
            for (const [k, v] of Object.entries({
                xmlns: SVG.NS,
                height: s,
                width: s,
                x: i*s,
                y: 0,
                viewBox: [-b, -b, s + 2*b, s + 2*b].join(" "),
            })) {
                svg.setAttribute(k, v);
            }
        }
        const example_select = document.getElementById("example");
        for (const name of EX) {
            const el = document.createElement("option");
            el.setAttribute("value", (name[0] == "S") ? "select" : name);
            el.textContent = name;
            example_select.appendChild(el);
        }
        const limit_select = document.getElementById("limit_select");
        for (const val of ["all", 10000, 1000, 100, 10, 1]) {
            const el = document.createElement("option");
            el.setAttribute("value", val);
            el.textContent = val;
            limit_select.appendChild(el);
        }
        for (const id of ["flat", "fold"]) {
            const rotate_select = SVG.clear(`rotate_${id}`);
            for (const val of [0, 90, 180, 270]) {
                const el = document.createElement("option");
                el.setAttribute("value", val);
                el.textContent = val;
                rotate_select.appendChild(el);
            }
        }
        NOTE.time("*** Setting up computing worker ***");
        COMP = new Worker("./src/compute.js", {type: "module"});
        COMP.onerror = (e) => { debugger; }
        await PAR.send_message(COMP, "setup", []);
        const import_file = document.getElementById("import");
        example_select.onchange = async (e) => {
            import_file.value = null;
            const path = e.target.value.split("/")      // keep the folder
                .map(encodeURIComponent).join("/");     // separator a "/"
            const response = await fetch(`./examples/${path}`);
            const doc = await response.text();
            MAIN.process_file(e.target.value, doc);     // unencoded: file name
        };
        import_file.onchange = (e) => {
            example_select.value = "select";
            if (e.target.files.length > 0) {
                const file_reader = new FileReader();
                file_reader.onload = (e) => {
                    const doc = e.target.result;
                    const path = document.getElementById("import").value;
                    MAIN.process_file(path, doc);
                };
                file_reader.readAsText(e.target.files[0]);
            }
        };
        document.getElementById("import_button").onclick = () => {
            import_file.click();    // file input is hidden behind XP button
        };
        document.getElementById("side").onclick = (e) => {
            const side = ((e.target.textContent == "+") ? "-" : "+");
            e.target.textContent = side;
        };
        // Fold in the editor imports its pattern like a file and solves it.
        // The editor's output already is what it showed, so it is imported
        // "+" side up whatever the side toggle says.
        EDIT.setup(async (name, doc) => {
            if (!await MAIN.process_file(name, doc, true)) { return false; }
            await MAIN.compute();
            return true;
        });
        document.getElementById("edit_button").onclick = () => EDIT.edit(SOURCE);
        // E edits and F folds the crease pattern shown (the editor has its
        // own keys while active, where F folds too and E is the Erase tool)
        window.addEventListener("keydown", (e) => {
            if (EDIT.active() || e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
                e.target.matches?.("input[type=text], input[type=number]") ||
                (document.querySelector("dialog[open]") != null) ||
                document.getElementById("flat_controls").hidden) { return; }
            const id = {e: "edit_button", f: "fold_button"}[e.key.toLowerCase()];
            if (id == undefined) { return; }
            e.preventDefault();     // e.g. a focused list must not jump to an
            const button = document.getElementById(id);     // entry instead
            if (!button.disabled) { button.click(); }
        });
        NOTE.end();
    },
    process_file: async (path, doc, side_up) => {
        // Never leave the page half drawn: on any error, show "Import failed"
        try {
            return await MAIN.import_doc(path, doc, side_up);
        } catch (e) {
            NOTE.time(`ERROR: ${e.message}`);
            return MAIN.import_failed();
        }
    },
    import_failed: () => {
        [FOLD, CELL, SOURCE] = [undefined, undefined, undefined];
        NOTE.time("Import failed");
        for (const id of ["flat", "cell", "fold", "export"]) { SVG.clear(id); }
        for (const id of ["flat_controls", "cell_controls",
            "state_controls", "export_button"]) {
            document.getElementById(id).hidden = true;
        }
        document.getElementById("num_states").textContent = "Import failed";
        NOTE.end();
        return false;
    },
    import_doc: async (path, doc, side_up) => {
        EDIT.stop();            // importing leaves the crease pattern editor
        SOURCE = undefined;
        NOTE.clear_log();
        NOTE.start("*** Starting File Import ***");
        const file_name = path.split("\\").pop().split("/").pop();
        document.getElementById("file_name").textContent = file_name;
        NOTE.time(`Importing from file ${file_name}`);
        const parts = file_name.split(".");
        const name = parts[0];
        let type = parts[parts.length - 1].toLowerCase();
        if ((type == "svg") || (type == "opx")) {
            const L = (type == "svg") ? IO.SVG_2_L(doc) : IO.OPX_2_L(doc);
            const M = {U: 5, B: 1, M: 2, V: 3, F: 4};
            doc = L.map(([[x1, y1], [x2, y2], a]
                ) => [M[a], x1, y1, x2, y2].join(" ")).join("\n");
            type = "cp";
        }
        const side = side_up ?? (document.getElementById("side").textContent == "+");
        await PAR.send_message(COMP, "clear", []);
        CELL = undefined;
        try {
            FOLD = await PAR.send_message(COMP,
                "doc_type_side_2_fold", [doc, type, side]);
        } catch (e) {           // worker threw, e.g. on a malformed file
            NOTE.time(`ERROR: ${e.message}`);
            FOLD = undefined;
        }
        if (FOLD == undefined) { return MAIN.import_failed(); }
        FOLD.name = name;
        [FOLD.FL, FOLD.RV] = BP.doc_2_FL_RV(doc, type, side) ?? [];   // circles
        SOURCE = {name, doc, type, side};
        for (const input of ["text", "flip_flat", "flip_fold", "visible", "scale"]) {
            document.getElementById(input).checked = false;
        }
        document.getElementById("bp_flat").checked = true;
        document.getElementById("bp_flat_row").hidden = !(FOLD.FL?.length > 0);
        document.getElementById("bp_flat").onchange = () => GUI.update_flat(FOLD);
        for (const id of ["rotate_flat", "rotate_fold", "shadow"]) {
            document.getElementById(id).value = 0;
        }
        NOTE.time("Drawing flat");
        GUI.update_flat(FOLD);
        NOTE.time("Drawing cell");
        GUI.update_cell(FOLD);
        SVG.clear("fold");
        document.getElementById("num_states").innerHTML = "";
        for (const [id, hidden] of [
            ["flat_controls", false], ["fold_controls", true],
            ["cell_controls", false], ["state_controls", true],
            ["export_button", false],
        ]) {
            document.getElementById(id).hidden = hidden;
        }
        document.getElementById("export_button").onclick = () => IO.write(FOLD);
        document.getElementById("text").onchange = () => {
            NOTE.start("Toggling Text");
            GUI.update_text(FOLD);
            NOTE.end();
        };
        for (const [id, log] of [["flip", "Flipping"], ["rotate", "Rotating"]]) {
            document.getElementById(`${id}_flat`).onchange = () => {
                NOTE.start(`${log} crease pattern`);
                GUI.update_flat(FOLD);
                NOTE.end();
            };
            document.getElementById(`${id}_fold`).onchange = () => {
                NOTE.start(`${log} model`);
                GUI.update_cell(FOLD);
                NOTE.end();
            };
        }
        document.getElementById("fold_button").onclick = () => {
            MAIN.compute();
        };
        NOTE.end();
        return true;
    },
    compute: async () => {
        // The solve draws into all three panels as it goes, so the editor
        // must not take over the left panel meanwhile: New and Edit wait,
        // and so does Fold (no second solve on top of this one).
        const buttons = ["new_button", "edit_button", "fold_button"]
            .map(id => document.getElementById(id));
        for (const b of buttons) { b.disabled = true; }
        try {
            await MAIN.solve();
        } catch (e) {   // the solver threw: report it, keep Edit usable
            NOTE.time(`ERROR: the solver failed: ${e.message}`);
            document.getElementById("num_states").textContent = "Solver failed";
            document.getElementById("fold_button").onclick = undefined;
            NOTE.end();
        } finally {
            for (const b of buttons) { b.disabled = false; }
        }
    },
    solve: async () => {
        const val = document.getElementById("limit_select").value;
        const lim = (val == "all") ? Infinity : +val;
        NOTE.start(`*** Starting solve with limit ${lim} ***`);
        // A vertex failing Kawasaki or Maekawa (or of odd degree), marked red
        // in the crease pattern, rules out any flat folded state; the solver
        // would crash or report states that cannot exist, so stop here.
        const bad = FOLD.VK.filter(k => k > 1/M.EPS).length;
        if (bad > 0) {
            NOTE.time(`${bad} ${(bad == 1) ? "vertex is" : "vertices are"} ` +
                "not locally flat-foldable (marked red): no folded state");
            NOTE.count(0, "folded states");
            document.getElementById("num_states").textContent =
                `Found 0 states: ${bad} ${(bad == 1) ? "vertex" : "vertices"} ` +
                "not locally flat-foldable (red)";
            NOTE.end();
            return;
        }
        const solved = await PAR.send_message(COMP, "solved", []);
        if (solved) {
            NOTE.log("   - Using information from previous solve");
        } else {
            CELL = await PAR.send_message(COMP, "get_cell", []);
            if (CELL == undefined) {
                const num_states = document.getElementById("num_states");
                const error = "(Precision Error: could not find stable graph)"
                num_states.textContent = error;
                NOTE.time(error);
                NOTE.end();
                return;
            }
            NOTE.time("Updating cell");
            GUI.update_cell(FOLD, CELL);
            document.getElementById("text").onchange = (e) => {
                NOTE.start("Toggling Text");
                GUI.update_text(FOLD, CELL);
                NOTE.end();
            };
            for (const [id, log] of [["flip", "Flipping"], ["rotate", "Rotating"]]) {
                document.getElementById(`${id}_fold`).onchange = () => {
                    NOTE.start(`${log} model`);
                    GUI.update_cell(FOLD, CELL);
                    NOTE.end();
                };
            }
            NOTE.time("Updating cell-face listeners");
            await GUI.update_cell_face_listeners(FOLD, CELL, COMP);
            await PAR.send_message(COMP, "build_variables", []);
            await PAR.send_message(COMP, "build_constraints", []);
            const [type, out] = await PAR.send_message(COMP, "presolve", []);
            if (type == "assign_error") {
                const [type, F, E] = out;
                GUI.update_error(F, E, CELL.FC);
                document.getElementById("fold_button").onclick = undefined;
                for (const id of ["flip_flat", "rotate_flat", "flip_fold", "rotate_fold"]) {
                    document.getElementById(id).onchange = undefined;
                }
                NOTE.time("Solve completed");
                NOTE.count(0, "folded states");
                const num_states = document.getElementById("num_states");
                num_states.textContent = `Found 0 states`;
                NOTE.end();
                return;
            }
        }
        const [type, out] = await PAR.send_message(COMP, "solve", [lim]);
        if (type == "component_error") {
            const [gi, F] = out;
            NOTE.log(`   - Unable to resolve component ${gi}`);
            GUI.update_component_error(F, CELL.FC);
            document.getElementById("fold_button").onclick = undefined;
            for (const id of ["flip_flat", "rotate_flat", "flip_fold", "rotate_fold"]) {
                document.getElementById(id).onchange = undefined;
            }
            NOTE.time("Solve completed");
            NOTE.count(0, "folded states");
            const num_states = document.getElementById("num_states");
            num_states.textContent = `Found 0 states`;
            NOTE.end();
            return;
        }
        const Gn = out;
        const n = Gn.reduce((s, gn) => s*BigInt(gn), BigInt(1));
        NOTE.count(n, "folded states");
        const num_states = document.getElementById("num_states");
        num_states.textContent = `Found ${n} state${(n == 1) ? "" : "s"}`;
        const Gi = Gn.map(() => 0);
        const [CD, FO] = await PAR.send_message(COMP, "Gi_2_CD_FO", [Gi]);
        CELL.CF = CD;
        FOLD.FO = FO;
        document.getElementById("fold_controls").hidden = false;
        document.getElementById("state_controls").hidden = false;
        for (const [id, log] of [["flip", "Flipping"], ["rotate", "Rotating"]]) {
            document.getElementById(`${id}_flat`).onchange = async () => {
                NOTE.start(`${log} crease pattern`);
                GUI.update_flat(FOLD);
                GUI.update_visible(FOLD, CELL);
                NOTE.time("Updating cell-face listeners");
                await GUI.update_cell_face_listeners(FOLD, CELL, COMP);
                NOTE.end();
            };
            document.getElementById(`${id}_fold`).onchange = async () => {
                NOTE.start(`${log} folded state`);
                GUI.update_fold(FOLD, CELL);
                GUI.update_cell(FOLD, CELL);
                NOTE.time("Updating cell-face listeners");
                await GUI.update_cell_face_listeners(FOLD, CELL, COMP);
                GUI.update_component(FOLD, CELL, COMP, Gn, Gi);
                NOTE.end();
            };
        }
        document.getElementById("shadow").onchange = () => {
            NOTE.start("Toggling shadows");
            GUI.update_fold(FOLD, CELL);
            NOTE.end();
        };
        document.getElementById("visible").onchange = () => {
            NOTE.start("Toggling visible faces");
            GUI.update_visible(FOLD, CELL);
            NOTE.end();
        };
        document.getElementById("scale").onchange = () => {
            NOTE.start("Toggling scale faces");
            if (document.getElementById("scale").checked) {
                const [p_min, p_max] = M.bounding_box(CELL.P);
                const d = M.sub(p_max, p_min);
                NOTE.log(`Scaled to [width, height] = [${d[0]},${d[1]}]`);
            }
            GUI.update_fold(FOLD, CELL);
            NOTE.end();
        };
        const comp_select = SVG.clear("component_select");
        for (const opt of ["none", "all"]) {
            const el = document.createElement("option");
            el.setAttribute("value", opt);
            el.textContent = opt;
            comp_select.appendChild(el);
        }
        for (const [i, _] of Gn.entries()) {
            const el = document.createElement("option");
            el.setAttribute("value", `${i}`);
            el.textContent = `${i}`;
            comp_select.appendChild(el);
        }
        comp_select.onchange = (e) => {
            NOTE.start("Changing component");
            GUI.update_component(FOLD, CELL, COMP, Gn, Gi);
            NOTE.end();
        };
        NOTE.time("Drawing fold");
        GUI.update_flat(FOLD);
        GUI.update_fold(FOLD, CELL);
        NOTE.time("Updating cell-face listeners");
        await GUI.update_cell_face_listeners(FOLD, CELL, COMP);
        NOTE.time("Drawing component");
        GUI.update_component(FOLD, CELL, COMP, Gn, Gi);
        NOTE.end();
    },
};
