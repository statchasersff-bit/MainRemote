<?php
/**
 * NFL Player Stats: how a new stats snapshot reaches the visitor (audit
 * WEB-003, WEB-002).
 *
 * ## The layers, and what each one held on 2026-11-24
 *
 * A stats rebuild (scripts/player-stats/buildSeason.mjs) lands in the API's
 * data files, and the API serves it at once: its caches are keyed on the file
 * and, since WEB-003, on the rendered markup. Between the API and a visitor
 * are three more copies, each with its own lifetime:
 *
 *   1. this plugin's fragment transient (sc_stats_ssr_*, one hour, plus a
 *      30-day outage backup);
 *   2. WP Rocket's page files (desktop and mobile, 24-hour lifespan);
 *   3. the Rocket.net Cloudflare edge, whose platform strips the origin's
 *      Cache-Control from PHP responses and stamps `s-maxage=2592000` (30
 *      days) on every 200 (docs/WEB-040-SCHEDULE-STATUS.md).
 *
 * Nothing purged the third on a data change. A post save does (Rocket.net's
 * "CDN Cache Plugin" mu-plugin purges a saved post's URLs), but a data rebuild
 * saves no post, and /rb/, /wr/ and /te/ are rewrite routes no post names. So
 * the edge kept Weeks 1-10 for as long as nobody purged the whole site, while
 * WordPress itself already rendered Weeks 1-11.
 *
 * ## The publication check
 *
 * Every five minutes (WP-cron; this host runs wp-cron.php from a real system
 * cron) the plugin asks the API for GET /embed/player-stats/version: one
 * fingerprint of what the four pages would print, and each position's own
 * fragment ETag. When the fingerprint differs from the last one published
 * here, in this order:
 *
 *   1. fetch the four fragments and check each one's ETag is the one
 *      announced (a rebuild landing between the two calls waits for the next
 *      run); any failure stops here, so the copies already published - the
 *      last complete snapshot - stay exactly as they are;
 *   2. replace the fragment transients (fresh and backup) with them, and drop
 *      every other fresh stats transient (season variants, attribute renders);
 *   3. delete WP Rocket's files for the four addresses (desktop and mobile);
 *   4. purge those paths at the edge through the mu-plugin's own API call
 *      (CDN_Clear_Cache_Api::cache_api_call, the targeted purge its admin
 *      form uses), plus /qb/ and the old ?season= variants;
 *   5. record the version, and a minute later request each address once as a
 *      desktop and once as a phone, so the edge and WP Rocket refill from the
 *      new snapshot and no visitor pays the cold render.
 *
 * Steps 1-2 come before 3-4 so that the request that refills the edge after
 * the purge cannot be rendered from the old fragment; step 3 comes before 4
 * so it cannot be served WP Rocket's old file either.
 *
 * ## The edge lifetime
 *
 * As a fallback for a missed purge, the pages ask for a six-hour edge
 * lifetime the same three ways the schedule does (Cache-Control s-maxage,
 * CDN-Cache-Control, Cloudflare-CDN-Cache-Control). Today the platform
 * replaces all of that with its 30 days; honoring it needs the route-scoped
 * hosting change written up in docs/WEB-003-STATS-FRESHNESS.md.
 *
 * `wp eval 'print_r( statchasers_player_stats_publish_check( true ) );'`
 * runs a check by hand and forces the purge even when nothing changed.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The WP-cron hook of the publication check. */
const STATCHASERS_PLAYER_STATS_PUBLISH_HOOK = 'statchasers_player_stats_publish_check';

/** The warm-up that follows a publication. */
const STATCHASERS_PLAYER_STATS_WARM_HOOK = 'statchasers_player_stats_warm';

/** What was last published, and when (one row, autoload off). */
const STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION = 'statchasers_player_stats_published';

/** The fallback edge lifetime of a stats page: hours, not 30 days. */
const STATCHASERS_PLAYER_STATS_EDGE_TTL = 6 * HOUR_IN_SECONDS;

/** Seconds a fetch claim is honored before another request may take it over. */
const STATCHASERS_PLAYER_STATS_FETCH_LEASE = 20;

/* ------------------------------------------------------------- the schedule */

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

add_action(
	'init',
	static function (): void {
		if ( '' === statchasers_news_origin() || wp_next_scheduled( STATCHASERS_PLAYER_STATS_PUBLISH_HOOK ) ) {
			return;
		}
		wp_schedule_event( time() + MINUTE_IN_SECONDS, 'statchasers_five_minutes', STATCHASERS_PLAYER_STATS_PUBLISH_HOOK );
	}
);

add_action(
	STATCHASERS_PLAYER_STATS_PUBLISH_HOOK,
	static function (): void {
		statchasers_player_stats_publish_check();
	}
);
add_action( STATCHASERS_PLAYER_STATS_WARM_HOOK, 'statchasers_player_stats_warm' );

/* ------------------------------------------------------------ the addresses */

/**
 * The four canonical addresses, keyed by position.
 *
 * @return array<string,string>
 */
function statchasers_player_stats_public_urls(): array {
	$urls = array();
	foreach ( STATCHASERS_PLAYER_STATS_POSITIONS as $pos ) {
		$urls[ $pos ] = statchasers_player_stats_position_url( $pos );
	}
	return $urls;
}

/**
 * The edge paths a publication purges: the four pages, /qb/ (a redirect, but
 * an entry of its own) and every ?season= variant the old season links
 * created, which stay at the edge until purged even though the plugin now
 * redirects them.
 *
 * @param string[] $seasons Seasons the API holds ("2023" ... "all").
 * @return string[]
 */
function statchasers_player_stats_purge_paths( array $seasons ): array {
	$paths = array();
	$all   = statchasers_player_stats_public_urls();
	$all['qb-alias'] = user_trailingslashit( home_url( '/' . statchasers_player_stats_page_path() . '/qb' ) );
	foreach ( $all as $url ) {
		$path    = (string) wp_parse_url( $url, PHP_URL_PATH );
		$paths[] = $path;
		foreach ( $seasons as $season ) {
			if ( 1 === preg_match( '/^(\d{4}|all)$/', (string) $season ) ) {
				$paths[] = $path . '?season=' . $season;
			}
		}
	}

	/**
	 * Filters the edge paths purged when a new stats snapshot is published.
	 *
	 * @param string[] $paths   Paths, with their query strings.
	 * @param string[] $seasons The seasons the API holds.
	 */
	return array_values( array_unique( (array) apply_filters( 'statchasers_player_stats_purge_paths', $paths, $seasons ) ) );
}

/* --------------------------------------------------------- the version poll */

/**
 * The API's publication fingerprint, or null when it cannot be read.
 *
 * @return array{version:string,season:string,seasons:string[],positions:array<string,array<string,mixed>>}|null
 */
function statchasers_player_stats_remote_version(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}
	$response = wp_remote_get(
		$origin . '/embed/player-stats/version',
		array(
			'timeout' => 10,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$doc = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $doc ) || ! isset( $doc['version'], $doc['positions'] ) || ! is_string( $doc['version'] ) || ! is_array( $doc['positions'] ) ) {
		return null;
	}
	foreach ( STATCHASERS_PLAYER_STATS_POSITIONS as $pos ) {
		if ( ! isset( $doc['positions'][ $pos ]['etag'] ) || ! is_string( $doc['positions'][ $pos ]['etag'] ) ) {
			return null;
		}
	}
	return array(
		'version'   => $doc['version'],
		'season'    => isset( $doc['season'] ) ? (string) $doc['season'] : '',
		'seasons'   => isset( $doc['seasons'] ) && is_array( $doc['seasons'] ) ? array_map( 'strval', $doc['seasons'] ) : array(),
		'positions' => $doc['positions'],
	);
}

/**
 * One publication check. See the file header for the order and why.
 *
 * @param bool $force Publish (refresh, clear, purge) even when the version has not moved.
 * @return array<string,mixed> What happened, also stored in the option.
 */
function statchasers_player_stats_publish_check( bool $force = false ): array {
	$now    = time();
	$stored = get_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION );
	$stored = is_array( $stored ) ? $stored : array();

	$remote = statchasers_player_stats_remote_version();
	if ( null === $remote ) {
		return statchasers_player_stats_publish_record( $stored, array( 'checked_at' => $now, 'result' => 'version unavailable; nothing changed' ) );
	}
	if ( ! $force && isset( $stored['version'] ) && $stored['version'] === $remote['version'] ) {
		return statchasers_player_stats_publish_record( $stored, array( 'checked_at' => $now, 'result' => 'unchanged' ) );
	}

	// 1. The four fragments of the announced snapshot, all of them or none.
	$fresh = array();
	foreach ( STATCHASERS_PLAYER_STATS_POSITIONS as $pos ) {
		$args    = array(
			'pos'    => $pos,
			'season' => '',
		);
		$payload = statchasers_player_stats_remote( $args );
		if ( null === $payload ) {
			return statchasers_player_stats_publish_record( $stored, array( 'checked_at' => $now, 'result' => "fetch failed for {$pos}; previous snapshot kept" ) );
		}
		if ( $payload['version'] !== $remote['positions'][ $pos ]['etag'] ) {
			return statchasers_player_stats_publish_record( $stored, array( 'checked_at' => $now, 'result' => "{$pos} moved during the check; retrying next run" ) );
		}
		$fresh[ $pos ] = array( $args, $payload );
	}

	// 2. Publish them to the fragment cache. The other fresh copies go first
	//    (a season variant or a shortcode attribute render of the old data),
	//    then the four are written in their place.
	statchasers_player_stats_flush( false );
	foreach ( $fresh as $pair ) {
		statchasers_player_stats_store( $pair[0], $pair[1] );
	}

	// 3. WP Rocket's files for the four addresses, desktop and mobile.
	$urls   = array_values( statchasers_player_stats_public_urls() );
	$rocket = false;
	if ( function_exists( 'rocket_clean_files' ) ) {
		rocket_clean_files( $urls );
		$rocket = true;
	}

	// 4. The edge, for exactly these paths.
	$paths = statchasers_player_stats_purge_paths( $remote['seasons'] );
	$edge  = statchasers_player_stats_purge_edge( $paths );

	// 5. Record, then refill in a minute (the purge takes a moment to land).
	$weeks = array();
	foreach ( STATCHASERS_PLAYER_STATS_POSITIONS as $pos ) {
		$info          = $remote['positions'][ $pos ];
		$weeks[ $pos ] = array(
			'weeks'      => isset( $info['weeks'] ) ? (string) $info['weeks'] : '',
			'updated_at' => isset( $info['updatedAt'] ) ? (string) $info['updatedAt'] : '',
			'etag'       => (string) $info['etag'],
		);
	}
	if ( ! wp_next_scheduled( STATCHASERS_PLAYER_STATS_WARM_HOOK ) ) {
		wp_schedule_single_event( $now + MINUTE_IN_SECONDS, STATCHASERS_PLAYER_STATS_WARM_HOOK );
	}

	return statchasers_player_stats_publish_record(
		array(
			'version'      => $remote['version'],
			'season'       => $remote['season'],
			'published_at' => $now,
			'previous'     => isset( $stored['version'] ) ? (string) $stored['version'] : '',
			'positions'    => $weeks,
			'wp_rocket'    => $rocket,
			'edge'         => $edge,
			'paths'        => count( $paths ),
		),
		array(
			'checked_at' => $now,
			'result'     => $force && isset( $stored['version'] ) && $stored['version'] === $remote['version'] ? 'republished (forced)' : 'published',
		)
	);
}

/**
 * Store the check's outcome beside what was published.
 *
 * @param array<string,mixed> $published The published state to keep.
 * @param array<string,mixed> $check     This run's outcome.
 * @return array<string,mixed>
 */
function statchasers_player_stats_publish_record( array $published, array $check ): array {
	$record = array_merge( $published, $check );
	update_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, $record, false );
	return $record;
}

/**
 * Purge paths at the Rocket.net edge through its mu-plugin, when it is there.
 *
 * @param string[] $paths Paths with their query strings, as the mu-plugin's own purges send them.
 * @return string What was done, for the record.
 */
function statchasers_player_stats_purge_edge( array $paths ): string {
	/**
	 * Short-circuits the edge purge, for a host with another CDN (or a test).
	 * Return a string to report instead of calling Rocket.net.
	 *
	 * @param string|null $result Null to purge through Rocket.net.
	 * @param string[]    $paths  The paths.
	 */
	$short = apply_filters( 'statchasers_player_stats_pre_purge_edge', null, $paths );
	if ( is_string( $short ) ) {
		return $short;
	}
	if ( ! class_exists( 'CDN_Clear_Cache_Api' ) || ! method_exists( 'CDN_Clear_Cache_Api', 'cache_api_call' ) ) {
		return 'no edge purge available';
	}
	$result = CDN_Clear_Cache_Api::cache_api_call( $paths, 'purge' );
	$ok     = is_object( $result ) && isset( $result->success ) ? ( $result->success ? 'ok' : 'refused' ) : 'sent';
	return 'rocket.net ' . $ok;
}

/**
 * Request each address once as a desktop and once as a phone, so the edge and
 * WP Rocket hold the new snapshot before a visitor asks. Sequential and
 * blocking: it runs in cron, and parallel cold renders are what the warm-up
 * exists to spare the origin.
 *
 * @return array<string,string> URL and agent => status and cache status.
 */
function statchasers_player_stats_warm(): array {
	$agents = array(
		'desktop' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 StatChasers-StatsWarm/1',
		'phone'   => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 StatChasers-StatsWarm/1',
	);
	$out = array();
	foreach ( statchasers_player_stats_public_urls() as $url ) {
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
	$stored = get_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION );
	if ( is_array( $stored ) ) {
		$stored['warmed_at'] = time();
		$stored['warm']      = $out;
		update_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION, $stored, false );
	}
	return $out;
}

/* --------------------------------------------------------- the edge lifetime */

/**
 * The six-hour fallback lifetime, sent before output on the four pages.
 * WP Rocket keeps storing them: the publication check clears its files.
 */
function statchasers_player_stats_cache_headers(): void {
	if ( is_admin() || headers_sent() || ! statchasers_player_stats_post_has_shortcode() ) {
		return;
	}
	$ttl = (int) apply_filters( 'statchasers_player_stats_edge_ttl', STATCHASERS_PLAYER_STATS_EDGE_TTL );
	if ( $ttl < 1 ) {
		return;
	}
	header( 'Cache-Control: public, max-age=0, s-maxage=' . $ttl );
	header( 'CDN-Cache-Control: public, max-age=' . $ttl );
	header( 'Cloudflare-CDN-Cache-Control: public, max-age=' . $ttl );
	$stored = get_option( STATCHASERS_PLAYER_STATS_PUBLISHED_OPTION );
	$ver    = is_array( $stored ) && isset( $stored['version'] ) ? (string) $stored['version'] : 'none';
	header( 'X-SC-Stats-Cache: edge-ttl=' . $ttl . '; published=' . preg_replace( '/[^A-Za-z0-9]/', '', $ver ) );
}
add_action( 'template_redirect', 'statchasers_player_stats_cache_headers', 20 );

/* ------------------------------------------------------- the fetch claim */

/**
 * Claim the right to fetch one fragment, so that when its copy expires under
 * load one request asks the API and the others serve the backup for those few
 * hundred milliseconds instead of each starting the same fetch (WEB-002). The
 * claim is a row inserted with INSERT IGNORE (the upgrade sweep's pattern,
 * statchasers_news_claim_upgrade), so exactly one request wins it; a claim
 * older than its lease is taken over, so a request that died holding one
 * blocks nothing for long.
 *
 * @param string $key The fragment's cache key.
 * @return bool Whether this request holds the claim.
 */
function statchasers_player_stats_claim_fetch( string $key ): bool {
	global $wpdb;
	if ( ! isset( $wpdb ) || ! is_object( $wpdb ) || ! method_exists( $wpdb, 'query' ) || ! method_exists( $wpdb, 'prepare' ) || ! method_exists( $wpdb, 'get_var' ) || ( function_exists( 'wp_using_ext_object_cache' ) && wp_using_ext_object_cache() ) ) {
		return true;
	}
	$name = 'sc_stats_claim_' . substr( md5( $key ), 0, 20 );
	$now  = time();
	$won  = $wpdb->query(
		$wpdb->prepare(
			"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
			$name,
			(string) $now
		)
	);
	if ( 1 === (int) $won ) {
		return true;
	}
	$held = (int) $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name ) );
	if ( $now - $held < STATCHASERS_PLAYER_STATS_FETCH_LEASE ) {
		return false;
	}
	// Stale: take it over, if nobody else just did.
	$took = $wpdb->query(
		$wpdb->prepare(
			"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s",
			(string) $now,
			$name,
			(string) $held
		)
	);
	return 1 === (int) $took;
}

/**
 * Give the claim back.
 *
 * @param string $key The fragment's cache key.
 */
function statchasers_player_stats_release_fetch( string $key ): void {
	global $wpdb;
	if ( ! isset( $wpdb ) || ! is_object( $wpdb ) || ! method_exists( $wpdb, 'query' ) || ! method_exists( $wpdb, 'prepare' ) || ! method_exists( $wpdb, 'get_var' ) || ( function_exists( 'wp_using_ext_object_cache' ) && wp_using_ext_object_cache() ) ) {
		return;
	}
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s", 'sc_stats_claim_' . substr( md5( $key ), 0, 20 ) ) );
}
