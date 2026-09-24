/**
 * RB composite-grade engine.
 *
 * Produces five normalized 0-100 grades — Volume, Production, Explosiveness,
 * Receiving, Elusiveness — plus a blended Overall RB Grade. Every input stat is
 * first converted to a percentile rank across the supplied population (never a
 * raw average), so grades are always relative to the RB pool passed in.
 *
 * Each composite is built to capture a DISTINCT trait so the five axes spread
 * cleanly on a radar chart (bellcows score Volume, scat-backs score Receiving,
 * home-run backs score Explosiveness, etc.). Volume, and Production's counts,
 * are read PER GAME, so a back who missed games is not graded down for the
 * games he missed; Production is the one grade that takes yards and fantasy
 * points directly (2026-09-24, by request).
 *
 * Modularity: all the percentile/clamp math lives in ./percentiles (position-
 * agnostic). This file only owns the RB field map + category weights, mirroring
 * the QB engine's shape.
 */
import { atLeast, clampScore, mix, percentileColumnAgainst, toFiniteNumber as num, type GradeOptions } from './percentiles';

/**
 * Qualifier for the percentile baseline. Tiny-sample backs would otherwise
 * distort the distribution, so percentiles are ranked against RBs meeting this
 * bar (a real ground game OR a real receiving role). Scores are still produced
 * for everyone — unqualified RBs are just measured against the qualified curve.
 */
export function isQualifiedRb(row: Record<string, unknown>, scale = 1): boolean {
  return num(row.rushAttempts) >= atLeast(50, scale) || num(row.targets) >= atLeast(25, scale);
}

export interface RbCompositeScores {
  volumeScore: number;
  productionScore: number;
  explosivenessScore: number;
  receivingScore: number;
  elusivenessScore: number;
  overallRBGrade: number;
}

export type RbScoreKey = keyof RbCompositeScores;

/** Display metadata for each grade — drives column labels, tooltips, radar axes. */
export interface RbScoreCategory {
  key: RbScoreKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const RB_SCORE_CATEGORIES: RbScoreCategory[] = [
  {
    key: 'overallRBGrade',
    label: 'Overall',
    shortLabel: 'Overall',
    description:
      'Overall RB Grade (0-100): Volume 35%, Production 35%, Explosiveness 15%, Elusiveness 10%, Receiving 5%. Led by workload and what it produces, because fantasy RB scoring is opportunity-driven. Percentile-based vs. qualified RBs.',
  },
  {
    key: 'volumeScore',
    label: 'Volume',
    shortLabel: 'Vol',
    description:
      'Volume (0-100): workload & opportunity per game — identifies bellcows and high-floor backs. Rush Att/G 35%, Targets/G 30%, Snap% 15%, GL Carries/G 15%, RZ Opp/G 5%.',
  },
  {
    key: 'productionScore',
    label: 'Production',
    shortLabel: 'Prod',
    description:
      'Production (0-100): what the workload turns into. Scrimmage Yds/G 33%, Y/C 28%, Y/R 22%, FPTS/G 17% (the 30/25/20/15 split, scaled to 100%). Ranked vs. qualified RBs.',
  },
  {
    key: 'explosivenessScore',
    label: 'Explosiveness',
    shortLabel: 'Exp',
    description:
      'Explosiveness (0-100): home-run ability & big-play upside. Explosive% 25%, Breakaway% 20%, 10+ 20%, 20+ 15%, 30+ 10%, Longest Rush 5%, Longest Rush TD 5%.',
  },
  {
    key: 'receivingScore',
    label: 'Receiving',
    shortLabel: 'Rec',
    description:
      'Receiving (0-100): pass-game value & PPR upside. Targets 20%, Target Share% 20%, Receptions 15%, Rec Yds 15%, Y/R 10%, Rec YAC 10%, YPRR 5%, Rec TDs 5%.',
  },
  {
    key: 'elusivenessScore',
    label: 'Elusiveness',
    shortLabel: 'Elu',
    description:
      'Elusiveness (0-100): self-created yardage & tackle-breaking. Broken Tackles 25%, Broken-tackle rate 25%, YAC/Att 25%, Tackle-eluded rate 15%, Rec YAC 5%, Fumble rate 5% (inverted).',
  },
];

/** Ordered grade keys (overall first) for sorting menus, radar axes, etc. */
export const RB_SCORE_KEYS: RbScoreKey[] = RB_SCORE_CATEGORIES.map(c => c.key);

type RbRow = Record<string, unknown>;

// Safe rate helpers — return 0 when the denominator is 0 so divide-by-zero rows
// sink to the bottom of the curve rather than throwing or spiking.
const fumbleRate = (r: RbRow) => { const a = num(r.rushAttempts); return a > 0 ? num(r.fumbles) / a : 0; };
// Broken tackles per attempt — invert the "attempts per broken tackle" rate so
// higher = breaks tackles more often. 0 attempts/brk-tkl (never broke one) → 0.
const brokenTackleRate = (r: RbRow) => { const x = num(r.rushAttemptsPerBrokenTackle); return x > 0 ? 1 / x : 0; };
// A season count per game played. No games → 0, to the bottom of the curve.
const perGame = (r: RbRow, value: number) => { const g = num(r.games); return g > 0 ? value / g : 0; };

/**
 * Compute composite grades for a population of RB rows. Pass the full RB pool
 * (not a filtered/sorted subset). Percentiles are ranked against the QUALIFIED
 * subset (see {@link isQualifiedRb}) so low-volume backs don't define the
 * distribution, but every row still receives a score.
 */
export function computeRbCompositeScores<T extends RbRow>(rows: T[], opts: GradeOptions = {}): RbCompositeScores[] {
  if (!rows.length) return [];

  // Baseline = qualified RBs (falls back to all rows if none qualify).
  const baseline = rows.filter(r => isQualifiedRb(r, opts.scale));

  // Percentile array per input stat (aligned to `rows`), ranked vs. the
  // qualified baseline. "lowerIsBetter" stats are pre-inverted here.
  const pcol = (accessor: (r: RbRow) => number, direction: 'higherIsBetter' | 'lowerIsBetter' = 'higherIsBetter') =>
    percentileColumnAgainst<RbRow, RbRow>(rows, accessor, baseline, direction);

  const p = {
    // Volume (per game, but for snap share, which is already a rate)
    rushAttemptsPerGame: pcol(r => perGame(r, num(r.rushAttempts))),
    targetsPerGame: pcol(r => perGame(r, num(r.targets))),
    snapPct: pcol(r => num(r.snapPct)),
    goalLineCarriesPerGame: pcol(r => perGame(r, num(r.goalLineCarries))),
    redZoneOpportunitiesPerGame: pcol(r => perGame(r, num(r.redZoneOpportunities))),

    // Production
    scrimmageYardsPerGame: pcol(r => perGame(r, num(r.rushYards) + num(r.receivingYards))),
    yardsPerCarry: pcol(r => num(r.yardsPerCarry)),
    fantasyPointsPerGame: pcol(r => perGame(r, num(r.fantasyPoints))),

    // Receiving
    targets: pcol(r => num(r.targets)),
    yardsPerRouteRun: opts.omit?.has('yardsPerRouteRun') ? null : pcol(r => num(r.yardsPerRouteRun)),

    // Explosiveness
    explosiveRunPct: pcol(r => num(r.explosiveRunPct)),
    breakawayRunPct: pcol(r => num(r.breakawayRunPct)),
    rushes10Plus: pcol(r => num(r.rushes10Plus)),
    rushes20Plus: pcol(r => num(r.rushes20Plus)),
    rushes30Plus: pcol(r => num(r.rushes30Plus)),
    longestRush: pcol(r => num(r.longestRush)),
    longestRushTouchdown: pcol(r => num(r.longestRushTouchdown)),

    // Receiving
    targetSharePct: pcol(r => num(r.targetSharePct)),
    receptions: pcol(r => num(r.receptions)),
    receivingYards: pcol(r => num(r.receivingYards)),
    yardsPerReception: pcol(r => num(r.yardsPerReception)),
    receivingYardsAfterCatch: pcol(r => num(r.receivingYardsAfterCatch)),
    receivingTouchdowns: pcol(r => num(r.receivingTouchdowns)),

    // Elusiveness
    brokenTackles: pcol(r => num(r.brokenTackles)),
    brokenTackleRate: pcol(brokenTackleRate),
    yardsAfterContactPerAttempt: pcol(r => num(r.yardsAfterContactPerAttempt)),
    tackleEludedRate: pcol(r => num(r.tackleEludedRate)),
    fumbleRate: pcol(fumbleRate, 'lowerIsBetter'),
  };

  return rows.map((_, i) => {
    const volumeScore = clampScore(
      p.rushAttemptsPerGame[i] * 0.35 +
        p.targetsPerGame[i] * 0.30 +
        p.snapPct[i] * 0.15 +
        p.goalLineCarriesPerGame[i] * 0.15 +
        p.redZoneOpportunitiesPerGame[i] * 0.05,
    );

    // Asked for as 30/25/20/15, which is 90%; the same proportions over 100%.
    const productionScore = clampScore(
      (p.scrimmageYardsPerGame[i] * 0.30 +
        p.yardsPerCarry[i] * 0.25 +
        p.yardsPerReception[i] * 0.20 +
        p.fantasyPointsPerGame[i] * 0.15) /
        0.90,
    );

    const explosivenessScore = clampScore(
      p.explosiveRunPct[i] * 0.25 +
        p.breakawayRunPct[i] * 0.20 +
        p.rushes10Plus[i] * 0.20 +
        p.rushes20Plus[i] * 0.15 +
        p.rushes30Plus[i] * 0.10 +
        p.longestRush[i] * 0.05 +
        p.longestRushTouchdown[i] * 0.05,
    );

    const receivingScore = clampScore(
      mix(
        [
          [p.targets, 0.20],
          [p.targetSharePct, 0.20],
          [p.receptions, 0.15],
          [p.receivingYards, 0.15],
          [p.yardsPerReception, 0.10],
          [p.receivingYardsAfterCatch, 0.10],
          [p.yardsPerRouteRun, 0.05],
          [p.receivingTouchdowns, 0.05],
        ],
        i,
      ),
    );

    const elusivenessScore = clampScore(
      p.brokenTackles[i] * 0.25 +
        p.brokenTackleRate[i] * 0.25 +
        p.yardsAfterContactPerAttempt[i] * 0.25 +
        p.tackleEludedRate[i] * 0.15 +
        p.receivingYardsAfterCatch[i] * 0.05 +
        p.fumbleRate[i] * 0.05,
    );

    const overallRBGrade = clampScore(
      volumeScore * 0.35 +
        productionScore * 0.35 +
        explosivenessScore * 0.15 +
        receivingScore * 0.05 +
        elusivenessScore * 0.10,
    );

    return {
      volumeScore,
      productionScore,
      explosivenessScore,
      receivingScore,
      elusivenessScore,
      overallRBGrade,
    };
  });
}
