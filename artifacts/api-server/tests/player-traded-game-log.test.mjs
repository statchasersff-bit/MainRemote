/**
 * A traded player's Game Log credits each game to the club he played for that
 * week, not to his current club.
 *
 * The defects (player-page audit, 2026-11-20):
 * - Per-game target share summed every player's targets into his CURRENT club,
 *   so a midseason trade emptied the old club's weeks: Tyler Warren (IND)
 *   read 66.7% in Week 3 against a true 28.6%, Josh Downs 73.3% against 31.4%.
 * - The result column looked up the season team's score, so Downs's first KC
 *   game (Week 10, 2026) read IND's "W 24-22" instead of KC's 35-13.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

after(cleanupBundles);

const ranks = await importModule("lib/player/ranks");

// A season no real data uses, so the per-season aggregate cache is ours alone.
const SEASON = 1990;
const row = (week, team, stats) => ({ week, opp: "XXX", team, stats: { pts_ppr: 0, ...stats } });

// Traded: 4 targets for A in week 1, then 5 for B in week 2. Now on B.
const traded = { id: "t", name: "Traded", position: "WR", team: "BBB" };
const mateA = { id: "a", name: "Mate A", position: "TE", team: "AAA" };
const mateB = { id: "b", name: "Mate B", position: "WR", team: "BBB" };
const players = [traded, mateA, mateB];
const logs = {
  t: [row(1, "AAA", { rec_tgt: 4 }), row(2, "BBB", { rec_tgt: 5 })],
  a: [row(1, "AAA", { rec_tgt: 4 }), row(2, "AAA", { rec_tgt: 6 })],
  b: [row(1, "BBB", { rec_tgt: 10 }), row(2, "BBB", { rec_tgt: 5 })],
};

const share = (entries, week) => entries.find((e) => e.week === week).stats.target_share;

test("the old club's week keeps the traded player's targets", () => {
  const out = ranks.enrichWithTeamMetrics(logs.a, "AAA", SEASON, logs, players);
  // Week 1: A's pool is 4 (his) + 4 (traded) = 8, so 50%, not 100%.
  assert.equal(share(out, 1), 50);
  assert.equal(share(out, 2), 100);
});

test("the traded player's earlier game is a share of the club he played for", () => {
  const out = ranks.enrichWithTeamMetrics(logs.t, "BBB", SEASON, logs, players);
  assert.equal(share(out, 1), 50); // 4 of AAA's 8, not 4 of BBB's 10
  assert.equal(share(out, 2), 50); // 5 of BBB's 10
});

test("the new club's earlier weeks are not padded with his old targets", () => {
  const out = ranks.enrichWithTeamMetrics(logs.b, "BBB", SEASON, logs, players);
  assert.equal(share(out, 1), 100); // only B's own 10 were BBB's in week 1
  assert.equal(share(out, 2), 50);
});

test("the result column reads the club he played for that week", () => {
  // Real 2026 scores: IND won Week 10 24-22, KC won Week 10 35-13.
  const filled = ranks.fillMissingWeeks([row(10, "KC", { rec_tgt: 6, rec: 4 })], 2026, "IND", "WR");
  const wk10 = filled.find((e) => e.week === 10);
  assert.deepEqual([wk10.score?.tm, wk10.score?.opp, wk10.score?.r], [35, 13, "W"]);
});

test("a row with no club falls back to the season club", () => {
  const filled = ranks.fillMissingWeeks([row(10, null, { rec_tgt: 6, rec: 4 })], 2026, "IND", "WR");
  const wk10 = filled.find((e) => e.week === 10);
  assert.deepEqual([wk10.score?.tm, wk10.score?.opp], [24, 22]);
});
