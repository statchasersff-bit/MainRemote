<?php
/**
 * Legacy addresses that answer with a 301, and the /fantasy-football/
 * breadcrumb parent (WEB-028, WEB-006; 2026-11-25).
 *
 * ## The two rankings addresses (WEB-028)
 *
 * The November 24 audit found two old rankings addresses sending visitors who
 * wanted the overall rest-of-season rankings somewhere else:
 *
 * - /fantasy-football-rankings/ went to Redraft Command's projections. That
 *   301 is not WordPress's: it comes back with Apache's "Moved Permanently"
 *   body and no X-Redirect-By, so a rule in the host's .htaccess (or the
 *   Rocket.net layer in front of it) answers before WordPress loads. Only the
 *   bare path is caught there; /fantasy-football-rankings/rb/ reaches
 *   WordPress and its 404 guesser.
 * - /nfl/rest-of-season-rankings/ went to the WR board. That one is Rank
 *   Math's redirection #11 (X-Redirect-By: Rank Math), created 2026-09-28.
 *
 * Both are fixed where they are answered (the host rule and Rank Math #11 are
 * edited to the hub; see docs/WEB-028-029-021-006-ROS-2026-11-25.md). This file
 * is the same answer from the plugin, for the moment either of those rules is
 * deleted rather than edited: without it WordPress would 404 the address, or
 * worse, its redirect_canonical() guesser would send it to whatever post slug
 * starts with the same words. It only answers when WordPress found nothing
 * there (is_404), so it can never shadow a page someone builds at one of
 * these addresses later, and it runs at priority 1 on template_redirect,
 * ahead of that guesser (10).
 *
 * ## The breadcrumb parent (WEB-006)
 *
 * The rest-of-season pages sit under page 5831, /fantasy-football/, so Rank
 * Math's trail runs Home > Fantasy Football > Rest of Season Rankings. Page
 * 5831 is an empty Divi placeholder, created four minutes before the rankings
 * page to give it that address, never a hub; and /fantasy-football/ answers
 * 403 publicly, because the web root has a physical fantasy-football
 * directory: Apache's DirectorySlash 301s the slashless form to it, finds no
 * index file, forbids the listing, and hands the 403 to WordPress as an error
 * document (so the 403 carries the empty page's markup). The children work
 * because WordPress's rewrite only skips paths that exist on disk.
 *
 * The site's fantasy football hub already exists: /nfl/fantasy-football-tools/
 * ("Fantasy Football Tools"), in the main menu and the sitemap. So:
 *
 * - /fantasy-football/ is an exact-path 301 to that hub (here, for when the
 *   request reaches WordPress; the directory has to go, or get an exact-path
 *   rule ahead of it in .htaccess, for that to happen - a host action).
 * - The crumb that pointed at /fantasy-football/ points at the hub, named as
 *   the hub's H1 names it, so no breadcrumb links through a redirect.
 * - /fantasy-football/ leaves the sitemap: a redirecting URL is not a
 *   canonical one.
 *
 * Child paths are untouched: the match is exact, so
 * /fantasy-football/rest-of-season-rankings/ and its positions still resolve
 * to page 5835 as before.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The fantasy football hub the /fantasy-football/ parent stands in for. */
const STATCHASERS_FANTASY_HUB = array(
	'path' => '/nfl/fantasy-football-tools/',
	'name' => 'Fantasy Football Tools',
);

/** The breadcrumb parent page's own path, the one that 403s. */
const STATCHASERS_FANTASY_PARENT_PATH = 'fantasy-football';

/**
 * Legacy path (no leading or trailing slash) => where it goes.
 *
 * `parent` is the one source that is a real page; the rest are 404s to
 * WordPress. Filterable, so an address can be retired or added without a code
 * change:
 *
 *     add_filter( 'statchasers_legacy_routes', fn( $r ) => array_diff_key( $r, array( 'fantasy-football' => 1 ) ) );
 *
 * @return array<string,string> Path => absolute destination URL.
 */
function statchasers_legacy_routes(): array {
	$ros = function_exists( 'statchasers_rankings_position_url' )
		? statchasers_rankings_position_url( 'all' )
		: user_trailingslashit( home_url( '/fantasy-football/rest-of-season-rankings' ) );

	$routes = array(
		// WEB-028: both mean the overall rest-of-season rankings.
		'fantasy-football-rankings'   => $ros,
		'nfl/rest-of-season-rankings' => $ros,
		// WEB-006: the empty breadcrumb parent.
		STATCHASERS_FANTASY_PARENT_PATH => home_url( STATCHASERS_FANTASY_HUB['path'] ),
	);

	$routes = apply_filters( 'statchasers_legacy_routes', $routes );
	return is_array( $routes ) ? $routes : array();
}

/**
 * Where this request should 301 to, or '' to leave it alone.
 *
 * Exact paths only, either slash form, any case. A source answers only while
 * WordPress has nothing there (a 404), except the breadcrumb parent, which is
 * a real page: it answers when the page WordPress found is that top-level
 * page, so a query var cannot opt another page in.
 *
 * @param string $request_path The request's path, as in REQUEST_URI.
 */
function statchasers_legacy_route_target( string $request_path ): string {
	$path = strtolower( trim( $request_path, '/' ) );
	if ( '' === $path ) {
		return '';
	}
	$routes = statchasers_legacy_routes();
	if ( ! isset( $routes[ $path ] ) || '' === (string) $routes[ $path ] ) {
		return '';
	}
	if ( is_404() ) {
		return (string) $routes[ $path ];
	}
	// Not a 404: only the parent page itself, at its own path.
	$queried = get_queried_object();
	if ( STATCHASERS_FANTASY_PARENT_PATH === $path
		&& $queried instanceof WP_Post
		&& 'page' === $queried->post_type
		&& STATCHASERS_FANTASY_PARENT_PATH === $queried->post_name
		&& 0 === (int) $queried->post_parent ) {
		return (string) $routes[ $path ];
	}
	return '';
}

add_action(
	'template_redirect',
	static function (): void {
		$path   = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
		$target = statchasers_legacy_route_target( $path );
		if ( '' === $target ) {
			return;
		}
		wp_safe_redirect( $target, 301, 'StatChasers' );
		exit;
	},
	// Before core's redirect_canonical (10) and its 404 guesser.
	1
);

/** Is this URL the breadcrumb parent, /fantasy-football/? */
function statchasers_is_fantasy_parent_url( string $url ): bool {
	$path = (string) wp_parse_url( $url, PHP_URL_PATH );
	return '/' . STATCHASERS_FANTASY_PARENT_PATH . '/' === trailingslashit( strtolower( $path ) );
}

/**
 * Any crumb at /fantasy-football/ becomes the hub it redirects to.
 *
 * Runs early (5) so the crumbs other files append after it (a rankings
 * position, an SOS sub-page) are untouched; it only ever rewrites the one
 * crumb whose address is the parent.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_fantasy_parent_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) ) {
		return $crumbs;
	}
	foreach ( $crumbs as $i => $crumb ) {
		if ( is_array( $crumb ) && isset( $crumb[1] ) && statchasers_is_fantasy_parent_url( (string) $crumb[1] ) ) {
			$crumbs[ $i ][0] = STATCHASERS_FANTASY_HUB['name'];
			$crumbs[ $i ][1] = home_url( STATCHASERS_FANTASY_HUB['path'] );
		}
	}
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_fantasy_parent_breadcrumbs', 5 );

/**
 * Keep /fantasy-football/ out of Rank Math's sitemap: it redirects.
 *
 * @param array<string,mixed>|false $url The entry, with its `loc`.
 * @return array<string,mixed>|false
 */
function statchasers_sitemap_drop_fantasy_parent( $url ) {
	if ( is_array( $url ) && isset( $url['loc'] ) && statchasers_is_fantasy_parent_url( (string) $url['loc'] ) ) {
		return false;
	}
	return $url;
}
add_filter( 'rank_math/sitemap/entry', 'statchasers_sitemap_drop_fantasy_parent', 10, 1 );
