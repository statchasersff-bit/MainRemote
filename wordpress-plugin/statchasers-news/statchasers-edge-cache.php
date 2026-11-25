<?php
/**
 * The pieces every publication check shares (audit WEB-003): the five-minute
 * WP-cron schedule, the targeted Rocket.net edge purge, the desktop + phone
 * warm-up and the six-hour fallback edge lifetime.
 *
 * Written for the NFL Player Stats pages (statchasers-player-stats-cache.php)
 * and lifted here unchanged when the depth charts needed the same thing
 * (statchasers-depth-charts-cache.php). Each caller keeps its own hooks,
 * options and filters; only the mechanics live here.
 *
 * Why the edge needs an explicit purge: Rocket.net strips the origin's
 * Cache-Control from PHP responses and stamps `public, max-age=0,
 * s-maxage=2592000` (30 days) at its Cloudflare edge
 * (docs/WEB-040-SCHEDULE-STATUS.md). Its mu-plugin purges a post's URLs when
 * the post is saved, and nothing else: a data publication saves no post.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The fallback edge lifetime of a page a publication check purges: hours, not 30 days. */
const STATCHASERS_EDGE_TTL = 6 * HOUR_IN_SECONDS;

/** Paths per Rocket.net purge call (its API's file limit). */
const STATCHASERS_EDGE_PURGE_CHUNK = 30;

add_filter(
	'cron_schedules',
	static function ( $schedules ) {
		if ( is_array( $schedules ) && ! isset( $schedules['statchasers_five_minutes'] ) ) {
			$schedules['statchasers_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => 'Every five minutes (StatChasers)',
			);
		}
		return $schedules;
	}
);

/**
 * Purge paths at the Rocket.net edge through its mu-plugin, when it is there.
 *
 * @param string[] $paths  Paths with their query strings, as the mu-plugin's own purges send them.
 * @param string   $filter A short-circuit filter: return a string from it to report instead of
 *                         calling Rocket.net (another CDN, or a test).
 * @return string What was done, for the record.
 */
function statchasers_edge_purge_paths( array $paths, string $filter ): string {
	$short = apply_filters( $filter, null, $paths );
	if ( is_string( $short ) ) {
		return $short;
	}
	if ( ! class_exists( 'CDN_Clear_Cache_Api' ) || ! method_exists( 'CDN_Clear_Cache_Api', 'cache_api_call' ) ) {
		return 'no edge purge available';
	}
	$outcome = array();
	foreach ( array_chunk( array_values( $paths ), STATCHASERS_EDGE_PURGE_CHUNK ) as $chunk ) {
		$result    = CDN_Clear_Cache_Api::cache_api_call( $chunk, 'purge' );
		$outcome[] = is_object( $result ) && isset( $result->success ) ? ( $result->success ? 'ok' : 'refused' ) : 'sent';
	}
	return 'rocket.net ' . implode( ',', array_unique( $outcome ) );
}

/**
 * Request each address once as a desktop and once as a phone, so the edge and
 * WP Rocket (two caches each: desktop and mobile) hold the new snapshot before
 * a visitor asks. Sequential and blocking: it runs in cron, and parallel cold
 * renders are what the warm-up exists to spare the origin.
 *
 * @param string[] $urls Absolute URLs.
 * @param string   $tag  Product token appended to the user agent ("StatChasers-StatsWarm/1").
 * @return array<string,string> "URL desktop|phone" => status and cache status.
 */
function statchasers_edge_warm( array $urls, string $tag ): array {
	$agents = array(
		'desktop' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 ' . $tag,
		'phone'   => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ' . $tag,
	);
	$out = array();
	foreach ( $urls as $url ) {
		foreach ( $agents as $kind => $agent ) {
			$response = wp_remote_get(
				$url,
				array(
					'timeout'     => 30,
					'redirection' => 0,
					'user-agent'  => $agent,
				)
			);
			$out[ $url . ' ' . $kind ] = is_wp_error( $response )
				? 'error'
				: (int) wp_remote_retrieve_response_code( $response ) . ' ' . (string) wp_remote_retrieve_header( $response, 'cf-cache-status' );
		}
	}
	return $out;
}

/**
 * The fallback edge lifetime, sent before output the three ways the schedule
 * does (Cache-Control s-maxage, CDN-Cache-Control, Cloudflare-CDN-Cache-Control),
 * plus an X- header that says from outside what the plugin decided. Today the
 * platform replaces all of it with its 30 days; honoring it needs the
 * route-scoped hosting change in docs/WEB-003-*.md. WP Rocket keeps storing
 * the page: the publication checks clear its files.
 *
 * @param int    $ttl     Seconds; nothing is sent below 1.
 * @param string $x_name  The X- header ("X-SC-Stats-Cache").
 * @param string $x_value Its value after "edge-ttl=N; ".
 */
function statchasers_edge_ttl_headers( int $ttl, string $x_name, string $x_value ): void {
	if ( $ttl < 1 || headers_sent() ) {
		return;
	}
	header( 'Cache-Control: public, max-age=0, s-maxage=' . $ttl );
	header( 'CDN-Cache-Control: public, max-age=' . $ttl );
	header( 'Cloudflare-CDN-Cache-Control: public, max-age=' . $ttl );
	header( $x_name . ': edge-ttl=' . $ttl . '; ' . $x_value );
}
