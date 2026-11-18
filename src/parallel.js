import { NOTE } from "./note.js";

export const PAR = {
    queue: new WeakMap(),   // worker -> promise of its last pending request
    send_message: (w, type, args) => {
        // A worker has a single onmessage slot, so a request sent while an
        // earlier one is still running would take over that slot and receive
        // the earlier reply. Requests to the same worker are therefore queued
        // and each is only sent once the previous reply has arrived.
        const prev = PAR.queue.get(w) ?? Promise.resolve();
        const next = prev.then(() => new Promise((res, rej) => {
            const fail = (e) => {       // worker threw: fail this request
                w.removeEventListener("error", fail);   // instead of waiting
                rej(e.error ?? new Error(e.message));   // forever
            };
            w.addEventListener("error", fail);
            w.onmessage = (e) => {
                if (e.data.type == "note") { NOTE.log(e.data.arg); return; }
                w.removeEventListener("error", fail);
                res(e.data.arg);
            };
            w.postMessage({type, args});
        }));
        PAR.queue.set(w, next.catch(() => {}));  // a failure must not block
        return next;                             // later requests
    },
    get_workers: async (wn, path) => {
        if (wn == 1) { return undefined; }
        if ((typeof process !== 'undefined') && (process.release.name === 'node')) {
            await import("./node_Worker_polyfill/main.js");
        }
        NOTE.time(`*** Setting up ${wn} web workers ***`);
        const W = Array(wn).fill()
            .map(() => new Worker(path, {type: "module"}));
        for (const w of W) { w.onerror = (e) => { debugger; }; }
        await Promise.all(W.map((w, wi) => PAR.send_message(w, "init", [wi])));
        return W;
    },
    end_workers: async (W) => {
        for (const w of W) { w.terminate(); }
    },
};
