# WEB-040 / WEB-003: live matchup pages and game-day caching

Branch `fix/web-040-live-matchup-2026-11-24b`, from
`integ/matchup-p1-p4-2026-11-24` (local `main` 54ce4e4 + the 1.10.64
hotfix), so it carries WEB-001 and the schedule half of WEB-040
(b43a623 / 311cd32, docs/WEB-040-SCHEDULE-STATUS.md). Local only: not
pushed, published, uploaded or purged. Plugin version not bumped
(integration's call).

## 1. One game through the system: Colts at Texans, 2026-11-19

| Step | Where | What it did on 2026-11-19 |
| --- | --- | --- |
| Feed: schedule | nflverse games.csv | Scores only after the game, no status column. |
| Feed: live | ESPN scoreboard, `fetchEspnWeek()` in schedule-data.ts | Read lazily: 30 s while a game is "in", 15 min otherwise, **60 min after any refused sweep** (ESPN refuses this host for hours at a time). |
| Status | `normalize()` + game-status.ts | One status per game: scheduled / live / final / pending. |
| Team schedules | team/schedule.ts `fromSlate()` | Carries the status, but a score only once final (`result`). |
| Matchup data | matchup-data.ts `decide()` | While the game was not final and within 4 h of kickoff (`isUpcomingFixture`), the pair page was "upcoming" and featured the game: **the preview**. Nothing on a matchup page rendered an in-progress state; the score never reached it. |
| Week URL | routes/matchup.ts + plugin `statchasers_matchup_fetch()` | A dated address pinned only a **final** game (`pinned`). Dated previews (`pinnedFixture`, the `X-SC-Matchup-Preview` header) arrived with Phase 7, 5630f66, **2026-11-20 13:48 UTC**, the day after. So on 11-19 the week URL was `pinnedMissing` -> **404 until the slate called the game final** (11:13 PM ET is about the end of a TNF game; the live layer was reaching ESPN). |
| WordPress | plugin, matchup transient | 5-minute transient, no cache policy of its own. |
| WP Rocket | 24 h lifespan, nothing purges a matchup URL | |
| Edge | Rocket.net stamps `s-maxage=2592000` on every 200 and strips origin Cache-Control | The H2H preview, cached before or during the game, stayed until WP Rocket's lifespan and a purge: **~18 h**. |
| Browser | no polling anywhere | An open tab never changed. |

Root causes, in order of effect:
1. **The matchup pages had no live state.** "Not final" meant "preview" until 4 h past kickoff. Every fresh render during the game was a preview (the audit's three refreshes), and a game running past 4 h (overtime, delays, a stalled feed) dropped the H2H page back to the *previous* result.
2. **The week URL could not exist before final** (fixed in production since 11-20 by Phase 7 dated previews; this branch keeps that and links to it).
3. **Caching was blind to the game.** The edge kept whatever it got for 30 days, WP Rocket for a day, and nothing purged on a status change.
4. **ESPN refusal backoff** of 60 min applied mid-game too, so a refused sweep froze every surface for an hour.

What production does today (read-only, 2026-11-24 ~19:35 UTC, browser UA):

| URL | cf-cache-status | age | cache-control | TTFB cached / `?zz=` origin |
| --- | --- | --- | --- | --- |
| /nfl/houston-texans-vs-indianapolis-colts/ | HIT | 7861 s | `public, max-age=0, s-maxage=2592000` | 0.51 s / **14.1 s** |
| /nfl/houston-texans-vs-indianapolis-colts/2026-week-11/ | HIT | - | same | 0.23 s / 5.5 s |
| /nfl/dallas-cowboys-vs-philadelphia-eagles/ | HIT | - | same | 0.11 s / 5.9 s |
| /nfl/dallas-cowboys-vs-philadelphia-eagles/2026-week-12/ | HIT | - | same | 0.10 s / 3.3 s |
| /nfl/nfl-schedule/week-12/ | HIT | - | same, plus `cdn-cache-control: public, max-age=21600`, `x-sc-schedule-cache: state=pregame; edge-ttl=21600; page-cache=skip` | 0.12 s / 3.9 s |

Note `cdn-cache-control` **does** reach the visitor through the edge today
(the schedule plugin sends it), while Cache-Control is still replaced. The
Week 12 DAL-PHI URL is 200 with `canonical` -> the pair page (Phase 7
"current") and the schedule links the pair page.

## 2. What changed

### One record per game (API)

- `src/lib/matchup/game-state.ts` (new): `GameStateRecord` built from the
  **same slate row the schedule prints**. Phases: scheduled, live, halftime,
  break ("End of 3rd"), delayed, postponed, canceled, pending, final. A clock
  only while live; score only when a source vouches for it; a pending game
  carries `lastVerified` (score, clock, read time) printed as "last
  verified", never as the score; a final carries `detailsReady` (box score
  in or not). `pollPlan()` and `matchupCachePolicy()` live here.
- schedule-data.ts:
  - `regressesFinal()`: a completed ESPN entry is only replaced by another
    completed one (corrections land; a lagging "in" response after the final
    is ignored);
  - the live refresh clock (30 s) also runs while a kickoff is due or just
    past with no word yet (`kickoffDue`), not just once ESPN says "in";
  - the refusal backoff is 5 min while a game is live (60 min otherwise);
  - `liveLastSeen` on a stale in-progress game (in the fingerprint).
- pair.ts: `isUpcomingFixture(..., inPlay)` and `MeetingFacts.inPlay`: a game
  a source reports in play stays the pair page's current game past the 4 h
  grace. **`meetingLinkTarget`: every unplayed game of the current season
  links its own dated page** (see "Decisions for mak").
- matchup-data.ts: `Meeting.gameId`; `data.gameState` (current-season
  subject game: the dated page's game or the one the pair page leads with);
  `data.cachePolicy`, with `changeAtMs` = kickoff, or the moment the pair page
  turns into a preview (6 days before the next meeting).
- matchup-render.ts + `game-state-render.ts` (new): the **strip** under the
  hero on the week page and the H2H page. Hidden before kickoff (the
  preview's hero carries the kickoff); live: "LIVE  CIN 7, WAS 3  2nd
  quarter, 6:11 / Score as of 9:41 PM ET"; halftime and delays without a
  clock; pending: "Live updates are paused. Last verified: ..."; final with
  no box score yet: "Detailed stats are still arriving." A final with its box
  score is the recap page itself: no strip. The hero's in-progress score
  reads the same record; SportsEvent says EventPostponed / EventCancelled for
  a called-off game (in progress stays EventScheduled: schema.org has no
  in-progress status).
- routes/game-state.ts (new): `GET /api/game-state/<gameId>` (public, CORS,
  in-memory, no upstream call; `max-age` 15 s while it can change) and
  `GET /api/game-events` (behind the ingest secret).
- client/game-state.ts (new, in the team bundle): open tabs follow the game.
  Wakes 30 min before kickoff, polls every 30 s while live, pauses while
  hidden, backs off to 5 min on errors keeping the last verified score and
  its time, never steps back from a final, every 2 min while a final waits
  for its box score, every 5 min for 48 h after a final (corrections). On
  final it shows "Box score and recap" (H2H) or "Load the box score" (week
  page). WordPress is never asked to re-render for a score.
- boxscore.ts: ESPN summary URL goes through `ESPN_SITE` (`SC_ESPN_SITE_BASE`)
  like the scoreboard, so replays fake both.
- `lib/schedule/game-events.ts` (new): on every slate assembly, status changes
  and final-score changes of current-season games are detected (never on
  first sight after a restart) and the stale pages named: week page, H2H,
  schedule week + season, both hubs and their schedule tabs. POSTed to
  `SC_PURGE_WEBHOOK` with `SC_PURGE_KEY` when both are set; **neither is set
  anywhere**, so today it only logs.

### Cache policy

The API sends `X-SC-Matchup-Cache-State` (live / pregame / recent / settled)
and `X-SC-Matchup-Change-At` (epoch s) on matchup fragments and pages; the
schedule gains a `recent` state (`withRecentFinal`).

| State | When | Edge (plugin) | WP Rocket | plugin transient |
| --- | --- | --- | --- | --- |
| live | in progress, halftime, delayed, pending, kicked off with no word | 60 s | skip | 30 s |
| pregame | before kickoff | until kickoff, cap 6 h (a preview cached 1 min before kickoff lives 1 min) | skip | never past kickoff |
| recent | final < 48 h (end estimated kickoff + 4 h), or box score not in | 1 h | skip | 5 min |
| settled | older finals, series pages | host default (30 d), but never past the pair page's own flip to preview | allowed unless the flip is < 1 day away | 5 min |
| backup / unavailable | API down | 60 s | skip | 1 min |
| legacy | API without the header | unchanged (no override) | unchanged | 5 min |

Why these numbers: the live layer refreshes ESPN every 30 s, so 60 s at the
edge costs at most one extra refresh of staleness. Origin capacity (below):
an uncached matchup render is 3-14 s on production WordPress, so 60 s live is
at most ~1 render per minute per URL per edge location for the 2-6 games of a
window; the browser updates come from the API (in-memory) instead.

Plugin (statchasers-matchup.php): `statchasers_matchup_page_cache_policy()`,
`statchasers_matchup_apply_cache_policy()` on `template_redirect` 20
(`X-SC-Matchup-Cache` says what was decided), transient TTL follows the
state, backup renders are marked. `POST /wp-json/statchasers/v1/purge-games`
(off unless `STATCHASERS_PURGE_KEY` is defined): drops the matchup transients
for the named pages and the schedule's fresh transients, `rocket_clean_files()`
for exactly those URLs, then fires `statchasers_purge_edge_urls`. Paths
filtered to `/nfl/...` shapes.

## 3. The edge: what has to change on the host (proposal, not applied)

Rocket.net replaces origin Cache-Control on PHP 200s with
`public, max-age=0, s-maxage=2592000`. `CDN-Cache-Control` passes through to
the visitor today, so the edge either ignores it or is not asked to read it.
Ask Rocket.net (or use their dashboard if exposed) for a cache rule scoped to:

```
http.host eq "statchasers.com" and (
  starts_with(http.request.uri.path, "/nfl/nfl-schedule/") or
  (starts_with(http.request.uri.path, "/nfl/") and http.request.uri.path contains "-vs-") or
  (starts_with(http.request.uri.path, "/nfl/teams/") and ends_with(http.request.uri.path, "/schedule/"))
)
```
- Eligible for cache; **Edge TTL: use origin `Cloudflare-CDN-Cache-Control`
  (or `CDN-Cache-Control`) when present**, else the current default.
- Browser TTL: respect origin (`max-age=0`).
- Everything else on the site keeps today's 30-day behavior.

Fallback if they cannot honor origin headers on those paths: a fixed 60 s
edge TTL there. Pregame and settled pages would then re-render every minute
per edge location (3-14 s each on WordPress): workable for the ~16 game
URLs of a week, heavy for all 496 pairs; prefer the header rule.

Event purge: the plugin route above is ready; the missing piece is **which
call of Rocket.net's CDN Cache Plugin purges one URL** (`wp cdn purge` is the
WP-CLI whole-zone purge `pnpm purge-and-warm` uses). Check on the host
(`wp cdn --help`, the mu-plugin's class) and hook it to
`statchasers_purge_edge_urls`, then set `STATCHASERS_PURGE_KEY` in wp-config
and `SC_PURGE_WEBHOOK=https://statchasers.com/wp-json/statchasers/v1/purge-games`
+ `SC_PURGE_KEY` on the API. Until then, the TTLs alone bound staleness
(60 s live, kickoff for a preview, 1 h for a fresh final) once the edge
honors them.

## 4. Decisions for mak

1. **Links to unplayed games go to the dated week URL, always** (was: the
   pair page while it previews the game, Phase 7 Option A). This is what the
   brief asks ("the schedule should link directly to it") and it is the only
   way an open preview tab is the same URL as the final box score. Nothing
   an indexed page declares changes: the dated page is still noindex with no
   canonical until the pair page previews it, then canonical up to the pair
   page, then self-canonical once final (WEB-001). No title / meta / schema
   change except EventPostponed / EventCancelled on a called-off game.
2. Turning on the purge hook and the host cache rule are production changes.

## 5. Verification

See the report in this commit's message and the run logs below.

### Local replay (scripts/schedule/web040-matchup-replay.mjs)

Run 2026-11-24 ~17:55 UTC (local clock), CIN @ WAS, seconds from kickoff.
"fresh" = an uncached request to the app; "tab" = a Chromium tab opened a
minute before kickoff and never reloaded (one browser per tab, both
visible); "edge-h" = the edge honoring the plugin's lifetime; "edge-obs" =
production's edge today (30 days).

| t | step | API / schedule row | week URL (fresh) | H2H (fresh) | open tabs | edge-h week | edge-obs week |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -55 s | pregame | scheduled, row "12:56 PM ET", pregame | 200, canonical up (current), pregame, change-at = kickoff, strip hidden | upcoming, pregame | scheduled (hidden strip) | MISS, ttl 56 s (expires at kickoff) | MISS |
| +37 s | kickoff | live 0-0 14:55 1st, row "14:55 - 1ST" | live, strip "LIVE CIN 0, WAS 0 1st quarter, 14:55 / Score as of ..." | upcoming + same strip, live | live | MISS (refilled), ttl 60 | **HIT: preview** |
| +73 s | halftime | halftime 10-7, row "HALFTIME" | strip halftime, no clock | same | halftime | HIT live (<60 s old) | preview |
| +108 s | second half | live 17-10 8:30 3rd | live | live | live | MISS -> live | preview |
| +143 s | overtime | live 20-20 5:00 OT, row "5:00 - OT" | "Overtime, 5:00" | same | live, "Overtime, 5:00" | HIT live | preview |
| +178 s | ESPN refusing | pending, no score; row "STATUS PENDING" | strip pending + "Last verified: CIN 20, WAS 20 (5:00 - OT) at ..." | same | still live (next poll due) | MISS -> pending | preview |
| +213 s | final/OT | final 23-20, row "FINAL/OT" 23-20, schedule recent | 200 **archived** (own canonical), recent, recap, no strip | recently_completed, recent | **final** "FINAL/OT CIN 23, WAS 20" + "Load the box score" / "Box score and recap" | HIT pending (<60 s old; a purge would clear it) | preview |
| +563 s | corrected final | final **26-20**, row 26-20 | recap 26-20 | recap | **26-20** after the tab's 5-min check | MISS -> final, ttl 3600 | preview |
| +574 s | older in-progress response | still final 26-20 (ignored) | archived | recently_completed | final 26-20 | HIT final | preview |

Purge events recorded: `scheduled->live`, `live->final`, `score 23-20->26-20`,
8 paths each (week, H2H, schedule week + season, both hubs + schedule tabs).
None for the ignored older response. The week URL, the H2H strip and the
schedule row agreed at every step; the open tabs lagged by at most one poll
(30 s), and the "honoring" edge by at most one 60 s lifetime. Production's
edge today would have shown the preview the whole way, which is the audit.

Also covered by `tests/matchup-live-state.test.mjs` (fast clocks): delayed,
the final arriving before the box score (week URL 200, strip "Detailed stats
are still arriving", recent, polled every 2 min), the week-99 404, an
unknown game id 404.

### Tests

- `tests/matchup-live-state.test.mjs` (new): 16 pass.
- `tests/schedule-game-status.test.mjs`, `tests/matchup-game-index.test.mjs`,
  `tests/matchup-rematch.test.mjs`: 38 pass, after updating the link-rule
  expectations (Phase 7's "pair page while previewing" -> own dated page) and
  the schedule's just-final week from `settled` to `recent`.
- `tests/matchup.test.mjs` + `tests/schedule.test.mjs`: 152, 151 pass, 1 fail =
  the known pre-existing Wild Card heading failure.
- `php tests/smoke.php`: all passed, including the new `mucache` group
  (`smoke-matchup-cache.php`, 18 checks) and the schedule's `recent` check.
- `tsc` server and client clean. Full suite not run here (integration runs it).
- Not run: `cache-integration.php` (needs the MariaDB rehearsal site).

### Origin timings

App origin (`/embed/matchup/...`, the fragment WordPress fetches), a fresh
process per "cold" row (`NODE_ENV=production`, ESPN layer off so the run is
deterministic), same box, before = e96626e, after = this branch:

| Request | before cold / warm | after cold / warm |
| --- | --- | --- |
| H2H HOU-IND (recap of the Week 11 final) | 3.41 s / 0.090 s | 2.66 s / 0.065 s |
| Week 12 preview DAL-PHI | 2.72 s / 0.088 s | 1.21 s / 0.050 s |
| Week 11 final HOU-IND (recap) | 7.00 s / 0.077 s | 1.75 s / 0.067 s |
| 3 concurrent, fresh process (the three above) | 4.15 / 4.16 / 4.52 s | 2.00 / 2.01 / 2.16 s |

The "cold" numbers are dominated by the process loading its data stores on
the first request and vary run to run with the disk cache (the before run
went first); they show no regression, not a speed-up. The change adds one
in-memory slate lookup per render. `/api/game-state/<id>` is an in-memory
read (no upstream call): single-digit ms warm.

Production WordPress, read-only, browser UA, 2026-11-24 ~19:35 UTC (table in
section 1): an edge HIT answers in 0.1-0.5 s; an origin render (`?zz=`) of a
matchup page takes **3.3-14.1 s** (the 14.1 s was the HOU-IND H2H recap),
the schedule week 3.9 s. In the local replay one cold H2H recap render took
18.6 s inside the app. That cost is why the live edge lifetime stays at 60 s
(at most one render per URL per minute per edge location) and why open tabs
update from the API instead of re-rendering WordPress.

### Needs a real game after deployment

`scripts/schedule/web040-game-sampler.mjs` samples the week page, H2H,
schedule week and `/api/game-state/<id>` every 5 min from kickoff - 30 min to
final + 2 h, recording the feed's update time, displayed state, score, clock,
cf-cache-status / age / cache-control / plugin verdict, and when each surface
first showed final versus the API. Thanksgiving, 2026-11-26 (Week 12):

```
node scripts/schedule/web040-game-sampler.mjs --pair <pair> --season 2026 --week 12 --game-id <id> --kickoff <utc>
```

| Game | --pair | --game-id | --kickoff (UTC) |
| --- | --- | --- | --- |
| CHI @ DET | chicago-bears-vs-detroit-lions | 2026_12_CHI_DET | 2026-11-26T18:00:00Z |
| PHI @ DAL | dallas-cowboys-vs-philadelphia-eagles | 2026_12_PHI_DAL | 2026-11-26T21:30:00Z |
| KC @ BUF | buffalo-bills-vs-kansas-city-chiefs | 2026_12_KC_BUF | 2026-11-27T01:20:00Z |

(`--season 2026 --week 12`.) Run one at a time. Before the release it
measures today's behavior (no strip, 30-day edge); after it, the new one.
