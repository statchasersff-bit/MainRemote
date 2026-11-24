/**
 * PPG position rank: one calculation for the player page, the player index
 * and the matchup preview (2026-11-24).
 *
 * The bug: a Bears-Saints preview printed Luther Burden III as WR19 at 15.1
 * PPG while his player page printed WR17 at 15.1. The preview ranked the
 * nflverse usage feed's rounded fpPerGame over a 2-game minimum; the page
 * ranked the Sleeper game logs over four games. Mike Evans (usage 15.8,
 * logs 14.83) and Omar Cooper Jr. (usage 15.7, logs 10.43) sat above him only
 * in the feed. The fixture below rebuilds that shape from the stored week-10
 * numbers.
 */

import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/bundle.mjs";

let ranks;
let preview;

before(async () => {
  ranks = await importModule("lib/player/ranks");
  preview = await importModule("lib/matchup/preview");
});

const SEASON = 2026;

/** A logged game with a touch, scoring `ppr` PPR points and `rec` catches. */
const game = (week, ppr, rec = 0) => ({
  week,
  season: SEASON,
  game_status: "active",
  stats: { off_snp: 40, rec_tgt: rec + 1, rec, pts_ppr: ppr, pts_half_ppr: ppr - rec / 2, pts_std: ppr - rec },
});

/** `n` games that total exactly `total` points. */
const games = (n, total, rec = 0) => {
  const each = Math.round((total / n) * 100) / 100;
  const out = Array.from({ length: n }, (_, i) => game(i + 1, each, rec));
  out[n - 1].stats.pts_ppr = Math.round((total - each * (n - 1)) * 100) / 100;
  return out;
};

const player = (id, name, position = "WR") => ({ id, name, slug: id, position, team: "CHI" });

const usagePlayer = (sleeperId, name, fpPerGame, g, receptions = 0, pos = "WR") => ({
  id: `gsis-${sleeperId}`,
  sleeperId,
  name,
  slug: sleeperId,
  pos,
  games: g,
  fpPerGame,
  receptions,
});

describe("ppgPositionTable: the shared rules", () => {
  const players = [
    player("a", "A"),
    player("b", "B"),
    player("c", "C"),
    player("d", "D"),
    player("e", "E"),
    player("t", "T", "TE"),
  ];
  const logs = {
    // a and b tie at exactly 15.0 a game (60 over 4, 75 over 5).
    a: games(4, 60),
    b: games(5, 75),
    c: games(4, 59.6), // 14.9
    // d has the best rate and only three games: ineligible.
    d: games(3, 90),
    // e logged a week with no touch, which is not a game.
    e: [...games(4, 40), { week: 9, season: SEASON, game_status: "inactive", stats: { pts_ppr: 0 } }],
    // A tight end never enters the WR pool.
    t: games(6, 120),
  };

  test("ties share the better rank and the next rank skips", () => {
    const table = ranks.ppgPositionTable(logs, players, "WR", "ppr");
    assert.deepEqual(
      table.ranked.map((r) => [r.id, r.rank]),
      [
        ["a", 1],
        ["b", 1],
        ["c", 3],
        ["e", 4],
      ],
    );
  });

  test("an ineligible player keeps his rate and has no rank", () => {
    const table = ranks.ppgPositionTable(logs, players, "WR", "ppr");
    const d = table.byId.get("d");
    assert.equal(d.rank, null);
    assert.equal(d.games, 3);
    assert.equal(d.ppg, 30);
    assert.ok(!table.ranked.some((r) => r.id === "d"));
  });

  test("a week without a touch is not a game", () => {
    assert.equal(ranks.ppgPositionTable(logs, players, "WR", "ppr").byId.get("e").games, 4);
  });

  test("the player index standings print the same ranks", () => {
    ranks.resetRankCaches();
    const st = ranks.buildSeasonStandings(1999, logs, players, "ppr");
    assert.deepEqual(st.byId.get("a"), { rank: 1, value: 15, measure: "ppg", games: 4 });
    assert.equal(st.byId.get("b").rank, 1);
    assert.equal(st.byId.get("c").rank, 3);
    // Under the minimum the index falls back to the points table, as before.
    assert.equal(st.byId.get("d").measure, "total");
  });

  test("the preview league ranks the same pool, and has no rank for the ineligible", () => {
    const league = preview.buildLeague(SEASON, "ppr", { logs, players });
    const u = (id) => usagePlayer(id, id.toUpperCase(), 99, 9);
    assert.equal(league.rankOf(u("a")), 1);
    assert.equal(league.rankOf(u("b")), 1);
    assert.equal(league.rankOf(u("c")), 3);
    assert.equal(league.rankOf(u("d")), null);
    // The PPG beside the rank is the rank's own figure, not the feed's 99.
    assert.equal(Math.round(league.ppgOf(u("c")) * 100) / 100, 14.9);
    // Labeled with another position than his own: no rank rather than a wrong one.
    assert.equal(league.rankOf(usagePlayer("t", "T", 20, 6, 0, "WR")), null);
  });
});

describe("the Burden WR19 / WR17 mismatch (week-10 fixture)", () => {
  // The week-10 WR table from Zay Flowers down, with the two feed outliers.
  const rows = [
    // id, name, log games, log total, usage fpPerGame, usage games
    ["14", "Zay Flowers", 9, 138.87, 15.4, 9],
    ["15", "Parker Washington", 9, 137.79, 15.3, 9],
    ["16", "Malik Nabers", 9, 137.16, 15.2, 9],
    ["12519", "Luther Burden III", 9, 136.26, 15.1, 9],
    ["2216", "Mike Evans", 6, 88.98, 15.8, 6],
    ["13276", "Omar Cooper Jr.", 6, 62.6, 15.7, 6],
  ];
  // Thirteen receivers above them all, the same in both sources.
  const top = Array.from({ length: 13 }, (_, i) => [`top${i}`, `Top ${i}`, 9, 9 * (30 - i), 30 - i, 9]);
  const all = [...top, ...rows];
  const players = all.map(([id, name]) => player(id, name));
  const logs = Object.fromEntries(all.map(([id, , g, total]) => [id, games(g, total)]));
  const usage = Object.fromEntries(all.map(([id, name, , , fp, g]) => [id, usagePlayer(id, name, fp, g)]));

  test("the old usage-feed ranking reproduces WR19", () => {
    // buildLeague as it stood before 2026-11-24: usage fpPerGame, 2-game minimum.
    const pool = Object.values(usage)
      .filter((p) => p.games >= 2)
      .sort((x, y) => y.fpPerGame - x.fpPerGame);
    assert.equal(pool.findIndex((p) => p.sleeperId === "12519") + 1, 19);
  });

  test("the player page's table puts him at WR17", () => {
    const table = ranks.ppgPositionTable(logs, players, "WR", "ppr");
    const row = table.byId.get("12519");
    assert.equal(row.rank, 17);
    assert.equal(row.ppg.toFixed(1), "15.1");
  });

  test("the preview now prints the page's WR17 and 15.1", () => {
    const league = preview.buildLeague(SEASON, "ppr", { logs, players });
    assert.equal(league.rankOf(usage["12519"]), 17);
    assert.equal(league.ppgOf(usage["12519"]).toFixed(1), "15.1");
    assert.equal(league.rankOf(usage["2216"]), 18);
    // Evans' feed figure no longer outranks him; the logs' 14.83 does not.
    assert.ok(league.ppgOf(usage["2216"]) < league.ppgOf(usage["12519"]));
  });

  test("the same in half PPR and standard", () => {
    for (const [fmt, pageFmt] of [
      ["half", "half"],
      ["std", "standard"],
    ]) {
      const league = preview.buildLeague(SEASON, fmt, { logs, players });
      const table = ranks.ppgPositionTable(logs, players, "WR", pageFmt);
      for (const [id] of all) assert.equal(league.rankOf(usage[id]), table.byId.get(id).rank, `${fmt} ${id}`);
    }
  });
});
