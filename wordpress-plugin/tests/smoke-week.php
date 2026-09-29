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

/*
 * "Let the tool supply the heading" on the schedule.
 *
 * The hubs and profiles answer that mode with their own promoted section
 * heading. The schedule's would be the source repo's Space Grotesk title,
 * which is not the site's hero and read as a second design on the page, so it
 * answers with the site's own hero markup instead and never asks the API for
 * `?h1=1`.
 */
echo "\nthe schedule answers tool mode with the site's hero\n";

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
$hero = statchasers_schedule_shortcode_heading( 2026 );
is( str_contains( $hero, 'class="sc-lo sc-lo-hero' ), true, 'in the site hero markup' );
is( str_contains( $hero, '>2026 NFL Schedule: Week 7</h1>' ), true, 'headed with the week' );
is(
	str_contains( $hero, 'Every Week 7 game of the 2026 NFL regular season: matchups, dates, kickoff times in ET' ),
	true,
	'and the standfirst says the season, word for word with the API'
);
is(
	str_contains( (string) file_get_contents( dirname( __DIR__ ) . '/statchasers-news/statchasers-schedule.php' ), "\$query['h1']" ),
	false,
	'the fragment is never asked for its own heading'
);

// And the rule that holds that hero flush with the board is printed with it.
// It was gated on the modes where the plugin normally prints a heading, so in
// this one the site's centred hero shell indented it on desktop only.
ob_start();
// Every head hook runs; the ones this stub harness cannot satisfy are skipped,
// since only the heading rule's output is being asked about.
foreach ( $GLOBALS['hooks']['wp_head'] ?? array() as $fn ) {
	try {
		$fn();
	} catch ( \Throwable $e ) {
		continue;
	}
}
$head = (string) ob_get_clean();
is(
	str_contains( $head, '.sc-lo-hero--generated .sc-lo-hero__inner{max-width:none!important' ),
	true,
	'and the rule that holds it flush with the board is in the head'
);

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'off';
is( statchasers_schedule_shortcode_heading( 2026 ), '', 'and with headings off it prints none' );

// The trail. Rank Math's ends at the schedule page the rewrite resolved to; the
// week URL's own crumb goes on the end, at the week's own address.
echo "\nthe week is the breadcrumb's last step\n";

$sched_trail = array(
	array( 'Home', 'https://example.com/', 'hide_in_schema' => false ),
	array( 'NFL', 'https://example.com/nfl/', 'hide_in_schema' => false ),
	array( '2026 NFL Schedule', 'https://example.com/nfl/nfl-schedule/', 'hide_in_schema' => false ),
);
$crumbs = statchasers_schedule_breadcrumbs( $sched_trail );
is( count( $crumbs ), 4, 'one crumb is added' );
is( $crumbs[3][0] ?? '', 'Week 7', 'named for the week' );
is( $crumbs[3][1] ?? '', 'https://example.com/nfl/nfl-schedule/week-7/', 'at the week URL' );
