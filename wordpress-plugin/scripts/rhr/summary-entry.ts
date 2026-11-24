/**
 * Rookie Hit Rates: the default-view summary printed into the WordPress page.
 *
 * Bundled by build-summary.mjs and run once per plugin build, never per page
 * view. Everything numeric comes from the tool's own code, vendored verbatim in
 * ./upstream from statchasersff-bit/Rookie-Hit-Rate at the commit the plugin's
 * app/ bundle was built from (see UPSTREAM_COMMIT). This file only does what the
 * app's data-context.tsx does around that code:
 *
 *   filteredDrafts = drafts filtered to the selected format + scoring
 *   rankMap        = buildRankMap(computeRanks(finishes, scoring))
 *   cohorts        = computeCohorts(filteredDrafts, rankMap,
 *                      { ...filters, positions: [], rounds: [] })   // Overview
 *
 * and then sums cohorts by position the way overview.tsx's
 * generateOverviewInsights() does for its "Overall" and "Highest/Lowest
 * Position Hit Rate" cards. The fetch() the loaders call is stubbed by the
 * runner to read the plugin's own app/data/*.csv, so the summary and the
 * iframe always read the same files.
 */
import { loadRookieDrafts, loadSeasonFinishes } from "./upstream/loaders";
import { computeRanks, buildRankMap } from "./upstream/ranks";
import { computeCohorts, LATEST_SEASON_WITH_DATA } from "./upstream/cohort";
import type { Filters, Pos } from "./upstream/types";

export const UPSTREAM_COMMIT = "9c69b00";

/** data-context.tsx `defaultFilters` at UPSTREAM_COMMIT. */
export const DEFAULT_FILTERS: Filters = {
  yearStart: 2017,
  yearEnd: 2025,
  format: "sf",
  scoring: "ppr",
  outcome: "elite",
  positions: ["QB", "RB", "WR", "TE"],
  rounds: [1, 2, 3, 4, 5],
  minGames: 8,
  showConfidence: false,
};

/** cohort.ts getThreshold(): the same for every position. */
const THRESHOLD = { elite: 12, starter: 24, flex: 36 } as const;

const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE"];

export interface SummaryRow {
  group: string;
  hits: number;
  total: number;
  /** hits / total, or null for a zero denominator. */
  rate: number | null;
  /**
   * What the tool prints: overview.tsx `${(rate * 100).toFixed(1)}%`, made
   * here with the same JS toFixed so PHP never rounds. A zero denominator gets
   * "-" (house placeholder; the heatmap prints a dash for a missing cohort).
   */
  rate_display: string;
}

export async function buildSummary() {
  const filters = DEFAULT_FILTERS;
  const drafts = await loadRookieDrafts();
  const finishes = await loadSeasonFinishes();

  const filteredDrafts = drafts.filter(
    (d) => d.adp_format === filters.format && d.scoring_format === filters.scoring,
  );
  const rankMap = buildRankMap(computeRanks(finishes, filters.scoring));
  const overviewFilters = { ...filters, positions: [] as Pos[], rounds: [] as number[] };
  const cohorts = computeCohorts(filteredDrafts, rankMap, overviewFilters);

  const byPos = new Map<string, { hits: number; total: number }>();
  for (const c of cohorts) {
    const agg = byPos.get(c.pos) ?? { hits: 0, total: 0 };
    agg.hits += c.hits;
    agg.total += c.total;
    byPos.set(c.pos, agg);
  }
  const row = (group: string, hits: number, total: number): SummaryRow => ({
    group,
    hits,
    total,
    rate: total > 0 ? hits / total : null,
    rate_display: total > 0 ? `${((hits / total) * 100).toFixed(1)}%` : "-",
  });
  const rows = POSITIONS.map((p) => {
    const a = byPos.get(p) ?? { hits: 0, total: 0 };
    return row(p, a.hits, a.total);
  });
  const allHits = cohorts.reduce((s, c) => s + c.hits, 0);
  const allTotal = cohorts.reduce((s, c) => s + c.total, 0);

  // The sample the Overview counts: same eligibility as computeCohorts.
  const sample = filteredDrafts.filter(
    (d) =>
      d.rookie_year >= filters.yearStart &&
      d.rookie_year <= filters.yearEnd &&
      d.rookie_year <= LATEST_SEASON_WITH_DATA,
  );
  const classes = Array.from(new Set(sample.map((d) => d.rookie_year))).sort((a, b) => a - b);
  const rounds = Array.from(new Set(sample.map((d) => d.rookie_round))).sort((a, b) => a - b);
  const perClass = classes.map((y) => ({
    year: y,
    rookies: sample.filter((d) => d.rookie_year === y).length,
    seasons_observed: LATEST_SEASON_WITH_DATA - y + 1,
  }));
  // Rookies with no season row at all from their rookie year on: the tool keeps
  // them in the denominator as misses.
  const noSeasons = sample.filter(
    (d) => !(rankMap.get(d.player_id) || []).some((s) => s.season >= d.rookie_year),
  ).length;

  return {
    upstream_commit: UPSTREAM_COMMIT,
    settings: {
      format: filters.format,
      scoring: filters.scoring,
      outcome: filters.outcome,
      threshold: THRESHOLD[filters.outcome],
      year_start: filters.yearStart,
      year_end: filters.yearEnd,
      latest_season: LATEST_SEASON_WITH_DATA,
      min_games: filters.minGames,
      rounds,
    },
    classes: perClass,
    rookies_without_seasons: noSeasons,
    rows,
    total: row("All positions", allHits, allTotal),
    // Per heatmap cell, kept for reconciliation against the tool (not printed).
    cells: cohorts.map((c) => ({ pos: c.pos, round: c.rookie_round, hits: c.hits, total: c.total })),
  };
}
