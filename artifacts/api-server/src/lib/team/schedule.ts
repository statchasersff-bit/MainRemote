/**
 * One team's schedule, read out of the league slate this site already holds.
 *
 * Until 2026-10-20 this module asked ESPN for each club's schedule document -
 * thirty-two requests to an endpoint that 403s this host for hours at a time,
 * for facts the NFL schedule tool had already loaded once for the whole
 * league from nflverse (lib/schedule/schedule-data.ts). Mak's rule: stop
 * fetching what we already have, and never again for a game that has been
 * played. So a team's schedule is now its rows of that slate, reshaped into
 * the form every hub, matchup and player page was already reading, and the
 * postseason is the same file's playoff rows.
 *
 * What changed underneath and what did not:
 *
 * - The slate's live layer (network, in-progress score) is still ESPN's
 *   scoreboard, best-effort, one request per OPEN week rather than per team,
 *   and never for a week nflverse has closed with final scores.
 * - `espnEventId` comes from nflverse's own `espn` column, so the box score
 *   lookup is unchanged.
 * - The bye week is DERIVED, not fetched: a team plays 17 games across 18
 *   weeks, so the week number missing from its rows is the bye, and it is
 *   reported as null whenever the rows do not have exactly one gap.
 * - Nothing is invented. A game whose window the league has not set carries
 *   `kickoffMs: null` with `timeConfirmed` and `dateConfirmed` false, and
 *   every reader of this shape prints TBD for it. The slate decides which
 *   games those are (lib/schedule/schedule-data.ts, resolveKickoff) - this
 *   module only carries the answer, so the table, the next-game card, the
 *   FAQ and the structured data cannot disagree about one game.
 * - A neutral-site game is neither home nor away. `homeAway` still names the
 *   designated host side (the matchup addresses and the box score are keyed
 *   on it), and `site` is what the counts and the copy read.
 */

import {
  getPostseason,
  getSeasonSlate,
  TOTAL_WEEKS,
  type GameStatus as SlateStatus,
  type KickoffSource,
  type PostseasonRound,
  type ScheduleGame as SlateGame,
} from "../schedule/schedule-data";
import type { NflTeam } from "./teams";

export type SeasonType = "regular" | "post";

export type GameStatus = SlateStatus;

/** Where a game is played, from this team's side of it. */
export type GameSite = "home" | "away" | "neutral";

export interface ScheduleGame {
  week: number;
  /**
   * Which half of the season this game belongs to.
   *
   * Week numbers are only unique WITHIN one of these: the postseason is
   * numbered from 1 again (ESPN's numbering, which the matchup addresses were
   * built on), so a season has two week 1s and anything that identifies a
   * game by week alone has to carry this as well.
   */
  seasonType: SeasonType;
  /** "Week 4", or "Super Bowl" - what to print where a week number would go. */
  weekLabel: string;
  /**
   * ESPN's own id for this game, which is what the box score is keyed by.
   *
   * Null whenever the feed does not carry one. It is the only handle we have
   * on `summary?event=`, so a game without it simply has no box score - see
   * lib/matchup/boxscore.ts, which is built to render nothing in that case.
   */
  espnEventId: string | null;
  /** The slate's own id, e.g. "2026_04_IND_WAS". */
  gameId: string;
  /** Kickoff in epoch ms, or null until a source has confirmed both date and time. */
  kickoffMs: number | null;
  /** True when a trusted source has set the kickoff time. */
  timeConfirmed: boolean;
  /** True when the calendar day is set. False with `timeConfirmed` false is "Date/Time TBD". */
  dateConfirmed: boolean;
  kickoffSource: KickoffSource;
  /**
   * Which side of the fixture this team is on - the designated home team or
   * the visitor. A neutral-site game still has a designated host, and this
   * says who it is; it does NOT say the game is at home. Read `site` for that.
   */
  homeAway: "home" | "away";
  /** home, away, or neutral - what the counts, the chips and the copy use. */
  site: GameSite;
  neutralSite: boolean;
  /** Resolved through the canonical team table; null if the feed names a team we don't know. */
  opponent: NflTeam | null;
  opponentName: string;
  venue: string | null;
  venueCity: string | null;
  /** The venue's state. The feed does not say, so this is always null now. */
  venueState?: string | null;
  /** True when the game is played outside the United States. */
  international: boolean;
  /** True when the opponent is in the same division. */
  divisional: boolean;
  /** Normalized broadcaster: "FOX", "NFL Network", "ESPN / ABC"; null until assigned. */
  network: string | null;
  status: GameStatus;
  /** ESPN's status line while live or final ("Q3 5:23", "Final/OT"), else null. */
  statusDetail: string | null;
  /** Populated only for completed games. */
  result: { outcome: "W" | "L" | "T"; teamScore: number; opponentScore: number } | null;
}

export interface TeamSchedule {
  season: number;
  games: ScheduleGame[];
  /** Week number with no game, or null when it can't be established. */
  byeWeek: number | null;
  fetchedAt: number;
  /**
   * When the schedule's sources last answered - the slate fetch or the live
   * layer's last successful sweep. The page's "Updated" stamp.
   */
  updatedAtMs: number;
  /**
   * Fingerprint of every rendered fact (dates, times, scores, networks,
   * statuses). The render cache keys on it, so a score or a flex that lands
   * in the live layer re-renders the page without waiting for the slate's
   * six-hour clock.
   */
  version: string;
}

/**
 * ESPN's postseason week numbers, which the matchup pages' addresses use
 * (`2025-wild-card`, see lib/matchup/pair.ts). Week 4 is the Pro Bowl, which
 * nflverse does not list and which is not a meeting between two teams.
 */
const ROUND_WEEK: Record<PostseasonRound, number> = { WC: 1, DIV: 2, CON: 3, SB: 5 };

const ROUND_LABEL: Record<PostseasonRound, string> = {
  WC: "Wild Card",
  DIV: "Divisional Round",
  CON: "Conference Championship",
  SB: "Super Bowl",
};

/**
 * The one gap in the week numbers, or null.
 *
 * Null rather than a guess whenever the data does not support exactly one
 * answer - a short slate (an unpublished schedule, a partial file) would
 * otherwise produce several "missing" weeks and we would print one of them as
 * the bye.
 */
export function deriveByeWeek(weeks: number[], totalWeeks: number): number | null {
  const played = new Set(weeks);
  const missing: number[] = [];
  for (let week = 1; week <= totalWeeks; week += 1) {
    if (!played.has(week)) missing.push(week);
  }
  return missing.length === 1 ? (missing[0] as number) : null;
}

/** One slate row as this team saw it. Null when the team was not in it. */
function fromSlate(
  team: NflTeam,
  game: SlateGame,
  seasonType: SeasonType,
  week: number,
  weekLabel: string,
): ScheduleGame | null {
  const home = game.home?.abbreviation === team.abbreviation;
  const away = game.away?.abbreviation === team.abbreviation;
  if (!home && !away) return null;

  const opponent = home ? game.away : game.home;
  const opponentCode = home ? game.awayCode : game.homeCode;
  const teamScore = home ? game.homeScore : game.awayScore;
  const opponentScore = home ? game.awayScore : game.homeScore;
  const completed = game.status === "final";

  return {
    week,
    seasonType,
    weekLabel,
    espnEventId: game.espnId,
    gameId: game.id,
    kickoffMs: game.kickoffMs,
    timeConfirmed: game.timeConfirmed,
    dateConfirmed: game.dateConfirmed,
    kickoffSource: game.kickoffSource,
    homeAway: home ? "home" : "away",
    site: game.neutralSite ? "neutral" : home ? "home" : "away",
    neutralSite: game.neutralSite,
    opponent,
    opponentName: opponent?.fullName ?? opponentCode ?? "Opponent TBD",
    venue: game.stadium,
    venueCity: game.location,
    venueState: null,
    international: game.international,
    divisional: game.divisional,
    network: game.network,
    status: game.status,
    statusDetail: game.statusDetail,
    result:
      completed && teamScore !== null && opponentScore !== null
        ? {
            outcome:
              teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T",
            teamScore,
            opponentScore,
          }
        : null,
  };
}

/** One team's regular season, or null when the slate has none for that year. */
export async function getTeamSchedule(
  team: NflTeam,
  season: number,
): Promise<TeamSchedule | null> {
  const slate = await getSeasonSlate(season);
  if (!slate) return null;

  const games: ScheduleGame[] = [];
  for (const game of slate.games) {
    const own = fromSlate(team, game, "regular", game.week, `Week ${game.week}`);
    if (own) games.push(own);
  }
  if (games.length === 0) return null;
  games.sort((a, b) => a.week - b.week);

  // 17 games in an 18-week season. Derived from the slate's own span so a
  // future schedule expansion doesn't need this constant edited.
  const lastWeek = Math.max(
    TOTAL_WEEKS,
    (games[games.length - 1] as ScheduleGame).week,
    games.length + 1,
  );

  return {
    season,
    games,
    byeWeek: deriveByeWeek(
      games.map((g) => g.week),
      lastWeek,
    ),
    fetchedAt: slate.fetchedAt,
    updatedAtMs: slate.updatedAtMs,
    version: slate.version,
  };
}

/**
 * One team's postseason, which is empty for most teams in most years.
 *
 * Separate from getTeamSchedule() rather than merged into it, because almost
 * everything that reads a schedule means the regular season by it: the bye week
 * is derived from an unbroken run of weeks, "Week 5" means one thing in a
 * seventeen-game schedule and another in a five-game bracket, and the team
 * page's own schedule table is a regular-season table. The matchup page's
 * head-to-head is the caller that genuinely wants both.
 *
 * An empty schedule rather than null for a team that did not make it: that is
 * the correct answer for two thirds of the league, not a failed read.
 */
export async function getTeamPostseason(
  team: NflTeam,
  season: number,
): Promise<TeamSchedule | null> {
  const rounds = await getPostseason(season);
  const games: ScheduleGame[] = [];
  for (const game of rounds) {
    const own = fromSlate(
      team,
      game,
      "post",
      ROUND_WEEK[game.round],
      ROUND_LABEL[game.round],
    );
    if (own) games.push(own);
  }
  games.sort((a, b) => a.week - b.week);
  const now = Date.now();
  return {
    season,
    games,
    // A bye is a regular-season fact. The postseason has gaps by construction.
    byeWeek: null,
    fetchedAt: now,
    updatedAtMs: now,
    version: games
      .map((g) => `${g.gameId}:${g.status}:${g.result?.teamScore ?? ""}-${g.result?.opponentScore ?? ""}`)
      .join("|"),
  };
}

/**
 * The next few games, from the perspective of `now`.
 *
 * "Next" means not yet final - a game in progress is still the next thing a
 * reader cares about, and a Sunday-evening visitor should not be shown Week 5
 * while Week 4 is still being played.
 */
export function upcomingGames(
  schedule: TeamSchedule | null,
  now: number,
  count: number,
): ScheduleGame[] {
  if (!schedule) return [];
  const upcoming = schedule.games.filter(
    (game) =>
      game.status !== "final" &&
      (game.kickoffMs === null || game.kickoffMs + 4 * 60 * 60 * 1000 > now),
  );
  // Season over: fall back to the tail of the schedule rather than an empty
  // section that reads like a data failure.
  return (upcoming.length ? upcoming : schedule.games.slice(-count)).slice(0, count);
}

/* ----------------------------------------------------------- the readings */

/**
 * How long a game with no live layer behind it is still "the next game".
 *
 * ESPN marks a final within minutes; nflverse posts one hours later. A game
 * the live layer never saw is treated as over four hours after kickoff.
 */
export const RECENTLY_ENDED_MS = 4 * 60 * 60 * 1000;

/** Played, or being played: anything that is not final and not written off. */
function isPending(game: ScheduleGame, now: number): boolean {
  if (game.status === "final" || game.status === "canceled") return false;
  if (game.status === "live" || game.status === "postponed") return true;
  return game.kickoffMs === null || game.kickoffMs + RECENTLY_ENDED_MS > now;
}

/**
 * The next game, strictly: the earliest game not yet final.
 *
 * A game in progress is the next game - a reader on Sunday afternoon is
 * asking about the one being played. A game that has finished is never the
 * next game, however recently, which is what keeps a "next game" FAQ from
 * going stale the moment a final lands. Null once the season has been
 * played out; this never falls back to the tail of the schedule the way
 * upcomingGames() does for the card strip.
 */
export function nextGame(schedule: TeamSchedule | null, now: number): ScheduleGame | null {
  if (!schedule) return null;
  // Games are in week order; a TBD game (no kickoff) sorts by its week, which
  // is the only order the league has given it.
  return schedule.games.find((game) => isPending(game, now)) ?? null;
}

/** The latest completed game, or null before the first final. */
export function lastResult(schedule: TeamSchedule | null): ScheduleGame | null {
  if (!schedule) return null;
  for (let i = schedule.games.length - 1; i >= 0; i -= 1) {
    const game = schedule.games[i] as ScheduleGame;
    if (game.status === "final" && game.result) return game;
  }
  return null;
}

/**
 * The season in two halves: what has been played and what has not.
 *
 * One pass over one list, so a game is in exactly one half. "Played" means
 * final with a result; a game in progress is on the remaining side until its
 * final lands, because a result column cannot show a score it does not have.
 */
export function splitSchedule(schedule: TeamSchedule): {
  results: ScheduleGame[];
  remaining: ScheduleGame[];
} {
  const results: ScheduleGame[] = [];
  const remaining: ScheduleGame[] = [];
  for (const game of schedule.games) {
    if (game.status === "final" && game.result) results.push(game);
    else remaining.push(game);
  }
  return { results, remaining };
}

export interface SiteCounts {
  games: number;
  home: number;
  away: number;
  neutral: number;
}

/** Home, away and neutral, which add up to the games - never 8 + 9 = 17 with a London game in it. */
export function siteCounts(games: readonly ScheduleGame[]): SiteCounts {
  const counts: SiteCounts = { games: games.length, home: 0, away: 0, neutral: 0 };
  for (const game of games) counts[game.site] += 1;
  return counts;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  /** "5-3", or "5-3-1" with a tie. */
  text: string;
  played: number;
}

/** The record the completed games add up to, in schedule order up to and including `through`. */
export function recordThrough(
  games: readonly ScheduleGame[],
  through?: ScheduleGame,
): TeamRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const game of games) {
    if (game.status === "final" && game.result) {
      if (game.result.outcome === "W") wins += 1;
      else if (game.result.outcome === "L") losses += 1;
      else ties += 1;
    }
    if (through && game === through) break;
  }
  return {
    wins,
    losses,
    ties,
    text: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
    played: wins + losses + ties,
  };
}

/** True when the game is on the given Eastern calendar day. */
export function isOnDate(game: ScheduleGame, easternDate: string): boolean {
  if (game.kickoffMs === null || !game.dateConfirmed) return false;
  return (
    new Date(game.kickoffMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) ===
    easternDate
  );
}
