<?php
/**
 * NFL depth charts: how a published change reaches the reader (audit WEB-003,
 * docs/WEB-003-DEPTH-CHARTS-CACHE.md).
 *
 * Two surfaces, two data paths, one cache stack in front of both: WP Rocket's
 * page files (desktop and mobile, 24 hours) and the Rocket.net Cloudflare edge
 * (30 days, stamped by the platform on every 200; nothing purged it on a data
 * change). The same remedy the stats pages got (statchasers-player-stats-cache
 * .php), with the shared mechanics in statchasers-edge-cache.php.
 *
 * ## The league page, /nfl/nfl-depth-charts/ (WP page 2068)
 *
 * The shortcode prints the page with `data-endpoint=".../depth-charts.json?v=
 * <meta last_refreshed_ts>"` and the browser fetches the data. A new `?v=` is
 * a new edge entry, so the JSON is never stale; the HTML that names the `?v=`
 * was. SCDC_Refresh::store() fires `scdc_published` once the file is written
 * and the meta stored (a publication; nothing else fires it), and this file:
 *
 *   1. clears WP Rocket's files for the page (desktop and mobile);
 *   2. purges its path at the edge (Rocket.net's targeted purge);
 *   3. records the publication and, a minute later, requests the page once
 *      as a desktop and once as a phone so both caches refill from it.
 *
 * The data is readable before step 1, so the refill cannot see the old `?v=`.
 *
 * ## The team tabs, /nfl/teams/{slug}/depth-chart/
 *
 * Rendered by the API from a snapshot committed by hand and shipped with a
 * Replit publish (docs/DEPTH-CHART-MANUAL-UPDATE.md; the WordPress push stays
 * off). Every five minutes WP-cron reads GET /embed/depth-charts/version: one
 * fingerprint, plus each club's content hash and version. When the
 * fingerprint differs from the one published here:
 *
 *   1. fetch the depth-chart fragment of every club whose hash moved; each
 *      must carry the X-SC-Depth-Version that was announced, or nothing is
 *      changed (a publish landing between the two calls waits for the next
 *      run, an API that is down changes nothing);
 *   2. replace those clubs' fragment copies (fresh and backup);
 *   3. clear WP Rocket's files for exactly those addresses;
 *   4. purge exactly those paths at the edge;
 *   5. record, and warm them a minute later, desktop and phone.
 *
 * Steps 1-2 come before 3-4 so that the request that refills a page after the
 * purge cannot be rendered from the old fragment; 3 before 4 so the edge
 * cannot refill from WP Rocket's old file.
 *
 * ## The edge lifetime
 *
 * As a fallback for a missed purge both surfaces ask for six hours
 * (STATCHASERS_EDGE_TTL), with X-SC-Depth-Cache naming what was published.
 * The platform replaces it with its 30 days until the route-scoped Rocket.net
 * rule in the doc is in place.
 *
 * By hand:
 *   wp eval 'print_r( statchasers_depth_charts_publish_check( true ) );'   (teams, forced)
 *   wp eval 'print_r( statchasers_depth_charts_hub_publish() );'           (league page)
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The WP-cron hook of the team-tab publication check (every five minutes). */
const STATCHASERS_DEPTH_PUBLISH_HOOK = 'statchasers_depth_charts_publish_check';

/** The warm-ups that follow a publication. */
const STATCHASERS_DEPTH_TEAM_WARM_HOOK = 'statchasers_depth_charts_team_warm';
const STATCHASERS_DEPTH_HUB_WARM_HOOK  = 'statchasers_depth_charts_hub_warm';

/** What was last published, and when (one row each, autoload off). */
const STATCHASERS_DEPTH_TEAM_OPTION = 'statchasers_depth_charts_team_published';
const STATCHASERS_DEPTH_HUB_OPTION  = 'statchasers_depth_charts_hub_published';

/** The team section these routes serve. */
const STATCHASERS_DEPTH_SECTION = 'depth-chart';

/* ------------------------------------------------------------- the schedule */

add_action(
	'init',
	static function (): void {
		if ( '' === statchasers_news_origin() || wp_next_scheduled( STATCHASERS_DEPTH_PUBLISH_HOOK ) ) {
			return;
		}
		wp_schedule_event( time() + 2 * MINUTE_IN_SECONDS, 'statchasers_five_minutes', STATCHASERS_DEPTH_PUBLISH_HOOK );
	}
);

add_action(
	STATCHASERS_DEPTH_PUBLISH_HOOK,
	static function (): void {
		statchasers_depth_charts_publish_check();
	}
);
add_action( STATCHASERS_DEPTH_TEAM_WARM_HOOK, 'statchasers_depth_charts_team_warm' );
add_action( STATCHASERS_DEPTH_HUB_WARM_HOOK, 'statchasers_depth_charts_hub_warm' );
add_action( 'scdc_published', 'statchasers_depth_charts_on_published', 10, 2 );

/* ------------------------------------------------------------ the addresses */

/** The league page's canonical address. */
function statchasers_depth_charts_hub_url(): string {
	if ( class_exists( 'SCDC_Pages' ) && method_exists( 'SCDC_Pages', 'depth_charts_url' ) ) {
		return (string) SCDC_Pages::depth_charts_url();
	}
	return trailingslashit( home_url( '/nfl/nfl-depth-charts/' ) );
}

/**
 * The edge paths a league-page publication purges: the page itself. The
 * pre-1.7.0 nested addresses are 301s that carry no chart, the JSON is
 * addressed by `?v=`, and /nfl/ ([statchasers_nfl_hub]) prints links only.
 *
 * @return string[]
 */
function statchasers_depth_charts_hub_paths(): array {
	$paths = array( (string) wp_parse_url( statchasers_depth_charts_hub_url(), PHP_URL_PATH ) );

	/**
	 * Filters the edge paths purged when the league depth-chart page publishes.
	 *
	 * @param string[] $paths Paths, with any query strings.
	 */
	return array_values( array_unique( array_filter( (array) apply_filters( 'statchasers_depth_charts_hub_purge_paths', $paths ) ) ) );
}

/**
 * One club's Depth Chart tab, the canonical address.
 *
 * @param string $slug Team slug.
 */
function statchasers_depth_charts_team_url( string $slug ): string {
	return user_trailingslashit( home_url( '/' . trim( STATCHASERS_TEAM_PATH, '/' ) . '/' . $slug . '/' . STATCHASERS_DEPTH_SECTION ) );
}

/* ------------------------------------------------------ the league page */

/**
 * `scdc_published`: a new league snapshot is readable. Purge now, warm in a
 * minute (the purge takes a moment to land).
 *
 * @param mixed $meta    The stored refresh meta.
 * @param mixed $payload The document (unused: the page reads it from disk).
 */
function statchasers_depth_charts_on_published( $meta = array(), $payload = null ): void {
	statchasers_depth_charts_hub_publish( is_array( $meta ) ? $meta : array() );
}

/**
 * Clear and purge the league page, record, schedule the warm-up.
 *
 * @param array<string,mixed> $meta The refresh meta; read from the option when empty.
 * @return array<string,mixed> The record.
 */
function statchasers_depth_charts_hub_publish( array $meta = array() ): array {
	if ( ! $meta && class_exists( 'SCDC_Store' ) ) {
		$meta = SCDC_Store::get_meta();
	}
	$now   = time();
	$url   = statchasers_depth_charts_hub_url();
	$paths = statchasers_depth_charts_hub_paths();

	// 1. WP Rocket, desktop and mobile.
	$rocket = false;
	if ( function_exists( 'rocket_clean_files' ) ) {
		rocket_clean_files( array( $url ) );
		$rocket = true;
	}

	// 2. The edge, exactly this page.
	$edge = statchasers_edge_purge_paths( $paths, 'statchasers_depth_charts_pre_purge_edge' );

	// 3. Record; refill in a minute.
	if ( ! wp_next_scheduled( STATCHASERS_DEPTH_HUB_WARM_HOOK ) ) {
		wp_schedule_single_event( $now + MINUTE_IN_SECONDS, STATCHASERS_DEPTH_HUB_WARM_HOOK );
	}
	$stored = get_option( STATCHASERS_DEPTH_HUB_OPTION );
	$record = array(
		'version'      => isset( $meta['last_refreshed_ts'] ) ? (int) $meta['last_refreshed_ts'] : 0,
		'status'       => isset( $meta['status'] ) ? (string) $meta['status'] : '',
		'previous'     => is_array( $stored ) && isset( $stored['version'] ) ? (int) $stored['version'] : 0,
		'published_at' => $now,
		'url'          => $url,
		'wp_rocket'    => $rocket,
		'edge'         => $edge,
		'paths'        => $paths,
	);
	update_option( STATCHASERS_DEPTH_HUB_OPTION, $record, false );
	return $record;
}

/**
 * The league page's warm-up.
 *
 * @return array<string,string>
 */
function statchasers_depth_charts_hub_warm(): array {
	$out    = statchasers_edge_warm( array( statchasers_depth_charts_hub_url() ), 'StatChasers-DepthWarm/1' );
	$stored = get_option( STATCHASERS_DEPTH_HUB_OPTION );
	if ( is_array( $stored ) ) {
		$stored['warmed_at'] = time();
		$stored['warm']      = $out;
		update_option( STATCHASERS_DEPTH_HUB_OPTION, $stored, false );
	}
	return $out;
}

/* --------------------------------------------------------- the team tabs */

/**
 * The API's depth-chart publication, or null when it cannot be read or does
 * not name every club.
 *
 * @return array{version:string,fetchedAt:string,teams:array<string,array{hash:string,version:string}>}|null
 */
function statchasers_depth_charts_remote_version(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}
	$response = wp_remote_get(
		$origin . '/embed/depth-charts/version',
		array(
			'timeout' => 10,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$doc = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $doc ) || ! isset( $doc['version'], $doc['teams'] ) || ! is_string( $doc['version'] ) || '' === $doc['version'] || ! is_array( $doc['teams'] ) ) {
		return null;
	}
	$teams = array();
	foreach ( array_keys( statchasers_team_table() ) as $slug ) {
		$info = $doc['teams'][ $slug ] ?? null;
		if ( ! is_array( $info ) || ! isset( $info['hash'], $info['version'] ) || ! is_string( $info['hash'] ) || ! is_string( $info['version'] ) ) {
			return null;
		}
		$teams[ $slug ] = array(
			'hash'       => $info['hash'],
			'version'    => $info['version'],
			'updated_at' => isset( $info['updatedAt'] ) && is_string( $info['updatedAt'] ) ? $info['updatedAt'] : '',
		);
	}
	return array(
		'version'   => $doc['version'],
		'fetchedAt' => isset( $doc['fetchedAt'] ) ? (string) $doc['fetchedAt'] : '',
		'teams'     => $teams,
	);
}

/**
 * One club's depth-chart fragment as the API renders it now, with the
 * snapshot version it was rendered from; null on any failure.
 *
 * @param string $slug Team slug.
 * @return array{html:string,version:string,depth:string}|null
 */
function statchasers_depth_charts_remote_fragment( string $slug ): ?array {
	$response = wp_remote_get(
		statchasers_team_fragment_url( $slug, STATCHASERS_DEPTH_SECTION ),
		array(
			'timeout' => STATCHASERS_TEAM_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === trim( $body ) ) {
		return null;
	}
	return array(
		'html'    => $body,
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
		'depth'   => trim( (string) wp_remote_retrieve_header( $response, 'x-sc-depth-version' ) ),
	);
}

/**
 * One team-tab publication check. See the file header for the order and why.
 *
 * @param bool $force Re-publish every club (refresh, clear, purge) even when nothing moved.
 * @return array<string,mixed> What happened, also stored in the option.
 */
function statchasers_depth_charts_publish_check( bool $force = false ): array {
	$now    = time();
	$stored = get_option( STATCHASERS_DEPTH_TEAM_OPTION );
	$stored = is_array( $stored ) ? $stored : array();

	$remote = statchasers_depth_charts_remote_version();
	if ( null === $remote ) {
		return statchasers_depth_charts_team_record( $stored, array( 'checked_at' => $now, 'result' => 'version unavailable; nothing changed' ) );
	}
	if ( ! $force && isset( $stored['version'] ) && $stored['version'] === $remote['version'] ) {
		return statchasers_depth_charts_team_record( $stored, array( 'checked_at' => $now, 'result' => 'unchanged' ) );
	}

	// The clubs whose chart moved. The first check after an install has no
	// record, so every club is published once: the edge may hold any older
	// snapshot until then.
	$known   = isset( $stored['teams'] ) && is_array( $stored['teams'] ) ? $stored['teams'] : array();
	$changed = array();
	foreach ( $remote['teams'] as $slug => $info ) {
		if ( $force || ! isset( $known[ $slug ] ) || $known[ $slug ] !== $info['hash'] ) {
			$changed[] = $slug;
		}
	}

	$hashes = array_map( static fn( array $info ): string => $info['hash'], $remote['teams'] );
	$base   = array(
		'version'      => $remote['version'],
		'fetched_at'   => $remote['fetchedAt'],
		'published_at' => $now,
		'previous'     => isset( $stored['version'] ) ? (string) $stored['version'] : '',
		'teams'        => $hashes,
	);

	if ( ! $changed ) {
		// A new stamp over the same charts: nothing a reader sees moved.
		return statchasers_depth_charts_team_record(
			$base + array( 'changed' => array(), 'paths' => 0, 'wp_rocket' => false, 'edge' => 'not needed' ),
			array( 'checked_at' => $now, 'result' => 'no club changed' )
		);
	}

	// 1. The fragments of the announced snapshot, all of them or none.
	$fresh = array();
	foreach ( $changed as $slug ) {
		$payload = statchasers_depth_charts_remote_fragment( $slug );
		if ( null === $payload ) {
			return statchasers_depth_charts_team_record( $stored, array( 'checked_at' => $now, 'result' => "fetch failed for {$slug}; previous snapshot kept" ) );
		}
		if ( $payload['depth'] !== $remote['teams'][ $slug ]['version'] ) {
			return statchasers_depth_charts_team_record( $stored, array( 'checked_at' => $now, 'result' => "{$slug} moved during the check; retrying next run" ) );
		}
		$fresh[ $slug ] = $payload;
	}

	// 2. Publish them to the fragment cache.
	foreach ( $fresh as $slug => $payload ) {
		statchasers_team_store_fragment(
			$slug,
			STATCHASERS_DEPTH_SECTION,
			array(
				'html'    => $payload['html'],
				'version' => $payload['version'],
			)
		);
	}

	// 3. WP Rocket's files for exactly those addresses, desktop and mobile.
	$urls   = array_map( 'statchasers_depth_charts_team_url', $changed );
	$rocket = false;
	if ( function_exists( 'rocket_clean_files' ) ) {
		rocket_clean_files( $urls );
		$rocket = true;
	}

	// 4. The edge, exactly those paths.
	$paths = array();
	foreach ( $urls as $url ) {
		$paths[] = (string) wp_parse_url( $url, PHP_URL_PATH );
	}

	/**
	 * Filters the edge paths purged when clubs' depth charts publish.
	 *
	 * @param string[] $paths   Paths.
	 * @param string[] $changed The clubs' slugs.
	 */
	$paths = array_values( array_unique( (array) apply_filters( 'statchasers_depth_charts_team_purge_paths', $paths, $changed ) ) );
	$edge  = statchasers_edge_purge_paths( $paths, 'statchasers_depth_charts_pre_purge_edge' );

	// 5. Record, then refill in a minute.
	if ( ! wp_next_scheduled( STATCHASERS_DEPTH_TEAM_WARM_HOOK ) ) {
		wp_schedule_single_event( $now + MINUTE_IN_SECONDS, STATCHASERS_DEPTH_TEAM_WARM_HOOK );
	}

	return statchasers_depth_charts_team_record(
		$base + array(
			'changed'   => $changed,
			'paths'     => count( $paths ),
			'wp_rocket' => $rocket,
			'edge'      => $edge,
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
function statchasers_depth_charts_team_record( array $published, array $check ): array {
	$record = array_merge( $published, $check );
	update_option( STATCHASERS_DEPTH_TEAM_OPTION, $record, false );
	return $record;
}

/**
 * The team tabs' warm-up: the clubs the last publication changed.
 *
 * @return array<string,string>
 */
function statchasers_depth_charts_team_warm(): array {
	$stored  = get_option( STATCHASERS_DEPTH_TEAM_OPTION );
	$changed = is_array( $stored ) && isset( $stored['changed'] ) && is_array( $stored['changed'] ) ? $stored['changed'] : array();
	$out     = statchasers_edge_warm( array_map( 'statchasers_depth_charts_team_url', $changed ), 'StatChasers-DepthWarm/1' );
	if ( is_array( $stored ) ) {
		$stored['warmed_at'] = time();
		$stored['warm']      = $out;
		update_option( STATCHASERS_DEPTH_TEAM_OPTION, $stored, false );
	}
	return $out;
}

/* --------------------------------------------------------- the edge lifetime */

/**
 * Which depth-chart surface this request is, or ''.
 *
 * @return string 'hub' | 'team' | ''
 */
function statchasers_depth_charts_cache_surface(): string {
	if ( class_exists( 'SCDC_Route' ) && method_exists( 'SCDC_Route', 'is_main' ) && SCDC_Route::is_main() ) {
		return 'hub';
	}
	if ( STATCHASERS_DEPTH_SECTION === statchasers_team_section_from_url() && '' !== statchasers_team_current_slug() ) {
		return 'team';
	}
	return '';
}

/**
 * The six-hour fallback lifetime on the league page and the 32 Depth Chart
 * tabs, sent before output. `published=` names the publication the page was
 * rendered after: the league page's `?v=`, or the club's content hash.
 */
function statchasers_depth_charts_cache_headers(): void {
	if ( is_admin() || headers_sent() ) {
		return;
	}
	$surface = statchasers_depth_charts_cache_surface();
	if ( '' === $surface ) {
		return;
	}
	$ttl = (int) apply_filters( 'statchasers_depth_charts_edge_ttl', STATCHASERS_EDGE_TTL, $surface );
	if ( 'hub' === $surface ) {
		$meta = class_exists( 'SCDC_Store' ) ? SCDC_Store::get_meta() : array();
		$ver  = isset( $meta['last_refreshed_ts'] ) ? (string) (int) $meta['last_refreshed_ts'] : 'none';
	} else {
		$stored = get_option( STATCHASERS_DEPTH_TEAM_OPTION );
		$slug   = statchasers_team_current_slug();
		$ver    = is_array( $stored ) && isset( $stored['teams'][ $slug ] ) ? (string) $stored['teams'][ $slug ] : 'none';
	}
	statchasers_edge_ttl_headers( $ttl, 'X-SC-Depth-Cache', 'surface=' . $surface . '; published=' . preg_replace( '/[^A-Za-z0-9]/', '', $ver ) );
}
add_action( 'template_redirect', 'statchasers_depth_charts_cache_headers', 20 );
