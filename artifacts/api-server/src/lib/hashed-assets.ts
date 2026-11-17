/**
 * The stylesheets and bundles whose URL carries the build's content hash
 * (`?ver=<version>`, public/dist/version.json). One list, read by two things
 * that must agree: the static handler in app.ts, which marks exactly these
 * immutable when the ver matches the build, and the edge pre-fetch
 * (lib/edge-prefetch.ts), which asks Cloudflare for exactly these right after
 * a boot so no visitor's browser is the first to.
 */
export const HASHED_ASSET_NAMES: readonly string[] = [
  "news",
  "team",
  "player",
  "fpa",
  "rankings",
  "schedule",
  "player-stats",
  "rb-handcuffs",
  "sos",
  "rookie-hit-rates",
  "redraft-strategy",
  "injury-impact",
  "news-rail",
];

/**
 * Stylesheets with no bundle of their own. matchup.css is the matchup and game
 * pages' half of the old team.css: those pages load team.css and then it, and
 * they run the team bundle.
 */
export const HASHED_EXTRA_STYLESHEETS: readonly string[] = ["/matchup.css"];

/** `/dist/statchasers-<name>.js` and `/<name>.css` (the news tool's sheet is `/styles.css`), then the extras. */
export const HASHED_ASSET_PATHS: readonly string[] = [
  ...HASHED_ASSET_NAMES.flatMap((name) => [
    `/dist/statchasers-${name}.js`,
    `/${name === "news" ? "styles" : name}.css`,
  ]),
  ...HASHED_EXTRA_STYLESHEETS,
];

/**
 * Every hashed stylesheet's path (`/team.css`, ...). build.mjs writes a
 * minified copy of each to public/dist/css/, which app.ts serves in place of
 * the readable source outside development.
 */
export const HASHED_STYLESHEET_PATHS: readonly string[] = HASHED_ASSET_PATHS.filter((p) => p.endsWith(".css"));

export const HASHED_ASSETS: ReadonlySet<string> = new Set(HASHED_ASSET_PATHS);
