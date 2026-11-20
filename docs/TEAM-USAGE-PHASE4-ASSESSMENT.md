# Team Pages Phase 4: Usage & Snap Counts, assessment

Branch `team-hubs-phase4-usage`, based on `1983d9e` (the deployed production
commit: 865f637 plus Replit's publish commits, which only touch the ESPN
schedule cache). Audited 2026-11-19 on Detroit, New England, Kansas City, San
Francisco, Jacksonville and Cincinnati from the served `/team/<slug>/usage/`
HTML and the data files; heights from Chromium device emulation (844px tall)
at 320, 390, 768 and 1280.

## 0. Production verification (Step 1)

- API: news.statchasers.com serves asset version c3df86836e7f (= 865f637).
  Plugin: 1.10.58 (installed by WP-CLI 2026-11-19). 1.10.57 backup kept on
  the server (~/tmp/statchasers-news-1.10.57-backup-20261119); the SSH key
  this machine used was lost when /home/runner was reset, so the backup's
  presence and the server logs are re-checked once the new key is imported.
- Live sweep of all 32 hubs + Stats + Coaching + Usage on statchasers.com
  (see section 9 for the final counts).
- Scheduled refresh: the daily chain (which includes the coordinated
  Usage/Coaching/Stats refresh) is OFF in production (`/api/status`
  playerStats.daily.enabled = false, never attempted) as it has been since
  2026-10-04; data moves when the weekly chain is hand-run. There is no
  "first scheduled refresh" to verify.
- Chicago and Denver (bye in Week 10): Coaching prints "2026 through Week 9"
  in its tendency headings (the club's last game) and "Data through Week 10"
  in its data line. Not a data error; worded differently from Stats.

## 1. Current Usage tab (one template, all 32 clubs)

`renderUsageSection()` (team/usage-render.ts) prints, in order:

| # | Section | Contents | Words (DET) | Height 390 / 1280 (DET) |
|---|---|---|---|---|
| 1 | Banner + Snap Counts & Playing Time | Season / Last 3 / Week filter, position filter, every player's snaps, snap %, change | 218 (with 2, 3) | 984 / 108 |
| 2 | Target Distribution | Tgt, Rec, Yds, TD, season share, last-3 share, RZ share | | 509 / 500 |
| 3 | Rushing Distribution | Att, Yds, YPC, TD, season share, last-3 share | | 390 / 518 |
| 4 | Situational Usage | RB share by situation (early, 3rd, RZ, inside 10, 2-min, trailing) + three cards (Workload, Third-Down, If X Misses Time) | 317 | 731 / 850 |
| 5 | Rushing Direction | Five gaps: YPC, attempts, share | 107 | 415 / 406 |
| 6 | Passing Distribution | Six zones: att, YPA, top receiver | 109 | 499 / 527 |
| 7 | Notable Usage Changes | Up to three cards: snap / target share last 3 vs previous 3 | 326 | 704 / 465 |
| 8 | Advanced & Fantasy Analysis | Opportunity percentile, snap %, RZ opps by player with expandable detail rows; handcuff line; "Put This Usage Data to Work" (six tool cards) | 1,055 | 1,261 / 1,491 |
| 9 | FAQ | 14 questions, FAQPage | | 1,016 / 740 |

Panel 2,105-2,379 DOM nodes, page HTML 206-224 KB, 37-45 player links (16-21
players).

## 2. Statistical cross-check (all 32 clubs, 587 players vs the player game logs the Stats / Game Log pages read, per club)

| Field | Result | Cause |
|---|---|---|
| Rushing yards | 1 differs: Trevor Lawrence 104 vs 106 | **Bug.** 2026 wk 1 CLE-JAX: "left end for 2 yards ... Illegal Forward Pass". nflverse flags the play `rush=0, pass=1` but `rush_attempt=1` with Lawrence as rusher; Usage credits carries on `rush`/`qb_scramble` only, the box score counts it. Same class: Carson Wentz aborted snap wk 9 (8 vs 9 carries). |
| Carries | QBs lower everywhere | **Definition.** Usage carries exclude kneel-downs (box score includes them); with kneels added every QB matches except the two plays above. Rush yards include kneel yards and YPC subtracts them (rushYardsOnCarries), so YPC is right. The page must say "carries exclude kneel-downs". |
| Targets | 13 players differ by 1-2 | **Definition.** Play-by-play targets (plays wiped by penalty excluded; e.g. Drake London wk 1: four targets in pbp, five at the stats provider). Targets are not an official NFL statistic. Label the source. |
| Games | 92 players differ | **Definition, unlabeled.** Usage "games" = games with an offensive snap; player pages count every game played (special teams included): Jacob Saylors 2 vs 8. The header says "G". |
| Receptions, rec yards, TDs | match (laterals credited since Phase 1) | |

Traded players: Usage is per club, game logs are season totals (Keenan Allen
SF 7 tgt + IND 58). Per-club comparison matches; the page should say so for
a player with two clubs.

## 3. Injury and availability (all surfaces share matchup/availability.ts gameAvailability)

The 2026-11-19 rule expires a Sleeper Q/D/Out for a player who played the
club's last game unless this week's official report gives a game status. It
fixes the stale case (Sione Vaki: Questionable for Week 10, played) but also
**clears designations filed after that game**. Today, 27 skill players carry
a Q/D/Out and played Week 10:

- 4 stale (Sleeper status = the Week 10 report's): Vaki, Omar Cooper Jr.,
  Tyjae Spears, Skyy Moore. Correctly cleared.
- 23 new (Sleeper status differs from the Week 10 report or the player was
  not on it): Woody Marks Out, A.J. Brown Out (Questionable in Week 10),
  Geno Smith, Drake London, Dalton Kincaid, Bhayshul Tuten ... all Questionable.
  **Wrongly cleared** on player pages, team Overview/News/Depth Chart and
  matchup previews (NYJ Injury Watch: "No Jets skill-position players carry
  an injury designation" while Geno Smith is Questionable).

Proposed rule (shared, in gameAvailability): a Sleeper Q/D/Out for a player
who played the last game stands when the previous week's official report
shows a different status (or does not list him), labeled "reported after
Week N, not yet on the official Week M report"; it expires only when it
equals the previous report's status. Official game statuses still win;
reserve lists stand; Pending after a missed game unchanged. Sleeper's
`news_updated` cannot date a designation (Vaki's moved on Nov 18 with a
Week 10 status).

Usage itself prints no injury status; its handcuff / "If X misses time"
lines name the next back by usage only.

## 4. Redundant and oversized

- Situational Usage renders its Workload and Third-Down cards twice
  (desktop rail `.sct-us-sit-cards` + phone `.sct-us-pa`), both in the HTML.
- Snap %, target share, carry share and "change" each appear in 2-3 places:
  Snap Counts table, Target / Rushing Distribution, Advanced & Fantasy, and
  Notable Usage Changes.
- Advanced & Fantasy Analysis is half the tab's words (1,055 of 2,127) and
  its tallest section; six tool cards sit inside it.
- 768px is the tallest width (panel 6,970-7,751 vs 4,727-5,393 at 1280):
  Situational, Direction, Pass Map and Advanced fall to one column.
- Notable Usage Changes is 465-764px for at most three cards.
- FAQ: 14 questions, 740-1,191px.

## 5. Proposed layout

A. **Team Usage Snapshot** (one row of compact cards): offensive snaps/G,
   pass rate (Coaching's shared value, linked, not re-derived), backfield
   split (top two backs' share of RB opportunities), target leader (share),
   rushing-workload leader (share), biggest role change (last 3 vs previous 3,
   only past the threshold). Data-through line: league week + club games.
B. **Player Usage Leaders**: one row per offensive player who matters (QB,
   RBs, WRs, TEs above a floor), name linked, position, games with an
   offensive snap, snap share bar, and the share that fits the position
   (targets for WR/TE, carries + targets for RB, dropbacks for QB), with a
   last-3 delta chip only past the threshold.
C. **Weekly Usage Trends**: season vs last 3 vs previous 3 completed games
   for snap share, target share, carry share and RZ opportunities, sample
   sizes printed, arrows only past +-8 pp (snap) / +-5 pp (share), with the
   threshold stated.
D. **Position Groups** (QB / RB / WR / TE tabs or disclosures): RB = carries,
   targets, backfield opportunity share, situational split (the current
   Situational Usage, one copy); WR/TE = routes where available, targets,
   target share, aDOT, RZ targets; QB = dropbacks, scrambles, designed runs.
E. **Detailed Snap Counts & Usage** (closed disclosures, one copy each):
   the snap table (with its Season / Last 3 / Week filter), target and
   rushing distribution tables, Rushing Direction and Passing Distribution,
   definitions (offensive games, carries exclude kneels, pbp targets, per-club
   for traded players, data-through week).
   Advanced & Fantasy keeps its content inside E; tool cards move to one
   compact link row.

## 6. Visualizations

Share bars on every player row (snap, target / carry), a stacked backfield
split bar, last-3 vs previous-3 dumbbell marks in Trends, and the existing
gap and zone charts. No decorative charts.

## 7. Expected effect

One copy of Situational cards (-~110 nodes); detail in closed disclosures;
the 768 single-column fall-through removed. Target: panel at 1280 under
3,000px and at 390 under 4,000px with every table still in the HTML; nodes
roughly flat (data kept server-rendered).

## 8. Risks

- Usage content was approved piece by piece (2026-11-05 to 11-15: premium
  dashboard, situational, direction, pass map, product bridges). The
  redesign keeps every block's data and moves it; nothing is deleted
  without a replacement.
- The injury rule change touches the player pages, team pages and matchup
  previews at once (one shared function). Regression tests cover stale,
  new-after-game, missed-game and official-report cases.
- The carry fix changes Usage carry counts and carry shares slightly for the
  clubs with such plays; the shared Phase 2 definitions (play mix, pass
  rate, pace, fingerprint) are untouched.
- FAQ questions that quote numbers must keep matching the visible page.

## 9. Production sweep (live, 32 clubs x hub / Stats / Coaching / Usage)

32 clubs x 4 pages, 2026-11-19 ~20:00 UTC, cache-busted: 128/128 HTTP 200,
one H1 each (hub "{Team} 2026 Stats, Schedule & Fantasy Outlook", Stats
"{Team} Stats 2026", Coaching "{Team} Offensive Coordinator & Scheme (2026)",
Usage "{Team} Snap Counts & Player Usage (2026)"), canonical = own URL, no
duplicate IDs, Overview the default hub tab on all 32, Stats "League data
through Week 10" on all 32, FAQPage = visible questions (hub: archived
preseason questions correctly outside the schema). 14 sampled player links
200. No 500/503 seen.

The one "Service Unavailable" right after the plugin install (2026-11-19
~19:55 UTC) did not recur in three immediate re-fetches or in this sweep;
server logs, read 2026-11-20 over SSH: 14 of 66,032 requests on Nov 19
returned 503 (0.02%). Five fell in one 16-second burst, 19:52:53-19:53:09
UTC, while WP-CLI swapped the plugin files (one of them our own cache-busted
check of the Detroit hub); the other nine are isolated or 2-4 request bursts
through the day (13:37, 16:10, 17:38, 18:15, 18:18, 23:02), several of them
crawlers, hours before the install. No PHP fatal; php.error.log only repeats
an older warning ("Undefined array key game", statchasers-matchup.php line
329, also logged before the install). Not an ongoing problem. The 1.10.57
backup is still at ~/tmp/statchasers-news-1.10.57-backup-20261119 and the
plugin reads 1.10.58, active.

## 10. Implemented (2026-11-19)

**Injury rule (shared, all surfaces).** A Sleeper Q/D/Out for a player who
played the last game stands, sourced "sleeper" and labeled "reported after
Week N; not yet an official Week M game status", when the previous week's
official report gave him a different status or did not list him. The same
status as that report expires (Vaki, Omar Cooper Jr., Tyjae Spears, Skyy
Moore). Official game statuses win; reserve lists stand; Pending after a
missed game unchanged; with no previous report the old expiry applies.
Verified: Geno Smith Questionable, A.J. Brown Out, Woody Marks Out now show
on their team Injury Watch and Injury tab ("Reported after Week 10; not yet
an official Week 11 game status."); Vaki still "No injury designation for
Week 11". Tests: stale / new-after-game / missed / official / undatable.

**Carries.** Usage credits a carry for every official rush attempt
(`rush_attempt = 1` with a rusher) even when nflverse flags the play as a
pass: Lawrence 104 -> 106 rush yds (21 car), Wentz 6 car. After the rebuild
every rushing-yards total equals the player pages' game logs per club;
carries equal them once kneels are added (labeled). Snapshot (2026, Week 10,
18376:11093) and the shared team metrics unchanged.

**Layout.** A Team Usage Snapshot (plays/G and pass rate with ranks, pass
rate linked to Coaching, backfield split bar, target and rushing leaders,
biggest role change past 8 points in games played), B Player Usage Leaders
(offensive games, snap-share and role-share bars, last-3 chip), C Weekly
Usage Trends (previous 3 -> last 3 club games, shares over games played, two
games in each at least, marks only past 8 / 5 points or 1 RZ opp per game),
D Position Groups (QB / RB / WR / TE tables; Situational Usage, Rushing
Direction, Passing Distribution inside), E Detailed Snap Counts & Usage
(snap table with week filter + boards, Advanced & Fantasy, definitions).
Situational Usage prints one copy (the phone figures) at every width.
Notable Usage Changes is replaced by C. Definitions add offensive games vs
games played, play-by-play targets vs the provider, per-club numbers for
traded players.

### After measurements (six teams, same method)

| Width | Panel before -> after | Page before -> after |
|---|---|---|
| 320 | 5,423-6,592 -> 2,683-3,183 | 7,022-8,171 -> 4,217-4,779 |
| 390 | 5,080-6,196 -> 2,589-3,124 | 6,551-7,667 -> 4,037-4,595 |
| 768 | 6,970-7,751 -> 2,216-2,455 | 8,426-9,207 -> 3,649-3,925 |
| 1280 | 4,727-5,393 -> 2,056-2,295 | 5,954-6,620 -> 3,283-3,522 |

No horizontal scroll, 0 duplicate IDs, CLS 0. Nodes 2,105-2,379 ->
2,777-3,143 and HTML 206-224 KB -> 229-251 KB (every table stays in the HTML;
B, C, D are new). Divi sim (live DET page) at four widths: one H1, no
overflow, no theme bleed. 32-club sweep clean (no NaN / undefined / em dash,
no broken player links, FAQPage = visible). Bye weeks: DEN and CHI read
"League data through Week 10" with windows Weeks 4-6 -> 7-9; HOU (bye 8)
last 3 = Weeks 7, 9, 10. Committee backfields (GB, NO) show both backs.

## 11. Released scope (2026-11-20)

mak rejected the new Usage layout (sections A-E above). Released: the
production Usage layout, plus the shared post-game injury rule, official rush
attempts as carries (Lawrence 106 rush yds), one share definition
(usage-share.ts, "Club share" on the boards) and four definition lines.
Sections 5-7 and the layout parts of 10 describe the rejected design.
