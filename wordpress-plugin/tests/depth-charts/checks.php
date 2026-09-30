<?php
/**
 * Assertions for rules with a crisp answer. Exits non-zero on any failure.
 *
 *   php checks.php
 *
 * - The bare tool page canonicalises (and og:url) to the URL the sitemap lists.
 * - A refresh keeps a failed team's previous entry, and never writes when
 *   nothing was fetched.
 * - SCDC_Store::write() replaces the file by rename, so a reader holding the
 *   old file never sees it truncated or half-written.
 * - A refresh takes a lock the button and the daily cron share, and a stale
 *   lock is taken over.
 * - The hub never nests an <a> inside an <a>.
 */

require __DIR__ . '/wp-stubs.php';

$GLOBALS['scdc_fail'] = 0;
function check( $label, $ok, $detail = '' ) {
	echo ( $ok ? 'ok    ' : 'FAIL  ' ) . $label . ( $ok || '' === $detail ? '' : "\n      $detail" ) . "\n";
	if ( ! $ok ) {
		$GLOBALS['scdc_fail']++;
	}
}

// --- HTTP stubs: every request fails, except ESPN for the slugs listed here.
$GLOBALS['http_espn_ok'] = array();
function wp_remote_get( $url, $args = array() ) {
	if ( preg_match( '#/teams/([a-z]+)/depthcharts$#', $url, $m ) && in_array( $m[1], $GLOBALS['http_espn_ok'], true ) ) {
		return array( 'code' => 200, 'body' => '{"season":{"year":2026},"depthchart":[]}' );
	}
	return array( 'code' => 500, 'body' => '' );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
function get_category_by_slug( $slug ) { return false; }

require __DIR__ . '/../../statchasers-depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

// ------------------------------------------------------------ 1. canonical

$sitemap_main = 'https://statchasers.com/nfl/nfl-depth-charts/fantasy/';
$out          = shell_exec( escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __DIR__ . '/render-url.php' ) . ' /nfl/nfl-depth-charts/' );
preg_match( '#<link rel="canonical" href="([^"]*)"#', (string) $out, $canon );
preg_match( '#<meta property="og:url" content="([^"]*)"#', (string) $out, $og );
check( 'bare main page canonical is the sitemap URL', isset( $canon[1] ) && $sitemap_main === $canon[1], 'got ' . ( isset( $canon[1] ) ? $canon[1] : '(none)' ) );
check( 'bare main page og:url is the sitemap URL', isset( $og[1] ) && $sitemap_main === $og[1], 'got ' . ( isset( $og[1] ) ? $og[1] : '(none)' ) );

// ------------------------------------------------------------ 1b. sitemap

$bare = SCDC_Sitemap::drop_bare_page( array( 'loc' => 'https://statchasers.com/nfl/nfl-depth-charts/' ), 'post', (object) array( 'ID' => 42 ) );
check( 'sitemap: the bare tool page is dropped from Rank Math by id', false === $bare );
$bare = SCDC_Sitemap::drop_bare_page( array( 'loc' => 'https://statchasers.com/nfl/nfl-depth-charts/' ), 'post', null );
check( 'sitemap: the bare tool page is dropped from Rank Math by path', false === $bare );
$kept = SCDC_Sitemap::drop_bare_page( array( 'loc' => 'https://statchasers.com/nfl/' ), 'post', (object) array( 'ID' => 7 ) );
check( 'sitemap: other pages are kept', is_array( $kept ) );
check( 'sitemap: the filter is hooked', ! empty( $GLOBALS['wp_filters']['rank_math/sitemap/entry'] ) );

// -------------------------------------------------------------- 2. refresh

$previous = array(
	'version' => 1,
	'teams'   => array(
		array( 'team' => array( 'abbr' => 'ATL', 'name' => 'Atlanta Falcons' ), 'positions' => array( 'QB' => array( array( 'name' => 'Old QB', 'rank' => 1 ) ) ) ),
		array( 'team' => array( 'abbr' => 'ARI', 'name' => 'Arizona Cardinals' ), 'positions' => array( 'QB' => array( array( 'name' => 'Stale QB', 'rank' => 1 ) ) ) ),
	),
);
$by_abbr = function ( $payload ) {
	$index = array();
	foreach ( $payload['teams'] as $t ) {
		$index[ $t['team']['abbr'] ] = $t;
	}
	return $index;
};

// ARI and BAL fetch; ATL (has a previous entry) and the other 29 (none) fail.
$GLOBALS['http_espn_ok'] = array( 'ari', 'bal' );
$r     = SCDC_Refresh::run( $previous );
$teams = $by_abbr( $r['payload'] );
check( 'partial refresh: status partial, 2 fetched', 'partial' === $r['status'] && 2 === $r['teams_ok'], "status {$r['status']}, teams_ok {$r['teams_ok']}" );
check( 'partial refresh: failed team keeps its previous entry', isset( $teams['ATL'] ) && $teams['ATL'] === $previous['teams'][0] );
check( 'partial refresh: fetched team is replaced, not kept', isset( $teams['ARI'] ) && $teams['ARI'] !== $previous['teams'][1] );
check( 'partial refresh: payload holds fetched + kept teams only', 3 === count( $teams ), count( $teams ) . ' teams' );
check( 'partial refresh: ATL reported failed and kept', in_array( 'ATL', $r['teams_failed'], true ) && array( 'ATL' ) === $r['teams_kept'] );
check( 'partial refresh: notice names the kept team', false !== strpos( $r['error'], 'kept from the last refresh: ATL' ), $r['error'] );

// Nothing fetched: an error, even though ATL and ARI could be kept.
$GLOBALS['http_espn_ok'] = array();
$r = SCDC_Refresh::run( $previous );
check( 'total failure: status error, so the handler writes nothing', 'error' === $r['status'] && 0 === $r['teams_ok'], "status {$r['status']}" );

// Past the deadline: no team is fetched at all, every previous entry is kept.
$GLOBALS['http_espn_ok'] = array( 'ari', 'bal' );
$r = SCDC_Refresh::run( $previous, microtime( true ) );
check( 'deadline passed: no team fetched', 0 === $r['teams_ok'] && array( 'ATL', 'ARI' ) === array_values( array_intersect( array( 'ATL', 'ARI' ), $r['teams_kept'] ) ) );

// ---------------------------------------------------------------- 3. store

$tmp_dir = sys_get_temp_dir() . '/scdc-checks-' . getmypid();
$GLOBALS['scdc_test_basedir'] = $tmp_dir;
$ok_a  = SCDC_Store::write( array( 'teams' => array(), 'mark' => str_repeat( 'a', 5000 ) ) );
$path  = SCDC_Store::file_path();
$old   = fopen( $path, 'rb' );
$ok_b  = SCDC_Store::write( array( 'teams' => array(), 'mark' => 'b' ) );
$seen  = stream_get_contents( $old );
fclose( $old );
$now   = SCDC_Store::read();
check( 'store: both writes succeed', $ok_a && $ok_b );
check( 'store: a reader of the old file still sees it whole', is_array( json_decode( $seen, true ) ) && false !== strpos( $seen, str_repeat( 'a', 5000 ) ), strlen( $seen ) . ' bytes' );
check( 'store: the new file is in place', is_array( $now ) && 'b' === $now['mark'] );
$leftovers = glob( SCDC_Store::dir_path() . '/*.tmp' );
check( 'store: no temp files left behind', empty( $leftovers ), implode( ', ', (array) $leftovers ) );
array_map( 'unlink', glob( SCDC_Store::dir_path() . '/*' ) );
@rmdir( SCDC_Store::dir_path() );
@rmdir( $tmp_dir );
unset( $GLOBALS['scdc_test_basedir'] );

// ------------------------------------------------ 3b. lock, cron, season

$tmp_dir = sys_get_temp_dir() . '/scdc-lock-' . getmypid();
$GLOBALS['scdc_test_basedir'] = $tmp_dir;
$GLOBALS['http_espn_ok']      = array( 'ari', 'bal' );

update_option( SCDC_Refresh::LOCK_OPTION, time() );
check( 'lock: a live run blocks a second one', 'locked' === SCDC_Refresh::run_and_store( 0 ) );
check( 'lock: and leaves the live run\'s lock alone', false !== get_option( SCDC_Refresh::LOCK_OPTION ) );

update_option( SCDC_Refresh::LOCK_OPTION, time() - SCDC_Refresh::LOCK_TTL - 1 );
$status = SCDC_Refresh::run_and_store( 0 );
check( 'lock: a stale lock is taken over', 'partial' === $status, "status $status" );
check( 'lock: released when the run ends', false === get_option( SCDC_Refresh::LOCK_OPTION ) );
check( 'lock: the run stored its result', 'partial' === SCDC_Store::get_meta()['status'] );

$on_init = false;
foreach ( $GLOBALS['wp_filters']['init'] as $callbacks ) {
	$on_init = $on_init || in_array( 'scdc_schedule_refresh', $callbacks, true );
}
check( 'cron: scheduling is hooked to init', $on_init );
scdc_schedule_refresh();
check( 'cron: it schedules the daily refresh', false !== wp_next_scheduled( SCDC_Refresh::CRON_HOOK ) && 'daily' === $GLOBALS['wp_cron'][ SCDC_Refresh::CRON_HOOK ]['recurrence'] );
check( 'cron: the event runs the refresh', ! empty( $GLOBALS['wp_filters'][ SCDC_Refresh::CRON_HOOK ] ) );

// Nothing fetched, so the payload's season is the fallback: the configured
// season, not the calendar year.
add_filter( 'scdc_season', function () { return 2019; } );
$r = SCDC_Refresh::run( null, microtime( true ) );
check( 'season: the fallback is the configured season', 2019 === $r['payload']['season'], (string) $r['payload']['season'] );
unset( $GLOBALS['wp_filters']['scdc_season'] );

array_map( 'unlink', glob( SCDC_Store::dir_path() . '/*' ) );
@rmdir( SCDC_Store::dir_path() );
@rmdir( $tmp_dir );
unset( $GLOBALS['scdc_test_basedir'] );

// ------------------------------------------------------------------ 4. hub

add_filter( 'scdc_nfl_article_count', function () { return 0; } );
$hub   = call_user_func( $GLOBALS['shortcodes']['statchasers_nfl_hub'], array() );
$depth = 0;
$max   = 0;
preg_match_all( '#<(/?)a\b#i', $hub, $tags, PREG_SET_ORDER );
foreach ( $tags as $tag ) {
	$depth += '' === $tag[1] ? 1 : -1;
	$max    = max( $max, $depth );
}
check( 'hub: no <a> nested inside an <a>', 1 === $max && 0 === $depth, "max depth $max" );
check( 'hub: popular views still render', false !== strpos( $hub, 'fantasy/all-teams/rb/' ) );

echo $GLOBALS['scdc_fail'] ? "\n{$GLOBALS['scdc_fail']} check(s) failed\n" : "\nall checks passed\n";
exit( $GLOBALS['scdc_fail'] ? 1 : 0 );
