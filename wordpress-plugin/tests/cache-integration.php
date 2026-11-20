<?php
/**
 * Cache reliability tests (plugin 1.10.60) against a REAL WordPress and MySQL.
 *
 *     SC_WP_PATH=/path/to/wordpress php wordpress-plugin/tests/cache-integration.php
 *
 * smoke.php stubs WordPress; the bugs this covers live in WordPress core's
 * get_transient()/set_transient() and in InnoDB row locks, so these run
 * against a throwaway site with the plugin active. Never point SC_WP_PATH at a
 * site whose data matters: the tests write, delete and lock wp_options rows.
 *
 * The app is mocked through pre_http_request: every fetch is counted, so a
 * test can say how many times a page was regenerated. Concurrency uses
 * separate PHP processes, each with its own database connection, held at a
 * starting line BEFORE WordPress loads and released together - so the
 * upgrade tests exercise the plugin's real init hook, as visitor requests do.
 *
 * @package StatChasers\Tests
 */

$wp_path = getenv( 'SC_WP_PATH' );
if ( ! $wp_path || ! is_file( "$wp_path/wp-load.php" ) ) {
	fwrite( STDERR, "SC_WP_PATH must point at a throwaway WordPress install\n" );
	exit( 2 );
}
$role = $argv[1] ?? 'parent';

if ( 'child' === $role ) {
	$start = (float) $argv[3];
	while ( microtime( true ) < $start ) {
		usleep( 200 );
	}
	$GLOBALS['sc_t0'] = microtime( true );
}

require "$wp_path/wp-load.php";

const SC_MOCK_ORIGIN = 'http://mock.test';
$GLOBALS['sc_http_calls'] = 0;
add_filter( 'statchasers_news_origin', static fn() => SC_MOCK_ORIGIN );
add_filter(
	'pre_http_request',
	static function ( $pre, $args, $url ) {
		if ( 0 !== strpos( (string) $url, SC_MOCK_ORIGIN ) ) {
			return $pre;
		}
		$GLOBALS['sc_http_calls']++;
		return array(
			'headers'  => array( 'x-matchup-state' => 'upcoming', 'x-matchup-game' => '', 'etag' => 'W/"t"' ),
			'body'     => '<div class="fresh" data-pid="' . getmypid() . '">fresh ' . microtime( true ) . '</div>',
			'response' => array( 'code' => 200, 'message' => 'OK' ),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);

function sc_key( string $slug ): string {
	return 'sc_matchup_ssr_' . md5( SC_MOCK_ORIGIN . '|matchup|' . $slug . '|' );
}

/* ----------------------------------------------------------------- children */

if ( 'child' === $role ) {
	global $wpdb;
	$wpdb->suppress_errors( true );
	$scenario = $argv[2];
	if ( ! empty( $argv[5] ) ) {
		$wpdb->query( 'SET SESSION innodb_lock_wait_timeout = ' . (int) $argv[5] );
	}
	$GLOBALS['sc_out'] = array( 'pid' => getmypid(), 'errors' => array() );
	// Reported last, after WordPress's own shutdown hooks (the upgrade sweep
	// runs there), on a line of its own the parent looks for.
	register_shutdown_function(
		static function () {
			global $wpdb;
			$out            = $GLOBALS['sc_out'];
			$out['http']    = $GLOBALS['sc_http_calls'];
			$out['t']       = round( microtime( true ) - $GLOBALS['sc_t0'], 3 );
			$out['claimed'] = isset( $GLOBALS['statchasers_news_upgrade_claim'] );
			$out['done']    = $GLOBALS['statchasers_news_upgrade_done'] ?? null;
			if ( '' !== (string) $wpdb->last_error ) {
				$out['errors'][] = (string) $wpdb->last_error;
			}
			echo "\n@@RESULT@@", wp_json_encode( $out ), "\n";
		}
	);
	$note = static function () {
		global $wpdb;
		if ( '' !== (string) $wpdb->last_error ) {
			$GLOBALS['sc_out']['errors'][] = (string) $wpdb->last_error;
			$wpdb->last_error              = '';
		}
	};
	if ( 'fetch' === $scenario ) {
		$page = statchasers_matchup_fetch( $argv[4] );
		$note();
		$GLOBALS['sc_out']['ok']    = is_array( $page ) && '' !== (string) ( $page['html'] ?? '' );
		$GLOBALS['sc_out']['stale'] = is_array( $page ) && false !== strpos( (string) $page['html'], 'STALE' );
	} elseif ( 'storm' === $scenario ) {
		// Mixed reads and state changes on three pages. "STALE#<id>" is only
		// ever written into a value in the same single statement that removes
		// its expiry row, and the moment that statement has committed is logged.
		// A read that STARTED after that moment and still returned it has
		// served an orphan. (A read that straddles the orphaning can see the
		// value that was valid an instant before: WordPress reads the expiry and
		// the value in two queries, and no read path can close that.)
		mt_srand( getmypid() );
		$ok    = true;
		$stale = false;
		$seen  = array();
		$log   = getenv( 'SC_STORM_LOG' );
		for ( $i = 0; $i < 25; $i++ ) {
			$slug = 'storm-' . mt_rand( 1, 3 );
			$ck   = sc_key( $slug );
			$r    = mt_rand( 1, 10 );
			if ( $r <= 7 ) {
				wp_cache_flush();
				$t_read = microtime( true );
				$page   = statchasers_matchup_fetch( $slug );
				$ok     = $ok && is_array( $page );
				if ( is_array( $page ) && preg_match( '/STALE#([0-9a-f.]+)/', (string) $page['html'], $m ) ) {
					// Did the entry have an expiry row when it was served? (Checked
					// right away; a concurrent writer can put one back in between.)
					$has = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name = %s", '_transient_timeout_' . $ck ) );
					$seen[] = array( $m[1], $t_read, $has );
				}
			} elseif ( 8 === $r ) {
				$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %d WHERE option_name = %s", time() - 5, '_transient_timeout_' . $ck ) );
			} else {
				$id   = uniqid( '', true );
				$blob = serialize( array( 'html' => "STALE#$id", 'version' => '', 'state' => '', 'season' => '', 'score' => '' ) );
				$wpdb->query(
					$wpdb->prepare(
						"UPDATE {$wpdb->options}
						 SET option_value = IF( option_name = %s, %s, option_value ),
						     option_name  = IF( option_name = %s, CONCAT( 'dead_', option_id, '_', option_name ), option_name )
						 WHERE option_name IN ( %s, %s )",
						'_transient_' . $ck,
						$blob,
						'_transient_timeout_' . $ck,
						'_transient_' . $ck,
						'_transient_timeout_' . $ck
					)
				);
				file_put_contents( $log, $id . ' ' . microtime( true ) . "\n", FILE_APPEND | LOCK_EX );
			}
			$note();
		}
		$GLOBALS['sc_out']['ok']   = $ok;
		$GLOBALS['sc_out']['seen'] = $seen;
	} elseif ( 'visit' === $scenario ) {
		// A visitor request: WordPress has loaded and the plugin's init hook has
		// run (and claimed the upgrade sweep or not); the sweep, if ours, runs
		// at shutdown. Nothing else to do.
		$GLOBALS['sc_out']['visit'] = true;
	} elseif ( 'longsweep' === $scenario ) {
		// The init hook claimed; run the sweep now with no budget, to be killed.
		if ( isset( $GLOBALS['statchasers_news_upgrade_claim'] ) ) {
			echo "STARTED\n";
			fflush( STDOUT );
			statchasers_news_run_upgrade( $GLOBALS['statchasers_news_upgrade_claim'], 0.0 );
		}
	} elseif ( 'lock' === $scenario ) {
		$ck = sc_key( $argv[4] );
		$wpdb->query( 'START TRANSACTION' );
		$wpdb->query( $wpdb->prepare( "SELECT option_id FROM {$wpdb->options} WHERE option_name IN (%s, %s) FOR UPDATE", '_transient_' . $ck, '_transient_timeout_' . $ck ) );
		sleep( 6 );
		$wpdb->query( 'COMMIT' );
	}
	exit( 0 );
}

/* ------------------------------------------------------------------ parent */

global $wpdb;
$fails = 0;
function is( $got, $want, string $label ): void {
	global $fails;
	if ( $got === $want ) {
		echo "  ok    $label\n";
		return;
	}
	$fails++;
	echo "  FAIL  $label\n        got:  " . var_export( $got, true ) . "\n        want: " . var_export( $want, true ) . "\n";
}
function rows( string $ck ): array {
	global $wpdb;
	wp_cache_flush();
	$v = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", '_transient_' . $ck ) );
	$t = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", '_transient_timeout_' . $ck ) );
	return array( 'value' => null !== $v, 'timeout' => null === $t ? null : (int) $t - time(), 'stale' => null !== $v && false !== strpos( $v, 'STALE' ) );
}
function healthy( string $ck ): bool {
	$r = rows( $ck );
	return $r['value'] && null !== $r['timeout'] && $r['timeout'] > 0;
}
function fetch_calls( string $slug ): array {
	wp_cache_flush();
	$before = $GLOBALS['sc_http_calls'];
	$page   = statchasers_matchup_fetch( $slug );
	return array( $GLOBALS['sc_http_calls'] - $before, is_array( $page ) ? (string) $page['html'] : null );
}
/** Run children together; each argset is ( scenario, start_at, arg, lock_wait ). */
function children( array $argsets, ?callable $while_running = null ): array {
	$procs = array();
	$pipes = array();
	foreach ( $argsets as $i => $args ) {
		$cmd         = array_merge( array( PHP_BINARY, '-d', 'memory_limit=512M', __FILE__, 'child' ), array_map( 'strval', $args ) );
		$procs[ $i ] = proc_open( $cmd, array( 1 => array( 'pipe', 'w' ), 2 => array( 'pipe', 'w' ) ), $p );
		$pipes[ $i ] = $p;
	}
	if ( $while_running ) {
		$while_running( $procs, $pipes );
	}
	$out = array();
	foreach ( $procs as $i => $proc ) {
		$stdout = stream_get_contents( $pipes[ $i ][1] );
		$stderr = stream_get_contents( $pipes[ $i ][2] );
		proc_close( $proc );
		$out[ $i ] = preg_match( '/@@RESULT@@(\{.*\})/', $stdout, $m ) ? json_decode( $m[1], true ) : array( 'raw' => substr( $stdout . $stderr, -400 ) );
	}
	return $out;
}
function errs( array $res ): array {
	$e = array();
	foreach ( $res as $r ) {
		if ( isset( $r['raw'] ) ) {
			$e[] = 'no result: ' . $r['raw'];
		}
		foreach ( (array) ( $r['errors'] ?? array() ) as $x ) {
			$e[] = $x;
		}
	}
	return $e;
}
function orphans(): int {
	global $wpdb;
	return (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->options} v LEFT JOIN {$wpdb->options} t ON t.option_name = CONCAT('_transient_timeout_', SUBSTRING(v.option_name, 12))
		 WHERE v.option_name LIKE '\\_transient\\_sc\\_%' AND v.option_name NOT LIKE '\\_transient\\_timeout\\_%' AND t.option_id IS NULL"
	);
}
function store( string $ck, string $html, int $ttl = 300 ): void {
	wp_cache_flush();
	delete_transient( $ck );
	set_transient( $ck, array( 'html' => $html, 'version' => '', 'state' => '', 'season' => '', 'score' => '' ), $ttl );
}
function sql( string $q ): void {
	global $wpdb;
	$wpdb->query( $q );
	wp_cache_flush();
}
function soon(): float {
	return microtime( true ) + 1.5;
}

echo "\nself-healing reads (statchasers_cache_get)\n";
$ck = sc_key( 'valid' );
store( $ck, 'CACHED' );
list( $calls, $html ) = fetch_calls( 'valid' );
is( array( $calls, $html ), array( 0, 'CACHED' ), 'valid entry with a future expiry: served, no fetch' );

$ck = sc_key( 'expired' );
store( $ck, 'OLD' );
sql( "UPDATE {$wpdb->options} SET option_value = " . ( time() - 10 ) . " WHERE option_name = '_transient_timeout_$ck'" );
list( $calls, $html ) = fetch_calls( 'expired' );
is( array( $calls, false !== strpos( (string) $html, 'fresh' ) ), array( 1, true ), 'expired entry: one fetch, fresh page' );
$r = rows( $ck );
is( array( $r['value'], $r['timeout'] > 250 && $r['timeout'] <= 300 ), array( true, true ), 'expired entry: stored again with its 5-minute lifetime' );

$ck = sc_key( 'orphan' );
store( $ck, 'STALE' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_timeout_$ck'" );
is( statchasers_cache_get( $ck ), false, 'entry missing its expiry: statchasers_cache_get() says miss' );
is( rows( $ck )['value'], true, 'and the read itself deletes nothing' );
list( $calls, $html ) = fetch_calls( 'orphan' );
is( array( $calls, false !== strpos( (string) $html, 'STALE' ) ), array( 1, false ), 'entry missing its expiry: one fetch, the stale HTML is never served' );
$r = rows( $ck );
is( array( $r['value'], $r['timeout'] > 250 && $r['timeout'] <= 300, $r['stale'] ), array( true, true, false ), 'and it is stored again with a valid 5-minute expiry (set_transient repairs the pair)' );
is( fetch_calls( 'orphan' )[0], 0, 'the next read is a normal hit' );

$ck = sc_key( 'novalue' );
store( $ck, 'X' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_$ck'" );
list( $calls ) = fetch_calls( 'novalue' );
is( array( $calls, healthy( $ck ) ), array( 1, true ), 'missing value with an expiry row: one fetch, stored again' );

$ck = sc_key( 'novalue-past' );
store( $ck, 'X' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_$ck'" );
sql( "UPDATE {$wpdb->options} SET option_value = " . ( time() - 10 ) . " WHERE option_name = '_transient_timeout_$ck'" );
$seq = array( fetch_calls( 'novalue-past' )[0], fetch_calls( 'novalue-past' )[0], fetch_calls( 'novalue-past' )[0] );
is( array_sum( $seq ) <= 2 && 0 === $seq[2], true, 'missing value with a PAST expiry row: settles within two fetches, no loop (fetches ' . implode( ',', $seq ) . ')' );

$ck = 'other_plugin_cache';
set_transient( $ck, 'theirs', 300 );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_timeout_$ck'" );
is( statchasers_cache_get( $ck ), 'theirs', 'a name outside the plugin is passed straight to get_transient()' );
delete_option( '_transient_' . $ck );

echo "\nconcurrent requests for the same page\n";
$ck = sc_key( 'hot' );
store( $ck, 'STALE' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_timeout_$ck'" );
$res = children( array_fill( 0, 12, array( 'fetch', soon(), 'hot' ) ) );
is( count( array_filter( $res, fn( $r ) => ! empty( $r['ok'] ) ) ), 12, '12 simultaneous requests on a page missing its expiry: all 12 served' );
is( count( array_filter( $res, fn( $r ) => ! empty( $r['stale'] ) ) ), 0, 'none of them served the stale HTML' );
is( max( array_map( fn( $r ) => (int) ( $r['http'] ?? 99 ), $res ) ) <= 1, true, 'each request fetched at most once, no regeneration loop (' . array_sum( array_map( fn( $r ) => (int) ( $r['http'] ?? 0 ), $res ) ) . ' fetches in all)' );
is( errs( $res ), array(), 'no database errors' );
fetch_calls( 'hot' );
is( healthy( $ck ), true, 'after the burst the page is cached with a valid expiry' );

foreach ( array( 1, 2, 3 ) as $n ) {
	store( sc_key( "storm-$n" ), 'seed' );
}
$storm_log = tempnam( sys_get_temp_dir(), 'scstorm' );
putenv( "SC_STORM_LOG=$storm_log" );
$res = children( array_fill( 0, 16, array( 'storm', soon(), '' ) ) );
$e   = errs( $res );
$committed = array();
foreach ( file( $storm_log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) as $line ) {
	list( $id, $at ) = explode( ' ', $line );
	$committed[ $id ] = (float) $at;
}
unlink( $storm_log );
$straddled = 0;
$late      = array();
$rewritten = 0;
foreach ( $res as $r ) {
	foreach ( (array) ( $r['seen'] ?? array() ) as $hit ) {
		list( $id, $t_read, $has ) = $hit;
		if ( isset( $committed[ $id ] ) && $t_read > $committed[ $id ] && ! $has ) {
			$late[] = sprintf( 'read %.4fs after the orphaning, with no expiry row', $t_read - $committed[ $id ] );
		} elseif ( isset( $committed[ $id ] ) && $t_read > $committed[ $id ] ) {
			// A concurrent set_transient() had already written a NEW expiry row
			// and not yet the new value (core writes them in two statements):
			// for a millisecond the entry is valid with its previous value.
			$rewritten++;
		} else {
			$straddled++;
		}
	}
}
is( count( array_filter( $res, fn( $r ) => ! empty( $r['ok'] ) ) ), 16, 'storm: 16 processes x 25 mixed reads, expiries and orphanings on 3 pages: every read served (' . count( $committed ) . ' orphanings)' );
is( $late, array(), 'storm: no read ever served an entry that had no expiry row' );
echo "  info  storm: reads that straddled an orphaning and saw the value valid an instant before: $straddled\n";
echo "  info  storm: reads inside core set_transient()'s two-statement write (new expiry, previous value, about a millisecond): $rewritten\n";
echo '  info  storm: database errors during the storm (WordPress core statements colliding): ' . count( $e ) . ( $e ? ' e.g. ' . substr( $e[0], 0, 90 ) : '' ) . "\n";
foreach ( array( 1, 2, 3 ) as $n ) {
	fetch_calls( "storm-$n" );
	fetch_calls( "storm-$n" );
}
is( count( array_filter( array( 1, 2, 3 ), fn( $n ) => healthy( sc_key( "storm-$n" ) ) ) ), 3, 'storm: afterwards normal reads leave all three pages healthy' );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE 'dead\\_%'" );
if ( getenv( 'SC_ONLY_STORM' ) ) {
	echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
	exit( $fails ? 1 : 0 );
}

echo "\nfailed cache writes and locked rows\n";
$ck = sc_key( 'nowrite' );
store( $ck, 'STALE' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_timeout_$ck'" );
sql( "CREATE TRIGGER sc_test_block BEFORE INSERT ON {$wpdb->options} FOR EACH ROW BEGIN IF NEW.option_name = '_transient_$ck' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'blocked by test'; END IF; END" );
$wpdb->suppress_errors( true );
list( $c1, $h1 ) = fetch_calls( 'nowrite' );
list( $c2, $h2 ) = fetch_calls( 'nowrite' );
$wpdb->suppress_errors( false );
is( array( $c1, $c2, false !== strpos( (string) $h1, 'fresh' ), false !== strpos( (string) $h2, 'fresh' ) ), array( 1, 1, true, true ), 'a cache write that fails: the page is still served fresh, one fetch per request, no loop' );
is( rows( $ck )['stale'], false, 'and the stale value is not left behind to be served' );
sql( 'DROP TRIGGER sc_test_block' );
is( array( fetch_calls( 'nowrite' )[0], fetch_calls( 'nowrite' )[0], healthy( $ck ) ), array( 1, 0, true ), 'once writes work again: one fetch, then hits, valid expiry' );

$ck = sc_key( 'locked' );
store( $ck, 'STALE' );
sql( "DELETE FROM {$wpdb->options} WHERE option_name = '_transient_timeout_$ck'" );
$at  = soon();
$res = children( array( array( 'lock', $at - 0.5, 'locked' ), array( 'fetch', $at, 'locked', 2 ), array( 'fetch', $at, 'locked', 2 ) ) );
$f   = array( $res[1], $res[2] );
is( count( array_filter( $f, fn( $r ) => ! empty( $r['ok'] ) && empty( $r['stale'] ) ) ), 2, 'rows locked by another transaction: both requests still served fresh, never the stale value' );
is( max( array_map( fn( $r ) => (float) ( $r['t'] ?? 99 ), $f ) ) < 8, true, 'and they finish, bounded by the lock wait timeout (' . implode( 's, ', array_map( fn( $r ) => $r['t'] ?? '?', $f ) ) . 's; db errors: ' . count( errs( $f ) ) . ')' );
fetch_calls( 'locked' );
fetch_calls( 'locked' );
is( healthy( $ck ), true, 'after the lock is released the page heals on the next reads' );

echo "\nthe upgrade sweep (through the real init hook)\n";
function seed_sweep( int $n ): void {
	global $wpdb;
	$html = str_repeat( 'x', 5000 );
	$rows = array();
	foreach ( array( 'sc_team_ssr_', 'sc_player_ssr_', 'sc_matchup_ssr_' ) as $prefix ) {
		for ( $i = 0; $i < $n; $i++ ) {
			$k      = $prefix . md5( "seed$prefix$i" );
			$rows[] = $wpdb->prepare( '(%s, %s, %s)', '_transient_' . $k, serialize( array( 'html' => $html ) ), 'off' );
			$rows[] = $wpdb->prepare( '(%s, %s, %s)', '_transient_timeout_' . $k, (string) ( time() + 300 ), 'off' );
			if ( 0 === $i % 20 ) {
				$rows[] = $wpdb->prepare( '(%s, %s, %s)', '_transient_' . $prefix . 'bak_' . md5( "seed$i" ), serialize( array( 'html' => 'backup' ) ), 'off' );
				$rows[] = $wpdb->prepare( '(%s, %s, %s)', '_transient_timeout_' . $prefix . 'bak_' . md5( "seed$i" ), (string) ( time() + 86400 ), 'off' );
			}
		}
	}
	foreach ( array( '_transient_other_plugin_x', '_transient_scx_ssr_lookalike', '_transient_timeout_other_plugin_x' ) as $name ) {
		$rows[] = $wpdb->prepare( '(%s, %s, %s)', $name, 'keep', 'off' );
	}
	foreach ( array_chunk( $rows, 500 ) as $chunk ) {
		$wpdb->query( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES " . implode( ',', $chunk ) );
	}
	update_option( STATCHASERS_NEWS_OPTION_INSTALLED, '1.10.59', false );
	delete_option( STATCHASERS_NEWS_OPTION_UPGRADE );
	wp_cache_flush();
}
function count_like( string $like ): int {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) );
}
function claim_row(): ?array {
	global $wpdb;
	$raw = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", STATCHASERS_NEWS_OPTION_UPGRADE ) );
	return null === $raw ? null : json_decode( $raw, true );
}
function set_claim( array $c ): void {
	global $wpdb;
	$wpdb->query( $wpdb->prepare( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off') ON DUPLICATE KEY UPDATE option_value = VALUES(option_value)", STATCHASERS_NEWS_OPTION_UPGRADE, wp_json_encode( $c ) ) );
	wp_cache_flush();
}
function expire_lease(): void {
	$c = claim_row();
	if ( $c ) {
		$c['until'] = time() - 1;
		set_claim( $c );
	}
}
function installed(): string {
	wp_cache_flush();
	return (string) get_option( STATCHASERS_NEWS_OPTION_INSTALLED, '' );
}
function visit(): array {
	return children( array( array( 'visit', microtime( true ), '' ) ) )[0];
}

// Baseline: the same 12 requests at once with nothing to sweep, so the
// comparison is load for load (they share this machine's CPUs).
$base = children( array_fill( 0, 12, array( 'visit', soon(), '' ) ) );
$base = max( array_map( fn( $r ) => (float) ( $r['t'] ?? 0 ), $base ) );

seed_sweep( 1000 );
$before = count_like( '\\_transient\\_sc\\_%' );
$waits  = static fn() => (int) $wpdb->get_row( "SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_waits'", ARRAY_N )[1];
$w0     = $waits();
$res    = children( array_fill( 0, 12, array( 'visit', soon(), '' ) ) );
$w1     = $waits();
$won    = array_values( array_filter( $res, fn( $r ) => ! empty( $r['claimed'] ) ) );
$others = array_values( array_filter( $res, fn( $r ) => empty( $r['claimed'] ) ) );
is( count( $won ), 1, '12 simultaneous requests after an upgrade: exactly one claims the sweep' );
$slowest = $others ? max( array_map( fn( $r ) => (float) ( $r['t'] ?? 99 ), $others ) ) : 99;
is( $w1 - $w0, 0, 'the other 11 never wait on a database lock (InnoDB row lock waits during the burst: ' . ( $w1 - $w0 ) . ')' );
echo "  info  wall time of the other 11, slowest {$slowest}s; the same 12 requests with nothing to sweep, slowest {$base}s (12 PHP processes share this machine)\n";
is( (float) ( $won[0]['t'] ?? 99 ) < $base + 1.0, true, 'the claimant\'s extra work stays within its 0.75 s budget (' . ( $won[0]['t'] ?? '?' ) . 's in all)' );
is( errs( $res ), array(), 'no database errors' );

store( sc_key( 'written-after-upgrade' ), 'NEW' );
$claims = 1;
$paced  = true;
while ( STATCHASERS_NEWS_VERSION !== installed() && $claims < 300 ) {
	$paced = $paced && empty( visit()['claimed'] );
	expire_lease();
	$r = visit();
	$claims++;
	if ( errs( array( $r ) ) ) {
		is( errs( array( $r ) ), array(), 'sweep runs without database errors' );
		break;
	}
}
echo "  info  the sweep of $before sc_ rows finished in $claims claims of <= 0.75 s\n";
is( $paced, true, 'between runs the sweep paces itself: a request inside the pause does not claim' );
is( installed(), STATCHASERS_NEWS_VERSION, 'the version is recorded as swept' );
is( claim_row(), null, 'and the claim row is gone' );
is( count_like( '\\_transient\\_sc\\_team\\_ssr\\_%' ) - count_like( '\\_transient\\_sc\\_team\\_ssr\\_bak\\_%' ) + count_like( '\\_transient\\_sc\\_player\\_ssr\\_%' ) - count_like( '\\_transient\\_sc\\_player\\_ssr\\_bak\\_%' ), 0, 'every fresh cached page from before the upgrade is gone' );
is( count_like( '\\_transient\\_sc\\_%ssr\\_bak\\_%' ) > 0, true, 'the outage backups are kept, as before' );
is( healthy( sc_key( 'written-after-upgrade' ) ), true, 'a page cached after the upgrade was claimed is untouched' );
is( array( count_like( '\\_transient\\_other\\_plugin\\_x' ), count_like( '\\_transient\\_scx\\_ssr\\_lookalike' ), count_like( '\\_transient\\_timeout\\_other\\_plugin\\_x' ) ), array( 1, 1, 1 ), 'other plugins\' rows and look-alike names are untouched' );
is( orphans(), 0, 'no cached page was left without its expiry' );
is( visit()['claimed'] ?? null, false, 'once swept, no request claims again' );

echo "\nan interrupted sweep\n";
seed_sweep( 4000 );
$seeded = count_like( '\\_transient\\_sc\\_%' );
children(
	array( array( 'longsweep', microtime( true ), '' ) ),
	static function ( $procs, $pipes ) {
		// Kill it 0.2 s after it reports the sweep has started.
		$buf = '';
		$end = microtime( true ) + 30;
		while ( false === strpos( $buf, 'STARTED' ) && microtime( true ) < $end ) {
			$buf .= (string) fread( $pipes[0][1], 64 );
		}
		usleep( 200000 );
		proc_terminate( $procs[0], 9 );
	}
);
$left = count_like( '\\_transient\\_sc\\_%' );
echo "  info  killed after sweeping " . ( $seeded - $left ) . " of $seeded rows\n";
is( $left < $seeded && $left > 0, true, 'the kill landed mid-sweep' );
$c = claim_row();
is( is_array( $c ) && $c['until'] > time(), true, 'a sweep killed mid-run leaves its claim, with a bounded lease' );
is( orphans(), 0, 'killing it mid-batch leaves no page without its expiry (each batch is one statement)' );
is( visit()['claimed'] ?? null, false, 'while the lease runs, nobody else claims, and nobody waits' );
expire_lease();
is( visit()['claimed'] ?? null, true, 'when the lease runs out, the next request takes over' );
expire_lease();
is( statchasers_news_run_upgrade_now(), true, 'and the sweep completes (the WP-CLI path, statchasers_news_run_upgrade_now)' );
is( array( installed(), orphans() ), array( STATCHASERS_NEWS_VERSION, 0 ), 'version recorded, nothing left without an expiry' );

echo "\nbounded: never forever\n";
update_option( STATCHASERS_NEWS_OPTION_INSTALLED, '1.10.59', false );
set_claim( array( 'v' => STATCHASERS_NEWS_VERSION, 'until' => time() - 1, 'runs' => STATCHASERS_UPGRADE_MAX_RUNS, 'since' => time() - 60, 'mark' => 1 ) );
$r = visit();
is( array( $r['claimed'] ?? null, installed(), claim_row() ), array( false, STATCHASERS_NEWS_VERSION, null ), 'after the maximum number of claims the sweep stops and the version is recorded' );

update_option( STATCHASERS_NEWS_OPTION_INSTALLED, '1.10.59', false );
set_claim( array( 'v' => STATCHASERS_NEWS_VERSION, 'until' => time() - 1, 'runs' => 3, 'since' => time() - STATCHASERS_UPGRADE_MAX_AGE - 1, 'mark' => 1 ) );
$r = visit();
is( array( $r['claimed'] ?? null, installed() ), array( false, STATCHASERS_NEWS_VERSION ), 'after the maximum age the sweep stops and the version is recorded' );

update_option( STATCHASERS_NEWS_OPTION_INSTALLED, '1.10.58', false );
set_claim( array( 'v' => '1.10.59', 'until' => time() + 999, 'runs' => 5, 'since' => time(), 'mark' => 1 ) );
is( visit()['claimed'] ?? null, true, 'a claim left by an older version does not block the new one' );
expire_lease();
statchasers_news_run_upgrade_now();

echo "\nfresh activation\n";
delete_option( STATCHASERS_NEWS_OPTION_INSTALLED );
delete_option( STATCHASERS_NEWS_OPTION_UPGRADE );
wp_cache_flush();
$r = visit();
is( array( $r['claimed'] ?? null, $r['done'] ?? null, installed() ), array( true, true, STATCHASERS_NEWS_VERSION ), 'a first install claims, sweeps and records the version in one request' );

echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit( $fails ? 1 : 0 );
