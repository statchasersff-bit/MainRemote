# Edge purge retry (2026-11-25)

Branch `fix/depth-followups-2026-11-25`, on top of the depth snapshot
consumers commit (docs/DEPTH-SNAPSHOT-CONSUMERS-2026-11-25.md), based on main
f3c6dd7 (plugin 1.10.71). Approved by mak; ships in a later release with the
consumers work, not in 1.10.71. No version bump here.

## Why

mak cannot change Rocket.net's edge rules. The edge keeps every page 30 days
and ignores origin headers, so the `s-maxage=21600` the pages send never
applies; a targeted purge is the only thing that refreshes them. In 1.10.71
`statchasers_edge_purge_paths()` returns a string the callers store and never
act on: a publication is recorded even when its purge failed, the next check
says `unchanged`, and the page can stay stale until the next data change, up
to 30 days.

## What the purge reports now

`statchasers_edge_purge( $paths, $filter )` (statchasers-edge-cache.php)
returns `state`, `text`, `purged`, `failed`. Rocket.net is called 30 paths at
a time, so failures are known per batch:

| state | when | retried |
| --- | --- | --- |
| `ok` | every call answered `success: true` (`rocket.net ok`) | no |
| `failed` | a call answered `success: false` (`refused`), no readable answer (`sent`: timeout, curl error, or the mu-plugin's guard file after a 401/403, which returns `[]`), or threw (`error`); `failed` lists that call's paths | yes |
| `skipped` | the mu-plugin is absent (`no edge purge available`), or the short-circuit filter returned a string | no |

`text` is the 1.10.71 string, still stored as `edge`.
`statchasers_edge_purge_paths()` remains and returns `text`. The short-circuit
filter may now also return an array (`failed`, optional `state`, `text`), which
the tests use.

## The retry rule

Each publication record carries a ledger, `edge_retry`: `pending` (paths to
retry), `warm` (which of them to warm once they land), `attempts`, `first_at`,
`last_at`, `next_at`, `last` (the last purge's text), `abandoned` (given up),
`gave_up_at`, `state`.

- **When:** on the caller's own five-minute WP-cron run, once `next_at` is
  reached (a minute of slack for cron timing).
- **Backoff:** 5, 10, 20, 40, 80 minutes after the attempt before.
- **Bound:** 6 attempts in all (the publication's own purge + 5 retries,
  about 2.6 hours). Paths still failing then move to `abandoned`, are
  recorded, and are not retried again by the timer.
- **A new publication** purges its own paths together with everything pending
  or abandoned, in one purge (the union, each path once), and its count starts
  again at 1. So given-up paths get another chance on the next data change,
  never in a loop.
- **Skipped is not failed:** a skipped purge leaves nothing pending; if a
  pending retry comes back skipped (the mu-plugin is gone), the ledger clears
  (`attempt N: skipped (...); not retried`).
- **No re-fetch:** a retry only calls Rocket.net; it never asks the API again
  and never touches the fragment or matchup transients.
- **No second WP Rocket clean:** its files were cleared before the first purge
  (and the plugin's fresh renders were replaced or dropped first), so they can
  only refill from the new render. Cleaning again would not change what the
  edge refills with.
- **Warm only after landing:** the publication's own warm-up covers only the
  paths whose purge landed (or was skipped). A retry that lands schedules
  `statchasers_edge_retry_warm` events (4 URLs each, desktop + phone, a minute
  apart from a minute on), which write `retry_warm` / `retry_warmed_at` into
  the record.

## Callers

| Caller | Record (option) | Retry runs on |
| --- | --- | --- |
| League page, `scdc_published` -> `statchasers_depth_charts_on_published` | `statchasers_depth_charts_hub_published` | the team poll's five-minute event `statchasers_depth_charts_publish_check`, priority 5 (`statchasers_depth_charts_hub_retry`; the hook itself fires during a refresh, not on a schedule). Writes the record only when a retry ran. |
| Team tabs, `statchasers_depth_charts_publish_check` | `statchasers_depth_charts_team_published` | the same event, inside the check |
| Stats pages, `statchasers_player_stats_publish_check` | `statchasers_player_stats_published` | its own five-minute event, inside the check |
| Consumers, `statchasers_depth_consumers_check` | `statchasers_depth_consumers_published` | the depth event, priority 20, inside the check |

A check that publishes nothing (unchanged, version unavailable, fetch failed,
no club / page changed, baseline) runs the retry when it is due.

## Record fields (added; nothing removed or renamed)

- `edge_state`: `ok`, `pending`, `failed` (given up; stale until the next
  publication), `skipped`.
- `edge_pending`, `edge_failed` (counts), `edge_attempts`.
- `edge_retry` (the ledger), `retry` (last retry summary, e.g.
  `attempt 2 of 6: rocket.net ok`), `retried_at`, `retry_warm`,
  `retry_warmed_at`.
- `to_warm` on the team record (slugs), the stats record (URLs) and the
  consumers record (paths, now only the ones whose purge landed).
- `edge` keeps the publication's own purge text; `paths` counts (or lists,
  for the league page) the union that was purged.

The `X-SC-…` headers are unchanged. The depth-charts admin screen shows the
league refresh, not the edge publication, so nothing was added there.

## Upgrade from 1.10.71

1.10.71 records have no ledger and are read as they are. When a record's
`edge` says the purge did not land (`refused`, `sent`, `error`), its paths are
adopted as pending and due at once: the league page's `paths`, the team
record's `changed` clubs' tabs, the stats paths rebuilt from the seasons the
API names now, the consumers record's `changed`. A record whose purge landed
(`rocket.net ok`) gets no ledger until its next publication. Warm-up events
1.10.71 scheduled still run: without `to_warm` the team warm-up uses
`changed` and the stats warm-up all four pages.

Production today (read-only, 2026-11-25): `statchasers_player_stats_published`
has `edge: rocket.net ok`, `paths: 30` (one Rocket.net call); the depth and
consumers records do not exist yet (1.10.70 installed).

## Tests

| Command | Result |
| --- | --- |
| `STATCHASERS_SMOKE_GROUP=dccache php wordpress-plugin/tests/smoke.php` | 120 ok (63 before) |
| `STATCHASERS_SMOKE_GROUP=statscache ...` | 51 ok (25 before) |
| `STATCHASERS_SMOKE_GROUP=dcconsumers ...` | 47 ok (30 before) |
| `env -u INGEST_SECRET php wordpress-plugin/tests/smoke.php` (every group) | 3474 ok, 0 fail |
| `wordpress-plugin/tests/depth-charts/run-tests.sh` | 146 ok, all passed |
| `php -l` on the four changed plugin files | clean |
| `node --test --test-reporter=tap` depth-consumers-version, depth-charts-version, player-stats-publication | 12/12 |
| `node --test --test-reporter=tap` depth-charts-restore, team-depth-chart, team-roster-depth, depth-charts-ingest, embed-key, team | 139/139 |
| depth-charts web003 replay with step 6b (bench `.local/dc-followups/env`, ports 18160-18162) | 4 ACCEPTANCE lines PASS, log `.local/dc-followups/replay-2026-11-25.txt` |
| consumers replay (`SC_POLL_MIN=1`, bench `.local/dc-followups/env-consumers`, ports 18165-18167) | ACCEPTANCE PASS, log `.local/dc-followups/consumers-replay-2026-11-25.txt` |

Smoke cases, per group: the purge fails once then succeeds (retried once,
exactly the pending paths, then warmed, then quiet); keeps failing (6 attempts,
waits 5/10/20/40/80 min, recorded as failed, never warmed, WP Rocket cleaned
once); skipped (no retry loop, also when a pending retry comes back skipped);
a new publication while a retry is pending (one purge of the union, each path
once, count reset, the pending club not fetched again). dccache also covers
the per-batch outcome against a stub `CDN_Clear_Cache_Api` (30 + 5 paths, one
call refused), `[]` as a failure, the 1.10.71 records (landed: quiet; failed:
adopted and retried), the old warm-up event, and the league page's retry on
the five-minute event.

Replay step 6b: the edge model refuses the first purge of snapshot C. Team
tab: recorded `published` with `edge_state: pending`, 0 warm-up events, the
public page still B (edge HIT); the next run (not due) purges nothing; five
minutes on (ledger aged) the retry lands (`attempt 2 of 6: rocket.net ok`),
its warm-up refills the edge, desktop and iPhone show C as HITs; the run after
purges nothing. League page: the refresh's purge refused, the page stays B,
`do_action( STATCHASERS_DEPTH_PUBLISH_HOOK )` five minutes on retries it, and
both devices show the new QB.

## Needs production verification

1. After install, each record gains `edge_state` on its next publication
   (`ok` expected); `wp option get <record> --format=json`.
2. A real refused or timed-out Rocket.net call (cannot be forced from here):
   `edge_state: pending`, then `retry: attempt 2 of 6: rocket.net ok` on a
   later run and `retry_warm` with 200s. Rocket.net's actual answer body on
   failure (assumed: no `success: true`).
3. The mu-plugin's guard file (`api_requests_disabled`) turns every purge into
   `sent`: six attempts, then `edge_state: failed`. Someone must delete the
   guard file; the next publication then purges the abandoned paths too.
4. `wp cron event list | grep statchasers_edge_retry_warm` only after a
   retry landed.
