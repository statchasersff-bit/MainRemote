# NFL Depth Charts audit, 2026-11-25: integration

Branch `fix/depth-charts-audit-2026-11-25`, rebased onto main 2f9d4f8 (= efbe131, plugin
1.10.70, not yet installed). Versions: **statchasers-news 1.10.71**,
**SCDC_VERSION 1.7.6**. Four audit branches plus two additions asked for during
integration (startup restore, first-poll load). Nothing here was pushed,
deployed, installed or purged.

| Item | Branch / commit (rebased) | What |
|---|---|---|
| WEB-003 cache | `fix/dc-web003-cache-2026-11-25` (2c1d84e, 6d31a05) | publication purges for the league page and the 32 team tabs, 6 h edge lifetime |
| Timestamp | `fix/dc-timestamp-2026-11-25` (d2c7142) | "Depth charts updated" line from the stored file |
| WEB-023 assets | `fix/dc-web023-assets-2026-11-25` (e16597f) | team Depth Chart tab loads the bundled team.css / team bundle |
| WEB-021 identity | `fix/dc-web021-identity-2026-11-25` (de3ae64) | 'depth' family: graph + own share image on the league page |
| A. Startup restore | b0f069d | stored push no longer rolls a newer committed snapshot back |
| B. First poll | a3b1662 | team warm-up staggered, quiet second poll asserted |

## Per item

### WEB-003: publication purges and edge lifetime

- Files: API `src/lib/team/depth-charts.ts` (fingerprint, club hashes),
  `src/lib/team/team-data.ts`, `src/lib/team-ssr.ts`, `src/routes/team.ts`
  (`GET /embed/depth-charts/version`, `X-SC-Depth-Version`); plugin
  `statchasers-depth-charts-cache.php` (new), `statchasers-edge-cache.php`
  (new, helpers moved out of `statchasers-player-stats-cache.php`),
  `statchasers-team.php` (fragment key/url/store helpers),
  `depth-charts/includes/class-scdc-refresh.php` (`scdc_published` after
  `set_meta`); `docs/WEB-003-DEPTH-CHARTS-CACHE.md`.
- Tests: `tests/depth-charts-version.test.mjs`; smoke group `dccache`
  (63 checks with B); `tests/depth-charts/checks.php` section 3e.
- Effective cache policy (configured in `statchasers-depth-charts-cache.php`,
  `statchasers_depth_charts_cache_headers()` at `template_redirect` 20 through
  `statchasers_edge_ttl_headers()`): `/nfl/nfl-depth-charts/` and
  `/nfl/teams/{slug}/depth-chart/` send `Cache-Control: public, max-age=0,
  s-maxage=21600`, `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control:
  public, max-age=21600`, `X-SC-Depth-Cache: edge-ttl=21600;
  surface=hub|team; published=<id>`. Freshness comes from the purges: league
  page on `scdc_published` (WP Rocket desktop+mobile, Rocket.net path purge,
  warm a minute later); team tabs from the 5-minute WP-cron poll of the API
  version (only changed clubs). The platform's 30-day edge TTL applies and
  the 6 h is only a request: mak cannot change Rocket.net's edge rules, so
  the targeted purges are the only freshness mechanism (a failed purge is
  retried from the follow-up release on; see "Edge rules" below).
- `data-endpoint` stays `.../depth-charts.json?v=<last_refreshed_ts>`
  (`SCDC_Store::file_url()`, untouched by the stamp change).

### Timestamp

- Files: `depth-charts/includes/class-scdc-stamp.php` (new),
  `class-scdc-refresh.php` (per-team `updatedAt`, top-level `updatedAt` and
  `teamsKept` ahead of `teams`), `class-scdc-shortcode.php`,
  `assets/js/frontend.js`, `assets/css/frontend.css`,
  `tests/depth-charts/stamp-checks.php` (run by `run-tests.sh`).
- Source: the stored league file (`SCDC_Stamp::for_file(SCDC_Store::file_path())`),
  top-level `updatedAt` = the newest team fetch time; label "Latest team
  update" when teams were carried over. Printed as the first child of
  `.scdc-page`: `<p class="scdc-updated"><span class="scdc-updated-label">…</span>
  <time datetime="…Z">Nov 25, 2026 at 10:36 AM ET</time></p>`. No valid time,
  no line.
- Cross-check: the line is baked into the hub HTML. `scdc_published` fires in
  `SCDC_Refresh::store()` after the file is renamed into place and `set_meta`
  has run, with the payload (which carries `updatedAt`) as its second
  argument; the hook purges and warms the page, so line, `?v=` and data move
  together. Bench evidence below.

### WEB-023: local assets on the team Depth Chart tab

- Files: `statchasers-local-assets.php` (new), `statchasers_team_enqueue_assets()`
  in `statchasers-team.php`, `scripts/build-zip.sh` step 3b, `.gitignore`
  (`assets/api/`), `tests/smoke-local-assets.php` (35 checks with the staged
  manifest).
- Rule: bundled `assets/api/team.css` and `assets/api/dist/statchasers-team.js`
  are used on `depth-chart` only when the manifest version equals
  `statchasers_news_asset_version()`, or the live file's sha256 matches (one
  server-side GET per version and path, verdict cached: match 1 week,
  mismatch/failure 10 minutes, written before the fetch). Otherwise
  news.statchasers.com. No per-request remote fetch.
- Composition: the decision is made at enqueue (render) time and lands in the
  HTML the 6 h edge / WP Rocket keep; the fragment cache is unaffected (it
  caches the API fragment only). A cached page keeps the URLs it was rendered
  with until purged, same as the remote URLs before.
- Build: `node build.mjs` asset version **d09d66ec6807**, the same hash
  production reports; the bundled team.css (sha256 3d2348b3...) and
  statchasers-team.js (c91ea917...) are byte-identical to what
  news.statchasers.com serves now. So the bundled copies apply immediately
  after install, and stay in use after the API publish unless that publish
  changes the asset hash (then the sha256 compare decides).
- Asset URLs (bench, WP origin):
  `/wp-content/plugins/statchasers-news/assets/api/team.css?ver=d09d66ec6807`,
  `/wp-content/plugins/statchasers-news/assets/api/dist/statchasers-team.js?ver=d09d66ec6807`.

### WEB-021: identity on the league page

- Files: `statchasers-page-identity.php` (family 'depth', gated on
  `SCDC_Route::is_main()`, sixth family after 1.10.70's 'ros'),
  `depth-charts/assets/img/nfl-depth-charts-og.png` (1200x630),
  `wordpress-plugin/assets/social/nfl-depth-charts-og.html` (source),
  `tests/smoke-page-identity.php` depth cases.
- Share image:
  `https://statchasers.com/wp-content/plugins/statchasers-news/depth-charts/assets/img/nfl-depth-charts-og.png`
  (og:image, twitter:image, primaryImageOfPage).
- Graph (harness, Rank Math stubbed): Organization, WebSite, WebPage at the
  canonical `#webpage`, BreadcrumbList (Rank Math's own trail, Home > NFL >
  page), every `@id` reference resolves, no duplicate `@id`. The team
  depth-chart routes stay family 'team' (unchanged; team share cards from
  1.10.69 keep working), the legacy 301 / junk 404 / `/nfl/` hub get nothing.
  Production today: no og:image, one JSON-LD block (checked read-only).
- The bench WordPress has no Rank Math, so og:image / JSON-LD are harness
  evidence only: confirm on production after install.

### A. Startup restore (asked during integration)

- Problem: `restoreDepthCharts()` (first team render per process) restored the
  Postgres `depth_charts` row whenever its `fetchedAt` was later than the
  file's. `fetchedAt` is a fetch time, so an older stored push with a later
  `fetchedAt` replaced a newer committed snapshot at every boot.
- Reproduced: `tests/depth-charts-restore.test.mjs` on the pre-fix code served
  "Stale Pushed QB" over the newer committed "Committed New QB" (3/3 fail);
  with the fix 3/3 pass.
- Fix (`src/lib/team/depth-charts.ts`): the committed snapshot is the
  publication of record. A push records `basedOn` = the fingerprint of the
  committed snapshot it was pushed on top of (carried down a chain of
  pushes); `storedPushWins()` restores a row only when `basedOn` equals the
  on-disk file's root and the row is a strictly later fetch. Rows without
  `basedOn` (all existing ones) are never restored. `basedOn` is not part of
  the fingerprint, so WEB-003 versions are unaffected.
- Production (read-only): the live Bills tab omits Shaq Thompson and
  Tre'Davious White, who are in the 11-23 snapshot and not in the committed
  11-24 one, so production serves the committed snapshot today: no stored row
  with a later `fetchedAt` was restored. Before the fix: committed snapshot
  (no qualifying row). After: committed snapshot (any row lacks `basedOn`).
  The production DB itself was not read (no read-only access from here).

### B. First poll load (asked during integration)

- The first check after install publishes all 32 clubs: 1 version read, 32
  sequential fragment GETs to the API, one `rocket_clean_files()` with 32 URLs,
  two Rocket.net purge calls (30 + 2 paths), all at once. Purges are not
  staggered: every club is purged before its warm-up.
- Warm-up, before: one cron event a minute later firing 64 sequential cold
  renders (desktop + iPhone per club). Now: 8 events
  `statchasers_depth_charts_team_warm [<version>, offset]`, one a minute from
  T+1 to T+8 min, 4 clubs = 8 requests each. Load: ~8 requests/minute for ~8
  minutes, never more than one request in flight. An event for a superseded
  publication does nothing. A change to 1-4 clubs is one event, as before.
- A second poll against the same snapshot: `unchanged`, zero purges, zero
  warm-up events (asserted in dccache and in the replay).

## Evidence

- Plugin: full smoke 3344 ok / 0 fail; groups dccache 63, pageids 1769,
  statscache 25, legacyroutes 30, sos 23, schedtitles 194, all passed;
  smoke-local-assets 35; `tests/depth-charts/run-tests.sh` 146 ok (checks.php
  + stamp-checks.php); php -l clean.
- API: tsc (server + client) clean; targeted 154/154 (restore, version,
  team-depth-chart, team-roster-depth, depth-charts-ingest, embed-key, team,
  player-stats-publication, asset-version); full suite 1987 tests, 1983 pass,
  3 fail, 1 skipped. The 3 (matchup.test.mjs Wild Card H1,
  rb-handcuffs.test.mjs player card fragment, schedule-game-status.test.mjs
  warm cache live-to-final) fail the same way on a clean efbe131 checkout:
  pre-existing data drift, not regressions.
- Packaging: `node build.mjs` (asset version d09d66ec6807), then
  `build-zip.sh`: `wordpress-plugin/dist/statchasers-news.zip`, 2,560,817
  bytes, sha256
  `f2a6e0e23fbfbc95410ab7f270cf063742f70d2ff8af789b816495fc6e3ffa72`;
  contains `depth-charts/assets/img/nfl-depth-charts-og.png`,
  `assets/api/{manifest.json,team.css,dist/statchasers-team.js}`,
  `statchasers-{edge-cache,depth-charts-cache,local-assets,legacy-routes}.php`,
  `depth-charts/includes/class-scdc-stamp.php`. A rebuild (any commit after
  this one) changes the sha256.
- Bench replay (`.local/dc-integ/replay-2026-11-25.txt`, WP + MariaDB copy of
  the WEB-003 bench, ports 18140-18142, edge and WP Rocket modeled): ordinary
  desktop + iPhone requests, no cache-busters, hub A->B and buffalo-bills tab
  A->B; the hub `<time datetime>` moved 2026-11-25T15:36:01Z -> 15:36:16Z in
  the same publication as the lineup (Hub Alpha QB -> Hub Bravo QB); first
  poll 8 warm events at +55s..+475s; second poll 0 purges, 0 events. All three
  ACCEPTANCE lines PASS.

## Edge rules (no request)

mak cannot change Rocket.net's edge rules (updated 2026-11-25). The edge keeps
every page 30 days and ignores origin headers, so the `s-maxage=21600` these
pages send never applies, and there is no rule request to send. Targeted
purges are the only thing that keeps the pages fresh. In 1.10.71 a purge that
fails is recorded but never retried (the next check says `unchanged`); the
follow-up branch `fix/depth-followups-2026-11-25` retries failed purges
(docs/EDGE-PURGE-RETRY-2026-11-25.md).

## Release order

1. 1.10.69 / 1.10.70 first: their API published and plugin 1.10.70 installed.
2. Merge this branch to main, publish the API (version endpoint, depth
   version header, restore fix). The plugin without it only logs
   `version unavailable; nothing changed`.
3. Rebuild the zip from the deployed commit (`node build.mjs`, then
   `build-zip.sh`) if anything changed since this build; install 1.10.71; run
   `wp eval 'statchasers_news_run_upgrade_now();'`.
4. Clear WP Rocket (mobile included), then purge the Rocket.net edge.

(No Rocket.net rule request: the edge rules cannot be changed.)

## After release

- `wp cron event list | grep depth_charts`: the 5-minute check; within 5
  minutes `statchasers_depth_charts_team_published` shows `published`, 32
  changed, `edge: rocket.net ok`, then 8 warm events over ~8 minutes; the next
  run `unchanged`.
- `measure.sh public ""`: league page `v=` and the Bills QB1, desktop and
  phone; `x-sc-depth-cache` on a MISS.
- League page source: the `scdc-updated` line, og:image = the depth card URL,
  JSON-LD Organization/WebSite/WebPage with resolving `@id`s (needs production
  Rank Math; harness-only so far).
- A team Depth Chart tab: `<link id="statchasers-team-css">` on
  `statchasers.com/wp-content/plugins/statchasers-news/assets/api/team.css`.
- After the next daily league refresh: hub record `version` =
  `last_refreshed_ts`, the `<time>` line moved.
- Needs production: the real Rocket.net purge per path, WP Rocket mobile
  files, Rank Math output. The edge keeps its 30 days whatever the pages
  send; check `edge` in the records is `rocket.net ok` after each
  publication (until the retry ships, a failed purge needs a by-hand forced
  check: `wp eval 'print_r( statchasers_depth_charts_publish_check( true ) );'`).
