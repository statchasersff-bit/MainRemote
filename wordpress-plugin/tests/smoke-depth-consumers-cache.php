<?php
/**
 * The depth-chart snapshot's other pages: hub Draft tabs and matchup
 * previews (statchasers-depth-consumers-cache.php), against the stub harness.
 * Order, scope and refusals; the run through a real WordPress, WP Rocket and
 * edge model is artifacts/api-server/scripts/depth-charts/consumers/replay.mjs.
 * smoke.php runs this as STATCHASERS_SMOKE_GROUP=dcconsumers.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_depth_consumers_check' ) ) {
	fwrite( STDERR, "smoke-depth-consumers-cache.php is included by smoke.php; run that.\n" );
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

echo "\nDepth snapshot consumers: hub Draft tabs and matchup previews\n";

is( in_array( 'statchasers_depth_consumers_check', $GLOBALS['hooks'][ STATCHASERS_DEPTH_PUBLISH_HOOK ] ?? array(), true ), true, 'hooked on the tabs\' five-minute event' );

$slugs = array_keys( statchasers_team_table() );
$now   = time();
$doc   = static function ( string $fingerprint, array $draft, ?array $previews ) use ( $slugs ): array {
	$teams = array();
	foreach ( $slugs as $slug ) {
		$teams[ $slug ] = array( 'abbr' => 'X', 'hash' => 'h', 'version' => 'v', 'updatedAt' => null, 'hub' => "/nfl/teams/{$slug}/", 'draft' => $draft[ $slug ] ?? 'd0' );
	}
	return array( 'version' => $fingerprint, 'fetchedAt' => '2026-11-24T12:59:15+00:00', 'season' => 2026, 'teams' => $teams, 'previews' => $previews );
};
$soon  = $now + DAY_IN_SECONDS;
$later = $now + 20 * DAY_IN_SECONDS;
$pv    = static function ( array $hashes ) use ( $soon, $later ): array {
	return array(
		'/nfl/buffalo-bills-vs-kansas-city-chiefs/'              => array( 'hash' => $hashes['kc'] ?? 'p0', 'kickoff' => $soon ),
		'/nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/' => array( 'hash' => $hashes['kc'] ?? 'p0', 'kickoff' => $soon ),
		'/nfl/buffalo-bills-vs-new-england-patriots/2026-week-13/' => array( 'hash' => $hashes['ne'] ?? 'p1', 'kickoff' => $later ),
		'/nfl/dallas-cowboys-vs-philadelphia-eagles/2026-week-12/' => array( 'hash' => 'p2', 'kickoff' => $soon ),
		'/nfl/not-a-path/../x/'                                    => array( 'hash' => 'zz', 'kickoff' => $soon ),
	);
};

// API down, or an API before this change (no `draft`): nothing touched.
$reset();
$GLOBALS['http_code'] = 503;
$GLOBALS['http_body'] = '';
$r = statchasers_depth_consumers_check();
is( $r['result'], 'version unavailable; nothing changed', 'API down: reported' );
$GLOBALS['http_code'] = 200;
$old = $doc( 'fpA', array(), $pv( array() ) );
foreach ( $old['teams'] as &$t ) {
	unset( $t['draft'] );
}
unset( $t );
$GLOBALS['http_body'] = json_encode( $old );
$r = statchasers_depth_consumers_check();
is( $r['result'], 'version unavailable; nothing changed', 'an API without Draft hashes is not read' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'refused: no purge' );

// First run: a baseline, nothing purged.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpA', array(), $pv( array() ) ) );
$r = statchasers_depth_consumers_check();
is( $r['result'], 'baseline recorded', 'first run: baseline' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ), 0, 'first run: no purge' );
is( count( $r['previews'] ), 4, 'first run: four preview paths recorded, the malformed one dropped' );

// Same version: nothing.
$reset();
$r = statchasers_depth_consumers_check();
is( $r['result'], 'unchanged', 'same version: unchanged' );

// The Bills' chart moves: their hub, the hub of a club whose draftee is on it
// (Draft hash moved), and the Bills' preview pages. Not the Cowboys-Eagles page.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpB', array( 'buffalo-bills' => 'd1', 'miami-dolphins' => 'd1' ), $pv( array( 'kc' => 'q0', 'ne' => 'q1' ) ) ) );
$r = statchasers_depth_consumers_check();
is( $r['result'], 'published', 'one club moved: published' );
$want = array(
	'/nfl/teams/buffalo-bills/',
	'/nfl/teams/miami-dolphins/',
	'/nfl/buffalo-bills-vs-kansas-city-chiefs/',
	'/nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/',
	'/nfl/buffalo-bills-vs-new-england-patriots/2026-week-13/',
);
is( $r['changed'], $want, 'one club moved: exactly the two hubs and the three Bills preview pages' );
is( $GLOBALS['sc_test_edge'], array( $want ), 'edge: one targeted purge of those paths' );
is( $GLOBALS['sc_test_rocket'], array( array_map( static fn( $p ) => 'https://example.com' . $p, $want ) ), 'WP Rocket: exactly those URLs' );
is( in_array( '/nfl/buffalo-bills-vs-new-england-patriots/2026-week-13/', $r['to_warm'], true ), false, 'warm: a preview three weeks out refills on demand' );
is( in_array( '/nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/', $r['to_warm'], true ), true, 'warm: this week\'s preview is warmed' );
is( in_array( '/nfl/teams/miami-dolphins/', $r['to_warm'], true ), true, 'warm: the hubs are warmed' );
is( in_array( STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK, array_column( $GLOBALS['scheduled'], 0 ), true ), true, 'warm: scheduled' );
is( $r['previous'], 'fpA', 'the previous publication is on record' );

// A new stamp, same content: recorded, nothing purged. A new preview path
// (a pair page entering its preview window) is not a change.
$reset();
$next = $pv( array( 'kc' => 'q0', 'ne' => 'q1' ) );
$next['/nfl/chicago-bears-vs-detroit-lions/'] = array( 'hash' => 'n0', 'kickoff' => $soon );
$GLOBALS['http_body'] = json_encode( $doc( 'fpC', array( 'buffalo-bills' => 'd1', 'miami-dolphins' => 'd1' ), $next ) );
$r = statchasers_depth_consumers_check();
is( $r['result'], 'no page changed', 'same content under a new stamp: nothing purged' );
is( count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['sc_test_rocket'] ), 0, 'same content: no purge' );

// The slate cannot be read: the hubs publish, the preview record is kept.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpD', array( 'buffalo-bills' => 'd2', 'miami-dolphins' => 'd1' ), null ) );
$r = statchasers_depth_consumers_check();
is( $r['changed'], array( '/nfl/teams/buffalo-bills/' ), 'no slate: the hub publishes alone' );
is( $r['matchups'], 'slate unavailable', 'no slate: said so' );
is( $r['previews']['/nfl/buffalo-bills-vs-kansas-city-chiefs/'] ?? '', 'q0', 'no slate: the stored preview hashes are kept' );

// Forced: every listed page.
$reset();
$GLOBALS['http_body'] = json_encode( $doc( 'fpD', array( 'buffalo-bills' => 'd2', 'miami-dolphins' => 'd1' ), $next ) );
$r = statchasers_depth_consumers_check( true );
is( $r['result'], 'republished (forced)', 'forced: republished' );
is( count( $r['changed'] ), 32 + 5, 'forced: 32 hubs + 5 preview paths' );
is( count( array_filter( $r['changed'], static fn( $p ) => '' === statchasers_depth_consumers_path( $p ) ) ), 0, 'forced: only hub and matchup shapes' );

// Path filter.
is( statchasers_depth_consumers_path( '/nfl/teams/buffalo-bills/' ), '/nfl/teams/buffalo-bills/', 'path: hub' );
is( statchasers_depth_consumers_path( '/nfl/teams/buffalo-bills/depth-chart/' ), '', 'path: a team section is not ours (the tabs publish it)' );
is( statchasers_depth_consumers_path( '/nfl/nfl-schedule/' ), '', 'path: the schedule is not ours' );
is( statchasers_depth_consumers_path( 'https://evil.example/nfl/teams/x/' ), '', 'path: absolute URLs refused' );

// Warm-up: desktop and phone for each.
$reset();
$GLOBALS['http_body'] = '';
update_option( STATCHASERS_DEPTH_CONSUMERS_OPTION, array( 'to_warm' => array( '/nfl/teams/buffalo-bills/' ) ) );
$w = statchasers_depth_consumers_warm();
is( array_keys( $w ), array( 'https://example.com/nfl/teams/buffalo-bills/ desktop', 'https://example.com/nfl/teams/buffalo-bills/ phone' ), 'warm: desktop and phone' );

// ------------------------------------------------------------ a purge that fails (retry)
echo "\nEdge purge retry (consumers)\n";

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
$age = static function ( int $secs ): void {
	$r = get_option( STATCHASERS_DEPTH_CONSUMERS_OPTION );
	foreach ( array( 'next_at', 'first_at', 'last_at' ) as $k ) {
		if ( ! empty( $r['edge_retry'][ $k ] ) ) {
			$r['edge_retry'][ $k ] -= $secs;
		}
	}
	update_option( STATCHASERS_DEPTH_CONSUMERS_OPTION, $r );
};
$check = static function ( string $fp, array $draft, array $previews ) use ( $doc ): array {
	$GLOBALS['http_code'] = 200;
	$GLOBALS['http_body'] = json_encode( $doc( $fp, $draft, $previews ) );
	return statchasers_depth_consumers_check();
};
$events = static fn( string $hook ): array => array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => $hook === $e[0] ) );
$hub    = '/nfl/teams/buffalo-bills/';
$kc     = '/nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/';
$ne     = '/nfl/buffalo-bills-vs-new-england-patriots/2026-week-13/';

// Baseline.
$reset();
update_option( STATCHASERS_DEPTH_CONSUMERS_OPTION, array() );
$GLOBALS['sc_test_edge_answer'] = null;
$check( 'fpR0', array(), $pv( array() ) );

// Case 1: the purge fails once, then succeeds; the near pages are then warmed, the far one is not.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$r = $check( 'fpR1', array( 'buffalo-bills' => 'r1' ), $pv( array( 'kc' => 'r1', 'ne' => 'r1' ) ) );
is( array( $r['result'], $r['edge_state'], $r['edge_pending'], $r['to_warm'] ), array( 'published', 'pending', 4, array() ), 'fail once: published, the hub and three Bills previews pending, nothing warmed' );
is( count( $events( STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK ) ), 0, 'fail once: no warm-up scheduled' );
is( in_array( $ne, $r['edge_retry']['pending'], true ) && ! in_array( $ne, $r['edge_retry']['warm'], true ), true, 'fail once: the far preview pending, not to be warmed' );
$reset();
$age( 300 );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = $check( 'fpR1', array( 'buffalo-bills' => 'r1' ), $pv( array( 'kc' => 'r1', 'ne' => 'r1' ) ) );
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['sc_test_edge'][0] ?? array() ) ), array( 'unchanged', 1, 4 ), 'fail once: retried once, the four paths' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_attempts'] ), array( 'ok', 0, 2 ), 'fail once: landed on attempt 2' );
is( count( $GLOBALS['sc_test_rocket'] ), 0, 'fail once: WP Rocket not cleaned again' );
$warmed = array_merge( ...array_map( static fn( $e ) => $e[3][2], $events( STATCHASERS_EDGE_RETRY_WARM_HOOK ) ) );
is( in_array( 'https://example.com' . $hub, $warmed, true ) && in_array( 'https://example.com' . $kc, $warmed, true ), true, 'fail once: then the hub and this week\'s preview are warmed' );
is( in_array( 'https://example.com' . $ne, $warmed, true ), false, 'fail once: not the preview three weeks out' );
$reset();
$age( 3600 );
$r = $check( 'fpR1', array( 'buffalo-bills' => 'r1' ), $pv( array( 'kc' => 'r1', 'ne' => 'r1' ) ) );
is( array( count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['scheduled'] ) ), array( 0, 0 ), 'fail once: then quiet' );

// Case 2: the purge keeps failing: bounded, recorded, never warmed.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$check( 'fpR2', array( 'buffalo-bills' => 'r2' ), $pv( array( 'kc' => 'r1', 'ne' => 'r1' ) ) );
for ( $i = 0; $i < 7; $i++ ) {
	$age( 6 * 3600 );
	$r = $check( 'fpR2', array( 'buffalo-bills' => 'r2' ), $pv( array( 'kc' => 'r1', 'ne' => 'r1' ) ) );
}
is( count( $GLOBALS['sc_test_edge'] ), 6, 'keeps failing: six attempts, then no more' );
is( array( $r['edge_state'], $r['edge_pending'], $r['edge_failed'] ), array( 'failed', 0, 1 ), 'keeps failing: the hub given up on, recorded' );
is( count( $GLOBALS['scheduled'] ), 0, 'keeps failing: never warmed' );

// Case 3: a new publication while a retry is pending: the union, once.
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$check( 'fpR3', array( 'buffalo-bills' => 'r2' ), $pv( array( 'kc' => 'r3', 'ne' => 'r1' ) ) );
$reset();
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = $check( 'fpR4', array( 'buffalo-bills' => 'r4' ), $pv( array( 'kc' => 'r3', 'ne' => 'r1' ) ) );
$want = array( $hub, '/nfl/buffalo-bills-vs-kansas-city-chiefs/', $kc );
sort( $want );
$got = $GLOBALS['sc_test_edge'][0] ?? array();
sort( $got );
is( array( count( $GLOBALS['sc_test_edge'] ), $got ), array( 1, $want ), 'union: one purge of the new hub and the two pending previews, each once' );
is( array( $r['changed'], $r['edge_state'], $r['edge_pending'] ), array( array( $hub ), 'ok', 0 ), 'union: landed, nothing left' );
is( count( $r['to_warm'] ), 3, 'union: the hub and both near previews warmed' );

// Case 4: skipped: no retry loop.
$reset();
$GLOBALS['sc_test_edge_answer'] = null;
$r = $check( 'fpR5', array( 'buffalo-bills' => 'r5' ), $pv( array( 'kc' => 'r3', 'ne' => 'r1' ) ) );
is( array( $r['edge'], $r['edge_state'], $r['edge_pending'], $r['to_warm'] ), array( 'test edge', 'skipped', 0, array( $hub ) ), 'skipped: not pending, warmed' );
$reset();
$age( 6 * 3600 );
$check( 'fpR5', array( 'buffalo-bills' => 'r5' ), $pv( array( 'kc' => 'r3', 'ne' => 'r1' ) ) );
is( count( $GLOBALS['sc_test_edge'] ), 0, 'skipped: the next run purges nothing' );
$GLOBALS['sc_test_edge_answer'] = null;
