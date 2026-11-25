<?php
/**
 * WEB-028 and WEB-006: the legacy rankings addresses and the /fantasy-football/
 * breadcrumb parent (statchasers-legacy-routes.php).
 *
 * Live on 2026-11-24: /fantasy-football-rankings/ 301ed to Redraft Command's
 * projections (a host .htaccess rule), /nfl/rest-of-season-rankings/ to the WR
 * board (Rank Math redirection #11), and /fantasy-football/ answered 403 while
 * the rest-of-season BreadcrumbList linked through it and the sitemap listed
 * it. The plugin's part: the plugin-side 301s (exact, 404-only except the
 * parent page itself), the crumb pointed at the hub, the sitemap entry gone.
 *
 * smoke.php includes this; running it directly does nothing.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_legacy_route_target' ) ) {
	fwrite( STDERR, "smoke-legacy-routes.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "legacy rankings addresses and the /fantasy-football/ parent (WEB-028, WEB-006)\n";

$sc_lr_hub   = 'https://example.com/fantasy-football/rest-of-season-rankings/';
$sc_lr_tools = 'https://example.com/nfl/fantasy-football-tools/';

// Both rankings addresses, both slash forms, as 404s: the overall hub.
$GLOBALS['page'] = array( 'is404' => true );
foreach ( array( '/fantasy-football-rankings/', '/fantasy-football-rankings', '/nfl/rest-of-season-rankings/', '/nfl/rest-of-season-rankings', '/NFL/Rest-Of-Season-Rankings/' ) as $sc_lr_path ) {
	is( statchasers_legacy_route_target( $sc_lr_path ), $sc_lr_hub, "$sc_lr_path (404) 301s to the overall rest-of-season hub, not a position board" );
}
// Exact paths only: a position under an old address, or a longer slug, is not ours.
foreach ( array( '/fantasy-football-rankings/rb/', '/nfl/rest-of-season-rankings/wr/', '/fantasy-football-rankings-2025/', '/nfl/', '/' ) as $sc_lr_path ) {
	is( statchasers_legacy_route_target( $sc_lr_path ), '', "$sc_lr_path is left to WordPress" );
}

// A page somebody builds at a legacy address later is not shadowed.
$sc_lr_page            = new WP_Post();
$sc_lr_page->ID        = 9001;
$sc_lr_page->post_name = 'fantasy-football-rankings';
$GLOBALS['page']       = array( 'post' => $sc_lr_page );
is( statchasers_legacy_route_target( '/fantasy-football-rankings/' ), '', 'a real page at a legacy rankings address keeps it' );

// The breadcrumb parent: page 5831, a top-level page with that slug.
$sc_lr_parent            = new WP_Post();
$sc_lr_parent->ID        = 5831;
$sc_lr_parent->post_name = 'fantasy-football';
$GLOBALS['page']         = array( 'post' => $sc_lr_parent );
is( statchasers_legacy_route_target( '/fantasy-football/' ), $sc_lr_tools, '/fantasy-football/ (page 5831) 301s to the fantasy football tools hub' );
is( statchasers_legacy_route_target( '/fantasy-football' ), $sc_lr_tools, 'and so does the slashless form, in one hop' );
// Its children are not touched.
foreach ( array( '/fantasy-football/rest-of-season-rankings/', '/fantasy-football/rest-of-season-rankings/rb/', '/fantasy-football/rest-of-season-rankings/xyz/' ) as $sc_lr_path ) {
	is( statchasers_legacy_route_target( $sc_lr_path ), '', "$sc_lr_path is not redirected" );
}
// Another page answering at that path (a query var, a nested page) is not the parent.
$sc_lr_nested              = new WP_Post();
$sc_lr_nested->ID          = 77;
$sc_lr_nested->post_name   = 'fantasy-football';
$sc_lr_nested->post_parent = 12;
$GLOBALS['page']           = array( 'post' => $sc_lr_nested );
is( statchasers_legacy_route_target( '/fantasy-football/' ), '', 'a nested fantasy-football page is not the parent' );
$sc_lr_article            = new WP_Post();
$sc_lr_article->ID        = 5;
$sc_lr_article->post_name = 'some-article';
$sc_lr_article->post_type = 'post';
$GLOBALS['page']          = array( 'post' => $sc_lr_article );
is( statchasers_legacy_route_target( '/fantasy-football/' ), '', 'a post resolved at that path is not the parent' );
unset( $GLOBALS['page'] );

// Registered ahead of core's redirect_canonical (10).
$sc_lr_prio = null;
foreach ( $GLOBALS['hooks']['template_redirect'] ?? array() as $sc_lr_i => $sc_lr_fn ) {
	$sc_lr_ref = new ReflectionFunction( Closure::fromCallable( $sc_lr_fn ) );
	if ( false !== strpos( (string) $sc_lr_ref->getFileName(), 'statchasers-legacy-routes.php' ) ) {
		$sc_lr_prio = $GLOBALS['hook_priority']['template_redirect'][ $sc_lr_i ];
	}
}
is( $sc_lr_prio, 1, 'the legacy redirect runs at template_redirect priority 1' );

// The rest-of-season trail, as Rank Math builds it from the page tree, and with
// a position crumb appended later by another file.
$sc_lr_crumbs = array(
	array( 'Home', 'https://example.com' ),
	array( 'Fantasy Football', 'https://example.com/fantasy-football/', 'hide_in_schema' => false ),
	array( 'Rest of Season Rankings', $sc_lr_hub ),
	array( 'Running Back Rankings', $sc_lr_hub . 'rb/' ),
);
$sc_lr_out = apply_filters( 'rank_math/frontend/breadcrumb/items', $sc_lr_crumbs );
is( $sc_lr_out[1][0] ?? null, 'Fantasy Football Tools', 'the parent crumb is named as the hub names itself' );
is( $sc_lr_out[1][1] ?? null, $sc_lr_tools, 'and links straight to the hub, not through a redirect' );
is( $sc_lr_out[1]['hide_in_schema'] ?? null, false, 'and keeps its other keys' );
is( $sc_lr_out[2], $sc_lr_crumbs[2], 'the rest-of-season crumb is untouched' );
is( count( $sc_lr_out ) >= 4 && $sc_lr_crumbs[3] === $sc_lr_out[ count( $sc_lr_out ) - 1 ], true, 'a later crumb is untouched' );
$sc_lr_none = array( array( 'Home', 'https://example.com' ), array( 'Fantasy Football Articles', 'https://example.com/fantasy-football-articles/' ) );
is( statchasers_fantasy_parent_breadcrumbs( $sc_lr_none ), $sc_lr_none, 'a trail without the parent is left as it is' );

// The sitemap.
is( statchasers_sitemap_drop_fantasy_parent( array( 'loc' => 'https://example.com/fantasy-football/' ) ), false, '/fantasy-football/ leaves the sitemap' );
foreach ( array( $sc_lr_hub, $sc_lr_hub . 'rb/', $sc_lr_tools, 'https://example.com/fantasy-football-articles/' ) as $sc_lr_loc ) {
	is( statchasers_sitemap_drop_fantasy_parent( array( 'loc' => $sc_lr_loc ) ), array( 'loc' => $sc_lr_loc ), "$sc_lr_loc stays in the sitemap" );
}
