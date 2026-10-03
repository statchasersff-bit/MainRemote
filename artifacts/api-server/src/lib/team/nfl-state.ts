/**
 * Where the NFL calendar currently is: season, season type, week.
 *
 * From Sleeper's `state` endpoint - the same host the roster already comes
 * from, so this adds a provider but not a dependency.
 *
 * It exists to keep the page honest about two things:
 *
 *   - A win-loss record. ESPN's team document reports whatever record is
 *     current, which in August is the PRESEASON record. Printing "1-0-1" in a
 *     hero labelled 2026 would be a plain falsehood about a season that has not
 *     kicked off, so the record is shown only once `season_type` says the
 *     regular season is under way.
 *   - Which season the Team Snapshot describes. Per-game averages and NFL ranks
 *     do not exist for a season nobody has played yet, so before Week 1 the
 *     snapshot reads from the last completed season and says so on the card.
 *
 * Never throws: a page that cannot reach Sleeper falls back to the calendar
 * season and simply omits the record.
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "./cache";
import { seasonYear } from "../seo";
import { SLEEPER } from "./upstream";

const STATE_URL = `${SLEEPER}/v1/state/nfl`;

export type SeasonType = "pre" | "regular" | "post" | "off";

export interface NflState {
  season: number;
  seasonType: SeasonType;
  week: number;
  displayWeek: number;
  /** True once regular-season games have actually been played. */
  regularSeasonUnderway: boolean;
  /** The season whose completed statistics we can describe. */
  statsSeason: number;
  /** True when statsSeason is not the current season. */
  statsSeasonIsPrior: boolean;
}

interface RawState {
  season?: string;
  season_type?: string;
  week?: number;
  display_week?: number;
}

const cache = createKeyedCache<NflState>({
  name: "sleeper-state",
  ttlMs: 30 * 60 * 1000,
  timeoutMs: 5_000,
  load: async (_key, signal) => {
    const raw = await fetchJson<RawState>(STATE_URL, signal, TEAM_USER_AGENT);
    const season = Number(raw.season);
    if (!Number.isFinite(season) || season < 2000) {
      throw new Error(`Unusable season in state payload: ${raw.season}`);
    }
    const seasonType = (["pre", "regular", "post", "off"] as const).includes(
      raw.season_type as SeasonType,
    )
      ? (raw.season_type as SeasonType)
      : "off";
    const week = typeof raw.week === "number" ? raw.week : 0;
    const regularSeasonUnderway =
      (seasonType === "regular" && week >= 1) || seasonType === "post";

    return {
      season,
      seasonType,
      week,
      displayWeek:
        typeof raw.display_week === "number" ? raw.display_week : week,
      regularSeasonUnderway,
      // Before Week 1 there is nothing to average, so the snapshot describes the
      // season that finished. "off" means the previous season is over too.
      statsSeason: regularSeasonUnderway ? season : season - 1,
      statsSeasonIsPrior: !regularSeasonUnderway,
    };
  },
});

/** Best-effort calendar state; falls back to the season derived from the date. */
export async function nflState(now: Date = new Date()): Promise<NflState> {
  const value = await cache.ensure("nfl");
  if (value) return value;

  const season = seasonYear(now);
  return {
    season,
    seasonType: "off",
    week: 0,
    displayWeek: 0,
    regularSeasonUnderway: false,
    statsSeason: season - 1,
    statsSeasonIsPrior: true,
  };
}
