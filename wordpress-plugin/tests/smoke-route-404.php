<?php
/**
 * WEB-013, the other routes: a matchup or FPA-archive 404 is a 404 in the
 * head too, not only in the status and the template.
 *
 * Same flaw as the schedule weeks (smoke-schedule-404.php, which explains the
 * replay): these routes made the request a 404 on template_redirect, after
 * Rank Math built its Paper on `wp` at 10. Live on 2026-11-24:
 * /nfl/foo-vs-bar/ was a 404 titled "NFL Matchups" with the holder's og:url;
 * /nfl/detroit-lions-vs-green-bay-packers/2026-week-30/ was a 404 with the
 * pair's whole game head (index, canonical, share card, FAQ, SportsEvent);
 * /2026-week-3/ (no such game) was a noindex 404 keeping the game's title and
 * og:url. The depth chart's junk-team 404, decided on `wp` at priority 1,
 * already had Rank Math's 404 head - the control.
 *
 * `route404s` is the parent and runs one `route404` child per route. The
 * matchup and FPA fetches are fed through the harness's HTTP stubs; Rank Math
 * is modeled as in smoke-schedule-404.php, not run.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_matchup_not_found' ) ) {
	fwrite( STDERR, "smoke-route-404.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

const SC_R404_PAIR = 'detroit-lions-vs-green-bay-packers';

if ( 'route404s' === $group ) {
	echo "\nmatchup and FPA-archive 404s are 404s in the head too (WEB-013)\n";
	$routes = array(
		'm:foo-vs-bar',
		'm:' . SC_R404_PAIR . '/2026-week-30',
		'm:' . SC_R404_PAIR . '/2026-week-3',
		'm:' . SC_R404_PAIR,
		'm:' . SC_R404_PAIR . '/2025-week-7',
		'm:green-bay-packers-vs-detroit-lions',
		'm:green-bay-packers-vs-detroit-lions/2026-week-3',
		'f:2003',
		'f:2025',
	);
	foreach ( $routes as $route ) {
		$child = array();
		$code  = 0;
		exec(
			'STATCHASERS_SMOKE_GROUP=route404 STATCHASERS_SMOKE_ROUTE=' . escapeshellarg( $route ) . ' ' .
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

/** Run one action's callbacks whose priority is in [$min, $max), in priority order. */
function sc_r404_run( string $hook, int $min, int $max ): void {
	$fns  = $GLOBALS['hooks'][ $hook ] ?? array();
	$prio = $GLOBALS['hook_priority'][ $hook ] ?? array();
	$todo = array();
	foreach ( $fns as $i => $fn ) {
		$p = $prio[ $i ] ?? 10;
		if ( $p >= $min && $p < $max ) {
			$todo[] = array( $p, $i, $fn );
		}
	}
	usort( $todo, static function ( $a, $b ) { return $a[0] <=> $b[0] ?: $a[1] <=> $b[1]; } );
	foreach ( $todo as $t ) {
		( $t[2] )();
	}
}

/* ------------------------------------------------------------ one request */

$route = (string) getenv( 'STATCHASERS_SMOKE_ROUTE' );
list( $kind, $path ) = explode( ':', $route, 2 );
$parts = explode( '/', $path );

$post = new WP_Post();
if ( 'm' === $kind ) {
	// The holder page every pair URL resolves to: noindex, its own title.
	$post->ID           = 50;
	$post->post_title   = 'NFL Matchups';
	$post->post_content = '[statchasers_matchup]';
	$stored_canonical   = 'https://example.com/nfl/matchup/';
	$stored_robots      = array( 'index' => 'noindex', 'follow' => 'follow' );
	$GLOBALS['query']['sc_matchup'] = $parts[0];
	if ( isset( $parts[1] ) ) {
		$GLOBALS['query']['sc_matchup_game'] = $parts[1];
	}
	// What the API answers for a game: a finished one, with every piece of
	// head the page carries - so a 404 that kept any of it would show.
	$GLOBALS['http_body'] = '<div>game</div>' .
		'<script type="application/json" class="sct-matchup-event-data">{"@type":"SportsEvent","name":"Packers at Lions","startDate":"2025-10-19T13:00:00-04:00","location":{"@type":"Place","name":"Ford Field"},"homeTeam":{"@type":"SportsTeam","name":"Detroit Lions"},"awayTeam":{"@type":"SportsTeam","name":"Green Bay Packers"}}</script>' .
		'<script type="application/json" class="sct-matchup-faq-data">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Who won?","acceptedAnswer":{"@type":"Answer","text":"The Lions."}}]}</script>';
	$GLOBALS['http_headers'] = array(
		'x-matchup-game'        => isset( $parts[1] ) ? 'archived' : '',
		'x-matchup-state'       => 'final',
		'x-matchup-title'       => rawurlencode( 'Packers vs Lions Player Stats, Box Score & Highlights | 2025' ),
		'x-matchup-description' => rawurlencode( 'Lions beat the Packers.' ),
		'x-matchup-image'       => '/og/green-bay-packers-vs-detroit-lions-2025-week-7.png',
		'x-matchup-image-alt'   => rawurlencode( 'Final score.' ),
	);
	if ( '2026-week-3' === ( $parts[1] ?? '' ) ) {
		// They did not play that week: the API's 404 is the answer.
		$GLOBALS['http_code'] = 404;
		$GLOBALS['http_body'] = '';
	}
} else {
	$post->ID           = 96;
	$post->post_title   = 'Fantasy Points Allowed by Position';
	$post->post_content = '[statchasers_fpa]';
	$stored_canonical   = 'https://example.com/nfl/fantasy-points-allowed-by-position/';
	$stored_robots      = array( 'index' => 'index', 'follow' => 'follow' );
	$GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] = $path;
	if ( '2003' === $path ) {
		// No table for the season.
		$GLOBALS['http_code'] = 404;
		$GLOBALS['http_body'] = '';
	} else {
		$GLOBALS['http_body'] = '<div class="scf-answer">table</div><script type="application/json" class="scf-page-data">{"title":"Fantasy Points Allowed by Position 2025 (Full Season)","h1":"2025 Fantasy Points Allowed by Position","description":"Full 2025 season.","kind":"archive","season":2025,"currentSeason":2026}</script>';
	}
}
$_GET = array();

$GLOBALS['page']     = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );
// A WP_Query (the FPA path checks for one) that records a 404.
$GLOBALS['wp_query'] = new class() extends WP_Query {
	public function set_404() {
		$GLOBALS['page']['is404']    = true;
		$GLOBALS['page']['singular'] = false;
	}
};
$GLOBALS['status_code'] = 200;

sc_r404_run( 'wp', PHP_INT_MIN, 10 );
$paper = is_404() ? 'Error_404' : ( is_singular() ? 'Singular' : 'Misc' );
sc_r404_run( 'wp', 10, PHP_INT_MAX );

$label = $route;

if ( 0 === strpos( $path, 'green-bay-packers-vs-detroit-lions' ) ) {
	// The reversed spelling 301s on template_redirect (which exits, so it is
	// not run here); it must not have been made a 404 first.
	is( statchasers_matchup_not_found(), false, "$label: a 301, not a 404" );
	is( is_404(), false, "$label: not made a 404 on wp" );
	is( $GLOBALS['status_code'], 200, "$label: no 404 status" );
	return;
}

sc_r404_run( 'template_redirect', PHP_INT_MIN, PHP_INT_MAX );

if ( 'Singular' === $paper ) {
	$p_title  = $post->post_title;
	$p_robots = $stored_robots;
	$p_canon  = $stored_canonical;
} else {
	$p_title  = 'Page not found - StatChasers';
	$p_robots = array( 'index' => 'noindex', 'follow' => 'follow' );
	$p_canon  = '';
}
$title     = apply_filters( 'rank_math/frontend/title', $p_title );
$robots    = apply_filters( 'rank_math/frontend/robots', $p_robots );
$canonical = (string) apply_filters( 'rank_math/frontend/canonical', $p_canon );
$og_url    = (string) apply_filters( 'rank_math/opengraph/url', $canonical );
$graph     = (string) wp_json_encode( apply_filters( 'rank_math/json_ld', array(), null ) );
$images    = 0;
foreach ( array( 'facebook', 'twitter' ) as $network ) {
	$col = new class() {
		public $n = 0;
		public function has_images() { return $this->n > 0; }
		public function add_image( $a ) { $this->n++; }
	};
	foreach ( array( 'add_images', 'add_additional_images' ) as $stage ) {
		foreach ( $GLOBALS['hooks'][ "rank_math/opengraph/{$network}/{$stage}" ] ?? array() as $fn ) {
			$fn( $col );
		}
	}
	$images += $col->n;
}
$crumbs = apply_filters( 'rank_math/frontend/breadcrumb/items', array( array( 'Home', 'https://example.com' ) ) );

if ( in_array( $path, array( 'foo-vs-bar', SC_R404_PAIR . '/2026-week-30', SC_R404_PAIR . '/2026-week-3', '2003' ), true ) ) {
	is( $GLOBALS['status_code'], 404, "$label: HTTP 404" );
	is( is_404(), true, "$label: the 404 template" );
	is( $paper, 'Error_404', "$label: 404 set before Rank Math built its Paper" );
	is( $robots['index'], 'noindex', "$label: noindex" );
	is( $canonical, '', "$label: no canonical" );
	is( $og_url, '', "$label: no og:url" );
	is( $title, 'Page not found - StatChasers', "$label: Rank Math's 404 title" );
	is( $images, 0, "$label: no share image" );
	is( false === strpos( $graph, 'SportsEvent' ) && false === strpos( $graph, 'FAQPage' ) && false === strpos( $graph, 'VideoObject' ), true, "$label: no game nodes in the graph" );
	is( count( $crumbs ), 1, "$label: no pair or game breadcrumb" );
	return;
}

// The valid pages, unchanged.
is( $GLOBALS['status_code'], 200, "$label: HTTP 200" );
is( $paper, 'Singular', "$label: Rank Math's page" );
is( $robots['index'], 'index', "$label: index" );
if ( 'f' === $kind ) {
	$want = 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/';
	is( $canonical, $want, "$label: the archive's own canonical" );
	is( $og_url, $want, "$label: og:url matches" );
	is( $title, 'Fantasy Points Allowed by Position 2025 (Full Season)', "$label: the archive's title" );
	return;
}
$want = statchasers_matchup_url( SC_R404_PAIR, $parts[1] ?? '' );
is( $canonical, $want, "$label: canonical $want" );
is( $og_url, $want, "$label: og:url matches" );
is( $title, 'Packers vs Lions Player Stats, Box Score & Highlights | 2025', "$label: the API's title" );
is( false !== strpos( $graph, 'SportsEvent' ), true, "$label: its SportsEvent" );
if ( isset( $parts[1] ) ) {
	is( $images, 2, "$label: its share card on both networks" );
}
