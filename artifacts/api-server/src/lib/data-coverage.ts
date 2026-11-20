/**
 * Dataset freshness and completeness, for /api/status and the checks
 * (audit WEB-032, 2026-11-18).
 *
 * The player hubs read the Sleeper game logs; the NFL Player Stats tables read
 * an nflverse build. On November 16 the tables held Week 10 without its Monday
 * game and still said "Weeks 1-10" (Justin Herbert: 8 games / 1,591 yards
 * there, 9 / 1,720 on his page). This reports, per dataset, what it actually
 * holds against the stored schedule's final games - never inferred from the
 * highest week number - and cross-checks the two player datasets.
 *
 * The coverage rule is the builder's (scripts/player-stats/coverage.mjs); a
 * test holds the two to the same answers.
 */

import fs from "node:fs";
import { dataPath } from "./data-dir";
import { loadGameLogs } from "./player/data";
import { buildInfo, datasetMeta } from "./dataset-meta";
import { getTeamByAbbreviation } from "./team/teams";
import { getStatsTable, type StatsPosition } from "./player-stats/stats-data";

export interface SlateGame {
  gameId: string;
  week: number;
  gameday: string;
  gametime: string | null;
  away: string;
  home: string;
  final: boolean;
}

export interface Coverage {
  throughWeek: number;
  partialWeek: number | null;
  gamesIncluded: number;
  gamesFinal: number;
  missing: string[];
  latestFinalGame: string | null;
  latestIncludedGame: string | null;
  complete: boolean;
}

const code = (t: string): string => getTeamByAbbreviation(t)?.code ?? t.toUpperCase();

/** The season's regular-season games from the stored slate (data/schedule/games.csv). */
export function slateGames(season: number, csv?: string): SlateGame[] {
  let text = csv;
  if (text === undefined) {
    try {
      text = fs.readFileSync(dataPath("schedule", "games.csv"), "utf8");
    } catch {
      return [];
    }
  }
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? "").split(",");
  const at = (k: string) => head.indexOf(k);
  const out: SlateGame[] = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith(`${season}_`)) continue;
    const c = line.split(",");
    if (c[at("game_type")] !== "REG") continue;
    const score = (k: string) => c[at(k)] !== "" && c[at(k)] !== "NA" && c[at(k)] !== undefined;
    out.push({
      gameId: c[at("game_id")]!,
      week: Number(c[at("week")]),
      gameday: c[at("gameday")] ?? "",
      gametime: c[at("gametime")] || null,
      away: code(c[at("away_team")] ?? ""),
      home: code(c[at("home_team")] ?? ""),
      final: score("away_score") && score("home_score"),
    });
  }
  return out;
}

/** What a dataset holding `present` ("week:TEAM") covers of the slate. */
export function coverage(games: SlateGame[], present: Set<string>, lastWeek = 18): Coverage {
  const finals = games.filter((g) => g.final && g.week <= lastWeek);
  const has = (g: SlateGame) => present.has(`${g.week}:${g.away}`) && present.has(`${g.week}:${g.home}`);
  const order = (a: SlateGame, b: SlateGame) => (a.gameday + (a.gametime ?? "")).localeCompare(b.gameday + (b.gametime ?? ""));
  const included = finals.filter(has).sort(order);
  const missing = finals.filter((g) => !has(g)).sort(order);
  const weeks = [...new Set(games.filter((g) => g.week <= lastWeek).map((g) => g.week))].sort((a, b) => a - b);
  let throughWeek = 0;
  for (const w of weeks) {
    if (games.filter((g) => g.week === w).every((g) => g.final && has(g))) throughWeek = w;
    else break;
  }
  const partialWeek = [...new Set(included.map((g) => g.week))].filter((w) => w > throughWeek).sort((a, b) => a - b)[0] ?? null;
  return {
    throughWeek,
    partialWeek,
    gamesIncluded: included.length,
    gamesFinal: finals.length,
    missing: missing.map((g) => g.gameId),
    latestFinalGame: finals.sort(order).at(-1)?.gameId ?? null,
    latestIncludedGame: included.at(-1)?.gameId ?? null,
    complete: missing.length === 0,
  };
}

/** The club-weeks the Sleeper game logs hold for a season. */
export function gameLogPresence(season: number): Set<string> {
  const out = new Set<string>();
  for (const entries of Object.values(loadGameLogs(season))) {
    for (const g of entries ?? []) if (g.team) out.add(`${g.week}:${code(g.team)}`);
  }
  return out;
}

export interface TotalsMismatch {
  position: StatsPosition;
  playerId: string;
  name: string;
  field: "games" | "yards";
  table: number;
  hub: number;
}

/**
 * Hub (Sleeper game logs) vs stats table (nflverse build), per player, for the
 * weeks the table covers: the position's main yardage (pass yards for QBs,
 * rush yards for RBs, receiving yards for WRs/TEs), the one figure the two
 * sources produce independently. A mismatch is a dataset that missed a game,
 * not a rounding difference. Fantasy points are NOT compared here: the
 * table's FPTS is re-scored from these same game logs (house-points.ts), so
 * they agree by construction, and tests/data-accuracy.test.mjs holds that.
 */
export function crossCheck(season: number): { checked: number; mismatches: TotalsMismatch[] } {
  const logs = loadGameLogs(season);
  const mismatches: TotalsMismatch[] = [];
  let checked = 0;
  const yardKey: Record<StatsPosition, [string, (s: Record<string, number | undefined>) => number]> = {
    QB: ["passingYards", (s) => s["pass_yd"] ?? 0],
    RB: ["rushYards", (s) => s["rush_yd"] ?? 0],
    WR: ["receivingYards", (s) => s["rec_yd"] ?? 0],
    TE: ["receivingYards", (s) => s["rec_yd"] ?? 0],
  };
  for (const position of ["QB", "RB", "WR", "TE"] as StatsPosition[]) {
    const table = getStatsTable(position, season);
    if (!table) continue;
    const through = table.coverage ? Math.max(table.coverage.throughWeek, table.coverage.partialWeek ?? 0) : table.week ?? 17;
    const [col, read] = yardKey[position];
    for (const row of table.rows) {
      if (!row.playerId) continue;
      const entries = (logs[row.playerId] ?? []).filter((g) => g.week <= through);
      if (!entries.length) continue;
      checked++;
      const stats = entries.map((g) => g.stats as unknown as Record<string, number | undefined>);
      const hubYards = stats.reduce((n, s) => n + read(s), 0);
      const tableYards = Number(row.values[col] ?? NaN);
      if (Number.isFinite(tableYards) && Math.abs(hubYards - tableYards) > 0.5) {
        mismatches.push({ position, playerId: row.playerId, name: row.name, field: "yards", table: tableYards, hub: hubYards });
      }
    }
  }
  return { checked, mismatches };
}

/** The per-dataset report /api/status serves. */
export function datasetReport(season: number, nowMs = Date.now()) {
  const games = slateGames(season);
  const logs = coverage(games, gameLogPresence(season));
  const logMeta = datasetMeta("game_logs", season);
  const statsMeta = datasetMeta("player_stats", season);
  const tables = (["QB", "RB", "WR", "TE"] as StatsPosition[]).map((position) => {
    const t = getStatsTable(position, season);
    return {
      position,
      updatedAt: t?.updatedAt ?? null,
      weeks: t?.weeks ?? null,
      coverage: t?.coverage ?? null,
      // A table built before coverage was recorded makes no claim to check.
      state: !t ? "missing" : !t.coverage ? "unverified" : t.coverage.complete ? "complete" : "incomplete",
    };
  });
  const check = crossCheck(season);
  return {
    season,
    checkedAt: new Date(nowMs).toISOString(),
    // Freshness from data/dataset-meta.json, never a file's mtime (Phase 1.1).
    gameLogs: {
      source: "Sleeper weekly stats (scripts/player/buildGameLogs.js)",
      lastIngestedAt: logMeta?.lastIngestedAt ?? null,
      lastAggregatedAt: logMeta?.lastAggregatedAt ?? null,
      lastCorrectionAt: logMeta?.lastCorrectionAt ?? null,
      lastCorrection: logMeta?.lastCorrection ?? null,
      lastFailureAt: logMeta?.lastFailureAt ?? null,
      lastFailure: logMeta?.lastFailure ?? null,
      provenance: logMeta?.provenance ?? null,
      latestCompletedGame: logs.latestIncludedGame,
      coverage: logs,
      state: logs.complete ? "complete" : "incomplete",
    },
    statsTables: {
      source: "nflverse weekly stats (scripts/player-stats/buildSeason.mjs)",
      lastIngestedAt: statsMeta?.lastIngestedAt ?? null,
      lastAggregatedAt: statsMeta?.lastAggregatedAt ?? null,
      lastFailureAt: statsMeta?.lastFailureAt ?? null,
      lastFailure: statsMeta?.lastFailure ?? null,
      provenance: statsMeta?.provenance ?? null,
      tables,
    },
    build: buildInfo(),
    crossCheck: {
      playersChecked: check.checked,
      mismatches: check.mismatches.length,
      sample: check.mismatches.slice(0, 10),
    },
    ok: logs.complete && tables.every((t) => t.state !== "incomplete" && t.state !== "missing") && check.mismatches.length === 0,
  };
}

/* ------------------------------------------------------------ data health */

/** Hours after kickoff a final game may be absent before it counts as missing. */
export const MISSING_GAME_GRACE_H = Number(process.env["DATA_ALERT_GAME_GRACE_H"]) > 0 ? Number(process.env["DATA_ALERT_GAME_GRACE_H"]) : 36;
/** In season, a last successful ingestion older than this is stale (the refresh is a weekly hand-run chain). */
export const STALE_INGEST_H = Number(process.env["DATA_ALERT_MAX_AGE_H"]) > 0 ? Number(process.env["DATA_ALERT_MAX_AGE_H"]) : 8 * 24;

function kickoffMs(g: SlateGame): number {
  // Eastern time; -05:00 in the season's back half, a one-hour error at most earlier.
  const ms = Date.parse(`${g.gameday}T${g.gametime ?? "13:00"}:00-05:00`);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The alerting verdict for the player checks in GET /api/data/health (routes/health.ts, Phase 1.1): unhealthy only
 * for a condition a person should act on, so an uptime monitor can page on a
 * 503 the way it does for /api/ingest/health. A final game is "missing" only
 * once MISSING_GAME_GRACE_H has passed since kickoff, so Monday night's game
 * does not page before Tuesday's refresh has had its chance.
 */
export function dataHealth(
  season: number,
  nowMs: number,
  inputs: {
    report?: ReturnType<typeof datasetReport>;
    games?: SlateGame[];
    unattributedScoring?: number;
  } = {},
): { ok: boolean; reasons: string[] } {
  const report = inputs.report ?? datasetReport(season, nowMs);
  const games = inputs.games ?? slateGames(season);
  const due = new Set(games.filter((g) => g.final && nowMs - kickoffMs(g) > MISSING_GAME_GRACE_H * 3600_000).map((g) => g.gameId));
  const reasons: string[] = [];
  const overdue = (missing: string[] | undefined | null) => (missing ?? []).filter((id) => due.has(id));
  const logMissing = overdue(report.gameLogs.coverage.missing);
  if (logMissing.length) reasons.push(`game logs missing final games: ${logMissing.join(", ")}`);
  for (const t of report.statsTables.tables) {
    if (t.state === "missing") reasons.push(`${t.position} stats table missing`);
    const m = overdue(t.coverage?.missing);
    if (m.length) reasons.push(`${t.position} stats table missing final games: ${m.join(", ")}`);
  }
  if (report.crossCheck.mismatches > 0) reasons.push(`${report.crossCheck.mismatches} player totals differ between player pages and stats tables`);
  const inSeason = games.some((g) => g.final) && games.some((g) => !g.final);
  const age = (at: string | null) => (at ? nowMs - Date.parse(at) : Infinity);
  if (inSeason && age(report.gameLogs.lastIngestedAt) > STALE_INGEST_H * 3600_000) reasons.push(`game logs not ingested successfully in ${STALE_INGEST_H}h`);
  if (inSeason && age(report.statsTables.lastIngestedAt) > STALE_INGEST_H * 3600_000) reasons.push(`stats tables not ingested successfully in ${STALE_INGEST_H}h`);
  const newer = (fail: string | null, ok: string | null) => fail && (!ok || Date.parse(fail) > Date.parse(ok));
  if (newer(report.gameLogs.lastFailureAt, report.gameLogs.lastIngestedAt)) reasons.push(`game-log ingestion failed: ${report.gameLogs.lastFailure}`);
  if (newer(report.statsTables.lastFailureAt, report.statsTables.lastIngestedAt)) reasons.push(`stats-table build failed: ${report.statsTables.lastFailure}`);
  if ((inputs.unattributedScoring ?? 0) > 0) reasons.push(`${inputs.unattributedScoring} ${season} game totals differ from the scoring rules with no known cause`);
  return { ok: reasons.length === 0, reasons };
}
