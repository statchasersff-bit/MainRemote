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
