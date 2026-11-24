# Team-page audit, 2026-11-24: five tasks, one candidate

Integration branch `integ/team-audit-2026-11-24` (worktree `.local/teamaudit/integ`),
based on the published commit `2d0bd3b` (release/2026-11-24, plugin 1.10.64).
Shipped as plugin **1.10.66** on top of the live matchup release (API 38d5199, plugin 1.10.65), release branch `release/2026-11-24c`.
Local only: not pushed, not deployed, nothing purged.

| Task | Branch @ commit | Merge |
|---|---|---|
| 1 WEB-044 finish | fix/team-audit-t1-2026-11-24 @ fbb7b74 | 86b7ff7 |
| 2 Coaching metrics (WEB-043) | fix/team-audit-t2-2026-11-24 @ 7ca6c71 | d7a6022 (conflict in coaching-fantasy-premium.ts + team.css resolved, both sides kept) |
| 3 Usage receiving yards | fix/team-audit-t3-2026-11-24 @ 16c6eca | ea469b7 |
| 4 Hub FAQ | fix/team-audit-t4-2026-11-24 @ 6c16a02 | 35fc796 |
| 5 SEO, links, schedule | fix/team-audit-t5-2026-11-24 @ 497e7d4, 55b2baa | 57e3013 (team.css, both kept) |
| Plugin 1.10.65 | | 6b142e0 |

## Tests

Full suite (`node --test --test-concurrency=1 tests/*.test.mjs`, `INGEST_SECRET` unset):

| Build | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| 2d0bd3b (published) | 1,917 | 1,914 | 2 | 1 |
| candidate | 1,937 | 1,934 | 2 | 1 |

The same two tests fail on both builds: "the Wild Card: one H1 in the hero..." and "a player card is its
own fragment, and an unknown one is a 404". The skip is data-dependent (no deebo-samuel profile).
No regressions. New test files: team-audit-t1, team-coaching-metrics, usage-receiving-reconcile,
team-faq-schema. Plugin: build-zip.sh lint + load + smoke pass.

## Task 1: WEB-044

Already in production (4c6ed3d, 0611c5d, c084b06): one Coaching table per dataset, Usage names once,
id-based Usage links, finishes links, Stats Season History once, roster link.

Added here:
- Same-surname players in Fantasy Finishes keep their initial on phones ("A. St. Brown", "M. Brown"),
  or the full name when initials clash too (DET, ARI, CHI, KC, TEN).
- Historical finish links need a game-log row for that club and season (no match by today's roster).

Detroit, 7c3e646 vs candidate code, same data: Coaching 134.4 KB -> 126.5 KB, 1,648 -> 1,410
elements, duplicated rows 8 -> 0, player links 0 -> 15 (all correct, incl. Goff, Gibbs, St. Brown,
LaPorta; Marquise Brown plain text, no published profile). Stats 3 -> 3 links (it names no other
players). Usage rows repeating a name 29/29 -> 0/29, links 38 -> 69.
Roster link "Lions roster & depth chart" -> /nfl/teams/detroit-lions/depth-chart/, in server HTML at
every width, visible under a 680px header; 32/32 destinations 200 + self-canonical live.

## Task 2: Coaching metrics (all 32 routes, tests/team-coaching-metrics.test.mjs)

- Play-caller span from one model: "Target Distribution Under Petzing, 2023-2026" (FAQ agrees);
  gaps print as runs (NE "2016-2023, 2025-2026").
- Period line: "2026 regular season through Week 11 (10 games) compared with the full 2025 regular
  season, when the previous staff called plays. Rate changes are in percentage points (pp): 53.0% to
  56.0% is +3.0 pp."
- Changes in pp, one decimal per row: play-action "25.5% | 30.3% | +4.8 pp | 22.4% | 3rd-highest of 32".
  This supersedes the 11-19 "pts" convention on Coaching only.
- Ranks name group and direction: "T-10th-fastest of 32" (neutral pace, "0.6 seconds faster").
- Benchmarks period-matched: "NFL 2026" column; distribution card's NFL figure = same seasons.
- Partial season: "Peak PPG 23.5 · 2024 ARI · full season"; "Current PPG 28.8 · 2026 · thru Wk 11 ·
  10 games"; season row "2026 In progress · 10 games".
- Repetition (DET visible text): PPG 5 -> 3, lead-back share 3 -> 2, rate figures in FAQ answers
  633 -> 0 league-wide; no questions removed.
- Open: coaching data not rebuilt (builder now stores raw values; renderer pads 1-decimal values
  until the next refreshTeamMetrics). A one-line scope note under two cards bends the 11-21 "no notes"
  rule. Phone tendency rows ~14px taller.

## Task 3: Usage receiving yards

Root cause: lateral yards. Week 4 DET at CAR, play 4069: St. Brown 4-yard catch, lateral to Gibbs for
9. nflverse carries those in lateral_receiving_yards; buildUsage.mjs ignored them until 6cf67b9
(11-19, already live). Usage 375 vs game logs 384 on the 11-18 snapshot (8bb9692); 404 = 404 today.
Historical: 455 pairs, 14 mismatches (11 lateral, 3 QB catches backfilled 11-19), 0 unexplained.
Current: 463 pairs, 0 mismatches; 3,563 game rows, 0 differences.
Rerun: `node scripts/team/reconcileUsageReceiving.mjs 2026 [--pbp <dir>]` (exits 1 on unexplained).
Side finding: 5 Usage rows lack a sleeperId (unlinkable), yards match.

## Task 4: Hub FAQ

Detroit 21 -> 6; all 32 hubs 20-21 -> 5-6. No Search Console access found; selection by rule
(own-tab data and cutoff, not a re-listing of a visible card, not asked by a tab page).
Kept: record, injuries with roles, backfield next in line, usage moves, 2027 picks, cap space.
Removed: next game, top scorers, leaders, offense rank, first-round history, classes, cap hits,
dead money, release savings, best value, contract count.
tests/team-faq-schema.test.mjs runs the plugin's own PHP FAQ functions against all 32 served hubs:
visible == FAQPage, exactly one FAQPage after Rank Math's merge. PASS.

## Task 5: SEO surface and links

- Inventory 257 = directory + 32 hubs + 32 x 7 tabs (usage, coaching, stats, schedule, depth-chart,
  matchups, news); Draft/Contracts are hub hash panels. The audit's 224 = tab entries; its "30
  unreached" is most likely Matchups (off the hub strip by design, reachable only via Depth Chart).
  Schedule's "More" list now links Matchups too.
- Team routes join the WEB-021 page-identity mechanism: Organization -> WebSite -> WebPage at
  {canonical}#webpage, hub FAQ folded in; brand card (media 7458, 1200x630 png) as fallback og:image /
  twitter:image, page featured images kept.
- Descriptions over 160: 102 of 256 -> 0 (longest 158), none identical. Stored hub (140-146) and
  directory (122) descriptions untouched; both still say "offensive depth chart".
- Hub breadcrumb item now the team name (was the tab H1). Structured-data label change: needs OK.
- Schedule tab: "{Team} 2025 Results" board, 285 games / 570 links, all 200, 0 unresolved
  (BUF-MIA 2025-week-3 and 2025-week-10 each to their own page).
- Local crawl: 257 URLs 200, 0 unreachable, 0 broken links. The live scan could not run (uncached team
  pages were timing out after today's release). Run after deploy:
  `node artifacts/api-server/scripts/team/scanTeamPages.mjs https://statchasers.com --games`

## Integrated Detroit check (candidate, headless Chromium, CDP emulation, local data)

Hub, Coaching, Usage, Stats, Schedule at 390 / 768 / 1280: no page overflow (390, 753, 1265), no
clipped table headers, roster link in HTML on hub + three tabs (visible at 390), Coaching pp + period
line present and no "pts", 15 Coaching / 3 Stats player links, Schedule 17 links to 2025 games.

## Not changed / for mak

- Usage still prints "pp" in its share columns (e.g. "-9.5 pp"); identical on 2d0bd3b, so already live.
- SEO-surface changes (FAQ/FAQPage, descriptions, og:image, schema graph, breadcrumb name) on the team
  family: the release window rule allows one per 3-4 weeks and team hubs had one on 11-20.
- Not checked: physical phone, live Divi template on the candidate, real Rank Math output.

## After deploy (needs mak's OK)

Upload plugin 1.10.65, publish the API, `pnpm purge-and-warm`, then the live scan above,
`reconcileUsageReceiving.mjs`, and a curl of Detroit hub/coaching/schedule heads for og:image,
#webpage, one FAQPage.

## Plugin version

The matchup candidate shipped first as 1.10.65 (API 38d5199, 19:45 UTC). This release is 1.10.66 on
top of it (mak: ship both; WEB-001 included in the matchup half).
