/**
 * "Through Week N" in player copy names the week his club has completed, not
 * the league's highest logged week.
 *
 * The defect (SEO investigation, 2026-11-20): after the Week 11 Thursday game
 * was ingested, leagueWeek read 11 for everyone, and every player's Stats FAQ
 * (visible and in FAQPage JSON-LD) said "through Week 11" while the same page
 * said "Through Week 10" - including players whose club had not played.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

after(cleanupBundles);

const phase = await importModule("lib/player/season-phase");
const pools = await importModule("lib/player/faq-pools");

const game = (week) => ({ week, homeAway: "home", opponent: null, opponentCode: "TEN", opponentName: "Titans", kickoffMs: null, timeConfirmed: false, matchup: null });

test("club yet to play the week in progress: through the week before", () => {
  assert.equal(phase.statsThroughWeek({ leagueWeek: 11, upcoming: [game(11), game(12)] }), 10);
});

test("club that played Thursday: through the week in progress", () => {
  assert.equal(phase.statsThroughWeek({ leagueWeek: 11, upcoming: [game(12)] }), 11);
});

test("never past the league's logged week (a bye does not run ahead)", () => {
  assert.equal(phase.statsThroughWeek({ leagueWeek: 10, upcoming: [game(13)] }), 10);
});

test("no next game (season over, or no schedule): the league week stands", () => {
  assert.equal(phase.statsThroughWeek({ leagueWeek: 18, upcoming: [] }), 18);
  assert.equal(phase.statsThroughWeek({ leagueWeek: 7 }), 7);
});

test("before Week 1: zero, so the copy drops the clause", () => {
  assert.equal(phase.statsThroughWeek({ leagueWeek: 0, upcoming: [game(1)] }), 0);
});

test("the Stats FAQ answer uses the club's completed week", () => {
  const week = (w, extra = {}) => ({
    week: w, opp: "PHI", team: "DAL", game_status: "active",
    stats: { pts_ppr: 15, rec: 5, rec_tgt: 8, rec_yd: 70, rec_td: 1, gp: 1, off_snp: 50, tm_off_snp: 60, ...extra },
  });
  const log = Array.from({ length: 9 }, (_, i) => week(i + 1));
  const data = {
    season: 2026, leagueSeason: 2026, leagueWeek: 11, format: "ppr",
    player: { name: "Test Receiver", slug: "test-receiver", position: "WR", team: "DAL" },
    gameLog: log, upcoming: [game(11)], schedule: [],
    production: [],
    statsProfile: { career: [], current: { season: 2026, gamesPlayed: 9, points: 147.8, ppg: 16.4, totals: { rec: 45, tgt: 72, recYd: 630, recTd: 9 } } },
  };
  let out;
  try {
    out = pools.statsPool(data, { embed: false });
  } catch (err) {
    // The pool reads more of PlayerPageData than this fixture builds; the
    // helper tests above pin the rule. Surface the gap rather than pass.
    assert.fail(`statsPool threw on the minimal fixture: ${err.message}`);
  }
  const text = out.map((c) => c.a).join(" ");
  assert.match(text, /through Week 10\b/);
  assert.doesNotMatch(text, /through Week 11\b/);
});
