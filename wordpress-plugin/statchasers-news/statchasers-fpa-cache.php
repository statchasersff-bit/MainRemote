<?php
/**
 * Fantasy Points Allowed: how a new weekly dataset reaches the visitor (audit
 * WEB-003, docs/FPA-AUDIT-WEB-003-2026-11-27.md).
 *
 * ## The layers
 *
 * The weekly ingest (POST /api/fpa/ingest) replaces every snapshot row of the
 * season in one transaction and drops the API's table memo and render cache,
 * so the API serves the new table at once. Between the API and a visitor are
 * three more copies:
 *
 *   1. this plugin's fragment transient (sc_fpa_ssr_*, 15 minutes, plus a
 *      7-day outage backup), one per format x view x season;
 *   2. WP Rocket's page files (desktop and a separate mobile copy);
 *   3. the Rocket.net Cloudflare edge, which strips the origin's
 *      Cache-Control from PHP responses and stamps `s-maxage=2592000` (30
 *      days) on every 200, desktop and phone apart, every query string its
 *      own entry. Its rules cannot be changed from our side.
 *
 * Nothing purged the third on a data change: a post save does, but an
 * ingest saves no post, and /2025/ is a rewrite route no post names. On
 * 2026-11-24 the edge still said "Weeks 1-10" a day after the origin said
 * "Weeks 1-11"; a manual purge fixed it on 11-25.
 *
 * ## The publication check
 *
 * Every five minutes (WP-cron, the shared 'statchasers_five_minutes'
 * schedule) the plugin asks the API for GET /embed/fpa/version: per season
 * (the current one and each archive), the six format x view fragment ETags
 * and one version over them. For each season whose version differs from the
 * one published here (all of them on the first run, or forced), in order:
 *
 *   1. fetch that season's six fragments, uncached, and check each one's ETag
 *      is the one announced. Any failure (a fetch, an ETag that moved) stops
 *      the whole run here and records nothing new: the copies already
 *      published - the last complete dataset - stay exactly as they are,
 *      backups included, nothing is purged, and the next run tries again;
 *   2. write the fragments as the fresh copy and the outage backup, so the
 *      request that refills a page after the purge renders the new table;
 *   3. delete WP Rocket's files for the season's address (desktop and
 *      mobile; WP Rocket's per-URL clean takes the directory);
 *   4. purge the season's paths at the edge: the address and every format /
 *      view query a link, a bookmark or the old Half-PPR default ever wrote,
 *      through the mu-plugin's targeted purge (statchasers-edge-cache.php),
 *      after WP Rocket, so the edge cannot refill from an old page file;
 *   5. record the versions, and a minute later request each purged address
 *      once as a desktop and once as a phone.
 *
 * An archive season is touched only when its own version moves (a
 * historical correction): the weekly ingest leaves /2025/ alone.
 *
 * A path whose edge purge fails stays pending in the record's retry ledger
 * (5, 10, 20, 40, 80 minutes apart, six attempts in all), with no API fetch
 * and no second WP Rocket clean; a page is warmed only once its purge landed.
 *
 * ## The edge lifetime
 *
 * The current page asks for six hours (STATCHASERS_EDGE_TTL, as the stats
 * pages do), an archive for 30 days, with X-SC-FPA-Cache naming what was
 * published. The platform replaces both with its own 30 days, so the purges
 * and their retry are what keep these pages fresh.
 *
 * `wp eval 'print_r( statchasers_fpa_publish_check( true ) );'` runs a check
 * by hand and republishes every season even when nothing changed.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The WP-cron hook of the publication check. */
const STATCHASERS_FPA_PUBLISH_HOOK = 'statchasers_fpa_publish_check';

/** The warm-up that follows a publication. */
const STATCHASERS_FPA_WARM_HOOK = 'statchasers_fpa_warm';

/** What was last published, and when (one row, autoload off). */
const STATCHASERS_FPA_PUBLISHED_OPTION = 'statchasers_fpa_published';

/** The edge purge's short-circuit filter (another CDN, or a test). */
const STATCHASERS_FPA_PURGE_FILTER = 'statchasers_fpa_pre_purge_edge';

/** The warm-up's user-agent token. */
const STATCHASERS_FPA_WARM_TAG = 'StatChasers-FpaWarm/1';

/** The edge lifetime an archive asks for: a finished season changes only on a correction. */
const STATCHASERS_FPA_ARCHIVE_EDGE_TTL = 30 * DAY_IN_SECONDS;

/* ------------------------------------------------------------- the schedule */

add_action(
	'init',
	static function (): void {
		if ( '' === statchasers_news_origin() || wp_next_scheduled( STATCHASERS_FPA_PUBLISH_HOOK ) ) {
			return;
		}
		wp_schedule_event( time() + 3 * MINUTE_IN_SECONDS, 'statchasers_five_minutes', STATCHASERS_FPA_PUBLISH_HOOK );
	}
);

add_action(
	STATCHASERS_FPA_PUBLISH_HOOK,
	static function (): void {
		statchasers_fpa_publish_check();
	}
);
add_action( STATCHASERS_FPA_WARM_HOOK, 'statchasers_fpa_warm' );

/* ------------------------------------------------------------ the addresses */

/**
 * The six renderings of one season: every scoring format x view, as
 * statchasers_fpa_args() builds them (same key order, so the transient keys
 * are the shortcode's own).
 *
 * @param int $season 0 for the current season (the bare address), else the archive's year.
 * @return array<string,array{format:string,view:string,season:int}> Keyed "format-view".
 */
function statchasers_fpa_variants( int $season ): array {
	$out = array();
	foreach ( STATCHASERS_FPA_FORMATS as $format ) {
		foreach ( STATCHASERS_FPA_VIEWS as $view ) {
			$out[ $format . '-' . $view ] = array(
				'format' => $format,
				'view'   => $view,
				'season' => $season,
			);
		}
	}
	return $out;
}

/**
 * The query strings a season's address is reached with, each its own edge
 * entry: every format and view, either alone or both in either order, the
 * defaults spelled out too (the table's links omitted PPR only since
 * 2026-11-26; before that they omitted Half-PPR and wrote `format=ppr`).
 *
 * @return string[] Without the leading "?"; '' is the bare address.
 */
function statchasers_fpa_query_variants(): array {
	$out = array( '' );
	foreach ( STATCHASERS_FPA_FORMATS as $format ) {
		$out[] = 'format=' . $format;
	}
	foreach ( STATCHASERS_FPA_VIEWS as $view ) {
		$out[] = 'view=' . $view;
	}
	foreach ( STATCHASERS_FPA_FORMATS as $format ) {
		foreach ( STATCHASERS_FPA_VIEWS as $view ) {
			$out[] = 'format=' . $format . '&view=' . $view;
			$out[] = 'view=' . $view . '&format=' . $format;
		}
	}
	return $out;
}

/**
 * The edge paths a season's publication purges.
 *
 * @param int $season 0 for the current season, else the archive's year.
 * @return string[]
 */
function statchasers_fpa_purge_paths( int $season ): array {
	$path  = (string) wp_parse_url( statchasers_fpa_page_url( $season ), PHP_URL_PATH );
	$paths = array();
	foreach ( statchasers_fpa_query_variants() as $query ) {
		$paths[] = '' === $query ? $path : $path . '?' . $query;
	}

	/**
	 * Filters the edge paths purged when an FPA season is published.
	 *
	 * @param string[] $paths  Paths, with their query strings.
	 * @param int      $season 0 for the current season, else the archive's year.
	 */
	return array_values( array_unique( (array) apply_filters( 'statchasers_fpa_purge_paths', $paths, $season ) ) );
}

/* --------------------------------------------------------- the version poll */

/**
 * The API's publication fingerprint, or null when it cannot be read or is
 * not complete (a season missing one of its six variants).
 *
 * @return array{version:string,current:int,seasons:array<string,array<string,mixed>>}|null
 */
function statchasers_fpa_remote_version(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}
	$response = wp_remote_get(
		$origin . '/embed/fpa/version',
		array(
			'timeout' => 10,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$doc = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $doc ) || ! isset( $doc['version'], $doc['current'], $doc['seasons'] ) || ! is_string( $doc['version'] ) || ! is_array( $doc['seasons'] ) ) {
		return null;
	}
	$current = (int) $doc['current'];
	if ( ! isset( $doc['seasons'][ (string) $current ] ) ) {
		return null;
	}
	foreach ( $doc['seasons'] as $year => $scope ) {
		if ( (int) $year < 1999 || ! is_array( $scope ) || ! isset( $scope['version'] ) || ! is_string( $scope['version'] ) ) {
			return null;
		}
		foreach ( array_keys( statchasers_fpa_variants( 0 ) ) as $key ) {
			if ( ! isset( $scope['variants'][ $key ]['etag'] ) || ! is_string( $scope['variants'][ $key ]['etag'] ) ) {
				return null;
			}
		}
	}
	return array(
		'version' => $doc['version'],
		'current' => $current,
		'seasons' => $doc['seasons'],
	);
}

/**
 * One publication check. See the file header for the order and why.
 *
 * @param bool $force Republish every season even when its version has not moved.
 * @return array<string,mixed> What happened, also stored in the option.
 */
function statchasers_fpa_publish_check( bool $force = false ): array {
	$now    = time();
	$stored = get_option( STATCHASERS_FPA_PUBLISHED_OPTION );
	$stored = is_array( $stored ) ? $stored : array();
	$filter = STATCHASERS_FPA_PURGE_FILTER;
	$ledger = statchasers_edge_ledger( $stored, array(), array(), $now );
	$quiet  = static function ( array $check ) use ( $stored, $ledger, $filter, $now ): array {
		return statchasers_fpa_publish_record( $stored, $check + statchasers_edge_retry_fields( $ledger, $filter, STATCHASERS_FPA_PUBLISHED_OPTION, STATCHASERS_FPA_WARM_TAG, $now ) );
	};

	$remote = statchasers_fpa_remote_version();
	if ( null === $remote ) {
		return $quiet( array( 'checked_at' => $now, 'result' => 'version unavailable; nothing changed' ) );
	}

	// Which seasons moved. The current season is the bare address (season 0
	// in the shortcode's arguments); any other is an archive address.
	$published = isset( $stored['seasons'] ) && is_array( $stored['seasons'] ) ? $stored['seasons'] : array();
	$changed   = array();
	foreach ( $remote['seasons'] as $year => $scope ) {
		$year = (int) $year;
		$was  = isset( $published[ (string) $year ]['version'] ) ? (string) $published[ (string) $year ]['version'] : '';
		// A season that was the current one and is now an archive (the
		// rollover) has a new address: compare kinds too.
		$kind_was = isset( $published[ (string) $year ]['kind'] ) ? (string) $published[ (string) $year ]['kind'] : '';
		$kind_now = $year === $remote['current'] ? 'live' : 'archive';
		if ( $force || $was !== $scope['version'] || $kind_was !== $kind_now ) {
			$changed[ $year ] = $year === $remote['current'] ? 0 : $year;
		}
	}
	if ( ! $changed ) {
		return $quiet( array( 'checked_at' => $now, 'result' => 'unchanged' ) );
	}

	// 1. Every fragment of every changed season, all of them or none.
	$fresh = array();
	foreach ( $changed as $year => $arg_season ) {
		foreach ( statchasers_fpa_variants( $arg_season ) as $key => $args ) {
			$payload = statchasers_fpa_remote( $args );
			if ( null === $payload ) {
				return $quiet( array( 'checked_at' => $now, 'result' => "fetch failed for {$year} {$key}; previous dataset kept" ) );
			}
			if ( $payload['version'] !== $remote['seasons'][ (string) $year ]['variants'][ $key ]['etag'] ) {
				return $quiet( array( 'checked_at' => $now, 'result' => "{$year} {$key} moved during the check; retrying next run" ) );
			}
			$fresh[] = array( $args, $payload );
		}
	}

	// 2. The fragment copies, fresh and backup, before anything is purged.
	foreach ( $fresh as $pair ) {
		statchasers_fpa_store( $pair[0], $pair[1] );
	}
	/**
	 * Fires once a publication's fragments are stored, before any page cache
	 * is cleared.
	 *
	 * @param int[] $seasons The changed seasons (0 = the current season's address).
	 */
	do_action( 'statchasers_fpa_fragments_stored', array_values( $changed ) );

	// 3. WP Rocket's files for the changed addresses, desktop and mobile.
	$urls = array();
	foreach ( $changed as $arg_season ) {
		$urls[] = statchasers_fpa_page_url( $arg_season );
	}
	$rocket = false;
	if ( function_exists( 'rocket_clean_files' ) ) {
		rocket_clean_files( $urls );
		$rocket = true;
	}

	// 4. The edge, for exactly these seasons' paths (with whatever an earlier
	//    publication left pending or gave up on, once).
	$paths = array();
	foreach ( $changed as $arg_season ) {
		$paths = array_merge( $paths, statchasers_fpa_purge_paths( $arg_season ) );
	}
	$warm_paths = array_map( static fn( string $url ): string => (string) wp_parse_url( $url, PHP_URL_PATH ), $urls );
	$pub        = statchasers_edge_publish( $paths, $warm_paths, $ledger, $filter, $now );

	// 5. Record, then refill in a minute: the addresses whose purge landed.
	foreach ( $remote['seasons'] as $year => $scope ) {
		if ( ! isset( $changed[ (int) $year ] ) ) {
			continue;
		}
		$etags = array();
		foreach ( $scope['variants'] as $key => $v ) {
			$etags[ $key ] = (string) $v['etag'];
		}
		$published[ (string) $year ] = array(
			'kind'         => (int) $year === $remote['current'] ? 'live' : 'archive',
			'version'      => (string) $scope['version'],
			'week'         => isset( $scope['weekNumber'] ) ? (int) $scope['weekNumber'] : 0,
			'updated_at'   => isset( $scope['updatedAt'] ) ? (string) $scope['updatedAt'] : '',
			'etags'        => $etags,
			'published_at' => $now,
		);
	}
	$to_warm = array_values( array_filter( $urls, static fn( string $url ): bool => in_array( (string) wp_parse_url( $url, PHP_URL_PATH ), $pub['landed'], true ) ) );
	if ( $to_warm && ! wp_next_scheduled( STATCHASERS_FPA_WARM_HOOK ) ) {
		wp_schedule_single_event( $now + MINUTE_IN_SECONDS, STATCHASERS_FPA_WARM_HOOK );
	}

	$all_same = $force && ! array_filter(
		array_keys( $changed ),
		static fn( int $year ): bool => ! isset( $stored['seasons'][ (string) $year ]['version'] ) || $stored['seasons'][ (string) $year ]['version'] !== $remote['seasons'][ (string) $year ]['version']
	);

	return statchasers_fpa_publish_record(
		array(
			'version'      => $remote['version'],
			'current'      => $remote['current'],
			'seasons'      => $published,
			'published_at' => $now,
			'previous'     => isset( $stored['version'] ) ? (string) $stored['version'] : '',
			'changed'      => array_keys( $changed ),
			'wp_rocket'    => $rocket,
			'rocket_urls'  => $urls,
			'edge'         => $pub['purge']['text'],
			'paths'        => count( $pub['paths'] ),
			'to_warm'      => $to_warm,
		) + statchasers_edge_ledger_fields( $pub['ledger'] ),
		array(
			'checked_at' => $now,
			'result'     => $all_same ? 'republished (forced)' : 'published',
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
function statchasers_fpa_publish_record( array $published, array $check ): array {
	$record = array_merge( $published, $check );
	update_option( STATCHASERS_FPA_PUBLISHED_OPTION, $record, false );
	return $record;
}

/**
 * Request each published address once as a desktop and once as a phone, so
 * the edge and WP Rocket hold the new table before a visitor asks. Only the
 * addresses whose edge purge landed (`to_warm`); one whose purge is retried
 * is warmed by the retry's own warm-up.
 *
 * @return array<string,string> URL and agent => status and cache status.
 */
function statchasers_fpa_warm(): array {
	$stored = get_option( STATCHASERS_FPA_PUBLISHED_OPTION );
	$urls   = is_array( $stored ) && isset( $stored['to_warm'] ) && is_array( $stored['to_warm'] ) ? $stored['to_warm'] : array( statchasers_fpa_page_url( 0 ) );
	$out    = statchasers_edge_warm( $urls, STATCHASERS_FPA_WARM_TAG );
	if ( is_array( $stored ) ) {
		$stored['warmed_at'] = time();
		$stored['warm']      = $out;
		update_option( STATCHASERS_FPA_PUBLISHED_OPTION, $stored, false );
	}
	return $out;
}

/* --------------------------------------------------------- the edge lifetime */

/**
 * The lifetime the page asks the edge for, or 0 for none: six hours on the
 * current season, 30 days on an archive, nothing on a season with no table
 * (a 404, which sends its own no-cache headers). Pure, for the smoke test.
 *
 * @param int  $season    The season the address names (0 = the current page).
 * @param bool $not_found Whether the address is a 404.
 */
function statchasers_fpa_edge_ttl( int $season, bool $not_found ): int {
	if ( $not_found ) {
		return 0;
	}
	$ttl = $season > 0 ? STATCHASERS_FPA_ARCHIVE_EDGE_TTL : STATCHASERS_EDGE_TTL;
	/**
	 * Filters the edge lifetime the FPA page asks for.
	 *
	 * @param int $ttl    Seconds.
	 * @param int $season 0 for the current page, else the archive's year.
	 */
	return (int) apply_filters( 'statchasers_fpa_edge_ttl', $ttl, $season );
}

/**
 * Send the lifetime before output. Runs after the season redirect (priority
 * 9 exits on a 301), so only a page that renders carries it.
 */
function statchasers_fpa_cache_headers(): void {
	if ( is_admin() || headers_sent() || ! statchasers_fpa_post_has_shortcode() ) {
		return;
	}
	$season = statchasers_fpa_request_season();
	$ttl    = statchasers_fpa_edge_ttl( $season, statchasers_fpa_season_not_found() );
	if ( $ttl < 1 ) {
		return;
	}
	$stored = get_option( STATCHASERS_FPA_PUBLISHED_OPTION );
	$key    = (string) ( $season > 0 ? $season : ( is_array( $stored ) && isset( $stored['current'] ) ? (int) $stored['current'] : 0 ) );
	$ver    = is_array( $stored ) && isset( $stored['seasons'][ $key ]['version'] ) ? (string) $stored['seasons'][ $key ]['version'] : 'none';
	statchasers_edge_ttl_headers( $ttl, 'X-SC-FPA-Cache', 'season=' . ( $season > 0 ? $season : 'current' ) . '; published=' . preg_replace( '/[^A-Za-z0-9]/', '', $ver ) );
}
add_action( 'template_redirect', 'statchasers_fpa_cache_headers', 20 );
