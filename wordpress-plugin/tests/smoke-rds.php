<?php
/**
 * The redraft strategy tool, in processes of its own.
 *
 * The tool memoizes "does this page mount me" and the fetch its title filters
 * read, so the page that does and the article that does not cannot be asked
 * about in one process. smoke.php runs this twice: STATCHASERS_SMOKE_GROUP=
 * rdsleak for an ordinary article, and =rds for the page that mounts the tool.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_rds_fetch' ) ) {
	fwrite( STDERR, "smoke-rds.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( 'rdsleak' === $group ) {
	echo "\nthe redraft strategy tool leaves other pages alone\n";

	$article               = new WP_Post();
	$article->ID           = 96;
	$article->post_title   = 'Zero RB Is Back';
	$article->post_content = '<p>Draft receivers early.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$GLOBALS['http_body']  = '<script type="application/json" class="scds-page-data">{"title":"T","h1":"H","description":"D"}</script>';

	is( statchasers_rds_title(), '', 'the article is not retitled as the tool' );
	is( statchasers_rds_canonical(), '', 'and its canonical is left alone' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/zero-rb-is-back/' ), 'https://example.com/zero-rb-is-back/', 'through Rank Math too' );
	is( $GLOBALS['remote_urls'] ?? array(), array(), 'and nothing was fetched for it' );
	is( statchasers_h1_mounts_a_tool(), false, 'and the heading machinery leaves it alone' );
	return;
}

echo "\nthe redraft strategy tool prints its fragment\n";

$rds_page               = new WP_Post();
$rds_page->ID           = 97;
$rds_page->post_title   = 'Fantasy Football Redraft Strategy Analysis';
$rds_page->post_content = '<h1 class="sc-lo-hero__h1">Redraft Draft Strategy Analysis</h1>[statchasers_redraft_strategy]';
$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $rds_page );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';

$_GET                   = array( 'season' => 'compare', 'qb' => 'superflex' );
$GLOBALS['remote_urls'] = array();
$GLOBALS['http_body']   =
	'<div class="scds is-embed" data-scds-root="1"><h2 class="scds-h2">Strategy Ranking</h2>' .
	'<script type="application/json" class="scds-page-data">{"title":"Fantasy Football Redraft Strategy Analysis - StatChasers","h1":"Redraft Draft Strategy Analysis","description":"What real draft data reveals <b>about</b> the strategies.","extra":1}</script>' .
	'</div>';

$html = statchasers_rds_shortcode();
is( $GLOBALS['remote_urls'][0] ?? '', 'https://api.example.com/embed/redraft-strategy', 'the one fragment is fetched, whatever the query string says' );
is( substr_count( $html, '<h1' ), 0, 'the shortcode prints no H1, even in tool mode: the page\'s hero is its editor\'s' );
is( str_contains( $html, 'scds-page-data' ), false, 'and the island is stripped from the printed markup' );
is( str_contains( $html, 'data-scds-root="1"' ), true, 'while the tool itself is printed' );

is( statchasers_rds_title(), 'Fantasy Football Redraft Strategy Analysis - StatChasers', 'the title is the island\'s, as written' );
is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), 'Fantasy Football Redraft Strategy Analysis - StatChasers', 'through Rank Math, with no suffix added' );
is( apply_filters( 'rank_math/frontend/description', 'x' ), 'What real draft data reveals about the strategies.', 'and the description, tags stripped' );
is( statchasers_rds_canonical(), 'https://example.com/p/97/', 'the canonical is the bare page' );
is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/p/97/?season=compare' ), 'https://example.com/p/97/', 'so no query string mints a canonical through Rank Math' );
is( apply_filters( 'get_canonical_url', 'https://example.com/p/97/?qb=superflex' ), 'https://example.com/p/97/', 'or through core' );
is( statchasers_h1_mounts_a_tool(), false, 'the page is not a tool-heading page: its H1 is the editor\'s' );

is( statchasers_rds_parse_copy( '<div></div>' ), array(), 'no island, no copy' );
is( statchasers_rds_strip_islands( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

echo "\nthe redraft strategy tool joins the shared lists\n";

is( str_contains( statchasers_tool_root_selector(), '.scds' ), true, 'its root is capped at the content width like every tool' );
is( statchasers_proxy_allowed( 'embed/redraft-strategy/data/combo/one_qb__ppr__no_tep__12__2025' ), true, 'the browser proxy forwards a combo' );
is( statchasers_proxy_allowed( 'embed/redraft-strategy/data/trends/one_qb__ppr__no_tep__12' ), true, 'and a trend' );
is( statchasers_proxy_allowed( 'embed/redraft-strategy/data/boards' ), true, 'and the boards' );
is( statchasers_proxy_allowed( 'embed/redraft-strategy' ), false, 'and not the fragment, which only WordPress fetches' );
$GLOBALS['current_filter'] = 'statchasers_rds_shortcode_h1';
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
is( apply_filters( 'statchasers_rds_shortcode_h1', false ), true, 'the heading verdict answers for it when a theme turns it on' );
$GLOBALS['current_filter'] = '';
