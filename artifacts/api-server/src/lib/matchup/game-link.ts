/**
 * The one way to link a game (Team Pages Phase 7, 2026-11-20).
 *
 * Every page that links a particular meeting - the team Schedule, Matchups,
 * Overview and Usage tabs, the league schedule, the player header and
 * Breakdown - builds its href here, so they cannot disagree about where a
 * game lives. Where it lives is meetingLinkTarget() in pair.ts:
 *
 *   - a finished game: its dated address once the pair's page has let it go,
 *     otherwise the pair's page (unchanged);
 *   - an unplayed game: the pair's page while that page is previewing it,
 *     otherwise its own dated preview - so an upcoming rematch opens its own
 *     preview rather than the earlier meeting's box score;
 *   - a canceled game: the pair's page.
 *
 * The pair URL itself (`/nfl/<a>-vs-<b>/`) is still what a link to the PAIR
 * uses - the "vs Every Team" index - and is untouched.
 */

import type { NflTeam } from "../team/teams";
import type { ScheduleGame, SeasonType } from "../team/schedule";
import { canonicalizeMatchupPair, gameSegment, meetingLinkTarget, type LinkedMeeting } from "./pair";

/** One meeting of a pair, as every caller can describe it. */
export interface GameLinkMeeting extends LinkedMeeting {
  week: number;
  seasonType: SeasonType;
}

export interface GameLinkOptions {
  /** Where matchup pages live: "/nfl/" on WordPress. */
  prefix: string;
  /** Carried onto the link so embed mode stays embed mode. */
  query: string;
  /** The league's current season: only its unplayed games have previews. */
  currentSeason: number;
  now: number;
}

/**
 * The href for `game` between `teamA` and `teamB`, or null when the pair
 * cannot be named.
 *
 * `meetings` is every meeting between the two in the game's season, played
 * or not, and `game` must be one of them (compared by identity, so two undated
 * fixtures are never confused).
 */
export function gameLink(
  teamA: NflTeam | string | null,
  teamB: NflTeam | string | null,
  game: GameLinkMeeting,
  meetings: readonly GameLinkMeeting[],
  options: GameLinkOptions,
): string | null {
  const pair = canonicalizeMatchupPair(teamA, teamB);
  if (!pair) return null;
  const base = `${options.prefix}${pair.slug}/`;
  const target = meetingLinkTarget(game, meetings, options.currentSeason, options.now);
  return target === "own" ? `${base}${gameSegment(game)}/${options.query}` : `${base}${options.query}`;
}

/** The meeting in `meetings` for this week and season type, else null. */
export function meetingForWeek(
  meetings: readonly GameLinkMeeting[],
  week: number,
  seasonType: SeasonType,
): GameLinkMeeting | null {
  return meetings.find((m) => m.week === week && m.seasonType === seasonType) ?? null;
}

/**
 * One club's meetings with one opponent in a season, from that club's
 * schedule (the team hub's, or the one a player page loads).
 */
export function teamMeetings(
  schedule: { season: number; games: readonly ScheduleGame[] },
  opponent: NflTeam,
): GameLinkMeeting[] {
  return schedule.games
    .filter((other) => other.opponent?.abbreviation === opponent.abbreviation)
    .map((other) => ({
      season: schedule.season,
      week: other.week,
      seasonType: other.seasonType,
      kickoffMs: other.kickoffMs,
      isFinal: other.status === "final" && !!other.result,
      canceled: other.status === "canceled",
    }));
}
