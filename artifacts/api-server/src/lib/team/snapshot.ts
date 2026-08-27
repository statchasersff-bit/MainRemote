/**
 * Team Snapshot — four offensive rates with their NFL rank.
 *
 * From ESPN's season statistics document, which carries both the per-game value
 * and the league rank for each stat. The rank matters more than the number: a
 * team averaging 21 points is meaningless until you know that is 9th or 27th,
 * and computing a rank ourselves would mean pulling all 32 teams to render one
 * page — precisely the thing the performance brief rules out.
 *
 * Availability is not assumed. A season nobody has played has no averages, so
 * the caller asks for the last COMPLETED season before Week 1 and the card says
 * which season it is describing. If ESPN returns a document without these
 * fields, the metric is dropped; if none of the four survive, the section does
 * not render at all. Nothing here is defaulted to zero or to "N/A".
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "./cache";
import type { NflTeam } from "./teams";


export interface SnapshotMetric {
  /** Short label above the number, e.g. "PASS YDS/G". */
  label: string;
  /** Formatted value, e.g. "250.5". */
  value: string;
  /** Ordinal rank among the 32 teams, e.g. "4th". Null when ESPN omits it. */
  rank: string | null;
  /** 1-32, for the tint that shows good/bad without relying on colour alone. */
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
 * `netYardsPerGame` inside the passing category is ESPN's total-offence figure
 * (it is exactly net passing + rushing), not a passing-only number — which is
 * why the label says Total.
 */
const WANTED: Array<{
  category: string;
  stat: string;
  label: string;
  description: string;
}> = [
  {
    category: "scoring",
    stat: "totalPointsPerGame",
    label: "Points/G",
    description: "Points scored per game",
  },
  {
    category: "passing",
    stat: "netPassingYardsPerGame",
    label: "Pass Yds/G",
    description: "Net passing yards per game",
  },
  {
    category: "rushing",
    stat: "rushingYardsPerGame",
    label: "Rush Yds/G",
    description: "Rushing yards per game",
  },
  {
    category: "passing",
    stat: "netYardsPerGame",
    label: "Total Yds/G",
    description: "Total net yards per game",
  },
];

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
      `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/` +
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
        label: want.label,
        value,
        rank: stat.rankDisplayValue?.trim() || null,
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

export async function getTeamSnapshot(
  team: NflTeam,
  season: number,
): Promise<TeamSnapshot | null> {
  return cache.ensure(`${team.espnId}:${season}`);
}
