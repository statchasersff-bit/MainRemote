import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "../tests/helpers/server.mjs";
import path from "node:path";
const { origin, stop } = await startServer();
const bundle = fs.readFileSync(path.join(APP_DIR, "public", "dist", "statchasers-team.js"), "utf8");
const slug = process.argv[2] ?? "cleveland-browns";
console.error("server up", origin); const t0=Date.now(); const res = await fetch(`${origin}/embed/team/${slug}?section=contracts`); console.error("fetched", res.status, Date.now()-t0, "ms");
const errors = [];
const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(String(e)));
const body = await res.text(); console.error("roots in fragment", (body.match(/data-sct-root/g)||[]).length); const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: "outside-only", url: `${origin}/team/${slug}/`, pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window; console.error("dom built"); w.eval(bundle); console.error("bundle run"); await new Promise(r => setTimeout(r, 80));
const doc = w.document;
const old = doc.querySelector(".sct-ct"), neu = doc.querySelector(".sct-ctp");
const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const outs = (b) => ["count", "freed", "added", "after"].map(k => txt(b.querySelector(`[data-sct-ct-out="${k}"]`))).join(" | ");
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const tick = (b, id, sel) => { const p = b.querySelector(`[data-sct-ct-row][data-sct-ct-id="${id}"] [data-sct-ct-pick]`); p.checked = !p.checked; p.dispatchEvent(new w.Event("change", { bubbles: true })); };
const rows = [...neu.querySelectorAll("[data-sct-ct-row]")];
const pos = rows.find(r => Number(r.dataset.preSave) > 0);
const neg = rows.find(r => Number(r.dataset.preSave) < 0);
const diffPP = rows.find(r => r !== neg && r !== pos && r.dataset.preSave !== r.dataset.postSave);
console.log("js flags", old.dataset.sctCt, neu.dataset.sctCt, "timing attr", neu.dataset.timing);
console.log("baseline old:", outs(old)); console.log("baseline new:", outs(neu));
const step = (label) => { console.log(`${label}\n  old: ${outs(old)}\n  new: ${outs(neu)}  ${outs(old) === outs(neu) ? "MATCH" : "MISMATCH"}`); };
for (const b of [old, neu]) tick(b, pos.dataset.sctCtId); step(`+ positive ${pos.dataset.sctCtId} (${txt(pos.querySelector(".sct-ct-name"))})`);
console.log("  picked row class:", pos.classList.contains("is-picked"), "rel card picked:", neu.querySelector(`[data-sct-ct-cut="${pos.dataset.sctCtId}"]`)?.classList.contains("is-picked"), "sim active:", neu.querySelector("[data-sct-ct-scen]").classList.contains("is-active"), "reset hidden:", neu.querySelector("[data-sct-ct-reset]").hidden, "alt:", txt(neu.querySelector('[data-sct-ct-out="alt"]')));
for (const b of [old, neu]) tick(b, neg.dataset.sctCtId); step(`+ negative ${neg.dataset.sctCtId} (${txt(neg.querySelector(".sct-ct-name"))})`);
for (const b of [old, neu]) tick(b, diffPP.dataset.sctCtId); step(`+ pre!=post ${diffPP.dataset.sctCtId} (${txt(diffPP.querySelector(".sct-ct-name"))}) pre ${diffPP.dataset.preSave} post ${diffPP.dataset.postSave}`);
// toggle to post
for (const b of [old, neu]) click(b.querySelector('[data-sct-ct-timing="post"]')); step("toggle After June 1");
console.log("  timing attr:", neu.dataset.timing, "pressed:", [...neu.querySelectorAll("[data-sct-ct-timing]")].map(x => x.getAttribute("aria-pressed")).join(","), "net cell sort key:", diffPP.querySelector(".is-net").dataset.sort, "dead sort:", diffPP.querySelector(".is-dead").dataset.sort, "foot word:", txt(neu.querySelector("[data-sct-ct-timing-word]")));
console.log("  still checked:", [pos, neg, diffPP].map(r => r.querySelector("[data-sct-ct-pick]").checked).join(","));
for (const b of [old, neu]) click(b.querySelector('[data-sct-ct-timing="pre"]')); step("toggle Before June 1");
console.log("  net cell sort key back:", diffPP.querySelector(".is-net").dataset.sort);
// sort by APY while picked; selection must survive
click(old.querySelector('thead [data-sct-ct-sort="apy"]')); console.log("old apy sort:", old.querySelector("thead th.is-apy").getAttribute("aria-sort")); click(neu.querySelector('thead [data-sct-ct-sort="apy"]'));
console.log("sorted by apy:", neu.querySelector("thead th.is-apy").getAttribute("aria-sort"), "cap head sort:", neu.querySelector("thead th.is-cap").getAttribute("aria-sort"), "picked still:", [...neu.querySelectorAll("[data-sct-ct-row].is-picked")].length);
step("after sort (totals unchanged)");
// clear
for (const b of [old, neu]) click(b.querySelector("[data-sct-ct-reset]")); step("clear");
// Try link
for (const b of [old, neu]) click(b.querySelector("[data-sct-ct-try]")); step("Try <first>");
for (const b of [old, neu]) click(b.querySelector("[data-sct-ct-reset]"));
// release row tap
const rel = neu.querySelector(".sct-ctp-rel"); click(rel); step("tap release row (new only)");
console.log("  row picked:", neu.querySelector(`[data-sct-ct-row][data-sct-ct-id="${rel.dataset.sctCtCut}"]`).classList.contains("is-picked"));
click(rel.querySelector("[data-sct-ct-cut-tick]")); step("tap release row button again");
// Independence: old block unaffected by new picks
console.log("old independent:", outs(old));
console.log("errors:", errors);
await stop(); process.exit(0);
