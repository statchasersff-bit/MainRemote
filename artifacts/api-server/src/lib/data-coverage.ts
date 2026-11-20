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

/* ---------------------------------------- derived (hand-run) team datasets */

/**
 * The hand-run files the team pages and the player Outlook read
 * (2026-11-20, the SEO investigation's defect list): none of them is covered
 * by the game-log / stats-table checks above, the daily chain that used to
 * rebuild them has been off since 2026-10-04, and a lagging one prints last
 * week's numbers under this week's dates ("Through 9 games" on a Week 10
 * page). Each states the week it covers; the depth-chart snapshot states only
 * when it ran.
 */
export interface DerivedFile {
  name: string;
  /** The week the file says it covers; null when it records none. */
  throughWeek: number | null;
  /** When it was last built or refreshed (ISO); null when unknown. */
  refreshedAt: string | null;
  /** The file is absent or unreadable. */
  missing?: boolean;
}

function readJson(...parts: string[]): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(dataPath(...parts), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** What each derived file on disk says it covers. */
export function derivedFiles(season: number): DerivedFile[] {
  const out: DerivedFile[] = [];
  const team = (file: string, name: string) => {
    const d = readJson("team", `${file}_${season}.json`);
    const snap = (d?.["snapshot"] ?? null) as Record<string, unknown> | null;
    out.push({
      name,
      throughWeek: num(d?.["throughWeek"]) ?? num(snap?.["throughWeek"]),
      refreshedAt: str(d?.["builtAt"]),
      missing: d === null,
    });
  };
  team("usage", "team usage");
  team("efficiency", "team stats (efficiency)");
  team("coaching", "coaching tendencies");
  for (const pos of ["qb", "rb", "wr", "te"]) {
    const d = readJson("player", "advanced_stats", `${pos}_${season}.json`);
    out.push({ name: `${pos.toUpperCase()} advanced stats`, throughWeek: num(d?.["week"]), refreshedAt: str(d?.["updated_at"]), missing: d === null });
  }
  const depth = readJson("depth-charts", "statchasers", "meta.json");
  out.push({ name: "depth-chart snapshot", throughWeek: null, refreshedAt: str(depth?.["last_refreshed"]), missing: depth === null });
  return out;
}

/**
 * The last week the schedule says is over: every game of it and of every
 * week before it final, and its last kickoff at least MISSING_GAME_GRACE_H
 * ago (the same grace as a missing game, so Monday night does not page
 * before Tuesday's refresh). 0 before the first such week.
 */
export function completedWeek(games: SlateGame[], nowMs: number): number {
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  let done = 0;
  for (const w of weeks) {
    const of = games.filter((g) => g.week === w);
    const last = Math.max(...of.map(kickoffMs));
    if (!of.every((g) => g.final) || nowMs - last < MISSING_GAME_GRACE_H * 3600_000) break;
    done = w;
  }
  return done;
}

/** Reasons a derived file is behind the schedule, or stale in season. */
export function derivedReasons(files: DerivedFile[], games: SlateGame[], nowMs: number): string[] {
  const reasons: string[] = [];
  const complete = completedWeek(games, nowMs);
  const inSeason = games.some((g) => g.final) && games.some((g) => !g.final);
  for (const f of files) {
    if (f.missing) {
      if (complete > 0) reasons.push(`${f.name} file missing`);
      continue;
    }
    if (f.throughWeek !== null && complete > 0 && f.throughWeek < complete) {
      reasons.push(`${f.name} covers through Week ${f.throughWeek}; the schedule is complete through Week ${complete}`);
    }
    if (f.throughWeek === null && inSeason) {
      const at = f.refreshedAt ? Date.parse(f.refreshedAt) : NaN;
      if (!Number.isFinite(at)) reasons.push(`${f.name} records no refresh time`);
      else if (nowMs - at > STALE_INGEST_H * 3600_000) reasons.push(`${f.name} last refreshed ${Math.floor((nowMs - at) / 86_400_000)} days ago`);
    }
  }
  return reasons;
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
    /**
     * The hand-run team / advanced files (derivedFiles). Read from disk only
     * when the report is too: a test that injects a report is testing the
     * player checks, and passes these explicitly to test the derived ones.
     */
    derived?: DerivedFile[];
  } = {},
): { ok: boolean; reasons: string[] } {
  const report = inputs.report ?? datasetReport(season, nowMs);
  const games = inputs.games ?? slateGames(season);
  const derived = inputs.derived ?? (inputs.report ? [] : derivedFiles(season));
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
  reasons.push(...derivedReasons(derived, games, nowMs));
  return { ok: reasons.length === 0, reasons };
}
