# Depth-chart snapshot: the other pages that read it (2026-11-25)

Follow-up to WEB-003 depth charts (docs/WEB-003-DEPTH-CHARTS-CACHE.md), kept
separate from that release. Written on `fix/depth-snapshot-consumers-2026-11-25`
(main efbe131 with a cherry-pick of the release's 5cfed15 under it); now
rebased onto main f3c6dd7 (the depth charts audit, plugin 1.10.71, which
carries that release in its final form) as the first commit of
`fix/depth-followups-2026-11-25`, the cherry-pick dropped. It reuses the
release's version endpoint, five-minute WP-cron event and edge helpers. The
same branch adds the edge purge retry (docs/EDGE-PURGE-RETRY-2026-11-25.md),
which this check also uses. Local only: nothing pushed, deployed, purged or
written to production; no plugin version bump (assigned at release, 1.10.72
or later).

The release's own residual note named two pages that also print the team
snapshot (`artifacts/api-server/data/depth-charts/statchasers/depth-charts.json`)
and are not purged by it: the matchup pages' Player Battles and the team
Draft tab's Pos column.

## 1. Trace

### Matchup Player Battles

| | |
| --- | --- |
| Which pages | The **preview** only (preview-premium.ts `battlesCard`, in the rail). A preview is built (matchup-data.ts, `buildPreview`) when the page is "upcoming": every **unplayed game's dated page** `/nfl/{pair}/{season}-week-{n}/` (the plugin asks for dated previews with `X-SC-Matchup-Preview`), and the **pair's page** `/nfl/{pair}/` while it previews its next meeting (`pairPreviewsMeeting`: within 6 days of kickoff, or no meeting played yet this season). Series pages (pair page outside that window), recaps and finals print no battles. |
| Code that reads the snapshot | preview-extras.ts `battlesFor()`: `depthStarters()` at EDGE, DL (3 each), LB, S (1 each) or CB (2), `depthChartNames()` (every available name on the defense's chart; a defender not on it is never named), `depthHeadshot()`. All go through `readDoc()` -> `readDataJson()` (mtime-keyed). Which battles are shown is picked from season stats, so a chart change can swap a defender or a whole battle. |
| API caches | None specific to the snapshot: `readDataJson` re-reads on mtime, and the fragment's ETag (`matchupVersion`) includes the team `dataVersion` (with the release, the snapshot fingerprint) and `pv<updatedMs>` (which includes the snapshot's `fetchedAt`). A publish restarts the process anyway. |
| WP transient | `sc_matchup_ssr_<md5(origin|matchup|pair|game)>`: 5 min, never past `change_at` (kickoff); 1-day outage backup. |
| WP Rocket | Skipped for a preview (`pregame` -> `DONOTCACHEPAGE`). |
| Edge | The plugin asks `s-maxage` = until kickoff, capped at 6 h (`X-SC-Matchup-Cache: state=pregame; edge-ttl=21600`). Rocket.net replaces it with 30 days (read-only check below). Nothing purges a preview on a chart change: the WEB-040 purge route fires only on game status changes, and is off in production (`STATCHASERS_PURGE_KEY` not defined, checked with `wp config has`). |
| Intended window | WEB-040 (docs/WEB-040-LIVE-MATCHUP-2026-11-24b.md): **a preview lives at most until kickoff, capped at 6 hours**, never in WP Rocket, 5 min in the transient. |

### Team Draft tab

| | |
| --- | --- |
| Which URL | A **hash tab of the hub**: `/nfl/teams/{slug}/#draft`, so the page is the hub `/nfl/teams/{slug}/` (no `/draft/` address; team-render.ts `hash: true`, rendered only into the hub). |
| Code that reads the snapshot | draft-premium.ts `yearCard()` -> draft-render.ts `depthSlotCell()` -> depth-charts.ts `depthSlotFor()` (the slot index, keyed on `fetchedAt` on main, on the content fingerprint with the release). It reads the chart of the club the draftee is **with now** (draft_status.json), so a change to one club's chart can move a cell on **another club's hub**. Nothing else on the hub reads the snapshot (the Depth Chart panel is its own address). |
| API caches | team-ssr render cache keyed on `dataVersion`, which includes `depthChartsVersion()` (+ fingerprint with the release). Restart clears it anyway. |
| WP transient | `sc_team_ssr_*` (section `''`, heading mode): 5 min + 1-day backup. |
| WP Rocket | Desktop + mobile files, 24 h (`purge_cron_interval` 24 HOUR_IN_SECONDS on production). |
| Edge | No plugin header on the hub (none sent); Rocket.net 30 days. |
| Intended window | No lifetime is written for the hub. The documented refresh after a snapshot publish is docs/DEPTH-CHART-MANUAL-UPDATE.md **step 5: a whole-site WP Rocket clean + `wp cdn purge`**, and the API keys the hub's render on the snapshot "so a push re-renders it". The release doc says step 5 is "no longer needed for the tabs"; once it is dropped, nothing refreshes the hub. |

Not a consumer: the player pages' depth role (player/data.ts `loadDepthCharts`)
reads a different file, `data/depth_charts.json`.

### Production, read-only (2026-11-25 ~15:28 UTC, browser UA, 2 s apart)

| URL | cache-control (edge) | plugin header | cf |
| --- | --- | --- | --- |
| /nfl/buffalo-bills-vs-kansas-city-chiefs/ | `public, max-age=0, s-maxage=2592000` | `cdn-cache-control: public, max-age=21600`, `x-sc-matchup-cache: state=pregame; edge-ttl=21600; page-cache=skip` | MISS |
| /nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/ | same | same | MISS |
| /nfl/teams/buffalo-bills/ | same | none | MISS |

The hub printed `EDGE4`, `CB2`, `LT3`, `WR6`, `LB3` Pos cells ("... on the BUF
depth chart"). wp-cli (read-only): plugin 1.10.68, `STATCHASERS_PURGE_KEY` and
`STATCHASERS_INGEST_SECRET` not defined, WP Rocket mobile cache on with
separate mobile files.

## 2. Staging test

`artifacts/api-server/scripts/depth-charts/consumers/replay.mjs`, bench in
`.local/dc-consumers/env` (a copy of the WEB-003 bench, MariaDB on its own
datadir/socket, a `nfl/matchup` holder page added). Real: the API (dist),
embed key, version endpoint; WordPress + MariaDB with this branch's plugin
(transients, matchup cache policy, both five-minute checks run as WP-cron
runs them). Modeled: WP Rocket files and Rocket.net's purge API
(player-stats/web003/bench-mu-plugin.php) and the edge (keeps every 200 per
device until purged, origin headers ignored, as production does). Log:
`.local/dc-consumers/replay-2026-11-25.txt`.

The change (snapshot B): the Bills' LB1 and LB2 trade places (Dorian Williams
and Terrel Bernard, both Bills draftees, both on the hub's Draft tab) and EDGE1
Greg Rousseau is listed Out. Readers: the hub's Pos cell on Williams' row (A
`LB1`, B `LB2`); the Chiefs at Bills Player Battles card naming Williams or
Rousseau (A) or neither (B). Published the normal way: file swapped (tmp +
rename) and the API restarted. Pages: `/nfl/teams/buffalo-bills/`,
`/nfl/buffalo-bills-vs-kansas-city-chiefs/`, `.../2026-week-12/`.

### Today's behavior (the release's tab check only), ordinary requests every 60 s for 7 min

Caches filled with A (desktop + phone, edge HIT on repeat), B published 0 s
later. Seconds after the publish when each layer first showed B (run
2026-11-25, log above):

| Layer (how it was asked) | Hub Draft tab (`Williams LB1` -> `LB2`) | Pair page battles | Dated week-12 battles |
| --- | --- | --- | --- |
| API (direct) | at once (t+1 s) | at once | at once |
| WP render, transient (`?zz=` on WordPress, skips WP Rocket) | **307 s** (5-min transient) | **307 s** | **308 s** |
| WordPress as WP Rocket serves it (no query) | **still A at t+7 min** (Rocket file, 24 h) | 308 s (no Rocket file: pregame skip) | 308 s |
| Edge, desktop | **still A at t+7 min** (HIT) | **still A at t+7 min** | **still A at t+7 min** |
| Edge, iPhone | **still A at t+7 min** | **still A at t+7 min** | **still A at t+7 min** |

The release's tab check ran right after the publish and purged only
`/nfl/teams/buffalo-bills/depth-chart/`. The edge model keeps a page until a
purge, as production's 30-day stamp does; on production the hub would stay A
for up to 30 days (WP Rocket refills at 24 h but the edge never asks), the
previews until a purge or 30 days.

So both pages stay stale past their intended window:

- **Previews:** the transient lets go at ~5 min, but the edge keeps the old
  battles with no end short of 30 days (production ignores the 6 h header;
  even if it honored it, 6 h after a publish is the same window, and nothing
  invalidates on a chart change). Beyond "until kickoff, at most 6 h" for any
  preview whose game is more than 6 h away, and every dated preview of later
  weeks is cached the same way.
- **Draft tab:** the transient lets go at ~5 min, WP Rocket keeps its file
  24 h and the edge 30 days. Without step 5's site-wide purge it is stale
  until something else purges the hub.

## 3. The fix: targeted invalidation on the same publication signal

**API** (`lib/team/depth-consumers.ts`, `routes/team.ts`):
`GET /embed/depth-charts/version` (the release's endpoint, embed key) now also
carries, per club, `hub` (its path) and `draft` (a hash of every Pos-column
cell its Draft tab prints, computed with the same `depthSlotCell()`; memoized
per snapshot fingerprint + draft files + season), and a `previews` map
`{ <path>: { hash, kickoff } }` of every matchup address printing a preview
now (each unplayed game's dated page, plus the pair page while
`pairPreviewsMeeting`), where `hash` = the two clubs' entry hashes (the same
hashes the tabs publish by). `previews` is null when the slate cannot be read.
The preview's "updated" stamp (`updatedMs`, which takes `fetchedAt` among
others) is deliberately not in the hash: it moves with every line refresh.

**Plugin** (`statchasers-depth-consumers-cache.php`, new; required after
`statchasers-depth-charts-cache.php`): on the release's five-minute event
(`statchasers_depth_charts_publish_check`, priority 20, after the tabs), when
the snapshot `version` differs from the one recorded in
`statchasers_depth_consumers_published`:

1. list the hubs whose `draft` hash moved and the preview paths whose `hash`
   moved (a path new to the list is not a change);
2. drop this plugin's fresh render of each (hub fragment transient, matchup
   transient; backups kept), so the refill asks the API, which already serves
   the new snapshot;
3. `rocket_clean_files()` exactly those URLs (desktop + mobile);
4. purge exactly those paths at the edge (`statchasers_edge_purge_paths`,
   Rocket.net targeted purge, 30 a call; same short-circuit filter as the tabs);
5. record, and a minute later warm the hubs and the previews of games kicking
   off within 7 days (or in the last day), desktop + phone.

First run after install: baseline only, no purge. An API before this change
(no `draft`) is not read. No slate: the hubs still publish and the stored
preview hashes are kept for the next publication. By hand:
`wp eval 'print_r( statchasers_depth_consumers_check( true ) );'` (forced:
32 hubs + every preview path). Filter: `statchasers_depth_consumers_purge_paths`.
Deactivation clears the warm event. Paths are filtered to the hub and matchup
shapes; no site-wide purge anywhere.

Scope of one club's change (Bills, bench slate): the Bills hub plus the hubs
whose draftees now play for the Bills (when their cell moves), and the Bills'
preview pages: 17 matchup paths in the bench (the offline replayed slate
still lists the played weeks 8-11 as unplayed, so the API renders previews
there too; production's slate has those finals, so about a dozen). Warm-ups
are limited to the near games.

### With this branch

Same run, after the 7 minutes above (step 4), then a second publication
(snapshot A again) checked at once, with WordPress still holding fresh
transients of B (step 5):

| Step | Check result | Purged | Ordinary requests, desktop + iPhone |
| --- | --- | --- | --- |
| A, first check | `baseline recorded` | nothing | |
| B | `published`: the Bills hub + 17 Bills preview paths; `wp_rocket: true`, `edge: rocket.net ok` | 6 edge entries dropped (3 pages x 2 devices) | MISS -> **B** on all 6, then HIT B on all 6 |
| A again, at once | `published`, same 18 paths | 6 entries | MISS -> **A** on all 6 (the dropped transients kept B from refilling the edge) |
| no change | `unchanged` | nothing | |

`ACCEPTANCE: PASS`. Only the Bills' hub and Bills' preview paths were named;
no other hub, no tab, no site-wide purge.

## 4. Tests

| Command | Result |
| --- | --- |
| `STATCHASERS_SMOKE_GROUP=dcconsumers php wordpress-plugin/tests/smoke.php` (new `smoke-depth-consumers-cache.php`) | all passed |
| `php wordpress-plugin/tests/smoke.php` (every group, incl. `dccache`) | all passed |
| `node --test tests/depth-consumers-version.test.mjs` (new: shape; a Bills LB1/LB2 swap moves only the Bills' Draft hash and only Bills previews; the hub re-renders LB1 -> LB2) | 2/2 |
| `node --test tests/depth-charts-version.test.mjs tests/team-depth-chart.test.mjs tests/team-roster-depth.test.mjs tests/depth-charts-ingest.test.mjs tests/embed-key.test.mjs` | 34/34 |
| `node --test tests/team.test.mjs` | 108/108 |
| `node --test tests/matchup.test.mjs tests/matchup-live-state.test.mjs` | 98/99; the one failure (2021 Wild Card FAQ question order on the Cardinals-Rams page) is not touched by this change (nothing in the matchup render path changed) |
| `tsc -p tsconfig.json --noEmit` | clean |
| staging replay | ACCEPTANCE: PASS (log `.local/dc-consumers/replay-2026-11-25.txt`) |

Runtime cache files the tests rewrite (data/matchup/lines/2026.json,
data/schedule/espn-layer-2026.json) were reverted before committing.

## 5. Needs production verification (after both releases ship)

1. `wp option get statchasers_depth_consumers_published --format=json`
   within 5 minutes of the deploy: `result: baseline recorded`.
2. After the next manual snapshot publish: the option lists only hub paths
   whose Draft cells moved and the changed clubs' preview paths;
   `edge: rocket.net ok`; then `warm` with 200s.
3. Ordinary requests (desktop + iPhone UA) to a changed club's hub and its
   next preview: `cf-cache-status: MISS` then `HIT`, with the new Pos cell and
   battle.
4. Rocket.net's purge of these exact paths for both device variants, and real
   WP Rocket's `rocket_clean_files()` removing the mobile file (modeled here).
5. Step 5 of docs/DEPTH-CHART-MANUAL-UPDATE.md (site-wide purge) can then be
   dropped for these pages too; until both ship, keep it.
6. No Rocket.net rule: mak cannot change the edge rules, so the preview's
   own 6 h / until-kickoff header will never be honored. The purges (and their
   retry) are the only freshness mechanism for these pages.
