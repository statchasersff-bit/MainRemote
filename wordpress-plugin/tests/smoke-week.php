<?php
/**
 * What a week URL is, in a process of its own.
 *
 * Split out for the reason smoke-containers.php gives: the week a request names
 * is memoised — deliberately, because a Divi page asks for it many times — so
 * one process can answer "this is /week-7/" or "this is the bare page" but not
 * both. The main group is the bare page, because that is the common case and
 * everything else there depends on it. This is the week.
 *
 * smoke.php includes this with STATCHASERS_SMOKE_GROUP=week set; running it
 * directly does nothing, because the plugin is not loaded.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_heading' ) ) {
	fwrite( STDERR, "smoke-week.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

// NOT `$page`: this file runs at global scope, where `$page` IS
// `$GLOBALS['page']` — the array the harness uses for the request state, which
// the next statement would then assign over the top of.
$sched_page               = new WP_Post();
$sched_page->ID           = 7;
$sched_page->post_title   = '2026 NFL Schedule';
$sched_page->post_content = '[statchasers_schedule]';

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $sched_page,
);
// What the rewrite rule put there before the shortcode ran.
$GLOBALS['query']['sc_sched_week'] = '7';

echo "\na week URL is a page of its own\n";

is( statchasers_schedule_request_week(), 7, 'the week comes off the address' );
is(
	statchasers_schedule_week_title(),
	'2026 NFL Schedule: Week 7',
	'the title is the page\'s own name plus the week'
);
is(
	statchasers_schedule_heading(),
	'2026 NFL Schedule: Week 7',
	'and the heading is the same phrase, so the tab and the H1 agree'
);
is(
	str_starts_with( statchasers_schedule_lead(), 'Every Week 7 game' ),
	true,
	'the standfirst is about week 7'
);

/*
 * The recursion this file exists to catch.
 *
 * `statchasers_schedule_week_title()` needs the page's name, and this plugin
 * now filters `the_title` to append the week to it. Reading the filtered title
 * while computing what the filter should return appends twice — and the second
 * append is invisible on a page nobody reloads, because it only shows once the
 * filter has run over its own output. Asserted by running the filter over the
 * value it just produced.
 */
echo "\nthe title filter appends the week once\n";

$filtered = apply_filters( 'the_title', $sched_page->post_title, $sched_page->ID );
is( $filtered, '2026 NFL Schedule: Week 7', 'the theme\'s title carries the week' );
is(
	apply_filters( 'the_title', $filtered, $sched_page->ID ),
	'2026 NFL Schedule: Week 7',
	'and running it again does not append a second one'
);

// Another post's title is not this page's, even on a week URL: `the_title` is
// called for menu items and widgets, and renaming those renames the page
// everywhere it is mentioned.
is(
	apply_filters( 'the_title', 'Some Other Page', 4242 ),
	'Some Other Page',
	'a title that is not this page\'s is left alone'
);

/*
 * The address outranks the attributes. A page reached at /week-7/ renders the
 * weekly board on week 7 whatever the shortcode was written with, which is the
 * pair of overrides that makes one page two addresses.
 */
echo "\nthe address outranks the shortcode\n";

$args = statchasers_schedule_args( array( 'view' => 'matrix' ) );
is( $args['view'], 'week', 'a week URL forces the weekly board' );
is( $args['week'], 7, 'at the week the address names' );
