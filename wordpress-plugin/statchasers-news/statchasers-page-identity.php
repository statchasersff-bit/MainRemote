<?php
/**
 * Page identity for the NFL schedule, strength of schedule, team, player
 * stats, rest-of-season rankings and depth charts pages (WEB-021).
 *
 * ## What was missing, and why
 *
 * The November 20 audit found every schedule and SOS URL with no og:image and
 * a schema graph of BreadcrumbList (plus the schedule's FAQ) and nothing else:
 * no Organization, no WebSite, no WebPage. Neither is something these files
 * suppressed. Both come from how Rank Math treats a Page:
 *
 * - Rank Math adds its global entities (publisher Organization, WebSite,
 *   WebPage, primary image) to a singular page only when that page has a
 *   schema of its own or its post type has a default schema type
 *   (JsonLD::can_add_global_entities). Pages here are set to "None"
 *   (titles.pt_page_default_rich_snippet = ''), so every tool page loses
 *   them. The front page is exempt, which is why the homepage has the full
 *   graph, and a 404 is not singular, which is why /week-99/ does too.
 * - Neither page has a featured image or a Rank Math social image, and no
 *   site-wide default Open Graph image is set, so Rank Math prints no og:image.
 *
 * The fix stays inside Rank Math's own output, on these two families only:
 *
 * - `rank_math/schema/add_global_entities` says yes on a valid schedule or
 *   SOS route. Rank Math then builds the same Organization
 *   (https://statchasers.com/#organization) and WebSite (/#website) nodes the
 *   homepage carries, and a WebPage whose @id and url are the route's own
 *   canonical (Paper canonical, which statchasers-schedule.php and
 *   statchasers-sos.php already set per week and per sub-page), with the
 *   route's title as its name, isPartOf the WebSite and breadcrumb the
 *   route's BreadcrumbList. Its own FAQ merge (Frontend::change_webpage_entity,
 *   priority 99) then folds the schedule's FAQPage into that same node: one
 *   page entity typed FAQPage, at the route's @id, with the questions intact.
 *   Before this, with no WebPage to merge into, that merge left a FAQPage with
 *   no @id or url at all. Rank Math's author Person is added too and dropped
 *   again by its own remove_person_entity, as nothing references it.
 * - The site's 1200x630 brand card (media 7458) is handed to Rank Math's
 *   image collector for both networks when the page has no image of its own,
 *   so og:image and twitter:image are one picture, and the same picture is
 *   the WebPage's primaryImageOfPage.
 * - An SOS sub-page's BreadcrumbList ended at the overview (its title and
 *   canonical already said RB), so the sub-page is appended as the last crumb,
 *   the way a schedule week is.
 *
 * Titles, descriptions, canonicals and og:url are not touched here: WEB-022
 * and the tool files own those. A route that is a 404 (/week-99/) gets
 * none of this.
 *
 * ## The team pages (team audit, 2026-11-24)
 *
 * The same gap on the team directory (/nfl/teams/), the 32 hubs and every
 * tab address under them (/usage/, /coaching/, /stats/, /schedule/,
 * /depth-chart/, /matchups/, /news/): BreadcrumbList plus an FAQPage with no
 * @id or url, no Organization, WebSite or WebPage, and no og:image on 26 of
 * the 32 hubs (the other six carry the crest the page builder set as their
 * featured image). They join as a third family, 'team', on exactly the
 * mechanism above: global entities on, the brand card as the fallback image
 * (so the six crests stay theirs, and the 26 others get one), and the
 * WebPage's @id built from the canonical statchasers-team-pages.php already
 * sets per tab. The team FAQ (statchasers-team.php) folds into that WebPage
 * the way the schedule's does, and the Schedule tab's ItemList hangs off it.
 *
 * One more piece is the team pages' own: the hub's breadcrumb. Rank Math
 * names a page's crumb with the page title, and the team page's title is its
 * H1, which statchasers-team-pages.php writes per tab - so on the Schedule
 * tab the crumb at the HUB's address read "Buffalo Bills Schedule", and on
 * the hub "Buffalo Bills 2026 Stats, Schedule & Fantasy Outlook". The hub
 * crumb is the team's name on every team route
 * (statchasers_team_identity_breadcrumbs).
 *
 * The player stats leaderboards (2026-11-24) are another family on the same
 * terms: the bare page (/nfl/nfl-player-stats/, the quarterbacks) and /rb/,
 * /wr/ and /te/, which the rewrite resolves to that same page. Rank Math's
 * WebPage takes its @id, url and name from the canonical and title it settled
 * on, and statchasers-player-stats.php already filters both per position (the
 * same way the schedule's weeks and SOS sub-pages get their own WebPage, live
 * since 1.10.63), so each position is its own WebPage. Its FAQPage folds into
 * that node like the schedule's. A position's breadcrumb ended at the bare
 * page, so the position is appended as the last crumb, as an SOS sub-page is.
 * /qb/ is a 301 to the bare page before anything prints and is not a route.
 *
 * ## The rest-of-season rankings (2026-11-25)
 *
 * The same gap again on the rest-of-season board: the page that mounts
 * [statchasers_ros_rankings] (page 5835, /fantasy-football/rest-of-season-rankings/)
 * and its /qb/, /rb/, /wr/ and /te/ addresses, which the rewrite in
 * statchasers-rankings.php resolves to that same page with sc_rank_pos set.
 * Live on 2026-11-25 the hub's graph was a BreadcrumbList, four ItemLists
 * with no @id and an FAQPage with no @id, /rb/'s the same with one list, and
 * neither printed an og:image. They join as a fifth family, 'ros', on the
 * same terms as the others:
 *
 * - Global entities on, so Rank Math builds the Organization, the WebSite and
 *   a WebPage at the canonical statchasers-rankings.php already filters per
 *   position (Rank Math's BreadcrumbList on /rb/ was already at
 *   /rb/#breadcrumb, which is the same Paper canonical the WebPage reads).
 * - The board's FAQPage (statchasers_rankings_rank_math_schema, priority 20)
 *   folds into that WebPage at priority 99, as the team FAQ does: one page
 *   entity typed FAQPage at the position's own #webpage. Its ItemLists
 *   (statchasers_rankings_rank_math_lists) already point isPartOf at
 *   whatever page node the graph has, which they could not do while there
 *   was none; now they hang off the WebPage the way the team Schedule tab's
 *   game list does. statchasers-rankings.php needs no change for any of it,
 *   and its fallback printer still prints only the FAQPage and the lists,
 *   and only when no schema-graph plugin is present, so it can never add a
 *   second page, Organization or WebSite beside Rank Math's.
 * - The brand card as the fallback image, and a position appended as the last
 *   crumb at its own address, named with the board's H1
 *   (statchasers_ros_rankings_breadcrumbs).
 *
 * The redraft board ([statchasers_rankings], /redraft-rankings/) is not part
 * of this family, and an address the rewrite does not know (/xyz/) is a 404
 * that keeps its noindex and gets none of this.
 *
 * The NFL depth charts hub (/nfl/nfl-depth-charts/, page 2068, 2026-11-25) is
 * the sixth family, 'depth', on the same terms: BreadcrumbList only, no
 * og:image, no featured or Rank Math social image. It is the route
 * SCDC_Route::is_main() names (the page SCDC_Pages records, by ID or by path),
 * so the pre-1.7.0 nested addresses (301s) and junk under the path (404s) are
 * not it. Unlike the others it has a picture of its own: a "NFL Depth Charts"
 * card in the brand card's style, shipped in the plugin
 * (depth-charts/assets/img/nfl-depth-charts-og.png, source
 * wordpress-plugin/assets/social/nfl-depth-charts-og.html) rather than
 * uploaded, so it is served from the WordPress origin with the plugin. The
 * hub prints no FAQ schema, so its page entity stays a WebPage. Its trail
 * (Home > NFL > the page) is Rank Math's own and is left as it is.
 *
 * ## Fantasy points allowed (WEB-021, 2026-11-27)
 *
 * The FPA page (page 2094, /nfl/fantasy-points-allowed-by-position/) and its
 * season archives (/2025/, the rewrite's sc_fpa_season on the same page) are
 * the seventh family, 'fpa'. Live on 2026-11-27 the current page's graph was a
 * WebPage statchasers-fpa.php had built itself (no isPartOf, no publisher), a
 * BreadcrumbList and a second, id-less FAQPage of nineteen questions; /2025/
 * had a BreadcrumbList ending at the base page and nothing else. Both already
 * printed the brand card as og:image (Rank Math's site default, the same media
 * 7458 this file hands over), so the image part changes nothing they print.
 *
 * - Global entities on, so Rank Math builds the Organization, the WebSite and
 *   the WebPage at the canonical statchasers-fpa.php already sets per season:
 *   the base URL on the current page, /2025/ on the archive. Each season is
 *   its own WebPage, @id and url its own address, name its own title.
 * - statchasers-fpa.php's FAQPage (priority 20, from the fragment's
 *   scf-faq-data island, the same list the visible FAQ is printed from) folds
 *   into that WebPage at 99. Its own page node (statchasers_fpa_modified_schema)
 *   is now only a fallback for a graph with no page node; with one present it
 *   puts dateModified on Rank Math's WebPage and adds nothing.
 * - The archive is appended as the last crumb at its own address
 *   (statchasers_fpa_breadcrumbs), named with its H1.
 * - A season with no table is a 404 (statchasers_fpa_season_404) and gets
 *   none of this.
 *
 * tests/smoke-page-identity.php models both seasons and the 404.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The share image for every family: the StatChasers brand card. There is no
 * schedule, SOS, team, player stats or rankings graphic in the media library; this one
 * names the site and what it does, which is true of all of them. A team hub
 * with a featured image (its crest) keeps it: this is only ever the fallback. Real pixels (checked 2026-11-24:
 * 200, image/png, 1200 x 630).
 */
const STATCHASERS_PAGE_IDENTITY_IMAGE = array(
	'url'    => 'https://statchasers.com/wp-content/uploads/2026/11/statchasers-og-default-1200x630-1.png',
	'width'  => 1200,
	'height' => 630,
	'alt'    => 'StatChasers fantasy football tools and rankings',
	'type'   => 'image/png',
);

/**
 * The depth charts hub's own card (same brand style as the one above), served
 * from the plugin directory. Real pixels: 1200 x 630 PNG, checked by
 * tests/smoke-page-identity.php against the file this URL names.
 */
const STATCHASERS_PAGE_IDENTITY_DEPTH_IMAGE = array(
	'url'    => 'https://statchasers.com/wp-content/plugins/statchasers-news/depth-charts/assets/img/nfl-depth-charts-og.png',
	'width'  => 1200,
	'height' => 630,
	'alt'    => 'NFL depth charts for all 32 teams on StatChasers',
	'type'   => 'image/png',
);

/**
 * Which family this request is a valid route of: 'schedule', 'sos', 'stats',
 * 'ros', 'depth', 'fpa', 'team' or ''.
 *
 * Valid means the page that mounts the tool, rendered as a page: a week the
 * season does not have is a 404 (statchasers-schedule.php's
 * template_redirect) and answers ''. The mount checks are the tool files' own
 * memoized predicates, so a query var on an article cannot opt it in.
 *
 * 'team' is the directory at /nfl/teams/ (the index shortcode, or the
 * container page the plugin fills) and a page carrying [statchasers_team]
 * whose slug is a team, on its hub address or a tab the rewrite serves.
 *
 * 'ros' is the page mounting the rest-of-season board, bare or at a position
 * the rewrite serves (statchasers_rankings_page_is_ros(), memoized off the
 * queried page, so the redraft board's page and `?sc_rank_pos=` on an article
 * answer '').
 */
function statchasers_page_identity_family(): string {
	if ( is_404() || ! is_singular() ) {
		return '';
	}
	if ( function_exists( 'statchasers_schedule_post_has_shortcode' ) && statchasers_schedule_post_has_shortcode() ) {
		return 'schedule';
	}
	if ( function_exists( 'statchasers_sos_post_has_shortcode' ) && statchasers_sos_post_has_shortcode() ) {
		return 'sos';
	}
	if ( function_exists( 'statchasers_player_stats_post_has_shortcode' ) && statchasers_player_stats_post_has_shortcode() ) {
		// /qb/ redirects to the bare page on template_redirect; it never
		// renders, so it is not a route of its own.
		return 'qb' === strtolower( trim( (string) get_query_var( 'sc_stats_pos' ) ) ) ? '' : 'stats';
	}
	if ( function_exists( 'statchasers_rankings_page_is_ros' ) && statchasers_rankings_page_is_ros() ) {
		return 'ros';
	}
	// The depth charts hub: its one address only (legacy routes 301 and junk
	// 404s on `wp`, before the head).
	if ( class_exists( 'SCDC_Route' ) && SCDC_Route::is_main() ) {
		return 'depth';
	}
	// Fantasy points allowed: the page and its season archives (/2025/). A
	// season with no table is a 404 by now (statchasers_fpa_season_404, on
	// `wp` at 0) and was answered above, and is asked again here in case
	// anything ever clears that 404; ?season= and /2026/ 301 first.
	if ( function_exists( 'statchasers_fpa_post_has_shortcode' ) && statchasers_fpa_post_has_shortcode() ) {
		return function_exists( 'statchasers_fpa_season_not_found' ) && statchasers_fpa_season_not_found() ? '' : 'fpa';
	}
	if ( statchasers_page_identity_is_team() ) {
		return 'team';
	}
	return '';
}

/**
 * Is this request the team directory, a team hub or one of a hub's tabs?
 *
 * A hub is a page carrying [statchasers_team] at a team's slug
 * (statchasers_team_current_slug(), the key the title, canonical and render
 * already share), so a page somebody made at a team slug for another purpose
 * is not one. `/outlook/` 301s before the head is built and answers like the
 * hub it lands on.
 */
function statchasers_page_identity_is_team(): bool {
	if ( function_exists( 'statchasers_team_post_has_index_shortcode' ) && statchasers_team_post_has_index_shortcode() ) {
		return true;
	}
	if ( function_exists( 'statchasers_team_is_container_page' ) && statchasers_team_is_container_page() ) {
		return true;
	}
	return function_exists( 'statchasers_team_post_has_shortcode' )
		&& function_exists( 'statchasers_team_current_slug' )
		&& statchasers_team_post_has_shortcode()
		&& '' !== statchasers_team_current_slug();
}

/**
 * The share image, filterable, or null off these routes.
 *
 * @return array{url:string,width:int,height:int,alt:string,type:string}|null
 */
function statchasers_page_identity_image(): ?array {
	$family = statchasers_page_identity_family();
	if ( '' === $family ) {
		return null;
	}
	/**
	 * Filters the share image of a schedule, SOS, team, player stats,
	 * rest-of-season rankings, depth charts or fantasy points allowed route. Return null for none.
	 *
	 * @param array  $image  url, width, height, alt, type.
	 * @param string $family 'schedule', 'sos', 'team', 'stats', 'ros', 'depth' or 'fpa'.
	 */
	$image = apply_filters(
		'statchasers_page_identity_image',
		'depth' === $family ? STATCHASERS_PAGE_IDENTITY_DEPTH_IMAGE : STATCHASERS_PAGE_IDENTITY_IMAGE,
		$family
	);
	if ( ! is_array( $image ) || empty( $image['url'] ) || 0 !== strpos( (string) $image['url'], 'https://' ) ) {
		return null;
	}
	return $image;
}

/*
 * Rank Math's global entities on a valid route. Rank Math answers false here
 * for every Page with no schema of its own; this answers true for these
 * families and passes every other page's answer through.
 */
add_filter(
	'rank_math/schema/add_global_entities',
	static function ( $add ) {
		return '' === statchasers_page_identity_family() ? $add : true;
	}
);

/*
 * og:image and twitter:image: the same picture for both networks, handed to
 * Rank Math's collector as the player and matchup pages hand theirs - but on
 * `add_additional_images`, which Rank Math fires after it has looked for the
 * page's own social or featured image, and only when it found none. So there
 * is always exactly one og:image, and an image an editor sets on the page
 * later wins rather than printing a second.
 */
foreach ( array( 'facebook', 'twitter' ) as $statchasers_page_identity_network ) {
	add_action(
		"rank_math/opengraph/{$statchasers_page_identity_network}/add_additional_images",
		static function ( $images ) {
			$image = statchasers_page_identity_image();
			if ( null === $image || ! is_object( $images ) || ! method_exists( $images, 'add_image' ) ) {
				return;
			}
			if ( method_exists( $images, 'has_images' ) && $images->has_images() ) {
				return;
			}
			$images->add_image(
				array(
					'url'    => $image['url'],
					'width'  => (int) $image['width'],
					'height' => (int) $image['height'],
					'alt'    => (string) $image['alt'],
					'type'   => (string) ( $image['type'] ?? '' ),
				)
			);
		}
	);
}

/**
 * The share image as the page node's primaryImageOfPage: an ImageObject node
 * keyed `primaryImage`, Rank Math's own key and @id convention (the image
 * URL), referenced from the WebPage. Left alone when Rank Math already found
 * a featured image for the page.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_page_identity_schema( $data ) {
	if ( ! is_array( $data ) || empty( $data['WebPage'] ) || ! is_array( $data['WebPage'] ) ) {
		return $data;
	}
	$image = statchasers_page_identity_image();
	if ( null === $image ) {
		return $data;
	}
	// A family image flagged replace_unshareable (the team cards) also takes
	// the place of a featured image the social networks cannot show (the
	// hubs' AVIF crests), so og:image and primaryImageOfPage name one picture.
	$unshareable = ! empty( $image['replace_unshareable'] )
		&& ! empty( $data['primaryImage']['url'] )
		&& preg_match( '/\.avif(?:\?|$)/i', (string) $data['primaryImage']['url'] );
	if ( $unshareable ) {
		unset( $data['WebPage']['primaryImageOfPage'] );
	}
	if ( empty( $data['primaryImage'] ) || $unshareable ) {
		$data['primaryImage'] = array(
			'@type'      => 'ImageObject',
			'@id'        => $image['url'],
			'url'        => $image['url'],
			'width'      => (int) $image['width'],
			'height'     => (int) $image['height'],
			'caption'    => (string) $image['alt'],
			'inLanguage' => 'en-US',
		);
	}
	if ( empty( $data['WebPage']['primaryImageOfPage'] ) ) {
		$data['WebPage']['primaryImageOfPage'] = array( '@id' => $data['primaryImage']['@id'] );
	}
	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_page_identity_schema', 25 );

/**
 * An SOS sub-page as the last breadcrumb, at its own address.
 *
 * Rank Math's trail on /rb/ ends at the overview, the page the rewrite
 * resolves to, so the RB page's BreadcrumbList named the overview as the page.
 * Same fix as the schedule's week crumb (statchasers_schedule_breadcrumbs),
 * scoped by statchasers_sos_request_page(): the SOS page only, a sub-page it
 * has only. The overview and its query variants keep their trail as it is.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_sos_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) || ! function_exists( 'statchasers_sos_request_page' ) ) {
		return $crumbs;
	}
	$page = statchasers_sos_request_page();
	if ( '' === $page || is_404() ) {
		return $crumbs;
	}
	$name = function_exists( 'statchasers_sos_h1' ) ? statchasers_sos_h1() : '';
	if ( '' === $name ) {
		$name = STATCHASERS_SOS_PAGE_COPY[ $page ]['h1'];
	}
	$crumbs[] = array( $name, statchasers_sos_page_url( $page ), 'hide_in_schema' => false );
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_sos_breadcrumbs', 20 );

/**
 * The team hub's crumb as the team's name, on every team route.
 *
 * Rank Math's trail names the hub crumb with the page title, which on a team
 * page is the tab's H1 (statchasers-team-pages.php's the_title filter): the
 * Schedule tab's trail read "... > Buffalo Bills Schedule > Schedule", with
 * the first of those two at the hub's address. Matched by URL, so only the
 * crumb that IS the hub is renamed; the tab crumb that
 * statchasers_team_breadcrumbs() appends after it keeps its label.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_team_identity_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) || 'team' !== statchasers_page_identity_family() ) {
		return $crumbs;
	}
	$slug = function_exists( 'statchasers_team_current_slug' ) ? statchasers_team_current_slug() : '';
	$row  = '' === $slug ? null : ( statchasers_team_table()[ $slug ] ?? null );
	if ( null === $row ) {
		return $crumbs;
	}
	$hub = trailingslashit( (string) get_permalink( get_queried_object() ) );
	foreach ( $crumbs as $i => $crumb ) {
		if ( is_array( $crumb ) && isset( $crumb[1] ) && trailingslashit( (string) $crumb[1] ) === $hub ) {
			$crumbs[ $i ][0] = $row[0];
		}
	}
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_team_identity_breadcrumbs', 15 );

/**
 * A player stats position as the last breadcrumb, at its own address.
 *
 * /rb/, /wr/ and /te/ resolve to the bare page, so Rank Math's trail ended at
 * "NFL Player Stats" while the page's canonical and title said wide receivers.
 * Same fix as statchasers_sos_breadcrumbs(), scoped by
 * statchasers_player_stats_request_position(): the stats page only, a
 * position address only. The bare page keeps its trail as it is. The crumb is
 * the short "NFL Wide Receiver Stats", the same shape as its parent crumb,
 * rather than the season-dated H1.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_player_stats_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) || is_404() || ! function_exists( 'statchasers_player_stats_request_position' ) ) {
		return $crumbs;
	}
	$pos = statchasers_player_stats_request_position();
	if ( '' === $pos || ! isset( STATCHASERS_PLAYER_STATS_NAMES[ $pos ] ) ) {
		return $crumbs;
	}
	$crumbs[] = array(
		sprintf( 'NFL %s Stats', STATCHASERS_PLAYER_STATS_NAMES[ $pos ] ),
		statchasers_player_stats_position_url( $pos ),
		'hide_in_schema' => false,
	);
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_player_stats_breadcrumbs', 20 );

/**
 * A rest-of-season position as the last breadcrumb, at its own address.
 *
 * /rb/ resolves to the rankings page, so Rank Math's trail ended at "Rest of
 * Season Rankings" while the page's canonical, title and H1 said running
 * backs. Same fix as statchasers_sos_breadcrumbs(), scoped by
 * statchasers_rankings_request_pos(): the rest-of-season page only (the
 * redraft board has no position addresses), a position address only. The
 * bare page keeps its trail as it is. The crumb is the board's H1, the
 * heading the visitor sees, as an SOS sub-page's is.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_ros_rankings_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) || is_404() || ! function_exists( 'statchasers_rankings_request_pos' ) ) {
		return $crumbs;
	}
	$pos = statchasers_rankings_request_pos();
	if ( '' === $pos ) {
		return $crumbs;
	}
	$name = function_exists( 'statchasers_rankings_h1' ) ? statchasers_rankings_h1() : '';
	if ( '' === $name ) {
		$name = sprintf( 'Rest of Season Rankings: %s', STATCHASERS_RANKINGS_POSITION_NAMES[ $pos ] ?? strtoupper( $pos ) );
	}
	$crumbs[] = array( $name, statchasers_rankings_position_url( $pos ), 'hide_in_schema' => false );
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_ros_rankings_breadcrumbs', 20 );

/**
 * A fantasy points allowed season archive as the last breadcrumb, at its own
 * address.
 *
 * /2025/ resolves to the FPA page, so Rank Math's trail ended at "Fantasy
 * Points Allowed by Position" at the base address while the archive's
 * canonical, title and H1 said 2025 (live 2026-11-27). Same fix as
 * statchasers_sos_breadcrumbs(), scoped by statchasers_fpa_request_season():
 * the FPA page only, an archive address only. The base page keeps its trail
 * as it is. The crumb is the archive's H1, as an SOS sub-page's is.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_fpa_breadcrumbs( $crumbs ) {
	if ( ! is_array( $crumbs ) || is_404() || ! function_exists( 'statchasers_fpa_request_season' ) ) {
		return $crumbs;
	}
	$season = statchasers_fpa_request_season();
	if ( $season <= 0 ) {
		return $crumbs;
	}
	$name = function_exists( 'statchasers_fpa_h1' ) ? statchasers_fpa_h1() : '';
	if ( '' === $name ) {
		$name = sprintf( '%d Fantasy Points Allowed by Position', $season );
	}
	$crumbs[] = array( $name, statchasers_fpa_page_url( $season ), 'hide_in_schema' => false );
	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_fpa_breadcrumbs', 20 );
