/**
 * WEB-033 (2026-11-26): one matchup-difficulty calculation on the player pages.
 *
 * The Game Log's Difficulty column, its per-week panel and the upcoming
 * strip read the FPA table (fpa-data.ts) the Fantasy Points Allowed page
 * prints; a finished season the FPA archive does not hold falls back to the
 * same arithmetic over the stored logs. These tests pin that arithmetic with
 * clubs that have played unequal games, so a switch to season totals (or to
 * an average of single player lines) fails, and pin the tie rule, the
 * unavailable state, the labels and the format-carrying FPA link.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let ranks, math, bands;
before(async () => {
  ranks = await importModule("lib/player/ranks");
  math = await importModule("lib/fpa/math");
  bands = await importModule("lib/fpa/matchup-bands");
});
after(cleanupBundles);

/** One RB line worth `pts` PPR points (rushing yards only). */
const line = (week, opp, pts) => ({
  week,
  opp,
  stats: { rush_att: 1, rush_yd: pts * 10, pts_ppr: pts, pts_half_ppr: pts, pts_std: pts, gp: 1 },
});

/*
 * Three defenses, chosen so the three candidate rules give three different
 * orders:
 *   AAA  2 games, one back, 22 a game   total 44  per game 22  per line 22
 *   BBB  3 games, one back, 16 a game   total 48  per game 16  per line 16
 *   CCC  2 games, two backs 10 + 10     total 40  per game 20  per line 10
 * Per game (the FPA rule): AAA 1, CCC 2, BBB 3.
 * Season totals:            BBB 1, AAA 2, CCC 3.
 * Per player line:          AAA 1, BBB 2, CCC 3.
 */
const players = [
  { id: "r1", position: "RB", team: "XXX" },
  { id: "r2", position: "RB", team: "YYY" },
  { id: "r3", position: "RB", team: "YYY" },
];
const logs = {
  r1: [line(1, "AAA", 22), line(2, "AAA", 22), line(3, "BBB", 16), line(4, "BBB", 16), line(5, "BBB", 16)],
  r2: [line(1, "CCC", 10), line(2, "CCC", 10)],
  r3: [line(1, "CCC", 10), line(2, "CCC", 10)],
};

describe("game-log fallback ranks use the FPA arithmetic (per game, team totals)", () => {
  test("unequal games played: ranked per game, not by totals or per player line", () => {
    const map = ranks.buildOppRanks(1999, logs, players, "ppr");
    assert.deepEqual(
      ["AAA", "CCC", "BBB"].map((t) => map.get(`${t}:RB`)),
      [1, 2, 3],
      "per-game team totals; totals would put BBB 1st, per-line averages CCC 3rd",
    );
  });

  test("the FPA table's raw figure is per game too, and ranks the same way", () => {
    const rows = [];
    for (const [id, entries] of Object.entries(logs)) {
      for (const e of entries) {
        rows.push({
          season: 1999, week: e.week, seasonType: "REG", position: "RB",
          team: id === "r1" ? "XXX" : "YYY", defenseTeam: e.opp, receptions: 0,
          points: { standard: e.stats.pts_ppr, half: e.stats.pts_ppr, ppr: e.stats.pts_ppr },
        });
      }
    }
    const table = math.computeFpaTable(rows, "ppr");
    const teams = ["AAA", "BBB", "CCC"];
    const values = teams.map((t) => table.get(t).byPos.RB.raw);
    assert.deepEqual(values, [22, 16, 20]);
    assert.deepEqual(table.get("BBB").games, 3);
    const order = math.rankFpaValues(teams.map((t, i) => ({ team: t, value: values[i] })));
    assert.deepEqual(order, [1, 3, 2], "AAA 1st, CCC 2nd, BBB 3rd, as the game log ranks them");
  });

  test("ties rank by team code, whatever order the rows arrive in", () => {
    const a = math.rankFpaValues([{ team: "TB", value: 7.93 }, { team: "MIN", value: 7.93 }, { team: "NE", value: 9 }]);
    const b = math.rankFpaValues([{ team: "MIN", value: 7.93 }, { team: "NE", value: 9 }, { team: "TB", value: 7.93 }]);
    assert.deepEqual(a, [3, 2, 1]);
    assert.deepEqual(b, [2, 1, 3]);
  });
});

describe("labels and the unavailable state", () => {
  test("the scope names position, format, per game and the cutoff", () => {
    const base = { position: "RB", formatLabel: "PPR", season: 2026 };
    assert.equal(
      bands.oppRankScope({ ...base, source: "fpa-current", through: "Week 11" }),
      "PPR fantasy points allowed per game to RBs through Week 11",
    );
    assert.equal(
      bands.oppRankScope({ ...base, season: 2025, source: "fpa-archive", through: "Week 17" }),
      "PPR fantasy points allowed per game to RBs in 2025 (Weeks 1-17)",
    );
    assert.equal(
      bands.oppRankScope({ ...base, season: 2024, source: "gamelog", through: null }),
      "PPR fantasy points allowed per game to RBs in 2024 (full season)",
    );
  });

  test("no FPA table for the current season: no rank, never a second calculation", () => {
    const log = ranks.attachOppRanks([line(1, "AAA", 22)], "RB", new Map(), "unavailable");
    assert.equal(log[0].opp_rank_vs_pos, null);
    assert.equal(log[0].opp_rank_source, "unavailable");
  });

  test("the FPA link opens the page's format: PPR is the bare page, others name themselves", () => {
    assert.equal(bands.fpaFormatHref("/fpa", "ppr"), "/fpa");
    assert.equal(bands.fpaFormatHref("/fpa?embed=1", "ppr"), "/fpa?embed=1");
    assert.equal(bands.fpaFormatHref("/fpa", "half"), "/fpa?format=half");
    assert.equal(bands.fpaFormatHref("/fpa?embed=1", "standard"), "/fpa?embed=1&format=standard");
    assert.equal(
      bands.fpaFormatHref("https://statchasers.com/nfl/fantasy-points-allowed-by-position/", "half"),
      "https://statchasers.com/nfl/fantasy-points-allowed-by-position/?format=half",
    );
  });
});

describe("the FPA page opens in PPR (mak, 2026-11-26)", () => {
  test("the default format is PPR, in one constant both halves read", async () => {
    const blend = await importModule("lib/fpa/blend");
    assert.equal(blend.DEFAULT_FPA_FORMAT, "ppr");
  });

  test("bare /fpa is PPR, ?format=half and standard still work, PPR is the pressed default", async () => {
    const { startServer } = await import("./helpers/server.mjs");
    const srv = await startServer({ SC_LIVE_WARM: "0", SC_EDGE_PREFETCH: "0", SC_WATCHDOG: "0" });
    try {
      const bare = await (await fetch(`${srv.origin}/embed/fpa`)).text();
      if (!/data-scf-root/.test(bare)) return; // nothing ingested in this database
      assert.match(bare, /data-format="ppr"/);
      assert.match(bare, /PPR scoring, raw view/);
      // The controls are buttons since WEB-020 (2026-11-27): no ?format= href.
      assert.match(bare, /<button type="button" class="scf-opt is-active" data-scf-format="ppr"[^>]*aria-pressed="true"/);
      assert.match(bare, /data-default-format="ppr"/);
      assert.doesNotMatch(bare, /href="[^"]*\?format=/);
      const ppr = await (await fetch(`${srv.origin}/embed/fpa?format=ppr`)).text();
      assert.equal(ppr.replace(/\s+/g, " "), bare.replace(/\s+/g, " "), "?format=ppr is the bare page");
      for (const f of ["half", "standard"]) {
        const html = await (await fetch(`${srv.origin}/embed/fpa?format=${f}`)).text();
        assert.match(html, new RegExp(`data-format="${f}"`));
      }
    } finally {
      await srv.stop();
    }
  });
});
