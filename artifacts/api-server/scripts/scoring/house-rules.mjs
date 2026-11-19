/**
 * The house scoring rules for the build scripts, which run as plain Node and
 * cannot import the TypeScript module. This is a MIRROR of
 * src/lib/scoring/house-rules.ts, not a second definition:
 * tests/scoring.test.mjs fails if the two ever disagree on a coefficient.
 */

export const HOUSE_RULES = Object.freeze({
  passYd: 0.04,
  passTd: 4,
  passInt: -1,
  rushYd: 0.1,
  rushTd: 6,
  recYd: 0.1,
  recTd: 6,
  fumLost: -2,
  twoPt: 2,
  otherTd: 6,
  fg0_39: 3,
  fg40_49: 4,
  fg50p: 5,
  xpm: 1,
  kMiss: -1,
});

/** A game-log kicker line in distance bands (see kickerBands in scoring.ts). */
export function kickerBands(s) {
  const v = (k) => (typeof s?.[k] === "number" && Number.isFinite(s[k]) ? s[k] : 0);
  const banded = v("fgm_0_19") + v("fgm_20_29") + v("fgm_30_39") + v("fgm_40_49") + v("fgm_50p");
  // A line with no distance bands (none stored) cannot be scored by distance.
  if (v("fgm") > 0 && banded === 0) return null;
  return {
    fg0_39: v("fgm_0_19") + v("fgm_20_29") + v("fgm_30_39"),
    fg40_49: v("fgm_40_49"),
    fg50p: v("fgm_50p"),
    xpm: v("xpm"),
    kMiss: Math.max(0, v("fga") - v("fgm")) + Math.max(0, v("xpa") - v("xpm")),
  };
}

export const RECEPTION_POINTS = Object.freeze({ standard: 0, half: 0.5, ppr: 1 });

/** Kicker points under the house rule, or the provider's total when no distance bands are stored. */
function kickerScore(s) {
  const k = kickerBands(s);
  if (!k) return s?.pts_std ?? s?.pts_ppr ?? 0;
  const r = HOUSE_RULES;
  return k.fg0_39 * r.fg0_39 + k.fg40_49 * r.fg40_49 + k.fg50p * r.fg50p + k.xpm * r.xpm + k.kMiss * r.kMiss;
}

/** A Sleeper-style game-log stat line, scored. Rounded to 2 places. */
export function scoreGameLogStats(s, format) {
  const r = HOUSE_RULES;
  const v = (k) => (typeof s?.[k] === "number" && Number.isFinite(s[k]) ? s[k] : 0);
  const pts =
    v("pass_yd") * r.passYd +
    v("pass_td") * r.passTd +
    v("pass_int") * r.passInt +
    v("rush_yd") * r.rushYd +
    v("rush_td") * r.rushTd +
    v("rec_yd") * r.recYd +
    v("rec_td") * r.recTd +
    v("rec") * RECEPTION_POINTS[format] +
    v("fum_lost") * r.fumLost +
    (v("pass_2pt") + v("rush_2pt") + v("rec_2pt")) * r.twoPt +
    (v("st_td") + v("fum_rec_td")) * r.otherTd +
    kickerScore(s);
  return Math.round(pts * 100) / 100;
}

/** Stored per-game total first, as src/lib/player/scoring.ts getEntryPoints does. */
export function entryPoints(s, format) {
  // The same policy switch as src/lib/scoring/house-rules.ts scoringTotalsSource().
  if (process.env.SC_SCORING_TOTALS?.trim().toLowerCase() === "house") return scoreGameLogStats(s, format);
  if (format === "ppr" && s?.pts_ppr != null) return s.pts_ppr;
  if (format === "half" && s?.pts_half_ppr != null) return s.pts_half_ppr;
  if (format === "standard" && s?.pts_std != null) return s.pts_std;
  return scoreGameLogStats(s, format);
}
