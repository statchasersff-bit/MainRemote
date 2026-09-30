/**
 * Team record and head coach, from ESPN.
 *
 * Both are hero details, and both are optional: the hero is built to look right
 * with any subset of them present. Nothing here is ever substituted with a
 * placeholder — a field we could not load is simply not rendered, which is the
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
  /** e.g. "1st in AFC East". Null when absent. */
  standing: string | null;
  headCoach: string | null;
  /**
   * Which part of the calendar this team's NEXT scheduled game belongs to.
   *
   * Reported rather than acted on, because it is the only thing in the response
   * that says what the record above is a record OF. ESPN's `record.items` has
   * exactly three entries — total, home, road — and none of them names a season
   * type, so on 31 August the Eagles' "total" of 0-3 is a preseason result with
   * nothing on it to say so. The next event does say so: while it is a
   * preseason fixture, no regular-season game has been played and the total can
   * only be exhibition football.
   *
   * Null when ESPN lists no next event at all — after a team's final game, and
   * through the deep offseason. The caller falls back to the calendar there.
   */
  nextGameType: "pre" | "regular" | "post" | null;
  fetchedAt: number;
}

interface EspnTeamResponse {
  team?: {
    standingSummary?: string;
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
      standing: team?.standingSummary?.trim() || null,
      headCoach: coachResult.status === "fulfilled" ? coachResult.value : null,
      nextGameType: nextGameTypeOf(team),
      fetchedAt: Date.now(),
    };
  },
});

export async function getTeamProfile(
  team: NflTeam,
  season: number,
): Promise<TeamProfile | null> {
  return cache.ensure(`${team.espnId}:${season}`);
}
