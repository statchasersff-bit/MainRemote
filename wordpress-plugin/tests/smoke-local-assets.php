<?php
/**
 * WEB-023: the team depth-chart route loads team.css and the team bundle, and
 * every FPA page loads fpa.css and the FPA bundle, from the WordPress origin
 * when the plugin carries the API's current build, and from the asset host
 * otherwise.
 *
 *     php wordpress-plugin/tests/smoke-local-assets.php
 *
 * Standalone, not a smoke.php group: the lockstep rule caches its verdicts in
 * transients and smoke.php's transient stubs forget everything, so this file
 * stubs the few WordPress functions statchasers-local-assets.php calls, with
 * transients that remember and an HTTP stub that answers per URL.
 *
 * @package StatChasers\Tests
 */

define( 'ABSPATH', '/tmp/fake-wp/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'WEEK_IN_SECONDS', 604800 );

$GLOBALS['hooks']      = array();
$GLOBALS['transients'] = array();
$GLOBALS['http']       = array(); // URL (without query) => array( code, body ).
$GLOBALS['fetched']    = array();

function add_filter( $hook, $fn, $priority = 10, $args = 1 ) { $GLOBALS['hooks'][ $hook ][] = $fn; }
function apply_filters( $hook, $value ) {
	foreach ( (array) ( $GLOBALS['hooks'][ $hook ] ?? array() ) as $fn ) {
		$value = $fn( $value );
	}
	return $value;
}
function get_transient( $key ) { return $GLOBALS['transients'][ $key ] ?? false; }
function set_transient( $key, $value, $ttl ) { $GLOBALS['transients'][ $key ] = $value; }
function is_wp_error( $t ) { return false; }
function wp_remote_get( $url, $args = array() ) {
	$GLOBALS['fetched'][] = $url;
	$bare                 = strtok( $url, '?' );
	return $GLOBALS['http'][ $bare ] ?? array( 404, '' );
}
function wp_remote_retrieve_response_code( $r ) { return $r[0]; }
function wp_remote_retrieve_body( $r ) { return $r[1]; }
function plugin_dir_url( $file ) { return 'https://statchasers.com/wp-content/plugins/statchasers-news/'; }
function statchasers_news_origin() { return 'https://api.example.com'; }
function statchasers_public_origin() { return 'https://news.statchasers.com'; }

$plugin = dirname( __DIR__ ) . '/statchasers-news';
require_once "$plugin/statchasers-local-assets.php";

$fail = 0;
function is( $got, $want, $label ) {
	global $fail;
	if ( $got === $want ) { printf( "  ok    %s\n", $label ); return; }
	$fail++;
	printf( "  FAIL  %s\n        got:  %s\n        want: %s\n", $label, var_export( $got, true ), var_export( $want, true ) );
}

// ---------------------------------------------------------------- fixture

$dir = sys_get_temp_dir() . '/sc-local-assets-' . getmypid();
@mkdir( "$dir/dist", 0777, true );
$css = '.sct-dc{overflow-x:auto}';
$js  = '(()=>{document.documentElement.dataset.t="1"})();';
file_put_contents( "$dir/team.css", $css );
file_put_contents( "$dir/dist/statchasers-team.js", $js );

/** Write a manifest for the fixture; $css_bytes lets a case lie about a size. */
function fixture_manifest( string $dir, string $version, ?int $css_bytes = null ): void {
	$css = (string) file_get_contents( "$dir/team.css" );
	$js  = (string) file_get_contents( "$dir/dist/statchasers-team.js" );
	file_put_contents(
		"$dir/manifest.json",
		json_encode(
			array(
				'version' => $version,
				'files'   => array(
					'/team.css'                 => array( 'sha256' => hash( 'sha256', $css ), 'bytes' => $css_bytes ?? strlen( $css ) ),
					'/dist/statchasers-team.js' => array( 'sha256' => hash( 'sha256', $js ), 'bytes' => strlen( $js ) ),
				),
			)
		)
	);
	statchasers_local_asset_manifest( true );
	$GLOBALS['transients'] = array();
	$GLOBALS['fetched']    = array();
}

add_filter( 'statchasers_local_asset_dir', static function () use ( $dir ) { return $dir; } );

$local_css  = 'https://statchasers.com/wp-content/plugins/statchasers-news/assets/api/team.css';
$local_js   = 'https://statchasers.com/wp-content/plugins/statchasers-news/assets/api/dist/statchasers-team.js';
$remote_css = 'https://news.statchasers.com/team.css';
$remote_js  = 'https://news.statchasers.com/dist/statchasers-team.js';

// ----------------------------------------------------------------- checks

echo "no bundled copy: everything stays on the asset host\n";
statchasers_local_asset_manifest( true );
$u = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( array( $u['css'], $u['js'] ), array( $remote_css, $remote_js ), 'depth chart without a manifest' );
is( $GLOBALS['fetched'], array(), 'and nothing is fetched to compare' );

echo "\nbundle is the API's current build\n";
fixture_manifest( $dir, 'abc123' );
$u = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( array( $u['css'], $u['js'] ), array( $local_css, $local_js ), 'depth chart loads both from the WordPress origin' );
is( array( $u['css_local'], $u['js_local'] ), array( true, true ), 'and says so' );
is( $GLOBALS['fetched'], array(), 'same version: no comparison fetch' );
foreach ( array( '', 'outlook', 'usage', 'coaching', 'stats', 'schedule', 'matchups', 'news' ) as $section ) {
	$u = statchasers_team_asset_urls( $section, 'abc123' );
	is( array( $u['css'], $u['js'] ), array( $remote_css, $remote_js ), "'" . ( '' === $section ? 'hub' : $section ) . "' keeps the asset host (out of scope)" );
}

echo "\nscope is one filter away\n";
$GLOBALS['hooks']['statchasers_local_asset_sections'][] = static function ( $s ) { $s[] = 'schedule'; return $s; };
$u = statchasers_team_asset_urls( 'schedule', 'abc123' );
is( $u['css'], $local_css, 'adding a section to statchasers_local_asset_sections serves it locally' );
unset( $GLOBALS['hooks']['statchasers_local_asset_sections'] );

echo "\nAPI redeployed, team files unchanged (byte-identical live copy)\n";
fixture_manifest( $dir, 'abc123' );
$GLOBALS['http'] = array(
	'https://api.example.com/team.css'                 => array( 200, $css ),
	'https://api.example.com/dist/statchasers-team.js' => array( 200, $js ),
);
$u = statchasers_team_asset_urls( 'depth-chart', 'def456' );
is( array( $u['css'], $u['js'] ), array( $local_css, $local_js ), 'local after the sha256 comparison' );
is( $GLOBALS['fetched'], array( 'https://api.example.com/team.css?ver=def456', 'https://api.example.com/dist/statchasers-team.js?ver=def456' ), 'compared against the fetch origin, once per file' );
$GLOBALS['fetched'] = array();
statchasers_team_asset_urls( 'depth-chart', 'def456' );
is( $GLOBALS['fetched'], array(), 'the match is cached for that version' );

echo "\nAPI redeployed with a changed team.css\n";
fixture_manifest( $dir, 'abc123' );
$GLOBALS['http']['https://api.example.com/team.css'] = array( 200, $css . '.x{}' );
$u = statchasers_team_asset_urls( 'depth-chart', 'ghi789' );
is( $u['css'], $remote_css, 'stylesheet falls back to the asset host' );
is( $u['js'], $local_js, 'the unchanged bundle stays local' );
$GLOBALS['fetched'] = array();
statchasers_team_asset_urls( 'depth-chart', 'ghi789' );
is( $GLOBALS['fetched'], array(), 'the mismatch is cached too (no fetch per page view)' );

echo "\nAPI unreachable from this server, versions differ\n";
fixture_manifest( $dir, 'abc123' );
$GLOBALS['http'] = array(
	'https://api.example.com/team.css'                 => array( 503, '' ),
	'https://api.example.com/dist/statchasers-team.js' => array( 503, '' ),
);
$u = statchasers_team_asset_urls( 'depth-chart', 'jkl012' );
is( array( $u['css'], $u['js'] ), array( $remote_css, $remote_js ), 'cannot compare: asset host, as before WEB-023' );

echo "\nAPI unreachable, but its last known version is the bundled one\n";
$GLOBALS['fetched'] = array();
$u = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( array( $u['css'], $u['js'] ), array( $local_css, $local_js ), 'local, with no fetch needed' );
is( $GLOBALS['fetched'], array(), 'no fetch' );

echo "\na truncated copy is never served\n";
fixture_manifest( $dir, 'abc123', strlen( $css ) + 1 );
$u = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( $u['css'], $remote_css, 'size disagrees with the manifest: asset host' );
is( $u['js'], $local_js, 'the intact bundle is still local' );

echo "\na missing file is never served\n";
fixture_manifest( $dir, 'abc123' );
unlink( "$dir/dist/statchasers-team.js" );
$u = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( $u['js'], $remote_js, 'missing bundle: asset host' );
file_put_contents( "$dir/dist/statchasers-team.js", $js );

echo "\nWP Rocket keeps its hands off the local copies\n";
$css_ex = apply_filters( 'rocket_exclude_css', array() );
is( in_array( '/assets/api/team.css', $css_ex, true ) && false !== strpos( $local_css, '/assets/api/team.css' ), true, 'minify exclusion matches the local stylesheet URL' );
is( in_array( '/assets/api/team.css', apply_filters( 'rocket_exclude_async_css', array() ), true ), true, 'async CSS exclusion too' );
// statchasers-team.php's delay-JS exclusion is the substring '/dist/statchasers-team.js'.
is( false !== strpos( $local_js, '/dist/statchasers-team.js' ), true, 'the existing delay-JS pattern matches the local bundle URL' );

echo "\nstatchasers-team.php registers what this file decides\n";
$team = (string) file_get_contents( "$plugin/statchasers-team.php" );
is( 1 === preg_match( "/wp_register_style\\(\\s*STATCHASERS_TEAM_HANDLE,\\s*\\\$urls\\['css'\\]/", $team ), true, 'style registered with $urls[css]' );
is( 1 === preg_match( "/wp_register_script\\(\\s*STATCHASERS_TEAM_HANDLE,\\s*\\\$urls\\['js'\\]/", $team ), true, 'script registered with $urls[js]' );
is( false !== strpos( $team, "statchasers_team_asset_urls(" ), true, 'urls come from statchasers_team_asset_urls()' );
is( false !== strpos( $team, "'/dist/statchasers-team.js'" ), true, 'delay-JS exclusion pattern unchanged' );

echo "\nFPA table: fpa.css and the FPA bundle (WEB-023, 2026-11-27)\n";
$fpa_css = '.scf-scroll{overflow-x:auto;max-width:100%}';
$fpa_js  = '(()=>{document.documentElement.dataset.f="1"})();';
file_put_contents( "$dir/fpa.css", $fpa_css );
file_put_contents( "$dir/dist/statchasers-fpa.js", $fpa_js );

/** A manifest naming all four bundled files, as build-zip.sh writes it. */
function fixture_manifest_all( string $dir, string $version ): void {
	$files = array();
	foreach ( array( '/team.css', '/dist/statchasers-team.js', '/fpa.css', '/dist/statchasers-fpa.js' ) as $path ) {
		$body           = (string) file_get_contents( $dir . $path );
		$files[ $path ] = array( 'sha256' => hash( 'sha256', $body ), 'bytes' => strlen( $body ) );
	}
	file_put_contents( "$dir/manifest.json", json_encode( array( 'version' => $version, 'files' => $files ) ) );
	statchasers_local_asset_manifest( true );
	$GLOBALS['transients'] = array();
	$GLOBALS['fetched']    = array();
}

$local_fpa_css  = 'https://statchasers.com/wp-content/plugins/statchasers-news/assets/api/fpa.css';
$local_fpa_js   = 'https://statchasers.com/wp-content/plugins/statchasers-news/assets/api/dist/statchasers-fpa.js';
$remote_fpa_css = 'https://news.statchasers.com/fpa.css';
$remote_fpa_js  = 'https://news.statchasers.com/dist/statchasers-fpa.js';

// A team-only manifest (a zip built before this change): FPA stays remote.
fixture_manifest( $dir, 'abc123' );
statchasers_local_asset_manifest( true );
$GLOBALS['transients'] = array();
$GLOBALS['fetched']    = array();
$u = statchasers_fpa_asset_urls( 'abc123' );
is( array( $u['css'], $u['js'] ), array( $remote_fpa_css, $remote_fpa_js ), 'manifest without the FPA files: asset host' );
is( $GLOBALS['fetched'], array(), 'and nothing is fetched to compare' );

fixture_manifest_all( $dir, 'abc123' );
$u = statchasers_fpa_asset_urls( 'abc123' );
is( array( $u['css'], $u['js'] ), array( $local_fpa_css, $local_fpa_js ), 'manifest version matches: both from the WordPress origin' );
is( array( $u['css_local'], $u['js_local'] ), array( true, true ), 'and says so' );
is( $GLOBALS['fetched'], array(), 'same version: no comparison fetch' );
$t = statchasers_team_asset_urls( 'depth-chart', 'abc123' );
is( array( $t['css'], $t['js'] ), array( $local_css, $local_js ), 'the team depth chart still local from the same manifest' );
$t = statchasers_team_asset_urls( 'outlook', 'abc123' );
is( array( $t['css'], $t['js'] ), array( $remote_css, $remote_js ), 'and the team tabs out of scope still remote (FPA scope does not leak)' );

$GLOBALS['hooks']['statchasers_fpa_local_assets'][] = static function () { return false; };
$u = statchasers_fpa_asset_urls( 'abc123' );
is( array( $u['css'], $u['js'] ), array( $remote_fpa_css, $remote_fpa_js ), 'statchasers_fpa_local_assets=false: asset host' );
unset( $GLOBALS['hooks']['statchasers_fpa_local_assets'] );

fixture_manifest_all( $dir, 'abc123' );
$GLOBALS['http'] = array(
	'https://api.example.com/fpa.css'                 => array( 200, $fpa_css ),
	'https://api.example.com/dist/statchasers-fpa.js' => array( 200, $fpa_js . '/*changed*/' ),
);
$u = statchasers_fpa_asset_urls( 'zzz999' );
is( $u['css'], $local_fpa_css, 'API redeployed, fpa.css byte-identical: stays local' );
is( $u['js'], $remote_fpa_js, 'API redeployed, FPA bundle changed: asset host' );
is( $GLOBALS['fetched'], array( 'https://api.example.com/fpa.css?ver=zzz999', 'https://api.example.com/dist/statchasers-fpa.js?ver=zzz999' ), 'compared against the fetch origin' );

fixture_manifest_all( $dir, 'abc123' );
$GLOBALS['http'] = array();
$u = statchasers_fpa_asset_urls( 'zzz999' );
is( array( $u['css'], $u['js'] ), array( $remote_fpa_css, $remote_fpa_js ), 'versions differ and the API cannot be compared: asset host' );

fixture_manifest_all( $dir, 'abc123' );
file_put_contents( "$dir/fpa.css", $fpa_css . '/*x*/' );
$u = statchasers_fpa_asset_urls( 'abc123' );
is( $u['css'], $remote_fpa_css, 'an fpa.css whose size disagrees with the manifest is never served' );
file_put_contents( "$dir/fpa.css", $fpa_css );

echo "\nWP Rocket and the tag attributes cover the local FPA URLs\n";
foreach ( array( 'rocket_exclude_css', 'rocket_exclude_async_css', 'rocket_rucss_excluded_stylesheets' ) as $hook ) {
	$ex = apply_filters( $hook, array() );
	is( in_array( '/assets/api/fpa.css', $ex, true ) && in_array( '/assets/api/team.css', $ex, true ), true, "$hook names fpa.css and team.css" );
}
is( false !== strpos( $local_fpa_css, '/assets/api/fpa.css' ), true, 'the exclusion matches the local stylesheet URL' );
if ( ! function_exists( 'wp_parse_url' ) ) {
	function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
}
if ( ! function_exists( 'statchasers_perf_script_tag' ) ) {
	require_once "$plugin/statchasers-perf.php";
}
$tag = statchasers_perf_script_tag( "<script id=\"statchasers-fpa-js\" defer src=\"$local_fpa_js?ver=abc123\"></script>", 'statchasers-fpa', "$local_fpa_js?ver=abc123" );
is( false !== strpos( $tag, ' nowprocket ' ) && false !== strpos( $tag, 'data-no-optimize="1"' ) && false !== strpos( $tag, ' defer ' ), true, 'local FPA bundle tag keeps defer + nowprocket/no-optimize' );
is( in_array( '/dist/statchasers-', apply_filters( 'rocket_delay_js_exclusions', array() ), true ) && false !== strpos( $local_fpa_js, '/dist/statchasers-' ), true, 'Delay JS exclusion matches the local bundle URL' );

echo "\nstatchasers-fpa.php registers what this file decides\n";
$fpa = (string) file_get_contents( "$plugin/statchasers-fpa.php" );
is( false !== strpos( $fpa, '$urls = statchasers_fpa_asset_urls( $version );' ), true, 'urls come from statchasers_fpa_asset_urls()' );
is( 1 === preg_match( "/wp_register_style\\(\\s*STATCHASERS_FPA_HANDLE,\\s*\\\$urls\\['css'\\],\\s*statchasers_font_dependency\\(\\)/", $fpa ), true, 'style registered with $urls[css], font dependency kept' );
is( 1 === preg_match( "/wp_register_script\\(\\s*STATCHASERS_FPA_HANDLE,\\s*\\\$urls\\['js'\\],.*?'strategy'\\s*=>\\s*'defer'/s", $fpa ), true, 'script registered with $urls[js], still deferred' );
is( false === strpos( $fpa, "statchasers_public_origin() . '/fpa.css'" ) && false === strpos( $fpa, "statchasers_public_origin() . '/dist/statchasers-fpa.js'" ), true, 'no hard-coded asset-host URL left (no duplicate external load)' );
is( false !== strpos( $fpa, 'wp_add_inline_style( STATCHASERS_FPA_HANDLE' ), true, 'inline styles still ride on the handle' );

echo "\nthe bundled copy in this tree, if build-zip.sh has staged one\n";
$real = "$plugin/assets/api";
if ( is_file( "$real/manifest.json" ) ) {
	$m = json_decode( (string) file_get_contents( "$real/manifest.json" ), true );
	foreach ( (array) ( $m['files'] ?? array() ) as $path => $entry ) {
		$body = is_file( $real . $path ) ? (string) file_get_contents( $real . $path ) : '';
		is( hash( 'sha256', $body ), $entry['sha256'], "staged $path matches its manifest hash" );
	}
} else {
	echo "  skip  (no assets/api/manifest.json; build-zip.sh stages it)\n";
}

// ---------------------------------------------------------------- cleanup
@unlink( "$dir/fpa.css" );
@unlink( "$dir/dist/statchasers-fpa.js" );
@unlink( "$dir/team.css" );
@unlink( "$dir/dist/statchasers-team.js" );
@unlink( "$dir/manifest.json" );
@rmdir( "$dir/dist" );
@rmdir( $dir );

echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
exit( $fail ? 1 : 0 );
