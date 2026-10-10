<?php
/**
 * The key to the StatChasers app, and the proxy readers' browsers use.
 *
 * The app (STATCHASERS_NEWS_ORIGIN) can refuse every fragment and data request
 * that does not carry a shared key (SC_EMBED_KEY on the app). This file does
 * the two things that make that work:
 *
 *   1. Every request WordPress makes to the app carries the key, added in one
 *      place by the `http_request_args` filter. No fetch site in the other
 *      files had to change, and a new one is covered automatically.
 *
 *   2. Six widgets fetch from the reader's browser, where a key cannot live:
 *      the Player Stats table, FPA, RB Handcuffs player cards, the Strength of
 *      Schedule view switch, the Rookie Hit Rates dataset and the news refresh. They call this site instead,
 *      at /wp-json/statchasers/v1/p/<path>, and this forwards the request to
 *      the app with the key. Only those six paths are forwarded. The app points
 *      the widgets here once SC_BROWSER_PROXY is set on it.
 *
 * Set the key in wp-config.php, the same value as SC_EMBED_KEY on the app:
 *
 *   define( 'STATCHASERS_EMBED_KEY', 'a-long-random-string' );
 *
 * Without it nothing is sent and the proxy forwards without a key, which is
 * what an app with no key configured expects. Rollout order and checks:
 * wordpress-plugin/README.md, "Locking the app to WordPress".
 *
 * @package StatChasers_News
 */

defined( 'ABSPATH' ) || exit;

/** Seconds the proxy keeps an answer, matching the app's own max-age. */
const STATCHASERS_PROXY_TTL = 300;

/** How long a proxied request may wait on the app. */
const STATCHASERS_PROXY_TIMEOUT = 8;

/**
 * The paths the proxy forwards, relative to the app origin. Anything else is a
 * 404, so the proxy cannot be used to reach the rest of the app.
 */
const STATCHASERS_PROXY_PATHS = array(
	'#^embed/fpa$#',
	'#^embed/player-stats$#',
	'#^embed/sos$#',
	'#^embed/rookie-hit-rates/data$#',
	'#^embed/redraft-strategy/data/(?:combo|trends)/[a-z0-9_]{1,60}$#',
	'#^embed/redraft-strategy/data/boards$#',
	'#^embed/rb-handcuffs/player/[A-Za-z0-9_-]{1,40}$#',
	'#^api/news$#',
);

/**
 * The shared key, or '' when none is configured.
 */
function statchasers_embed_key(): string {
	return defined( 'STATCHASERS_EMBED_KEY' ) ? trim( (string) constant( 'STATCHASERS_EMBED_KEY' ) ) : '';
}

/**
 * Adds the key to every request bound for the app, and to nothing else.
 *
 * @param array<string,mixed> $args HTTP request arguments.
 * @param string              $url  The URL being requested.
 * @return array<string,mixed>
 */
function statchasers_add_embed_key( $args, $url ) {
	$key    = statchasers_embed_key();
	$origin = function_exists( 'statchasers_news_origin' ) ? statchasers_news_origin() : '';
	if ( '' === $key || '' === $origin || ! is_string( $url ) ) {
		return $args;
	}
	// The origin followed by a path or nothing, so https://app.example.com
	// never matches https://app.example.com.attacker.net.
	if ( 0 !== strpos( $url, $origin . '/' ) && $url !== $origin ) {
		return $args;
	}
	if ( ! isset( $args['headers'] ) || ! is_array( $args['headers'] ) ) {
		$args['headers'] = array();
	}
	$args['headers']['X-StatChasers-Key'] = $key;
	return $args;
}
add_filter( 'http_request_args', 'statchasers_add_embed_key', 10, 2 );

/**
 * Registers GET /wp-json/statchasers/v1/p/<path>.
 */
function statchasers_register_proxy(): void {
	register_rest_route(
		'statchasers/v1',
		'/p/(?P<path>[A-Za-z0-9_/-]+)',
		array(
			'methods'             => 'GET',
			'callback'            => 'statchasers_proxy',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'statchasers_register_proxy' );

/**
 * Whether a path is one the proxy forwards.
 *
 * @param string $path Path relative to the app origin, no leading slash.
 */
function statchasers_proxy_allowed( string $path ): bool {
	foreach ( STATCHASERS_PROXY_PATHS as $pattern ) {
		if ( preg_match( $pattern, $path ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Sends a response body as-is and stops. The REST server would JSON-encode a
 * WP_REST_Response, and these are HTML fragments and the app's own JSON.
 *
 * @param int    $status HTTP status.
 * @param string $type   Content-Type.
 * @param string $body   Body.
 * @param bool   $cache  Whether browsers and Cloudflare may keep it.
 */
function statchasers_proxy_send( int $status, string $type, string $body, bool $cache ): void {
	status_header( $status );
	header( 'Content-Type: ' . $type );
	header( 'X-Robots-Tag: noindex' );
	header( 'Cache-Control: ' . ( $cache ? 'public, max-age=' . STATCHASERS_PROXY_TTL : 'no-store' ) );
	echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- the app's own fragment, printed as the shortcodes print it.
	exit;
}

/**
 * Forwards one allowed request to the app.
 *
 * @param WP_REST_Request $request The request.
 */
function statchasers_proxy( WP_REST_Request $request ) {
	$path   = trim( (string) $request->get_param( 'path' ), '/' );
	$origin = statchasers_news_origin();
	if ( '' === $origin || ! statchasers_proxy_allowed( $path ) ) {
		statchasers_proxy_send( 404, 'text/plain; charset=utf-8', "Not found\n", false );
	}

	// The query string, minus WordPress's own routing parameter, kept to short
	// plain keys and values: the widgets send format, view, pos, season, from
	// and limit, and nothing else needs to pass.
	$query = array();
	foreach ( $request->get_query_params() as $name => $value ) {
		if ( 'rest_route' === $name || ! is_string( $value ) ) {
			continue;
		}
		if ( preg_match( '/^[a-z_]{1,32}$/', (string) $name ) && strlen( $value ) <= 100 ) {
			$query[ $name ] = $value;
		}
	}
	ksort( $query );
	$url = $origin . '/' . $path . ( $query ? '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) : '' );

	$cache_key = 'sc_proxy_' . md5( $url );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['type'], $cached['body'] ) ) {
		statchasers_proxy_send( 200, (string) $cached['type'], (string) $cached['body'], true );
	}

	// The key is added by statchasers_add_embed_key(), like every other call.
	$response = wp_remote_get(
		$url,
		array(
			'timeout' => STATCHASERS_PROXY_TIMEOUT,
			'headers' => array( 'Accept' => 'api/news' === $path ? 'application/json' : 'text/html' ),
		)
	);
	if ( is_wp_error( $response ) ) {
		statchasers_proxy_send( 502, 'text/plain; charset=utf-8', "Upstream unavailable\n", false );
	}

	$status = (int) wp_remote_retrieve_response_code( $response );
	$type   = (string) wp_remote_retrieve_header( $response, 'content-type' );
	$body   = (string) wp_remote_retrieve_body( $response );
	if ( '' === $type ) {
		$type = 'text/html; charset=utf-8';
	}
	if ( 200 !== $status ) {
		// The widgets fall back to a plain link on any failure; pass the status on.
		statchasers_proxy_send( $status >= 400 ? $status : 502, 'text/plain; charset=utf-8', "Unavailable\n", false );
	}

	set_transient( $cache_key, array( 'type' => $type, 'body' => $body ), STATCHASERS_PROXY_TTL );
	statchasers_proxy_send( 200, $type, $body, true );
}
