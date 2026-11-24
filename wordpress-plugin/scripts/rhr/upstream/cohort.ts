import type { RookieDraft, RankedSeason, CohortSummary, PickRangeCohortSummary, Pos, Outcome, Filters } from "./types";

export const LATEST_SEASON_WITH_DATA = 2025;

function getThreshold(outcome: Outcome, pos: Pos): number {
  switch (outcome) {
    case "elite": return 12;
    case "starter": return 24;
    case "flex": return 36;
  }
}

function wilsonCI(hits: number, total: number): { lower: number; upper: number; width: number } {
  if (total === 0) return { lower: 0, upper: 0, width: 0 };
  const z = 1.96;
  const p = hits / total;
  const denom = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / total + z * z / (4 * total * total));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    width: Math.min(1, center + margin) - Math.max(0, center - margin),
  };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeCohorts(
  drafts: RookieDraft[],
  rankMap: Map<string, RankedSeason[]>,
  filters: Filters
): CohortSummary[] {
  const filtered = drafts.filter((d) => {
    if (d.rookie_year < filters.yearStart || d.rookie_year > filters.yearEnd) return false;
    if (d.rookie_year > LATEST_SEASON_WITH_DATA) return false;
    if (filters.positions.length > 0 && !filters.positions.includes(d.pos)) return false;
    if (filters.rounds.length > 0 && !filters.rounds.includes(d.rookie_round)) return false;
    return true;
  });

  const groups = new Map<string, RookieDraft[]>();
  for (const d of filtered) {
    const key = `${d.pos}-${d.rookie_round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const results: CohortSummary[] = [];

  for (const [key, group] of groups) {
    const [pos, roundStr] = key.split("-");
    const round = parseInt(roundStr);
    const position = pos as Pos;

    let hits = 0, eliteHits = 0, starterHits = 0, flexHits = 0, bustCount = 0;
    const breakouts: number[] = [];
    let year1Hits = 0, year2Hits = 0, year3PlusHits = 0;
    const years = new Set<number>();

    for (const draft of group) {
      years.add(draft.rookie_year);
      const seasons = rankMap.get(draft.player_id) || [];
      const validSeasons = seasons.filter((s) => s.games >= filters.minGames && s.season >= draft.rookie_year);

      let isHit = false;
      let firstHitSeason: number | null = null;
      let bestRank = Infinity;

      for (const s of validSeasons.sort((a, b) => a.season - b.season)) {
        if (s.pos_rank < bestRank) bestRank = s.pos_rank;

        const threshold = getThreshold(filters.outcome, position);
        if (!isHit && s.pos_rank <= threshold) {
          isHit = true;
          firstHitSeason = s.season;
        }
      }

      const eliteT = getThreshold("elite", position);
      const starterT = getThreshold("starter", position);
      const flexT = getThreshold("flex", position);

      if (bestRank <= eliteT) eliteHits++;
      else if (bestRank <= starterT) starterHits++;
      else if (bestRank <= flexT) flexHits++;
      else bustCount++;

      if (isHit) {
        hits++;

        if (firstHitSeason !== null) {
          const bt = firstHitSeason - draft.rookie_year + 1;
          breakouts.push(bt);
          if (bt === 1) year1Hits++;
          else if (bt === 2) year2Hits++;
          else year3PlusHits++;
        }
      }
    }

    const total = group.length;
    const ci = wilsonCI(hits, total);

    results.push({
      pos: position,
      rookie_round: round,
      dynasty_years: Array.from(years).sort(),
      total,
      hits,
      hit_rate: total > 0 ? hits / total : 0,
      elite_hits: eliteHits,
      elite_rate: total > 0 ? eliteHits / total : 0,
      starter_hits: starterHits,
      starter_rate: total > 0 ? starterHits / total : 0,
      flex_hits: flexHits,
      flex_rate: total > 0 ? flexHits / total : 0,
      bust_count: bustCount,
      bust_rate: total > 0 ? bustCount / total : 0,
      median_breakout: median(breakouts),
      hit_by_year: {
        year1: hits > 0 ? year1Hits / hits : 0,
        year2: hits > 0 ? year2Hits / hits : 0,
        year3_plus: hits > 0 ? year3PlusHits / hits : 0,
      },
      ci_lower: ci.lower,
      ci_upper: ci.upper,
      ci_width: ci.width,
    });
  }

  return results.sort((a, b) => {
    const posOrder = ["QB", "RB", "WR", "TE"];
    const pi = posOrder.indexOf(a.pos) - posOrder.indexOf(b.pos);
    return pi !== 0 ? pi : a.rookie_round - b.rookie_round;
  });
}

function getPickRange(pick: number): { start: number; end: number } {
  if (pick <= 3) return { start: 1, end: 3 };
  if (pick <= 6) return { start: 4, end: 6 };
  if (pick <= 9) return { start: 7, end: 9 };
  return { start: 10, end: 12 };
}

function pickRangeLabel(round: number, start: number, end: number): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${round}.${pad(start)}-${round}.${pad(end)}`;
}

export function computePickRangeCohorts(
  drafts: RookieDraft[],
  rankMap: Map<string, RankedSeason[]>,
  filters: Filters
): PickRangeCohortSummary[] {
  const filtered = drafts.filter((d) => {
    if (d.rookie_year < filters.yearStart || d.rookie_year > filters.yearEnd) return false;
    if (d.rookie_year > LATEST_SEASON_WITH_DATA) return false;
    if (filters.positions.length > 0 && !filters.positions.includes(d.pos)) return false;
    if (filters.rounds.length > 0 && !filters.rounds.includes(d.rookie_round)) return false;
    return true;
  });

  const groups = new Map<string, RookieDraft[]>();
  for (const d of filtered) {
    const range = getPickRange(d.rookie_pick);
    const key = `${d.pos}-${d.rookie_round}-${range.start}-${range.end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const results: PickRangeCohortSummary[] = [];

  for (const [key, group] of groups) {
    const parts = key.split("-");
    const pos = parts[0] as Pos;
    const round = parseInt(parts[1]);
    const pickStart = parseInt(parts[2]);
    const pickEnd = parseInt(parts[3]);

    let hits = 0, eliteHits = 0, starterHits = 0, flexHits = 0, bustCount = 0;
    const breakouts: number[] = [];
    let year1Hits = 0, year2Hits = 0, year3PlusHits = 0;
    const years = new Set<number>();

    for (const draft of group) {
      years.add(draft.rookie_year);
      const seasons = rankMap.get(draft.player_id) || [];
      const validSeasons = seasons.filter((s) => s.games >= filters.minGames && s.season >= draft.rookie_year);

      let isHit = false;
      let firstHitSeason: number | null = null;
      let bestRank = Infinity;

      for (const s of validSeasons.sort((a, b) => a.season - b.season)) {
        if (s.pos_rank < bestRank) bestRank = s.pos_rank;
        const threshold = getThreshold(filters.outcome, pos);
        if (!isHit && s.pos_rank <= threshold) {
          isHit = true;
          firstHitSeason = s.season;
        }
      }

      const eliteT = getThreshold("elite", pos);
      const starterT = getThreshold("starter", pos);
      const flexT = getThreshold("flex", pos);

      if (bestRank <= eliteT) eliteHits++;
      else if (bestRank <= starterT) starterHits++;
      else if (bestRank <= flexT) flexHits++;
      else bustCount++;

      if (isHit) {
        hits++;
        if (firstHitSeason !== null) {
          const bt = firstHitSeason - draft.rookie_year + 1;
          breakouts.push(bt);
          if (bt === 1) year1Hits++;
          else if (bt === 2) year2Hits++;
          else year3PlusHits++;
        }
      }
    }

    const total = group.length;
    const ci = wilsonCI(hits, total);

    results.push({
      pos,
      rookie_round: round,
      pickStart,
      pickEnd,
      rangeLabel: pickRangeLabel(round, pickStart, pickEnd),
      dynasty_years: Array.from(years).sort(),
      total,
      hits,
      hit_rate: total > 0 ? hits / total : 0,
      elite_hits: eliteHits,
      elite_rate: total > 0 ? eliteHits / total : 0,
      starter_hits: starterHits,
      starter_rate: total > 0 ? starterHits / total : 0,
      flex_hits: flexHits,
      flex_rate: total > 0 ? flexHits / total : 0,
      bust_count: bustCount,
      bust_rate: total > 0 ? bustCount / total : 0,
      median_breakout: median(breakouts),
      hit_by_year: {
        year1: hits > 0 ? year1Hits / hits : 0,
        year2: hits > 0 ? year2Hits / hits : 0,
        year3_plus: hits > 0 ? year3PlusHits / hits : 0,
      },
      ci_lower: ci.lower,
      ci_upper: ci.upper,
      ci_width: ci.width,
    });
  }

  return results.sort((a, b) => {
    const posOrder = ["QB", "RB", "WR", "TE"];
    const pi = posOrder.indexOf(a.pos) - posOrder.indexOf(b.pos);
    if (pi !== 0) return pi;
    if (a.rookie_round !== b.rookie_round) return a.rookie_round - b.rookie_round;
    return a.pickStart - b.pickStart;
  });
}

export interface TrendPoint {
  year: number;
  hitRate: number;
  n: number;
  hits: number;
  eliteHits: number;
  starterHits: number;
  bustCount: number;
  incomplete: boolean;
}

export function computeTrends(
  drafts: RookieDraft[],
  rankMap: Map<string, RankedSeason[]>,
  pos: Pos,
  round: number,
  outcome: Outcome,
  minGames: number
): TrendPoint[] {
  const yearGroups = new Map<number, RookieDraft[]>();
  for (const d of drafts) {
    if (d.pos !== pos || d.rookie_round !== round) continue;
    if (d.rookie_year > LATEST_SEASON_WITH_DATA) continue;
    if (!yearGroups.has(d.rookie_year)) yearGroups.set(d.rookie_year, []);
    yearGroups.get(d.rookie_year)!.push(d);
  }

  const results: TrendPoint[] = [];
  const currentYear = LATEST_SEASON_WITH_DATA;
  for (const [year, group] of yearGroups) {
    let hits = 0, eliteHits = 0, starterHits = 0, bustCount = 0;
    for (const d of group) {
      const seasons = rankMap.get(d.player_id) || [];
      const threshold = getThreshold(outcome, pos);
      const isHit = seasons.some((s) => s.games >= minGames && s.season >= d.rookie_year && s.pos_rank <= threshold);
      if (isHit) hits++;

      let bestRank = Infinity;
      for (const s of seasons) {
        if (s.games >= minGames && s.pos_rank < bestRank) bestRank = s.pos_rank;
      }
      if (bestRank <= 12) eliteHits++;
      else if (bestRank <= 24) starterHits++;
      else if (bestRank > 36) bustCount++;
    }
    const seasonsPlayed = currentYear - year;
    results.push({
      year,
      hitRate: group.length > 0 ? hits / group.length : 0,
      n: group.length,
      hits,
      eliteHits,
      starterHits,
      bustCount,
      incomplete: seasonsPlayed < 3,
    });
  }

  return results.sort((a, b) => a.year - b.year);
}

export interface SurvivalGroup {
  group: string;
  n: number;
  data: { year: number; pct: number; hits: number; eligible: number }[];
}

export function computeSurvival(
  drafts: RookieDraft[],
  rankMap: Map<string, RankedSeason[]>,
  groupBy: "pos" | "round",
  outcome: Outcome,
  minGames: number,
  filterPos?: Pos[],
  filterRounds?: number[]
): SurvivalGroup[] {
  const groups = new Map<string, RookieDraft[]>();

  for (const d of drafts) {
    if (d.rookie_year > LATEST_SEASON_WITH_DATA) continue;
    if (filterPos && filterPos.length > 0 && !filterPos.includes(d.pos)) continue;
    if (filterRounds && filterRounds.length > 0 && !filterRounds.includes(d.rookie_round)) continue;
    const key = groupBy === "pos" ? d.pos : `Round ${d.rookie_round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const results: SurvivalGroup[] = [];
  const currentYear = LATEST_SEASON_WITH_DATA;

  for (const [group, gDrafts] of groups) {
    const total = gDrafts.length;
    const data: { year: number; pct: number; hits: number; eligible: number }[] = [];

    for (let yr = 1; yr <= 6; yr++) {
      let hitsByYear = 0;
      let eligible = 0;
      for (const d of gDrafts) {
        if (d.rookie_year + yr - 1 > currentYear) continue;
        eligible++;
        const seasons = rankMap.get(d.player_id) || [];
        const threshold = getThreshold(outcome, d.pos);
        const hasHit = seasons.some(
          (s) => s.games >= minGames && s.season >= d.rookie_year && s.season <= d.rookie_year + yr - 1 && s.pos_rank <= threshold
        );
        if (hasHit) hitsByYear++;
      }
      const rawPct = eligible > 0 ? hitsByYear / eligible : 0;
      const prevPct = data.length > 0 ? data[data.length - 1].pct : 0;
      data.push({ year: yr, pct: Math.max(rawPct, prevPct), hits: hitsByYear, eligible });
    }

    results.push({ group, n: total, data });
  }

  return results.sort((a, b) => a.group.localeCompare(b.group));
}

export function computePlayerSummaries(
  drafts: RookieDraft[],
  rankMap: Map<string, RankedSeason[]>,
  outcome: Outcome,
  minGames: number
): import("./types").PlayerSummary[] {
  return drafts.map((d) => {
    // Restrict to the player's own career (rookie year onward). Some source rows
    // carry seasons that predate the rookie year — e.g. a junior's id colliding
    // with the senior's history — which would otherwise yield a "hit" (and a
    // negative breakout year like "Year -6") from before they entered the league.
    const seasons = (rankMap.get(d.player_id) || [])
      .filter((s) => s.season >= d.rookie_year)
      .sort((a, b) => a.season - b.season);
    const threshold = getThreshold(outcome, d.pos);

    let bestRank = Infinity;
    let bestYear = d.rookie_year;
    let firstHitSeason: number | null = null;

    for (const s of seasons) {
      if (s.pos_rank < bestRank) {
        bestRank = s.pos_rank;
        bestYear = s.season;
      }
      if (firstHitSeason === null && s.games >= minGames && s.pos_rank <= threshold) {
        firstHitSeason = s.season;
      }
    }

    let bestQualifiedRank = Infinity;
    for (const s of seasons) {
      if (s.games >= minGames && s.pos_rank < bestQualifiedRank) {
        bestQualifiedRank = s.pos_rank;
      }
    }

    let hitType: "elite" | "starter" | "flex" | "bust" | "too_early" = "bust";
    if (d.rookie_year > LATEST_SEASON_WITH_DATA) hitType = "too_early";
    else if (bestQualifiedRank <= 12) hitType = "elite";
    else if (bestQualifiedRank <= 24) hitType = "starter";
    else if (bestQualifiedRank <= 36) hitType = "flex";

    return {
      player_id: d.player_id,
      player_name: d.player_name,
      pos: d.pos,
      rookie_year: d.rookie_year,
      rookie_round: d.rookie_round,
      rookie_pick: d.rookie_pick,
      current_nfl_team: d.current_nfl_team,
      current_age: d.current_age,
      height: d.height,
      weight: d.weight,
      best_finish: bestRank <= 999 ? `${d.pos}${bestRank} (${bestYear})` : "N/A",
      best_finish_year: bestYear,
      breakout_year: firstHitSeason !== null ? firstHitSeason - d.rookie_year + 1 : null,
      breakout_time: firstHitSeason !== null ? firstHitSeason - d.rookie_year + 1 : null,
      hit_type: hitType,
      seasons,
    };
  });
}
