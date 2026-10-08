<?php
/**
 * Divi Supreme's and TablePress's stylesheets: dequeued where they are not
 * used, kept where they are.
 *
 * Every case is one process: the scan is pure and reads only the request the
 * case builds (the queried post, the Theme Builder layouts, the widget
 * options), then runs the enqueue-time hook against a queue that holds the
 * plugins' handles and reads the queue back.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_host_css_trim' ) ) {
	fwrite( STDERR, "smoke-hostcss.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

/** Divi's Theme Builder accessor, answering with whatever the case set. */
function et_theme_builder_get_template_layouts() {
	return $GLOBALS['tb_layouts'] ?? array();
}

/** TablePress, enough of it: a typed static controller whose enqueue_css() is counted. */
class TablePress {
	public static object $controller;
}
class TablePress_Frontend_Controller_Stub {
	public $calls = 0;
	public function enqueue_css(): void { $this->calls++; }
}
define( 'DSM_VERSION', '2.5.64' );

/** A request: the queried post's content, plus what else the case says. */
function hostcss_request( string $content, array $extra = array() ): void {
	$post               = new WP_Post();
	$post->ID           = 500;
	$post->post_content = $content;
	$GLOBALS['page']               = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );
	$GLOBALS['tb_layouts']         = $extra['layouts'] ?? array();
	$GLOBALS['post_content_by_id'] = $extra['posts'] ?? array();
	$GLOBALS['options']            = $extra['options'] ?? array();
	$GLOBALS['inline_styles']      = array();
	$GLOBALS['styles']             = array( 'supreme-modules-for-divi-styles' => true, 'magnific-popup' => true, 'tablepress-default' => true );
	$GLOBALS['wp_styles']          = (object) array( 'registered' => array( 'magnific-popup' => (object) array( 'ver' => $extra['magnific'] ?? '2.5.64' ) ) );
	$_GET                          = array();
	TablePress::$controller        = new TablePress_Frontend_Controller_Stub();
	statchasers_host_css_trim();
}

/** The queue after the hook. */
function hostcss_queue(): array {
	return array(
		'dsm'      => wp_style_is( 'supreme-modules-for-divi-styles' ),
		'magnific' => wp_style_is( 'magnific-popup' ),
		'tp'       => wp_style_is( 'tablepress-default' ),
	);
}

$none = array( 'dsm' => false, 'magnific' => false, 'tp' => true );
$dsm  = array( 'dsm' => true, 'magnific' => true, 'tp' => true );

echo "\nthe scan\n";

$f = statchasers_host_css_features( '[et_pb_section][et_pb_text]<p>A hub.</p>[statchasers_team team="buf"][/et_pb_text][/et_pb_section]' );
is( $f, array( 'dsm' => false, 'tablepress' => false ), 'a Divi page mounting a tool uses neither' );
is( statchasers_host_css_features( '[dsm_flipbox title="x"][/dsm_flipbox]' )['dsm'], true, 'a Divi Supreme module counts' );
is( statchasers_host_css_features( '[et_pb_image src="a.jpg" dsm_image_zoom="on"]' )['dsm'], true, 'a Divi Supreme extension setting on a Divi module counts' );
is( statchasers_host_css_features( '<div class="dsm-badge">x</div>' )['dsm'], true, 'hand-written markup naming its classes counts' );
is( statchasers_host_css_features( '<style>.scfa-sec{--scfa-gold:#f3c623}</style>' )['dsm'], false, 'our own tokens do not' );
is( statchasers_host_css_features( 'https://cdsm_x.example/' )['dsm'], false, 'nor dsm_ inside a longer word' );
is( statchasers_host_css_features( '[table id=3 /]' )['tablepress'], true, '[table id=3 /] counts' );
is( statchasers_host_css_features( '[table-info id=3 field="name" /]' )['tablepress'], true, '[table-info] counts' );
is( statchasers_host_css_features( '<!-- wp:tablepress/table {"id":"3"} /-->' )['tablepress'], true, 'the block counts' );
is( statchasers_host_css_features( '<table class="scp-table">' )['tablepress'], false, 'an HTML table does not' );
is( statchasers_host_css_features( '[tablet_only]x[/tablet_only]' )['tablepress'], false, 'nor another shortcode starting with table' );

echo "\nthe list\n";

is( statchasers_host_css_dequeue_list( array( 'dsm' => false ), '2.5.64', '2.5.64' ), array( 'supreme-modules-for-divi-styles', 'magnific-popup' ), 'no Divi Supreme: both of its handles go' );
is( statchasers_host_css_dequeue_list( array( 'dsm' => true ), '2.5.64', '2.5.64' ), array(), 'Divi Supreme on the page: both stay' );
is( statchasers_host_css_dequeue_list( array( 'dsm' => false ), '4.27.9', '2.5.64' ), array( 'supreme-modules-for-divi-styles' ), 'a magnific-popup Divi registered itself is not ours to drop' );
is( statchasers_host_css_dequeue_list( array( 'dsm' => false ), '', '' ), array( 'supreme-modules-for-divi-styles' ), 'with Divi Supreme inactive nothing is proven about magnific-popup' );

echo "\nwhat the page uses\n";

hostcss_request( '<p>A team hub.</p>[statchasers_team team="buf"]' );
is( hostcss_queue(), $none, 'a page without either loses the Divi Supreme stylesheet and its magnific-popup' );
is( $GLOBALS['inline_styles']['statchasers-host-css'] ?? '', 'button::-moz-focus-inner{padding:0;border:0}', 'and keeps the one global rule magnific_popup.css carried' );
is( TablePress::$controller->calls, 0, 'TablePress is not asked for its CSS' );

hostcss_request( '[et_pb_section][dsm_flipbox title="x"][/dsm_flipbox][/et_pb_section]' );
is( hostcss_queue(), $dsm, 'a page with a Divi Supreme module keeps both' );
is( isset( $GLOBALS['inline_styles']['statchasers-host-css'] ), false, 'and prints no replacement rule' );

hostcss_request( '<p>An article.</p>[table id=5 /]' );
is( hostcss_queue(), $none, 'a page with a TablePress table still loses the Divi Supreme pair' );
is( TablePress::$controller->calls, 1, 'and asks TablePress to enqueue its CSS in the head' );

hostcss_request( '<p>An article.</p>', array( 'layouts' => array( 'et_template' => 9, 'et_header_layout' => array( 'id' => 31, 'enabled' => true, 'override' => true ) ), 'posts' => array( 31 => '[et_pb_section][dsm_menu][/et_pb_section]' ) ) );
is( hostcss_queue(), $dsm, 'a Divi Supreme module in the Theme Builder header keeps them on a page whose content has none' );

hostcss_request( '<p>An article.</p>', array( 'layouts' => array( 'et_header_layout' => array( 'id' => 31, 'enabled' => false, 'override' => true ) ), 'posts' => array( 31 => '[dsm_menu]' ) ) );
is( hostcss_queue(), $none, 'a disabled layout does not' );

hostcss_request( '[et_pb_section global_module="77"][/et_pb_section]', array( 'posts' => array( 77 => '[dsm_badges]' ) ) );
is( hostcss_queue(), $dsm, 'a Divi global module carrying one counts' );

hostcss_request( '<p>An article.</p>', array( 'options' => array( 'sidebars_widgets' => array( 'wp_inactive_widgets' => array( 'block-9' ), 'sidebar-1' => array( 'block-2' ), 'array_version' => 3 ), 'widget_block' => array( 2 => array( 'content' => '<!-- wp:tablepress/table {"id":"4"} /-->' ), 9 => array( 'content' => '[dsm_badges]' ) ) ) ) );
is( hostcss_queue(), $none, 'a widget in the inactive bin does not count' );
is( TablePress::$controller->calls, 1, 'an active block widget carrying a table does' );

hostcss_request( '<p>An article.</p>', array( 'options' => array( 'sidebars_widgets' => array( 'sidebar-1' => array( 'text-3' ) ), 'widget_text' => array( 3 => array( 'text' => '[dsm_typing_effect]' ) ) ) ) );
is( hostcss_queue(), $dsm, 'an active text widget carrying a Divi Supreme module counts' );

hostcss_request( '<p>An article.</p>', array( 'magnific' => '4.27.9' ) );
is( hostcss_queue(), array( 'dsm' => false, 'magnific' => true, 'tp' => true ), 'a magnific-popup registered by Divi itself is left alone' );
is( isset( $GLOBALS['inline_styles']['statchasers-host-css'] ), false, 'and nothing is printed in its place' );

$GLOBALS['styles'] = array( 'supreme-modules-for-divi-styles' => true, 'magnific-popup' => true, 'tablepress-default' => true );
$GLOBALS['page']   = array( 'singular' => true, 'admin' => false, 'post' => new WP_Post() );
$_GET              = array( 'et_fb' => '1' );
statchasers_host_css_trim();
is( hostcss_queue(), $dsm, 'the Visual Builder keeps everything' );
$_GET = array();

$GLOBALS['page'] = array( 'singular' => true, 'admin' => true, 'post' => new WP_Post() );
statchasers_host_css_trim();
is( hostcss_queue(), $dsm, 'so does wp-admin' );

add_filter( 'statchasers_host_css_features', static function ( $f ) { $f['dsm'] = true; return $f; } );
hostcss_request( '<p>Forced.</p>' );
is( hostcss_queue(), $dsm, 'the features filter can force a page to keep them' );
array_pop( $GLOBALS['hooks']['statchasers_host_css_features'] );

add_filter( 'statchasers_host_css_dequeue', '__return_empty_array' );
hostcss_request( '<p>Off.</p>' );
is( hostcss_queue(), $dsm, 'the dequeue filter can switch the whole thing off' );
array_pop( $GLOBALS['hooks']['statchasers_host_css_dequeue'] );

is( in_array( '__return_false', $GLOBALS['hooks']['tablepress_frontend_legacy_css_loading'] ?? array(), true ), true, 'TablePress is told to load its CSS where a table renders' );
