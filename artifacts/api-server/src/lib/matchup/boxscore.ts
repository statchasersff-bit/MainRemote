/**
 * The box score for one completed game, from ESPN's summary document.
 *
 * This is what turns a matchup page from "10–13" into a game page: the
 * quarter-by-quarter line, and the handful of team figures that say how the
 * result happened rather than what it was. Neither is derivable from anything
 * the app already holds — the schedule carries a final score and nothing else,
 * and the Sleeper logs are per player — so this is a genuinely new upstream and
 * it is treated like the other one.
 *
 * Treated like one means: keyed on ESPN's own event id, cached hard because a
 * finished game never changes again, timed out, and allowed to fail on its own.
 * Every section built on this renders only when the document loads and is
 * absent when it does not; nothing here has a fallback that invents a figure,
 * because a made-up yards-per-play is worse than a missing block.
 *
 * Only the fields actually rendered are parsed. ESPN's summary is a half-megabyte
 * document carrying drives, win probability, odds and articles; reading four
 * objects out of it and dropping the rest is deliberate.
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "../team/cache";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";

/** One side's scoring by period, and the final. */
export interface BoxscoreLine {
  /** Upstream's abbreviation, kept for a side the team table cannot resolve. */
  abbr: string;
  team: NflTeam | null;
  /** Points in each period, in order. Length is the periods actually played. */
  periods: number[];
  total: number;
}

/** A third-down or red-zone line: "5-13". */
export interface BoxAttempt {
  made: number;
  attempts: number;
  /** Rounded percentage, or null when there were no attempts to divide by. */
  percent: number | null;
}

/**
 * The team figures the page compares.
 *
 * Every one of them is optional, because ESPN omits a statistic rather than
 * sending a zero for it, and a missing turnover count is not zero turnovers.
 * The renderer skips a row that neither side has.
 */
export interface BoxTeamStats {
  plays: number | null;
  totalYards: number | null;
  yardsPerPlay: number | null;
  passYards: number | null;
  rushYards: number | null;
  turnovers: number | null;
  firstDowns: number | null;
  thirdDown: BoxAttempt | null;
  redZone: BoxAttempt | null;
  penalties: BoxAttempt | null;
  /** Time of possession in seconds, from "29:55". */
  possessionSeconds: number | null;
}

export interface GameBoxscore {
  eventId: string;
  /** How many periods the line covers — 4, or 5 when the game went to overtime. */
  periodCount: number;
  /** Away first, home second, the order every scoreboard reads in. */
  lines: BoxscoreLine[];
  /** Keyed by upstream abbreviation, upper case. */
  stats: Record<string, BoxTeamStats>;
}

/* ------------------------------------------------------------- upstream */

interface EspnStatistic {
  name?: string;
  displayValue?: string;
}

interface EspnSummary {
  header?: {
    competitions?: Array<{
      status?: { type?: { completed?: boolean } };
      competitors?: Array<{
        homeAway?: string;
        score?: string | number;
        team?: { abbreviation?: string };
        linescores?: Array<{ value?: number; displayValue?: string }>;
      }>;
    }>;
  };
  boxscore?: {
    teams?: Array<{
      team?: { abbreviation?: string };
      statistics?: EspnStatistic[];
    }>;
  };
}

function toNumber(raw: string | number | undefined | null): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** "5-13" as made and attempted. Also reads the penalties line, "9-77". */
function attempt(raw: string | undefined): BoxAttempt | null {
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 2) return null;
  const made = toNumber(parts[0]);
  const attempts = toNumber(parts[1]);
  if (made === null || attempts === null) return null;
  return {
    made,
    attempts,
    percent: attempts > 0 ? Math.round((made / attempts) * 100) : null,
  };
}

/** "29:55" as seconds. */
function clockSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const minutes = toNumber(parts[0]);
  const seconds = toNumber(parts[1]);
  if (minutes === null || seconds === null) return null;
  return minutes * 60 + seconds;
}

function statsOf(entries: EspnStatistic[] | undefined): BoxTeamStats {
  const by = new Map<string, string>();
  for (const entry of entries ?? []) {
    // First value wins: ESPN sends `interceptions` twice in a team's list —
    // once for the pass defense and once inside the turnover breakdown — and
    // the later one would overwrite a field the earlier one got right.
    if (entry.name && entry.displayValue && !by.has(entry.name)) {
      by.set(entry.name, entry.displayValue);
    }
  }
  const value = (key: string): number | null => toNumber(by.get(key));
  return {
    plays: value("totalOffensivePlays"),
    totalYards: value("totalYards"),
    yardsPerPlay: value("yardsPerPlay"),
    passYards: value("netPassingYards"),
    rushYards: value("rushingYards"),
    turnovers: value("turnovers"),
    firstDowns: value("firstDowns"),
    thirdDown: attempt(by.get("thirdDownEff")),
    redZone: attempt(by.get("redZoneAttempts")),
    penalties: attempt(by.get("totalPenaltiesYards")),
    possessionSeconds: clockSeconds(by.get("possessionTime")),
  };
}

function parse(eventId: string, payload: EspnSummary): GameBoxscore {
  const competition = payload.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  if (competition?.status?.type?.completed !== true) {
    // A game still being played has a partial line and partial team stats, and
    // this page renders the postgame layout off the presence of a box score.
    // Throwing keeps it out of the cache until the game is actually over.
    throw new Error(`ESPN event ${eventId} is not final`);
  }

  const lines: BoxscoreLine[] = [];
  for (const side of ["away", "home"] as const) {
    const competitor = competitors.find((c) => c.homeAway === side);
    if (!competitor) continue;
    const abbr = competitor.team?.abbreviation?.trim().toUpperCase() ?? "";
    const periods = (competitor.linescores ?? [])
      .map((score) => toNumber(score.value ?? score.displayValue))
      .filter((n): n is number => n !== null);
    const total = toNumber(competitor.score);
    if (!abbr || periods.length === 0 || total === null) continue;
    lines.push({ abbr, team: getTeamByAbbreviation(abbr), periods, total });
  }
  if (lines.length !== 2) {
    throw new Error(`ESPN event ${eventId} has no usable line score`);
  }

  const stats: Record<string, BoxTeamStats> = {};
  for (const entry of payload.boxscore?.teams ?? []) {
    const abbr = entry.team?.abbreviation?.trim().toUpperCase();
    if (!abbr) continue;
    stats[abbr] = statsOf(entry.statistics);
  }

  return {
    eventId,
    periodCount: Math.max(...lines.map((line) => line.periods.length)),
    lines,
    stats,
  };
}

/**
 * Twelve hours, and the value is immutable anyway.
 *
 * A final game's box score is the one thing on these pages that can never
 * change, so the TTL is really only there to bound how long a process holds a
 * key it will never read again. The error backoff matters more: ESPN has
 * refused this host before, and a page view per failed request is how one
 * blocked upstream becomes a slow site.
 */
const cache = createKeyedCache<GameBoxscore>({
  name: "espn-boxscore",
  ttlMs: 12 * 60 * 60 * 1000,
  timeoutMs: 6_000,
  errorBackoffMs: 10 * 60 * 1000,
  load: async (eventId, signal) => {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
      `?event=${encodeURIComponent(eventId)}`;
    return parse(eventId, await fetchJson<EspnSummary>(url, signal, TEAM_USER_AGENT));
  },
});

/** The box score for a finished game, or null when it cannot be had. */
export async function getGameBoxscore(
  eventId: string | null,
): Promise<GameBoxscore | null> {
  if (!eventId) return null;
  return cache.ensure(eventId).catch(() => null);
}

/** One side of a box score by team, or null. */
export function boxLineFor(
  box: GameBoxscore | null,
  team: NflTeam,
): BoxscoreLine | null {
  if (!box) return null;
  return (
    box.lines.find(
      (line) =>
        line.team?.abbreviation === team.abbreviation ||
        line.abbr === team.espnAbbr ||
        line.abbr === team.abbreviation.toUpperCase(),
    ) ?? null
  );
}

/** One side's team figures by team, or null. */
export function boxStatsFor(
  box: GameBoxscore | null,
  team: NflTeam,
): BoxTeamStats | null {
  const line = boxLineFor(box, team);
  if (!box || !line) return null;
  return box.stats[line.abbr] ?? null;
}

/** "29:55" from a possession figure in seconds. */
export function formatClock(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** "Q1"…"Q4", then "OT" and "2OT" for anything past regulation. */
export function periodLabel(index: number): string {
  if (index < 4) return `Q${index + 1}`;
  return index === 4 ? "OT" : `${index - 3}OT`;
}
