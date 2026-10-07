<?php
/**
 * Load the plugin with WordPress stubbed out, then check what it computes.
 *
 *     php wordpress-plugin/tests/smoke.php
 *
 * `php -l` proves a file parses. It does not prove the plugin LOADS: a function
 * declared twice across two files, a constant used before the file defining it
 * is required, a hook callback naming a function that does not exist - all of
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
// Divi's own accessor. statchasers_team_is_divi() keys off its existence, and
// statchasers_team_content_width() reads the Customizer's content width from
// it. $GLOBALS['et_options'] left unset is a site that has never touched the
// setting, which is the case the fallback is for.
function et_get_option( $key, $default = false ) { return $GLOBALS['et_options'][ $key ] ?? $default; }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['options'][ $key ] = $value; }
function delete_option( $key ) { unset( $GLOBALS['options'][ $key ] ); }
function get_transient( $key ) { return false; }
function set_transient( $key, $value, $ttl ) {}
function delete_transient( $key ) {}
function get_query_var( $key ) { return $GLOBALS['query'][ $key ] ?? ''; }
function sanitize_title( $s ) { return strtolower( preg_replace( '/[^a-z0-9-]+/i', '-', (string) $s ) ); }
function sanitize_key( $s ) { return strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $s ) { return esc_html( $s ); }
function esc_url( $s ) { return (string) $s; }
function wp_strip_all_tags( $s ) { return strip_tags( (string) $s ); }
function wp_kses_post( $s ) { return (string) $s; }
function is_singular( $t = '' ) { return (bool) ( $GLOBALS['page']['singular'] ?? false ); }
function in_the_loop() { return (bool) ( $GLOBALS['page']['loop'] ?? false ); }
function is_main_query() { return (bool) ( $GLOBALS['page']['loop'] ?? false ); }
function get_queried_object() { return $GLOBALS['page']['post'] ?? null; }
function get_post( $id = null ) {
	// By id when the test has built a page tree; otherwise the page being
	// rendered, which is what every other caller in the plugin means.
	if ( null !== $id && isset( $GLOBALS['pages'][ (int) $id ] ) ) {
		return $GLOBALS['pages'][ (int) $id ];
	}
	return $GLOBALS['page']['current'] ?? null;
}
function get_queried_object_id() { $o = get_queried_object(); return $o instanceof WP_Post ? (int) $o->ID : 0; }
/*
 * Tag boundaries matter here, unlike most of these stubs. WordPress matches a
 * whole registered tag; a strpos for "[statchasers_team" also finds
 * "[statchasers_team_index", which would make an index page answer yes to "is
 * this a team hub" - the exact confusion the two predicates exist to avoid. A
 * stub that cannot tell them apart cannot test them apart.
 */
function has_shortcode( $content, $tag ) {
	return 1 === preg_match( '/\[' . preg_quote( (string) $tag, '/' ) . '(?=[\s\]\/])/', (string) $content );
}
function current_user_can( $cap ) { return false; }
function wp_get_theme() { return new class { public function get( $k ) { return 'X'; } }; }
function get_stylesheet() { return 'theme'; }
function get_template() { return 'theme'; }
function human_time_diff( $t ) { return '1 minute'; }
function checked( $a, $b, $echo = true ) { return $a === $b ? ' checked' : ''; }
function wp_nonce_field( $a ) {}
// Container bodies, keyed by post id. statchasers_index_state() reads them.
function get_post_field( $field, $id = 0 ) { return $GLOBALS['post_content_by_id'][ (int) $id ] ?? ''; }
function delete_post_meta( $id, $key ) { $GLOBALS['deleted_meta'][] = $key; return true; }
function check_admin_referer( $a ) {}
function wp_safe_redirect( $u ) {}
function admin_url( $p = '' ) { return 'https://example.com/wp-admin/' . $p; }
function add_query_arg( ...$a ) {
	// Both of WordPress's forms: (array $args, $url) and ($key, $value, $url).
	return is_array( $a[0] ) ? $a[1] . '?' . http_build_query( $a[0] ) : $a[2] . '?' . $a[0] . '=' . $a[1];
}
function get_permalink( $id ) { return 'https://example.com/p/' . $id . '/'; }
function get_post_status( $id ) { return 'publish'; }
if ( ! function_exists( 'get_post_modified_time' ) ) { function get_post_modified_time( $f = '', $g = false, $id = 0 ) { return '2026-09-24T00:00:00+00:00'; } }
function get_page_by_path( $p ) { return $GLOBALS['pages_by_path'][ $p ] ?? null; }
function get_page_uri( $id ) { return 'nfl'; }
/*
 * A page tree, for the handful of tests that need one: $GLOBALS['pages'] maps
 * id => WP_Post, and the three functions below read and write it. Left unset,
 * they behave exactly as the flat stubs they replaced, so no other test sees a
 * difference.
 *
 * statchasers_team_find_page() matches on slug AND parent, which is the whole
 * point of it - so a stub that ignores post_parent would let a page built in
 * the wrong container pass for one built in the right one. That is the bug
 * these exist to catch.
 */
function get_posts( $args = array() ) {
	if ( ! isset( $GLOBALS['pages'] ) ) {
		return array();
	}
	// A meta lookup (the old-slug redirect) matches nothing: no page here has
	// an old slug. A query with no name lists every child, as WordPress does.
	if ( isset( $args['meta_key'] ) ) {
		return array();
	}
	$any    = ! array_key_exists( 'name', $args );
	$name   = (string) ( $args['name'] ?? '' );
	$parent = (int) ( $args['post_parent'] ?? 0 );
	$found  = array();
	foreach ( $GLOBALS['pages'] as $id => $post ) {
		if ( ( $any || $post->post_name === $name ) && (int) $post->post_parent === $parent ) {
			$found[] = 'ids' === ( $args['fields'] ?? '' ) ? (int) $id : $post;
		}
	}
	$limit = (int) ( $args['numberposts'] ?? 1 );
	return $limit < 0 ? $found : array_slice( $found, 0, max( 1, $limit ) );
}

function wp_insert_post( $a, $b = false ) {
	if ( ! isset( $GLOBALS['pages'] ) ) {
		return 1;
	}
	$id                 = max( array_keys( $GLOBALS['pages'] ) + array( 0 ) ) + 1;
	$post               = new WP_Post();
	$post->ID           = $id;
	$post->post_name    = (string) ( $a['post_name'] ?? '' );
	$post->post_title   = (string) ( $a['post_title'] ?? '' );
	$post->post_content = (string) ( $a['post_content'] ?? '' );
	$post->post_parent  = (int) ( $a['post_parent'] ?? 0 );
	$post->post_status  = (string) ( $a['post_status'] ?? 'publish' );
	$GLOBALS['pages'][ $id ] = $post;
	return $id;
}

function wp_update_post( $a, $b = false ) {
	if ( ! isset( $GLOBALS['pages'] ) ) {
		return 1;
	}
	$id = (int) ( $a['ID'] ?? 0 );
	if ( ! isset( $GLOBALS['pages'][ $id ] ) ) {
		return 0;
	}
	foreach ( array( 'post_name', 'post_parent', 'post_title', 'post_content', 'post_status' ) as $field ) {
		if ( isset( $a[ $field ] ) ) {
			$GLOBALS['pages'][ $id ]->$field = 'post_parent' === $field ? (int) $a[ $field ] : $a[ $field ];
		}
	}
	return $id;
}
function is_wp_error( $t ) { return false; }
// The URL is kept so a test can see what the plugin asked the API for.
function wp_remote_get( $u, $a = array() ) { $GLOBALS['remote_urls'][] = $u; return array(); }
function wp_remote_retrieve_body( $r ) { return $GLOBALS['http_body'] ?? ''; }
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
function statchasers_news_asset_version() { return '1'; }
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
function user_trailingslashit( $s ) { return trailingslashit( $s ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_create_nonce( $a = '' ) { return 'nonce'; }
function wp_style_is( $h, $l = 'enqueued' ) { return (bool) ( $GLOBALS['styles'][ $h ] ?? false ); }
function wp_script_is( $h, $l = 'enqueued' ) { return false; }
function check_ajax_referer( $a = '', $b = false, $c = true ) { return true; }
function wp_send_json_success( $d = null, $s = null ) {}
function wp_send_json_error( $d = null, $s = null ) {}
function wp_parse_args( $a, $b ) { return array_merge( $b, (array) $a ); }
function shortcode_atts( $pairs, $atts, $tag = '' ) { return array_merge( $pairs, (array) $atts ); }
/*
 * WordPress's own two, reduced.
 *
 * statchasers_schedule_mounted_atts() reads the schedule shortcode's
 * attributes off the post that is about to render, so the group numbering has
 * to match the real get_shortcode_regex(): 2 is the tag and 3 is the attribute
 * string. A stub that returned its own numbering would pass while production
 * read the wrong group.
 */
function get_shortcode_regex( $tagnames = null ) {
	$tagregexp = join( '|', array_map( 'preg_quote', (array) $tagnames ) );
	return '\\[(\\[?)(' . $tagregexp . ')(?![\\w-])([^\\]\\/]*(?:\\/(?!\\])[^\\]\\/]*)*?)(?:(\\/)\\]|\\](?:([^\\[]*(?:\\[(?!\\/\\2\\])[^\\[]*)*)\\[\\/\\2\\])?)(\\]?)';
}
function shortcode_parse_atts( $text ) {
	$atts    = array();
	$pattern = '/([\\w-]+)\\s*=\\s*"([^"]*)"(?:\\s|$)|([\\w-]+)\\s*=\\s*\'([^\']*)\'(?:\\s|$)|([\\w-]+)\\s*=\\s*([^\\s\'"]+)(?:\\s|$)|"([^"]*)"(?:\\s|$)|(\\S+)(?:\\s|$)/';
	$text    = preg_replace( "/[\x{00a0}\x{200b}]+/u", ' ', (string) $text );
	if ( preg_match_all( $pattern, $text, $match, PREG_SET_ORDER ) ) {
		foreach ( $match as $m ) {
			if ( ! empty( $m[1] ) ) {
				$atts[ strtolower( $m[1] ) ] = stripcslashes( $m[2] );
			} elseif ( ! empty( $m[3] ) ) {
				$atts[ strtolower( $m[3] ) ] = stripcslashes( $m[4] );
			} elseif ( ! empty( $m[5] ) ) {
				$atts[ strtolower( $m[5] ) ] = stripcslashes( $m[6] );
			} elseif ( isset( $m[7] ) && strlen( $m[7] ) ) {
				$atts[] = stripcslashes( $m[7] );
			} elseif ( isset( $m[8] ) && strlen( $m[8] ) ) {
				$atts[] = stripcslashes( $m[8] );
			}
		}
	}
	return $atts;
}
function get_the_title( $id = 0 ) { return ''; }
// Which hook is running. statchasers_h1_filter() reads it to know which page
// type is asking, so the tests set it directly.
function current_filter() { return $GLOBALS['current_filter'] ?? ''; }
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
// Headers by lower-case name, for the tests that read what the API sent.
function wp_remote_retrieve_header( $r = null, $name = '' ) { return $GLOBALS['http_headers'][ $name ] ?? ''; }
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

class WP_Post { public $ID = 7; public $post_title = ''; public $post_content = ''; public $post_name = ''; public $post_type = 'page'; public $post_parent = 0; public $post_status = 'publish'; }
class WP_Error {}
class WP_Query {}

$GLOBALS['wpdb'] = new class {
	public $posts = 'wp_posts';
	public $options = 'wp_options';
	public function prepare( $q, ...$a ) { return $q; }
	public function get_results( $q ) { return array(); }
	public function get_col( $q ) { return array(); }
	public function query( $q ) { return 0; }
	public function esc_like( $s ) { return $s; }
};

$dir = __DIR__ . '/../statchasers-news';

require_once "$dir/statchasers-assets.php";
require_once "$dir/statchasers-team.php";
require_once "$dir/statchasers-team-pages.php";
require_once "$dir/statchasers-matchup.php";
require_once "$dir/statchasers-player.php";
require_once "$dir/statchasers-player-pages.php";
require_once "$dir/statchasers-h1.php";
// Loaded for the FAQ island round trips below; those are the only parts of
// these two files the smoke tests reach into.
require_once "$dir/statchasers-fpa.php";
require_once "$dir/statchasers-schedule.php";
require_once "$dir/statchasers-player-stats.php";
require_once "$dir/statchasers-rb-handcuffs.php";
require_once "$dir/statchasers-sos.php";
require_once "$dir/statchasers-rookie-hit-rates.php";
// And for its position URLs, near the bottom.
require_once "$dir/statchasers-rankings.php";
// The key header and the browser proxy's allowlist, against the stubbed
// statchasers_news_origin() above (https://api.example.com).
define( 'STATCHASERS_EMBED_KEY', 'smoke-key' );
require_once "$dir/statchasers-proxy.php";

echo "LOADED OK\n\n";

// ------------------------------------------------------------------ checks
$fail = 0;
/** The slash-separated path of a page in the test tree, walking its parents. */
function statchasers_matchup_holder_path( int $id ): string {
	$parts = array();
	while ( $id && isset( $GLOBALS['pages'][ $id ] ) ) {
		array_unshift( $parts, $GLOBALS['pages'][ $id ]->post_name );
		$id = (int) $GLOBALS['pages'][ $id ]->post_parent;
	}
	return implode( '/', $parts );
}

function is( $got, $want, $label ) {
	global $fail;
	if ( $got === $want ) { printf( "  ok    %s\n", $label ); return; }
	$fail++;
	printf( "  FAIL  %s\n        got:  %s\n        want: %s\n", $label, var_export( $got, true ), var_export( $want, true ) );
}

/*
 * Two groups, two processes.
 *
 * Several predicates memoise their answer in a `static` - which is right in
 * WordPress, where a request renders one page and a Divi template asks the same
 * question hundreds of times, and which means a process can only ever see ONE
 * answer from each of them. `statchasers_team_post_has_index_shortcode()` is
 * asked whether a page carrying the mount is an index (yes) and whether a bare
 * container is (no), and those are two requests, not two calls.
 *
 * So the container checks run in a child of this process, which loads the
 * plugin again with the statics unset. `main` runs everything else and then
 * spawns `containers` at the bottom.
 */
$group = getenv( 'STATCHASERS_SMOKE_GROUP' ) ?: 'main';

if ( 'main' === $group ) {
	echo "embed key + proxy\n";
	$with = statchasers_add_embed_key( array( 'headers' => array( 'Accept' => 'text/html' ) ), 'https://api.example.com/embed/player/x' );
	is( $with['headers']['X-StatChasers-Key'] ?? null, 'smoke-key', 'a request to the app carries the key' );
	is( $with['headers']['Accept'], 'text/html', 'and keeps its own headers' );
	$other = statchasers_add_embed_key( array(), 'https://api.example.com.attacker.net/embed/players.json' );
	is( isset( $other['headers']['X-StatChasers-Key'] ), false, 'a look-alike host never gets the key' );
	$third = statchasers_add_embed_key( array(), 'https://api.sleeper.app/v1/players' );
	is( isset( $third['headers']['X-StatChasers-Key'] ), false, 'another service never gets the key' );
	foreach ( array( 'embed/fpa', 'embed/player-stats', 'embed/sos', 'embed/rookie-hit-rates/data', 'embed/rb-handcuffs/player/4034', 'api/news' ) as $ok_path ) {
		is( statchasers_proxy_allowed( $ok_path ), true, "proxy forwards $ok_path" );
	}
	foreach ( array( 'embed/players.json', 'embed/player/jacoby-brissett', 'player/x', 'embed/rb-handcuffs/player/../../x', 'embed/sos/x', 'embed/sos.csv', 'embed/rookie-hit-rates', 'embed/rookie-hit-rates/data/x', 'api/x/accounts', '' ) as $no_path ) {
		is( statchasers_proxy_allowed( $no_path ), false, "proxy refuses '$no_path'" );
	}
	echo "\n";
}

if ( 'containers' === $group ) {
	require __DIR__ . '/smoke-containers.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'sos' === $group || 'sosleak' === $group ) {
	require __DIR__ . '/smoke-sos.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'rhr' === $group || 'rhrleak' === $group ) {
	require __DIR__ . '/smoke-rhr.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'leak' === $group || 'headings' === $group ) {
	require __DIR__ . '/smoke-headings.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'playersection' === $group ) {
	require __DIR__ . '/smoke-player-section.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'week' === $group ) {
	require __DIR__ . '/smoke-week.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'rules' === $group ) {
	require __DIR__ . '/smoke-rules.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'playerlinks' === $group ) {
	require __DIR__ . '/smoke-player-links.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

if ( 'weekstray' === $group ) {
	require __DIR__ . '/smoke-week-stray.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
}

echo "team headings\n";
is( statchasers_team_heading( 'new-england-patriots', '' ), 'New England Patriots Fantasy Football Outlook & Stats 2026', 'hub' );
is( statchasers_team_heading( 'new-england-patriots', 'outlook' ), 'New England Patriots Fantasy Football Outlook & Stats 2026', 'outlook is the hub' );
is( statchasers_team_heading( 'new-england-patriots', 'news' ), 'New England Patriots News 2026', 'news' );
is( statchasers_team_heading( 'new-england-patriots', 'depth-chart' ), 'New England Patriots Depth Chart 2026', 'depth chart' );

echo "\nteam section meta mirrors the API\n";
$news = statchasers_team_section_meta( 'new-england-patriots', 'news' );
is( $news['title'], 'New England Patriots News 2026: Injuries, Roster Moves & Fantasy Impact', 'news title' );
is( in_array( 'news', STATCHASERS_TEAM_SECTIONS, true ), true, 'news is a public section' );
is( count( STATCHASERS_TEAM_SECTIONS ), 7, 'seven sections' );
is( statchasers_team_heading( 'new-england-patriots', 'usage' ), 'New England Patriots Usage & Opportunity Report 2026', 'usage' );
is( statchasers_team_section_meta( 'new-england-patriots', 'usage' )['title'], 'New England Patriots Target Share & Snap Counts 2026: Usage Report', 'usage title' );

echo "\nurl switches default on\n";
is( statchasers_team_section_urls_enabled(), true, 'team sections' );
is( statchasers_player_section_urls_enabled(), true, 'player sections' );
is( statchasers_matchup_urls_enabled(), true, 'matchup pairs' );

echo "\nmatchup headings\n";
$GLOBALS['query']['sc_matchup'] = 'new-england-patriots-vs-philadelphia-eagles';
is( statchasers_matchup_heading(), 'New England Patriots vs Philadelphia Eagles', 'pair' );

echo "\nmatchup recap: description, share image and video from the API\n";
$GLOBALS['query']['sc_matchup']      = 'arizona-cardinals-vs-los-angeles-rams';
$GLOBALS['query']['sc_matchup_game'] = '2021-wild-card';
$GLOBALS['http_body']    = '<div>page</div><script type="application/json" class="sct-matchup-video-data">{"@type":"VideoObject","name":"Highlights","thumbnailUrl":"https://i.ytimg.com/vi/x/hqdefault.jpg","uploadDate":"2022-01-18"}</script>';
$GLOBALS['http_headers'] = array(
	'x-matchup-description' => rawurlencode( 'Rams beat the Cardinals 34–11 at SoFi Stadium.' ),
	'x-matchup-image'       => '/og/arizona-cardinals-vs-los-angeles-rams-2021-wild-card.png',
	'x-matchup-image-alt'   => rawurlencode( 'Final score: Los Angeles Rams 34, Arizona Cardinals 11, 2021 Wild Card.' ),
);
$share = statchasers_matchup_share_image();
is( $share['url'] ?? '', 'https://api.example.com/og/arizona-cardinals-vs-los-angeles-rams-2021-wild-card.png', 'the image is absolute, on the API origin' );
is( array( $share['width'] ?? 0, $share['height'] ?? 0 ), array( 1200, 630 ), 'at 1200 x 630' );
is( $share['alt'] ?? '', 'Final score: Los Angeles Rams 34, Arizona Cardinals 11, 2021 Wild Card.', 'with its alt text' );
is( statchasers_matchup_request_meta()['description'] ?? '', 'Rams beat the Cardinals 34–11 at SoFi Stadium.', "the API's description wins" );
is( statchasers_matchup_video_node()['@type'] ?? '', 'VideoObject', 'the video island becomes a node' );
is( false !== strpos( statchasers_matchup_strip_event_data( $GLOBALS['http_body'] ), 'sct-matchup-video-data' ), false, 'and leaves the printed page' );
$GLOBALS['http_headers']['x-matchup-image'] = 'https://evil.example/x.png';
is( statchasers_matchup_share_image(), null, 'only an /og/ path is taken' );
unset( $GLOBALS['query']['sc_matchup_game'] );
$GLOBALS['http_headers'] = array();
$GLOBALS['http_body']    = '';

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

/*
 * The mode where the tool supplies the page heading.
 *
 * The player fragment already prints "<player> Stats 2026" with the gold rule
 * under it; on a section address the theme prints the same phrase above it and
 * the reader gets it twice. This empties the theme's title and asks the API for
 * the promoted markup, so the heading on screen IS the page's H1.
 */
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
is( statchasers_h1_tool_supplies_heading(), true, 'tool: the fragment owns the heading' );
is( statchasers_h1_should_print(), false, 'tool: the plugin prints nothing of its own' );
is( statchasers_h1_should_print( 'player' ), false, 'tool: and nothing on player pages either' );
is( statchasers_h1_should_replace(), true, "tool: the theme's title is emptied" );

// It must not depend on a verdict: the whole point is that the answer is known.
unset( $GLOBALS['options'][ STATCHASERS_H1_OPTION ] );
is( statchasers_h1_should_replace(), true, 'tool: and it needs no measurement' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';
is( statchasers_h1_tool_supplies_heading(), false, 'any other mode leaves it to the host' );

/*
 * The check is asked per page type.
 *
 * The bug this covers shipped: one measurement taken on a team hub answered for
 * player pages too, so a site whose hub title comes from a builder layout (no
 * H1) and whose player pages come from page.php (one H1) printed a second H1 on
 * every player page - on the setting whose whole job is to prevent that.
 */
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';
$GLOBALS['options'][ STATCHASERS_H1_OPTION ]      = array(
	'fingerprint' => statchasers_h1_fingerprint(),
	'count' => 0, 'error' => '', 'matched' => false, 'texts' => array(),
	'time' => time(), 'url' => 'u', 'theme' => 'T', 'expect' => '',
	'tools' => array(
		// The hub prints no title of its own; the player page prints one.
		'team'   => array( 'count' => 0, 'error' => '', 'matched' => false, 'texts' => array(), 'url' => 'u', 'expect' => '' ),
		'player' => array( 'count' => 1, 'error' => '', 'matched' => true,  'texts' => array( 'Jacoby Brissett' ), 'url' => 'p', 'expect' => '' ),
	),
);

is( statchasers_h1_should_print( 'team' ), true, 'the hub has no theme H1 -> prints one' );
is( statchasers_h1_should_print( 'player' ), false, 'the player page already has one -> prints none' );

$GLOBALS['current_filter'] = 'statchasers_team_shortcode_h1';
is( statchasers_h1_filter( false ), true, 'and the hub filter says so' );
$GLOBALS['current_filter'] = 'statchasers_player_shortcode_h1';
is( statchasers_h1_filter( false ), false, 'and the player filter says so' );

// A tool with no measurement of its own gets no answer rather than the hub's.
$GLOBALS['current_filter'] = 'statchasers_matchup_shortcode_h1';
is( statchasers_h1_filter( false ), false, 'an unmeasured page type prints nothing' );

// A verdict stored before this split still answers for the hub it was taken on.
$GLOBALS['options'][ STATCHASERS_H1_OPTION ] = array(
	'fingerprint' => statchasers_h1_fingerprint(),
	'count' => 0, 'error' => '', 'matched' => false, 'texts' => array(),
	'time' => time(), 'url' => 'u', 'theme' => 'T', 'expect' => '',
);
is( statchasers_h1_should_print( 'team' ), true, 'an old verdict still speaks for the hub' );
is( statchasers_h1_should_print( 'player' ), false, 'but not for anything else' );
$GLOBALS['current_filter'] = '';

echo "\nindex container state\n";
/*
 * The state the rebuild button reads.
 *
 * The button exists because the write used to be reachable only from the page
 * build, which is only offered while pages are missing - so a container still
 * carrying the old wall of links on a complete site had no way to be fixed.
 * These are the five answers it distinguishes; only `empty` and `stub` are
 * written, and `custom` is the one that must never be.
 */
$lead  = STATCHASERS_TEAM_INDEX_LEAD;
$stub2 = '<p>' . $lead . '</p>';
for ( $i = 0; $i < 32; $i++ ) {
	$stub2 .= '<li><a href="/' . STATCHASERS_TEAM_PATH . '/team-' . $i . '/">Team</a></li>';
}

$GLOBALS['post_content_by_id'] = array(
	1 => $stub2,
	2 => '',
	3 => '<p>' . $lead . "</p>\n\n[" . STATCHASERS_TEAM_INDEX_SHORTCODE . ']',
	4 => '<p>My own words about the teams.</p>',
);

$state = static function ( int $id ): string {
	return statchasers_index_state( $id, STATCHASERS_TEAM_INDEX_SHORTCODE, 'statchasers_team_index_is_stub' );
};

is( $state( 1 ), 'stub', 'the old 32-link body is the stub' );
is( $state( 2 ), 'empty', 'an empty body is empty' );
is( $state( 3 ), 'mounted', 'a body carrying the shortcode is mounted' );
is( $state( 4 ), 'custom', "somebody's own page is theirs" );
is( $state( 0 ), 'missing', 'no container at all' );

/*
 * The link count survives a block editor.
 *
 * The published /nfl/teams/ is edited in WonderBlocks, which rewrote the
 * build script's root-relative hrefs to absolute ones on save. The old test
 * looked for the literal `href="/nfl/teams/` and so counted zero, the page
 * reported as hand-written, and the rebuild button never offered to touch the
 * one container that needed it.
 */
$absolute = '<p>' . $lead . '</p>';
for ( $i = 0; $i < 32; $i++ ) {
	$absolute .= '<li><a href="https://statchasers.com/' . STATCHASERS_TEAM_PATH . '/team-' . $i . '/">Team</a></li>';
}
is( statchasers_team_index_is_stub( $absolute ), true, 'absolute hrefs are still the stub' );

$single = str_replace( '"', "'", $absolute );
is( statchasers_team_index_is_stub( $single ), true, 'single-quoted hrefs too' );

is( statchasers_index_link_count( $absolute, STATCHASERS_TEAM_PATH ), 32, 'and all 32 are counted' );

// The guard that matters is still a shortcode, not any bracket at all.
is(
	statchasers_team_index_is_stub( $stub2 . '<p>see [1] above</p>' ),
	true,
	'a bracket in prose is not a mount'
);
is(
	statchasers_team_index_is_stub( $stub2 . '[contact_form]' ),
	false,
	'but a real shortcode still stops it'
);

/*
 * A page builder's wrapper is packaging, not a mount.
 *
 * Opening the generated stub in Divi wraps the same words in [et_pb_section]
 * and friends. Reading that as "somebody arranged this page" is what left
 * /nfl/teams/ alone through three releases - and it is the same wrapper that
 * put the grid in the footer, because the_content appends after the closing
 * [/et_pb_section], below every section the builder laid out.
 */
$wrapped = '[et_pb_section][et_pb_row][et_pb_column][et_pb_text]' . $stub2 . '[/et_pb_text][/et_pb_column][/et_pb_row][/et_pb_section]';

is( statchasers_index_is_builder_content( $wrapped ), true, 'the body is inside a builder wrapper' );
is( statchasers_index_has_shortcode( $wrapped ), false, 'and the wrapper is not somebody\'s mount' );
is( statchasers_team_index_is_stub( $wrapped ), true, 'so a builder-wrapped stub is still the stub' );

// A real mount inside a builder wrapper is still a real mount.
$wrapped_mount = '[et_pb_section][et_pb_text]' . $stub2 . '[contact_form][/et_pb_text][/et_pb_section]';
is( statchasers_index_has_shortcode( $wrapped_mount ), true, 'a real shortcode inside a wrapper still counts' );
is( statchasers_team_index_is_stub( $wrapped_mount ), false, 'and still stops the rewrite' );

is(
	statchasers_index_shortcode_tags( $wrapped ),
	array( 'et_pb_section', 'et_pb_row', 'et_pb_column', 'et_pb_text' ),
	'the tags are named for the screen'
);

echo "\nwebfont\n";
is( str_contains( statchasers_font_url(), 'family=Inter' ), true, 'Inter is the family asked for' );
is( str_contains( statchasers_font_url(), 'wght@400;500;600;700;800&' ), true, 'at five weights, 400 to 800' );
is( str_contains( statchasers_font_url(), '900' ), false, 'and never 900' );
is( statchasers_font_dependency(), array( STATCHASERS_FONT_HANDLE ), 'every stylesheet depends on it' );
is( str_contains( statchasers_matchup_font_url(), 'family=Barlow' ), true, 'Barlow is the display family' );
is( statchasers_display_font_dependency(), array( STATCHASERS_DISPLAY_FONT_HANDLE ), 'the hub stylesheet depends on it' );
is( str_contains( statchasers_player_header_font_url(), 'family=Archivo' ), true, 'Archivo is the player header face' );
is( str_contains( statchasers_schedule_font_url(), 'family=DM+Sans' ), true, 'DM Sans + Space Grotesk are the schedule faces' );
// OMGF self-hosts every one of these on the live site, so the plugin prints no
// preconnect to Google's hosts - the matchup-only hint and the shared one that
// briefly replaced it are both gone.
is( function_exists( 'statchasers_matchup_resource_hints' ), false, 'no matchup-only preconnect' );
is( function_exists( 'statchasers_fonts_resource_hints' ), false, 'no shared preconnect either' );

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

/*
 * The emptied title leaves the source, not just the screen.
 *
 * An SEO audit read View Source on /nfl/players/josh-allen/ and found Divi's
 * `<h1 class="entry-title main_title"></h1>` - the :empty rule hid it from
 * readers and from nobody else. The buffer runs from loop_start to the first
 * the_content, which is exactly the span page.php prints the title in.
 */
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
$main  = new class { public function is_main_query() { return true; } };
$other = new class { public function is_main_query() { return false; } };

ob_start();
statchasers_h1_husk_open( $other );
echo '<h1 class="entry-title main_title"></h1>';
statchasers_h1_husk_close();
is( ob_get_clean(), '<h1 class="entry-title main_title"></h1>', 'husk: a secondary loop is left alone' );

ob_start();
statchasers_h1_husk_open( $main );
echo "<article id=\"post-7\"><h1 class=\"entry-title main_title\"></h1>\n\t<div class=\"entry-content\">";
apply_filters( 'the_content', '' );
echo '<h1 class="scp-title">Josh Allen</h1></div></article>';
$printed = ob_get_clean();
is( substr_count( $printed, '<h1' ), 1, 'husk: the page source carries one H1' );
is( false !== strpos( $printed, '<h1 class="scp-title">Josh Allen</h1>' ), true, "husk: and it is the tool's" );
is( false !== strpos( $printed, '<article id="post-7"><div class="entry-content">' ), true, 'husk: the rest of the markup is untouched' );

// Once per request: a second loop does not reopen it.
ob_start();
statchasers_h1_husk_open( $main );
echo '<h1 class="entry-title"></h1>';
statchasers_h1_husk_close();
is( ob_get_clean(), '<h1 class="entry-title"></h1>', 'husk: the buffer opens once' );

is( statchasers_h1_strip_husk( '<h1 class="entry-title main_title">Josh Allen</h1>' ), '<h1 class="entry-title main_title">Josh Allen</h1>', 'husk: a title with words in it is never removed' );

/*
 * Every profile address has an H1 naming the player and the page's intent. The
 * profile's was the bare name, the same words as the hero. The Overview has no
 * heading of its own any more: /overview/ 301s to the profile.
 */
$allen             = new WP_Post();
$allen->ID         = 71;
$allen->post_name  = 'josh-allen-h1-test';
$allen->post_title = 'Josh Allen (QB)';
$GLOBALS['page']   = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $allen );
is( statchasers_player_heading( 'josh-allen-h1-test', '' ), 'Josh Allen Fantasy Football Stats & Analysis', 'player H1: the profile names its intent' );
is( statchasers_player_heading( 'josh-allen-h1-test', 'stats' ), 'Josh Allen Stats ' . STATCHASERS_TEAM_SEASON, 'player H1: stats is dated' );
is( statchasers_player_heading( 'josh-allen-h1-test', 'outlook' ), 'Josh Allen Fantasy Outlook ' . STATCHASERS_TEAM_SEASON, 'player H1: so is the outlook' );
is( statchasers_player_heading( 'josh-allen-h1-test', 'injury' ), 'Josh Allen Injury Update & History', 'player H1: injury is not' );
is( statchasers_player_heading( 'josh-allen-h1-test', 'news' ), 'Latest Josh Allen News & Updates', 'player H1: news leads with Latest (mak, 2026-09-30)' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';
$GLOBALS['page'] = array();

echo "\nteam index body\n";
/*
 * The one piece of this plugin that OVERWRITES a page somebody may have
 * written. It replaces the stub the old builder wrote and nothing else, so
 * what matters is which bodies it declines to touch.
 */
$lead = STATCHASERS_TEAM_INDEX_LEAD;
$stub = '<p>' . $lead . '</p>';
for ( $i = 0; $i < 32; $i++ ) {
	$stub .= '<li><a href="/' . STATCHASERS_TEAM_PATH . '/team-' . $i . '/">Team</a></li>';
}

is( statchasers_team_index_is_stub( $stub ), true, 'the generated stub is recognised' );
is( statchasers_team_index_is_stub( '' ), false, 'an empty body is not the stub' );
is(
	statchasers_team_index_is_stub( '<p>My own words about the teams.</p>' ),
	false,
	'a hand-written page is left alone'
);
is(
	statchasers_team_index_is_stub( $stub . '[statchasers_team_index]' ),
	false,
	'a body already carrying a shortcode is not the stub'
);
is(
	statchasers_team_index_is_stub( '<p>' . $lead . '</p><p>and my own note</p>' ),
	false,
	'the lead alone is not enough - the wall of links is the signature'
);

echo "\nplayer index body\n";
$plead = STATCHASERS_PLAYER_INDEX_LEAD;
$pstub = '<p>' . $plead . '</p>';
for ( $i = 0; $i < 60; $i++ ) {
	$pstub .= '<li><a href="/' . STATCHASERS_PLAYER_PATH . '/player-' . $i . '/">Name</a> (WR)</li>';
}

is( statchasers_player_index_is_stub( $pstub ), true, 'the generated stub is recognised' );
is( statchasers_player_index_is_stub( '' ), false, 'an empty body is not the stub' );
is(
	statchasers_player_index_is_stub( '<p>My own words about the players.</p>' ),
	false,
	'a hand-written page is left alone'
);
is(
	statchasers_player_index_is_stub( $pstub . '[statchasers_player_index]' ),
	false,
	'a body already carrying a shortcode is not the stub'
);

echo "\nindex mounts are their own question\n";
/*
 * The index predicates must NOT answer "yes" to "is this page a hub/profile".
 * That question decides whether an FAQ node is built from the page's slug, and
 * an index page has no team and no player to build one from.
 */
$post = new WP_Post();
$post->post_content = '[statchasers_team_index]';
$post->post_name    = 'teams';
$GLOBALS['page'] = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );

is( statchasers_team_post_has_index_shortcode(), true, 'the team index is detected' );
is( statchasers_team_post_has_shortcode(), false, 'and is not mistaken for a hub' );
$GLOBALS['page'] = array();

/*
 * The matchup holder is built where the rewrite rules look for it.
 *
 * The bug: statchasers_matchup_build_holder() resolved its parent with
 * statchasers_team_container(), the HUBS' container, so the page landed at
 * `nfl/teams/matchup` while every rewrite rule, filter and sitemap entry in
 * the plugin addresses it as `nfl/matchup`. All 496 pair URLs then resolved to
 * no page, and WordPress's 404 guess redirected each of them to the stray page
 * by slug - so "View matchup" on a hub landed on the holder's own notice.
 *
 * Asserted on the PARENT rather than on "a page was created", because a page
 * was always created; it was created in the wrong place, and the old builder
 * reported success either way.
 */
echo "\nthe matchup holder is built under /nfl/, not under the hubs\n";

$GLOBALS['pages'] = array();
$error            = '';
$id               = statchasers_matchup_build_holder( $error );

is( $error, '', 'the build reports no error' );
is( $id > 0, true, 'and returns a page id' );
is( statchasers_matchup_holder_path( $id ), 'nfl/matchup', 'the holder is at nfl/matchup' );
is( statchasers_matchup_build_holder( $error ), $id, 'running it again finds the same page' );
is( count( $GLOBALS['pages'] ), 2, 'and creates nothing the second time' );

/*
 * The repair path: a holder an older release left one level too deep is MOVED,
 * not duplicated. Two pages carrying the shortcode would leave the stray
 * address reachable, which is the state this whole fix is undoing.
 */
echo "\na holder left at the old address is moved, not duplicated\n";

$GLOBALS['pages'] = array();
$nfl              = wp_insert_post( array( 'post_name' => 'nfl', 'post_parent' => 0 ) );
$teams            = wp_insert_post( array( 'post_name' => 'teams', 'post_parent' => $nfl ) );
$stray            = wp_insert_post(
	array(
		'post_name'    => 'matchup',
		'post_parent'  => $teams,
		'post_content' => '[statchasers_matchup]',
	)
);

is( statchasers_matchup_stray_holder(), $stray, 'the misplaced holder is recognised' );

$error = '';
$built = statchasers_matchup_build_holder( $error );

is( $built, $stray, 'the build returns the page that already existed' );
is( count( $GLOBALS['pages'] ), 3, 'no second holder is created' );
is( statchasers_matchup_holder_path( $stray ), 'nfl/matchup', 'and it now sits at nfl/matchup' );

/*
 * A page someone wrote themselves at that address is not this plugin's to move.
 * The shortcode is the only signature there is.
 */
echo "\na page at that address that is not ours is left alone\n";

$GLOBALS['pages'] = array();
$nfl              = wp_insert_post( array( 'post_name' => 'nfl', 'post_parent' => 0 ) );
$teams            = wp_insert_post( array( 'post_name' => 'teams', 'post_parent' => $nfl ) );
$theirs           = wp_insert_post(
	array(
		'post_name'    => 'matchup',
		'post_parent'  => $teams,
		'post_content' => '<p>Our matchup policy.</p>',
	)
);

is( statchasers_matchup_stray_holder(), 0, 'a page with no shortcode is not a stray holder' );

$error = '';
$built = statchasers_matchup_build_holder( $error );

is( $built > 0 && $built !== $theirs, true, 'the build makes its own holder instead' );
is( statchasers_matchup_holder_path( $built ), 'nfl/matchup', 'at the right address' );
is( $GLOBALS['pages'][ $theirs ]->post_parent, $teams, 'and leaves theirs where it was' );

unset( $GLOBALS['pages'] );

/*
 * The width a tool is held to inside its host page.
 *
 * The bug: `#left-area { width: 100% }` takes the sidebar's share back, which
 * is right, and on a page Divi has widened the content container for - any
 * page opened in the Divi Builder - it also takes the whole window. Same
 * stylesheet on a player page that had not been through the builder gave the
 * content column. One rule, two widths, and the team hubs came out ~700px
 * wider than the player pages they are supposed to match.
 *
 * So the cap is the site's OWN content width, asked of the theme. These assert
 * the three ways that can come back, because a bare number or an empty string
 * in a max-width drops the declaration and puts the blowout straight back.
 */
echo "\nthe tools are held to the site's content column\n";

is( statchasers_team_content_width(), '1080px', "Divi's default when the theme cannot be asked" );

$GLOBALS['et_options']['content_width'] = '1280px';
is( statchasers_team_content_width(), '1280px', 'the width the site actually uses' );

$GLOBALS['et_options']['content_width'] = '1440';
is( statchasers_team_content_width(), '1440px', 'a bare number is given its unit' );

$GLOBALS['et_options']['content_width'] = 'wide';
is( statchasers_team_content_width(), '1080px', 'and nonsense never reaches the stylesheet' );

unset( $GLOBALS['et_options'] );

$css = statchasers_team_full_width_css();
is( false !== strpos( $css, 'max-width:1080px!important' ), true, 'the cap is in the CSS the tools enqueue' );
is( false !== strpos( $css, 'width:100%!important' ), true, 'and the sidebar share is still taken back' );

/*
 * And the gutter below that breakpoint.
 *
 * `.container { width: 80% }` is not in a media query, so on a phone the
 * profile is read through a 39px margin on each side. The full-width CSS above
 * cannot fix it: that block only speaks inside `min-width: 981px`. These pin
 * the two halves meeting - one rule for every width - and the `!important`,
 * without which a Divi Builder page's own container rule outweighs this one.
 */
$mobile = statchasers_tool_mobile_gutter_css();
is( false !== strpos( $mobile, '@media (max-width:980px)' ), true, 'the gutter rule starts where the full-width rule stops' );
is( false !== strpos( $mobile, 'width:100%!important;max-width:100%!important' ), true, 'the content column takes the screen' );
is( 2, substr_count( $mobile, 'env(safe-area-inset' ), 'and a sideways phone still clears its notch' );
is(
	false !== strpos( $mobile, 'box-sizing:border-box!important' ),
	true,
	'and the padding comes out of the width, not added to it'
);

/*
 * And WHERE the gutter is, which is the whole of the bug it was shipped with.
 *
 * Padding `.container` fixed the player pages and left the team hubs flush
 * against the glass, because Divi's page.php prints `.container`, `#content-area`
 * and `#left-area` only when the page builder is NOT used - a hub that has been
 * through the builder, and a Theme Builder body layout, both go straight into
 * `#main-content`. So the padding belongs on `#main-content`, the one wrapper
 * every shape prints, and `.container` has to give its own gutter up rather
 * than add a second one on the pages that do have both.
 */
is(
	1 === preg_match( '/#main-content\{[^}]*padding-left:max\(4px/', $mobile ),
	true,
	'the gutter is on the wrapper a builder page still prints'
);
is(
	1 === preg_match( '/#main-content \.container\{[^}]*padding-left:0!important/', $mobile ),
	true,
	'and the container adds no second gutter on the pages that have one'
);

/*
 * The site's header outranks the tool.
 *
 * Every tool's sticky furniture carries a z-index meant to be read against its
 * own rows, and on a Theme Builder header - where Divi's 99999 sits on the menu
 * module, inside a wrapper that is itself a stacking context - those small
 * numbers win instead, and the tab bar prints through the open mobile menu.
 *
 * The second assertion is the one that matters. `position: relative` is the
 * obvious thing to pair with a z-index and it would unstick a sticky Theme
 * Builder header to fix a stacking bug, so the rule must not carry one.
 */
echo "\nthe site's header outranks the tool\n";

$layer = statchasers_tool_header_layer_css();
is( false !== strpos( $layer, '.et-l--header' ), true, 'a Theme Builder header is lifted too, not just #main-header' );
is( false === strpos( $layer, 'position' ), true, 'and nothing here moves it' );
is( false === strpos( $layer, '@media' ), true, 'a desktop dropdown is the same overlay, so no breakpoint' );

/*
 * And every tool enqueues both of them.
 *
 * This is the assertion that would have caught the actual mistake. The gutter
 * went in on the player pages, because that is where it was reported, and the
 * teams index was still reading through a 43px margin on each side a day later
 * - the same "fixed where it was seen rather than everywhere it applied" that
 * the host-override blocks in the stylesheets already record having done once.
 * Both rules are about the HOST page, so every file that mounts a tool wants
 * them; a sixth tool added without these two lines is the regression.
 */
echo "\nevery tool enqueues the host rules\n";

foreach ( array( 'team', 'player', 'fpa', 'schedule', 'rankings', 'player-stats', 'rb-handcuffs', 'sos', 'rookie-hit-rates' ) as $tool ) {
	$src = (string) file_get_contents( "$dir/statchasers-$tool.php" );
	is(
		false !== strpos( $src, 'statchasers_tool_header_layer_css()' ),
		true,
		"$tool lifts the site header above the tool"
	);
	is(
		false !== strpos( $src, 'statchasers_tool_mobile_gutter_css()' ),
		true,
		"$tool takes the phone's full width"
	);
}

// And the width cap, which is what holds a tool at the site's content width.
// rb-handcuffs shipped without it and grew with the window when zoomed out.
foreach ( array( 'team', 'player', 'fpa', 'schedule', 'rankings', 'player-stats', 'rb-handcuffs', 'sos', 'rookie-hit-rates' ) as $tool ) {
	$src = (string) file_get_contents( "$dir/statchasers-$tool.php" );
	is(
		false !== strpos( $src, 'statchasers_team_full_width_css()' ),
		true,
		"$tool caps itself at the site's content width"
	);
}

/*
 * The FPA FAQ island survives the round trip the plugin puts it through.
 *
 * The fragment carries its questions as an inert JSON payload, the plugin turns
 * that into the FAQPage it appends to Rank Math's graph, and then strips the
 * payload so the answers are not sitting in the page twice. Three things can
 * break silently: the parse can come back empty and leave the page with no
 * structured data, a malformed entry can reach the node, and the strip can take
 * the table with it. The last is the one worth a test - a greedy pattern there
 * eats everything between the island and the next </script> on the page.
 */
/*
 * Scoring format and view survive the trip from the URL to the API.
 *
 * The controls are links, and the bundle intercepts them so that switching
 * scoring format does not change the page's address. This is the path when it
 * cannot - scripting off, or a click that beat the bundle to the page - and
 * before it existed the link went somewhere that rendered the DEFAULT table.
 * A control that appears to work and does not is worse than one that is absent.
 *
 * The precedence is the part worth pinning: a page that writes an attribute has
 * decided what it shows, and a query string must not overrule it.
 */
echo "\nfpa scoring and view fall back to the query string\n";

$_GET = array();
$args = statchasers_fpa_args( array() );
is( $args['format'], 'half', 'no attribute and no query is the default' );
is( $args['view'], 'raw', 'and so is the view' );

$_GET = array( 'format' => 'ppr', 'view' => 'adjusted' );
$args = statchasers_fpa_args( array() );
is( $args['format'], 'ppr', 'the query string decides when the page did not' );
is( $args['view'], 'adjusted', 'both halves of the combination' );

$args = statchasers_fpa_args( array( 'format' => 'standard' ) );
is( $args['format'], 'standard', 'an explicit attribute outranks the query string' );
is( $args['view'], 'adjusted', 'and only the key it set' );

$_GET = array( 'format' => 'PPR ', 'view' => 'Adjusted' );
$args = statchasers_fpa_args( array() );
is( $args['format'], 'ppr', 'case and padding are normalised' );
is( $args['view'], 'adjusted', 'on both' );

$_GET = array( 'format' => 'superflex', 'view' => '<script>' );
$args = statchasers_fpa_args( array() );
is( $args['format'], 'half', 'anything not one of the three is dropped, not corrected' );
is( $args['view'], 'raw', 'and nothing from the URL reaches the API' );

$_GET = array();

echo "\nthe fpa faq island becomes a node and then leaves\n";

$island = '<script type="application/json" class="scf-faq-data">' .
	json_encode(
		array(
			array( 'q' => 'What does FPA mean in fantasy football?', 'a' => 'FPA stands for Fantasy Points Allowed.' ),
			array( 'q' => 'What is Adjusted Fantasy Points Allowed?', 'a' => 'aFPA accounts for the strength of the opponents a defense has faced.' ),
			// Dropped rather than emitted half-built.
			array( 'q' => '', 'a' => 'An answer with no question.' ),
			array( 'q' => 'A question with no answer.' ),
		)
	) .
	'</script>';

$fragment = '<div class="scf" data-scf-root="1"><table class="scf-table"></table></div>' . $island;

$items = statchasers_fpa_faq_parse( $fragment );
is( count( $items ), 2, 'both well-formed questions are lifted' );
is( $items[0]['q'], 'What does FPA mean in fantasy football?', 'the question comes through' );
is( $items[1]['a'], 'aFPA accounts for the strength of the opponents a defense has faced.', 'and so does the answer' );

$stripped = statchasers_fpa_strip_faq_data( $fragment );
is( false === strpos( $stripped, 'scf-faq-data' ), true, 'the island is gone from what is printed' );
is( false !== strpos( $stripped, 'data-scf-root' ), true, 'and the table it was sitting next to is not' );
is( statchasers_fpa_strip_faq_data( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

echo "\nthe rb handcuffs faq island becomes a node and then leaves\n";

$island = '<script type="application/json" class="rbh-faq-data">' .
	json_encode(
		array(
			array( 'q' => 'Who are the best RB handcuffs in fantasy football?', 'a' => 'The best RB handcuffs are backup running backs who could inherit a large workload.' ),
			array( 'q' => 'What does handcuff mean in fantasy football?', 'a' => 'A handcuff is a backup player, usually a running back.' ),
			// Dropped rather than emitted half-built.
			array( 'q' => '', 'a' => 'An answer with no question.' ),
			array( 'q' => 'A question with no answer.' ),
		)
	) .
	'</script>';

$fragment = '<div class="rbh" data-rbh-root="1" data-season="2026"><table class="rbh-table"></table></div>' . $island;

$items = statchasers_rb_handcuffs_faq_parse( $fragment );
is( count( $items ), 2, 'both well-formed questions are lifted' );
is( $items[0]['q'], 'Who are the best RB handcuffs in fantasy football?', 'the question comes through' );
is( $items[1]['a'], 'A handcuff is a backup player, usually a running back.', 'and so does the answer' );

$stripped = statchasers_rb_handcuffs_strip_faq_data( $fragment );
is( false === strpos( $stripped, 'rbh-faq-data' ), true, 'the island is gone from what is printed' );
is( false !== strpos( $stripped, 'data-rbh-root' ), true, 'and the board it was sitting next to is not' );
is( statchasers_rb_handcuffs_strip_faq_data( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

echo "\nthe schedule faq island becomes a node and then leaves\n";

/*
 * The same round trip as the FPA block above, on the one tool that was missing
 * it. The schedule fragment has carried `scs-faq-data` since the weekly board
 * got its questions; nothing in this plugin lifted it, so the answers shipped
 * as visible prose and as a dead JSON island and never as structured data.
 */
$island = '<script type="application/json" class="scs-faq-data">' .
	json_encode(
		array(
			array( 'q' => 'What does @ mean on an NFL schedule?', 'a' => 'The @ symbol means that team is playing on the road.' ),
			array( 'q' => 'How many weeks are in the 2026 NFL schedule?', 'a' => 'The 2026 NFL regular season runs 18 weeks.' ),
			// Dropped rather than emitted half-built.
			array( 'q' => '', 'a' => 'An answer with no question.' ),
			array( 'q' => 'A question with no answer.' ),
		)
	) .
	'</script>';

$fragment = '<section class="scs" data-scs-root data-scs-view="matrix"><table class="scs-matrix"></table></section>' . $island;

$items = statchasers_schedule_faq_parse( $fragment );
is( count( $items ), 2, 'both well-formed questions are lifted' );
is( $items[0]['q'], 'What does @ mean on an NFL schedule?', 'the question comes through' );
is( $items[1]['a'], 'The 2026 NFL regular season runs 18 weeks.', 'and so does the answer' );

$stripped = statchasers_schedule_strip_faq_data( $fragment );
is( false === strpos( $stripped, 'scs-faq-data' ), true, 'the island is gone from what is printed' );
is( false !== strpos( $stripped, 'data-scs-root' ), true, 'and the grid it was sitting next to is not' );
is( statchasers_schedule_strip_faq_data( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

/*
 * A team Schedule page's games: the ItemList that replaced the
 * SoftwareApplication node Search Console flagged on every team URL. The island
 * is grafted into Rank Math's graph and must never reach the printed page.
 */
$fragment = '<div class="sct" data-sct-root="1" data-section="schedule"></div>' .
	'<script type="application/json" class="sct-faq-data">[]</script>' .
	'<script type="application/json" class="sct-schedule-data">{"@type":"ItemList","itemListElement":[]}</script>';
$stripped = statchasers_team_strip_faq_data( $fragment );
is( false === strpos( $stripped, 'sct-schedule-data' ), true, 'the team schedule island is gone from what is printed' );
is( false === strpos( $stripped, 'sct-faq-data' ), true, 'and so is the FAQ island beside it' );
is( false !== strpos( $stripped, 'data-sct-root' ), true, 'and the hub it was sitting in is not' );
is( in_array( 'statchasers_team_rank_math_schedule', $GLOBALS['hooks']['rank_math/json_ld'], true ), true, 'the schedule list is grafted into Rank Math' );
is( in_array( 'statchasers_news_rank_math_schema', $GLOBALS['hooks']['rank_math/json_ld'] ?? array(), true ), false, 'and no application node is' );

/*
 * The rankings boards' ItemLists: the same island arrangement, one list per
 * position the page shows.
 */
$fragment = '<div class="scr" data-scr-root="1"></div>' .
	'<script type="application/json" class="scr-faq-data">[]</script>' .
	'<script type="application/json" class="scr-list-data">[{"@type":"ItemList","itemListElement":[]}]</script>' .
	'<script type="application/json" class="scr-page-data">{}</script>';
$stripped = statchasers_rankings_strip_faq_data( $fragment );
is( false === strpos( $stripped, 'scr-list-data' ), true, 'the rankings list island is gone from what is printed' );
is( false === strpos( $stripped, 'scr-faq-data' ) && false === strpos( $stripped, 'scr-page-data' ), true, 'and so are the islands beside it' );
is( false !== strpos( $stripped, 'data-scr-root' ), true, 'and the board is not' );
is( in_array( 'statchasers_rankings_rank_math_lists', $GLOBALS['hooks']['rank_math/json_ld'], true ), true, 'the board lists are grafted into Rank Math' );

/*
 * Which set of questions the page is describing.
 *
 * The other four tools fetch their FAQ with default arguments because their
 * questions do not vary. This one's do: `view` picks the weekly board's set or
 * the season grid's, and the node is built in wp_head, before the shortcode
 * has run. So the attributes are read off the post that is about to render.
 *
 * Asserted on the resolution as well as on the read, because these are two
 * separate ways to get it wrong: reading the wrong regex group gives no
 * attributes at all, and both of those fall back to `matrix` and look fine on
 * the page that is already the grid.
 */
echo "\nthe schedule faq follows the view the page actually mounts\n";

$post = new WP_Post();
$post->post_content = "<p>Some page copy.</p>\n[statchasers_schedule view=\"week\" week=\"3\"]";
$GLOBALS['page'] = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );

// Memoised, so this process only ever sees this one post. The resolution below
// is a pure function and can be asked as often as we like.
$atts = statchasers_schedule_mounted_atts();
is( $atts['view'] ?? '', 'week', 'the mounted view is read off the post' );
is( $atts['week'] ?? '', '3', 'and so is the week' );

$args = statchasers_schedule_args( $atts );
is( $args['view'], 'week', 'which is what the fetch asks the API for' );
is( $args['week'], 3, 'at the week the page pinned' );

// A bare mount is the season grid, which is this page's real address.
$bare = statchasers_schedule_args( array() );
is( $bare['view'], 'matrix', 'a bare mount is the grid' );
is( $bare['week'], 0, 'and lets the API pick the week' );

// The team lens is gone from the API; a mount that still names it is the grid,
// and neither the team nor a filter the grid ignores reaches the cache key.
$lens = statchasers_schedule_args( array( 'view' => 'team', 'team' => 'NE', 'filter' => 'division' ) );
is( $lens['view'], 'matrix', 'view="team" falls back to the grid' );
is( isset( $lens['team'] ), false, 'the team is not carried' );
is( $lens['filter'], 'all', 'the grid drops the filter' );
$weekly = statchasers_schedule_args( array( 'view' => 'week', 'filter' => 'division' ) );
is( $weekly['filter'], 'division', 'the weekly board keeps it' );

/*
 * The heading off a week URL, which is the page's own name and nothing added.
 * The week case is in the `week` group, for the reason given there.
 */
echo "\nthe bare page is called what the page is called\n";

$post->post_title = '2026 NFL Schedule';
is( statchasers_schedule_heading(), '2026 NFL Schedule', 'the heading is the page title' );
is( statchasers_schedule_week_title(), '', 'and nothing asks the theme to rename it' );
is(
	str_starts_with( statchasers_schedule_lead(), 'View the full NFL schedule' ),
	true,
	'the standfirst describes the grid'
);
// The filter itself is asserted in the `week` group, where the request is a
// week URL. Running it here would measure the matchup file's `the_title`
// filter instead: this process set a pair up earlier and that answer memoised.

/*
 * Retired player addresses. The old section-first layout
 * (/nfl/players/outlook/josh-allen/) still resolved to stale pages, and the
 * redraft-era /fantasy-football/players/<slug>/ is indexed and 404s.
 */
echo "\nretired player addresses redirect to the profile\n";

$saved_pages   = $GLOBALS['pages'] ?? null;
$saved_by_path = $GLOBALS['pages_by_path'] ?? null;

$nfl                 = new WP_Post();
$nfl->ID             = 500;
$players             = new WP_Post();
$players->ID         = 501;
$allen               = new WP_Post();
$allen->ID           = 502;
$allen->post_name    = 'josh-allen';
$allen->post_parent  = 501;
$GLOBALS['pages_by_path'] = array( 'nfl' => $nfl, 'nfl/players' => $players );
$GLOBALS['pages']         = array( 502 => $allen );

$profile = 'https://example.com/p/502/';
is( statchasers_player_legacy_target( 'nfl/players/outlook/josh-allen' ), $profile . 'outlook/', 'the old Outlook page goes to the Outlook section' );
is( statchasers_player_legacy_target( 'nfl/players/game-log/josh-allen/' ), $profile . 'game-log/', 'and so does every section in that layout' );
is( statchasers_player_legacy_target( 'nfl/players/overview/josh-allen' ), $profile, 'the overview is the profile itself' );
is( statchasers_player_legacy_target( 'fantasy-football/players/josh-allen' ), $profile, 'the redraft-era profile goes to the profile' );
is( statchasers_player_legacy_target( 'fantasy-football/players/josh-allen/stats' ), $profile . 'stats/', 'keeping its section' );
is( statchasers_player_legacy_target( 'nfl/players/outlook/nobody' ), '', 'a player with no page is left alone' );
is( statchasers_player_legacy_target( 'fantasy-football/players/josh-allen/rankings' ), '', 'an unknown second segment is not a match' );
is( statchasers_player_legacy_target( 'nfl/players/josh-allen/outlook' ), '', 'the current layout is never redirected' );
is( statchasers_player_legacy_target( 'nfl/players/josh-allen' ), '', 'nor the profile' );
is( statchasers_player_legacy_target( 'nfl/players/outlook' ), '', 'nor a bare section word' );
is( in_array( 'statchasers_player_legacy_redirect', $GLOBALS['hooks']['template_redirect'] ?? array(), true ), true, 'it runs on template_redirect' );

$GLOBALS['pages']         = $saved_pages;
$GLOBALS['pages_by_path'] = $saved_by_path;
if ( null === $saved_pages ) {
	unset( $GLOBALS['pages'] );
}
if ( null === $saved_by_path ) {
	unset( $GLOBALS['pages_by_path'] );
}

/*
 * A rankings position URL. Not a group of its own: the position is read off
 * the query var on every call, not memoised, so it can be set and unset here.
 */
echo "\nrankings position URLs\n";

$rank_page               = new WP_Post();
$rank_page->ID           = 11;
$rank_page->post_title   = 'Rest of Season Rankings';
$rank_page->post_content = '[statchasers_ros_rankings]';
$GLOBALS['page']         = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $rank_page,
);

is( statchasers_rankings_position_title(), '', 'the page itself is not retitled' );
is( statchasers_rankings_position_canonical(), '', 'nor given a second canonical' );
is( statchasers_rankings_args( array( 'pos' => 'te' ) )['pos'], 'te', 'the attribute opens a board on the bare page' );

$GLOBALS['query']['sc_rank_pos'] = 'rb';
is( statchasers_rankings_request_pos(), 'rb', 'the position comes off the address' );
is( statchasers_rankings_args( array( 'pos' => 'te' ) )['pos'], 'rb', 'and outranks the attribute' );
is( statchasers_rankings_position_title(), 'Rest of Season Rankings: Running Backs', 'the title names the board' );
is(
	apply_filters( 'rank_math/frontend/title', 'Rest of Season Rankings | StatChasers' ),
	'Rest of Season Rankings: Running Backs | StatChasers',
	'and Rank Math prints it'
);
is(
	apply_filters( 'rank_math/frontend/canonical', 'https://example.com/fantasy-football/rest-of-season-rankings/' ),
	'https://example.com/fantasy-football/rest-of-season-rankings/rb/',
	'the board is its own canonical'
);
is(
	str_starts_with( statchasers_rankings_position_description(), 'Rest-of-season fantasy football RB rankings' ),
	true,
	'with its own description'
);

$GLOBALS['query']['sc_rank_pos'] = 'k';
is( statchasers_rankings_request_pos(), '', 'a position the board lacks is not one' );

unset( $GLOBALS['query']['sc_rank_pos'] );
is( statchasers_rankings_position_url( 'all' ), 'https://example.com/fantasy-football/rest-of-season-rankings/', 'All is the page itself' );

$GLOBALS['page'] = array();

/*
 * The advanced stats table: which position and season a request renders.
 *
 * The address outranks the attribute for the position, because /rb/ is an
 * address and a page there that rendered quarterbacks would be a wrong answer
 * at a right-looking URL. The attribute outranks the query string for the
 * season, because a page that wrote season="2024" decided what it shows.
 */
echo "\nthe advanced stats table reads its address\n";

// The position is read only on the page that mounts the table - see
// smoke-headings.php for an article that does not.
$stats_page               = new WP_Post();
$stats_page->ID           = 12;
$stats_page->post_title   = 'NFL Player Stats';
$stats_page->post_content = '[statchasers_player_stats]';
$GLOBALS['page']          = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $stats_page,
);
$GLOBALS['http_body']     = '';

$GLOBALS['query'] = array();
$_GET             = array();
is( statchasers_player_stats_args( array() ), array( 'pos' => 'qb', 'season' => '' ), 'the bare page is the quarterbacks, newest season' );
is( statchasers_player_stats_title(), '', 'with no fragment, the bare page keeps its own title' );
is( statchasers_player_stats_canonical(), '', 'and its own canonical' );

// A position address - the address outranking the attribute, its title and
// its canonical - is asserted in smoke-headings.php: the "does this page mount
// the table" answer those read is memoised, and an earlier group has already
// asked it about a page of its own.

$GLOBALS['query'] = array( 'sc_stats_pos' => 'k' );
is( statchasers_player_stats_request_position(), '', 'a position the table does not have is not one' );

$GLOBALS['query'] = array();
$_GET             = array( 'season' => 'all' );
is( statchasers_player_stats_args( array() )['season'], 'all', 'the season link works with scripting off' );
is( statchasers_player_stats_args( array( 'season' => '2024' ) )['season'], '2024', 'an attribute outranks the query string' );
$_GET = array( 'season' => '<script>' );
is( statchasers_player_stats_args( array() )['season'], '', 'a season that is not one is dropped' );
$_GET = array();

is(
	statchasers_player_stats_position_url( 'qb' ),
	'https://example.com/nfl/nfl-player-stats/',
	'the quarterbacks are the bare page'
);
is(
	1 === preg_match( '#' . statchasers_player_stats_rule() . '#', 'nfl/nfl-player-stats/rb/' ),
	true,
	'the rewrite rule matches a position address'
);
is(
	1 === preg_match( '#' . statchasers_player_stats_rule() . '#', 'nfl/nfl-player-stats/RB/' ),
	false,
	'and only the lower-case spelling'
);

/*
 * The fragment carries the page's title, H1, description and FAQ as inert
 * islands; the plugin reads them and strips them from what it prints.
 */
echo "\nthe advanced stats table hands WordPress its titles and FAQ\n";

$sca_fragment = '<div class="sca"><h2>2026 NFL Wide Receiver Stats</h2>' .
	'<script type="application/json" class="sca-faq-data">[{"q":"Where can I find NFL player stats?","a":"Here."},{"q":"","a":"dropped"},{"q":"x"}]</script>' .
	'<script type="application/json" class="sca-page-data">{"title":"2026 NFL Wide Receiver Stats & Fantasy Football Stats","h1":"2026 NFL Wide Receiver Stats & Fantasy Football Stats","description":"2026 NFL wide receiver stats \u003cb\u003ebold\u003c/b\u003e","extra":1}</script>' .
	'</div>';
is(
	statchasers_player_stats_parse_copy( $sca_fragment ),
	array(
		'title'       => '2026 NFL Wide Receiver Stats & Fantasy Football Stats',
		'h1'          => '2026 NFL Wide Receiver Stats & Fantasy Football Stats',
		'description' => '2026 NFL wide receiver stats bold',
	),
	'the title island is read, tags stripped, unknown keys ignored'
);
is(
	statchasers_player_stats_parse_faq( $sca_fragment ),
	array( array( 'q' => 'Where can I find NFL player stats?', 'a' => 'Here.' ) ),
	'the FAQ island is read, and a malformed entry dropped'
);
is( statchasers_player_stats_parse_copy( '<div></div>' ), array(), 'no island, no copy' );
is(
	statchasers_player_stats_strip_islands( $sca_fragment ),
	'<div class="sca"><h2>2026 NFL Wide Receiver Stats</h2></div>',
	'both islands are stripped from the printed markup'
);

/*
 * The RB handcuff board's schema node: one CreativeWork, hung off whichever
 * node is the page, with no rating - the standalone plugin's final answer after
 * WebApplication earned it a Search Console error - and the season read off the
 * fragment rather than written in.
 */
echo "\nthe RB handcuff board describes itself to Rank Math\n";

is( statchasers_rb_handcuffs_season( '<div class="rbh" data-rbh-root="1" data-season="2026">' ), 2026, 'the season comes off the fragment' );

$rbh_post               = new WP_Post();
$rbh_post->ID           = 41;
$rbh_post->post_content = '[statchasers_rb_handcuffs]';
$GLOBALS['page']        = array(
	'singular' => true,
	'post'     => $rbh_post,
);
$graph = statchasers_rb_handcuffs_rank_math_schema(
	array(
		'WebPage'      => array( '@type' => 'WebPage', '@id' => 'https://example.com/p/41/#webpage' ),
		'Organization' => array( '@type' => 'Organization' ),
	)
);
$node = $graph['statchasersRbHandcuffs'] ?? array();
is( $node['@type'] ?? '', 'CreativeWork', 'the tool is a CreativeWork' );
is( isset( $node['aggregateRating'] ) || isset( $node['review'] ), false, 'with no invented rating' );
is( $graph['WebPage']['mainEntity']['@id'] ?? '', 'https://example.com/p/41/#rb-handcuff-rankings', 'and is the page\'s main entity' );
is( isset( $graph['Organization']['mainEntity'] ), false, 'the other nodes are left alone' );
$GLOBALS['page'] = array();

/*
 * Postseason game addresses. The API links `/2025-super-bowl/` and its
 * siblings from every pair that has met in January; the rewrite used to know
 * only `-week-N`, so each of those links was a WordPress 404 before the
 * validator was asked. The shape and the validator both mirror
 * parseGameSegment() in the API's pair.ts.
 */
echo "\npostseason game addresses resolve, near misses do not\n";

$shape = '#^' . STATCHASERS_MATCHUP_GAME_SHAPE . '$#';
foreach ( array( '2026-week-1', '2022-wild-card', '2022-divisional', '2022-conference-championship', '2025-super-bowl', '2025-postseason-week-4' ) as $segment ) {
	is( 1 === preg_match( $shape, $segment ), true, "the rewrite takes $segment" );
	$GLOBALS['query']['sc_matchup_game'] = $segment;
	is( statchasers_matchup_game(), $segment, "and the validator passes $segment to ?game= as spelled" );
}
foreach ( array( '2026-week-01', '2026-WEEK-1', '2026-wk-1', '2025-pro-bowl', '2025-postseason-week-0', '2025-postseason-week-26', '1919-super-bowl', '2025-superbowl', '25-super-bowl', '2026-week-26' ) as $segment ) {
	$GLOBALS['query']['sc_matchup_game'] = $segment;
	is( statchasers_matchup_game(), '', "$segment is not a game (a 404)" );
}

$GLOBALS['query']['sc_matchup_game'] = '2025-super-bowl';
is( statchasers_matchup_heading(), 'New England Patriots vs Philadelphia Eagles, Super Bowl 2025', 'a Super Bowl is headed by its round' );
is(
	statchasers_matchup_game_meta( 'new-england-patriots', 'philadelphia-eagles', '2025-super-bowl' )['title'],
	'New England Patriots vs Philadelphia Eagles, Super Bowl 2025 Box Score',
	'and titled by it'
);

// Every matchup title fits in 70 characters: all 496 pairs, every state, and
// the longest game labels. Site audits flag longer titles, and there were 1,280.
$longest = '';
foreach ( array_keys( statchasers_team_table() ) as $ta ) {
	foreach ( array_keys( statchasers_team_table() ) as $tb ) {
		if ( $ta >= $tb ) {
			continue;
		}
		$titles = array(
			statchasers_matchup_meta( $ta, $tb, 'upcoming', '2026' )['title'],
			statchasers_matchup_meta( $ta, $tb, 'recently_completed', '2026' )['title'],
			statchasers_matchup_meta( $ta, $tb, 'historical', '2026' )['title'],
		);
		foreach ( array( '2026-week-18', '2025-conference-championship', '2025-divisional', '2025-postseason-week-4' ) as $g ) {
			$titles[] = statchasers_matchup_game_meta( $ta, $tb, $g )['title'];
		}
		foreach ( $titles as $t ) {
			if ( strlen( $t ) > strlen( $longest ) ) {
				$longest = $t;
			}
		}
	}
}
is( strlen( $longest ) <= 70, true, "no matchup title is over 70 characters (longest: $longest)" );
is(
	statchasers_matchup_game_meta( 'miami-dolphins', 'new-york-jets', '2026-week-1' )['title'],
	'Miami Dolphins vs New York Jets, Week 1 2026 Box Score | StatChasers',
	'the brand stays when it fits'
);
$GLOBALS['query']['sc_matchup_game'] = '2026-week-1';
is( statchasers_matchup_heading(), 'New England Patriots vs Philadelphia Eagles, Week 1 2026', 'a regular-season game is still "Week N"' );
is(
	statchasers_matchup_game_meta( 'new-england-patriots', 'philadelphia-eagles', '2026-week-1' )['description'],
	'Full box score from Patriots vs Eagles in Week 1 of 2026: quarter-by-quarter scoring, every passing, rushing and receiving line, snap counts and fantasy points.',
	'with the API\'s own regular-season description'
);

/*
 * The scoreboard hero. The API renders its heading as an H2 in an embed and
 * sends the page's H1 and <title> as headers; the plugin promotes the H2 so
 * the page's one H1 is inside the hero, prints the API's words, and lifts the
 * SportsEvent island into the head.
 */
echo "\nthe scoreboard hero carries the page's H1, title and SportsEvent\n";

$hero_html = '<div class="sct sct-mu"><header class="sct-sbh" aria-labelledby="sct-mu-title">'
	. '<h2 class="sct-sbh-title" id="sct-mu-title" data-sct-hero-heading>Philadelphia Eagles vs New England Patriots, Week 1 2026</h2>'
	. '</header><section><h2 class="sct-h2">Player Stats</h2></section>'
	. '<script type="application/json" class="sct-matchup-event-data">'
	. '{"@type":"SportsEvent","name":"x","startDate":"2026-09-13T17:00:00.000Z","location":{"@type":"StadiumOrArena","name":"Gillette Stadium"},"homeTeam":{"@type":"SportsTeam","name":"New England Patriots"},"awayTeam":{"@type":"SportsTeam","name":"Philadelphia Eagles"}}'
	. '</script></div>';

$promoted = statchasers_matchup_promote_heading( $hero_html );
is( substr_count( (string) $promoted, '<h1' ), 1, 'the hero heading is promoted to the one H1' );
is( 1 === preg_match( '#<header class="sct-sbh"[^>]*><h1 class="sct-sbh-title" id="sct-mu-title" data-sct-hero-heading>#', (string) $promoted ), true, 'in place, inside the hero, id kept for aria-labelledby' );
is( substr_count( (string) $promoted, '<h2' ), 1, 'and only that heading: the section H2 stays an H2' );
is( statchasers_matchup_promote_heading( '<div class="sct"><h2 class="sct-mu-strip-title">x</h2></div>' ), null, 'an older render with no hero heading promotes nothing' );

$stripped = statchasers_matchup_strip_event_data( $hero_html );
is( false === strpos( $stripped, 'sct-matchup-event-data' ), true, 'the SportsEvent island is stripped from the printed markup' );
is( false !== strpos( $stripped, 'data-sct-hero-heading' ), true, 'and nothing else is' );

$GLOBALS['http_body']    = $hero_html;
$GLOBALS['http_headers'] = array(
	'x-matchup-heading' => rawurlencode( 'Philadelphia Eagles vs New England Patriots, Week 1 2026' ),
	'x-matchup-title'   => rawurlencode( "Eagles vs Patriots Week 1 2026: Final Score 24\u{2013}20, Stats & Recap" ),
	'x-matchup-score'   => 'Eagles won 24-20.',
	'x-matchup-game'    => 'archived',
);
is( statchasers_matchup_heading(), 'Philadelphia Eagles vs New England Patriots, Week 1 2026', "the H1 is the API's, away then home" );
is(
	statchasers_matchup_request_meta()['title'],
	"Eagles vs Patriots Week 1 2026: Final Score 24\u{2013}20, Stats & Recap",
	"the title is the API's, en dash and all"
);
$event = statchasers_matchup_event_node();
is( $event['@type'] ?? '', 'SportsEvent', 'the SportsEvent is lifted for the head' );
is(
	statchasers_matchup_rank_math_schema( array() )['statchasersMatchupEvent']['homeTeam']['name'] ?? '',
	'New England Patriots',
	"and joins Rank Math's graph"
);
// The FAQ island: lifted into the graph beside the event, stripped from the markup.
$faq_island = '<script type="application/json" class="sct-matchup-faq-data">'
	. '{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Who won?","acceptedAnswer":{"@type":"Answer","text":"The Eagles won 24\u201320."}}]}'
	. '</script>';
$GLOBALS['http_body'] = $hero_html . $faq_island;
is( statchasers_matchup_rank_math_schema( array() )['statchasersMatchupFaq']['mainEntity'][0]['name'] ?? '', 'Who won?', 'the FAQ joins the graph too' );
is( false === strpos( statchasers_matchup_strip_event_data( $hero_html . $faq_island ), 'sct-matchup-faq-data' ), true, 'and its island is stripped from the markup' );
$GLOBALS['http_body'] = $hero_html . str_replace( '"text":"The Eagles won 24\u201320."', '"text":""', $faq_island );
is( statchasers_matchup_faq_node(), null, 'a question with no answer drops the FAQ node' );
$GLOBALS['http_body'] = str_replace( '"startDate":"2026-09-13T17:00:00.000Z",', '', $hero_html );
is( statchasers_matchup_event_node(), null, 'an Event with no startDate is dropped, not printed broken' );

// An API from before the headers: the plugin's own builders stand in.
$GLOBALS['http_headers'] = array();
$GLOBALS['http_body']    = $hero_html;
is( statchasers_matchup_heading(), 'New England Patriots vs Philadelphia Eagles, Week 1 2026', 'with no heading header, the pair order stands' );
unset( $GLOBALS['http_body'] );
$GLOBALS['http_headers'] = array();

/*
 * The matchup trail. Rank Math builds it from the holder, so it ended at the
 * noindex /nfl/matchup/ template. The holder comes out; the pair, and the game
 * on a dated address, go in.
 */
echo "\nthe matchup breadcrumb never names the holder\n";

$rank_math_trail = array(
	array( 'Home', 'https://example.com/', 'hide_in_schema' => false ),
	array( 'NFL', 'https://example.com/nfl/', 'hide_in_schema' => false ),
	array( 'NFL Matchups', 'https://example.com/nfl/matchup/', 'hide_in_schema' => false ),
);

$GLOBALS['query']['sc_matchup_game'] = '';
$crumbs = statchasers_matchup_breadcrumbs( $rank_math_trail );
is( array_column( $crumbs, 0 ), array( 'Home', 'NFL', 'New England Patriots vs Philadelphia Eagles' ), 'pair: Home › NFL › the pair' );
is( $crumbs[2][1], 'https://example.com/nfl/new-england-patriots-vs-philadelphia-eagles/', 'at the pair\'s own address' );

$GLOBALS['query']['sc_matchup_game'] = '2025-super-bowl';
$crumbs = statchasers_matchup_breadcrumbs( $rank_math_trail );
is( array_column( $crumbs, 0 ), array( 'Home', 'NFL', 'New England Patriots vs Philadelphia Eagles', 'Super Bowl 2025' ), 'game: … › the pair › the game' );
is( $crumbs[3][1], 'https://example.com/nfl/new-england-patriots-vs-philadelphia-eagles/2025-super-bowl/', 'at the game\'s own address' );

$GLOBALS['query']['sc_matchup_game'] = '2026-week-01';
is( statchasers_matchup_breadcrumbs( $rank_math_trail ), $rank_math_trail, 'a 404 game address is not given a trail' );
unset( $GLOBALS['query']['sc_matchup_game'] );

/*
 * `?adv=` on a player page. The API prints Advanced-section season chips as
 * `?adv=<season>` links; the plugin read `log` and not `adv`, so every chip
 * reloaded the same season. Read, bounded and forwarded exactly like `log`.
 */
echo "\n?adv= reaches the API the way ?log= does\n";

$_GET = array( 'adv' => '2024', 'log' => '2023' );
$args = statchasers_player_args( array( 'slug' => 'josh-allen' ) );
is( $args['adv'], '2024', 'the Advanced season comes off the URL' );
is( $args['log'], '2023', 'beside the Game Log\'s' );
$GLOBALS['remote_urls'] = array();
statchasers_player_fetch( $args['slug'], $args['format'], $args['section'], $args['log'], $args['adv'] );
is( end( $GLOBALS['remote_urls'] ), 'https://api.example.com/embed/player/josh-allen?log=2023?adv=2024', 'and both are forwarded to /embed/player' );

$_GET = array( 'adv' => '1998' );
is( statchasers_player_args( array( 'slug' => 'josh-allen' ) )['adv'], '', 'a season before 1999 is dropped' );
$_GET = array( 'adv' => (string) ( (int) gmdate( 'Y' ) + 2 ) );
is( statchasers_player_args( array( 'slug' => 'josh-allen' ) )['adv'], '', 'and one two years out' );
$_GET = array( 'adv' => array( '2024' ) );
is( statchasers_player_args( array( 'slug' => 'josh-allen' ) )['adv'], '', 'and an array' );
$_GET = array();
is( statchasers_player_args( array( 'slug' => 'josh-allen' ) )['adv'], '', 'absent is absent' );

/*
 * A routine flush keeps the outage backups. The sweeps used to LIKE-delete
 * `_transient_sc_<tool>_ssr_%`, which is also the backups' prefix, so "Clear
 * cached renders" left nothing to serve if the API went down straight after.
 * The fake $wpdb below runs the DELETE's LIKE clauses against a list of rows.
 */
echo "\nclearing cached renders keeps the outage backups\n";

$saved_wpdb     = $GLOBALS['wpdb'];
$GLOBALS['wpdb'] = new class {
	public $options = 'wp_options';
	public $rows    = array();
	public function esc_like( $s ) { return addcslashes( (string) $s, '_%\\' ); }
	public function prepare( $q, ...$a ) {
		foreach ( $a as $arg ) {
			$q = preg_replace( '/%s/', "'" . str_replace( '\\', '\\\\', $arg ) . "'", $q, 1 );
		}
		return $q;
	}
	/** MySQL's LIKE, with backslash as the escape. */
	private function like( $pattern, $name ) {
		$regex = '';
		$len   = strlen( $pattern );
		for ( $i = 0; $i < $len; $i++ ) {
			$c = $pattern[ $i ];
			if ( '\\' === $c && $i + 1 < $len ) {
				$regex .= preg_quote( $pattern[ ++$i ], '/' );
			} elseif ( '%' === $c ) {
				$regex .= '.*';
			} elseif ( '_' === $c ) {
				$regex .= '.';
			} else {
				$regex .= preg_quote( $c, '/' );
			}
		}
		return 1 === preg_match( '/^' . $regex . '$/s', $name );
	}
	public function query( $q ) {
		// Every sweep is (LIKE OR LIKE ...) AND NOT LIKE AND NOT LIKE ...
		preg_match_all( "/option_name (NOT )?LIKE '((?:[^'\\\\]|\\\\.)*)'/", $q, $m, PREG_SET_ORDER );
		$in  = array();
		$out = array();
		foreach ( $m as $clause ) {
			$pattern = $clause[2];
			if ( '' === $clause[1] ) {
				$in[] = $pattern;
			} else {
				$out[] = $pattern;
			}
		}
		foreach ( $this->rows as $i => $name ) {
			$hit = false;
			foreach ( $in as $p ) { $hit = $hit || $this->like( $p, $name ); }
			foreach ( $out as $p ) { $hit = $hit && ! $this->like( $p, $name ); }
			if ( $hit ) {
				unset( $this->rows[ $i ] );
			}
		}
		return 0;
	}
};
$flush_rows = array(
	'_transient_sc_team_ssr_abc123',
	'_transient_timeout_sc_team_ssr_abc123',
	'_transient_sc_team_ssr_bak_abc123',
	'_transient_timeout_sc_team_ssr_bak_abc123',
	'_transient_sc_player_ssr_def456',
	'_transient_sc_player_ssr_bak_def456',
	'_transient_sc_player_idx_bak_aaa',
	'_transient_sc_team_idx_bak_bbb',
	'_transient_sc_teamXssr_ccc',
	'_transient_sc_fpa_ssr_1',
	'_transient_sc_fpa_ssr_bak_1',
	'_transient_sc_rank_ssr_2',
	'_transient_sc_rank_ssr_bak_2',
	'_transient_sc_sched_ssr_3',
	'_transient_sc_sched_ssr_bak_3',
	'_transient_sc_stats_ssr_4',
	'_transient_sc_stats_ssr_bak_4',
	'_transient_sc_rbh_ssr_5',
	'_transient_sc_rbh_ssr_bak_5',
	'_transient_sc_sos_ssr_6',
	'_transient_sc_sos_ssr_bak_6',
	'_transient_sc_rhr_ssr_7',
	'_transient_sc_rhr_ssr_bak_7',
);
$GLOBALS['wpdb']->rows = $flush_rows;
foreach ( array( 'statchasers_team_flush', 'statchasers_player_flush', 'statchasers_fpa_flush', 'statchasers_rankings_flush', 'statchasers_schedule_flush', 'statchasers_player_stats_flush', 'statchasers_rb_handcuffs_flush', 'statchasers_sos_flush', 'statchasers_rhr_flush' ) as $flush ) {
	$flush();
}
is(
	array_values( $GLOBALS['wpdb']->rows ),
	array(
		'_transient_sc_team_ssr_bak_abc123',
		'_transient_timeout_sc_team_ssr_bak_abc123',
		'_transient_sc_player_ssr_bak_def456',
		'_transient_sc_player_idx_bak_aaa',
		'_transient_sc_team_idx_bak_bbb',
		'_transient_sc_teamXssr_ccc',
		'_transient_sc_fpa_ssr_bak_1',
		'_transient_sc_rank_ssr_bak_2',
		'_transient_sc_sched_ssr_bak_3',
		'_transient_sc_stats_ssr_bak_4',
		'_transient_sc_rbh_ssr_bak_5',
		'_transient_sc_sos_ssr_bak_6',
		'_transient_sc_rhr_ssr_bak_7',
	),
	'every tool\'s fresh copies go and every backup stays'
);

$GLOBALS['wpdb']->rows = $flush_rows;
foreach ( array( 'statchasers_team_flush', 'statchasers_player_flush', 'statchasers_fpa_flush', 'statchasers_rankings_flush', 'statchasers_schedule_flush', 'statchasers_player_stats_flush', 'statchasers_rb_handcuffs_flush', 'statchasers_sos_flush', 'statchasers_rhr_flush' ) as $flush ) {
	$flush( true );
}
is( array_values( $GLOBALS['wpdb']->rows ), array( '_transient_sc_teamXssr_ccc' ), 'the full cleanup takes the backups and indexes too, and nothing that only looks similar' );
$GLOBALS['wpdb'] = $saved_wpdb;

/*
 * The RB handcuff board as mainEntity: a WebPage (or kin) only. The old test
 * was "any @type containing Page", and FAQPage contains it - its mainEntity is
 * its questions.
 */
echo "\nthe RB handcuff board never takes the FAQPage's mainEntity\n";

$GLOBALS['page'] = array( 'singular' => true, 'post' => $rbh_post );
$faq_questions   = array( array( '@type' => 'Question', 'name' => 'Q?' ) );
$graph           = statchasers_rb_handcuffs_rank_math_schema(
	array(
		'faq'     => array( '@type' => 'FAQPage', 'mainEntity' => $faq_questions ),
		'WebPage' => array( '@type' => 'WebPage', '@id' => 'https://example.com/p/41/#webpage' ),
	)
);
is( $graph['faq']['mainEntity'], $faq_questions, 'the FAQPage keeps its questions' );
is( $graph['WebPage']['mainEntity']['@id'] ?? '', 'https://example.com/p/41/#rb-handcuff-rankings', 'and the WebPage after it gets the board' );

$graph = statchasers_rb_handcuffs_rank_math_schema(
	array( 'WebPage' => array( '@type' => array( 'WebPage', 'CollectionPage' ), 'mainEntity' => array( '@id' => '#other' ) ) )
);
is( $graph['WebPage']['mainEntity'], array( '@id' => '#other' ), 'a mainEntity already set is not overwritten' );

$graph = statchasers_rb_handcuffs_rank_math_schema( array( 'faq' => array( '@type' => 'FAQPage' ) ) );
is( isset( $graph['faq']['mainEntity'] ), false, 'and a graph with only an FAQPage gets no mainEntity at all' );
$GLOBALS['page'] = array();

/*
 * Sitemap section URLs belong to pages that mount the tool. Every published
 * child of /nfl/players/ used to get six, shortcode or not.
 */
echo "\nsitemap sections only under pages that mount the tool\n";

$saved_pages    = $GLOBALS['pages'] ?? null;
$saved_by_path  = $GLOBALS['pages_by_path'] ?? null;
$sm_nfl             = new WP_Post();
$sm_nfl->ID         = 900;
$sm_players         = new WP_Post();
$sm_players->ID     = 901;
$sm_profile               = new WP_Post();
$sm_profile->ID           = 902;
$sm_profile->post_parent  = 901;
$sm_profile->post_content = '[statchasers_player]';
$sm_other                 = new WP_Post();
$sm_other->ID             = 903;
$sm_other->post_parent    = 901;
$sm_other->post_content   = '<p>How we rank players.</p>';
$GLOBALS['pages_by_path'] = array( 'nfl' => $sm_nfl, 'nfl/players' => $sm_players );
$GLOBALS['pages']         = array( 902 => $sm_profile, 903 => $sm_other );

$sitemap = statchasers_player_sitemap_sections( '' );
is( substr_count( $sitemap, 'https://example.com/p/902/' ), count( STATCHASERS_PLAYER_INDEXED_SECTIONS ), 'the profile gets its section URLs' );
is( false === strpos( $sitemap, '/p/903/' ), true, 'the page without the shortcode gets none' );

// A section the player has none of redirects, so it stays out of the sitemap.
is( statchasers_player_sitemap_skips( 'injury', array( 'empty' => array( 'injury' ) ) ), true, 'a section the roster says is empty is left out' );
is( statchasers_player_sitemap_skips( 'stats', array( 'empty' => array( 'injury' ) ) ), false, 'and its other sections are kept' );
is( statchasers_player_sitemap_skips( 'outlook', array() ), false, 'a row from before emptySections keeps every section' );
is( statchasers_player_sitemap_skips( 'bio', array( 'bioIndex' => false ) ), true, 'a noindex bio is still left out' );
is( statchasers_player_sitemap_skips( 'injury', null ), false, 'and a page with no roster row keeps its sections' );

// The dead players sitemap is taken out of the index; the others stay.
$sm_index = "\t<sitemap>\n\t\t<loc>https://statchasers.com/sitemap-players.xml</loc>\n\t\t<lastmod>2026-09-07T00:00:00+00:00</lastmod>\n\t</sitemap>\n" .
	"\t<sitemap>\n\t\t<loc>https://statchasers.com/nfl-depth-charts-sitemap.xml</loc>\n\t</sitemap>\n";
$sm_index = statchasers_sitemap_drop_dead_players( $sm_index );
is( false === strpos( $sm_index, 'sitemap-players.xml' ), true, 'the 404ing players sitemap leaves the index' );
is( false !== strpos( $sm_index, '<loc>https://statchasers.com/nfl-depth-charts-sitemap.xml</loc>' ), true, 'and the depth charts sitemap stays' );

// A player who has left the roster: noindex, and out of the sitemap.
$sm_roster = array( array( 'slug' => 'josh-allen' ), array( 'slug' => 'dj-moore' ) );
is( statchasers_player_left_roster( 'malik-turner', $sm_roster ), true, 'a page whose player is off the roster has left' );
is( statchasers_player_left_roster( 'josh-allen', $sm_roster ), false, 'a rostered player has not' );
is( statchasers_player_left_roster( 'malik-turner', array() ), false, 'and an empty roster (the API down) sends nobody away' );
is( statchasers_player_sitemap_drop_left( array( 'loc' => 'x' ), 'post', null ), array( 'loc' => 'x' ), 'an entry with no post is kept' );
is( statchasers_player_sitemap_drop_left( array( 'loc' => 'x' ), 'post', $sm_other ), array( 'loc' => 'x' ), 'and so is a page without the shortcode' );

// The fragment's flag for a section the player has none of.
is( statchasers_player_section_missing( '<div></div><script type="application/json" class="scp-page-data">{"missing":true}</script>' ), true, 'the missing flag is read off the page-data island' );
is( statchasers_player_section_missing( '<script type="application/json" class="scp-page-data">{"title":"T","description":"D"}</script>' ), false, 'a section with its own copy is not missing' );
is( statchasers_player_section_missing( '' ), false, 'nor is an empty fragment (the API down): no redirect on no evidence' );

// The team hubs, through the filter: two pages at team slugs, one a hub.
$sm_teams                = new WP_Post();
$sm_teams->ID            = 910;
$sm_teams->post_name     = 'teams';
$sm_teams->post_parent   = 0;
$sm_root                 = new WP_Post();
$sm_root->ID             = 909;
$sm_root->post_name      = 'nfl';
$sm_teams->post_parent   = 909;
$sm_bills                = new WP_Post();
$sm_bills->ID            = 911;
$sm_bills->post_name     = 'buffalo-bills';
$sm_bills->post_parent   = 910;
$sm_bills->post_content  = '[statchasers_team]';
$sm_fins                 = new WP_Post();
$sm_fins->ID             = 912;
$sm_fins->post_name      = 'miami-dolphins';
$sm_fins->post_parent    = 910;
$sm_fins->post_content   = '<p>Our Dolphins coverage.</p>';
$GLOBALS['pages']         = array( 909 => $sm_root, 910 => $sm_teams, 911 => $sm_bills, 912 => $sm_fins );
$GLOBALS['pages_by_path'] = array();

$sitemap = apply_filters( 'rank_math/sitemap/page_content', '' );
is( false !== strpos( $sitemap, 'https://example.com/p/911/stats/' ), true, 'a team hub gets its section URLs' );
is( false !== strpos( $sitemap, 'https://example.com/p/911/usage/' ), true, 'the Usage report is in the sitemap' );
is( false === strpos( $sitemap, '/p/912/' ), true, 'a page at a team slug without the hub shortcode gets none' );

$GLOBALS['pages']         = $saved_pages;
$GLOBALS['pages_by_path'] = $saved_by_path;
if ( null === $saved_pages ) {
	unset( $GLOBALS['pages'] );
}

/*
 * The season rollover's retitle. It knew only the OLD generated title, so the
 * current one read as custom the moment the season moved on and all 32 hubs
 * stayed on last season's year.
 */
echo "\nthe hub retitle recognises both generated titles, any season\n";

$patriots = 'New England Patriots';
is( statchasers_team_title_is_generated( '2025 New England Patriots Fantasy Football Hub | StatChasers', $patriots ), true, 'the old template' );
is( statchasers_team_title_is_generated( 'New England Patriots 2026: Record, Schedule, Stats & Fantasy Football | StatChasers', $patriots ), true, 'the current template' );
is( statchasers_team_title_is_generated( 'New England Patriots 2025: Record, Schedule, Stats & Fantasy Football | StatChasers', $patriots ), true, 'the current template on an earlier season' );
is( statchasers_team_title_is_generated( '', $patriots ), true, 'no title' );
is( statchasers_team_title_is_generated( statchasers_team_section_meta( 'new-england-patriots', '' )['title'] . ' | StatChasers', $patriots ), true, 'exactly what the builder writes today' );
is( statchasers_team_title_is_generated( 'Patriots 2026: Our Take | StatChasers', $patriots ), false, 'a custom title stays custom' );
is( statchasers_team_title_is_generated( 'New England Patriots 2026: Record, Schedule, Stats & Fantasy Football', $patriots ), false, 'even one a suffix away' );
is( statchasers_team_title_is_generated( 'Miami Dolphins 2026: Record, Schedule, Stats & Fantasy Football | StatChasers', $patriots ), false, 'and another team\'s title is not this team\'s' );

/*
 * The other groups. Their failures are this run's failures - a split that only
 * reported the half it felt like running would be worse than not splitting.
 */
foreach ( array( 'containers', 'week', 'weekstray', 'leak', 'headings', 'playersection', 'rules', 'playerlinks', 'sos', 'sosleak', 'rhr', 'rhrleak' ) as $child_group ) {
	$child = array();
	$code  = 0;
	exec(
		'STATCHASERS_SMOKE_GROUP=' . $child_group . ' ' . escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __FILE__ ) . ' 2>&1',
		$child,
		$code
	);

	foreach ( $child as $line ) {
		// The child re-announces the load and prints its own verdict line. Both
		// are this process's to print, once, about every group.
		if ( 'LOADED OK' === $line || 'all passed' === $line || preg_match( '/^\d+ FAILED$/', $line ) ) {
			continue;
		}
		echo $line . "\n";
	}

	if ( 0 !== $code ) {
		// The count is in the child's own tally, which is not reachable from
		// here. One is enough to fail the build, and the lines above say which.
		$fail++;
	}
}

echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
exit( $fail ? 1 : 0 );
