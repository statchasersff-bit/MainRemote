/**
 * WEB-036 (2026-11-26): every career-table FPTS is reproducible from what the
 * page prints - the row's visible columns plus the scoring note under the
 * table (stats-profile.ts careerScoringExtras, stats-premium.ts
 * careerScoringNote).
 *
 * The audit's row: Amon-Ra St. Brown 2024 printed 316.2 PPR while its columns
 * (115 rec, 1,263 yds, 12 TD, 6 rush yds, 1 fumble lost) add to 311.9. The
 * 4.3 is his Week 4 touchdown pass to Jared Goff (1/1, 7 yds, 1 TD: 0.28 + 4),
 * which a receiver's row has no passing column for.
 *
 * Fixtures: the stored 2026-11-18 audit snapshot for named rows; the live
 * data dir only for the league-wide "every row reconciles" check, which
 * asserts agreement, not any number.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

// The deployed setting (docs/RELEASE-TEAM-HUBS-P4-P5.md: SC_SCORING_TOTALS=house).
process.env.SC_SCORING_TOTALS = "house";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "audit-2026-11-18", "game-logs.json"), "utf8")).logs;
const DATA = path.join(HERE, "..", "data", "player");

let metrics, profile, premium, statsData, gameLogs;
before(async () => {
  statsData = await importModule("lib/player-stats/stats-data");
  gameLogs = await importModule("lib/player/data");
  metrics = await importModule("lib/player/metrics");
  profile = await importModule("lib/player/stats-profile");
  premium = await importModule("lib/player/stats-premium");
});
after(cleanupBundles);

const r1 = (x) => Math.round(x * 10) / 10;
const active = (entries) => entries.map((e) => ({ game_status: "active", ...e }));

/** The career row the page builds for one season (player-data.ts -> stats-profile.ts). */
function row(season, id, position) {
  const s = metrics.careerSeasonTotals(season, active(LOGS[String(season)][id]), position, "ppr", null);
  return profile.careerStatRows([], [s], 9999)[0];
}

/** The arithmetic of the columns the career table shows (player-render.ts renderCareerStats). */
function visible(r, position) {
  const t = r.totals;
  let v = t.rushYd * 0.1 + t.rushTd * 6 - 2 * (t.fumLost ?? 0);
  if (position === "QB") v += t.passYd * 0.04 + t.passTd * 4 - t.passInt;
  else v += t.rec + t.recYd * 0.1 + t.recTd * 6;
  return v;
}

describe("career FPTS reproduce from the printed figures (WEB-036)", () => {
  test("St. Brown 2024: 311.9 from the columns + 4.3 passing = 316.2", () => {
    const r = row(2024, "7547", "WR");
    assert.equal(r1(r.points), 316.2);
    assert.deepEqual(
      [r.totals.rec, r.totals.recYd, r.totals.recTd, r.totals.rushYd, r.totals.fumLost],
      [115, 1263, 12, 6, 1],
    );
    assert.equal(r1(visible(r, "WR")), 311.9);
    const extras = profile.careerScoringExtras(r, "WR", "ppr");
    assert.deepEqual(extras.map((x) => [x.label, x.detail, Math.round(x.points * 100) / 100]), [["Passing", "1 TD, 7 yds", 4.28]]);
    assert.equal(r1(visible(r, "WR") + extras[0].points), 316.2);
    assert.equal(profile.scoringExtraText(extras[0]), "Passing 1 TD, 7 yds (+4.3)");
  });

  test("St. Brown 2023 still 330.9, every point in its columns", () => {
    const r = row(2023, "7547", "WR");
    assert.equal(r1(r.points), 330.9);
    assert.equal(r1(visible(r, "WR")), 330.9);
    assert.deepEqual(profile.careerScoringExtras(r, "WR", "ppr"), []);
  });

  test("a quarterback row with interceptions reconciles at -1 per interception", () => {
    for (const id of ["4881", "6797", "1166"]) {
      const r = row(2024, id, "QB");
      assert.ok(r.totals.passInt > 0, id);
      const extra = profile.careerScoringExtras(r, "QB", "ppr").reduce((s, x) => s + x.points, 0);
      assert.equal(r1(visible(r, "QB") + extra), r1(r.points), id);
    }
  });

  test("the note prints each season's extras with its counts and points", () => {
    const r = row(2024, "7547", "WR");
    const html = premium.careerScoringNote({ player: { position: "WR" }, format: "ppr", statsProfile: { career: [r, row(2023, "7547", "WR")] } });
    assert.match(html, /data-scp-score-note/);
    assert.match(html, /FPTS also counts scoring with no column in the table: 2024 Passing 1 TD, 7 yds \(\+4\.3\)\./);
    assert.doesNotMatch(html, /2023/);
    assert.doesNotMatch(html, /Other/);
    assert.equal(premium.careerScoringNote({ player: { position: "WR" }, format: "ppr", statsProfile: { career: [row(2023, "7547", "WR")] } }), "");
  });

  test("the career table names its week range beside the leaderboards' (mak, 2026-11-26)", () => {
    const html = premium.careerRangeNote();
    assert.match(html, /Season rows count the full regular season, Week 18 included\. The NFL Player Stats leaderboards count Weeks 1-17, the fantasy season\./);
  });

  test("league-wide: every player-season with logs reconciles from its columns plus the note", () => {
    const players = JSON.parse(fs.readFileSync(path.join(DATA, "players.json"), "utf8"));
    const pos = new Map((Array.isArray(players) ? players : Object.values(players)).map((p) => [String(p.id), p.position]));
    const dir = path.join(DATA, "game_logs");
    let rows = 0;
    const bad = [];
    for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}\.json$/.test(n))) {
      const season = Number(f.slice(0, 4));
      const logs = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const [id, entries] of Object.entries(logs)) {
        const p = pos.get(id);
        if (!p || p === "DEF") continue;
        const s = metrics.careerSeasonTotals(season, active(entries), p, "ppr", null);
        if (!s) continue;
        rows++;
        const r = profile.careerStatRows([], [s], 9999)[0];
        const shown = visible(r, p) + profile.careerScoringExtras(r, p, "ppr").reduce((n, x) => n + x.points, 0);
        if (Math.abs(r1(r.points) - r1(shown)) > 0.051) bad.push(`${season} ${id} ${p} ${r1(r.points)} vs ${r1(shown)}`);
      }
    }
    assert.ok(rows > 10000, `rows ${rows}`);
    assert.deepEqual(bad.slice(0, 10), []);
  });

  test("WEB-031 regression: the NFL Player Stats table's FPTS equals the career row, every position and stored season", () => {
    const players = JSON.parse(fs.readFileSync(path.join(DATA, "players.json"), "utf8"));
    const pos = new Map((Array.isArray(players) ? players : Object.values(players)).map((p) => [String(p.id), p.position]));
    let asb = null;
    for (const season of [2023, 2024, 2025, 2026]) {
      for (const P of ["QB", "RB", "WR", "TE"]) {
        const t = statsData.getStatsTable(P, season);
        if (!t) continue;
        const logs = gameLogs.loadGameLogs(season);
        const through = t.week ?? 18;
        let n = 0;
        for (const r of t.rows) {
          if (!r.playerId || !logs[r.playerId] || pos.get(String(r.playerId)) !== P) continue;
          const weeks = logs[r.playerId].filter((g) => g.week <= through);
          const s = metrics.careerSeasonTotals(season, active(weeks), P, "ppr", null);
          if (!s) continue;
          assert.equal(r.values.fantasyPoints, r1(s.points), `${season} ${P} ${r.name}`);
          if (season === 2024 && String(r.playerId) === "7547") asb = r.values.fantasyPoints;
          n++;
        }
        assert.ok(n > 20, `${season} ${P}: rows checked ${n}`);
      }
    }
    // The 2024 table states "weeks 1-17" (the fantasy season); the career row
    // counts all 18 weeks. 302.5 + his Week 18 (13.7) = 316.2.
    assert.equal(asb, 302.5, "St. Brown 2024, weeks 1-17");
    const wk18 = gameLogs.loadGameLogs(2024)["7547"].find((g) => g.week === 18);
    assert.equal(r1(asb + metrics.fpts(wk18, "ppr")), 316.2);
  });
});

// Re-check of WEB-036 (2026-11-27): the other seasons the audit named, a
// control season, and the weights the Stats footer states.
describe("WEB-036 re-check (2026-11-27)", () => {
  // Seasons and players the 11-18 fixture does not hold: the stored logs (historical, not refreshed).
  const stored = (season, id, position) => {
    const logs = JSON.parse(fs.readFileSync(path.join(DATA, "game_logs", `${season}.json`), "utf8"))[id];
    const s = metrics.careerSeasonTotals(season, active(logs), position, "ppr", null);
    return profile.careerStatRows([], [s], 9999)[0];
  };
  test("St. Brown 2021: 223.3 from the columns + 2 two-point catches (Weeks 6 and 17) = 227.3", () => {
    const r = row(2021, "7547", "WR");
    assert.equal(r1(visible(r, "WR")), 223.3);
    assert.deepEqual(profile.careerScoringExtras(r, "WR", "ppr").map((x) => [x.label, x.detail, x.points]), [["2-pt conversions", "2", 4]]);
    assert.equal(r1(r.points), 227.3);
    assert.deepEqual(LOGS["2021"]["7547"].filter((g) => g.stats.rec_2pt).map((g) => g.week), [6, 17]);
  });

  test("St. Brown 2023: the printed 330.9 is the house rule; the source's 331.9 adds a forced fumble (Week 14)", () => {
    const logs = LOGS["2023"]["7547"];
    const provider = logs.reduce((n, g) => n + g.stats.pts_ppr, 0);
    assert.equal(r1(provider), 331.9);
    assert.equal(r1(row(2023, "7547", "WR").points), 330.9);
    const wk14 = logs.find((g) => g.week === 14);
    assert.equal(wk14.stats.px?.idp_ff, 1);
    assert.equal(r1(wk14.stats.pts_ppr - metrics.fpts(wk14, "ppr")), 1);
  });

  test("control: St. Brown 2022 reconciles from its columns alone", () => {
    const r = stored(2022, "7547", "WR");
    assert.equal(r1(r.points), 267.6);
    assert.equal(r1(visible(r, "WR")), 267.6);
    assert.deepEqual(profile.careerScoringExtras(r, "WR", "ppr"), []);
  });

  test("Goff 2024: -1 per interception (12 INT), not the source's old -2", () => {
    const r = stored(2024, "3163", "QB");
    assert.equal(r.totals.passInt, 12);
    assert.equal(r1(r.points), 336.5);
    assert.equal(r1(r.points - r.totals.passInt), 324.5, "what -2 per interception would print");
  });
});
