<?php
/**
 * Test harness: boots the plugin against the WordPress shims and simulates a
 * request, printing what a browser/Googlebot would receive.
 *
 * Usage: php render-url.php <path> [body]
 *   e.g. php render-url.php /nfl/nfl-depth-charts/fantasy/houston-texans/   (a 301)
 *        php render-url.php /nfl/nfl-depth-charts/ body                      (the markup)
 */

require __DIR__ . '/wp-stubs.php';

$path  = isset( $argv[1] ) ? $argv[1] : '/nfl/nfl-depth-charts/';
$parts = explode( '?', $path, 2 );
$only  = isset( $argv[2] ) ? $argv[2] : '';

$_SERVER['REQUEST_URI']    = $path;
$_SERVER['REQUEST_METHOD'] = 'GET';
if ( isset( $parts[1] ) ) { parse_str( $parts[1], $_GET ); }

// --- Simulate the rewrite rules: /nfl/nfl-depth-charts/{view}/{team}/{pos} ---
$request = trim( (string) parse_url( $parts[0], PHP_URL_PATH ), '/' );
$base    = 'nfl/nfl-depth-charts';
if ( $request === $base || 0 === strpos( $request, $base . '/' ) ) {
	$GLOBALS['wp_is_page']    = true;
	$GLOBALS['wp_queried_id'] = 42;
	$rest = trim( substr( $request, strlen( $base ) ), '/' );
	$segs = '' === $rest ? array() : explode( '/', $rest );
	if ( isset( $segs[0] ) ) { $GLOBALS['wp_query_vars']['sc_view'] = $segs[0]; }
	if ( isset( $segs[1] ) ) { $GLOBALS['wp_query_vars']['sc_team'] = $segs[1]; }
	if ( isset( $segs[2] ) ) { $GLOBALS['wp_query_vars']['sc_position'] = $segs[2]; }
}

require __DIR__ . '/../../statchasers-news/depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

// --- The request lifecycle WordPress would run ---
try {
	do_action( 'parse_request' );
	do_action( 'wp' );                     // routing: 404s + the pre-1.7.0 301s
	do_action( 'template_redirect' );      // nothing of ours runs here any more
} catch ( SCDC_Test_Redirect $redirect ) {
	// Recorded in $GLOBALS['wp_redirect']; reported below.
}

$route = SCDC_Route::get();
$team  = SCDC_Route::team();

echo "REQUEST  {$path}\n";
echo str_repeat( '=', 78 ) . "\n";

if ( ! empty( $GLOBALS['wp_redirect'] ) ) {
	echo "HTTP {$GLOBALS['wp_redirect'][1]} redirect -> {$GLOBALS['wp_redirect'][0]}\n";
	echo "Route type               : {$route['type']} ({$route['reason']})\n";
	echo 'Named team               : ' . ( $team ? $team['name'] . ' [' . $team['abbr'] . ']' : '-' ) . "\n";
	exit;
}

// WordPress's own canonical-redirect pass (redirect_canonical filter) - the
// plugin no longer touches it, so a missing trailing slash is WordPress's call.
$canonical_redirect = apply_filters( 'redirect_canonical', false );
if ( $canonical_redirect ) {
	echo "HTTP 301 redirect (URL normalization) -> {$canonical_redirect}\n";
	exit;
}

$status = ! empty( $GLOBALS['wp_is_404'] ) ? 404 : 200;
echo "HTTP status              : {$status}" . ( 404 === $status ? "  (404 template, nocache headers)" : '' ) . "\n";
echo "Route type               : {$route['type']} ({$route['reason']})\n";
echo "Season                   : " . SCDC_Teams::season() . "\n";

if ( 404 === $status ) {
	echo "\nNot one of the recognised view/team/position slugs.\n";
	exit;
}

// --- The head is the page's own: the plugin registers no title, description,
// canonical, robots, breadcrumb, schema or Open Graph filter any more. ---
foreach ( array( 'rank_math/frontend/title', 'rank_math/frontend/canonical', 'rank_math/json_ld', 'rank_math/sitemap/index', 'rank_math/sitemap/entry', 'the_title', 'template_redirect' ) as $hook ) {
	if ( ! empty( $GLOBALS['wp_filters'][ $hook ] ) ) {
		echo "UNEXPECTED: a callback is hooked to {$hook}\n";
	}
}

// --- Rendered body (theme title + shortcode) ---
$body  = "<body>\n<header><a class=\"logo\">StatChasers</a></header>\n";
$body .= '<h1 class="entry-title">' . get_the_title( 42 ) . "</h1>\n";
$body .= call_user_func( $GLOBALS['shortcodes']['statchasers_depth_charts'], array() );
$body .= "\n</body>";

preg_match_all( '#<h1\b[^>]*>(.*?)</h1>#is', $body, $h1s );
echo "\n--- H1 elements in the initial HTML (" . count( $h1s[0] ) . ") ---\n";
foreach ( $h1s[0] as $h1 ) { echo $h1 . "\n"; }

if ( 'body' === $only ) {
	echo "\n--- Server-rendered tool markup ---\n" . $body . "\n";
	exit;
}

preg_match_all( '#<a\s[^>]*data-scdc-team-link[^>]*>#i', $body, $links );
echo "\nCrawlable team anchors   : " . count( $links[0] ) . " (must be 0 since 1.7.0)\n";
preg_match_all( '#<a\s[^>]*href="([^"]*)"#i', $body, $hrefs );
echo 'Anchors in the markup    : ' . count( $hrefs[1] ) . ( $hrefs[1] ? ' (' . implode( ', ', $hrefs[1] ) . ')' : '' ) . "\n";
if ( preg_match( '#<div class="scdc-page"#', $body ) ) { echo "Page wrapper             : .scdc-page (no team class)\n"; }
if ( preg_match( '#data-endpoint="([^"]*)"#', $body, $m ) ) { echo 'Data endpoint            : ' . $m[1] . "\n"; }
