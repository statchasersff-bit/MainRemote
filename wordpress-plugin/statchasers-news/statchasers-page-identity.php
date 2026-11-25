<?php
/**
 * Page identity for the NFL schedule, strength of schedule and player stats
 * pages (WEB-021).
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
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The share image for every family: the StatChasers brand card. There is no
 * schedule, SOS, team or player stats graphic in the media library; this one
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
 * Which family this request is a valid route of: 'schedule', 'sos', 'stats', 'team'
 * or ''.
 *
 * Valid means the page that mounts the tool, rendered as a page: a week the
 * season does not have is a 404 (statchasers-schedule.php's
 * template_redirect) and answers ''. The mount checks are the tool files' own
 * memoized predicates, so a query var on an article cannot opt it in.
 *
 * 'team' is the directory at /nfl/teams/ (the index shortcode, or the
 * container page the plugin fills) and a page carrying [statchasers_team]
 * whose slug is a team, on its hub address or a tab the rewrite serves.
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
	 * Filters the share image of a schedule, SOS, team or player stats route.
	 * Return null for none.
	 *
	 * @param array  $image  url, width, height, alt, type.
	 * @param string $family 'schedule', 'sos', 'team' or 'stats'.
	 */
	$image = apply_filters( 'statchasers_page_identity_image', STATCHASERS_PAGE_IDENTITY_IMAGE, $family );
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
