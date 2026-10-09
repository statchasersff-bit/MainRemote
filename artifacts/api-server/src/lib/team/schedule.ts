/**
 * Regular-season schedule for one team, from ESPN's public site API.
 *
 * There was no schedule data in this project before the team pages: the news
 * archive knows about headlines and Sleeper knows about rosters, and neither
 * knows who anybody plays in Week 4. So this is a genuinely new upstream, and
 * it is treated like one - cached hard, timed out, and allowed to fail without
 * taking the page with it. A team whose schedule cannot be loaded renders the
 * "temporarily unavailable" state; it never renders a made-up fixture.
 *
 * The bye week is DERIVED, not fetched: a team plays 17 games across 18 weeks,
 * so the week number missing from the response is the bye. That is a fact about
 * the returned data rather than an assumption about the calendar, and it is
 * reported as null whenever the response does not have exactly one gap.
 */

import { createKeyedCache, fetchJson, PAST_SEASON_TTL_MS, TEAM_USER_AGENT } from "./cache";
import { seasonYear } from "../seo";
import { getTeamByAbbreviation, TEAMS, type NflTeam } from "./teams";
import { ESPN_SITE } from "./upstream";


/** ESPN's season types. 1 is preseason, which this app never asks for. */
const SEASON_TYPE = { regular: 2, post: 3 } as const;

export type SeasonType = keyof typeof SEASON_TYPE;

/**
 * What ESPN calls each postseason week, when it does not say.
 *
 * It normally does - `week.text` comes back as "Super Bowl", "Wild Card" and so
 * on - and that is what is used. This is the fallback for a response that omits
 * it, so a postseason game never prints as a bare "Week 5", which in the
 * postseason means nothing to anybody.
 *
 * Week 4 is the Pro Bowl. It is not a meeting between two teams in any sense
 * this page means and is dropped rather than labeled - see parse().
 */
const POSTSEASON_WEEKS: Record<number, string> = {
  1: "Wild Card",
  2: "Divisional Round",
  3: "Conference Championship",
  5: "Super Bowl",
};

/** The Pro Bowl's week within ESPN's postseason. Not a meeting; never listed. */
const PRO_BOWL_WEEK = 4;

export type GameStatus = "scheduled" | "live" | "final";

export interface ScheduleGame {
  week: number;
  /**
   * Which half of the season this game belongs to.
   *
   * Week numbers are only unique WITHIN one of these: ESPN numbers the
   * postseason from 1 again, so a season has two week 1s and anything that
   * identifies a game by week alone has to carry this as well.
   */
  seasonType: SeasonType;
  /** "Week 4", or "Super Bowl" - what to print where a week number would go. */
  weekLabel: string;
  /**
   * ESPN's own id for this game, which is what the box score is keyed by.
   *
   * Null whenever the response does not carry one. It is the only handle we
   * have on `summary?event=`, so a game without it simply has no box score -
   * see lib/matchup/boxscore.ts, which is built to render nothing in that case.
   */
  espnEventId: string | null;
  /** Kickoff in epoch ms, or null when ESPN has no confirmed time yet. */
  kickoffMs: number | null;
  /** ESPN's own flag for "this time is real", not a placeholder. */
  timeConfirmed: boolean;
  homeAway: "home" | "away";
  neutralSite: boolean;
  /** Resolved through the canonical team table; null if ESPN names a team we don't know. */
  opponent: NflTeam | null;
  opponentName: string;
  venue: string | null;
  venueCity: string | null;
  /** "CA": the venue's state, when ESPN gives one (it does not abroad). */
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

interface EspnScore {
  value?: number;
}

interface EspnCompetitor {
  homeAway?: string;
  winner?: boolean;
  score?: EspnScore | number | string;
  team?: {
    abbreviation?: string;
    displayName?: string;
  };
}

interface EspnEvent {
  id?: string;
  date?: string;
  timeValid?: boolean;
  week?: { number?: number; text?: string };
  competitions?: Array<{
    id?: string;
    date?: string;
    neutralSite?: boolean;
    venue?: {
      fullName?: string;
      address?: { city?: string; state?: string; country?: string };
    };
    broadcasts?: Array<{
      type?: { shortName?: string };
      media?: { shortName?: string };
    }>;
    competitors?: EspnCompetitor[];
    status?: { type?: { state?: string; completed?: boolean } };
  }>;
}

interface EspnScheduleResponse {
  events?: EspnEvent[];
}

function scoreOf(competitor: EspnCompetitor): number | null {
  const raw = competitor.score;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw && typeof raw === "object" && typeof raw.value === "number") {
    return raw.value;
  }
  return null;
}

function networkOf(
  broadcasts: Array<{ type?: { shortName?: string }; media?: { shortName?: string } }> | undefined,
): string | null {
  if (!broadcasts?.length) return null;
  // Prefer an actual TV listing; "Streaming" and radio entries also appear and
  // are not what a reader means by "where is this on".
  const tv = broadcasts.find((b) => b.type?.shortName === "TV");
  return (tv ?? broadcasts[0])?.media?.shortName?.trim() || null;
}

/**
 * The one gap in the week numbers, or null.
 *
 * Null rather than a guess whenever the data does not support exactly one
 * answer - a short response (an unpublished schedule, a partial fetch) would
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

function parse(
  team: NflTeam,
  season: number,
  payload: EspnScheduleResponse,
  seasonType: SeasonType,
): TeamSchedule {
  const games: ScheduleGame[] = [];

  for (const event of payload.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const competitors = competition.competitors ?? [];
    const self = competitors.find(
      (c) => c.team?.abbreviation?.toUpperCase() === team.espnAbbr,
    );
    const other = competitors.find((c) => c !== self);
    if (!self || !other) continue;

    const week = event.week?.number;
    if (typeof week !== "number") continue;
    // The Pro Bowl is in the postseason response and is not a game between
    // these two teams in any sense the head-to-head record means.
    if (seasonType === "post" && week === PRO_BOWL_WEEK) continue;

    const opponent = getTeamByAbbreviation(other.team?.abbreviation);
    const dateRaw = competition.date ?? event.date;
    const parsedDate = dateRaw ? Date.parse(dateRaw) : NaN;
    const state = competition.status?.type?.state;
    const country = competition.venue?.address?.country;

    const teamScore = scoreOf(self);
    const opponentScore = scoreOf(other);
    const completed = competition.status?.type?.completed === true;

    games.push({
      week,
      seasonType,
      weekLabel:
        seasonType === "post"
          ? (event.week?.text?.trim() || POSTSEASON_WEEKS[week] || `Postseason week ${week}`)
          : `Week ${week}`,
      espnEventId: (competition.id ?? event.id)?.trim() || null,
      kickoffMs: Number.isNaN(parsedDate) ? null : parsedDate,
      timeConfirmed: event.timeValid !== false,
      homeAway: self.homeAway === "away" ? "away" : "home",
      neutralSite: competition.neutralSite === true,
      opponent,
      opponentName:
        opponent?.fullName ?? other.team?.displayName?.trim() ?? "Opponent TBD",
      venue: competition.venue?.fullName?.trim() || null,
      venueCity: competition.venue?.address?.city?.trim() || null,
      venueState: competition.venue?.address?.state?.trim() || null,
      // ESPN reports the venue's country; anything that is not the US is an
      // international game. Derived from the venue rather than from a hand-kept
      // list of London/Munich/São Paulo fixtures, which would go stale yearly.
      international: !!country && country.toUpperCase() !== "USA",
      divisional: !!opponent && opponent.division === team.division,
      network: networkOf(competition.broadcasts),
      status: completed ? "final" : state === "in" ? "live" : "scheduled",
      result:
        completed && teamScore !== null && opponentScore !== null
          ? {
              outcome:
                teamScore > opponentScore
                  ? "W"
                  : teamScore < opponentScore
                    ? "L"
                    : "T",
              teamScore,
              opponentScore,
            }
          : null,
    });
  }

  games.sort((a, b) => a.week - b.week);

  // 17 games in an 18-week season. Derived from the response's own span so a
  // future schedule expansion doesn't need this constant edited.
  const lastWeek = games.length ? (games[games.length - 1] as ScheduleGame).week : 0;
  const totalWeeks = Math.max(lastWeek, games.length + 1);

  return {
    season,
    games,
    // A bye is a regular-season fact. The postseason has gaps by construction -
    // a team that lost in the Wild Card round has four of five weeks missing -
    // and putting that through deriveByeWeek() would be asking a question the
    // data cannot answer.
    byeWeek:
      seasonType === "regular" && games.length
        ? deriveByeWeek(games.map((g) => g.week), totalWeeks)
        : null,
    fetchedAt: Date.now(),
  };
}

/** Cache key is `espnId:season` - one entry per team per season, nothing global. */
/** ESPN's numeric id back to our team, so the loader can parse without a closure. */
const TEAM_BY_ESPN_ID = new Map<string, NflTeam>(
  TEAMS.map((team) => [team.espnId, team]),
);

const cache = createKeyedCache<TeamSchedule>({
  name: "espn-schedule",
  // Schedules move rarely (flexed kickoffs, a relocated game), and every visitor
  // after the first is served from memory. Six hours is well inside the window
  // in which a flex change would still be picked up before kickoff.
  ttlMs: 6 * 60 * 60 * 1000,
  // A finished season does not change; see ttlFor in ./cache.
  ttlFor: (key) => (Number(key.split(":")[1]) < seasonYear() ? PAST_SEASON_TTL_MS : 6 * 60 * 60 * 1000),
  timeoutMs: 6_000,
  load: async (key, signal) => {
    const [espnId, seasonRaw, typeRaw] = key.split(":");
    const season = Number(seasonRaw);
    const seasonType: SeasonType = typeRaw === "post" ? "post" : "regular";
    const url =
      `${ESPN_SITE}/apis/site/v2/sports/football/nfl/teams/` +
      `${encodeURIComponent(espnId ?? "")}/schedule` +
      `?season=${season}&seasontype=${SEASON_TYPE[seasonType]}`;
    const payload = await fetchJson<EspnScheduleResponse>(url, signal, TEAM_USER_AGENT);
    const team = TEAM_BY_ESPN_ID.get(espnId ?? "");
    if (!team) throw new Error(`Unknown ESPN team id ${espnId}`);
    const parsed = parse(team, season, payload, seasonType);
    if (seasonType === "regular" && parsed.games.length === 0) {
      // A 200 with no games is a failure, not an empty season - the same rule
      // the news ingest applies to an empty feed. Throwing keeps the last good
      // schedule in the cache rather than replacing it with nothing.
      //
      // Only for the REGULAR season. Twenty of the thirty-two teams have no
      // postseason in any given year, and for them an empty response is the
      // correct answer rather than a failed fetch - throwing there would retry
      // a working upstream on every request for two thirds of the league.
      throw new Error(`ESPN returned no ${season} games for ${team.code}`);
    }
    return parsed;
  },
});

/** One team's regular season. */
export async function getTeamSchedule(
  team: NflTeam,
  season: number,
): Promise<TeamSchedule | null> {
  return cache.ensure(`${team.espnId}:${season}:regular`);
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
 */
export async function getTeamPostseason(
  team: NflTeam,
  season: number,
): Promise<TeamSchedule | null> {
  return cache.ensure(`${team.espnId}:${season}:post`);
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
