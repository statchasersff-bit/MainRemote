<?php
/**
 * The rookie hit rate tool, in processes of its own.
 *
 * The tool memoises "does this page mount me" and the fetch its title filters
 * read, so the page that does and the article that does not cannot be asked
 * about in one process. smoke.php runs this twice: STATCHASERS_SMOKE_GROUP=
 * rhrleak for an ordinary article, and =rhr for the page that mounts the tool,
 * in the "Let the tool supply the heading" mode.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_rhr_fetch' ) ) {
	fwrite( STDERR, "smoke-rhr.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( 'rhrleak' === $group ) {
	echo "\nthe rookie hit rate tool leaves other pages alone\n";

	$article               = new WP_Post();
	$article->ID           = 94;
	$article->post_title   = 'Rookie Draft Primer';
	$article->post_content = '<p>Draft these rookies.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$GLOBALS['http_body']  = '<script type="application/json" class="schr-page-data">{"title":"T","h1":"H","description":"D"}</script>';

	is( statchasers_rhr_title(), '', 'the article is not retitled as the tool' );
	is( statchasers_rhr_canonical(), '', 'and its canonical is left alone' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/rookie-draft-primer/' ), 'https://example.com/rookie-draft-primer/', 'through Rank Math too' );
	is( $GLOBALS['remote_urls'] ?? array(), array(), 'and nothing was fetched for it' );
	is( statchasers_h1_mounts_a_tool(), false, 'and the heading machinery leaves it alone' );
	return;
}

echo "\nthe rookie hit rate tool prints its fragment\n";

$rhr_page               = new WP_Post();
$rhr_page->ID           = 95;
$rhr_page->post_title   = 'Rookie Hit Rates';
$rhr_page->post_content = '[statchasers_rookie_hit_rates]';
$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $rhr_page );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';

$_GET                   = array( 'tab' => 'players', 'format' => '1qb' );
$GLOBALS['remote_urls'] = array();
$GLOBALS['http_body']   =
	'<div class="schr is-embed" data-schr-root="1"><h2>Rookie Hit Rates</h2>' .
	'<script type="application/json" class="schr-page-data">{"title":"Dynasty Rookie Hit Rates by Position, Round & Pick (2017-2025)","h1":"Dynasty Rookie Hit Rates","description":"How often dynasty rookie picks hit <b>by round</b>.","extra":1}</script>' .
	'</div>';

$html = statchasers_rhr_shortcode();
is( $GLOBALS['remote_urls'][0] ?? '', 'https://api.example.com/embed/rookie-hit-rates', 'the one fragment is fetched, whatever the query string says' );
is( substr_count( $html, '<h1' ), 1, 'the shortcode prints exactly one H1 in tool mode' );
is( str_contains( $html, '>Dynasty Rookie Hit Rates</h1>' ), true, 'naming the tool, from the island' );
is( str_contains( $html, 'schr-page-data' ), false, 'and the island is stripped from the printed markup' );
is( str_contains( $html, 'data-schr-root="1"' ), true, 'while the tool itself is printed' );

is( statchasers_rhr_title(), 'Dynasty Rookie Hit Rates by Position, Round & Pick (2017-2025)', 'the title is the island\'s, as written' );
is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), 'Dynasty Rookie Hit Rates by Position, Round & Pick (2017-2025)', 'through Rank Math, with no suffix added' );
is( apply_filters( 'rank_math/frontend/description', 'x' ), 'How often dynasty rookie picks hit by round.', 'and the description, tags stripped' );
is( statchasers_rhr_canonical(), 'https://example.com/p/95/', 'the canonical is the bare page' );
is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/p/95/?tab=players' ), 'https://example.com/p/95/', 'so no query string mints a canonical through Rank Math' );
is( apply_filters( 'get_canonical_url', 'https://example.com/p/95/?format=1qb' ), 'https://example.com/p/95/', 'or through core' );
is( statchasers_h1_mounts_a_tool(), true, 'the rookie hit rate page is a tool page' );

is( statchasers_rhr_parse_copy( '<div></div>' ), array(), 'no island, no copy' );
is( statchasers_rhr_strip_islands( '<div>no island</div>' ), '<div>no island</div>', 'a fragment without one is untouched' );

echo "\nthe rookie hit rate tool joins the shared lists\n";

is( str_contains( statchasers_tool_root_selector(), '.schr' ), true, 'its root is capped at the content width like every tool' );
is( statchasers_proxy_allowed( 'embed/rookie-hit-rates/data' ), true, 'the browser proxy forwards its dataset' );
is( statchasers_proxy_allowed( 'embed/rookie-hit-rates' ), false, 'and not the fragment, which only WordPress fetches' );
$GLOBALS['current_filter'] = 'statchasers_rhr_shortcode_h1';
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'on';
is( apply_filters( 'statchasers_rhr_shortcode_h1', false ), true, 'the heading verdict answers for it' );
$GLOBALS['current_filter'] = '';
