<?php
/**
 * The other pages that print the team depth-chart snapshot: purge exactly the
 * ones a publication changed (docs/DEPTH-SNAPSHOT-CONSUMERS-2026-11-25.md).
 *
 * statchasers-depth-charts-cache.php publishes the 32 Depth Chart tabs. Two
 * more pages render from the same snapshot and sat behind the same caches
 * (plugin transient 5 min, WP Rocket 24 h, Rocket.net edge 30 days) with
 * nothing to purge them:
 *
 * - the hub /nfl/teams/{slug}/, whose Draft tab (a hash tab of the hub) prints
 *   each draftee's slot on the chart of the club he is with now;
 * - the matchup previews' Player Battles: every unplayed game's dated page
 *   /nfl/{pair}/{season}-week-{n}/ and the pair's page /nfl/{pair}/ while it
 *   previews that game.
 *
 * The API's GET /embed/depth-charts/version carries a hash of what each of
 * those pages prints from the snapshot (`teams.<slug>.draft`, `previews`).
 * On the same five-minute WP-cron event as the tabs, after them, when the
 * snapshot's `version` differs from the one recorded here:
 *
 *   1. the hubs whose Draft hash moved and the preview paths whose hash moved
 *      are listed (a path new to the list is not a change: it was rendered
 *      from the snapshot it is listed under);
 *   2. this plugin's fresh render of each is dropped (hub fragment, matchup
 *      transient; the outage backups stay), so the refill asks the API, which
 *      already serves the new snapshot;
 *   3. WP Rocket's files for exactly those URLs are cleared;
 *   4. exactly those paths are purged at the edge;
 *   5. the record is stored; a minute later the hubs and the previews of
 *      games in the next seven days are warmed, desktop and phone, the ones
 *      whose purge landed.
 *
 * A path whose edge purge fails stays pending in the record's retry ledger
 * and is retried on later runs of this check (5, 10, 20, 40, 80 minutes
 * apart, six attempts in all; statchasers-edge-cache.php), without asking the
 * API again or cleaning WP Rocket again, and warmed once it lands. A new
 * publication purges its paths together with the pending ones, once.
 *
 * The first run after install records a baseline and purges nothing. An API
 * that cannot read its slate sends `previews: null`: the hubs still publish,
 * the matchup half waits for the next publication, and the stored preview
 * hashes are kept so that publication compares against what was cached.
 *
 * By hand:
 *   wp eval 'print_r( statchasers_depth_consumers_check() );'
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** What was last published to these pages (one row, autoload off). */
const STATCHASERS_DEPTH_CONSUMERS_OPTION = 'statchasers_depth_consumers_published';

/** The warm-up that follows a publication. */
const STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK = 'statchasers_depth_consumers_warm';

/** Previews of games kicking off within this (or in the last day) are warmed after a purge; the rest refill on demand. */
const STATCHASERS_DEPTH_CONSUMERS_WARM_AHEAD = 7 * DAY_IN_SECONDS;

// After the tabs' own check (priority 10) on the same event.
add_action( STATCHASERS_DEPTH_PUBLISH_HOOK, 'statchasers_depth_consumers_check', 20, 0 );
add_action( STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK, 'statchasers_depth_consumers_warm' );

/**
 * The version document's consumer half, or null when it cannot be read.
 *
 * @return array{version:string,hubs:array<string,array{path:string,draft:string}>,previews:array<string,array{hash:string,kickoff:int}>|null}|null
 */
function statchasers_depth_consumers_remote(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}
	$response = wp_remote_get(
		$origin . '/embed/depth-charts/version',
		array(
			'timeout' => 15,
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
	$hubs = array();
	foreach ( array_keys( statchasers_team_table() ) as $slug ) {
		$info = $doc['teams'][ $slug ] ?? null;
		// An API before this file sends no `draft`: nothing to compare.
		if ( ! is_array( $info ) || ! isset( $info['draft'], $info['hub'] ) || ! is_string( $info['draft'] ) || ! is_string( $info['hub'] ) ) {
			return null;
		}
		$path = statchasers_depth_consumers_path( $info['hub'] );
		if ( '' === $path ) {
			return null;
		}
		$hubs[ $slug ] = array(
			'path'  => $path,
			'draft' => $info['draft'],
		);
	}
	$previews = null;
	if ( isset( $doc['previews'] ) && is_array( $doc['previews'] ) ) {
		$previews = array();
		foreach ( $doc['previews'] as $path => $info ) {
			$path = statchasers_depth_consumers_path( (string) $path );
			if ( '' === $path || ! is_array( $info ) || ! isset( $info['hash'] ) || ! is_string( $info['hash'] ) ) {
				continue;
			}
			$previews[ $path ] = array(
				'hash'    => $info['hash'],
				'kickoff' => isset( $info['kickoff'] ) ? (int) $info['kickoff'] : 0,
			);
		}
	}
	return array(
		'version'  => $doc['version'],
		'hubs'     => $hubs,
		'previews' => $previews,
	);
}

/**
 * A site path the API named, kept only in the shapes these pages have:
 * /nfl/teams/{slug}/, /nfl/{a}-vs-{b}/ and /nfl/{a}-vs-{b}/{game}/.
 *
 * @param string $path Root-relative path.
 * @return string The path, or ''.
 */
function statchasers_depth_consumers_path( string $path ): string {
	if ( preg_match( '#^/nfl/teams/[a-z0-9-]+/$#', $path ) ) {
		return $path;
	}
	if ( preg_match( '#^/nfl/[a-z0-9-]+-vs-[a-z0-9-]+/(?:[a-z0-9-]+/)?$#', $path ) ) {
		return $path;
	}
	return '';
}

/**
 * Drop this plugin's fresh render of one path, so its refill asks the API.
 * The outage backups are kept.
 *
 * @param string $path A path from statchasers_depth_consumers_path().
 */
function statchasers_depth_consumers_forget( string $path ): void {
	if ( preg_match( '#^/nfl/teams/([a-z0-9-]+)/$#', $path, $m ) ) {
		list( $fresh ) = statchasers_team_fragment_keys( $m[1], '' );
		delete_transient( $fresh );
		return;
	}
	if ( preg_match( '#^/nfl/([a-z0-9-]+-vs-[a-z0-9-]+)/(?:([a-z0-9-]+)/)?$#', $path, $m ) ) {
		delete_transient( 'sc_matchup_ssr_' . md5( statchasers_news_origin() . '|matchup|' . $m[1] . '|' . ( $m[2] ?? '' ) ) );
	}
}

/**
 * One check. See the file header for the order and why.
 *
 * @param bool $force Purge every listed page even when nothing moved.
 * @return array<string,mixed> What happened, also stored in the option.
 */
function statchasers_depth_consumers_check( bool $force = false ): array {
	$now    = time();
	$stored = get_option( STATCHASERS_DEPTH_CONSUMERS_OPTION );
	$stored = is_array( $stored ) ? $stored : array();
	$filter = 'statchasers_depth_charts_pre_purge_edge';

	// What an earlier publication's purge left pending (a 1.10.71-era record's
	// failed purge is adopted: its pages, due now).
	$ledger = statchasers_edge_ledger(
		$stored,
		isset( $stored['changed'] ) && is_array( $stored['changed'] ) ? $stored['changed'] : array(),
		isset( $stored['to_warm'] ) && is_array( $stored['to_warm'] ) ? $stored['to_warm'] : array(),
		$now
	);
	$quiet = static function ( array $published, array $check ) use ( $ledger, $filter, $now ): array {
		return statchasers_depth_consumers_record( $published, $check + statchasers_edge_retry_fields( $ledger, $filter, STATCHASERS_DEPTH_CONSUMERS_OPTION, 'StatChasers-DepthWarm/1', $now ) );
	};

	$remote = statchasers_depth_consumers_remote();
	if ( null === $remote ) {
		return $quiet( $stored, array( 'checked_at' => $now, 'result' => 'version unavailable; nothing changed' ) );
	}
	if ( ! $force && isset( $stored['version'] ) && $stored['version'] === $remote['version'] ) {
		return $quiet( $stored, array( 'checked_at' => $now, 'result' => 'unchanged' ) );
	}

	$known_hubs     = isset( $stored['hubs'] ) && is_array( $stored['hubs'] ) ? $stored['hubs'] : array();
	$known_previews = isset( $stored['previews'] ) && is_array( $stored['previews'] ) ? $stored['previews'] : array();
	$baseline       = ! isset( $stored['version'] ) && ! $force;

	$hubs = array();
	foreach ( $remote['hubs'] as $slug => $info ) {
		if ( $force || ( isset( $known_hubs[ $slug ] ) && $known_hubs[ $slug ] !== $info['draft'] ) ) {
			$hubs[] = $info['path'];
		}
	}
	$previews = array();
	foreach ( (array) $remote['previews'] as $path => $info ) {
		if ( $force || ( isset( $known_previews[ $path ] ) && $known_previews[ $path ] !== $info['hash'] ) ) {
			$previews[] = $path;
		}
	}

	$base = array(
		'version'      => $remote['version'],
		'previous'     => isset( $stored['version'] ) ? (string) $stored['version'] : '',
		'published_at' => $now,
		'hubs'         => array_map( static fn( array $info ): string => $info['draft'], $remote['hubs'] ),
		// Without a slate this run says nothing about the previews: keep what
		// the caches were filled under.
		'previews'     => null === $remote['previews']
			? $known_previews
			: array_map( static fn( array $info ): string => $info['hash'], $remote['previews'] ),
		'matchups'     => null === $remote['previews'] ? 'slate unavailable' : 'checked',
	);

	if ( $baseline ) {
		return $quiet(
			$base + array( 'changed' => array(), 'wp_rocket' => false, 'edge' => 'not needed' ),
			array( 'checked_at' => $now, 'result' => 'baseline recorded' )
		);
	}

	/**
	 * Filters the paths a depth-chart publication purges beyond the Depth Chart tabs.
	 *
	 * @param string[] $paths   Hub and matchup paths whose snapshot content moved.
	 * @param string   $version The snapshot fingerprint.
	 */
	$paths = array_values( array_unique( array_filter( array_map( 'statchasers_depth_consumers_path', (array) apply_filters( 'statchasers_depth_consumers_purge_paths', array_merge( $hubs, $previews ), $remote['version'] ) ) ) ) );

	if ( ! $paths ) {
		return $quiet(
			$base + array( 'changed' => array(), 'to_warm' => array(), 'wp_rocket' => false, 'edge' => 'not needed' ),
			array( 'checked_at' => $now, 'result' => 'no page changed' )
		);
	}

	// 2. This plugin's renders.
	foreach ( $paths as $path ) {
		statchasers_depth_consumers_forget( $path );
	}

	// 3. WP Rocket, exactly these pages (desktop and mobile).
	$urls   = array_map( static fn( string $path ): string => home_url( $path ), $paths );
	$rocket = false;
	if ( function_exists( 'rocket_clean_files' ) ) {
		rocket_clean_files( $urls );
		$rocket = true;
	}

	// 5. Which of them to warm: the hubs and the near previews.
	$warm = array();
	foreach ( $paths as $path ) {
		$kickoff = isset( $remote['previews'][ $path ] ) ? (int) $remote['previews'][ $path ]['kickoff'] : 0;
		$ahead   = $kickoff - $now;
		if ( ! isset( $remote['previews'][ $path ] ) || ( $kickoff > 0 && $ahead <= STATCHASERS_DEPTH_CONSUMERS_WARM_AHEAD && $ahead > -DAY_IN_SECONDS ) ) {
			$warm[] = $path;
		}
	}

	// 4. The edge, exactly these paths, with whatever an earlier publication
	//    left pending or gave up on, once.
	$pub = statchasers_edge_publish( $paths, $warm, $ledger, $filter, $now );

	// 5. Record; warm in a minute the ones whose purge landed. The rest are
	//    retried on later runs and warmed when they land.
	if ( $pub['landed'] && ! wp_next_scheduled( STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK ) ) {
		wp_schedule_single_event( $now + MINUTE_IN_SECONDS, STATCHASERS_DEPTH_CONSUMERS_WARM_HOOK );
	}

	return statchasers_depth_consumers_record(
		$base + array(
			'changed'   => $paths,
			'to_warm'   => $pub['landed'],
			'wp_rocket' => $rocket,
			'edge'      => $pub['purge']['text'],
		) + statchasers_edge_ledger_fields( $pub['ledger'] ),
		array(
			'checked_at' => $now,
			'result'     => $force ? 'republished (forced)' : 'published',
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
function statchasers_depth_consumers_record( array $published, array $check ): array {
	$record = array_merge( $published, $check );
	update_option( STATCHASERS_DEPTH_CONSUMERS_OPTION, $record, false );
	return $record;
}

/**
 * The warm-up: the hubs and the near previews the last publication purged.
 *
 * @return array<string,string>
 */
function statchasers_depth_consumers_warm(): array {
	$stored = get_option( STATCHASERS_DEPTH_CONSUMERS_OPTION );
	$paths  = is_array( $stored ) && isset( $stored['to_warm'] ) && is_array( $stored['to_warm'] ) ? $stored['to_warm'] : array();
	$out    = statchasers_edge_warm( array_map( static fn( string $path ): string => home_url( $path ), $paths ), 'StatChasers-DepthWarm/1' );
	if ( is_array( $stored ) ) {
		$stored['warmed_at'] = time();
		$stored['warm']      = $out;
		update_option( STATCHASERS_DEPTH_CONSUMERS_OPTION, $stored, false );
	}
	return $out;
}
