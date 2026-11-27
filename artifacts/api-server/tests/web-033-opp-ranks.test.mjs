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
import { importModule, importSource, cleanupBundles } from "./helpers/bundle.mjs";

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

/* ---------------------------------------------------------------------------
 * One fixed league through every surface (FPA audit item 1, 2026-11-27).
 *
 * The tests above pin the arithmetic. This one pins the plumbing: a fixed
 * season of RB points goes into the snapshot store, and the FPA page, the
 * Game Log's Difficulty cell and the Upcoming Matchups strip are each
 * rendered from what getFpaTable() reads back, in PPR, Half-PPR and
 * Standard. The database module is replaced by an in-memory stub (an esbuild
 * plugin), so the real read path runs: readFpaTable -> rankRows ->
 * FpaTableData -> fpaOppRanks / buildUpcoming / renderFpaPage.
 *
 * The league (32 clubs, six weeks) is a ladder with one club moved:
 *   GB   bye (5 games), 14.6 standard + 6 catches a game:
 *        PPR 20.6 = 10th (Favorable), Half 17.6 = 12th (Favorable),
 *        Standard 14.6 = 14th (Neutral). Season totals would rank it
 *        BELOW HOU (103 vs 115.2 PPR), so a totals rule fails here.
 *   HOU  no bye, 15.2 standard + 4 catches: PPR 19.2 = 13th (Neutral),
 *        Standard 15.2 = 12th (Favorable).
 * Eight clubs have a bye inside the six weeks, so games played are uneven.
 * ------------------------------------------------------------------------- */

const CLUBS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
];
const BYE_CLUBS = new Set(["ARI", "CAR", "DAL", "GB", "LA", "MIN", "NYJ", "SF"]);

/** Points-allowed rows, one RB row per defense-week, all three formats. */
function fixtureRows() {
  const rows = [];
  CLUBS.forEach((club, k) => {
    let std = 20 - 0.4 * k;
    let catches = 4;
    if (club === "GB") {
      std = 14.6;
      catches = 6;
    }
    const bye = BYE_CLUBS.has(club) ? (k % 6) + 1 : null;
    for (let week = 1; week <= 6; week++) {
      if (week === bye) continue;
      rows.push({
        season: 2026, week, seasonType: "REG", position: "RB",
        team: CLUBS[(k + week) % 32], defenseTeam: club, receptions: catches,
        points: { standard: std, half: std + catches / 2, ppr: std + catches },
      });
    }
  });
  return rows;
}

/** The snapshot rows an ingest would write for this league (no 2025 blend). */
function fixtureSnapshots(math, rows) {
  const out = [];
  const n = (v) => (Math.round(v * 100) / 100).toFixed(2);
  for (const format of ["standard", "half", "ppr"]) {
    for (const [abbr, def] of math.computeFpaTable(rows, format)) {
      out.push({
        season: 2026, weekNumber: 6, defenseTeamAbbr: abbr, defenseTeamName: abbr, scoringFormat: format,
        qbFpaRaw: "0.00", rbFpaRaw: n(def.byPos.RB.raw), wrFpaRaw: "0.00", teFpaRaw: "0.00", offFpaRaw: n(def.byPos.RB.raw),
        qbFpaAdj: "0.00", rbFpaAdj: n(def.byPos.RB.adj), wrFpaAdj: "0.00", teFpaAdj: "0.00", offFpaAdj: n(def.byPos.RB.adj),
        gamesPlayed: def.games, dataMode: "week_6", createdAt: new Date("2026-10-20T12:00:00Z"),
      });
    }
  }
  return out;
}

/** The database module and drizzle's operators, in memory. Only the snapshot table answers. */
const DB_STUB = `
export const __store = { snapshots: [] };
const table = (name) => new Proxy({}, { get: (_t, col) => (col === "__table" ? name : { table: name, col }) });
export const fpaSnapshots = table("snapshots");
export const fpaGames = table("games");
export const newsItems = table("news");
const match = (row, c) =>
  !c ? true
  : c.op === "and" ? c.args.every((a) => match(row, a))
  : c.op === "eq" ? row[c.col.col] === c.val
  : c.op === "ne" ? row[c.col.col] !== c.val
  : c.op === "lte" ? row[c.col.col] <= c.val
  : true;
function query() {
  let from = null;
  const conds = [];
  const chain = {
    from(t) { from = t.__table; return chain; },
    where(c) { conds.push(c); return chain; },
    groupBy() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    then(resolve) {
      resolve(from === "snapshots" ? __store.snapshots.filter((r) => conds.every((c) => match(r, c))) : []);
    },
  };
  return chain;
}
export const db = { select: () => query(), selectDistinct: () => query() };
`;
const DRIZZLE_STUB = `
export const and = (...args) => ({ op: "and", args });
export const eq = (col, val) => ({ op: "eq", col, val });
export const ne = (col, val) => ({ op: "ne", col, val });
export const lte = (col, val) => ({ op: "lte", col, val });
export const desc = (col) => ({ op: "desc", col });
export const sql = () => ({ op: "sql" });
`;
const stubPlugin = {
  name: "web-033-db-stub",
  setup(build) {
    build.onResolve({ filter: /^\.\.?\/(.*\/)?db$/ }, () => ({ path: "db", namespace: "web033-stub" }));
    build.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "drizzle", namespace: "web033-stub" }));
    build.onLoad({ filter: /.*/, namespace: "web033-stub" }, (args) => ({
      contents: args.path === "db" ? DB_STUB : DRIZZLE_STUB,
      loader: "js",
    }));
  },
};

const ord = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

describe("one fixed league: FPA page, Game Log and Upcoming Matchups print the same rank and band", () => {
  let m;
  const GAMELOG_OPPS = ["GB", "HOU", "ARI", "WAS"]; // weeks 1-4
  const UPCOMING_OPPS = ["GB", "HOU", "MIN", "ARI"]; // weeks 7-10
  const EXPECTED = {
    ppr: { GB: 10, HOU: 13, ARI: 1, WAS: 32, MIN: 21 },
    half: { GB: 12, HOU: 13 },
    standard: { GB: 14, HOU: 12, ARI: 1, WAS: 32, MIN: 21 },
  };

  before(async () => {
    m = await importSource(
      `export * as fpaData from "../src/lib/fpa/fpa-data";
       export * as upcoming from "../src/lib/player/upcoming";
       export * as math from "../src/lib/fpa/math";
       export * as bands from "../src/lib/fpa/matchup-bands";
       export * as ranks from "../src/lib/player/ranks";
       export * as fpaRender from "../src/lib/fpa-render";
       export * as glp from "../src/lib/player/gamelog-premium";
       export * as bkp from "../src/lib/player/breakdown-premium";
       export * as header from "../src/lib/player/header";
       export { __store } from "../src/lib/db";`,
      { plugins: [stubPlugin] },
    );
    m.__store.snapshots = fixtureSnapshots(m.math, fixtureRows());
    m.fpaData.invalidateFpaTableCache();
    m.upcoming.resetMatchupTableCache();
  });

  /** RB rank and tier per club, from the rendered FPA page. */
  const fpaPageRanks = (html) => {
    const out = {};
    for (const row of html.matchAll(/<tr class="scf-row" data-team="([A-Z]+)">([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[2].matchAll(/<td class="scf-cell" data-tier="([a-z0-9-]+)"[\s\S]*?<span class="scf-rank">(\d+)<\/span>/g)];
      out[row[1]] = { rank: Number(cells[1][2]), tier: cells[1][1] }; // QB, RB, WR, TE
    }
    return out;
  };

  const renderSurfaces = async (format) => {
    const table = await m.upcoming.matchupTable(format);
    assert.ok(table, `${format}: the table reads back from the stub`);
    assert.equal(table.format, format);
    const page = fpaPageRanks(m.fpaRender.renderFpaPage(table, { embed: true }, { teaser: null }));

    const log = m.ranks.attachOppRanks(
      GAMELOG_OPPS.map((opp, i) => ({
        week: i + 1, opp, game_status: "active",
        stats: { rush_att: 10, rush_yd: 50, pts_ppr: 10, pts_half_ppr: 10, pts_std: 10, gp: 1 },
      })),
      "RB",
      m.ranks.fpaOppRanks(table.rows),
      "fpa-current",
    );
    const now = Date.parse("2026-10-21T12:00:00Z");
    const upcomingGames = m.upcoming.buildUpcoming({
      position: "RB",
      schedule: {
        games: UPCOMING_OPPS.map((opp, i) => ({
          week: 7 + i, status: "scheduled", kickoffMs: now + (i + 1) * 7 * 864e5, timeConfirmed: true,
          homeAway: i % 2 ? "away" : "home", opponent: null, opponentName: opp,
        })),
      },
      fpa: table,
      now,
    });
    const data = {
      player: { name: "Fixture Back", position: "RB" }, format, season: 2026, logSeason: 2026, logSeasons: [2026],
      seasonLog: log, gameLog: log, logOppRankThrough: table.dataMode, upcoming: upcomingGames, upcomingMatchupMode: table.dataMode,
    };
    const glpHtml = m.glp.renderGameLogPremium(data, {
      logSrc: "", layout: { columns: [], scored: false, span: 5 }, summary: null, averages: null,
      cell: () => "", score: () => "", points: () => 10, dnp: () => ({ label: "Bye week", href: null }), detail: () => "",
      fpaLink: "Fantasy Points Allowed page", difficultyWord: m.bands.BAND_WORDS, ordinal: ord, num: (v) => String(v),
    });
    const bkpHtml = m.bkp.renderBreakdownPremium(data, {
      matchupHref: () => null, kickoff: () => "Sun", ordinal: ord, outlookHref: null, teamName: "Fixture",
      bandRead: Object.fromEntries(Object.entries(m.bands.BAND_WORDS).map(([b, w]) => [b, `${w} matchup`])),
      allowedLink: "fantasy points allowed",
    });
    const gamelog = {};
    for (const c of glpHtml.matchAll(/<span class="scp-glp-diff" data-band="(\w+)" title="([A-Z]+) ranks (\d+)\w\w in ([^"]*?)"><b>(\d+)\w\w<\/b><span>(\w+)<\/span>/g)) {
      gamelog[c[2]] = { band: c[1], titleRank: Number(c[3]), scope: c[4], rank: Number(c[5]), word: c[6] };
    }
    const strip = {};
    for (const c of bkpHtml.matchAll(/scp-bkp-nx-code">([A-Z]+)<\/b>[\s\S]*?nx-rank"><b data-band="(\w+)">(\d+)\w\w<\/b>[\s\S]*?scp-bkp-pill" data-band="\w+">(\w+)</g)) {
      strip[c[1]] = { band: c[2], rank: Number(c[3]), word: c[4] };
    }
    return { table, page, gamelog, strip, glpHtml, bkpHtml };
  };

  const tierBand = (tier) => (tier === "mid" ? "mid" : tier.startsWith("soft") ? "soft" : "tough");

  for (const format of ["ppr", "half", "standard"]) {
    test(`${format}: every Difficulty cell and strip row equals the FPA page's RB rank and band`, async () => {
      const { page, gamelog, strip, glpHtml, bkpHtml } = await renderSurfaces(format);
      const label = { ppr: "PPR", half: "Half-PPR", standard: "Standard" }[format];
      for (const [club, rank] of Object.entries(EXPECTED[format])) {
        assert.equal(page[club].rank, rank, `${format} ${club}: FPA page rank`);
      }
      assert.deepEqual(Object.keys(gamelog), GAMELOG_OPPS, `${format}: one Difficulty cell per game`);
      assert.deepEqual(Object.keys(strip), UPCOMING_OPPS, `${format}: one strip row per fixture`);
      for (const [club, cell] of Object.entries(gamelog)) {
        assert.equal(cell.rank, page[club].rank, `${format} ${club}: game log rank = FPA page`);
        assert.equal(cell.titleRank, cell.rank);
        assert.equal(cell.band, tierBand(page[club].tier), `${format} ${club}: game log band = FPA page tier`);
        assert.equal(cell.word, m.bands.BAND_WORDS[cell.band]);
        assert.match(cell.scope, new RegExp(`^${label} fantasy points allowed per game to RBs through Week 6`));
      }
      for (const [club, row] of Object.entries(strip)) {
        assert.equal(row.rank, page[club].rank, `${format} ${club}: upcoming rank = FPA page`);
        assert.equal(row.band, tierBand(page[club].tier), `${format} ${club}: upcoming band = FPA page tier`);
        assert.equal(row.word, m.bands.BAND_WORDS[row.band]);
      }
      assert.match(glpHtml, new RegExp(`Difficulty is each defense's current rank in ${label} fantasy points allowed per game to RBs`));
      assert.match(glpHtml, /Favorable 1-12, Neutral 13-20, Tough 21-32\./);
      assert.match(
        bkpHtml,
        new RegExp(`per game to RBs, in ${label}: 1st allows the most, 32nd the fewest\\. Measured through Week 6, the same ranks as the Difficulty column above\\.`),
      );
    });
  }

  test("the format moves GB and HOU across the 12/13 line, the same way on both player surfaces", async () => {
    const ppr = await renderSurfaces("ppr");
    const std = await renderSurfaces("standard");
    assert.deepEqual(
      [ppr.gamelog.GB.word, ppr.strip.GB.word, std.gamelog.GB.word, std.strip.GB.word],
      ["Favorable", "Favorable", "Neutral", "Neutral"],
    );
    assert.deepEqual(
      [ppr.gamelog.HOU.word, ppr.strip.HOU.word, std.gamelog.HOU.word, std.strip.HOU.word],
      ["Neutral", "Neutral", "Favorable", "Favorable"],
    );
  });

  test("a bye is not a game: GB averages over its 5, so it ranks ahead of HOU (totals would not)", async () => {
    const { table } = await renderSurfaces("ppr");
    const gb = table.rows.find((r) => r.abbr === "GB");
    const hou = table.rows.find((r) => r.abbr === "HOU");
    assert.equal(gb.gamesPlayed, 5);
    assert.equal(hou.gamesPlayed, 6);
    assert.equal(gb.byPos.RB.fpa, 20.6);
    assert.ok(gb.byPos.RB.rank < hou.byPos.RB.rank, "per game GB is ahead of HOU; by season totals it would be behind (103 vs 115.2)");
  });

  test("the bare FPA table is the PPR table", async () => {
    const bare = await m.fpaData.getFpaTable({});
    const ppr = await m.fpaData.getFpaTable({ format: "ppr", view: "raw" });
    assert.equal(bare.format, "ppr");
    assert.deepEqual(bare.rows.map((r) => [r.abbr, r.byPos.RB.rank]), ppr.rows.map((r) => [r.abbr, r.byPos.RB.rank]));
  });

  test("latent path 2: an ingest reaches the player page at once (no second 10-minute cache)", async () => {
    const was = async () => (await m.upcoming.matchupTable("ppr")).rows.find((r) => r.abbr === "WAS").byPos.RB.rank;
    assert.equal(await was(), 32);
    const saved = m.__store.snapshots;
    // A new ingest in which WAS allows the most.
    m.__store.snapshots = saved.map((s) =>
      s.defenseTeamAbbr === "WAS" ? { ...s, rbFpaRaw: "40.00", createdAt: new Date("2026-10-27T12:00:00Z") } : s,
    );
    m.fpaData.invalidateFpaTableCache(); // what every ingest does when it commits
    try {
      assert.equal(await was(), 1, "matchupTable reads through getFpaTable's memo, not a cache of its own");
    } finally {
      m.__store.snapshots = saved;
      m.fpaData.invalidateFpaTableCache();
    }
  });

  test("latent path 1: the player page's render key carries the FPA table version", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../src/lib/player/player-data.ts", import.meta.url), "utf8");
    const key = src.slice(src.indexOf("export function playerDataVersion("));
    assert.match(key.slice(0, 2500), /data\.fpaStamp,/, "playerDataVersion includes fpaStamp");
    assert.match(src, /fpaStamp: \[fpaTable\?\.version/, "fpaStamp starts with the live table's version");
  });

  test("the header chip says the same three words, lowercased", () => {
    for (const band of ["soft", "mid", "tough"]) {
      assert.equal(m.header.CHIP_WORD[band].word, m.bands.BAND_WORDS[band].toLowerCase());
    }
  });
});
