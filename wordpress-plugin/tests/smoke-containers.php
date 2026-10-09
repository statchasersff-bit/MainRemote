<?php
/**
 * The container-page checks, in a process of their own.
 *
 * Split out of smoke.php rather than sitting at the bottom of it for the reason
 * given there: the predicates these call memoize, so the answers this file
 * needs and the answers the main group needs cannot both exist in one process.
 * smoke.php includes this with STATCHASERS_SMOKE_GROUP=containers set; running
 * it directly does nothing, because the plugin is not loaded.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_team_is_container_page' ) ) {
	fwrite( STDERR, "smoke-containers.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "\nthe players container mounts itself\n";
/*
 * The failure this covers: a container page built in Divi is neither empty nor
 * the old stub, so statchasers_player_write_index() leaves it alone - correctly,
 * it is the editor's page - and /nfl/players/ ships with a heading, a sentence
 * and no roster under it. The container is the one page that mounts itself.
 *
 * Only the positive case is asserted, and only once: the predicate memoizes,
 * which is what makes it cheap on a Divi page that asks hundreds of times.
 */
$container = new WP_Post();
$container->ID           = 42;
$container->post_name    = 'players';
$container->post_content = '<p>Search and explore fantasy football players.</p>';

$GLOBALS['page']          = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $container, 'current' => $container );
$GLOBALS['pages_by_path'] = array( STATCHASERS_PLAYER_PATH => $container );
$GLOBALS['http_body']     = '<div class="scp is-embed" data-scp-index="1">roster</div>';

is( statchasers_player_is_container_page(), true, 'the page at nfl/players is the container' );
is( statchasers_player_post_has_index_shortcode(), false, 'and this one carries no mount of its own' );
is(
	str_contains( statchasers_player_auto_index( '<p>Copy.</p>' ), 'data-scp-index' ),
	true,
	'so the roster is appended to it'
);
is(
	statchasers_player_auto_index( '<p>Copy.</p>' ),
	'<p>Copy.</p>',
	'and appended once per request, not once per the_content call'
);

$GLOBALS['page'] = array();

echo "\nthe teams container mounts itself\n";
/*
 * The same failure, on the other container, and the reason this block exists at
 * all: /nfl/players/ grew the self-mount and /nfl/teams/ did not, so the hubs'
 * own parent shipped as a paragraph and 32 bullets in the theme's list styling
 * - no grid, and no team.css either, because the enqueue gate only asked about
 * shortcodes and the container carries none.
 *
 * Asserted the same way and for the same reason: the predicate memoizes, so the
 * positive case is the one case a process can see.
 */
$teams = new WP_Post();
$teams->ID           = 43;
$teams->post_name    = 'teams';
$teams->post_content = '<p>Every NFL team, one hub each.</p>';

$GLOBALS['page']          = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $teams, 'current' => $teams );
$GLOBALS['pages_by_path'] = array( STATCHASERS_TEAM_PATH => $teams );
$GLOBALS['http_body']     = '<div class="sct is-embed" data-sct-index="1">grid</div>';

is( statchasers_team_is_container_page(), true, 'the page at nfl/teams is the container' );
is( statchasers_team_post_has_index_shortcode(), false, 'and this one carries no mount of its own' );
is(
	str_contains( statchasers_team_auto_index( '<p>Copy.</p>' ), 'data-sct-index' ),
	true,
	'so the grid is appended to it'
);
is(
	statchasers_team_auto_index( '<p>Copy.</p>' ),
	'<p>Copy.</p>',
	'and appended once per request, not once per the_content call'
);

$GLOBALS['page'] = array();
