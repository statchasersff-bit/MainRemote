<?php
/**
 * The news shortcode's compact rail (2026-11-17):
 *
 *   [statchasers_news layout="rail" limit="6"]
 *
 * Six stories a page with Prev / Next paging, five pages by default; no
 * View All link (mak, 2026-11-17).
 *
 * A sidebar view of the same feed - same /embed/ssr endpoint, same caching -
 * with its own stylesheet and small bundle (news-rail.css,
 * dist/statchasers-news-rail.js) in place of the full feed's. This file holds
 * the rail's argument handling; the shortcode, fetch and enqueue branches live
 * beside the full feed's in statchasers-news.php. Without layout="rail" the
 * shortcode is the full feed, exactly as before.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Rows per page by default, and the range a shortcode may ask for. */
const STATCHASERS_NEWS_RAIL_DEFAULT = 6;
const STATCHASERS_NEWS_RAIL_MIN     = 3;
const STATCHASERS_NEWS_RAIL_MAX     = 10;
/** Pages a reader can step through with Prev / Next (default 5, 1 = no pager, up to 10). */
const STATCHASERS_NEWS_RAIL_PAGES_DEFAULT = 5;
const STATCHASERS_NEWS_RAIL_PAGES_MAX     = 10;
/** The rail's own stylesheet and bundle (public/news-rail.css, dist/statchasers-news-rail.js). */
const STATCHASERS_NEWS_RAIL_HANDLE  = 'statchasers-news-rail';

/**
 * Whether a set of shortcode attributes asks for the compact rail.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 */
function statchasers_news_is_rail( array $atts ): bool {
	return isset( $atts['layout'] ) && 'rail' === strtolower( trim( (string) $atts['layout'] ) );
}

/**
 * The rail's arguments: rows per page (3-10, default 6), pages to step
 * through (1-10, default 5) and an optional heading. Everything the full feed
 * takes (filters, pager size, related links, vitals) is irrelevant to it and
 * left out, so a rail and a full feed on one site never share a cache entry.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{layout:string,limit:int,pages:int,heading_text:string}
 */
function statchasers_news_rail_args( array $atts ): array {
	// A missing or non-numeric number is the default, not zero (the API agrees).
	$limit = isset( $atts['limit'] ) && is_numeric( trim( (string) $atts['limit'] ) )
		? (int) $atts['limit']
		: STATCHASERS_NEWS_RAIL_DEFAULT;
	$pages = isset( $atts['pages'] ) && is_numeric( trim( (string) $atts['pages'] ) )
		? (int) $atts['pages']
		: STATCHASERS_NEWS_RAIL_PAGES_DEFAULT;
	return array(
		'layout'       => 'rail',
		'limit'        => max( STATCHASERS_NEWS_RAIL_MIN, min( STATCHASERS_NEWS_RAIL_MAX, $limit ) ),
		'pages'        => max( 1, min( STATCHASERS_NEWS_RAIL_PAGES_MAX, $pages ) ),
		'heading_text' => isset( $atts['heading_text'] ) ? sanitize_text_field( (string) $atts['heading_text'] ) : '',
	);
}

