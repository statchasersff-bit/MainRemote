<?php
/**
 * The strength of schedule board, in processes of its own.
 *
 * The board memoises "does this page mount me" and the fetch its title filters
 * read, so the page that does and the article that does not cannot be asked
 * about in one process — nor after the main group has asked about a page of
 * its own. smoke.php runs this twice: STATCHASERS_SMOKE_GROUP=sosleak for an
 * ordinary article carrying the view's query args, and =sos for the page that
 * mounts the board, in the "Let the tool supply the heading" mode.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_sos_args' ) ) {
	fwrite( STDERR, "smoke-sos.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( 'sosleak' === $group ) {
	/*
	 * `tab`, `pos` and `scoring` are ordinary words that any URL can carry. On
	 * an article they must mean nothing: no fetch of a board, no retitling, no
	 * canonical moved onto the SOS page.
	 */
	echo "\nthe SOS view args mean nothing off the board's page\n";

	$article               = new WP_Post();
	$article->ID           = 92;
	$article->post_title   = 'Waiver Wire Week 5';
	$article->post_content = '<p>Pick up these players.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$_GET                  = array( 'tab' => 'player', 'pos' => 'wr', 'scoring' => 'std' );
	$GLOBALS['http_body']  = '<script type="application/json" class="scsos-page-data">{"title":"T","h1":"H","description":"D"}</script>';

	is( statchasers_sos_query_view(), array( 'tab' => '', 'pos' => '', 'scoring' => '' ), 'the view is not read off an article' );
	is( statchasers_sos_title(), '', 'so the article is not retitled as the board' );
	is( statchasers_sos_canonical(), '', 'and its canonical is left alone' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/waiver-wire-week-5/' ), 'https://example.com/waiver-wire-week-5/', 'through Rank Math too' );
	is( $GLOBALS['remote_urls'] ?? array(), array(), 'and nothing was fetched for it' );
	is( statchasers_h1_mounts_a_tool(), false, 'and the heading machinery leaves it alone' );
	return;
}

echo "\nthe SOS board reads its view\n";

$sos_page               = new WP_Post();
$sos_page->ID           = 93;
$sos_page->post_title   = 'Strength of Schedule';
$sos_page->post_content = '[statchasers_strength_of_schedule]';
$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $sos_page );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';

$_GET = array();
is( statchasers_sos_args( array() ), array( 'tab' => 'team', 'pos' => 'rb', 'scoring' => 'ppr' ), 'the bare page is Team SOS, RB, PPR' );
is( statchasers_sos_args( array( 'tab' => 'player', 'pos' => 'QB', 'scoring' => 'half-ppr' ) ), array( 'tab' => 'player', 'pos' => 'qb', 'scoring' => 'half-ppr' ), 'the attributes set the page default' );

$_GET = array( 'tab' => 'player', 'pos' => 'wr', 'scoring' => 'std' );
is( statchasers_sos_args( array( 'pos' => 'te' ) ), array( 'tab' => 'player', 'pos' => 'wr', 'scoring' => 'std' ), 'the shared view outranks the attribute' );

$_GET = array( 'tab' => 'fpa', 'pos' => 'k', 'scoring' => '<script>' );
is( statchasers_sos_args( array() ), array( 'tab' => 'team', 'pos' => 'rb', 'scoring' => 'ppr' ), 'anything off the whitelist falls back to the default' );
$_GET = array( 'tab' => array( 'player' ), 'pos' => 'half-ppr' );
is( statchasers_sos_query_view(), array( 'tab' => '', 'pos' => '', 'scoring' => '' ), 'an array or a value from another list is not a view' );

$_GET                    = array( 'tab' => 'player', 'pos' => 'te', 'scoring' => 'half-ppr' );
$GLOBALS['remote_urls']  = array();
$GLOBALS['http_body']    =
	'<div class="scsos is-embed" data-scsos-root="1" data-season="2026"><h2>Board</h2>' .
	'<script type="application/json" class="scsos-page-data">{"title":"Fantasy Football Strength of Schedule | 2026 SOS by Team & Player","h1":"Fantasy Football Strength of Schedule","description":"View 2026 fantasy football strength of schedule <b>by team</b>.","extra":1}</script>' .
	'</div>';

$html = statchasers_sos_shortcode();
is(
	$GLOBALS['remote_urls'][0] ?? '',
	'https://api.example.com/embed/sos?tab=player&pos=te&scoring=half-ppr',
	'the fragment is fetched for exactly that view'
);
is( substr_count( $html, '<h1' ), 1, 'the shortcode prints exactly one H1 in tool mode' );
is( str_contains( $html, '>Fantasy Football Strength of Schedule</h1>' ), true, 'naming the board, from the island' );
is( str_contains( $html, 'scsos-page-data' ), false, 'and the island is stripped from the printed markup' );
is( str_contains( $html, 'data-scsos-root="1"' ), true, 'while the board itself is printed' );

is( statchasers_sos_title(), 'Fantasy Football Strength of Schedule | 2026 SOS by Team & Player', 'the title is the island\'s, as written' );
is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), 'Fantasy Football Strength of Schedule | 2026 SOS by Team & Player', 'through Rank Math, with no suffix added' );
is( apply_filters( 'rank_math/frontend/description', 'x' ), 'View 2026 fantasy football strength of schedule by team.', 'and the description, tags stripped' );
is( statchasers_sos_canonical(), 'https://example.com/p/93/', 'the canonical is the bare page whatever the view' );
is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/p/93/?tab=player&pos=te&scoring=half-ppr' ), 'https://example.com/p/93/', 'so no view mints a canonical through Rank Math' );
is( apply_filters( 'get_canonical_url', 'https://example.com/p/93/?pos=te' ), 'https://example.com/p/93/', 'or through core' );
is( statchasers_h1_mounts_a_tool(), true, 'the SOS page is a tool page' );

is( statchasers_sos_parse_copy( '<div></div>' ), array(), 'no island, no copy' );
is( statchasers_sos_strip_islands( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

echo "\nthe SOS board joins the shared lists\n";

is( str_contains( statchasers_tool_root_selector(), '.scsos' ), true, 'its root is capped at the content width like every tool' );
$GLOBALS['current_filter'] = 'statchasers_sos_shortcode_h1';
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
is( apply_filters( 'statchasers_sos_shortcode_h1', false ), true, 'the heading verdict answers for it' );
$GLOBALS['current_filter'] = '';
