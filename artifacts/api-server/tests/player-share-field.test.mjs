/**
 * One comparison per share metric across the player page (audit WEB-035,
 * 2026-11-26). Luther Burden III's 22.0% target share read 27th of 110 on the
 * Stats card, 25th of 114 in the Outlook and the 62nd percentile of a third
 * pool in the Overview. Rendered against the data on disk, so the assertions
 * are relations (the same rank wherever it is printed), not pinned numbers.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer({ SC_LIVE_WARM: "0", SC_EDGE_PREFETCH: "0", SC_WATCHDOG: "0" });
});
after(async () => server?.stop());

const squash = (s) => s.replace(/\s+/g, " ").trim();

describe("target share: one field on Overview, Stats and Outlook", () => {
  test("Luther Burden III", async () => {
    const res = await fetch(`${server.origin}/embed/player/luther-burden-iii`);
    assert.equal(res.status, 200);
    const doc = new JSDOM(await res.text()).window.document;

    // Stats card row: "Target share 22.0% 25th of 114".
    const statRow = [...doc.querySelectorAll(".scp-stp-row")].find((r) => r.querySelector(".scp-stp-row-label")?.textContent === "Target share");
    assert.ok(statRow, "Stats card has a Target share row");
    const statRank = squash(statRow.querySelector(".scp-stp-rank").textContent);
    const m = /^(\d+)(?:st|nd|rd|th) of (\d+)$/.exec(statRank);
    assert.ok(m, statRank);
    const [rank, of] = [Number(m[1]), Number(m[2])];

    // Outlook drivers and read print the same rank of the same field.
    const outlook = squash([...doc.querySelectorAll(".scp-olp-drv, .scp-olr-sec")].map((e) => e.textContent).join(" "));
    const ord = statRank.split(" of ")[0];
    assert.match(outlook, new RegExp(`${ord} of ${of}\\b`));
    assert.doesNotMatch(outlook, new RegExp(`target share[^.]*?\\b(?!${ord})\\d+(st|nd|rd|th) of (?!${of}\\b)\\d+`, "i"));

    // Overview meter: the same field's percentile (share of the other qualified players he is above).
    const meter = [...doc.querySelectorAll(".scp-ox-eff")].find((e) => e.querySelector(".scp-ox-eff-l")?.textContent === "Target share");
    assert.ok(meter, "Overview has a Target share meter");
    const pct = Number(/(\d+)/.exec(meter.querySelector(".scp-ox-eff-p").textContent)[1]);
    // Without ties the percentile is (of - rank) / (of - 1).
    assert.ok(Math.abs(pct - Math.round(((of - rank) / (of - 1)) * 100)) <= 1, `${pct} vs ${rank}/${of}`);
    assert.match(squash(doc.querySelector(".scp-ox-effs .scp-ow-note").textContent), new RegExp(`target share among the ${of} WRs with`));

    // The Stats card says which rows rank in that field.
    assert.match(squash(doc.querySelector(".scp-stp-note")?.textContent ?? ""), new RegExp(`target share[^;]* among the ${of} WRs with \\d+\\+ games`));
  });
});
