<?php
/**
 * WEB-022: the schedule's <title> on the hub and every week URL.
 *
 * One request per process, for the reason smoke-week.php gives: the week, the
 * shortcode check and the season are all memoized, so a process can only
 * answer for one address. `schedtitles` is the parent: it runs one `schedtitle`
 * child per route and reports their lines as its own. Each child plays one
 * request through the same hooks WordPress and Rank Math call - Rank Math's
 * title filter, then core's pre_get_document_title on Rank Math's answer - and
 * checks the H1, description and canonical did not move with it.
 *
 * The season comes from the fragment, so the fixture fragment names it; the
 * 2025 and no-fragment routes are there to show it is not written into the
 * code. smoke.php includes this; running it directly does nothing.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_document_title' ) ) {
	fwrite( STDERR, "smoke-schedule-titles.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

// The page's stored title on the live site, and the title Rank Math built from
// it before this change. The week title used to be this plus ": Week N | StatChasers".
const SC_SCHED_PAGE_TITLE = '2026 NFL Schedule – Weekly Games, Teams & Matchups';

if ( 'schedtitles' === $group ) {
	echo "\nthe schedule's <title>, route by route (WEB-022)\n";

	$routes = array( 'hub' );
	for ( $w = 1; $w <= STATCHASERS_SCHEDULE_WEEKS; $w++ ) {
		$routes[] = (string) $w;
	}
	// Past and future seasons, no fragment, no year anywhere, and the 404.
	$routes = array_merge( $routes, array( 'hub@2025', '12@2025', '12@nofrag', '12@noyear', 'hub@noyear', '99' ) );

	foreach ( $routes as $route ) {
		$child = array();
		$code  = 0;
		exec(
			'STATCHASERS_SMOKE_GROUP=schedtitle STATCHASERS_SMOKE_ROUTE=' . escapeshellarg( $route ) . ' ' .
				escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( dirname( __FILE__ ) . '/smoke.php' ) . ' 2>&1',
			$child,
			$code
		);
		foreach ( $child as $line ) {
			if ( 'LOADED OK' === $line || 'all passed' === $line || preg_match( '/^\d+ FAILED$/', $line ) || '' === $line ) {
				continue;
			}
			echo $line . "\n";
		}
		if ( 0 !== $code ) {
			$fail++;
		}
	}
	return;
}

/* ------------------------------------------------------------ one request */

$route              = (string) getenv( 'STATCHASERS_SMOKE_ROUTE' );
list( $wk, $flavor ) = array_pad( explode( '@', $route, 2 ), 2, '' );
$week               = 'hub' === $wk ? 0 : (int) $wk;
$season             = '2025' === $flavor ? 2025 : 2026;

$sched_page             = new WP_Post();
$sched_page->ID         = 7;
$sched_page->post_title = 'noyear' === $flavor ? 'NFL Schedule' : SC_SCHED_PAGE_TITLE;
if ( '2025' === $flavor ) {
	// A page still titled for the old year, showing the season the board says.
	$sched_page->post_title = '2025 NFL Schedule – Weekly Games, Teams & Matchups';
}
$sched_page->post_content = '[statchasers_schedule]';

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $sched_page,
);
if ( $week > 0 ) {
	$GLOBALS['query']['sc_sched_week'] = (string) $week;
}

// The fragment the API answers with. Only its root matters here.
$GLOBALS['http_body'] = in_array( $flavor, array( 'nofrag', 'noyear' ), true )
	? ''
	: '<div class="scs" data-scs-root data-scs-season="' . $season . '"><p>board</p></div>';
if ( '' === $GLOBALS['http_body'] ) {
	$GLOBALS['http_code'] = 503;
}

// template_redirect, as WordPress runs it, with a query object that records a 404.
$GLOBALS['wp_query'] = new class() {
	public function set_404() {
		$GLOBALS['page']['is404']    = true;
		$GLOBALS['page']['singular'] = false;
	}
};
foreach ( $GLOBALS['hooks']['template_redirect'] ?? array() as $fn ) {
	try {
		$fn();
	} catch ( \Throwable $e ) {
		continue;
	}
}

$label = 'hub' === $wk ? 'hub' : 'week ' . $wk;
$label .= '' === $flavor ? '' : " ($flavor)";

// What Rank Math would print on its own: the page's stored title, brand-less.
$rank_math = SC_SCHED_PAGE_TITLE;
$rm_title  = apply_filters( 'rank_math/frontend/title', $rank_math );
// Rank Math answers core's pre_get_document_title with that (priority 15); the
// plugin's own filter runs after it on the same string.
$final = apply_filters( 'pre_get_document_title', $rm_title );

if ( 99 === $week ) {
	is( (bool) ( $GLOBALS['page']['is404'] ?? false ), true, "$label: still a 404" );
	is( $final, $rank_math, "$label: and the 404 keeps the title it had" );
	return;
}

if ( 'hub' === $wk ) {
	$want = 'noyear' === $flavor ? 'NFL Schedule | StatChasers' : "$season NFL Schedule | StatChasers";
} elseif ( 'noyear' === $flavor ) {
	$want = "NFL Week $week Schedule | StatChasers";
} else {
	// nofrag: the board is down, so the year comes off the page's own title.
	$want = "NFL Week $week Schedule $season | StatChasers";
}

is( $final, $want, "$label: <title> is \"$want\"" );
is( $rm_title, $want, "$label: and Rank Math's filter says the same" );
is( substr_count( $final, 'StatChasers' ), 1, "$label: one brand" );
is( mb_strlen( $final ) <= 60, true, "$label: " . mb_strlen( $final ) . ' chars, 60 or fewer' );
// A title filter that ran again over its own answer must not stack.
is( apply_filters( 'pre_get_document_title', $final ), $final, "$label: running the filter twice changes nothing" );

// The rest of the head and the H1, unchanged.
$h1 = apply_filters( 'the_title', $sched_page->post_title, $sched_page->ID );
if ( 0 === $week ) {
	is( $h1, $sched_page->post_title, "$label: the H1 is still the page's own name" );
	is( apply_filters( 'rank_math/frontend/description', 'stored desc' ), 'stored desc', "$label: description left to Rank Math" );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/nfl/nfl-schedule/' ), 'https://example.com/nfl/nfl-schedule/', "$label: canonical left to Rank Math" );
} else {
	is( $h1, $sched_page->post_title . ': Week ' . $week, "$label: the H1 is still the page name plus the week" );
	is(
		apply_filters( 'rank_math/frontend/description', 'stored desc' ),
		"Every Week $week game of the NFL regular season: matchups, dates, kickoff times, TV networks, the teams on bye, and the market's posted spreads and totals.",
		"$label: description unchanged"
	);
	is(
		apply_filters( 'rank_math/frontend/canonical', 'https://example.com/nfl/nfl-schedule/' ),
		"https://example.com/nfl/nfl-schedule/week-$week/",
		"$label: canonical is still the week URL"
	);
}
