# Player data build scripts

These rebuild `artifacts/api-server/data/player/*`, which is what
`src/lib/player/data.ts` reads and therefore what every player page is made of.
They came across from the standalone statchasers-player-pages app; the only
change made to them here was the data directory, which now comes from
`paths.mjs` rather than being derived sixteen different ways.

Everything writes to `data/player/`, and the files are **committed**. That is
deliberate: a player page assembles itself from JSON already in memory with no
upstream in the request path, which is why it renders in single-digit
milliseconds and why the deployment has no third-party dependency at render
time. The cost is ~13MB in the repository and a rebuild step you run by hand.

## Order

Several of these read what the ones before them wrote, so a cold rebuild runs in
this order:

| # | Script | Writes | Source |
|---|--------|--------|--------|
| 1 | `buildPlayersIndex.js` | `players.json` | Sleeper player dictionary |
| 2 | `buildDepthCharts.js` | `depth_charts.json` | OurLads (scraped, needs `cheerio`) |
| 3 | `buildIndexedPlayers.js` | `indexed_players.json`, `indexed_players_by_team.json` | the two above |
| 4 | `buildGameLogs.js` | `game_logs/<season>.json` | Sleeper weekly stats |
| 5 | `buildGameScores.js` | `game_scores.json` | ESPN scoreboard |
| 6 | `buildDraft.js` | `draft.json` | ESPN athlete search |
| 7 | `buildBios.js` | `bios.json` | game logs + `draft.json`, deterministic templates |
| 7a | `buildBioFacts.mjs` | `bio_facts.json` | Sleeper player dictionary + season stats |
| 8 | `buildDynastyRankings.js` | `dynasty_rankings.json` | KeepTradeCut |
| 9 | `buildProductionSnapshot.mjs` | `player_production.json` | Sleeper season production |
| 10 | `buildInjurySnapshots.mjs` | `player_injuries.json` | injury history |
| 11 | `buildFantasyOutlook2026.js` | `fantasy_outlook_2026.json` | see below |
| 12 | `buildRosterPct.mjs` | `roster_pct.json` | Sleeper league research (ownership) |

`backfillTeamInGameLogs.js` and `syncPlayerTeamsFromDepthCharts.js` are
maintenance passes over files that already exist, not part of a cold build.

`buildRosterPct.mjs` is the one builder here whose output goes stale on its own:
every other file is a record of seasons that have already happened, and this one
is how many leagues rostered a player in a given week. It carries the season and
week it read inside it, so a stale file is stale visibly rather than quietly —
rerun it whenever the number should have moved, which in season is weekly.

## Bio facts

`buildBioFacts.mjs` feeds the Bio tab and only the Bio tab: birth date, college
and high school from Sleeper's player dictionary, plus one row per season the
player was actually on a roster, which is the career timeline.

It is numbered 7a because it needs `players.json` (for the slugs, which it reads
rather than recomputes) and nothing else. It runs about twenty requests — one
per season from 2005 — and takes a minute.

Two things worth knowing before changing it:

**Sleeper answers for seasons a player was not alive for.** Ask
`/stats/nfl/2005?grouping=season` about a 2016 draftee and it returns his
CURRENT team with an empty stats object. Taken at face value that put Jacoby
Brissett on Arizona in 2005. The builder therefore requires a non-empty stat
line before it records a season, and a timeline that starts before a player's
draft year is the signature of that guard having been removed.

**There is no hometown.** Sleeper's `birth_city` and `birth_state` are null for
every active player at every position — not sparse, empty — so the Bio tab has
no hometown row. If a source for it appears, this is the script that should
carry it.

Re-running one season (`node buildBioFacts.mjs 2019`) rewrites that season for
everybody and leaves the rest of the file alone.

## Seasons

`buildGameLogs.js` and `buildGameScores.js` used to carry
`const SEASONS = [2023, 2024, 2025]`. That list is wrong every September and
wrong *silently* — the build succeeds, the server serves, and every player page
shows last season's game log as though it were this one. Both now derive the
list from the calendar (`season.mjs`), and both take seasons as arguments:

```
node scripts/player/buildGameLogs.js              # 2023 through the current season
node scripts/player/buildGameLogs.js 2026         # just this one
SC_SEASON=2025 node scripts/player/buildGameLogs.js   # pin "current" for a backfill
```

Naming one season rebuilds one file and leaves the others alone, which matters
because they are committed: a full rebuild rewrites four megabytes of JSON to
re-derive numbers that stopped changing when the season ended.

`buildGameScores.js` used to need one more thing per season — `SEASON_STARTS`,
the Thursday of week 1 — because it asked ESPN for a date range and counted the
window off that anchor. It no longer does: ESPN now answers `dates=<from>-<to>`
with `400 Failed to get events endpoint.`, and the week is asked for directly
(`dates=<season>&seasontype=2&week=<n>`). There is no calendar to maintain and
nothing to add in September.

It records a game only once ESPN calls it `STATUS_FINAL`. A game still being
played carries the score as it stands, and a settled "W" printed over a game in
progress would sit there until somebody rebuilt the file — so an in-season run
leaves the afternoon's unfinished games out and picks them up on the next one.

That script also **merges** into `game_scores.json` rather than replacing it,
and will not overwrite a season already on disk with an empty fetch. ESPN rate
limits and blocks, and both of those would otherwise turn three finished seasons
into nothing.

`advanced_stats/<pos>_<season>.json` is not built here — those tables arrive
from the advanced-stats pipeline and are dropped in whole. The Advanced Stats
tab reads whatever columns they declare, so a table with new metrics in it
renders without a code change.

## The 2026 outlook

`buildFantasyOutlook2026.js` is the one script that calls an LLM, and it is a
three-step workflow rather than one command:

```
node scripts/player/outlookPrep.js          # per-player input bundles
ANTHROPIC_API_KEY=... node scripts/player/buildFantasyOutlook2026.js
node scripts/player/outlookMerge.js         # fold the parts into the file
```

`outlookMerge.js` never clobbers a record marked `edited: true`, so a hand-written
outlook survives a regeneration.

### What a record carries

`headline` and `body` are the original two fields. Everything else is the
**decision layer** the Outlook tab renders around them, and all of it is
authored in the same pass:

| field | shape | drives |
| --- | --- | --- |
| `quickTake` | 2–3 sentences | the take under the head |
| `weeklyRole` | 1–3 words | the Weekly Role chip |
| `restOfSeason` | `"QB3 / Matchup Play"` | the Rest-of-Season chip |
| `confidence` | `High` \| `Moderate` \| `Low` | the Confidence chip |
| `range` | `floor`/`expected`/`ceiling`, each `{best, worst, note}` | the range spectrum |
| `upsideTriggers` | 3 strings | the left column of "What Moves The Outlook" |
| `warningSigns` | 3 strings | the right column |
| `usage` | `{standard, deep, bestWhen, avoidWhen}` | "How To Use Him" |
| `verdict` | `{call, rationale}` | the closing slab |

Every one of them is **optional**, and each is validated on its own: a malformed
`range` does not cost the record its triggers, and a record with no decision
layer at all still renders a perfectly good tab from `headline`, `body` and the
measured driver strip. The failure mode of a bad generation is a shorter tab,
never a wrong one.

Two validations are worth knowing about, both in `parseModelJson`:

- **The range is dropped whole unless it is ordered** —
  `ceiling.best <= expected.best <= floor.best`, and the same for `worst`. A
  ceiling worse than the floor is not a range, it is a mistake, and drawing it
  would put the marker off the axis.
- **`verdict.call` must come from a fixed vocabulary** (`VERDICT_CALLS`).
  Free text drifts: three runs produce "Matchup Play", "matchup-dependent" and
  "Use in good matchups" for the same call. `Buy` and `Sell` are deliberately
  not in the list — this site has no trade-market data behind them.

The four driver cards on the tab are **not** in this file and are not authored.
They are measured from `keyStats` against the position's own distribution — see
`src/lib/player/outlook-drivers.ts` — so they stay true without anybody
rewriting them, and the categories differ by position.

To see what one generation produces before committing to a full run:

```
ANTHROPIC_API_KEY=... node scripts/player/buildFantasyOutlook2026.js \
  jacoby-brissett --force --print
```

`--print` shows the prose and then the decision layer as JSON, and names any
field that was dropped in validation.

Two things to know before running it:

- **`OUTLOOK_MODEL` still defaults to `claude-opus-4-8`**, which is what the
  standalone app pinned. It was not changed as part of moving the script, because
  which model writes this site's copy is a content decision rather than a port
  one. Set `OUTLOOK_MODEL` explicitly, or update the default deliberately.
- The `.outlook_parts/` working directory (about a thousand small files) is
  **not** committed. It is regenerated by `outlookPrep.js` and is an intermediate,
  not data.

## What did not come across

`buildStaticApi.js` built a static JSON API under `dist/wp/data` for the old
self-contained WordPress plugin, which bundled the whole dataset in its zip and
read it from wp-uploads. `[statchasers_player]` fetches a server-rendered
fragment instead, so there is nothing for that script to feed. The same goes for
the plugin-directory mirrors that `buildFantasyOutlook2026.js` and
`outlookMerge.js` used to write: the API's copy is now the only copy.
