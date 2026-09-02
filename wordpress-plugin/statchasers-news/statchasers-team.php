<?php
/**
 * The team hub shortcode: [statchasers_team]
 *
 * Same posture as the news shortcode in the main plugin file, and for the same
 * reason — the team hubs are the whole point of this half. The API serves them
 * at their own URL marked `noindex, indexifembedded`, which means they are
 * invisible to search until something embeds them. This file is that something.
 * Without it the pages exist and rank nowhere.
 *
 * Two things differ from the news mount, both forced by the endpoint:
 *
 *   1. `/embed/team/<slug>` returns raw HTML, not the `{ok, html, version}`
 *      JSON that `/embed/ssr` returns. So the fetch below reads the body
 *      directly and takes its version from the ETag the route already sets.
 *   2. It takes no render arguments. Everything the news shortcode passes as
 *      query parameters — heading, page size, link templates — is either fixed
 *      for a team page or configured server-side by environment variable.
 *
 * Everything else is shared with the news file: the origin, the asset version,
 * the canonical guess. This file is required from statchasers-news.php and is
 * not a plugin of its own.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_TEAM_SHORTCODE = 'statchasers_team';
const STATCHASERS_TEAM_HANDLE    = 'statchasers-team';

/** How long a rendered team fragment is reused before we ask the API again. */
const STATCHASERS_TEAM_CACHE_TTL = 5 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_TEAM_BACKUP_TTL = DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Longer than the news timeout: a team hub assembles ESPN season stats, a depth
 * chart, a schedule and the news archive, and a cold render is measurably
 * slower than a list of headlines. Five seconds turned a slow-but-fine render
 * into a fallback often enough to matter.
 */
const STATCHASERS_TEAM_TIMEOUT = 8;

/**
 * Which team to render.
 *
 * Defaults to the post slug, because the WordPress pages are at
 * /nfl/teams/<slug>/ and the API's slugs are the same strings — so 32 pages can
 * carry one identical shortcode with no attribute at all. `slug="..."` is there
 * for the pages where that isn't true.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return string Sanitised slug, or '' if there is nothing usable.
 */
function statchasers_team_slug( array $atts ): string {
	$atts = shortcode_atts(
		array( 'slug' => '' ),
		$atts,
		STATCHASERS_TEAM_SHORTCODE
	);

	$slug = sanitize_title( (string) $atts['slug'] );

	if ( '' === $slug ) {
		$post = get_post();
		if ( $post instanceof WP_Post ) {
			$slug = (string) $post->post_name;
		}
	}

	// The slug goes into a URL path, so it is constrained to what the API's own
	// slugs look like rather than merely escaped. A value that isn't a plausible
	// team slug is treated as absent — better a missing section than a request
	// built from arbitrary post content.
	return preg_match( '/^[a-z0-9-]{2,40}$/', $slug ) ? $slug : '';
}

/**
 * Fetch the server-rendered team fragment, cached.
 *
 * @param string $slug Team slug.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_team_fetch( string $slug ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	$key        = md5( $origin . '|' . $slug );
	$cache_key  = 'sc_team_ssr_' . $key;
	$backup_key = 'sc_team_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$response = wp_remote_get(
		$origin . '/embed/team/' . rawurlencode( $slug ),
		array(
			'timeout' => STATCHASERS_TEAM_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the slug is wrong, and no amount of retrying fixes that. It is
	// still cached as a failure below, so a mistyped slug costs one request per
	// TTL rather than one per page view.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		// The route sets a weak ETag over the same fingerprint it caches the
		// render under, so it identifies this exact fragment. Only used for
		// cache bookkeeping — the enqueue version comes from assets.json.
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, STATCHASERS_TEAM_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_TEAM_BACKUP_TTL );

	return $payload;
}

/**
 * Register and enqueue the team hub's compiled bundles.
 *
 * Separate handles from the news tool: different stylesheet, different bundle,
 * and a page that mounts one does not want the other's assets. The version is
 * shared because the build hashes all four files into one number.
 */
function statchasers_team_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_TEAM_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_TEAM_HANDLE,
			$origin . '/team.css',
			array(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_TEAM_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_TEAM_HANDLE,
			$origin . '/dist/statchasers-team.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_TEAM_HANDLE );
	wp_enqueue_script( STATCHASERS_TEAM_HANDLE );

	// Rides on the handle above, so it is scoped to hub pages by the same
	// condition that loads the stylesheet at all — no body class, no filter
	// priority, no theme internals in the way. See the divi layout section.
	if ( statchasers_team_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_TEAM_HANDLE, statchasers_team_full_width_css() );
	}
}

/**
 * Does the request being rendered mount the team hub?
 *
 * Reads get_queried_object() rather than get_post(). Divi swaps the global post
 * while it renders a Theme Builder layout, so during that render get_post() is
 * the LAYOUT — whose content has no shortcode in it — and the page would answer
 * "no" to a question about itself. The queried object is the page either way.
 *
 * Memoised because the layout hooks below ask on every post-meta read, which on
 * a Divi page is hundreds of times per request.
 */
function statchasers_team_post_has_shortcode(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	// Before the main query there is no page to inspect. Answer false without
	// caching it, or an early asker would pin the answer for the whole request.
	if ( ! is_singular() ) {
		return false;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_TEAM_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_team_post_has_shortcode() ) {
			return;
		}
		statchasers_team_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Is the active theme Divi (or Extra, or a child of either)?
 *
 * Three checks OR'd together rather than one, because the cost of guessing
 * wrong is that the whole section below silently does nothing — which is
 * exactly what a single `function_exists( 'et_get_option' )` gate bought on the
 * first attempt at this fix.
 */
function statchasers_team_is_divi(): bool {
	// get_template() is the PARENT theme's directory, so a child theme still
	// answers "Divi" here.
	if ( in_array( get_template(), array( 'Divi', 'Extra' ), true ) ) {
		return true;
	}

	return defined( 'ET_CORE_VERSION' ) || function_exists( 'et_get_option' );
}

/**
 * Does this page want Divi's full-width column?
 *
 * Divi gives `#left-area` 79.125% of the row above 980px and reserves the rest
 * for a sidebar widget area. On a team page that widget area is empty, so what
 * a reader sees is the hub squeezed into three quarters of the page, a 1px grey
 * rule down the boundary, and a tall band of nothing beside it. Below 980px
 * Divi collapses the split by itself, which is why it looks fine on every phone
 * you check it on.
 *
 * Keyed on "this page mounts the shortcode" rather than on the slug, because
 * that is the actual condition. The companion Divi plugin answers the same
 * question from its table of 32 team slugs, which is right for the pages the
 * WP-CLI script creates and wrong for every hub mounted anywhere else — a
 * staging page, a page whose slug was auto-generated, a hub embedded partway
 * down a longer article. Those are exactly the pages where the empty column
 * turns up, and they are the reason this lives here as well.
 *
 * Both plugins may run. Everything below is idempotent so that is a no-op.
 */
function statchasers_team_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_team_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the hub takes the whole content column.
	 *
	 * Return false to keep the theme's own layout — for a page that really does
	 * have a populated sidebar and wants to keep it.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_team_full_width', true );
}

/**
 * The width itself, as CSS.
 *
 * This is the belt to the two filters' braces, and it is here because the
 * filters are not enough on their own — not as a matter of taste, but because
 * of what Divi's stylesheet actually says:
 *
 *     @media (min-width: 981px) { #left-area { width: 79.125% } }
 *
 * The 79.125% is on the BARE id. It is not scoped to `.et_right_sidebar`, so
 * taking that class off the body changes nothing at all; the rule that undoes
 * it is `.et_full_width_page #left-area { width: 100% !important }`, which only
 * helps once the new class is actually on the body. That makes the body_class
 * filter load-bearing, and a filter is exactly the kind of thing that can be
 * outrun by another plugin, a cached body class or a theme that adds its layout
 * class later than you hooked. This stylesheet cannot be.
 *
 * Enqueued against STATCHASERS_TEAM_HANDLE, which is proven to load on hub
 * pages — it is how the hub is styled at all — so it needs no scoping of its
 * own beyond that.
 *
 * @return string
 */
function statchasers_team_full_width_css(): string {
	return implode(
		'',
		array(
			// Same breakpoint as Divi's own rule. Outside it Divi has already
			// collapsed the columns and there is nothing to correct.
			'@media (min-width:981px){',
			'#left-area{width:100%!important;float:none!important;padding-right:0!important;padding-left:0!important}',
			// The 1px grey rule Divi draws down the column boundary, which
			// without a sidebar beside it is a line down the middle of nothing.
			'#main-content .container:before{display:none!important}',
			// Belt: if some other plugin fills the widget area, the hub still
			// owns the row. Overridable through statchasers_team_full_width.
			'#sidebar{display:none!important}',
			'}',
		)
	);
}

/**
 * Remove the sidebar markup.
 *
 * page.php reads this meta to decide whether to call get_sidebar(). Filtered
 * rather than written to the database: these pages are created by WP-CLI (see
 * wordpress-plugin/scripts/), so a page added next season would arrive with the
 * default again, and "why is there an empty column on one team page" is not
 * something anyone should have to rediscover. The layout is a property of what
 * a hub IS, so it belongs in code beside the shortcode.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_team_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	// $object_id is whatever is being asked about, which during a Theme Builder
	// render can be the layout post. Only answer for the page itself.
	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_team_wants_full_width() ) {
		return $value;
	}

	// get_post_meta() with $single = true unwraps one level, so a short-circuit
	// has to return the array form or the caller gets the first character.
	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_team_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * `et_full_width_page` is the one that carries weight — see the note on the CSS
 * above. Dropping `et_right_sidebar` is tidiness rather than the fix.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_team_full_width_body_class( array $classes ): array {
	if ( ! statchasers_team_wants_full_width() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);

	// Guarded rather than appended: the companion Divi plugin adds the same
	// class on the 32 slugs it knows about, and a duplicate in body_class is
	// the kind of thing that shows up in a diff six months from now.
	if ( ! in_array( 'et_full_width_page', $classes, true ) ) {
		$classes[] = 'et_full_width_page';
	}

	return $classes;
}
// Last, not merely late. Divi adds its layout class at the default priority,
// but Theme Builder, a caching plugin or a child theme can all append after
// that, and anything that re-adds et_right_sidebar behind us wins.
add_filter( 'body_class', 'statchasers_team_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered team hub into the page.
 *
 * Same deliberate omissions as the news shortcode — no canonical, no <h1>, no
 * title or meta description, nothing written to the URL. The page owns all of
 * it. The fragment's own tab strip is `:target`-based, so the only URL state it
 * can produce is a hash, which is not a separate URL to a crawler.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_team_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Team:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$slug = statchasers_team_slug( is_array( $atts ) ? $atts : array() );

	if ( '' === $slug ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Team:</strong> no team slug. This page\'s slug is not a team slug, so set one explicitly — <code>[statchasers_team slug="philadelphia-eagles"]</code>.</p>';
		}
		return '';
	}

	$data = statchasers_team_fetch( $slug );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_team_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// Unlike the news tool there is no client-side render to fall back to:
		// the team bundle only enhances markup that is already there. An empty
		// string is the honest answer, and it leaves the rest of the page — the
		// H1, the copy, the internal links — intact.
		if ( current_user_can( 'manage_options' ) ) {
			return sprintf(
				'<p><strong>StatChasers Team:</strong> the API returned nothing for <code>%s</code>. Check the slug and that the deployment is up.</p>',
				esc_html( $slug )
			);
		}
		return '';
	}

	/**
	 * Filters the server-rendered team fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 * @param string $slug Team slug.
	 */
	return (string) apply_filters( 'statchasers_team_fragment_html', $data['html'], $slug );
}
add_shortcode( STATCHASERS_TEAM_SHORTCODE, 'statchasers_team_shortcode' );

/**
 * Clear cached team renders. Called by statchasers_news_flush().
 */
function statchasers_team_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_team_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_team_ssr_' ) . '%'
		)
	);
}
