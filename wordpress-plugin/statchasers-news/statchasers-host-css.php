<?php
/**
 * Stylesheets other plugins load on every page, trimmed to the pages that use
 * them.
 *
 * Audited 2026-10-08 against the live site: every post, every category, every
 * hand-made page and one of each generated page type (team hub, hub section,
 * player, rivalry, schedule week, rankings and stats positions, depth chart).
 * Six stylesheets reach every reader on every page, and not one of those pages
 * carries the markup they style:
 *
 *   handle                           file                           registered by              bytes
 *   inf-font-awesome                 font-awesome.min.css (FA 7.2)  Blog Designer Pack        75,736
 *   owl-carousel                     owl.carousel.min.css           Blog Designer Pack         3,336
 *   bdpp-public-style                bdpp-public.min.css            Blog Designer Pack        26,472
 *   supreme-modules-for-divi-styles  styles/style.min.css           Divi Supreme (Lite)      192,657
 *   magnific-popup                   magnific_popup.css             Divi Supreme (Divi's file) 6,470
 *   tablepress-default               css/build/default.css          TablePress                 8,064
 *
 * How each gets there, from the plugins' own source (versions on the site):
 *
 * - Blog Designer Pack 4.0.12 enqueues all three in bdpp_public_style_script()
 *   on wp_enqueue_scripts with no condition at all. Its markup only ever comes
 *   from its shortcodes ([bdp_post], [bdp_post_carousel], [bdp_post_gridbox],
 *   [bdp_post_list], [bdp_post_slider], [bdp_masonry], [bdp_ticker],
 *   [pld_post_list]), its block (bdpp/bdpp-layout-selector) and its two widgets
 *   (bdpp-post-widget, bdpp-post-scrolling-widget). Its JavaScript already
 *   loads only when a shortcode renders; the CSS never learned the same trick.
 *   The Font Awesome file is there for the icons inside those layouts (author,
 *   date, comment count). Nothing else on the site uses a Font Awesome class.
 * - Divi Supreme 2.5.64 enqueues its whole module stylesheet through Divi's
 *   extension framework, and enqueue_styles() in its public class adds Divi's
 *   magnific_popup.css (for its lightbox and popup modules) whenever its own
 *   "Dynamic Assets" setting is off. The site has it off: both files appear
 *   with ?ver=2.5.64. Its markup is its [dsm_*] modules and the dsm_* settings
 *   its extensions add to ordinary Divi modules.
 * - TablePress 3.x loads default.css on every page because Divi is not a block
 *   theme ("legacy CSS loading", see tablepress_frontend_legacy_css_loading).
 *   With that filter false it uses its own on-demand path instead: the CSS is
 *   enqueued when a [table] actually renders, and printed in place when the
 *   head has already gone out.
 *
 * WHAT THIS FILE DOES. On wp_enqueue_scripts, after those plugins have run, it
 * reads the content that will render (the queried post, the posts page, every
 * Divi Theme Builder layout for this request, the global library modules
 * those reference, and the active widgets) and looks for the marks above. A
 * handle whose feature is absent is dequeued; one whose feature is present is
 * left exactly as its plugin enqueued it. TablePress is switched to its
 * on-demand mode, and on a page whose content carries a table its CSS is
 * enqueued here, in the head, so those pages do not paint unstyled first.
 *
 * This is not deferral. A deferred stylesheet is still downloaded and still
 * applied, just later; it can still shift the layout and it still costs the
 * bytes. A dequeued one is simply not on the page, which is the only right
 * answer for a page with nothing for it to style.
 *
 * WHAT IT DOES NOT DO. It never touches the visual builder, the theme builder
 * editor, the customizer or a post preview (every handle stays, so an editor
 * sees exactly what the plugins intend). It never dequeues magnific-popup
 * unless the registered copy carries Divi Supreme's version, which is the
 * proof that Divi Supreme enqueued it and not Divi: Divi's own lightbox CSS
 * travels inside its dynamic assets and is never this handle. It does not
 * touch any script. And it restores the one rule in magnific_popup.css that
 * is not scoped to the lightbox at all (button::-moz-focus-inner, a Firefox
 * button-padding reset), so a page that loses the file keeps that geometry.
 *
 * Two filters: `statchasers_host_css_features` (which features were found, to
 * force one on for a page the scan cannot see) and
 * `statchasers_host_css_dequeue` (the handles about to go; return an empty
 * array to switch this off).
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** After every plugin's own enqueue (they all use the default 10). */
const STATCHASERS_HOST_CSS_PRIORITY = 1000;

/**
 * The content marks that prove each feature is on the page.
 *
 * @return array<string,string> feature => regex over the page's source content.
 */
function statchasers_host_css_marks(): array {
	return array(
		// Blog Designer Pack: its shortcodes, its block, its widget ids.
		'bdpp'        => '/\[(?:bdp_post|bdp_masonry|bdp_ticker|pld_post_list)\b|wp:bdpp\/|bdpp-post-(?:scrolling-)?widget/i',
		// Font Awesome markup in any of its syntaxes: "fa fa-x", "fas fa-x",
		// "fa-solid fa-x". The lookbehind keeps our own scfa-* tokens out.
		'fontawesome' => '/(?<![\w-])(?:fa[srlbd]?|fa-(?:solid|regular|brands|light|thin|duotone|sharp))\s+fa-[a-z0-9-]+|(?<![\w-])fa-(?:solid|regular|brands|light|thin|duotone|sharp)(?![\w-])/i',
		// Divi Supreme: [dsm_*] modules and the dsm_* settings its extensions
		// add to any Divi module; dsm- for hand-written markup naming its classes.
		'dsm'         => '/(?<![\w-])dsm[_-][a-z]/i',
		// TablePress: the shortcode in either form, or the block.
		'tablepress'  => '/\[table(?:-info)?[\s\]]|wp:tablepress\//i',
	);
}

/**
 * Which features the page content carries.
 *
 * @param string $haystack The page's source content, see statchasers_host_css_haystack().
 * @return array<string,bool>
 */
function statchasers_host_css_features( string $haystack ): array {
	$found = array();
	foreach ( statchasers_host_css_marks() as $feature => $regex ) {
		$found[ $feature ] = 1 === preg_match( $regex, $haystack );
	}

	/**
	 * Filters which features the page was found to use.
	 *
	 * @param array<string,bool> $found    feature => present.
	 * @param string             $haystack The content that was scanned.
	 */
	return (array) apply_filters( 'statchasers_host_css_features', $found, $haystack );
}

/**
 * The handles to dequeue for a page with these features.
 *
 * Pure, so the tests can ask it directly. $magnific_version is the version the
 * registered magnific-popup handle carries and $dsm_version is Divi Supreme's;
 * they match only when Divi Supreme is the one that enqueued it.
 *
 * @param array<string,bool> $features         From statchasers_host_css_features().
 * @param string             $magnific_version Registered version of magnific-popup, '' if unregistered.
 * @param string             $dsm_version      DSM_VERSION, '' if Divi Supreme is not active.
 * @return string[]
 */
function statchasers_host_css_dequeue_list( array $features, string $magnific_version, string $dsm_version ): array {
	$drop = array();

	if ( empty( $features['bdpp'] ) ) {
		$drop[] = 'owl-carousel';
		$drop[] = 'bdpp-public-style';
		if ( empty( $features['fontawesome'] ) ) {
			$drop[] = 'inf-font-awesome';
		}
	}

	if ( empty( $features['dsm'] ) ) {
		$drop[] = 'supreme-modules-for-divi-styles';
		if ( '' !== $dsm_version && $magnific_version === $dsm_version ) {
			$drop[] = 'magnific-popup';
		}
	}

	return $drop;
}

/**
 * Every string inside a (possibly nested) option value, joined.
 *
 * The widget options are arrays of instances; the strings in them are the
 * widget titles and, for block and text widgets, the content.
 *
 * @param mixed $value An option value.
 * @return string
 */
function statchasers_host_css_strings( $value ): string {
	if ( is_string( $value ) ) {
		return $value;
	}
	if ( ! is_array( $value ) && ! is_object( $value ) ) {
		return '';
	}
	$out = array();
	foreach ( (array) $value as $item ) {
		$s = statchasers_host_css_strings( $item );
		if ( '' !== $s ) {
			$out[] = $s;
		}
	}
	return implode( "\n", $out );
}

/**
 * The content that will render on this request, as one string to scan.
 *
 * The queried post (or the posts page on the blog index), every Divi Theme
 * Builder layout that applies, the Divi Library modules those reference as
 * global_module="id", the ids of the active widgets, and the block, text and
 * custom-HTML widget instances. Posts in an archive loop are not read: Divi
 * prints excerpts there, which strip shortcodes.
 *
 * Deliberately not memoised: WordPress asks once per request, and a static
 * would let a test process see only one page.
 */
function statchasers_host_css_haystack(): string {
	$ids = array();

	$queried = get_queried_object();
	if ( $queried instanceof WP_Post ) {
		$ids[] = (int) $queried->ID;
	}
	if ( is_home() ) {
		$ids[] = (int) get_option( 'page_for_posts' );
	}

	if ( function_exists( 'et_theme_builder_get_template_layouts' ) ) {
		foreach ( (array) et_theme_builder_get_template_layouts() as $layout ) {
			if ( is_array( $layout ) && ! empty( $layout['enabled'] ) && ! empty( $layout['id'] ) ) {
				$ids[] = (int) $layout['id'];
			}
		}
	}

	$ids   = array_values( array_unique( array_filter( $ids ) ) );
	$parts = array();
	foreach ( $ids as $id ) {
		$parts[] = (string) get_post_field( 'post_content', $id );
	}

	// Divi global modules: the layout holds a reference, the Library holds the markup.
	if ( preg_match_all( '/global_module="(\d+)"/', implode( "\n", $parts ), $m ) ) {
		foreach ( array_unique( $m[1] ) as $id ) {
			if ( ! in_array( (int) $id, $ids, true ) ) {
				$parts[] = (string) get_post_field( 'post_content', (int) $id );
			}
		}
	}

	// Active widgets, by id, everywhere but the inactive bin.
	$sidebars = get_option( 'sidebars_widgets' );
	if ( is_array( $sidebars ) ) {
		unset( $sidebars['wp_inactive_widgets'], $sidebars['array_version'] );
		$parts[] = statchasers_host_css_strings( $sidebars );
	}
	foreach ( array( 'widget_block', 'widget_text', 'widget_custom_html' ) as $option ) {
		$parts[] = statchasers_host_css_strings( get_option( $option ) );
	}

	return implode( "\n", $parts );
}

/** Contexts where every handle stays: editors must see what the plugins intend. */
function statchasers_host_css_skip(): bool {
	if ( is_admin() || is_customize_preview() || is_preview() ) {
		return true;
	}
	foreach ( array( 'et_core_is_fb_enabled', 'et_fb_is_enabled', 'et_builder_tb_enabled' ) as $fn ) {
		if ( function_exists( $fn ) && $fn() ) {
			return true;
		}
	}
	return false;
}

/** The one rule in magnific_popup.css that applies outside the lightbox. */
const STATCHASERS_HOST_CSS_MAGNIFIC_GLOBAL = 'button::-moz-focus-inner{padding:0;border:0}';

/**
 * Dequeue what this page has no use for.
 */
function statchasers_host_css_trim(): void {
	if ( statchasers_host_css_skip() ) {
		return;
	}

	$features = statchasers_host_css_features( statchasers_host_css_haystack() );

	$styles   = wp_styles();
	$magnific = isset( $styles->registered['magnific-popup'] ) ? (string) $styles->registered['magnific-popup']->ver : '';
	$drop     = statchasers_host_css_dequeue_list( $features, $magnific, defined( 'DSM_VERSION' ) ? (string) DSM_VERSION : '' );

	/**
	 * Filters the handles about to be dequeued. Return an empty array to leave
	 * every stylesheet as its plugin enqueued it.
	 *
	 * @param string[]           $drop     Style handles.
	 * @param array<string,bool> $features What the page was found to use.
	 */
	$drop = (array) apply_filters( 'statchasers_host_css_dequeue', $drop, $features );

	foreach ( $drop as $handle ) {
		if ( wp_style_is( $handle, 'enqueued' ) ) {
			wp_dequeue_style( $handle );
		}
	}

	if ( in_array( 'magnific-popup', $drop, true ) ) {
		// A src-less handle is how WordPress prints an inline block on its own.
		wp_register_style( 'statchasers-host-css', false, array(), null );
		wp_enqueue_style( 'statchasers-host-css' );
		wp_add_inline_style( 'statchasers-host-css', STATCHASERS_HOST_CSS_MAGNIFIC_GLOBAL );
	}

	// TablePress is in on-demand mode (filter below). A page whose content
	// carries a table gets the CSS in the head rather than beside the table.
	if ( ! empty( $features['tablepress'] ) && class_exists( 'TablePress' ) && isset( TablePress::$controller ) && method_exists( TablePress::$controller, 'enqueue_css' ) ) {
		TablePress::$controller->enqueue_css();
	}
}
add_action( 'wp_enqueue_scripts', 'statchasers_host_css_trim', STATCHASERS_HOST_CSS_PRIORITY );

// TablePress: load the CSS where a table renders, not everywhere (3.0.1+).
add_filter( 'tablepress_frontend_legacy_css_loading', '__return_false' );
