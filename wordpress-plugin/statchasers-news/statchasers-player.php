<?php
/**
 * The player page shortcode: [statchasers_player]
 *
 * Same posture as the team hub in statchasers-team.php, and for the same
 * reason. The API serves every player route with `noindex, indexifembedded`,
 * which means those pages are invisible to search until something embeds them —
 * `indexifembedded` with no embed is just `noindex`. This file is the embed.
 * Without it the content exists and ranks nowhere.
 *
 * What differs from the team mount:
 *
 *   1. There are several hundred of these rather than 32, so the cache TTL is
 *      the same but the volume is not. That is fine — a player fragment is
 *      cheap to render (the API assembles it from local JSON, with no upstream
 *      in the request path) and each is cached under its own key.
 *   2. It takes a `format` attribute. Scoring format genuinely changes every
 *      number in the fragment, and a site that runs half-PPR leagues should be
 *      able to say so once per page rather than asking every reader to switch.
 *   3. There is no alias resolution. A team has a handful of well-known aliases
 *      worth redirecting; a player slug has thousands of near-misses, so a slug
 *      that does not resolve is reported to an administrator rather than
 *      guessed at.
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

const STATCHASERS_PLAYER_SHORTCODE = 'statchasers_player';
const STATCHASERS_PLAYER_HANDLE    = 'statchasers-player';

/** How long a rendered player fragment is reused before we ask the API again. */
const STATCHASERS_PLAYER_CACHE_TTL = 5 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_PLAYER_BACKUP_TTL = DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Shorter than the team hub's eight. A team page waits on ESPN for a schedule,
 * a record and two statistics documents; a player page waits on nothing —
 * every number in it is arithmetic over JSON the API already holds in memory.
 * Six seconds is generous for that and still well inside what a page render can
 * absorb.
 */
const STATCHASERS_PLAYER_TIMEOUT = 6;

/** The scoring formats the API understands. Anything else falls back to PPR. */
const STATCHASERS_PLAYER_FORMATS = array( 'standard', 'half', 'ppr' );

/**
 * Which player to render, and in which scoring format.
 *
 * The slug defaults to the post slug, because the WordPress pages are at
 * /nfl/players/<slug>/ and the API's slugs are the same strings — so several
 * hundred pages can carry one identical shortcode with no attribute at all.
 * `slug="..."` is there for the pages where that isn't true.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{slug:string,format:string}
 */
function statchasers_player_args( array $atts ): array {
	$atts = shortcode_atts(
		array(
			'slug'   => '',
			'format' => '',
		),
		$atts,
		STATCHASERS_PLAYER_SHORTCODE
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
	// player slug is treated as absent — better a missing section than a request
	// built from arbitrary post content.
	if ( ! preg_match( '/^[a-z0-9][a-z0-9-]{1,63}$/', $slug ) ) {
		$slug = '';
	}

	$format = strtolower( trim( (string) $atts['format'] ) );
	if ( ! in_array( $format, STATCHASERS_PLAYER_FORMATS, true ) ) {
		$format = 'ppr';
	}

	return array(
		'slug'   => $slug,
		'format' => $format,
	);
}

/**
 * Fetch the server-rendered player fragment, cached.
 *
 * Like the team endpoint, `/embed/player/<slug>` returns raw HTML rather than
 * the `{ok, html, version}` JSON `/embed/ssr` returns, so the body is read
 * directly and the version comes from the ETag the route already sets.
 *
 * @param string $slug   Player slug.
 * @param string $format Scoring format.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_player_fetch( string $slug, string $format ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	$key        = md5( $origin . '|' . $slug . '|' . $format );
	$cache_key  = 'sc_player_ssr_' . $key;
	$backup_key = 'sc_player_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$url = $origin . '/embed/player/' . rawurlencode( $slug );
	if ( 'ppr' !== $format ) {
		$url = add_query_arg( 'format', $format, $url );
	}

	$response = wp_remote_get(
		$url,
		array(
			'timeout' => STATCHASERS_PLAYER_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the slug is wrong, and no amount of retrying fixes that. It is
	// still cached as a failure below, so a mistyped slug costs one request per
	// minute rather than one per page view.
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

	set_transient( $cache_key, $payload, STATCHASERS_PLAYER_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_PLAYER_BACKUP_TTL );

	return $payload;
}

/**
 * Register and enqueue the player page's compiled bundles.
 *
 * Separate handles from the news tool and the team hub: three stylesheets,
 * three bundles, and a page that mounts one does not want the others' assets.
 * The version is shared because the build hashes all six files into one number.
 */
function statchasers_player_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_PLAYER_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_PLAYER_HANDLE,
			$origin . '/player.css',
			array(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_PLAYER_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_PLAYER_HANDLE,
			$origin . '/dist/statchasers-player.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_PLAYER_HANDLE );
	wp_enqueue_script( STATCHASERS_PLAYER_HANDLE );

	// Rides on the handle above, so it is scoped to player pages by the same
	// condition that loads the stylesheet at all. See the divi layout section
	// in statchasers-team.php for why this is not left to body classes.
	if ( statchasers_player_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_PLAYER_HANDLE, statchasers_team_full_width_css() );
	}
}

/**
 * Does the request being rendered mount a player page?
 *
 * Reads get_queried_object() rather than get_post(), for the reason given at
 * length in statchasers-team.php: Divi swaps the global post while it renders a
 * Theme Builder layout, so during that render get_post() is the LAYOUT — whose
 * content has no shortcode in it — and the page would answer "no" to a question
 * about itself.
 *
 * Memoised because the layout hooks ask on every post-meta read, which on a
 * Divi page is hundreds of times per request.
 */
function statchasers_player_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_PLAYER_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_player_post_has_shortcode() ) {
			return;
		}
		statchasers_player_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column?
 *
 * Exactly the team hub's problem and exactly its answer — see the long note on
 * `statchasers_team_wants_full_width()`. Divi gives `#left-area` 79.125% of the
 * row above 980px and reserves the rest for a sidebar that these pages do not
 * have, so without this the profile renders in three quarters of the page with
 * a grey rule and a tall band of nothing beside it.
 *
 * The CSS and the meta/body-class filters are the team file's; only the
 * "does this page mount the tool" question is different, so only that is
 * restated here. Both plugins may run, and everything involved is idempotent.
 */
function statchasers_player_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_player_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting a player profile takes the whole column.
	 *
	 * Return false to keep the theme's own layout — for a page that really does
	 * have a populated sidebar and wants to keep it.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_player_full_width', true );
}

/**
 * Remove the sidebar markup on a player page.
 *
 * page.php reads this meta to decide whether to call get_sidebar(). Filtered
 * rather than written to the database: these pages are created by WP-CLI (see
 * scripts/create-player-pages.sh), so a player added next season would arrive
 * with the default again.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_player_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	// $object_id is whatever is being asked about, which during a Theme Builder
	// render can be the layout post. Only answer for the page itself.
	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_player_wants_full_width() ) {
		return $value;
	}

	// get_post_meta() with $single = true unwraps one level, so a short-circuit
	// has to return the array form or the caller gets the first character.
	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_player_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * `et_full_width_page` is the one that carries weight — see the note on the CSS
 * in statchasers-team.php. Guarded rather than appended, because the team
 * filter may have added the same class already.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_player_full_width_body_class( array $classes ): array {
	if ( ! statchasers_player_wants_full_width() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);

	if ( ! in_array( 'et_full_width_page', $classes, true ) ) {
		$classes[] = 'et_full_width_page';
	}

	return $classes;
}
// Last, not merely late — same reasoning as the team filter.
add_filter( 'body_class', 'statchasers_player_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered player profile into the page.
 *
 * Same deliberate omissions as the news and team shortcodes — no canonical, no
 * <h1>, no title or meta description, nothing written to the URL. The page owns
 * all of it. The fragment's tab strip is `:target`-based, so the only URL state
 * it can produce is a hash, which is not a separate URL to a crawler.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_player_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_player_args( is_array( $atts ) ? $atts : array() );

	if ( '' === $args['slug'] ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player:</strong> no player slug. This page\'s slug is not a player slug, so set one explicitly — <code>[statchasers_player slug="kyler-murray"]</code>.</p>';
		}
		return '';
	}

	$data = statchasers_player_fetch( $args['slug'], $args['format'] );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_player_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// Unlike the news tool there is no client-side render to fall back to:
		// the player bundle only enhances markup that is already there. An empty
		// string is the honest answer, and it leaves the rest of the page — the
		// H1, the copy, the internal links — intact.
		if ( current_user_can( 'manage_options' ) ) {
			return sprintf(
				'<p><strong>StatChasers Player:</strong> the API returned nothing for <code>%s</code>. Check the slug and that the deployment is up.</p>',
				esc_html( $args['slug'] )
			);
		}
		return '';
	}

	/**
	 * Filters the server-rendered player fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html   Rendered fragment.
	 * @param string $slug   Player slug.
	 * @param string $format Scoring format.
	 */
	return (string) apply_filters(
		'statchasers_player_fragment_html',
		$data['html'],
		$args['slug'],
		$args['format']
	);
}
add_shortcode( STATCHASERS_PLAYER_SHORTCODE, 'statchasers_player_shortcode' );

/**
 * Clear cached player renders. Called by statchasers_news_flush().
 */
function statchasers_player_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_player_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_player_ssr_' ) . '%'
		)
	);
}
