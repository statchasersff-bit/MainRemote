# StatChasers NFL Content — SEO, Crawl, Request-Volume, Cache & Origin-Load Audit

Audit date: 2026-09-28. Read-only. No code, data, routes, redirects, metadata or database were changed.

**Method**

Five parallel code traces covered:

1. The WordPress player, team and matchup pages.
2. The WordPress tool shortcodes and the depth-charts plugin.
3. The API's player, team and matchup routes.
4. The API's news, FPA and tool routes, plus its background jobs.
5. A runtime probe.

The runtime probe sent about 135 GETs to the dev server on `localhost:8080` and about 26 to production at `https://newsfeed.replit.app`. The top findings were then re-checked by hand against the source.

Paths are relative to the repo root.
- `WP/` = `wordpress-plugin/statchasers-news/`
- `DC/` = `wordpress-plugin/statchasers-depth-charts/`
- `API/` = `artifacts/api-server/src/`

**Limits of this audit**

- `statchasers.com` answers `403` to this host (Cloudflare). Nothing in this report observed the live WordPress site directly. Every WordPress statement comes from reading the PHP, and anything that depends on Bluehost, Rank Math, Divi or a page cache is marked **REQUIRES RUNTIME VERIFICATION**.
- The dev database is not production-sized. It has 146 wire rows; production's archive is 5,436 items.

**Side effects during the audit (disclosed)**

- One probe, `GET https://newsfeed.replit.app/fpa?season=2099`, triggered a full production FPA re-ingest at 20:12 UTC. That is finding #1 below, confirmed live.
  - It rewrote the same week-3 data that the manual refresh had written at 19:39 UTC.
  - Production still reports `week_3`. No harm was done.
- A probe of `/schedule?season=2099` in production caused extra `games.csv` downloads.
- Nothing else in production changed.

---

> **Update 2026-09-28: low-risk fixes applied.** WordPress plugin 1.10.9 and the API; each item still needs deploying.
>
> Fixed:
> - **P0-1:** the FPA auto-import runs only for the default table; a 1 h backoff follows a successful run; the nflverse download times out at 120 s.
> - **P0-2:** a failed fetch keeps serving the saved copy under the fresh key for 1 min in every WordPress fetcher, so repeat calls in the same request reuse it. News gains a 1-minute failure cache.
> - **P0-3:** a failed player-list fetch is remembered for 5 min; a 7-day backup is kept; a reader's page view waits at most 8 s.
> - **P1-3, partial:** Sleeper refresh gets a 10-minute failure backoff and serves stale data while refreshing.
> - **P1-6:** player-stats `?season=` accepts 1999 to the current year, plus `all`.
> - **P1-7:** `sc_sched_week` applies only on the schedule page (new smoke test, `tests/smoke-week-stray.php`).
> - **P1-8, partial:** a failed freshness check no longer returns 500 on player, team and matchup pages. DB pool timeouts are not done.
> - **P1-9, partial:** hashed assets requested with the current `?ver=` are served `immutable` for a year in production. Compression is not done.
> - **P2:** `/api/news` is sent with `max-age=30`, and the refresh on returning to the tab is limited to once a minute.
> - **P2:** the `?sc_section=overview|outlook` redirect loops are fixed.
>
> - **P1-5:** news ingest counts only real changes. Re-sent rows get one batched `lastSeenAt` touch, and no longer invalidate the freshness version or the render cache. On dev, a club sweep went from `updated: 1790` to `updated: 1, unchanged: 1787`.
>
> - **P1-4, mostly:**
>   - `?season=` is limited to 1999 through the current season; future seasons fall back to the current board.
>   - Concurrent requests share one ESPN sweep per season.
>   - A sweep that reaches nothing backs off for 1 h instead of repeating every 15 min.
>   - Past seasons refresh ESPN weekly instead of every 6 h.
>   - Not done: `season` is still carried into week links, and the March–May empty-season window (rollover) still re-downloads games.csv every 60 s.
>
> - **P1-1, rescoped:**
>   - The player and matchup app pages build their data once instead of twice.
>   - The FPA table is memoised for 5 min, with in-flight dedupe, and dropped by every in-process ingest.
>   - Not done: a version check before the data build. WordPress sends no conditional requests, and a crawl rarely repeats a key within a minute, so it would add risk for little saving. The per-build cost that remains is P1-2.
>
> - **Found at deploy check, pre-existing:** `/embed/assets.json` answered `"version":"0"` in production. `assetVersion()` read version.json from `process.cwd()`, the same bug class `lib/data-dir.ts` fixed for `data/`. As a result WordPress enqueued every asset as `?ver=1.7.0`, and no deploy ever busted an asset cache. Fixed by resolving from the module (`tests/asset-version.test.mjs`); needs the next deploy.
>
> - **P1-2, done without a schema change:**
>   - Team news asks SQL for a superset: wire rows whose headshot is a player on the team now, whose folded name is one, or whose name is not plain ASCII. The JS derivation still decides.
>   - Player news matches the tagged player in SQL instead of a title/name `ILIKE`, which also fixes the surname starvation.
>   - Checked against the old algorithm on the dev DB: identical sets for all 33 team values and all 647 players; 142 rows read instead of 4,818.
>   - Test: `tests/team-news-query.test.mjs`.
> - **Weekly data:** automated in production (`lib/player/live-refresh.ts`; plugin 1.10.10 WP-cron page build).
>
> - **Compression:** gzip/brotli on every response except the dev live-reload stream. Team hub 217 KB → 30 KB, player.css 204 KB → 58 KB.
> - **Season rollover:**
>   - The schedule shows the season just played between March 1 and the new schedule's release, instead of an empty page or a 503. The missing season is retried every 30 min.
>   - The game-log builder never writes an empty season.
>   - Runbook for the rest: `docs/SEASON-ROLLOVER.md`.
>
> **Update 2026-09-29: P2/P3 pass.** Most P2/P3 items were already fixed in the code: postseason matchup rewrites, `?adv=` forwarding, the section-sitemap shortcode check, flush-fresh vs flush-all, the matchup breadcrumb, the RB-handcuffs `mainEntity` guard, `getFpaDelta`, the `X-Forwarded-Host` check, `X-Powered-By`/source maps, the version fallback, the committed token, depth-charts partial refresh, atomic writes, the nested `<a>` and the bare-page canonical, the schedule rewrite self-heal, and the empty-state 404s. New in this pass:
> - Club RSS feeds are fetched with `If-None-Match`/`If-Modified-Since`, and a 304 answers with the last items (`tests/club-feed-conditional.test.mjs`).
> - The club sweep's timer is off in the dev workspace, the same as the wire (`SC_DEV_INGEST=1` turns both on).
> - App-host `robots.txt` disallows `/*?season=` and `/*&season=`.
> - Depth charts 1.6.2 drops the bare tool page from Rank Math's page sitemap (its canonical is `/fantasy/`, which the plugin's own sitemap already lists).
>
> Still open, by decision:
> - **Roster island:** 30 KB raw / 12 KB gzipped per player page. Inert JSON, parsed only when someone types. Inlining it was a deliberate design choice (no cross-origin fetch), and the saving did not justify reversing that.
> - **Owner decisions:** the six `[statchasers_nfl_hub]` links (verify live first); the depth-charts "popular view" links that canonicalise to `/fantasy/`; server-rendering the depth-chart table; data-dated section `lastmod`; app-host trailing-slash canonicals (noindex host, low value).
> - **Needs a live check:** everything marked REQUIRES RUNTIME VERIFICATION.

# Executive Summary

**Framing: this is not a JavaScript-rendered SEO site.**

- Every `[statchasers_*]` shortcode prints **server-rendered HTML fetched from the Replit API during PHP execution**. View Source on statchasers.com contains the real content.
- Per-URL titles, descriptions, canonicals, robots, breadcrumbs and schema are set through Rank Math filters in `wp_head`.
- The API's own host is `noindex, indexifembedded` everywhere.
- The large SEO failure modes the brief anticipated are mostly **not** present:
  - player bodies with generic WordPress titles;
  - JavaScript-only metadata;
  - unbounded `?week=`/`?position=` crawl traps on statchasers.com;
  - soft-404s for invalid player slugs.

**The real risks are elsewhere:**
- **Origin-load and resilience multipliers.** One request becomes many during an outage, a cache miss, or a crawl.
- **A handful of specific SEO defects.**
- **Season-rollover time bombs.**

## 1. Any anonymous GET can force a full production FPA re-ingest

- **Severity:** CRITICAL. **Status:** CONFIRMED, including live in production.
- **Problem:**
  - `renderFpaFragment()` calls `kickLazyIngest()` whenever `getFpaTable(query)` returns null.
  - It returns null for **any season with no snapshots**, and `season` is user-controlled from 1999 to 2100 on `/fpa`, `/embed/fpa` and `/fpa/download.csv`.
  - The guard only blocks while a run is in flight, or for 60 s after a *failure*. After a success, the next bad-season request starts another run.
  - Each run re-downloads nflverse CSVs with **no fetch timeout**, deletes the current snapshots, and re-inserts 7,269 rows.
- **Evidence:**
  - `API/lib/fpa-ssr.ts:62-76` (the guard) and `:111-114` (the trigger).
  - `API/lib/fpa/fpa-data.ts:95-111`.
  - `API/lib/fpa/nflverse.ts:243` (`await fetch(url)` with no signal).
  - `API/lib/fpa/ingest.ts:352-360`.
  - The comment at `fpa-ssr.ts:30` says it "fires when the table is EMPTY … can never refresh a stale one". The code contradicts it.
  - Production `/api/status` after one probe: `lastAttempt 20:12:40Z`, `lastSuccess 20:12:43Z`.
- **SEO impact:** none directly. The app host is noindex. The WordPress shortcode takes `season` only from a shortcode attribute (`WP/statchasers-fpa.php:82-93`), so statchasers.com URLs cannot trigger it.
- **Traffic/performance impact:**
  - One looping client or crawler on `newsfeed.replit.app` can keep Postgres in back-to-back delete-and-insert transactions and pull about 7 MB × 2–4 from GitHub per run.
  - Each run also clears five render caches (`API/lib/fpa/refresh.ts:37-56`), which forces cold renders for FPA, matchup and player pages.
  - `robots.txt` on the app host allows crawling.
- **Recommended fix:** only lazy-ingest when the **table is empty for the default season**; never for a user-supplied season. Whitelist `season` to seasons that have snapshots, and return 404 for the rest. Add a timeout to the nflverse fetch.

## 2. When the API is slow or down, every WordPress view re-fetches, several times, synchronously

- **Severity:** HIGH. **Status:** CONFIRMED.
- **Problem:**
  - Every fragment fetcher writes the 60-second negative cache **only when no backup transient exists**.
  - In the normal outage case, where a backup exists, it returns the backup without caching anything. Every page view therefore calls `wp_remote_get` again and blocks until the timeout.
  - Several shortcodes call the fetcher more than once per request, through separate callers for the Rank Math title, json_ld and the shortcode body. Only RB handcuffs memoizes the result per request.
  - `[statchasers_news]` has no negative cache at all.
- **Evidence:**
  - Backup branch with no negative cache:
    - `WP/statchasers-fpa.php:203-210`
    - `WP/statchasers-rankings.php:563-571`
    - `WP/statchasers-schedule.php:353-361`
    - `WP/statchasers-player-stats.php:309-317`
    - `WP/statchasers-player.php:268-273`
    - `WP/statchasers-team.php:150-154`
    - `WP/statchasers-matchup.php:299-303`
  - News: `WP/statchasers-news.php:204-215`.
  - The only per-request memo: `WP/statchasers-rb-handcuffs.php:70-73`.
  - Worst-case blocking time per view:

    | Page | Worst case |
    |---|---|
    | ROS rankings | 3 × 6 s |
    | Schedule | 2 × 12 s |
    | Player stats | 2 × 8 s |
    | Team | 2 × 8 s |
    | Matchup | 4–6 × 8 s (`statchasers_matchup_request_meta` is not memoized, `WP/statchasers-matchup.php:542-568`) |
    | Player | 2 × 6 s, plus finding #3 |

- **SEO impact:**
  - During an outage, Googlebot sees TTFB of 12–32 s. Crawl rate drops, and slow or failed fetches count against the host.
  - Where no backup exists, pages return 200 with an empty body (see soft-404s).
- **Traffic/performance impact:**
  - Bluehost PHP workers are held for the full timeout on every view, human or bot.
  - A 5-minute Replit blip can stall the whole WordPress site, because shared workers are exhausted by the product and tool pages.
  - Each blocked request is also another hit on the struggling origin, which is the classic retry-amplification pattern.
- **Recommended fix:** on any failure, write the backup (or a sentinel) into the primary key for about 60 s. Memoize the fetch result per request, including failures, in every fetcher, the way `rb-handcuffs` does.

## 3. Every player page view can make a 20-second, never-cached-on-failure API call from the title filter

- **Severity:** HIGH. **Status:** CONFIRMED.
- **Problem:**
  - The `the_title` filter on player pages calls `statchasers_player_heading()`, which calls `statchasers_player_roster()`. That fetches `/embed/players.json` (113 KB) with a **20 s timeout** whenever the 6-hour transient is absent.
  - On failure it returns `[]` and **sets no transient**, so the next view tries again.
  - When the transient expires, every concurrent player-page view fetches at once (a stampede).
- **Evidence:** `WP/statchasers-player-pages.php:78-114` (timeout 20 at `:101`; failure returns at `:106-114`), `:880-907` (the filter).
- **SEO impact:** the same TTFB collapse as #2, but on the page family with about 4,300 indexable URLs.
- **Traffic/performance impact:** 611 player profiles plus 3,666 section URLs all share this path. During a Replit outage it adds up to 20 s to every player-page request.
- **Recommended fix:**
  - Negative-cache failures.
  - Keep a long-lived backup of the roster.
  - Lower the front-end timeout, or read the roster only in admin and cron paths and store the heading in post meta at build time.

## 4. The API rebuilds page data (including Postgres queries) on every request, before checking its cache; a 304 costs as much as a 200

- **Severity:** HIGH. **Status:** CONFIRMED.
- **Problem:**
  - `renderPlayerFragment()` runs `ensureFreshness()` and `getPlayerPageData()` (3 queries), and only then checks `fragmentCache`.
  - `renderPlayerAppPage()` builds the data a second time.
  - The matchup page calls `getMatchupData()` twice. Each call covers 2 teams' news plus an uncached `getFpaTable`, which adds up to 10 queries per view.
  - The ETag and 304 decision comes after all of that work.
- **Evidence:**
  - `API/lib/player-ssr.ts:90-99` (data before cache) and `:170` (second build).
  - `API/routes/player.ts:451-456` and `:648-652`.
  - `API/lib/matchup/matchup-ssr.ts:126-129`.
  - `API/lib/matchup/matchup-data.ts:273` and `:349`.
  - `API/lib/team/team-data.ts:179-186`.
- **SEO impact:** indirect, through TTFB under crawl.
- **Traffic/performance impact:**
  - WordPress transients last 5 minutes, and the site has about 4,900 indexable player, team and matchup URLs.
  - A daily crawl therefore misses almost every time. Each miss is one Replit request and 3 Postgres queries for a player, 2 for a team, or 5 for a matchup embed.
  - Two of the three player queries are the 4,000-row scan in #5.
- **Recommended fix:** compute a cheap version key (data-file mtimes plus freshness sequence plus options) and return from the fragment cache or with a 304 **before** building the page data. Cache `getMatchupData` and `getFpaTable` in memory.

## 5. News lookups for players and teams read up to 4,000 full rows and filter them in JavaScript

- **Severity:** HIGH. **Status:** LIKELY. Confirmed in code; the production row count is a runtime check.
- **Problem:**
  - `listNewsForTeam()` lane 2 runs `SELECT * … WHERE team_abbr IS NULL AND <180-day window> ORDER BY pub_date_ms DESC NULLS LAST, first_seen_at DESC LIMIT 4000`, then works out each row's team in JavaScript.
  - The player path uses the same scan even though it needs 8 items.
  - The index is on `pub_date_ms DESC` (NULLS FIRST), so the planner always adds a Sort node.
  - The player search, `listNews({search})`, is a three-column `ILIKE '%name%'` with no trigram index.
- **Evidence:**
  - `API/lib/news-query.ts:43` (`TEAM_WINDOW_DAYS = 180`), `:54` (`TEAM_SCAN_MAX = 4000`), `:239-251`, `:113-123`.
  - `API/lib/player/player-data.ts:445-448` and `:471`.
  - Schema index: `lib/db/src/schema/news.ts:102-109`.
- **SEO impact:** the player News tab can be starved. A common surname fills the 60 ILIKE slots, and the exact-match filter then discards them.
- **Traffic/performance impact:**
  - At the cap, one scan moves about 2.5–6 MB from Postgres.
  - The scan runs once per player embed, twice per player app page, once per team embed, and four times per matchup app page.
  - This is the largest per-request database cost in the repo.
- **Recommended fix:**
  - Store the team on each row at ingest (the code already resolves it).
  - Query `team_abbr = X` using the existing `(team_abbr, pub_date_ms)` index.
  - Match players on a normalised `player_key` column, not with ILIKE.

## 6. A failed Sleeper roster fetch (14.6 MB) is retried on every page request, and page requests block on it

- **Severity:** HIGH. **Status:** CONFIRMED.
- **Problem:**
  - `ensureTeams()` is awaited by news SSR, player, team and matchup renders, and ingest.
  - When the copy is older than 12 hours, the request waits for a 14.6 MB download (30 s timeout). It does not serve stale data while refreshing.
  - On failure, `fetchedAt` is not advanced and there is no backoff, so every later request starts a new fetch. `inFlight` serializes them, but each one still waits.
- **Evidence:** `API/lib/teams.ts:43`, `:143-145`, `:183-208`. Callers: `API/lib/player/player-data.ts:928`, `API/lib/team/team-data.ts:174`, `API/lib/ssr.ts:91`, `API/routes/news.ts:782`.
- **SEO impact:** WordPress timeouts are 6–8 s, so during a Sleeper outage every uncached player, team or matchup fragment fails. WordPress then falls back to backups (see #2).
- **Traffic/performance impact:**
  - Third party: roughly one 14.6 MB Sleeper request per origin request while Sleeper is failing.
  - Replit: CPU and memory spikes from `JSON.parse` of 14.6 MB.
- **Recommended fix:** serve stale data while revalidating in the background, and back off exponentially after a failure.

## 7. The schedule's live ESPN and nflverse calls are triggered by visitors and fan out

- **Severity:** HIGH. **Status:** CONFIRMED in code.
- **Problem:**
  - **Per-season cache keys from user input.** `getSchedule(season)` keys its cache on a season the visitor supplies: `?season=1999..2100` on `/schedule*`, `/embed/schedule`, the CSV and the ICS routes.
  - **Each real season costs a full download plus 18 ESPN calls.** Every distinct real season downloads the whole nflverse `games.csv` (6-hour TTL) and makes **18 ESPN scoreboard calls** (a full refresh).
  - **Empty seasons retry every minute.** A season with no games throws, and the error backoff is only 60 s. The next request after that downloads the CSV again.
  - **`loadEspn()` has no in-flight dedupe.** Concurrent requests after expiry each run their own sweep, and during live games the TTL is 30 s.
  - **Blocked ESPN means repeated full sweeps.** If every week fails, `fullRefreshAt` stays 0, so every 15-minute expiry repeats the full 18-call sweep: about 1,728 calls/day while ESPN is blocked, which is a known condition from Replit.
  - **The season spreads across the link graph.** `carriedQuery` copies `season` into every week link.
- **Evidence:**
  - `API/routes/schedule.ts:46-51` (season parse) and `:88-103` (`carriedQuery`).
  - `API/lib/schedule/schedule-data.ts:395-420` (`loadEspn`, `Promise.all` over 18 weeks) and `:399-418` (the slate cache).
  - `API/lib/team/cache.ts:87` (60 s error backoff).
- **SEO impact:**
  - statchasers.com is not exposed: the WordPress shortcode takes `season` only from an attribute and reads no `$_GET` (`WP/statchasers-schedule.php`).
  - The app host serves `?season=2099` as a 200 empty shell, a soft 404, but it is noindex.
- **Traffic/performance impact:**
  - A crawl of `?season=1999..2026` on the app host costs 28 CSV downloads plus 504 ESPN calls every 6 hours.
  - Invalid seasons cost up to one CSV download per minute each.
- **Recommended fix:**
  - Whitelist `season` to the current season plus the seasons actually present, and return 404 otherwise.
  - Add in-flight dedupe to `loadEspn`.
  - After a total ESPN failure, back off instead of repeating the full sweep.
  - Stop carrying `season` into links.

## 8. News ingest invalidates every cache even when nothing is new, and rewrites about 90,000 rows a day

- **Severity:** HIGH. **Status:** CONFIRMED (code plus production status).
- **Problem:**
  - `storeItems()` issues a per-row `UPDATE … lastSeenAt` for every re-seen item and increments `updated`.
  - `if (inserted > 0 || updated > 0)` then invalidates freshness and the render cache.
  - The wire always returns about 25 known items (every 10 minutes), and the club sweep re-sees about 1,790 (every 30 minutes). The news ETag and the 250-item render therefore reset constantly, contradicting the comment directly above the check.
- **Evidence:**
  - `API/routes/news.ts:711-727` (the per-row UPDATE loop).
  - `:764-771`, where the comment says "An ingest that re-sees the same items … must not move the 'Last updated' date" and the code does the opposite.
  - Production `/api/status`: wire `{"inserted":4,"updated":21}`, clubs `{"inserted":7,"updated":1783}`.
- **SEO impact:** "Last updated" and freshness signals move without any content change.
- **Traffic/performance impact:**
  - Replit: about 1,790 single-row UPDATEs per club sweep, about 86k per day, which bloats tables and churns autovacuum.
  - It also defeats the 304s and the render cache for `/` and `/embed/ssr`, forcing re-renders of about 300 KB.
- **Recommended fix:** count only rows whose content fields changed. Update `lastSeenAt` in one set-based statement, or not at all.

## 9. `?season=` on the WordPress player-stats page is an unbounded transient key and origin fetch

- **Severity:** HIGH. **Status:** CONFIRMED.
- **Problem:**
  - `statchasers_player_stats_query_season()` accepts any `^\d{4}$` value.
  - The value goes into the transient key and is forwarded to the API. The API falls back to the newest season and returns 200.
  - WordPress then stores the result as a 1-hour transient **plus a 30-day backup**.
- **Evidence:** `WP/statchasers-player-stats.php:216-224` (validation), `:282-284` (key), `:292-294` (forwarded), `:324-325` (TTLs).
- **SEO impact:**
  - Low. The canonical strips the parameter, and the season links on the page are `rel=nofollow` (`API/lib/player-stats-render.ts:261`).
  - The title and H1 show the requested season while the canonical points to the bare URL.
- **Traffic/performance impact:**
  - About 10,000 values × 4 position URLs × 2 transients per value. Each is a full HTML table stored in `wp_options`, and each new value forces a blocking origin fetch with an 8 s timeout.
  - This is the only WordPress URL parameter that is not whitelisted.
- **Recommended fix:** whitelist the season to the seasons the API actually has (in the fragment's `data-seasons`), or clamp it to 1999..current.

## 10. The schedule week query var hijacks any WordPress URL's title and canonical

- **Severity:** MEDIUM, listed in the top 10 for SEO reach. **Status:** CONFIRMED.
- **Problem:**
  - `sc_sched_week` is a public query var.
  - `statchasers_schedule_request_week()` reads it without checking that the request is for the schedule page.
  - The Rank Math title, description, canonical and og:url filters, and the 404 hook, therefore run on **any** URL.
  - Rankings and player stats had this same bug and were fixed.
- **Evidence:**
  - `WP/statchasers-schedule.php:116-121` (public query var) and `:153-171` (no page check).
  - `:180-192` (404 on any request that carries the var) and `:772-801` (filters).
  - Compare the fixed versions: `WP/statchasers-rankings.php:260-263` and `WP/statchasers-player-stats.php:177-180`.
- **SEO impact:**
  - `/any-article/?sc_sched_week=7` gets the title "…: Week 7" and a canonical of `/nfl/nfl-schedule/week-7/`.
  - `?sc_sched_week=99` turns any page into a 404.
  - Exposure needs someone to link such URLs, but it is a canonical-hijack surface on every WordPress URL.
- **Traffic/performance impact:** none.
- **Recommended fix:** scope the function to the schedule page, as rankings does.

---

# Project Architecture

```
Browser / Googlebot
   │  GET https://statchasers.com/nfl/players/josh-allen/stats/
   ▼
Cloudflare (statchasers.com) ── edge cache behaviour: REQUIRES RUNTIME VERIFICATION
   ▼
Bluehost ─ WordPress + Divi + Rank Math
   │  rewrite: ^nfl/players/([^/]+)/(stats|…)/?$ → pagename=…&sc_section=stats   (WP/statchasers-player.php:1158-1176)
   │  template_redirect: legacy/old-slug/overview 301s                           (WP/statchasers-player-pages.php:599,820; WP/statchasers-player.php:1218)
   │  wp_head → Rank Math filters (title/desc/canonical/robots/json_ld/breadcrumb)
   │        └─ statchasers_player_page_html() → statchasers_player_fetch()      ← fetch #1 (warms the transient)
   │  the_title filter → statchasers_player_heading() → statchasers_player_roster()  ← /embed/players.json, 6 h, 20 s timeout
   │  the_content → [statchasers_player] → statchasers_player_fetch()           ← transient hit (same key)
   │        transient sc_player_ssr_<md5> 5 min + sc_player_ssr_bak_<md5> 24 h (wp_options)
   ▼  wp_remote_get https://newsfeed.replit.app/embed/player/josh-allen?section=stats&format=ppr&h1=…
Replit Reserved VM (GCE, Google Front End, no CDN, no compression)
   │  Express: API/app.ts → routes/player.ts:590 → lib/player-ssr.ts renderPlayerFragment
   │     ensureFreshness()          → Postgres count/max (≤1/60 s)
   │     ensureTeams()              → Sleeper /v1/players/nfl 14.6 MB (12 h; blocks when stale)
   │     getPlayerPageData()        → committed JSON (data/player/*, ~32 MB, loaded once)
   │                                → Postgres listNews ILIKE (1) + listNewsForTeam (2, ≤4,000 rows)
   │                                → ESPN team schedule (6 h SWR) · FPA table (10 min)
   │     fragmentCache check (after the work above) → HTML ~41–104 KB
   ▼
WordPress prints HTML; strips FAQ/page-data JSON islands into Rank Math's graph.
Browser then loads from newsfeed.replit.app: player.css (203 KB, max-age=0) + dist/statchasers-player.js (25 KB, max-age=0)
Images: sleepercdn.com / static.clubs.nfl.com (direct from browser).
```

**The same pattern for each shortcode**

| Shortcode | WordPress file | API route | API data source | Live third-party on request path |
|---|---|---|---|---|
| `[statchasers_news]` | WP/statchasers-news.php:410 | `/embed/ssr` | Postgres `news_items` (listNews 250) | Sleeper roster (12 h) |
| `[statchasers_team]` | WP/statchasers-team.php:1064 | `/embed/team/:slug` | Postgres news + ESPN (profile, schedule, snapshot, byteam) + Sleeper state | ESPN (3–6 h SWR), Sleeper |
| `[statchasers_player]` | WP/statchasers-player.php:837 | `/embed/player/:slug` | JSON + Postgres news + ESPN schedule | Sleeper roster, ESPN (cached) |
| `[statchasers_fpa]` | WP/statchasers-fpa.php:443 | `/embed/fpa` | Postgres `fpa_snapshots` | nflverse (lazy ingest, #1) |
| `[statchasers_rankings]` / ROS | WP/statchasers-rankings.php:851-852 | `/embed/rankings` | CSV on disk | none |
| `[statchasers_schedule]` | WP/statchasers-schedule.php:604 | `/embed/schedule` | nflverse games.csv + ESPN scoreboard | **yes** (#7) |
| `[statchasers_player_stats]` | WP/statchasers-player-stats.php:544 | `/embed/player-stats` | JSON on disk | none |
| `[statchasers_rb_handcuffs]` | WP/statchasers-rb-handcuffs.php:327 | `/embed/rb-handcuffs` | JSON on disk | none |
| `[statchasers_matchup]` (extra) | WP/statchasers-matchup.php:360 | `/embed/matchup/:pair` | 2 × team data + FPA + ESPN (12 schedule docs, boxscore) | ESPN (cached) |
| `[statchasers_depth_charts]`, `[statchasers_nfl_hub]` | DC/includes/class-scdc-shortcode.php:37, class-scdc-hub.php:35 | none (static JSON in uploads) | ESPN, FantasyPros, Footballguys (manual admin refresh only) | none |

**Background jobs on the Replit app**

These are in `API/index.ts`. Production runs them, and so does **the dev workspace** whenever it is running, which doubles the volume.

| Job | Location | What it does | Frequency |
|---|---|---|---|
| Wire ingest | `API/index.ts:38-46` | Fetches `dynasty-command.replit.app`, falling back to `api.statchasers.com`, at `/api/news/nfl` | every 10 min |
| Club RSS sweep | `API/index.ts:70-71` | Fetches all 32 club sites | every 30 min, 6 concurrent |
| X poller | `API/lib/x/scheduler.ts` | Polls X | 30 s tick, **disabled** |
| Sleeper roster | `ensureTeams` | Refreshes the roster | 12 h |
| Sleeper state | `API/lib/team/nfl-state.ts` | Refreshes league state | 30 min |

WordPress has **no WP-cron** anywhere (grep for `wp_schedule` finds nothing).

---

# Shortcode Audit

"Requests" means origin requests per page view. Warm is a transient hit, cold is a transient miss, and outage is the API down with a backup present. All fetchers use `md5(origin|args)` keys, 5-minute to 1-hour fresh TTLs, and backups of 24 hours to 30 days.

| Shortcode | Function | Requests (warm / cold / outage) | Queries per origin hit | Cache (WP fresh / backup) | SEO risk | Traffic risk |
|---|---|---|---|---|---|---|
| statchasers_news | `statchasers_news_shortcode` → `statchasers_news_fetch` (news.php:162-226) | 0 / 1 / **1 every view, 5 s** (no negative cache) | listNews(250) on a render-cache miss; the render cache is reset by #8 | 5 min / 24 h | LOW. Rank Math owns the metadata; H1 comes from the WP page | MEDIUM. The client polls `/api/news` every 2 min against the origin directly (see News) |
| statchasers_team | `statchasers_team_shortcode` → `statchasers_team_fetch` (team.php:135) | 0 / 1 / 2 × 8 s | 2 (listNewsForTeam, including the 4,000-row lane) + freshness | 5 min / 24 h | LOW–MED. Section meta is computed locally and robust; soft-404 if the API fails with no backup | MEDIUM. Cold ESPN fanout of 5–13 per team per 3–6 h |
| statchasers_player | `statchasers_player_shortcode` → `statchasers_player_fetch` (player.php:254) + roster (player-pages.php:98) | 0 / 1–2 / **2 × 6 s + 20 s roster** | 3 (ILIKE + 2 team lanes) + freshness | 5 min / 24 h; roster 6 h, no backup | MEDIUM. Section meta falls back to the profile's meta on failure | **HIGH** (#2, #3, #4, #5) |
| statchasers_fpa | `statchasers_fpa_shortcode` → `statchasers_fpa_fetch` (fpa.php:190) | 0 / 1 / 2 × 6 s | 1 (getFpaTable, uncached) | 15 min / 7 d | LOW. Six variants, nofollow, canonical is the bare URL | LOW on WP; **CRITICAL** on the app host (#1) |
| statchasers_rankings | `statchasers_rankings_fetch` (rankings.php:550) | 0 / 1 / **ROS 3 × 6 s**, redraft 2 | 0 (disk) | 1 h / 30 d | LOW. Position URLs are self-canonical, in the sitemap, with a 404 on bad positions | MEDIUM in an outage |
| statchasers_schedule | `statchasers_schedule_fetch` (schedule.php:338) | 0 / 1 / 2 × **12 s** | 0 DB; **ESPN plus nflverse** on API cache miss | follows the API's max-age, 30 s–15 min / 7 d | MEDIUM (#10) | MEDIUM–HIGH (#7) |
| statchasers_player_stats | `statchasers_player_stats_fetch` (player-stats.php:296) | 0 / 1 / 2 × 8 s | 0 (disk) | 1 h / 30 d | LOW | **HIGH** (#9) |
| statchasers_rb_handcuffs | `statchasers_rb_handcuffs_fetch` (rb-handcuffs.php:90), memoized | 0 / 1 / 1 | 0 (disk) | 1 h / 30 d | LOW (possible `mainEntity` overwrite, see Schema) | LOW |

**Multiple instances of a shortcode.** Two identical shortcodes on one page share a transient key, so the second one costs nothing extra. Different attributes produce different keys, and the head (Rank Math) fetch uses the page's own attributes. FPA, rankings and player stats document one extra fetch when an attribute is pinned.

**Bots do the same work as people.** No path distinguishes bots from human visitors, and nothing should.

**Server work per view.** On a warm page it is 2–4 `wp_options` reads plus about 40–230 KB of HTML printed. On a cold page, add 1 blocking HTTP call (40–230 KB uncompressed) and 4 `wp_options` writes.

---

# URL Inventory

Counts come from `artifacts/api-server/data/player/indexed_players.json` (643 players, including 32 DEF entries) and `/embed/players.json` (611 players).

| URL family (statchasers.com) | Estimated count | Index? | Sitemap? | Canonical | Raw HTML? | Severity |
|---|---|---|---|---|---|---|
| `/nfl/players/{slug}/` | 611 | yes (stored Rank Math meta) | Rank Math page sitemap | self | yes | – |
| `/nfl/players/{slug}/{stats,game-log,outlook,injury,news,bio}/` | 3,666 | forced `index` | appended to page-sitemap **page 1** (player.php:1524-1561) | self | yes | MEDIUM (lastmod, soft-404 on failure) |
| `/nfl/players/{slug}/overview/` | 611 | 301 to profile | no | – | – | LOW (#redirect loop via `?sc_section=`) |
| `?format=`, `?log=`, `?adv=` on player pages | ~3 × ~29 per URL | canonical drops the query | no | bare | yes | LOW (log links are nofollow; `?adv` ignored by WP) |
| Legacy `/nfl/players/{section}/{slug}/`, `/fantasy-football/players/…` | – | 301 | removed (assets.php:94-112) | – | – | – |
| `/nfl/teams/{slug}/` | 32 | yes | Rank Math | self | yes | – |
| `/nfl/teams/{slug}/{stats,schedule,depth-chart,matchups,news}/` | 160 | forced index | appended (team-pages.php:1629-1666) | self | yes | LOW |
| `/nfl/teams/{slug}/outlook/` | 32 | 301 | no | – | – | – |
| `/nfl/{a}-vs-{b}/` | 496 | forced index (holder page is noindex) | appended, **no lastmod** (matchup.php:633-653) | self | yes | LOW–MED |
| `/nfl/{a}-vs-{b}/{YYYY-week-N}/` | ≈1,360 (5 seasons × 272) and growing | self-canonical | not in sitemap (deliberate) | self | yes | LOW |
| `/nfl/{a}-vs-{b}/{YYYY-wild-card…}/` (postseason, linked by the API) | ≈65 | **no WP rewrite, so likely 404** | no | – | – | MEDIUM (broken internal links) |
| `/nfl/nfl-schedule/` + `/week-{1..18}/` | 19 | yes | 18 appended, no lastmod | self | yes | LOW |
| `/fantasy-football/rest-of-season-rankings/` + `/{qb,rb,wr,te}/` | 5 (+ redraft 1) | yes | 4 appended | self | yes | – |
| `/nfl/nfl-player-stats/` + `/{rb,wr,te}/` | 4 (`/qb/` → 301) | yes | 3 appended | self | yes | – |
| `?season=` on player stats | ~10,000 × 4 | canonical is bare | no | bare | yes | HIGH (#9, load not SEO) |
| FPA, RB handcuffs, news | 1 each | yes | Rank Math | self | yes | – |
| `/nfl/nfl-depth-charts/` + `/fantasy/` + 32 teams | 34 indexable; 952 valid routes canonicalise to 33 | yes | own sitemap (33) + Rank Math page | `/fantasy/`, team | **table is JS-only** | MEDIUM (duplicate main, JS content) |
| `/nfl/` hub links to `/nfl/rankings/`, `/nfl/waiver-wire/`, etc. | 6 | – | – | – | – | MEDIUM (LIKELY 404s) |

**Totals**

- **Intended indexable URLs:** about 5,030 in sitemaps, plus about 1,400 dated matchup games that are discovered through links.
- **Unintended crawlable URLs on statchasers.com:**
  - bounded parameter variants (`?format`, `?log`, `?adv`, `?utm…`), all canonicalised;
  - `?season=` on player stats (unbounded);
  - `?sc_sched_week=` and `?sc_section=` on any URL (unbounded, but only if linked);
  - 952 depth-chart route variants (canonicalised).
- **App host `newsfeed.replit.app` (all noindex but crawlable; `robots.txt` is `Allow: /`):**
  - 4,389 dictionary players × 7 sections ≈ 30,700 URLs, plus case and trailing-slash variants that each self-canonicalise;
  - `?season=1999..2100` on the FPA, schedule, rankings and player-stats routes.

---

# Request Inventory

Every outbound HTTP call. Severity reflects frequency × fanout.

| File | Function | Endpoint | Trigger | Frequency | Cache | Fanout | Sev |
|---|---|---|---|---|---|---|---|
| WP/statchasers-player.php:254 | statchasers_player_fetch | origin `/embed/player/{slug}` | page view (head + body) | per transient miss | 5 min / 24 h | 1 (2 in outage) | HIGH |
| WP/statchasers-player-pages.php:98 | statchasers_player_roster | origin `/embed/players.json` | `the_title` on every player page | per 6 h, **every view on failure** | 6 h, no backup | 1 × 20 s | HIGH |
| WP/statchasers-team.php:135 | statchasers_team_fetch | `/embed/team/{slug}` | page view | per miss | 5 min / 24 h | 1–2 | MED |
| WP/statchasers-matchup.php:271 | statchasers_matchup_fetch | `/embed/matchup/{pair}` | template_redirect + 3 meta filters + body | per miss | 5 min / 24 h | 1 (4–6 in outage) | MED |
| WP/statchasers-news.php:196 | statchasers_news_fetch | `/embed/ssr` | body | per miss | 5 min / 24 h, no negative cache | 1 | MED |
| WP/statchasers-news.php:246 | statchasers_news_asset_version | `/embed/assets.json` | enqueue on every tool page | 1 per 15 min | failures cached | 1 | LOW |
| WP/statchasers-fpa.php:190 | statchasers_fpa_fetch | `/embed/fpa` | json_ld + body | per miss | 15 min / 7 d | 1–2 | LOW |
| WP/statchasers-rankings.php:550 | statchasers_rankings_fetch | `/embed/rankings` | title + json_ld + body | per miss | 1 h / 30 d | 1–3 | MED |
| WP/statchasers-schedule.php:338 | statchasers_schedule_fetch | `/embed/schedule` | json_ld + body | per miss | 30 s–15 min / 7 d | 1–2 | MED |
| WP/statchasers-player-stats.php:296 | statchasers_player_stats_fetch | `/embed/player-stats` | title + body | per miss | 1 h / 30 d | 1–2; key unbounded | HIGH |
| WP/statchasers-rb-handcuffs.php:90 | statchasers_rb_handcuffs_fetch | `/embed/rb-handcuffs` | body (memoised) | per miss | 1 h / 30 d | 1 | LOW |
| WP/statchasers-h1.php:355 | statchasers_h1_measure | own site (loopback) | admin button only | manual | option | 3 | – |
| DC/includes/class-scdc-espn.php:77 | fetch_team | ESPN depthcharts | admin refresh | manual | JSON file | 32 sequential | LOW |
| DC/includes/class-scdc-fantasypros.php:61 | fetch_team | fantasypros.com | admin refresh | manual | JSON file | 32 sequential | LOW |
| DC/includes/class-scdc-footballguys.php:45 | fetch_all | footballguys.com | admin refresh | manual | JSON file | 1 | LOW |
| API/routes/news.ts:421 | fetchFeedFrom | dynasty-command.replit.app → api.statchasers.com | 10-min timer + traffic | ~144/day/instance | DB | 1–2 | LOW |
| API/lib/club-news.ts:32 | fetchClub | www.{club}.com/rss/news × 32 | 30-min timer | ~1,570/day/instance | none, **no conditional GET** | 32 | MED |
| API/lib/teams.ts:143 | fetchTeams | api.sleeper.app/v1/players/nfl (14.6 MB) | awaited by page renders | 2/day; **per request on failure** | 12 h | 1 | HIGH |
| API/lib/team/nfl-state.ts:25 | nflState | api.sleeper.app/v1/state/nfl | team, matchup | 30 min SWR | – | 1 | LOW |
| API/lib/team/schedule.ts:293 | getTeamSchedule | ESPN teams/{id}/schedule | team, player, matchup | 6 h SWR per team:season:type | – | matchup 12 docs | MED |
| API/lib/team/profile.ts:89-116 | profile / loadCoach | ESPN team + sports.core coaches `$ref` | team | 3 h SWR | – | 3 (2 sequential hops) | LOW |
| API/lib/team/snapshot.ts:137 | getTeamSnapshot | sports.core statistics | team | 6 h SWR | – | 1–2 | LOW |
| API/lib/team/stats.ts:825 | getTeamStats | site.web byteam (~370 KB) | team | 6 h SWR per season; **completed seasons re-fetched too** | – | up to 6, sequential chain up to 30 s | MED |
| API/lib/matchup/boxscore.ts:218 | getGameBoxscore | ESPN summary | final-game matchup | 12 h | – | 1 | LOW |
| API/lib/schedule/schedule-data.ts (loadEspn) | fetchEspnWeek | ESPN scoreboard × week | visitor request | 30 s (live) / 15 min / 6 h; **no dedupe** | per season | **18** | HIGH |
| API/lib/schedule/schedule-data.ts (slate) | games.csv | raw.githubusercontent nflverse | visitor request, key = user season | 6 h; 60 s on error | per season | 1 × ~2 MB | HIGH |
| API/lib/fpa/nflverse.ts:243 | fetchScoredWeeklyStats | GitHub releases CSV | guarded POST **or anonymous GET (#1)** | unbounded | none, **no timeout** | 2–4 | CRITICAL |
| API/lib/summarize.ts | summarize | Anthropic API | during ingest, if key set | ≤25 per ingest | DB | 3 concurrent | LOW |
| API/client/main.ts:34,717 | refresh | origin `/api/news` | browser, every 2 min + every tab refocus | per visible tab | **no Cache-Control** | 1 | MED |
| Browser (all WP tool pages) | enqueue | origin CSS + JS (`max-age=0`) | every WP page view | per view | revalidated every view | 2 per tool | MED |

---

# Googlebot Cost

Assumptions:
- Page views are transient misses. With 5-minute transients and about 4,900 URLs, a crawl at ≤10k/day misses more than 95% of the time.
- Bluehost's page cache is unknown. If a full-page cache is active, divide the WordPress and origin numbers accordingly (REQUIRES RUNTIME VERIFICATION).
- Google's renderer fetches CSS and JS from the Replit origin, but caches them aggressively, so they are shown as roughly 0–2 per page.

**One Google player-page crawl, API healthy:**

→ 1 Bluehost PHP request
→ about 4 transient reads plus **4 `wp_options` writes** (about 100–200 KB stored: fresh plus backup), plus Rank Math's own queries (not measured)
→ **1 Replit request** (`/embed/player/{slug}`, about 41–104 KB, uncompressed)
→ **3 Postgres queries** (1 leading-wildcard ILIKE; 2 news lanes, one of which reads up to 4,000 full rows) plus a freshness query at most once per 60 s
→ **0 api.statchasers.com calls**
→ third-party calls: about 0 per crawl, amortised. The roster refreshes every 12 h and ESPN schedules every 6 h per team. They rise to 1 × 14.6 MB Sleeper call per request while Sleeper is failing.
→ 0–2 CSS/JS revalidations against Replit, from rendering

| Crawled URLs/day (player-heavy mix) | Bluehost requests | wp_options writes | Replit requests | Postgres queries | api.statchasers.com | Third-party (healthy / degraded) |
|---|---|---|---|---|---|---|
| 100 | 100 | ~400 (~15 MB) | ~100 | ~300 (≈200 of them 4,000-row scans) | 0 | ~0 / up to 100 Sleeper × 14.6 MB |
| 1,000 | 1,000 | ~4,000 (~150 MB) | ~1,000 | ~3,000 | 0 | ~0–40 (ESPN SWR) / up to 1,000 |
| 10,000 | 10,000 | ~40,000 (**transient table grows by hundreds of MB**; the agent estimate for one full player crawl is ~480 MB) | ~10,000 | ~30,000 | 0 | ~50–200 / up to 10,000 |

**Other page types, per origin hit:**
- Team: 2 queries. Cold ESPN costs 11–13 calls for the first team and 5–6 for each later team, once per 3–6 h.
- Matchup embed: 5 queries. A cold matchup is about 25–31 ESPN calls, once per 6–12 h per pair.

**During a Replit outage:**
- Replit requests do not drop. They **multiply by 2–4** (#2).
- Every Bluehost worker is held 12–32 s per player, team or matchup view.
- At 1,000 crawls per day, that is roughly 3–9 worker-hours of blocking on shared hosting, before any human traffic.

---

# Highest Request Multipliers

1. **Anonymous FPA re-ingest.** One GET leads to 2–4 GitHub downloads (~7 MB each), a DELETE, 7,269 INSERTs and 5 cache flushes. It can be repeated back to back (`API/lib/fpa-ssr.ts:66-114`).
2. **Schedule `?season=` × 18 ESPN calls.** 28 real seasons × (1 CSV + 18 ESPN) = 532 calls per 6 h. Invalid seasons cost 1 CSV download per minute each (`schedule-data.ts`).
3. **Outage re-fetch loop on WordPress.** Every view × (1–6 fetches per view) × (6–20 s blocking), for as long as the 24-hour to 30-day backups exist (#2, #3).
4. **Club RSS sweep.** 32 feeds × 48 per day × 2 instances (prod plus dev) is about 3,100 full downloads a day with no conditional GET. Each sweep also runs about 1,790 single-row UPDATEs (#8).
5. **Blocked-ESPN full sweep.** 18 calls every 15 minutes is about 1,728 per day, and higher with concurrent misses because there is no in-flight dedupe.
6. **Sleeper roster failure.** 1 × 14.6 MB per page request on player, team, matchup and news renders (`teams.ts:183-208`).
7. **4,000-row news scan per render.** Once per player embed, twice per player app page, once per team, and four times per matchup app page (`news-query.ts:245-251`).
8. **Matchup data built twice per app view.** 10 queries plus 2 × 2 team-data builds (`matchup-ssr.ts:126-129`).
9. **Cold matchup ESPN fanout.** 2 teams + 11 history schedules + boxscore + league stats ≈ 25–31 calls (`matchup-data.ts:286-299`, `HISTORY_SEASONS=5` at `:144`).
10. **Player-stats `?season=` key explosion.** About 10k values × 4 URLs × 2 transients, each a forced 8-second origin fetch (#9).

The requested loop-shaped patterns (`foreach $players → API`, `players.map(fetch)`) were checked and **do not exist** on any public request path:
- The WordPress page builder makes 1 roster request per build and no per-player calls (`WP/statchasers-player-pages.php:343-457`).
- League-wide ESPN `byteam` serves all 32 teams from one document.
- The largest per-entity loops are the depth-charts admin refresh (65 sequential calls, admin-only) and the 18-week ESPN sweep.

---

# Player Page Findings

- **Raw HTML is complete (CONFIRMED).**
  - The shortcode prints the SSR fragment.
  - The title, description, canonical, robots (index,follow), H1 and breadcrumb come from Rank Math filters. They are per-player, so there is **no generic-template-title problem**.
  - FAQPage is added to Rank Math's graph, and the JSON islands are stripped (`WP/statchasers-player.php:1047-1112`, `:1369-1471`, `:1492-1511`).
- **URL formats.**
  - One canonical form: `/nfl/players/{slug}/[section/]`.
  - Old slugs, legacy layouts and `/overview/` return 301s.
  - `?section=` has no 301 on WordPress; it renders a single panel with the profile canonical, and the API no longer links it (LOW).
  - Team changes do not create URLs, because the slug is team-free.
- **Invalid slugs return a real 404** on both WordPress (no page, so core 404) and the API (`API/routes/player.ts:440`).
  - The one soft-404 case: the WordPress page exists but the API fails and no backup exists. The page then returns 200 with an empty body and stored index,follow metadata (`WP/statchasers-player.php:804-816`).
  - WordPress pages are never deleted when a player leaves the index.
- **Section metadata depends on the fetch (MEDIUM, CONFIRMED).**
  - If `statchasers_player_request_meta()` returns null, all six section URLs print the profile's stored title and description, while keeping self-canonical and forced `index`.
- **H1 year (LOW, CONFIRMED).**
  - `STATCHASERS_TEAM_SEASON='2026'` is baked into section H1s (`WP/statchasers-player-pages.php:861-865`).
  - `?log=2024` renders 2024 data under "Game Log 2026".
- **`in_the_loop()` guard (MEDIUM, REQUIRES RUNTIME VERIFICATION).**
  - The player and matchup H1 filters require it (`WP/statchasers-player-pages.php:883`, `WP/statchasers-matchup.php:409`).
  - The team filter deliberately dropped it because Divi Theme Builder prints titles outside the loop (`WP/statchasers-team-pages.php:1377-1381`).
- **`?adv=` season switcher is broken on WordPress (MEDIUM functional, CONFIRMED).**
  - WordPress never forwards `adv`, so the chips do nothing.
  - Each click is a full WordPress page render, because the client refetches the whole page URL (`API/client/player.ts:1071-1095`).
- **30 KB `data-scp-roster` JSON is shipped in every player page (MEDIUM for Core Web Vitals, LIKELY).**
  - The WordPress stripper removes only the FAQ and page-data islands (`WP/statchasers-player.php:1107`).
- **Per-page cost.** 1 Bluehost request, 1 Replit request, and 3 Postgres queries. It is 2 Replit fetches plus a 20-second roster attempt during an outage. See Googlebot Cost for the extrapolation to the full library (~4,300 URLs → ~4,300 origin calls and ~13k queries per full crawl).
- **Redirect loop (LOW, CONFIRMED).** `/nfl/players/x/?sc_section=overview` 301s to itself forever, because `sc_section` is a public query var and the query string is carried over (`WP/statchasers-player.php:1199-1218`). The same happens with `?sc_section=outlook` on teams (`WP/statchasers-team-pages.php:1171-1192`).
- **Sitemap junk (LOW–MED, POSSIBLE).**
  - `statchasers_player_sitemap_sections` appends 6 section URLs for **every** child of `/nfl/players/`, with no shortcode check (`WP/statchasers-player.php:1534-1557`).
  - Legacy section containers such as `/nfl/players/outlook/` would emit junk like `/nfl/players/outlook/stats/`.
  - Verify with `wp post list --post_parent=<players container>`.

# Team Page Findings

- **One canonical per team, with sections as rewrites.** The API 301s `kc`, `KC` and `chiefs` to the full slug.
  - WordPress has **no alias redirect**. `/nfl/teams/kc/` goes to core's `redirect_guess_404_permalink` (REQUIRES RUNTIME VERIFICATION).
  - The README claims `/nfl/phi-vs-ne/` 301s on WordPress; the code 404s it (LOW, doc mismatch).
- **Metadata.**
  - Hub meta is stored at build time.
  - Section meta is computed locally from `STATCHASERS_TEAM_SEASON`, so it survives API failure.
  - The schedule section adds an ItemList of SportsEvent.
- **Fanout.**
  - A team embed is one origin request.
  - On the origin: 2 news queries, plus cold ESPN calls. Those are 11–13 for the first team and 5–6 for later teams, under 3–6 h SWR.
  - The stats chain is sequential (current, then fallback, then 4 history seasons), with up to about 30 s cold (`API/lib/team/stats.ts:906-923`), which exceeds WordPress's 8 s timeout.
  - **Completed-season documents are re-fetched every 6 hours** even though they are immutable.
- **Stale-and-failing ESPN is retried on every request (MEDIUM, CONFIRMED).** `createKeyedCache.ensure` backs off only when the value is null (`API/lib/team/cache.ts:99-139`). A stale value with a failing refresh therefore costs one ESPN attempt per request per key, and a team page touches about 10 keys.
- **Depth-chart overlap (LOW, POSSIBLE cannibalisation).**
  - `/nfl/teams/{slug}/depth-chart/` (160-section family) and `/nfl/nfl-depth-charts/fantasy/{slug}/` (depth-charts plugin) both target "{Team} depth chart", both are indexable, and both are in sitemaps.
- **Team build flush.** `statchasers_team_build_pages` calls `statchasers_news_flush()`, which deletes **all** caches and backups. That creates a cold herd on the next crawl and removes the outage fallback (`WP/statchasers-team-pages.php:345-348`, `WP/statchasers-news.php:651-673`).

# FPA Findings

- **WordPress side is safe.**
  - `?format` and `?view` are whitelisted: 6 combinations, nofollow links, and a bare canonical (`WP/statchasers-fpa.php:82-93`).
  - `season` is taken only from the shortcode attribute.
  - The FAQ is added to the Rank Math graph.
- **The FPA table is not calculated live.** It is precomputed into `fpa_snapshots` by ingest. Each view runs a small indexed query with no in-memory cache (`API/lib/fpa/fpa-data.ts:101`, MEDIUM-LOW).
- **#1 is the only critical issue in the repo.**
- **The app host's `/fpa?season=2025` is an empty 200.** It also exposes a developer instruction ("Run `pnpm … ingest-fpa`") on a noindex page (LOW). `/embed/fpa` returns 404 for the same input, so the two routes are inconsistent.
- **Freshness depends on a manual or external trigger.** Before today's manual refresh, production sat at week 2. No scheduled deployment exists: the previous `/api/status` showed `lastAttempt: null`.
- **Season is hardcoded.** `FPA_CURRENT_SEASON ?? 2026` and `FPA_BASELINE_SEASON ?? 2025` (`fpa-data.ts:95-97`, `ingest.ts:51-55`). Rollover is manual.

# Rankings Findings

- Data comes from CSV on disk, memoised by mtime, with **no third-party calls and no DB** on any path.
  - The fragment is the complete board. Position tabs on the ROS board are separate URLs (`/qb|rb|wr|te/`), each with its own fetch and key; there are 5 keys in total.
- WordPress URLs: `^fantasy-football/rest-of-season-rankings/(qb|rb|wr|te)/?$`.
  - These are self-canonical, carry their own titles, and are in the sitemap.
  - Uppercase and other spellings get a real 404.
  - This is **done well**.
- **Triple fetch in an outage (HIGH, part of #2).** `page_copy()` is called from the title filter, `page_html()` from json_ld, and the shortcode fetches again: three separate callers (`WP/statchasers-rankings.php:337-354`, `:879-899`).
- **App host only (LOW).**
  - `/rankings?season=2099` renders an empty 200 whose title says "Rest of Season" on the redraft URL (`API/lib/rankings-seo.ts:76-82` falls through on null data).
  - `/rankings?pos=` returns 200 duplicates with no 301.
- Rankings pages are about 220 KB, carrying 5 ItemList(Person) blocks, uncompressed.
- Both boards are filed as 2026. The season comes from the newest CSV, so rollover follows the data.

# Schedule Findings

- **WordPress URL space.** The grid plus `/week-1..18/`. `week-19`–`week-99` get a real 404; `week-0` and `week-02` miss the rewrite and get core's 404. No season, team or date URLs exist on WordPress. The team view is served on team hubs.
  - Theoretical WordPress space: **19 URLs**. That is bounded and all intended.
- The rewrite needs a **manual permalink flush**, unlike rankings and player stats, which self-heal (LOW).
- **#10** (unscoped `sc_sched_week`) is the WordPress SEO defect.
- **#7** is the origin and third-party multiplier (app-host `?season=`, no ESPN dedupe, blocked-ESPN sweeps).
- **Rollover gap (HIGH, future, CONFIRMED in code).** Mid-May is when the NFL usually publishes next season's schedule.
  - `seasonYear()` flips to the new year on March 1 (`API/lib/seo.ts:35-39`).
  - `games.csv` has no new-season games until the schedule release.
  - From March 1 until then, `/embed/schedule` returns **503 no-store**, so WordPress serves its 7-day backup and then an empty 200.
  - `/schedule` renders an empty 200, and every request after the 60 s backoff re-downloads the CSV.
  - `SC_SCHEDULE_SEASON` can pin the season, but nothing reminds anyone to set it.
- **Playoffs are not handled.** `seasontype=2` is hardcoded, and `currentWeek()` returns 18 after the regular season.
- **Per-game calls do not exist.** The scoreboard is fetched per week, not per game.

# Advanced Stats Findings

- **Bulk-loaded** from committed JSON (`data/player-stats`, 7 MB), memoised by mtime. It is not per-player, not per-stat, not from the DB, and involves no third party.
  - Page sizes: `/embed/player-stats?pos=wr` 234 KB; `season=all` 330 KB, uncompressed.
- The API whitelists `season` against files on disk and silently falls back for unknown values. The **WordPress side does not whitelist it** (#9).
- Positions are path URLs `(rb|wr|te)`, and `/qb/` 301s to the bare URL, scoped to the page (fixed).
- Sorting and filtering happen client-side. There are no sort, pagination or min-attempt URL parameters.
- The client season swap fetches `/embed/player-stats`: one request per change, no polling.

# News Findings

- **How news arrives.**
  - A server-side ingest pulls the wire every 10 minutes from `dynasty-command.replit.app`, falling back to `api.statchasers.com`.
  - Club RSS feeds are swept every 30 minutes.
  - Everything is stored in Postgres (5,436 items in production).
- **Page views never trigger third-party collection.** The exception is the traffic-triggered `refreshIfStale`, which is gap-limited to one per 10 minutes and deduped.
- **The shortcode queries once.** `listNews(250)`, rendered once and cached. There are no per-story requests.
- **Client polling (MEDIUM, CONFIRMED).**
  - `main.ts` polls `/api/news?limit=N` **every 2 minutes while visible** (`API/client/main.ts:34`, `:717-719`), and **on every `visibilitychange` to visible, with no throttle** (`:533-535`).
  - Hidden tabs do not poll.
  - The polls go **directly to newsfeed.replit.app**, not through WordPress.
  - `/api/news` sends **no Cache-Control**, so every poll is a DB query returning 43–63 KB uncompressed.
- **Cache churn (#8).**
- **`search=`** is an unbounded, unescaped `ILIKE` (`API/lib/news-query.ts:41-47`). It is cheap at the current size.
- **The render-cache key includes caller-controlled `page_url` and `heading_text`** in a 32-entry FIFO, so arbitrary variants force re-renders (LOW, `API/lib/ssr.ts:37-52`).
- **No negative cache on WordPress** (part of #2).

# Handcuff Findings

- Data is computed from disk JSON, cached by the mtime and size of every input. There is no DB and no third party.
  - Data is refreshed weekly by `scripts/rb-handcuffs/refresh.mjs` and `buildStats.mjs` (Ourlads, Sleeper and nflverse), **offline**.
- There is one WordPress key, memoised per request, and it is **the model the other fetchers should copy**.
- **Overlap.** Its depth data (Ourlads) and the depth-charts plugin (ESPN, FantasyPros, Footballguys) and the team hub's depth-chart section (ESPN) are **three independent depth-chart pipelines**. They are not fetched per request, so there is no load cost, but they can disagree. That is a content consistency and ownership decision (OWNER DECISION).
- **Schema (LOW, POSSIBLE).** The CreativeWork filter at priority 99 sets `mainEntity` on the first node whose `@type` contains "Page". FAQPage matches too, so its questions could be overwritten if Rank Math's WebPage node comes later (`WP/statchasers-rb-handcuffs.php:370-397`).
- `BASIS_SEASON = 2026` is hardcoded (`API/lib/rb-handcuffs/handcuffs-data.ts:70`).

---

# Crawler Traps

| URL pattern | Potential combos | How discovered | Index status | Canonical behaviour | Severity |
|---|---|---|---|---|---|
| statchasers.com `/nfl/nfl-player-stats/[pos/]?season=NNNN` | ~10,000 × 4 | nofollow chips for real seasons only; anything else needs an external link | indexable page, canonical bare | canonical drops the param; **origin fetch plus 2 transients per value** | HIGH (load) |
| statchasers.com `any-url/?sc_sched_week=N` | every URL × 18 (+ 404 variants) | only if linked | retitled, canonicalised to the schedule week | hijacks the canonical | MEDIUM |
| statchasers.com `/nfl/players/x/?sc_section=overview`, `/nfl/teams/x/?sc_section=outlook` | 611 + 32 | only if linked | – | **infinite 301 loop** | LOW |
| statchasers.com player `?format×?log×?adv` | 3 × ~29 × ~4 per URL | nofollow chips (`log`, `adv`); `format` is not a link | index page, canonical bare | fine; transient keys bounded by whitelists | LOW |
| statchasers.com depth-chart `{view}/{team}/{pos}` | 952 | 32 team links + 5 "popular views"; tabs are buttons | indexable, canonicalised to 33 | 5 popular-view links point at non-canonical URLs | LOW |
| statchasers.com matchup game pages | ~1,400 and growing | links from pair and team pages | self-canonical, not in sitemap | – | LOW (intended), plus about 65 postseason links that likely 404 |
| newsfeed.replit.app `?season=1999..2100` on /fpa, /schedule, /rankings, /player-stats | 102 × 4 routes × variants | `carriedQuery` spreads `season` through the schedule's links | noindex | canonical is the path | **CRITICAL (/fpa), HIGH (/schedule)** for load |
| newsfeed.replit.app `/player/{4,389 slugs}/{7 sections}` × case × trailing slash | ~30,700 × 2–4 | the player index links 643; the rest need guessing | noindex | canonical echoes the path, including case and slash | MEDIUM (load: every hit runs 3–6 queries) |

No calendar or date traps exist. No next/previous season links are crawlable on WordPress. There is no search-results URL, and no pagination URL (news pagination is DOM-only).

# Canonical Problems

1. `sc_sched_week` hijack on any URL (#10). MEDIUM, CONFIRMED.
2. **App host:** `canonicalUrl()` echoes `req.path`, so `/player/Lamar-Jackson`, `/team/Kansas-City-Chiefs/`, `/Schedule`, and slash and no-slash variants all self-canonicalise (`API/lib/request.ts:36-37`).
   - The matchup 301 target has a trailing slash, while the no-slash URL's canonical has none.
   - It is noindex, so SEO impact is small. MEDIUM for load.
3. **App host:** `publicOrigin()` trusts `X-Forwarded-Host`. A local test produced `canonical=http://evil.example/schedule` (`API/lib/request.ts:17`). LOW (no shared cache in front).
4. **Depth charts:** the bare `/nfl/nfl-depth-charts/` keeps Rank Math's self-canonical, and `/fantasy/` is also self-canonical. Both are in sitemaps, so they are duplicates. MEDIUM, CONFIRMED (`DC/includes/class-scdc-seo.php` `canonical_for_request`, `DC/includes/class-scdc-sitemap.php:77`).
5. **Depth charts:** `offense/all-teams/wr/` (a "popular view" link) canonicalises to `/fantasy/`, which is a content mismatch. LOW.
6. The **player-stats** `?season=2024` title and H1 say 2024 while the canonical is the bare page, which shows the current season. LOW, by design.
7. **Team fallback WebPage node** (no Rank Math only) uses `get_permalink()`, so on section URLs its `url` is the hub (`WP/statchasers-news.php:459-517`). LOW.
8. `PUBLIC_CANONICAL_URL`, if ever set, would replace **every** canonical with one URL (`API/lib/request.ts:31-32`). It is not set in production (CONFIRMED). This is a hazard to document.

HTTP vs HTTPS, www vs non-www, and multiple canonicals: none found. Rank Math removes core's canonical, and all WordPress canonicals are built from permalinks.

# Duplicate Content Problems

- **Depth chart:** the plugin's main page duplicates `/fantasy/` (CONFIRMED). The plugin's team pages and the team hub's `/depth-chart/` sections compete (POSSIBLE; compare intent, since they are two different templates).
- **Outage duplicates:** player sections temporarily share the profile's title and description when the fetch fails with no backup (CONFIRMED mechanism).
- **App host `newsfeed.replit.app` vs statchasers.com:** every tool exists on both, but the app host is `noindex, indexifembedded` in the header and meta. Not a duplicate-content problem, as long as that header stays.
- **Player index vs players JSON:** not an issue.
- Ranking position pages vs the full board, and schedule week pages vs the grid, have distinct content and titles. **Not cannibalisation.**

# Soft 404 / HTTP Status Problems

| Case | Result | Severity |
|---|---|---|
| WP player, team or tool page exists, API fails, no backup | 200 with an empty shortcode body and index metadata (`WP/statchasers-player.php:804-816`, `WP/statchasers-team.php:1031-1043`, the tool shortcodes) | MEDIUM |
| WP matchup, API unreachable | deliberately 200, robots still forced to index (`WP/statchasers-matchup.php:218-223`) | LOW–MED |
| WP player page for a player who left the index | page persists, and renders as long as the API resolves the slug (the API renders all 4,389 dictionary players) | LOW (REQUIRES RUNTIME VERIFICATION of the retention policy) |
| Postseason matchup links `/nfl/{pair}/{YYYY-wild-card}/` | no WP rewrite, so likely 404 (`WP/statchasers-matchup.php:113` only matches `\d{4}-week-\d{1,2}`; the API emits `-wild-card`, `-divisional`, etc.) | MEDIUM (broken internal links) |
| `[statchasers_nfl_hub]` links `/nfl/rankings/`, `/nfl/waiver-wire/`, `/nfl/injury-report/`, `/nfl/start-sit/`, `/nfl/trade-value/`, `/nfl/news/` | likely 404 (`DC/includes/class-scdc-hub.php:57-122`) | MEDIUM, LIKELY |
| Rolling matchup history: 2021 game URLs drop out when 2027 starts | previously linked URLs start returning 404 | LOW (acceptable if not in the sitemap; they aren't) |
| App-host empty-state 200s: `/fpa?season≠2026`, `/rankings?season=2099`, `/schedule?season=2099` | 200 empty (noindex) | LOW |
| Invalid player, team, section, week or position slug | **real 404** on both layers | done well |

# Sitemap Problems

- **About 4,350 plugin-appended URLs all go to page-sitemap1** (`WP/statchasers-assets.php:83-85`, gated on `sitemap_n <= 1`).
  - Page 1 may carry about 4,500 URLs while later pages carry about 200 each.
  - Valid under the 50k limit, but heavy to generate. Team sections also run 32 `get_posts` calls per request.
  - Whether the hook `rank_math/sitemap/page_content` exists in the installed Rank Math build is **explicitly unverified in the code comments**. REQUIRES RUNTIME VERIFICATION that these URLs actually appear.
- **lastmod does not reflect content.**
  - Player and team section entries reuse the parent page's `post_modified`, and those pages contain only a shortcode, so the date never moves.
  - Matchups, schedule weeks, rankings and stats positions have **no lastmod**.
  - The depth-charts sitemap uses one refresh timestamp for all 33 URLs.
- **Sections are listed regardless of the parent's robots setting** (sections force `index`), and with no shortcode check (possible junk from legacy containers).
- **The depth-charts plugin's bare main page and `/fantasy/`** are both in sitemaps (duplicate).
- **Done well:** 301'd legacy player URLs are removed from the sitemap (`WP/statchasers-assets.php:94-112`), overview and outlook redirects are excluded, and dated matchup games are excluded.

# robots.txt Problems

- **statchasers.com:** not observable from here (403). The depth-charts plugin adds its sitemap to robots.txt only when Rank Math is absent.
- **App host `artifacts/api-server/public/robots.txt`:** `Allow: /`, with only `/api/ingest` disallowed and `/api/news` explicitly allowed.
  - Every page is noindex, but **crawling is invited**, and crawling is exactly what triggers #1, #7 and the per-request costs.
  - Disallowing `/*?season=`, or everything except `/embed.js`, would cut crawl cost with no SEO loss.
  - OWNER DECISION: disallow blocks Google from seeing the noindex tag. That is acceptable here, because the content is canonical on statchasers.com.

# Metadata Problems

- There is no generic-title problem. Titles are per player, per team, per week, per position and per matchup.
- **Section metadata falls back to the profile's metadata when the fetch fails** (player).
- **Hardcoded season `STATCHASERS_TEAM_SEASON='2026'`** (`WP/statchasers-team-pages.php:31`) is used in:
  - player descriptions stored at build (`WP/statchasers-player-pages.php:489`);
  - section H1s and lead text (`:861-865`, `:987-1002`);
  - team section titles and descriptions (`WP/statchasers-team-pages.php:1237`, `:1360`);
  - the matchup fallback season (`WP/statchasers-matchup.php:472`, `:518`).
- **Stored fields are only filled when empty** (`statchasers_team_fill_meta`), so 2026 descriptions persist into 2027.
- The retitle tool recognises only the **old** hub title template (`WP/statchasers-team-pages.php:1679-1688`), so it will treat current titles as custom and skip them.
- The build scripts still write the old template (`scripts/create-team-pages.sh:226`, `scripts/sc-build-pages.php:521`).
- **Four independent season clocks:**
  - the Sleeper state API (team, player and matchup pages);
  - `seasonYear()`, which flips on March 1 (news, schedule and SEO titles);
  - the newest data file (rankings, player stats);
  - `new Date().getUTCFullYear()` in empty states (`API/lib/fpa-seo.ts:32`, `rankings-seo.ts:76`, `schedule-seo.ts:52`).
  - Plus the hardcoded constants `OUTLOOK_SEASON=2026` (`API/lib/player-render.ts:253`), `BASIS_SEASON=2026`, the FPA defaults, and `SCDC_SEASON=2026` (`DC/statchasers-depth-charts.php:29`).
  - From March 2027 these will disagree.
- **Depth-charts titles ("… Depth Chart 2026") need a manual constant bump.**

# Raw HTML / Rendering Problems

| Template | Title / desc / canonical / robots in raw HTML | H1 | Main content in raw HTML | JSON-LD in raw HTML |
|---|---|---|---|---|
| Player (7 URLs each) | yes (Rank Math filters) | yes (filter + optional `h1` mode) | yes (SSR fragment) | yes (FAQPage in Rank Math graph) |
| Team hub and sections | yes | yes | yes | FAQPage; schedule: ItemList of SportsEvent |
| Matchup | yes | yes (loop guard caveat) | yes | none beyond Rank Math |
| FPA, rankings, schedule, stats, handcuffs, news | yes | from the WP page (tools render no H1) | yes | FAQPage and ItemLists into the graph |
| **Depth charts** | yes (team routes) | yes | **no. "Loading depth charts…" and the table is fetched by JS** (`DC/includes/class-scdc-shortcode.php:357`, `DC/assets/js/frontend.js:1395`); only a top-names summary is server-rendered | Rank Math |

**The Divi / Theme Builder H1 interplay is the main thing to check live**, with View Source on one player section URL and one matchup URL.

# Structured Data Problems

- There is one graph (Rank Math), and every tool appends to it through `rank_math/json_ld`. Fallback printers run only when no graph provider exists. There is no SoftwareApplication and no aggregateRating. **Done well.**
- `rb-handcuffs` may overwrite the CreativeWork `mainEntity` (POSSIBLE; see Handcuff Findings).
- The depth charts' `json_ld` at priority 99 rewrites name and url on every page-type node, including any FAQPage (LOW).
- **Matchup has no breadcrumb filter.** All 496 pairs' BreadcrumbList ends at the **noindex holder page** `/nfl/matchup/` (LOW).
- If an editor adds a Rank Math FAQ block on a tool page, there would be a second FAQPage (POSSIBLE).
- The Divi `[sc_team_hub]` placed in a template bypasses `statchasers_team_post_has_shortcode()`, so it emits no FAQ or schedule schema (POSSIBLE).
- The matchup app page has no JSON-LD. SportsEvent would be a natural fit (OWNER DECISION).

# Internal Linking Problems

- **Likely-404 internal links:**
  - about 65 postseason matchup game links;
  - 6 `[statchasers_nfl_hub]` links.
- **Links to non-canonical URLs:**
  - depth-charts "popular views" (5);
  - app host: player season chips link `/player/X/?log=` (slash variant) while the canonical is `/player/X`.
- **Environment-dependent links.** Fragment links become `/player/…?embed=1` on the app host unless the `SC_*_PATH_PREFIX` environment variables are set (`API/routes/player.ts:87-91`, `API/routes/team.ts:163-167`).
  - Production matchup output showed correct `/nfl/teams/` links.
  - REQUIRES RUNTIME VERIFICATION that the player and team prefixes are set in production.
- **nofollow** is used only on season, `adv` and FPA/stats variant chips, which is appropriate.
- **Link density:** the team hub has about 173 links (32 team switcher, 26 matchups, 20 players and sections), and a player page about 42 in production. That is reasonable, and it forms a bounded graph: players ↔ team ↔ matchups ↔ schedule.
- The **invalid HTML nested `<a>`** in the depth-charts hub featured card (`DC/includes/class-scdc-hub.php:202-217`) is LOW.

# Cache Problems

| Dataset | Real change rate | Current cache | Verdict |
|---|---|---|---|
| Player page data (JSON, weekly rebuild) | weekly | WP 5 min, API version-checked but built every request | **WP TTL far too short**; the API should short-circuit before building (#4) |
| Team data | ESPN hours, news minutes | WP 5 min; ESPN 3–6 h SWR | acceptable, except that immutable past seasons are refetched every 6 h |
| Completed games, boxscores, past seasons' byteam | immutable | 6–12 h | should be effectively permanent |
| Schedule | slow, plus live scores | 30 s live / 5 min / 15 min / 6 h; WP follows max-age | good design; needs dedupe and a season whitelist |
| FPA | weekly | WP 15 min; API DB query per request | fine; add an in-memory memo |
| Rankings, stats, handcuffs (disk) | weekly | WP 1 h / 30 d; API mtime memo | good |
| News | minutes | WP 5 min; API render cache reset every ≤10 min for no reason (#8); `/api/news` no Cache-Control | fix the churn; add a short `max-age` |
| Sleeper roster | daily | 12 h, **blocking and no failure backoff** | needs stale-while-revalidate |
| Static CSS/JS (versioned `?ver=`) | per deploy | **`max-age=0`** (`API/app.ts:202`) | should be `immutable`, 1 year |
| WP transients | – | every entry duplicated (fresh + backup); ~480 MB for one full player crawl (LIKELY, measured sizes); no locking; the flush deletes backups | bloat and stampede risk; check for a persistent object cache on Bluehost |

- `getFpaDelta` permanently caches `null` on a DB error (`API/lib/matchup/fpa-delta.ts:146`, `:152`). LOW.
- `matchupTable` has no in-flight dedupe (`API/lib/player/upcoming.ts:100-118`). LOW.
- `loadGameLogs` never re-checks mtime, so the weekly data refresh needs a restart. Consistent with the documented workflow. LOW.

# Database Query Problems

| Query / function | Trigger | Estimated frequency | Cache? | Risk |
|---|---|---|---|---|
| `listNewsForTeam` wire lane, `SELECT * … LIMIT 4000` + JS filter (`API/lib/news-query.ts:245-251`) | every player, team and matchup render | per origin hit; ~1–4× per view | none | **HIGH** |
| `listNews` 3-column `ILIKE '%…%'` (`API/lib/news-query.ts:113-123`) | player render, `/api/news?search=` | per origin hit | none | MEDIUM (no trigram index; starvation) |
| `storeItems` per-row UPDATE loop (`API/routes/news.ts:711-727`) | every ingest and club sweep | ~90k/day per instance | – | **HIGH** (bloat, cache churn) |
| FPA ingest DELETE + 7,269 INSERTs (`API/lib/fpa/ingest.ts:352-360`) | guarded POST **or anonymous GET** | unbounded | – | **CRITICAL** |
| `getFpaTable` (`API/lib/fpa/fpa-data.ts:101`) | FPA, matchup ×2, player upcoming | per request | fragment cache checked after | LOW–MED |
| `ensureFreshness` count/max over `news_items` (`API/lib/freshness.ts:81-89`) | all SSR | ≤1 per 60 s | 60 s, dedupe | LOW; **uncaught rejection → 500 on every player, team and matchup page** (`API/lib/player-ssr.ts:90`, `API/lib/team-ssr.ts:72`, `API/lib/matchup/matchup-ssr.ts:79`), HIGH resilience |
| `listNews(250)` for the news page (`API/lib/news-query.ts:35-54`) | `/`, `/embed/ssr`, and **every `/api/news` poll** | per poll | render cache only | MEDIUM |
| `claimDueAccounts` (`API/lib/x/accounts.ts:135-160`) | X tick (disabled) | 2,880 ticks/day if enabled | – | latent |

- **Index opportunities (do not apply yet):**
  - a trigram index or a normalised player-key column;
  - `(pub_date_ms DESC NULLS LAST, first_seen_at DESC)` matching the ORDER BY;
  - storing `team_abbr` on wire rows at ingest, to use the existing `(team_abbr, pub_date_ms)` index.
- **Pool:** pg defaults (max 10), with **no `statement_timeout` and no `connectionTimeoutMillis`** (`lib/db/src/index.ts:13`). A hung DB parks requests indefinitely.

---

# Origin Load Risks

### BLUEHOST / WORDPRESS
1. Outage multiplication: 2–6 blocking fetches per view at 6–20 s each, with no negative cache when a backup exists (#2, #3).
2. The 20 s roster fetch in `the_title` on every player page (#3).
3. `wp_options` growth. Every fragment is stored twice at 25–230 KB each, and there are unbounded `?season=` keys on player stats. About 480 MB for one full player crawl (LIKELY).
4. Stampedes. There are no transient locks; 5-minute TTLs across about 4,900 URLs give a roughly 1:1 crawl-to-miss ratio.
5. The sitemap page-1 build: about 4,350 appended URLs plus 32 `get_posts` per sitemap request.

### API.STATCHASERS.COM
- **No public page request in this repo calls api.statchasers.com.** It appears only as the **fallback** wire URL (`.replit` `DYNASTY_NEWS_API_URL`).
- **Production** currently succeeds on dynasty-command, so it sends about 0 requests/day to api.statchasers.com.
- **The dev workspace** fails on both hosts (`403`, confirmed via local `/api/status`: "all 2 feed routes failed … api.statchasers.com … 403"). While the workspace runs, it sends **~144 requests/day to api.statchasers.com, all of them 403s**, and would continue indefinitely.
- If dynasty-command fails in production, production adds another ~144/day.
- **Conclusion: this project is not a material source of api.statchasers.com load.** If api.statchasers.com is seeing 429s, look elsewhere. The one cheap win is stopping the dev instance's scheduled ingests (or pointing dev at a stub).

### REPLIT (newsfeed.replit.app)
1. Anonymous FPA re-ingest (#1).
2. Per-request DB work before cache checks, and the 4,000-row news scan (#4, #5).
3. Ingest churn: about 90k UPDATEs/day, and cache resets every ≤10 minutes (#8).
4. No compression. HTML is 100–300 KB, and CSS is 200–250 KB at `max-age=0`, revalidated on **every statchasers.com page view** (browser-driven).
5. `/api/news` polling every 2 minutes per visible tab, plus every tab refocus, with no Cache-Control.
6. Crawlable noindex space (~30k player URLs × variants; `robots.txt` is `Allow: /`).
7. No rate limiting, no request timeout, and default pool settings without timeouts.

### THIRD-PARTY APIs
1. **ESPN scoreboard:** visitor-triggered 18-week sweeps; no dedupe; about 1,728/day while blocked; plus the `?season=` fanout (#7).
2. **Sleeper `/players/nfl` (14.6 MB):** per-request retries on failure (#6).
3. **GitHub nflverse:** the anonymous FPA ingest, and `games.csv` per season key (#1, #7).
4. **32 club sites:** ~1,570 full RSS downloads/day per instance with no `If-Modified-Since`. With dev running, that is ~3,100.
5. **ESPN team endpoints:** stale-and-failing refresh on every request; immutable seasons re-fetched every 6 h.
6. FantasyPros, Footballguys, Ourlads, KeepTradeCut, CBS and Anthropic are **admin or offline build scripts only**. They are never on a visitor path.

---

# Potential 429 Causes

Ranked by evidence.

1. **ESPN scoreboard sweeps from the Replit IP.** HIGHLY LIKELY. They are visitor-triggered, have no dedupe, cost 18 calls per miss, and get repeated full sweeps when blocked. ESPN already intermittently returns 403 to this host (project memory).
2. **Club RSS sweeps.** POSSIBLE. 32 sites × 48 per day × 2 instances, full downloads, 6 concurrent. They share one platform (the NFL club CMS), so the platform may rate-limit the aggregate.
3. **Sleeper `/players/nfl` retry loop.** POSSIBLE. It only activates after a first failure, but then it runs per request.
4. **GitHub (nflverse) during anonymous FPA re-ingest loops.** POSSIBLE. Unauthenticated release downloads are rate-limited per IP.
5. **dynasty-command / api.statchasers.com from the dev instance.** CONFIRMED as 403s, not 429s. About 144 wasted requests/day per host from dev.
6. **Bluehost PHP worker exhaustion (503/508, not 429) during a Replit outage.** HIGHLY LIKELY if an outage coincides with crawl or peak traffic (#2, #3).
7. **Replit 5xx from DB unavailability.** CONFIRMED mechanism. `ensureFreshness` rejections surface as 500/503 on every player, team and matchup page, and with no pool timeouts requests hang rather than fail fast.
8. **X / syndication.** UNLIKELY now, because it is disabled. It is HIGHLY LIKELY if enabled with 37 seeded accounts on the public provider; the code itself warns above 8 accounts.

**Cascade trace (CONFIRMED mechanism):**
1. Replit becomes slow.
2. The WordPress fetch hits its 6–12 s timeout.
3. There is no negative cache, so the next view retries, and the same view retries from 2–3 callers.
4. Bluehost workers pile up and humans refresh.
5. Replit receives more concurrent requests, and each one runs DB queries before checking its cache.
6. The 10-connection pool saturates, with no timeouts.
7. Replit slows further.

The client JS does **not** retry, so the amplification is entirely on the server side (WordPress).

---

# Core Web Vitals / Performance

- **Shortcode PHP waits synchronously for the Replit API before returning HTML. HIGH, CONFIRMED by design.**
  - On a warm transient this costs about 0 ms.
  - On a miss it costs one origin round trip (up to 6–12 s timeout).
  - In an outage it costs several (#2, #3).
  - TTFB on crawled pages is therefore bounded by Replit's latency, not WordPress's.
- **HTML payloads, uncompressed:**
  - Team hub fragment: about 200 KB.
  - Rankings: about 220 KB.
  - Player-stats WR: about 234 KB.
  - Player profile: about 104 KB, **plus a 30 KB roster island**.
  - Player index: about 397 KB.
  - Cloudflare compresses the WordPress HTML to the browser (INFERRED), so this mainly affects WordPress↔Replit transfer and the DOM size.
- **Render-blocking CSS from a second origin.** player.css (203 KB) and team.css (254 KB) are loaded from `newsfeed.replit.app` with `max-age=0` and no compression.
  - Every page view pays a connection to a second origin plus a revalidation round trip before first paint.
  - **This is likely the largest Core Web Vitals cost** (LCP/FCP).
- **Images** are lazy-loaded with dimensions set (29 of 30 on players, 142 of 143 on teams), so layout shift risk is low.
- **Fonts:** Inter from Google Fonts, `display=swap`.
- **Depth charts:** the main table is late-loaded by JS, which delays LCP and risks layout shift.
- **Source maps** are public (about 179 KB for the player bundle), and `X-Powered-By: Express` is sent. LOW.

# Year/Week Staleness

| When | What happens (CONFIRMED in code unless noted) |
|---|---|
| Now (in season) | Sleeper state drives the week. FPA advances only when someone triggers an ingest. Game logs, stats and rankings advance only on the manual weekly rebuild. |
| After week 18 / playoffs | Schedule `currentWeek()` stays at 18 and `seasontype=2` is hardcoded, so there is no playoff schedule. Postseason matchup links are generated but unrouted on WordPress. |
| New Year (Jan 1) | `seasonYear()` still returns the old season until March 1, which is fine. The depth-charts refresh falls back to `gmdate('Y')` if ESPN has no season (`DC/includes/class-scdc-refresh.php:34`, `:44`), which could label data with the new year. |
| **March 1** | `seasonYear()` flips. News and schedule titles say 2027. **The schedule becomes empty or 503 until nflverse publishes the new schedule** (≈ mid-May). FPA, handcuffs, outlook and depth charts still say 2026. WordPress stored descriptions still say 2026. The retitle tool skips current titles. |
| Offseason, before week 1 | Player pages show the prior season's stats under whichever year each clock reports. Rankings follow whichever CSV exists. |

A season-rollover runbook is needed before March 2027. It must cover:
- `STATCHASERS_TEAM_SEASON`, `SCDC_SEASON`, `OUTLOOK_SEASON`, `BASIS_SEASON`, and the `FPA_*` environment variables;
- `SC_SCHEDULE_SEASON`;
- forced re-fill of the stored Rank Math descriptions;
- the retitle regex.

---

# Recommended Fix Order

Line numbers are for the files as of this audit.

## P0 — fix immediately

**P0-1. Stop anonymous FPA ingests** (#1)
- **Where:** `API/lib/fpa-ssr.ts`, `kickLazyIngest()` at `:66-100` and its trigger in `renderFpaFragment()` at `:111-114`; `API/routes/fpa.ts` season parse at `:45-48` (per report); `API/lib/fpa/nflverse.ts:243`.
- **Current behaviour:** any season with no snapshots triggers a full re-ingest. There is no throttle after success and no fetch timeout.
- **Desired behaviour:** lazy-ingest only when the default season has zero rows, at most once per process, or behind a long backoff. Unknown seasons return 404 (or the default). Add `AbortSignal.timeout` to the fetch.
- **SEO impact:** none.
- **Traffic impact:** removes an unbounded DB-write and GitHub-download trigger.
- **Implementation risk:** low. Keep the cold-DB seeding path working.

**P0-2. Negative-cache on failure and memoise per request in every WordPress fetcher** (#2)
- **Where:**
  - `WP/statchasers-player.php` `statchasers_player_fetch` `:268-273`
  - `WP/statchasers-team.php` `statchasers_team_fetch` `:150-154`
  - `WP/statchasers-matchup.php` `statchasers_matchup_fetch` `:299-303`, and memoise `statchasers_matchup_request_meta` `:542-568`
  - `WP/statchasers-fpa.php` `:203-210`
  - `WP/statchasers-rankings.php` `:563-571`
  - `WP/statchasers-schedule.php` `:353-361`
  - `WP/statchasers-player-stats.php` `:309-317`
  - `WP/statchasers-news.php` `:204-215`
- **Current behaviour:** when a backup exists, a failure returns it without writing the primary key, so every view re-fetches. Multiple callers per request each fetch.
- **Desired behaviour:** on failure, `set_transient($cache_key, $backup ?? sentinel, 60)`. A static per-request memo keyed like the transient, as in `WP/statchasers-rb-handcuffs.php:70-73`.
- **SEO impact:** keeps TTFB flat during outages, so crawl rate holds.
- **Traffic impact:** outage load on Replit drops 2–6× per view, and Bluehost worker blocking drops to at most 1 per key per minute.
- **Implementation risk:** low. This is mechanical and the pattern already exists in the codebase.

**P0-3. Take the roster fetch off the front-end hot path** (#3)
- **Where:** `WP/statchasers-player-pages.php` `statchasers_player_roster()` `:78-155`, called from the `the_title` filter at `:880-907`.
- **Current behaviour:** a 20 s blocking fetch on any player view when the transient is absent, and failures are never cached.
- **Desired behaviour:** negative-cache failures (60–300 s), keep a long backup, and use a short timeout on the front end. Better still, store the heading data in post meta at build time.
- **SEO impact:** H1 stability.
- **Traffic impact:** removes up to 20 s per player view in an outage, and the 6-hourly stampede.
- **Implementation risk:** low–medium, because the H1 wording must stay identical.

## P1 — fix next

**P1-1. Check the version and cache before building page data; add memos** (#4)
- **Where:** `API/lib/player-ssr.ts` `renderPlayerFragment` `:86-99` and `renderPlayerAppPage` `:166-172`; `API/lib/matchup/matchup-ssr.ts:126-129`; `API/lib/team-ssr.ts:72`.
- **Current behaviour:** 3–10 DB queries per request, including 304s. Player and matchup pages build their data twice.
- **Desired behaviour:** a cheap version key (data-file mtimes, `contentVersion()`, options), then return the cached fragment or a 304 before `get*PageData`. Build the data once per request.
- **SEO impact:** faster TTFB.
- **Traffic impact:** ≈ 3,000 fewer DB queries per 1,000 crawled pages; the 4,000-row scans drop in proportion.
- **Implementation risk:** medium. The version key must include every input: news freshness, the Sleeper roster and ESPN cache stamps.

**P1-2. Replace the 4,000-row wire scan and the ILIKE player search** (#5)
- **Where:** `API/lib/news-query.ts:43`, `:54`, `:113-123`, `:239-272`; `API/lib/player/player-data.ts:445-448`, `:471`; `API/routes/news.ts` `storeItems` (write `team_abbr` and a player key at ingest).
- **Current behaviour:** reads up to 4,000 full rows and filters in JS; a leading-wildcard ILIKE.
- **Desired behaviour:** indexed `team_abbr` and `player_key` lookups with small LIMITs, plus a one-off backfill.
- **SEO impact:** a correct News tab for common surnames.
- **Traffic impact:** removes MB-scale DB reads per render.
- **Implementation risk:** medium. It needs a migration and backfill, which were **not** done in this audit.

**P1-3. Stale-while-revalidate and failure backoff for the Sleeper roster** (#6)
- **Where:** `API/lib/teams.ts` `ensureTeams()` `:183-208`.
- **Current behaviour:** the request blocks on a 14.6 MB fetch when the copy is 12 h stale, and retries on every request after a failure.
- **Desired behaviour:** serve the existing map and refresh in the background. On failure, set `fetchedAt` forward by a backoff (for example 15 min doubling to 2 h).
- **SEO impact:** none directly.
- **Traffic impact:** removes a per-request multi-MB third-party call during Sleeper incidents.
- **Implementation risk:** low.

**P1-4. Schedule: whitelist seasons, deduplicate ESPN, back off when blocked** (#7)
- **Where:** `API/routes/schedule.ts:46-51` and `:88-103`; `API/lib/schedule/schedule-data.ts` `loadEspn` (~`:395-420`) and the slate cache `:399-418`; `API/lib/team/cache.ts:87`.
- **Current behaviour:** user-supplied season keys; 18 ESPN calls per miss with no dedupe; repeated full sweeps when blocked; CSV re-download every 60 s for empty seasons.
- **Desired behaviour:** accept only seasons present in `games.csv` (cache the season list once), and return 404 otherwise. One in-flight promise per season. After a total failure, advance `fullRefreshAt` or back off to hours. Stop carrying `season` into links.
- **SEO impact:** removes app-host soft-404s.
- **Traffic impact:** ESPN falls from potentially thousands of calls a day to the healthy ~170/day.
- **Implementation risk:** low–medium.

**P1-5. Stop re-seen items counting as updates** (#8)
- **Where:** `API/routes/news.ts` `storeItems` `:711-727` and the invalidation at `:764-771`.
- **Current behaviour:** a per-row UPDATE and `updated++` for every re-seen row, which invalidates all caches.
- **Desired behaviour:** compare content fields and count only real changes. Batch the `lastSeenAt` touch into one UPDATE, or drop it.
- **SEO impact:** "Last updated" becomes truthful.
- **Traffic impact:** ~86k fewer UPDATEs a day; render cache and 304s start working.
- **Implementation risk:** low.

**P1-6. Whitelist `?season=` on WordPress player stats** (#9)
- **Where:** `WP/statchasers-player-stats.php` `statchasers_player_stats_query_season()` `:216-224`.
- **Current behaviour:** any 4-digit year is accepted, keyed and fetched.
- **Desired behaviour:** accept only the seasons listed by the API (or 2023..current plus `all`). Drop everything else so it is served as the default page.
- **SEO impact:** none.
- **Traffic impact:** bounds the `wp_options` rows and origin fetches.
- **Implementation risk:** low.

**P1-7. Scope `sc_sched_week` to the schedule page** (#10)
- **Where:** `WP/statchasers-schedule.php` `statchasers_schedule_request_week()` `:153-171` (and hence `:180-192`, `:772-801`).
- **Current behaviour:** any URL with `?sc_sched_week=N` is retitled and canonicalised to the schedule, and `=99` 404s any page.
- **Desired behaviour:** return 0 unless the queried object is the schedule page, matching `WP/statchasers-rankings.php:260-263`.
- **SEO impact:** closes a canonical-hijack surface.
- **Traffic impact:** none.
- **Implementation risk:** low.

**P1-8. Catch `ensureFreshness()` failures and add DB timeouts**
- **Where:** `API/lib/player-ssr.ts:90`, `API/lib/team-ssr.ts:72`, `API/lib/matchup/matchup-ssr.ts:79`; `lib/db/src/index.ts:13`.
- **Current behaviour:** any DB error returns 500/503 for every player, team and matchup page. There are no statement or connect timeouts.
- **Desired behaviour:** treat freshness as best-effort (fall back to the last value), and set `statement_timeout` and `connectionTimeoutMillis`.
- **SEO impact:** fewer 5xx seen by crawlers. The WordPress backups mask these, but only for 24 h.
- **Traffic impact:** fail fast instead of piling up.
- **Implementation risk:** low.

**P1-9. Make static assets cacheable and compressed**
- **Where:** `API/app.ts:202` (`express.static(publicDir)`); there is no compression middleware.
- **Current behaviour:** `max-age=0` and uncompressed. Every WordPress page view revalidates 200–250 KB of CSS plus JS against Replit.
- **Desired behaviour:** `Cache-Control: public, max-age=31536000, immutable` for `?ver=`-versioned assets, plus gzip/brotli (a compression middleware or pre-compressed files). Optionally serve the CSS from statchasers.com itself.
- **SEO impact:** better LCP/FCP on every tool page.
- **Traffic impact:** removes most browser-driven Replit requests and cuts transfer by about 80%.
- **Implementation risk:** low. `ver` already busts the cache per build.

## P2 — worthwhile

- Add a `max-age` of about 30–60 s to `/api/news`. Throttle refetch on `visibilitychange` (e.g. only if more than 2 minutes since the last one) (`API/client/main.ts:533-535`).
- Add `If-Modified-Since`/`ETag` to the club RSS fetches (`API/lib/club-news.ts:32-39`). Don't run schedulers in the dev workspace, or point dev at stubs; this also stops the 403 loop against api.statchasers.com.
- Add WordPress rewrites for postseason matchup game slugs (`WP/statchasers-matchup.php:113`, `:143`), or stop emitting those links.
- Fix or remove the `[statchasers_nfl_hub]` links to non-existent paths (`DC/includes/class-scdc-hub.php:57-122`), after verifying them live.
- Depth charts:
  - Make the bare main page canonicalise to `/fantasy/` (or the reverse), and list only one.
  - Server-render at least the team table.
  - On a partial refresh, keep the previous data for failed teams (`DC/includes/class-scdc-refresh.php:38-42`).
- Write a season-rollover plan: schedule empty state, `seasonYear` vs data, constants, stored meta, retitle regex (see Year/Week Staleness).
- Cache immutable ESPN seasons for a long time. Add in-flight dedupe to `matchupTable`. Back off stale-and-failing entries in `createKeyedCache` (`API/lib/team/cache.ts:99-139`).
- Fix `?sc_section=overview`/`outlook` redirect loops (`WP/statchasers-player.php:1199-1218`; `WP/statchasers-team-pages.php:1171-1192`).
- Forward `adv` on WordPress (`WP/statchasers-player.php` `statchasers_player_args`), or stop rendering those chips.
- Strip the 30 KB `data-scp-roster` island from WordPress player pages, or lazy-load it for search.
- Add a shortcode or parent check to `statchasers_player_sitemap_sections` (`WP/statchasers-player.php:1534-1557`), and emit meaningful lastmod values (the data version date).
- App host `robots.txt`: disallow `/*?season=` (OWNER DECISION on a broader disallow).
- Normalise the case and trailing slash of app-host canonicals, or 301 them.
- Verify live: Divi Theme Builder H1 on player and matchup pages; Rank Math sitemap hook output; Bluehost object and page cache; `SC_*_PATH_PREFIX` in production.

## P3 — cleanup

- The news flush deletes backups: separate "flush fresh" from "flush all" (`WP/statchasers-news.php:651-673`; team build at `WP/statchasers-team-pages.php:345-348`).
- The matchup breadcrumb ends at the noindex holder: add a breadcrumb filter.
- The RB-handcuffs `mainEntity` overwrite guard (`WP/statchasers-rb-handcuffs.php:370-397`).
- Validate `X-Forwarded-Host` in `publicOrigin()`.
- Remove the dev instruction from the FPA empty state. Make `/fpa` and `/embed/fpa` agree (both 404).
- Stale fallback `STATCHASERS_NEWS_VERSION='1.7.0'` (`WP/statchasers-news.php:36`).
- README drift: matchup aliases on WordPress; team-render `news` comment.
- Make depth-charts writes atomic (write to a temp file, then rename).
- Hide public source maps and `X-Powered-By`.
- `scripts/sc-build-pages.php:48` commits a fixed access token for a web-root page-creation script. Security hygiene: rotate it and move it out of the repo.

---

# FINAL SUMMARY

**TOTAL CRITICAL FINDINGS: 1**

**TOTAL HIGH FINDINGS: 10**
1. WordPress outage re-fetch multiplication
2. The 20 s roster fetch in `the_title`
3. Per-request API data build before cache checks
4. The 4,000-row news scan
5. Sleeper roster blocking and retry-on-failure
6. Visitor-triggered schedule fanout (ESPN and nflverse)
7. No ESPN dedupe and full sweeps while blocked
8. News ingest cache churn plus UPDATE volume
9. Player-stats `?season=` key explosion
10. DB failure → 5xx on all player, team and matchup pages

**TOTAL MEDIUM FINDINGS: 22**
1. `sc_sched_week` hijack
2. Soft-404 on API failure with no backup
3. Section metadata falls back to the profile's
4. No compression
5. Static assets at `max-age=0`
6. `/api/news` polling with no cache headers
7. Club RSS without conditional GET
8. Stale-and-failing ESPN retried per request
9. No transient locking and 1:1 crawl misses
10. `wp_options` bloat
11. Sitemap lastmod and page-1 concentration
12. Postseason matchup links unrouted
13. Likely-404 hub links
14. Depth-charts duplicate main page
15. Depth-charts JS-only table
16. Depth-charts partial refresh drops teams
17. `?adv=` not forwarded
18. `in_the_loop()` H1 guard (verify)
19. 30 KB roster island on every player page
20. Season-rollover schedule gap and hardcoded 2026 constants
21. No DB pool or request timeouts
22. Crawlable noindex app-host URL space and `Allow: /`

**TOTAL LOW FINDINGS: 18**
1. `?sc_section` redirect loops
2. App-host empty-state soft-404s (FPA, rankings, schedule)
3. Wrong ROS title on empty redraft
4. FPA empty state leaks a dev instruction
5. Host-header canonical reflection
6. Flush deletes backups
7. Matchup breadcrumb ends at noindex holder
8. RB-handcuffs `mainEntity` overwrite
9. Stale asset-version fallback
10. README drift
11. Schedule rewrite needs a manual flush
12. `getFpaDelta` permanent null cache
13. `matchupTable` has no dedupe
14. Non-atomic depth-chart writes
15. Public source maps and `X-Powered-By`
16. Nested `<a>` in the hub
17. Depth-charts "popular view" non-canonical links
18. Committed access token

### The 5 issues most likely to hurt organic SEO
1. Outage TTFB of 12–32 s on player, team and tool pages, which throttles Googlebot's crawl rate (#2, #3).
2. The `sc_sched_week` canonical and title hijack on any URL (#10).
3. Soft-404s: 200 with an empty body and index robots when the API fails with no backup; player sections falling back to the profile's title and description.
4. Sitemap quality: section lastmod never changes; no lastmod on matchups, weeks and positions; about 4,350 URLs on page 1; unverified hook; possible junk section URLs from legacy containers.
5. Broken internal links: about 65 postseason matchup games, and 6 `[statchasers_nfl_hub]` links. Plus the 2027 rollover (2026 in stored meta and H1s; empty schedule from March to May).

### The 5 issues most likely to create excessive Bluehost traffic
1. No negative cache when a backup exists: every view re-fetches (#2).
2. The 20 s roster fetch from `the_title`, never negative-cached (#3).
3. Multiple uncached fetch callers per request: rankings ×3, matchup ×4–6, schedule, FPA and stats ×2.
4. `wp_options` bloat from double-stored fragments, plus unbounded player-stats `?season=` keys (#9).
5. No transient locking, with 5-minute TTLs against ~4,900 crawled URLs (stampedes, ~1:1 misses).

### The 5 issues most likely to create excessive api.statchasers.com traffic
This project is **not** a material source.
1. The dev workspace's 10-minute wire ingest falls through to api.statchasers.com and gets 403 (~144/day while dev runs). CONFIRMED.
2. The production fallback to api.statchasers.com whenever dynasty-command fails (~144/day).
3. No backoff across the feed list. Each attempt tries both hosts in sequence, every 10 minutes, indefinitely.
4. A traffic-triggered `refreshIfStale` in addition to the timer. Both are gap-limited, so this adds little.
5. Nothing on any public page, WordPress or client path calls api.statchasers.com.

### The 5 biggest database query problems
1. The anonymous FPA ingest: DELETE plus 7,269 INSERTs on demand (#1).
2. The `listNewsForTeam` 4,000-row `SELECT *` plus JS filter, 1–4 times per render (#5).
3. The `storeItems` per-row UPDATE loop: ~90k/day, with cache invalidation every run (#8).
4. Page-data queries run before the cache and ETag check, and twice on player and matchup pages (#4).
5. The leading-wildcard ILIKE player search with no suitable index, plus no `statement_timeout`/pool timeouts.

### The 5 biggest cache opportunities
1. Static CSS/JS: `immutable` + 1 year + compression. Removes a Replit revalidation on every WordPress page view.
2. A version short-circuit in the API before the data build: 304 and fragment hits without DB work.
3. A WordPress negative cache plus per-request memo (also the top resilience fix).
4. Longer WordPress TTLs for weekly-changing player data. The data changes weekly, the TTL is 5 minutes. Pair with a purge on rebuild.
5. Treat immutable ESPN data (completed seasons and boxscores) as permanent, and stop the news-ingest churn so the news render cache and 304s actually hold.

### The 5 highest-risk crawler traps
1. App host `/fpa?season=` (triggers ingests).
2. App host `/schedule?season=`, propagated by `carriedQuery` (ESPN and nflverse fanout).
3. statchasers.com `/nfl/nfl-player-stats/?season=NNNN` (unbounded transients and origin fetches).
4. statchasers.com `?sc_sched_week=` on any URL (canonical hijack) and `?sc_section=overview|outlook` (redirect loop).
5. The app host's ~30k noindex player URLs × case and trailing-slash variants, all crawlable under `Allow: /`, each costing 3–6 DB queries.

### The 5 most important player-page SEO issues
1. Outage TTFB (20 s roster fetch plus 2 fragment attempts) on the ~4,300-URL family.
2. Section URLs falling back to the profile's title and description (and forced `index`) when the fetch fails without a backup.
3. Section sitemap lastmod never changes; possible junk section URLs from legacy containers.
4. Hardcoded 2026 in section H1s and stored descriptions; the `?log=2024` page is headed "Game Log 2026".
5. The `in_the_loop()` H1 guard under Divi Theme Builder (verify live), plus the 30 KB roster JSON shipped in every player page.

### The 5 most important things to fix first
1. **P0-1:** close the anonymous FPA ingest trigger.
2. **P0-2:** negative-cache plus per-request memo in every WordPress fetcher.
3. **P0-3:** take the 20 s roster fetch off the player-page title path.
4. **P1-1 + P1-2:** API cache-before-build, and replace the 4,000-row news scan.
5. **P1-4 + P1-9:** schedule season whitelist and ESPN dedupe/backoff; immutable, compressed static assets.
