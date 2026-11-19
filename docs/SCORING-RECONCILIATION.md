# Fantasy scoring reconciliation, 2009-2026

Generated 2026-11-19 by `node artifacts/api-server/scripts/player/scoringReconciliationReport.mjs` (Phase 1.1). Every stored per-game PPR total (Sleeper's provider record, `pts_ppr`) compared with the StatChasers house rule computed from the same game's stat line (`src/lib/scoring/house-rules.ts`). Nothing was rewritten: provider totals stay stored as `pts_ppr` / `pts_half_ppr` / `pts_std`.

## House rule

Passing 0.04/yd, 4/TD, -1/INT. Rushing and receiving 0.1/yd, 6/TD. Reception 0 / 0.5 / 1 (Standard / Half / PPR). Fumble lost -2. Two-point conversion 2. Kick/punt-return or fumble-recovery TD 6. Kicker: FG 0-39 yds 3, 40-49 4, 50+ 5, extra point 1, any missed FG or XP -1 (same in every format; adopted from the matchup pages and the provider in Phase 1.1, replacing the hub's flat 3/1).

## Summary

- Player-weeks compared: **113,592**; identical: **107,142** (94.3%).
- `provider-fumble-penalty`: 5,854
- `provider-extra-event`: 494
- `provider-fumble-penalty+provider-extra-event`: 46
- `missing-input`: 33
- `unexplained`: 12
- `kicker-unexplained`: 7
- `house-only-event`: 4
- If displayed totals switched to the house rule (`SC_SCORING_TOTALS=house`): **3,018** of 10,391 player-seasons change, **1,100** players, seasons 2009-2026.

## Causes

| Cause | Classification | Meaning |
|---|---|---|
| provider-fumble-penalty | correct total under a different documented scoring | The provider's pre-2022 settings charge -1 for every fumble on top of -2 for a lost one. Present 2009-2021 and part of 2022, absent from 2023. Not a house rule. |
| provider-extra-event | source-specific scoring outside the house rules | Defensive or special-teams plays by an offensive player (blocked kick, forced fumble, fumble recovery, special-teams tackle, safety, interception) or a kick by a non-kicker. Stored in `px` / `st_fum_rec` / `idp_ff` since Phase 1.1. |
| house-only-event | house rule scores what the provider did not | A fumble-recovery TD (6) the provider total does not include. |
| missing-input | missing statistical input | Kicker weeks the provider gives no distance bands for (2011, 2015, 2016). The provider total stands. |
| unexplained / kicker-unexplained | unresolved | No stored event accounts for the difference. Listed below. |

No case of an incorrect calculation in our code remains: the earlier gaps (2-pt conversions, non-QB passing, QB receptions, return TDs, kicker distances) were missing inputs, now backfilled.

## By season

| Season | Weeks | Identical | Fumble penalty | Provider-only plays | Both | House-only | Missing input | Unexplained |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2009 | 2,481 | 2,179 | 289 | 12 | 1 | 0 | 0 | 0 |
| 2010 | 3,241 | 2,883 | 334 | 21 | 2 | 0 | 0 | 1 |
| 2011 | 4,054 | 3,687 | 346 | 19 | 1 | 0 | 1 | 0 |
| 2012 | 5,158 | 4,681 | 447 | 25 | 4 | 0 | 0 | 1 |
| 2013 | 6,119 | 5,636 | 443 | 35 | 4 | 0 | 0 | 1 |
| 2014 | 6,977 | 6,423 | 495 | 53 | 6 | 0 | 0 | 0 |
| 2015 | 7,333 | 6,753 | 516 | 35 | 3 | 0 | 20 | 6 |
| 2016 | 7,254 | 6,696 | 482 | 51 | 7 | 0 | 12 | 6 |
| 2017 | 7,137 | 6,644 | 451 | 35 | 6 | 0 | 0 | 1 |
| 2018 | 7,103 | 6,598 | 477 | 25 | 3 | 0 | 0 | 0 |
| 2019 | 7,029 | 6,515 | 474 | 36 | 4 | 0 | 0 | 0 |
| 2020 | 7,292 | 6,792 | 470 | 27 | 0 | 2 | 0 | 1 |
| 2021 | 7,793 | 7,233 | 524 | 33 | 0 | 2 | 0 | 1 |
| 2022 | 7,621 | 7,494 | 106 | 20 | 1 | 0 | 0 | 0 |
| 2023 | 7,604 | 7,583 | 0 | 19 | 2 | 0 | 0 | 0 |
| 2024 | 7,562 | 7,536 | 0 | 25 | 1 | 0 | 0 | 0 |
| 2025 | 7,575 | 7,563 | 0 | 10 | 1 | 0 | 0 | 1 |
| 2026 | 4,259 | 4,246 | 0 | 13 | 0 | 0 | 0 | 0 |

## By position and cause

| Position | Cause | Player-weeks |
|---|---|---:|
| K | kicker-unexplained | 7 |
| K | missing-input | 33 |
| K | provider-extra-event | 15 |
| K | provider-fumble-penalty | 3 |
| QB | provider-extra-event | 5 |
| QB | provider-fumble-penalty | 2,661 |
| QB | provider-fumble-penalty+provider-extra-event | 3 |
| QB | unexplained | 3 |
| RB | provider-extra-event | 170 |
| RB | provider-fumble-penalty | 1,533 |
| RB | provider-fumble-penalty+provider-extra-event | 6 |
| RB | unexplained | 1 |
| TE | house-only-event | 2 |
| TE | provider-extra-event | 99 |
| TE | provider-fumble-penalty | 359 |
| TE | unexplained | 1 |
| WR | house-only-event | 2 |
| WR | provider-extra-event | 205 |
| WR | provider-fumble-penalty | 1,298 |
| WR | provider-fumble-penalty+provider-extra-event | 37 |
| WR | unexplained | 7 |

## By magnitude (per game)

| Cause | <=1 | 1-2 | 2-5 | >5 | n/a |
|---|---:|---:|---:|---:|---:|
| house-only-event | 0 | 0 | 0 | 4 | 0 |
| kicker-unexplained | 5 | 1 | 1 | 0 | 0 |
| missing-input | 0 | 0 | 0 | 0 | 33 |
| provider-extra-event | 219 | 171 | 99 | 5 | 0 |
| provider-fumble-penalty | 5027 | 697 | 130 | 0 | 0 |
| provider-fumble-penalty+provider-extra-event | 40 | 5 | 1 | 0 | 0 |
| unexplained | 3 | 7 | 1 | 1 | 0 |

## Largest season-total changes under the house rule

| Season | Player | Pos | Provider (displayed) | House rule | Difference |
|---|---|---|---:|---:|---:|
| 2019 | Daniel Jones | QB | 208.98 | 226.98 | -18 |
| 2019 | Carson Wentz | QB | 266.86 | 282.86 | -16 |
| 2012 | Philip Rivers | QB | 208.24 | 223.24 | -15 |
| 2017 | Jameis Winston | QB | 197.66 | 212.66 | -15 |
| 2009 | Matt Cassel | QB | 165.86 | 179.86 | -14 |
| 2011 | Matt Moore | QB | 147.38 | 161.38 | -14 |
| 2011 | Blaine Gabbert | QB | 111.36 | 125.36 | -14 |
| 2012 | Mark Sanchez | QB | 122.12 | 136.12 | -14 |
| 2015 | Blake Bortles | QB | 320.12 | 334.12 | -14 |
| 2016 | Carson Palmer | QB | 243.12 | 257.12 | -14 |
| 2016 | Carson Wentz | QB | 213.98 | 227.98 | -14 |
| 2019 | Josh Allen | QB | 283.56 | 297.56 | -14 |
| 2021 | Dak Prescott | QB | 316.56 | 330.56 | -14 |
| 2009 | Eli Manning | QB | 232.34 | 245.34 | -13 |
| 2009 | Jason Campbell | QB | 220.32 | 233.32 | -13 |

## Unexplained player-weeks

| Season | Week | Player id | Pos | Provider | House | Difference |
|---|---:|---|---|---:|---:|---:|
| 2010 | 9 | 177 | WR | 8.6 | 7.6 | +1 |
| 2012 | 9 | 763 | K | 5.9 | 6 | -0.1 |
| 2013 | 13 | 763 | K | 0.8 | 2 | -1.2 |
| 2015 | 4 | 208 | QB | 21.24 | 20.24 | +1 |
| 2015 | 8 | 367 | TE | 9.7 | 7.7 | +2 |
| 2015 | 8 | 1029 | QB | 13.34 | 11.34 | +2 |
| 2015 | 4 | 1903 | WR | 8.2 | 6.2 | +2 |
| 2015 | 9 | 2411 | RB | 25.2 | 23.2 | +2 |
| 2015 | 10 | 2803 | WR | 5.9 | 3.9 | +2 |
| 2016 | 16 | 1433 | K | 6.6 | 6 | +0.6 |
| 2016 | 13 | 2216 | WR | 8.8 | 6.8 | +2 |
| 2016 | 13 | 2306 | QB | 16.3 | 14.3 | +2 |
| 2016 | 10 | 2459 | WR | 4 | 0 | +4 |
| 2016 | 17 | 3321 | WR | 17.1 | 11.1 | +6 |
| 2016 | 10 | 3342 | WR | -3 | -2 | -1 |
| 2017 | 17 | 3678 | K | 7.4 | 7 | +0.4 |
| 2020 | 11 | 2650 | K | -2.8 | 0 | -2.8 |
| 2021 | 18 | 2818 | K | 0.1 | 0 | +0.1 |
| 2025 | 15 | 11533 | K | 14.6 | 14 | +0.6 |

## Policy decision needed

Which total do the pages print for a game? `SC_SCORING_TOTALS` (default `provider`) switches it without rewriting data.

- **provider** (current): unchanged pages. Inconsistent with the matchup pages and FPA (which score by the house rule) in the weeks above, and inconsistent across seasons (pre-2022 totals carry the -1 per fumble).
- **house**: one rule for every season and every page. Changes the 3,018 player-seasons above (mostly pre-2022 quarterbacks, up to +18 points), and 13 player-weeks of 2026 (provider-only plays). Provider totals remain stored and can be shown as a reference.

St. Brown 2023 Week 14 (+1, a forced fumble on defense) belongs to the provider total only. The breakdown names it "Provider-only scoring" and does not fold it into a house-rule line.

## Are the historical inputs complete enough for the house rule?

Yes, for every skill-player week 2009-2026: passing, rushing, receiving, fumbles lost, two-point conversions, return/fumble-recovery TDs and receptions are stored for every entry (Phase 1 and 1.1 backfills; fields added only, `pts_*` untouched). Kickers: distance bands are stored for every kicker week except 33 (2011: 1, 2015: 20, 2016: 12) where the provider published none; those weeks keep the provider total. Return yardage is stored by the provider but is not a house-rule event.

## Kicker scoring, traced

| Component | Before Phase 1.1 | Now |
|---|---|---|
| Player hub / Stats / Game Log totals | Provider total (distance-tiered) | Provider total by default; house rule under `SC_SCORING_TOTALS=house` |
| Hub computed fallback and points breakdown | Flat 3 per FG, 1 per XP, misses ignored | House rule: 0-39 3, 40-49 4, 50+ 5, XP 1, miss -1 |
| Matchup pages (`kickerPoints`) | 0-39 3, 40-49 4, 50+ 5, XP 1, miss -1 | Same rule, now through `scoreLine()` |
| NFL Player Stats tables, FPA | No kicker rows | No kicker rows |

The house kicker rule reproduces the provider's stored kicker totals in 8,537 of 8,562 kicker weeks with distance data (99.7%); of the other 25, 18 are provider-only plays or the fumble penalty and 7 are unexplained fractional differences (listed above).
