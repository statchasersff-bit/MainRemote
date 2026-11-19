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
  fgm: 3,
  xpm: 1,
});

export const RECEPTION_POINTS = Object.freeze({ standard: 0, half: 0.5, ppr: 1 });

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
    v("fgm") * r.fgm +
    v("xpm") * r.xpm;
  return Math.round(pts * 100) / 100;
}

/** Stored per-game total first, as src/lib/player/scoring.ts getEntryPoints does. */
export function entryPoints(s, format) {
  if (format === "ppr" && s?.pts_ppr != null) return s.pts_ppr;
  if (format === "half" && s?.pts_half_ppr != null) return s.pts_half_ppr;
  if (format === "standard" && s?.pts_std != null) return s.pts_std;
  return scoreGameLogStats(s, format);
}
