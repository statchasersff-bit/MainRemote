<?php
/**
 * Blog Designer Pack's stylesheets, only where Blog Designer Pack is.
 *
 * Blog Designer Pack (the post grid / slider / ticker plugin) enqueues three
 * stylesheets on every front-end request, from BDP_Scripts::bdpp_public_style_script
 * on wp_enqueue_scripts at priority 10, with no look at the page:
 *
 *   inf-font-awesome   assets/css/font-awesome.min.css   Font Awesome 7 Free, ~75 KB,
 *                                                        plus a woff2 per style it draws
 *   owl-carousel       assets/css/owl.carousel.min.css   the carousel/slider chrome
 *   bdpp-public-style  assets/css/bdpp-public.min.css    the layouts themselves
 *
 * Those are the handles as the plugin registers them (includes/class-bdpp-scripts.php,
 * 4.0.12), and as the live page prints them: the <link> ids are the handles
 * with "-css" appended. Its scripts are different: they are registered there
 * and enqueued by the shortcode that needs them, so a page without a shortcode
 * already loads no Blog Designer Pack script. Only the styles leak.
 *
 * WHAT COUNTS AS USING IT. A page uses the plugin when something that will
 * render on it carries one of its shortcodes, its block, or its widgets:
 *
 *   - the queried post's own content (a Divi page is shortcodes in post_content,
 *     so a [bdp_post] inside a Text or Code module is found there too);
 *   - the Divi Theme Builder layouts applied to this request, header, body and
 *     footer, since a ticker in the header renders on pages whose content
 *     never mentions it;
 *   - Divi global modules and block-editor reusable blocks referenced from any
 *     of those, one level down;
 *   - an active Blog Designer Pack widget, in any sidebar. Which pages print a
 *     sidebar is the theme's decision, so an active widget keeps the styles on
 *     every page rather than guess.
 *
 * Anything else dequeues them at wp_enqueue_scripts priority 100, after the
 * plugin has enqueued. The editors keep everything: the Divi Visual Builder
 * and the Customizer preview show a page that is about to change.
 *
 * THE SAFETY NET. Detection runs before the page renders, so a shortcode that
 * reaches the page some other way (a theme template calling do_shortcode, a
 * plugin printing one in a hook) would render unstyled. Every Blog Designer
 * Pack shortcode passes through the do_shortcode_tag filter, and its widgets
 * through a wrapped callback, so this file knows by wp_footer whether one
 * rendered; if it did on a page that dequeued, the two layout stylesheets are
 * enqueued again there and WordPress prints them late. A flash of unstyled
 * grid on a page the detection missed, never a permanently broken one.
 *
 * FONT AWESOME IS NEVER NEEDED. The plugin uses twelve icons from the whole
 * font, all printed from string literals in includes/bdpp-functions.php and
 * templates/pagination.php as an empty <i class="... fa-solid fa-user"></i>.
 * The same filter and wrapper that watch for a render swap each of those for
 * an inline SVG of the same icon (Font Awesome Free's own paths, CC BY 4.0,
 * attribution in statchasers_bdp_icon_paths()), and the AJAX "load more"
 * response gets the same treatment on its way out. So the Font Awesome
 * stylesheet is dequeued on every page, including the ones that keep the
 * other two. An <i> naming an icon this file does not know is left alone and
 * the stylesheet is enqueued late for it, which is the same safety net.
 *
 * The plugin's own settings offer a site-wide "disable Font Awesome / Owl
 * CSS" switch, which is all-or-nothing and the wrong tool for a page that
 * does use a carousel. If either is switched on, the handle is never
 * registered and the dequeue here is a no-op; the two do not fight.
 *
 * Filters:
 *   statchasers_bdp_page_uses_plugin  (bool)  force the verdict for a request
 *   statchasers_bdp_inline_icons      (bool)  false keeps Font Awesome on the
 *                                             pages that use the plugin and
 *                                             leaves its <i> markup alone
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The three style handles, exactly as includes/class-bdpp-scripts.php registers them. */
const STATCHASERS_BDP_STYLE_FONT_AWESOME = 'inf-font-awesome';
const STATCHASERS_BDP_STYLE_OWL          = 'owl-carousel';
const STATCHASERS_BDP_STYLE_PUBLIC       = 'bdpp-public-style';

/** The layout stylesheets: the two a page that renders the plugin must keep. */
const STATCHASERS_BDP_LAYOUT_STYLES = array( STATCHASERS_BDP_STYLE_OWL, STATCHASERS_BDP_STYLE_PUBLIC );

/** Every shortcode the plugin registers (includes/shortcodes/*.php, 4.0.12). */
const STATCHASERS_BDP_SHORTCODES = array(
	'bdp_post',          // post grid
	'bdp_post_list',     // post list
	'pld_post_list',     // the post list's old name, still registered
	'bdp_post_gridbox',  // grid box
	'bdp_post_slider',   // slider
	'bdp_post_carousel', // carousel
	'bdp_masonry',       // masonry
	'bdp_ticker',        // ticker
	'bdpp_tmpl',         // a saved layout, which is one of the above stored as a post
);

/** The block-editor block (includes/integrations/blocks), which renders [bdpp_tmpl]. */
const STATCHASERS_BDP_BLOCK = 'bdpp/bdpp-layout-selector';

/** The two widgets' id_base values (includes/widgets/class-bdpp-*-widget.php). */
const STATCHASERS_BDP_WIDGETS = array( 'bdpp-post-widget', 'bdpp-post-scrolling-widget' );

/** How far a global-module or reusable-block reference is followed. */
const STATCHASERS_BDP_REF_DEPTH = 2;

/**
 * This request's bookkeeping: what was dequeued, what rendered anyway.
 *
 * Keys: `dequeued` (the layout stylesheets were removed), `rendered` (a
 * shortcode or widget produced output), `needs_fa` (an icon this file could
 * not draw was met). A static rather than globals so nothing else can write
 * it; the tests reset it between cases with statchasers_bdp_state_reset().
 */
function statchasers_bdp_state( string $key = '', $set = null ) {
	static $state = array();

	if ( null !== $set ) {
		$state[ $key ] = $set;
	}

	if ( '' === $key ) {
		return $state;
	}

	return $state[ $key ] ?? false;
}

/** Forget this request's bookkeeping. For the tests, which run many requests in one process. */
function statchasers_bdp_state_reset(): void {
	foreach ( array( 'dequeued', 'rendered', 'needs_fa' ) as $key ) {
		statchasers_bdp_state( $key, false );
	}
}

/**
 * Does this content carry the plugin?
 *
 * Shortcodes are matched by WordPress's own has_shortcode(), which respects
 * tag boundaries ([bdp_post] is not [bdp_posts]) and only matches tags that
 * are actually registered - so on a site that has deactivated the plugin the
 * answer is always no, which is right: nothing would render.
 *
 * References are followed one level at a time to a small depth: a Divi
 * global module (global_module="123" on any et_pb_* shortcode) and a reusable
 * block (<!-- wp:block {"ref":123} /-->) both keep their content on another
 * post. Two levels is one more than either builder nests in practice.
 */
function statchasers_bdp_content_uses_plugin( string $content, int $depth = 0 ): bool {
	if ( '' === trim( $content ) ) {
		return false;
	}

	foreach ( STATCHASERS_BDP_SHORTCODES as $tag ) {
		if ( has_shortcode( $content, $tag ) ) {
			return true;
		}
	}

	if ( function_exists( 'has_block' ) && has_block( STATCHASERS_BDP_BLOCK, $content ) ) {
		return true;
	}

	if ( $depth >= STATCHASERS_BDP_REF_DEPTH ) {
		return false;
	}

	$refs = array();
	if ( preg_match_all( '/global_module="(\d+)"/', $content, $m ) ) {
		$refs = array_merge( $refs, $m[1] );
	}
	if ( preg_match_all( '/<!--\s*wp:block\s+\{[^}]*"ref"\s*:\s*(\d+)/', $content, $m ) ) {
		$refs = array_merge( $refs, $m[1] );
	}

	foreach ( array_unique( array_map( 'intval', $refs ) ) as $ref ) {
		if ( $ref > 0 && statchasers_bdp_content_uses_plugin( (string) get_post_field( 'post_content', $ref ), $depth + 1 ) ) {
			return true;
		}
	}

	return false;
}

/**
 * The Divi Theme Builder layouts that will render on this request.
 *
 * et_theme_builder_get_template_layouts() answers for the current request
 * with one entry per layout kind (header, body, footer), each an array with
 * the layout post's id and whether it is enabled; the template's own id rides
 * along as a bare integer, which is skipped. Without Divi there is nothing to
 * ask and nothing to scan.
 *
 * @return int[] Layout post ids, enabled ones only.
 */
function statchasers_bdp_theme_builder_layout_ids(): array {
	if ( ! function_exists( 'et_theme_builder_get_template_layouts' ) ) {
		return array();
	}

	$ids = array();
	foreach ( (array) et_theme_builder_get_template_layouts() as $layout ) {
		if ( is_array( $layout ) && ! empty( $layout['enabled'] ) && ! empty( $layout['id'] ) ) {
			$ids[] = (int) $layout['id'];
		}
	}

	return $ids;
}

/** Is a front-end editor showing this page? Those keep everything. */
function statchasers_bdp_is_editor(): bool {
	if ( function_exists( 'is_customize_preview' ) && is_customize_preview() ) {
		return true;
	}

	if ( function_exists( 'et_core_is_fb_enabled' ) && et_core_is_fb_enabled() ) {
		return true;
	}

	// The Visual Builder's own flag, for a Divi whose helper is not loaded yet.
	return isset( $_GET['et_fb'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
}

/**
 * Will this request render Blog Designer Pack?
 *
 * Pure: it looks at the page and answers, remembering nothing, so one process
 * can be asked about many pages. The editors, the queried post, the Theme
 * Builder layouts and the widgets, in that order; the first yes wins.
 */
function statchasers_bdp_page_uses_plugin(): bool {
	$uses = statchasers_bdp_page_uses_plugin_raw();

	/**
	 * Filters whether the current request is treated as rendering Blog
	 * Designer Pack. true keeps its stylesheets; false dequeues them.
	 *
	 * @param bool $uses What this file found.
	 */
	return (bool) apply_filters( 'statchasers_bdp_page_uses_plugin', $uses );
}

/** The unfiltered verdict. */
function statchasers_bdp_page_uses_plugin_raw(): bool {
	if ( statchasers_bdp_is_editor() ) {
		return true;
	}

	if ( is_singular() ) {
		$post = get_queried_object();
		if ( $post instanceof WP_Post && statchasers_bdp_content_uses_plugin( (string) $post->post_content ) ) {
			return true;
		}
	}

	foreach ( statchasers_bdp_theme_builder_layout_ids() as $layout_id ) {
		if ( statchasers_bdp_content_uses_plugin( (string) get_post_field( 'post_content', $layout_id ) ) ) {
			return true;
		}
	}

	if ( function_exists( 'is_active_widget' ) ) {
		foreach ( STATCHASERS_BDP_WIDGETS as $id_base ) {
			if ( false !== is_active_widget( false, false, $id_base, true ) ) {
				return true;
			}
		}
	}

	return false;
}

/** Are the <i> icons being redrawn as SVG, which makes Font Awesome surplus everywhere? */
function statchasers_bdp_inline_icons_enabled(): bool {
	/**
	 * Filters whether Blog Designer Pack's Font Awesome icons are replaced
	 * with inline SVG. false keeps the font on the pages that use the plugin.
	 *
	 * @param bool $enabled Default true.
	 */
	return (bool) apply_filters( 'statchasers_bdp_inline_icons', true );
}

/**
 * The CSS that makes an inline SVG sit where the font glyph sat.
 *
 * Font Awesome's base class is an inline-block 1.25em wide, centered, with a
 * line-height of 1; the glyph itself is 1em tall on a baseline nudged down
 * an eighth. The plugin's own rules then size the post-format badge
 * (.bdpp-format-icon .bdpp-post-icon: 40px round, 18px type) with more
 * specificity than this, as they did over the font's, so the badge keeps
 * its circle and the SVG its 18px.
 */
function statchasers_bdp_icon_css(): string {
	return '.scbdp-icon{display:inline-block;width:1.25em;line-height:1;text-align:center;font-style:normal}'
		. '.scbdp-icon svg{width:1em;height:1em;fill:currentColor;vertical-align:-.125em;display:inline-block}';
}

/**
 * Dequeue what this page will not use. wp_enqueue_scripts, priority 100.
 *
 * After the plugin's own priority-10 enqueue. wp_dequeue_style() leaves the
 * handle registered, so the late enqueue in statchasers_bdp_late_styles()
 * can bring it back if a render turns up after all.
 */
function statchasers_bdp_dequeue(): void {
	// The editors keep all three, Font Awesome included: the Visual Builder
	// draws modules on the client from markup that never passed the filters.
	if ( is_admin() || statchasers_bdp_is_editor() ) {
		return;
	}

	$uses   = statchasers_bdp_page_uses_plugin();
	$inline = statchasers_bdp_inline_icons_enabled();

	if ( ! $uses ) {
		foreach ( STATCHASERS_BDP_LAYOUT_STYLES as $handle ) {
			wp_dequeue_style( $handle );
		}
		statchasers_bdp_state( 'dequeued', true );
	} elseif ( $inline ) {
		wp_add_inline_style( STATCHASERS_BDP_STYLE_PUBLIC, statchasers_bdp_icon_css() );
	}

	if ( ! $uses || $inline ) {
		wp_dequeue_style( STATCHASERS_BDP_STYLE_FONT_AWESOME );
	}
}
add_action( 'wp_enqueue_scripts', 'statchasers_bdp_dequeue', 100 );

/**
 * The safety net. wp_footer, priority 5: before wp_print_footer_scripts (20),
 * whose print_late_styles() prints whatever was enqueued after <head>.
 */
function statchasers_bdp_late_styles(): void {
	if ( statchasers_bdp_state( 'dequeued' ) && statchasers_bdp_state( 'rendered' ) ) {
		if ( statchasers_bdp_inline_icons_enabled() ) {
			wp_add_inline_style( STATCHASERS_BDP_STYLE_PUBLIC, statchasers_bdp_icon_css() );
		}
		foreach ( STATCHASERS_BDP_LAYOUT_STYLES as $handle ) {
			wp_enqueue_style( $handle );
		}
	}

	if ( statchasers_bdp_state( 'needs_fa' ) ) {
		wp_enqueue_style( STATCHASERS_BDP_STYLE_FONT_AWESOME );
	}
}
add_action( 'wp_footer', 'statchasers_bdp_late_styles', 5 );

/**
 * The twelve icons, as Font Awesome Free draws them.
 *
 * Font Awesome Free 7 by @fontawesome - https://fontawesome.com
 * Icons: CC BY 4.0 (https://fontawesome.com/license/free). Copyright Fonticons, Inc.
 *
 * Keyed by the fa-* class the plugin prints. Five are the post-meta row
 * (author, date, comments, category, tags), six are the post-format badge
 * (video, audio, quote, gallery, link, and the pin for everything else), and
 * the chevron is the "Load More" button.
 *
 * @return array<string, array{0: string, 1: string}> viewBox and path per icon.
 */
function statchasers_bdp_icon_paths(): array {
	return array(
		'user'         => array( '0 0 448 512', 'M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z' ),
		'clock'        => array( '0 0 512 512', 'M464 256a208 208 0 1 1 -416 0 208 208 0 1 1 416 0zM0 256a256 256 0 1 0 512 0 256 256 0 1 0 -512 0zM232 120l0 136c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2 280 120c0-13.3-10.7-24-24-24s-24 10.7-24 24z' ),
		'comments'     => array( '0 0 576 512', 'M384 144c0 97.2-86 176-192 176-26.7 0-52.1-5-75.2-14L35.2 349.2c-9.3 4.9-20.7 3.2-28.2-4.2s-9.2-18.9-4.2-28.2l35.6-67.2C14.3 220.2 0 183.6 0 144 0 46.8 86-32 192-32S384 46.8 384 144zm0 368c-94.1 0-172.4-62.1-188.8-144 120-1.5 224.3-86.9 235.8-202.7 83.3 19.2 145 88.3 145 170.7 0 39.6-14.3 76.2-38.4 105.6l35.6 67.2c4.9 9.3 3.2 20.7-4.2 28.2s-18.9 9.2-28.2 4.2L459.2 498c-23.1 9-48.5 14-75.2 14z' ),
		'folder-open'  => array( '0 0 576 512', 'M56 225.6L32.4 296.2 32.4 96c0-35.3 28.7-64 64-64l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4l117.3 0c35.3 0 64 28.7 64 64l0 16-365.4 0c-41.3 0-78 26.4-91.1 65.6zM477.8 448L99 448c-32.8 0-55.9-32.1-45.5-63.2l48-144C108 221.2 126.4 208 147 208l378.8 0c32.8 0 55.9 32.1 45.5 63.2l-48 144c-6.5 19.6-24.9 32.8-45.5 32.8z' ),
		'tags'         => array( '0 0 576 512', 'M401.2 39.1L549.4 189.4c27.7 28.1 27.7 73.1 0 101.2L393 448.9c-9.3 9.4-24.5 9.5-33.9 .2s-9.5-24.5-.2-33.9L515.3 256.8c9.2-9.3 9.2-24.4 0-33.7L367 72.9c-9.3-9.4-9.2-24.6 .2-33.9s24.6-9.2 33.9 .2zM32.1 229.5L32.1 96c0-35.3 28.7-64 64-64l133.5 0c17 0 33.3 6.7 45.3 18.7l144 144c25 25 25 65.5 0 90.5L285.4 418.7c-25 25-65.5 25-90.5 0l-144-144c-12-12-18.7-28.3-18.7-45.3zm144-85.5a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z' ),
		'play'         => array( '0 0 448 512', 'M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z' ),
		'music'        => array( '0 0 512 512', 'M468 7c7.6 6.1 12 15.3 12 25l0 304c0 44.2-43 80-96 80s-96-35.8-96-80 43-80 96-80c11.2 0 22 1.6 32 4.6l0-116.7-224 49.8 0 206.3c0 44.2-43 80-96 80s-96-35.8-96-80 43-80 96-80c11.2 0 22 1.6 32 4.6L128 96c0-15 10.4-28 25.1-31.2l288-64c9.5-2.1 19.4 .2 27 6.3z' ),
		'quote-left'   => array( '0 0 448 512', 'M0 216C0 149.7 53.7 96 120 96l8 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-8 0c-30.9 0-56 25.1-56 56l0 8 64 0c35.3 0 64 28.7 64 64l0 64c0 35.3-28.7 64-64 64l-64 0c-35.3 0-64-28.7-64-64L0 216zm256 0c0-66.3 53.7-120 120-120l8 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-8 0c-30.9 0-56 25.1-56 56l0 8 64 0c35.3 0 64 28.7 64 64l0 64c0 35.3-28.7 64-64 64l-64 0c-35.3 0-64-28.7-64-64l0-136z' ),
		'image'        => array( '0 0 448 512', 'M64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64L64 32zm64 80a48 48 0 1 1 0 96 48 48 0 1 1 0-96zM272 224c8.4 0 16.1 4.4 20.5 11.5l88 144c4.5 7.4 4.7 16.7 .5 24.3S368.7 416 360 416L88 416c-8.9 0-17.2-5-21.3-12.9s-3.5-17.5 1.6-24.8l56-80c4.5-6.4 11.8-10.2 19.7-10.2s15.2 3.8 19.7 10.2l26.4 37.8 61.4-100.5c4.4-7.1 12.1-11.5 20.5-11.5z' ),
		'link'         => array( '0 0 576 512', 'M419.5 96c-16.6 0-32.7 4.5-46.8 12.7-15.8-16-34.2-29.4-54.5-39.5 28.2-24 64.1-37.2 101.3-37.2 86.4 0 156.5 70 156.5 156.5 0 41.5-16.5 81.3-45.8 110.6l-71.1 71.1c-29.3 29.3-69.1 45.8-110.6 45.8-86.4 0-156.5-70-156.5-156.5 0-1.5 0-3 .1-4.5 .5-17.7 15.2-31.6 32.9-31.1s31.6 15.2 31.1 32.9c0 .9 0 1.8 0 2.6 0 51.1 41.4 92.5 92.5 92.5 24.5 0 48-9.7 65.4-27.1l71.1-71.1c17.3-17.3 27.1-40.9 27.1-65.4 0-51.1-41.4-92.5-92.5-92.5zM275.2 173.3c-1.9-.8-3.8-1.9-5.5-3.1-12.6-6.5-27-10.2-42.1-10.2-24.5 0-48 9.7-65.4 27.1L91.1 258.2c-17.3 17.3-27.1 40.9-27.1 65.4 0 51.1 41.4 92.5 92.5 92.5 16.5 0 32.6-4.4 46.7-12.6 15.8 16 34.2 29.4 54.6 39.5-28.2 23.9-64 37.2-101.3 37.2-86.4 0-156.5-70-156.5-156.5 0-41.5 16.5-81.3 45.8-110.6l71.1-71.1c29.3-29.3 69.1-45.8 110.6-45.8 86.6 0 156.5 70.6 156.5 156.9 0 1.3 0 2.6 0 3.9-.4 17.7-15.1 31.6-32.8 31.2s-31.6-15.1-31.2-32.8c0-.8 0-1.5 0-2.3 0-33.7-18-63.3-44.8-79.6z' ),
		'thumbtack'    => array( '0 0 384 512', 'M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29.5 0 10.3 134.1c37.1 21.2 65.8 56.4 78.2 99.7l3.8 13.4c2.8 9.7 .8 20-5.2 28.1S362 352 352 352L32 352c-10 0-19.5-4.7-25.5-12.7s-8-18.4-5.2-28.1L5 297.8c12.4-43.3 41-78.5 78.2-99.7L93.5 64 64 64C46.3 64 32 49.7 32 32zM160 400l64 0 0 112c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-112z' ),
		'chevron-down' => array( '0 0 448 512', 'M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z' ),
	);
}

/** One icon as an inline SVG, or '' for a name this file does not draw. */
function statchasers_bdp_icon_svg( string $name ): string {
	$paths = statchasers_bdp_icon_paths();
	if ( ! isset( $paths[ $name ] ) ) {
		return '';
	}

	list( $view_box, $d ) = $paths[ $name ];

	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' . esc_attr( $view_box ) . '" aria-hidden="true" focusable="false"><path d="' . esc_attr( $d ) . '"/></svg>';
}

/**
 * Redraw every empty Font Awesome <i> in a fragment of the plugin's output.
 *
 * Matches exactly what the plugin prints: an <i> whose class list names a
 * style (fa-solid or fa-regular) and an icon, with nothing inside. The
 * style and icon classes come off, so a Font Awesome stylesheet some other
 * plugin loads cannot draw a second glyph over the SVG; the plugin's own
 * hooks (bdpp-fa, bdpp-post-icon, bdpp-load-more-icon) stay, because its
 * CSS targets them. An icon outside the twelve is left exactly as it was and
 * noted, so the stylesheet that can draw it is printed late.
 */
function statchasers_bdp_inline_icons( string $html ): string {
	if ( '' === $html || false === strpos( $html, 'fa-' ) ) {
		return $html;
	}

	return (string) preg_replace_callback(
		'/<i\s+class="([^"]*\bfa-(?:solid|regular)\b[^"]*)"\s*><\/i>/',
		static function ( array $m ): string {
			$classes = preg_split( '/\s+/', trim( $m[1] ) ) ?: array();
			$name    = '';
			$kept    = array();

			foreach ( $classes as $class ) {
				if ( in_array( $class, array( 'fa', 'fas', 'far', 'fa-solid', 'fa-regular' ), true ) ) {
					continue;
				}
				if ( '' === $name && 0 === strpos( $class, 'fa-' ) ) {
					$name = substr( $class, 3 );
					continue;
				}
				$kept[] = $class;
			}

			$svg = statchasers_bdp_icon_svg( $name );
			if ( '' === $svg ) {
				statchasers_bdp_state( 'needs_fa', true );
				return $m[0];
			}

			$kept[] = 'scbdp-icon';
			$kept[] = 'scbdp-icon-' . $name;

			return '<i class="' . esc_attr( implode( ' ', $kept ) ) . '" aria-hidden="true">' . $svg . '</i>';
		},
		$html
	);
}

/**
 * Every shortcode's output passes here (do_shortcode_tag). The plugin's are
 * noted as rendered and, when icons are inlined, redrawn.
 *
 * @param string $output What the shortcode returned.
 * @param string $tag    Its name.
 */
function statchasers_bdp_filter_shortcode( $output, $tag ) {
	if ( ! in_array( (string) $tag, STATCHASERS_BDP_SHORTCODES, true ) ) {
		return $output;
	}

	statchasers_bdp_state( 'rendered', true );

	if ( ! statchasers_bdp_inline_icons_enabled() ) {
		return $output;
	}

	return statchasers_bdp_inline_icons( (string) $output );
}
add_filter( 'do_shortcode_tag', 'statchasers_bdp_filter_shortcode', 10, 2 );

/**
 * Wrap the plugin's widgets so their output passes through the same redraw.
 *
 * Widgets echo rather than return, and WordPress offers no filter on what
 * they echo. dynamic_sidebar_params runs just before each widget's callback
 * is invoked and hands back the arguments it will be invoked with, so the
 * registered callback is swapped for one that buffers the original.
 *
 * @param array $params dynamic_sidebar()'s per-widget arguments.
 * @return array The same arguments.
 */
function statchasers_bdp_wrap_widget( $params ) {
	global $wp_registered_widgets;

	$id = $params[0]['widget_id'] ?? '';
	if ( '' === $id || empty( $wp_registered_widgets[ $id ]['callback'] ) ) {
		return $params;
	}

	$callback = $wp_registered_widgets[ $id ]['callback'];
	$widget   = is_array( $callback ) ? ( $callback[0] ?? null ) : null;
	if ( ! is_object( $widget ) || ! isset( $widget->id_base ) || ! in_array( (string) $widget->id_base, STATCHASERS_BDP_WIDGETS, true ) ) {
		return $params;
	}

	$wp_registered_widgets[ $id ]['callback'] = static function () use ( $callback ) {
		statchasers_bdp_state( 'rendered', true );
		ob_start();
		call_user_func_array( $callback, func_get_args() );
		$out = (string) ob_get_clean();
		echo statchasers_bdp_inline_icons_enabled() ? statchasers_bdp_inline_icons( $out ) : $out; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- the widget's own markup, icons redrawn.
	};

	return $params;
}
add_filter( 'dynamic_sidebar_params', 'statchasers_bdp_wrap_widget' );

/**
 * The "Load More" response: the same cards, delivered as JSON.
 *
 * BDP_Public::bdp_load_more_posts() renders the next page's cards straight
 * from the templates (no shortcode, so no do_shortcode_tag) and sends them
 * as the `data` member of a JSON object, then dies. A buffer opened one
 * priority ahead of it catches the whole response on the way out; the
 * `data` member is redrawn and the object re-encoded. Anything that is not
 * that object is passed through untouched.
 */
function statchasers_bdp_buffer_load_more(): void {
	if ( ! statchasers_bdp_inline_icons_enabled() ) {
		return;
	}
	ob_start( 'statchasers_bdp_rewrite_load_more' );
}
add_action( 'wp_ajax_bdp_load_more_posts', 'statchasers_bdp_buffer_load_more', 9 );
add_action( 'wp_ajax_nopriv_bdp_load_more_posts', 'statchasers_bdp_buffer_load_more', 9 );

/** The buffer callback: redraw `data` in the plugin's JSON reply. */
function statchasers_bdp_rewrite_load_more( string $buffer ): string {
	$json = json_decode( $buffer, true );
	if ( ! is_array( $json ) || ! isset( $json['data'] ) || ! is_string( $json['data'] ) ) {
		return $buffer;
	}

	$json['data'] = statchasers_bdp_inline_icons( $json['data'] );
	$encoded      = json_encode( $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- same flags as wp_send_json()'s default.

	return false === $encoded ? $buffer : $encoded;
}
