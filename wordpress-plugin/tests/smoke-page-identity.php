<?php
/**
 * WEB-021: page identity on the schedule and SOS routes - share image,
 * canonical, title and the schema graph, checked together per route.
 *
 * One request per process, for the reason smoke-schedule-titles.php gives (the
 * week, the mount checks and the fetches are memoized). `pageids` is the
 * parent: it runs one `pageid` child per route and reports their lines as its
 * own.
 *
 * What a child exercises: the plugin's real hooks, called the way WordPress
 * and Rank Math call them - template_redirect, Rank Math's title, description,
 * canonical and og:url filters, the breadcrumb items filter, the
 * `schema/add_global_entities` decision, the `json_ld` filter chain and the
 * Open Graph image collector of both networks. What it does NOT run is Rank
 * Math itself: rank_math_model() below is a transcription of the pieces of
 * Rank Math 1.0.x that build this graph (JsonLD::can_add_global_entities,
 * add_context_data's Publisher / WebSite / Breadcrumbs / WebPage, and
 * Frontend::change_webpage_entity's FAQ merge at priority 99), fed with this
 * site's settings: Pages default to no schema, knowledge graph type company
 * with Local SEO on, no logo or social profiles. The graph is then encoded,
 * decoded and checked as JSON: every @id reference must resolve inside it.
 *
 * smoke.php includes this; running it directly does nothing.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_page_identity_family' ) ) {
	fwrite( STDERR, "smoke-page-identity.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

const SC_PID_SCHED_TITLE = '2026 NFL Schedule – Weekly Games, Teams & Matchups';
const SC_PID_SOS_TITLE   = '2026 Fantasy Football Strength of Schedule (SOS) Rankings';
const SC_PID_HOME        = 'https://example.com';

if ( 'pageids' === $group ) {
	echo "\npage identity on the schedule and SOS routes (WEB-021)\n";

	$routes = array( 'sched:hub' );
	for ( $w = 1; $w <= STATCHASERS_SCHEDULE_WEEKS; $w++ ) {
		$routes[] = 'sched:' . $w;
	}
	$routes = array_merge(
		$routes,
		array( 'sched:99', 'sos:hub' ),
		array_map( static function ( $p ) { return 'sos:' . $p; }, STATCHASERS_SOS_PAGES ),
		array( 'sos:hub?tab=player&scoring=half-ppr', 'sos:rb?scoring=std', 'article' )
	);

	foreach ( $routes as $route ) {
		$child = array();
		$code  = 0;
		exec(
			'STATCHASERS_SMOKE_GROUP=pageid STATCHASERS_SMOKE_ROUTE=' . escapeshellarg( $route ) . ' ' .
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

/* ------------------------------------------------------------ Rank Math */

/**
 * Rank Math's graph for this request, as Rank Math would print it.
 *
 * @param string $canonical The canonical Rank Math's Paper settled on.
 * @param string $title     The title Rank Math's Paper settled on.
 * @param array  $crumbs    The trail before the plugin's breadcrumb filter.
 * @return array<string,mixed> The graph, keyed as Rank Math keys it.
 */
function rank_math_model( string $canonical, string $title, array $crumbs ): array {
	$data = array();

	// JsonLD::can_add_global_entities: the front page and anything not
	// singular (a 404) always; a singular Page with no schema of its own only
	// when its post type has a default schema type ('' on this site) - or
	// when the filter says so.
	$singular = is_singular() && ! is_404();
	$add      = $singular ? (bool) apply_filters( 'rank_math/schema/add_global_entities', false ) : true;

	if ( $add ) {
		$data['publisher'] = array(
			'@type' => array( 'OnlineBusiness', 'Organization' ),
			'@id'   => SC_PID_HOME . '/#organization',
			'name'  => 'StatChasers',
			'url'   => SC_PID_HOME,
		);
		$data['WebSite']   = array(
			'@type'      => 'WebSite',
			'@id'        => SC_PID_HOME . '/#website',
			'url'        => SC_PID_HOME,
			'name'       => 'StatChasers.com',
			'publisher'  => array( '@id' => SC_PID_HOME . '/#organization' ),
			'inLanguage' => 'en-US',
		);
	}

	$crumbs = apply_filters( 'rank_math/frontend/breadcrumb/items', $crumbs );
	$items  = array();
	foreach ( array_values( $crumbs ) as $i => $crumb ) {
		$items[] = array(
			'@type'    => 'ListItem',
			'position' => (string) ( $i + 1 ),
			'item'     => array( '@id' => $crumb[1], 'name' => $crumb[0] ),
		);
	}
	$data['BreadcrumbList'] = array(
		'@type'           => 'BreadcrumbList',
		'@id'             => $canonical . '#breadcrumb',
		'itemListElement' => $items,
	);

	if ( $add ) {
		$data['WebPage'] = array(
			'@type'      => 'WebPage',
			'@id'        => $canonical . '#webpage',
			'url'        => $canonical,
			'name'       => $title,
			'isPartOf'   => array( '@id' => SC_PID_HOME . '/#website' ),
			'inLanguage' => 'en-US',
			'breadcrumb' => array( '@id' => $canonical . '#breadcrumb' ),
		);
		// Author: a Person no node references, removed again by
		// Frontend::remove_person_entity before printing. Not modeled.
	}

	// The rest of the json_ld chain: every callback the plugin registered.
	$data = apply_filters( 'rank_math/json_ld', $data, null );

	// Frontend::change_webpage_entity (priority 99): an FAQPage folds into
	// WebPage - creating a bare one when there is none.
	foreach ( $data as $key => $node ) {
		if ( is_array( $node ) && 'FAQPage' === ( $node['@type'] ?? null ) ) {
			$data['WebPage']['@type']      = 'FAQPage';
			$data['WebPage']['mainEntity'] = $node['mainEntity'];
			unset( $data[ $key ] );
			break;
		}
	}

	return $data;
}

/** Rank Math's image collector, one per network. */
function rank_math_images( string $network ): array {
	$images = new class() {
		public $images = array();
		public function has_images() { return ! empty( $this->images ); }
		public function add_image( $a ) { $this->images[ $a['url'] ] = $a; }
	};
	foreach ( array( 'add_images', 'add_additional_images' ) as $stage ) {
		foreach ( $GLOBALS['hooks'][ "rank_math/opengraph/{$network}/{$stage}" ] ?? array() as $fn ) {
			$fn( $images );
		}
	}
	return array_values( $images->images );
}

/* ------------------------------------------------------------ one request */

$route = (string) getenv( 'STATCHASERS_SMOKE_ROUTE' );
list( $path, $qs ) = array_pad( explode( '?', $route, 2 ), 2, '' );
list( $family, $which ) = array_pad( explode( ':', $path, 2 ), 2, '' );
parse_str( $qs, $_GET );

$post = new WP_Post();
if ( 'sched' === $family ) {
	$post->ID           = 7;
	$post->post_title   = SC_PID_SCHED_TITLE;
	$post->post_content = '[statchasers_schedule]';
	$base_canonical     = SC_PID_HOME . '/nfl/nfl-schedule/';
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( SC_PID_SCHED_TITLE, $base_canonical ) );
	if ( 'hub' !== $which ) {
		$GLOBALS['query']['sc_sched_week'] = $which;
	}
	$faq_count            = 'hub' === $which ? 3 : 2;
	$faq                  = array();
	for ( $i = 1; $i <= $faq_count; $i++ ) {
		$faq[] = array( 'q' => "Question $i?", 'a' => "Answer $i." );
	}
	$GLOBALS['http_body'] = '<div class="scs" data-scs-root data-scs-season="2026"><p>board</p>' .
		'<script type="application/json" class="scs-faq-data">' . json_encode( $faq ) . '</script></div>';
} elseif ( 'sos' === $family ) {
	$post->ID           = 94;
	$post->post_title   = SC_PID_SOS_TITLE;
	$post->post_content = '[statchasers_strength_of_schedule]';
	$base_canonical     = get_permalink( 94 );
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( 'FF Strength of Schedule', $base_canonical ) );
	if ( 'hub' !== $which ) {
		$GLOBALS['query']['sc_sos_page'] = $which;
		$copy = array(
			'title'       => sprintf( STATCHASERS_SOS_PAGE_COPY[ $which ]['title'], 2026 ),
			'h1'          => STATCHASERS_SOS_PAGE_COPY[ $which ]['h1'],
			'description' => sprintf( STATCHASERS_SOS_PAGE_COPY[ $which ]['description'], 2026 ),
		);
	} else {
		$copy = array(
			'title'       => 'Fantasy Football Strength of Schedule | 2026 SOS by Team & Player',
			'h1'          => 'Fantasy Football Strength of Schedule',
			'description' => 'View 2026 fantasy football strength of schedule by team, player, position, scoring format, rest-of-season, and fantasy playoff weeks.',
		);
	}
	$GLOBALS['http_body'] = '<div class="scsos is-embed" data-scsos-root="1" data-season="2026"><h2>Board</h2>' .
		'<script type="application/json" class="scsos-page-data">' . json_encode( $copy ) . '</script></div>';
} else {
	// An ordinary article carrying the tools' query words.
	$post->ID           = 92;
	$post->post_title   = 'Waiver Wire Week 5';
	$post->post_content = '<p>Pick up these players.</p>';
	$base_canonical     = SC_PID_HOME . '/waiver-wire-week-5/';
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'Waiver Wire Week 5', $base_canonical ) );
	$GLOBALS['query']   = array( 'sc_sched_week' => '12', 'sc_sos_page' => 'rb' );
	$_GET               = array( 'tab' => 'player', 'scoring' => 'std' );
}

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $post,
);
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

$label = $route;

// The head, through Rank Math's filters.
$title     = apply_filters( 'rank_math/frontend/title', $post->post_title );
$canonical = apply_filters( 'rank_math/frontend/canonical', $base_canonical );
$og_url    = apply_filters( 'rank_math/opengraph/url', $base_canonical );
$graph     = rank_math_model( $canonical, $title, $crumbs );
$json      = json_decode( (string) wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => array_values( $graph ) ) ), true );
$nodes     = is_array( $json['@graph'] ?? null ) ? $json['@graph'] : array();
$fb        = rank_math_images( 'facebook' );
$tw        = rank_math_images( 'twitter' );

$by_id = array();
foreach ( $nodes as $node ) {
	if ( isset( $node['@id'] ) ) {
		$by_id[ $node['@id'] ][] = $node;
	}
}
$pages = array_values(
	array_filter(
		$nodes,
		static function ( $n ) {
			foreach ( (array) ( $n['@type'] ?? array() ) as $t ) {
				if ( false !== strpos( (string) $t, 'Page' ) ) {
					return true;
				}
			}
			return false;
		}
	)
);
$typed = static function ( string $type ) use ( $nodes ): array {
	return array_values(
		array_filter(
			$nodes,
			static function ( $n ) use ( $type ) {
				return in_array( $type, (array) ( $n['@type'] ?? array() ), true );
			}
		)
	);
};

/* --- the 404 and the article: nothing of this --- */

if ( 'article' === $family ) {
	is( statchasers_page_identity_family(), '', "$label: not a schedule or SOS route" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: Rank Math's answer for it passes through" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image added" );
	is( $canonical, $base_canonical, "$label: canonical untouched" );
	is( count( $graph['BreadcrumbList']['itemListElement'] ), 2, "$label: breadcrumb untouched" );
	return;
}

if ( 'sched' === $family && '99' === $which ) {
	is( (bool) ( $GLOBALS['page']['is404'] ?? false ), true, "$label: still a 404" );
	is( statchasers_page_identity_family(), '', "$label: not a valid route" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: the plugin does not opt it in" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image" );
	is( $title, SC_PID_SCHED_TITLE, "$label: title untouched (WEB-022 leaves 404s alone)" );
	is( $canonical, $base_canonical, "$label: no week canonical" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	return;
}

/* --- a valid route --- */

if ( 'sched' === $family ) {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/nfl-schedule/week-$which/";
	$want_title     = 'hub' === $which ? '2026 NFL Schedule | StatChasers' : "NFL Week $which Schedule 2026 | StatChasers";
	$want_faq       = $faq_count;
} else {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/fantasy-football-strength-of-schedule/$which/";
	$want_title     = $copy['title'];
	$want_faq       = 0;
}
$want_id = $want_canonical . '#webpage';

is( $canonical, $want_canonical, "$label: canonical $want_canonical" );
is( $og_url, $want_canonical, "$label: og:url matches the canonical" );
is( $title, $want_title, "$label: title \"$want_title\"" );

// One share image, the same on both networks, with real pixels and alt.
is( count( $fb ), 1, "$label: one og:image" );
is( count( $tw ), 1, "$label: one twitter:image" );
is( $fb[0]['url'] ?? '', STATCHASERS_PAGE_IDENTITY_IMAGE['url'], "$label: og:image is the brand card" );
is( ( $tw[0]['url'] ?? '' ) === ( $fb[0]['url'] ?? null ), true, "$label: twitter:image is the same picture" );
is( array( $fb[0]['width'] ?? 0, $fb[0]['height'] ?? 0 ), array( 1200, 630 ), "$label: 1200 x 630" );
is( '' !== ( $fb[0]['alt'] ?? '' ), true, "$label: with alt text" );

// Exactly one Organization, WebSite, BreadcrumbList and page entity.
$orgs = $typed( 'Organization' );
$site = $typed( 'WebSite' );
$bcs  = $typed( 'BreadcrumbList' );
is( count( $orgs ), 1, "$label: one Organization" );
is( $orgs[0]['@id'] ?? '', SC_PID_HOME . '/#organization', "$label: the site's Organization @id" );
is( count( $site ), 1, "$label: one WebSite" );
is( $site[0]['@id'] ?? '', SC_PID_HOME . '/#website', "$label: the site's WebSite @id" );
is( $site[0]['publisher']['@id'] ?? '', SC_PID_HOME . '/#organization', "$label: WebSite published by the Organization" );
is( count( $bcs ), 1, "$label: one BreadcrumbList" );
is( count( $pages ), 1, "$label: one page entity" );
$page = $pages[0] ?? array();
is( $page['@id'] ?? '', $want_id, "$label: page @id is the route's own" );
is( $page['url'] ?? '', $want_canonical, "$label: page url is the canonical" );
is( $page['name'] ?? '', $want_title, "$label: page name is the route's title" );
is( $page['isPartOf']['@id'] ?? '', SC_PID_HOME . '/#website', "$label: isPartOf the WebSite" );
is( $page['breadcrumb']['@id'] ?? '', $bcs[0]['@id'] ?? 'none', "$label: breadcrumb connected" );
is( $bcs[0]['@id'] ?? '', $want_canonical . '#breadcrumb', "$label: breadcrumb @id is the route's" );
$last = end( $bcs[0]['itemListElement'] );
is( $last['item']['@id'] ?? '', $want_canonical, "$label: the trail ends at the route" );
is( count( $bcs[0]['itemListElement'] ), 'hub' === $which ? 3 : 4, "$label: the trail keeps Home, NFL and the page" );
is( $page['primaryImageOfPage']['@id'] ?? '', STATCHASERS_PAGE_IDENTITY_IMAGE['url'], "$label: primaryImageOfPage is the share image" );
is( isset( $by_id[ STATCHASERS_PAGE_IDENTITY_IMAGE['url'] ] ), true, "$label: and that ImageObject is in the graph" );

// The FAQ is the page entity itself, not a second page.
if ( $want_faq > 0 ) {
	is( (array) ( $page['@type'] ?? null ), array( 'FAQPage' ), "$label: the page entity is the FAQPage" );
	is( count( $page['mainEntity'] ?? array() ), $want_faq, "$label: with all $want_faq questions" );
} else {
	is( (array) ( $page['@type'] ?? null ), array( 'WebPage' ), "$label: a WebPage (no FAQ schema on SOS)" );
}

// Every node has an @id, no @id is used twice, every reference resolves.
$ok_ids = true;
foreach ( $nodes as $node ) {
	if ( empty( $node['@id'] ) ) {
		$ok_ids = false;
	}
}
is( $ok_ids, true, "$label: every node has an @id" );
is( max( array_map( 'count', $by_id ) ), 1, "$label: no @id emitted twice" );
$dangling = array();
foreach ( $nodes as $node ) {
	foreach ( array( 'isPartOf', 'publisher', 'breadcrumb', 'primaryImageOfPage' ) as $ref ) {
		if ( isset( $node[ $ref ]['@id'] ) && ! isset( $by_id[ $node[ $ref ]['@id'] ] ) ) {
			$dangling[] = $ref . ' -> ' . $node[ $ref ]['@id'];
		}
	}
}
is( $dangling, array(), "$label: every reference resolves" );

// STATCHASERS_PAGEID_DUMP=1 prints what a route's head would carry, for the
// before/after report; the checks above do not depend on it.
if ( getenv( 'STATCHASERS_PAGEID_DUMP' ) ) {
	echo "DUMP title={$title}\nDUMP canonical={$canonical}\nDUMP og:url={$og_url}\n";
	echo 'DUMP og:image=' . ( $fb[0]['url'] ?? '-' ) . ' ' . ( $fb[0]['width'] ?? '' ) . 'x' . ( $fb[0]['height'] ?? '' ) . ' alt="' . ( $fb[0]['alt'] ?? '' ) . "\"\n";
	echo 'DUMP twitter:image=' . ( $tw[0]['url'] ?? '-' ) . "\n";
	echo 'DUMP json-ld=' . json_encode( $json, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n";
}
