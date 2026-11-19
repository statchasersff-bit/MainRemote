# Player-data alerting (Phase 1.1, 2026-11-19)

## What exists

The project sends no notifications itself. Its established pattern (docs/INGEST-FIX-CHECKLIST.md, "Monitoring") is a health endpoint that answers **503** when something needs a person, so an uptime checker turns it into a notification. Two exist: `/api/ingest/health` (the news wire) and `/api/data/health` (src/routes/health.ts: database, data directory, FPA freshness, the daily rebuild's steps). `/api/status` always answers 200 and is for diagnosis. Whether a checker is configured against either endpoint is not visible from the repository.

## Added to the existing `GET /api/data/health`

The player-data checks below now add `reasons` (and a `playerData` block) to the existing endpoint, so whatever already watches it pages on them too; no new endpoint, no new service:

| Condition | Alerts when |
|---|---|
| Missing final game (game logs or any stats table) | still absent `DATA_ALERT_GAME_GRACE_H` (default 36) hours after kickoff - Monday night does not page before Tuesday's refresh |
| Player-page vs stats-table mismatch | any player's yards differ for the weeks both cover |
| Stale source data | no successful ingestion in `DATA_ALERT_MAX_AGE_H` (default 192 = 8 days; the refresh is a weekly hand-run chain) while the season is in progress |
| Failed data job | a recorded failure newer than the last success (`data/dataset-meta.json`) |
| Failed scoring reconciliation | a current-season game total differs from the scoring rules with no known cause |

A checker notifies on the 200 -> 503 transition and again on recovery, so a condition that persists does not repeat notifications.

## Needed (not done here)

Confirm an uptime checker is actually pointed at `https://<deployment>/api/data/health`. If none is, that is the missing dependency: choosing and configuring one is an account decision, not a code change. Note the daily rebuild chain is off (since 2026-10-04), so its step checks are inert until it is re-enabled; the player-data checks above work either way because they read the files and data/dataset-meta.json.

## Never replace good data

`buildGameLogs.js` and `buildSeason.mjs` keep the file on disk when a build holds fewer final games than it, record the failure, and never advance `lastIngestedAt` for a failed or partial run.
