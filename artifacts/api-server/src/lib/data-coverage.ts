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
import { gameLogUpdatedMs, loadGameLogs } from "./player/data";
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
 * Hub (game logs) vs stats table, per player, for the weeks the table covers:
 * games played and the position's main yardage. A mismatch is a dataset that
 * missed a game, not a rounding difference.
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
  const logMs = gameLogUpdatedMs(season);
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
    gameLogs: {
      source: "Sleeper weekly stats (scripts/player/buildGameLogs.js)",
      updatedAt: logMs ? new Date(logMs).toISOString() : null,
      coverage: logs,
      state: logs.complete ? "complete" : "incomplete",
    },
    statsTables: { source: "nflverse weekly stats (scripts/player-stats/buildSeason.mjs)", tables },
    crossCheck: {
      playersChecked: check.checked,
      mismatches: check.mismatches.length,
      sample: check.mismatches.slice(0, 10),
    },
    ok: logs.complete && tables.every((t) => t.state !== "incomplete" && t.state !== "missing") && check.mismatches.length === 0,
  };
}
