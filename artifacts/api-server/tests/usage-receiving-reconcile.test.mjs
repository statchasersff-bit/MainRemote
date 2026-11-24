/**
 * Team Usage receiving yards = the player pages' game-log receiving yards
 * (mak's WEB-042 follow-up, 2026-11-24).
 *
 * The failure: Jahmyr Gibbs, DET 2026, Weeks 1-10 (nine games): Usage 375,
 * player hub / Stats / Game Log 384. Cause: on 2026_04_DET_CAR play 4069
 * St. Brown caught a 4-yard pass and lateraled to Gibbs for 9. nflverse puts
 * those 9 yards in lateral_receiving_yards, not receiving_yards; the official
 * box score (and Sleeper) credit them to Gibbs. The builder skipped lateral
 * yards until 2026-11-19 (11 pairs league-wide, Deebo Samuel -80 the largest).
 *
 * scripts/team/reconcileUsageReceiving.mjs is the full check (per game with
 * --pbp); this file pins the rule and the committed data.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { APP_DIR } from "./helpers/server.mjs";
import { receivingCredits } from "../scripts/team/buildUsage.mjs";
import { reconcile, pbpByGame, firstDifferingGame } from "../scripts/team/reconcileUsageReceiving.mjs";

const GIBBS = "00-0039139";
const ST_BROWN = "00-0036963";
// 2026_04_DET_CAR play 4069, the fields the rule reads.
const lateralPlay = {
  game_id: "2026_04_DET_CAR",
  play_id: "4069",
  week: "4",
  posteam: "DET",
  play_type: "pass",
  pass_attempt: "1",
  sack: "0",
  complete_pass: "1",
  passer_player_id: "00-0033106",
  receiver_player_id: ST_BROWN,
  receiving_yards: "4",
  lateral_receiver_player_id: GIBBS,
  lateral_receiving_yards: "9",
  desc: "J.Goff pass short right to A.St. Brown for 4 yards. Lateral to J.Gibbs for 9 yards.",
};

describe("Usage receiving yards reconcile with the game logs", () => {
  test("a lateral's yards go to the player who took it, the catch's to the catcher (DET 2026 wk 4)", () => {
    const credits = receivingCredits(lateralPlay);
    assert.deepEqual(
      credits.map((c) => [c.id, c.yards, c.lateral]),
      [
        [ST_BROWN, 4, false],
        [GIBBS, 9, true],
      ],
    );
    // An incompletion or a sack credits no catch yards.
    assert.deepEqual(receivingCredits({ ...lateralPlay, complete_pass: "0", lateral_receiver_player_id: "NA" }), []);
    assert.deepEqual(receivingCredits({ ...lateralPlay, sack: "1", lateral_receiver_player_id: "NA" }), []);
  });

  test("the pre-fix Gibbs gap (375 vs 384) is classified as a stale lateral snapshot, first differing in Week 4", () => {
    const weeks = [1, 2, 3, 4, 5, 7, 8, 9, 10];
    const logYds = { 1: 30, 2: 61, 3: 65, 4: 31, 5: 56, 7: 27, 8: 15, 9: 0, 10: 99 };
    const plays = weeks.map((w) =>
      w === 4
        ? { ...lateralPlay, receiver_player_id: GIBBS, receiving_yards: "22", lateral_receiver_player_id: "NA" }
        : { ...lateralPlay, play_id: "1", week: String(w), game_id: `2026_${w}`, receiver_player_id: GIBBS, receiving_yards: String(logYds[w]), lateral_receiver_player_id: "NA" },
    );
    plays.push(lateralPlay);
    const usage = {
      throughWeek: 10,
      teams: { det: { games: weeks, players: [{ id: GIBBS, name: "Jahmyr Gibbs", pos: "RB", sleeperId: "9221", targets: 53, receptions: 41, recYards: 375 }] } },
    };
    const logs = { 9221: weeks.map((w) => ({ week: w, team: "DET", stats: { rec_yd: logYds[w], rec: 1 } })) };
    const [pair] = reconcile({ usage, logs, pbp: pbpByGame(plays) });
    assert.equal(pair.logSum, 384);
    assert.equal(pair.diff, -9);
    assert.deepEqual(pair.causes, ["usage-stale-lateral"]);
    assert.equal(firstDifferingGame(pair)?.week, 4);
    // Rebuilt with laterals, the same plays give the log's 384.
    assert.equal(pair.games.reduce((s, g) => s + g.pbp, 0), 384);
  });

  test("committed data: every club/player pair's Usage receiving yards equal its game-log sum over the club's games", () => {
    const season = fs
      .readdirSync(path.join(APP_DIR, "data", "team"))
      .filter((f) => /^usage_\d{4}\.json$/.test(f))
      .map((f) => Number(f.slice(6, 10)))
      .sort()
      .pop();
    const read = (...p) => JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", ...p), "utf8"));
    const usage = read("team", `usage_${season}.json`);
    const logs = read("player", "game_logs", `${season}.json`);
    const players = read("player", "players.json");
    const pairs = reconcile({ usage, logs, players });
    assert.ok(pairs.length > 400, `only ${pairs.length} pairs`);
    const off = pairs.filter((p) => p.status !== "match").map((p) => `${p.club} ${p.name}: Usage ${p.usage} vs logs ${p.logSum} (${p.status})`);
    assert.deepEqual(off, [], "run scripts/team/reconcileUsageReceiving.mjs --pbp <dir> for causes");
    const gibbs = pairs.find((p) => p.gsis === GIBBS && p.club === "det");
    assert.ok(gibbs && gibbs.usage === gibbs.logSum);
  });
});
