<?php
/**
 * The injury tools, in processes of their own.
 *
 * The tools memoize "which page mounts me" and the fetch their title filters
 * read, so the page that does and the article that does not cannot be asked
 * about in one process. smoke.php runs this three times: STATCHASERS_SMOKE_GROUP=
 * scinleak for an ordinary article, =scin for the page that mounts the
 * analysis, and =scindb for the page that mounts the database, both in the
 * "Let the tool supply the heading" mode.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_scin_fetch' ) ) {
	fwrite( STDERR, "smoke-scin.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( 'scinleak' === $group ) {
	echo "\nthe injury tools leave other pages alone\n";

	$article               = new WP_Post();
	$article->ID           = 98;
	$article->post_title   = 'Week 7 Injury Report';
	$article->post_content = '<p>Who is out this week.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$GLOBALS['http_body']  = '<script type="application/json" class="scin-page-data">{"title":"T","h1":"H","description":"D"}</script>';

	is( statchasers_scin_title(), '', 'the article is not retitled as the tool' );
	is( statchasers_scin_canonical(), '', 'and its canonical is left alone' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/week-7-injury-report/' ), 'https://example.com/week-7-injury-report/', 'through Rank Math too' );
	is( $GLOBALS['remote_urls'] ?? array(), array(), 'and nothing was fetched for it' );
	is( statchasers_h1_mounts_a_tool(), false, 'and the heading machinery leaves it alone' );
	return;
}

$is_db = 'scindb' === $group;
echo $is_db ? "\nthe injury database prints its fragment\n" : "\nthe injury analysis prints its fragment\n";

$scin_page               = new WP_Post();
$scin_page->ID           = $is_db ? 100 : 99;
$scin_page->post_title   = $is_db ? 'NFL Injury Database' : 'Fantasy Football Injury Risk Analysis';
$scin_page->post_content = $is_db ? '[statchasers_injury_database]' : '[statchasers_injury_impact]';
$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $scin_page );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';

$_GET                   = array( 'season' => '2023', 'adp' => '60' );
$GLOBALS['remote_urls'] = array();
$h1_text                = $is_db ? 'NFL Injury Database' : 'Fantasy Football Injury Risk Analysis';
$title_text             = $is_db ? 'NFL Injury Database - StatChasers' : 'Fantasy Football Injury Risk Analysis - StatChasers';
$GLOBALS['http_body']   =
	'<div class="scin is-embed" data-scin-root="1" data-scin-page="' . ( $is_db ? 'database' : 'analysis' ) . '"><h2 class="scin-h2">Is the NFL becoming safer?</h2>' .
	'<script type="application/json" class="scin-page-data">{"title":"' . $title_text . '","h1":"' . $h1_text . '","description":"Which players are most <b>likely</b> to get hurt.","extra":1}</script>' .
	'</div>';

$html = $is_db ? statchasers_scin_db_shortcode() : statchasers_scin_shortcode();
is( $GLOBALS['remote_urls'][0] ?? '', 'https://api.example.com' . ( $is_db ? '/embed/injury-database' : '/embed/injury-impact' ), 'the one fragment is fetched, whatever the query string says' );
is( substr_count( $html, '<h1' ), 1, 'the shortcode prints exactly one H1 in tool mode' );
is( str_contains( $html, '>' . $h1_text . '</h1>' ), true, 'naming the tool, from the island' );
is( str_contains( $html, 'scin-page-data' ), false, 'and the island is stripped from the printed markup' );
is( str_contains( $html, 'data-scin-root="1"' ), true, 'while the tool itself is printed' );

is( statchasers_scin_title(), $title_text, 'the title is the island\'s, as written' );
is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), $title_text, 'through Rank Math, with no suffix added' );
is( apply_filters( 'rank_math/frontend/description', 'x' ), 'Which players are most likely to get hurt.', 'and the description, tags stripped' );
is( statchasers_scin_canonical(), 'https://example.com/p/' . $scin_page->ID . '/', 'the canonical is the bare page' );
is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/p/' . $scin_page->ID . '/?season=2023' ), 'https://example.com/p/' . $scin_page->ID . '/', 'so no query string mints a canonical through Rank Math' );
is( apply_filters( 'get_canonical_url', 'https://example.com/p/' . $scin_page->ID . '/?adp=60' ), 'https://example.com/p/' . $scin_page->ID . '/', 'or through core' );
is( statchasers_h1_mounts_a_tool(), true, 'the page is a tool-heading page' );
is( statchasers_scin_page_mounted(), $is_db ? 'database' : 'analysis', 'and the file knows which of its two pages this is' );

is( statchasers_scin_parse_copy( '<div></div>' ), array(), 'no island, no copy' );
is( statchasers_scin_strip_islands( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

if ( ! $is_db ) {
	echo "\nthe injury tools join the shared lists\n";

	is( str_contains( statchasers_tool_root_selector(), '.scin' ), true, 'their root is capped at the content width like every tool' );
	is( statchasers_proxy_allowed( 'embed/injury-impact/data/analysis' ), true, 'the browser proxy forwards the analysis slice' );
	is( statchasers_proxy_allowed( 'embed/injury-impact/data/search' ), true, 'and the search index' );
	is( statchasers_proxy_allowed( 'embed/injury-impact/data/sim' ), true, 'and the simulation' );
	is( statchasers_proxy_allowed( 'embed/injury-impact/data/player/00-0030228' ), true, 'and a player slice' );
	is( statchasers_proxy_allowed( 'embed/injury-impact/data/player/x' ), false, 'but only a GSIS id' );
	is( statchasers_proxy_allowed( 'embed/injury-impact' ), false, 'and not the fragment, which only WordPress fetches' );
	is( statchasers_proxy_allowed( 'embed/injury-database' ), false, 'either fragment' );
	$GLOBALS['current_filter'] = 'statchasers_scin_shortcode_h1';
	$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
	is( apply_filters( 'statchasers_scin_shortcode_h1', false ), true, 'the heading verdict answers for them' );
	$GLOBALS['current_filter'] = '';
}
