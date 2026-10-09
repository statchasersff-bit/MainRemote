<?php
/**
 * Assertions for rules with a crisp answer. Exits non-zero on any failure.
 *
 *   php checks.php
 *
 * - The tool answers at one address: the pre-1.7.0 team routes 301 to the
 *   team pages, the view routes and ?team= to the tool, junk 404s, and the
 *   page carries no team links and no SEO filters.
 * - A refresh keeps a failed team's previous entry, and never writes when
 *   nothing was fetched.
 * - SCDC_Store::write() replaces the file by rename, so a reader holding the
 *   old file never sees it truncated or half-written.
 * - A refresh takes a lock the button and the daily cron share, and a stale
 *   lock is taken over.
 * - The hub never nests an <a> inside an <a>.
 * - The three scrapers still read the pages they scrape: ESPN's JSON,
 *   Footballguys' and FantasyPros' HTML, captured 2026-09-30 and trimmed
 *   (fixtures/sources/). A markup change upstream breaks these first, instead
 *   of silently emptying a column on the live site.
 */

require __DIR__ . '/wp-stubs.php';

$GLOBALS['scdc_fail'] = 0;
function check( $label, $ok, $detail = '' ) {
	echo ( $ok ? 'ok    ' : 'FAIL  ' ) . $label . ( $ok || '' === $detail ? '' : "\n      $detail" ) . "\n";
	if ( ! $ok ) {
		$GLOBALS['scdc_fail']++;
	}
}

// --- HTTP stubs: every request fails, except ESPN for the slugs listed here,
// and any URL given a stored page in $GLOBALS['http_fixtures'].
$GLOBALS['http_espn_ok']  = array();
$GLOBALS['http_fixtures'] = array();
function wp_remote_get( $url, $args = array() ) {
	if ( isset( $GLOBALS['http_fixtures'][ $url ] ) ) {
		return array( 'code' => 200, 'body' => $GLOBALS['http_fixtures'][ $url ] );
	}
	if ( preg_match( '#/teams/([a-z]+)/depthcharts$#', $url, $m ) && in_array( $m[1], $GLOBALS['http_espn_ok'], true ) ) {
		return array( 'code' => 200, 'body' => '{"season":{"year":2026},"depthchart":[]}' );
	}
	return array( 'code' => 500, 'body' => '' );
}
// The push to the app: recorded, answered with $GLOBALS['http_post_code'].
$GLOBALS['http_posts']     = array();
$GLOBALS['http_post_code'] = 200;
function wp_remote_post( $url, $args = array() ) {
	$GLOBALS['http_posts'][] = array( 'url' => $url, 'args' => $args );
	return array( 'code' => $GLOBALS['http_post_code'], 'body' => 200 === $GLOBALS['http_post_code'] ? '{"ok":true}' : '{"ok":false,"error":"unauthorized"}' );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
function get_category_by_slug( $slug ) { return false; }

require __DIR__ . '/../../statchasers-depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

// ---------------------------------------------------------- 1. one address

$render = function ( $url ) {
	return (string) shell_exec( escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __DIR__ . '/render-url.php' ) . ' ' . escapeshellarg( $url ) );
};
$redirect_of = function ( $out ) {
	return preg_match( '#^HTTP (\d+) redirect -> (\S+)#m', $out, $m ) ? array( (int) $m[1], $m[2] ) : null;
};
$tool = 'https://statchasers.com/nfl/nfl-depth-charts/';

$out = $render( '/nfl/nfl-depth-charts/' );
check( 'tool page: 200, route main', false !== strpos( $out, 'HTTP status              : 200' ) && false !== strpos( $out, 'Route type               : main' ), $out );
check( 'tool page: no crawlable team anchors', false !== strpos( $out, 'Crawlable team anchors   : 0' ) );
check( 'tool page: no anchors at all in the shortcode markup', false !== strpos( $out, 'Anchors in the markup    : 0' ) );
check( 'tool page: no SEO filter is hooked', false === strpos( $out, 'UNEXPECTED' ), $out );
check( 'tool page: exactly one H1, the theme\'s', false !== strpos( $out, 'H1 elements in the initial HTML (1)' ) && false !== strpos( $out, 'NFL Depth Charts</h1>' ) );
check( 'tool page: no team chrome', false === strpos( $out, 'scdc-seo-' ) && false === strpos( $out, 'scdc-page-team' ) );

foreach ( array( 'houston-texans', 'dallas-cowboys', 'buffalo-bills' ) as $slug ) {
	$r = $redirect_of( $render( "/nfl/nfl-depth-charts/fantasy/{$slug}/" ) );
	check( "team route {$slug}: 301 to the team page", $r && 301 === $r[0] && "https://statchasers.com/nfl/teams/{$slug}/depth-chart/" === $r[1], wp_json_encode( $r ) );
}
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/fantasy/houston-texans/rb/' ) );
check( 'team route with a position: 301 to the team page', $r && 'https://statchasers.com/nfl/teams/houston-texans/depth-chart/' === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/offense/houston-texans/' ) );
check( 'team route in another view: 301 to the team page', $r && 'https://statchasers.com/nfl/teams/houston-texans/depth-chart/' === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/fantasy/Houston-Texans' ) );
check( 'uppercase, no trailing slash: still the team page', $r && 'https://statchasers.com/nfl/teams/houston-texans/depth-chart/' === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/fantasy/' ) );
check( 'view route: 301 to the tool', $r && 301 === $r[0] && $tool === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/defense/all-teams/cb/' ) );
check( 'all-teams position route: 301 to the tool', $r && $tool === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/?team=houston-texans' ) );
check( '?team=: 301 to the team page', $r && 'https://statchasers.com/nfl/teams/houston-texans/depth-chart/' === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/fantasy/?team=houston-texans' ) );
check( 'view route with ?team=: 301 to the team page', $r && 'https://statchasers.com/nfl/teams/houston-texans/depth-chart/' === $r[1], wp_json_encode( $r ) );
$r = $redirect_of( $render( '/nfl/nfl-depth-charts/?view=offense&utm_source=x' ) );
check( '?view=: 301 to the tool, other args kept', $r && 'https://statchasers.com/nfl/nfl-depth-charts/?utm_source=x' === $r[1], wp_json_encode( $r ) );
foreach ( array( '/nfl/nfl-depth-charts/fantasy/not-a-real-team/', '/nfl/nfl-depth-charts/bogus-view/houston-texans/', '/nfl/nfl-depth-charts/fantasy/houston-texans/goalie/' ) as $bad ) {
	$out = $render( $bad );
	check( "junk {$bad}: 404", false !== strpos( $out, 'HTTP status              : 404' ), $out );
}

// The team page address follows the team-pages plugin's switch and filter.
check( 'team page url: default', 'https://statchasers.com/nfl/teams/buffalo-bills/depth-chart/' === SCDC_Route::team_page_url( 'buffalo-bills' ) );
add_filter( 'scdc_team_page_url', function ( $url, $slug ) { return "https://example.com/t/{$slug}/"; }, 10, 2 );
check( 'team page url: filterable', 'https://example.com/t/buffalo-bills/' === SCDC_Route::team_page_url( 'buffalo-bills' ) );
unset( $GLOBALS['wp_filters']['scdc_team_page_url'] );

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
check( 'push: off without STATCHASERS_INGEST_SECRET, and nothing sent', array() === $GLOBALS['http_posts'] && 'off' === SCDC_Store::get_meta()['push']['status'] );

// ------------------------------------------------------------ 3b. push

define( 'STATCHASERS_INGEST_SECRET', 'test-secret' );
define( 'SCDC_PUSH_ORIGIN', 'https://app.example.com/' );
$status = SCDC_Refresh::run_and_store( 0 );
$sent   = end( $GLOBALS['http_posts'] );
check( 'push: a refresh that writes the file sends it', 1 === count( $GLOBALS['http_posts'] ) && 'https://app.example.com/api/depth-charts/ingest' === $sent['url'] );
check( 'push: with the secret header', 'test-secret' === $sent['args']['headers']['X-Ingest-Secret'] );
check( 'push: the body is the file that was written', json_decode( $sent['args']['body'], true ) === SCDC_Store::read() );
check( 'push: recorded as sent', 'ok' === SCDC_Store::get_meta()['push']['status'] );
$GLOBALS['http_post_code'] = 401;
$status = SCDC_Refresh::run_and_store( 0 );
check( 'push: an app error is recorded, and the refresh still succeeds', 'partial' === $status && 'error' === SCDC_Store::get_meta()['push']['status'] && false !== strpos( SCDC_Store::get_meta()['push']['message'], 'unauthorized' ) );
$GLOBALS['http_post_code'] = 200;
$GLOBALS['http_espn_ok']   = array();
$before = count( $GLOBALS['http_posts'] );
SCDC_Refresh::run_and_store( 0 );
check( 'push: a refresh that writes nothing sends nothing', count( $GLOBALS['http_posts'] ) === $before );
$GLOBALS['http_espn_ok'] = array( 'ari', 'bal' );

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

// ----------------------------------------------------------- 3c. sources

$src = __DIR__ . '/fixtures/sources';

$GLOBALS['http_fixtures'] = array(
	'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/buf/depthcharts' => file_get_contents( "$src/espn-buf.json" ),
);
$espn = SCDC_Espn::fetch_team( 'BUF', 'Buffalo Bills', 'buf' );
$GLOBALS['http_fixtures'] = array();
$first = function ( $list ) { return isset( $list[0]['name'] ) ? $list[0]['name'] : null; };
check( 'espn: the stored page parses to a team', is_array( $espn ) && ! empty( $espn['positions'] ) );
check( 'espn: season from the payload', is_array( $espn ) && 2026 === (int) $espn['season'] );
check( 'espn: QB1 is Josh Allen', is_array( $espn ) && 'Josh Allen' === $first( $espn['positions']['QB'] ?? array() ), wp_json_encode( array_slice( $espn['positions']['QB'] ?? array(), 0, 2 ) ) );
check( 'espn: offense and defense both present', is_array( $espn ) && isset( $espn['positions']['RB'], $espn['positions']['CB'] ), implode( ',', array_keys( $espn['positions'] ?? array() ) ) );
$statuses = array();
foreach ( ( is_array( $espn ) ? $espn['positions'] : array() ) as $players ) {
	foreach ( $players as $p ) {
		if ( ! empty( $p['status'] ) ) { $statuses[] = $p['status']; }
	}
}
check( 'espn: injury designations come through', ! empty( $statuses ), 'none found' );

$fbg = SCDC_Footballguys::parse_html( file_get_contents( "$src/footballguys-all.html" ) );
check( 'footballguys: both stored teams parse', array( 'BUF', 'PIT' ) === array_keys( $fbg ), implode( ',', array_keys( $fbg ) ) );
check( 'footballguys: BUF QB1 is Josh Allen, with his id', isset( $fbg['BUF']['QB'][0] ) && 'Josh Allen' === $fbg['BUF']['QB'][0]['name'] && 'AlleJo01' === $fbg['BUF']['QB'][0]['id'] );
check( 'footballguys: PIT RB1 is Jaylen Warren', 'Jaylen Warren' === $first( $fbg['PIT']['RB'] ?? array() ) );
foreach ( array( 'LT', 'K', 'DL', 'EDGE', 'LB', 'CB', 'S' ) as $slot ) {
	check( "footballguys: BUF has a $slot column", ! empty( $fbg['BUF'][ $slot ] ) );
}

$fp = SCDC_FantasyPros::parse_html( file_get_contents( "$src/fantasypros-buffalo-bills.html" ) );
check( 'fantasypros: the five position tables parse', array( 'QB', 'RB', 'WR', 'TE', 'K' ) === array_keys( $fp ), implode( ',', array_keys( $fp ) ) );
check( 'fantasypros: RB order and ids', isset( $fp['RB'][1] ) && 'James Cook III' === $fp['RB'][0]['name'] && '22958' === $fp['RB'][0]['id'] && 2 === $fp['RB'][1]['rank'] );
check( 'fantasypros: WR1 is DJ Moore', 'DJ Moore' === $first( $fp['WR'] ?? array() ) );

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
check( 'hub: popular views are fragments on the one address', false !== strpos( $hub, 'nfl-depth-charts/#fantasy/all-teams/rb' ) && false === strpos( $hub, 'nfl-depth-charts/fantasy/' ), $hub );

echo $GLOBALS['scdc_fail'] ? "\n{$GLOBALS['scdc_fail']} check(s) failed\n" : "\nall checks passed\n";
exit( $GLOBALS['scdc_fail'] ? 1 : 0 );
