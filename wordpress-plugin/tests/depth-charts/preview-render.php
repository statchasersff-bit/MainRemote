<?php
/**
 * Render one depth-chart URL for the Replit preview (/preview/depth-charts).
 *
 *   php preview-render.php <path> <basedir>
 *   e.g. php preview-render.php /nfl/nfl-depth-charts/fantasy/houston-texans/ data/depth-charts
 *
 * Runs the same request lifecycle as render-url.php (rewrite simulation,
 * parse_request -> wp -> template_redirect) against the snapshot snapshot.php
 * wrote, and prints one JSON object:
 *
 *   { status, redirect, title, description, heading, fragment }
 *
 * `heading` is the host page's H1, as markup; `fragment` is the shortcode
 * output. A pre-1.7.0 URL comes back as its 301. URLs are left as the plugin builds them
 * (https://statchasers.com/...) - the preview route maps them onto itself.
 */

require __DIR__ . '/wp-stubs.php';

$path    = isset( $argv[1] ) ? $argv[1] : '/nfl/nfl-depth-charts/';
$basedir = isset( $argv[2] ) ? rtrim( $argv[2], '/' ) : __DIR__ . '/fixtures';
$GLOBALS['scdc_test_basedir'] = $basedir;

$meta_file = $basedir . '/statchasers/meta.json';
if ( is_file( $meta_file ) ) {
	$GLOBALS['wp_options']['scdc_refresh_meta'] = json_decode( (string) file_get_contents( $meta_file ), true );
}

function get_category_by_slug( $slug ) { return false; }

$parts = explode( '?', $path, 2 );
$_SERVER['REQUEST_URI']    = $path;
$_SERVER['REQUEST_METHOD'] = 'GET';
if ( isset( $parts[1] ) ) { parse_str( $parts[1], $_GET ); }

// The rewrite rules: /nfl/nfl-depth-charts/{view}/{team}/{position}.
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

require __DIR__ . '/../../statchasers-depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

// Nothing but the JSON may reach stdout.
ob_start();
try {
	do_action( 'parse_request' );
	do_action( 'wp' );
	do_action( 'template_redirect' );
} catch ( SCDC_Test_Redirect $redirect ) {
	// Recorded in $GLOBALS['wp_redirect']; reported below.
}
ob_end_clean();

$out = array(
	'status'      => 200,
	'redirect'    => null,
	'title'       => '',
	'description' => '',
	'heading'     => '',
	'fragment'    => '',
);

if ( ! empty( $GLOBALS['wp_redirect'] ) ) {
	$out['status']   = (int) $GLOBALS['wp_redirect'][1];
	$out['redirect'] = $GLOBALS['wp_redirect'][0];
} elseif ( $canonical = apply_filters( 'redirect_canonical', false ) ) {
	$out['status']   = 301;
	$out['redirect'] = $canonical;
} elseif ( ! empty( $GLOBALS['wp_is_404'] ) ) {
	$out['status'] = 404;
} else {
	// The page's own title and H1: the plugin filters neither any more.
	$out['title']       = 'NFL Depth Charts for Fantasy Football | All 32 Teams';
	$out['description'] = 'Free NFL depth charts for all 32 teams, updated for fantasy football.';
	$out['heading']     = '<h1 class="hp-h1">' . esc_html( get_the_title( 42 ) ) . '</h1>';
	$out['fragment']    = call_user_func( $GLOBALS['shortcodes']['statchasers_depth_charts'], array() );
}

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
