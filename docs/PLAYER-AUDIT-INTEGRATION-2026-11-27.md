# Player-page re-check: integration of items 1-6 (2026-11-27)

Branch `integ/player-audit-2026-11-27` (worktree .local/pa1127/integ), base main 401e3618.
Production at the start: API build ebb0c4d6 + plugin 1.10.76 (the 11-26 audit shipped as 1.10.74 on 11-26; the 11-26 scan's 1.10.72 is history).
Candidate: plugin **1.10.77** (1.10.75 = unreleased SOS candidate; whichever ships second carries the other).
Zip: .local/pa1127/statchasers-news-1.10.77.zip, sha256 632d53c07ea86ada963f0725ea95ea0d69da02d2ead87800887ee4a647c3d783 (round 2, API assets 069462be6fe4; supersedes 456235fb...).
Nothing pushed, published, purged or written to WordPress.

Item docs: docs/SCORING-LABELS-PLAYER-2026-11-27.md (1, 6), docs/INJURY-ROS-PLAYER-2026-11-27.md (2, 3),
docs/MOBILE-PERF-PLAYER-2026-11-27.md (4), docs/LINKS-FILTERS-PLAYER-2026-11-27.md (5).

## Commits

| Branch | Commit | Merge |
|---|---|---|
| fix/player-lnk-2026-11-27 (item 5) | ff2b54ac | 17d473ee |
| fix/player-s16-2026-11-27 (items 1, 6) | 0fc3eccc | 4106deef |
| fix/player-mob-2026-11-27 (item 4) | 042af914 | c34ef9c8 |
| fix/player-inj-2026-11-27 (items 2, 3) | 03da23c7, afac14fc | c8cd4147 |
| plugin 1.10.77 bump | 8e4fd69e | - |

All merges auto-resolved (faq-pools.ts, injury-tab.ts, outlook-tab.ts, player-data.ts, player-overview.test.mjs touched by two branches each, different hunks).

## Summary

| # | Original evidence | Reproduced 11-27 (live unless noted) | Changed | Tests | Verified in |
|---|---|---|---|---|---|
| 1 WEB-031/036 | St. Brown 2024 316.2 vs 311.9; 2021 227.3 vs 223.3; 2023 331.9 vs 330.9 | Totals correct: 2024 +4.3 = Wk 4 TD pass 7 yds (0.28 + 4); 2021 +4.0 = two 2-pt catches; 2023 page prints 330.9 (the provider's 331.9 adds an IDP forced fumble we do not score); controls 2022, 2025 reconcile; Goff 2024 336.5 with INT -1 (324.5 at -2). Hub = Stats = Game Log sum. FPA per-player input 1,249/1,304 to the cent, rest = FB classification + return fumbles. Reproduced: hub season block "FPTS" with no format | Hub block "PPR FPTS"/HALF/STD; Stats footer states every weight in every format | career-scoring 11/11 and 12 related files | live read-only + local |
| 2 WEB-039/030 | Burden Q header vs none on Injury tab; Pacheco counts disagree; IR matchup advice | 11-26 fixes hold (Pacheco IR everywhere, no matchup advice). New: games missed under-counted when a played game ended a window (Pierce 0 vs 9, Pittman 2 vs 7; 8 of 368 players); history rows not summing (Bowers 4 vs 3); cleared player stuck "pending"; FAQ "on track to play" while pending | games-missed.ts windows, player-data.ts row counts, availability.ts pending only before the final report, status-aware Injury/Overview FAQ | data-accuracy 83/83, player-injury-tab 34/34, player-overview 29/29 + 11 more | live read-only + local (sims documented) |
| 3 WEB-034 | ROS "updated October 22, 2026" | Still true: ros-2026.meta.json committed 10-22 and never replaced (source data, not cache). Player pages already refuse it ("not used for current advice"). Reproduced locally: a newer board did not reach the Outlook without a restart; a date-only fix did not reach the ROS page | ROS rank/date/staleness in playerDataVersion; rankings cache keyed on meta mtime; other-season board = missing; dated ROS rank in FAQ | ros-freshness-cache 2/2 (new), rankings 45/45, ros-check 6/6 | local (fresh / stale / missing / stale->fresh without restart) |
| 4 WEB-044/048/052 | ~6,500 DOM, CLS 0.191 at .scp-pid, TBT 219-879 | DOM 5,066 live (11-26 trim holds). CLS 0.18 Gibbs, 0.68-0.70 Hayden Large on every clean load: WP Rocket async-loads news.statchasers.com/player.css, Rocket's stale critical CSS lacks the phone hero rule, hero 930-1,010 px then collapses to 263 px; plus 8 px from a stale critical rule | player.css + bundle same-origin (assets/api/), excluded from Rocket async/minify/RUCSS; 8 px margin restated. No duplicated desktop/mobile tables/cards/FAQs found (DOM change 0) | player 153, header 23, smoke-local-assets, smoke.php | live (before) + production shell (before/after) |
| 5 WEB-017/020 | Redraft player shell links; ?log= links with nofollow | 0 shell links, 0 ?log= hrefs, 301s and canonicals correct. New: Rodgers hub links 6x to a 404 start/sit page; ~51 hubs link noindex start/sit pages; phone season menu dropped focus to body | Start/sit links only for slugs on Redraft's indexable start/sit sitemap (stored data/player/startsit_pages.json, 676, no render-time fetch); focus returns to menu button | header 24, startsit-pages 4 (new), player 154 + 7 more | live read-only + local Chromium |
| 6 WEB-035 | St. Brown 30-target pool + "51 TD"; Burden 107/138/111; Carter RB133 PPG vs total | Holds: "52 receiving TD", Burden 25th of 114 on every surface, Carter "RB134 by total points", Tyson (3 games) sample notice. New: snap share "22nd of 113" under a "114" note; A.J. Brown "among the 0 WRs"; Carter chart SR text PPG beside total rank | Counts named per row; out-of-field wording; REC YDS / REC TD on WR/TE hub block; SR text names basis | player-share-field 6/6, ppg-rank-consistency 11/11 | live read-only + local |

Regression checks: Gibbs Game Log vs FPA, PPR RB through Week 11, 11/11 opponents + next (ATL 5th) agree live and locally.
WP 4927/4929: 404 + noindex live; page-sitemap1-4 = 4,556 rows, 0 duplicates, tyson-bagent and dandre-swift once each.

## Mobile before/after (390x844 DPR 2, slow 4G + 4x CPU, cold cache, median / worst of 3)

| Page | CLS | TBT ms | FCP ms | LCP ms | DOM |
|---|---|---|---|---|---|
| Gibbs live | 0.18 / 0.18 | 497 / 634 | 672 / 696 | 2,524 / 2,760 | 5,066 |
| Gibbs shell before | 0 / 0.32 (0.83 incl. input-flagged) | 689 / 920 | 688 / 776 | 2,068 / 2,108 | 4,746 |
| Gibbs shell after | 0 / 0 | 327 / 344 | 1,668 / 1,728 | 2,060 / 2,176 | 4,746 |
| Large live | 0.68 / 0.70 | 200 / 548 | 496 / 796 | 704 / 1,324 | 870 |
| Large shell after | 0 / 0 | 117 / 287 | 1,668 / 1,848 | 2,000 / 2,160 | 865 |

Trade-off: first paint about 1 s later (render-blocking CSS). Lab only; re-run .local/pa1127/shots/mob/lab.mjs after release.

## Combined verification (this branch)

- Full API suite `env -u INGEST_SECRET node --test --test-concurrency=1 tests/*.test.mjs`: base 401e3618 2,055 / 2,051 pass / 3 fail / 1 skip; integ 2,075 / 2,071 / 3 / 1. Same three failures (Wild Card H1, RB handcuffs player card, schedule warm cache), all pre-existing.
- tsc server + client clean. Plugin: smoke.php all passed, smoke-local-assets all passed, smoke-rhr-embed 36/36; build-zip.sh parse/load/version/loader/api-manifest checks ok.
- Rendered on the integrated build (:8095, SC_SCORING_TOTALS=house): Gibbs hub 6 start/sit links, Rodgers 0, Bagent 0; "PPR FPTS"; St. Brown "Passing 1 TD, 7 yds (+4.3)"; Pierce "2026 games missed 9"; Pacheco Outlook 0 "Tough matchups"; Gibbs Game Log 0 `log=` hrefs.

## Needs mak

1. FCP trade for item 4 (CLS 0 vs ~1 s later first paint); alternative = inline critical header CSS from the API with player.css async (not built). Also regenerate WP Rocket critical CSS for the player template.
2. FAQ answer wording: seven status/freshness-driven answers (list in INJURY-ROS doc); the start/sit link removals on ~51 hubs.
3. Games-played definition: hub/header count snap-or-touch games, Stats counts every active game (Carter "2 games" vs "3 GP"; 136 players). Pick one.
4. Header "POS RANK" basis printed only in the tooltip (PPG after four games, total before).
5. robots.txt `Disallow: /nfl/*?log=` hides the ?log= 301s from Google; keep or lift. `?adv=` dead parameter.
6. Relink the now-populated (JS-only, noindex) Redraft app profile, or keep start/sit.
7. FPA: return fumbles and fullbacks excluded vs player pages; keep?

## Other owners

- Rankings (mak): install a current ROS board with `node scripts/rankings/check-ros.mjs <csv> --date YYYY-MM-DD --install` (writes data/rankings/ros-2026.csv + .meta.json), then commit, Publish, purge. No defined cadence; weekly in season assumed (7-day stale guard). Should the ROS hub warn past 7 days?
- Redraft: unknown /players/<id> = 200 empty shell; raw HTML meta robots index,follow vs header noindex; Rodgers' profile links its own 404 start/sit page.
- Hosting/WordPress: Rocket critical CSS regeneration; confirm Rocket honors the `news.statchasers.com/player.css` async exclusion.
- Research pipeline: /injury-impact gridiron.json (2026 through week 6) needs a repack; buildInjuryHistory.mjs overlapping weeks / "played through".
- Weekly chain: add `node scripts/player/buildStartSitPages.mjs` (scripts/player/README.md step 14). Matchup startSitFor() has the same gap.

## Release order (when mak says go)

1. Merge to main, Publish the API, wait for /api/status `datasets.build.commit` to show the new commit.
2. Upload 1.10.77 (carry 1.10.75 first if SOS ships before), `wp eval 'statchasers_news_run_upgrade_now();'`.
3. Clear WP Rocket (mobile too), then Rocket.net edge purge; iPhone UA check: player.css `rel='stylesheet'` from `assets/api/`, no `data-rocket-async`.
4. Re-run the lab script and the live checks in the item docs.

## Round 2: mak's decisions of 2026-11-27

1. **First paint: build the inline alternative** (e6198e80, merge 16348bf5). Every embedded fragment starts with `<style id="scp-critical">` (47 KB, 9.4 KB gzipped), generated from player.css by `scripts/player/critical-css.mjs` into `public/player-critical.css` (header, search, tab strip; `:where()` scoping keeps order) plus a 305-byte panel gate that holds the panels unpainted until player.css sets `--scp-sheet-*`. player.css is async again (Rocket async exclusion removed; still out of minify/RUCSS); the same-origin `assets/api/` move stays. Drift test tests/player-critical-css.test.mjs fails if player.css changes without regenerating (`node scripts/player/critical-css.mjs`, ~40 s).

   | Page (390, slow 4G + 4x CPU, cold, median / worst) | CLS | FCP ms | LCP ms | TBT ms | DOM |
   |---|---|---|---|---|---|
   | Gibbs live | 0.18 / 0.18 | 644 / 648 | 2,512 / 3,216 | 867 / 1,446 | 5,066 |
   | Gibbs round 1 (render-blocking) | 0 / 0 | 1,668 / 1,728 | 2,060 / 2,176 | 327 / 344 | 4,746 |
   | Gibbs round 2 (inline + async) | 0 / 0 | 648 / 684 | 2,844 / 2,896 | 906 / 1,116 | 4,747 |
   | Large live | 0.70 / 0.70 | 740 / 820 | 1,276 / 1,292 | 244 / 260 | 870 |
   | Large round 2 | 0 / 0 | 752 / 860 | 2,132 / 2,412 | 345 / 397 | 866 |

   Desktop 1366: Gibbs CLS 0.016, Large 0.010 (Divi's own deferred CSS). TBT is level with live, higher than round 1 (second style pass). Release: the API deploy must include public/player-critical.css; check the iPhone page has `<style id="scp-critical">` first in `.entry-content` and player.css from `assets/api/` with `data-rocket-async`. WP Rocket critical CSS regeneration is now optional.

3. **Games played = the Stats rule** (a7f3f972, merge 94653334). `ranks.ts hasParticipation()` = `gp > 0 || hasTouch()` (same as `isGamePlayed()`), so header FPPG/POS RANK, hub GP, Overview, Outlook, FAQ + schema, Game Log summary, weekly rates, peers rail and the team overview contributor G/PPR-G count every active game. Points unchanged. Abdullah 7 games / 1.6 / RB90 -> 10 / 1.1 / RB95 (= his Stats row); Gibbs unchanged; Carter's live 2-vs-3 case needs Week 12 data (unit test covers it). 136 players' 2026 GP/PPG change, 294 ranks move (30 switch total -> PPG basis), 3,923 historical Game Log summaries. PPG rank 4-game gate counts the new games; Stats card (4+) and usage (6+) pools stay on offensive-snap games (they rank shares over those games; criteria printed). FAQ templates unchanged, figures inside them change.

Main merged (b71a7b71, main 1d67b832: workspace-8f's matchup release). Final checks on b71a7b71: suite 2,081 / 2,077 / 3 / 1 (same three); tsc clean; smoke.php, smoke-local-assets, smoke-rhr-embed 36/36 pass; build-zip.sh all checks ok. Rendered (:8095): scp-critical first in the Gibbs fragment (47,276 bytes), 6 start/sit links, PPR FPTS; Abdullah "RB95 by points per game, 10 games"; Rodgers 0 start/sit; Pierce games missed 9; Pacheco 0 "Tough matchups".

Decisions 2 and 4-7 above are still open.
