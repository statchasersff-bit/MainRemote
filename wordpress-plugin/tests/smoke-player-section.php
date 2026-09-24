<?php
/**
 * A player section URL describes itself, in a process of its own.
 *
 * The fragment fetch, the shortcode check and the section metadata are all
 * memoised per request, so a section request has to be the first and only one
 * this process asks about. smoke.php runs it as STATCHASERS_SMOKE_GROUP=playersection.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_player_request_meta' ) ) {
	fwrite( STDERR, "smoke-player-section.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "\na player section URL has its own title, description, canonical and crumb\n";

$nfl                  = new WP_Post();
$nfl->ID              = 500;
$players              = new WP_Post();
$players->ID          = 501;
$allen                = new WP_Post();
$allen->ID            = 502;
$allen->post_name     = 'josh-allen';
$allen->post_parent   = 501;
$allen->post_content  = '[statchasers_player]';
$GLOBALS['pages_by_path'] = array( 'nfl' => $nfl, 'nfl/players' => $players );
$GLOBALS['pages']         = array( 502 => $allen );
$GLOBALS['page']          = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $allen );
$GLOBALS['query']['sc_section'] = 'stats';
$GLOBALS['http_body'] =
	'<div class="scp" data-scp-root="1"></div>' .
	'<script type="application/json" class="scp-page-data">' .
	'{"title":"Josh Allen Stats 2026: Fantasy Points, Passing & Rushing Stats","description":"Josh Allen 2026 stats: QB season totals."}' .
	'</script>';

$profile = 'https://example.com/p/502/';

is( statchasers_player_indexed_section(), 'stats', 'the section is read off the address' );
is(
	apply_filters( 'rank_math/frontend/title', 'Josh Allen Fantasy Football Stats & Analysis | StatChasers' ),
	'Josh Allen Stats 2026: Fantasy Points, Passing & Rushing Stats | StatChasers',
	'the title is the section\'s, not the profile\'s'
);
is(
	apply_filters( 'rank_math/frontend/description', 'Josh Allen Buffalo Bills quarterback fantasy football profile.' ),
	'Josh Allen 2026 stats: QB season totals.',
	'and so is the description'
);
is( apply_filters( 'rank_math/frontend/canonical', $profile ), $profile . 'stats/', 'the canonical is the section itself' );
is( apply_filters( 'rank_math/opengraph/url', $profile ), $profile . 'stats/', 'and og:url with it' );
is( apply_filters( 'get_canonical_url', $profile ), $profile . 'stats/', 'and core\'s, without Rank Math' );

$robots = apply_filters( 'rank_math/frontend/robots', array( 'index' => 'noindex', 'follow' => 'follow' ) );
is( $robots['index'], 'index', 'it is indexable, stated rather than inherited' );

$crumbs = apply_filters(
	'rank_math/frontend/breadcrumb/items',
	array( array( 'Home', 'https://example.com/' ), array( 'Josh Allen', $profile ) )
);
is( end( $crumbs )[1], $profile . 'stats/', 'the last crumb is the section' );
is( end( $crumbs )[0], 'Stats', 'named for it' );

is(
	false === strpos( statchasers_player_strip_faq_data( $GLOBALS['http_body'] ), 'scp-page-data' ),
	true,
	'the island is stripped from what is printed'
);

echo "\nthe sitemap lists each section once, and never a redirect\n";

$GLOBALS['query']['sitemap_n'] = '';
$xml = apply_filters( 'rank_math/sitemap/page_content', '' );
foreach ( array( 'stats', 'game-log', 'outlook', 'injury', 'news', 'bio' ) as $section ) {
	is( false !== strpos( $xml, '<loc>' . $profile . $section . '/</loc>' ), true, "lists /{$section}/" );
}
is( false === strpos( $xml, 'overview' ), true, 'not /overview/, which redirects' );

$GLOBALS['query']['sitemap_n'] = '2';
is( false === strpos( (string) apply_filters( 'rank_math/sitemap/page_content', '' ), '/stats/' ), true, 'only on the first page of a paginated sitemap' );

is(
	statchasers_sitemap_drop_legacy( array( 'loc' => 'https://example.com/nfl/players/outlook/josh-allen/' ) ),
	false,
	'a legacy /nfl/players/outlook/<slug>/ page is dropped'
);
is(
	statchasers_sitemap_drop_legacy( array( 'loc' => 'https://example.com/nfl/players/josh-allen/' ) )['loc'],
	'https://example.com/nfl/players/josh-allen/',
	'a profile is kept'
);
