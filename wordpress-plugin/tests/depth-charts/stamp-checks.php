<?php
/**
 * The hub's "updated" time (audit 3d.3). Exits non-zero on any failure.
 *
 *   php stamp-checks.php [outdir]
 *
 * - The time is read from the stored file, in Eastern time with DST handled,
 *   whatever the site's timezone setting; <time datetime> is UTC with Z.
 * - A missing or invalid time prints no line at all.
 * - A partial refresh keeps the kept team's own time and says "Latest team
 *   update"; a hard failure keeps the old file and so the old line.
 * - A second publication advances the lineup and the time together.
 *
 * With [outdir], the rendered HTML for each case is saved there as evidence.
 */

require __DIR__ . '/wp-stubs.php';

$GLOBALS['scdc_fail'] = 0;
function check( $label, $ok, $detail = '' ) {
	echo ( $ok ? 'ok    ' : 'FAIL  ' ) . $label . ( $ok || '' === $detail ? '' : "\n      $detail" ) . "\n";
	if ( ! $ok ) {
		$GLOBALS['scdc_fail']++;
	}
}

// ESPN answers for the slugs in http_espn_ok (an empty chart) or from a stored
// page in http_fixtures; everything else fails.
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
function wp_remote_post( $url, $args = array() ) { return array( 'code' => 200, 'body' => '{"ok":true}' ); }
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
function get_category_by_slug( $slug ) { return false; }

require __DIR__ . '/../../statchasers-news/depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

$outdir = isset( $argv[1] ) ? rtrim( $argv[1], '/' ) : '';
if ( '' !== $outdir && ! is_dir( $outdir ) ) {
	mkdir( $outdir, 0777, true );
}
function save_html( $name, $html ) {
	global $outdir;
	if ( '' !== $outdir ) {
		file_put_contents( "$outdir/$name.html", $html );
	}
}

// A fresh uploads dir per case; render the shortcode from whatever is there.
$GLOBALS['tmp_root'] = sys_get_temp_dir() . '/scdc-stamp-' . getmypid();
function use_dir( $name ) {
	$dir = $GLOBALS['tmp_root'] . '/' . $name;
	$GLOBALS['scdc_test_basedir'] = $dir;
	@mkdir( $dir . '/statchasers', 0777, true );
	$GLOBALS['wp_options']['scdc_refresh_meta'] = array();
	return $dir . '/statchasers/depth-charts.json';
}
function put_file( $path, $payload ) {
	file_put_contents( $path, is_string( $payload ) ? $payload : wp_json_encode( $payload ) );
	clearstatcache();
}
function render_hub() {
	return SCDC_Shortcode::instance()->render( array() );
}
function updated_line( $html ) {
	return preg_match( '#<p class="scdc-updated">.*?</p>#s', $html, $m ) ? $m[0] : '';
}
function team( $abbr, $name, $extra = array() ) {
	return array_merge( array( 'team' => array( 'abbr' => $abbr, 'name' => $name ) ), $extra, array( 'positions' => array( 'QB' => array( array( 'name' => "$abbr QB", 'rank' => 1 ) ) ) ) );
}

// ------------------------------------------------------------- 1. parse

check( 'parse: Z', 1795521600 === SCDC_Stamp::parse( '2026-11-24T12:00:00Z' ) );
check( 'parse: +00:00 (gmdate c)', 1795521600 === SCDC_Stamp::parse( '2026-11-24T12:00:00+00:00' ) );
check( 'parse: an offset is honored', 1795521600 === SCDC_Stamp::parse( '2026-11-24T07:00:00-05:00' ) );
check( 'parse: fractional seconds', 1795521600 === SCDC_Stamp::parse( '2026-11-24T12:00:00.000Z' ) );
foreach ( array( '', 'garbage', '2026-11-24', '2026-11-24 12:00:00', '2026-11-24T12:00:00', '2026-02-31T12:00:00Z', '1970-01-01T00:00:00Z', 1795521600, null, array() ) as $bad ) {
	check( 'parse: invalid ' . wp_json_encode( $bad ) . ' -> null', null === SCDC_Stamp::parse( $bad ) );
}

// ------------------------------------------------------- 2. format, DST

// The site's own timezone setting must not leak in.
$GLOBALS['wp_options']['timezone_string'] = 'America/Los_Angeles';
$GLOBALS['wp_options']['gmt_offset']      = -8;
$GLOBALS['wp_options']['date_format']     = 'd/m/Y';
$GLOBALS['wp_options']['time_format']     = 'H:i';
$dst = array(
	'2026-11-24T12:00:00Z' => 'Nov 24, 2026 at 7:00 AM ET',  // winter, EST (UTC-5)
	'2026-07-04T16:00:00Z' => 'Jul 4, 2026 at 12:00 PM ET',  // summer, EDT (UTC-4)
	'2026-03-08T06:59:00Z' => 'Mar 8, 2026 at 1:59 AM ET',   // last minute of EST
	'2026-03-08T07:00:00Z' => 'Mar 8, 2026 at 3:00 AM ET',   // first minute of EDT
	'2026-11-01T05:30:00Z' => 'Nov 1, 2026 at 1:30 AM ET',   // 1:30 EDT
	'2026-11-01T06:30:00Z' => 'Nov 1, 2026 at 1:30 AM ET',   // 1:30 EST, an hour later
	'2026-12-01T00:15:00Z' => 'Nov 30, 2026 at 7:15 PM ET',  // UTC date ahead of ET
);
foreach ( $dst as $iso => $want ) {
	$got = SCDC_Stamp::format( SCDC_Stamp::parse( $iso ) );
	check( "format: $iso -> $want", $want === $got, $got );
}
check( 'format: datetime is UTC with Z', '2026-07-04T16:00:00Z' === SCDC_Stamp::iso( SCDC_Stamp::parse( '2026-07-04T12:00:00-04:00' ) ) );

// ------------------------------------------------------ 3. rendered HTML

// Known time (a file written before teams carried their own: fetchedAt only).
$path = use_dir( 'known' );
put_file( $path, array( 'version' => 1, 'season' => 2026, 'fetchedAt' => '2026-11-24T12:00:00+00:00', 'teams' => array( team( 'HOU', 'Houston Texans' ) ) ) );
$GLOBALS['wp_options']['scdc_refresh_meta'] = array( 'status' => 'success', 'last_refreshed_ts' => 1795000000 );
$html = render_hub();
save_html( 'known', $html );
$want = '<p class="scdc-updated"><span class="scdc-updated-label">Depth charts updated</span> <time datetime="2026-11-24T12:00:00Z">Nov 24, 2026 at 7:00 AM ET</time></p>';
check( 'html known: the exact line', $want === updated_line( $html ), updated_line( $html ) );
check( 'html known: in the server HTML, above the tool root', strpos( $html, 'scdc-updated' ) < strpos( $html, 'class="scdc-root"' ) );
check( 'html known: read from the file, not the meta time', false === strpos( $html, '2026-11-18' ) );
check( 'html known: data-last-updated carries the same ET text', false !== strpos( $html, 'data-last-updated="Nov 24, 2026 at 7:00 AM ET"' ) );
$again = render_hub();
check( 'html known: a second page view prints the same line', updated_line( $html ) === updated_line( $again ) );
$GLOBALS['wp_options']['scdc_refresh_meta']['last_refreshed_ts'] = time();
check( 'html known: a meta change alone (no new file) does not move it', updated_line( $html ) === updated_line( render_hub() ) );

// The new fields take precedence over fetchedAt.
$path = use_dir( 'new-fields' );
put_file( $path, array( 'version' => 1, 'season' => 2026, 'fetchedAt' => '2026-11-24T12:01:30+00:00', 'updatedAt' => '2026-11-24T12:01:10+00:00', 'teamsKept' => array(), 'teams' => array( team( 'HOU', 'Houston Texans', array( 'updatedAt' => '2026-11-24T12:01:10+00:00' ) ) ) ) );
check( 'html new fields: updatedAt wins over fetchedAt', false !== strpos( updated_line( render_hub() ), 'datetime="2026-11-24T12:01:10Z"' ) );

// Top-level fields after "teams" (not the order run() writes): the full decode stands in.
$path = use_dir( 'reordered' );
put_file( $path, '{"teams":[],"fetchedAt":"2026-11-24T12:00:00Z"}' );
check( 'html reordered file: still found', false !== strpos( updated_line( render_hub() ), 'datetime="2026-11-24T12:00:00Z"' ) );

// Missing: no line, and no stray text anywhere.
$path = use_dir( 'missing' );
put_file( $path, array( 'version' => 1, 'season' => 2026, 'teams' => array( team( 'HOU', 'Houston Texans' ) ) ) );
$html = render_hub();
save_html( 'missing', $html );
check( 'html missing: no line', false === strpos( $html, 'scdc-updated' ) && false === strpos( $html, '<time' ) );
check( 'html missing: data-last-updated empty', false !== strpos( $html, 'data-last-updated=""' ) );

// Invalid values: treated exactly like missing.
foreach ( array( 'not a date', '2026-11-24 12:00:00', '2026-11-24T12:00:00', '' ) as $i => $bad ) {
	$path = use_dir( "invalid-$i" );
	put_file( $path, array( 'version' => 1, 'fetchedAt' => $bad, 'updatedAt' => $bad, 'teams' => array() ) );
	$html = render_hub();
	if ( 0 === $i ) {
		save_html( 'invalid', $html );
	}
	check( 'html invalid ' . wp_json_encode( $bad ) . ': no line', false === strpos( $html, 'scdc-updated' ) );
}

// No file at all: the fallback message, no line.
use_dir( 'none' );
$html = render_hub();
check( 'html no file: no line', false === strpos( $html, 'scdc-updated' ) && false !== strpos( $html, 'has not been refreshed yet' ) );

// ------------------------------------------- 4. refresh -> file -> line

// The previous file: ATL, ARI, BAL from an earlier refresh, written before
// teams carried their own time (fetchedAt only).
$path     = use_dir( 'partial' );
$t0       = '2026-11-20T11:00:00+00:00';
$previous = array(
	'version'   => 1,
	'season'    => 2026,
	'fetchedAt' => $t0,
	'teams'     => array( team( 'ARI', 'Arizona Cardinals' ), team( 'ATL', 'Atlanta Falcons' ), team( 'BAL', 'Baltimore Ravens' ) ),
);
put_file( $path, $previous );
$GLOBALS['wp_options']['scdc_refresh_meta'] = array( 'status' => 'success', 'last_refreshed' => $t0, 'last_refreshed_ts' => SCDC_Stamp::parse( $t0 ) );
$before_old = render_hub();
save_html( 'older-fallback-before', $before_old );

// Partial: ARI and BAL fetch, ATL fails and is kept.
$GLOBALS['http_espn_ok'] = array( 'ari', 'bal' );
$start  = time();
$status = SCDC_Refresh::run_and_store( 0 );
clearstatcache();
$file   = SCDC_Store::read();
$teams  = array();
foreach ( $file['teams'] as $t ) {
	$teams[ $t['team']['abbr'] ] = $t;
}
check( 'partial: status partial', 'partial' === $status, $status );
check( 'partial: the kept team keeps the old file\'s time', isset( $teams['ATL']['updatedAt'] ) && $t0 === $teams['ATL']['updatedAt'], wp_json_encode( $teams['ATL']['updatedAt'] ?? null ) );
check( 'partial: fetched teams carry this run\'s time', isset( $teams['ARI']['updatedAt'], $teams['BAL']['updatedAt'] ) && SCDC_Stamp::parse( $teams['ARI']['updatedAt'] ) >= $start && SCDC_Stamp::parse( $teams['BAL']['updatedAt'] ) >= $start );
check( 'partial: top-level updatedAt = newest team time', $file['updatedAt'] === max( $teams['ARI']['updatedAt'], $teams['BAL']['updatedAt'] ) );
check( 'partial: teamsKept names ATL', array( 'ATL' ) === $file['teamsKept'] );
check( 'partial: top-level fields precede teams', array( 'version', 'season', 'fetchedAt', 'updatedAt', 'teamsKept', 'teams' ) === array_keys( $file ), implode( ',', array_keys( $file ) ) );
$after_partial = render_hub();
save_html( 'older-fallback-partial', $after_partial );
check( 'partial: hub says "Latest team update"', false !== strpos( updated_line( $after_partial ), '>Latest team update<' ), updated_line( $after_partial ) );
check( 'partial: hub time is the newest team time', false !== strpos( updated_line( $after_partial ), 'datetime="' . SCDC_Stamp::iso( SCDC_Stamp::parse( $file['updatedAt'] ) ) . '"' ) );

// A second partial in which ATL fails again: its own updatedAt survives
// (not the newer file's fetchedAt).
$GLOBALS['http_espn_ok'] = array( 'ari' );
SCDC_Refresh::run_and_store( 0 );
clearstatcache();
$file2 = SCDC_Store::read();
foreach ( $file2['teams'] as $t ) {
	if ( 'ATL' === $t['team']['abbr'] ) {
		check( 'partial again: ATL still has its first time', $t0 === $t['updatedAt'], $t['updatedAt'] );
	}
	if ( 'BAL' === $t['team']['abbr'] ) {
		check( 'partial again: BAL keeps the time of the run that fetched it', $teams['BAL']['updatedAt'] === $t['updatedAt'] );
	}
}

// Hard failure: nothing fetched, the file and the line stay as they were.
$line_before = updated_line( render_hub() );
$raw_before  = file_get_contents( $path );
$GLOBALS['http_espn_ok'] = array();
$status = SCDC_Refresh::run_and_store( 0 );
clearstatcache();
$after_fail = render_hub();
save_html( 'older-fallback-hard-failure', $after_fail );
check( 'hard failure: status error', 'error' === $status, $status );
check( 'hard failure: the file is untouched', file_get_contents( $path ) === $raw_before );
check( 'hard failure: the line is unchanged', '' !== $line_before && $line_before === updated_line( $after_fail ), updated_line( $after_fail ) );

// A previous file whose kept team has neither its own time nor a fetchedAt: no time.
$path = use_dir( 'kept-unknown' );
put_file( $path, array( 'version' => 1, 'teams' => array( team( 'ATL', 'Atlanta Falcons' ) ) ) );
$GLOBALS['http_espn_ok'] = array( 'ari' );
SCDC_Refresh::run_and_store( 0 );
clearstatcache();
foreach ( SCDC_Store::read()['teams'] as $t ) {
	if ( 'ATL' === $t['team']['abbr'] ) {
		check( 'kept, no time known: no updatedAt invented', ! isset( $t['updatedAt'] ) );
	}
}

// -------------------------- 5. a second publication moves lineup and time

$path = use_dir( 'second-publication' );
$espn_buf = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/buf/depthcharts';

// Publication 1: BUF answers with an empty chart.
$GLOBALS['http_espn_ok']  = array( 'buf' );
$GLOBALS['http_fixtures'] = array();
SCDC_Refresh::run_and_store( 0 );
clearstatcache();
$pub1      = SCDC_Store::read();
$meta1     = SCDC_Store::get_meta();
$html1     = render_hub();
$line1     = updated_line( $html1 );
$buf_qb1   = $pub1['teams'][0]['positions']['QB'][0]['name'] ?? '';
save_html( 'second-publication-1', $html1 );

sleep( 2 );

// Publication 2: BUF answers with the stored page (Josh Allen at QB1).
$GLOBALS['http_espn_ok']  = array();
$GLOBALS['http_fixtures'] = array( $espn_buf => file_get_contents( __DIR__ . '/fixtures/sources/espn-buf.json' ) );
SCDC_Refresh::run_and_store( 0 );
clearstatcache();
$GLOBALS['http_fixtures'] = array();
$pub2    = SCDC_Store::read();
$meta2   = SCDC_Store::get_meta();
$html2   = render_hub();
$line2   = updated_line( $html2 );
$buf_qb2 = $pub2['teams'][0]['positions']['QB'][0]['name'] ?? '';
save_html( 'second-publication-2', $html2 );

preg_match( '#datetime="([^"]+)"#', $line1, $d1 );
preg_match( '#datetime="([^"]+)"#', $line2, $d2 );
check( 'second publication: the lineup changed', '' === $buf_qb1 && 'Josh Allen' === $buf_qb2, "'$buf_qb1' -> '$buf_qb2'" );
check( 'second publication: the displayed time advanced', isset( $d1[1], $d2[1] ) && $d2[1] > $d1[1], ( $d1[1] ?? '-' ) . ' -> ' . ( $d2[1] ?? '-' ) );
check( 'second publication: the line names the new file\'s time', isset( $d2[1] ) && SCDC_Stamp::iso( SCDC_Stamp::parse( $pub2['updatedAt'] ) ) === $d2[1] );
check( 'second publication: the endpoint version advanced too', $meta2['last_refreshed_ts'] > $meta1['last_refreshed_ts'] && false !== strpos( $html2, 'depth-charts.json?v=' . $meta2['last_refreshed_ts'] ) );
check( 'second publication: line and version from the same publication', abs( SCDC_Stamp::parse( $pub2['updatedAt'] ) - (int) $meta2['last_refreshed_ts'] ) <= 5 );

// --------------------------------------------------------------- cleanup

$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $GLOBALS['tmp_root'], FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST );
foreach ( $it as $f ) {
	$f->isDir() ? rmdir( $f->getPathname() ) : unlink( $f->getPathname() );
}
rmdir( $GLOBALS['tmp_root'] );

echo $GLOBALS['scdc_fail'] ? "\n{$GLOBALS['scdc_fail']} check(s) failed\n" : "\nall stamp checks passed\n";
exit( $GLOBALS['scdc_fail'] ? 1 : 0 );
