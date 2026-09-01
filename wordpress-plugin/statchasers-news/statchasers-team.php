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
}

/** Does the current request render the team shortcode in post content? */
function statchasers_team_post_has_shortcode(): bool {
	if ( ! is_singular() ) {
		return false;
	}

	$post = get_post();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	return has_shortcode( (string) $post->post_content, STATCHASERS_TEAM_SHORTCODE );
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
