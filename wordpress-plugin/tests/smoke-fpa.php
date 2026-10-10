<?php
/**
 * The Fantasy Points Allowed page's addresses, in processes of their own.
 *
 * The module memoizes "does this page mount me" and the fetch its title
 * filters read, so the page that does and the article that does not cannot be
 * asked about in one process. smoke.php runs this three times:
 * STATCHASERS_SMOKE_GROUP=fpaleak for an ordinary article carrying ?season=,
 * =fpa for the page itself, whose fragment carries the live table's island,
 * and =fpaarchive for /2025/, whose fragment carries the archive's.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_fpa_args' ) ) {
	fwrite( STDERR, "smoke-fpa.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$fpa_hero =
	'<section class="sc-lo sc-lo-hero" aria-labelledby="sc-lo-hero-title"><div class="sc-lo-hero__inner"><div class="sc-lo-hero__copy">' . "\n" .
	'<h1 id="sc-lo-hero-title" class="sc-lo-hero__h1">' . "\n" . 'Fantasy Points Allowed by Position' . "\n" . '      </h1>' . "\n" .
	'<div class="sc-lo-hero__underline" aria-hidden="true"></div>' . "\n" .
	'<p class="sc-lo-hero__lead">Fantasy points allowed by position helps.</p></div></div></section>';

if ( 'fpaleak' === $group ) {
	echo "\n?season= and the season query var mean nothing off the FPA page\n";

	$article               = new WP_Post();
	$article->ID           = 95;
	$article->post_title   = 'Waiver Wire Week 5';
	$article->post_content = '<p>Pick up these players.</p>';
	$GLOBALS['page']       = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $article );
	$_GET                  = array( 'season' => '2025', 'format' => 'ppr' );
	$GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] = '2025';
	$GLOBALS['remote_urls'] = array();
	$GLOBALS['http_body']   = '<script type="application/json" class="scf-page-data">{"title":"T","h1":"H","description":"D","kind":"archive","season":2025}</script>';

	is( statchasers_fpa_request_season(), 0, 'the season var is not read off an article' );
	is( statchasers_fpa_title(), '', 'so the article is not retitled' );
	is( statchasers_fpa_canonical(), '', 'and its canonical is left alone' );
	is( apply_filters( 'rank_math/frontend/title', 'Waiver Wire | Site' ), 'Waiver Wire | Site', 'through Rank Math too' );
	is( apply_filters( 'the_content', '<p>Pick up these players.</p>' ), '<p>Pick up these players.</p>', 'its content is not rewritten' );
	statchasers_fpa_season_redirect();
	is( $GLOBALS['remote_urls'], array(), 'and nothing was fetched for it' );
	unset( $GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] );

	echo "\nthe redirect target is pure, so it answers anywhere\n";
	is( statchasers_fpa_redirect_target( array( 'season' => '2025' ), 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', '?season=2025 is the archive address' );
	is( statchasers_fpa_redirect_target( array( 'season' => '2026' ), 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', '?season= naming the current season is the page' );
	is( statchasers_fpa_redirect_target( array( 'season' => '2025', 'format' => 'ppr', 'view' => 'adjusted' ), 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/?format=ppr&view=adjusted', 'a non-default format and view ride along' );
	is( statchasers_fpa_redirect_target( array( 'season' => '2025', 'format' => 'half', 'view' => 'raw' ), 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'the defaults are dropped on the way' );
	is( statchasers_fpa_redirect_target( array( 'season' => 'abc' ), 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', 'a season that is not one is dropped' );
	is( statchasers_fpa_redirect_target( array( 'season' => '3000' ), 2025, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'and on an archive the archive stays' );
	is( statchasers_fpa_redirect_target( array(), 2026, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', '/2026/ - the current season by name - is the page' );
	is( statchasers_fpa_redirect_target( array(), 2026, 0, true ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', 'as is any address whose table came back live' );
	is( statchasers_fpa_redirect_target( array(), 2025, 2026 ), '', 'an archive address stays put' );
	is( statchasers_fpa_redirect_target( array( 'format' => 'ppr' ), 0, 2026 ), '', 'and so does the page with its view in the query' );
	is( statchasers_fpa_page_url( 2025 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'a season hangs off the page' );
	is( statchasers_fpa_page_url( 0 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', 'and 0 is the page' );

	echo "\nthe hero rewrite is pure\n";
	$out = statchasers_fpa_rewrite_hero( $fpa_hero, 'Fantasy Points Allowed by Position: Weeks 1–5, 2026', 'Updated Oct 8, through Week 5' );
	is( substr_count( $out, '<h1' ), 1, 'one H1' );
	is( str_contains( $out, '<h1 id="sc-lo-hero-title" class="sc-lo-hero__h1">Fantasy Points Allowed by Position: Weeks 1–5, 2026</h1>' ), true, 'its text is the week range' );
	is( str_contains( $out, '</div><p class="sc-lo-hero__updated scf-updated">Updated Oct 8, through Week 5</p>' . "\n" . '<p class="sc-lo-hero__lead">' ), true, 'the Updated line follows the gold rule, above the lead' );
	is( str_contains( $out, 'Fantasy points allowed by position helps.' ), true, 'the lead is kept' );
	is( statchasers_fpa_rewrite_hero( $fpa_hero, '', '' ), $fpa_hero, 'nothing to say, nothing changed' );
	$bare = '<p>intro</p><div class="scf is-embed" data-scf-root="1">table</div>';
	is( statchasers_fpa_rewrite_hero( $bare, 'H', 'Updated Oct 8, through Week 5' ), '<p>intro</p><p class="sc-lo-hero__updated scf-updated">Updated Oct 8, through Week 5</p><div class="scf is-embed" data-scf-root="1">table</div>', 'with no hero the line goes in front of the table' );
	is( str_contains( statchasers_fpa_rewrite_hero( $bare, 'H', '', true ), '<h1 id="' . STATCHASERS_HEADING_ID . '" class="sc-lo-hero__h1" data-sct-page-title>H</h1>' ), true, 'and in tool mode a generated hero goes with it' );
	is( statchasers_fpa_rewrite_hero( '<p>no table either</p>', 'H', 'U' ), '<p>no table either</p>', 'nowhere to put it, nothing changed' );
	$dollars = statchasers_fpa_rewrite_hero( $fpa_hero, 'Costs $1 & more', 'Updated $2' );
	is( str_contains( $dollars, '>Costs $1 &amp; more</h1>' ), true, 'a heading with a dollar sign is printed as written' );
	is( str_contains( $dollars, '>Updated $2</p>' ), true, 'and so is the line' );
	return;
}

/*
 * The page itself (`fpa`) or an archive address (`fpaarchive`): the fragment
 * is fetched for the address's season, the title, H1, description and
 * canonical are the API's, the hero is rewritten and the modified time is the
 * data's.
 */
$fpa_page               = new WP_Post();
$fpa_page->ID           = 96;
$fpa_page->post_title   = 'Fantasy Points Allowed by Position';
$fpa_page->post_content = '[statchasers_fpa]';
$GLOBALS['page']        = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $fpa_page );
$GLOBALS['options'][ STATCHASERS_H1_MODE_OPTION ] = 'tool';
$GLOBALS['remote_urls'] = array();
$_GET                   = array( 'format' => 'ppr' );

if ( 'fpaarchive' === $group ) {
	echo "\nan FPA archive address reads its season\n";
	$GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] = '2025';
	$GLOBALS['http_body'] =
		'<div class="scf is-embed" data-scf-root="1" data-season="2025" data-kind="archive"><p class="scf-answer">Softest.</p></div>' .
		'<script type="application/json" class="scf-page-data">{"title":"Fantasy Points Allowed by Position 2025 (Full Season)","h1":"2025 Fantasy Points Allowed by Position","description":"Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses over the full 2025 season (Weeks 1–17), raw and schedule-adjusted.","answer":"Softest.","updatedLine":"Full 2025 season, Weeks 1–17","updatedIso":"","updatedAt":"","season":2025,"kind":"archive","weekNumber":17,"archiveSeasons":[]}</script>';

	is( statchasers_fpa_request_season(), 2025, 'the season comes off the address' );
	is( statchasers_fpa_args( array( 'season' => '2024' ) ), array( 'format' => 'ppr', 'view' => 'raw', 'season' => 2025 ), 'its table is the address\'s season, whatever the attribute says; format still reads' );
	$html = statchasers_fpa_shortcode( array() );
	is( $GLOBALS['remote_urls'][0] ?? '', 'https://api.example.com/embed/fpa?format=ppr&view=raw&season=2025', 'the fragment is fetched for the season' );
	is( str_contains( $html, 'scf-page-data' ), false, 'the island is stripped' );
	is( str_contains( $html, 'scf-answer' ), true, 'and the table printed' );
	is( statchasers_fpa_title(), 'Fantasy Points Allowed by Position 2025 (Full Season)', 'the title is the archive\'s' );
	is( apply_filters( 'rank_math/frontend/title', 'Page | Site' ), statchasers_fpa_title(), 'through Rank Math, with no suffix' );
	is( apply_filters( 'pre_get_document_title', 'Page | Site' ), statchasers_fpa_title(), 'and through core' );
	is( apply_filters( 'rank_math/frontend/description', 'x' ), 'Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses over the full 2025 season (Weeks 1–17), raw and schedule-adjusted.', 'and the description' );
	is( statchasers_fpa_canonical(), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'the archive is its own canonical' );
	is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/?format=ppr' ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'and the format does not move it' );
	is( apply_filters( 'get_canonical_url', 'https://example.com/p/96/' ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/', 'through core too' );
	is( apply_filters( 'the_title', 'Fantasy Points Allowed by Position', 96 ), '2025 Fantasy Points Allowed by Position', 'the theme\'s title would be the archive\'s H1' );
	$content = apply_filters( 'the_content', $fpa_hero . $html );
	is( str_contains( $content, '<h1 id="sc-lo-hero-title" class="sc-lo-hero__h1">2025 Fantasy Points Allowed by Position</h1>' ), true, 'the hand-written hero names the season' );
	is( str_contains( $content, '<p class="sc-lo-hero__updated scf-updated">Full 2025 season, Weeks 1–17</p>' ), true, 'and says it is the full season' );
	is( apply_filters( 'rank_math/opengraph/facebook/og_updated_time', '2026-09-21T22:31:09+00:00' ), '2026-09-21T22:31:09+00:00', 'a finished season leaves the modified time alone' );
	is( apply_filters( 'rank_math/json_ld', array( 'b' => array( '@type' => 'BreadcrumbList' ) ) ), array( 'b' => array( '@type' => 'BreadcrumbList' ) ), 'and adds no dateModified' );
	is( statchasers_fpa_faq_items(), array(), 'no FAQ on an archive: the fragment carries none' );
	$fetched = count( $GLOBALS['remote_urls'] );
	statchasers_fpa_season_redirect();
	is( count( $GLOBALS['remote_urls'] ), $fetched, 'the redirect check reads the memoized fetch, and does not redirect an archive' );
	foreach ( $GLOBALS['remote_urls'] as $url ) {
		is( str_contains( $url, 'season=2025' ), true, 'every fetch on the archive address names its season' );
	}
	unset( $GLOBALS['query'][ STATCHASERS_FPA_SEASON_VAR ] );
	return;
}

echo "\nthe FPA page reads the live table's island\n";
$GLOBALS['http_body'] =
	'<div class="scf is-embed" data-scf-root="1" data-season="2026" data-kind="live"><p class="scf-answer">Softest matchups through Week 5: Detroit allows the most fantasy points to QBs (26.7 per game).</p></div>' .
	'<script type="application/json" class="scf-faq-data">[{"q":"What does FPA mean in fantasy football?","a":"FPA stands for Fantasy Points Allowed."}]</script>' .
	'<script type="application/json" class="scf-page-data">{"title":"Fantasy Points Allowed by Position 2026 (Weeks 1–5)","h1":"Fantasy Points Allowed by Position: Weeks 1–5, 2026","description":"Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses through Week 5 of 2026, raw and schedule-adjusted. Updated Oct 8.","answer":"Softest matchups through Week 5: Detroit allows the most fantasy points to QBs (26.7 per game).","updatedLine":"Updated Oct 8, through Week 5","updatedIso":"2026-10-08","updatedAt":"2026-10-08T21:39:10.927Z","season":2026,"kind":"live","weekNumber":5,"archiveSeasons":[2025]}</script>';

is( statchasers_fpa_request_season(), 0, 'the page itself names no season' );
is( statchasers_fpa_args( array() ), array( 'format' => 'ppr', 'view' => 'raw', 'season' => 0 ), 'and asks for the current table' );
$html = statchasers_fpa_shortcode( array() );
is( $GLOBALS['remote_urls'][0] ?? '', 'https://api.example.com/embed/fpa?format=ppr&view=raw', 'fetched without a season' );
is( str_contains( $html, 'scf-page-data' ), false, 'the page-data island is stripped' );
is( str_contains( $html, 'scf-faq-data' ), false, 'and so is the FAQ island' );
is( statchasers_fpa_title(), 'Fantasy Points Allowed by Position 2026 (Weeks 1–5)', 'the title carries the week range' );
is( apply_filters( 'rank_math/frontend/title', 'Fantasy Points Allowed by Position | StatChasers' ), 'Fantasy Points Allowed by Position 2026 (Weeks 1–5)', 'through Rank Math, with no suffix' );
is( apply_filters( 'rank_math/frontend/description', 'Compare fantasy points allowed.' ), 'Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses through Week 5 of 2026, raw and schedule-adjusted. Updated Oct 8.', 'the description is the API\'s' );
is( statchasers_fpa_canonical(), 'https://example.com/p/96/', 'the page is its own canonical' );
is( apply_filters( 'rank_math/frontend/canonical', 'https://example.com/p/96/?format=ppr' ), 'https://example.com/p/96/', 'and the format does not move it' );
is( apply_filters( 'rank_math/opengraph/url', 'x' ), 'https://example.com/p/96/', 'nor og:url' );

$content = apply_filters( 'the_content', $fpa_hero . $html );
is( substr_count( $content, '<h1' ), 1, 'one H1' );
is( str_contains( $content, '<h1 id="sc-lo-hero-title" class="sc-lo-hero__h1">Fantasy Points Allowed by Position: Weeks 1–5, 2026</h1>' ), true, 'the hand-written hero carries the week range' );
is( substr_count( $content, 'scf-updated' ), 1, 'the Updated line, once' );
is( str_contains( $content, '<div class="sc-lo-hero__underline" aria-hidden="true"></div><p class="sc-lo-hero__updated scf-updated">Updated Oct 8, through Week 5</p>' ), true, 'under the gold rule' );
is( apply_filters( 'the_content', $content ), $content, 'a second pass of the content filter changes nothing' );

echo "\nthe modified time is the data's\n";
is( apply_filters( 'rank_math/opengraph/facebook/og_updated_time', '2026-09-21T22:31:09+00:00' ), '2026-10-08T21:39:10.927Z', 'og:updated_time' );
is( apply_filters( 'rank_math/opengraph/facebook/article:modified_time', '2026-09-21T22:31:09+00:00' ), '2026-10-08T21:39:10.927Z', 'article:modified_time, either spelling of the hook' );
$graph = apply_filters( 'rank_math/json_ld', array( 'b' => array( '@type' => 'BreadcrumbList' ) ) );
is( isset( $graph['statchasersFpaFaq']['@type'] ) && 'FAQPage' === $graph['statchasersFpaFaq']['@type'], true, 'the FAQ node is built from the island' );
is( $graph['statchasersFpaPage']['dateModified'] ?? '', '2026-10-08', 'a WebPage node carries dateModified as a date' );
is( $graph['statchasersFpaPage']['@id'] ?? '', 'https://example.com/p/96/#webpage', 'named by the canonical' );
is( $graph['statchasersFpaFaq']['isPartOf'] ?? null, array( '@id' => 'https://example.com/p/96/#webpage' ), 'and the FAQ is part of it' );
$graph = apply_filters( 'rank_math/json_ld', array( 'w' => array( '@type' => 'WebPage', 'name' => 'x' ), 'b' => array( '@type' => 'BreadcrumbList' ) ) );
is( $graph['w']['dateModified'] ?? '', '2026-10-08', 'a WebPage Rank Math already printed gets the date instead' );
is( isset( $graph['statchasersFpaPage'] ), false, 'and no second one is added' );

echo "\n?season= 301s\n";
$_GET = array( 'season' => '2025', 'format' => 'ppr' );
is( statchasers_fpa_redirect_target( $_GET, 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/2025/?format=ppr', '?season=2025 goes to the archive, PPR along for the ride' );
$_GET = array( 'season' => '2026' );
is( statchasers_fpa_redirect_target( $_GET, 0, 2026 ), 'https://example.com/nfl/fantasy-points-allowed-by-position/', 'and ?season=2026 to the page' );
$_GET = array();

echo "\nthe archive seasons join the sitemap\n";
$GLOBALS['pages_by_path'] = array( 'nfl/fantasy-points-allowed-by-position' => $fpa_page );
$map                      = statchasers_fpa_sitemap_entries();
is( substr_count( $map, '<url>' ), 1, 'one entry per finished season' );
is( str_contains( $map, '<loc>https://example.com/nfl/fantasy-points-allowed-by-position/2025/</loc>' ), true, 'the 2025 archive' );
is( apply_filters( 'rank_math/sitemap/page_content', '<x/>' ), '<x/>' . $map, 'appended to the page sitemap' );
$fpa_page->post_content = '<p>moved</p>';
is( statchasers_fpa_sitemap_entries(), '', 'nothing once the page no longer mounts the table' );
$fpa_page->post_content = '[statchasers_fpa]';
add_filter( 'statchasers_fpa_page_urls', '__return_false' );
is( statchasers_fpa_sitemap_entries(), '', 'nor with the archive addresses switched off' );
$GLOBALS['pages_by_path'] = array();
