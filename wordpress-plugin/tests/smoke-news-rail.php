<?php
/**
 * The news shortcode's compact rail (layout="rail", 2026-11-17): its own
 * arguments, and the full feed's arguments exactly as before when the
 * attribute is absent. Included by smoke.php's "newsrail" group.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'is' ) ) {
	fwrite( STDERR, "smoke-news-rail.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

require_once dirname( __DIR__ ) . '/statchasers-news/statchasers-news-rail.php';

// The compact news rail (layout="rail", 2026-11-17): its own args, and the
// full feed's args untouched when the attribute is absent.
$rail = statchasers_news_rail_args( array( 'layout' => 'rail' ) );
is( array( $rail['layout'], $rail['limit'], $rail['pages'] ), array( 'rail', 6, 5 ), 'news rail: six rows a page, five pages' );
is( array_key_exists( 'all_url', $rail ), false, 'news rail: no View All link (mak, 2026-11-17)' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'pages' => '1' ) )['pages'], 1, 'news rail: pages="1" is six stories with no pager' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'pages' => '40' ) )['pages'], 10, 'news rail: pages capped at 10' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'pages' => '0' ) )['pages'], 1, 'news rail: pages floored at 1' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'pages' => 'x' ) )['pages'], 5, 'news rail: a non-number pages is the default' );
is( statchasers_news_rail_args( array( 'layout' => 'RAIL', 'limit' => '99' ) )['limit'], 10, 'news rail: limit capped at 10, layout case-insensitive' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'limit' => '1' ) )['limit'], 3, 'news rail: limit floored at 3' );
is( statchasers_news_rail_args( array( 'layout' => 'rail', 'limit' => 'abc' ) )['limit'], 6, 'news rail: a non-number limit is the default, never zero' );

is( statchasers_news_is_rail( array() ), false, 'news feed: no layout attribute is the full feed' );
is( statchasers_news_is_rail( array( 'layout' => 'full' ) ), false, 'news feed: any other layout value is the full feed' );
is( statchasers_news_is_rail( array( 'layout' => ' Rail ' ) ), true, 'news rail: layout read case- and space-insensitively' );
