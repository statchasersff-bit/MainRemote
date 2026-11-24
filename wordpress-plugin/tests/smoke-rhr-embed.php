<?php
/**
 * Smoke test for the Rookie Hit Rates tool page 1319 uses, [rookie_hit_rates]
 * (wordpress-plugin/statchasers-news/rookie-hit-rates, the former standalone
 * iframe plugin).
 *
 *   php wordpress-plugin/tests/smoke-rhr-embed.php
 *
 * Stubs the handful of WordPress functions the plugin calls, renders the
 * shortcode, and checks the server-rendered summary against the JSON the
 * build wrote: methodology, a real table with column and row headers, every
 * row's numbers, the noscript fallback, and the fail-closed paths (stale CSV,
 * missing file, summary="0").
 */

define( 'ABSPATH', __DIR__ . '/' );

$GLOBALS['shortcodes'] = array();
function add_shortcode( $tag, $cb ) { $GLOBALS['shortcodes'][ $tag ] = $cb; }
$GLOBALS['actions'] = array();
function add_action( $hook, $cb, $prio = 10 ) { $GLOBALS['actions'][ $hook ][] = array( $cb, $prio ); }
function trailingslashit( $s ) { return rtrim( $s, '/' ) . '/'; }
function plugins_url( $path, $file ) { return 'https://statchasers.com/wp-content/plugins/' . basename( dirname( $file ) ) . '/' . $path; }
function plugin_dir_path( $file ) { return $GLOBALS['rhr_plugin_dir'] ?? trailingslashit( dirname( $file ) ); }
function esc_url( $s ) { return $s; }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function wp_generate_uuid4() { return '00000000-0000-4000-8000-000000000000'; }
function shortcode_atts( $pairs, $atts, $tag = '' ) {
	$atts = (array) $atts;
	$out  = array();
	foreach ( $pairs as $k => $v ) {
		$out[ $k ] = array_key_exists( $k, $atts ) ? $atts[ $k ] : $v;
	}
	return $out;
}

$plugin = dirname( __DIR__ ) . '/statchasers-news/rookie-hit-rates';
require $plugin . '/rookie-hit-rates.php';
// Registered on init (priority 20), not at load: nothing yet, then run init.
$registered_at_load = isset( $GLOBALS['shortcodes']['rookie_hit_rates'] );
foreach ( $GLOBALS['actions']['init'] ?? array() as $a ) { if ( 20 === $a[1] ) { call_user_func( $a[0] ); } }

$ok = 0;
$fail = 0;
function check( $cond, $label ) {
	global $ok, $fail;
	if ( $cond ) {
		$ok++;
	} else {
		$fail++;
		fwrite( STDERR, "FAIL $label\n" );
	}
}

$json = json_decode( file_get_contents( $plugin . '/summary/hit-rates-summary.json' ), true );
check( is_array( $json ), 'summary json parses' );

// Both shortcode names still render the embed.
check( ! $registered_at_load && isset( $GLOBALS['shortcodes']['rookie_hit_rates'] ), '[rookie_hit_rates] registered on init 20' );
check( ! isset( $GLOBALS['shortcodes']['statchasers_rookie_hit_rates'] ), 'no alias over the port shortcode' );
check( ! function_exists( 'scff_rhr_shortcode' ), 'no standalone function names (would fatal next to the standalone plugin)' );

$html = call_user_func( $GLOBALS['shortcodes']['rookie_hit_rates'], array() );

// The iframe is unchanged.
check( 1 === substr_count( $html, '<iframe class="rhr-embed-frame"' ), 'one iframe' );
check( false !== strpos( $html, 'src="https://statchasers.com/wp-content/plugins/rookie-hit-rates/app/index.html"' ), 'iframe src' );
check( false !== strpos( $html, 'style="width:100%;height:1400px;border:0;display:block;overflow:hidden;"' ), 'iframe style unchanged' );
check( strpos( $html, '<iframe' ) < strpos( $html, '<section class="rhr-summary"' ), 'summary after the tool' );

// Headings: one H2, no H1.
check( 0 === preg_match( '/<h1\b/', $html ), 'no h1 in shortcode output' );
check( 1 === preg_match_all( '/<h2\b/', $html ), 'one h2' );
check( false !== strpos( $html, '>How We Count a Hit</h2>' ), 'h2 text' );

// Methodology states the definition from the JSON settings.
$text = html_entity_decode( strip_tags( preg_replace( '~<(style|script)\b[^>]*>.*?</\1>~s', '', $html ) ), ENT_QUOTES );
check( false !== strpos( $text, 'finishes Top-12 or better at his position in at least one season, from his rookie year through 2025' ), 'hit threshold + window' );
check( false !== strpos( $text, 'at least 8 games' ), 'min games' );
check( false !== strpos( $text, 'regular-season PPR fantasy points' ), 'rank basis' );
check( false !== strpos( $text, 'rounds 1 to 5 of Superflex PPR dynasty rookie drafts by rookie ADP, 2017 to 2025 classes: 530 rookies' ), 'sample' );
check( false !== strpos( $text, '2024 (2 seasons) and 2025 (1 season) so far' ), 'incomplete classes named' );
check( false !== strpos( $text, 'including ' . $json['rookies_without_seasons'] . ' with no season on record' ), 'missing outcomes counted as misses' );
check( false !== strpos( $text, 'Overview tab, Superflex, PPR, Top-12, seasons 2017 to 2025, rounds 1 to 5, minimum 8 games' ), 'default settings to reproduce' );
check( false === strpos( $html, "\u{2014}" ), 'no em dash' );

// A semantic table: caption, column headers, row headers, every row's numbers.
check( 1 === substr_count( $html, '<table class="rhr-summary__table">' ), 'one table' );
check( false !== strpos( $html, '<thead><tr><th scope="col">Position</th><th scope="col">Hits</th><th scope="col">Rookies</th><th scope="col">Hit rate</th></tr></thead>' ), 'column headers' );
check( false !== strpos( $html, '<caption>Top-12 hit rate by position, Superflex PPR, 2017 to 2025 classes</caption>' ), 'caption' );
foreach ( array_merge( $json['rows'], array( $json['total'] ) ) as $row ) {
	$want = '<tr><th scope="row">' . $row['group'] . '</th><td>' . $row['hits'] . '</td><td>' . $row['total'] . '</td><td>' . $row['rate_display'] . '</td></tr>';
	check( false !== strpos( $html, $want ), 'row ' . $row['group'] );
}
// The rows are the tool's: the JSON was checked against the tool separately,
// these pin the values the 2026-11-24 reconciliation saw.
check( false !== strpos( $html, '<th scope="row">TE</th><td>23</td><td>72</td><td>31.9%</td>' ), 'TE row value' );
check( false !== strpos( $html, '<th scope="row">All positions</th><td>104</td><td>530</td><td>19.6%</td>' ), 'total row value' );
$sum_hits  = array_sum( array_column( $json['rows'], 'hits' ) );
$sum_total = array_sum( array_column( $json['rows'], 'total' ) );
check( $sum_hits === $json['total']['hits'] && $sum_total === $json['total']['total'], 'rows add up to the total' );

// The resize listener is kept out of WP Rocket's Delay JS.
check( false !== strpos( $html, '<script data-no-optimize="1" data-noptimize="1" data-no-defer="1" data-cfasync="false" nowprocket>(function(){window.addEventListener("message"' ), 'listener not delayed' );

// Without JavaScript the iframe hides and the summary stays.
check( false !== strpos( $html, '<noscript><style>.rhr-embed-wrap{display:none!important}</style></noscript>' ), 'noscript hides iframe' );

// summary="0" prints the plain embed.
$plain = call_user_func( $GLOBALS['shortcodes']['rookie_hit_rates'], array( 'summary' => '0' ) );
check( false === strpos( $plain, 'rhr-summary' ) && false !== strpos( $plain, '<iframe' ), 'summary="0"' );

// Fail closed: a CSV that is not the one the summary came from.
$tmp = sys_get_temp_dir() . '/rhr-smoke-' . getmypid() . '/';
@mkdir( $tmp . 'app/data', 0777, true );
@mkdir( $tmp . 'summary', 0777, true );
copy( $plugin . '/summary/hit-rates-summary.json', $tmp . 'summary/hit-rates-summary.json' );
copy( $plugin . '/app/data/rookie_drafts.csv', $tmp . 'app/data/rookie_drafts.csv' );
file_put_contents( $tmp . 'app/data/season_finishes.csv', file_get_contents( $plugin . '/app/data/season_finishes.csv' ) . "x\n" );

$child = function ( $dir ) use ( $plugin ) {
	// The summary is memoised per process, so each case runs in its own.
	$code = 'define("ABSPATH","/");$GLOBALS["rhr_plugin_dir"]=' . var_export( $dir, true ) . ';'
		. 'function add_shortcode($t,$c){} function add_action($h,$c,$p=10){} function trailingslashit($s){return rtrim($s,"/")."/";}'
		. 'function plugins_url($p,$f){return "u/".$p;} function plugin_dir_path($f){return $GLOBALS["rhr_plugin_dir"];}'
		. 'function esc_url($s){return $s;} function esc_attr($s){return $s;} function esc_html($s){return $s;}'
		. 'require ' . var_export( $plugin . '/rookie-hit-rates.php', true ) . ';'
		. 'echo statchasers_rhr_embed_summary_html(1380);';
	return (string) shell_exec( escapeshellarg( PHP_BINARY ) . ' -r ' . escapeshellarg( $code ) );
};
check( '' === $child( $tmp ), 'stale CSV prints no summary' );
copy( $plugin . '/app/data/season_finishes.csv', $tmp . 'app/data/season_finishes.csv' );
check( false !== strpos( $child( $tmp ), '<table class="rhr-summary__table">' ), 'matching CSVs print the summary' );
unlink( $tmp . 'summary/hit-rates-summary.json' );
check( '' === $child( $tmp ), 'missing summary prints nothing' );
array_map( 'unlink', glob( $tmp . 'app/data/*' ) );
@rmdir( $tmp . 'app/data' );
@rmdir( $tmp . 'app' );
@rmdir( $tmp . 'summary' );
@rmdir( $tmp );

printf( "smoke-rhr-embed: %d ok, %d failed\n", $ok, $fail );
exit( $fail ? 1 : 0 );
