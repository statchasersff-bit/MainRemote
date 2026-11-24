<?php
/**
 * WEB-040: the schedule page's cache lifetime follows the games on it.
 *
 * The policy is pure (statchasers_schedule_page_cache_policy takes $now), so
 * a game day is walked here with fixed timestamps. DONOTCACHEPAGE is a
 * constant, so the page-cache verdict needs a process of its own: smoke.php
 * runs this as STATCHASERS_SMOKE_GROUP=schedlive (the API says live) and
 * =schedfinal (settled). Running it directly does nothing.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_page_cache_policy' ) ) {
	fwrite( STDERR, "smoke-schedule-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$live = 'schedlive' === getenv( 'STATCHASERS_SMOKE_GROUP' );

if ( $live ) {
	echo "\nthe cache policy walks a game day\n";

	$kick  = 1795137300; // IND @ HOU, 2026-11-20 01:15 UTC.
	$board = array( 'html' => '<div></div>', 'version' => 'v' );
	$p     = static fn( array $extra, int $now ) => statchasers_schedule_page_cache_policy( $board + $extra, $now );

	$three_hours = $p( array( 'state' => 'pregame', 'next_kickoff' => $kick ), $kick - 3 * HOUR_IN_SECONDS );
	is( $three_hours['edge_ttl'], 3 * HOUR_IN_SECONDS, 'pregame: the edge keeps it until kickoff and not a second longer' );
	is( $three_hours['page_cache'], false, 'pregame: WP Rocket (a day\'s lifespan) never stores it' );

	$two_days = $p( array( 'state' => 'pregame', 'next_kickoff' => $kick ), $kick - 2 * DAY_IN_SECONDS );
	is( $two_days['edge_ttl'], 6 * HOUR_IN_SECONDS, 'a kickoff days away is capped at six hours' );

	$tbd = $p( array( 'state' => 'pregame', 'next_kickoff' => 0 ), $kick );
	is( $tbd['edge_ttl'], 6 * HOUR_IN_SECONDS, 'games ahead with no confirmed kickoff: the cap' );

	$passed = $p( array( 'state' => 'pregame', 'next_kickoff' => $kick ), $kick + 30 );
	is( $passed['edge_ttl'], MINUTE_IN_SECONDS, 'a pregame copy whose kickoff has passed: a minute' );

	$playing = $p( array( 'state' => 'live' ), $kick + HOUR_IN_SECONDS );
	is( $playing['edge_ttl'], MINUTE_IN_SECONDS, 'live: about a minute' );
	is( $playing['page_cache'], false, 'live: never in WP Rocket' );

	$backup = $p( array( 'state' => 'backup' ), $kick );
	is( array( $backup['edge_ttl'], $backup['page_cache'] ), array( MINUTE_IN_SECONDS, false ), 'the outage backup: a minute, never in WP Rocket' );

	$old_api = $p( array(), $kick );
	is( $old_api['state'], 'live', 'a payload with no state (an older API) is treated as live' );

	$nothing = statchasers_schedule_page_cache_policy( null, $kick );
	is( array( $nothing['edge_ttl'], $nothing['page_cache'] ), array( MINUTE_IN_SECONDS, false ), 'nothing to show: short, never stored' );

	$recent = $p( array( 'state' => 'recent' ), $kick + DAY_IN_SECONDS );
	is( array( $recent['edge_ttl'], $recent['page_cache'] ), array( HOUR_IN_SECONDS, false ), 'recent (first 48 h after a final): an hour, never in WP Rocket' );

	$done = $p( array( 'state' => 'settled' ), $kick + DAY_IN_SECONDS );
	is( array( $done['edge_ttl'], $done['page_cache'] ), array( null, true ), 'settled: the long default stands, WP Rocket may keep it' );
}

$post               = new WP_Post();
$post->ID           = 3238;
$post->post_title   = 'NFL Schedule';
$post->post_content = '[statchasers_schedule]';

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $post,
);
$GLOBALS['query']['sc_sched_week'] = '11';

$GLOBALS['http_code']    = 200;
$GLOBALS['http_body']    = '<div class="scs" data-scs-root data-scs-season="2026"><article class="scs-game" data-status="' . ( $live ? 'live' : 'final' ) . '"></article></div>';
$GLOBALS['http_headers'] = array(
	'etag'                => 'W/"2026-13-x"',
	'cache-control'       => $live ? 'public, max-age=30' : 'public, max-age=300',
	'x-sc-schedule-state' => $live ? 'live' : 'settled',
);

echo $live ? "\na live week board stays out of WP Rocket\n" : "\na settled week board may be cached\n";

$data = statchasers_schedule_fetch( statchasers_schedule_args( statchasers_schedule_mounted_atts() ) );
is( $data['state'] ?? null, $live ? 'live' : 'settled', 'the fetch carries the API\'s state' );

statchasers_schedule_cache_headers();
is( defined( 'DONOTCACHEPAGE' ), $live, $live ? 'template_redirect marks the page uncacheable' : 'a settled board leaves the page cacheable' );

$html = statchasers_schedule_shortcode( array() );
is( str_contains( $html, 'data-status="' . ( $live ? 'live' : 'final' ) . '"' ), true, 'the board still prints' );
is( defined( 'DONOTCACHEPAGE' ), $live, 'and the shortcode agrees' );
