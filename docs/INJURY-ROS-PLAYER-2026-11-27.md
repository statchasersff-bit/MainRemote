# Player pages: injury status, games missed and ROS freshness re-check (2026-11-27)

Items 2 (WEB-039/030) and 3 (WEB-034) of the player-page audit re-check. Branch `fix/player-inj-2026-11-27`, base main 401e3618 (production = plugin 1.10.76 + API build ebb0c4d6). Code commit **03da23c7**. Nothing pushed, published, purged or written to WordPress. Plugin version unchanged. No PHP change.

Calendar note: in the stored schedule, today (Friday 2026-11-27) is **Week 12**, not Week 13. GB @ LA was Wednesday 11-25, CHI @ DET, PHI @ DAL and KC @ BUF were Thanksgiving, DEN @ PIT is today at 3:00 PM ET, and the Sunday and Monday games follow. Detroit has played Week 12, so Pacheco's next game is Week 13.

Environments used below:

- **live**: statchasers.com, read-only, browser UA, 5 hub reads 4 s apart at 12:37 UTC, plus the ROS hub at 12:14 UTC. A hub ships all seven panels, so one read covers the header, Overview, Outlook and Injury tab.
- **local**: this worktree, `node ./build.mjs`, server on :8092. Data is the committed snapshot: game logs through Week 11, the practice report as read 2026-11-25 17:08Z, and the live Sleeper roster.
- **local-sim**: the local server with one input changed in place, then restored and checked with `git status` / md5.

## Item 2: injury status and games missed

### What still held (verified, not redone)

The 11-26 work holds, and these were not redone:

- One resolver: `gameAvailability`, through `currentStatus`, feeds the header, Outlook, Injury tab, FAQ and the matchup preview.
- A reserve list is `kind: "reserve"`, separate from a game designation.
- A week with no report reads "Game designation pending".
- `matchupAdviceOff` gates the IR Outlook.

Live Pacheco (IR) reads the same on every surface:

| Surface | Reads |
|---|---|
| Header | "IR", "On injured reserve (back) On IR" |
| Overview | "has not played in 2026. On IR (back)." |
| Start FAQ | "No: Isiah Pacheco is on injured reserve for Week 13 at the Falcons, so he should sit." |
| Outlook risk | "Injury He's on injured reserve, back. Weak efficiency ..." (no tough-matchup advice) |
| Injury tab | "2026 games missed 11", "Latest injury Injured reserve Week 1, 2026, 11 games missed", "missed 11 games to injury this season" |

Production has Detroit's Week 12 log; local has 10 through Week 11.

### What still reproduced (live, 2026-11-27 12:37 UTC)

**F1. A game he played ended the injury window, so later Out and IR weeks fell out of every count.**

- `https://statchasers.com/nfl/players/alec-pierce/` reads "On injured reserve (heel)", "2026 games missed 0", "Latest injury Foot Week 1, 2026, 9 games missed" and "Last played Week 2, Sep 20".
- `https://statchasers.com/nfl/players/michael-pittman-jr/` reads "2026 games missed 2" and "Last played Week 4, Oct 1". The same page's history reads "Foot 7 games missed ... out since Week 2 (7 games missed so far)". The durability card reads "Foot / Toe (3 occurrences, 2 games missed)" and "Week 2 Foot Missed 1 game and returned in Week 3". The FAQ reads "missed 2 games to injury in 2026 and played in 3" beside "cost him 14 games in all: 7 for a foot injury in 2026, ... 1 for a foot injury in 2026".
- Cause: `games-missed.ts` ended a window at the first game he played after the entry's week. Pierce played Weeks 1-2 while listed, was Out in Week 3 and has been on IR since. Pittman played Weeks 3-4 while listed Questionable, was Out in Week 5, and was on IR from Week 6 to Week 11. Their Out and IR weeks became "not played, reason unknown".
- Local scan of all 368 players with 2026 entries: 8 players change, and each now equals the history builder's own total: Pierce 0->9, Pittman 2->7, Shipley 0->4, Gilliam 1->5, DeVonta Smith 2->5, DJ Moore 0->2, Spears 2->3, Brevin Jordan 1->2.

**F2. History rows did not add up to the season total.**

- The builder counts a week under two entries when an IR stint overlaps a listing (Malik Willis: "out since Week 10 (2 games missed so far)" on both his groin and his IR stint, beside "2026 games missed 2").
- Its stale "out since Week 4 (5 games)" outlived a return. Terry McLaurin played Weeks 5 and 6: rows 5 + 4 beside a total of 5.
- The 11-26 open-window override was keyed by week. Bowers' Week 10 ankle and quad both took the open count, so his rows summed to 4 beside "2026 games missed 3".

**F3. A player who missed his last game read "Game designation pending" even after the final report cleared him.**

- `availability.ts` returned `pending` for "on this week's report, no status, missed last game", whatever the report state.
- Live Pittman (game today, 3:00 PM ET; Thursday Nov 26 report "Tue Full | Wed Full | Thu Full No status") reads "Status pending Game designation pending for Week 12 after missing Week 11."
- Whether production's report state is already final I cannot see from outside (no endpoint exposes the report fetch time). Locally the rule was pending even with a read inside 30 h of kickoff (local-sim B before the fix).

**F4. FAQ and start advice ignored a pending status.**

- Locally, Pittman's Injury FAQ said "is active with no injury designation" and "has no injury designation for Week 12 ..., so he is on track to play", beside "Status pending".
- Live Bowers (pending, missed Week 11) reads "Should I start Brock Bowers in Week 12? Brock Bowers is a weekly starter in 12-team leagues ..." with no availability caveat.

### What changed (commit 03da23c7)

**`src/lib/player/games-missed.ts`**

- A window runs at least to its entry's last report week. A played game inside it is skipped, not the end.
- Entries are walked in week order, and each missed week counts for one entry, the earliest (the builder's rule).
- A window that loses a week to an earlier entry records `sharedWith {week, type}`.
- With `stillOut`, the running stint is the window holding his latest missed game (Pittman: the Week 2 foot, not the Week 11 re-listing). It is marked open and runs to the last completed game. Before, the open stint was always the latest entry.

**`src/lib/player/player-data.ts` `withOpenWindows`**

- Every current-season history row takes its window's count. Only the outcome tail of the builder's description is rewritten, in the builder's own words ("; out since Week N (K games missed so far).", "; missed Weeks a and b.").
- A row with no games of its own, whose games another entry counts, gets `countedUnder` and the tail "; the games he missed then are counted under his Week 2 foot injury."
- Windows are matched to rows by position, not by week.

**Renderers**

- `injury-tab-data.ts` / `injury-tab.ts`: the chip reads "Counted under Week 2 foot", the latest-injury card "games counted under Week 2 foot", and the FAQ "The games he missed while it was listed are counted under his Week 2 foot injury."
- `injury-durability.ts`: the episode reads "Did not play while listed; those games are counted under the Week 2 foot." It used to read "Listed Questionable ... but didn't miss a game".

**`src/lib/matchup/availability.ts`**

- "Missed last game, no status" is `pending` only while the report is not final. Once it is final he is `active`, labeled "No game designation".
- This is shared with the preview Injury Watch.

**FAQ wording**

- `injury-tab.ts` FAQ: a pending player gets the not-yet wording. The game-day answer says "Check the inactive list" instead of "expected to be active" unless a final report cleared him.
- `faq-pools.ts`, Overview start FAQ: a caveat for pending ("He did not play in Week 11 and has no Week 12 game designation yet, so check the final injury report before lineups lock.") and for Questionable or Doubtful ("He is listed questionable for Week N, so check his status before kickoff.").

### Counter definitions (what each displayed count measures)

All of these are one calculation now: `seasonAvailability` windows.

| Count | Where | Definition |
|---|---|---|
| "2026 games missed" | Injury tab tile, hub Season Status, FAQ "missed N games to injury" | His club's completed regular-season games he did not play inside an injury window. Byes are skipped. Weeks before a mid-season signing are not charged. |
| History row "N games missed" | Injury tab | The same windows, one per entry, disjoint, so the rows add up to the tile. |
| Latest injury "N games missed" / "games counted under ..." | Injury tab card | The latest entry's row. |
| Region total, episode text | Durability card | The union of that region's windows. |
| "Not played, reason unknown" | Grid "-" / Bye-Inactive | A completed club game not played that no window covers. Never called an injury. |
| Grid | Durability card | The `weekCodes` of the same record. |

Same period, same definition, same number. Checked locally on Pittman, Pierce, Bowers, Willis, McLaurin, Charbonnet, McMillan and Pacheco (rows sum = tile = FAQ = region).

### The three scenarios (local, after the fix)

**IR: Isiah Pacheco** (live reads the same, with 11 for Detroit's Week 12)

| Surface | Reads |
|---|---|
| Header | "RB · IR", "On injured reserve (back) On IR" |
| Overview | "has not played in 2026. On IR (back)." |
| Start FAQ | "No: Isiah Pacheco is on injured reserve for Week 13 at the Falcons, so he should sit." |
| Outlook | risk "Injury He's on injured reserve, back. Weak efficiency ..."; "He is on injured reserve, so these matchups matter only once he is activated." |
| Injury tab | "2026 games missed 10", "Latest injury Injured reserve Week 1, 2026, 10 games missed". The open stint runs across the rollover. |

**IR, the F1 case: Alec Pierce**

| | Reads |
|---|---|
| Before (live) | "2026 games missed 0" beside "9 games missed" |
| After (local) | "2026 games missed 9", "missed 9 games to injury in 2026 and played in 2", Durability "Still out, 9 games missed so far". Start FAQ: "on injured reserve for Week 12 against the Giants, so he should sit." |

**Cleared after a previous Q: Michael Pittman Jr.** (Q in Week 11, did not play; Week 12 report Tue/Wed/Thu Full, no status; game Fri 3:00 PM ET)

| | local-sim A: report as stored (read 11-25 17:08Z, > 30 h before kickoff) = pending | local-sim B: same report read 11-27 02:30Z (inside 30 h) = final |
|---|---|---|
| Header | "WR · Pending" | "WR · Active" |
| Injury tab status | "Status pending Game designation pending for Week 12 after missing Week 11. ... Missed Week 11; no Week 12 game status yet (practice: Full Tue)." | "No game designation for Week 12 against the Broncos. No game designation for Week 12. Practice: Full Tue. Listed Questionable for Week 11." |
| FAQ injured? | "has no injury designation for Week 12 yet; the club's game statuses are not out. He has missed 7 games to injury this season." | "is active with no injury designation. He has missed 7 games to injury this season." |
| FAQ playing this week? | "... yet; the club's game statuses are not out. He did not play in Week 11." | "... so he is on track to play." |
| FAQ playing today? | "... Check the inactive list, released about 90 minutes before kickoff." | "... He is expected to be active barring a late change." |
| Preview Injury Watch (DEN @ PIT) | "0 designated · 3 reserve · 2 game designation pending" | "0 designated · 3 reserve · report as of ..." |
| Counts (both) | "2026 games missed 7"; rows "Foot 7 games missed Week 2 ... out since Week 2 (7 games missed so far)" and "Foot Counted under Week 2 foot Week 11"; "Latest injury Foot Week 11, 2026, games counted under Week 2 foot" | same |

Live today: "Status pending ..." and "2026 games missed 2" (F1 and F3). After deploy it reads column B if production's last report read is inside 30 h of kickoff, else column A.

The prior Q expires either way: no surface reads Questionable for Week 12.

**Awaiting this week's report: Brock Bowers** (Q Week 11, did not play; Sunday night game, Fri report due; live grid "Wed Limited | Thu Limited | Fri due Nov 27")

| Surface | Reads |
|---|---|
| Header | live and local "TE · Pending" |
| Injury tab | "Status pending Game designation pending for Week 12 after missing Week 11. No Week 12 game designation reported yet." |
| Start FAQ, before (live) | "Brock Bowers is a weekly starter in 12-team leagues for Week 12 at the Browns ... a favorable matchup." |
| Start FAQ, after (local) | the same, plus "He did not play in Week 11 and has no Week 12 game designation yet, so check the final injury report before lineups lock." |
| Counts | "2026 games missed 3" = rows knee 2 + ankle 1 + quad "Counted under Week 10 ankle". Before: quad "1 game missed", which summed to 4. |

The rollover rules (Burden across the bye, St. Brown cleared, an expired designation) are still covered by the 11-26 data-accuracy tests, which pass.

### /injury-impact gridiron.json (Pacheco 5 vs 10)

**Not rebuilt; documented.** `data/injury-impact/gridiron.json` is packed by `scripts/injury-impact/buildData.mjs` from the research app's pipeline output (statchasersff-bit/RESEARCH-Injury-Impact-Analysis, `public/data/gridiron_dataset.json`). `refresh.mjs` cannot move it, so there is no cheap local rebuild.

The tool labels the period on the page: the source line "... 2026 through week 6", from `gridiron.json.source`, printed by render-tool.ts and render-gm.ts. So its 5 is a labeled different period, not the same count unlabeled.

The player pages already override the current season (`withSeasonOnPage`). Applying the same override to the tool's profile, rankings and event tables is possible but touches three tool surfaces whose scores are pack-relative. It is left for mak, as a repack (research pipeline owner) or an overlay.

## Item 3: ROS rank and date

### Where "October 22" comes from

**Source snapshot, not a cache and not a display bug.**

- `data/rankings/ros-2026.meta.json`: `updatedAt "October 22, 2026"`, `updatedAtIso 2026-10-22T00:00:00-04:00`, committed in 338f8ea0 (2026-10-22). No later board was installed.
- Live `https://statchasers.com/fantasy-football/rest-of-season-rankings/` (12:14 UTC) still reads "Rankings updated October 22, 2026" and "updated October 22, 2026" on each position table. The FAQ reads "as of October 22, 2026" and "This board was last updated October 22, 2026."

Path:

1. `getRankings(season, "ros")` (rankings-data.ts, cached on file mtime).
2. Then one of two consumers:
   - the board route `/embed/rankings?board=ros`, through the plugin to the ROS page, where the date prints as is; or
   - `rosRank()` (outlook-context.ts), which returns `{rank, updatedAt, updatedAtIso, stale}` with stale meaning more than `ROS_STALE_DAYS` = 7 in season. It feeds `PlayerPageData.rosRank` into the Outlook "Best fit" note and the chips, and into the Outlook FAQ "What is X's rest-of-season fantasy ranking?". No other player component reads it: the header and Overview print the season PPG/total rank, labeled.

Live player pages already hold the WEB-034 rule:

- `https://statchasers.com/nfl/players/lamar-jackson/` (IR, thumb): "Based on his PPR points-per-game rank this season, QB18. The rest-of-season board (QB4) was last updated October 22 and is not used for current advice."
- Bowers: "Based on his PPR points-per-game rank this season, TE1. The rest-of-season board (TE1) was last updated October 22 and is not used for current advice."
- The FAQ answers with the season rank only, labeled "in PPR points per game through Week 11".

### Refresh cadence

There is no ROS generation job. The board is mak's hand-pasted CSV (docs/REFERENCE-PAGES-2026-11-20.md), installed with `node scripts/rankings/check-ros.mjs <candidate.csv> --date YYYY-MM-DD --install`. That writes `data/rankings/ros-2026.csv` and `ros-2026.meta.json` (date from one input), then commit, Publish and purge.

Assumed cadence: **weekly in season**. That is the 7-day `ROS_STALE_DAYS` guard, and the FAQ says "updated throughout the NFL season". No doc names a day. **The upstream fix belongs to the rankings owner (mak): a new board through check-ros.mjs into `data/rankings/ros-2026.csv` + `.meta.json`.** No code can make October current.

### What was wrong in the cache path (fixed in 03da23c7)

Reproduced on HEAD (local, same server, no restart):

1. Rendered with the October board.
2. Installed a newer board with check-ros.mjs (`--date 2026-11-26`; Lamar QB9, Bowers TE2).
3. The player Outlook **still read the October sentence**. `dataStamp()` is computed once per process and the fragment cache key had no ROS part.
4. A meta-only date correction did not move the board page's date. getRankings was keyed on the CSV mtime only.

In production a Publish restarts the process, which masks step 3 for a new board. The same key gap also let a fragment rendered while the board was fresh outlive the 7-day cutoff until another key part changed.

Changes:

- `rankings-data.ts`: the version includes the meta file's mtime.
- `player-data.ts playerDataVersion`: adds `rank.updatedAtIso.(s|f)`.
- `outlook-context.ts rosRank`: a board whose meta season is not the page season returns null (treated as missing).
- `outlook-tab.ts` FAQ: a current ROS rank is dated: "..., and QB9 on the StatChasers rest-of-season board (updated November 26)."

### Renders (local, Lamar Jackson and Brock Bowers Outlook, one server, no restart between steps; board files restored after, md5 checked)

| State | Lamar note | Lamar FAQ | Bowers note |
|---|---|---|---|
| 1 stale (Oct 22, as committed) | "Based on his PPR points-per-game rank this season, QB18. The rest-of-season board (QB4) was last updated October 22 and is not used for current advice." | "is the QB18 in PPR points per game through Week 11. That puts him in QB2 territory, a bench stash ..." | "... TE1. The rest-of-season board (TE1) was last updated October 22 and is not used for current advice." |
| 2 fresh (installed, dated Nov 26) | "Based on his StatChasers rest-of-season rank, QB9 (updated November 26)." | "..., and QB9 on the StatChasers rest-of-season board (updated November 26). That puts him in QB1 territory, a bench stash ..." (stash: he is on IR) | "Based on his StatChasers rest-of-season rank, TE2 (updated November 26)." |
| 3 missing (CSV removed) | "Based on his PPR points-per-game rank this season, QB18." (no board sentence) | season rank only | "... TE1." |
| 4 other season (meta season 2025) | as missing | as missing | as missing |
| 5 stale again | as 1 | as 1 | as 1 |
| 6 fresh again | as 2: current advice resumes with QB9 and the source date | as 2 | as 2 |
| 7 meta-only date fix (Nov 25) | "QB9 (updated November 25)" | | "TE2 (updated November 25)" |

The board page in state 2 reads "Rankings updated November 26, 2026".

On HEAD, step 2 read as step 1, and step 7 left the board page at "November 26".

The weekly-vs-ROS labels: where both appear (Outlook note and FAQ), the season rank is "his PPR points-per-game rank this season" / "in PPR points per game through Week 11", and the board rank is "StatChasers rest-of-season rank ... (updated <date>)". A stale rank appears once, dated, as "not used for current advice".

## Tests (worktree, `env -u INGEST_SECRET node --test --test-concurrency=1`)

| Suite | Result |
|---|---|
| data-accuracy | 83/83 (4 new) |
| player-injury-tab | 34/34 (1 new) |
| player-outlook-tab | 42/42 (1 assertion added) |
| player-overview | 29/29 (1 new) |
| ros-freshness-cache (new) | 2/2 |
| rankings | 45/45 |
| ros-check | 6/6 |
| injury-watch | 6/6 |
| build-injury-history | 19/19 |
| injury-impact | 29/29 |
| team-season-phase | 19/19 |
| player-header | 23/23 |
| player-seo-refresh | 7/7 |
| player-faq-schema | 4/4 |
| player | 153/153 |
| team-roster-depth | 3/3 |
| matchup | 82/83 |

The one matchup failure is the Wild Card H1 test, which also fails on main (documented 11-24b).

The new window, availability and ROS tests each fail on the pre-fix code (checked by swapping the file back). `tsc --noEmit` is clean. The ros-freshness-cache test rewrites `data/rankings/ros-2026.*` in place and restores bytes and mtimes in `finally`.

## SEO surfaces (for mak)

No titles, meta, H1, JSON-LD types or FAQ schema structure changed. Visible FAQ = FAQPage schema, so these answer wordings change in both. All are status-driven (the 11-26 pattern) except the last, which is freshness-driven.

1. Injury tab "Is X injured?" for a pending player: "No. As of {date}, X has no injury designation for Week N yet; the club's game statuses are not out." Was "is active with no injury designation".
2. Injury tab "Is X playing this week?" for a pending player: "... for Week N ... yet; the club's game statuses are not out. He did not play in Week M." Was "... so he is on track to play".
3. Injury tab "Is X playing today?" without a final report: ends "Check the inactive list, released about 90 minutes before kickoff." Was "He is expected to be active barring a late change".
4. Injury tab "What was X's most recent injury?" for a counted-under entry: "The games he missed while it was listed are counted under his Week 2 foot injury." Was "He played through it and missed no regular-season games".
5. Overview "Should I start X in Week N?" gets one appended sentence for pending, Questionable or Doubtful (above).
6. Injury tab FAQ games-missed answers now carry the corrected counts (Pittman 2 -> 7, Pierce 0 -> 9, and the 8 players above).
7. Outlook "What is X's rest-of-season fantasy ranking?" dates a current ROS rank: "(updated {Month D})". This is dormant until a new board is installed.

## Open / for mak

- A new ROS board (rankings owner). Until one is installed, the ROS hub prints October 22 as its date (true), and the player pages keep refusing it for advice.
- Whether the ROS hub itself should say the board is older than 7 days (an editorial line on that page). Not changed.
- The /injury-impact tool's 2026 rows: a repack from the research pipeline, or an overlay of the page's season count (see above).
- `buildInjuryHistory.mjs` still double-attributes stint and listing weeks, and writes "played through" for co-listed injuries. The page corrects both at render. A builder fix is the weekly-chain owner's.
- Production's practice-report fetch time is not visible from outside. If Pittman still reads "pending" after deploy on a game day, check that the 21:00/23:30/02:30 UTC reads ran (Thanksgiving week).
- Not mine, seen in passing: Lamar's header "QB18 POS RANK" (PPG) beside the Stats chart "2026 16.0 (QB30), in progress" (a different basis, unlabeled). That is item 1+6's rank labels.
