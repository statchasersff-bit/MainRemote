/**
 * The FPA table's arithmetic (lib/fpa/math.ts), on a league small enough to
 * work out by hand: the strength-of-schedule adjustment, the blend with the
 * baseline season, and the rolling window. Until this file none of the three
 * had a test; the suite only checked what the page says about them.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let math;
let blend;
before(async () => {
  math = await importModule("lib/fpa/math");
  blend = await importModule("lib/fpa/blend");
});
after(cleanupBundles);

/** One QB line: `offense` scored `pts` against `defense` in `week`. */
const qb = (week, offense, defense, pts) => ({
  season: 2026,
  week,
  seasonType: "REG",
  position: "QB",
  team: offense,
  defenseTeam: defense,
  receptions: 0,
  points: { standard: pts, half: pts, ppr: pts },
});

/*
 * Four offenses that score the same every week whoever they play: A 30,
 * B 10, C 20, D 20. League average 20. So every defense is exactly average,
 * and any difference in what they allowed is the schedule.
 *
 *   week 1: A-B, C-D      week 2: A-C, B-D
 */
const league = [
  qb(1, "A", "B", 30), qb(1, "B", "A", 10), qb(1, "C", "D", 20), qb(1, "D", "C", 20),
  qb(2, "A", "C", 30), qb(2, "C", "A", 20), qb(2, "B", "D", 10), qb(2, "D", "B", 20),
];

describe("strength of schedule", () => {
  test("raw is points allowed per game", () => {
    const table = math.computeFpaTable(league, "ppr");
    assert.equal(table.get("B").byPos.QB.raw, 25); // A 30, D 20
    assert.equal(table.get("A").byPos.QB.raw, 15); // B 10, C 20
    assert.equal(table.get("B").games, 2);
  });

  test("adjusted takes out the offenses faced, so equal defenses come out equal", () => {
    const table = math.computeFpaTable(league, "ppr");
    for (const team of ["A", "B", "C", "D"]) {
      assert.equal(table.get(team).byPos.QB.adj, 20, team);
    }
  });

  test("a position nobody scored at is zero, not missing", () => {
    const table = math.computeFpaTable(league, "ppr");
    assert.deepEqual(table.get("A").byPos.TE, { raw: 0, adj: 0 });
  });
});

describe("the blend", () => {
  const baseline = () => math.buildPreseasonBaseline(math.computeFpaTable([qb(1, "X", "A", 10)], "ppr"));

  test("weights the current season by currentSeasonWeight", () => {
    const current = math.computeFpaTable([qb(1, "X", "A", 30)], "ppr");
    const w = blend.currentSeasonWeight(4);
    const out = math.blendWithCurrent(baseline(), current, 4);
    assert.ok(Math.abs(out.get("A").byPos.QB.raw - ((1 - w) * 10 + w * 30)) < 1e-9);
  });

  test("a defense in only one season is blended with itself, not with zero", () => {
    const current = math.computeFpaTable([qb(1, "X", "N", 24)], "ppr");
    const out = math.blendWithCurrent(baseline(), current, 4);
    assert.equal(out.get("N").byPos.QB.raw, 24);
    assert.equal(out.get("A").byPos.QB.raw, 10);
  });

  test("from week 12 the current season is all of it", () => {
    const current = math.computeFpaTable([qb(1, "X", "A", 30)], "ppr");
    assert.equal(math.blendWithCurrent(baseline(), current, 12).get("A").byPos.QB.raw, 30);
  });
});

describe("the rolling window", () => {
  const weeks = (n) => Array.from({ length: n }, (_, i) => qb(i + 1, "X", "A", 10));

  test("before week 12 every week counts", () => {
    assert.deepEqual([...math.currentWindowWeeks(weeks(11), 11)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("from week 12 only the last ten", () => {
    const window = [...math.currentWindowWeeks(weeks(14), 14)].sort((a, b) => a - b);
    assert.deepEqual(window, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    assert.equal(window.length, math.ROLLING_WINDOW_WEEKS);
  });
});
