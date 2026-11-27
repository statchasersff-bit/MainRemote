<?php
/**
 * WEB-021: page identity on the schedule, SOS and player stats routes - share image,
 * canonical, title and the schema graph, checked together per route. The team
 * directory, hubs and tabs joined as the 'team' family in the team audit
 * (2026-11-24), the rest-of-season rankings as the 'ros' family on 2026-11-25
 * (the hub, its four position addresses, an address the rewrite does not
 * know, and the redraft board's page as the family it is not). The NFL depth
 * charts hub joined as 'depth' (2026-11-25), with the depth charts' real route
 * classes loaded into every child, so each other family's route is also a
 * check that it is not mistaken for the hub.
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
const SC_PID_DEPTH_TITLE = 'NFL Depth Charts for Fantasy Football | All 32 Teams';
const SC_PID_SOS_TITLE   ='2026 Fantasy Football Strength of Schedule (SOS) Rankings';
const SC_PID_HOME        = 'https://example.com';
const SC_PID_ROS_URL     = SC_PID_HOME . '/fantasy-football/rest-of-season-rankings/';
const SC_PID_STATS_NAMES = array(
	'hub' => 'Player',
	'rb'  => 'Running Back',
	'wr'  => 'Wide Receiver',
	'te'  => 'Tight End',
);

if ( 'pageids' === $group ) {
	echo "\npage identity on the schedule, SOS, team, player stats and rest-of-season rankings routes (WEB-021)\n";

	$routes = array( 'sched:hub' );
	for ( $w = 1; $w <= STATCHASERS_SCHEDULE_WEEKS; $w++ ) {
		$routes[] = 'sched:' . $w;
	}
	$routes = array_merge(
		$routes,
		array( 'sched:99', 'sos:hub' ),
		array_map( static function ( $p ) { return 'sos:' . $p; }, STATCHASERS_SOS_PAGES ),
		array( 'sos:hub?tab=player&scoring=half-ppr', 'sos:rb?scoring=std', 'article' ),
		// The team family (team audit, 2026-11-24): the directory, a hub with
		// no image of its own, a hub whose crest is its featured image, every
		// tab address, a long name, and a page at a slug that is no team.
		array( 'team:index', 'team:buffalo-bills', 'team:buffalo-bills+thumb', 'team:buffalo-bills/coaching+thumb', 'team:buffalo-bills+avif', 'team:buffalo-bills/schedule+avif' ),
		array_map(
			static function ( $t ) {
				return 'team:buffalo-bills/' . $t;
			},
			array( 'usage', 'coaching', 'stats', 'schedule', 'depth-chart', 'matchups', 'news' )
		),
		array( 'team:washington-commanders/schedule', 'team:not-a-team' ),
		array( 'stats:hub', 'stats:rb', 'stats:wr', 'stats:te', 'stats:qb' ),
		// The rest-of-season rankings (2026-11-25): the hub, every position
		// address, an address the rewrite does not serve (a 404), the hub and
		// a position with an image an editor set, and the redraft board's
		// page, which is not part of the family even with a position in the
		// query.
		array( 'ros:hub', 'ros:qb', 'ros:rb', 'ros:wr', 'ros:te', 'ros:xyz', 'ros:hub+thumb', 'ros:rb+thumb', 'redraft' ),
		// The depth charts hub (2026-11-25): its one address, the same with an
		// unrelated query argument, with an image an editor set, a pre-1.7.0
		// team route (a 301), junk under the path (a 404), and the /nfl/ hub
		// page the same plugin provisions (not the tool).
		array( 'depth:hub', 'depth:hub?utm_source=x', 'depth:hub+thumb', 'depth:legacy', 'depth:invalid', 'depth:nfl-hub' ),
		// Fantasy points allowed (2026-11-27): the current table, the same
		// with a format and view in the query (one canonical), the 2025
		// archive, and a season with no table (a 404).
		array( 'fpa:hub', 'fpa:hub?format=half&view=adjusted', 'fpa:2025', 'fpa:2001' )
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

/* ------------------------------------------------------ the depth charts */

// The depth charts' own route classes, so SCDC_Route::is_main() is the real
// predicate in every child. Two WordPress conditionals they ask that the rest
// of the plugin never does.
if ( ! function_exists( 'is_feed' ) ) {
	function is_feed() { return false; }
}
if ( ! function_exists( 'is_robots' ) ) {
	function is_robots() { return false; }
}
foreach ( array( 'teams', 'rewrite', 'pages', 'route' ) as $scdc_class ) {
	require_once __DIR__ . "/../statchasers-news/depth-charts/includes/class-scdc-{$scdc_class}.php";
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
		if ( ! empty( $GLOBALS['featured_avif'] ) ) {
			// Rank Math's primaryImage from the featured image.
			$data['primaryImage']                  = array(
				'@type' => 'ImageObject',
				'@id'   => $GLOBALS['featured_avif'],
				'url'   => $GLOBALS['featured_avif'],
			);
			$data['WebPage']['primaryImageOfPage'] = array( '@id' => $GLOBALS['featured_avif'] );
		}
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
} elseif ( 'team' === $family ) {
	// $which: "index", "<slug>", "<slug>/<tab>", each optionally "+thumb" (the
	// page has a featured image, which Rank Math's own add_images finds).
	$thumb = '+thumb' === substr( $which, -6 );
	$which = $thumb ? substr( $which, 0, -6 ) : $which;
	// "+avif": the live hubs' featured image, an AVIF crest Rank Math names as
	// primaryImage but does not print as og:image (2026-11-25).
	$avif  = '+avif' === substr( $which, -5 );
	$which = $avif ? substr( $which, 0, -5 ) : $which;
	if ( $avif ) {
		$GLOBALS['featured_avif'] = 'https://example.com/wp-content/uploads/2026/09/buf.avif';
	}
	list( $team_slug, $team_tab ) = array_pad( explode( '/', $which, 2 ), 2, '' );
	$container                    = new WP_Post();
	$container->ID                = 50;
	$container->post_name         = 'teams';
	$container->post_title        = 'NFL Team Hubs';
	$container->post_content      = '[statchasers_team_index]';
	$team_hubs_url                = get_permalink( 50 );
	$crumbs                       = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( 'NFL Team Hubs', $team_hubs_url ) );
	if ( 'index' === $team_slug ) {
		$post           = $container;
		$base_canonical = $team_hubs_url;
	} else {
		$post->ID           = 51;
		$post->post_name    = $team_slug;
		$post->post_title   = 'Team Page';
		$post->post_content = '[statchasers_team]';
		$base_canonical     = get_permalink( 51 );
		$GLOBALS['pages_by_path'][ STATCHASERS_TEAM_PATH . '/' . $team_slug ] = $post;
		if ( '' !== $team_tab ) {
			$GLOBALS['query']['sc_section'] = $team_tab;
		}
		$GLOBALS['team_faq']  = 'schedule' === $team_tab ? 2 : 3;
		$faq                  = array();
		for ( $i = 1; $i <= $GLOBALS['team_faq']; $i++ ) {
			$faq[] = array( 'q' => "Question $i?", 'a' => "Answer $i." );
		}
		$GLOBALS['http_body'] = '<div class="sct" data-sct-root="1"><p>panel</p>' .
			'<script type="application/json" class="sct-faq-data">' . json_encode( $faq ) . '</script>' .
			( 'schedule' === $team_tab
				? '<script type="application/json" class="sct-schedule-data">' . json_encode(
					array(
						'@type'           => 'ItemList',
						'itemListElement' => array( array( '@type' => 'ListItem', 'position' => 1, 'item' => array( '@type' => 'SportsEvent', 'name' => 'Game' ) ) ),
					)
				) . '</script>'
				: '' ) .
			'</div>';
		// Rank Math names the page's own crumb with the_title, which the team
		// pages rewrite to the tab's H1.
		$GLOBALS['page_post_for_title'] = $post;
	}
	if ( $thumb ) {
		$featured = static function ( $images ) {
			$images->add_image( array( 'url' => 'https://example.com/wp-content/uploads/BUF.png', 'width' => 512, 'height' => 512, 'alt' => 'Buffalo Bills logo' ) );
		};
		$GLOBALS['hooks']['rank_math/opengraph/facebook/add_images'][] = $featured;
		$GLOBALS['hooks']['rank_math/opengraph/twitter/add_images'][]  = $featured;
	}
} elseif ( 'stats' === $family ) {
	// Page 1736 on the live site. The bare page is the quarterbacks; /rb/,
	// /wr/ and /te/ are the rewrite's sc_stats_pos on the same post, and /qb/
	// is the 301 to the bare page.
	$post->ID           = 1736;
	$post->post_title   = 'NFL Player Stats';
	$post->post_content = '[statchasers_player_stats]';
	$base_canonical     = SC_PID_HOME . '/nfl/nfl-player-stats/';
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( 'NFL Player Stats', $base_canonical ) );
	if ( 'hub' !== $which ) {
		$GLOBALS['query']['sc_stats_pos'] = $which;
	}
	$stats_name = SC_PID_STATS_NAMES[ $which ] ?? 'Player';
	$copy       = array(
		'title'       => "2026 NFL $stats_name Stats & Fantasy Football Stats",
		'h1'          => "2026 NFL $stats_name Stats & Fantasy Football Stats",
		'description' => "2026 NFL $stats_name stats.",
		'lead'        => 'Compare players.',
	);
	$faq = array();
	for ( $i = 1; $i <= 3; $i++ ) {
		$faq[] = array( 'q' => "Stats question $i?", 'a' => "Answer $i." );
	}
	$GLOBALS['http_body'] = '<div class="sca"><div class="sca-intro"><p>intro</p></div><p>table</p>' .
		'<script type="application/json" class="sca-faq-data">' . json_encode( $faq ) . '</script>' .
		'<script type="application/json" class="sca-page-data">' . json_encode( $copy ) . '</script></div>';
	if ( 'qb' === $which ) {
		// /qb/ exits inside template_redirect (the 301). Reaching the head
		// would mean it rendered; the checks run as the process ends.
		register_shutdown_function(
			static function () {
				global $fail;
				if ( ! empty( $GLOBALS['sc_pid_head_reached'] ) ) {
					return;
				}
				is( true, true, 'stats:qb: /qb/ ends in template_redirect (the 301), no head of its own' );
				is( statchasers_page_identity_family(), '', 'stats:qb: not a route of its own' );
				is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, 'stats:qb: the plugin does not opt it in' );
				is( count( rank_math_images( 'facebook' ) ) + count( rank_math_images( 'twitter' ) ), 0, 'stats:qb: no share image' );
				echo "\n" . ( $fail ? "$fail FAILED\n" : "all passed\n" );
				if ( $fail ) {
					exit( 1 );
				}
			}
		);
	}
} elseif ( 'ros' === $family || 'redraft' === $family ) {
	// Page 5835 on the live site, and the redraft board's page beside it. The
	// fragment carries the three islands the API ships: the FAQ, the board
	// lists (four on the All board, one on a position) and the page copy.
	$thumb = '+thumb' === substr( $which, -6 );
	$which = $thumb ? substr( $which, 0, -6 ) : $which;
	if ( 'ros' === $family ) {
		$post->ID           = 5835;
		$post->post_title   = 'Rest of Season Rankings';
		$post->post_content = '[statchasers_ros_rankings]';
		$base_canonical     = SC_PID_ROS_URL;
		$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'Fantasy Football', SC_PID_HOME . '/fantasy-football/' ), array( 'Rest of Season Rankings', $base_canonical ) );
		if ( 'hub' !== $which && 'xyz' !== $which ) {
			$GLOBALS['query']['sc_rank_pos'] = $which;
		}
	} else {
		$post->ID                        = 5834;
		$post->post_title                = 'Redraft Rankings';
		$post->post_content              = '[statchasers_rankings]';
		$base_canonical                  = SC_PID_HOME . '/fantasy-football/redraft-rankings/';
		$crumbs                          = array( array( 'Home', SC_PID_HOME ), array( 'Fantasy Football', SC_PID_HOME . '/fantasy-football/' ), array( 'Redraft Rankings', $base_canonical ) );
		$GLOBALS['query']['sc_rank_pos'] = 'rb';
	}
	$ros_on_pos = 'ros' === $family && in_array( $which, array( 'qb', 'rb', 'wr', 'te' ), true );
	$ros_lists  = array();
	foreach ( $ros_on_pos ? array( strtoupper( $which ) ) : array( 'QB', 'RB', 'WR', 'TE' ) as $p ) {
		$ros_lists[] = array(
			'@type'           => 'ItemList',
			'name'            => "2026 Rest of Season Fantasy Football $p Rankings",
			'itemListElement' => array( array( '@type' => 'ListItem', 'position' => 1, 'item' => array( '@type' => 'Person', 'name' => "$p One" ) ) ),
		);
	}
	$ros_board = $ros_on_pos ? strtoupper( $which ) . ' ' : '';
	$copy      = array(
		'title'       => "2026 Rest of Season Fantasy Football {$ros_board}Rankings",
		'h1'          => "2026 Rest of Season Fantasy Football {$ros_board}Rankings",
		'description' => "Rest-of-season {$ros_board}rankings.",
	);
	$faq = array();
	for ( $i = 1; $i <= 4; $i++ ) {
		$faq[] = array( 'q' => "Rankings question $i?", 'a' => "Answer $i." );
	}
	$GLOBALS['http_body'] = '<div class="scr" data-scr-root="1"><p>board</p>' .
		'<script type="application/json" class="scr-faq-data">' . json_encode( $faq ) . '</script>' .
		'<script type="application/json" class="scr-list-data">' . json_encode( $ros_lists ) . '</script>' .
		'<script type="application/json" class="scr-page-data">' . json_encode( $copy ) . '</script></div>';
	// The rewrite serves qb|rb|wr|te only, so WordPress finds no page at
	// /xyz/ and the request is a 404 (live 2026-11-25: 404, "follow, noindex").
	$GLOBALS['ros_404'] = 'ros' === $family && 'xyz' === $which;
	if ( $thumb ) {
		$featured = static function ( $images ) {
			$images->add_image( array( 'url' => 'https://example.com/wp-content/uploads/ros-card.png', 'width' => 1200, 'height' => 630, 'alt' => 'Rest of season rankings' ) );
		};
		$GLOBALS['hooks']['rank_math/opengraph/facebook/add_images'][] = $featured;
		$GLOBALS['hooks']['rank_math/opengraph/twitter/add_images'][]  = $featured;
	}
} elseif ( 'depth' === $family ) {
	// Page 2068 on the live site, under the /nfl/ hub page (1137). Rank Math
	// names the last crumb with the page title, as it does live.
	$thumb              = '+thumb' === substr( $which, -6 );
	$which              = $thumb ? substr( $which, 0, -6 ) : $which;
	$post->ID           = 2068;
	$post->post_name    = 'nfl-depth-charts';
	$post->post_title   = SC_PID_DEPTH_TITLE;
	$post->post_content = '[statchasers_depth_charts]';
	$base_canonical     = SC_PID_HOME . '/nfl/nfl-depth-charts/';
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( SC_PID_DEPTH_TITLE, $base_canonical ) );
	$GLOBALS['options'][ SCDC_Pages::OPT_DC_PAGE ] = 2068;
	if ( 'legacy' === $which ) {
		$GLOBALS['query'] = array( 'sc_view' => 'fantasy', 'sc_team' => 'houston-texans' );
	} elseif ( 'invalid' === $which ) {
		$GLOBALS['query'] = array( 'sc_view' => 'not-a-view' );
	} elseif ( 'nfl-hub' === $which ) {
		$post->ID           = 1137;
		$post->post_name    = 'nfl';
		$post->post_title   = 'NFL';
		$post->post_content = '[statchasers_nfl_hub]';
		$base_canonical     = SC_PID_HOME . '/nfl/';
		$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', $base_canonical ) );
	}
	if ( $thumb ) {
		$featured = static function ( $images ) {
			$images->add_image( array( 'url' => 'https://example.com/wp-content/uploads/depth.png', 'width' => 1200, 'height' => 630, 'alt' => 'Editor image' ) );
		};
		$GLOBALS['hooks']['rank_math/opengraph/facebook/add_images'][] = $featured;
		$GLOBALS['hooks']['rank_math/opengraph/twitter/add_images'][]  = $featured;
	}
} elseif ( 'fpa' === $family ) {
	// Page 2094 on the live site: the current table at the page's own
	// address, /2025/ (the rewrite's sc_fpa_season on the same page), and a
	// season the API has no table for (a 404). The fragment carries the FAQ
	// island the API ships (fpa-render.ts fpaFaq(): five questions on the
	// current page, three on the archive) and the page copy.
	$post->ID           = 2094;
	$post->post_name    = 'fantasy-points-allowed-by-position';
	$post->post_title   = 'Fantasy Points Allowed by Position';
	$post->post_content = '[statchasers_fpa]';
	$base_canonical     = get_permalink( 2094 );
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( 'Fantasy Points Allowed by Position', $base_canonical ) );
	$fpa_archive        = 'hub' !== $which;
	if ( $fpa_archive ) {
		$GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] = $which;
	}
	if ( '2001' === $which ) {
		// No table: the API answers 404 and the plugin has no backup.
		$GLOBALS['http_code'] = 404;
		$GLOBALS['http_body'] = '';
	} else {
		$copy = $fpa_archive
			? array(
				'title'       => "Fantasy Points Allowed by Position $which (Full Season)",
				'h1'          => "$which Fantasy Points Allowed by Position",
				'description' => "Fantasy points allowed over the full $which season.",
				'updatedLine' => "Full $which season, Weeks 1-17",
				'updatedIso'  => '',
				'season'      => (int) $which,
				'kind'        => 'archive',
				'weekNumber'  => 17,
			)
			: array(
				'title'          => 'Fantasy Points Allowed by Position 2026 (Weeks 1-11)',
				'h1'             => 'Fantasy Points Allowed by Position: Weeks 1-11, 2026',
				'description'    => 'Fantasy points allowed through Week 11 of 2026.',
				'updatedLine'    => 'Updated Nov 26, through Week 11',
				'updatedIso'     => '2026-11-26',
				'updatedAt'      => '2026-11-26T22:04:29.821Z',
				'season'         => 2026,
				'kind'           => 'live',
				'weekNumber'     => 11,
				'archiveSeasons' => array( 2025 ),
			);
		$faq = array();
		for ( $i = 1; $i <= ( $fpa_archive ? 3 : 5 ); $i++ ) {
			$faq[] = array( 'q' => ( $fpa_archive ? "$which question $i?" : "FPA question $i?" ), 'a' => "Answer $i." );
		}
		$GLOBALS['http_body'] = '<div class="scf is-embed" data-scf-root="1" data-season="' . ( $fpa_archive ? $which : '2026' ) . '"><p>table</p>' .
			'<details class="scf-faq-item"><summary><h3 class="scf-faq-q">' . $faq[0]['q'] . '</h3></summary></details></div>' .
			'<script type="application/json" class="scf-faq-data">' . json_encode( $faq ) . '</script>' .
			'<script type="application/json" class="scf-page-data">' . json_encode( $copy ) . '</script>';
		// A real /embed/fpa fragment instead of the fixture, for the
		// before/after report (docs/FPA-AUDIT-WEB-030-021-2026-11-27.md):
		// STATCHASERS_FPA_FRAGMENT=<file>; its page copy replaces $copy.
		$fpa_fragment = (string) getenv( 'STATCHASERS_FPA_FRAGMENT' );
		if ( '' !== $fpa_fragment && is_readable( $fpa_fragment ) ) {
			$GLOBALS['http_body'] = (string) file_get_contents( $fpa_fragment );
			$copy                 = statchasers_fpa_parse_copy( $GLOBALS['http_body'] );
		}
	}
} else {
	// An ordinary article carrying the tools' query words.
	$post->ID           = 92;
	$post->post_title   = 'Waiver Wire Week 5';
	$post->post_content = '<p>Pick up these players.</p>';
	$base_canonical     = SC_PID_HOME . '/waiver-wire-week-5/';
	$crumbs             = array( array( 'Home', SC_PID_HOME ), array( 'Waiver Wire Week 5', $base_canonical ) );
	$GLOBALS['query']   = array( 'sc_sched_week' => '12', 'sc_sos_page' => 'rb', 'sc_stats_pos' => 'wr', 'sc_rank_pos' => 'rb', 'sc_fpa_season' => '2025' );
	$_GET               = array( 'tab' => 'player', 'scoring' => 'std' );
}

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $post,
);
if ( ! empty( $GLOBALS['ros_404'] ) ) {
	$GLOBALS['page']['is404']    = true;
	$GLOBALS['page']['singular'] = false;
}
$GLOBALS['wp_query'] = new class() {
	public function set_404() {
		$GLOBALS['page']['is404']    = true;
		$GLOBALS['page']['singular'] = false;
	}
};
// SCDC_Route turns junk under the tool's path into a 404 on `wp`
// (send_404(), which needs a real WP_Query); the same outcome here.
if ( 'depth' === $family && 'invalid' === $which && 'invalid' === SCDC_Route::type() ) {
	$GLOBALS['wp_query']->set_404();
}
// The same for an FPA season with no table: statchasers_fpa_season_404() on
// `wp` at 0 sets the 404 on the real WP_Query, which this stand-in is not.
if ( 'fpa' === $family && statchasers_fpa_season_not_found() ) {
	$GLOBALS['wp_query']->set_404();
}
foreach ( $GLOBALS['hooks']['template_redirect'] ?? array() as $fn ) {
	try {
		$fn();
	} catch ( \Throwable $e ) {
		continue;
	}
}

$label = $route;

if ( 'team' === $family && isset( $GLOBALS['page_post_for_title'] ) ) {
	$crumbs[] = array( apply_filters( 'the_title', $post->post_title, $post->ID ), $base_canonical );
}
if ( 'stats' === $family && 'qb' === $which ) {
	$GLOBALS['sc_pid_head_reached'] = true;
	is( 'rendered', 'a 301', "$label: /qb/ reached the head instead of redirecting" );
	return;
}

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
	is( statchasers_page_identity_family(), '', "$label: not a schedule, SOS, stats or depth charts route" );
	is( SCDC_Route::type(), 'none', "$label: not the depth charts page" );
	is( statchasers_player_stats_canonical(), '', "$label: sc_stats_pos does not opt it in" );
	is( statchasers_rankings_request_pos(), '', "$label: nor does sc_rank_pos" );
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
	// No week canonical; since WEB-013 an invalid week is a 404 in the head
	// too, so Rank Math's 404 paper prints no canonical at all (merge on
	// main, 2026-11-24; WEB-021 alone still saw the hub's).
	is( $canonical, false, "$label: no week canonical (a 404 prints none, WEB-013)" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	return;
}

/* --- the depth charts hub --- */

if ( 'depth' === $family && in_array( $which, array( 'legacy', 'invalid', 'nfl-hub' ), true ) ) {
	$want_type = array( 'legacy' => 'legacy', 'invalid' => 'invalid', 'nfl-hub' => 'none' )[ $which ];
	is( SCDC_Route::type(), $want_type, "$label: the depth charts route is '$want_type'" );
	is( statchasers_page_identity_family(), '', "$label: not the depth charts hub" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: Rank Math's answer passes through" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image added" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	if ( 'invalid' !== $which ) {
		// A 404 is not singular, so Rank Math adds its own entities there.
		is( isset( $graph['WebPage'] ) || isset( $graph['publisher'] ), false, "$label: no page entity or publisher added" );
	}
	return;
}

if ( 'depth' === $family ) {
	$want_image = $thumb ? 'https://example.com/wp-content/uploads/depth.png' : STATCHASERS_PAGE_IDENTITY_DEPTH_IMAGE['url'];

	is( SCDC_Route::type(), 'main', "$label: the depth charts route is 'main'" );
	is( statchasers_page_identity_family(), 'depth', "$label: the depth charts hub" );
	is( $canonical, $base_canonical, "$label: canonical $base_canonical (untouched)" );
	is( $og_url, $base_canonical, "$label: og:url matches the canonical" );
	is( $title, SC_PID_DEPTH_TITLE, "$label: title untouched" );
	is( (string) apply_filters( 'rank_math/frontend/description', 'stored' ), 'stored', "$label: description untouched" );

	is( count( $fb ), 1, "$label: one og:image" );
	is( count( $tw ), 1, "$label: one twitter:image" );
	is( $fb[0]['url'] ?? '', $want_image, $thumb ? "$label: the editor's image wins, no second og:image" : "$label: og:image is the depth charts card" );
	is( ( $tw[0]['url'] ?? '' ) === ( $fb[0]['url'] ?? null ), true, "$label: twitter:image is the same picture" );
	is( 0 === strpos( (string) ( $fb[0]['url'] ?? '' ), 'https://' ), true, "$label: an absolute https URL" );
	if ( ! $thumb ) {
		is( array( $fb[0]['width'] ?? 0, $fb[0]['height'] ?? 0, $fb[0]['type'] ?? '' ), array( 1200, 630, 'image/png' ), "$label: 1200 x 630 image/png" );
		is( '' !== ( $fb[0]['alt'] ?? '' ), true, "$label: with alt text" );
		// The URL names a file the plugin ships, and the file is what it says.
		$prefix = 'https://statchasers.com/wp-content/plugins/statchasers-news/';
		$rel    = substr( STATCHASERS_PAGE_IDENTITY_DEPTH_IMAGE['url'], strlen( $prefix ) );
		$file   = __DIR__ . '/../statchasers-news/' . $rel;
		$size   = is_file( $file ) ? getimagesize( $file ) : false;
		is( 0 === strpos( STATCHASERS_PAGE_IDENTITY_DEPTH_IMAGE['url'], $prefix ), true, "$label: the card is served from the plugin directory" );
		is( is_array( $size ) ? array( $size[0], $size[1], $size['mime'] ) : null, array( 1200, 630, 'image/png' ), "$label: statchasers-news/$rel is a 1200 x 630 PNG" );
	}

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
	is( (array) ( $page['@type'] ?? null ), array( 'WebPage' ), "$label: a WebPage (the hub prints no FAQ schema)" );
	is( $page['@id'] ?? '', $base_canonical . '#webpage', "$label: page @id is the canonical's" );
	is( $page['url'] ?? '', $base_canonical, "$label: page url is the canonical" );
	is( $page['name'] ?? '', SC_PID_DEPTH_TITLE, "$label: page name is the title" );
	is( $page['isPartOf']['@id'] ?? '', SC_PID_HOME . '/#website', "$label: isPartOf the WebSite" );
	is( $page['breadcrumb']['@id'] ?? '', $base_canonical . '#breadcrumb', "$label: breadcrumb connected" );
	is( $bcs[0]['@id'] ?? '', $base_canonical . '#breadcrumb', "$label: breadcrumb @id is the canonical's" );
	is(
		array_map(
			static function ( $li ) {
				return array( $li['item']['name'], $li['item']['@id'] );
			},
			$bcs[0]['itemListElement'] ?? array()
		),
		array( array( 'Home', SC_PID_HOME ), array( 'NFL', SC_PID_HOME . '/nfl/' ), array( SC_PID_DEPTH_TITLE, $base_canonical ) ),
		"$label: the trail is Rank Math's own, untouched"
	);
	// With a featured image Rank Math builds primaryImage from it itself (not
	// modeled here), and the plugin leaves that one alone, as on a team crest.
	if ( ! $thumb ) {
		is( $page['primaryImageOfPage']['@id'] ?? '', $want_image, "$label: primaryImageOfPage is the share image" );
		is( $by_id[ $want_image ][0]['@type'] ?? '', 'ImageObject', "$label: and that ImageObject is in the graph" );
		is( array( $by_id[ $want_image ][0]['width'] ?? 0, $by_id[ $want_image ][0]['height'] ?? 0 ), array( 1200, 630 ), "$label: at 1200 x 630" );
	}

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
	if ( getenv( 'STATCHASERS_PAGEID_DUMP' ) ) {
		echo "DUMP title={$title}\nDUMP canonical={$canonical}\nDUMP og:url={$og_url}\n";
		echo 'DUMP og:image=' . ( $fb[0]['url'] ?? '-' ) . ' ' . ( $fb[0]['width'] ?? '' ) . 'x' . ( $fb[0]['height'] ?? '' ) . ' ' . ( $fb[0]['type'] ?? '' ) . ' alt="' . ( $fb[0]['alt'] ?? '' ) . "\"\n";
		echo 'DUMP twitter:image=' . ( $tw[0]['url'] ?? '-' ) . "\n";
		echo 'DUMP json-ld=' . json_encode( $json, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n";
	}
	return;
}

/* --- the team family --- */

if ( 'team' === $family && 'not-a-team' === $which ) {
	is( statchasers_page_identity_family(), '', "$label: a [statchasers_team] page at no team's slug is not a team route" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: Rank Math's answer passes through" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image added" );
	return;
}

if ( 'team' === $family ) {
	$is_index       = 'index' === $team_slug;
	$want_canonical = $is_index ? $team_hubs_url : ( '' === $team_tab ? $base_canonical : $base_canonical . $team_tab . '/' );
	$want_meta      = $is_index ? null : statchasers_team_section_meta( $team_slug, $team_tab );
	$want_title     = $is_index || '' === $team_tab ? $post->post_title : $want_meta['title'];
	$team_card      = 'https://news.example.com/og/team/' . $team_slug . '.png?v=' . STATCHASERS_TEAM_SHARE_VERSION;
	$want_image     = $thumb ? 'https://example.com/wp-content/uploads/BUF.png' : ( $is_index ? STATCHASERS_PAGE_IDENTITY_IMAGE['url'] : $team_card );

	is( statchasers_page_identity_family(), 'team', "$label: a team route" );
	is( $canonical, $want_canonical, "$label: canonical $want_canonical" );
	is( $og_url, $want_canonical, "$label: og:url matches the canonical" );
	is( $title, $want_title, "$label: title untouched by this file" );
	if ( null !== $want_meta ) {
		$desc = (string) apply_filters( 'rank_math/frontend/description', 'stored' );
		is( strlen( $desc ) <= 160, true, "$label: description fits 160 (" . strlen( $desc ) . ')' );
		is( '' === $team_tab ? 'stored' : $want_meta['description'], $desc, "$label: description is the tab's own (the hub keeps its stored one)" );
	}

	is( count( $fb ), 1, "$label: one og:image" );
	is( count( $tw ), 1, "$label: one twitter:image" );
	is( $fb[0]['url'] ?? '', $want_image, $thumb ? "$label: the page's own image is kept" : ( $is_index ? "$label: og:image is the brand card" : "$label: og:image is the team's own card" ) );
	if ( ! $thumb && ! $is_index ) {
		is( $fb[0]['width'] ?? 0, 1200, "$label: the card is 1200 wide" );
		is( false !== strpos( (string) ( $fb[0]['alt'] ?? '' ), statchasers_team_table()[ $team_slug ][0] ), true, "$label: its alt names the team" );
	}
	is( ( $tw[0]['url'] ?? '' ) === ( $fb[0]['url'] ?? null ), true, "$label: twitter:image is the same picture" );

	$orgs = $typed( 'Organization' );
	$site = $typed( 'WebSite' );
	$bcs  = $typed( 'BreadcrumbList' );
	is( count( $orgs ), 1, "$label: one Organization" );
	is( count( $site ), 1, "$label: one WebSite" );
	is( $site[0]['publisher']['@id'] ?? '', SC_PID_HOME . '/#organization', "$label: WebSite published by the Organization" );
	is( count( $bcs ), 1, "$label: one BreadcrumbList" );
	is( count( $pages ), 1, "$label: one page entity (no id-less FAQPage beside it)" );
	$page = $pages[0] ?? array();
	is( $page['@id'] ?? '', $want_canonical . '#webpage', "$label: page @id is the route's own" );
	is( $page['url'] ?? '', $want_canonical, "$label: page url is the canonical" );
	is( $page['isPartOf']['@id'] ?? '', SC_PID_HOME . '/#website', "$label: isPartOf the WebSite" );
	is( $page['breadcrumb']['@id'] ?? '', $bcs[0]['@id'] ?? 'none', "$label: breadcrumb connected" );
	$trail = $bcs[0]['itemListElement'] ?? array();
	$last  = end( $trail );
	is( $last['item']['@id'] ?? '', $want_canonical, "$label: the trail ends at the route" );
	if ( ! $is_index ) {
		is( $trail[3]['item']['@id'] ?? '', $base_canonical, "$label: the fourth crumb is the hub" );
		is( $trail[3]['item']['name'] ?? '', statchasers_team_table()[ $team_slug ][0], "$label: named for the team, not the tab's H1" );
		is( count( $trail ), '' === $team_tab ? 4 : 5, "$label: Home, NFL, NFL Team Hubs, the team" . ( '' === $team_tab ? '' : ', the tab' ) );
		is( (array) ( $page['@type'] ?? null ), array( 'FAQPage' ), "$label: the FAQ is the page entity" );
		is( count( $page['mainEntity'] ?? array() ), $GLOBALS['team_faq'], "$label: with every question" );
		is( count( $typed( 'ItemList' ) ), 'schedule' === $team_tab ? 1 : 0, "$label: the games ItemList only on the Schedule tab" );
	} else {
		is( count( $trail ), 3, "$label: the directory's trail is untouched" );
		is( (array) ( $page['@type'] ?? null ), array( 'WebPage' ), "$label: a WebPage" );
	}
	$want_primary = $thumb ? null : ( $is_index ? STATCHASERS_PAGE_IDENTITY_IMAGE['url'] : $team_card );
	if ( $avif ) {
		is( isset( $by_id[ $GLOBALS['featured_avif'] ] ), false, "$label: the AVIF crest is no longer the page's image" );
	}
	if ( null !== $want_primary ) {
		is( $page['primaryImageOfPage']['@id'] ?? '', $want_primary, "$label: primaryImageOfPage is the share image" );
	}

	$ok_ids = true;
	foreach ( $nodes as $node ) {
		if ( empty( $node['@id'] ) && 'ItemList' !== ( $node['@type'] ?? '' ) ) {
			$ok_ids = false;
		}
	}
	is( $ok_ids, true, "$label: every entity node has an @id" );
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
	if ( getenv( 'STATCHASERS_PAGEID_DUMP' ) ) {
		echo "DUMP title={$title}\nDUMP canonical={$canonical}\n";
		echo 'DUMP og:image=' . ( $fb[0]['url'] ?? '-' ) . "\n";
		echo 'DUMP json-ld=' . json_encode( $json, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n";
	}
	return;
}

/* --- the rest-of-season rankings: what is not a route --- */

// The fallback printer for a site with no schema-graph plugin: what it prints
// on this request, as decoded nodes. With Rank Math present it must print
// nothing at all, or the page carries a second FAQPage beside the merged one.
$ros_fallback = static function ( bool $provider ): array {
	$GLOBALS['hooks']['statchasers_news_graph_provider_present'] = array(
		static function () use ( $provider ) {
			return $provider;
		},
	);
	ob_start();
	statchasers_rankings_print_fallback_schema();
	$out = (string) ob_get_clean();
	unset( $GLOBALS['hooks']['statchasers_news_graph_provider_present'] );
	preg_match_all( '#<script type="application/ld\+json">(.*?)</script>#s', $out, $m );
	return array_map(
		static function ( $j ) {
			return json_decode( $j, true );
		},
		$m[1]
	);
};

if ( 'redraft' === $family ) {
	is( statchasers_rankings_page_board(), 'redraft', "$label: the redraft board's page" );
	is( statchasers_page_identity_family(), '', "$label: not a rest-of-season route" );
	is( statchasers_rankings_request_pos(), '', "$label: sc_rank_pos means nothing here" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: Rank Math's answer passes through" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image added" );
	is( $canonical, $base_canonical, "$label: canonical untouched" );
	is( count( $graph['BreadcrumbList']['itemListElement'] ), 3, "$label: breadcrumb untouched" );
	is( count( $typed( 'Organization' ) ) + count( $typed( 'WebSite' ) ), 0, "$label: no Organization or WebSite opted in" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	// WEB-029: the page shows the StatChasers Tools preseason board, so the
	// API redraft file's FAQ and lists (another date, other players) are not it.
	is( count( $typed( 'ItemList' ) ), 0, "$label: no board lists from the API's redraft file" );
	is( count( $typed( 'FAQPage' ) ), 0, "$label: no FAQ the page does not show" );
	is( $ros_fallback( false ), array(), "$label: the fallback printer prints nothing either" );
	return;
}

if ( 'ros' === $family && 'xyz' === $which ) {
	is( (bool) ( $GLOBALS['page']['is404'] ?? false ), true, "$label: still a 404" );
	is( statchasers_page_identity_family(), '', "$label: not a valid route" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: the plugin does not opt it in" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	is( count( $graph['BreadcrumbList']['itemListElement'] ), 3, "$label: no position crumb" );
	is( count( $typed( 'ItemList' ) ), 0, "$label: no board lists" );
	is( count( $typed( 'FAQPage' ) ), 0, "$label: no FAQ" );
	is( $canonical, $base_canonical, "$label: no position canonical" );
	is( $ros_fallback( false ), array(), "$label: the fallback printer prints nothing either" );
	return;
}

if ( 'fpa' === $family && '2001' === $which ) {
	is( (bool) ( $GLOBALS['page']['is404'] ?? false ), true, "$label: a season with no table is a 404" );
	is( statchasers_page_identity_family(), '', "$label: not a valid route" );
	is( apply_filters( 'rank_math/schema/add_global_entities', false ), false, "$label: the plugin does not opt it in" );
	is( count( $fb ) + count( $tw ), 0, "$label: no share image" );
	is( isset( $graph['primaryImage'] ), false, "$label: no primaryImageOfPage" );
	is( count( $graph['BreadcrumbList']['itemListElement'] ), 3, "$label: no season crumb" );
	is( count( $typed( 'FAQPage' ) ), 0, "$label: no FAQ" );
	is( $canonical, false, "$label: no canonical (WEB-013)" );
	return;
}

if ( 'ros' === $family && $thumb ) {
	is( statchasers_page_identity_family(), 'ros', "$label: a rest-of-season route" );
	is( count( $fb ), 1, "$label: one og:image" );
	is( count( $tw ), 1, "$label: one twitter:image" );
	is( $fb[0]['url'] ?? '', 'https://example.com/wp-content/uploads/ros-card.png', "$label: the image an editor set wins" );
	is( $tw[0]['url'] ?? '', 'https://example.com/wp-content/uploads/ros-card.png', "$label: on both networks" );
	return;
}

/* --- a valid route --- */

if ( 'sched' === $family ) {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/nfl-schedule/week-$which/";
	$want_title     = 'hub' === $which ? '2026 NFL Schedule | StatChasers' : "NFL Week $which Schedule 2026 | StatChasers";
	$want_faq       = $faq_count;
} elseif ( 'sos' === $family ) {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/fantasy-football-strength-of-schedule/$which/";
	$want_title     = $copy['title'];
	$want_faq       = 0;
} elseif ( 'ros' === $family ) {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_ROS_URL . "$which/";
	$want_title     = $copy['title'] . ' | StatChasers';
	$want_faq       = 4;
	is( statchasers_page_identity_family(), 'ros', "$label: a rest-of-season route" );
} elseif ( 'fpa' === $family ) {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/fantasy-points-allowed-by-position/$which/";
	$want_title     = $copy['title'];
	$want_faq       = 'hub' === $which ? 5 : 3;
	is( statchasers_page_identity_family(), 'fpa', "$label: a fantasy points allowed route" );
} else {
	$want_canonical = 'hub' === $which ? $base_canonical : SC_PID_HOME . "/nfl/nfl-player-stats/$which/";
	$want_title     = $copy['title'] . ' | StatChasers';
	$want_faq       = 3;
	is( statchasers_page_identity_family(), 'stats', "$label: a player stats route" );
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
is( count( $bcs[0]['itemListElement'] ), 'hub' === $which ? 3 : 4, "$label: the trail keeps Home, its section and the page" );
if ( 'stats' === $family && 'hub' !== $which ) {
	$want_crumb = 'NFL ' . SC_PID_STATS_NAMES[ $which ] . ' Stats';
	is( $last['item']['name'] ?? '', $want_crumb, "$label: the last crumb is \"$want_crumb\"" );
	is( $bcs[0]['itemListElement'][2]['item']['@id'] ?? '', $base_canonical, "$label: after the bare page" );
}
if ( 'ros' === $family && 'hub' !== $which ) {
	is( $last['item']['name'] ?? '', $copy['h1'], "$label: the last crumb is the board's H1" );
	is( $bcs[0]['itemListElement'][2]['item']['@id'] ?? '', $base_canonical, "$label: after the rankings page" );
}
if ( 'fpa' === $family ) {
	if ( 'hub' !== $which ) {
		is( $last['item']['name'] ?? '', $copy['h1'], "$label: the last crumb is the archive's H1" );
		is( $bcs[0]['itemListElement'][2]['item']['@id'] ?? '', $base_canonical, "$label: after the FPA page" );
		is( isset( $page['dateModified'] ), false, "$label: a finished season carries no dateModified" );
	} else {
		is( $page['dateModified'] ?? '', '2026-11-26', "$label: dateModified is the data's, on Rank Math's WebPage" );
	}
	is( count( $typed( 'FAQPage' ) ), 1, "$label: one FAQ entity" );
	is( count( $typed( 'WebPage' ) ), 0, "$label: and no second WebPage beside it (statchasers-fpa.php's own page node stays out)" );
	$fpa_qs = array_map(
		static function ( $q ) {
			return $q['name'] ?? '';
		},
		$page['mainEntity'] ?? array()
	);
	$fpa_real = '' !== (string) getenv( 'STATCHASERS_FPA_FRAGMENT' );
	if ( ! $fpa_real ) {
		is( $fpa_qs[0] ?? '', 'hub' === $which ? 'FPA question 1?' : "$which question 1?", "$label: the questions are this season's own" );
	}
	// STATCHASERS_FPA_RENDER_OUT=<file>: the printed table plus the graph, as
	// the WordPress page would carry them, for scripts/fpa-faq-schema-check.mjs.
	$fpa_out = (string) getenv( 'STATCHASERS_FPA_RENDER_OUT' );
	if ( '' !== $fpa_out ) {
		file_put_contents(
			$fpa_out,
			'<!doctype html><html><head><link rel="canonical" href="' . $canonical . '"><meta property="og:url" content="' . $og_url . '">' .
				'<meta property="og:image" content="' . ( $fb[0]['url'] ?? '' ) . '"><meta name="twitter:image" content="' . ( $tw[0]['url'] ?? '' ) . '">' .
				'<script type="application/ld+json" class="rank-math-schema">' . wp_json_encode( $json ) . '</script></head><body>' .
				statchasers_fpa_shortcode( array() ) . '</body></html>'
		);
	}
	// The fallback printer: nothing beside Rank Math, only the FAQPage without it.
	$GLOBALS['hooks']['statchasers_news_graph_provider_present'] = array( static function () { return true; } );
	ob_start();
	statchasers_fpa_print_fallback_schema();
	is( (string) ob_get_clean(), '', "$label: the fallback printer prints nothing with Rank Math present" );
	unset( $GLOBALS['hooks']['statchasers_news_graph_provider_present'] );
}
is( $page['primaryImageOfPage']['@id'] ?? '', STATCHASERS_PAGE_IDENTITY_IMAGE['url'], "$label: primaryImageOfPage is the share image" );
is( isset( $by_id[ STATCHASERS_PAGE_IDENTITY_IMAGE['url'] ] ), true, "$label: and that ImageObject is in the graph" );

// The FAQ is the page entity itself, not a second page.
if ( $want_faq > 0 ) {
	is( (array) ( $page['@type'] ?? null ), array( 'FAQPage' ), "$label: the page entity is the FAQPage" );
	is( count( $page['mainEntity'] ?? array() ), $want_faq, "$label: with all $want_faq questions" );
} else {
	is( (array) ( $page['@type'] ?? null ), array( 'WebPage' ), "$label: a WebPage (no FAQ schema on SOS)" );
}

// The board lists hang off the page entity, as the team Schedule tab's game
// list does; and the fallback printer stays out of a Rank Math page.
if ( 'ros' === $family ) {
	$lists = $typed( 'ItemList' );
	is( count( $lists ), 'hub' === $which ? 4 : 1, "$label: " . ( 'hub' === $which ? 'four board lists' : 'the one board list' ) );
	$hung = array_filter(
		$lists,
		static function ( $l ) use ( $want_id ) {
			return ( $l['isPartOf']['@id'] ?? '' ) === $want_id;
		}
	);
	is( count( $hung ), count( $lists ), "$label: every list isPartOf the page" );
	is( count( $typed( 'FAQPage' ) ), 1, "$label: one FAQ entity" );
	is( count( $typed( 'WebPage' ) ), 0, "$label: and no second WebPage beside it" );
	is( $ros_fallback( true ), array(), "$label: the fallback printer prints nothing with Rank Math present" );
	$types = array_map(
		static function ( $n ) {
			return implode( ',', (array) ( $n['@type'] ?? '' ) );
		},
		$ros_fallback( false )
	);
	is( $types, array_merge( array( 'FAQPage' ), array_fill( 0, count( $lists ), 'ItemList' ) ), "$label: without one, only the FAQPage and the lists (no WebPage, Organization or WebSite)" );
}

// Every node has an @id, no @id is used twice, every reference resolves. The
// board lists are the exception the team Schedule tab's is: no @id of their
// own, tied to the page by isPartOf.
$ok_ids = true;
foreach ( $nodes as $node ) {
	if ( empty( $node['@id'] ) && ! ( 'ros' === $family && 'ItemList' === ( $node['@type'] ?? '' ) ) ) {
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
