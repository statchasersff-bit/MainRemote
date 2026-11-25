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

// The first poll's warm-up is staggered: 8 events of 4 clubs (8 requests), a
// minute apart from a minute on; the purges above all came first.
$warm_events = array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_DEPTH_TEAM_WARM_HOOK === $e[0] ) );
is( count( $warm_events ), 8, 'team warm: first poll, 32 clubs in 8 events' );
is( array_map( static fn( $e ) => $e[3][1] ?? null, $warm_events ), array( 0, 4, 8, 12, 16, 20, 24, 28 ), 'team warm: offsets of 4 clubs each' );
is( array_map( static fn( $e ) => $e[3][0] ?? null, $warm_events ), array_fill( 0, 8, 'fpA' ), 'team warm: each event names the publication' );
$gaps = array();
foreach ( $warm_events as $i => $e ) {
	$gaps[] = $i ? $e[1] - $warm_events[ $i - 1 ][1] : 0;
}
is( array_slice( $gaps, 1 ), array_fill( 0, 7, 60 ), 'team warm: one event a minute' );
is( $warm_events[0][1] - time() >= 59 && $warm_events[0][1] - time() <= 61, true, 'team warm: the first a minute after the purge' );

// One batch, run as WP-cron runs it: that batch's clubs only, desktop + phone.
$GLOBALS['http_body'] = '';
$GLOBALS['remote_urls'] = array();
$w = statchasers_depth_charts_team_warm( 'fpA', 4 );
is( count( $w ), 8, 'team warm: one batch = 4 clubs x desktop + phone' );
is( count( $GLOBALS['remote_urls'] ), 8, 'team warm: one batch, 8 requests' );
is( count( statchasers_depth_charts_team_warm( 'not-the-publication', 0 ) ), 0, 'team warm: an event for a superseded publication does nothing' );
$GLOBALS['http_body'] = json_encode( $doc( 'fpA', array(), 'A~h0' ) );

// Nothing new (the second poll against the same snapshot): nothing purged, nothing warmed.
$reset();
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'unchanged', 'team: same version, unchanged' );
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['sc_test_rocket'] ), 0, 'team: same version, no purge' );
is( count( $GLOBALS['remote_urls'] ), 1, 'team: same version, the version read only' );
is( count( $GLOBALS['scheduled'] ), 0, 'team: same version, zero warm-ups scheduled' );

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
is( count( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_DEPTH_TEAM_WARM_HOOK === $e[0] ) ), 1, 'team: one club moved, one warm-up event' );

// A new stamp over the same charts: recorded, nothing purged.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpC', array( 'buffalo-bills' => 'h1' ), 'C~h1' ) );
$r = statchasers_depth_charts_publish_check();
is( $r['result'], 'no club changed', 'team: a new stamp, same charts' );
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['sc_test_rocket'] ), 0, 'team: new stamp, no purge' );
is( count( $GLOBALS['scheduled'] ), 0, 'team: new stamp, no warm-up' );
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

// ------------------------------------------------------------ a purge that fails (retry)
echo "\nEdge purge retry\n";

// The edge's answer, set per case: 'fail' (every path), 'ok', an array (a
// structured answer), or null (the 'test edge' string above: skipped).
$GLOBALS['sc_test_edge_answer'] = null;
add_filter(
	'statchasers_depth_charts_pre_purge_edge',
	static function ( $result, $paths = array() ) {
		$answer = $GLOBALS['sc_test_edge_answer'] ?? null;
		if ( 'fail' === $answer ) {
			return array( 'failed' => $paths, 'text' => 'rocket.net refused' );
		}
		if ( 'ok' === $answer ) {
			return array( 'failed' => array(), 'text' => 'rocket.net ok' );
		}
		return is_array( $answer ) ? $answer : $result;
	}
);
// Time passing: move the record's ledger back.
$age = static function ( string $option, int $secs ): void {
	$r = get_option( $option );
	foreach ( array( 'next_at', 'first_at', 'last_at' ) as $k ) {
		if ( ! empty( $r['edge_retry'][ $k ] ) ) {
			$r['edge_retry'][ $k ] -= $secs;
		}
	}
	update_option( $option, $r );
};
$team_warms = static fn(): array => array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_DEPTH_TEAM_WARM_HOOK === $e[0] ) );
$retry_warms = static fn(): array => array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_EDGE_RETRY_WARM_HOOK === $e[0] ) );
$bills_tab   = '/nfl/teams/buffalo-bills/depth-chart/';
$fins_tab    = '/nfl/teams/miami-dolphins/depth-chart/';
$jets_tab    = '/nfl/teams/new-york-jets/depth-chart/';
$publish     = static function ( string $fp, array $hashes ) use ( $doc ): array {
	$GLOBALS['http_code']    = 200;
	$GLOBALS['http_body']    = json_encode( $doc( $fp, $hashes, $fp . '~v' ) );
	$GLOBALS['http_headers'] = array( 'x-sc-depth-version' => $fp . '~v', 'etag' => 'W/"' . $fp . '"' );
	return statchasers_depth_charts_publish_check();
};

// The purge itself: what each answer means.
$p = statchasers_edge_purge( array( '/a/', '/b/' ), 'statchasers_test_no_such_filter' );
is( array( $p['state'], $p['text'], $p['failed'] ), array( 'skipped', 'no edge purge available', array() ), 'purge: no mu-plugin, skipped (not failed)' );
$GLOBALS['sc_test_cdn'] = array();
if ( ! class_exists( 'CDN_Clear_Cache_Api' ) ) {
	// The mu-plugin's call, answering from a queue: an object with success, [] (its guard file), null (a timeout).
	class CDN_Clear_Cache_Api {
		public static function cache_api_call( $files, $action = 'purge' ) {
			$GLOBALS['sc_test_cdn'][] = $files;
			return array_shift( $GLOBALS['sc_test_cdn_answers'] );
		}
	}
}
$many = array();
for ( $i = 0; $i < 35; $i++ ) {
	$many[] = "/p{$i}/";
}
$GLOBALS['sc_test_cdn_answers'] = array( (object) array( 'success' => true ), (object) array( 'success' => false ) );
$p = statchasers_edge_purge( $many, 'statchasers_test_no_such_filter' );
is( array( count( $GLOBALS['sc_test_cdn'][0] ), count( $GLOBALS['sc_test_cdn'][1] ) ), array( 30, 5 ), 'purge: 30 paths a call' );
is( array( $p['state'], $p['text'], count( $p['purged'] ), $p['failed'] ), array( 'failed', 'rocket.net ok,refused', 30, array_slice( $many, 30 ) ), 'purge: the refused call\'s paths, and only those, failed' );
$GLOBALS['sc_test_cdn_answers'] = array( array() );
$p = statchasers_edge_purge( array( '/a/' ), 'statchasers_test_no_such_filter' );
is( array( $p['state'], $p['text'] ), array( 'failed', 'rocket.net sent' ), 'purge: no readable answer (guard file, timeout) is a failure' );
$GLOBALS['sc_test_cdn_answers'] = array( (object) array( 'success' => true ) );
$p = statchasers_edge_purge( array( '/a/' ), 'statchasers_test_no_such_filter' );
is( array( $p['state'], $p['text'], $p['purged'] ), array( 'ok', 'rocket.net ok', array( '/a/' ) ), 'purge: success' );
is( statchasers_edge_purge_paths( array( '/a/' ), 'statchasers_depth_charts_pre_purge_edge' ), 'test edge', 'purge: the 1.10.71 string helper is unchanged' );

// A record 1.10.71 wrote: read as it is. Its purge landed: nothing to retry.
$reset();
update_option( STATCHASERS_DEPTH_TEAM_OPTION, array( 'version' => 'fpL', 'teams' => array(), 'changed' => array( 'buffalo-bills' ), 'paths' => 1, 'wp_rocket' => true, 'edge' => 'rocket.net ok', 'published_at' => time() - 600 ) );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$GLOBALS['http_body']           = json_encode( $doc( 'fpL', array(), 'L~v' ) );
$r = statchasers_depth_charts_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ), isset( $r['edge_retry'] ) ), array( 'unchanged', 0, false ), 'upgrade: a 1.10.71 record whose purge landed, unchanged and quiet' );
// Its purge did not land: adopted, retried once on the first run.
$reset();
update_option( STATCHASERS_DEPTH_TEAM_OPTION, array( 'version' => 'fpL', 'teams' => array(), 'changed' => array( 'buffalo-bills' ), 'paths' => 1, 'wp_rocket' => true, 'edge' => 'rocket.net refused', 'published_at' => time() - 600 ) );
$r = statchasers_depth_charts_publish_check();
is( array( $r['result'], $GLOBALS['sc_test_edge'] ), array( 'unchanged', array( array( $bills_tab ) ) ), 'upgrade: a 1.10.71 record whose purge failed, its tab purged on the first run' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_attempts'] ), array( 'ok', 0, 2 ), 'upgrade: landed on attempt 2' );
is( count( $retry_warms() ), 1, 'upgrade: then warmed' );
is( count( $GLOBALS['sc_test_rocket'] ), 0, 'upgrade: WP Rocket not cleaned again' );

// Case 1: the purge fails once, then succeeds.
$reset();
update_option( STATCHASERS_DEPTH_TEAM_OPTION, array() );
$GLOBALS['sc_test_edge_answer'] = null;
$publish( 'fpR0', array() ); // A baseline publication of all 32 (skipped edge).
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$r = $publish( 'fpR1', array( 'buffalo-bills' => 'r1' ) );
is( $r['result'], 'published', 'fail once: the publication is recorded' );
is( array( $r['edge'], $r['edge_state'], $r['edge_pending'], $r['edge_failed'], $r['edge_attempts'] ), array( 'rocket.net refused', 'pending', 1, 0, 1 ), 'fail once: one path pending, attempt 1' );
is( $r['edge_retry']['pending'], array( $bills_tab ), 'fail once: the failed path is named' );
is( $r['edge_retry']['next_at'] - time() >= 299 && $r['edge_retry']['next_at'] - time() <= 301, true, 'fail once: next attempt in 5 minutes' );
is( array( $r['to_warm'], count( $team_warms() ) ), array( array(), 0 ), 'fail once: nothing warmed while the edge holds the old page' );
is( count( $GLOBALS['sc_test_rocket'] ), 1, 'fail once: WP Rocket cleaned once, at the publication' );

$reset();
$r = statchasers_depth_charts_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ), $r['edge_pending'] ), array( 'unchanged', 0, 1 ), 'fail once: not due yet, no purge, still pending' );

$reset();
$age( STATCHASERS_DEPTH_TEAM_OPTION, 300 );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = statchasers_depth_charts_publish_check();
is( array( $r['result'], $GLOBALS['sc_test_edge'] ), array( 'unchanged', array( array( $bills_tab ) ) ), 'fail once: retried once, exactly the pending path' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_attempts'], $r['retry'] ), array( 'ok', 0, 2, 'attempt 2 of 6: rocket.net ok' ), 'fail once: landed on attempt 2, recorded' );
is( count( $GLOBALS['remote_urls'] ), 1, 'fail once: the retry fetches nothing (the version read only)' );
is( count( $GLOBALS['sc_test_rocket'] ), 0, 'fail once: WP Rocket not cleaned again' );
$rw = $retry_warms();
is( count( $rw ), 1, 'fail once: then warmed (one event)' );
is( $rw[0][3], array( STATCHASERS_DEPTH_TEAM_OPTION, 'StatChasers-DepthWarm/1', array( 'https://example.com' . $bills_tab ) ), 'fail once: the warm-up names the record and the landed tab' );
is( $rw[0][1] - time() >= 59 && $rw[0][1] - time() <= 61, true, 'fail once: warmed a minute after the purge' );
$GLOBALS['http_body'] = '';
$w = statchasers_edge_retry_warm( ...$rw[0][3] );
is( array_keys( $w ), array( 'https://example.com' . $bills_tab . ' desktop', 'https://example.com' . $bills_tab . ' phone' ), 'fail once: the warm-up, desktop and phone' );
is( isset( get_option( STATCHASERS_DEPTH_TEAM_OPTION )['retry_warm'] ), true, 'fail once: the warm-up is on record' );
is( statchasers_edge_retry_warm( 'siteurl', 'x', array( 'https://example.com/' ) ), array(), 'retry warm: only a publication record' );

$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpR1', array( 'buffalo-bills' => 'r1' ), 'fpR1~v' ) );
$age( STATCHASERS_DEPTH_TEAM_OPTION, 3600 );
$r = statchasers_depth_charts_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['scheduled'] ), $r['edge_state'] ), array( 'unchanged', 0, 0, 'ok' ), 'fail once: then quiet' );

// Case 2: the purge keeps failing: bounded, recorded, never warmed.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$r = $publish( 'fpR2', array( 'buffalo-bills' => 'r2' ) );
$gaps = array( $r['edge_retry']['next_at'] - $r['edge_retry']['last_at'] );
$purges = count( $GLOBALS['sc_test_edge'] );
for ( $i = 0; $i < 7; $i++ ) {
	$age( STATCHASERS_DEPTH_TEAM_OPTION, 6 * 3600 );
	$r = statchasers_depth_charts_publish_check();
	if ( $r['edge_retry']['next_at'] ) {
		$gaps[] = $r['edge_retry']['next_at'] - $r['edge_retry']['last_at'];
	}
}
is( count( $GLOBALS['sc_test_edge'] ), 6, 'keeps failing: six attempts in all (the publication + 5 retries), then no more' );
is( $gaps, array( 300, 600, 1200, 2400, 4800 ), 'keeps failing: waits of 5, 10, 20, 40, 80 minutes' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_failed'], $r['edge_attempts'] ), array( 'failed', 0, 1, 6 ), 'keeps failing: given up on, recorded as failed' );
is( $r['edge_retry']['abandoned'], array( $bills_tab ), 'keeps failing: the given-up path is named' );
is( count( $team_warms() ) + count( $retry_warms() ), 0, 'keeps failing: never warmed' );
is( count( $GLOBALS['sc_test_rocket'] ), 1, 'keeps failing: WP Rocket cleaned once' );

// A new publication carries the given-up path: purged together, once.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = $publish( 'fpR3', array( 'buffalo-bills' => 'r2', 'miami-dolphins' => 'r3' ) );
is( $GLOBALS['sc_test_edge'], array( array( $fins_tab, $bills_tab ) ), 'given up, then a new publication: one purge of the new tab and the given-up one' );
is( array( $r['changed'], $r['to_warm'], $r['edge_state'], $r['edge_failed'], $r['paths'] ), array( array( 'miami-dolphins' ), array( 'miami-dolphins', 'buffalo-bills' ), 'ok', 0, 2 ), 'given up, then a new publication: both warmed, nothing left' );

// Case 3: a new publication arrives while a retry is pending: the union, once.
$reset();
$GLOBALS['sc_test_edge_answer'] = array( 'failed' => array( $fins_tab ), 'text' => 'rocket.net refused' );
$r = $publish( 'fpR4', array( 'buffalo-bills' => 'r2', 'miami-dolphins' => 'r4' ) );
is( $r['edge_retry']['pending'], array( $fins_tab ), 'union: the Dolphins tab pending' );
$reset();
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = $publish( 'fpR5', array( 'buffalo-bills' => 'r2', 'miami-dolphins' => 'r4', 'new-york-jets' => 'r5' ) );
is( $GLOBALS['sc_test_edge'], array( array( $jets_tab, $fins_tab ) ), 'union: one purge of the new tab and the pending one (not due yet, purged anyway, once)' );
is( array( $r['changed'], $r['to_warm'], $r['edge_state'], $r['edge_pending'], $r['edge_attempts'] ), array( array( 'new-york-jets' ), array( 'new-york-jets', 'miami-dolphins' ), 'ok', 0, 1 ), 'union: both warmed, the count starts again' );
is( count( $GLOBALS['remote_urls'] ), 2, 'union: the pending club is not fetched again (version + the new club only)' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com' . $jets_tab ) ), 'union: WP Rocket cleaned for the new club only' );

// Case 4: skipped is not failed: no retry loop.
$reset();
$GLOBALS['sc_test_edge_answer'] = null;
$r = $publish( 'fpR6', array( 'buffalo-bills' => 'r6', 'miami-dolphins' => 'r4', 'new-york-jets' => 'r5' ) );
is( array( $r['edge'], $r['edge_state'], $r['edge_pending'], $r['to_warm'] ), array( 'test edge', 'skipped', 0, array( 'buffalo-bills' ) ), 'skipped: recorded as skipped, nothing pending, warmed' );
$reset();
$age( STATCHASERS_DEPTH_TEAM_OPTION, 6 * 3600 );
$r = statchasers_depth_charts_publish_check();
is( array( count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['scheduled'] ) ), array( 0, 0 ), 'skipped: the next run purges nothing' );
// Pending, then the mu-plugin is gone: the retry is skipped and the ledger clears.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$publish( 'fpR7', array( 'buffalo-bills' => 'r7', 'miami-dolphins' => 'r4', 'new-york-jets' => 'r5' ) );
$age( STATCHASERS_DEPTH_TEAM_OPTION, 300 );
$GLOBALS['sc_test_edge_answer'] = array( 'state' => 'skipped', 'text' => 'no edge purge available' );
$r = statchasers_depth_charts_publish_check();
is( array( $r['edge_state'], $r['edge_pending'], $r['retry'] ), array( 'skipped', 0, 'attempt 2: skipped (no edge purge available); not retried' ), 'skipped on retry: cleared, not retried' );
$reset();
$age( STATCHASERS_DEPTH_TEAM_OPTION, 6 * 3600 );
statchasers_depth_charts_publish_check();
is( count( $GLOBALS['sc_test_edge'] ), 0, 'skipped on retry: no loop' );

// An old warm-up event (a 1.10.71 record: no to_warm) still warms `changed`.
$reset();
$GLOBALS['http_body'] = '';
update_option( STATCHASERS_DEPTH_TEAM_OPTION, array( 'version' => 'old', 'changed' => array( 'buffalo-bills' ) ) );
is( count( statchasers_depth_charts_team_warm( 'old', 0 ) ), 2, 'upgrade: a 1.10.71 warm-up event warms its changed club' );

// The league page: the hook fires once, its retry rides on the five-minute event.
is( in_array( 'statchasers_depth_charts_hub_retry', $GLOBALS['hooks'][ STATCHASERS_DEPTH_PUBLISH_HOOK ] ?? array(), true ), true, 'hub retry: on the five-minute event' );
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$r = statchasers_depth_charts_hub_publish( array( 'status' => 'success', 'last_refreshed_ts' => 1795560000 ) );
is( array( $r['version'], $r['edge_state'], $r['edge_pending'] ), array( 1795560000, 'pending', 1 ), 'hub fail: recorded, pending' );
is( in_array( STATCHASERS_DEPTH_HUB_WARM_HOOK, array_column( $GLOBALS['scheduled'], 0 ), true ), false, 'hub fail: not warmed' );
$reset();
statchasers_depth_charts_hub_retry();
is( count( $GLOBALS['sc_test_edge'] ), 0, 'hub fail: not due, no purge' );
// A second refresh while pending: the page once.
$r = statchasers_depth_charts_hub_publish( array( 'status' => 'success', 'last_refreshed_ts' => 1795560300 ) );
is( $GLOBALS['sc_test_edge'], array( array( '/nfl/nfl-depth-charts/' ) ), 'hub union: one purge, the page once' );
is( $r['edge_attempts'], 1, 'hub union: the count starts again' );
$reset();
$age( STATCHASERS_DEPTH_HUB_OPTION, 300 );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = statchasers_depth_charts_hub_retry();
is( array( $GLOBALS['sc_test_edge'], $r['edge_state'], $r['edge_attempts'], $r['version'] ), array( array( array( '/nfl/nfl-depth-charts/' ) ), 'ok', 2, 1795560300 ), 'hub retry: landed on attempt 2, the publication kept' );
is( $retry_warms()[0][3] ?? null, array( STATCHASERS_DEPTH_HUB_OPTION, 'StatChasers-DepthWarm/1', array( 'https://example.com/nfl/nfl-depth-charts/' ) ), 'hub retry: then warmed' );
is( count( $GLOBALS['sc_test_rocket'] ), 0, 'hub retry: WP Rocket not cleaned again' );
$reset();
$age( STATCHASERS_DEPTH_HUB_OPTION, 3600 );
statchasers_depth_charts_hub_retry();
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['scheduled'] ), 0, 'hub retry: then quiet' );
$GLOBALS['sc_test_edge_answer'] = null;

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
