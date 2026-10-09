<?php
/**
 * The strength of schedule board, in processes of its own.
 *
 * The board memoizes "does this page mount me" and the fetch its title filters
 * read, so the page that does and the article that does not cannot be asked
 * about in one process - nor after the main group has asked about a page of
 * its own. smoke.php runs this four times: STATCHASERS_SMOKE_GROUP=sosleak for
 * an ordinary article carrying the view's query args, =sos for the page that
 * mounts the board, in the "Let the tool supply the heading" mode, =sospage
 * for a sub-page (/rb/) whose fragment carries its own copy, and =sosfallback
 * for a sub-page served by an API older than the sub-pages.
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
	$GLOBALS['query']['sc_sos_page'] = 'rb';
	is( statchasers_sos_request_page(), '', 'nor is ?sc_sos_page= a page off the board\'s page' );
	is( statchasers_sos_redirect_target( array( 'pos' => 'rb' ), '' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/', 'the redirect target is pure, so it answers anywhere' );
	unset( $GLOBALS['query']['sc_sos_page'] );
	return;
}

if ( 'sospage' === $group || 'sosfallback' === $group ) {
	/*
	 * A sub-page: /nfl/fantasy-football-strength-of-schedule/rb/, which the
	 * rewrite serves as the SOS page with sc_sos_page=rb. The board is pinned
	 * to the page's position, the fragment is fetched for the page, and the
	 * title, H1, description and canonical are the page's own.
	 */
	$sos_page               = new WP_Post();
	$sos_page->ID           = 94;
	$sos_page->post_title   = 'Strength of Schedule';
	$sos_page->post_content = '[statchasers_strength_of_schedule tab="player" pos="te"]';
	$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $sos_page );
	$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
	$GLOBALS['query']['sc_sos_page'] = 'rb';
	$_GET                   = array( 'scoring' => 'half-ppr' );
	$GLOBALS['remote_urls'] = array();

	if ( 'sospage' === $group ) {
		echo "\nan SOS sub-page reads its address\n";
		$GLOBALS['http_body'] =
			'<div class="scsos is-embed" data-scsos-root="1" data-season="2026" data-page="rb"><h2>Board</h2>' .
			'<script type="application/json" class="scsos-page-data">{"title":"RB Strength of Schedule 2026: Fantasy Matchups","h1":"RB Strength of Schedule","description":"Fantasy RB strength of schedule for 2026: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to running backs.","lead":"Easiest rest-of-season RB schedule: Miami Dolphins (23.4 fantasy points allowed per game to RBs by remaining opponents). Hardest: Washington Commanders."}</script>' .
			'</div>';
	} else {
		echo "\nan SOS sub-page against an API older than the sub-pages\n";
		$GLOBALS['http_body'] =
			'<div class="scsos is-embed" data-scsos-root="1" data-season="2027"><h2>Board</h2>' .
			'<script type="application/json" class="scsos-page-data">{"title":"Fantasy Football Strength of Schedule | 2027 SOS by Team & Player","h1":"Fantasy Football Strength of Schedule","description":"View 2027 fantasy football strength of schedule.","lead":"Use the tool below."}</script>' .
			'</div>';
	}

	is( statchasers_sos_request_page(), 'rb', 'the page comes off the address' );
	is( statchasers_sos_args( array( 'tab' => 'player', 'pos' => 'te' ) ), array( 'tab' => 'player', 'pos' => 'rb', 'scoring' => 'half-ppr' ), 'its board is its own position, whatever the attribute says; tab and scoring still read' );
	is( statchasers_sos_redirect_target( $_GET, 'rb' ), '', 'without ?pos= nothing redirects' );

	$html = statchasers_sos_shortcode( array( 'tab' => 'player', 'pos' => 'te' ) );
	is(
		$GLOBALS['remote_urls'][0] ?? '',
		'https://api.example.com/embed/sos?tab=player&pos=rb&scoring=half-ppr&page=rb',
		'the fragment is fetched for the page'
	);
	is( substr_count( $html, '<h1' ), 1, 'one H1 in tool mode' );
	is( str_contains( $html, '>RB Strength of Schedule</h1>' ), true, 'naming the page' );
	is( statchasers_sos_title(), 'RB Strength of Schedule ' . ( 'sospage' === $group ? '2026' : '2027' ) . ': Fantasy Matchups', 'the title is the page\'s, the season the board\'s' );
	is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), statchasers_sos_title(), 'through Rank Math, with no suffix' );
	is( apply_filters( 'rank_math/frontend/description', 'x' ), 'Fantasy RB strength of schedule for ' . ( 'sospage' === $group ? '2026' : '2027' ) . ': rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to running backs.', 'and the description' );
	is( statchasers_sos_canonical(), 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/', 'the sub-page is its own canonical' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/?scoring=half-ppr' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/', 'and the scoring does not move it' );
	is( apply_filters( 'get_canonical_url', 'https://example.com/p/94/' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/', 'through core too' );
	if ( 'sospage' === $group ) {
		is( str_contains( $html, '<p class="sc-lo-hero__lead" data-sct-page-lead>Easiest rest-of-season RB schedule: Miami Dolphins (23.4 fantasy points allowed per game to RBs by remaining opponents). Hardest: Washington Commanders.</p>' ), true, 'the answer sentence is the hero lead, above the table' );
	} else {
		is( str_contains( $html, 'sc-lo-hero__lead' ), false, 'the overview\'s lead is not borrowed for the sub-page' );
	}
	is( str_contains( $html, 'scsos-page-data' ), false, 'the island is stripped' );

	echo "\n?pos= 301s to the sub-page\n";
	is( statchasers_sos_redirect_target( array( 'pos' => 'wr', 'tab' => 'team', 'scoring' => 'ppr' ), 'rb' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/wr/', 'the defaults are dropped on the way' );
	is( statchasers_sos_redirect_target( array( 'pos' => 'WR', 'tab' => 'player', 'scoring' => 'std' ), '' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/wr/?tab=player&scoring=std', 'a non-default view rides along' );
	is( statchasers_sos_redirect_target( array( 'pos' => 'k' ), 'rb' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/rb/', 'a position the board lacks is dropped and the page stays' );
	is( statchasers_sos_redirect_target( array( 'pos' => 'k', 'sc_sos_page' => 'rb' ), '' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/', 'or the overview, and the query var never rides along' );
	is( statchasers_sos_page_url( 'playoffs' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/playoffs/', 'the five addresses hang off the page' );
	is( statchasers_sos_page_url( 'all' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/', 'and anything else is the overview' );

	echo "\nthe five sub-pages join the sitemap\n";
	$GLOBALS['pages_by_path'] = array( 'nfl/fantasy-football-strength-of-schedule' => $sos_page );
	$sos_page->post_status    = 'publish';
	$map                      = statchasers_sos_sitemap_entries();
	is( substr_count( $map, '<url>' ), 5, 'five entries' );
	is( str_contains( $map, '<loc>https://example.com/nfl/fantasy-football-strength-of-schedule/te/</loc>' ), true, 'each a sub-page' );
	is( str_contains( $map, '<loc>https://example.com/nfl/fantasy-football-strength-of-schedule/playoffs/</loc>' ), true, 'the playoffs page too' );
	is( apply_filters( 'rank_math/sitemap/page_content', '<x/>' ), '<x/>' . $map, 'appended to the page sitemap' );
	$sos_page->post_content = '<p>moved</p>';
	is( statchasers_sos_sitemap_entries(), '', 'nothing once the page no longer mounts the board' );
	$GLOBALS['pages_by_path'] = array();
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
is( statchasers_sos_args( array( 'pos' => 'te' ) ), array( 'tab' => 'player', 'pos' => 'te', 'scoring' => 'std' ), 'the shared tab and scoring outrank the attribute; ?pos= is not a view since the sub-pages (it redirects)' );
is( statchasers_sos_redirect_target( $_GET, '' ), 'https://example.com/nfl/fantasy-football-strength-of-schedule/wr/?tab=player&scoring=std', 'which is where ?pos=wr goes instead' );

$_GET = array( 'tab' => 'fpa', 'pos' => 'k', 'scoring' => '<script>' );
is( statchasers_sos_args( array() ), array( 'tab' => 'team', 'pos' => 'rb', 'scoring' => 'ppr' ), 'anything off the whitelist falls back to the default' );
$_GET = array( 'tab' => array( 'player' ), 'pos' => 'half-ppr' );
is( statchasers_sos_query_view(), array( 'tab' => '', 'pos' => '', 'scoring' => '' ), 'an array or a value from another list is not a view' );

$_GET                    = array( 'tab' => 'player', 'pos' => 'te', 'scoring' => 'half-ppr' );
$GLOBALS['remote_urls']  = array();
$GLOBALS['http_body']    =
	'<div class="scsos is-embed" data-scsos-root="1" data-season="2026"><h2>Board</h2>' .
	'<script type="application/json" class="scsos-page-data">{"title":"Fantasy Football Strength of Schedule | 2026 SOS by Team & Player","h1":"Fantasy Football Strength of Schedule","description":"View 2026 fantasy football strength of schedule <b>by team</b>.","lead":"Use the <i>tool</i> below.","extra":1}</script>' .
	'</div>';

$html = statchasers_sos_shortcode();
is(
	$GLOBALS['remote_urls'][0] ?? '',
	'https://api.example.com/embed/sos?tab=player&pos=rb&scoring=half-ppr',
	'the fragment is fetched for exactly that view (the position is the page\'s default, not the query\'s)'
);
is( substr_count( $html, '<h1' ), 1, 'the shortcode prints exactly one H1 in tool mode' );
is( str_contains( $html, '>Fantasy Football Strength of Schedule</h1>' ), true, 'naming the board, from the island' );
is( str_contains( $html, '<p class="sc-lo-hero__lead" data-sct-page-lead>Use the tool below.</p>' ), true, 'with the lead under it, tags stripped' );
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
