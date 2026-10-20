/**
 * Team record and head coach, from ESPN.
 *
 * Both are hero details, and both are optional: the hero is built to look right
 * with any subset of them present. Nothing here is ever substituted with a
 * placeholder - a field we could not load is simply not rendered, which is the
 * page's rule everywhere (see the empty-state note in team-render.ts).
 *
 * The record needs care. ESPN's team document reports the record for whatever
 * part of the calendar is current, which before Week 1 is the PRESEASON record,
 * with nothing in the record itself to say so. `nextGameType` below is the
 * evidence that settles it; the gate that acts on it lives in the caller
 * (team-data.ts) so this module stays a plain reader.
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "./cache";
import type { NflTeam } from "./teams";
import { ESPN_CORE, ESPN_SITE } from "./upstream";


export interface TeamProfile {
  /** e.g. "12-5" or "9-7-1". Null when ESPN reports none. */
  record: string | null;
  /**
   * e.g. "3rd in AFC East", placed from ESPN's standings table, which applies
   * the tiebreakers. Null when that table could not be loaded.
   */
  standing: string | null;
  headCoach: string | null;
  /**
   * Which part of the calendar this team's NEXT scheduled game belongs to.
   *
   * Reported rather than acted on, because it is the only thing in the response
   * that says what the record above is a record OF. ESPN's `record.items` has
   * exactly three entries - total, home, road - and none of them names a season
   * type, so on 31 August the Eagles' "total" of 0-3 is a preseason result with
   * nothing on it to say so. The next event does say so: while it is a
   * preseason fixture, no regular-season game has been played and the total can
   * only be exhibition football.
   *
   * Null when ESPN lists no next event at all - after a team's final game, and
   * through the deep offseason. The caller falls back to the calendar there.
   */
  nextGameType: "pre" | "regular" | "post" | null;
  fetchedAt: number;
}

interface EspnTeamResponse {
  team?: {
    record?: {
      items?: Array<{ type?: string; summary?: string }>;
    };
    nextEvent?: Array<{ seasonType?: { type?: number } }>;
  };
}

/** ESPN's season-type ids. 4 is the offseason and is not a game. */
function nextGameTypeOf(
  team: EspnTeamResponse["team"],
): TeamProfile["nextGameType"] {
  const id = team?.nextEvent?.[0]?.seasonType?.type;
  switch (id) {
    case 1:
      return "pre";
    case 2:
      return "regular";
    case 3:
      return "post";
    default:
      return null;
  }
}

interface EspnCoachesResponse {
  items?: Array<{ $ref?: string }>;
}

interface EspnCoachResponse {
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

async function loadCoach(
  espnId: string,
  season: number,
  signal: AbortSignal,
): Promise<string | null> {
  // Two hops: the team's coach list is a collection of $refs. Both are inside
  // the cache's single AbortSignal, so a hang on either one is bounded.
  const listUrl =
    `${ESPN_CORE}/v2/sports/football/leagues/nfl/seasons/` +
    `${season}/teams/${encodeURIComponent(espnId)}/coaches?lang=en&region=us`;
  const list = await fetchJson<EspnCoachesResponse>(listUrl, signal, TEAM_USER_AGENT);
  const ref = list.items?.[0]?.$ref;
  if (!ref) return null;

  // ESPN hands back http:// refs. Re-rooted on ESPN_CORE, which upgrades the
  // hop to https and follows a test replay too.
  const coachUrl = ref.replace(/^https?:\/\/sports\.core\.api\.espn\.com/, ESPN_CORE);
  const coach = await fetchJson<EspnCoachResponse>(coachUrl, signal, TEAM_USER_AGENT);
  const name =
    coach.displayName?.trim() ||
    [coach.firstName, coach.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

const cache = createKeyedCache<TeamProfile>({
  name: "espn-profile",
  // A record changes at most once a week and a head coach a handful of times a
  // year. Three hours keeps an in-season Sunday result visible the same day
  // without asking ESPN anything on a typical page view.
  ttlMs: 3 * 60 * 60 * 1000,
  timeoutMs: 7_000,
  load: async (key, signal) => {
    const [espnId, seasonRaw] = key.split(":");
    const season = Number(seasonRaw);

    const teamUrl =
      `${ESPN_SITE}/apis/site/v2/sports/football/nfl/teams/` +
      `${encodeURIComponent(espnId ?? "")}`;

    // The coach lookup is allowed to fail on its own. It is the least important
    // of the three and costs two extra requests; losing it must not cost us the
    // record as well.
    const [teamResult, coachResult] = await Promise.allSettled([
      fetchJson<EspnTeamResponse>(teamUrl, signal, TEAM_USER_AGENT),
      loadCoach(espnId ?? "", season, signal),
    ]);

    if (teamResult.status === "rejected" && coachResult.status === "rejected") {
      throw teamResult.reason instanceof Error
        ? teamResult.reason
        : new Error(String(teamResult.reason));
    }

    const team =
      teamResult.status === "fulfilled" ? teamResult.value.team : undefined;
    const total = team?.record?.items?.find((item) => item.type === "total");

    return {
      record: total?.summary?.trim() || null,
      standing: null, // placed from the standings table in getTeamProfile
      headCoach: coachResult.status === "fulfilled" ? coachResult.value : null,
      nextGameType: nextGameTypeOf(team),
      fetchedAt: Date.now(),
    };
  },
});

interface EspnStandingsResponse {
  children?: Array<{
    children?: Array<{
      name?: string;
      standings?: {
        entries?: Array<{
          team?: { id?: string };
          stats?: Array<{ name?: string; value?: number }>;
        }>;
      };
    }>;
  }>;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * One team's line in the league standings table.
 *
 * `place` is the division place with the tiebreakers applied - see the cache
 * below for why the team document's own summary cannot supply it. The record
 * fields are ESPN's regular-season totals; before Week 1 they are all zero,
 * and `leagueHasPlayed()` is how a caller tells a table of 0-0s from a season.
 */
export interface StandingsLine {
  /** 1-4 within the division, ties broken. */
  place: number;
  /** "AFC East" - the division the place is in. */
  division: string;
  wins: number;
  losses: number;
  ties: number;
  /** 0-1. ESPN's own figure, which counts a tie as half a win. */
  winPercent: number;
}

export type LeagueStandings = ReadonlyMap<string, StandingsLine>;

/** Has anybody played? False for the table ESPN serves before Week 1. */
export function leagueHasPlayed(standings: LeagueStandings): boolean {
  for (const line of standings.values()) {
    if (line.wins + line.losses + line.ties > 0) return true;
  }
  return false;
}

/**
 * Every team's division place and record, keyed by ESPN team id.
 *
 * The team document's own `standingSummary` cannot be used for the place. It
 * gives tied teams the same place and skips the ones below: on 3 October 2026
 * it had the Jets and Patriots both "2nd in AFC East" at 1-2, and the Falcons,
 * Saints and Panthers all "1st in NFC South". The standings table breaks those
 * ties, and its `playoffSeed` (conference-wide, so it orders a division too) is
 * the order the tiebreakers settled on.
 *
 * The record rides along because the same table carries it, and the index of
 * all 32 hubs prints every team's line at once: one request for the league,
 * where the team document is one request per club.
 */
const standingsCache = createKeyedCache<Map<string, StandingsLine>>({
  name: "espn-standings",
  ttlMs: 3 * 60 * 60 * 1000,
  timeoutMs: 7_000,
  load: async (seasonRaw, signal) => {
    const url =
      `${ESPN_SITE}/apis/v2/sports/football/nfl/standings` +
      `?level=3&season=${encodeURIComponent(seasonRaw)}`;
    const doc = await fetchJson<EspnStandingsResponse>(url, signal, TEAM_USER_AGENT);
    const lines = new Map<string, StandingsLine>();
    for (const conference of doc.children ?? []) {
      for (const division of conference.children ?? []) {
        const name = division.name?.trim();
        if (!name) continue;
        const statOf = (
          entry: { stats?: Array<{ name?: string; value?: number }> },
          stat: string,
        ): number | undefined => {
          const value = entry.stats?.find((s) => s.name === stat)?.value;
          return typeof value === "number" && Number.isFinite(value) ? value : undefined;
        };
        const seedOf = (entry: { stats?: Array<{ name?: string; value?: number }> }) =>
          statOf(entry, "playoffSeed") ?? Number.POSITIVE_INFINITY;
        const ranked = [...(division.standings?.entries ?? [])].sort(
          (a, b) => seedOf(a) - seedOf(b),
        );
        ranked.forEach((entry, i) => {
          if (!entry.team?.id) return;
          const wins = statOf(entry, "wins") ?? 0;
          const losses = statOf(entry, "losses") ?? 0;
          const ties = statOf(entry, "ties") ?? 0;
          const games = wins + losses + ties;
          lines.set(entry.team.id, {
            place: i + 1,
            division: name,
            wins,
            losses,
            ties,
            winPercent:
              statOf(entry, "winPercent") ?? (games ? (wins + ties / 2) / games : 0),
          });
        });
      }
    }
    if (lines.size === 0) throw new Error("standings: no division entries");
    return lines;
  },
});

/**
 * The league table for a season, or null when ESPN could not supply it.
 *
 * Null rather than a throw because the one page that wants all 32 lines is
 * the index, whose job is to link to 32 hubs; a standings outage costs it the
 * records, not the page.
 */
export async function getLeagueStandings(
  season: number,
): Promise<LeagueStandings | null> {
  try {
    return (await standingsCache.ensure(String(season))) ?? null;
  } catch {
    return null;
  }
}

export async function getTeamProfile(
  team: NflTeam,
  season: number,
): Promise<TeamProfile | null> {
  const [profile, places] = await Promise.all([
    cache.ensure(`${team.espnId}:${season}`),
    standingsCache.ensure(String(season)).catch(() => null),
  ]);
  if (!profile) return null;
  // No table, no standing: the summary's tie-blind place is the bug this
  // replaces, so it is not a fallback.
  const line = places?.get(team.espnId);
  return {
    ...profile,
    standing: line ? `${ordinal(line.place)} in ${line.division}` : null,
  };
}
