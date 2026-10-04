/**
 * The practice store's merge (lib/player/practice-store.ts): a publish ships
 * the committed file over the reads the deployment filed since, and the store
 * puts them back, so the merge must never lose a day either side holds.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const ps = await importModule("lib/player/practice-store");
after(cleanupBundles);

const row = (final, days, extra = {}) => ({ name: "Terry McLaurin", pos: "WR", injury: "Hamstring", gameStatus: null, final, days, ...extra });
const doc = (updatedAt, weeks) => ({ season: 2026, source: "NFL.com", updatedAt, weeks });
const week = (fetchedAt, teams) => ({ fetchedAt, url: "u", teams });

describe("practice store merge", () => {
  test("a publish's stale file does not erase the days the store kept", () => {
    // The committed file: read on Wednesday morning, before any report.
    const shipped = doc("2026-09-30T12:00:00Z", { 4: week("2026-09-30T12:00:00Z", { Commanders: {} }) });
    // The store: Wednesday and Thursday filed live.
    const stored = doc("2026-10-02T02:30:00Z", {
      4: week("2026-10-02T02:30:00Z", { Commanders: { "terry-mclaurin": row("LIMITED", { "2026-09-30": "DNP", "2026-10-01": "LIMITED" }) } }),
    });
    const merged = ps.mergePracticeDocs(shipped, stored);
    assert.deepEqual(merged.weeks[4].teams.Commanders["terry-mclaurin"].days, { "2026-09-30": "DNP", "2026-10-01": "LIMITED" });
    assert.equal(merged.updatedAt, "2026-10-02T02:30:00Z");
  });

  test("days are a union; the later read wins a date and the player's fields", () => {
    const a = doc("2026-10-01T02:30:00Z", {
      4: week("2026-10-01T02:30:00Z", { Commanders: { "terry-mclaurin": row("DNP", { "2026-09-30": "DNP" }) } }),
    });
    const b = doc("2026-10-03T02:30:00Z", {
      4: week("2026-10-03T02:30:00Z", {
        Commanders: { "terry-mclaurin": row("LIMITED", { "2026-10-02": "LIMITED" }, { gameStatus: "Questionable" }) },
        Jets: { "breece-hall": row("DNP", { "2026-10-02": "DNP" }, { name: "Breece Hall" }) },
      }),
    });
    for (const merged of [ps.mergePracticeDocs(a, b), ps.mergePracticeDocs(b, a)]) {
      const tm = merged.weeks[4].teams.Commanders["terry-mclaurin"];
      assert.deepEqual(tm.days, { "2026-09-30": "DNP", "2026-10-02": "LIMITED" });
      assert.equal(tm.final, "LIMITED");
      assert.equal(tm.gameStatus, "Questionable");
      assert.ok(merged.weeks[4].teams.Jets["breece-hall"]);
      assert.equal(merged.weeks[4].fetchedAt, "2026-10-03T02:30:00Z");
    }
  });

  test("a week only one side has is kept, and a missing side is no-op", () => {
    const a = doc("x", { 3: week("2026-09-27T00:00:00Z", {}) });
    const b = doc("y", { 4: week("2026-10-01T00:00:00Z", {}) });
    assert.deepEqual(Object.keys(ps.mergePracticeDocs(a, b).weeks).sort(), ["3", "4"]);
    assert.equal(ps.mergePracticeDocs(null, b), b);
    assert.equal(ps.mergePracticeDocs(a, null), a);
  });
});
