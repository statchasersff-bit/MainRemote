<?php
/**
 * WEB-040: a matchup page's cache lifetime follows its game, the same rule
 * as the schedule's. Pure policy walked with fixed timestamps, plus the
 * transient lifetime and the purge route's path filter. Run by smoke.php as
 * STATCHASERS_SMOKE_GROUP=mucache.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_matchup_page_cache_policy' ) ) {
	fwrite( STDERR, "smoke-matchup-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "\nthe matchup cache policy walks a game day\n";

$kick = 1795137300; // IND @ HOU, 2026-11-20 01:15 UTC.
$page = array( 'html' => '<div></div>', 'version' => 'v' );
$p    = static fn( array $extra, int $now ) => statchasers_matchup_page_cache_policy( $page + $extra, $now );

$early = $p( array( 'cache_state' => 'pregame', 'change_at' => $kick ), $kick - 3 * HOUR_IN_SECONDS );
is( array( $early['edge_ttl'], $early['page_cache'] ), array( 3 * HOUR_IN_SECONDS, false ), 'pregame: until kickoff, never in WP Rocket' );

$minute = $p( array( 'cache_state' => 'pregame', 'change_at' => $kick ), $kick - 60 );
is( $minute['edge_ttl'], 60, 'a preview cached a minute before kickoff expires at kickoff' );

$far = $p( array( 'cache_state' => 'pregame', 'change_at' => $kick ), $kick - 5 * DAY_IN_SECONDS );
is( $far['edge_ttl'], 6 * HOUR_IN_SECONDS, 'a kickoff days away: the six-hour cap' );

$stale = $p( array( 'cache_state' => 'pregame', 'change_at' => $kick ), $kick + 10 );
is( $stale['edge_ttl'], MINUTE_IN_SECONDS, 'a pregame copy past its kickoff: a minute' );

$live = $p( array( 'cache_state' => 'live' ), $kick + HOUR_IN_SECONDS );
is( array( $live['edge_ttl'], $live['page_cache'] ), array( MINUTE_IN_SECONDS, false ), 'live: a minute, never in WP Rocket' );

$recent = $p( array( 'cache_state' => 'recent' ), $kick + 5 * HOUR_IN_SECONDS );
is( array( $recent['edge_ttl'], $recent['page_cache'] ), array( HOUR_IN_SECONDS, false ), 'recent final: an hour, never in WP Rocket' );

$settled = $p( array( 'cache_state' => 'settled' ), $kick + 5 * DAY_IN_SECONDS );
is( array( $settled['edge_ttl'], $settled['page_cache'] ), array( null, true ), 'settled: the long default stands' );

$flip = $p( array( 'cache_state' => 'settled', 'change_at' => $kick + 3 * DAY_IN_SECONDS ), $kick );
is( array( $flip['edge_ttl'], $flip['page_cache'] ), array( 3 * DAY_IN_SECONDS, true ), 'settled, turning into a preview in three days: kept until then' );

$soon = $p( array( 'cache_state' => 'settled', 'change_at' => $kick + HOUR_IN_SECONDS ), $kick );
is( array( $soon['edge_ttl'], $soon['page_cache'] ), array( HOUR_IN_SECONDS, false ), 'settled, flipping within a day: not in WP Rocket' );

$backup = $p( array( 'cache_state' => 'backup' ), $kick );
is( array( $backup['edge_ttl'], $backup['page_cache'] ), array( MINUTE_IN_SECONDS, false ), 'outage backup: a minute' );

$legacy = $p( array(), $kick );
is( array( $legacy['state'], $legacy['edge_ttl'], $legacy['page_cache'] ), array( 'legacy', null, true ), 'an API too old to say: unchanged behavior' );

$none = statchasers_matchup_page_cache_policy( null, $kick );
is( array( $none['edge_ttl'], $none['page_cache'] ), array( MINUTE_IN_SECONDS, false ), 'nothing to show: short, never stored' );

echo "\nthe plugin's own copy\n";
is( statchasers_matchup_transient_ttl( array( 'cache_state' => 'live' ), $kick ), 30, 'live: half a minute' );
is( statchasers_matchup_transient_ttl( array( 'cache_state' => 'pregame', 'change_at' => $kick ), $kick - 40 ), 40, 'never past kickoff' );
is( statchasers_matchup_transient_ttl( array( 'cache_state' => 'settled' ), $kick ), STATCHASERS_MATCHUP_CACHE_TTL, 'otherwise five minutes' );

echo "\nthe purge route names only site pages\n";
is(
	statchasers_matchup_purge_paths( array( '/nfl/houston-texans-vs-indianapolis-colts/2026-week-11/', '/nfl/nfl-schedule/week-11/', '/nfl/teams/houston-texans/schedule/', '/wp-admin/', 'https://evil.example/', '/nfl/../etc/' ) ),
	array( '/nfl/houston-texans-vs-indianapolis-colts/2026-week-11/', '/nfl/nfl-schedule/week-11/', '/nfl/teams/houston-texans/schedule/' ),
	'matchup, schedule and team paths kept; anything else dropped'
);
is( statchasers_matchup_purge_paths( 'x' ), array(), 'not a list: nothing' );
