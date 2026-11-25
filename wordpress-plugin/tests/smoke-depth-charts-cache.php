<?php
/**
 * WEB-003: the depth-chart publication paths
 * (statchasers-depth-charts-cache.php), against the stub harness.
 *
 * The harness answers every wp_remote_get with one body and one header set,
 * so the version document doubles as each club's "fragment" here: what is
 * tested is the order, the scope and the refusals, not the markup. The full
 * path through a real WordPress, WP Rocket and edge model is
 * artifacts/api-server/scripts/depth-charts/web003/replay.mjs. That
 * SCDC_Refresh::store() fires `scdc_published` only for a publication is
 * checked in tests/depth-charts/checks.php, where the depth-charts classes
 * load. smoke.php runs this as STATCHASERS_SMOKE_GROUP=dccache.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_depth_charts_publish_check' ) ) {
	fwrite( STDERR, "smoke-depth-charts-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$GLOBALS['sc_test_rocket'] = array();
if ( ! function_exists( 'rocket_clean_files' ) ) {
	function rocket_clean_files( $urls ) { $GLOBALS['sc_test_rocket'][] = $urls; }
}
$GLOBALS['sc_test_edge'] = array();
add_filter(
	'statchasers_depth_charts_pre_purge_edge',
	static function ( $result, $paths = array() ) {
		$GLOBALS['sc_test_edge'][] = $paths;
		return 'test edge';
	}
);
$reset = static function (): void {
	$GLOBALS['sc_test_rocket'] = array();
	$GLOBALS['sc_test_edge']   = array();
	$GLOBALS['scheduled']      = array();
	$GLOBALS['remote_urls']    = array();
};

echo "\nDepth charts publication (WEB-003)\n";

// ------------------------------------------------------------ hooks wired
is( in_array( 'statchasers_depth_charts_on_published', $GLOBALS['hooks']['scdc_published'] ?? array(), true ), true, 'hub: scdc_published is hooked' );
is( in_array( 'statchasers_depth_charts_cache_headers', $GLOBALS['hooks']['template_redirect'] ?? array(), true ), true, 'edge ttl: sent from template_redirect' );
is( STATCHASERS_EDGE_TTL, 21600, 'edge ttl: six hours' );
is( STATCHASERS_PLAYER_STATS_EDGE_TTL, STATCHASERS_EDGE_TTL, 'edge ttl: the stats pages ask for the same six hours' );
$schedules = apply_filters( 'cron_schedules', array() );
is( $schedules['statchasers_five_minutes']['interval'] ?? 0, 300, 'cron: the shared five-minute schedule is registered once' );

// ------------------------------------------------------------ the league page
$reset();
$r = statchasers_depth_charts_on_published( array( 'status' => 'partial', 'last_refreshed_ts' => 1795551600 ), array( 'teams' => array() ) );
$r = get_option( STATCHASERS_DEPTH_HUB_OPTION );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com/nfl/nfl-depth-charts/' ) ), 'hub: WP Rocket cleared for the league page only' );
is( $GLOBALS['sc_test_edge'], array( array( '/nfl/nfl-depth-charts/' ) ), 'hub: one edge purge, the league path only (not /nfl/, not the JSON)' );
is( $r['version'], 1795551600, 'hub: the publication id (last_refreshed_ts, the ?v=) is on record' );
is( $r['status'], 'partial', 'hub: a partial refresh is a publication too' );
is( $r['edge'], 'test edge', 'hub: the edge result is on record' );
is( in_array( STATCHASERS_DEPTH_HUB_WARM_HOOK, array_column( $GLOBALS['scheduled'], 0 ), true ), true, 'hub: the warm-up is scheduled' );
is( count( $GLOBALS['remote_urls'] ), 0, 'hub: no API call (the data is local)' );

// ------------------------------------------------------------ the team tabs
$slugs = array_keys( statchasers_team_table() );
$doc   = static function ( string $fingerprint, array $hashes, string $version ) use ( $slugs ): array {
	$teams = array();
	foreach ( $slugs as $slug ) {
		$teams[ $slug ] = array( 'abbr' => 'X', 'hash' => $hashes[ $slug ] ?? 'h0', 'version' => $version, 'updatedAt' => null );
	}
	return array( 'version' => $fingerprint, 'fetchedAt' => '2026-11-24T12:59:15+00:00', 'season' => 2026, 'teams' => $teams );
};

// The API is down: nothing is touched.
$reset();
$GLOBALS['http_code'] = 503;
$GLOBALS['http_body'] = '';
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'version unavailable; nothing changed', 'team: API down, reported' );
is( isset( $r['version'] ), false, 'team: API down, no version recorded' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'team: API down, no page cache cleared, no edge purge' );

// A document that does not name every club is not a publication.
$partial = $doc( 'fpA', array(), 'A~h0' );
unset( $partial['teams']['buffalo-bills'] );
$GLOBALS['http_code'] = 200;
$GLOBALS['http_body'] = json_encode( $partial );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'version unavailable; nothing changed', 'team: a version naming 31 clubs is refused' );

// First check after install: every club, but only with the announced fragments.
$reset();
$GLOBALS['http_body']    = json_encode( $doc( 'fpA', array(), 'A~h0' ) );
$GLOBALS['http_headers'] = array( 'x-sc-depth-version' => 'B~h0', 'etag' => 'W/"e"' );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'buffalo-bills moved during the check; retrying next run', 'team: a fragment from another snapshot is refused' );
is( isset( $r['version'] ), false, 'team: refused, version not recorded, so the next run tries again' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'team: refused, no purge' );

$reset();
$GLOBALS['http_headers'] = array( 'x-sc-depth-version' => 'A~h0', 'etag' => 'W/"e"' );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'published', 'team: first check publishes' );
is( count( $r['changed'] ), 32, 'team: first check publishes every club once' );
is( $r['paths'], 32, 'team: 32 edge paths' );
is( count( $GLOBALS['sc_test_edge'] ), 1, 'team: one purge call from here (statchasers_edge_purge_paths chunks by 30 for Rocket.net)' );
is( in_array( '/nfl/teams/buffalo-bills/depth-chart/', $GLOBALS['sc_test_edge'][0], true ), true, 'team: canonical depth-chart path purged' );
is( count( array_filter( $GLOBALS['sc_test_edge'][0], static fn( $p ) => 1 !== preg_match( '#^/nfl/teams/[a-z0-9-]+/depth-chart/$#', $p ) ) ), 0, 'team: nothing but depth-chart tabs purged' );
is( in_array( 'https://example.com/nfl/teams/buffalo-bills/depth-chart/', $GLOBALS['sc_test_rocket'][0], true ), true, 'team: WP Rocket cleared for the tab' );
is( count( $GLOBALS['remote_urls'] ), 33, 'team: one version read + 32 fragment fetches' );
is( false !== strpos( (string) $GLOBALS['remote_urls'][1], '/embed/team/buffalo-bills?section=depth-chart' ), true, 'team: the fragment is the depth-chart section' );
is( in_array( STATCHASERS_DEPTH_TEAM_WARM_HOOK, array_column( $GLOBALS['scheduled'], 0 ), true ), true, 'team: the warm-up is scheduled' );

// Nothing new: nothing purged.
$reset();
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'unchanged', 'team: same version, unchanged' );
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['sc_test_rocket'] ), 0, 'team: same version, no purge' );
is( count( $GLOBALS['remote_urls'] ), 1, 'team: same version, the version read only' );

// A new snapshot that changes one club: only that club.
$reset();
$GLOBALS['http_body']    = json_encode( $doc( 'fpB', array( 'buffalo-bills' => 'h1' ), 'B~h1' ) );
$GLOBALS['http_headers'] = array( 'x-sc-depth-version' => 'B~h1', 'etag' => 'W/"e2"' );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'published', 'team: one club moved, published' );
is( $r['changed'], array( 'buffalo-bills' ), 'team: only that club' );
is( $GLOBALS['sc_test_edge'], array( array( '/nfl/teams/buffalo-bills/depth-chart/' ) ), 'team: only its path purged at the edge' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com/nfl/teams/buffalo-bills/depth-chart/' ) ), 'team: only its WP Rocket files cleared' );
is( $r['previous'], 'fpA', 'team: the previous publication is on record' );
is( $r['teams']['buffalo-bills'], 'h1', 'team: the new hash is on record' );

// A new stamp over the same charts: recorded, nothing purged.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpC', array( 'buffalo-bills' => 'h1' ), 'C~h1' ) );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'no club changed', 'team: a new stamp, same charts' );
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['sc_test_rocket'] ), 0, 'team: new stamp, no purge' );
is( $r['version'], 'fpC', 'team: the new fingerprint is recorded' );

// A later failure leaves the published record alone.
$GLOBALS['http_code'] = 500;
$r = statchasers_depth_charts_publish_check();
is( $r['version'], 'fpC', 'team: failure after a publish keeps the last snapshot on record' );

// Forced: every club again (the by-hand path).
$reset();
$GLOBALS['http_code']    = 200;
$GLOBALS['http_headers'] = array( 'x-sc-depth-version' => 'C~h1', 'etag' => 'W/"e3"' );
$GLOBALS['http_body']    = json_encode( $doc( 'fpC', array( 'buffalo-bills' => 'h1' ), 'C~h1' ) );
$r = statchasers_depth_charts_publish_check( true );
is( $r['result'], 'republished (forced)', 'team: forced, republished' );
is( count( $r['changed'] ), 32, 'team: forced, every club' );

// The warm-up requests the clubs the last publication changed, desktop and phone.
$reset();
$GLOBALS['http_body'] = '';
$w = statchasers_depth_charts_team_warm();
is( count( $w ), 64, 'team warm: 32 clubs x desktop + phone' );
is( isset( $w['https://example.com/nfl/teams/buffalo-bills/depth-chart/ phone'] ), true, 'team warm: the phone pass' );
is( false !== strpos( (string) ( $GLOBALS['remote_args'][ count( $GLOBALS['remote_args'] ) - 1 ]['user-agent'] ?? '' ), 'iPhone' ), true, 'team warm: an iPhone user agent' );
$w = statchasers_depth_charts_hub_warm();
is( array_keys( $w ), array( 'https://example.com/nfl/nfl-depth-charts/ desktop', 'https://example.com/nfl/nfl-depth-charts/ phone' ), 'hub warm: the league page, desktop and phone' );

// ------------------------------------------------------------ which pages get the 6 h policy
$post            = new WP_Post();
$post->post_name = 'buffalo-bills';
$GLOBALS['page'] = array( 'post' => $post );
$GLOBALS['query'] = array( 'sc_section' => 'depth-chart' );
is( statchasers_depth_charts_cache_surface(), 'team', 'surface: /nfl/teams/buffalo-bills/depth-chart/ is a team tab' );
$GLOBALS['query'] = array( 'sc_section' => 'schedule' );
is( statchasers_depth_charts_cache_surface(), '', 'surface: the Schedule tab is not' );
$GLOBALS['query'] = array();
is( statchasers_depth_charts_cache_surface(), '', 'surface: the team hub is not' );
$post->post_name  = 'not-a-team';
$GLOBALS['query'] = array( 'sc_section' => 'depth-chart' );
is( statchasers_depth_charts_cache_surface(), '', 'surface: a page that is not a team is not' );
