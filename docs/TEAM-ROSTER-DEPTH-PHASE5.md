# Team Pages Phase 5: Roster & Depth Chart accuracy

Branch `team-hubs-phase5-roster`, based on `f0f0854` (Phase 4: production
1983d9e + the shared week-aware availability rule, the carry fix and one
share definition; the Phase 4 layout was rejected and is not in it). Audited
2026-11-20. No design change: the 32 Depth Chart pages render byte for byte
as before (test-server origin aside).

## How the data is updated today (nothing changed, nothing scheduled added)

| Data | Source | How it moves |
|---|---|---|
| Depth charts | WordPress plugin (statchasers-news/depth-charts): FantasyPros + Footballguys + ESPN blended on the WordPress host | WP-Cron `scdc_cron_refresh`, daily ~20:17 UTC (last run 2026-11-19 20:18, 32/32 teams). Written to wp-content/uploads/statchasers/depth-charts.json. **The push to the app is OFF** ("Not configured: set STATCHASERS_INGEST_SECRET (and the app origin) in wp-config.php"), so the team hub's Depth Chart tab renders the committed snapshot `data/depth-charts/statchasers/depth-charts.json` (2026-11-18 05:34 UTC), or a newer database row if one was ever pushed. It moves only when someone runs `wordpress-plugin/tests/depth-charts/snapshot.php` and publishes. |
| Roster index, injury status | Sleeper player dictionary, fetched by the app at runtime | In memory, refreshed every 12 h (lib/teams.ts REFRESH_MS). QB/RB/WR/TE within Sleeper's top ranks only. |
| Official practice reports / game status | NFL.com, `data/player/practice_reports/<season>.json` | Refreshed on production three times a day (existing practice-report refresh); hand-refreshed in the workspace. |
| Player file (`data/player/players.json`), indexed slugs | Sleeper + the depth chart | Hand-run builders (daily chain OFF since 2026-10-04); last 2026-11-18. |
| Player pages on WordPress | WP-Cron `statchasers_player_auto_build`, daily 15:00 UTC | Existing. |

Decision for mak (not changed here): turning the depth-chart push on is one
secret in wp-config.php plus the app's `INGEST_SECRET`; it would make the hub
follow the WordPress tool daily. Until then the hub's chart is a hand-refreshed
snapshot. Today the two differ in one skill slot (BAL RB3: Rasheen Ali vs Adam
Randall).

## Confirmed errors and root causes

1. **Players off the roster index read healthy on their page.** Michael
   Burton (CLE) and Alec Ingold (LAC) are on IR on the Depth Chart and at
   Sleeper; their player pages said "No injury designation". Tyler Loop (K),
   Ty Simpson (QB, rookie) the same. Cause: player pages took a status only
   from the live roster index (skill positions within Sleeper's top ranks);
   anyone outside it had no row, and no row printed as no designation.
   Fix: `player-data.ts rosterRowFor` falls back to the player file's Sleeper
   status for a player on this club, through the same week-aware rule.
2. **"Pending" players headlined as healthy.** 21 linked players (Josh
   Jacobs, T.J. Hockenson, Ladd McConkey ...) showed a "Status pending" pill
   under the headline "No injury designation for Week N". Cause: the Injury
   tab headline knew only reserve and game statuses. Fix: the headline reads
   "Jacobs has no Week 12 game designation yet after missing Week 10."
3. **Hub Depth Chart is not refreshed from WordPress** (see above). Not
   fixed: needs mak's approval to configure the push.

Not errors (checked):
- Team assignments: 616 of 622 skill players on the WordPress chart are on
  that club at Sleeper; 5 are not in Sleeper under that name (Bam Knight,
  Matthew Hibner, Mitchell Tinsley, Greg Desrosiers, Chip Trayanum, all
  depth-only names) and Cole Burgess (PIT WR8) is a free agent on IR at
  Sleeper: the source still lists him. Shown as the source lists them.
- 12 listed starters played under 35% of snaps over the last three games
  while another player had 60%+ (Jake Ferguson O, DeVonta Smith Q, Mike
  Evans Q, Ladd McConkey Q, Sam Darnold Q, A.J. Brown, David Montgomery,
  Breece Hall, Emeka Egbuka, Fernando Mendoza, Joe Milton, Carnell Tate):
  injuries or source order. Not promoted (brief: no promotion by snaps).

## Results

- Player links: 1,203 links on 32 charts to 588 players; every one is a
  published WordPress player page (725 published, read over SSH), every one
  goes to the player named, and no player with a page is left unlinked.
- Injury consistency: 149 linked players with a badge or a current Sleeper
  designation; Depth Chart badge = player page status for all 149 after the
  fixes (24 disagreements before, 21 of them the pending headline).
- Overview injuries, News Injury Watch and the Depth Chart read the same
  normalized roster (current-injuries.ts), so they agree by construction.
- 32 Depth Chart pages: 200, one H1, no duplicate IDs, HTML unchanged.

## Remaining

- The player header chip shows the roster status ("Active") for a pending
  player (Josh Jacobs, Ty Simpson) where the Depth Chart says "Pending". The
  header is being redesigned on phase2-player-redesign; left to that branch.
- php.error.log repeats "Undefined array key game" (statchasers-matchup.php
  line 329); harmless, for the next plugin release.
