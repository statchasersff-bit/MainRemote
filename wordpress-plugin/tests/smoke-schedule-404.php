<?php
/**
 * WEB-013: an invalid schedule week is a 404 all the way through the head.
 *
 * The failure this guards against was live on /nfl/nfl-schedule/week-99/ on
 * 2026-11-24: HTTP 404 and the 404 template, but a head saying "index,
 * follow", a canonical and og:url to the hub, the hub's stored title, and a
 * WebPage at the hub's address carrying the hub's FAQ. The cause was order:
 * Rank Math builds its Paper (the source of every head tag) once, on `wp` at
 * priority 10, and the plugin only made the request a 404 later, on
 * template_redirect.
 *
 * So each child replays one request in WordPress's order, with priorities:
 * the plugin's `wp` callbacks below 10, then Rank Math's Paper is chosen the
 * way Paper::get_papers() chooses it (Singular while is_singular(), Error_404
 * once is_404()), then the rest of `wp`, then template_redirect, then the head
 * through Rank Math's filters and a model of its schema graph (global
 * entities, WebPage at the canonical, the FAQ merge at priority 99). What is
 * NOT run is Rank Math itself: the Paper choice, the Error_404 paper's values
 * and the graph are transcribed from Rank Math 1.0.x and from the live
 * site's 404 head (Page not found - StatChasers, "follow, noindex", no
 * canonical, no og:url, Organization + WebSite + a WebPage with no url).
 *
 * `sched404s` is the parent and runs one `sched404` child per route. When the
 * WEB-021 page identity is loaded, the valid routes' share image and graph
 * links are checked too, and the 404s are checked for having none.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_invalid_week' ) ) {
	fwrite( STDERR, "smoke-schedule-404.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

const SC_S404_TITLE = '2026 NFL Schedule – Weekly Games, Teams & Matchups';
const SC_S404_HOME  = 'https://example.com';
const SC_S404_HUB   = 'https://example.com/nfl/nfl-schedule/';

if ( 'sched404s' === $group ) {
	echo "\ninvalid schedule weeks are 404s in the head too (WEB-013)\n";
	foreach ( array( '99', '19', '23', 'hub', '1', '18', 'article' ) as $route ) {
		$child = array();
		$code  = 0;
		exec(
			'STATCHASERS_SMOKE_GROUP=sched404 STATCHASERS_SMOKE_ROUTE=' . escapeshellarg( $route ) . ' ' .
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
function sc_s404_run( string $hook, int $min, int $max ): void {
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
		try {
			( $t[2] )();
		} catch ( \Throwable $e ) {
			continue;
		}
	}
}

/* ------------------------------------------------------------ one request */

$route = (string) getenv( 'STATCHASERS_SMOKE_ROUTE' );

$post = new WP_Post();
if ( 'article' === $route ) {
	$post->ID           = 92;
	$post->post_title   = 'Waiver Wire Week 5';
	$post->post_content = '<p>Pick up these players.</p>';
	$stored_canonical   = SC_S404_HOME . '/waiver-wire-week-5/';
	$GLOBALS['query']['sc_sched_week'] = '99';
} else {
	$post->ID           = 7;
	$post->post_title   = SC_S404_TITLE;
	$post->post_content = '[statchasers_schedule]';
	$stored_canonical   = SC_S404_HUB;
	if ( 'hub' !== $route ) {
		$GLOBALS['query']['sc_sched_week'] = $route;
	}
	$GLOBALS['http_body'] = '<div class="scs" data-scs-root data-scs-season="2026"><p>board</p>' .
		'<script type="application/json" class="scs-faq-data">[{"q":"When does the season start?","a":"In September."},{"q":"How many weeks?","a":"Eighteen."}]</script></div>';
}

$GLOBALS['page']     = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $post );
$GLOBALS['wp_query'] = new class() {
	public function set_404() {
		$GLOBALS['page']['is404']    = true;
		$GLOBALS['page']['singular'] = false;
	}
};
$GLOBALS['status_code'] = 200;

// WordPress: the main query has run; `wp` fires. Rank Math's
// Frontend::integrations() is on `wp` at 10 and calls Paper::get(), which is
// built once and kept for the request.
sc_s404_run( 'wp', PHP_INT_MIN, 10 );
$paper = is_404() ? 'Error_404' : ( is_singular() ? 'Singular' : 'Misc' );
sc_s404_run( 'wp', 10, PHP_INT_MAX );
sc_s404_run( 'template_redirect', PHP_INT_MIN, PHP_INT_MAX );

// The head, from that Paper, through Rank Math's filters.
if ( 'Singular' === $paper ) {
	$p_title  = $post->post_title;
	$p_robots = array( 'index' => 'index', 'follow' => 'follow' );
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

// Rank Math's graph: global entities on a non-singular request, or where the
// add_global_entities filter says (WEB-021); WebPage at the canonical; the
// json_ld chain; the FAQ folded into the WebPage at 99.
$data = array();
$add  = is_singular() ? (bool) apply_filters( 'rank_math/schema/add_global_entities', false ) : true;
if ( $add ) {
	$data['publisher'] = array( '@type' => 'Organization', '@id' => SC_S404_HOME . '/#organization', 'name' => 'StatChasers' );
	$data['WebSite']   = array( '@type' => 'WebSite', '@id' => SC_S404_HOME . '/#website', 'publisher' => array( '@id' => SC_S404_HOME . '/#organization' ) );
	$data['WebPage']   = array( '@type' => 'WebPage', '@id' => $canonical . '#webpage', 'url' => $canonical, 'name' => $title, 'isPartOf' => array( '@id' => SC_S404_HOME . '/#website' ) );
}
$data = apply_filters( 'rank_math/json_ld', $data, null );
foreach ( $data as $key => $node ) {
	if ( is_array( $node ) && 'FAQPage' === ( $node['@type'] ?? null ) ) {
		$data['WebPage']['@type']      = 'FAQPage';
		$data['WebPage']['mainEntity'] = $node['mainEntity'];
		unset( $data[ $key ] );
		break;
	}
}
$graph_json = (string) wp_json_encode( array_values( $data ) );

// og:image from the collector, both networks.
$images = 0;
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
$identity = function_exists( 'statchasers_page_identity_family' );

$label = 'article' === $route ? 'article ?sc_sched_week=99' : ( 'hub' === $route ? 'hub' : "week $route" );

if ( 'article' === $route ) {
	is( $GLOBALS['status_code'], 200, "$label: not a 404" );
	is( $robots['index'], 'index', "$label: robots untouched" );
	is( $canonical, $stored_canonical, "$label: canonical untouched" );
	is( $title, $post->post_title, "$label: title untouched" );
	return;
}

if ( in_array( $route, array( '99', '19', '23' ), true ) ) {
	// The reported failure: HTTP 404 with an indexable hub head.
	is( $GLOBALS['status_code'], 404, "$label: HTTP 404" );
	is( is_404(), true, "$label: the 404 template" );
	is( $paper, 'Error_404', "$label: 404 set before Rank Math built its Paper" );
	is( $robots['index'], 'noindex', "$label: noindex (not \"index, follow\")" );
	is( $canonical, '', "$label: no canonical (not the hub's)" );
	is( $og_url, '', "$label: no og:url" );
	is( $title, 'Page not found - StatChasers', "$label: Rank Math's 404 title, not the schedule's" );
	is( false === strpos( $graph_json, 'FAQPage' ) && false === strpos( $graph_json, '"Question"' ), true, "$label: no schedule FAQ in the graph" );
	is( false === strpos( $graph_json, SC_S404_HUB ), true, "$label: nothing in the graph at the hub's address" );
	is( isset( $data['publisher'], $data['WebSite'] ), true, "$label: Rank Math's site-level 404 entities left alone" );
	is( $images, 0, "$label: no schedule share image" );
	is( statchasers_schedule_faq_items(), array(), "$label: the FAQ hook has no questions for it" );
	return;
}

// The valid boundaries and the hub: unchanged.
$want_canonical = 'hub' === $route ? SC_S404_HUB : SC_S404_HOME . "/nfl/nfl-schedule/week-$route/";
$want_title     = 'hub' === $route ? '2026 NFL Schedule | StatChasers' : "NFL Week $route Schedule 2026 | StatChasers";
is( $GLOBALS['status_code'], 200, "$label: HTTP 200" );
is( $paper, 'Singular', "$label: Rank Math's Singular page" );
is( $robots['index'], 'index', "$label: index" );
is( $canonical, $want_canonical, "$label: canonical $want_canonical" );
is( $og_url, $want_canonical, "$label: og:url matches" );
is( $title, $want_title, "$label: title \"$want_title\"" );
is( count( statchasers_schedule_faq_items() ), 2, "$label: its FAQ is still there" );
if ( $identity ) {
	is( $images, 2, "$label: share image on both networks (WEB-021)" );
	is( $data['WebPage']['@id'] ?? '', $want_canonical . '#webpage', "$label: page entity at its own @id (WEB-021)" );
	is( $data['WebPage']['@type'] ?? '', 'FAQPage', "$label: and it carries the FAQ (WEB-021)" );
	is( $data['WebPage']['isPartOf']['@id'] ?? '', SC_S404_HOME . '/#website', "$label: isPartOf the WebSite (WEB-021)" );
}
