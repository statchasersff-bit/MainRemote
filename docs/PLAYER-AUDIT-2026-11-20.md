# NFL player pages: technical SEO, performance and functionality audit (2026-11-20)

Branch `player-audit-2026-11-20`, from production `d4d63e2` (published 20:26 UTC,
publish commit 468f99a, caches purged 20:37). Nothing was deployed, published,
merged or purged, and no WordPress setting was changed. The design is unchanged:
every fix on the branch is a data, link, schema or wording correction.

Detailed evidence for every finding (commands, scripts, raw output) is in
`.local/playeraudit/findings/{seo,links,data,func-perf,cache}.md` and
`.local/playeraudit/scratch/`.

## 0. Baseline

| Item | Value |
|---|---|
| API build in production | d4d63e2 (`/api/status`), the Game Log CLS release 15c65b3 before it |
| WordPress plugin | statchasers-news 1.10.60 (source only on `wp-cache-reliability-2026-11-20`; the app line carries 1.10.59) |
| Navigation | 981-1280px gap fixed in WordPress 19:39 UTC (Divi header layout 268 + Integration head) |
| Already live, not redone | house scoring, injury-status source, shared target share, Server-Timing, selective tab construction, render caches, desktop + Game Log CLS fixes, "through Week N" on the Stats FAQ |
| Shelved | `phase2-player-redesign` untouched |
| Search Console | **Not available**: Rank Math Analytics module off, no exports. Every statement about Google below is from crawl logs or page output, never from rankings. |

Sources audited: all 681 indexed slugs x 7 routes on a local copy of the production
build (9,534 renders), 5,129 linking pages, 1,053 game-log scoring cells, 33,637
Googlebot requests in the Rocket.net origin logs (Oct 31 to Nov 20), and about
300 live requests at 1 per 3-6 s (no 429s).

## A. Technical SEO

Nothing is broken at the indexing level: every indexed URL answers 200 or a
deliberate redirect, with one H1, a self canonical and the right robots tag;
unknown slugs and tabs are real 404s; every parameter, case and slash variant
canonicalizes to the clean URL; left-roster players are noindex and out of the
sitemap; every JSON-LD block parses with no dangling @id; FAQPage matches the
visible FAQ on every page; name, club and position match the data for all 649.

| ID | Finding | Pri | Pages | Status |
|---|---|---|---|---|
| SEO-1 | Sitemap lists 92 section URLs that 302 to the profile (63 /stats/: all 34 kickers + players with no NFL game; 29 /game-log/). Googlebot fetched them 418 times in November. | P1 | 92 | **Fixed** fa457ee (app only; the plugin already skips what the API lists) |
| SEO-2 | `dateModified` taken from the wrong season's schedule for players whose newest game is from an earlier season (44): 24 of them carried a date (94 fragments), 59 of those fragments in the future (2025 Week 18 dated 2027-01-03); the other 20 already emitted none. | P1 | 24 | **Fixed** b6ff460 (JSON-LD: needs your OK) |
| SEO-8 | Outlook FAQ and starting-QB sentences say "through Week 11" from the Thursday game on, for clubs that have not played (Josh Allen live). The d4d63e2 fix covered the Stats FAQ only. | P1 | every Outlook, Thu-Sun | **Fixed** ea92984 (FAQ text: needs your OK) |
| SEO-3 | 22% of Googlebot's player crawl (7,375 requests) goes to `?log=YYYY` archive variants. Canonicals are correct, so no duplicate indexing; the cost is crawl budget (hypothesis without GSC). | P1 | ~680 | Proposal (see G) |
| SEO-4 | Hub FAQPage merges every tab's FAQ: 30-66 questions (mean 54), 87% from panels hidden by default, each also in its section's FAQPage. Hub vs section text containment 98-99% (confirms the prior investigation). | P2 | ~680 hubs | Decision (prior investigation item P2) |
| SEO-5 | JSON-LD names carry literal `&amp;` and `&#8217;` (Rank Math graph). | P2 | all | Proposal (plugin) |
| SEO-6 | 45 WordPress page titles drop Jr./Sr./II/III, so the breadcrumb reads "Marvin Harrison (WR)". Two slugs have duplicate published pages (tyson-bagent, dandre-swift): 12 duplicate sitemap entries. | P2 | 45 + 2 | Proposal (WP content: needs OK) |
| SEO-7 | News tabs (649) and players with no 2026 game get no WebPage node. | P2 | ~700 | Proposal |
| SEO-9 | Heading levels skip h2 to h4 (stats-premium.ts:193/205/214/299, outlook-projection-premium.ts:157). | P2 | ~1,700 | Proposal (tag swap; verify no visual change) |
| SEO-10 | Sitemap `lastmod` is the WordPress page date (75% say 2026-09-20) while data changes weekly. | P2 | 4,344 | Proposal (plugin) |
| SEO-11 | og:type "article" on player pages (app says "profile"). | P2 | all | Proposal (meta: needs OK) |
| SEO-12 | 1,333 titles 61-70 characters. Not a defect by itself; listed for the title decision only. | P2 | 1,333 | No action now |
| SEO-13 | 302 (not 301) for sections a player lacks. Correct as designed: a section can appear (an injury is logged). | info | | Keep |
| SEO-14 | `/nfl/players/` directory note says "through Week 11" league-wide from `data.week` (player-render.ts:2607). Needs a wording choice: last fully completed week, or the FPA form "through Week 10 and 1 Week 11 game". | P2 | 1 | Decision |

Googlebot log note: player crawl jumped from ~500 to 2,000+ requests a day on
Nov 3, but logging for every user agent jumped the same day and Redraft Command
rose in step, so this is most likely a logging or edge-cache change, not a crawl
change. The logs are origin-only (edge hits are missing).

## B. Internal links

All 5,129 linking pages (32 teams x 8 views, 527 matchup pages, 649 players x 7,
leaderboards, rankings, handcuffs, schedule) return 200. Every player link uses
`/nfl/players/<slug>/[tab/]`: no retired forms, no `?season=`, no missing slashes,
no API-origin links, no old slugs, no links to empty tabs or noindex bios, and
every player page links his current club.

| ID | Finding | Pri | Status |
|---|---|---|---|
| L1 | Wrong player by name: a defender who shares a star's name gets the star's link (Browns LB Justin Jefferson -> Vikings WR from the CLE depth chart, Contracts, Draft and the CLE-NYJ matchup; Panthers CB DeVonta Smith -> Eagles WR). Cause: name-only lookup (`lib/player/data.ts:259-302`); defenders are not in the dictionary, so no clash is visible to it. | P1 | **Team-page code**: fix is to pass each row's position/club from the callers (team-render.ts:1085/1226, contracts, draft, matchup-render.ts:950). Coordinate with the team session. |
| D10 | Pages of players with no Stats tab linked /stats/, which 302s back: 34 kickers, 29 players with no NFL game and the 32 team-defense pages (628 links). | P2 | **Fixed** ed83bcc |
| L2 | Team Usage links 47 non-indexed players (404 targets); the plugin's unlinker hides it live but fails open. | P2 | Proposal (team code) |
| L3 | 7 indexed players left unlinked by spelling ("Bam Knight", "Irv Charles", Desrosiers...). | P2 | Proposal (alias list) |
| L4 | 4 strict orphans (gregory-desrosiers, nick-williams, chris-collier, myles-white); 57 indexed players absent from their club's hub depth chart (index from Ourlads, chart from another source). | P2 | Proposal |
| L5 | ~16,300 Redraft Command profile links go to byte-identical empty SPA shells (same title, no canonical, index,follow). | P2 | Redraft Command decision |
| L6 | Heavy duplicate links: 42 peer-card links per hub (6 peers x 7 panels), median 45 self-links; matchup pages ~106 player links for ~22 players. | P2 | Tied to SEO-4 hub decision |
| L7 | "View game recap" (7,847 links) opens the player's own game log, not a recap. | P2 | Proposal (anchor wording: needs OK) |
| L8 | Articles: auto-linker works (20 valid links in the sample); team names never linked. | P2 | Opportunity |
| L9 | Contracts data disagrees with the roster for 4 players. | P2 | Team data |

## C. Search visibility

Without Search Console no ranking, impression or CTR claim can be made, and none
is. What the evidence supports:

1. **Crawl efficiency** is the best-evidenced lever: 418 Googlebot hits on
   redirecting sitemap URLs (fixed), 7,375 on `?log=` variants (SEO-3), and
   uncached renders of 7-22 s after each purge (D below).
2. **Duplication**: the hub contains 98-99% of each section page and carries a
   54-question FAQPage on average. This is the main structural SEO risk; the
   prior investigation's cohort test (40 players vs 40) remains the right way to
   decide it. Not changed.
3. **Freshness signals** were wrong in places: future `dateModified` (fixed),
   "through Week 11" claims (Stats fixed in d4d63e2, Outlook fixed here),
   September `lastmod` in the sitemap (SEO-10).
4. **Thin URLs**: about 2,000 URLs belong to marginal players (prior
   investigation); the section index rule waits for GSC.

Needed to go further: the GSC exports listed in section 11 of
`.local/seo-investigation-2026-11-20/SEO-RECOVERY-INVESTIGATION-2026-11-20.md`.

## D. Performance

Where the time goes (cold vs warm, separated by layer):

| Layer | Measured |
|---|---|
| API render | hub 121 ms cold / 12-16 ms warm; section 18-30 ms cold |
| WordPress origin, uncached | 7-22 s TTFB with a cache-buster during the warm crawl, 5-10 s of it in `wp-before-template`; natural misses 1.1-2.8 s |
| Cached (WP Rocket / edge) | 32-95 ms TTFB |
| Browser, phone (4x CPU) | hub LCP 2.9 s, TBT 1.06 s, 753 KB HTML, 6,986 DOM nodes; sections LCP 0.6-1.1 s |
| CLS | at most 0.04 on every tab and width measured |

| ID | Finding | Pri | Fix (appearance unchanged) |
|---|---|---|---|
| FP-1 | Game Log season chips wait 7-15 s: each click fetches a never-cached `?log=` page. | P1 | Add `log` (and `adv`) to WP Rocket cached query strings, or fetch the API fragment. WP setting: needs OK. |
| FP-2 | Uncached WordPress renders cost 5-10 s before our shortcode runs (the prior TTFB profile: plugin load/init). | P1 | Host-side; per-URL purges and warm after purge (see E) limit exposure. |
| FP-3 | Tab switch on phones 270-530 ms to next paint (lab INP proxy; field INP unavailable). Style/layout, not script; same on the standalone page, so our code. | P1 | `content-visibility:auto` on below-the-fold panel sections; needs a visual check before shipping. |
| FP-4 | Hub weight (753 KB, 6,986 nodes). | P1 | Structural: same decision as SEO-4. |
| FP-5 | WP Rocket Delay JS / async CSS apply to hubs but not sections (386 KB JS up front, phone TBT 0.6-0.9 s). Root cause unconfirmed (settings read was refused). | P2 | Check WP Rocket exclusions. |
| FP-6 | Page 2 px wider than the viewport at 768/820 px when an FAQ is open (rotated "+", player.css:799-811). | P2 | `overflow-x: clip` on `.scp-ox-faq`; visual check. |
| FP-7 | Divi late-CSS loader throws a TypeError on every phone page. | P2 | Divi/host |
| FP-8 / FP-9 | Wrong headshot preloaded on desktop; all 178 hub images eager. | P2 | WP Rocket preload exclusion; `loading=lazy` in hidden panels. |
| FP-10 | `?format=std` falls back to PPR (the keyword is `standard`). Format selector removed by design. | P2 | Accept `std` as an alias. |

### Caching and reliability

Healthy today: 0 page-cache entries without an expiry row (player live 2,927/2,927,
backups 7,145/7,145), plugin 1.10.60 installed with no leftover upgrade claim, no
object cache, the app's fragment cache is keyed on a data fingerprint, and stale
`ver=` asset requests get current bytes with a 1-hour cache.

| ID | Finding | Pri |
|---|---|---|
| C1 | The per-player sibling purge (`statchasers-player.php:1028-1043`) clears WP Rocket only; Rocket.net purges the edge only on domain/post cleans. Player pages carry `s-maxage=2592000` (30 days), so after a data refresh live pages stay stale until the next full purge, and a player's hub, tabs, desktop and phone copies can show different weeks (seen live on Ja'Marr Chase before 20:37). | P1 |
| C2 | Publish-to-flip window: the plugin holds the asset version in a 15-minute transient and the 5-minute fragment key has no build in it. Today: build 20:26:01, new `ver=` written 20:34:39, purge 20:37 (2.5 min after the flip, by luck). Harmless today because player.css was byte-identical. | P1 |
| C3 | When the API errors or takes over 6 s the plugin serves the 1-day backup without marking it uncacheable: WP Rocket keeps it 24 h, the edge 30 days. | P1 |
| C4 | The "last seen" marker is per slug but the version includes format and season, so `?log=` fetches trigger sibling purges (1,518 `?log=` origin hits today, 159 Googlebot). | P2 |
| C5 | Phone critical CSS is an 11-17 snapshot (78 KB, 899 player selectors) inlined on hubs. | P2 |
| C6 | Opcache revalidates every 60 s and the upgrade hook has no downgrade guard: an old worker can write the old version back after an upload. | P2 |
| C7 | `sc_news_asset_version` is not read through the self-healing read. | P2 |
| C8 | One version hash for all six bundles re-versions player.css on any bundle change. | P2 |
| C9 | No check compares the live site's cached pages with the build. | P2 |

Worst-case staleness: after a data refresh, app immediate, WP fragment 5 min,
WP Rocket 24 h, edge until the next full purge (C1); after an API publish, up to
15 min of mixed `ver=` plus cached backups during a slow start (C2, C3); after a
plugin upgrade, opcache runs old code up to 60 s (C6).

## E. Data accuracy and freshness

Verified correct: all 1,053 game-log fantasy-point cells (PPR, Half, Standard,
2024-2026) and every career season against an independent recomputation,
including kicker distance bands; header PPG in all three formats; Stats-card
target and snap share against the shared definition; every matchup label
checked; byes, games missed, IR chips; traded players' current team, career
club column and bio trade history.

| ID | Finding | Pri | Status |
|---|---|---|---|
| D1 | Game Log per-game target share divided by the club's CURRENT roster: Tyler Warren Wk 3 66.7% (true 28.6%), Josh Downs 73.3% (31.4%). 90 players, 252 player-games, 16 clubs; also the News recap "share of the team's targets". | P1 | **Fixed** 824a429 |
| D2 | Game Log result for a traded player's new-club games showed the old club's score (Downs Wk 10 "W 24-22" = IND; KC won 35-13). Also Harrison Jr. Wk 6/7/9, Cousins Wk 10. | P1 | **Fixed** 824a429 |
| D3 | Outlook (also on the Overview) prints the usage report's whole-season, current-club share: Bowers 21.0% / 62% snaps beside 25.4% / 77.5% on the same page; Downs "1.8% target share". Up to 172 players differ by 1+ point. | P1 | Definitional: needs coordination with the team session (the usage report is theirs). Not changed. |
| D4 | Outlook drivers print a third share (advanced table): Downs "22.2%, 20th of 139". | P1 | Same decision as D3 |
| D6 | Outlook PPG for traded players uses the new club only (Cousins 19.7 in the header vs "15.4 a game"). | P1 | Same decision as D3 |
| D5 | One share, four rank pools (St. Brown 30.2%: 92nd pctile, 6th of 112, 3rd of 108, WR3). | P2 | Document; decide one pool per section |
| D7 | Freshness monitor counts a game final only when games.csv has its score; the Week 11 Thursday game was final elsewhere. Latent (production refresh picked it up). | P1 | Proposal: add the ESPN-layer final check to /api/data/health |
| D8 | Harrison Jr. "Pending, on track to play" while the roster feed lists him Out. | P2 | Proposal |
| D9 | Lamar Jackson "Still out, 5 games missed" for an ankle he returned from in Week 8 (stale injury-history store). | P2 | Rebuild the store; add it to the monitor |
| D11 | ROS board (Oct 22), redraft board (Sep 20), injury history (Oct 20 / Nov 18), transactions (Sep 30) have no freshness check. | P2 | Proposal |
| D12 | QB FAQ "on 201 of 320 completions"; news/FAQ "1 yards". | P2 | **Fixed** 3ac34f4, 902e7c9, 028c733 (FAQ text: needs your OK) |
| D13 | Team usage FAQ "582 of 651 snaps (98%)" is 89%. | P2 | Flagged to the team-page project |

## F. Functionality

Working: direct tab URLs (21/21), in-page tab switching (URL, title and H1
update), back/forward, Game Log expand/sort, Stats NFL/Fantasy toggle, player
search (suggestions and Enter), peers and fantasy-profile links, wide tables
scroll inside their box with no page overflow at 360-430 and 1024+, keyboard
focus visible on every stop, empty states (redirect to profile) and the 404.
Navigation and the mobile menu, including keyboard, at 320-1440 px (after the
19:39 header fix). Broken or unreliable: FP-1 (slow season chips), FP-6 (2 px
overflow at 768/820), FP-7 (phone console error). No component needed a
functional code change.

## G. Recommended fixes, ranked

| # | Item | Pri | Impact | Effort | Risk | Owner / approval |
|---|---|---|---|---|---|---|
| 1 | Deploy the branch's data fixes D1/D2 + sitemap SEO-1 + kicker links D10 | P1 | wrong numbers on 90+ players; 92 redirecting sitemap URLs | done | low (777-page diff, all intended) | your OK |
| 2 | Deploy the SEO-surface fixes SEO-2, SEO-8, D12 wording | P1 | future dates and false week claims in schema/FAQ | done | low | your OK (SEO surface) |
| 3 | C3: mark backup renders uncacheable in the plugin | P1 | stops day-old pages being cached 24 h / 30 d after a slow publish | S | low | plugin release |
| 4 | C1: make the per-player purge reach the edge (or shorten edge TTL on player pages) | P1 | stale live stats after data refreshes, hub/tab disagreeing | M | medium | plugin + Rocket.net |
| 5 | C2: send the asset version with the embed response; guard purge-and-warm on the version flip | P1 | mixed old/new `ver=` window (8.5 min today) | S-M | low | app + script |
| 6 | L1: pass position/club to player-name links on team and matchup pages | P1 | wrong-player links | M | low | team session |
| 7 | D3/D4/D6: one share and PPG definition in Outlook | P1 | conflicting numbers on one page | M | medium | team session + you |
| 8 | FP-1: cache `?log=` pages (WP Rocket query strings) | P1 | 7-15 s waits on season chips; also helps SEO-3 | S | low | WP setting: your OK |
| 9 | D7 + D11: extend the freshness monitor | P1 | silent staleness | S | low | app |
| 10 | FP-3: `content-visibility` on lower panel sections | P1 | phone tab-switch lag | S | low-medium (visual check) | app |
| 11 | SEO-4 / FP-4 / L6: hub duplication decision via the cohort test | P1 | crawl, weight, cannibalization | L | medium | after GSC |
| 12 | SEO-5/6/7/9/10/11, SEO-14, FP-5..10, L2-L9 | P2 | small, individually | S each | low | as listed |

## H. Implemented on the branch

| Commit | Change | Files |
|---|---|---|
| 824a429 | Game Log: each game credited to the club he played for that week (target-share pool and result) | lib/player/ranks.ts; tests/player-traded-game-log.test.mjs (new) |
| ed83bcc | No Stats link where the player has no Stats tab (63 players + 32 team defenses, 628 links) | lib/player-render.ts, lib/player/{overview,faq-pools,bio-tab}.ts |
| 3ac34f4 | QB FAQ: "completing 201 of 320 passes" | lib/player/faq-pools.ts |
| fa457ee | Sitemap: Stats and Game Log join emptySections | routes/player.ts |
| b6ff460 | No dateModified from another season's schedule | lib/player-seo.ts |
| ea92984 | Outlook "through Week N" = the club's completed week | lib/player/outlook-tab.ts; tests/player-outlook-tab.test.mjs |
| 902e7c9 | News recap line: "1 time for 1 yard" | lib/player/news-tab-data.ts |
| 028c733 | Game Log FAQ: "1 yard" | lib/player/faq-pools.ts |
| 06a01e1 | Tests for the above | tests/player.test.mjs, tests/player-overview.test.mjs |

No CSS, client JS, data files, plugin, WordPress or configuration changes.

Verification:

- **Every page, before and after**: all 681 indexed slugs x 7 routes (4,767
  pages) on the production build vs the branch, same data: 3,884 identical,
  883 changed. Every change is one of the fixes: target-share percentages
  (Game Log and the News recap share), traded players' results, Stats links
  removed (500 on 63 players' pages, 128 on the 32 team-defense pages; every
  one pointed at a URL that 302s, checked by exact href count), the QB FAQ
  wording, "1 yard"/"1 catch". The only exception is 22 News pages whose team
  headlines arrived between the two servers' feed fetches (live feed timing).
  No title, canonical, robots, H1 or "through Week" number changed (local data
  has no Thursday game, so the Outlook week fix is shown by its test).
- **Sitemap list vs reality**: for all 649 roster rows x 4 optional sections
  (2,596 URLs), every URL listed empty returns 302 and every other returns 200.
- **Regression tests**: new tests fail on the original code and pass on the fix
  (traded game log 4 of 5 fail before; Outlook week 1 fails before).
- **Full suite** (90 files, serially, against the production code d4d63e2 run
  the same way): production 1,771 pass / 14 fail / 1 skipped; branch (c9f84bc) 1,784
  pass / 14 fail / 1 skipped. The 13 extra passes are the new tests. The 14 failures
  are the same named tests in every file (the known data-drift set: matchup 1,
  player-outlook-title 1, player 3, schedule 3, table-armour 2, team-coaching 1,
  team-depth-chart 2, team 1).

## I. Production readiness

- **Ready after your approval** (app publish, no plugin change, no purge needed
  beyond the normal release purge): 824a429, ed83bcc, fa457ee, 902e7c9, 028c733.
  The sitemap change takes effect when the plugin next reads `/embed/players.json`.
- **Ready, but SEO surface (your explicit OK)**: b6ff460 (JSON-LD dateModified),
  ea92984 and 3ac34f4 (FAQ and FAQPage text).
- **Needs another owner or a decision**: L1, D3/D4/D6, D13 (team session);
  C1/C3/C7 (plugin release after 1.10.60); FP-1, FP-5, FP-8 (WP Rocket
  settings); SEO-6 (WordPress page titles and the two duplicate pages);
  SEO-14 wording.
- **Blocked on data**: anything about rankings, cannibalization or index rules
  until Search Console exports exist.
- **Rollback**: the app publish rolls back to d4d63e2 (publish 468f99a) by
  switching to it and publishing; no data or plugin state to undo.
- **Release order** (cache audit): publish, wait for `/embed/assets.json` to
  show the new build and a fresh render to print the new `ver=`, wait 5 more
  minutes, then purge WP Rocket (desktop and mobile), then the edge, then warm
  phone first. Inside the 14:00-16:00 UTC release window (docs/RELEASE-WINDOW.md).
