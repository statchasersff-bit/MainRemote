# Team Pages Phase 2: Offensive Coaching & Scheme, assessment

Branch `team-hubs-phase2-coaching`, based on the Phase 1 release commit `6cf67b9`.
Audited 2026-11-19 on New England (returning caller, 20-season history),
Detroit (new caller, LOW continuity) and Atlanta (new caller, same scheme family),
from the served HTML and the data files (`data/team/coaching_2026.json`,
`data/team/usage_2026.json`), measured with Chromium at 390x844 and 1280.

## 1. Inventory (what renders, top to bottom)

All 32 clubs render the same template: `renderCoachingSection()` in
`src/lib/team/coaching-render.ts` mounts five modules.

| # | Section (module) | Contents | Metrics |
|---|---|---|---|
| 1 | Header + coordinator card (`coaching-premium.ts`) | Navy tab banner, dek; card: kicker (long + phone short), name, lineage + tree chips, context line (long + phone short), "Coaching continuity" state + note | Continuity rating |
| 2 | Offensive Identity (`coaching-premium.ts`) | 4 tiles + 1 sentence | RZ pass rate, motion, shotgun, PROE, each "+x% vs 2025" |
| 3 | Play Calling table | Metric, 2025, 2026, change + dumbbell, rank (edges only) | Pass rate, PROE, early-down pass rate, RZ pass rate (+ play sample), play-action rate |
| 4 | Formations & Tempo table + Formation Profile | Same table shape; donut (desktop) or segment bar (phone); legend; "not charted" note | Motion, no-huddle, neutral pace; shotgun vs under center + NFL avg |
| 5 | Situational Play Calling (`coaching-premium-tendencies.ts`) | Score state bars (leading / within 7 / trailing, vs "Baseline"); Fourth-Down Decisions (desktop stack + phone tiles, both in the HTML); caution note | Pass rate by score state + play counts; 4th-and-2 go rate 2026, 2025, NFL avg |
| 6 | Target & Backfield Tendencies | Target distribution bars vs NFL; backfield share bars by season | WR/TE/RB target share pooled 2016-2026; lead-back share of weighted opportunities |
| 7 | Coaching Career & Historical Performance (`coaching-career-premium.ts` + `coaching-seasons-premium.ts`) | Career History (closed details), PPG chart (4 SVG copies), KPI stack (desktop) + KPI row (phone), Season by Season table (desktop) + season list (phone), legend | Peak PPG, current PPG, NFL rank, seasons calling, per-season PPG/rank/target shares/lead RB |
| 8 | Fantasy Implications (`coaching-fantasy-premium.ts`) | One paragraph | Restates sections 2 and 6 as fantasy readings |
| 9 | Fantasy Finishes by Season | Table (desktop, all rows) + list (phone, 5 then Show all), note + "How finishes are calculated" | QB/RB1/WR1/TE1 PPR finish per season |
| 10 | FAQ tail (`coaching-faq.ts`) | 16 questions, in the page's FAQPage | Restates sections 1-9 |

Size (New England): panel 3,751px tall at 390 + FAQ 1,276px; 4,158px at 1280
+ FAQ 990px; 218.5KB HTML; 2,825 nodes in the panel. Detroit: 3,657 / 3,695px,
141.6KB.

## 2. Errors and inconsistencies found

**E1. Two sources, two precisions, one row (data).** For four rows (pass rate,
PROE, RZ pass rate, pace) `rowView()` replaces the coaching file's 2026 value
with the Usage file's (`view.team.env`), which rounds pass rates to whole
numbers, while the 2025 value stays the coaching builder's one-decimal figure.
The change is the difference of the two: NE pass rate prints 61% and "+0.5%"
where the coaching file holds 60.8% (a +0.3 move, below the page's own
"steady" threshold). DET "57% / −2.4%" has the same artifact.

**E2. Two ranks for one metric (data).** The two builders define red-zone pass
rate differently (Usage: dropbacks / (dropbacks + designed runs); Coaching:
every non-pass snap counts as a run). NE's 65% is "1st in NFL" in the coaching
file and 3rd in the Usage file; the page prints 3rd beside a value and a 2025
figure from the other definition.

**E3. Percentage points printed as percent (units).** Every rate change is a
percentage-point difference printed with "%": "+11.0% vs 2025" (54% -> 65% is
+11 points, a +20% relative change), score state "+14%", target distribution
"−4%", season table "↑up 2". This follows the 2026-11-06 house rule (pp -> %),
which is what makes these read as relative changes.

**E4. Ranks unclear and inconsistent.** A rank appears only at the edges
(top 10 / bottom 5), inside the Change column, so "3rd" reads as the rank of
the change. Direction is unstated (3rd highest? 3rd fastest?). Fourth-down
"NFL average 75%" and target "NFL 59%" are averages, never ranks; season table
"30th in window" uses a partial-season population.

**E5. Mixed comparison periods.** Section 2-4: 2026 through Week N vs 2025
full season. Section 5: 2026 only. Section 6: 2016-2026 pooled, with the
current partial season weighted the same as a full season (unweighted mean of
season shares). Section 7: 2005-2026. Section 9: 2016-2026. Only some headings
name their window.

**E6. Comparisons across a coaching change.** For a new caller (DET, ATL and
the other LOW / MEDIUM clubs) the 2025 column is a different staff ("prev.
staff" in small type), but the identity tiles and "Change" column read as a
trend. Backfield bars pad with the previous staff's seasons marked "*".

## 3. Repetition

| Figure | Where it prints (NE) |
|---|---|
| Red-zone pass rate 65% / +11 | Identity tile, Play Calling row, Fantasy Implications prose, FAQ |
| Shotgun 60.6% | Identity tile, donut, segment bar (phone, in HTML at every width), FAQ |
| Pre-snap motion 55.4% / +2.5 | Identity tile, Formations row, FAQ |
| PROE −1.2% / −3.9 | Identity tile, Play Calling row, FAQ |
| Current PPG 22.1, 18th | Career KPI stack, phone KPI row, season table 2026 row, phone season list; also Stats tab and hub Overview |
| 4th-down 3 of 3, 100% | Desktop stack and phone tiles (both in HTML), caution note, FAQ |
| Season history | Desktop table and phone list (both in HTML) |
| Fantasy finishes | Desktop table and phone list (both in HTML), note + "How finishes are calculated" (same sentence twice) |
| Career PPG chart | Four SVG copies (wide, narrow, phone-s, phone-m): 47KB, 539 nodes |
| Pass rate, PROE, RZ pass rate, pace | Also the Usage tab's environment cards |

Explanations repeated: the table legend, the "not charted" note, the season
table legend and the finishes note are always-open paragraphs; definitions
exist twice (row popovers + FAQ answers).

## 4. Recommended layout

1. **Header + coordinator card** (kept; one kicker/context, phone short form via CSS).
2. **Scheme at a glance** (replaces Identity tiles + both tables): ONE table of
   every tendency, grouped "Play calling" / "Formations & tempo", columns
   `2025` · `2026 thru Wk N` · `Change` · `NFL avg` · `NFL rank`, with the
   dumbbell (2025 -> 2026 against the NFL tick) as the visual. Shotgun returns
   as a row (no donut). The identity sentence sits above it as the summary.
   For a new caller the 2025 column header names the previous play-caller and
   the change column reads "vs prior staff".
3. **Situations** (kept, compacted): score-state bars with the difference
   labelled "vs leading"; fourth down rendered once.
4. **Target & backfield** (kept): window in the heading, note that the current
   season counts as one season.
5. **Career & history** (kept): one chart SVG per layout instead of four
   where possible, one KPI block, season table with 5 rows + Show all.
6. **Fantasy** (kept): implications paragraph; finishes table 5 rows + Show
   all on desktop too; one methodology line.
7. **Notes**: legend, "not charted" and methodology move into one closed
   "How these are measured" disclosure.
8. **FAQ**: trim to distinct questions (pending decision, see section 8).

## 5. Desktop and mobile

Desktop: two tables and four tiles become one table (~450px saved at 1280);
finishes collapse to 5 rows (~350px); notes fold (~120px). Mobile: the same
single table in the existing compact phone treatment; one fourth-down block;
notes folded. Target: panel 25-35% shorter at both widths with no figure
removed from the page (the identity tile figures all remain as table rows).

## 6. Visualizations

- Dumbbell per tendency (kept, now the only rendering of those figures), NFL
  average tick, NFL rank pill with direction ("3rd highest", "14th fastest").
- Score state: horizontal bars with the leading-by-7 bar as the reference.
- Target distribution: bars with the NFL marker (kept).
- Career PPG: kept as the line chart.
- Not proposed: anything needing data we do not have (weekly tendency
  sparklines, personnel groupings).

## 7. Data integrity plan

- One source per row: the coaching file's own 2025 and 2026 values (same
  builder, same definition, both one decimal) for every row; the Usage
  override in `rowView()` is retired. Changes from the one-decimal values.
- Ranks computed at render time over the 32 clubs' 2026 values in the same
  file (same definition, same week window), shown for every row with its
  direction; ties share the rank ("T-3rd").
- Notation (pending decision): point differences and relative changes never
  share a symbol.
- New caller: the comparison is labelled as a staff comparison, not a trend.
- No builder rerun is needed; no value is estimated.

## 8. Decisions (mak, 2026-11-19)

1. Percentage-point changes print as "pts" ("+11.0 pts"), with "percentage
   points" spelled out in headers and tooltips; relative changes keep "%".
   This supersedes the 2026-11-06 "% not pp" rule on the Coaching tab.
2. The coaching FAQ is trimmed to about 8 distinct questions; the FAQPage
   keeps matching the visible questions.

## 9. Risks and tests

- Coaching values freshen only when `buildCoaching.mjs` runs (hand-run, like
  Usage): retiring the live override can show a staler 2026 value if the two
  builders are run on different days. Mitigation: a test that both files carry
  the same through-week.
- team-coaching.test.mjs pins many class names and texts (identity tiles,
  two tables, donut); those tests change with the layout.
- Phone layouts are container-query driven; check 320/390/768/1280 and the
  Divi sim.
- Tests to add: one source per row (2026 value equals the coaching file),
  rank population and direction, notation (no rate change printed with a bare
  "%"), new-caller labelling, no duplicated fourth-down block, section heights.

## 10. Built (2026-11-19) and measured

Built on `team-hubs-phase2-coaching`:

- One Offensive Tendencies table (group rows Play Calling / Formations &
  Tempo; shotgun back as a row), columns 2025 · 2026 thru Wk N · Change (pts)
  with the dumbbell · NFL avg + rank. Identity tiles and the donut removed;
  the identity sentence is the summary. New callers: "Previous staff" /
  "vs previous staff", and the disclosure says the change is a change of
  caller.
- One source per row (E1): `rowView()` reads both seasons from the coaching
  file; the usage override is retired. NE pass rate now 60.8% / steady (was
  61% / +0.5).
- Ranks (E2, E4): `leagueTendencyValues()` ranks every row over the 32 clubs'
  values in the same file, with direction ("14th highest", "T-14th fastest")
  and ties; edge-only pills removed.
- Notation (E3): "pts" for point changes everywhere on the page (table,
  score state "+14 pts" vs a "Reference" row, target distribution, season
  table "pts vs lg"); singular "pt".
- Windows (E5): the table heading names "2026 through Week N vs 2025";
  the target distribution says each season counts equally.
- Fourth down printed once (tiles at every width).
- Fantasy finishes: newest first, five then Show all at every width; the
  note and the method are one disclosure.
- Legend + not-charted note + rank population: one "How these are
  measured" disclosure.
- FAQ 16 -> 8 (FAQPage still equals the visible questions); FAQ answers
  read the table's own numbers.
- Touch targets: metric buttons and both Show all links >= 24px.

Measured (Chromium, 390x844 and 1280, heading-to-heading):

| Club | Width | Panel | FAQ | Page |
|---|---|---|---|---|
| NE | 390 | 3,751 -> 3,514 (-6%) | 1,276 -> 727 | 5,323 -> 4,538 (-15%) |
| NE | 1280 | 4,158 -> 3,532 (-15%) | 990 -> 567 | 5,491 -> 4,442 (-19%) |
| DET | 390 | 3,657 -> 3,373 (-8%) | 1,255 -> 727 | 5,208 -> 4,397 (-16%) |
| DET | 1280 | 3,695 -> 3,340 (-10%) | 990 -> 567 | 5,028 -> 4,250 (-15%) |
| ATL | 390 | 3,462 -> 3,193 (-8%) | 1,276 -> 727 | 5,035 -> 4,217 (-16%) |
| ATL | 1280 | 3,537 -> 3,181 (-10%) | 990 -> 567 | 4,869 -> 4,092 (-16%) |

HTML: NE 219.7 -> 211.7KB, DET 141.9 -> 134.3KB, ATL 129.2 -> 121.7KB.
The tendencies block alone at 1280: 1,017px (tiles + two tables) -> 703px.
The panel came in short of the 25-35% estimate: the career block (832px at
1280) and the history tables were not restructured.

Validation: all 32 coaching pages swept (values = file, ranks recomputed,
pts notation, FAQ 6-8 = FAQPage, no duplicate ids, staff labels); full suite
1,624 tests, the same 14 failures as the Phase 1 release baseline, none new;
Divi sim on the live NE coaching page at 320/390/768/1280: no overflow, no
duplicate ids, one H1, FAQ and disclosure work, no console errors, no small
targets.

## 11. Still open (as of Phase 2; see section 12 for what 2B closed)

- Usage tab vs Coaching tab: the two builders define pass and red-zone plays
  differently, so the Usage tab can show a different red-zone rate/rank
  (NE: Usage 3rd, Coaching T-1st). Fixing means one shared definition in
  `buildUsage.mjs` / `buildCoaching.mjs` and a rebuild.
- The coaching values refresh only when `buildCoaching.mjs` runs; the Usage
  file used to make four rows fresher. Run both together.
- Career PPG chart still ships four SVG copies (47KB on NE); one responsive
  SVG would need its own design pass.
- Desktop CLS 0.29-0.30 on the coaching page comes from the Divi main area
  and the team header hero, identical on the unmodified production page.
- FAQ scheme answer reads "... play action on 20.3% of dropbacks, below it
  on motion." (pre-existing wording in coaching-faq.ts).

## 12. Phase 2B (2026-11-19): shared definitions, coordinated refresh, cleanup

### Overlapping metrics, before

| | Usage builder (before) | Coaching builder (before) |
|---|---|---|
| Season / weeks | REG; every week in the pbp file | REG; every week in the pbp file; "through Week N" read from the usage file on disk |
| Counted snap | play_type pass/run, not 2pt/kneel/spike, AND flagged `pass`=1 or `rush`=1 | play_type pass/run, not 2pt/kneel/spike (unflagged snaps counted) |
| Pass | `pass`=1 (dropbacks: sacks and scrambles are passes) | same |
| Red zone | yardline_100 <= 20 at the snap | same |
| PROE | mean `pass_oe` over the counted snaps | mean `pass_oe` over its counted snaps |
| Pace | neutral (wp 0.2-0.8, >2:00 in half), same drive, gaps <= 60s, before the kneel filter | identical code |
| Precision | pass rate and RZ rate whole numbers; PROE, pace 1 dp | pass rate 1 dp; RZ rate whole number |
| Rank | on the raw value | on the rounded value (whole-number RZ manufactured ties) |
| Postseason | excluded | excluded |

### After: one module

`scripts/team/team-rate-metrics.mjs` defines the counted snap (flagged pass or
designed run; the unflagged snaps are not classifiable as a call), the five
rates (pass, red-zone, inside-10, PROE, pace), one decimal everywhere, ranks
over the published values (ties share the better rank, pace fastest first),
snap-weighted league rates, and the completed-week cutoff (the last week with
every scheduled game in the pbp). Both builders call it; neither carries its
own copy.

### Files rebuilt

`data/team/usage_2026.json` and `data/team/coaching_2026.json` (2025 comparison
values recomputed with the same rules), through Week 10, fingerprint
18376:11093, by `scripts/team/refreshTeamMetrics.mjs`. Before: 30 club/metric
values differed between the two files (rounding and the snap definition);
after: 0, and every rank agrees. NE red-zone: Usage "65%, 3rd" / Coaching
"T-1st" before, both 64.9% T-2nd after.

### Coordinated refresh

`refreshTeamMetrics.mjs` downloads the pbp once, runs both builders into a
staging directory, and publishes both only when their snapshots (season,
completed-through week, fingerprint, definitions) match; a refusal or a
mismatch leaves the live files untouched. The daily chain (live-refresh.ts)
calls it in place of the two separate steps. The Coaching page prints the
snapshot's week and build date in "How these are measured".

### Intentional differences

- Stats tab "Play Mix": box-score split (attempts + sacks vs rushing
  attempts; scrambles and kneels are runs). Now captioned as such.
- Coaching per-club "Thru Wk N": the club's last played week (a bye team
  reads one week earlier than the league snapshot), by design.
- Coaching-only metrics (early-down, no-huddle, shotgun, motion,
  play-action, fourth down, score state) are not reported by Usage.

### Cross-tab checks (all 32 clubs)

Usage = Coaching for pass rate, RZ rate, PROE, pace (values and ranks);
Coaching current PPG and rank = Stats tab points per game and rank;
committed snapshots equal. Tests: tests/team-rate-metrics.test.mjs and the
"cross-tab" block in tests/team-coaching.test.mjs.

### Chart

One desktop drawing (the 720-wide layout, `is-wide`) at every width above
560px instead of two; the two phone drawings stay (SVG text scales with the
drawing). NE: 4 copies 47.1KB / 539 nodes -> 3 copies 35.8KB / 413 nodes.

### Cleanup

FAQ scheme answer rewritten (figures with their NFL averages, then one
comparison sentence). League averages at the row's precision. Keyboard:
every disclosure, the chart points, Show all toggles, FAQ and definition
popovers reached by Tab and opened by Enter/Space at 390 and 1280.

### Layout shift

docs/CLS-SITE-HEADER-2026-11-19.md: the 0.285 desktop shift is
`#et-main-area` moving 361px when Divi's late header CSS lands, identical on
the unmodified production page; handed to the WordPress/Divi workstream.

### Measurements (390x844 and 1280, heading-to-heading)

| Club | Width | Panel before Phase 2 -> after 2B | Page | Nodes |
|---|---|---|---|---|
| NE | 390 | 3,751 -> 3,514 (-6%) | 5,323 -> 4,538 (-15%) | 2,825 -> 2,659 |
| NE | 1280 | 4,158 -> 3,548 (-15%) | 5,491 -> 4,458 (-19%) | |
| DET | 390 | 3,657 -> 3,325 (-9%) | 5,208 -> 4,348 (-17%) | 1,380 -> 1,293 |
| DET | 1280 | 3,695 -> 3,326 (-10%) | 5,028 -> 4,237 (-16%) | |
| ATL | 390 | 3,462 -> 3,193 (-8%) | 5,035 -> 4,217 (-16%) | 1,109 -> 1,030 |
| ATL | 1280 | 3,537 -> 3,192 (-10%) | 4,869 -> 4,102 (-16%) | |

HTML: NE 218.5 -> 200.1KB, DET 141.6 -> 130.8KB, ATL 129.0 -> 119.2KB.
