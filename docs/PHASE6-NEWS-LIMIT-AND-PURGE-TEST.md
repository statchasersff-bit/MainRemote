# Two small assessments: News 45-day display limit, single-URL purge test

Read-only, 2026-11-20. Nothing has been built or run against production.

## 1. 45-day News display limit with an offseason fallback

**Today, on the live release.** Each team News tab shows 53-61 items, read
from a 180-day window (TEAM_WINDOW_DAYS) and capped at 60
(TEAM_NEWS_LIMIT). Washington is the only team with any item older than 45
days: 11 of its 53 (7 Dynasty Command reports from June and August, 3
September club stories, 1 August item). Its oldest is 155 days old. Every
other team's oldest item is 12.2 days or younger.

**Why a plain 45-day limit is unsafe.** Simulated on the stored news (from
2026-06-16, the start of the archive; players mapped to today's rosters):

| As of | Items within 45 days, per team | Teams under 20 |
|---|---|---|
| Jul 10 | median 1, min 0 | 32 |
| Jul 25 | median 1.5, min 0 | 32 |
| Aug 10 | median 2, min 0 | 23 |
| Sep 1 | median 53, min 4 | 6 |
| Nov 20 | median 60, min 41 | 0 |

The summer figures are low partly because the club and national lanes were
added later, but a dead-period offseason will always be thin. A hard limit
would empty most teams' tabs from February to August.

**Proposed rule (not built).** Apply the 45-day limit only when it leaves
enough to fill the tab; otherwise show exactly what is shown today:

- If at least 20 items fall within 45 days, show only those (up to 60).
- Otherwise, show the current 180-day list unchanged.

| | Effect |
|---|---|
| Washington today | 41 recent items, so the limit applies: 53 down to 41 shown (the 11 June-September items, plus one at the edge, drop off). Featured story and grid still full. |
| Other 31 teams today | No change (every item already within 13 days). |
| Offseason | Fallback applies to most teams: identical to today. |
| Collection, database, other pages | Unchanged. It is a display filter in listNewsForTeam's caller (team-data.ts), team pages only. Player pages' team news (8 items) not affected. |

Thresholds (45 days, 20 items) are parameters; 20 is about a third of the
tab. Risk: low. A team just above 20 recent items could show fewer, older
stories than today; that is the intended trade.
Effort: a few lines plus a test, an app publish, no plugin change.

## 2. Controlled single-URL cache-purge test

**Goal.** Prove we can purge one page from both WP Rocket and the Rocket.net
edge without touching anything else. Game-day purges could then target the
~150 pages that changed instead of the whole site.

**What exists (read from the server, not run):**
- WP Rocket: `rocket_clean_files( array $urls )` removes the cached desktop
  and mobile files for given URLs (`wp-content/cache/wp-rocket/statchasers.com/<path>/index-https.html`,
  plus the `_gzip` and mobile variants).
- Rocket.net mu-plugin cdn-cache-management 1.1.14:
  `CDN_Clear_Cache_Api::cache_api_call( array $files, 'purge' )` posts the
  list to Rocket.net's `/v1/sites/<id>/cache/purge` API. `$files` are site paths
  with a trailing slash (`/nfl/teams/<slug>/matchups/`), the form the plugin
  builds for single posts. It honours its own request guard and logs each call.
  `wp cdn purge` has no per-URL option (it purges everything).

**Test (needs your approval to run; about 5 minutes):**

1. Target: `/nfl/teams/washington-commanders/matchups/` (low traffic).
   Control: `/nfl/teams/washington-commanders/schedule/`.
2. Warm both with a desktop and an iPhone user agent until both answer
   `cf-cache-status: HIT`; record `age` and `last-modified`; confirm the WP
   Rocket files exist for both.
3. Run over SSH:
   `wp eval 'rocket_clean_files( array( "https://statchasers.com/nfl/teams/washington-commanders/matchups/" ) ); var_export( CDN_Clear_Cache_Api::cache_api_call( array( "/nfl/teams/washington-commanders/matchups/" ), "purge" ) );'`
4. Pass if:
   - the target's WP Rocket files are gone and the control's remain;
   - the target answers MISS for both user agents, then HIT with a new `last-modified`;
   - the control stays HIT with its `age` still counting up;
   - the plugin's log records one `cache_api_call` with `files_count: 1` and a success response.
5. If the edge does not purge, or the control is affected: stop. Fall back to
   the documented full purge (WP Rocket, then `wp cdn purge`) and report.

**Risk.** Negligible: one page is regenerated once. No settings, rules,
lifetimes or schedules change, and nothing is left running.
**If it passes,** the game-day procedure in GAME-DAY-CACHE-FRESHNESS.md can
gain a targeted variant: a hand-run list of the clubs that played and their
pair pages. It stays manual, with no automation.
