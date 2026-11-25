# NFL Depth Charts: published changes reach readers (WEB-003)

Branch `fix/dc-web003-cache-2026-11-25`, from main 87c85eb (production source:
API published 11-25, plugin 1.10.68). Nothing on this branch is deployed, and
no plugin version was bumped (the integrator assigns it). Surfaces:

- the league page `/nfl/nfl-depth-charts/` (WP page 2068, `[statchasers_depth_charts]`);
- the 32 team tabs `/nfl/teams/{slug}/depth-chart/` (the API's fragment).

## Where an update was held

Production, read-only, 2026-11-25 15:00-15:20 UTC. Browser user agent, at
least 1.5 s between requests, SSH and wp-cli reads only.

| Request | What the visitor got |
| --- | --- |
| `/nfl/nfl-depth-charts/` | `public, max-age=0, s-maxage=2592000`, `cf-cache-status: HIT`, age 336 s; `Last-Modified` = the WP Rocket file's mtime (14:49:33) |
| same, iPhone UA | the same header, but `MISS` while desktop was `HIT`: the edge keeps desktop and phone apart |
| `/nfl/teams/buffalo-bills/depth-chart/` | the same 30-day header, `HIT`, age 515 s |
| `/wp-content/uploads/statchasers/depth-charts.json?v=1795551600` | the same 30-day header; `HIT` on repeat (static file, cached by full URL) |
| `/nfl/` (`[statchasers_nfl_hub]`) | the same header. The page prints links only, no chart data (`class-scdc-hub.php`), so it is not purged |
| any of these, `X-SC-*` | none. WordPress sends no cache header on either route today (no `header()` in the depth-chart or team code) |

`scdc_refresh_meta` on production: `success`, `last_refreshed_ts` 1795551600
(11-24 20:20 UTC), which is the page's `?v=`. Push `off` (as intended).
WP-cron: `scdc_cron_refresh` daily (next 20:17:57 UTC) and
`statchasers_player_stats_publish_check` every 5 minutes.

### League page: one refresh, traced

| Layer | Lifetime | Refreshed by a publication before this branch? |
| --- | --- | --- |
| `uploads/statchasers/depth-charts.json` (atomic rename) + `scdc_refresh_meta` | until the next refresh | Yes |
| JSON at the edge, `?v=<last_refreshed_ts>` | 30 days, per URL | Yes: a new `?v=` is a new URL |
| Page HTML (it names the `?v=` and "Updated"), WP Rocket desktop + mobile files | 24 h | **No** |
| Page HTML at the Rocket.net edge, desktop + phone | **30 days** | **No** |

A refresh writes new data, but the page stays cached and keeps pointing the
browser at the old `?v=` until WP Rocket expires (24 h). The edge holds it
until someone purges. Rocket.net's mu-plugin purges only on post saves and
full cleans, and a refresh saves no post.

### Team tab: one snapshot, traced

| Layer | Lifetime | Refreshed by a publication before this branch? |
| --- | --- | --- |
| `data/depth-charts/statchasers/depth-charts.json` (committed, by hand) | until the next Replit publish | n/a |
| API read (`readDataJson`, mtime-keyed) | per file mtime | Yes, at once. Not a once-per-process cache |
| API render cache (`team-ssr.ts` LRU) | keyed on `dataVersion` | Yes, but only through `fetchedAt`. A file swapped under the same stamp kept the old render (fixed, below) |
| API slot index (`depthSlotFor`, Draft tab) | keyed on `fetchedAt` | Same caveat (fixed) |
| WP fragment transient `sc_team_ssr_*` (section + heading-mode key) | 5 min fresh + 1-day backup | Only by expiry |
| WP Rocket files (desktop + mobile) | 24 h | No |
| Rocket.net edge | **30 days** | **No** |

**Effective lifetime.** On both surfaces it is set by the platform: Rocket.net
stamps 30 days at its Cloudflare edge on every PHP 200 and strips origin
Cache-Control (established in WEB-040). The same header reaches the static
JSON. A Cloudflare rule overriding the origin cannot be read from here (the
zone is Rocket.net's), but the behavior matches one.

A second finding matters for the rule request. A WP Rocket file is served
without PHP: the hub's `Last-Modified` equals the file's mtime. So an edge
refill from that file carries none of the plugin's headers. "Respect origin"
alone would leave those refills on the platform default, so the request below
asks for a fixed TTL.

## The fix

### API (`artifacts/api-server`)

- `lib/team/depth-charts.ts`:
  - `depthChartsFingerprint()` hashes the document's content (sha1, computed
    once per read).
  - `depthTeamHash(abbr)` hashes one club's entry.
  - `depthTeamVersion(abbr)` = `<fetchedAt>~<hash>`.
  - `depthChartsStamp()` and `depthTeamUpdatedAt(abbr)` report the club's own
    `updatedAt` when the document carries one.
  - The slot index now keys on the fingerprint.
- `lib/team/team-data.ts`: `dataVersion` includes the fingerprint, so a file
  swapped without a new `fetchedAt` still re-renders.
- `lib/team-ssr.ts`: each render records `depthVersion`. A cache hit must match
  it too.
- `routes/team.ts`:
  - `GET /embed/depth-charts/version` (embed key; `no-store`) returns
    `{ version, fetchedAt, season, teams: { <slug>: { abbr, hash, version, updatedAt } } }`.
    It is mounted on the team router after `requireEmbedKey`, not on
    `routes/depth-charts.ts`, which is mounted ahead of the key for the
    ingest body.
  - `/embed/team/:slug` now sends `X-SC-Depth-Version`.

### Plugin (`wordpress-plugin/statchasers-news`)

- `depth-charts/includes/class-scdc-refresh.php`: `store()` fires
  `do_action( 'scdc_published', $meta, $payload )` right after `set_meta()`,
  only when the status is success or partial. A hard failure, a locked run, a
  failed write or a page view does not fire it. The publication id is
  `meta['last_refreshed_ts']`, which is the `?v=`.
- `statchasers-edge-cache.php` (new) holds the stats check's mechanics, lifted
  without a change in behavior:
  - the `statchasers_five_minutes` schedule;
  - `statchasers_edge_purge_paths()`: Rocket.net targeted purge, 30 paths a
    call;
  - `statchasers_edge_warm()`: desktop + iPhone;
  - `statchasers_edge_ttl_headers()`;
  - `STATCHASERS_EDGE_TTL` = 21600.

  `statchasers-player-stats-cache.php` now calls these helpers. Its filters,
  option, headers and results are unchanged.
- `statchasers-team.php`: the fragment key, URL and store are now shared
  functions (`statchasers_team_fragment_keys/_url/_store_fragment`,
  `statchasers_team_own_heading`). Keys and TTLs are unchanged.
- `statchasers-depth-charts-cache.php` (new):
  - **League page.** On `scdc_published` (`statchasers_depth_charts_on_published`):
    1. `rocket_clean_files()` the page (desktop + mobile).
    2. Purge `/nfl/nfl-depth-charts/` at the edge. Filter:
       `statchasers_depth_charts_hub_purge_paths`.
    3. Record in option `statchasers_depth_charts_hub_published`.
    4. Schedule `statchasers_depth_charts_hub_warm` 60 s later (desktop + iPhone).

    The data is readable before step 1, so the refill cannot pick up the old `?v=`.
  - **Team tabs.** WP-cron `statchasers_depth_charts_publish_check` runs every
    5 minutes and reads the version endpoint. When `version` moved:
    1. Fetch the `?section=depth-chart` fragment of each club whose hash moved.
       Each must carry the announced `X-SC-Depth-Version`. All or nothing: on
       failure or mismatch nothing is changed, and the record says why.
    2. Replace those clubs' fresh + backup transients.
    3. `rocket_clean_files()` exactly those tab URLs.
    4. Purge exactly those `/nfl/teams/{slug}/depth-chart/` paths. Filter:
       `statchasers_depth_charts_team_purge_paths`.
    5. Record in option `statchasers_depth_charts_team_published`.
    6. Warm them 60 s later (`statchasers_depth_charts_team_warm`).

    The first check after install publishes all 32 once. A new stamp over
    identical charts is recorded as `no club changed`, with no purge.
  - **Fallback lifetime.** Both surfaces send `Cache-Control: public,
    max-age=0, s-maxage=21600`, `CDN-Cache-Control` and
    `Cloudflare-CDN-Cache-Control` at 21600, plus
    `X-SC-Depth-Cache: edge-ttl=21600; surface=hub|team; published=<id>`.
    They are sent from `template_redirect` priority 20, on the tool page
    (`SCDC_Route::is_main()`) and on team pages with `sc_section=depth-chart`.
    Filter: `statchasers_depth_charts_edge_ttl`.
  - Short-circuit filter for tests or another CDN:
    `statchasers_depth_charts_pre_purge_edge`.
- `statchasers-news.php`: requires the two new files; deactivation clears the
  5-minute event.

By hand:

```
wp eval 'print_r( statchasers_depth_charts_publish_check( true ) );'   # team tabs, forced (all 32)
wp eval 'print_r( statchasers_depth_charts_hub_publish() );'           # league page, from the stored meta
```

## Tests

| Command | Result |
| --- | --- |
| `STATCHASERS_SMOKE_GROUP=dccache php wordpress-plugin/tests/smoke.php` (new `smoke-depth-charts-cache.php`) | all passed (52) |
| `STATCHASERS_SMOKE_GROUP=statscache php wordpress-plugin/tests/smoke.php` | all passed (stats unchanged) |
| `php wordpress-plugin/tests/smoke.php` (every group) | all passed |
| `wordpress-plugin/tests/depth-charts/run-tests.sh` (new section 3e: `scdc_published` fires once per publication, after file + meta; not on hard failure, lock, write failure or page view) | all checks passed |
| `node --test tests/depth-charts-version.test.mjs` (new) | 6/6 |
| `node --test tests/team-depth-chart.test.mjs tests/team-roster-depth.test.mjs tests/depth-charts-ingest.test.mjs tests/embed-key.test.mjs` | 28/28 |
| `tsc -p tsconfig.json --noEmit` | clean |

## Evidence: controlled two-snapshot replay

Run `artifacts/api-server/scripts/depth-charts/web003/replay.mjs`
(`SC_WP_DIR=.local/dc-web003/env`, a copy of the stats bench, with MariaDB on
its own datadir and socket). The run on 2026-11-25 ended in
**ACCEPTANCE: PASS**. The log is saved at `.local/dc-web003/replay-2026-11-25.txt`.

| Step | Origin | Public (edge model), desktop and iPhone |
| --- | --- | --- |
| A published (league refresh through `scdc_cron_refresh`; team check: 32 clubs), warmed | | league `?v=` A, BUF QB1 "Hub Alpha QB"; tab "Josh Allen"; all HIT |
| Control: league publication with the new hook removed (the old plugin) | new `?v=`, "Hub Control QB" | **HIT, old `?v=`, "Hub Alpha QB"** (the audit's bug) |
| B, league: the normal path (`store()` → `scdc_published`) | | purge drops 2 entries (desktop + phone); MISS → B; warm → HIT |
| B, team: file swapped (tmp + rename), API restarted | API fragment B at once (`X-SC-Depth-Version …~9b189eec…`); WP render still A (5-min transient) | **HIT A** (stale) |
| Team check | `published`, `changed: [buffalo-bills]`, 1 path, WP Rocket cleared | purge drops 2 entries; warm MISS → HIT |
| Acceptance: ordinary URLs, no cache-busters | | league `?v=` B + "Hub Bravo QB"; tab "Snapshot Bravo QB"; desktop and iPhone, twice: 8/8 B |
| Second check | `unchanged`, no purge | B |
| API down | `version unavailable; nothing changed`, record kept | HIT B |

The plugin's headers as seen at the origin (MISS responses):
`s-maxage=21600`, `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control`
`max-age=21600`, and `X-SC-Depth-Cache: edge-ttl=21600; surface=team; published=9b189eec0f824000`
(the league page shows `surface=hub; published=<last_refreshed_ts>`).

**Real in the replay:**
- the API: dist build, version endpoint, render cache, embed key, restart;
- WordPress 7.1.5 + MariaDB:
  - the plugin with the real `SCDC_Refresh` store path and uploads JSON;
  - meta, transients, the team route rewrite, `template_redirect` headers;
  - WP-cron hooks run through `do_action`.

**Modeled:**
- WP Rocket's files and Rocket.net's purge API (`player-stats/web003/bench-mu-plugin.php`);
- the edge: keeps every 200 per device until purged, and ignores the origin headers;
- the league sources (`depth-charts/web003/bench-sources.php`: the captured
  ESPN Bills chart with a marker QB1; others offline, so the refresh is
  partial).

**Needs production verification:**
- Rocket.net's real purge of these exact paths, for both device variants.
- That WP Rocket's `rocket_clean_files()` removes the mobile file too. The
  model deletes both; real WP Rocket removes the URL's directory.
- That wp-cron (a system cron here) runs the 5-minute event.
- The Rocket.net rule below.

## Rocket.net rule request

The purges keep the pages fresh. The 6 h lifetime is the fallback for a
missed purge, and today the platform overrides it. Ask Rocket.net to add a
Cloudflare cache rule for these routes only.

Expression (Cloudflare rules language):

```
http.host eq "statchasers.com" and (
  http.request.uri.path eq "/nfl/nfl-depth-charts/"
  or (starts_with(http.request.uri.path, "/nfl/teams/") and ends_with(http.request.uri.path, "/depth-chart/"))
)
```

If their plan has regex, this is equivalent:

```
http.request.uri.path matches "^/nfl/teams/[a-z0-9-]+/depth-chart/$"
```

Settings:

- **Eligible for cache.**
- **Edge TTL: fixed 21600 s (6 h), ignoring the origin header.** Not "respect
  origin" here: refills served from WP Rocket's files carry no plugin header,
  so they would fall back to 30 days.
- Browser TTL: respect origin (`max-age=0`).
- Keep today's cache key, including the desktop/phone split.

**Precedence.** These paths overlap neither the stats rule
(`/nfl/nfl-player-stats/`, WEB-003 stats) nor the schedule rule
(`/nfl/nfl-schedule/`, WEB-040), so the order among the three does not matter.
Each must sit after (and so override) the platform's site-wide 30-day rule. It
can go in the same ticket as those two.

**Not needed.** The JSON (`/wp-content/uploads/statchasers/depth-charts.json?v=`)
is versioned per publication. The unversioned URL is not used by any page.

**Verification after the rule is in place:**
1. `scripts/depth-charts/web003/measure.sh public ""` twice. The second run is
   HIT, and `age` stays under 21600 over a day.
2. A MISS shows `x-sc-depth-cache`, unless WP Rocket served it.
3. If `cdn-cache-control` reaches the client, the platform passes it.

## After release, check

1. `wp cron event list --fields=hook,next_run_gmt,recurrence | grep depth_charts`
   should show `statchasers_depth_charts_publish_check` at 5 minutes.
2. Within 5 minutes, `wp option get statchasers_depth_charts_team_published --format=json`
   should show:
   - `result: published` and `changed`: all 32 on this first run, so expect
     32 purges at once (one WP Rocket clean, two Rocket.net calls) and then
     64 warm requests spread over ~8 minutes: 8 WP-cron events
     `statchasers_depth_charts_team_warm` with args `[<version>, 0|4|...|28]`,
     one a minute from a minute after the check, 4 clubs (8 requests) each;
   - `edge: rocket.net ok`;
   - after the last event, `warm` with 64 entries of 200s.
   - the next run (5 minutes later) says `result: unchanged` and schedules no
     warm-up event.

   If it shows `version unavailable`, the API is not yet on this build, or the
   embed key is missing on the WP side.
3. After the next league refresh (daily ~20:17 UTC, or the admin Refresh
   button), `wp option get statchasers_depth_charts_hub_published --format=json`
   should show:
   - `version` = `scdc_refresh_meta.last_refreshed_ts`;
   - `edge: rocket.net ok`, `wp_rocket: true`, then `warm`.

   `measure.sh public ""` should print that `v=` for desktop and phone.
4. After the next manual team snapshot (docs/DEPTH-CHART-MANUAL-UPDATE.md) and
   Replit publish, check the tab within 5 minutes:
   - `measure.sh public ""` with `TEAM=<a club whose chart changed>` shows the
     new QB1 with no purge by hand;
   - the option lists only the changed clubs.

   Step 5 of that doc (full WP Rocket clean + `wp cdn purge`) is no longer
   needed for the tabs.

## Not covered (residual)

- Other pages that read the team snapshot follow their own caches:
  - matchup Player Battles (`depthStarters`, keyed on `fetchedAt`);
  - the team Draft tab's Pos column.

  Neither is purged by this.
- `restoreDepthCharts()` (fixed 2026-11-25, see
  docs/DEPTH-CHARTS-AUDIT-2026-11-25.md): a stored push is put back on API
  boot only when it was pushed on top of the committed snapshot now on disk
  (`basedOn`) and is a later fetch. Rows from before the fix carry no
  `basedOn` and are never restored, so a committed snapshot always wins over
  them whatever their `fetchedAt`.
- The team-tab hash covers the club's entry only. If the tab starts printing
  anything from outside it (for example the document's `fetchedAt`), fold that
  into `teamHash()` in `lib/team/depth-charts.ts`.
