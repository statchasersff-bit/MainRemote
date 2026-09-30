# Season rollover: 2026 → 2027

What changes on its own, and what somebody has to change, when the NFL season turns over. Written 2026-09-28. Line numbers are as of that date.

## Two dates

- **March 1** is when the *league year* turns over. `seasonYear()` (`artifacts/api-server/src/lib/seo.ts:35`) and the build scripts' `currentSeason()` (`scripts/player/season.mjs`) both flip on it. Nothing about the *data* changes that day: until week 1 in September, every page still shows 2026 games.
- **Week 1 of 2027**, in early September, is when the data becomes 2027. It is also when a "2027" in a title or H1 becomes true.

Most of what follows comes down to not letting a year label move before the data does.

## Handled automatically

| What | How | Since |
|---|---|---|
| Schedule, March to the release (≈ mid-May) | With nflverse holding no 2027 games, the board shows the 2026 season, labelled 2026, instead of an empty page and a 503. It retries the new season every 30 min, not every minute. It switches to 2027 as soon as nflverse publishes. (`getSchedule`, `lib/schedule/schedule-data.ts`) | 2026-09-28 |
| Schedule `?season=` | Limited to 1999 through the current season. | 2026-09-28 |
| Game logs and W/L scores | The production refresh (`lib/player/live-refresh.ts`) asks for `seasonYear()`. From March 1 that is 2027, which has no games. The builder then writes nothing, so no empty `2027.json` appears. From week 1 it fills 2027 by itself. | 2026-09-28 |
| Player pages' "active season" | Each player page picks the newest season the player actually played in (`getPlayerPageData`), so it moves to 2027 at a player's first 2027 game. | before |
| Rankings, advanced stats | Read the newest file on disk. | before |
| News page title | Uses `seasonYear()`, so it says 2027 from March 1. Correct for a news page. | before |

**Expected noise from March to August.** In `/api/status` → `playerStats.daily.steps`, these steps fail every day until 2027 data exists:
- **advanced stats** and **handcuff stats:** nflverse has no 2027 file yet.
- **ownership:** Sleeper has no 2027 research document yet.

That is harmless: each step keeps its 2026 file. `/api/data/health` ignores failed steps outside September–January for this reason; in season they are a 503. The signings chain (index, depth charts, indexed players) keeps working all offseason, which is when most signings happen.

## Changed by hand: when, where, what

### 1. August (preseason): new outlooks

Outlooks are hand-written per season. There is nothing to flip until the new ones exist.

- **`artifacts/api-server/data/player/fantasy_outlook_2027.json`:** write it. `scripts/player/buildFantasyOutlook2026.js` and `outlookPrep.js` are the 2026 pipeline, so copy and rename them.
- **`artifacts/api-server/src/lib/player/data.ts:56`:** point `OUTLOOK_FILE` at the new file.
- **`artifacts/api-server/src/lib/player-render.ts:253`:** set `OUTLOOK_SEASON` to 2027. It drives the Outlook section's title and H1 ("Fantasy Outlook 2027").
- **`artifacts/api-server/src/lib/team/outlook.ts`:** add the 32 team outlooks, each with `season: 2027` and an `updated:` date. The per-team `season: 2026` entries start at line 122.

### 2. August: FPA preseason mode

FPA has a preseason mode (`preseason_baseline`) that ranks defences on the previous season until 2027 games exist. To switch to it:

- Set the Replit production secrets `FPA_CURRENT_SEASON=2027` and `FPA_BASELINE_SEASON=2026`. The code defaults are 2026/2025, in `lib/fpa/fpa-data.ts:95-97` and `:257`, and `lib/fpa/ingest.ts:52-55`. Setting the secrets needs no code change.
- Then run `node scripts/refresh-fpa.mjs` once. It POSTs to the deployment, as in the weekly FPA refresh.

Do this before week 1, or the FPA table keeps showing 2026 through the start of the season.

### 3. Week 1 (early September): the year labels

Flip these the week the first 2027 games are played. Not in March.

| Constant | File:line | Drives |
|---|---|---|
| `STATCHASERS_TEAM_SEASON = '2026'` | `wordpress-plugin/statchasers-news/statchasers-team-pages.php:31` | Team section titles, descriptions and H1s; player section H1s and lead text (`statchasers-player-pages.php` ≈ 861-865, 987-1002); the matchup fallback season (`statchasers-matchup.php` ≈ 472, 518); the Rank Math description written for new player pages (≈ 489) |
| `SCDC_SEASON` 2026 | `wordpress-plugin/statchasers-depth-charts/statchasers-depth-charts.php:30` (a `define`, so it can also be set in `wp-config.php`) and `includes/class-scdc-teams.php:22` `DEFAULT_SEASON` | Depth-chart titles, descriptions, H1s ("… Depth Chart 2027") |
| `SC_BUILD_SEASON` / `SEASON` | `wordpress-plugin/scripts/sc-build-pages.php:51`, `create-player-pages.sh:44`, `create-team-pages.sh:30` | The CLI page builders |

Bump the plugin version, rebuild the zip (`bash wordpress-plugin/scripts/build-zip.sh`) and upload it.

**Stored meta does not follow the constant.** Rank Math titles and descriptions are written into each page's meta *only when empty*, so the 611 player descriptions ("… 2026 game log …") and 32 team hub titles keep saying 2026. Two ways to refresh them:

- **Player descriptions:** re-run `create-player-pages.sh` with `--force`, or clear `rank_math_description` on the player pages and press **Build player pages** (it refills empty fields).
- **Team hub titles:** the Tools-screen retitle only recognises the old `YYYY {Team} Fantasy Football Hub | StatChasers` template (`statchasers-team-pages.php` ≈ 1679-1688). It will treat the current "{Team} 2026: Record, …" titles as custom and skip them. Either update that pattern to recognise the current template before the rollover, or clear `rank_math_title` on the hubs and rebuild.

### 4. RB handcuffs: owner decision

`BASIS_SEASON = 2026` is in `artifacts/api-server/src/lib/rb-handcuffs/handcuffs-data.ts:70`.

Per the project notes, **do not flip it without asking**. When it moves to 2027:
- the model's role basis becomes 2027;
- the previous season becomes `rb_stats_2026.json`. That one is a code change too: `FILES.previous` in the same file (line 74) names `rb_advanced_stats_2025.json` outright and does not follow `BASIS_SEASON`;
- the Player Quality window keeps reaching one season back.

Until it moves, the daily **handcuff stats** step keeps rebuilding `rb_stats_2026.json` (a no-op once 2026 is final). From week 1 the step asks nflverse for `seasonYear()`, so it starts producing `rb_stats_2027.json` alongside.

### 5. Optional: pin the schedule

`SC_SCHEDULE_SEASON=2026` pins the schedule to 2026 even after nflverse publishes 2027. That is useful if you want the finished season up through the draft. Remove it to follow the calendar again. It is not needed for the March–May gap, which is automatic now.

### 6. After the Super Bowl: rebuild the all-time series

The matchup pages' all-time tiles read `artifacts/api-server/data/rivalry/all-time.json`, which holds complete seasons only (`throughSeason`); the season in progress comes from each page's own schedule. Once the Super Bowl is played, run from `artifacts/api-server`:

```
node scripts/build-rivalry-history.mjs --download
```

`--download` refreshes the stored source files in `data/rivalry/source/` first, which is where the newly finished season comes from; without it the script rebuilds from the stored copies and reproduces the current file. Both the sources and the output need committing. A missed year loses nothing at first: the page counts any season after `throughSeason` from its own five-season window. After five missed years the oldest of those seasons fall out of that window and out of the tiles, so rebuild every year.

The recaps' box scores are stored too, in `data/matchup/boxscores/<season>.json`, and production adds each week's games itself after every game window. A new season needs nothing: the builder starts its file after week 1. To fill a season by hand, `node scripts/matchup/buildBoxscores.mjs <season>`.

### 7. Advanced stats: two directories, and the multi-season tables

The daily chain builds the season's advanced tables twice (`lib/player/live-refresh.ts`): into `data/player-stats/` for `[statchasers_player_stats]`, and with `--dir` into `data/player/advanced_stats/` for the player pages. The two use different table shapes, so neither is a copy of the other. The Stats tab reads **last** season's card from the second one, so a 2027 page needs `advanced_stats/*_2026.json` there; the daily step has been writing it since 2026-09-30. Both stop at week 17 on their own.

The `*_all.json` multi-season tables in both directories hold 2023–2025 and **nothing rebuilds them**. The "all" label is read off the table's rows, so it keeps saying 2023-2025 rather than claiming 2026; adding 2026 to them needs a builder that does not exist yet.

## A quick check after each step

- **API:** `https://newsfeed.replit.app/api/status`. Check `playerStats.season`, `playerStats.latestWeek`, `playerStats.daily.steps` and `fpa.weekNumber`.
- **WordPress:** View Source on one player section URL, one team section URL, `/nfl/nfl-schedule/week-1/` and one depth-chart team page. Check that the year in the `<title>` and the H1 matches the season of the numbers on the page.
