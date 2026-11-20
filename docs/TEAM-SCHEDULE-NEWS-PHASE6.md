# Team Pages Phase 6: Schedule, News & Matchups accuracy

Branch `team-hubs-phase6-schedule-news`, from production `cff40da`
(release 1d2712b + Replit's publish commit, which only touched the ESPN
schedule cache). Audited 2026-11-20 03:00-04:00 UTC on all 32 teams, from the
served pages, against a fresh nflverse games.csv, ESPN's scoreboard, the
news database and the player pages. No design change.

## Inventory

| Tab | Components | Source |
|---|---|---|
| Schedule (/team/<slug>/schedule/) | banner, next / last game cards, full-season table (week, site, opponent, date / time ET, result, record, matchup link), Results / Remaining rail, FAQ, ItemList + FAQPage schema | the league slate (lib/schedule/schedule-data.ts): nflverse games.csv, fetched live with a stored snapshot fallback, + ESPN scoreboard layer for times, live state and just-finished scores (stored layer file as fallback) |
| Matchups (/team/<slug>/matchups/) | season game list (week, home-first pair, date, result, preview / recap link), "vs Every Team" pair index | the same team schedule (gameMatchupHref) |
| News (/team/<slug>/news/) | featured story, story grid, rail: Injury Watch, Next Game, Quick Links | news_items (club RSS, national outlets, player wire), roster maps; Injury Watch = data.injuries (shared availability rule) |

## Checks and results

- Schedule vs fresh nflverse, 544 team-games: opponent, home / away, 18
  neutral-site games, week, final score, W/L/T, record progression, bye week:
  **0 errors**. 300 finals all "View recap"; 244 upcoming, none with a result.
- Kickoff times: Week 11 JAX @ NYG and PIT @ PHI differ between nflverse
  (1:00 / 4:25) and ESPN (4:25 / 1:00); the page follows ESPN (the league's
  current times) and the stored ESPN layer carries the same, so a blocked
  ESPN still shows the right times. 48 Week 16 / 18 games print TBD: the
  league has not set them (nflverse carries placeholder dates). Correct.
- Status: "live" only from ESPN's in-progress state, "final" only from a
  score; never inferred from the clock (schedule-data.ts). HOU-IND read Live
  during the game.
- Matchups vs Schedule, 544 rows: same dates, results, labels and links.
- Links: 505 unique game links from Schedule, Matchups and hubs all 200 and
  name the right two teams.
- Records: team header = Schedule running record for 32/32; Overview Last
  Game = Schedule's latest final for 32/32.
- Injury Watch: 98 rows; all 88 linked players' status = their player header
  (shared rule). 10 rows unlinked (no player page).
- News: 1,912 articles; ET labels match their UTC timestamps; every article
  has a source and a link; no breaking / new badges.

## Confirmed issues

1. **Reserve codes printed raw** (fixed). Injury Watch and the Overview's
   injury list printed Sleeper's "NA" (Joe Forson, KC) and "DNR" (Brandon
   Aiyuk, SF): "NA" reads as "no data". Now "Not active" / "Did not report";
   codes and severity unchanged (team-render.ts injuryStatusLabel).
2. **Washington's club news feed is dead upstream** (not fixed, needs a
   decision). commanders.com/rss/news returns 20 items from April 2022; we
   stored 5 club stories since September (others 175-226). The News tab fills
   with dated June / August items (oldest 155 days; every other team's oldest
   is under 13 days). No current alternate feed exists; reading the site's
   HTML would be a new acquisition channel.
3. **Upcoming rematches open the earlier meeting** (not fixed, SEO decision).
   An upcoming game has no page of its own; its link is the pair page, which
   by the 2026-10-10 ownership rule shows the season's latest finished meeting
   until the rematch is within six days. Today: Seattle's Next Game (Week 12
   at SF, 9.8 days) opens the earlier SF-SEA box score; 66 remaining
   rematches pass through this. Fixing it changes which URL owns which game.
4. **Cached pages can lag a day** (not fixed, infrastructure decision). The
   app's own caching is 60 s to 5 min, but WP Rocket keeps a page 24 h
   (purge_cron_interval 24 h) and the Rocket.net edge caches HTML on top, so a
   team page can show a game as Live / upcoming, or an expired status, hours
   after the data moved, until the next purge.
5. Minor: 113 Dynasty Command items link a generic RotoWire player page with
   a doubled slash (rotowire.com//football/...); the links resolve (200).

## Recommendations needing approval (no automatic processes)

- (2) Ask mak whether to source Commanders club news another way, or accept
  the national outlets + wire for Washington.
- (3) SEO risk assessment before any change to pair-page ownership; an
  option is to keep ownership but have the Next Game card and the upcoming
  row say "preview opens <date>" rather than link the earlier recap.
- (4) A shorter WP Rocket lifespan for /nfl/teams/ and /nfl/<pair>/ pages on
  game days, or a manual "purge team pages" step in the weekly checklist after
  each slate; not an automatic purge.
