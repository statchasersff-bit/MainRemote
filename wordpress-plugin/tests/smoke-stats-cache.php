<?php
/**
 * WEB-003: the NFL Player Stats publication check
 * (statchasers-player-stats-cache.php), against the stub harness.
 *
 * The harness answers every wp_remote_get with one body and one header set,
 * so the version document doubles as each "fragment" here: what is tested is
 * the order and the refusals, not the markup. The full path through a real
 * WordPress, WP Rocket and edge model is scripts/player-stats/web003/replay.mjs.
 * smoke.php runs this as STATCHASERS_SMOKE_GROUP=statscache.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_player_stats_publish_check' ) ) {
	fwrite( STDERR, "smoke-stats-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$GLOBALS['sc_test_rocket'] = array();
if ( ! function_exists( 'rocket_clean_files' ) ) {
	function rocket_clean_files( $urls ) { $GLOBALS['sc_test_rocket'][] = $urls; }
}
$GLOBALS['sc_test_edge'] = array();
add_filter(
	'statchasers_player_stats_pre_purge_edge',
	static function ( $result, $paths = array() ) {
		$GLOBALS['sc_test_edge'][] = $paths;
		return 'test edge';
	}
);

echo "\nNFL Player Stats publication (WEB-003)\n";

$paths = statchasers_player_stats_purge_paths( array( '2025', '2026', 'all', 'bogus' ) );
is( in_array( '/nfl/nfl-player-stats/', $paths, true ) && in_array( '/nfl/nfl-player-stats/rb/', $paths, true ) && in_array( '/nfl/nfl-player-stats/wr/', $paths, true ) && in_array( '/nfl/nfl-player-stats/te/', $paths, true ), true, 'purge: the four canonical paths' );
is( in_array( '/nfl/nfl-player-stats/qb/', $paths, true ), true, 'purge: the /qb/ redirect entry' );
is( in_array( '/nfl/nfl-player-stats/wr/?season=2025', $paths, true ) && in_array( '/nfl/nfl-player-stats/?season=all', $paths, true ), true, 'purge: the old ?season= variants' );
is( count( array_filter( $paths, static fn( $p ) => false !== strpos( $p, 'bogus' ) ) ), 0, 'purge: nothing that is not a season' );
is( count( array_filter( $paths, static fn( $p ) => 0 !== strpos( $p, '/nfl/nfl-player-stats/' ) ) ), 0, 'purge: nothing outside the stats pages' );
is( count( $paths ), 5 * 4, 'purge: 5 addresses x (1 + 3 seasons)' );

$etag = 'W/"WR_2026-x-y-z"';
$doc  = array(
	'version'   => 'v1',
	'season'    => 2026,
	'seasons'   => array( '2025', '2026', 'all' ),
	'positions' => array(),
);
foreach ( array( 'qb', 'rb', 'wr', 'te' ) as $p ) {
	$doc['positions'][ $p ] = array( 'etag' => $etag, 'weeks' => '1-11', 'updatedAt' => '2026-11-24T12:57:07Z' );
}

// The API is down: nothing is touched.
$GLOBALS['http_code'] = 503;
$GLOBALS['http_body'] = '';
$r = statchasers_player_stats_publish_check();
is( $r['result'], 'version unavailable; nothing changed', 'API down: reported' );
is( isset( $r['version'] ), false, 'API down: no version recorded' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'API down: no page cache cleared, no edge purge' );

// A fragment that is not the announced snapshot: wait for the next run.
$GLOBALS['http_code']    = 200;
$GLOBALS['http_body']    = json_encode( $doc );
$GLOBALS['http_headers'] = array( 'etag' => 'W/"something-else"' );
$r = statchasers_player_stats_publish_check();
is( $r['result'], 'qb moved during the check; retrying next run', 'etag mismatch: refused' );
is( isset( $r['version'] ), false, 'etag mismatch: version not recorded, so the next run tries again' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'etag mismatch: no purge' );

// The announced snapshot: published, in order.
$GLOBALS['http_headers'] = array( 'etag' => $etag );
$GLOBALS['scheduled']    = array();
$r = statchasers_player_stats_publish_check();
is( $r['result'], 'published', 'new version: published' );
is( $r['version'], 'v1', 'new version: recorded' );
is( $r['positions']['wr']['weeks'], '1-11', 'new version: the weeks it announced are on record' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com/nfl/nfl-player-stats/', 'https://example.com/nfl/nfl-player-stats/rb/', 'https://example.com/nfl/nfl-player-stats/wr/', 'https://example.com/nfl/nfl-player-stats/te/' ) ), 'new version: WP Rocket cleared for the four pages' );
is( count( $GLOBALS['sc_test_edge'] ), 1, 'new version: one edge purge' );
is( $r['edge'], 'test edge', 'new version: the edge result is on record' );
is( in_array( STATCHASERS_PLAYER_STATS_WARM_HOOK, array_column( $GLOBALS['scheduled'], 0 ), true ), true, 'new version: the warm-up is scheduled' );

// Nothing new: nothing purged.
$r = statchasers_player_stats_publish_check();
is( $r['result'], 'unchanged', 'same version: unchanged' );
is( count( $GLOBALS['sc_test_edge'] ), 1, 'same version: no second purge' );

// Forced: purged again (the by-hand path).
$r = statchasers_player_stats_publish_check( true );
is( $r['result'], 'republished (forced)', 'forced: republished' );
is( count( $GLOBALS['sc_test_edge'] ), 2, 'forced: purged again' );

// A later failure leaves the published record alone.
$GLOBALS['http_code'] = 500;
$r = statchasers_player_stats_publish_check();
is( $r['version'], 'v1', 'failure after a publish: the last snapshot stays on record' );

// The fetch claim needs a database; the stub has none, so it never blocks.
is( statchasers_player_stats_claim_fetch( 'k' ), true, 'claim: no $wpdb, the request fetches itself' );

// ------------------------------------------------------------ a purge that fails (retry)
echo "\nEdge purge retry (stats)\n";

$GLOBALS['sc_test_edge_answer'] = null;
add_filter(
	'statchasers_player_stats_pre_purge_edge',
	static function ( $result, $paths = array() ) {
		$answer = $GLOBALS['sc_test_edge_answer'] ?? null;
		if ( 'fail' === $answer ) {
			return array( 'failed' => $paths, 'text' => 'rocket.net refused' );
		}
		if ( 'ok' === $answer ) {
			return array( 'failed' => array(), 'text' => 'rocket.net ok' );
		}
		if ( 'fail-wr' === $answer ) {
			return array( 'failed' => array_values( array_filter( $paths, static fn( $p ) => 0 === strpos( $p, '/nfl/nfl-player-stats/wr/' ) ) ), 'text' => 'rocket.net ok,refused' );
		}
		return $result;
	}
);
$age = static function ( int $secs ): void {
	$r = get_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION );
	foreach ( array( 'next_at', 'first_at', 'last_at' ) as $k ) {
		if ( ! empty( $r['edge_retry'][ $k ] ) ) {
			$r['edge_retry'][ $k ] -= $secs;
		}
	}
	update_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, $r );
};
$reset = static function (): void {
	$GLOBALS['sc_test_rocket'] = array();
	$GLOBALS['sc_test_edge']   = array();
	$GLOBALS['scheduled']      = array();
	$GLOBALS['remote_urls']    = array();
};
$publish = static function ( string $version ) use ( $doc, $etag ): array {
	$doc['version']          = $version;
	$GLOBALS['http_code']    = 200;
	$GLOBALS['http_body']    = json_encode( $doc );
	$GLOBALS['http_headers'] = array( 'etag' => $etag );
	return statchasers_player_stats_publish_check();
};
$hook_events = static fn( string $hook ): array => array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => $hook === $e[0] ) );
$wr_paths    = array( '/nfl/nfl-player-stats/wr/', '/nfl/nfl-player-stats/wr/?season=2025', '/nfl/nfl-player-stats/wr/?season=2026', '/nfl/nfl-player-stats/wr/?season=all' );

// A 1.10.71 record (no ledger) whose purge did not land: retried on the first run.
$reset();
update_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, array( 'version' => 'v1', 'wp_rocket' => true, 'edge' => 'rocket.net sent', 'paths' => 20, 'published_at' => time() - 900 ) );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$doc['version']                 = 'v1';
$GLOBALS['http_code']           = 200;
$GLOBALS['http_body']           = json_encode( $doc );
$r = statchasers_player_stats_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'][0] ?? array() ), $r['edge_state'], $r['edge_attempts'] ), array( 'unchanged', 20, 'ok', 2 ), 'upgrade: a 1.10.71 record whose purge failed, its 20 paths purged once on the first run' );
is( count( $hook_events( STATCHASERS_EDGE_RETRY_WARM_HOOK ) ), 1, 'upgrade: the four pages warmed (one event)' );
$reset();
$r = statchasers_player_stats_publish_check();
is( array( count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['scheduled'] ) ), array( 0, 0 ), 'upgrade: then quiet' );

// Case 1: part of the purge fails once, then succeeds.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail-wr';
$r = $publish( 'v2' );
is( array( $r['result'], $r['edge'], $r['edge_state'], $r['edge_pending'] ), array( 'published', 'rocket.net ok,refused', 'pending', 4 ), 'fail once: published, the WR paths pending' );
is( $r['edge_retry']['pending'], $wr_paths, 'fail once: exactly the failed paths' );
is( in_array( 'https://example.com/nfl/nfl-player-stats/wr/', $r['to_warm'], true ), false, 'fail once: the WR page is not warmed yet' );
is( count( $r['to_warm'] ), 3, 'fail once: the three pages whose purge landed are' );
is( count( $hook_events( STATCHASERS_PLAYER_STATS_WARM_HOOK ) ), 1, 'fail once: their warm-up is scheduled' );
$GLOBALS['http_body'] = '';
is( count( statchasers_player_stats_warm() ), 6, 'fail once: the warm-up requests the three, desktop + phone' );
$GLOBALS['http_body'] = json_encode( $doc + array() );

$reset();
$doc['version']       = 'v2';
$GLOBALS['http_body'] = json_encode( $doc );
$r = statchasers_player_stats_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ) ), array( 'unchanged', 0 ), 'fail once: not due yet' );
$reset();
$age( 300 );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = statchasers_player_stats_publish_check();
is( $GLOBALS['sc_test_edge'], array( $wr_paths ), 'fail once: retried once, exactly the WR paths' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_failed'], $r['retry'] ), array( 'ok', 0, 0, 'attempt 2 of 6: rocket.net ok' ), 'fail once: landed, recorded' );
is( array( count( $GLOBALS['remote_urls'] ), count( $GLOBALS['sc_test_rocket'] ) ), array( 1, 0 ), 'fail once: no fragment fetch, no WP Rocket clean' );
$rw = $hook_events( STATCHASERS_EDGE_RETRY_WARM_HOOK );
is( $rw[0][3] ?? null, array( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, 'StatChasers-StatsWarm/1', array( 'https://example.com/nfl/nfl-player-stats/wr/' ) ), 'fail once: then the WR page is warmed' );
$reset();
$age( 3600 );
$r = statchasers_player_stats_publish_check();
is( array( count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['scheduled'] ) ), array( 0, 0 ), 'fail once: then quiet' );

// Case 2: the purge keeps failing: bounded, recorded, never warmed.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$r = $publish( 'v3' );
is( count( $hook_events( STATCHASERS_PLAYER_STATS_WARM_HOOK ) ), 0, 'keeps failing: nothing warmed at the publication' );
for ( $i = 0; $i < 7; $i++ ) {
	$age( 6 * 3600 );
	$r = statchasers_player_stats_publish_check();
}
is( count( $GLOBALS['sc_test_edge'] ), 6, 'keeps failing: six attempts, then no more' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_failed'], $r['edge_attempts'] ), array( 'failed', 0, 20, 6 ), 'keeps failing: 20 paths given up on, recorded' );
is( count( $GLOBALS['scheduled'] ), 0, 'keeps failing: never warmed' );
is( $r['version'], 'v3', 'keeps failing: the publication stays on record' );

// Case 3: a new publication while a retry is pending: the union, once.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail-wr';
$publish( 'v4' );
$reset();
$GLOBALS['sc_test_edge_answer'] = 'ok';
$GLOBALS['sc_test_purge_extra'] = true;
add_filter(
	'statchasers_player_stats_purge_paths',
	static function ( $paths ) {
		return empty( $GLOBALS['sc_test_purge_extra'] ) ? $paths : array_values( array_diff( $paths, array( '/nfl/nfl-player-stats/wr/?season=all' ) ) );
	}
);
$r = $publish( 'v5' );
is( count( $GLOBALS['sc_test_edge'] ), 1, 'union: one purge' );
is( array( count( $GLOBALS['sc_test_edge'][0] ), count( array_unique( $GLOBALS['sc_test_edge'][0] ) ), in_array( '/nfl/nfl-player-stats/wr/?season=all', $GLOBALS['sc_test_edge'][0], true ) ), array( 20, 20, true ), 'union: the new paths and the pending one no longer listed, each once' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_attempts'], count( $r['to_warm'] ) ), array( 'ok', 0, 1, 4 ), 'union: landed, all four warmed' );
$GLOBALS['sc_test_purge_extra'] = false;

// Case 4: skipped (the default answer here, a string): no retry loop.
$reset();
$GLOBALS['sc_test_edge_answer'] = null;
$r = $publish( 'v6' );
is( array( $r['edge'], $r['edge_state'], $r['edge_pending'], count( $r['to_warm'] ) ), array( 'test edge', 'skipped', 0, 4 ), 'skipped: not pending, warmed' );
$reset();
$age( 6 * 3600 );
statchasers_player_stats_publish_check();
is( count( $GLOBALS['sc_test_edge'] ), 0, 'skipped: the next run purges nothing' );

// A 1.10.71 record (no to_warm) warms all four.
update_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, array( 'version' => 'old' ) );
$GLOBALS['http_body'] = '';
is( count( statchasers_player_stats_warm() ), 8, 'upgrade: a 1.10.71 record warms the four pages' );
