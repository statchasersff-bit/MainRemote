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
