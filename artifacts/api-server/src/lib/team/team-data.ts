/**
 * Assembles everything one team page needs, from every provider, in parallel.
 *
 * Two rules shape this module.
 *
 * First, a provider failing is normal and must not be contagious. Each source
 * is settled independently and a missing one leaves its field null; the
 * renderer then omits that section rather than drawing an empty shell full of
 * "N/A". A page with no schedule is still a good page.
 *
 * Second, nothing is invented to fill a gap. The record is withheld until the
 * regular season is actually under way (ESPN reports the preseason record
 * before that, which would be a lie about a season nobody has played), the
 * snapshot names the season it describes, and Injury Watch carries the time its
 * snapshot was taken. Where this app has no data at all — strength of schedule,
 * fantasy analysis on a news item — the section is either omitted or replaced
 * with an honest link into the tool that does have it.
 */

import { listNewsForTeam } from "../news-query";
import { ensureTeams } from "../teams";
import { itemTimestamp, type NewsItem } from "../render";
import { nflState, type NflState } from "./nfl-state";
import { getTeamProfile, type TeamProfile } from "./profile";
import { getTeamSchedule, type TeamSchedule } from "./schedule";
import { getTeamSnapshot, type TeamSnapshot } from "./snapshot";
import {
  depthPreview,
  fantasyCornerstones,
  getTeamRoster,
  injuryWatch,
  rosterFetchedAt,
  type DepthChartEntry,
  type SkillPosition,
  type TeamRoster,
} from "./roster";
import type { NflTeam } from "./teams";

/** Stories shown before "View more" reveals the rest. */
export const TEAM_NEWS_VISIBLE = 6;
/** Stories fetched in total; the remainder ships hidden behind the disclosure. */
export const TEAM_NEWS_LIMIT = 18;

export interface TeamPageData {
  team: NflTeam;
  state: NflState;

  news: NewsItem[];
  /** Newest story's timestamp — the page's "last updated" for this team. */
  newsUpdatedAtMs: number | null;

  roster: TeamRoster | null;
  cornerstones: DepthChartEntry[];
  depthChart: Record<SkillPosition, DepthChartEntry[]>;
  injuries: DepthChartEntry[];
  /** Epoch ms the roster/injury snapshot was pulled. 0 when there is none. */
  rosterFetchedAt: number;

  schedule: TeamSchedule | null;
  profile: TeamProfile | null;
  snapshot: TeamSnapshot | null;

  /** Changes whenever any input changes — used as the render cache key. */
  version: string;
}

function settled<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export async function getTeamPageData(team: NflTeam): Promise<TeamPageData> {
  // The roster index rides on the news tool's own Sleeper fetch, so this is
  // usually already warm; awaiting it first means the news filter below can use
  // the name fallback on the very first request rather than the second.
  await ensureTeams();

  const state = await nflState();

  const [newsResult, scheduleResult, profileResult, snapshotResult] =
    await Promise.allSettled([
      listNewsForTeam(team.abbreviation, { limit: TEAM_NEWS_LIMIT }),
      getTeamSchedule(team, state.season),
      getTeamProfile(team, state.season),
      getTeamSnapshot(team, state.statsSeason),
    ]);

  const news = settled(newsResult) ?? [];
  const roster = getTeamRoster(team.abbreviation);
  const profile = settled(profileResult);

  const newsUpdatedAtMs = news.reduce<number | null>((newest, item) => {
    const ts = itemTimestamp(item);
    return ts !== null && (newest === null || ts > newest) ? ts : newest;
  }, null);

  return {
    team,
    state,
    news,
    newsUpdatedAtMs,
    roster,
    cornerstones: fantasyCornerstones(roster),
    depthChart: depthPreview(roster),
    injuries: injuryWatch(roster),
    rosterFetchedAt: rosterFetchedAt(),
    schedule: settled(scheduleResult),
    profile:
      profile && !state.regularSeasonUnderway
        ? // Before Week 1 ESPN's "record" is the preseason record. Drop the
          // field rather than print a number that describes exhibition games
          // under a heading that says 2026.
          { ...profile, record: null, standing: null }
        : profile,
    snapshot: settled(snapshotResult),
    version: "",
  };
}

/**
 * A fingerprint of everything rendered, for the page cache.
 *
 * Built from each provider's own fetch stamp plus the news signature, so a
 * background refresh of any one source produces a new key and the next request
 * re-renders — and nothing else does.
 */
export function dataVersion(data: TeamPageData, contentVersion: string): string {
  return [
    data.team.abbreviation,
    contentVersion,
    data.news.length,
    data.newsUpdatedAtMs ?? 0,
    data.rosterFetchedAt,
    data.schedule?.fetchedAt ?? 0,
    data.profile?.fetchedAt ?? 0,
    data.snapshot?.fetchedAt ?? 0,
    data.state.season,
    data.state.week,
  ].join("-");
}
