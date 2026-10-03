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
 * snapshot names the season it describes, and Injury Watch says nothing at all
 * rather than report a clean bill of health it has not checked. Where this app
 * has no data at all - strength of schedule,
 * fantasy analysis on a news item - the section is either omitted or replaced
 * with an honest link into the tool that does have it.
 */

import { listNewsForTeam } from "../news-query";
import { ensureTeams } from "../teams";
import { itemTimestamp, type NewsItem } from "../render";
import { nflState, type NflState } from "./nfl-state";
import { getTeamProfile, type TeamProfile } from "./profile";
import { getTeamSchedule, upcomingGames, type TeamSchedule } from "./schedule";
import { getTeamSnapshot, type TeamSnapshot } from "./snapshot";
import { getTeamStats, type TeamStats } from "./stats";
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
import { coachingVersion } from "./coaching";
import { usageVersion } from "./usage";

/** Stories shown before "View more" reveals the rest. */
export const TEAM_NEWS_VISIBLE = 10;
/**
 * Stories fetched in total; the remainder ships hidden behind the disclosure.
 *
 * Sized against the reference these pages are matching (thehuddle's team
 * news/injuries pages), which lists a team's whole recent run - order 30-40
 * items across about four months - in one column rather than a handful with a
 * link away. Sixty is that with headroom for a team having a loud fortnight,
 * and it costs nothing when the archive holds less: the read is bounded by
 * TEAM_WINDOW_DAYS, and this is only the cap on what comes back.
 */
export const TEAM_NEWS_LIMIT = 60;

export interface TeamPageData {
  team: NflTeam;
  state: NflState;

  news: NewsItem[];
  /** Newest story's timestamp - the page's "last updated" for this team. */
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
  /**
   * Offence and defence with league ranks, for the Stats tab. Shares its season
   * with the snapshot rather than picking its own: both describe completed
   * football, so before Week 1 both describe last season and the page has one
   * season to explain instead of two.
   */
  stats: TeamStats | null;

  /**
   * How the next opponent's defence is doing, for the one line of context on
   * the Next Game card.
   *
   * Deliberately one number, and a real one: points allowed per game with its
   * league rank, read from the same league table the Stats tab is built on. It
   * costs almost nothing to add - that table is already in memory for this
   * season, and this is one map lookup against it.
   *
   * `abbreviation` is carried so the renderer can check that the game it picked
   * is the game this was fetched for. The two run off different clocks - this
   * one Date.now(), the renderer whatever it was handed - and within four hours
   * of a kickoff they can disagree about which fixture is next. When they do,
   * the line is dropped rather than printed against the wrong opponent.
   */
  nextOpponentDefense: {
    abbreviation: string;
    /** Points allowed per game, preformatted: "18.8". */
    value: string;
    /** e.g. "4th". Null when the metric could not be ranked. */
    rankLabel: string | null;
  } | null;

  /** Changes whenever any input changes - used as the render cache key. */
  version: string;
}

function settled<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/**
 * Does ESPN's win-loss record describe the season this page is labelled with?
 *
 * The calendar cannot answer this. Sleeper flips `season_type` to "regular" and
 * `week` to 1 as soon as the preseason ends - days before anybody plays a
 * regular-season game - so `regularSeasonUnderway` is true for most of the last
 * week of August while ESPN's "total" record is still the PRESEASON record.
 * That is how a Philadelphia hub headed "2026 Season" came to print "Record
 * 0-3" for a season in which the Eagles had not played.
 *
 * The schedule answers it directly. It is fetched for season type 2, so every
 * game in it is a regular-season game, and a game marked final is one that was
 * actually played. One of those and the record is a regular-season record; none
 * of them and it cannot be, whatever the calendar says. Nothing is inferred
 * from the date at all.
 *
 * The cost is that a team shows no record between kickoff of Week 1 and its own
 * first game - where the true answer is 0-0, which is not worth a line in the
 * hero. That is the right side to be wrong on: this field's whole purpose is to
 * say how the season is going, and before a team has played, it isn't.
 *
 * With no schedule to read, the two weaker signals are taken together: the next
 * game still being a preseason fixture is proof the record is exhibition
 * football, and past that the calendar is the best evidence left.
 */
function recordDescribesSeason(
  profile: TeamProfile,
  schedule: TeamSchedule | null,
  state: NflState,
): boolean {
  if (schedule) return schedule.games.some((game) => game.status === "final");
  if (profile.nextGameType === "pre") return false;
  return state.regularSeasonUnderway;
}

/**
 * Points allowed per game, and its rank, for whoever this team plays next.
 *
 * Null whenever anything is missing - no schedule, an opponent ESPN named that
 * the canonical table does not know, a season the stats provider is down for.
 * One absent line on a card, never a placeholder.
 */
async function opponentDefense(
  schedule: TeamSchedule | null,
  season: number,
): Promise<TeamPageData["nextOpponentDefense"]> {
  const opponent = upcomingGames(schedule, Date.now(), 1)[0]?.opponent;
  if (!opponent) return null;
  const stats = await getTeamStats(opponent, season).catch(() => null);
  const row = stats?.defense.find((cell) => cell.key === "def-points");
  if (!row) return null;
  return {
    abbreviation: opponent.abbreviation,
    value: row.value,
    rankLabel: row.rankLabel,
  };
}

export async function getTeamPageData(team: NflTeam): Promise<TeamPageData> {
  // The roster index rides on the news tool's own Sleeper fetch, so this is
  // usually already warm; awaiting it first means the news filter below can use
  // the name fallback on the very first request rather than the second.
  await ensureTeams();

  const state = await nflState();

  const [newsResult, scheduleResult, profileResult, snapshotResult, statsResult] =
    await Promise.allSettled([
      listNewsForTeam(team.abbreviation, { limit: TEAM_NEWS_LIMIT }),
      getTeamSchedule(team, state.season),
      getTeamProfile(team, state.season),
      getTeamSnapshot(team, state.statsSeason),
      getTeamStats(team, state.statsSeason),
    ]);

  const news = settled(newsResult) ?? [];
  const roster = getTeamRoster(team.abbreviation);
  const profile = settled(profileResult);
  const schedule = settled(scheduleResult);

  const newsUpdatedAtMs = news.reduce<number | null>((newest, item) => {
    const ts = itemTimestamp(item);
    return ts !== null && (newest === null || ts > newest) ? ts : newest;
  }, null);

  const nextOpponentDefense = await opponentDefense(schedule, state.statsSeason);

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
    schedule,
    profile:
      profile && !recordDescribesSeason(profile, schedule, state)
        ? // ESPN's "record" still describes the preseason. Drop the field
          // rather than print a number that counts exhibition games under a
          // heading that names the regular season.
          { ...profile, record: null, standing: null }
        : profile,
    snapshot: settled(snapshotResult),
    stats: settled(statsResult),
    nextOpponentDefense,
    version: "",
  };
}

/**
 * A fingerprint of everything rendered, for the page cache.
 *
 * Built from each provider's own fetch stamp plus the news signature, so a
 * background refresh of any one source produces a new key and the next request
 * re-renders - and nothing else does.
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
    data.stats?.fetchedAt ?? 0,
    data.nextOpponentDefense?.rankLabel ?? "",
    data.state.season,
    data.state.week,
    // The Usage tab reads a file the daily chain rebuilds in place; the
    // Coaching tab reads one that hand edits and new club entries change.
    usageVersion(data.state.season),
    coachingVersion(data.state.season),
  ].join("-");
}
