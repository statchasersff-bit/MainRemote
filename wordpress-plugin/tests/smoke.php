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
function get_post() { return $GLOBALS['page']['current'] ?? null; }
function get_queried_object_id() { $o = get_queried_object(); return $o instanceof WP_Post ? (int) $o->ID : 0; }
/*
 * Tag boundaries matter here, unlike most of these stubs. WordPress matches a
 * whole registered tag; a strpos for "[statchasers_team" also finds
 * "[statchasers_team_index", which would make an index page answer yes to "is
 * this a team hub" — the exact confusion the two predicates exist to avoid. A
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
function check_admin_referer( $a ) {}
function wp_safe_redirect( $u ) {}
function admin_url( $p = '' ) { return 'https://example.com/wp-admin/' . $p; }
function add_query_arg( $k, $v, $u ) { return $u . '?' . $k . '=' . $v; }
function get_permalink( $id ) { return 'https://example.com/p/' . $id . '/'; }
function get_post_status( $id ) { return 'publish'; }
function get_page_by_path( $p ) { return $GLOBALS['pages_by_path'][ $p ] ?? null; }
function get_page_uri( $id ) { return 'nfl'; }
function wp_insert_post( $a, $b = false ) { return 1; }
function wp_update_post( $a ) { return 1; }
function is_wp_error( $t ) { return false; }
function wp_remote_get( $u, $a = array() ) { return array(); }
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
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_create_nonce( $a = '' ) { return 'nonce'; }
function wp_style_is( $h, $l = 'enqueued' ) { return (bool) ( $GLOBALS['styles'][ $h ] ?? false ); }
function wp_script_is( $h, $l = 'enqueued' ) { return false; }
function check_ajax_referer( $a = '', $b = false, $c = true ) { return true; }
function wp_send_json_success( $d = null, $s = null ) {}
function wp_send_json_error( $d = null, $s = null ) {}
function wp_parse_args( $a, $b ) { return array_merge( $b, (array) $a ); }
function shortcode_atts( $pairs, $atts, $tag = '' ) { return array_merge( $pairs, (array) $atts ); }
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

class WP_Post { public $ID = 7; public $post_title = ''; public $post_content = ''; public $post_name = ''; public $post_type = 'page'; }
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

require_once "$dir/statchasers-assets.php";
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

/*
 * Two groups, two processes.
 *
 * Several predicates memoise their answer in a `static` — which is right in
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

if ( 'containers' === $group ) {
	require __DIR__ . '/smoke-containers.php';
	echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
	exit( $fail ? 1 : 0 );
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

/*
 * The check is asked per page type.
 *
 * The bug this covers shipped: one measurement taken on a team hub answered for
 * player pages too, so a site whose hub title comes from a builder layout (no
 * H1) and whose player pages come from page.php (one H1) printed a second H1 on
 * every player page — on the setting whose whole job is to prevent that.
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
 * build, which is only offered while pages are missing — so a container still
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

echo "\nwebfont\n";
is( str_contains( statchasers_font_url(), 'family=Inter' ), true, 'Inter is the family asked for' );
is( statchasers_font_dependency(), array( STATCHASERS_FONT_HANDLE ), 'every stylesheet depends on it' );

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
	'the lead alone is not enough — the wall of links is the signature'
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
 * The second group. Its failures are this run's failures — a split that only
 * reported the half it felt like running would be worse than not splitting.
 */
$child = array();
$code  = 0;
exec(
	'STATCHASERS_SMOKE_GROUP=containers ' . escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __FILE__ ) . ' 2>&1',
	$child,
	$code
);

foreach ( $child as $line ) {
	// The child re-announces the load and prints its own verdict line. Both are
	// this process's to print, once, about both groups.
	if ( 'LOADED OK' === $line || 'all passed' === $line || preg_match( '/^\d+ FAILED$/', $line ) ) {
		continue;
	}
	echo $line . "\n";
}

if ( 0 !== $code ) {
	// The count is in the child's own tally, which is not reachable from here.
	// One is enough to fail the build, and the lines above say which.
	$fail++;
}

echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
exit( $fail ? 1 : 0 );
