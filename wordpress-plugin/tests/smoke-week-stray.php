<?php
/**
 * `?sc_sched_week=` on a page that is not the schedule, in a process of its own.
 *
 * Split out for the reason smoke-week.php gives: the week is memoized, so one
 * process answers for one request. The query var is public, so any URL on the
 * site can carry it; only the page that mounts the schedule may act on it.
 *
 * smoke.php includes this with STATCHASERS_SMOKE_GROUP=weekstray set; running
 * it directly does nothing, because the plugin is not loaded.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_heading' ) ) {
	fwrite( STDERR, "smoke-week-stray.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$article               = new WP_Post();
$article->ID           = 42;
$article->post_title   = 'Waiver Wire Pickups';
$article->post_content = '<p>An article, no schedule here.</p>';

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $article,
);
$GLOBALS['query']['sc_sched_week'] = '7';

echo "\nthe week var on any other page means nothing\n";

is( statchasers_schedule_request_week(), 0, 'no week off an article\'s query string' );
is( statchasers_schedule_week_title(), '', 'so the article keeps its own title' );
is( statchasers_schedule_week_canonical(), '', 'and its own canonical' );

$stray_trail = array( array( 'Home', 'https://example.com/', 'hide_in_schema' => false ) );
is( statchasers_schedule_breadcrumbs( $stray_trail ), $stray_trail, 'and its own breadcrumb trail' );
