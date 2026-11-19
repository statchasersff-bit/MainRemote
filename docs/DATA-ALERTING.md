# Player-data alerting (Phase 1.1, 2026-11-19)

## What exists

The project sends no notifications itself. Its established pattern (docs/INGEST-FIX-CHECKLIST.md, "Monitoring") is a health endpoint that answers **503** when something needs a person, so any uptime checker (Replit's, UptimeRobot, a curl in cron) turns it into a notification. `/api/status` always answers 200 and is for diagnosis. Whether a checker is actually configured against `/api/ingest/health` is not visible from the repository.

## Added

`GET /api/data/health` - 200 or 503 with `reasons`, for the current season:

| Condition | Alerts when |
|---|---|
| Missing final game (game logs or any stats table) | still absent `DATA_ALERT_GAME_GRACE_H` (default 36) hours after kickoff - Monday night does not page before Tuesday's refresh |
| Player-page vs stats-table mismatch | any player's yards differ for the weeks both cover |
| Stale source data | no successful ingestion in `DATA_ALERT_MAX_AGE_H` (default 192 = 8 days; the refresh is a weekly hand-run chain) while the season is in progress |
| Failed data job | a recorded failure newer than the last success (`data/dataset-meta.json`) |
| Failed scoring reconciliation | a current-season game total differs from the scoring rules with no known cause |

A checker notifies on the 200 -> 503 transition and again on recovery, so a condition that persists does not repeat notifications.

## Needed (not done here)

Point the existing uptime checker at `https://<deployment>/api/data/health` with the same settings as `/api/ingest/health`. If none is configured, that is the missing dependency: choosing and configuring a checker is an account decision, not a code change.

## Never replace good data

`buildGameLogs.js` and `buildSeason.mjs` keep the file on disk when a build holds fewer final games than it, record the failure, and never advance `lastIngestedAt` for a failed or partial run.
