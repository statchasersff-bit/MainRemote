<?php
/**
 * Divi Supreme's and TablePress's stylesheets, only where those plugins are.
 *
 * Audited 2026-10-08 against the live site: every post, every category, every
 * hand-made page and one of each generated page type (team hub, hub section,
 * player, rivalry, schedule week, rankings and stats positions, depth chart).
 * Three stylesheets from these two plugins reach every reader on every page,
 * and not one of those pages carries the markup they style. (Blog Designer
 * Pack's three are the same story and are handled in
 * statchasers-bdp-assets.php.)
 *
 *   handle                           file                   registered by                bytes
 *   supreme-modules-for-divi-styles  styles/style.min.css   Divi Supreme (Lite 2.5.64) 192,657
 *   magnific-popup                   magnific_popup.css     Divi Supreme, Divi's file    6,470
 *   tablepress-default               css/build/default.css  TablePress 3.x               8,064
 *
 * How each gets there, from the plugins' own source at the versions the site runs:
 *
 * - Divi Supreme enqueues its whole module stylesheet through Divi's extension
 *   framework on wp_enqueue_scripts, and enqueue_styles() in its public class
 *   adds Divi's magnific_popup.css (for its lightbox and popup modules)
 *   whenever its own "Dynamic Assets" setting is off. The site has it off:
 *   both files print with ?ver=2.5.64, Divi Supreme's version, which is also
 *   the proof that Divi Supreme and not Divi enqueued magnific-popup. Its
 *   markup is its [dsm_*] modules and the dsm_* settings its extensions add to
 *   ordinary Divi modules. With "Dynamic Assets" on it dequeues its stylesheet
 *   itself and hands per-module CSS to Divi's dynamic assets; this file is the
 *   same outcome without depending on the setting, and a no-op if it is on.
 * - TablePress loads default.css on every page because Divi is not a block
 *   theme ("legacy CSS loading", the tablepress_frontend_legacy_css_loading
 *   filter, 3.0.1+). With that filter false it uses its own on-demand path:
 *   the CSS is enqueued when a [table] actually renders, and printed in place
 *   when the head has already gone out. So a table anywhere, in a widget or a
 *   template, is always styled. On a page whose content carries a table this
 *   file enqueues it in the head as well, so that page does not paint the
 *   table unstyled first.
 *
 * WHAT THIS FILE DOES. On wp_enqueue_scripts, after those plugins have run, it
 * reads the content that will render (the queried post, the posts page, every
 * Divi Theme Builder layout for this request, the global library modules
 * those reference, and the active widgets) and looks for the marks above. A
 * handle whose feature is absent is dequeued; one whose feature is present is
 * left exactly as its plugin enqueued it.
 *
 * This is not deferral. A deferred stylesheet is still downloaded and still
 * applied, just later; it still costs the bytes and can still move the
 * layout. A dequeued one is not on the page, which is the only right answer
 * for a page with nothing for it to style.
 *
 * WHAT IT DOES NOT DO. It never touches the visual builder, the theme builder
 * editor, the customizer or a post preview: every handle stays, so an editor
 * sees what the plugins intend. It never dequeues magnific-popup unless the
 * registered copy carries Divi Supreme's version. It touches no script. And
 * it restores the one rule in magnific_popup.css that is not scoped to the
 * lightbox at all (button::-moz-focus-inner, a Firefox button-padding reset),
 * so a page that loses the file keeps its button geometry.
 *
 * Two filters: `statchasers_host_css_features` (what the scan found, to force
 * a feature on for a page it cannot see) and `statchasers_host_css_dequeue`
 * (the handles about to go; return an empty array to switch this off).
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** After every plugin's own enqueue (they all use the default 10). */
const STATCHASERS_HOST_CSS_PRIORITY = 1000;

/** The handles, exactly as the plugins register them. */
const STATCHASERS_HOST_CSS_DSM_STYLES = 'supreme-modules-for-divi-styles';
const STATCHASERS_HOST_CSS_MAGNIFIC   = 'magnific-popup';
const STATCHASERS_HOST_CSS_TABLEPRESS = 'tablepress-default';

/** The one rule in magnific_popup.css that applies outside the lightbox. */
const STATCHASERS_HOST_CSS_MAGNIFIC_GLOBAL = 'button::-moz-focus-inner{padding:0;border:0}';

/**
 * The content marks that prove each feature is on the page.
 *
 * @return array<string,string> feature => regex over the page's source content.
 */
function statchasers_host_css_marks(): array {
	return array(
		// Divi Supreme: [dsm_*] modules and the dsm_* settings its extensions
		// add to any Divi module; dsm- for hand-written markup naming its classes.
		'dsm'        => '/(?<![\w-])dsm[_-][a-z]/i',
		// TablePress: the shortcode in either form, or the block.
		'tablepress' => '/\[table(?:-info)?[\s\]]|wp:tablepress\//i',
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

	if ( empty( $features['dsm'] ) ) {
		$drop[] = STATCHASERS_HOST_CSS_DSM_STYLES;
		if ( '' !== $dsm_version && $magnific_version === $dsm_version ) {
			$drop[] = STATCHASERS_HOST_CSS_MAGNIFIC;
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
 * global_module="id", the ids of the active widgets, and the content of the
 * active block, text and custom-HTML widget instances. Posts in an archive
 * loop are not read: Divi prints excerpts there, which strip shortcodes.
 *
 * Deliberately not memoized: WordPress asks once per request, and a static
 * would let a test process see only one page.
 */
function statchasers_host_css_haystack(): string {
	$parts = array();
	$ids   = array();

	$queried = get_queried_object();
	if ( $queried instanceof WP_Post ) {
		$parts[] = (string) $queried->post_content;
		$ids[]   = (int) $queried->ID;
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

	$ids = array_values( array_unique( array_filter( $ids ) ) );
	foreach ( $ids as $id ) {
		if ( $queried instanceof WP_Post && (int) $queried->ID === $id ) {
			continue; // Already in hand.
		}
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

	// Active widgets: their ids, and the content of the active block, text
	// and custom-HTML instances (a widget id is "<base>-<number>", its
	// instances live in the "widget_<base>" option under that number).
	$sidebars = get_option( 'sidebars_widgets' );
	if ( is_array( $sidebars ) ) {
		unset( $sidebars['wp_inactive_widgets'], $sidebars['array_version'] );
		$active = array();
		foreach ( $sidebars as $widgets ) {
			foreach ( (array) $widgets as $widget_id ) {
				if ( is_string( $widget_id ) && preg_match( '/^(.+)-(\d+)$/', $widget_id, $m ) ) {
					$active[ $m[1] ][] = (int) $m[2];
					$parts[]           = $widget_id;
				}
			}
		}
		foreach ( array( 'block', 'text', 'custom_html' ) as $base ) {
			if ( empty( $active[ $base ] ) ) {
				continue;
			}
			$instances = get_option( 'widget_' . $base );
			foreach ( $active[ $base ] as $number ) {
				if ( is_array( $instances ) && isset( $instances[ $number ] ) ) {
					$parts[] = statchasers_host_css_strings( $instances[ $number ] );
				}
			}
		}
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
	return isset( $_GET['et_fb'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the Visual Builder's own flag.
}

/** The version the registered magnific-popup handle carries, '' if none. */
function statchasers_host_css_magnific_version(): string {
	$styles = wp_styles();
	if ( ! isset( $styles->registered[ STATCHASERS_HOST_CSS_MAGNIFIC ] ) ) {
		return '';
	}
	return (string) ( $styles->registered[ STATCHASERS_HOST_CSS_MAGNIFIC ]->ver ?? '' );
}

/**
 * Dequeue what this page has no use for. wp_enqueue_scripts, late.
 */
function statchasers_host_css_trim(): void {
	if ( statchasers_host_css_skip() ) {
		return;
	}

	$features = statchasers_host_css_features( statchasers_host_css_haystack() );
	$drop     = statchasers_host_css_dequeue_list(
		$features,
		statchasers_host_css_magnific_version(),
		defined( 'DSM_VERSION' ) ? (string) DSM_VERSION : ''
	);

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

	if ( in_array( STATCHASERS_HOST_CSS_MAGNIFIC, $drop, true ) ) {
		// A src-less handle is how WordPress prints an inline block on its own.
		wp_register_style( 'statchasers-host-css', false, array(), null );
		wp_enqueue_style( 'statchasers-host-css' );
		wp_add_inline_style( 'statchasers-host-css', STATCHASERS_HOST_CSS_MAGNIFIC_GLOBAL );
	}

	// TablePress is in on-demand mode (the filter below). A page whose content
	// carries a table gets the CSS in the head rather than beside the table.
	if ( ! empty( $features['tablepress'] ) && statchasers_host_css_tablepress_controller() ) {
		statchasers_host_css_tablepress_controller()->enqueue_css();
	}
}
add_action( 'wp_enqueue_scripts', 'statchasers_host_css_trim', STATCHASERS_HOST_CSS_PRIORITY );

/**
 * TablePress's front-end controller, if the plugin is active and has booted.
 *
 * The property is a typed static (TablePress 3), so isset() is the only safe
 * read: a plain access before the plugin's run() would throw.
 *
 * @return object|null
 */
function statchasers_host_css_tablepress_controller() {
	if ( ! class_exists( 'TablePress' ) || ! isset( TablePress::$controller ) ) {
		return null;
	}
	return method_exists( TablePress::$controller, 'enqueue_css' ) ? TablePress::$controller : null;
}

// TablePress: load the CSS where a table renders, not everywhere (3.0.1+).
add_filter( 'tablepress_frontend_legacy_css_loading', '__return_false' );
