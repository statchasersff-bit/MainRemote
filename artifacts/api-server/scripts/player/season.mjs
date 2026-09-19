/**
 * Which seasons the per-season builders build.
 *
 * `buildGameLogs.js` and `buildGameScores.js` each carried
 * `const SEASONS = [2023, 2024, 2025]`, which is a list that is wrong every
 * September and silently so: the builders keep succeeding, the server keeps
 * serving, and every player page shows last season's game log as though it were
 * this one. That is the failure this module exists to remove — the year is
 * derived from the calendar, not typed into two files.
 *
 * Overridable with SC_SEASON for a backfill or a test, and every script takes
 * seasons as arguments too, so rebuilding one year never means rewriting three.
 */

/**
 * The NFL season a date falls in.
 *
 * March is the boundary, matching seasonYear() in src/lib/seo.ts: the league
 * year turns over in March, so January and February still belong to the season
 * that started the previous September and a page rendered in those months must
 * not jump forward to a season with nothing in it.
 */
export function currentSeason(now = new Date()) {
  const override = Number(process.env.SC_SEASON);
  if (Number.isFinite(override) && override > 2000) return override;
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 2 ? year : year - 1;
}

/**
 * The first season this app carries data for.
 *
 * 2009, which is where `player_production.json` starts. It was 2023 — where
 * the game logs happened to start — and that gap was visible on the page: the
 * Stats tab's career table counted eleven seasons off production while the
 * weekly rates beneath it counted four off the logs, and called both "career".
 * The logs were backfilled to meet production, and this is the line that says
 * the two now agree.
 */
export const FIRST_SEASON = 2009;

/** Every season from the first to the current one, oldest first. */
export function allSeasons(now = new Date()) {
  const last = currentSeason(now);
  const out = [];
  for (let season = FIRST_SEASON; season <= last; season += 1) out.push(season);
  return out;
}

/**
 * The seasons named on the command line, or all of them.
 *
 * `node scripts/player/buildGameLogs.js 2026` rebuilds one year and leaves the
 * rest untouched, which matters more now than it did: the files are committed
 * and there are eighteen of them, so a no-argument run refetches three hundred
 * weeks and rewrites nineteen megabytes of JSON to re-derive numbers that have
 * not changed since 2009.
 */
export function seasonsFromArgs(argv = process.argv.slice(2), now = new Date()) {
  const named = argv
    .map((arg) => Number(arg))
    .filter((n) => Number.isInteger(n) && n >= 2000 && n <= 2100);
  return named.length ? named : allSeasons(now);
}
