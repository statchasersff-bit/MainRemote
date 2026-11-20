# WordPress cache reliability: plugin 1.10.60

Branch `wp-cache-reliability-2026-11-20`, from production `1383a15` (plugin
1.10.59). Approved by mak 2026-11-20 for development; **not uploaded**.
Background: docs/WP-PAGE-CACHE-ORPHANS.md (on team-hubs-phase7-rematch-news).

## Part 1: the four remaining orphans (done on production, 15:36-15:38 UTC)

Quez Watkins (player hub, id 3513429), Tony Pollard (Outlook tab, 3513430),
Raiders-Browns (pair page, 3513644), Browns-Titans (pair page, 3513670).

- **Rechecked:** each still existed with no expiry row. The two player rows
  matched the earlier backup byte for byte.
- **Backed up:** id, name, autoload, raw value and sha256 in
  `~/tmp/orphan-transients-backup-20261120-b/rows.json` (outside public_html,
  sha256 `622e2cd3...`), with `restore.php`.
- **Deleted:** one at a time by id and name, each re-checked against the
  backup checksum. 0.00-0.18 s each.
- **Regenerated:** all four pages 200 with current titles (Raiders-Browns is
  the current Week 12 preview), self-canonical, index. The new entries have
  expiry rows 5 minutes out (normal lifetime).
- **Health:** no lock timeouts (count still 111), no PHP log lines; load
  17-20 on 32 cores. The recount found **0** entries without an expiry.

## Part 2: self-healing reads

`statchasers_cache_get( $key )` (statchasers-assets.php) replaces
`get_transient()` at all 31 page-cache reads in 14 modules (`$cache_key` and
`$backup_key`, every one an `sc_` name). It is get_transient() plus one rule:
**a value whose expiry row is missing is a miss**. The caller then fetches
and stores the page exactly as on any miss, and core's set_transient() repairs
the pair: a value with no expiry is deleted and both rows are written again
with the normal lifetime.

- **No extra query:** get_transient() has just read the expiry row (our
  entries are not autoloaded), so the check is answered from the per-request
  option cache.
- **Nothing deleted on read:** no new locking. At most one fetch per request,
  as on any miss, so no loop. If the store fails, the next request misses
  again, once.
- **Names that are not `sc_`, external object caches and installs** pass
  straight through to get_transient().

## Part 3: one upgrade sweep, claimed atomically

**Before:** every request between an upload and the end of the first sweep ran
the whole sweep (14 broad DELETEs). That produced the 14:23 lock timeouts.

**Now:**
- **Atomic claim.** One `wp_options` row
  (`statchasers_news_upgrade_claim`) taken with INSERT IGNORE, then
  `UPDATE ... WHERE option_value = <what was read>`. Exactly one request
  wins; every other request reads the row and carries on.
- **A lease, not a lock.** The claim expires after 120 s, so a sweep that
  dies with its request is taken over and nothing stays locked.
- **Bounded work.** The claimant works at shutdown, after
  `wp_ob_end_flush_all` has sent the page, for at most 0.75 s. It deletes in
  batches of 50 rows, each value together with its expiry in one statement
  (so the sweep can never orphan anything), and only rows that existed when
  the upgrade was claimed (option_id ceiling), so new-version pages are never
  swept. The outage backups are kept, as before.
- **Paced.** If more is left, the lease is handed back for 30 s. A later
  request continues.
- **Never forever.** The sweep stops after 400 claims or 6 hours; whatever
  is left expires on its own.
- **Run at deploy.** `wp eval 'statchasers_news_run_upgrade_now();'` does the
  whole sweep from WP-CLI, so in practice no visitor request does any of it.
- **Cache clears** (admin button, team build, WP-CLI) use the same batched
  delete.

## Tests (real WordPress 7.1.5 + MariaDB 10.5, local throwaway site)

`wordpress-plugin/tests/cache-integration.php`: 49 checks, all passing in 3
consecutive full runs and 10 storm-only runs.

- **Reads:** a valid entry is a hit with no fetch. An expired entry and an
  entry missing its expiry each cause one fetch and are stored again with the
  5-minute lifetime. The read itself deletes nothing. A missing value with a
  valid or past expiry settles within one or two fetches. Names outside the
  plugin pass through.
- **Concurrency:** 12 simultaneous requests on a page missing its expiry are
  all served fresh, never the stale copy, with 2 fetches in all and no DB
  errors. A 16-process storm (25 mixed reads, expiries and orphanings each, 3
  pages, about 80 orphanings per run) never served an entry that had no
  expiry row.
- **What the storm also measures:** a read can still see an entry's previous
  value for about a millisecond. That happens while core's set_transient() is
  between writing a new expiry row and writing the new value (two
  statements). No read path can close that; it is not an orphan, the entry
  has a valid expiry, and the value is the previous render.
- **Failures:** a cache write that fails (trigger) still serves fresh pages,
  one fetch per request, and leaves no stale value. Rows locked by another
  transaction give fresh pages within the lock-wait timeout, then heal.
- **Upgrade, through the real init hook:**
  - Exactly 1 of 12 simultaneous requests claims, and there are **0** InnoDB
    row lock waits.
  - The sweep finishes (1-2 claims for 3,000-6,600 rows here), the version is
    recorded and the claim row is removed.
  - Fresh pages from before the upgrade are gone; backups, new-version pages,
    other plugins' rows and look-alike names are untouched; 0 orphans.
  - Once swept, nothing claims again.
- **Interruption:** a sweep killed mid-run (after 1,050-1,700 of 12,622 rows)
  leaves its claim with a bounded lease and no orphans. Nobody claims while
  the lease runs; the next request takes over after it; the WP-CLI path
  completes.
- **Limits:** the run and age limits each end the sweep. A claim left by an
  older version does not block a new one. A fresh activation claims, sweeps
  and records the version in one request.
- **Real pages against the real app (production code):** team hub and
  schedule, player hub and injury tab, matchup pair and dated page.
  - Byte-identical output on 1.10.59 and 1.10.60, same headings, same 300 s
    lifetime.
  - With the expiry deleted: 1.10.59 kept serving the entry with no expiry,
    forever. 1.10.60 fetched once and stored it with a 300 s expiry.
- **Same scenarios on 1.10.59 vs 1.10.60 (production baseline):**
  - Entry missing its expiry: 1.10.59 serves STALE on every request; 1.10.60
    serves fresh.
  - 12 requests after an upgrade: 1.10.59 had 1 and 104 row lock waits (two
    rounds) and 26 and 130 DELETE statements (most requests ran the whole
    flush); 1.10.60 had 0 lock waits and 41 batched DELETEs by one claimant.
- **smoke.php:** all passed, including the existing assertions that a routine
  clear keeps the backups and a full clear removes everything of ours and
  nothing similar.

## Part 4: cache-version keys instead of an upgrade sweep (assessment and plan)

Yes, a cache-schema version in the keys can replace broad invalidation for
correctness, with one gap to close.

- **The plan.** Add `STATCHASERS_CACHE_SCHEMA` (an integer, bumped by hand
  only when a release changes the fragment format or how a page is built;
  not the plugin version, so routine releases keep their warm caches). Put it
  into every key's md5 next to the origin.
- **On a bump:**
  - Every read uses new keys at once, so no old HTML is served and nothing is
    deleted on the request path.
  - Old primaries (5 minutes to 1 hour) and backups (1 day for player,
    matchup and team; 7-30 days for the small tools) expire on their own.
  - WordPress core's daily `delete_expired_transients` (scheduled on
    production; next run 2026-11-21 15:14 UTC) removes them.
- **Cost:** for up to a day, a second set of backups. Player and matchup
  backups are about 1.4 GB today, so a bump would roughly double the plugin's
  storage for a day. Compression (Part 5) makes this small.
- **The gap: abandoned orphans.** An entry that lost its expiry under an old
  key is never read again, so it is never healed and never expires. Close it
  with the same claimed, batched, ID-ceiling sweep 1.10.60 adds, aimed only at
  rows that need it:
  1. `sc_` value rows with no expiry row;
  2. `sc_` rows whose expiry has passed.

  That is a fraction of today's broad sweep, and it still runs from WP-CLI at
  deploy time, never from a visitor.
- **Order:** ship 1.10.60 first (safe reads, single claim). Then a release that
  adds the schema version, runs the targeted sweep in place of the broad one,
  and drops the broad sweep.

## Part 5: database size (read-only, production, 2026-11-20 ~16:15 UTC)

The 137 s aggregate scan ran with no lock waits, no PHP log lines and no
load change.

| | |
|---|---|
| `wp_options` | 3,838 MB data + 429 MB free, about 40,700 rows |
| Real settings (non-transient) | 1,170 rows, 15 MB |
| Plugin page caches | about 1.79 GB logical, which is nearly all of the physical table (values over about 8 KB are stored off-page) |
| ...outage backups | about 1.44 GB (80%): player 1,074 MB (6,769 rows, avg 162 KB, max 539 KB), matchup 306 MB, team 42 MB |
| ...live copies | player 271 MB (1,340 rows), matchup 33 MB, team 31 MB, small tools a few MB |
| Expired but not yet removed | about 348 MB (1,261 of 1,340 live player entries; core removes them daily) |
| Autoloaded plugin caches | 0 (all `off`); the whole autoload set is 893 rows, 650 KB |
| Entries without an expiry | 0 now (the 42 removed today were about 6.5 MB: negligible for size; their harm was stale content) |
| Query latency on this table | indexed lookup about 7 ms; one 100-400 KB value about 13 ms; autoload set 137 ms (one sample); a prefix count 310 ms |

- **Growth:** the cache volume is bounded, not growing without limit. It
  follows how many distinct pages are requested per backup lifetime (1 day for
  player, matchup and team), so it tracks crawl breadth: player pages ×
  tabs × formats.
- **Why 3.8 GB is a problem anyway:** it makes every write to `wp_options`
  slower and every lock longer, for every plugin.
- **Safe manual cleanup:** nothing urgent. Expired entries go in the daily
  core run, and orphans are at 0. A table rebuild (`OPTIMIZE TABLE`) would
  return the 429 MB free plus space from deletions, but it locks the table;
  not recommended without a maintenance window.

**Recommendation, safest first:**

1. **Compress the cached HTML** (gzcompress before set_transient, inflate on
   read). HTML compresses about 6-10×, so roughly 1.8 GB becomes about
   200-300 MB in the same storage, with no new service. Small, local change.
2. **File-backed cache for page fragments**
   (`wp-content/cache/statchasers/<kind>/<key>`, written to a temp file and
   renamed atomically, expiry by mtime, swept by age).
   - Takes the caches out of `wp_options` entirely, so no DB locks and
     nothing shared with other plugins.
   - Works on any host; Rocket.net already serves WP Rocket's file cache
     this way.
   - Needs a directory-size guard and an age sweep at deploy.
3. **A supported object cache** (Redis, if Rocket.net offers it). Transients
   would move to memory, but it changes every plugin's caching at once and
   1.8 GB of HTML would pressure memory. Only with Rocket.net's guidance.
4. **A dedicated cache table:** isolates the locks but keeps the size in
   MySQL. Second-best to files.

## Release plan for 1.10.60 (needs mak's approval; not done)

1. Back up the live plugin:
   `cp -a ~/public_html/wp-content/plugins/statchasers-news ~/tmp/statchasers-news-1.10.59-backup-<date>`.
2. Upload `statchasers-news-1.10.60.zip` (sha256 `b86e5260...`) and run
   `wp plugin install ~/tmp/statchasers-news.zip --force`.
3. Immediately: `wp eval 'var_export( statchasers_news_run_upgrade_now() );'`.
   If it returns false, a visitor request claimed first; wait 2 minutes and
   run it again. Production sweeps about 1,800 live entries (about 370 MB) in
   batches of 50; backups are kept.
4. Verify:
   - `statchasers_news_installed_version` = 1.10.60 and no claim row;
   - no new lock timeouts in php.error.log; normal load;
   - 0 entries without an expiry;
   - team, player and matchup pages return 200.
5. No WP Rocket or Rocket.net purge is needed: page output is unchanged.

**Rollback:**
1. Set `wp option update statchasers_news_installed_version 1.10.59` FIRST, so
   1.10.59's old every-request flush does not run on its first requests.
2. `wp option delete statchasers_news_upgrade_claim`.
3. Reinstall the 1.10.59 backup (`wp plugin install <zip> --force`, or restore
   the folder).
4. Cached entries are the same format in both versions; nothing else to
   undo. The 1.10.58 backup (`~/tmp/statchasers-news-1.10.58-backup-20261120`)
   is kept too.
