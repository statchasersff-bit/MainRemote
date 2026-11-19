/**
 * Shared team play-calling rates (Team Pages Phase 2B, 2026-11-19).
 *
 * buildUsage.mjs (the Usage file's `env` block, the matchup previews) and
 * buildCoaching.mjs (the Coaching tab's tendencies table) both report a pass
 * rate, a red-zone pass rate, a pass rate over expected and a neutral pace.
 * Until this module they computed them separately, with two differences that
 * reached the page: Coaching counted every `play_type` pass/run snap (so an
 * aborted snap or a run that ended in an illegal forward pass, flagged
 * neither pass nor rush by nflverse, sat in its denominator) where Usage
 * counted only flagged snaps; and Coaching ranked the red-zone rate after
 * rounding it to a whole number (NE 2026: "T-1st") while Usage ranked the raw
 * value (3rd). Both builders now feed every play-by-play row through
 * `addSnap()` and publish with `publishRates()` / `rankPublished()`, so a
 * metric with one name has one value and one rank everywhere.
 *
 * THE DEFINITIONS (one counted snap = all of):
 *   - regular season (`season_type` REG); the postseason is never mixed in;
 *   - weeks 1..throughWeek, the last week whose every scheduled game is in
 *     the play-by-play (completedThroughWeek); a Thursday game of an
 *     unfinished week is left out rather than counted under "through Week N";
 *   - `play_type` pass or run (no_play = wiped out by penalty, never counted;
 *     a penalty on a play that still counts keeps the snap);
 *   - not a two-point try, kneel (`qb_kneel`) or spike (`qb_spike`);
 *   - flagged `pass` == 1 (a dropback: completions, incompletions,
 *     interceptions, sacks and scrambles) or `rush` == 1 (a designed run).
 *     A snap flagged neither is not classifiable as a call and is left out.
 *
 *   passRate     = pass snaps / counted snaps                     (higher = 1st)
 *   rzPassRate   = the same over counted snaps with yardline_100 <= 20 at
 *                  the snap (the opponent's 20 or closer)          (higher = 1st)
 *   in10PassRate = the same with yardline_100 <= 10               (higher = 1st)
 *   proe         = mean nflverse `pass_oe` over the counted snaps (higher = 1st,
 *                  the more pass-leaning offense)
 *   pace         = mean seconds between consecutive snaps of one drive, both
 *                  snaps neutral (win probability 0.2-0.8, more than 2:00 left
 *                  in the half), gaps over 60s dropped. Measured over pass/run
 *                  snaps BEFORE the kneel/spike/flag filter: a spike is a snap
 *                  for tempo. (lower = 1st, "fastest")
 *
 * PUBLISHING: every rate is published at one decimal; ranks are taken over
 * the published values of all clubs, so two clubs that print the same figure
 * share a rank ("T-3rd") and two that print different figures never do.
 * Ties share the better rank (competition ranking: 1, 2, 2, 4).
 *
 * The Stats tab's Play Mix is a different statistic on purpose: the box-score
 * split, pass attempts + sacks against rushing attempts, where a scramble and
 * a kneel are rushing attempts. It is labeled as such on that tab.
 */

export const RATE_PLACES = 1;

/** Metrics this module defines; `invert` = lower is better-ranked (pace). */
export const TEAM_RATE_METRICS = {
  passRate: { invert: false },
  rzPassRate: { invert: false },
  in10PassRate: { invert: false },
  proe: { invert: false },
  pace: { invert: true },
};

const num = (v) => {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function newRateAcc() {
  return {
    snaps: 0, pass: 0,
    rzSnaps: 0, rzPass: 0,
    in10Snaps: 0, in10Pass: 0,
    proeSum: 0, proeN: 0,
    paceSum: 0, paceN: 0,
    last: null,
  };
}

/** True when the row belongs to the regular season. */
export const isRegular = (r) => (r.season_type ?? r.game_type) === "REG";

/**
 * Feed one play-by-play row (already filtered to this club's offense and to
 * the counted weeks). Returns the classification so a builder can reuse it
 * for its own per-player work: { pace: bool, counted: bool, pass: bool }.
 */
export function addSnap(acc, r) {
  const playType = r.play_type;
  if (r.two_point_attempt === "1") return { counted: false, pass: false };
  if (playType !== "pass" && playType !== "run") {
    acc.last = null;
    return { counted: false, pass: false };
  }

  // Pace, before the kneel/spike/flag filter.
  const wp = num(r.wp);
  const halfSecs = num(r.half_seconds_remaining);
  const gameSecs = num(r.game_seconds_remaining);
  const neutral = wp != null && wp >= 0.2 && wp <= 0.8 && halfSecs != null && halfSecs > 120;
  const last = acc.last;
  if (last && neutral && last.neutral && last.game === r.game_id && last.drive === r.fixed_drive && gameSecs != null) {
    const gap = last.secs - gameSecs;
    if (gap > 0 && gap <= 60) {
      acc.paceSum += gap;
      acc.paceN += 1;
    }
  }
  acc.last = { game: r.game_id, drive: r.fixed_drive, secs: gameSecs, neutral };

  if (r.qb_kneel === "1" || r.qb_spike === "1") return { counted: false, pass: false };
  const pass = r.pass === "1";
  const rush = r.rush === "1";
  if (!pass && !rush) return { counted: false, pass: false };

  acc.snaps += 1;
  if (pass) acc.pass += 1;
  const yl = num(r.yardline_100);
  if (yl != null && yl <= 20) {
    acc.rzSnaps += 1;
    if (pass) acc.rzPass += 1;
  }
  if (yl != null && yl <= 10) {
    acc.in10Snaps += 1;
    if (pass) acc.in10Pass += 1;
  }
  const oe = num(r.pass_oe);
  if (oe != null) {
    acc.proeSum += oe;
    acc.proeN += 1;
  }
  return { counted: true, pass };
}

const pct = (a, b) => (b ? (100 * a) / b : null);

/** Raw (unrounded) rates for one club. */
export function rawRates(acc) {
  return {
    passRate: pct(acc.pass, acc.snaps),
    rzPassRate: pct(acc.rzPass, acc.rzSnaps),
    in10PassRate: pct(acc.in10Pass, acc.in10Snaps),
    proe: acc.proeN ? acc.proeSum / acc.proeN : null,
    pace: acc.paceN ? acc.paceSum / acc.paceN : null,
  };
}

export const publish = (v) => (v == null ? null : Math.round(v * 10 ** RATE_PLACES) / 10 ** RATE_PLACES);

/** Published (one-decimal) rates for one club, plus the samples behind them. */
export function publishRates(acc) {
  const raw = rawRates(acc);
  return {
    passRate: publish(raw.passRate),
    rzPassRate: publish(raw.rzPassRate),
    in10PassRate: publish(raw.in10PassRate),
    proe: publish(raw.proe),
    pace: publish(raw.pace),
    samples: { snaps: acc.snaps, rzSnaps: acc.rzSnaps, in10Snaps: acc.in10Snaps, paceGaps: acc.paceN },
  };
}

/**
 * Rank of one club's published value among every club's published value for
 * a metric: 1-based, ties share the better rank, null values unranked.
 * Returns { rank, tied, of }.
 */
export function rankPublished(values, value, key) {
  if (value == null) return { rank: null, tied: false, of: 0 };
  const invert = TEAM_RATE_METRICS[key]?.invert ?? false;
  const pool = values.filter((v) => v != null);
  const rank = 1 + pool.filter((v) => (invert ? v < value : v > value)).length;
  return { rank, tied: pool.filter((v) => v === value).length > 1, of: pool.length };
}

/** League rates: snap-weighted sums over every club (not a mean of club rates). */
export function leagueRates(accs) {
  const tot = newRateAcc();
  for (const a of accs) {
    for (const k of ["snaps", "pass", "rzSnaps", "rzPass", "in10Snaps", "in10Pass", "proeSum", "proeN", "paceSum", "paceN"]) tot[k] += a[k];
  }
  return publishRates(tot);
}

/**
 * The last week whose every scheduled regular-season game appears in the
 * play-by-play. `scheduled`: Map week -> Set(game_id) from games.csv;
 * `seen`: Set(game_id) present in the pbp. Weeks with no scheduled games
 * (none in the regular season) are skipped. 0 = no complete week yet.
 */
export function completedThroughWeek(scheduled, seen) {
  let through = 0;
  const weeks = [...scheduled.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    const games = scheduled.get(w);
    if (!games.size) continue;
    if ([...games].every((g) => seen.has(g))) through = w;
    else break;
  }
  return through;
}

/** Map week -> Set(game_id) of a season's regular-season games from a games.csv row stream. */
export async function scheduledWeeks(rowsIter, season) {
  const out = new Map();
  for await (const g of rowsIter) {
    if (Number(g.season) !== season || g.game_type !== "REG") continue;
    const w = Number(g.week);
    if (!out.has(w)) out.set(w, new Set());
    out.get(w).add(g.game_id);
  }
  return out;
}

export const NFLVERSE_PBP = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
export const NFLDATA_GAMES = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/**
 * The completed-week cutoff for a season, from the schedule and the
 * play-by-play itself. `rows` is the builder's CSV streamer (so `--cache`
 * applies and both builders read the same files).
 */
export async function computeThroughWeek(rows, season) {
  const scheduled = await scheduledWeeks(rows(NFLDATA_GAMES), season);
  const seen = new Set();
  for await (const r of rows(NFLVERSE_PBP(season))) if (isRegular(r)) seen.add(r.game_id);
  return completedThroughWeek(scheduled, seen);
}
