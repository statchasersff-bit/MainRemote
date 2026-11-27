# Player audit re-check, items 1 and 6: scoring and rank labels (2026-11-27)

Branch `fix/player-s16-2026-11-27`, base main 401e3618 (production: API ebb0c4d6 + plugin 1.10.76).
Status words: verified live (read-only) / verified locally / pending. Nothing pushed, published or purged.

Environments:
- **Live**: read-only `curl` with a browser UA, 2026-11-27 12:13-12:33 UTC, at least 4 s between requests (12 requests).
  Live data is one week newer than the repo (production's live refresh holds Week 12; the repo's game logs end at Week 11),
  so 2026 counts differ by one game between live and local. Historical seasons are identical.
- **Local**: this branch built with `node ./build.mjs`, served on :8091 with `SC_SCORING_TOTALS=house` (the deployed
  setting), `/embed/player/<slug>?section=...`; data-layer traces through `tests/helpers/bundle.mjs`. FPA rows from the
  workspace Postgres (`fantasy_points_allowed_games`, updated 2026-11-27 12:13Z; this is the dev database, not production's).

## Scoring rules in force (every player component and FPA)

One function, `scoreLine()` in `src/lib/scoring/house-rules.ts`. Player pages map game-log fields in
`player/scoring.ts toScoringLine()`; FPA maps nflverse columns in `fpa/nflverse.ts scoreRow()`.

| Event | Weight |
|---|---|
| Reception | PPR 1 / Half 0.5 / Standard 0 |
| Passing yard / TD / **interception** | 0.04 / 4 / **-1** (house rule, memory interceptions-minus-one) |
| Rushing or receiving yard / TD | 0.1 / 6 |
| Fumble lost | -2 |
| Two-point conversion (thrown, run, caught) | 2 |
| Kick/punt return or fumble-recovery TD | 6 |

Rounding: each game to 0.01 (`getFantasyPoints`), season sum printed to 0.1. Format: PPR (default and the
format of every figure below). Season scope: career rows = full regular season, Week 18 included (mak 11-26);
NFL Player Stats leaderboards = Weeks 1-17 (stated beside both).

## Item 1 (WEB-031/036): St. Brown reconciliation

Player: Amon-Ra St. Brown, Sleeper id 7547, position WR. Source records: `data/player/game_logs/<season>.json`
(Sleeper weekly stat lines; `pts_ppr` = the provider's stored total). Calculation: `careerSeasonTotals()`
(metrics.ts) sums `getFantasyPoints()` per week; the Stats tab's career table prints it, with the extras note under it
(`careerScoringExtras` / `careerScoringNote`).

| Season | Rec x1 | Rec yds x0.1 | Rec TD x6 | Rush yds x0.1 | Rush TD x6 | Fum lost x-2 | **Columns** | Not in a column (real events) | **Printed** | Provider sum |
|---|---|---|---|---|---|---|---|---|---|---|
| 2021 | 90 | 91.2 | 30 | 6.1 | 6 | 0 | **223.3** | 2 two-point catches, Wk 6 at CIN and Wk 17 vs SEA (+4.0) | **227.3** | 227.3 |
| 2022 (control) | 106 | 116.1 | 36 | 9.5 | 0 | 0 | **267.6** | none | **267.6** | 267.6 |
| 2023 | 119 | 151.5 | 60 | 2.4 | 0 | -2 (Wk 2 at SEA) | **330.9** | none | **330.9** | 331.9 |
| 2024 | 115 | 126.3 | 72 | 0.6 | 0 | -2 (Wk 15 vs BUF) | **311.9** | Wk 4 vs SEA TD pass to Goff, 1/1, 7 yds: 0.28 + 4 (+4.3) | **316.2** (316.18) | 316.18 |
| 2025 (control) | 117 | 140.1 | 66 | 0.9 | 0 | 0 (1 fumble, recovered) | **324.0** | none | **324.0** | 324.0 |

- 316.2 vs 311.9: the 4.28 is the Week 4 2024 touchdown pass. 2021 227.3 vs 223.3: two two-point receptions.
  Both are printed under the career table on live and local: "FPTS also counts scoring with no column in the table:
  2024 Passing 1 TD, 7 yds (+4.3); 2021 2-pt conversions 2 (+4.0)." No "Other" anywhere.
- 2023 331.9 vs 330.9: the page prints 330.9 (house rule) and its columns reproduce it exactly. 331.9 is the
  provider's stored total, which adds +1 for a **forced fumble** in Week 14 vs CHI (`px.idp_ff: 1`, a play after a
  turnover; stored 6.1 vs house 5.1). Forced fumbles are not a StatChasers scoring event, so 330.9 is right.
- 2024 Weeks 1-17 (leaderboard) = 302.5; + Week 18 13.7 = 316.2 (range stated beside both tables).

QB, interception weight (Jared Goff, id 3163):

| Season | Pass yds x0.04 | Pass TD x4 | INT x-1 | Rush yds x0.1 | Rush TD x6 | Fum lost x-2 | Columns | Extras | Printed | At -2/INT |
|---|---|---|---|---|---|---|---|---|---|---|
| 2024 | 185.16 | 148 | -12 | 5.6 | 0 | 0 | 326.76 | Wk 4 receiving TD 7.7 + Wk 17 2-pt 2.0 | **336.5** | 324.5 |
| 2026 (thru Wk 11, local) | 108.64 | 80 | -4 | 3.5 | 6 | -2 | 192.14 | none | **192.1** | 188.1 |

INT = -1 is consistent: Stats footer ("-1 per interception"), career row (above), Game Log per-week breakdown
("Interceptions 2 INT -2.0" for a two-interception game, 2024 Wk 2), hub season block, and FPA (`scoreRow` passes
`passing_interceptions` to `scoreLine`; the FPA FAQ states "-1 per interception").

Hub vs Stats vs Game Log, same player, games, format (local, PPR):

| Player | Hub season block | Stats career row | Sum of printed Game Log weeks |
|---|---|---|---|
| Gibbs 2026 | 281.2 | 281.2 | 281.2 (10 games) |
| Goff 2026 | 192.1 | 192.1 | 192.1 |
| Goff 2024 | - | 336.5 | 336.5 (17 games) |
| St. Brown 2024 | - | 316.2 | 316.2 (17 games; Wk 4 breakdown prints "Passing yards 7 yds +0.3, Passing TD 1 TD +4.0") |

FPA per-player contribution (before aggregation): FPA sums nflverse rows by defense/week/position. Every 2026 PPR
row Weeks 1-11 (1,304) was recomputed from the player game logs under the house rule:
1,249 match to the cent; 31 differ only by **position classification** (fullbacks such as Juszczyk, Ingold, Prentice
and Velus Jones Jr. are RB/WR in our player data but FB/RB in nflverse's); 24 differ only by **return fumbles**
(nflverse counts sack/rushing/receiving fumbles lost; the player game logs also charge -2 for a lost punt/kick
return, e.g. Jimmy Horn Jr. W1, Ke'Shawn Williams W3). 0 unexplained. Same weights; different event scope at the
edges (see open questions). Opponent points allowed per game is a different measure and was not compared to player totals.

Format printed beside the total: Stats career table header "Fantasy (PPR)" (live + local); Game Log "Regular season · PPR"
and "How the 27.8 points scored (PPR)"; FPA "PPR" selector. **Reproduced live and fixed**: the hub "2026 Season
Stats" block printed "FPTS 219.7" with the format only in the header.

## Item 6 (WEB-035): ranks, pools and labels

| Check | Live now (12:31-12:32 UTC) | Calculation | Status |
|---|---|---|---|
| St. Brown "51 TD" | Hub: "Career 94 games, 624 catches, 7,190 receiving yards, 52 receiving TD (2021-2026)"; Stats FAQ "52 receiving touchdowns" | sum of `rec_td`, all regular-season weeks 2021-2026 | holds |
| St. Brown Outlook ">=30 targets" pool vs Stats pool | No "30 targets" pool printed anywhere. Hub meters: "Percentile among the 110 qualified WRs on his Stats tab (17+ targets, 4+ games and a 25%+ snap share); target share among the 114 WRs with 6+ games and 1.5+ targets per team game." | Stats card pool: advanced table, 17+ targets, 4+ games, 25%+ snaps; usage field: `playedSeasonRows` qualified + `minGames(11)`=6 | holds (one field per metric, each stated) |
| Burden 107 / 138 / 111 | Hub "Target share 22.0% 79th pctile"; Stats "Target share 22.0% 25th of 114"; Outlook "22.0% target share ranks 25th among 114 qualifying receivers", tile "25th of 114 WRs" | target share sorted desc in the usage field, 2026 through Week 11, PPR-independent; pct = share of the other 113 he is above | holds (one pool) |
| **Snap share count** (found now) | Stats "Snap share 81.3% 22nd of 113" beside the note "target share, snap share and air-yards share among the 114 WRs"; Outlook tile "22nd of 113 WRs" under "Ranks are among qualifying WRs league-wide." | one usage-field member (Cody White, LV, 8 games) has no snap count, so snap share ranks 113 | **reproduced live, fixed** |
| **Player outside the usage field** (limited time: A.J. Brown, 4 games) | Stats: "Target share 22.2% Not ranked ... among the **0** WRs with 6+ games and 1.5+ targets per team game" | no ranks -> `of = 0` printed | **reproduced live, fixed** |
| Nate Carter RB133/134 | Hub "Waiver consideration RB134 by total points, 2 games", "ranks RB134 in total PPR points, averaging 0.4 a game"; FAQ "RB134 in PPR total points"; Outlook "Based on his total PPR points rank this season, RB134"; header "RB134 POS RANK" (tooltip: "by total PPR fantasy points (per-game rank from four games played)") | `publishedRank`: below 4 games no PPG table, total points rank | holds; Stats chart's screen-reader text "2026 0.3 (RB134)" paired a PPG with a total rank: fixed |
| Ordinal vs percentile | Overview prints "97th pct ile"; Stats/Outlook print "4th of 114" | pct = below/others; rank = position in the same sorted field | holds |
| TD labels | Header "REC TD"/"TOTAL TD"; hub season block for WR/TE printed bare "TD" and "YDS" | `tableCols` WR/TE | **reproduced live, fixed** ("REC YDS", "REC TD"; RB/QB already labeled) |
| Jordyn Tyson (3 games, below the Stats line) | (local) "League rankings unavailable: minimum qualifying sample not met. Ranked WRs need 17+ targets, 4+ games and a 25%+ snap share. He has 20 targets in 3 games." | `buildCard` qualify rule | holds |

Counts come from the selected dataset: Stats card = 2026 advanced table through Week 11 (110 WRs); usage field =
2026 usage report through Week 11 (114 WRs). Both are stated beside the figures.

## Gibbs Game Log vs FPA (regression check)

Live, 12:21 UTC (`/nfl/players/jahmyr-gibbs/game-log/` vs `/nfl/fantasy-points-allowed-by-position/`, PPR, RB, "through Week 11"):
NO 3/3, BUF 12/12, NYJ 8/8, CAR 1/1, ARI 13/13, GB 7/7, MIN 29/29, MIA 6/6, NE 15/15, TB 32/32, CHI 23/23 (11/11),
next opponent Week 13 at ATL: header "5th vs. RBs" = FPA ATL RB rank 5. Local (Week 11 data): the same 10/10 + ATL 5.
The 11-27 complete-weeks change holds both sides at Week 11 while Week 12 games are partial. No change needed.

## What changed (commit on this branch)

- `stats-tab-data.ts`: `shareField.ofs`, the count each share row is ranked among.
- `stats-tab.ts`: the Stats card note names a smaller count beside the field ("(snap share among the 113 of them with
  snap counts)") and, outside the field, says "target share, snap share and air-yards share rank only WRs with 6+
  games and 1.5+ targets per team game, the same field as his Outlook, which he has not reached yet". Footer states
  every weight: "... 6 per rushing or receiving TD, 2 per two-point conversion, -2 per fumble lost and 6 per return or
  fumble-recovery TD." (it said "Two-point conversions and lost fumbles are counted too", and nothing in Standard).
- `overview-data.ts`: the meter note uses the target-share row's own count.
- `outlook-tab.ts` (small, 10 lines in `opportunityModel` only): the Opportunity vs. Production lede names the field
  ("Ranks are among the 114 WRs with 6+ games and 1.5+ targets per team game; snap share among the 113 of them with
  snap counts.") or, with no ranks, "Ranks need 6+ games and 1.5+ targets per team game; he has not reached that line
  yet, so none are shown."
- `overview.ts` + `season-line.ts`: hub season block "PPR FPTS" (HALF/STD by format), WR/TE "REC YDS", "REC TD".
  Checked in headless Chromium at 390 px: the 4-column grid holds.
- `career-premium.ts`: chart caption (screen-reader text) "RB fantasy points per game by season, with the season
  finish by total PPR points: ...".

No titles, meta, H1, JSON-LD or FAQ text changed.

## Tests (local, `env -u INGEST_SECRET node --test --test-concurrency=1`)

career-scoring 11/11 (4 new: 2021, 2023 forced fumble, 2022 control, Goff -1/INT); player-share-field 6/6 (2 new);
player-overview 28/28; player-stats-tab 29/29; player-outlook-tab 42/42; ppg-rank-consistency 11/11;
player-entity-seo 9/9; player 153 pass / 0 fail (1 skipped); player-header 23/23; data-accuracy 79/79;
player-stats 39/39; player-faq-through-week 8/8; web-033-opp-ranks 17/17. `tsc --noEmit` clean. No PHP touched.

## Open questions for mak

1. **Games played differs between the hub and the Stats tab for special-teams-only games.** The header, hub and FAQ
   count a game only with an offensive snap or touch; the Stats career row counts Sleeper's `gp` (active, snap or
   not, the 11-04 rule). Live: Nate Carter header "0.4 FPPG ... through 2 games" vs Stats "2026 KC 3 GP ... 0.3 PPG".
   Local: Ameer Abdullah header 1.6 FPPG vs Stats 10 GP 1.1 PPG. 136 QB/RB/WR/TE players in 2026 local data have such
   weeks. Points agree; the games (and so PPG) do not. Which games-played count should both use? Not changed here.
2. FPA vs player scoring scope: a lost punt/kick-return fumble costs the player -2 on his page but is not in FPA's
   defense total (nflverse has no return-fumble column); fullbacks are RB on player pages, FB (excluded) in FPA. Keep as is?
3. The header's "POS RANK" is a PPG rank from four games and a total-points rank before that; the basis is in the
   tooltip only. Print it (header is item 4's area)?
