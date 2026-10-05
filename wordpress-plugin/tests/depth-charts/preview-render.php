<?php
/**
 * Render one depth-chart URL for the Replit preview (/preview/depth-charts).
 *
 *   php preview-render.php <path> <basedir>
 *   e.g. php preview-render.php /nfl/nfl-depth-charts/fantasy/houston-texans/ data/depth-charts
 *
 * Runs the same request lifecycle as render-url.php (rewrite simulation,
 * parse_request -> wp -> template_redirect, the Rank Math filters, the H1
 * buffer) against the snapshot snapshot.php wrote, and prints one JSON object:
 *
 *   { status, redirect, title, description, heading, fragment }
 *
 * `heading` is the host page's H1 after the plugin's H1 rewrite, as markup;
 * `fragment` is the shortcode output. URLs are left as the plugin builds them
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

// wp_safe_redirect() in the stubs echoes; nothing but the JSON may reach stdout.
ob_start();
do_action( 'parse_request' );
do_action( 'wp' );
do_action( 'template_redirect' );
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
	// What Rank Math would print, through the plugin's filters.
	$out['title']       = apply_filters( 'rank_math/frontend/title', 'NFL Depth Charts for Fantasy Football | All 32 Teams' );
	$out['description'] = apply_filters( 'rank_math/frontend/description', 'Free NFL depth charts for all 32 teams, updated for fantasy football.' );

	// The theme's page-title H1 and the shortcode, through the H1 buffer, so
	// the page carries the one H1 the live site would.
	$split = '<!--scdc-preview-split-->';
	$body  = '<h1 class="hp-h1">' . esc_html( get_the_title( 42 ) ) . '</h1>' . $split
		. call_user_func( $GLOBALS['shortcodes']['statchasers_depth_charts'], array() );
	$body  = SCDC_SEO::rewrite_h1( $body );
	list( $out['heading'], $out['fragment'] ) = explode( $split, $body, 2 );
}

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
