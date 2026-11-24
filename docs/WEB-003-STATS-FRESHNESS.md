# NFL Player Stats: freshness, speed, season control, identity (WEB-003, WEB-002, WEB-020, WEB-021)

Branch `fix/stats-audit-2026-11-24` (worktree `.local/statsaudit/wt`), from the
production release `release/2026-11-24` (2d0bd3b). Nothing on this branch is
deployed. Routes: `/nfl/nfl-player-stats/` (QB), `/rb/`, `/wr/`, `/te/`;
`/qb/` 301s to the bare page.

## WEB-003: where the old HTML survived

One stats publication, traced 2026-11-24 (production read over SSH and curl):

| Layer | Lifetime | Refreshed by a stats publication before this branch? |
| --- | --- | --- |
| API (`stats-data.ts`, `player-stats-ssr.ts`) | file mtime | Yes, at once. But FPTS reads the game logs, which reloaded without dropping the stats tables. |
| Plugin fragment transient `sc_stats_ssr_*` | 1 h (+30-day backup) | Only by expiry. |
| WP Rocket page files (desktop + mobile) | 24 h | No. |
| Rocket.net Cloudflare edge | **30 days** (`s-maxage=2592000`) | No. |

The effective HTML lifetime is set by the hosting platform, not by WordPress.
Rocket.net strips the origin's `Cache-Control`/`Expires` from PHP responses
and stamps `public, max-age=0, s-maxage=2592000` on every 200 (established in
WEB-040, docs/WEB-040-SCHEDULE-STATUS.md; same header on all four stats routes
today). Rocket.net's mu-plugin "CDN Cache Plugin" purges the edge on post saves
and full WP Rocket cleans only. A data rebuild saves no post, and `/rb/ /wr/ /te/`
are rewrite routes no post names. On 11-24 the 13:48 UTC publish put Weeks 1-11
on the origin, while the edge kept Weeks 1-10 until the manual full-site purge
at 14:21.

Cloudflare Cache Rules: this repo cannot read the zone (it is Rocket.net's).
The behavior matches a platform rule that ignores origin headers (WEB-040).

### The fix

`wordpress-plugin/statchasers-news/statchasers-player-stats-cache.php`:

1. **Event.** WP-cron runs every 5 minutes (this host runs wp-cron.php from a
   real system cron). Each run reads `GET /embed/player-stats/version` from the
   API. That is one fingerprint of the four default-season fragments, plus
   each fragment's ETag.
2. **Order when the fingerprint moves:**
   1. Fetch all four fragments. Each must carry the ETag that was announced,
      or nothing is changed.
   2. Replace the fragment transients (fresh and backup).
   3. `rocket_clean_files()` the four pages (desktop and mobile).
   4. Purge the four paths, plus `/qb/` and the old `?season=` variants, at
      the edge through `CDN_Clear_Cache_Api::cache_api_call($paths, 'purge')`.
      That is the mu-plugin's own targeted purge, scoped to these 30 paths.
   5. Record the version.
   6. A minute later, request each page once as a desktop and once as an
      iPhone, so the edge and WP Rocket refill from the new snapshot.
3. **Failure keeps the last complete snapshot.** A version or fragment fetch
   that fails, or a fragment whose ETag does not match, stops before anything
   is purged. The builder already refuses to write fewer games or weeks than
   disk (`buildSeason.mjs`).
4. **Fallback lifetime:** six hours, sent as `Cache-Control: s-maxage=21600`,
   `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control`, plus
   `X-SC-Stats-Cache: edge-ttl=21600; published=<version>`.

API (`artifacts/api-server`):

- `routes/player-stats.ts`: the version endpoint. It is protected by the embed
  key like every `/embed/` path.
- `player-stats-ssr.ts`: the fragment ETag now includes a hash of the markup.
- `player/live-refresh.ts`: `reloadPlayerStats()` now also drops the stats
  tables, because FPTS is computed from the game logs.
- `stats-data.ts` `servedStamp()`: when a table missing a final game is
  written (which does not advance `lastIngestedAt`), "Updated" shows that
  build's time, not the older complete one.

### Evidence: controlled two-snapshot replay

Run `scripts/player-stats/web003/replay.mjs`. It uses the real API and the
real WordPress 7.1.5 + MariaDB with this plugin. WP Rocket and the edge are
modeled (`bench-mu-plugin.php`); the edge keeps every 200 until it is purged,
as production does today.

- Snapshot A is bdadaa4: Weeks 1-10, with MNF CIN at WAS missing.
- Snapshot B is 7a65a44: Weeks 1-11.

Run 2026-11-24, `/wr/` shown (all four routes behave the same):

| Step | Origin (WP render) | Public (edge) |
| --- | --- | --- |
| A published, visitors | 1-10, Nov 23, Chase G 9 / 193.8 | MISS then HIT, same |
| B lands (publish restarts API) | **1-11, Nov 24, Chase G 10 / 201.9** | **HIT 1-10, Nov 23, G 9 / 193.8** (the 11-24 bug) |
| Check runs | | edge purge: 30 paths, 8 entries dropped; WP Rocket cleared for 4 URLs |
| Warm-up, then visitors | | HIT 1-11, Nov 24, G 10 / 201.9 (desktop and phone) |
| Second check, no change | | `unchanged`, no purge |
| API down | `version unavailable; nothing changed`; backup B served | HIT B |

QB Burrow 238.3 to 258.2 (G 9 to 10), RB Chase Brown 129.7 to 138.3: the
Monday game is counted in G and FPTS (WEB-032).

### Production change still needed (Rocket.net)

Purges are what keep the page fresh. The 6 h fallback only takes effect once
Rocket.net lets it through. Ask Rocket.net (or use their dashboard) to apply,
for these paths only:

```
http.host eq "statchasers.com" and starts_with(http.request.uri.path, "/nfl/nfl-player-stats/")
```

The rule should be: eligible for cache, Edge TTL "use cache-control header if
present" (Cloudflare-CDN-Cache-Control), browser TTL respect origin. Or, if
origin headers cannot pass, a fixed 6 h edge TTL for that expression. This can
share the request with WEB-040's `/nfl/nfl-schedule/` rule.

### After release, check

1. `wp eval 'print_r( statchasers_player_stats_publish_check( true ) );'`
   should show `result => published` and `edge => rocket.net ok`.
2. `wp option get statchasers_player_stats_published --format=json` a minute
   later should show `warm` entries with 200.
3. Run `scripts/player-stats/web003/measure.sh public ""` twice (the second
   run must be HIT), with the phone UA, and with `origin "?zz=$(date +%s)"`.
   Compare Weeks, Updated and rows; spot-check a player.
4. After the next real stats rebuild + publish, wait up to 5 min. The public
   page should change without any manual purge.

## WEB-002: the slow uncached page

Baseline, production, 2026-11-24 19:36-19:38 UTC, before any change. Desktop
UA, one request per route, 2 s apart (`measure.sh`):

| Route | Edge HIT TTFB | Edge MISS, WP Rocket file | WP render, fragment cached | WP render, fragment cold* | Complete |
| --- | --- | --- | --- | --- | --- |
| QB `/` | 0.09 s | 3.04 s | 2.39 / 4.84 s | 1.42 s | yes, 69 rows |
| RB `/rb/` | 0.07 s | 2.20 s | 1.80 / 1.99 s | 2.04 s | yes, 139 |
| WR `/wr/` | 0.09 s | 2.47 s | 1.35 / 2.16 s | 2.21 s | yes, 214 |
| TE `/te/` | 0.13 s | 1.87 s | 1.47 / 1.38 s | 8.34 s | yes, 115 |

\* The fragment cold column was taken after deleting the fresh `sc_stats_ssr_`
transients (the same as their hourly expiry).

Breakdown (WP-CLI on the server, and Performance Lab's Server-Timing):

- WordPress before the template: 0.69-0.96 s. `/wp-json/` alone takes 1.13 s.
- The plugin's own work per route:
  - transient read: 0.002-0.25 s;
  - API fragment fetch: 0.09-0.21 s;
  - parse: 0.002 s.
- API cold render, local: QB 124 ms, RB 87, WR 105, TE 52 (warm 4-6 ms).
  - All seasons: WR 163 ms.

Findings:

- **The 60 s timeout did not reproduce.** The stats-specific work is at most
  ~0.5 s of a 1.2-3 s WordPress floor; the rest is bootstrap and Divi,
  shared by every page.
- Single spikes of 4.8 s and 8.3 s were server contention, not one stats
  operation.
- 11-24 was also the day of the 1.10.63/1.10.64 installs. Each plugin upgrade
  runs the cache sweep that made uncached renders take 25-60 s for about 20
  minutes (memory: release-2026-11-24). That fits the audit's first uncached
  pass, but the audit's timestamps are not known here.
- The template does not load every season or position for one table. One
  fragment per request; the API builds one table.
- Measured waste:
  - 26 backup transients of 130-460 KB each (~6 MB in `wp_options`), one per
    season variant crawled;
  - every expired fragment fetched once per concurrent worker.

Fixes:

- Season variants removed (WEB-020).
- One fetch per expired fragment: an INSERT IGNORE claim; other requests serve
  the backup. Replay step 7: 12 simultaneous cold renders gave 1-2 API fetches (two runs),
  12/12 complete.
- Publication warm-up: no visitor pays the cold render after a data change.
- Concurrent misses at the API cannot fan out: table builds are synchronous
  and cached, so the second request waits on the first.

The "after" production timings need the release: rerun the same `measure.sh`
passes.

## WEB-020: season control

Code is in `player-stats-render.ts`, `client/player-stats.ts`,
`player-stats.css` and the plugin redirect.

- **Markup.** Season choices are `<button aria-pressed>` in a labeled group.
  Position links are clean canonical paths; none carries `?season=`.
- **Switching.** Switching is in place. The latest request wins (request id +
  AbortController) and the state is written as `#season=` (removed for the
  default).
- **Old bookmarks.** `?season=X` 301s in one hop to the position's canonical
  `#season=X`, other parameters kept. `/qb/?season=2024` goes to
  `/nfl/nfl-player-stats/#season=2024`. Verified on real WordPress (core
  `redirect_canonical` included):
  - invalid values drop the parameter;
  - `/qb/` still 301s;
  - other pages are untouched.

## WEB-021: share image and connected schema

Done by extending `statchasers-page-identity.php` (the schedule/SOS
mechanism), so it is the same code path that is live on the schedule.

- **og:image / twitter:image.** The brand card
  `https://statchasers.com/wp-content/uploads/2026/11/statchasers-og-default-1200x630-1.png`
  (200, image/png).
- **Entities.** Rank Math's global Organization `/#organization` and WebSite
  `/#website`.
- **WebPage.** One per position at `<canonical>#webpage`, `url` = canonical.
  Rank Math builds it from the filtered canonical, which is already
  per-position.
- **FAQ and breadcrumbs.** The FAQ is folded into the WebPage. Breadcrumbs end
  at the position page.
- **Tests.** Verified in the Rank Math model (`smoke-page-identity.php`, 138
  stats checks). Rank Math itself must be checked live after release.
