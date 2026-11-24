# WordPress page-cache entries that never expire: cleanup record and permanent fix

2026-11-20. Cleanup approved by mak and done; the permanent fix is a proposal
only (no plugin change deployed).

## What was wrong

The plugin caches each rendered page from the app as a WordPress transient
in `wp_options`: a value row `_transient_sc_<kind>_ssr_<md5>` plus an expiry
row `_transient_timeout_sc_<kind>_ssr_<md5>`. A value row whose expiry row is
missing never expires: WordPress treats it as permanent, the plugin serves it
forever, and only a version-change flush or a manual delete clears it.

Found during the Phase 7 verification: three pair pages showing October-format
titles (Ravens-Browns, Texans-Jaguars, Ravens-Steelers) and stale previews
(Buccaneers-Lions, Bears-Lions).

## Cleanup (2026-11-20 15:15-15:31 UTC)

- **Verified:** 38 rows (21 matchup, 17 player), all `sc_matchup_ssr_` /
  `sc_player_ssr_` value rows with no expiry row. None of them were backups.
  All had autoload `off`, which is what WordPress writes for an entry created
  WITH an expiry, so the expiry was lost after creation. `option_name` has a
  unique index, so no duplicate names. No external object cache. No other
  plugin, mu-plugin or theme uses these names. No expiry rows without a value.
- **Backup:** `~/tmp/orphan-transients-backup-20261120/rows.json` on Rocket.net
  (outside `public_html`; 6.57 MB; sha256 `41374de3...`). It holds option_id,
  name, autoload, raw stored value and a sha256 per row, plus `restore.php`
  (`wp eval-file restore.php`, INSERT IGNORE). wp_options has no row
  timestamps; option_id order and the export time (15:20:2x UTC) are
  recorded. The export already held 40 rows: 2 more had lost their expiry
  since the inspection.
- **Deleted:** exactly the 38 approved IDs, in batches of 3, 9, 9, 9 and 8,
  each row by `option_id` + `option_name`. Each was re-checked at deletion time:
  still in the approved list, still without an expiry row, value unchanged
  since the backup. Each delete took 0.00-0.34 s. No errors, no lock
  timeouts, no PHP log lines during or after the deletes; load 17-22 on 32
  cores before, during and after.
- **Regenerated** (uncached requests): the three pair pages now carry the
  current titles and their self-canonicals; Buccaneers-Lions shows the
  current Week 11 preview and Bears-Lions the Week 12 preview; archive game
  pages show current titles; the LAR-SF Week 1 game page (owned) still points
  its canonical at the pair page. Player pages checked: Kenneth Walker III
  injury, A.J. Brown stats, Daniel Bellinger game log, Samaje Perine outlook,
  Travis Hunter, Kyler Murray bio. All 200, current titles, self-canonical.
- **New entries have expiry rows:** of the 38 keys, 13 had already
  regenerated at 15:31, each with an expiry row (matchup pages 5 minutes
  out, the normal lifetime). The other 25 are simply absent until their page
  is next visited, and are then written normally.

## Why it happens: two causes

### 1. The version-change flush (the 14:23 lock timeouts)

`statchasers-news.php` runs on `init` on every request:

    if ( STATCHASERS_NEWS_VERSION === get_option( installed ) ) return;
    statchasers_news_flush();              // ~14 broad DELETE ... LIKE statements
    update_option( installed, VERSION );   // only AFTER the flush

Every request that arrives between the upload and the end of the first
flush runs the whole flush. Each flush is a set of
`DELETE ... WHERE option_name LIKE ...` statements. Each one removes
thousands of 100-400 KB rows from a 3.8 GB table in a single statement, and
holds their row locks until it finishes. Concurrent copies wait on each other's row locks: that is the 9
`Lock wait timeout exceeded` lines at 14:23:01-06, all on the
`sc_player_ssr` flush statement.

### 2. WordPress core's transient race, made likely by this table

On WordPress 7.1.5 (verified on the server):

- `get_transient()` on an expired entry: `delete_option( value )`, THEN
  `delete_option( timeout )`: two statements.
- `set_transient()` on an existing entry: `update_option( timeout )`, THEN
  `update_option( value )`, and `update_option` of a missing row inserts it.

When two requests regenerate the same page at once (common right after a
purge, or when crawlers hit a cold page), the reader's two deletes can wrap
around the writer's two updates. The writer refreshes the expiry, the reader
deletes it (and the old value), and the writer's value update finds no row
and inserts one. The result is a value with no expiry. A lock timeout on
either delete has the same effect.

This is still happening: 4 new orphans appeared between 15:15 and 15:31
(Quez Watkins, Tony Pollard player pages; two matchup pages) with no flush
running. The table's size makes it worse: `wp_options` is 3.8 GB in about
40,700 rows. Our page caches are about 1.55 GB of it (player 1,150 MB in
7,090 rows; matchup 314 MB; team 51 MB), with values of 100-400 KB that are
slow to write.

## Proposed permanent fix (not built, not deployed)

1. **Self-healing reads (small, highest value).** Read our page caches
   through one helper, `statchasers_cache_get( $key )`. It checks the expiry
   row first; a value with no expiry row is deleted and treated as a miss.
   Whatever the race leaves behind is then repaired on the next view, not
   served forever. No mass operation; one extra indexed read per page view
   (and `get_transient` already reads that row).
2. **Single-execution version change.** Replace "check, flush, then record" with
   an atomic claim: `UPDATE wp_options SET option_value = <new> WHERE
   option_name = <installed> AND option_value = <old>`. Only the request
   that changes the row (rows affected = 1) does the work; every other
   request sees the new version and returns.
3. **No mass DELETE on the request path.** Instead of deleting every cached
   page on upgrade, put a generation number in the cache keys (the plugin
   version is enough). After an upgrade the old keys are never read again
   and expire on their own (5 minutes to 1 day), and WordPress core's daily
   expired-transient cleanup removes them. If a sweep is still wanted, run it
   from WP-CLI at deploy time, deleting by primary key in batches of 200 with
   a short pause, never from a visitor's request.
4. **Longer term (assessment, needs Rocket.net input).** Move the large
   page-fragment caches out of `wp_options`: to the filesystem
   (`wp-content/cache/statchasers/`, one file per key, atomic rename on write),
   or to Rocket.net's object cache if one is available. That removes about
   1.5 GB from the table every other plugin also queries, along with the
   lock contention that comes with it.

Items 1 and 2 are small and low-risk, and they ship together as one plugin
release. Item 3 changes the upgrade behavior and is worth a test on staging.
Item 4 is the structural fix.

## Rollback of the cleanup

`wp eval-file ~/tmp/orphan-transients-backup-20261120/restore.php` re-inserts
the 38 rows exactly as they were (INSERT IGNORE: anything regenerated since is
left alone). There is no reason to expect it will be needed: the rows were
stale copies, and the plugin rebuilds them on demand.
