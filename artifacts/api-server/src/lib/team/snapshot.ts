/**
 * Team Snapshot - four offensive rates with their NFL rank.
 *
 * From ESPN's season statistics document, which carries both the per-game value
 * and the league rank for each stat. The rank matters more than the number: a
 * team averaging 21 points is meaningless until you know that is 9th or 27th,
 * and computing a rank ourselves would mean pulling all 32 teams to render one
 * page - precisely the thing the performance brief rules out.
 *
 * Availability is not assumed. A season nobody has played has no averages, so
 * a season ESPN cannot answer for falls back to the one before it (see
 * getTeamSnapshot below) and the card says which season it is describing. If
 * ESPN returns a document without these fields, the metric is dropped; if none
 * of the four survive, the section does not render at all. Nothing here is
 * defaulted to zero or to "N/A".
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "./cache";
import type { NflTeam } from "./teams";
import { ESPN_CORE } from "./upstream";


export interface SnapshotMetric {
  /**
   * Matches the `key` of the same metric's offense row on the Stats tab, minus
   * that row's `off-` prefix. The two come from different ESPN documents and
   * neither needs the other to render, but the Stats rows carry last season's
   * rank and these do not - so the renderer joins on this to put a movement
   * arrow on the card without a second request. Break the join and the arrow
   * disappears; it does not go wrong.
   */
  key: string;
  /** Short label above the number, e.g. "PASS YDS/G". */
  label: string;
  /** Formatted value, e.g. "250.5". */
  value: string;
  /** Ordinal rank among the 32 teams, e.g. "4th". Null when ESPN omits it. */
  rank: string | null;
  /** 1-32, for the tint that shows good/bad without relying on color alone. */
  rankValue: number | null;
  /** Read out to assistive tech in place of the abbreviated label. */
  description: string;
}

export interface TeamSnapshot {
  season: number;
  metrics: SnapshotMetric[];
  fetchedAt: number;
}

interface EspnStat {
  name?: string;
  value?: number;
  displayValue?: string;
  rank?: number;
  rankDisplayValue?: string;
}

interface EspnStatsResponse {
  splits?: {
    categories?: Array<{ name?: string; stats?: EspnStat[] }>;
  };
}

/**
 * The four metrics, in the order they appear on the page.
 *
 * `netYardsPerGame` inside the passing category is ESPN's total-offense figure
 * (it is exactly net passing + rushing), not a passing-only number - which is
 * why the label says Total.
 */
const WANTED: Array<{
  category: string;
  stat: string;
  key: string;
  label: string;
  description: string;
}> = [
  {
    category: "scoring",
    stat: "totalPointsPerGame",
    key: "points",
    label: "Points/G",
    description: "Points scored per game",
  },
  {
    category: "passing",
    stat: "netPassingYardsPerGame",
    key: "pass-yards",
    label: "Pass Yds/G",
    description: "Net passing yards per game",
  },
  {
    category: "rushing",
    stat: "rushingYardsPerGame",
    key: "rush-yards",
    label: "Rush Yds/G",
    description: "Rushing yards per game",
  },
  {
    category: "passing",
    stat: "netYardsPerGame",
    key: "total-yards",
    label: "Total Yds/G",
    description: "Total net yards per game",
  },
];

/**
 * ESPN's rank string, shortened to the form the rest of the page uses.
 *
 * It sends "Tied-4th" where lib/team/stats.ts writes "T-4th" for the same fact.
 * Eight characters is most of a card footer that also has to hold the caption
 * and the movement arrow, and two spellings of a tie across two tabs is one
 * more than the page needs.
 */
function shortRank(display: string): string {
  return display.replace(/^Tied-/i, "T-");
}

function format(stat: EspnStat): string | null {
  if (stat.displayValue && stat.displayValue.trim()) return stat.displayValue.trim();
  if (typeof stat.value === "number" && Number.isFinite(stat.value)) {
    return stat.value.toFixed(1);
  }
  return null;
}

const cache = createKeyedCache<TeamSnapshot>({
  name: "espn-statistics",
  // Season aggregates move once a week at most.
  ttlMs: 6 * 60 * 60 * 1000,
  timeoutMs: 7_000,
  load: async (key, signal) => {
    const [espnId, seasonRaw] = key.split(":");
    const season = Number(seasonRaw);
    const url =
      `${ESPN_CORE}/v2/sports/football/leagues/nfl/seasons/` +
      `${season}/types/2/teams/${encodeURIComponent(espnId ?? "")}/statistics` +
      `?lang=en&region=us`;
    const payload = await fetchJson<EspnStatsResponse>(url, signal, TEAM_USER_AGENT);
    const categories = payload.splits?.categories ?? [];

    const metrics: SnapshotMetric[] = [];
    for (const want of WANTED) {
      const stat = categories
        .find((c) => c.name === want.category)
        ?.stats?.find((s) => s.name === want.stat);
      if (!stat) continue;
      const value = format(stat);
      if (value === null) continue;
      metrics.push({
        key: want.key,
        label: want.label,
        value,
        rank: stat.rankDisplayValue?.trim()
          ? shortRank(stat.rankDisplayValue.trim())
          : null,
        rankValue:
          typeof stat.rank === "number" && stat.rank >= 1 && stat.rank <= 32
            ? stat.rank
            : null,
        description: want.description,
      });
    }

    if (metrics.length === 0) {
      throw new Error(`No usable ${season} statistics for ESPN team ${espnId}`);
    }
    return { season, metrics, fetchedAt: Date.now() };
  },
});

/**
 * The snapshot for `season`, or for the season before it.
 *
 * The caller asks for `statsSeason`, which lib/team/nfl-state.ts switches to
 * the current year the moment Sleeper reports Week 1 - days before anybody has
 * played a regular-season game. ESPN has nothing to average until then and
 * answers 404 for the new season outright, so through the opening week the
 * request for the right season returns nothing and the whole block used to
 * disappear from the Stats tab.
 *
 * Last season is real football. It is fetched instead, and `TeamSnapshot.season`
 * carries which one came back so the card can say so - the same fallback, for
 * the same reason, as lib/team/stats.ts, whose Stats tab must not be showing a
 * season this card has given up on.
 */
export async function getTeamSnapshot(
  team: NflTeam,
  season: number,
): Promise<TeamSnapshot | null> {
  const current = await cache.ensure(`${team.espnId}:${season}`);
  if (current) return current;
  return cache.ensure(`${team.espnId}:${season - 1}`);
}
