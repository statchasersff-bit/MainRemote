# WEB-040: NFL schedule game status and freshness

Branch `fix/web-040-schedule-status`, rebased on `main` 38e2e9c (which carries
WEB-022's schedule titles). Local only: not pushed, published, uploaded or
purged. Plugin version not assigned (integration's call).

## The report

2026-11-19, Week 11: Colts at Texans ended Texans 26, Colts 3. The weekly
board (`/nfl/nfl-schedule/week-11/`) printed the correct 3-26 score beside
"12:04 - 4TH" after the game was final. The dated matchup page already had the
final.

## Part 1: status

### One game, source to HTML

| Step | Where | What happened to IND @ HOU |
| --- | --- | --- |
| 1. Source | `fetchEspnWeek()`, schedule-data.ts | ESPN's scoreboard read the game `state: "in"`, `shortDetail: "12:04 - 4th"`. That entry is the layer's last word on the game if no later sweep reaches ESPN. ESPN refuses this host for hours at a time, and a failed sweep keeps the old entries and backs off 60 minutes. |
| 2. Second source | nflverse games.csv | Posts `away_score 3, home_score 26` hours after the whistle. |
| 3. Normalization (**where they diverge**) | `normalize()`, schedule-data.ts | `status` became `"final"` from the feed's score, but `statusDetail` was copied from the layer for every non-scheduled status: "12:04 - 4th". The score came from the feed, so the score was right and the words were the old clock. |
| 4. Generation | `statusText()`, schedule-render.ts | A final printed `(statusDetail ?? "Final").toUpperCase()`, so "12:04 - 4TH". The screen-reader line said the same. |
| 5. Caching | fragment LRU, ETag, WP transient, WP Rocket, edge | Every layer held the wrong text faithfully. They did not cause it, but see Part 2: the edge could keep it for 30 days. |
| 6. Matchup page | matchup-render.ts | Reads the box score and sets no layer detail, so it printed the final. That is why the two pages disagreed. |

No shared game-status helper existed on this branch or on the open matchup
branches; none of them touch the schedule files. The exact production window
cannot be reconstructed from here (no production logs). The replay below is
the one path through the code that produces the reported output; on `main` it
prints `12:04 - 4TH`.

### What establishes a completed game

- **ESPN has an explicit completion indicator:** `status.type.completed: true`
  and the status name `STATUS_FINAL`. It also has an explicit in-progress state
  (`state: "in"`), and this host now records when it read it (`seenAtMs`).
- **nflverse has none.** games.csv has no status column. The nflverse
  schedules dictionary says only that `away_score` / `home_score` (and
  `result`, `total`) are "NA for games which haven't yet been played". It
  promises nothing about when during or after a game they fill in, so a score
  there is not proof the game is over.

So the precedence in `src/lib/schedule/game-status.ts` is:

1. ESPN says completed (`completed`, `STATUS_FINAL`, or `post` with a score
   that is not a postponement): **final**. It prints ESPN's final word
   ("Final", "Final/OT"), or Final/OT when ESPN's period is 5+ or nflverse's
   `overtime` is 1. It never prints a clock, whatever period and clock the
   payload still carries.
2. ESPN read the game in progress within 10 minutes (`LIVE_STALE_MS`): **live**,
   with ESPN's clock ("12:04 - 4th", "Halftime", "Delayed") and ESPN's score,
   **even when the feed already has scores**, which may be partial.
3. nflverse has both scores and nothing fresh contradicts them: **final**
   ("Final", or "Final/OT" by `overtime`). This is the 2026-11-19 case.
4. ESPN postponed or canceled: **Postponed** / **Canceled**. **Delayed**
   before kickoff comes from `STATUS_DELAYED` / `STATUS_RAIN_DELAY`.
5. A stale in-progress read with no final anywhere: **Status pending**, with
   no clock, no live dot and no stale score (`data-status="pending"`).
6. Not started: the kickoff, until 20 minutes past it (`KICKOFF_GRACE_MS`)
   with no word from anyone, then **Status pending**.

`GameStatus` values are unchanged (matchup code branches on them). The new
`statusConfirmed` and `statusObservedAtMs` fields are optional, so games built
elsewhere read as confirmed. `data-kickoff`, the only hook the browser bundle
rewrites, sits only on a cell that really shows a kickoff. The browser bundle
fetches and polls nothing, so it cannot restore an old clock. While a game is
confirmed live, the week head prints **Updated h:mm PM ET**: when the oldest
live clock on the board was read from ESPN. Final-only weeks get no stamp,
because no source supplies a trustworthy timestamp for them.

### Before and after, IND @ HOU, `/schedule/week-11` and `/embed/schedule?view=week&week=11`

```
BEFORE (main)
  <p class="scs-visually-hidden">Indianapolis Colts at Houston Texans, 3 to 26, Thu, Nov 19, 12:04 - 4TH</p>
  <span class="scs-game-status">12:04 - 4TH</span>
AFTER
  <p class="scs-visually-hidden">Indianapolis Colts at Houston Texans, 3 to 26, Thu, Nov 19, FINAL</p>
  <span class="scs-game-status">FINAL</span>
```

## Part 2: the public page caches

### What sets `s-maxage=2592000` (traced 2026-11-24, 04:47-04:50 UTC)

Read-only requests to statchasers.com with a browser UA:

| Request | What WordPress sends | What the visitor gets |
| --- | --- | --- |
| `/nfl/nfl-schedule/`, `/week-12/` | no Cache-Control of its own | `public, max-age=0, s-maxage=2592000`, `cf-cache-status: HIT`, age 1851 s / 3890 s |
| `/nfl/nfl-schedule/?x=<ts>` | same | same header, `MISS` (query strings are separate keys, not a bypass) |
| `/?s=<random>` (search) | none | same 30-day header, `MISS` |
| `/wp-json/wp/v2/types/post` | none | same header, `DYNAMIC` |
| `/wp-admin/admin-ajax.php?action=heartbeat` (200) | `nocache_headers()` (core: `no-cache, must-revalidate, max-age=0, no-store, private` + `Expires: 1984`) | **`public, max-age=0, s-maxage=2592000`**, no Expires, `DYNAMIC` |
| `/wp-admin/admin-ajax.php?action=<unknown>` (400) | `nocache_headers()` | **no Cache-Control, no Expires** |
| `/nfl/nfl-schedule/week-23/` (404) | `nocache_headers()` | **no Cache-Control, no Expires**, `BYPASS` |

**Conclusion.** The header is not WordPress, WP Rocket or this plugin. It is
stamped above PHP by the Rocket.net platform. The origin's `Cache-Control` and
`Expires` are removed from every PHP response (the 400 and 404 arrive with
neither), and the 30-day value is added to successful ones. That fits an
nginx `fastcgi_hide_header Cache-Control/Expires` plus a non-`always`
`add_header`, but that is inferred; the config is not visible from here.
**Origin Cache-Control never reaches Cloudflare today**, so:

- the first WEB-040 commit's `nocache_headers()` could not have kept a page
  out of the edge (it is gone from this version);
- an origin `s-maxage=60` would be replaced by the 30 days the same way.

Production configuration, read through the WordPress connection (no changes
made):
- WP Rocket 3.24.1: cache lifespan 24 hours (`purge_cron_interval` 24 h),
  `cache_reject_uri` only sitemaps, separate mobile cache, RocketCDN off.
- Must-use plugin "CDN Cache Plugin" 1.1.14 (`cdn-cache-management.php`,
  Rocket.net's): purges the edge when content is updated. It is not in this
  repo. Earlier sessions found it purges on post saves and domain cleans only,
  and the week URLs are rewrite routes that no post save names.

### The policy (in this repo)

The app computes a policy from the games each view shows: a week's games for
`/week-N/`, the whole season for the hub. It sends the result as
`X-SC-Schedule-State` and `X-SC-Schedule-Next-Kickoff`:

| State | When | Edge lifetime (plugin) | WP Rocket | WP fragment transient |
| --- | --- | --- | --- | --- |
| `live` | a game in progress, pending, delayed, or kicked off with no word yet | 60 s | never stored (DONOTCACHEPAGE) | 30 s |
| `pregame` | games still to come, none in play | until the next kickoff on the page, capped at 6 h (no confirmed kickoff: 6 h) | never stored | never past that kickoff |
| `settled` | every game final or canceled (completed weeks) | no override: platform default (30 days) | may store | 5 min |
| backup / unavailable | API down; the 7-day outage backup is served, or nothing | 60 s | never stored | 1 min (unchanged) |

WP Rocket is skipped for everything that is not settled because its own
lifespan is a day and nothing purges its files at kickoff. If it stored them,
an expired edge entry would refill from a stale file. The plugin sends the
lifetime three ways from `template_redirect`, before output:
- `Cloudflare-CDN-Cache-Control: public, max-age=N`: Cloudflare only, not
  forwarded downstream.
- `CDN-Cache-Control: public, max-age=N`
- `Cache-Control: public, max-age=0, s-maxage=N`: today's platform replaces
  this one.

It also sends `X-SC-Schedule-Cache: state=…; edge-ttl=…; page-cache=…`, so a
live response shows from outside what the plugin decided.

### Hosting change needed at release (outside the repo)

Ask Rocket.net (or make the change in their dashboard, if they expose it) to
do this **for `/nfl/nfl-schedule/` and `/nfl/nfl-schedule/week-*/` only**:

1. Let the origin's `Cloudflare-CDN-Cache-Control` (or `CDN-Cache-Control`)
   through to Cloudflare, and have the zone's cache rule for those paths
   **respect origin cache headers** instead of forcing the 30-day TTL. As a
   Cloudflare cache rule: expression
   `http.host eq "statchasers.com" and (http.request.uri.path eq "/nfl/nfl-schedule/" or starts_with(http.request.uri.path, "/nfl/nfl-schedule/week-"))`,
   eligible for cache, Edge TTL "use cache-control header if present"
   (Cloudflare-CDN-Cache-Control wins over Cache-Control when present),
   browser TTL "respect origin".
2. If they cannot pass origin headers through, the fallback is a fixed
   short TTL for those paths: about 60 s. That covers live windows; pregame
   pages would refresh every minute instead of at kickoff, which costs origin
   renders but is never stale.

Everything else on the site keeps today's behavior.

### What visitors saw: the replay

`artifacts/api-server/scripts/schedule/web040-cache-replay.mjs` walks
IND @ HOU from 42 s before kickoff to final. These parts are real:
- the app, with its live layer, fragment cache and policy headers;
- a throwaway WordPress 6 + MariaDB with this plugin: real transients,
  `template_redirect`, the shortcode and its headers;
- fake nflverse and ESPN feeds that the script changes mid-run.

These parts are models, since the real ones can't run here:
- **WP Rocket:** stores unless `page-cache=skip`, 24-hour lifespan.
- **Edge, "honoring":** obeys `Cloudflare-CDN-Cache-Control`. This is the
  behavior after the hosting change.
- **Edge, "observed":** drops origin headers and stamps 30 days. This is
  production today.

The app's clocks are shortened (ESPN reads 1-2 s, staleness 8 s instead of
10 min, slate 2 s); the edge and WP Rocket models run on real seconds.

Run 2026-11-24 05:03 UTC (seconds from kickoff):

```
 -42s  warm: hub + week       pregame; edge-ttl=42-43; page-cache=skip      week shows "12:03 AM ET"
   2s  honoring/week          edge EXPIRED at kickoff -> state=live, ttl=60 (ESPN still "pre": shows kickoff)
   7s  SOURCE  ESPN: in progress, 14:55 - 1st
  62s  honoring/week sees     14:55 - 1ST          (next 60 s refill)
  76s  SOURCE  ESPN: 12:04 - 4th, 3-26
 122s  honoring/week sees     12:04 - 4TH
 146s  SOURCE  ESPN stops answering (last read 12:04 - 4th); nflverse posts 3-26
 183s  honoring/week sees     STATUS PENDING       (read stale; that refill still had the pre-final slate)
 187s  honoring/hub           state=pregame, edge-ttl=21600 (next kickoff, Week 12, is 3 days out: 6 h cap)
 243s  honoring/week sees     FINAL                state=settled; edge default; WP Rocket may store
 243s  observed/hub, observed/week   edge HIT age=285s, week still "12:03 AM ET"
```

What it shows:

- **With the hosting change**, every transition reached a visitor within one
  60 s edge lifetime of the app knowing it. Pregame entries expired exactly at
  kickoff. The live clock was never more than 60 s behind the app. The final
  replaced the stale fourth-quarter clock, and the completed week then went
  back to the long lifetime and into WP Rocket. Worst-case staleness while live
  is edge 60 s + WP transient 30 s + ESPN refresh 30 s.
- **Without it** (production today), the page warmed before kickoff kept
  showing the kickoff time after the game was final, and would for 30 days or
  until a purge. Nothing in the repo can fix that alone.
- The "Status pending" step comes from two things: the shortened staleness
  threshold, and the slate cache serving its old copy while it refreshes. In
  production the threshold is 10 minutes. If ESPN stops answering mid-game,
  visitors see the last clock for up to 10 minutes, then "Status pending"
  until nflverse posts the final (often hours).
- One local-only note: this WordPress turns " - " in the shortcode output
  into an en dash (`&#8211;`). That was true before this change and is not
  part of it.

Layers exercised for real: the app's caches and ETag, the WP transients
(MariaDB) and the plugin's hooks. Modeled: WP Rocket and the edge. **Not
exercised:** Rocket.net's real edge and nginx, WP Rocket's real
`advanced-cache.php`, and its mobile cache.

### Production checks after deploy (release coordination)

1. Request a schedule week page with `?x=<ts>` (an origin render). Expect
   `x-sc-schedule-cache: state=…`. Expect `cdn-cache-control` to appear too,
   if the platform passes it (Cloudflare strips the Cloudflare- variant
   before the visitor).
2. After the hosting change, during a pregame window: `age` on a HIT should
   never exceed the seconds to the next kickoff. During a game: never more than
   60. A completed week can stay a long HIT.
3. Pages cached before the release ignore all of this until they expire.
   Clear WP Rocket (mobile cache too) first, then the Rocket.net edge. Check
   with an iPhone UA.
4. Load: while live, the hub and the current week are WordPress renders about
   once a minute per edge location (TTFB 1.5-3 s). Before kickoff, at most
   every 6 hours.
5. The API change does not depend on the plugin. Deployed alone, it fixes the
   words on the next render. The plugin and the hosting change decide how long
   caches keep a page.

## Tests

Final commit, full API suite (`node --test tests/*.test.mjs`, after
`node build.mjs`, `INGEST_SECRET` unset), branch vs `main` 38e2e9c:

| | tests | pass | fail | skipped | cancelled |
| --- | --- | --- | --- | --- | --- |
| this branch | 1,899 | 1,885 | 13 | 1 | 0 |
| `main` 38e2e9c | 1,886 | 1,872 | 13 | 1 | 0 |

The 13 extra tests are `tests/schedule-game-status.test.mjs`; all pass. The 13
failures are **the same 13 by name on both**, so none is new:

- a closed season is never swept
- a player card is its own fragment, and an unknown one is a 404
- a player whose page is on last season still gets this season's outlook title
- a refused sweep is not repeated at the next idle expiry
- bio text is about the person; fantasy lives only in three marked places
- concurrent requests share one ESPN sweep
- every team.css selector in the Usage report carries the id-weight prefix
- phones' finishes list: newest first, five seasons then Show all, full names in the opened row (2026-11-15)
- player.css
- the board's fantasy trio is three figures, the first in gold
- the fragments it wraps ship no assets of their own
- the lead is not repeated in the feed, and outbound links open safely
- the Wild Card: one H1 in the hero, scores, table and JSON-LD in the source

(The first WEB-040 report said 14. That run was before the `.scs-updated`
font-variable fix, which was already in commit 1538223; that commit never
got a full run of its own. This is the reconciled count.)

- `tests/schedule-game-status.test.mjs`, 13 tests:
  - helper unit cases, including feed scores beside a fresh ESPN live read
    (the clock stays) and `STATUS_FINAL` as explicit completion;
  - the page policy;
  - with ESPN reachable: ESPN's final still carrying period 4 / clock 12:04
    prints FINAL on both routes; a live 4th quarter with partial feed scores
    (10-7) keeps its clock and ESPN's 17-17; hub; week 12 pregame with its
    next kickoff; the warm-cache live-to-final test (kept);
  - the incident: ESPN's last read 12:04 4th, then refusing, with nflverse
    3-26. It prints FINAL on both routes once the read is stale, and the
    other live game goes to STATUS PENDING with no clock or score.
- Plugin: `php tests/smoke.php`, all passed. That includes
  `smoke-schedule-cache.php`, which walks the policy across a game day with
  fixed timestamps (pregame until kickoff, 6 h cap, kickoff passed, live,
  backup, older API, nothing, settled), plus the DONOTCACHEPAGE verdict for
  live and settled boards. `tsc` (server and client) clean.
- `scripts/schedule/web040-cache-replay.mjs`, the timeline above, run against
  the local WordPress at `.local/web040/env`. It is opt-in, not part of
  `npm test`.

## Shared code

- `normalize()` feeds the team hubs (`team/schedule.ts`). Their effects:
  - a nflverse overtime final now carries "Final/OT", so the Overview prints
    "Overtime" for it;
  - a stale live game has no detail badge, and its score is hidden until a
    source confirms it;
  - a fresh ESPN live read now outranks feed scores there too.
  The hub's "Live Now" wording for a stale game is unchanged.
- Matchup code reads only `status === "final"` and the result; no matchup
  files were edited.
- WEB-022 (schedule titles, on `main`) touched the same plugin file. The
  rebase merged cleanly apart from the smoke-group list, which keeps
  `schedtitles`, `schedlive` and `schedfinal`.
