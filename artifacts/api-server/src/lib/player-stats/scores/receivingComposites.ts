/**
 * Shared receiving composite-grade engine (WR + TE).
 *
 * WR and TE share the SAME five-category framework — Opportunity, Production,
 * Explosiveness, Hands, Elusiveness, plus a blended Overall grade — for UI /
 * radar / sorting consistency. They differ ONLY in their weighting philosophy:
 * a position supplies its own per-stat weights, qualifier, and overall blend.
 *
 * Architecture: one engine, two configs. All percentile ranking, inversion of
 * "lower is better" stats, and derived-stat preprocessing live here once; the
 * WR/TE configs below are pure data. Mirrors ./percentiles for the shared math.
 */
import { atLeast, clampScore, mix, percentileColumnAgainst, toFiniteNumber as num, type GradeOptions } from './percentiles';

type Row = Record<string, unknown>;

// Stats where a lower raw value is better — percentiles are inverted for these.
const INVERTED = new Set(['drops', 'dropPct', 'interceptionsWhenTargeted', 'fumbles']);

// Derived stats (not present as a raw column). Everything else reads num(row[key]).
const DERIVED: Record<string, (r: Row) => number> = {
  // Per game, so a player who missed games is measured on the ones he played.
  targetsPerGame: r => perGame(r, num(r.targets)),
  // The feed has no raw air yards for receivers: AY/TGT × targets gives them back.
  airYardsPerGame: r => perGame(r, num(r.airYardsPerTarget) * num(r.targets)),
  redZoneTargetsPerGame: r => perGame(r, num(r.redZoneTargets)),
  fantasyPointsPerGame: r => perGame(r, num(r.fantasyPoints)),
  receptionsPerGame: r => perGame(r, num(r.receptions)),
  receivingYardsPerGame: r => perGame(r, num(r.receivingYards)),
  // YAC and YBC are per reception in the feed: × receptions gives the totals.
  yardsAfterCatchPerGame: r => perGame(r, num(r.yardsAfterCatchPerReception) * num(r.receptions)),
  yardsBeforeCatchPerGame: r => perGame(r, num(r.yardsBeforeCatchPerReception) * num(r.receptions)),
};
function perGame(r: Row, total: number): number {
  const g = num(r.games);
  return g > 0 ? total / g : 0;
}
const accessorFor = (stat: string) => DERIVED[stat] ?? ((r: Row) => num(r[stat]));

/** stat key → weight within one composite. Weights should sum to 1. */
type Weights = Record<string, number>;

export interface ReceivingConfig {
  position: string;
  /** Field name the Overall grade is written to (e.g. 'overallWRGrade'). */
  overallKey: string;
  /**
   * Percentile-baseline qualifier — low-sample players don't define the curve.
   * `scale` shrinks it for a season in progress (see GradeOptions).
   */
  qualify: (row: Row, scale?: number) => boolean;
  weights: {
    opportunity: Weights;
    production: Weights;
    explosiveness: Weights;
    hands: Weights;
    elusiveness: Weights;
  };
  /** Blend of the five composites into the Overall grade (should sum to 1). */
  overall: { opportunity: number; production: number; explosiveness: number; hands: number; elusiveness: number };
}

export interface ReceivingScoreCategory {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * Compute the five composites + Overall for a population of receiver rows.
 * Percentiles are ranked against the QUALIFIED subset (per config.qualify) so
 * low-volume players don't define the distribution, but every row gets a score.
 */
export function buildReceivingComposites<T extends Row>(
  config: ReceivingConfig,
  rows: T[],
  opts: GradeOptions = {},
): Array<Record<string, number>> {
  if (!rows.length) return [];
  const baseline = rows.filter(r => config.qualify(r, opts.scale));
  // A season in progress has its own Opportunity mix; see OPPORTUNITY_IN_PROGRESS.
  const weights = {
    ...config.weights,
    ...((opts.scale ?? 1) < 1 ? { opportunity: OPPORTUNITY_IN_PROGRESS } : {}),
  };

  // Percentile-rank every stat referenced by any composite, once.
  const stats = new Set<string>();
  for (const comp of Object.values(weights)) for (const k of Object.keys(comp)) stats.add(k);
  const pmap: Record<string, number[] | null> = {};
  for (const stat of stats) {
    if (opts.omit?.has(stat)) {
      pmap[stat] = null;
      continue;
    }
    const dir = INVERTED.has(stat) ? 'lowerIsBetter' : 'higherIsBetter';
    pmap[stat] = percentileColumnAgainst<Row, Row>(rows, accessorFor(stat), baseline, dir);
  }

  const combine = (w: Weights, i: number) =>
    mix(Object.entries(w).map(([stat, weight]) => [pmap[stat] ?? null, weight]), i);

  const o = config.overall;
  return rows.map((_, i) => {
    const opportunityScore = clampScore(combine(weights.opportunity, i));
    const productionScore = clampScore(combine(weights.production, i));
    const explosivenessScore = clampScore(combine(weights.explosiveness, i));
    const handsScore = clampScore(combine(weights.hands, i));
    const elusivenessScore = clampScore(combine(weights.elusiveness, i));
    const overall = clampScore(
      opportunityScore * o.opportunity +
        productionScore * o.production +
        explosivenessScore * o.explosiveness +
        handsScore * o.hands +
        elusivenessScore * o.elusiveness,
    );
    return {
      opportunityScore,
      productionScore,
      explosivenessScore,
      handsScore,
      elusivenessScore,
      [config.overallKey]: overall,
    };
  });
}

// ---------------------------------------------------------------------------
// Opportunity — the same mix for WR and TE (the user's weights, 2026-09-23).
// Targets, air yards and red-zone targets are per game played.
// ---------------------------------------------------------------------------
const OPPORTUNITY: Weights = {
  targetsPerGame: 0.30, airYardsPerGame: 0.20, routes: 0.15, targetSharePct: 0.10,
  airYardsSharePct: 0.10, redZoneTargetsPerGame: 0.10, targetsPerRouteRun: 0.05,
};

/**
 * A season in progress: no routes yet (nflverse publishes participation late)
 * and a small sample, so snap share stands in for routes and target share
 * carries more.
 */
const OPPORTUNITY_IN_PROGRESS: Weights = {
  targetsPerGame: 0.25, airYardsPerGame: 0.20, snapPct: 0.20, targetSharePct: 0.15,
  airYardsSharePct: 0.10, redZoneTargetsPerGame: 0.10,
};

const OPPORTUNITY_DESCRIPTION =
  'Opportunity (0-100): offensive role & target earning. Targets/G 30%, Air Yds/G 20%, Routes 15%, Target Share% 10%, AY Share% 10%, RZ TGT/G 10%, TPRR 5%.';
const OPPORTUNITY_IN_PROGRESS_DESCRIPTION =
  'Opportunity (0-100), season in progress: offensive role & target earning. Targets/G 25%, Air Yds/G 20%, Snap% 20% (standing in for routes), Target Share% 15%, AY Share% 10%, RZ TGT/G 10%.';

// ---------------------------------------------------------------------------
// Production — the same mix for WR and TE (the user's weights, 2026-09-23).
// Everything but YPRR, success rate and Y/R is per game played.
// ---------------------------------------------------------------------------
const PRODUCTION: Weights = {
  receivingYardsPerGame: 0.25, receptionsPerGame: 0.20, fantasyPointsPerGame: 0.15,
  yardsPerRouteRun: 0.10, successRate: 0.10, yardsPerReception: 0.10,
  yardsAfterCatchPerGame: 0.05, yardsBeforeCatchPerGame: 0.05,
};

const PRODUCTION_DESCRIPTION =
  'Production (0-100): per-game output. Rec Yds/G 25%, Rec/G 20%, FPTS/G 15%, YPRR 10%, Success% 10%, Y/R 10%, YAC/G 5%, YBC/G 5%.';
// No routes yet: YPRR drops out and the rest are reweighted (see GradeOptions.omit).
const PRODUCTION_IN_PROGRESS_DESCRIPTION =
  'Production (0-100), season in progress: per-game output. Rec Yds/G 25%, Rec/G 20%, FPTS/G 15%, YPRR 10% (left out until routes are published, the rest reweighted), Success% 10%, Y/R 10%, YAC/G 5%, YBC/G 5%.';

/** A position's categories with the tooltips for a season in progress. */
export function inProgressCategories(categories: ReceivingScoreCategory[]): ReceivingScoreCategory[] {
  return categories.map(c =>
    c.key === 'opportunityScore'
      ? { ...c, description: OPPORTUNITY_IN_PROGRESS_DESCRIPTION }
      : c.key === 'productionScore'
        ? { ...c, description: PRODUCTION_IN_PROGRESS_DESCRIPTION }
        : c,
  );
}

// ---------------------------------------------------------------------------
// WR config — earning and converting targets drive WR fantasy value, so Opportunity
// & Production are weighted heaviest; Explosiveness/Elusiveness carry real
// weight (deep threats, YAC monsters).
// ---------------------------------------------------------------------------
export const WR_RECEIVING_CONFIG: ReceivingConfig = {
  position: 'WR',
  overallKey: 'overallWRGrade',
  qualify: (row, scale) => num(row.targets) >= atLeast(40, scale) || num(row.routes) >= atLeast(150, scale),
  weights: {
    opportunity: OPPORTUNITY,
    production: PRODUCTION,
    explosiveness: {
      airYardsPerTarget: 0.25, airYardsPerReception: 0.20, receptions20Plus: 0.20,
      receptions30Plus: 0.15, receptions40Plus: 0.10, receptions50Plus: 0.05, longestReception: 0.05,
    },
    // Contested-catch% is unavailable in the feed (all null), so it's omitted
    // and the remaining weights are renormalized to sum to 1.
    hands: {
      catchPct: 0.40, catchableTargets: 0.20, drops: 0.20, dropPct: 0.15, interceptionsWhenTargeted: 0.05,
    },
    // Yards-after-contact/reception is unavailable in the feed (all null), so it's
    // omitted and the remaining weights renormalized.
    elusiveness: {
      avoidedTackleRate: 0.40, brokenTackles: 0.30, yardsAfterCatchPerReception: 0.25, fumbles: 0.05,
    },
  },
  overall: { opportunity: 0.25, production: 0.25, explosiveness: 0.20, hands: 0.15, elusiveness: 0.15 },
};

// ---------------------------------------------------------------------------
// TE config — TE value is driven by opportunity, reliability and production far
// more than pure explosiveness/YAC, so Opportunity/Hands are up-weighted and
// Explosiveness/Elusiveness down-weighted vs. WR.
// ---------------------------------------------------------------------------
export const TE_RECEIVING_CONFIG: ReceivingConfig = {
  position: 'TE',
  overallKey: 'overallTEGrade',
  qualify: (row, scale) => num(row.targets) >= atLeast(25, scale) || num(row.routes) >= atLeast(100, scale),
  weights: {
    opportunity: OPPORTUNITY,
    production: PRODUCTION,
    explosiveness: {
      airYardsPerTarget: 0.30, airYardsPerReception: 0.25, receptions20Plus: 0.20,
      receptions30Plus: 0.10, receptions40Plus: 0.10, longestReception: 0.05,
    },
    // Contested-catch% is unavailable in the feed (all null), so it's omitted
    // and the remaining weights renormalized to sum to 1.
    hands: {
      catchPct: 0.45, catchableTargets: 0.20, drops: 0.20, dropPct: 0.075, interceptionsWhenTargeted: 0.075,
    },
    // Yards-after-contact/reception is unavailable in the feed (all null), so it's
    // omitted and the remaining weights renormalized.
    elusiveness: {
      avoidedTackleRate: 0.40, brokenTackles: 0.35, yardsAfterCatchPerReception: 0.20, fumbles: 0.05,
    },
  },
  overall: { opportunity: 0.30, production: 0.25, hands: 0.20, explosiveness: 0.15, elusiveness: 0.10 },
};

// ---------------------------------------------------------------------------
// WR public surface (matches the QB/RB engine shape used by the table).
// ---------------------------------------------------------------------------
export const WR_SCORE_CATEGORIES: ReceivingScoreCategory[] = [
  {
    key: 'overallWRGrade', label: 'Overall', shortLabel: 'Overall',
    description: 'Overall WR Grade (0-100): Opportunity 25%, Production 25%, Explosiveness 20%, Hands 15%, Elusiveness 15%. Slightly favors earning & converting targets. Percentile-based vs. qualified WRs.',
  },
  {
    key: 'opportunityScore', label: 'Opportunity', shortLabel: 'Opp',
    description: OPPORTUNITY_DESCRIPTION,
  },
  {
    key: 'productionScore', label: 'Production', shortLabel: 'Prod',
    description: PRODUCTION_DESCRIPTION,
  },
  {
    key: 'explosivenessScore', label: 'Explosiveness', shortLabel: 'Exp',
    description: 'Explosiveness (0-100): vertical threat & big-play upside. AY/TGT 25%, AY/Rec 20%, 20+ 20%, 30+ 15%, 40+ 10%, 50+ 5%, Longest Rec 5%.',
  },
  {
    key: 'handsScore', label: 'Hands', shortLabel: 'Hnd',
    description: 'Hands (0-100): reliability & catch consistency. Catch% 40%, Catchable TGT 20%, Drops 20% (inv), Drop% 15% (inv), INT-when-targeted 5% (inv).',
  },
  {
    key: 'elusivenessScore', label: 'Elusiveness', shortLabel: 'Elu',
    description: 'Elusiveness (0-100): YAC creation & tackle-breaking. Avoided-tackle% 40%, Broken Tackles 30%, YAC/R 25%, Fumbles 5% (inv).',
  },
];

// ---------------------------------------------------------------------------
// TE public surface — same categories, TE-optimized weighting (see descriptions).
// ---------------------------------------------------------------------------
export const TE_SCORE_CATEGORIES: ReceivingScoreCategory[] = [
  {
    key: 'overallTEGrade', label: 'Overall', shortLabel: 'Overall',
    description: 'Overall TE Grade (0-100): Opportunity 30%, Production 25%, Hands 20%, Explosiveness 15%, Elusiveness 10%. Weighted for TE value — opportunity, reliability & production over pure explosiveness. Percentile-based vs. qualified TEs.',
  },
  {
    key: 'opportunityScore', label: 'Opportunity', shortLabel: 'Opp',
    description: OPPORTUNITY_DESCRIPTION,
  },
  {
    key: 'productionScore', label: 'Production', shortLabel: 'Prod',
    description: PRODUCTION_DESCRIPTION,
  },
  {
    key: 'explosivenessScore', label: 'Explosiveness', shortLabel: 'Exp',
    description: 'Explosiveness (0-100): downfield & big-play ability (weighted lighter for TEs). AY/TGT 30%, AY/Rec 25%, 20+ 20%, 30+ 10%, 40+ 10%, Longest Rec 5%.',
  },
  {
    key: 'handsScore', label: 'Hands', shortLabel: 'Hnd',
    description: 'Hands (0-100): reliability & catch consistency — weighted heavier for TEs. Catch% 45%, Catchable TGT 20%, Drops 20% (inv), Drop% 7.5% (inv), INT-when-targeted 7.5% (inv).',
  },
  {
    key: 'elusivenessScore', label: 'Elusiveness', shortLabel: 'Elu',
    description: 'Elusiveness (0-100): YAC & tackle-breaking. Avoided-tackle% 40%, Broken Tackles 35%, YAC/R 20%, Fumbles 5% (inv).',
  },
];

export const WR_SCORE_KEYS = WR_SCORE_CATEGORIES.map(c => c.key);
export const TE_SCORE_KEYS = TE_SCORE_CATEGORIES.map(c => c.key);

export const isQualifiedWr = (row: Record<string, unknown>, scale = 1): boolean => WR_RECEIVING_CONFIG.qualify(row, scale);
export const isQualifiedTe = (row: Record<string, unknown>, scale = 1): boolean => TE_RECEIVING_CONFIG.qualify(row, scale);

export const computeWrCompositeScores = <T extends Row>(rows: T[], opts?: GradeOptions) => buildReceivingComposites(WR_RECEIVING_CONFIG, rows, opts);
export const computeTeCompositeScores = <T extends Row>(rows: T[], opts?: GradeOptions) => buildReceivingComposites(TE_RECEIVING_CONFIG, rows, opts);
