<?php
/**
 * Load the plugin with WordPress stubbed out, then check what it computes.
 *
 *     php wordpress-plugin/tests/smoke.php
 *
 * `php -l` proves a file parses. It does not prove the plugin LOADS: a function
 * declared twice across two files, a constant used before the file defining it
 * is required, a hook callback naming a function that does not exist — all of
 * those parse cleanly and fatal on activation, which on shared hosting is
 * discovered by a white screen.
 *
 * So this file defines just enough of the WordPress API for the plugin to be
 * included, includes it, and then calls the functions whose output is a string
 * somebody will read: the headings, the section metadata that must agree with
 * the API's, and the verdict logic that decides whether an H1 is printed.
 *
 * The stubs are deliberately dumb. This is not a WordPress test suite and it
 * cannot see a bug in how a filter interacts with a theme; it catches the class
 * of mistake that makes the plugin fail before any of that can happen.
 *
 * @package StatChasers\Tests
 */

define( 'ABSPATH', '/tmp/fake-wp/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );

$GLOBALS['hooks']   = array();
$GLOBALS['options'] = array();
$GLOBALS['query']   = array();

function add_action( $hook, $fn, $priority = 10, $args = 1 ) { $GLOBALS['hooks'][ $hook ][] = $fn; }
function add_filter( $hook, $fn, $priority = 10, $args = 1 ) { $GLOBALS['hooks'][ $hook ][] = $fn; }

/**
 * Really runs the callbacks, in registration order.
 *
 * A version that returned $value untouched was simpler and quietly useless:
 * the whole H1 decision is one filter calling another, so a stub that skips
 * the callbacks reports "prints nothing" for every configuration and agrees
 * with itself forever.
 */
function apply_filters( $hook, $value ) {
	$args = array_slice( func_get_args(), 2 );
	foreach ( (array) ( $GLOBALS['hooks'][ $hook ] ?? array() ) as $fn ) {
		$value = $fn( $value, ...$args );
	}
	return $value;
}
function add_shortcode( $tag, $fn ) {}
function register_activation_hook( $file, $fn ) {}
function register_deactivation_hook( $file, $fn ) {}
function add_management_page() {}
function get_option( $key, $default = false ) { return $GLOBALS['options'][ $key ] ?? $default; }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['options'][ $key ] = $value; }
function delete_option( $key ) { unset( $GLOBALS['options'][ $key ] ); }
function get_transient( $key ) { return false; }
function set_transient( $key, $value, $ttl ) {}
function delete_transient( $key ) {}
function get_query_var( $key ) { return $GLOBALS['query'][ $key ] ?? ''; }
function sanitize_title( $s ) { return strtolower( preg_replace( '/[^a-z0-9-]+/i', '-', (string) $s ) ); }
function sanitize_key( $s ) { return strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $s ) ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $s ) { return esc_html( $s ); }
function esc_url( $s ) { return (string) $s; }
function wp_strip_all_tags( $s ) { return strip_tags( (string) $s ); }
function wp_kses_post( $s ) { return (string) $s; }
function is_singular( $t = '' ) { return (bool) ( $GLOBALS['page']['singular'] ?? false ); }
function in_the_loop() { return (bool) ( $GLOBALS['page']['loop'] ?? false ); }
function is_main_query() { return (bool) ( $GLOBALS['page']['loop'] ?? false ); }
function get_queried_object() { return $GLOBALS['page']['post'] ?? null; }
function get_post() { return null; }
function has_shortcode( $content, $tag ) { return false !== strpos( (string) $content, '[' . $tag ); }
function current_user_can( $cap ) { return false; }
function wp_get_theme() { return new class { public function get( $k ) { return 'X'; } }; }
function get_stylesheet() { return 'theme'; }
function get_template() { return 'theme'; }
function human_time_diff( $t ) { return '1 minute'; }
function checked( $a, $b, $echo = true ) { return $a === $b ? ' checked' : ''; }
function wp_nonce_field( $a ) {}
function check_admin_referer( $a ) {}
function wp_safe_redirect( $u ) {}
function admin_url( $p = '' ) { return 'https://example.com/wp-admin/' . $p; }
function add_query_arg( $k, $v, $u ) { return $u . '?' . $k . '=' . $v; }
function get_permalink( $id ) { return 'https://example.com/p/' . $id . '/'; }
function get_post_status( $id ) { return 'publish'; }
function get_page_by_path( $p ) { return null; }
function get_page_uri( $id ) { return 'nfl'; }
function wp_insert_post( $a, $b = false ) { return 1; }
function wp_update_post( $a ) { return 1; }
function is_wp_error( $t ) { return false; }
function wp_remote_get( $u, $a = array() ) { return array(); }
function wp_remote_retrieve_body( $r ) { return ''; }
function wp_remote_retrieve_response_code( $r ) { return 200; }
function get_post_meta( $id, $k, $single = false ) { return ''; }
function update_post_meta( $id, $k, $v ) {}
function get_edit_post_link( $id ) { return ''; }
function get_current_screen() { return null; }
function wp_die( $m ) { throw new RuntimeException( $m ); }
function absint( $v ) { return abs( (int) $v ); }
function wp_unslash( $v ) { return $v; }
function ucwords_( $s ) { return ucwords( $s ); }
function statchasers_news_origin() { return 'https://api.example.com'; }
function statchasers_news_flush() {}
function statchasers_news_schema_page_id( $d ) { return ''; }
function statchasers_news_schema_node() { return array(); }
function wp_enqueue_script() {}
function wp_enqueue_style() {}
function wp_add_inline_style() {}
function wp_register_script() {}
function wp_register_style() {}
function plugin_dir_url( $f ) { return ''; }
function plugins_url( $p = '', $f = '' ) { return ''; }
function add_rewrite_rule() {}
function flush_rewrite_rules() {}
function home_url( $p = '' ) { return 'https://example.com' . $p; }
function trailingslashit( $s ) { return rtrim( (string) $s, '/' ) . '/'; }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/' ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_create_nonce( $a = '' ) { return 'nonce'; }
function check_ajax_referer( $a = '', $b = false, $c = true ) { return true; }
function wp_send_json_success( $d = null, $s = null ) {}
function wp_send_json_error( $d = null, $s = null ) {}
function wp_parse_args( $a, $b ) { return array_merge( $b, (array) $a ); }
function shortcode_atts( $pairs, $atts, $tag = '' ) { return array_merge( $pairs, (array) $atts ); }
function get_the_title( $id = 0 ) { return ''; }
function get_bloginfo( $k ) { return ''; }
function is_admin() { return (bool) ( $GLOBALS['page']['admin'] ?? false ); }
function did_action( $h ) { return 1; }
function do_action( $h ) {}
function wp_cache_get() { return false; }
function wp_cache_set() {}
function number_format_i18n( $n ) { return (string) $n; }
function size_format( $n ) { return (string) $n; }
function get_page_by_title() { return null; }
function wp_list_pluck( $a, $k ) { return array_column( $a, $k ); }
function _n( $s, $p, $n ) { return 1 === $n ? $s : $p; }
function __( $s, $d = '' ) { return $s; }
function esc_html__( $s, $d = '' ) { return $s; }
function wp_kses( $s, $a ) { return $s; }
function status_header() {}
function nocache_headers() {}
function is_page() { return false; }
function get_children() { return array(); }
function wp_remote_retrieve_header() { return ''; }
function wp_remote_post() { return array(); }
function set_url_scheme( $u ) { return $u; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function rawurlencode_( $s ) { return rawurlencode( $s ); }
function wp_safe_remote_get() { return array(); }
function media_sideload_image() { return ''; }
function wp_generate_attachment_metadata() { return array(); }
function set_post_thumbnail() {}
function wp_upload_dir() { return array(); }
function current_time( $t ) { return time(); }
function get_locale() { return 'en_US'; }
function wp_timezone() { return new DateTimeZone( 'UTC' ); }
function printf_( $s ) {}

class WP_Post { public $ID = 7; public $post_title = ''; public $post_content = ''; public $post_name = ''; }
class WP_Error {}
class WP_Query {}

$GLOBALS['wpdb'] = new class {
	public $posts = 'wp_posts';
	public $options = 'wp_options';
	public function prepare( $q, ...$a ) { return $q; }
	public function get_results( $q ) { return array(); }
	public function query( $q ) { return 0; }
	public function esc_like( $s ) { return $s; }
};

$dir = __DIR__ . '/../statchasers-news';

require_once "$dir/statchasers-team.php";
require_once "$dir/statchasers-team-pages.php";
require_once "$dir/statchasers-matchup.php";
require_once "$dir/statchasers-player.php";
require_once "$dir/statchasers-player-pages.php";
require_once "$dir/statchasers-h1.php";

echo "LOADED OK\n\n";

// ------------------------------------------------------------------ checks
$fail = 0;
function is( $got, $want, $label ) {
	global $fail;
	if ( $got === $want ) { printf( "  ok    %s\n", $label ); return; }
	$fail++;
	printf( "  FAIL  %s\n        got:  %s\n        want: %s\n", $label, var_export( $got, true ), var_export( $want, true ) );
}

echo "team headings\n";
is( statchasers_team_heading( 'new-england-patriots', '' ), 'New England Patriots Team Hub 2026', 'hub' );
is( statchasers_team_heading( 'new-england-patriots', 'news' ), 'New England Patriots News 2026', 'news' );
is( statchasers_team_heading( 'new-england-patriots', 'depth-chart' ), 'New England Patriots Depth Chart 2026', 'depth chart' );

echo "\nteam section meta mirrors the API\n";
$news = statchasers_team_section_meta( 'new-england-patriots', 'news' );
is( $news['title'], 'New England Patriots News 2026: Injuries, Roster Moves & Fantasy Impact', 'news title' );
is( in_array( 'news', STATCHASERS_TEAM_SECTIONS, true ), true, 'news is a public section' );
is( count( STATCHASERS_TEAM_SECTIONS ), 6, 'six sections' );

echo "\nurl switches default on\n";
is( statchasers_team_section_urls_enabled(), true, 'team sections' );
is( statchasers_player_section_urls_enabled(), true, 'player sections' );
is( statchasers_matchup_urls_enabled(), true, 'matchup pairs' );

echo "\nmatchup headings\n";
$GLOBALS['query']['sc_matchup'] = 'new-england-patriots-vs-philadelphia-eagles';
is( statchasers_matchup_heading(), 'New England Patriots vs Philadelphia Eagles', 'pair' );

echo "\nplayer meta mirrors the shell script\n";
$meta = statchasers_player_page_meta( array(
	'slug' => 'kyler-murray', 'name' => 'Kyler Murray', 'position' => 'QB',
	'team' => 'MIN', 'teamName' => 'Minnesota Vikings', 'id' => '1',
) );
is( $meta['title'], 'Kyler Murray Fantasy Football Stats & Analysis | StatChasers', 'title' );
is(
	$meta['description'],
	'Kyler Murray Minnesota Vikings quarterback fantasy football profile: 2026 game log, weekly finishes, advanced metrics, injury history and career production.',
	'description'
);

echo "\nH1 verdict logic\n";
is( statchasers_h1_normalise( "<span>New  England\nPatriots</span> " ), 'New England Patriots', 'normalise' );
is( statchasers_h1_should_print(), false, 'no verdict -> prints nothing' );

$GLOBALS['options'][ STATCHASERS_H1_OPTION ] = array(
	'fingerprint' => statchasers_h1_fingerprint(),
	'count' => 0, 'error' => '', 'matched' => false, 'texts' => array(), 'time' => time(), 'url' => 'u', 'theme' => 'T', 'expect' => '',
);
is( statchasers_h1_should_print(), true, 'no theme H1 -> prints one' );

$GLOBALS['options'][ STATCHASERS_H1_OPTION ]['count']   = 1;
$GLOBALS['options'][ STATCHASERS_H1_OPTION ]['matched'] = true;
is( statchasers_h1_should_print(), false, 'theme H1 matches -> prints none' );

$GLOBALS['options'][ STATCHASERS_H1_OPTION ]['matched'] = false;
is( statchasers_h1_should_print(), false, 'foreign H1 -> still prints none' );

$GLOBALS['options'][ STATCHASERS_H1_OPTION ]['fingerprint'] = 'a-different-theme';
is( statchasers_h1_should_print(), false, 'stale verdict is ignored' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
is( statchasers_h1_should_print(), true, 'forced on' );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'off';
is( statchasers_h1_should_print(), false, 'forced off' );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';

is( statchasers_h1_filter( true ), true, 'an explicit true wins' );

echo "\nreplace mode\n";
// A page that mounts the team shortcode, in the loop, on the front end.
$post = new WP_Post();
$post->post_content = '[statchasers_team]';
$post->post_name    = 'buffalo-bills';
$GLOBALS['page'] = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
is( statchasers_h1_should_print(), true, 'on: prints' );
is( statchasers_h1_should_replace(), false, 'on: leaves the theme title alone' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'replace';
is( statchasers_h1_should_print(), true, 'replace: prints' );
is( statchasers_h1_should_replace(), true, 'replace: empties the theme title' );
is( statchasers_h1_mounts_a_tool(), true, 'and only where a tool is mounted' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'off';
is( statchasers_h1_should_replace(), false, 'off: never' );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';
$GLOBALS['page'] = array();

echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
exit( $fail ? 1 : 0 );
