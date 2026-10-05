# StatChasers Depth Charts (WordPress plugin)

A self-contained WordPress plugin that pulls NFL depth charts, caches them
locally, and renders the StatChasers depth-chart UI on the front end. No external
host, API server, or GitHub workflow is required - everything runs inside
WordPress.

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
- Serves **32 server-recognized team routes** (e.g.
  `/nfl/nfl-depth-charts/fantasy/houston-texans/`) from that same tool, each with
  its own title, meta description, self-referencing canonical, H1, intro and
  Open Graph tags in the initial HTML response - see
  [Team SEO routes](#team-seo-routes). Unrecognized slugs 404.
- Publishes **`/nfl-depth-charts-sitemap.xml`** (main URL + all 32 team URLs) and
  registers it with Rank Math's sitemap index.

## Install

1. Copy the `statchasers-depth-charts` folder into `wp-content/plugins/`.
2. In **Plugins**, activate **StatChasers Depth Charts**. Activation
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
└─ /nfl/nfl-depth-charts/       NFL Depth Charts tool page  [statchasers_depth_charts]
   └─ /nfl/nfl-depth-charts/{view}/{team}/{position?}/   ← virtual (rewrite-handled)
```
- `/nfl/` and `/nfl/nfl-depth-charts/` are **real, indexable pages** (no `noindex`).
- The nested `{view}/{team}/{position}` URLs are **virtual** - handled by rewrite
  rules, never real pages.
- The 32 `/{view}/{team-slug}/` routes are **indexable landing pages** with their
  own title, description, self-referencing canonical, H1 and intro (see
  [Team SEO routes](#team-seo-routes)). Filtered variants
  (`…/houston-texans/rb/`, `…/offense/houston-texans/`) consolidate onto the
  team's fantasy URL; general `all-teams` variants consolidate onto
  `/nfl/nfl-depth-charts/fantasy/`.
- Anything that is **not** a recognized view/team/position slug returns a real
  **404**, so the tool can never generate unlimited indexable URLs.
- The hub's tool cards / quick links point to `/nfl/rankings/`,
  `/nfl/waiver-wire/`, `/nfl/injury-report/`, etc. Create those pages when ready;
  the links are internal and lowercase regardless.

## Pretty filter URLs

Filter state lives in the path, not in query parameters:

```
/nfl/nfl-depth-charts/{view}/{team}/{position?}/
```

| Example | View | Team | Position |
|---|---|---|---|
| `/nfl/nfl-depth-charts/fantasy/all-teams/`            | Fantasy | All Teams | All |
| `/nfl/nfl-depth-charts/fantasy/all-teams/rb/`         | Fantasy | All Teams | RB |
| `/nfl/nfl-depth-charts/offense/all-teams/wr/`         | Offense | All Teams | WR |
| `/nfl/nfl-depth-charts/defense/all-teams/cb/`         | Defense | All Teams | CB |
| `/nfl/nfl-depth-charts/fantasy/buffalo-bills/rb/`     | Fantasy | Buffalo Bills | RB |

- Slugs are lowercase: `fantasy`, `offense`, `defense`, `special-teams`,
  `all-teams`, team-name slugs (`buffalo-bills`), and position keys (`rb`, `wr`,
  `qb`, `te`, …). UI labels stay proper-cased.
- Omitting the position segment means **all positions**.
- Changing a filter updates the URL via `history.pushState` (no reload);
  back/forward works via `popstate`. Every resulting URL also works when it is
  copied, refreshed, opened in a new tab, or requested by Googlebot.
- Unrecognized slugs 404 (they are not silently "fixed"); a missing trailing
  slash or an uppercase slug 301s to the clean URL, as does a legacy
  `?team=houston-texans` query argument.

If your page lives at a different path, change it with the `scdc_page_path`
filter (return the path relative to the site root, no slashes), e.g.:

```php
add_filter( 'scdc_page_path', function () { return 'nfl/nfl-depth-charts'; } );
```
After changing it, re-save Settings → Permalinks to flush the rules.

## Team SEO routes

Each of the 32 teams has its own indexable landing page **inside the same tool** -
one WordPress page, no duplicated Divi layouts, no 32 fake posts:

```
https://statchasers.com/nfl/nfl-depth-charts/fantasy/houston-texans/
```

Requested directly (curl / View Source / Googlebot), that URL returns:

```html
<title>Houston Texans Depth Chart 2026 | Fantasy Football</title>
<meta name="description" content="View the latest Houston Texans depth chart for 2026 fantasy football. See starters, backups, handcuffs, position battles, and offensive depth by position.">
<link rel="canonical" href="https://statchasers.com/nfl/nfl-depth-charts/fantasy/houston-texans/">
…
<h1>Houston Texans Depth Chart</h1>
```

and the tool below it is already showing Houston - the team is resolved in PHP
before render, so there is no "load all teams, then switch" flash.

### How it fits together

| Concern | Where |
|---|---|
| The 32 teams + season (single source of truth) | `SCDC_Teams` (`includes/class-scdc-teams.php`) |
| Route detection, validation, 404s, URL normalization | `SCDC_Route` (`includes/class-scdc-route.php`) |
| Title / description / canonical / robots / breadcrumbs / schema / OG | `SCDC_SEO` (`includes/class-scdc-seo.php`) |
| H1, intro, "at a glance" summary, team-link grid, breadcrumb trail | `SCDC_Team_Content` (`includes/class-scdc-team-content.php`) |
| `nfl-depth-charts-sitemap.xml` | `SCDC_Sitemap` (`includes/class-scdc-sitemap.php`) |

Every SEO filter returns its incoming value untouched unless `SCDC_Route` says the
request is one of these routes, so no other page on the site is affected.

### Rank Math hooks used

`rank_math/frontend/title`, `…/description`, `…/canonical`, `…/robots`,
`rank_math/frontend/breadcrumb/items`, `rank_math/json_ld`,
`rank_math/opengraph/facebook/og_(title|description|url)`,
`rank_math/opengraph/twitter/twitter_(title|description)` and
`rank_math/sitemap/index`.

- The **canonical is self-referencing** for each team URL; filtered variants
  consolidate onto it. The bare `/nfl/nfl-depth-charts/` renders the same view as
  `/nfl/nfl-depth-charts/fantasy/`, so it canonicalises there - the URL the
  sitemap lists. Only one canonical tag is ever emitted.
- **Robots** is only touched to *clear* an inherited `noindex` - nothing is added.
- **Breadcrumbs** are filtered, not duplicated: Rank Math builds both its visible
  trail and its `BreadcrumbList` schema from the same list, so the two agree.
- The plugin's own visible breadcrumbs render only when Rank Math's breadcrumbs
  are switched off (override with the `scdc_render_breadcrumbs` filter), and the
  plugin only outputs `BreadcrumbList` JSON-LD when no SEO plugin is active.
- With Rank Math inactive the plugin emits an equivalent minimal head block and
  removes core's `rel_canonical`, so there is still exactly one canonical.

### The season

`SCDC_SEASON` (default **2026**) is defined once in the main plugin file. Roll the
whole section over by changing it there, by defining it in `wp-config.php`, or via
the `scdc_season` filter. Nothing calls `date( 'Y' )` - NFL season naming doesn't
change on January 1.

### The H1

Team routes never carry two H1s. In order:

1. The page title is renamed for that request (`the_title`), so a Divi title
   module / theme header prints "Houston Texans Depth Chart" server-side.
2. The tool also renders its own `<h1 data-scdc-h1="tool">`.
3. A response-buffer pass on team routes only retitles the first H1 that is either
   the page title or already mentions "depth chart", and then drops the tool's H1 -
   so a Divi text module with a hard-coded "NFL Depth Charts" heading is handled
   too, and only one H1 survives.

`scdc_seo_heading_mode` picks the strategy: `auto` (default), `theme` (rename only)
or `shortcode` (tool H1 only). If the theme wraps the *site* title in an H1, use
`theme` mode.

### Sitemap

`https://statchasers.com/nfl-depth-charts-sitemap.xml` is generated on request
(main URL + 32 team URLs) and added to Rank Math's sitemap index. `lastmod` is only
emitted when there is real information to report - the timestamp of the last
successful depth-chart refresh - never a synthetic date.

### Caching

Team HTML differs per URL path, so any cache must key on the full path (all of
WP Rocket, LiteSpeed, WP Super Cache and Cloudflare do by default).

- Don't add a "ignore query string / normalize URL" rule that folds
  `/fantasy/{team}/` into `/fantasy/`.
- Cloudflare: no Page Rule that strips path segments or caches by hostname only.
- Every response on a tool route carries `X-SCDC-Route: team:houston-texans` (or
  `main`) - a quick way to prove a cached page belongs to the URL that served it.
  Disable it with the `scdc_send_route_header` filter.
- Purge the page cache once after deploying, so old copies with the generic title
  are dropped.

### Debug mode

Append `?scdc_debug=1` (or `define( 'SCDC_DEBUG', true )`) **while logged in as an
administrator** for a panel listing the detected route, team, slug, SEO title,
canonical, season, H1 source and indexability. It renders for nobody else, and
without the query argument or the constant it never renders at all - remove the
constant before you're done.

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
