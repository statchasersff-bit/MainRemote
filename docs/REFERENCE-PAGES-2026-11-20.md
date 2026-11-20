# Reference pages: ROS rankings, NFL stats tables, FPA (2026-11-20)

Follow-up to the 2026-11-18 audit (WEB-031..034). Production discovery was read-only.
Branch `reference-pages-fixes-2026-11-20`, based on the live release `2ed48aa`
(app code `5630f66`, plugin 1.10.59). Not merged, not published, no cache purged.

## What is live (checked 2026-11-20 15:24-15:45 UTC)

| Page | Public URL | Renders from | Date shown comes from |
|---|---|---|---|
| ROS rankings | /fantasy-football/rest-of-season-rankings/ (+ /qb/ /rb/ /wr/ /te/) | `[statchasers_ros_rankings]` -> API `/embed/rankings?board=ros` -> `data/rankings/ros-2026.csv` | `ros-2026.meta.json` `updatedAt` (hand-written with the paste) |
| NFL stats | /nfl/nfl-player-stats/ (QB), /nfl/nfl-player-stats/wr/ (and /rb/ /te/) | `[statchasers_player_stats]` -> `/embed/player-stats` -> `data/player-stats/{pos}_2026.json` (buildSeason.mjs, nflverse) | `data/dataset-meta.json` lastIngestedAt, else the file's `updated_at` |
| FPA | /nfl/fantasy-points-allowed-by-position/ | FPA plugin -> `/embed/fpa` -> DB `fantasy_points_allowed_snapshots` (in-server ingest) | newest snapshot row's insert time |

- `/api/status` build `5630f66` (built 14:36 UTC), plugin `statchasers-news` 1.10.59 active.
- `/api/status.datasets.crossCheck` = 521 players, 0 mismatches. It compares each stats-table
  row's main yardage (QB pass yds, RB rush yds, WR/TE rec yds) with the sum of that player's
  Sleeper game logs for the weeks the table covers. It does NOT compare fantasy points or games
  (FPTS in the table is re-scored from the same game logs, so it agrees by construction).

## Findings

| | Audit (11-18) | Today | Cause | Status |
|---|---|---|---|---|
| WEB-034 ROS | "Rankings updated October 22, 2026"; injured QB ranked 4th fed hub advice | Same date; Lamar Jackson (IR, thumb) still QB4 on the board. His Outlook now says "Based on his PPR points-per-game rank this season, QB18. The rest-of-season board (QB4) was last updated October 22 and is not used for current advice." | No job exists: the board is mak's hand-pasted CSV (commit 338f8ea, 10-22). Date = data. | Hub half fixed live (Phase 1 stale guard, >7 days). Board itself needs a new paste from mak. |
| WEB-032 stats | "Weeks 1-10 - Updated Nov 16" without LAC at BAL | "Weeks 1-10 - Updated November 19"; coverage 150/150 final games, latest included 2026_10_LAC_BAL; Herbert 9 G / 1,720 (8 / 1,591 without MNF) | Fixed in Phase 1 (coverage-based week labels). New: date printed in UTC, so the 02:00 UTC build (Nov 18, 9 pm ET) read "November 19". | Resolved live; date fixed on branch. |
| WEB-031 scoring | St. Brown 183.4 hub / 118.4 table; Lamar 80.1 / 79.1 | Table header "PPR FPTS"; St. Brown 183.4 and Lamar 80.1 on both | Table printed Standard with -2 INT under no label; Phase 1 re-scores the column from the game logs (house rule, -1 INT). | Resolved live. |
| WEB-033 FPA ranks | Gibbs: 7 of 9 opponents ranked differently (ARI 25th vs 13th) | All 13 Gibbs ranks (9 games + 4 upcoming) = live FPA PPR raw RB ranks; Lamar QB 5/5 and St. Brown WR 9/9 likewise. Game log says "today's season-to-date rank, not the rank before that game ... 1st allows the most ... Favorable 1-12, Neutral 13-20, Tough 21-32". | Phase 1: one rank source + one band scale. | Resolved live. |
| New (FPA week) | - | FPA page "Weeks 1-11 ... through Week 11" and start/sit "Week 12" with one Week 11 game played (IND at HOU); player pages "Measured through Week 11" | Snapshot week = highest week in nflverse's file. | Fixed on branch. |

## Branch changes (f69864a)

- `src/lib/fpa/week-coverage.ts` (new): last complete week from the club-weeks the FPA game rows
  hold, against the schedule's weeks and teams (never its scores); byes never hold a week back.
- `src/lib/fpa/fpa-data.ts`: live table reads that coverage (one `SELECT DISTINCT week, defense`
  per table build; the table is memoized a day and dropped by every ingest). `weekNumber` = last
  complete week; new `ingestedWeek`, `partialWeek`, `partialGames`; `dataMode` "Week 10 and 1
  Week 11 game". Blend weights/methodology still follow the ingest's week. Ranks unchanged.
- `src/lib/fpa-seo.ts`: Updated line and scope label add " and 1 Week 11 game (IND at HOU)".
  Title/H1/description wording unchanged (10-10 spec: last completed week).
- `src/lib/sos/sos-model.ts`, `src/lib/sos-render.ts`: baseline badge phase from the ingest's week.
- `src/lib/player-stats-render.ts`: Updated date in America/New_York.
- `src/lib/data-coverage.ts`: crossCheck docstring states what it compares.
- Tests: `tests/reference-pages.test.mjs` (16), `tests/fpa.test.mjs` regexes accept the partial suffix.
  Full suite: 1,756 = 1,741 pass / 14 fail / 1 skip; the 14 are production's known failures by name (Phase 7 baseline 1,740 + 16 new). tsc clean.

Rendered on the branch against the dev DB (ingest week 11, same as production):
title "Fantasy Points Allowed by Position 2026 (Weeks 1-10)"; Updated line "Updated Nov 20,
through Week 10 and 1 Week 11 game (IND at HOU)"; start/sit "Week 11"; Gibbs "Measured through
Week 10 and 1 Week 11 game."; SOS "Through Week 10: 10% 2025 baseline and 90% 2026 data.";
stats "Updated November 18, 2026". Gibbs's nine opponent ranks identical to production.

## Release preparation (2026-11-20 PM)

Live at prep time: app build `92e2567` (player speed fixes), Replit publish commit `1383a15`
(15:25 UTC; adds only `data/schedule/espn-layer-2026.json`), plugin 1.10.59. Phase 7
(`5630f66` code / `2ed48aa` publish) is an ancestor of `92e2567` and is no longer the base.

Release branch `release/reference-pages-2026-11-20` = `1383a15` +
- `4c43741` FPA last complete week, stats date in Eastern (cherry-pick of f69864a)
- `8583399` these notes (cherry-pick of de3326a)
- `9d53652` Start/Sit card week = the start/sit tool's week (Sleeper `/v1/state/nfl`, regular
  season and playoffs; the rule redraft-command's `server/nflState.ts` uses for "Who Should I
  Start in Week N?"), never the FPA table's; part of the fragment render version
- `24c178f` player Overview "Upcoming" note prints the chips' band cut (1st-12th favorable,
  21st-32nd tough); it said 1st-10th / 23rd-32nd beside chips on the Phase 1 scale

`git diff 1383a15 HEAD` is exactly the feature patch; all 14 files the player-speed release
changed are untouched. Trial merges with `player-desktop-cls-2026-11-20` and
`wp-cache-reliability-2026-11-20` (plugin 1.10.60 WIP) are clean.

Checks on 24c178f: tsc clean; `tests/reference-pages.test.mjs` 28/28; `tests/player-overview.test.mjs`
18/18. Full suite, base `1383a15` vs release, same machine, same dev DB, run back to back,
`env -u INGEST_SECRET`, concurrency 1, gitignored roster caches cleared first:
base 1,740 = 1,725 / 14 fail / 1 skip; release 1,769 = 1,754 / 14 fail / 1 skip. The 14 failures
are the same names; the skip is the same (no deebo-samuel profile in this data); +29 = new tests.

Same-DB comparison, base vs release servers: all seven FPA CSVs (3 formats x raw/adjusted +
2025 archive) byte-identical, so values and ranks are unchanged; default view still Half-PPR,
player pages still PPR. Visible text differs only in: FPA scope/Updated/title/H1/description/
answer week, Start/Sit "Week 11" (was "Week 12"), Gibbs "Measured through Week 10 and 1 Week 11
game", SOS "Through Week 10", stats "November 18".

## Release

1. App only: no plugin ZIP, no data refresh, no ordering constraint.
2. Switch the workspace to `release/reference-pages-2026-11-20` (24c178f) and Publish.
3. Caches, in order: WP Rocket (`rocket_clean_domain(); rocket_clean_minify();`, the FPA page is
   WP Rocket-cached), then the edge `wp cdn purge`. Plugin transients expire on their own
   (FPA 15 min, stats/SOS 1 h, player 5 min).
4. Verify with `.local/refpages/verify-live.sh` (read-only; desktop + iPhone; plain URL vs
   `?sc_probe=`). Baseline from before the publish: `.local/refpages/verify-live-before.txt`.
   Expected while Week 11 is partial: FPA "Weeks 1-10, 2026", "through Week 10 and N Week 11
   game(s)", card "Week 11"; Gibbs "Measured through Week 10 and N Week 11 game(s)." and
   "1st-12th favorable, 21st-32nd tough."; stats "Updated November 18, 2026" (or the next
   build's Eastern date); SOS "Through Week 10". After Monday's game is ingested: "Weeks 1-11",
   no partial words; the card stays "Week 11" until Sleeper rolls to Week 12 (Tuesday).
5. A stale page: plain old + probe new = edge (purge the URL); both old with the new build in
   /api/status = a fragment transient, possibly an orphan without expiry (coordinate with the
   wp-cache-reliability work; inspect with its inspect.php, delete nothing without mak).

Rollback: switch the workspace to `1383a15` (code `92e2567`, the live player-speed release) and
Publish, then the same two purges. No plugin or data step.

## Open, needs mak or production

- ROS board: a new board from mak, checked with `scripts/rankings/check-ros.mjs` (separate
  branch `ros-board-check-2026-11-20`) and shipped as its own release. Whether an injured
  player stays on it, and where, is the board's editorial call; no code change made.
- There is no ROS generation job, so "failed run keeps last good data" applies only to the
  WordPress side (30-day backup transient), which already holds.
- The game log deliberately shows today's season-to-date rank (labelled); a pregame rank view
  would be a new feature.
- The FPA page defaults to Half-PPR; player pages read PPR and say so.
- Matchup preview pages keep their own 1-10 / 23-32 matchup cut (preview-fantasy.ts); it drives
  their takeaways and their text says so, so it was left alone. One scale site-wide is mak's call.
