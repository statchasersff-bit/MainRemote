/**
 * Phase 1 data accuracy (the 2026-11-18 site audit: WEB-030 to WEB-036, WEB-039).
 *
 * Golden fixtures are the November 18 snapshot, stored under
 * tests/fixtures/audit-2026-11-18/ - never today's live totals, which move
 * every week. The "same snapshot" tests at the end read the live data dir and
 * assert only that two components agree with each other, not any number.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";
import * as jsRules from "../scripts/scoring/house-rules.mjs";
import { coverage as builderCoverage } from "../scripts/player-stats/coverage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "audit-2026-11-18");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const LOGS = read("game-logs.json").logs;
const INJ = read("injuries.json");
const PRACTICE = read("practice-bears.json");
const TABLES = read("stats-tables.json");
const SLATE_CSV = fs.readFileSync(path.join(FIX, "slate-2026.csv"), "utf8");

const ASB = "7547", GIBBS = "9221", LAMAR = "4881", HERBERT = "6797", COUSINS = "1166", BURDEN = "12519", PACHECO = "8205";

let rules, scoring, matchupPts, nflverse, coverageTs, availability, status, missed, bands, fpaRender, outlookCtx, rounding, ranks, teams, statsRender, statsData;
before(async () => {
  rules = await importModule("lib/scoring/house-rules");
  scoring = await importModule("lib/player/scoring");
  matchupPts = await importModule("lib/matchup/fantasy-points");
  nflverse = await importModule("lib/fpa/nflverse");
  coverageTs = await importModule("lib/data-coverage");
  availability = await importModule("lib/matchup/availability");
  status = await importModule("lib/player/current-status");
  missed = await importModule("lib/player/games-missed");
  bands = await importModule("lib/fpa/matchup-bands");
  fpaRender = await importModule("lib/fpa-render");
  outlookCtx = await importModule("lib/player/outlook-context");
  rounding = await importModule("lib/player/rounding");
  ranks = await importModule("lib/player/ranks");
  teams = await importModule("lib/team/teams");
  statsRender = await importModule("lib/player-stats-render");
  statsData = await importModule("lib/player-stats/stats-data");
});
after(cleanupBundles);

const sum = (entries, f) => Math.round(entries.reduce((n, e) => n + f(e), 0) * 10) / 10;
const season = (y, id) => LOGS[String(y)][id];

/* ------------------------------------------------------------- scoring */

describe("fantasy scoring: one implementation (WEB-031, WEB-036)", () => {
  test("the build scripts' mirror carries exactly the TypeScript coefficients", () => {
    assert.deepEqual({ ...jsRules.HOUSE_RULES }, { ...rules.HOUSE_RULES });
    assert.deepEqual({ ...jsRules.RECEPTION_POINTS }, { ...rules.RECEPTION_POINTS });
    for (const y of ["2021", "2023", "2024", "2026"]) {
      for (const games of Object.values(LOGS[y])) {
        for (const g of games) {
          for (const f of ["standard", "half", "ppr"]) {
            assert.equal(jsRules.scoreGameLogStats(g.stats, f), scoring.getFantasyPoints(g.stats, f));
          }
        }
      }
    }
  });

  test("house rules: -1 per interception, -2 per fumble lost, 2 per two-point conversion", () => {
    assert.equal(rules.scoreLine({ passInt: 1 }, "ppr"), -1);
    assert.equal(rules.scoreLine({ fumLost: 1 }, "ppr"), -2);
    assert.equal(rules.scoreLine({ twoPt: 1 }, "standard"), 2);
    assert.equal(rules.scoreLine({ rec: 4, recYd: 40 }, "half"), 6);
    assert.equal(rules.pointsLabel("ppr"), "Fantasy Points (PPR)");
    assert.equal(rules.pointsLabel("ppr", "target"), "PPR Points/Target");
  });

  test("St. Brown 2026: 183.4 PPR, 118.4 Standard", () => {
    const g = season(2026, ASB);
    assert.equal(sum(g, (e) => scoring.getEntryPoints(e.stats, "ppr")), 183.4);
    assert.equal(sum(g, (e) => scoring.getEntryPoints(e.stats, "standard")), 118.4);
    assert.equal(sum(g, (e) => scoring.getFantasyPoints(e.stats, "standard")), 118.4);
    // The audited stats-table figure is exactly the Standard total: the
    // table was printing a different format under no label.
    assert.equal(TABLES.wr.rows.find((r) => r.playerId === ASB).fantasyPoints, 118.4);
  });

  test("St. Brown points per target: PPR 2.02 and Standard 1.30 are one total over one target count", () => {
    const g = season(2026, ASB);
    const tgt = g.reduce((n, e) => n + (e.stats.rec_tgt ?? 0), 0);
    assert.equal(tgt, 91);
    assert.equal(Math.round((183.4 / tgt) * 100) / 100, 2.02);
    assert.equal(Math.round((118.4 / tgt) * 100) / 100, 1.3);
  });

  test("Gibbs 2026: 253.4 PPR; Week 1 33.6", () => {
    const g = season(2026, GIBBS);
    assert.equal(sum(g, (e) => scoring.getEntryPoints(e.stats, "ppr")), 253.4);
    assert.equal(sum(g, (e) => scoring.getFantasyPoints(e.stats, "ppr")), 253.4);
    assert.equal(g.find((e) => e.week === 1).stats.pts_ppr, 33.6);
    assert.equal(scoring.getFantasyPoints(g.find((e) => e.week === 1).stats, "ppr"), 33.6);
  });

  test("Lamar Jackson 2026: 80.1 under -1 INT; the stats table's 79.1 was -2", () => {
    const g = season(2026, LAMAR);
    assert.equal(sum(g, (e) => scoring.getEntryPoints(e.stats, "ppr")), 80.1);
    assert.equal(sum(g, (e) => scoring.getFantasyPoints(e.stats, "ppr")), 80.1);
    const ints = g.reduce((n, e) => n + (e.stats.pass_int ?? 0), 0);
    assert.equal(Math.round((80.1 - ints) * 10) / 10, TABLES.qb.rows.find((r) => r.playerId === LAMAR).fantasyPoints);
  });

  test("historical totals reconcile with their stat lines once the dropped events are stored", () => {
    const resid = (y, id) =>
      Math.round(season(y, id).reduce((n, e) => n + e.stats.pts_ppr - scoring.getFantasyPoints(e.stats, "ppr"), 0) * 100) / 100;
    // Two receiving two-point conversions, a 7-yard TD pass, a passing 2-pt.
    assert.equal(sum(season(2021, ASB), (e) => e.stats.pts_ppr), 227.3);
    assert.equal(resid(2021, ASB), 0);
    assert.equal(sum(season(2024, ASB), (e) => e.stats.pts_ppr), 316.2);
    assert.equal(resid(2024, ASB), 0);
    assert.equal(sum(season(2026, COUSINS), (e) => e.stats.pts_ppr), 196.7);
    assert.equal(resid(2026, COUSINS), 0);
    // 2023: +1, Sleeper's point for a forced fumble after a turnover - not a
    // house rule, stored as idp_ff so the breakdown can name it.
    assert.equal(sum(season(2023, ASB), (e) => e.stats.pts_ppr), 331.9);
    assert.equal(resid(2023, ASB), 1);
    const w14 = season(2023, ASB).find((e) => e.week === 14).stats;
    assert.equal(w14.idp_ff, 1);
  });

  test("the scoring breakdown names every event it scores", () => {
    const w = season(2024, ASB).find((e) => e.week === 4).stats;
    const rows = scoring.pointsBreakdown(w, "ppr");
    assert.ok(rows.some((r) => r.label === "Passing TD"));
    assert.equal(Math.round(rows.reduce((n, r) => n + r.points, 0) * 100) / 100, w.pts_ppr);
  });

  test("matchup box scores and FPA score a line exactly as the player pages do", () => {
    for (const g of season(2026, LAMAR).concat(season(2026, GIBBS), season(2026, ASB))) {
      const s = g.stats;
      const line = {
        passYds: s.pass_yd, passTd: s.pass_td, passInt: s.pass_int, rushYds: s.rush_yd, rushTd: s.rush_td,
        rec: s.rec, recYds: s.rec_yd, recTd: s.rec_td, fumblesLost: s.fum_lost,
      };
      for (const f of ["standard", "half", "ppr"]) {
        assert.equal(matchupPts.fantasyPoints(line, f), Math.round(scoring.getFantasyPoints(s, f) * 10) / 10);
      }
      const csv = {
        passing_yards: s.pass_yd, passing_tds: s.pass_td, passing_interceptions: s.pass_int, rushing_yards: s.rush_yd,
        rushing_tds: s.rush_td, receptions: s.rec, receiving_yards: s.rec_yd, receiving_tds: s.rec_td, rushing_fumbles_lost: s.fum_lost,
      };
      const scored = nflverse.scoreRow((c) => (csv[c] == null ? undefined : String(csv[c])));
      assert.equal(Math.round(scored.points.ppr * 100) / 100, scoring.getFantasyPoints(s, "ppr"));
    }
  });
});

/* ------------------------------------------------------------ freshness */

describe("statistical freshness and week labels (WEB-032)", () => {
  const games = () => coverageTs.slateGames(2026, SLATE_CSV);
  const presentFrom = (logs, skip = () => false) => {
    const out = new Set();
    for (const entries of Object.values(logs)) for (const g of entries) if (!skip(g)) out.add(`${g.week}:${teams.getTeamByAbbreviation(g.team)?.code ?? g.team}`);
    return out;
  };
  const allFinal = () => {
    const out = new Set();
    for (const g of games()) if (g.final) out.add(`${g.week}:${g.away}`).add(`${g.week}:${g.home}`);
    return out;
  };

  test("Monday night missing: complete through Week 9, Week 10 partial, the game named", () => {
    const p = allFinal();
    p.delete("10:LAC");
    p.delete("10:BAL");
    const c = coverageTs.coverage(games(), p, 17);
    assert.equal(c.throughWeek, 9);
    assert.equal(c.partialWeek, 10);
    assert.deepEqual(c.missing, ["2026_10_LAC_BAL"]);
    assert.equal(c.complete, false);
    // The builder's rule answers the same.
    const b = builderCoverage(2026, new Set([...p].map((k) => k.replace(":LAR", ":LA"))), { lastWeek: 17, games: games() });
    assert.deepEqual({ ...b }, { ...c });
  });

  test("Monday night ingested: complete through Week 10", () => {
    const c = coverageTs.coverage(games(), allFinal(), 17);
    assert.equal(c.throughWeek, 10);
    assert.equal(c.partialWeek, null);
    assert.equal(c.latestIncludedGame, "2026_10_LAC_BAL");
    assert.equal(c.complete, true);
  });

  test("bye weeks are not missing games", () => {
    const c = coverageTs.coverage(games(), allFinal(), 17);
    const week6Teams = new Set(games().filter((g) => g.week === 6).flatMap((g) => [g.away, g.home]));
    assert.ok(week6Teams.size < 32, "the fixture has byes in Week 6");
    assert.equal(c.missing.length, 0);
  });

  test("Herbert: 8 games / 1,591 yards without MNF, 9 / 1,720 with it", () => {
    const g = season(2026, HERBERT);
    const without = g.filter((e) => !(e.week === 10 && e.opp === "BAL"));
    assert.equal(without.length, 8);
    assert.equal(without.reduce((n, e) => n + e.stats.pass_yd, 0), 1591);
    assert.equal(g.length, 9);
    assert.equal(g.reduce((n, e) => n + e.stats.pass_yd, 0), 1720);
    assert.equal(TABLES.qb.rows.find((r) => r.playerId === HERBERT).passingYards, 1720);
  });

  test("an incomplete table says so beside the week range; a complete one does not", () => {
    const base = statsData.getStatsTable("QB", 2026);
    assert.ok(base, "the live 2026 QB table loads");
    const incomplete = {
      ...base,
      weeks: "1-9",
      coverage: { throughWeek: 9, partialWeek: 10, gamesIncluded: 149, gamesFinal: 150, missing: ["2026_10_LAC_BAL"], latestFinalGame: "2026_10_LAC_BAL", latestIncludedGame: "2026_10_PIT_CIN", complete: false, checkedAt: null },
    };
    const html = statsRender.renderStatsPage(incomplete, {});
    assert.match(html, /Weeks 1–9/);
    assert.match(html, /Week 10 partial, 1 game not yet included: LAC at BAL/);
    const complete = statsRender.renderStatsPage({ ...base, coverage: { ...incomplete.coverage, complete: true, missing: [], partialWeek: null, throughWeek: 10 } }, {});
    assert.doesNotMatch(complete, /not yet included/);
  });

  test("no current-season games: games-missed counts the club's games, not an empty log", () => {
    const logs = { ...LOGS["2026"] };
    delete logs[PACHECO];
    const a = missed.seasonAvailability({ season: 2026, playerId: PACHECO, currentTeam: "DET", injuries: INJ[PACHECO].nfl, logs });
    assert.equal(a.played, 0);
    assert.ok(a.teamGames > 0);
  });
});

/* ------------------------------------------------------------- injuries */

describe("one injury status (WEB-039)", () => {
  const chi = () => teams.getTeamByAbbreviation("CHI");
  const row = (over) => ({ id: BURDEN, name: "Luther Burden III", position: "WR", team: "chi", injuryStatus: null, injuryBodyPart: null, ...over });
  const logsWith = (extra = {}) => ({ ...LOGS["2026"], ...extra });

  test("Burden Week 11: an expired Questionable is not carried forward", () => {
    const a = availability.gameAvailability(chi(), 2026, 11, [row({ injuryStatus: "Questionable" })], { logs: logsWith(), practice: PRACTICE }).get(BURDEN);
    assert.equal(a.status, null);
    const s = status.currentStatus({
      playerId: BURDEN, team: chi(), season: 2026,
      games: [{ week: 11, seasonType: "regular", status: "scheduled", result: null }],
      rosterRow: row({ injuryStatus: "Questionable" }), rosterFetchedAt: Date.parse("2026-11-18T05:00:00Z"), now: Date.parse("2026-11-18T12:00:00Z"),
      deps: { logs: logsWith(), practice: PRACTICE },
    });
    assert.equal(s.designation, null);
    assert.equal(status.displayedStatus(s), null);
    assert.match(s.message, /^No current game designation reported for Week 11\./);
  });

  test("no report yet for the week: a Sleeper Questionable from a game he played is history, not current (Week 9, then the Week 10 bye)", () => {
    const a = availability.gameAvailability(chi(), 2026, 11, [row({ injuryStatus: "Questionable" })], { logs: logsWith(), practice: { weeks: {} } }).get(BURDEN);
    assert.equal(a.status, null);
    assert.match(a.note, /Listed Questionable for Week 9 and played; no Week 11 designation reported yet\./);
  });

  test("a current official Out stands", () => {
    const practice = { weeks: { "11": { teams: { Bears: { x: { name: "Luther Burden III", pos: "WR", injury: "Ankle", gameStatus: "Out", final: "DNP", days: {} } } } } } };
    const a = availability.gameAvailability(chi(), 2026, 11, [row({ injuryStatus: "Out" })], { logs: logsWith(), practice }).get(BURDEN);
    assert.equal(a.status, "Out");
    assert.equal(a.source, "nfl-report");
  });

  test("a Wednesday practice line is not a game designation", () => {
    const practice = { weeks: { "11": { teams: { Bears: { x: { name: "Luther Burden III", pos: "WR", injury: "Ankle", gameStatus: null, final: null, days: { "2026-11-18": "DNP" } } } } } } };
    const a = availability.gameAvailability(chi(), 2026, 11, [row()], { logs: logsWith(), practice }).get(BURDEN);
    assert.equal(a.status, null);
    assert.equal(a.practice, "DNP Wed");
  });

  test("injured reserve stays visible", () => {
    const det = teams.getTeamByAbbreviation("DET");
    const s = status.currentStatus({
      playerId: PACHECO, team: det, season: 2026,
      games: [{ week: 11, seasonType: "regular", status: "scheduled", result: null }],
      rosterRow: { id: PACHECO, name: "Isiah Pacheco", position: "RB", team: "det", injuryStatus: "IR", injuryBodyPart: null },
      rosterFetchedAt: Date.parse("2026-11-18T05:00:00Z"), now: Date.parse("2026-11-18T12:00:00Z"),
      deps: { logs: LOGS["2026"], practice: { weeks: {} } },
    });
    assert.equal(s.rosterStatus, "IR");
    assert.equal(status.displayedStatus(s), "IR");
  });

  test("returning from injury: missed last game, no new status yet, reads pending - not Out, not healthy", () => {
    // The Bears' last game before Week 11 is Week 9 (Week 10 bye). A
    // teammate's row keeps Week 9 a club game when Burden's own is removed.
    const logs = logsWith({
      [BURDEN]: LOGS["2026"][BURDEN].filter((e) => e.week !== 9),
      "997": [{ week: 9, opp: "TB", team: "CHI", stats: { pts_ppr: 0, gp: 1, off_snp: 30 } }],
    });
    const a = availability.gameAvailability(chi(), 2026, 11, [row({ injuryStatus: "Out" })], { logs, practice: { weeks: {} } }).get(BURDEN);
    assert.equal(a.kind, "pending");
  });

  test("an old roster snapshot is flagged stale, a missing one unavailable", () => {
    const args = {
      playerId: BURDEN, team: chi(), season: 2026,
      games: [{ week: 11, seasonType: "regular", status: "scheduled", result: null }],
      rosterRow: row({ injuryStatus: "IR" }), now: Date.parse("2026-11-18T12:00:00Z"),
      deps: { logs: logsWith(), practice: PRACTICE },
    };
    assert.equal(status.currentStatus({ ...args, rosterFetchedAt: Date.parse("2026-11-14T00:00:00Z") }).freshness, "stale");
    assert.equal(status.currentStatus({ ...args, rosterFetchedAt: null }).freshness, "unavailable");
    // Stale, but still shown with its timestamp - not dropped.
    assert.equal(status.currentStatus({ ...args, rosterFetchedAt: Date.parse("2026-11-14T00:00:00Z") }).rosterStatus, "IR");
  });

  test("Pacheco: one IR stint across the bye, nine games, one count everywhere", () => {
    const before = INJ["8205_before_2026_11_19"].nfl.filter((e) => e.season === 2026);
    assert.deepEqual(before.map((e) => e.gamesMissed).sort(), [4, 9], "the audited overlap");
    const after = INJ[PACHECO].nfl.filter((e) => e.season === 2026);
    assert.equal(after.length, 1);
    assert.equal(after[0].gamesMissed, 9);
    const logs = { ...LOGS["2026"] };
    const a = missed.seasonAvailability({ season: 2026, playerId: PACHECO, currentTeam: "DET", injuries: INJ[PACHECO].nfl, logs, throughWeek: 10 });
    assert.equal(a.missedInjury, 9);
    assert.equal(a.notPlayedOther, 0);
  });

  test("a player who joined mid-season is not charged the weeks before", () => {
    const logs = { ...LOGS["2026"], "999": [{ week: 8, opp: "X", team: "DET", stats: { pts_ppr: 1, gp: 1, off_snp: 10 } }] };
    const a = missed.seasonAvailability({ season: 2026, playerId: "999", currentTeam: "DET", injuries: [], logs, throughWeek: 10 });
    assert.equal(a.weeksNotPlayedOther.every((w) => w > 8), true);
  });

  test("a traded player counts his games with the club he was on that week", () => {
    const logs = {
      ...LOGS["2026"],
      "998": [
        { week: 1, opp: "X", team: "DET", stats: { pts_ppr: 1, gp: 1, off_snp: 10 } },
        { week: 9, opp: "X", team: "CHI", stats: { pts_ppr: 1, gp: 1, off_snp: 10 } },
      ],
    };
    const a = missed.seasonAvailability({ season: 2026, playerId: "998", currentTeam: "CHI", injuries: [], logs, throughWeek: 9 });
    assert.equal(a.played, 2);
    // Weeks 2-8 are DET weeks he has no row for: not played, reason unknown -
    // never called an injury.
    assert.equal(a.missedInjury, 0);
    assert.ok(a.notPlayedOther > 0);
  });
});

/* ------------------------------------------------------------- rankings */

describe("rankings, pools and labels (WEB-033, WEB-034, WEB-035)", () => {
  test("one band scale: the player pages' bands are the FPA page's tiers", () => {
    for (let r = 1; r <= 32; r++) {
      const tier = fpaRender.matchupTier(r);
      const band = bands.matchupBand(r);
      assert.equal(band, tier === "mid" ? "mid" : tier.startsWith("soft") ? "soft" : "tough", `rank ${r}`);
    }
    // The audit's Gibbs pairs: 13th is neutral, 25th tough, under one scale.
    assert.equal(bands.matchupBand(13), "mid");
    assert.equal(bands.matchupBand(25), "tough");
    assert.equal(bands.matchupBand(12), "soft");
    assert.equal(bands.matchupBand(21), "tough");
  });

  test("the Game Log's opponent ranks are the FPA table's ranks", () => {
    const rows = [
      { team: { code: "NO" }, abbr: "NO", byPos: { RB: { rank: 2 } } },
      { team: { code: "ARI" }, abbr: "ARI", byPos: { RB: { rank: 13 } } },
      { team: { code: "NE" }, abbr: "NE", byPos: { RB: { rank: 16 } } },
    ];
    const map = ranks.fpaOppRanks(rows);
    const log = ranks.attachOppRanks(
      [{ week: 1, opp: "NO", stats: {} }, { week: 5, opp: "ARI", stats: {} }, { week: 10, opp: "NE", stats: {} }],
      "RB", map, "fpa-current",
    );
    assert.deepEqual(log.map((e) => e.opp_rank_vs_pos), [2, 13, 16]);
    assert.ok(log.every((e) => e.opp_rank_source === "fpa-current"), "labelled as the current rank, not a pregame snapshot");
  });

  test("a rest-of-season board older than seven days is stale in season, not in preseason", () => {
    const oct22 = "2026-10-22T00:00:00-04:00";
    assert.equal(outlookCtx.rosBoardStale(oct22, Date.parse("2026-11-18T12:00:00Z"), true), true);
    assert.equal(outlookCtx.rosBoardStale(oct22, Date.parse("2026-10-25T12:00:00Z"), true), false);
    assert.equal(outlookCtx.rosBoardStale(oct22, Date.parse("2026-11-18T12:00:00Z"), false), false);
    assert.equal(outlookCtx.rosBoardStale(null, Date.now(), true), true, "an undated board cannot be shown current");
  });

  test("roster % rounds one way everywhere: 99.6 is 99%, 100 is 100%, 0.3 is <1%", () => {
    assert.equal(rounding.rosteredPct(99.6), "99%");
    assert.equal(rounding.rosteredPct(100), "100%");
    assert.equal(rounding.rosteredPct(0.3), "<1%");
  });
});

/* --------------------------------------------- same snapshot, two components */

describe("live data: components agree on the same snapshot", () => {
  test("every stats-table FPTS equals the hub's summed per-game PPR for the weeks the table covers", async () => {
    const data = await importModule("lib/player/data");
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const t = statsData.getStatsTable(pos, 2026);
      if (!t) continue;
      const logs = data.loadGameLogs(2026);
      const through = t.week ?? 17;
      let n = 0;
      for (const row of t.rows) {
        if (!row.playerId || !logs[row.playerId]) continue;
        const hub = Math.round(logs[row.playerId].filter((g) => g.week <= through).reduce((s, g) => s + scoring.getEntryPoints(g.stats, "ppr"), 0) * 10) / 10;
        assert.equal(row.values.fantasyPoints, hub, `${pos} ${row.name}`);
        n++;
      }
      assert.ok(n > 20, `${pos}: rows checked`);
      const col = t.groups.flatMap((g) => g.columns).find((c) => c.key === "fantasyPoints");
      assert.equal(col.label, "PPR FPTS");
    }
  });
});
