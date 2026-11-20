# Depth charts: manual update (team hubs)

The team hubs' Depth Chart tab renders `artifacts/api-server/data/depth-charts/statchasers/depth-charts.json`,
a snapshot committed to the repo. It changes only when someone follows these
steps. Keep it that way unless mak approves otherwise:

- The WordPress plugin rebuilds its own copy daily (WP-Cron `scdc_cron_refresh`,
  ~20:17 UTC) for the league-wide depth-chart tool on WordPress. Leave it alone.
- Its push to the app is OFF on purpose (no `STATCHASERS_INGEST_SECRET` in
  wp-config.php). Do not set it: that would update the hubs automatically.
- The app's daily chain is OFF (`SC_DAILY_REFRESH` unset; `/api/status`
  playerStats.daily.enabled = false) since 2026-10-04, after it crashed
  production. Do not turn it on.

## Steps

1. Copy WordPress's current document (read-only):
   `scp -F .local/ssh/config rocket-statchasers:public_html/wp-content/uploads/statchasers/depth-charts.json /tmp/candidate.json`
   (or run `php wordpress-plugin/tests/depth-charts/snapshot.php`, which
   fetches the three sources itself).
2. Save Sleeper's player list for the team check:
   `curl -s https://api.sleeper.app/v1/players/nfl -o /tmp/sleeper.json`
3. Validate:
   `cd artifacts/api-server && node scripts/team/validateDepthSnapshot.mjs /tmp/candidate.json --sleeper /tmp/sleeper.json`
   It refuses (exit 1) a document that is not 32 clubs, is not newer than the
   committed one, or has an empty QB/RB/WR/TE column; it lists every skill
   top-3 change and every listed player Sleeper puts on another club. Read
   the list: a release or trade the source has not caught yet is shown as
   the source lists it (never edited by hand).
4. Copy it over the committed file, run
   `node --test tests/team-depth-chart.test.mjs tests/team-roster-depth.test.mjs`,
   commit ("Depth charts snapshot <date>"), and publish with the next release.
5. After publishing: check two hubs' Depth Chart tabs, then clear WP Rocket and
   the Rocket.net edge (`wp eval "rocket_clean_domain();"`, then `wp cdn purge`).

## Other scheduled work (unchanged, for reference)

| Where | Job | What it does |
|---|---|---|
| WordPress | `scdc_cron_refresh`, daily ~20:17 UTC | Rebuilds the WordPress depth-chart tool's JSON. |
| WordPress | `statchasers_player_auto_build`, daily 15:00 UTC | Creates WordPress pages for newly indexed players. |
| App | practice-report and game-window refreshes | Existing, light; not the daily chain. |
| App | daily chain | OFF since 2026-10-04. |
