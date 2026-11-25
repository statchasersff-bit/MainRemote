<?php
/**
 * The pieces every publication check shares (audit WEB-003): the five-minute
 * WP-cron schedule, the targeted Rocket.net edge purge and its retry, the
 * desktop + phone warm-up and the six-hour fallback edge lifetime.
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

/* ------------------------------------------------------------- the purge */

/**
 * Purge paths at the Rocket.net edge through its mu-plugin, when it is there,
 * and say per path what happened.
 *
 * `state` is what the callers act on:
 *
 * - 'ok': every call answered `success: true` ("rocket.net ok");
 * - 'failed': at least one 30-path call did not ("refused" = `success:
 *   false`; "sent" = no answer that can be read: a timeout, a curl error, or
 *   the mu-plugin's own guard file after a 401/403, which returns []; "error"
 *   = it threw). `failed` names the paths of those calls, `purged` the rest;
 * - 'skipped': nothing to purge with (the mu-plugin is absent) or a filter
 *   answered with a string instead. Not a failure: there is nothing to retry.
 *
 * `text` is the string 1.10.71 recorded ("rocket.net ok", "rocket.net
 * ok,refused", "no edge purge available", or the filter's string).
 *
 * @param string[] $paths  Paths with their query strings, as the mu-plugin's own purges send them.
 * @param string   $filter A short-circuit filter. A string from it is reported as 'skipped'
 *                         (another CDN). An array answers for the edge (a test, or a CDN that
 *                         reports per path): `failed` (paths), optional `state` and `text`.
 * @return array{state:string,text:string,purged:string[],failed:string[]}
 */
function statchasers_edge_purge( array $paths, string $filter ): array {
	$paths = array_values( array_unique( array_filter( array_map( 'strval', $paths ), 'strlen' ) ) );
	if ( ! $paths ) {
		return array( 'state' => 'skipped', 'text' => 'not needed', 'purged' => array(), 'failed' => array() );
	}
	$short = apply_filters( $filter, null, $paths );
	if ( is_string( $short ) ) {
		return array( 'state' => 'skipped', 'text' => $short, 'purged' => array(), 'failed' => array() );
	}
	if ( is_array( $short ) ) {
		$state  = isset( $short['state'] ) && in_array( $short['state'], array( 'ok', 'failed', 'skipped' ), true ) ? $short['state'] : '';
		$failed = array_values( array_intersect( $paths, array_map( 'strval', (array) ( $short['failed'] ?? array() ) ) ) );
		if ( 'failed' === $state && ! $failed ) {
			$failed = $paths;
		}
		if ( 'skipped' === $state ) {
			$failed = array();
		}
		if ( 'skipped' !== $state ) {
			$state = $failed ? 'failed' : 'ok';
		}
		return array(
			'state'  => $state,
			'text'   => isset( $short['text'] ) ? (string) $short['text'] : 'filtered ' . $state,
			'purged' => 'skipped' === $state ? array() : array_values( array_diff( $paths, $failed ) ),
			'failed' => $failed,
		);
	}
	if ( ! class_exists( 'CDN_Clear_Cache_Api' ) || ! method_exists( 'CDN_Clear_Cache_Api', 'cache_api_call' ) ) {
		return array( 'state' => 'skipped', 'text' => 'no edge purge available', 'purged' => array(), 'failed' => array() );
	}
	$outcome = array();
	$purged  = array();
	$failed  = array();
	foreach ( array_chunk( $paths, STATCHASERS_EDGE_PURGE_CHUNK ) as $chunk ) {
		try {
			$result = CDN_Clear_Cache_Api::cache_api_call( $chunk, 'purge' );
			$word   = is_object( $result ) && isset( $result->success ) ? ( $result->success ? 'ok' : 'refused' ) : 'sent';
		} catch ( \Throwable $e ) {
			$word = 'error';
		}
		$outcome[] = $word;
		if ( 'ok' === $word ) {
			$purged = array_merge( $purged, $chunk );
		} else {
			$failed = array_merge( $failed, $chunk );
		}
	}
	return array(
		'state'  => $failed ? 'failed' : 'ok',
		'text'   => 'rocket.net ' . implode( ',', array_unique( $outcome ) ),
		'purged' => $purged,
		'failed' => $failed,
	);
}

/**
 * The purge as 1.10.71 called it: the record string only.
 *
 * @param string[] $paths  Paths.
 * @param string   $filter The short-circuit filter (see statchasers_edge_purge()).
 * @return string What was done, for the record.
 */
function statchasers_edge_purge_paths( array $paths, string $filter ): string {
	return statchasers_edge_purge( $paths, $filter )['text'];
}

/* ------------------------------------------------------------- the retry */

/*
 * Why a retry: Rocket.net's edge keeps every page 30 days and ignores the
 * origin's headers (the six-hour lifetime below is a request it does not
 * honor, and the edge rules cannot be changed from our side), so a targeted
 * purge is the only thing that refreshes these pages. Through 1.10.71 a
 * publication was recorded even when its purge failed, the next check said
 * "unchanged", and the page stayed stale until the next data change, up to
 * 30 days.
 *
 * Now each publication record carries a retry ledger (`edge_retry`): the paths
 * whose purge failed, retried on the publication check's own five-minute run
 * after a doubling wait (5, 10, 20, 40, 80 minutes), at most
 * STATCHASERS_EDGE_RETRY_MAX_ATTEMPTS attempts in all (the publication's own
 * purge is the first), then given up (`abandoned`) and recorded. A new
 * publication purges its own paths together with whatever is pending or was
 * given up on, in one purge (the union), and its count starts again at one.
 * Nothing is fetched from the API again, and WP Rocket is not cleaned again:
 * its files were cleared before the first purge and can only refill from the
 * new render. A path is warmed only once its purge has landed (or was
 * skipped); a skipped purge is never retried.
 */

/** Purge attempts per publication: its own purge and five retries. */
const STATCHASERS_EDGE_RETRY_MAX_ATTEMPTS = 6;

/** The wait before the first retry; it doubles after each failed one. */
const STATCHASERS_EDGE_RETRY_BASE = 5 * MINUTE_IN_SECONDS;

/** WP-cron runs late or early by seconds: a retry due within this is run now, not a run later. */
const STATCHASERS_EDGE_RETRY_SLACK = MINUTE_IN_SECONDS;

/** The warm-up after a retry lands, and its batch (URLs per event, each desktop + phone). */
const STATCHASERS_EDGE_RETRY_WARM_HOOK  = 'statchasers_edge_retry_warm';
const STATCHASERS_EDGE_RETRY_WARM_BATCH = 4;

add_action( STATCHASERS_EDGE_RETRY_WARM_HOOK, 'statchasers_edge_retry_warm', 10, 3 );

/**
 * The publication records a retry warm-up may write to.
 *
 * @return string[]
 */
function statchasers_edge_retry_options(): array {
	return array(
		'statchasers_player_stats_published',
		'statchasers_depth_charts_hub_published',
		'statchasers_depth_charts_team_published',
		'statchasers_depth_consumers_published',
	);
}

/**
 * An empty ledger.
 *
 * @return array<string,mixed>
 */
function statchasers_edge_ledger_empty(): array {
	return array(
		'state'      => '',
		'pending'    => array(),
		'warm'       => array(),
		'attempts'   => 0,
		'first_at'   => 0,
		'last_at'    => 0,
		'next_at'    => 0,
		'last'       => '',
		'abandoned'  => array(),
		'gave_up_at' => 0,
	);
}

/**
 * The retry ledger of a publication record.
 *
 * A record 1.10.71 wrote has no ledger. When its `edge` string says a purge
 * did not land ("refused", "sent", "error"), the caller's paths are adopted as
 * pending and due now, so the first run after the upgrade retries them rather
 * than leaving them for 30 days.
 *
 * @param array<string,mixed> $record      The stored record.
 * @param string[]            $legacy      The paths a 1.10.71 record's purge covered.
 * @param string[]            $legacy_warm Which of them to warm once they land.
 * @param int                 $now         Now.
 * @return array<string,mixed>
 */
function statchasers_edge_ledger( array $record, array $legacy = array(), array $legacy_warm = array(), int $now = 0 ): array {
	$empty = statchasers_edge_ledger_empty();
	if ( isset( $record['edge_retry'] ) && is_array( $record['edge_retry'] ) ) {
		$stored = $record['edge_retry'];
		$out    = $empty;
		foreach ( array( 'pending', 'warm', 'abandoned' ) as $k ) {
			$out[ $k ] = isset( $stored[ $k ] ) && is_array( $stored[ $k ] ) ? array_values( array_unique( array_map( 'strval', $stored[ $k ] ) ) ) : array();
		}
		foreach ( array( 'attempts', 'first_at', 'last_at', 'next_at', 'gave_up_at' ) as $k ) {
			$out[ $k ] = isset( $stored[ $k ] ) ? (int) $stored[ $k ] : 0;
		}
		$out['state'] = isset( $stored['state'] ) ? (string) $stored['state'] : '';
		$out['last']  = isset( $stored['last'] ) ? (string) $stored['last'] : '';
		return $out;
	}
	$edge   = isset( $record['edge'] ) && is_string( $record['edge'] ) ? $record['edge'] : '';
	$legacy = array_values( array_unique( array_filter( array_map( 'strval', $legacy ), 'strlen' ) ) );
	if ( '' === $edge || ! $legacy || 1 !== preg_match( '/^rocket\.net .*\b(refused|sent|error)\b/', $edge ) ) {
		return $empty;
	}
	$first = isset( $record['published_at'] ) ? (int) $record['published_at'] : $now;
	return array(
		'state'    => 'failed',
		'pending'  => $legacy,
		'warm'     => array_values( array_intersect( array_map( 'strval', $legacy_warm ), $legacy ) ),
		'attempts' => 1,
		'first_at' => $first,
		'last_at'  => $first,
		'next_at'  => $now,
		'last'     => $edge,
	) + $empty;
}

/**
 * The ledger after a purge attempt.
 *
 * @param array<string,mixed> $purge     statchasers_edge_purge()'s answer.
 * @param string[]            $warm      Paths to warm once they land (the caller's warm set).
 * @param string[]            $abandoned Paths given up on before, kept.
 * @param int                 $attempts  Attempts made, this one included.
 * @param int                 $first_at  When the first attempt of this count was made.
 * @param int                 $now       Now.
 * @return array<string,mixed>
 */
function statchasers_edge_ledger_after( array $purge, array $warm, array $abandoned, int $attempts, int $first_at, int $now ): array {
	$pending    = 'skipped' === $purge['state'] ? array() : array_values( array_unique( $purge['failed'] ) );
	$gave_up_at = 0;
	if ( $pending && $attempts >= STATCHASERS_EDGE_RETRY_MAX_ATTEMPTS ) {
		$abandoned  = array_values( array_unique( array_merge( $abandoned, $pending ) ) );
		$pending    = array();
		$gave_up_at = $now;
	}
	return array(
		'state'      => (string) $purge['state'],
		'pending'    => $pending,
		'warm'       => array_values( array_intersect( array_unique( $warm ), array_merge( $pending, $abandoned ) ) ),
		'attempts'   => $attempts,
		'first_at'   => $first_at,
		'last_at'    => $now,
		'next_at'    => $pending ? $now + STATCHASERS_EDGE_RETRY_BASE * ( 2 ** max( 0, $attempts - 1 ) ) : 0,
		'last'       => (string) $purge['text'],
		'abandoned'  => array_values( $abandoned ),
		'gave_up_at' => $gave_up_at,
	);
}

/**
 * The fields a record carries about its ledger: the ledger itself and the
 * counts an operator reads first.
 *
 * - `edge_state`: 'ok' (every path landed), 'pending' (a retry is coming),
 *   'failed' (given up on; stale until the next publication purges it),
 *   'skipped' (no edge purge to make);
 * - `edge_pending`: paths waiting for a retry;
 * - `edge_failed`: paths given up on;
 * - `edge_attempts`: purge attempts of the current count.
 *
 * @param array<string,mixed> $ledger The ledger.
 * @return array<string,mixed>
 */
function statchasers_edge_ledger_fields( array $ledger ): array {
	if ( $ledger['pending'] ) {
		$state = 'pending';
	} elseif ( $ledger['abandoned'] ) {
		$state = 'failed';
	} elseif ( 'skipped' === $ledger['state'] ) {
		$state = 'skipped';
	} else {
		$state = 'ok';
	}
	return array(
		'edge_state'    => $state,
		'edge_pending'  => count( $ledger['pending'] ),
		'edge_failed'   => count( $ledger['abandoned'] ),
		'edge_attempts' => (int) $ledger['attempts'],
		'edge_retry'    => $ledger,
	);
}

/**
 * A publication's purge: its own paths together with whatever an earlier
 * publication left pending or gave up on, in one purge, and a new ledger whose
 * count starts at one.
 *
 * @param string[]            $paths  This publication's paths.
 * @param string[]            $warm   Which of them the caller warms.
 * @param array<string,mixed> $ledger The ledger so far.
 * @param string              $filter The short-circuit filter.
 * @param int                 $now    Now.
 * @return array{purge:array<string,mixed>,ledger:array<string,mixed>,paths:string[],carried:string[],landed:string[]}
 *         `landed`: the warm paths (this publication's and the carried ones) whose purge landed.
 */
function statchasers_edge_publish( array $paths, array $warm, array $ledger, string $filter, int $now ): array {
	$carried = array_values( array_diff( array_unique( array_merge( $ledger['pending'], $ledger['abandoned'] ) ), $paths ) );
	$all     = array_values( array_unique( array_merge( $paths, $carried ) ) );
	$warm    = array_values( array_unique( array_merge( $warm, array_intersect( $ledger['warm'], $carried ) ) ) );
	$purge   = statchasers_edge_purge( $all, $filter );
	return array(
		'purge'   => $purge,
		'ledger'  => statchasers_edge_ledger_after( $purge, $warm, array(), 1, $now, $now ),
		'paths'   => $all,
		'carried' => $carried,
		'landed'  => array_values( array_diff( $warm, $purge['failed'] ) ),
	);
}

/**
 * The retry on a run that publishes nothing: when paths are pending and their
 * wait is over, purge exactly them, and warm the ones that landed from a
 * minute later (one STATCHASERS_EDGE_RETRY_WARM_HOOK event per batch).
 *
 * @param array<string,mixed> $ledger The ledger.
 * @param string              $filter The short-circuit filter.
 * @param string              $option The record the warm-up reports to.
 * @param string              $tag    The warm-up's user-agent token.
 * @param int                 $now    Now.
 * @return array{ran:bool,ledger:array<string,mixed>,summary:string,landed:string[],warm_events:int}
 */
function statchasers_edge_retry( array $ledger, string $filter, string $option, string $tag, int $now ): array {
	if ( ! $ledger['pending'] || $now < $ledger['next_at'] - STATCHASERS_EDGE_RETRY_SLACK ) {
		return array(
			'ran'         => false,
			'ledger'      => $ledger,
			'summary'     => '',
			'landed'      => array(),
			'warm_events' => 0,
		);
	}
	$attempt = $ledger['attempts'] + 1;
	$purge   = statchasers_edge_purge( $ledger['pending'], $filter );
	$next    = statchasers_edge_ledger_after( $purge, $ledger['warm'], $ledger['abandoned'], $attempt, $ledger['first_at'] ? $ledger['first_at'] : $now, $now );
	$landed  = array_values( array_diff( $ledger['pending'], $purge['failed'] ) );
	$warm    = array_values( array_intersect( $ledger['warm'], $landed ) );
	$events  = statchasers_edge_schedule_retry_warm( $option, $tag, array_map( 'home_url', $warm ), $now );
	if ( 'skipped' === $purge['state'] ) {
		$summary = "attempt {$attempt}: skipped ({$purge['text']}); not retried";
	} elseif ( $next['gave_up_at'] === $now ) {
		$summary = "attempt {$attempt} of " . STATCHASERS_EDGE_RETRY_MAX_ATTEMPTS . ": {$purge['text']}; gave up on " . count( $purge['failed'] );
	} else {
		$summary = "attempt {$attempt} of " . STATCHASERS_EDGE_RETRY_MAX_ATTEMPTS . ": {$purge['text']}";
	}
	return array(
		'ran'         => true,
		'ledger'      => $next,
		'summary'     => $summary,
		'landed'      => $landed,
		'warm_events' => $events,
	);
}

/**
 * The record fields of a run that publishes nothing: run the retry when it is
 * due, and carry the ledger either way.
 *
 * @param array<string,mixed> $ledger The ledger (statchasers_edge_ledger()).
 * @param string              $filter The short-circuit filter.
 * @param string              $option The record.
 * @param string              $tag    The warm-up's user-agent token.
 * @param int                 $now    Now.
 * @return array<string,mixed> Empty when there is no ledger to carry (a 1.10.71 record whose purge landed).
 */
function statchasers_edge_retry_fields( array $ledger, string $filter, string $option, string $tag, int $now ): array {
	if ( '' === $ledger['state'] && ! $ledger['pending'] && ! $ledger['abandoned'] ) {
		return array();
	}
	$retry  = statchasers_edge_retry( $ledger, $filter, $option, $tag, $now );
	$fields = statchasers_edge_ledger_fields( $retry['ledger'] );
	if ( $retry['ran'] ) {
		$fields['retry']      = $retry['summary'];
		$fields['retried_at'] = $now;
	}
	return $fields;
}

/**
 * Schedule the warm-up of paths whose retried purge landed: one event per
 * STATCHASERS_EDGE_RETRY_WARM_BATCH URLs, a minute apart from a minute on.
 *
 * @param string   $option The record to report to.
 * @param string   $tag    The user-agent token.
 * @param string[] $urls   Absolute URLs.
 * @param int      $now    Now.
 * @return int Events scheduled.
 */
function statchasers_edge_schedule_retry_warm( string $option, string $tag, array $urls, int $now ): int {
	$events = 0;
	foreach ( array_chunk( array_values( array_unique( $urls ) ), STATCHASERS_EDGE_RETRY_WARM_BATCH ) as $i => $batch ) {
		$args = array( $option, $tag, $batch );
		if ( ! wp_next_scheduled( STATCHASERS_EDGE_RETRY_WARM_HOOK, $args ) ) {
			wp_schedule_single_event( $now + ( 1 + $i ) * MINUTE_IN_SECONDS, STATCHASERS_EDGE_RETRY_WARM_HOOK, $args );
			++$events;
		}
	}
	return $events;
}

/**
 * The warm-up after a retried purge landed (WP-cron).
 *
 * @param string   $option One of statchasers_edge_retry_options().
 * @param string   $tag    The user-agent token.
 * @param string[] $urls   Absolute URLs.
 * @return array<string,string>
 */
function statchasers_edge_retry_warm( $option = '', $tag = '', $urls = array() ): array {
	if ( ! in_array( $option, statchasers_edge_retry_options(), true ) || ! is_array( $urls ) || ! $urls ) {
		return array();
	}
	$out    = statchasers_edge_warm( array_map( 'strval', $urls ), '' !== (string) $tag ? (string) $tag : 'StatChasers-EdgeWarm/1' );
	$stored = get_option( $option );
	if ( is_array( $stored ) ) {
		$stored['retry_warmed_at'] = time();
		$stored['retry_warm']      = $out;
		update_option( $option, $stored, false );
	}
	return $out;
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
 * plus an X- header that says from outside what the plugin decided. The
 * platform replaces all of it with its 30 days and its edge rules cannot be
 * changed from our side, so this is a statement of intent only; the purges
 * (and their retry above) are what keep the pages fresh. WP Rocket keeps
 * storing the page: the publication checks clear its files.
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
