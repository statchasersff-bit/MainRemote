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
import http from "node:http";
import os from "node:os";
import { execFile } from "node:child_process";
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

/* ===================================================== Phase 1.1 (2026-11-19) */

const AUBREY = "11533";

describe("kicker scoring: one distance-tiered rule (Phase 1.1)", () => {
  test("field goals by distance, extra points, misses: house rule = matchup pages = build mirror", () => {
    // 25, 44 and 53 yards made, one field goal missed; 3 of 4 extra points.
    const line = { fgMade: [25, 44, 53], fgAtt: 4, xpMade: 3, xpAtt: 4 };
    assert.equal(matchupPts.kickerPoints(line), 3 + 4 + 5 - 1 + 3 - 1);
    const log = { pts_ppr: 0, fgm: 3, fga: 4, xpm: 3, xpa: 4, fgm_20_29: 1, fgm_40_49: 1, fgm_50p: 1 };
    for (const f of ["standard", "half", "ppr"]) {
      assert.equal(scoring.getFantasyPoints(log, f), 13, `${f}: a kicker scores the same in every format`);
      assert.equal(jsRules.scoreGameLogStats(log, f), 13);
    }
  });

  test("band edges: 39 is 3, 40 is 4, 49 is 4, 50 is 5", () => {
    assert.equal(matchupPts.kickerPoints({ fgMade: [39], fgAtt: 1, xpMade: 0, xpAtt: 0 }), 3);
    assert.equal(matchupPts.kickerPoints({ fgMade: [40], fgAtt: 1, xpMade: 0, xpAtt: 0 }), 4);
    assert.equal(matchupPts.kickerPoints({ fgMade: [49], fgAtt: 1, xpMade: 0, xpAtt: 0 }), 4);
    assert.equal(matchupPts.kickerPoints({ fgMade: [50], fgAtt: 1, xpMade: 0, xpAtt: 0 }), 5);
  });

  test("a missed extra point costs one; a kicker line with no distances keeps the provider total, never a guess", () => {
    assert.equal(scoring.getFantasyPoints({ pts_ppr: 1, fgm: 0, fga: 0, xpm: 2, xpa: 3 }, "ppr"), 1);
    assert.equal(scoring.getFantasyPoints({ pts_ppr: 11, pts_std: 11, fgm: 3, fga: 3, xpm: 2, xpa: 2 }, "ppr"), 11);
  });

  test("Brandon Aubrey 2026: every week's stored total reproduces under the house kicker rule", () => {
    for (const g of season(2026, AUBREY)) {
      assert.equal(scoring.getFantasyPoints(g.stats, "ppr"), g.stats.pts_ppr, `week ${g.week}`);
    }
  });

  test("the breakdown itemizes a kicker by distance and the lines add up", () => {
    const g = season(2026, AUBREY).find((e) => (e.stats.fgm_50p ?? 0) > 0) ?? season(2026, AUBREY)[0];
    const rows = scoring.pointsBreakdown(g.stats, "ppr");
    assert.equal(Math.round(rows.reduce((n, r) => n + r.points, 0) * 100) / 100, g.stats.pts_ppr);
  });
});

describe("historical totals: provider vs house rule, reversible (Phase 1.1)", () => {
  const cousins21 = () => season(2021, COUSINS);
  const total = (games, f) => Math.round(games.reduce((n, g) => n + f(g.stats), 0) * 10) / 10;

  test("default: the provider's stored totals, unchanged (Cousins 2021 295.3)", () => {
    delete process.env.SC_SCORING_TOTALS;
    assert.equal(total(cousins21(), (s) => scoring.getEntryPoints(s, "ppr")), 295.3);
  });

  test("SC_SCORING_TOTALS=house: the house rule for every season (Cousins 2021 307.3); unset restores it", () => {
    process.env.SC_SCORING_TOTALS = "house";
    try {
      assert.equal(total(cousins21(), (s) => scoring.getEntryPoints(s, "ppr")), 307.3);
      assert.equal(total(cousins21(), (s) => jsRules.entryPoints(s, "ppr")), 307.3, "build scripts follow the same switch");
      // 2026 audited fixtures hold under either policy.
      assert.equal(total(season(2026, ASB), (s) => scoring.getEntryPoints(s, "ppr")), 183.4);
      assert.equal(total(season(2026, LAMAR), (s) => scoring.getEntryPoints(s, "ppr")), 80.1);
    } finally {
      delete process.env.SC_SCORING_TOTALS;
    }
    assert.equal(total(cousins21(), (s) => scoring.getEntryPoints(s, "ppr")), 295.3);
  });

  test("every difference is named: provider fumble penalty, provider-only plays", () => {
    const w2 = cousins21().find((g) => g.week === 2).stats;
    const r = Math.round((w2.pts_ppr - scoring.getFantasyPoints(w2, "ppr")) * 100) / 100;
    assert.equal(scoring.explainResidual(w2, r).label, "Provider fumble penalty");
    // St. Brown 2023 Week 14: +1 for a forced fumble on defense. Provider-only:
    // it is in the stored total and NOT in the house total.
    const w14 = season(2023, ASB).find((g) => g.week === 14).stats;
    assert.equal(scoring.getFantasyPoints(w14, "ppr"), 5.1);
    assert.equal(w14.pts_ppr, 6.1);
    const why = scoring.explainResidual(w14, 1);
    assert.equal(why.label, "Provider-only scoring");
    assert.match(why.detail, /forced fumble/);
    assert.equal(scoring.explainResidual(w14, 0), null);
  });
});

describe("freshness metadata: ingestion is not a file write (Phase 1.1)", () => {
  const SEASON_T = 2031;
  let dir, stub, failAll = false, withStd = false;
  const BUILDER = path.join(HERE, "..", "scripts", "player", "buildGameLogs.js");
  const BACKFILL = path.join(HERE, "..", "scripts", "player", "backfillScoringEvents.mjs");
  const exec = (file, args, env) =>
    new Promise((resolve) => {
      execFile(process.execPath, [file, ...args], { env: { ...process.env, ...env } }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
    });
  const meta = () => JSON.parse(fs.readFileSync(path.join(dir, "dataset-meta.json"), "utf8")).datasets.game_logs[String(SEASON_T)];

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-meta-"));
    fs.writeFileSync(path.join(dir, "players.json"), JSON.stringify([{ id: "1", name: "Test Back", position: "RB" }]));
    stub = http.createServer((req, res) => {
      const [, week] = req.url.split("?")[0].split("/").slice(-2).map(Number);
      if (failAll) { res.writeHead(500); res.end(); return; }
      const rows = week <= 3 ? [{ player_id: "1", team: "ARI", opponent: "LAC", stats: { gp: 1, rush_yd: 10 * week, pts_ppr: week, rush_2pt: week === 2 ? 1 : 0, ...(withStd ? { pts_std: week } : {}) } }] : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows));
    });
    await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  });
  after(async () => {
    await new Promise((r) => stub.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const env = () => ({ SC_PLAYER_DATA_DIR: dir, SC_SLEEPER_STATS_BASE: `http://127.0.0.1:${stub.address().port}` });

  test("a successful build records ingestion and aggregation", async () => {
    failAll = false;
    const r = await exec(BUILDER, [String(SEASON_T)], env());
    assert.equal(r.code, 0, r.stderr);
    const m = meta();
    assert.ok(m.lastIngestedAt && m.lastAggregatedAt);
    assert.equal(m.lastIngestedAt, m.lastAggregatedAt);
  });

  test("an old dataset rebuilt today by a backfill: correction recorded, ingestion time unchanged", async () => {
    const before = meta().lastIngestedAt;
    await new Promise((r) => setTimeout(r, 1100));
    // The provider now has a field the stored file lacks: the backfill adds it.
    withStd = true;
    const r = await exec(BACKFILL, [String(SEASON_T)], env());
    withStd = false;
    assert.equal(r.code, 0, r.stderr);
    const m = meta();
    assert.equal(m.lastIngestedAt, before, "a backfill is not an ingestion");
    assert.ok(Date.parse(m.lastCorrectionAt) > Date.parse(before), "the correction is recorded on its own");
  });

  test("a failed ingestion never advances the last successful ingestion", async () => {
    const before = meta().lastIngestedAt;
    failAll = true;
    const r = await exec(BUILDER, [String(SEASON_T)], env());
    failAll = false;
    assert.notEqual(r.code, 0, "every week failing is a failed run");
    const m = meta();
    assert.equal(m.lastIngestedAt, before);
    assert.ok(Date.parse(m.lastFailureAt) >= Date.parse(before));
    assert.ok(fs.existsSync(path.join(dir, "game_logs", `${SEASON_T}.json`)), "the last good file stays");
  });

  test("the status report and page labels read the metadata, not the mtime", async () => {
    const dm = await importModule("lib/dataset-meta");
    dm.setDatasetMetaForTests({ datasets: { game_logs: { "2026": { lastIngestedAt: "2026-11-18T14:25:32Z", lastCorrectionAt: "2026-11-19T03:00:00Z" } } } });
    assert.equal(dm.lastIngestedMs("game_logs", 2026), Date.parse("2026-11-18T14:25:32Z"));
    dm.setDatasetMetaForTests(null);
  });
});

describe("Burden: injury history vs current status (Phase 1.1)", () => {
  test("the Week 9 in-game injury is in the history, from the play-by-play, without an invented body part", () => {
    const e = INJ["12519_phase1_1"].nfl.filter((x) => x.season === 2026);
    assert.equal(e.length, 1);
    assert.equal(e[0].week, 9);
    assert.equal(e[0].source, "play-by-play");
    assert.equal(e[0].bodyPart, "unknown");
    assert.equal(e[0].gamesMissed, 0, "no reason established for any game since, so none counted to injury");
    assert.match(e[0].description, /Week 10 bye/);
  });

  test("builder: an in-game injury in the latest game with no report becomes an entry; one a report covers does not duplicate", async () => {
    const { buildEntries } = await import("../scripts/player/buildInjuryHistory.mjs");
    const ctx = (extra = {}) => ({ played: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]), playing: (w) => w !== 10, completedWeek: 10, team: "CHI", onReserve: false, current: true, ...extra });
    const ev = [{ week: 9, opponent: "TB", qtr: 4, clock: "03:48", desc: "(3:48) pass to 10-L.Burden" }];
    const [e] = buildEntries(2026, [], ev, ctx());
    assert.equal(e.type, "In-game injury");
    assert.equal(e.gamesMissed, 0);
    // A past season: no such entry (the durability grid owns past seasons).
    assert.equal(buildEntries(2026, [], ev, ctx({ current: false })).length, 0);
    // Once a report lists him, the report's entry carries the play instead.
    const rows = [{ week: 11, team: "CHI", term: "Concussion", status: null, primary: true }];
    const entries = buildEntries(2026, rows, ev, ctx({ completedWeek: 11, playing: () => true, played: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) }));
    assert.equal(entries.filter((x) => x.type === "In-game injury").length, 0);
  });

  test("an incomplete history does not change the current status: still no designation for Week 11", () => {
    const s = status.currentStatus({
      playerId: BURDEN, team: teams.getTeamByAbbreviation("CHI"), season: 2026,
      games: [{ week: 11, seasonType: "regular", status: "scheduled", result: null }],
      rosterRow: { id: BURDEN, name: "Luther Burden III", position: "WR", team: "chi", injuryStatus: "Questionable", injuryBodyPart: "Concussion" },
      rosterFetchedAt: Date.parse("2026-11-18T05:00:00Z"), now: Date.parse("2026-11-18T12:00:00Z"),
      deps: { logs: LOGS["2026"], practice: PRACTICE },
    });
    assert.equal(s.designation, null);
  });
});

describe("data health: alert only on actionable conditions (Phase 1.1)", () => {
  const games = () => coverageTs.slateGames(2026, SLATE_CSV);
  const report = (missing = []) => ({
    gameLogs: { coverage: { missing }, lastIngestedAt: "2026-11-18T14:25:32Z", lastFailureAt: null },
    statsTables: { tables: [{ position: "QB", state: "complete", coverage: { missing: [] } }], lastIngestedAt: "2026-11-19T02:00:46Z", lastFailureAt: null },
    crossCheck: { mismatches: 0 },
  });
  const mnfKickoff = Date.parse("2026-11-16T20:15:00-05:00");

  test("Monday night not yet ingested on Tuesday morning: no alert (grace window)", () => {
    const v = coverageTs.dataHealth(2026, mnfKickoff + 12 * 3600_000, { report: report(["2026_10_LAC_BAL"]), games: games() });
    assert.equal(v.ok, true, v.reasons.join("; "));
  });

  test("still missing two days later: alert names the game", () => {
    const v = coverageTs.dataHealth(2026, mnfKickoff + 40 * 3600_000, { report: report(["2026_10_LAC_BAL"]), games: games() });
    assert.equal(v.ok, false);
    assert.match(v.reasons.join(";"), /2026_10_LAC_BAL/);
  });

  test("a failure newer than the last success, a stale feed, a mismatch, an unattributed score: each alerts", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const r = report();
    r.gameLogs.lastFailureAt = "2026-11-19T10:00:00Z";
    r.gameLogs.lastFailure = "every week failed";
    assert.match(coverageTs.dataHealth(2026, now, { report: r, games: games() }).reasons.join(";"), /ingestion failed/);
    const stale = report();
    stale.gameLogs.lastIngestedAt = "2026-11-01T00:00:00Z";
    assert.match(coverageTs.dataHealth(2026, now, { report: stale, games: games() }).reasons.join(";"), /not ingested/);
    const mm = report();
    mm.crossCheck.mismatches = 2;
    assert.match(coverageTs.dataHealth(2026, now, { report: mm, games: games() }).reasons.join(";"), /differ between/);
    assert.match(coverageTs.dataHealth(2026, now, { report: report(), games: games(), unattributedScoring: 1 }).reasons.join(";"), /no known cause/);
    assert.equal(coverageTs.dataHealth(2026, now, { report: report(), games: games() }).ok, true);
  });
});

describe("grades keep their defined input (Phase 1.1)", () => {
  test("grades read the source FPTS while the column shows PPR", () => {
    const t = statsData.getStatsTable("WR", 2026);
    const asb = t.rows.find((r) => r.playerId === ASB);
    assert.equal(asb.values.fantasyPoints, 183.4 >= 0 ? asb.values.fantasyPoints : 0);
    assert.notEqual(asb.values.fantasyPointsSource, asb.values.fantasyPoints, "source (Standard) kept beside the PPR column");
    const prod = t.groups.flatMap((g) => g.columns).find((c) => c.key === "productionScore");
    assert.match(prod.tooltip, /Standard FPTS\/G/);
  });
});

describe("an injury no report has listed is never 'played through' (Phase 1.1)", () => {
  test("Burden's Week 9 entry is pending in the Injury tab's events", async () => {
    const itd = await importModule("lib/player/injury-tab-data");
    const events = itd.buildEvents(INJ["12519_phase1_1"].nfl, () => "CHI");
    const wk9 = events.find((e) => e.season === 2026 && e.week === 9);
    assert.equal(wk9.pending, true);
    assert.equal(wk9.games, 0);
    assert.ok(events.filter((e) => e.season < 2026).every((e) => e.pending === false));
  });
});

describe("Phase 1 final decisions (2026-11-19)", () => {
  test("house policy: PPR - Half = Half - Standard = half a point per catch, every fixture game", () => {
    process.env.SC_SCORING_TOTALS = "house";
    try {
      for (const y of ["2021", "2023", "2024", "2026"]) {
        for (const games of Object.values(LOGS[y])) {
          for (const g of games) {
            if (scoring.kickerUnscorable(g.stats)) continue;
            const p = scoring.getEntryPoints(g.stats, "ppr"), h = scoring.getEntryPoints(g.stats, "half"), s = scoring.getEntryPoints(g.stats, "standard");
            const rec = g.stats.rec ?? 0;
            assert.ok(Math.abs(p - h - rec / 2) < 0.011 && Math.abs(h - s - rec / 2) < 0.011, `${y} wk ${g.week}`);
          }
        }
      }
    } finally {
      delete process.env.SC_SCORING_TOTALS;
    }
  });

  test("house policy excludes provider-only plays: St. Brown 2023 sums to 330.9, the provider to 331.9", () => {
    process.env.SC_SCORING_TOTALS = "house";
    try {
      const t = Math.round(season(2023, ASB).reduce((n, g) => n + scoring.getEntryPoints(g.stats, "ppr"), 0) * 10) / 10;
      assert.equal(t, 330.9);
    } finally {
      delete process.env.SC_SCORING_TOTALS;
    }
    assert.equal(Math.round(season(2023, ASB).reduce((n, g) => n + scoring.providerPoints(g.stats, "ppr"), 0) * 10) / 10, 331.9);
  });

  test("a kicker week without distances is labelled as the source's total, never as house scoring", () => {
    const st = { pts_ppr: 11, pts_std: 11, fgm: 3, fga: 3, xpm: 2, xpa: 2 };
    assert.equal(scoring.kickerUnscorable(st), true);
    assert.equal(scoring.explainResidual(st, 0).label, "Source total");
  });

  test("the kicker header names no scoring format", async () => {
    const header = await importModule("lib/player/header");
    assert.equal(header.formatTag({ player: { position: "K" }, format: "ppr" }), "");
    assert.equal(header.formatTag({ player: { position: "WR" }, format: "ppr" }), "PPR");
  });
});

/* ======================== Team hubs: one current injury status (2026-11-19) */

describe("team hubs read current-week injury statuses (current-injuries.ts)", () => {
  let ci, roster;
  const DETFX = read("det-week11.json");
  const VAKI = DETFX.vaki.id;
  const week11 = { games: [{ week: 11, seasonType: "regular", status: "scheduled", result: null }] };
  const row = (over) => ({
    id: "x", name: "X", position: "RB", team: "det", depthOrder: 2, depthPosition: "RB", jersey: null, yearsExp: 1,
    searchRank: 100, status: "Active", injuryStatus: null, injuryBodyPart: null, practice: null, headshot: "", ...over,
  });
  const teamRoster = (players) => ({ team: "det", depthChart: { QB: [], RB: players, WR: [], TE: [] }, players, injuries: players.filter((p) => p.injuryStatus), fetchedAt: 1 });
  const depth = (rows) => ({ fetchedAt: "", season: 2026, views: [], football: [{ key: "def", label: "Defense", formation: null, folded: false, slots: [{ key: "cb", pos: "CB", label: "CB", rows }] }] });
  const drow = (name, injuryStatus) => ({ rank: 1, name, id: null, injuryStatus, injuryBodyPart: null, headshot: null, movement: null });
  const det = () => teams.getTeamByAbbreviation("DET");
  const chi = () => teams.getTeamByAbbreviation("CHI");
  before(async () => {
    ci = await importModule("lib/team/current-injuries");
    roster = await importModule("lib/team/roster");
  });

  test("Sione Vaki is not Questionable for Week 11: Questionable for Week 10, played, no Week 11 report", () => {
    const vaki = row({ id: VAKI, name: "Sione Vaki", injuryStatus: "Questionable", injuryBodyPart: "Ankle", practice: "Limited" });
    const r = ci.currentRoster(det(), 2026, week11, teamRoster([vaki]), { logs: DETFX.logs, practice: { weeks: {} } });
    const v = r.players.find((p) => p.id === VAKI);
    assert.equal(v.injuryStatus, null);
    assert.equal(v.injuryBodyPart, null);
    assert.equal(v.practice, null, "Sleeper's week-less practice field is not carried");
    assert.equal(r.injuries.length, 0);
    assert.equal(roster.injuryWatch(r).length, 0, "the News tab's Injury Watch reads the same list");
  });

  test("an expired designation does not carry across a bye (Burden: Week 9 Questionable, Week 10 bye)", () => {
    const burden = row({ id: BURDEN, name: "Luther Burden III", position: "WR", team: "chi", injuryStatus: "Questionable" });
    const r = ci.currentRoster(chi(), 2026, week11, teamRoster([burden]), { logs: LOGS["2026"], practice: PRACTICE });
    assert.equal(r.players[0].injuryStatus, null);
  });

  test("active reserve statuses persist, on the roster and on the depth chart", () => {
    const r = ci.currentRoster(det(), 2026, week11, teamRoster([row({ id: PACHECO, name: "Isiah Pacheco", injuryStatus: "IR" })]), { logs: DETFX.logs, practice: { weeks: {} } });
    assert.equal(r.players[0].injuryStatus, "IR");
    assert.equal(r.injuries.length, 1);
    const d = ci.currentDepthCharts(det(), 2026, week11, depth([drow("Some Safety", "IR"), drow("Some Corner", "PUP")]), r, { logs: DETFX.logs, practice: { weeks: {} } });
    assert.deepEqual(d.football[0].slots[0].rows.map((x) => x.injuryStatus), ["IR", "PUP"]);
  });

  test("an unavailable report invents no designation; the freshness note says so", () => {
    const d = ci.currentDepthCharts(det(), 2026, week11, depth([drow("Some Corner", "Questionable"), drow("Some End", "Out")]), teamRoster([]), { logs: DETFX.logs, practice: null });
    assert.deepEqual(d.football[0].slots[0].rows.map((x) => x.injuryStatus), [null, null]);
    const none = ci.injuryFreshness(det(), 2026, week11, 0, Date.parse("2026-11-19T12:00:00Z"), { practice: { weeks: {} } });
    assert.equal(none.state, "unavailable");
    assert.match(none.note, /unavailable; nothing here is a confirmed current status/);
    const stale = ci.injuryFreshness(det(), 2026, week11, Date.parse("2026-11-15T12:00:00Z"), Date.parse("2026-11-19T12:00:00Z"), { practice: { weeks: {} } });
    assert.equal(stale.state, "stale");
    assert.match(stale.note, /may be out of date/);
    const pending = ci.injuryFreshness(det(), 2026, week11, Date.parse("2026-11-19T08:00:00Z"), Date.parse("2026-11-19T12:00:00Z"), { practice: { weeks: {} } });
    assert.match(pending.note, /No Week 11 injury report is on file yet/);
  });

  test("a current official game status stands, and practice is this week's report line", () => {
    const practice = { weeks: { "11": { teams: { Lions: {
      a: { name: "Sione Vaki", pos: "RB", injury: "Ankle", gameStatus: "Out", final: "DNP", days: { "2026-11-19": "DNP" } },
      b: { name: "Some Corner", pos: "CB", injury: "Knee", gameStatus: "Doubtful", final: null, days: {} },
    } } } } };
    const r = ci.currentRoster(det(), 2026, week11, teamRoster([row({ id: VAKI, name: "Sione Vaki", injuryStatus: "Questionable", practice: "Limited" })]), { logs: DETFX.logs, practice });
    assert.equal(r.players[0].injuryStatus, "Out");
    assert.equal(r.players[0].practice, "DNP Thu");
    const d = ci.currentDepthCharts(det(), 2026, week11, depth([drow("Some Corner", "Questionable")]), r, { logs: DETFX.logs, practice });
    assert.equal(d.football[0].slots[0].rows[0].injuryStatus, "Doubtful");
  });
});
