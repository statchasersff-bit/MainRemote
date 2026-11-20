# Team Pages Phase 7: rematch previews, News freshness, single-URL purge

Branch `team-hubs-phase7-rematch-news`, from production `bfb90ab` (the Phase 6
release 8c949c7 plus Replit's publish commit). Approved by mak on 2026-11-20
as three workstreams. Not deployed.

## 1. Rematch URLs (Option A)

**Problem.** An unplayed meeting has no page of its own: every link went to
the pair page, which shows this season's latest finished meeting until the
rematch is within six days. 32 upcoming divisional rematches (64 team links)
opened the earlier game's box score; their dated URLs were 404.

**Change.**
- `/nfl/<a>-vs-<b>/<season>-week-<n>/` for an unplayed meeting of the current
  season now renders that game's preview: the same preview the pair page
  shows in its six-day window, with the same design and code path.
- Until the pair page takes the game over: no canonical at all, noindex,
  follow (printed by the plugin on WordPress; the app's own page is noindex
  by template) and no SportsEvent. The plugin is told with
  `X-Matchup-Game: preview`.
- Once the pair page previews the game (six days out, or as soon as the
  league dates a TBD game that is that close): `X-Matchup-Game: current` and
  the existing canonical-up rule, exactly as for an owned final.
- After the game: unchanged (the pair page owns the latest final; the
  earlier one keeps its own address and enters the game sitemap).
- The game is identified by season, week and season type, so a TBD or
  rescheduled kickoff keeps the same URL. A canceled game, a week the two do
  not play, or a game outside the current season stays a 404.
- One link rule for every game link: `gameLink()` in
  `src/lib/matchup/game-link.ts`, on top of `meetingLinkTarget()` in
  `pair.ts`. Used by the team Schedule, Matchups, Overview (Next Game) and
  Usage tabs, the league schedule, and the player header ("View matchup")
  and Breakdown. The "vs Every Team" index still links pairs.

**Unchanged by design:** every pair URL, title, H1, canonical and robots;
the earlier meetings' pages; `meetingHasOwnAddress()` (so the game sitemap and
`/embed/matchup-games.json` are identical); no redirects; no Option D.

**Caches around the switch.** The app's ETag changes when the pair page
takes a game over, so the plugin's 5-minute fragment cache and any
conditional request pick up the new canonical (tested: a pre-switch ETag
gets a 200, not a 304). The Rocket.net edge can keep serving the pre-switch
WordPress copy (noindex, no canonical) until it is purged: at most about a
day, because WP Rocket's daily lifespan clear also purges the whole edge.
That is the conservative direction: a lingering noindex copy never competes
with the pair page. The pair page's own switch to the preview has always had
the same lag; the manual game-day purge covers both.

**Compatibility.** The app serves an unplayed meeting's dated page only to a
caller that sends `X-SC-Matchup-Preview: 1` (plugin 1.10.59) or to its own
standalone page. Without the header it answers 404 as before.

| App | Plugin | Result |
|---|---|---|
| old | old | today: upcoming dated URLs 404, links go to the pair page |
| new | old (1.10.58) | links go to dated URLs, but WordPress gets a 404 for them. **Do not stay here.** |
| old | new (1.10.59) | identical to today (the origin still 404s; the plugin's new branch never runs). Safe. |
| new | new | the release |

So: **upload the plugin first**, verify nothing changed, then Publish the app.

## 2. Team News conditional 45-day rule

`recentTeamNews()` in `src/lib/team/news-window.ts`, applied only where the
team page loads its news (`team-data.ts`). If at least 20 stories fall
within 45 days, only those are shown; otherwise the list is unchanged.
Collection, the database, player pages and Dynasty Command are untouched,
and so is the order.

Results (same data, both builds rendered back to back): **Washington 53 to 42**
(the 11 June-September items drop; the assessment estimated about 41, and the
42nd is the item at the edge). The other 31 teams show identical story counts and
lists. Offseason (simulated in the assessment; unit-tested here): with fewer
than 20 recent stories a team keeps its whole list.

## 3. Single-URL cache-purge test (run 2026-11-20 12:51 UTC)

Test URL `/nfl/teams/washington-commanders/matchups/`, control
`/nfl/teams/washington-commanders/schedule/`; desktop and iPhone user agents.

| Step | Test URL | Control URL |
|---|---|---|
| Baseline (12:50) | HIT both devices (desktop age 607 s, iPhone 15 s) | HIT both devices (desktop age 763 s, iPhone 13 s) |
| Purge (12:51:21) | `rocket_clean_files()` + `CDN_Clear_Cache_Api::cache_api_call( ["/nfl/teams/washington-commanders/matchups/"], "purge" )` returned `status: success` | not named |
| +5 s | MISS both devices, fresh `last-modified` 12:51:38 / 12:51:47, origin render 1.2 s / 7.1 s | HIT, age still counting (836 s / 86 s) |
| +40 s | HIT both devices with the new copy | HIT, age 880 s / 130 s |

- **Edge (Rocket.net/Cloudflare): honors a single-path purge**, for both device
  variants, and leaves the control untouched.
- **WP Rocket: not exercised.** WP Rocket holds no file for either page: since
  the 12:30 full purge it has cached only the 31 team HUB pages
  (`/nfl/teams/<slug>/`), not the tabs or the pair pages. `rocket_clean_files()`
  on the test URL was a no-op, and the hub's own file was untouched (still
  12:40:20).
- Side effects: none. All responses were 200 with one H1. No new PHP errors
  (log size unchanged, 1,038,152 bytes). Load average 16-17 on 32 cores before
  and after. Exactly two origin renders.
- **Conclusion: targeted manual game-day purging is viable.** For the tabs and
  pair pages the edge is the only full-page cache, and it purges per path.
  For the 31 hubs, WP Rocket's per-URL purge still needs a one-page test
  (approval needed) before it goes into the procedure. A game-day list would
  be the clubs that played (hub, schedule, matchups, news) plus each game's
  pair and dated pages: about 150 paths on a Sunday, with no full-site cold
  start.

## Validation

- 32 rematches (both teams' Schedule and Matchups links, dated page, plugin
  endpoint with and without the header, earlier meeting): all pass. The same
  rule also fixes 7 later meetings whose first meeting is still unplayed
  (DEN-LV Wk 15; BUF-MIA, CHI-DET Wk 17; BAL-PIT, CIN-CLE, LAR-SEA, NO-TB
  Wk 18): their links opened the pair page's preview of the EARLIER game, and
  now open their own preview. 39 games in all; checked the same way.
- All 496 pair pages, all 150 finished 2026 game pages and the game-sitemap
  feed (294 entries): identical to production code. The league schedule adds
  exactly the 39 dated links (Weeks 12-18). Player pages: the header's
  "View matchup" for a Seattle player opens the Week 12 preview.
- Pair pages and earlier meetings for those 32: identical to production code
  (status, title, canonical, robots, H1, SportsEvent).
- 128 team pages (hub, schedule, matchups, news × 32) rendered on both builds
  with the same caches: identical except the rematch links (157 Schedule, 79
  Matchups, 1 hub) and Washington's News list.
- Regression tests: `tests/matchup-rematch.test.mjs` (23 tests: the link rule
  for the earlier meeting, the upcoming rematch, a single meeting, TBD,
  postponed and canceled games, two undated fixtures; the dated page on real
  data with the server clock 9 and 3 days before SF-SEA Week 12; the cached
  ETag across the switch; the News rule). Plugin `tests/smoke.php`: 18 new
  checks (preview, owned, archived, 404, pair page, capability header).

## Rollback

- App: Publish the previous release (production `bfb90ab` /
  `release/team-hubs-p6-2026-11-20`). Upcoming dated URLs go back to 404 and
  links back to the pair page. Nothing indexed in between (noindex).
- Plugin: reinstall 1.10.58 from `~/tmp/statchasers-news-1.10.58-backup-20261120`
  on Rocket.net. With the new app and the old plugin the dated preview URLs
  404 on WordPress, so roll the app back first (or together).
- Then clear WP Rocket and purge Rocket.net in the documented order.
