/**
 * The Game Log tab's generated note copy and the second-half deficit math in
 * src/lib/player/gamelog-sections.ts.
 *
 * The section renderers ("Where His Weeks Finished" and the "Game-by-Game
 * Breakdown") were deleted 2026-11-10 with their tests: the premium blocks
 * (gamelog-premium.ts, breakdown-premium.ts) render the tab from the same
 * builders. Driven with plain input objects, so nothing here depends on
 * what is in the stores the day the suite runs.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const mod = await importModule("lib/player/gamelog-sections");
after(() => cleanupBundles());

/* ---------------------------------------------------------------- fixtures */

const TEAMS = {
  DEN: { city: "Denver", nickname: "Broncos", abbr: "DEN", useNickname: false },
};

const qbStats = (o) => ({
  cmp: 0, att: 0, passYds: 0, passTd: 0, passInt: 0,
  car: 0, rushYds: 0, rushTd: 0,
  tgt: 0, rec: 0, recYds: 0, recTd: 0,
  fgm: 0, fga: 0, fgLong: 0, xpm: 0, xpa: 0,
  fumLost: 0,
  ...o,
});

const game = (o) => ({
  week: 1,
  dateMs: Date.UTC(2026, 8, 13, 20, 25),
  opp: TEAMS.DEN,
  homeAway: "home",
  result: { wlt: "W", teamScore: 20, oppScore: 10 },
  stats: qbStats({}),
  pts: 10,
  rank: 20,
  wasUnderdog: false,
  trailing2hBy10: false,
  started: true,
  usage: null,
  override: null,
  ...o,
});

const SEASON = {
  pos: "QB",
  ppg: (16.48 + 7.5 + 25.6) / 3, // 16.53 as the spec rounds it
  seasonRank: 17,
  lastName: "Brissett",
  avgAtt: 39.0,
  seasonEff: 652 / 117, // 5.6 to one decimal
  pastTense: false,
  updatedWeek: 3,
  updatedDateMs: Date.parse("2026-09-27T20:05Z"),
  hasOverrides: false,
  idSuffix: "",
};

/* ------------------------------------------------------------------ edges */

describe("edges", () => {
  test("unknown fumbles silence the clean-game claim instead of guessing", () => {
    // 0 INT but no player block in the box score: sentence 5 must not run.
    const g = game({
      week: 1,
      rank: 15,
      pts: 16,
      stats: qbStats({ cmp: 20, att: 30, passYds: 200, passTd: 1, fumLost: null }),
    });
    const note = mod.noteFor(g, SEASON, { max: 32, t1: 12, t2: 24 }, null);
    assert.ok(!note.includes("mistake-free"));
  });
});

/* ----------------------------------------------- second-half deficit math */

describe("trailing by 10 in the second half", () => {
  const td = (team, quarter) => ({
    quarter,
    clock: "7:00",
    team,
    type: "rush_td",
    yards: 1,
    pat: { type: "kick", result: "good" },
  });

  test("a 14-0 halftime hole counts, even if the second half is even", () => {
    assert.equal(mod.trailedBy10In2h([td("SF", 1), td("SF", 2)], "ARI"), true);
  });

  test("a 7-0 halftime game that stays close does not", () => {
    assert.equal(mod.trailedBy10In2h([td("SF", 1), td("ARI", 3)], "ARI"), false);
  });

  test("a lead lost by 10+ in the fourth counts", () => {
    assert.equal(
      mod.trailedBy10In2h([td("ARI", 1), td("SF", 3), td("SF", 4), td("SF", 4)], "ARI"),
      true,
    );
  });
});
