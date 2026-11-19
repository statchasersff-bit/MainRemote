/**
 * Fantasy scoring, computed from raw stats rather than stored.
 *
 * Ported from the player-pages app's `shared/scoring.ts`. Raw stat lines are
 * stored once and every format is derived from them, which is what lets one
 * page answer for Standard, Half-PPR and PPR without three copies of the data -
 * and, more to the point, what keeps the weekly ranks, the tier-finish rates
 * and the volatility numbers consistent with whichever format is on screen.
 *
 * Pure: no clock, no locale, no I/O. Everything downstream of it is cacheable
 * on a key that includes the format.
 */

import type { GameLogStats } from "./types";
import { loadGameLogs } from "./data";
import {
  HOUSE_RULES,
  RECEPTION_POINTS,
  SCORING_FORMATS as HOUSE_FORMATS,
  SCORING_LABELS as HOUSE_LABELS,
  scoreLine,
  scoringTotalsSource,
  type ScoringFormat as HouseFormat,
  type ScoringLine,
} from "../scoring/house-rules";

export type ScoringFormat = HouseFormat;

export const SCORING_FORMATS: readonly ScoringFormat[] = HOUSE_FORMATS;

export const SCORING_LABELS: Record<ScoringFormat, string> = HOUSE_LABELS;

/** The short form, for a label with no room to say "Half-PPR" in full. */
export const SCORING_SHORT: Record<ScoringFormat, string> = {
  standard: "STD",
  half: "HALF",
  ppr: "PPR",
};

export function parseScoringFormat(value: unknown): ScoringFormat {
  return value === "standard" || value === "half" || value === "ppr"
    ? value
    : "ppr";
}

/** A game-log stat line in the shared scoring module's terms. */
export function toScoringLine(stats: GameLogStats): ScoringLine {
  return {
    passYd: stats.pass_yd,
    passTd: stats.pass_td,
    passInt: stats.pass_int,
    rushYd: stats.rush_yd,
    rushTd: stats.rush_td,
    rec: stats.rec,
    recYd: stats.rec_yd,
    recTd: stats.rec_td,
    fumLost: stats.fum_lost,
    twoPt: (stats.pass_2pt ?? 0) + (stats.rush_2pt ?? 0) + (stats.rec_2pt ?? 0),
    otherTd: (stats.st_td ?? 0) + (stats.fum_rec_td ?? 0),
    ...kickerLine(stats),
  };
}

/**
 * A kicker's game in the house rule's distance bands, or null when the log
 * holds made field goals but no distances (scripts/player/
 * backfillScoringEvents.mjs adds them). Mirrors kickerBands() in
 * scripts/scoring/house-rules.mjs.
 */
export function kickerBands(stats: GameLogStats): Pick<ScoringLine, "fg0_39" | "fg40_49" | "fg50p" | "xpm" | "kMiss"> | null {
  const v = (k: keyof GameLogStats): number => {
    const x = stats[k];
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };
  const banded = v("fgm_0_19") + v("fgm_20_29") + v("fgm_30_39") + v("fgm_40_49") + v("fgm_50p");
  if (v("fgm") > 0 && banded === 0) return null;
  return {
    fg0_39: v("fgm_0_19") + v("fgm_20_29") + v("fgm_30_39"),
    fg40_49: v("fgm_40_49"),
    fg50p: v("fgm_50p"),
    xpm: v("xpm"),
    kMiss: Math.max(0, v("fga") - v("fgm")) + Math.max(0, v("xpa") - v("xpm")),
  };
}

function kickerLine(stats: GameLogStats): Partial<ScoringLine> {
  if (stats.fga == null && stats.xpa == null && stats.fgm == null && stats.xpm == null) return {};
  return kickerBands(stats) ?? {};
}

/**
 * Points for one game computed from its stat line under the house rules
 * (lib/scoring/house-rules.ts). Since 2026-11-19 this includes fumbles lost,
 * two-point conversions and return/fumble-recovery touchdowns, which it used
 * to leave out - so a computed Standard total no longer overstates a player
 * who lost a fumble.
 */
export function getFantasyPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  // A kicker line with no distance bands cannot be scored by the house rule:
  // the provider's total stands (a kicker scores the same in every format).
  if ((stats.fgm ?? 0) > 0 && !kickerBands(stats)) return stats.pts_std ?? stats.pts_ppr;
  return Math.round(scoreLine(toScoringLine(stats), format) * 100) / 100;
}

/**
 * Points for one entry, preferring the stored per-game total where upstream
 * has one.
 *
 * `pts_ppr`, `pts_half_ppr` and `pts_std` are Sleeper's per-game totals, which
 * use the same settings as the house rules (checked 2026-11-19: every 2026
 * week reproduces exactly from the stat line). Preferring them keeps the page
 * agreeing with the scoreboard the reader saw, and keeps all three formats
 * from the same source so PPR minus Standard is always the receptions. The
 * stats tables sum this same function, so the hub and the tables cannot
 * disagree for the same snapshot.
 */
export function getEntryPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  if (scoringTotalsSource() === "house") return getFantasyPoints(stats, format);
  if (format === "ppr") return stats.pts_ppr;
  if (format === "half" && stats.pts_half_ppr != null) return stats.pts_half_ppr;
  if (format === "standard" && stats.pts_std != null) return stats.pts_std;
  return getFantasyPoints(stats, format);
}

/** One line of a weekly scoring breakdown: what produced the points. */
export interface PointsComponent {
  label: string;
  /** The countable behind it - "277 yds", "2 TD". Empty when there is none. */
  detail: string;
  points: number;
}

/**
 * Where one week's fantasy points came from.
 *
 * The inverse of getFantasyPoints(): the same coefficients, kept as a list
 * instead of a sum. Its whole reason for existing is that "16.5" is a number a
 * reader has to trust, and a breakdown is the difference between trusting it
 * and checking it.
 *
 * Components worth nothing are dropped, so a passing line does not print four
 * empty rushing rows. It deliberately does NOT reconcile itself against
 * `getEntryPoints` - that value can come from Sleeper and include scoring this
 * function does not model. The renderer prints the difference as its own line
 * rather than quietly padding one of these, because an unexplained remainder is
 * exactly the thing a breakdown is supposed to reveal.
 */
export function pointsBreakdown(
  stats: GameLogStats,
  format: ScoringFormat,
): PointsComponent[] {
  const rows: PointsComponent[] = [];
  const add = (label: string, count: number, rate: number, unit: string): void => {
    if (!count) return;
    const points = Math.round(count * rate * 100) / 100;
    if (points === 0) return;
    rows.push({ label, detail: `${count} ${unit}`, points });
  };

  add("Passing yards", stats.pass_yd ?? 0, HOUSE_RULES.passYd, "yds");
  add("Passing TD", stats.pass_td ?? 0, HOUSE_RULES.passTd, "TD");
  add("Interceptions", stats.pass_int ?? 0, HOUSE_RULES.passInt, "INT");
  add("Rushing yards", stats.rush_yd ?? 0, HOUSE_RULES.rushYd, "yds");
  add("Rushing TD", stats.rush_td ?? 0, HOUSE_RULES.rushTd, "TD");
  if (format !== "standard") {
    add("Receptions", stats.rec ?? 0, RECEPTION_POINTS[format], "rec");
  }
  add("Receiving yards", stats.rec_yd ?? 0, HOUSE_RULES.recYd, "yds");
  add("Receiving TD", stats.rec_td ?? 0, HOUSE_RULES.recTd, "TD");
  const k = kickerBands(stats);
  if (k) {
    add("Field goals, 0-39 yds", k.fg0_39 ?? 0, HOUSE_RULES.fg0_39, "FG");
    add("Field goals, 40-49 yds", k.fg40_49 ?? 0, HOUSE_RULES.fg40_49, "FG");
    add("Field goals, 50+ yds", k.fg50p ?? 0, HOUSE_RULES.fg50p, "FG");
    add("Extra points", k.xpm ?? 0, HOUSE_RULES.xpm, "XP");
    add("Missed kicks", k.kMiss ?? 0, HOUSE_RULES.kMiss, "missed");
  }
  // From the log's own fumble column (kept since 2026-11-04): -2 a lost ball
  // in every format, the way Sleeper's stored points count it.
  add("Fumbles lost", stats.fum_lost ?? 0, HOUSE_RULES.fumLost, "lost");
  add(
    "Two-point conversions",
    (stats.pass_2pt ?? 0) + (stats.rush_2pt ?? 0) + (stats.rec_2pt ?? 0),
    HOUSE_RULES.twoPt,
    "2PT",
  );
  add("Return / fumble-recovery TD", (stats.st_td ?? 0) + (stats.fum_rec_td ?? 0), HOUSE_RULES.otherTd, "TD");

  return rows;
}

/** Plays Sleeper scores that the house rule does not, in words. */
const PROVIDER_PLAY_WORDS: Array<[RegExp, string]> = [
  [/blk_kick|blk_/, "blocked kick"],
  [/_ff$/, "forced fumble"],
  [/fum_rec/, "fumble recovery"],
  [/_int$/, "interception"],
  [/safe/, "safety"],
  [/tkl/, "special-teams tackle"],
  [/kick_pts/, "a kick by a non-kicker"],
];

/**
 * Why a stored (provider) total differs from the house-rule total for one
 * game, in words; null when they agree. The same classification as
 * scripts/player/scoringReconciliationReport.mjs. Never a guess: an
 * unattributed difference says so.
 */
export function explainResidual(stats: GameLogStats, residual: number): { label: string; detail: string } | null {
  if (Math.abs(residual) < 0.05) return null;
  const words = new Set<string>();
  const keys = [...Object.keys(stats.px ?? {}), ...(stats.st_fum_rec ? ["st_fum_rec"] : []), ...(stats.idp_ff ? ["idp_ff"] : [])];
  for (const k of keys) for (const [re, w] of PROVIDER_PLAY_WORDS) if (re.test(k)) { words.add(w); break; }
  const fum = stats.fum ?? 0;
  if (fum > 0 && Math.abs(residual + fum) < 0.05) {
    return { label: "Provider fumble penalty", detail: `-1 per fumble in the source's pre-2022 scoring; not a StatChasers rule` };
  }
  if (words.size) {
    return { label: "Provider-only scoring", detail: `${[...words].join(", ")}: scored by the source, not by StatChasers rules` };
  }
  if ((stats.fum_rec_td ?? 0) > 0 && residual < 0) {
    return { label: "Fumble-recovery TD", detail: "scored by StatChasers rules, not by the source" };
  }
  return { label: "Unattributed difference", detail: "between the source total and the stat line" };
}

/**
 * Current-season games whose stored total differs from the house rule with
 * no known cause (explainResidual says "Unattributed"), for /api/data/health.
 * Kickers with no distance bands are counted as missing input, not here.
 */
export function unattributedScoring(season: number): number {
  let n = 0;
  for (const games of Object.values(loadGameLogs(season))) {
    for (const g of games) {
      const s = g.stats;
      if (s.pts_ppr == null) continue;
      if ((s.fgm ?? 0) > 0 && !kickerBands(s)) continue;
      const why = explainResidual(s, Math.round((s.pts_ppr - getFantasyPoints(s, "ppr")) * 100) / 100);
      if (why?.label === "Unattributed difference") n++;
    }
  }
  return n;
}
