<?php
/**
 * The rankings board's and the stats table's addresses and headings, in
 * processes of their own.
 *
 * Both tools memoize "does this page mount me", so the page that does not and
 * the page that does cannot be asked about in one process - nor after anything
 * in the main group has asked about a page of its own. smoke.php runs this
 * twice: STATCHASERS_SMOKE_GROUP=leak for an ordinary article, and =headings
 * for a page mounting both tools in the "Let the tool supply the heading" mode.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_rankings_request_pos' ) ) {
	fwrite( STDERR, "smoke-headings.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( 'leak' === $group ) {
	/*
	 * Both position query vars are public, so anyone can put them on any URL.
	 * Before 1.10.2 an article at `?sc_stats_pos=rb` was retitled "NFL Running
	 * Back Stats…" and canonicalized to the stats page, and `?sc_rank_pos=rb`
	 * did the same with the rankings.
	 */
	echo "\nthe position query vars mean nothing off their own pages\n";

	$article               = new WP_Post();
	$article->ID           = 90;
	$article->post_title   = 'Waiver Wire Week 4';
	$article->post_content = '<p>Pick up these players.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$GLOBALS['query']      = array( 'sc_rank_pos' => 'rb', 'sc_stats_pos' => 'rb' );

	is( statchasers_rankings_request_pos(), '', 'the rankings position is not read off an article' );
	is( statchasers_rankings_position_title(), '', 'so the article is not retitled as a board' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/waiver-wire-week-4/' ), 'https://example.com/waiver-wire-week-4/', 'and keeps its own canonical' );
	is( statchasers_player_stats_request_position(), '', 'the stats position is not read off it either' );
	is( statchasers_player_stats_title(), '', 'so it is not retitled as a stats table' );
	is( statchasers_h1_mounts_a_tool(), false, 'and the heading machinery leaves it alone' );

	$_GET                    = array( 'season' => '2024' );
	$_SERVER['QUERY_STRING'] = 'season=2024';
	$GLOBALS['query']        = array( 'sc_stats_pos' => 'qb' );
	is( statchasers_player_stats_redirect_target(), '', 'and an article at /qb/?season=2024 is never redirected by the stats table' );
	$_GET                    = array();
	$_SERVER['QUERY_STRING'] = '';
	return;
}

echo "\nboth tools supply the page heading in tool mode\n";

$both               = new WP_Post();
$both->ID           = 91;
$both->post_title   = 'Rankings and Stats';
$both->post_content = '[statchasers_ros_rankings][statchasers_player_stats]';
$GLOBALS['page']    = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $both );
$GLOBALS['query']   = array( 'sc_rank_pos' => 'rb', 'sc_stats_pos' => 'wr' );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
$GLOBALS['http_body'] =
	'<div class="scr is-embed"><a class="scr-nav-link" data-scr-heading="2026 Rest of Season Fantasy Football RB Rankings">RB</a>' .
	'<script type="application/json" class="scr-faq-data">[]</script>' .
	'<script type="application/json" class="scr-page-data">{"title":"2026 Rest of Season Fantasy Football RB Rankings: Running Backs","h1":"2026 Rest of Season Fantasy Football RB Rankings","description":"RB board."}</script></div>' .
	'<div class="sca-intro"><p>Compare WRs.</p><p>View stats.</p></div>' .
	'<script type="application/json" class="sca-page-data">{"title":"2026 NFL Wide Receiver Stats & Fantasy Football Stats","h1":"2026 NFL Wide Receiver Stats & Fantasy Football Stats","description":"WR table.","lead":"Compare WRs. View stats."}</script>';

is( statchasers_player_stats_args( array( 'pos' => 'te' ) )['pos'], 'wr', 'the stats address outranks the attribute' );
is( statchasers_player_stats_canonical(), 'https://example.com/nfl/nfl-player-stats/wr/', 'and is its own canonical' );
is( statchasers_player_stats_title(), '2026 NFL Wide Receiver Stats & Fantasy Football Stats', 'with the island\'s title' );

is( statchasers_h1_mounts_a_tool(), true, 'a page mounting either tool is a tool page' );
is( statchasers_rankings_h1(), '2026 Rest of Season Fantasy Football RB Rankings', 'the rankings H1 follows the board, from the island' );
is( statchasers_rankings_position_title(), '2026 Rest of Season Fantasy Football RB Rankings: Running Backs', 'the rankings title is the island\'s' );
is( statchasers_rankings_position_description(), 'RB board.', 'and so is its description' );
is( statchasers_rankings_position_canonical(), 'https://example.com/fantasy-football/rest-of-season-rankings/rb/', 'and the board is its own canonical' );

$rank_html = statchasers_ros_rankings_shortcode();
is( substr_count( $rank_html, '<h1' ), 1, 'the rankings shortcode prints exactly one H1' );
is( str_contains( $rank_html, 'sc-lo-hero--generated' ), true, 'in the site\'s hero markup' );
is( str_contains( $rank_html, '>2026 Rest of Season Fantasy Football RB Rankings</h1>' ), true, 'naming the board' );
is( str_contains( $rank_html, 'data-sct-page-title' ), true, 'marked for the bundle to swap on a tab switch' );
is( str_contains( $rank_html, 'scr-page-data' ) || str_contains( $rank_html, 'scr-faq-data' ), false, 'and both islands are stripped' );

$stats_html = statchasers_player_stats_shortcode();
is( substr_count( $stats_html, '<h1' ), 1, 'the stats shortcode prints exactly one H1' );
is( str_contains( $stats_html, '>2026 NFL Wide Receiver Stats &amp; Fantasy Football Stats</h1>' ), true, 'naming the position' );
is( str_contains( $stats_html, '<p class="sc-lo-hero__lead" data-sct-page-lead>Compare WRs. View stats.</p>' ), true, 'with the intro as the hero\'s description' );
is( str_contains( $stats_html, 'sca-intro' ), false, 'and the fragment\'s own intro dropped' );

// The theme's own title is emptied on these pages in this mode (the
// PHP_INT_MAX `the_title` filter in statchasers-h1.php, which the stub harness
// cannot order), so the hero is the page's only heading.
is( statchasers_h1_should_replace(), true, 'and the theme\'s title is emptied' );

$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'auto';
is( str_contains( statchasers_ros_rankings_shortcode(), '<h1' ), false, 'in auto, with no measurement of its own, rankings prints none' );
$stats_html = statchasers_player_stats_shortcode();
is( str_contains( $stats_html, '<h1' ), false, 'nor does the stats table' );
is( str_contains( $stats_html, '<div class="sca-intro">' ), true, 'which keeps its own intro under the theme\'s title' );

/*
 * Old `?season=` links: a 301 to the position's clean address, in one hop,
 * with the season moved into the fragment and every other parameter kept.
 * The page above mounts the table (memoized), so the redirect is live here.
 */
echo "\nold season links redirect to the clean address\n";

$stats_redirect = static function ( array $query_var, string $query ): string {
	$GLOBALS['query'] = $query_var;
	parse_str( $query, $get );
	$_GET                    = $get;
	$_SERVER['QUERY_STRING'] = $query;
	$target                  = statchasers_player_stats_redirect_target();
	$_GET                    = array();
	$_SERVER['QUERY_STRING'] = '';
	return $target;
};

is( $stats_redirect( array(), '' ), '', 'the bare page is served' );
is( $stats_redirect( array( 'sc_stats_pos' => 'wr' ), '' ), '', 'and so is a clean position address' );
is( $stats_redirect( array( 'sc_stats_pos' => 'wr' ), 'utm_source=x' ), '', 'other parameters alone are not redirected' );
is( $stats_redirect( array(), 'season=2024' ), 'https://example.com/nfl/nfl-player-stats/#season=2024', 'the bare page with a season goes to the fragment' );
is( $stats_redirect( array( 'sc_stats_pos' => 'wr' ), 'season=all' ), 'https://example.com/nfl/nfl-player-stats/wr/#season=all', 'a position keeps its address' );
is( $stats_redirect( array( 'sc_stats_pos' => 'te' ), 'season=ALL' ), 'https://example.com/nfl/nfl-player-stats/te/#season=all', 'case folded' );
is( $stats_redirect( array( 'sc_stats_pos' => 'rb' ), 'utm_source=x&season=2023&ref=y' ), 'https://example.com/nfl/nfl-player-stats/rb/?utm_source=x&ref=y#season=2023', 'other parameters are kept, in order' );
is( $stats_redirect( array( 'sc_stats_pos' => 'rb' ), 'season=%3Cscript%3E' ), 'https://example.com/nfl/nfl-player-stats/rb/', 'a season of the wrong shape is just dropped' );
is( $stats_redirect( array( 'sc_stats_pos' => 'rb' ), 'season=1998' ), 'https://example.com/nfl/nfl-player-stats/rb/', 'and so is one out of range' );
is( $stats_redirect( array( 'sc_stats_pos' => 'rb' ), 'season=' ), 'https://example.com/nfl/nfl-player-stats/rb/', 'and an empty one' );
is( $stats_redirect( array( 'sc_stats_pos' => 'rb' ), 'season%5B%5D=2024&x=1' ), 'https://example.com/nfl/nfl-player-stats/rb/?x=1', 'and the array spelling' );
is( $stats_redirect( array( 'sc_stats_pos' => 'qb' ), '' ), 'https://example.com/nfl/nfl-player-stats/', '/qb/ is the bare page' );
is( $stats_redirect( array( 'sc_stats_pos' => 'qb' ), 'season=2024' ), 'https://example.com/nfl/nfl-player-stats/#season=2024', '/qb/?season=2024 lands on the final address in one hop' );
is( $stats_redirect( array( 'sc_stats_pos' => 'qb' ), 'ref=y' ), 'https://example.com/nfl/nfl-player-stats/?ref=y', '/qb/ keeps other parameters' );
$GLOBALS['query'] = array();
$_GET             = array();
is( statchasers_player_stats_args( array() )['season'], '', 'the target, served, renders the default season' );
