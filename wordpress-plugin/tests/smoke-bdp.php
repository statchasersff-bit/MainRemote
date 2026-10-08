<?php
/**
 * Blog Designer Pack's stylesheets: dequeued where it is not, kept where it is.
 *
 * The verdict is pure and the bookkeeping has a reset, so every case here is
 * one process. Each case builds a request (the queried post, the Theme
 * Builder layouts, the widgets), runs the enqueue-time hook against a queue
 * that holds the plugin's three handles, and reads the queue back.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_bdp_dequeue' ) ) {
	fwrite( STDERR, "smoke-bdp.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

/** Divi's Theme Builder accessor, answering with whatever the case set. */
function et_theme_builder_get_template_layouts() {
	return $GLOBALS['tb_layouts'] ?? array();
}

/** A request: the queried post's content, plus what else the case says. */
function bdp_request( string $content, array $extra = array() ): void {
	statchasers_bdp_state_reset();
	$post                           = new WP_Post();
	$post->ID                       = 500;
	$post->post_content             = $content;
	$GLOBALS['page']                = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );
	$GLOBALS['tb_layouts']          = $extra['layouts'] ?? array();
	$GLOBALS['active_widgets']      = $extra['widgets'] ?? array();
	$GLOBALS['post_content_by_id']  = $extra['posts'] ?? array();
	$GLOBALS['inline_styles']       = array();
	$GLOBALS['styles']              = array( 'inf-font-awesome' => true, 'owl-carousel' => true, 'bdpp-public-style' => true );
	$_GET                           = array();
	statchasers_bdp_dequeue();
}

/** The queue after the hook, as the three handles' presence. */
function bdp_queue(): array {
	return array(
		'fa'     => wp_style_is( 'inf-font-awesome' ),
		'owl'    => wp_style_is( 'owl-carousel' ),
		'public' => wp_style_is( 'bdpp-public-style' ),
	);
}

$none = array( 'fa' => false, 'owl' => false, 'public' => false );
$kept = array( 'fa' => false, 'owl' => true, 'public' => true );

echo "\nwhat uses Blog Designer Pack\n";

bdp_request( '<p>A team hub.</p>[statchasers_team team="buf"]' );
is( bdp_queue(), $none, 'a page without it loses all three stylesheets' );
is( statchasers_bdp_state( 'dequeued' ), true, 'and remembers that it did' );

bdp_request( '[et_pb_section][et_pb_text][bdp_post grid="3" limit="6"][/et_pb_text][/et_pb_section]' );
is( bdp_queue(), $kept, 'a Divi page with [bdp_post] in a Text module keeps the two layout stylesheets, not Font Awesome' );
is( isset( $GLOBALS['inline_styles']['bdpp-public-style'] ), true, 'and gets the SVG sizing rules inline on the public stylesheet' );
is( statchasers_bdp_state( 'dequeued' ), false, 'nothing to bring back later' );

foreach ( array( 'bdp_post_list', 'pld_post_list', 'bdp_post_gridbox', 'bdp_post_slider', 'bdp_post_carousel', 'bdp_masonry', 'bdp_ticker', 'bdpp_tmpl' ) as $tag ) {
	bdp_request( "[$tag limit=\"5\"]" );
	is( bdp_queue(), $kept, "[$tag] counts" );
}

bdp_request( '[bdp_posts limit="5"]' );
is( bdp_queue(), $none, '[bdp_posts] is not one of them: tag boundaries hold' );

bdp_request( '<!-- wp:bdpp/bdpp-layout-selector {"layout_id":12} /-->' );
is( bdp_queue(), $kept, 'the block counts' );

bdp_request( '[et_pb_section global_module="77"][/et_pb_section]', array( 'posts' => array( 77 => '[bdp_ticker limit="5"]' ) ) );
is( bdp_queue(), $kept, 'a Divi global module carrying a ticker counts' );

bdp_request( '<!-- wp:block {"ref":88} /-->', array( 'posts' => array( 88 => '[bdp_post_list]' ) ) );
is( bdp_queue(), $kept, 'a reusable block carrying a list counts' );

bdp_request( '[et_pb_section global_module="1"][/et_pb_section]', array( 'posts' => array( 1 => '[et_pb_section global_module="2"][/et_pb_section]', 2 => '[et_pb_section global_module="3"][/et_pb_section]', 3 => '[bdp_post]' ) ) );
is( bdp_queue(), $none, 'but references are followed two levels, not forever' );

bdp_request( '<p>An article.</p>', array( 'layouts' => array( 'et_template' => 9, 'et_header_layout' => array( 'id' => 31, 'enabled' => true, 'override' => true ) ), 'posts' => array( 31 => '[et_pb_section][bdp_ticker][/et_pb_section]' ) ) );
is( bdp_queue(), $kept, 'a ticker in the Theme Builder header keeps them on a page whose content has none' );

bdp_request( '<p>An article.</p>', array( 'layouts' => array( 'et_header_layout' => array( 'id' => 31, 'enabled' => false, 'override' => true ) ), 'posts' => array( 31 => '[bdp_ticker]' ) ) );
is( bdp_queue(), $none, 'a disabled layout does not' );

bdp_request( '<p>An article.</p>', array( 'widgets' => array( 'bdpp-post-widget' ) ) );
is( bdp_queue(), $kept, 'an active Blog Designer Pack widget keeps them everywhere' );

bdp_request( '<p>An article.</p>', array( 'widgets' => array( 'text' ) ) );
is( bdp_queue(), $none, 'some other widget does not' );

statchasers_bdp_state_reset();
$GLOBALS['styles'] = array( 'inf-font-awesome' => true, 'owl-carousel' => true, 'bdpp-public-style' => true );
$_GET              = array( 'et_fb' => '1' );
statchasers_bdp_dequeue();
is( bdp_queue(), array( 'fa' => true, 'owl' => true, 'public' => true ), 'the Visual Builder keeps all three' );
$_GET = array();

add_filter( 'statchasers_bdp_page_uses_plugin', '__return_true' );
bdp_request( '<p>Forced.</p>' );
is( bdp_queue(), $kept, 'the filter can force a page to keep them' );
array_pop( $GLOBALS['hooks']['statchasers_bdp_page_uses_plugin'] );

add_filter( 'statchasers_bdp_inline_icons', '__return_false' );
bdp_request( '[bdp_post]' );
is( bdp_queue(), array( 'fa' => true, 'owl' => true, 'public' => true ), 'with icon inlining off, a page that uses it keeps Font Awesome too' );
is( isset( $GLOBALS['inline_styles']['bdpp-public-style'] ), false, 'and no SVG rules are printed' );
bdp_request( '<p>Nothing.</p>' );
is( bdp_queue(), $none, 'while a page that does not still loses all three' );
array_pop( $GLOBALS['hooks']['statchasers_bdp_inline_icons'] );

echo "\nthe icons\n";

$meta = '<span class="bdpp-post-meta-data bdpp-post-author"><i class="bdpp-fa fa-solid fa-user"></i>Mak</span>'
	. '<span class="bdpp-post-date"><i class="bdpp-fa fa-regular fa-clock"></i>Oct 8</span>';
$out  = statchasers_bdp_inline_icons( $meta );
is( substr_count( $out, '<svg ' ), 2, 'both meta icons become SVGs' );
is( false === strpos( $out, 'fa-solid' ) && false === strpos( $out, 'fa-regular' ) && false === strpos( $out, 'fa-user' ), true, 'the font classes come off' );
is( false !== strpos( $out, '<i class="bdpp-fa scbdp-icon scbdp-icon-user" aria-hidden="true"><svg ' ), true, 'the plugin\'s own hook class stays, with the SVG inside the <i>' );
is( false !== strpos( $out, 'viewBox="0 0 448 512"' ) && false !== strpos( $out, 'viewBox="0 0 512 512"' ), true, 'each icon draws at its own viewBox' );

$badge = '<span class="bdpp-format-icon"><i class="bdpp-post-icon fa-solid fa-thumbtack"></i></span>';
is( false !== strpos( statchasers_bdp_inline_icons( $badge ), '<i class="bdpp-post-icon scbdp-icon scbdp-icon-thumbtack" aria-hidden="true"><svg ' ), true, 'the post-format badge keeps bdpp-post-icon, which the plugin sizes' );

$more = '<div class="bdpp-load-more">Load More <i class="bdpp-fa fa-solid fa-chevron-down bdpp-load-more-icon"></i> <span class="bdpp-loader"></span></div>';
is( false !== strpos( statchasers_bdp_inline_icons( $more ), 'class="bdpp-fa bdpp-load-more-icon scbdp-icon scbdp-icon-chevron-down"' ), true, 'Load More keeps its two hooks around the chevron' );

foreach ( array( 'user', 'clock', 'comments', 'folder-open', 'tags', 'play', 'music', 'quote-left', 'image', 'link', 'thumbtack', 'chevron-down' ) as $name ) {
	is( '' !== statchasers_bdp_icon_svg( $name ), true, "$name is drawn" );
}

statchasers_bdp_state_reset();
$odd = '<i class="bdpp-fa fa-solid fa-rocket"></i>';
is( statchasers_bdp_inline_icons( $odd ), $odd, 'an icon outside the twelve is left exactly as it was' );
is( statchasers_bdp_state( 'needs_fa' ), true, 'and noted, so Font Awesome is printed late' );

is( statchasers_bdp_inline_icons( '<i class="fa-solid fa-user">x</i>' ), '<i class="fa-solid fa-user">x</i>', 'an <i> with content is not an icon' );
is( statchasers_bdp_inline_icons( '<i class="et-pb-icon"></i>' ), '<i class="et-pb-icon"></i>', 'and a Divi icon is none of our business' );

$twice = statchasers_bdp_inline_icons( statchasers_bdp_inline_icons( $meta ) );
is( $twice, $out, 'running twice (a layout inside [bdpp_tmpl]) changes nothing the second time' );

echo "\nthe shortcode filter\n";

statchasers_bdp_state_reset();
is( statchasers_bdp_filter_shortcode( $meta, 'statchasers_team' ), $meta, 'another plugin\'s shortcode passes through untouched' );
is( statchasers_bdp_state( 'rendered' ), false, 'and does not count as a render' );
is( statchasers_bdp_filter_shortcode( $meta, 'bdp_post' ), $out, 'a Blog Designer Pack shortcode is redrawn' );
is( statchasers_bdp_state( 'rendered' ), true, 'and counts' );

echo "\nthe safety net\n";

bdp_request( '<p>A template calls do_shortcode itself.</p>' );
is( bdp_queue(), $none, 'dequeued at enqueue time' );
statchasers_bdp_filter_shortcode( '[grid]', 'bdp_post' );
statchasers_bdp_late_styles();
is( bdp_queue(), $kept, 'a render after all brings the two layout stylesheets back for the footer' );
is( isset( $GLOBALS['inline_styles']['bdpp-public-style'] ), true, 'with the SVG rules' );

bdp_request( '<p>Nothing renders.</p>' );
statchasers_bdp_late_styles();
is( bdp_queue(), $none, 'no render, nothing comes back' );

bdp_request( '[bdp_post]' );
statchasers_bdp_filter_shortcode( '<i class="bdpp-fa fa-solid fa-rocket"></i>', 'bdp_post' );
statchasers_bdp_late_styles();
is( bdp_queue(), array( 'fa' => true, 'owl' => true, 'public' => true ), 'an unknown icon brings Font Awesome back, late' );

echo "\nthe load-more reply\n";

$reply = json_encode( array( 'status' => 1, 'data' => $meta, 'last_page' => 0, 'msg' => 'Success' ) );
$fixed = json_decode( statchasers_bdp_rewrite_load_more( $reply ), true );
is( $fixed['data'], $out, 'the cards in the JSON reply are redrawn' );
is( $fixed['msg'], 'Success', 'and the rest of the object survives' );
is( statchasers_bdp_rewrite_load_more( '0' ), '0', 'a reply that is not the object passes through' );
is( statchasers_bdp_rewrite_load_more( '{"status":0,"msg":"Sorry"}' ), '{"status":0,"msg":"Sorry"}', 'as does one with no cards' );

echo "\nthe widget wrapper\n";

$GLOBALS['wp_registered_widgets'] = array(
	'bdpp-post-widget-2' => array( 'callback' => array( new class { public $id_base = 'bdpp-post-widget'; public function display_callback() { echo '<ul><li><i class="bdpp-fa fa-solid fa-user"></i>Mak</li></ul>'; } }, 'display_callback' ) ),
	'text-3'             => array( 'callback' => array( new class { public $id_base = 'text'; public function display_callback() { echo 'text'; } }, 'display_callback' ) ),
);
statchasers_bdp_state_reset();
$params = statchasers_bdp_wrap_widget( array( array( 'widget_id' => 'text-3' ) ) );
is( is_array( $GLOBALS['wp_registered_widgets']['text-3']['callback'] ), true, 'another widget keeps its own callback' );
$params = statchasers_bdp_wrap_widget( array( array( 'widget_id' => 'bdpp-post-widget-2' ) ) );
is( $params, array( array( 'widget_id' => 'bdpp-post-widget-2' ) ), 'the arguments are handed back unchanged' );
ob_start();
call_user_func( $GLOBALS['wp_registered_widgets']['bdpp-post-widget-2']['callback'], array(), array() );
$widget_out = ob_get_clean();
is( substr_count( $widget_out, '<svg ' ), 1, 'the Blog Designer Pack widget\'s output is redrawn' );
is( statchasers_bdp_state( 'rendered' ), true, 'and counts as a render' );
