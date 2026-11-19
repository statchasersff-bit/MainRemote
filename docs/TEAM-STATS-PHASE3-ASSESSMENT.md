# Team Pages Phase 3: Team Stats tab, assessment

Branch `team-hubs-phase3-stats`, based on `881d857` (Phase 2 + 2B + the
overview scoring alignment). Audited 2026-11-19 on New England, Detroit,
Atlanta, San Francisco (top offense), Tennessee (bottom on both sides) and
Jacksonville (2nd in points allowed), from the served `/team/<slug>/stats/`
HTML and the data files, measured with Chromium (device emulation, 844px
tall) at 390, 768 and 1280.

## 1. Inventory

One template for all 32 clubs: `renderTeamStats()` (team-render.ts) builds
the input, `renderStatsPremium()` (team/stats-premium.ts) draws it.

| # | Section | Rows (value, rank) | Source |
|---|---|---|---|
| 0 | Tab banner: H2 "{Nick} Team Stats {season}" + generic dek | - | - |
| 1 | Offense / Defense panels | Points/G, Total Yds/G, Pass Yds/G, Rush Yds/G, 1st Downs/G, 3rd Down % (both sides) | efficiency file `box` -> stats.ts league table |
| 2 | Efficiency band: Offense / Defense Efficiency | EPA/Play, EPA/DB, EPA/Rush, Success Rate, Explosive %, Yds/Play, Yds/Pass Att, Yds/Carry, Passer Rtg | efficiency file ladders |
| 3 | Pass Protection & Pass Rush | Blitz %, EPA vs Blitz, EPA vs 4-Man, Time to Throw, Sacks (allowed / made) | efficiency file (FTN + Next Gen) |
| 4 | Possession & Discipline: "Turnovers, Downs & Penalties" | TO Margin, Takeaways, Giveaways, 4th Down %, Penalty Yds/G | league table |
| 5 | Pace & Play Style | Plays/G, Opp Plays/G, Pass Att/G, Carries/G, Pass TD, Rush TD; Play Mix (offense, defense) | league table |
| 6 | Season History (5 seasons) | Pts/G, Yds/G, Yds/Play, Pts All, Yds All, TO +/- with ranks | efficiency files 2022-2026 |
| 7 | FAQ (8 questions, FAQPage) | restates 1, 5, 6 | stats-faq.ts |

No interactive controls; no links (no player is named). One rendering for
every width (no hidden desktop/mobile copies); 768 nodes in the panel.
Title "{Team} Stats 2026: Offense, Defense & NFL Rankings" (ladder),
description "points, yards, pace and play mix...", H1 on WordPress "{Team}
Stats 2026".

## 2. Verified errors and inconsistencies

**E1. One statistic, two ranks.** Yds/Play is printed twice: in Offense
Efficiency (ranked on the two-decimal value in the builder: NE 5.68 ties the
Rams' 5.68, "T-7th") and in Season History (stats.ts ranks the raw value:
5.678 vs 5.684, "8th"). Same cause as the Phase 2B Usage/Coaching ranks; any
club sharing a printed value with another can show it.

**E2. No data-through label.** The tab receives its week but never prints
it; the only time context is "10 games" inside the history table.

**E3. Week cutoff not coordinated.** The efficiency builder counts every week
present in the play-by-play; it is not part of the Phase 2B completed-week
cutoff. Today it agrees (Week 10), by timing, not by rule.

**E4. Defense labels.** The Defense panel prints "Points/G", "Total Yds/G",
"Pass Yds/G"... with the offense's words; "allowed" lives only in hidden text.

**E5. Mixed sides in one list.** "Turnovers, Downs & Penalties" mixes a team
figure (TO margin), a defensive one (takeaways), offensive ones (giveaways,
4th down %) and a discipline one (penalty yards) under one heading.

**E6. Rank direction mostly implicit.** "1st is best" is said once in a band
that phones hide; volume rows (Time to Throw "1st", Blitz %, Plays/G) rank
most-to-least with no good end, and a reader cannot tell which is which.

**E7. No league average anywhere.** Bars show percentile; a value has no
NFL reference point.

## 3. Repetition and height

- Season History's 2026 row repeats six figures already in panels 1-4.
- FAQ answers restate panel figures (by design for FAQ).
- Offense and Defense production overlap the hub Overview's Offense &
  Defense card (Phase 1) - different page, kept, but the Stats tab should
  lead with what the Overview does not have.
- Height: panel 3,250px at 390, 3,153px at 768 (single column), 2,003px at
  1280; FAQ 567-706px. 768 is nearly as tall as a phone.

## 4. Recommended hierarchy

A. **Team Performance Snapshot** - six cards: points scored / allowed per
   game, yards gained / allowed per game, EPA per play / allowed. Value,
   rank "of 32" with tier, NFL average marker, offense and defense colored
   apart.
B. **Offense** - grouped: Scoring & yardage, Passing, Rushing, Situational
   (3rd down, 4th down, red-zone TD rate, giveaways), Efficiency (EPA,
   success, explosive). Each row: value, NFL average, rank.
C. **Defense** - the same groups, "allowed" wording, plus Pass rush (sacks,
   blitz) and Takeaways.
D. **Recent form** - last three completed games vs the season for points
   for/against, yards per play and EPA per play on both sides, with the
   play counts; no narrative sentences.
E. **Detailed statistics** - Pass protection / pass rush detail, Pace &
   Play Style (play mix stays a box-score split, labeled), Season History,
   definitions in a disclosure.

## 5. Visualizations

- Snapshot cards and every grouped row: a one-line bar from league worst to
  best with the club's mark and an NFL-average tick (direction-aware, so
  right is always better; volume rows draw no "better" end).
- Recent form: paired figures (season / last 3) with a direction arrow only
  when the move clears a stated threshold.
- No decorative charts.

## 6. Data limitations

- No pressure rate, no time to pressure, no coverage data (not free).
- Red-zone TD rate and last-3 splits are not in the file today; both are
  computable from the play-by-play the builder already reads (drive result
  `fixed_drive_result`, per-game tallies). Three games is ~180 plays a side:
  shown as figures with samples, never as a trend claim.
- Defensive individual stats (sacks, interceptions by player) are not in the
  player game logs; offensive leaders are, so only offense names link.

## 7. Plan and tests

1. Ranks: rank every Stats row on its published value (stats.ts), the Phase
   2B rule; test that a metric printed twice carries one rank.
2. Builder: completed-week cutoff (`--through`, shared module), snapshot,
   red-zone TD rate (off/def), per-game tallies for last 3; join
   refreshTeamMetrics.mjs so Usage, Coaching and Stats publish together.
3. Renderer: new stats-premium.ts structure A-E, one responsive markup,
   league averages computed at render from the file's 32 clubs.
4. Offensive leaders with player-page links (game logs).
5. Tests: snapshot equality across three files; rank uniqueness; defense
   labels; averages; recent-form sample floor; FAQPage = visible questions;
   32-club sweep; Divi sim at 390/768/1280; heights vs this baseline.

## 8. Baseline measurements

| Club | 390 panel / page | 768 panel / page | 1280 panel / page | Nodes |
|---|---|---|---|---|
| NE | 3,243 / 4,254 | 3,153 / 4,229 | 2,003 / 2,922 | 768 |
| DET | 3,250 / 4,240 | 3,153 / 4,229 | 2,003 / 2,922 | 768 |
| ATL | 3,251 / 4,261 | 3,153 / 4,243 | 2,003 / 2,922 | 768 |
| SF | 3,251 / 4,240 | 3,153 / 4,243 | 2,003 / 2,922 | 768 |
| TEN | 3,243 / 4,233 | 3,153 / 4,229 | 2,003 / 2,922 | 768 |
| JAX | 3,244 / 4,255 | 3,153 / 4,229 | 2,003 / 2,922 | 768 |

HTML about 99KB per page.

## 9. Implemented (2026-11-19)

| Error | Fix |
|---|---|
| E1 two ranks | stats.ts ranks on the published value; test: Yds/Play carries one rank in the group and in Season History |
| E2 no week | dek: "... through Week N (G games)", from the efficiency file's snapshot |
| E3 cutoff | buildEfficiency.mjs uses the shared completed-week cutoff and joins refreshTeamMetrics.mjs; usage, coaching and efficiency files carry one snapshot (test) |
| E4 labels | every defensive row reads "Allowed" (or Sacks / Takeaways / Opp 3rd Down, the defense's own) |
| E5 mixed list | split: giveaways and 4th down under Offense, takeaways under Defense, TO margin and penalties under Discipline |
| E6 direction | every rank pill says "higher/lower is better" or "ranked most to least" to screen readers; scale bars run worst to best (right is better); volume rows untinted |
| E7 averages | NFL average on every card and row = mean of the 32 clubs' printed values (test) |

Structure: A snapshot (6 cards) beside D recent form on desktop, B offense
(4 groups + linked passing/rushing/receiving leaders), C defense (4 groups), E
detail (pass protection, pass rush, discipline, snaps, play mix folded in one
closed `details`; Season History open; "How these are measured" disclosure).
Sacks print once a side. Play Mix keeps its box-score caption and the
definitions note how it differs from the Coaching pass rate. Title,
description, canonical, URL, H1 and FAQ unchanged.

New data (efficiency file): red-zone TD rate per drive (offense / defense,
trips, rank) and last-three-games tallies (points, plays, EPA, success).
Recent form prints figures with play counts and an arrow only past 3 points,
0.05 EPA or 3 percentage points; no narrative.

### After measurements (same six clubs, same method)

| Width | Panel before -> after | Page before -> after |
|---|---|---|
| 390 | 3,243-3,251 -> 3,085-3,113 (-5%) | 4,233-4,261 -> 4,081-4,124 |
| 768 | 3,153 -> 2,494 (-21%) | 4,229-4,243 -> 3,570-3,584 |
| 1280 | 2,003 -> 1,995 (0%) | 2,922 -> 2,913 |

No horizontal scroll, 0 duplicate IDs at every width. Nodes in the panel 768
-> ~958 (the folded detail stays in the HTML). HTML ~99KB -> ~111KB. The
page carries more (averages, scales, red zone, recent form, leaders) in the
same or less height.

32-club sweep: dashboard on every club, 33 grouped rows + 6 cards, NFL
average on every row, recent form and linked leaders present, no NaN /
undefined / em dash, no duplicate IDs, FAQPage equals the visible questions.

## 10. Release readiness (2026-11-19, final)

### Injury-status dependency

The week-aware rule lives in `matchup/availability.ts` and
`player/current-status.ts` (f0b8e67, scoring line) and, since a930333, in the
release branch's `team/current-injuries.ts` (currentRoster,
currentDepthCharts, injuryFreshness) applied once in `getTeamPageData()`.
Phase 3 carries none of it: e05567b backed out the copy fd3e698 had made.
The integration branch inherits it from the release. Regression tests there:
a synthetic Sione Vaki case on injected game logs and practice reports
(Questionable for Week 10 and played -> no Week 11 designation; missed ->
Pending; IR stands; a fresh Week 11 report keeps Questionable) and a live DET
check that the overview, its FAQ and his player page agree.

Raw-status audit (before a930333): overview contributor badges
(overview.ts injuryBadge), the archived outlook card pin
(outlook-premium.ts), the News tab Injury Watch (news-premium.ts reading
data.injuries: DET showed Vaki Questionable) and the Depth Chart tab (the
depth feed's own week-less Q/D/O codes, depth-faq.ts sentences). a930333
normalizes data.injuries and the depth charts at the source, so every one of
these now reads the current status.

### Metric checks (all 32 clubs, integration build)

- Rank, direction, NFL average and scale position of all 33 grouped metrics
  recomputed from the 32 printed values: 0 mismatches. Defense rows are
  lower-is-better except Sacks/G and Takeaways/G; volume rows untinted.
- Season totals were ranked across unequal games (Week 10: 20 clubs on 9
  games, 12 on 10). Now shown, ranked and averaged per game; total printed
  under the label.
- No metric in the 2026 file is null; a missing value prints "-" with an empty
  scale, an average needs 22+ clubs, red zone / recent form drop out when
  absent.
- Dek: "League data through Week N; {Team} games played: G."
- Recent form = the club's last three games played (byes skipped: HOU 7, 9,
  10; DEN 7, 8, 9). Arrow copy says it is descriptive, not a significance test.
- Red zone: trips counted only passes and runs, missing drives that reached
  the 18 and kicked. Rule now: a pass, run, field-goal try or spike snapped at
  the 20 or closer; kneel-only drives excluded. Independent pbp recount: 32/32
  clubs match both sides. Versus nflverse drive_inside20: 20 drives we count
  (snap at exactly the 20), 9 it counts (8 kneel-only, 1 penalty-only).
- 4th Down prints its denominator ("10 of 13"; fewest attempts 6).
- Snapshots: usage, coaching and efficiency carry one snapshot
  (2026, Week 10, 18376:11093, team-rate-metrics/1); refreshTeamMetrics.mjs
  now copies all three, then renames all three. Rebuilding on the integration
  branch reproduces the committed files byte for byte (build stamps aside);
  the shared definitions and the Usage/Coaching builders are unchanged from
  Phase 2.

### Tests (clean detached worktrees, symlinked node_modules, one file at a time, env -u INGEST_SECRET)

| Run | Tests | Pass | Fail |
|---|---|---|---|
| Phase 2 head 881d857 | 1,635 | 1,620 | 14 |
| Phase 3 7c074ab | 1,639 | 1,624 | 14 |
| Release 6d86178 | 1,690 | 1,675 | 14 |
| Integration 89d4dbe | 1,709 | 1,694 | 14 |

Both pairs: the same 14 failures by file, test name and failure reason
(matchup Wild Card title; player-outlook-title; player x3 data drift;
schedule x3 ESPN sweep; table-armour x2; team carson-beck script;
team-coaching Maye QB rank; team-depth-chart PIT links and MIA PK slot).
Note: suites must not run in parallel; fpa, fpa-refresh, freshness, ingest
and ingest-routes write the shared database and fail when two runs overlap.
