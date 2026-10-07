# Team logo SVGs

`public/team-logos/<abbr>-<hash>.svg` are the 32 NFL club marks the app draws
(news card watermarks and filter crests, team hub, player pages, matchup and
handcuff pages). They replaced the 150px PNGs that used to be loaded from
Sleeper's CDN: a vector is crisp at every size and the file is cached for a
year under its content-hashed name.

They are built by `scripts/images/team-logos.mjs` (`pnpm run team-logos` in
the api-server package) from the SVG each club's English Wikipedia article
carries, optimised with svgo and given a square viewBox so every `<img>` box
sized for the old square PNGs still fits. `sources.json` records, per club,
the Wikipedia file, the download URL, the licence Wikipedia lists (most are
"Fair use" non-free content, some public domain as simple geometry) and the
byte sizes. The marks are the clubs' trademarks whatever the file's licence;
they are used here the same way the Sleeper copies were, to identify the
club beside its own news.

Re-run the script when a club changes its mark; a changed file gets a new
hash, and `src/lib/team-logo-files.ts` is regenerated to point at it.
