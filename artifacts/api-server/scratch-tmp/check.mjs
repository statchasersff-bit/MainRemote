import { startServer } from "/home/runner/workspace/artifacts/api-server/tests/helpers/server.mjs";
import { JSDOM } from "jsdom";
const { origin, stop } = await startServer();
const teams = process.argv.slice(2);
const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
for (const slug of teams) {
  const res = await fetch(`${origin}/embed/team/${slug}`);
  const html = await res.text();
  const doc = new JSDOM(html).window.document;
  const old = doc.querySelector(".sct-ct");
  const neu = doc.querySelector(".sct-ctp");
  const out = { slug, status: res.status, old: !!old, neu: !!neu };
  if (!old || !neu) { console.log(JSON.stringify(out)); continue; }
  // order: old before new, inside the same panel
  out.order = old.compareDocumentPosition(neu) & 4 ? "old-then-new" : "WRONG";
  out.samePanel = old.closest("#contracts") === neu.closest("#contracts");
  out.flag = txt(neu.querySelector(".sct-cp-flag"));
  out.title = txt(neu.querySelector(".sct-ctp-title"));
  out.h2count = doc.querySelectorAll("#contracts h2").length;
  const oldRows = [...old.querySelectorAll(".sct-ct-table tbody tr")];
  const newRows = [...neu.querySelectorAll(".sct-ctp-table tbody tr")];
  out.rows = [oldRows.length, newRows.length];
  // compare each row's data attrs, name, cap, apy, worth, gtd, len, net, dead
  let diffs = 0;
  oldRows.forEach((o, i) => {
    const n = newRows[i];
    const a = [o.dataset.sctCtId, o.dataset.preSave, o.dataset.preDead, o.dataset.postSave, o.dataset.postDead,
      txt(o.querySelector(".sct-ct-name")), txt(o.querySelector(".is-cap")), txt(o.querySelector(".is-apy")),
      txt(o.querySelector(".is-worth-col .sct-ct-fig")), txt(o.querySelector(".is-gtd")), txt(o.querySelector(".is-signed")),
      txt(o.querySelector(".is-save-col .sct-ct-fig")), txt(o.querySelector(".is-dead")), o.querySelector(".sct-ct-status")?.textContent ?? "",
      o.querySelector(".sct-ct-tag")?.textContent ?? "", o.querySelector(".sct-ct-face-img")?.getAttribute("src") ?? ""];
    const b = [n.dataset.sctCtId, n.dataset.preSave, n.dataset.preDead, n.dataset.postSave, n.dataset.postDead,
      txt(n.querySelector(".sct-ct-name")), txt(n.querySelector(".is-cap")), txt(n.querySelector(".is-apy")),
      txt(n.querySelector(".is-worth .sct-ctp-fig")), txt(n.querySelector(".is-gtd")), txt(n.querySelector(".is-span")),
      txt(n.querySelector(".is-net .is-pre")), txt(n.querySelector(".is-dead .is-pre")), n.querySelector(".sct-ctp-status")?.textContent ?? "",
      n.querySelector(".sct-ctp-tag")?.textContent ?? "", n.querySelector(".sct-ctp-face-img")?.getAttribute("src") ?? ""];
    if (JSON.stringify(a) !== JSON.stringify(b)) { diffs++; if (diffs < 3) console.log("DIFF", slug, a, b); }
  });
  out.rowDiffs = diffs;
  out.links = [oldRows.filter(r => r.querySelector("a.sct-player-link")).length, newRows.filter(r => r.querySelector("a.sct-player-link")).length];
  out.faces = [oldRows.filter(r => r.querySelector(".sct-ct-face-img")).length, newRows.filter(r => r.querySelector(".sct-ctp-face-img")).length];
  // scenario + ledger figures
  out.capSpace = [old.dataset.capSpace, neu.dataset.capSpace, txt(old.querySelector('[data-sct-ct-out="after"]')), txt(neu.querySelector('[data-sct-ct-out="after"]'))];
  out.try = [old.querySelector("[data-sct-ct-try]")?.dataset.sctCtTry, neu.querySelector("[data-sct-ct-try]")?.dataset.sctCtTry];
  const oldLedger = [...old.querySelectorAll(".sct-ct-ledger .sct-ct-lg-row")].map(r => [txt(r.querySelector(".sct-ct-lg-label")), txt(r.querySelector(".sct-ct-lg-value")), txt(r.querySelector(".sct-ct-rank"))]);
  const newFeat = [...neu.querySelectorAll(".sct-ctp-feature")].map(f => [txt(f.querySelector(".sct-ctp-feature-label")), txt(f.querySelector(".sct-ctp-feature-value")), txt(f.querySelector(".sct-ctp-rank .sct-ctp-num"))]);
  const newRowsC = [...neu.querySelectorAll(".sct-ctp-crow")].map(r => [txt(r.querySelector(".sct-ctp-crow-label")), txt(r.querySelector(".sct-ctp-crow-value .sct-ctp-num")), txt(r.querySelector(".sct-ctp-rank .sct-ctp-num"))]);
  out.oldLedger = oldLedger; out.newFeat = newFeat; out.newRows = newRowsC;
  out.oldFlexStrip = txt(old.querySelectorAll(".sct-ct-ledger .sct-ct-strip")[1]);
  out.newFlexStrip = txt(neu.querySelector(".is-flex .sct-ctp-card-strip"));
  out.oldDead = [txt(old.querySelector(".sct-ct-dead .sct-ct-strip")), txt(old.querySelector('.sct-ct-dead [data-sct-ct-out="dead"]')), txt(old.querySelector(".sct-ct-dead .sct-ct-rank")), old.querySelectorAll(".sct-ct-dead-row").length, txt(old.querySelector(".sct-ct-dead .sct-ct-lg-sub"))];
  out.newDead = [txt(neu.querySelector(".is-dead .sct-ctp-card-strip")), txt(neu.querySelector(".is-dead .sct-ctp-feature-value")), txt(neu.querySelector(".is-dead .sct-ctp-rank")), neu.querySelectorAll(".sct-ctp-dead-row").length, txt(neu.querySelector(".is-dead .sct-ctp-card-dek"))];
  out.oldCuts = [...old.querySelectorAll(".sct-ct-cut")].map(c => [c.dataset.sctCtCut, txt(c.querySelector(".sct-ct-cut-save")), txt(c.querySelector(".sct-ct-cut-dead"))]);
  out.newCuts = [...neu.querySelectorAll(".sct-ctp-rel")].map(c => [c.dataset.sctCtCut, txt(c.querySelector(".sct-ctp-rel-line")), txt(c.querySelectorAll(".sct-ctp-rel-line")[1])]);
  out.deadRowsMatch = JSON.stringify([...old.querySelectorAll(".sct-ct-dead-row")].map(r => txt(r))) === JSON.stringify([...neu.querySelectorAll(".sct-ctp-dead-row")].map(r => txt(r)));
  const ids = [...neu.querySelectorAll("[id]")].map(x => x.id);
  out.dupIds = ids.filter(id => [...doc.querySelectorAll("[id]")].filter(x => x.id === id).length > 1);
  out.ids = ids;
  out.sortHeads = [...neu.querySelectorAll("thead [data-sct-ct-sort]")].map(b => b.dataset.sctCtSort);
  out.sorted = neu.querySelector("thead th.is-sorted")?.getAttribute("aria-sort");
  console.log(JSON.stringify(out, null, 1));
}
await stop();
