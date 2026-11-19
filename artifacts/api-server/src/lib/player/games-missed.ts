/**
 * Games played and missed in one season - the one definition every player
 * component uses (audit WEB-039, 2026-11-18: Isiah Pacheco's page said 2, 4,
 * 5 and 9 games missed, from four different counts).
 *
 * The rule:
 *
 *   - A TEAM GAME is a week his club has a completed game in the stored game
 *     logs (the same per-club week list the matchup availability rule reads).
 *     Byes and unplayed weeks are not team games.
 *   - His club in a week is his own log row's team. For a week with no row,
 *     the nearest row's team (earlier first), else his current team - but a
 *     week before his first row counts only if an injury or reserve record
 *     covers it, so a player who joined in Week 8 is not charged Weeks 1-7.
 *   - PLAYED: a log row with a snap or Sleeper's game-played flag.
 *   - MISSED TO INJURY: a team game not played that an injury entry's span
 *     covers (its first week through first week + its games missed), which is
 *     how the injury history is built (scripts/player/buildInjuryHistory.mjs).
 *   - NOT PLAYED, REASON UNKNOWN: every other team game not played. Never
 *     called an injury: a healthy scratch, a suspension or a personal matter
 *     looks the same in a box score.
 *
 * Pure apart from reading the stored logs.
 */

import { loadGameLogs } from "./data";
import type { NflInjuryEntry } from "./injury";
import type { GameLogEntry } from "./types";

export interface SeasonAvailability {
  season: number;
  /** The last completed week any club has played. */
  throughWeek: number;
  /** His club's completed games while he was on it. */
  teamGames: number;
  played: number;
  /** Team games not played, for any reason. */
  notPlayed: number;
  missedInjury: number;
  /** Not played and no injury record covers it. */
  notPlayedOther: number;
  weeksMissedInjury: number[];
  weeksNotPlayedOther: number[];
}

const clubWeeksCache = new WeakMap<object, Map<string, Set<number>>>();

/** Every club's completed game weeks, from the logs. */
function clubWeeks(season: number, injected?: Record<string, GameLogEntry[]>): Map<string, Set<number>> {
  const logs = injected ?? loadGameLogs(season);
  const hit = clubWeeksCache.get(logs);
  if (hit) return hit;
  const out = new Map<string, Set<number>>();
  for (const entries of Object.values(logs)) {
    for (const g of entries ?? []) {
      if (!g.team) continue;
      const code = g.team.toUpperCase();
      if (!out.has(code)) out.set(code, new Set());
      out.get(code)!.add(g.week);
    }
  }
  clubWeeksCache.set(logs, out);
  return out;
}

function playedRow(stats: Record<string, unknown> | undefined): boolean {
  if (!stats) return false;
  const n = (k: string): number => (typeof stats[k] === "number" ? (stats[k] as number) : 0);
  return n("off_snp") > 0 || n("def_snp") > 0 || n("st_snp") > 0 || n("gp") > 0;
}

export function seasonAvailability(input: {
  season: number;
  playerId: string;
  /** His current club code, for weeks no log row names. */
  currentTeam: string | null;
  injuries: NflInjuryEntry[];
  /** Count only weeks up to this one (default: every completed week). */
  throughWeek?: number;
  /** The season's logs, for the tests; the stored file by default. */
  logs?: Record<string, GameLogEntry[]>;
}): SeasonAvailability {
  const { season, playerId } = input;
  const clubs = clubWeeks(season, input.logs);
  let through = 0;
  for (const weeks of clubs.values()) for (const w of weeks) through = Math.max(through, w);
  if (input.throughWeek != null) through = Math.min(through, input.throughWeek);

  const rows = ((input.logs ?? loadGameLogs(season))[playerId] ?? []).slice().sort((a, b) => a.week - b.week);
  const rowByWeek = new Map(rows.map((r) => [r.week, r]));
  const firstRow = rows[0]?.week ?? null;

  const injuryWeeks = new Set<number>();
  for (const e of input.injuries) {
    if (e.season !== season || typeof e.week !== "number") continue;
    for (let w = e.week; w <= e.week + (e.gamesMissed ?? 0); w += 1) injuryWeeks.add(w);
    for (const r of e.reports ?? []) injuryWeeks.add(r.week);
  }

  const teamFor = (week: number): string | null => {
    const own = rowByWeek.get(week)?.team;
    if (own) return own.toUpperCase();
    const before = rows.filter((r) => r.week < week && r.team).pop();
    if (before?.team) return before.team.toUpperCase();
    const after = rows.find((r) => r.week > week && r.team);
    if (after?.team) return after.team.toUpperCase();
    return input.currentTeam ? input.currentTeam.toUpperCase() : null;
  };

  const out: SeasonAvailability = {
    season,
    throughWeek: through,
    teamGames: 0,
    played: 0,
    notPlayed: 0,
    missedInjury: 0,
    notPlayedOther: 0,
    weeksMissedInjury: [],
    weeksNotPlayedOther: [],
  };
  for (let w = 1; w <= through; w += 1) {
    const club = teamFor(w);
    if (!club || !clubs.get(club)?.has(w)) continue;
    const row = rowByWeek.get(w);
    // Before his first row: on the roster only if a record says so.
    if (!row && (firstRow === null || w < firstRow) && !injuryWeeks.has(w)) continue;
    out.teamGames += 1;
    if (row && playedRow(row.stats as unknown as Record<string, unknown>)) {
      out.played += 1;
      continue;
    }
    out.notPlayed += 1;
    if (injuryWeeks.has(w)) {
      out.missedInjury += 1;
      out.weeksMissedInjury.push(w);
    } else {
      out.notPlayedOther += 1;
      out.weeksNotPlayedOther.push(w);
    }
  }
  return out;
}
