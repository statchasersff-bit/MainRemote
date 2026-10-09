# StatChasers Depth Charts (the depth-charts/ half of the StatChasers plugin)

The code that pulls NFL depth charts, caches them locally, and renders the
StatChasers depth-chart UI on the front end. No external host, API server, or
GitHub workflow is required - everything runs inside WordPress.

Until 1.7.0 this was a plugin of its own, "StatChasers Depth Charts". Since
StatChasers 1.10.33 it lives here, under `statchasers-news/depth-charts/`, and
`statchasers-news.php` loads it: one zip installs everything, and the parent's
activation, deactivation and upgrade hooks call `scdc_activate()`,
`scdc_deactivate()` and `scdc_after_upgrade()` here. The classes, constants,
options, upload path and cron hook kept their `scdc_` / `SCDC_` names, so a
site coming from the standalone plugin keeps its data and schedule. The
standalone copy, if still active, is deactivated by the parent on the next
admin page view (both declare the same classes, so only one may load); delete
its folder from the Plugins screen afterwards.

**Sources (blended, matching the StatChasers app):**

- **FantasyPros** - the Fantasy tab (QB/RB/WR/TE/K), in ECR order, stored in
  dedicated `FAN_*` columns.
- **Footballguys** - Offense / Defense / Special-Teams columns (team depth order).
- **ESPN** - baseline/fallback for any column the others don't supply.

## What it does

- Adds an admin menu page **StatChasers Data Refresh** (visible only to users
  with `manage_options`).
- A **Refresh NFL Depth Charts** button (nonce-protected) fetches all 32 teams
  server-side from the blended sources above, normalizes them by team / side of
  the ball / position / depth rank / player name, and writes the result to
  `/wp-content/uploads/statchasers/depth-charts.json`.
- Stores refresh metadata (last refreshed time, status, error message) in the
  `scdc_refresh_meta` option and shows it on the admin page.
- Provides the shortcode **`[statchasers_depth_charts]`** which renders the UI
  (Fantasy / Offense / Defense / Special Teams tabs, search, team + position
  filters, responsive team grid, depth-order columns, movement arrows, and a
  **Download** button) from the cached JSON.
  - The Download button exports exactly what's on screen as a CSV (one row per
    Team + Position, players in depth order). It opens natively in Excel. (The
    standalone app produced `.xlsx` via a 400 KB library; the plugin uses CSV to
    avoid bundling that - same data and UX, different file extension.)
- Shows **“Depth chart data has not been refreshed yet.”** until the first
  successful refresh.
- Lives at **one address** (`/nfl/nfl-depth-charts/`). The view, team and
  position filters are client state in the URL fragment, so the tool never
  creates a second indexable URL - see [One address](#one-address). A team's
  own depth chart page is its team page (`/nfl/teams/{slug}/depth-chart/`),
  which is where the pre-1.7.0 team routes now 301.

## Install

1. Install the StatChasers plugin (`wordpress-plugin/dist/statchasers-news.zip`,
   built by `scripts/build-zip.sh`); this directory ships inside it.
2. In **Plugins**, activate **StatChasers** (or, on an upgrade, just load any
   admin page once). Activation, and the first request after an upgrade,
   automatically:
   - creates the **`/nfl/`** hub page (containing `[statchasers_nfl_hub]`) if it
     doesn't already exist,
   - creates the **`/nfl/nfl-depth-charts/`** child page (containing
     `[statchasers_depth_charts]`, parent = NFL) if it doesn't exist,
   - registers the rewrite rules and flushes them.
3. Go to **StatChasers → StatChasers Data Refresh** and click
   **Refresh NFL Depth Charts**. The "NFL pages" panel there links to both pages
   and warns if either is missing its shortcode.

> Existing pages at those paths are **reused, not overwritten** - if you already
> have a `/nfl/` or `/nfl/nfl-depth-charts/` page, just make sure it contains the
> relevant shortcode.

> **Pretty permalinks required.** The nested filter URLs rely on rewrite rules,
> so WordPress must use a "pretty" permalink structure (Settings → Permalinks,
> anything other than "Plain"). Activation flushes the rules automatically; if
> nested URLs ever 404, re-save Settings → Permalinks once.

## Page structure

```
/nfl/                       NFL              hub page   [statchasers_nfl_hub]
└─ /nfl/nfl-depth-charts/   NFL Depth Charts tool page  [statchasers_depth_charts]
```
- `/nfl/` and `/nfl/nfl-depth-charts/` are **real, indexable pages** (no `noindex`).
  Their title, description and canonical are whatever Rank Math (or the theme)
  gives the page; the plugin does not touch them.
- The tool page is the **only** address the tool answers at. Anything nested
  under it is either a pre-1.7.0 URL (301, see below) or junk (404).
- The hub's tool cards / quick links point to `/nfl/rankings/`,
  `/nfl/waiver-wire/`, `/nfl/injury-report/`, etc. Create those pages when ready;
  the links are internal and lowercase regardless.

## Filter state

The view, team and position filters are kept in the URL **fragment**:

```
/nfl/nfl-depth-charts/#{view}/{team}/{position?}
```

| Example | View | Team | Position |
|---|---|---|---|
| `/nfl/nfl-depth-charts/`                              | Fantasy | All Teams | All |
| `/nfl/nfl-depth-charts/#fantasy/all-teams/rb`         | Fantasy | All Teams | RB |
| `/nfl/nfl-depth-charts/#offense/all-teams/wr`         | Offense | All Teams | WR |
| `/nfl/nfl-depth-charts/#defense/all-teams/cb`         | Defense | All Teams | CB |
| `/nfl/nfl-depth-charts/#fantasy/buffalo-bills/rb`     | Fantasy | Buffalo Bills | RB |

- Slugs are lowercase: `fantasy`, `offense`, `defense`, `special-teams`,
  `all-teams`, team-name slugs (`buffalo-bills`), and position keys (`rb`, `wr`,
  `qb`, `te`, …). UI labels stay proper-cased. The default state (Fantasy, all
  teams, all positions) is the bare address with no fragment.
- Changing a filter updates the fragment via `history.pushState` (no reload);
  back/forward works via `popstate`. A filtered view can be copied, refreshed
  or opened in a new tab. The fragment is never sent to the server and never
  indexed, which is the point: one page, one URL.
- An unrecognised fragment falls back to the default view; nothing 404s.

If your page lives at a different path, change it with the `scdc_page_path`
filter (return the path relative to the site root, no slashes), e.g.:

```php
add_filter( 'scdc_page_path', function () { return 'nfl/nfl-depth-charts'; } );
```
After changing it, re-save Settings → Permalinks to flush the rules.

## One address

Until 1.7.0 the tool also served 32 "team routes"
(`/nfl/nfl-depth-charts/fantasy/houston-texans/`), each with its own title,
canonical, H1, intro, "at a glance" summary and a 32-team link grid, plus its
own XML sitemap. They competed with the team pages, which carry a team's depth
chart themselves, so they were retired: one tool, one URL; team-specific
addresses belong to `/nfl/teams/{slug}/`.

The rewrite rules still recognise the old shapes so nothing indexed goes dead:

| Request | Response |
|---|---|
| `/nfl/nfl-depth-charts/{view}/{team}/{position?}/`, team known | **301** → `/nfl/teams/{team}/depth-chart/` |
| `/nfl/nfl-depth-charts/{view}/` or `…/{view}/all-teams/{position?}/` | **301** → `/nfl/nfl-depth-charts/` |
| `/nfl/nfl-depth-charts/?team=houston-texans` (or `?view=`, `?position=`) | **301** likewise (other query args carried over) |
| any other segment under the tool's path | **404** |

| Concern | Where |
|---|---|
| The 32 teams + season (single source of truth) | `SCDC_Teams` (`includes/class-scdc-teams.php`) |
| Recognising the old URL shapes | `SCDC_Rewrite` (`includes/class-scdc-rewrite.php`) |
| Validating them, the 301s and the 404s | `SCDC_Route` (`includes/class-scdc-route.php`) |

The team page address is built from the team-pages plugin's own constants
(`STATCHASERS_TEAM_PATH`, `statchasers_team_section_urls_enabled()`) when it is
active, so the two never disagree; override it with the `scdc_team_page_url`
filter. Nothing SEO-related is emitted by this plugin any more: no title,
description, canonical, robots, breadcrumb, schema, Open Graph or sitemap
filters, no H1 rewriting, no `X-SCDC-Route` header and no debug panel.

After deploying 1.7.0: purge the page cache once, and in Search Console remove
the retired `/nfl-depth-charts-sitemap.xml` (it 404s now; the tool page is in
Rank Math's page sitemap as any page is).

### The season

`SCDC_SEASON` (default **2026**) is defined once in the main plugin file. Roll the
whole section over by changing it there, by defining it in `wp-config.php`, or via
the `scdc_season` filter. Nothing calls `date( 'Y' )` - NFL season naming doesn't
change on January 1.

## How data flows

```
Admin clicks Refresh  (SCDC_Refresh::run)
   → ESPN depthcharts API (server-side, 32 teams)        ← baseline
   → Footballguys all-teams page (1 fetch)               ← Off/Def/ST columns
   → FantasyPros per-team pages (32 fetches)              ← FAN_* columns
   → normalize + diff vs previous snapshot (movement arrows)
   → /wp-content/uploads/statchasers/depth-charts.json
   → POST <app origin>/api/depth-charts/ingest           ← team hub's Depth Chart tab
Visitor loads page with [statchasers_depth_charts]
   → shortcode enqueues CSS/JS + the cached JSON URL
   → JS fetches the cached file and renders the UI
```

> Because the blended refresh makes ~65 HTTP requests, it can take up to a
> minute. The handler raises the PHP time limit to 720s where the host permits
> (the worst case, every request timing out, is 655s) and stops starting new
> teams shortly before the limit. Any source that fails degrades gracefully
> (Footballguys/ESPN keep the non-fantasy columns; the Fantasy tab falls back to
> the seeded canonical order), and a team whose ESPN fetch fails, or that the run
> didn't reach, keeps its chart from the previous refresh. If no team could be
> fetched, nothing is written. The JSON is written to a temp file and renamed
> into place, so visitors never load a half-written file.

Refreshing only rewrites the cached JSON; the live page reflects it on the next
load. No redeploy or commit is involved.

### Imagery from the app (1.6.6)

ESPN serves a 350x254 PNG per headshot and a 500px PNG per crest, and the
script drew them into 20 to 40 pixel boxes. When the StatChasers plugin is
active (or `STATCHASERS_PUBLIC_ORIGIN` / `STATCHASERS_NEWS_ORIGIN` /
`SCDC_IMAGE_ORIGIN` is defined), the root carries `data-image-origin` and the
script points every headshot at the app's resized WebP
(`<origin>/news-image/espn/<athlete id>/latest/160.webp`) and every crest at
the app's SVG (`<origin>/team-logos/<abbr>.svg`) instead. The cached JSON and
the push to the hub are unchanged: the rewrite happens in the browser on the
loaded data. Filter `scdc_image_origin` to change or clear the origin.

### Push to the team hub (1.6.4)

The NFL team hubs' **Depth Chart** tab shows this tool's team view (all four
views), but the hub is rendered by the StatChasers app, which cannot reach this
site. So every refresh that writes the file also POSTs it to the app
(`SCDC_Push`). Add to `wp-config.php`, with the same value as the app's
`INGEST_SECRET`:

```php
define( 'STATCHASERS_INGEST_SECRET', '...' );
```

The app origin is the StatChasers plugin's `STATCHASERS_NEWS_ORIGIN` (define
`SCDC_PUSH_ORIGIN` to override). The admin page's **Team hub push** row shows
the last result. Without the secret the push is off and nothing else changes;
the hub keeps the last push it stored.

## Security

- The admin page and refresh action require the `manage_options` capability.
- The refresh form uses a WordPress nonce (`check_admin_referer`).
- Non-admins have no access to any refresh action.

## Automatic refresh (WP-Cron)

Since 1.6.3 the plugin refreshes once a day on its own (`scdc_cron_refresh`,
scheduled on `init`, cleared on deactivation). The cron and the button both call
`SCDC_Refresh::run_and_store()`, so they share the same 720s deadline and one
lock (`scdc_refresh_lock`): a click while the cron is running reports "already
running" instead of starting a second full run. A lock older than 15 minutes is
taken over, so a run that died cannot block refreshes for good.

WP-Cron is traffic-driven; for a strict schedule, disable `WP_CRON` and trigger
`wp-cron.php` from a real system cron.
