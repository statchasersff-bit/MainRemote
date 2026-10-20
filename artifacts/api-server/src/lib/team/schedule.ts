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
 * - Nothing is invented. A flexible future week has no kickoff in the feed
 *   and `kickoffMs` stays null, with `timeConfirmed` false.
 */

import {
  getPostseason,
  getSeasonSlate,
  TOTAL_WEEKS,
  type PostseasonRound,
  type ScheduleGame as SlateGame,
} from "../schedule/schedule-data";
import type { NflTeam } from "./teams";

export type SeasonType = "regular" | "post";

export type GameStatus = "scheduled" | "live" | "final";

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
  /** Kickoff in epoch ms, or null when the feed has no confirmed time yet. */
  kickoffMs: number | null;
  /** True when the feed names a date and a time; a flexed week has neither. */
  timeConfirmed: boolean;
  homeAway: "home" | "away";
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
  network: string | null;
  status: GameStatus;
  /** Populated only for completed games. */
  result: { outcome: "W" | "L" | "T"; teamScore: number; opponentScore: number } | null;
}

export interface TeamSchedule {
  season: number;
  games: ScheduleGame[];
  /** Week number with no game, or null when it can't be established. */
  byeWeek: number | null;
  fetchedAt: number;
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
    kickoffMs: game.kickoffMs,
    timeConfirmed: game.kickoffMs !== null,
    homeAway: home ? "home" : "away",
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
  return {
    season,
    games,
    // A bye is a regular-season fact. The postseason has gaps by construction.
    byeWeek: null,
    fetchedAt: Date.now(),
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
