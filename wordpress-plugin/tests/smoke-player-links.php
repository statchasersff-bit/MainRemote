<?php
/**
 * A link to a player page this site has not published becomes a plain name.
 *
 * The published-slug list is memoised per request, so it gets a process of its
 * own. smoke.php runs it as STATCHASERS_SMOKE_GROUP=playerlinks.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_player_unlink_missing' ) ) {
	fwrite( STDERR, "smoke-player-links.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "\nplayer links to pages that are not published are unlinked\n";

$nfl     = new WP_Post();
$nfl->ID = 500;
$players = new WP_Post();
$players->ID = 501;
$GLOBALS['pages_by_path'] = array( 'nfl' => $nfl, 'nfl/players' => $players );

// Published: Allen and McBride. Dobbs was indexed by the API on 2026-09-24 and
// has no page yet — the recap links a crawl found 404ing.
$GLOBALS['wpdb'] = new class {
	public $posts = 'wp_posts';
	public $asked = '';
	public function prepare( $q, ...$a ) { return $q; }
	public function get_col( $q ) { $this->asked = $q; return array( 'josh-allen', 'trey-mcbride' ); }
	public function get_results( $q ) { return array(); }
};

$live = '<a class="sct-mu-ps-link sct-player-link" href="https://statchasers.com/nfl/players/trey-mcbride/" target="_top">Trey McBride</a>';
$dead = '<a class="sct-mu-ps-link sct-player-link" href="https://statchasers.com/nfl/players/joshua-dobbs/" target="_top">Joshua Dobbs</a>';

// home_url() is https://example.com in the stubs; the links name that host.
$live = str_replace( 'statchasers.com', 'example.com', $live );
$dead = str_replace( 'statchasers.com', 'example.com', $dead );

is( statchasers_player_unlink_missing( $live ), $live, 'a published profile keeps its link' );
is(
	statchasers_player_unlink_missing( $dead ),
	'<span class="sct-mu-ps-link">Joshua Dobbs</span>',
	'an unpublished one is the name, in the span the API prints for an unlinked player'
);
is( strpos( $GLOBALS['wpdb']->asked, "post_status = 'publish'" ) !== false, true, 'a draft does not count as published' );

is(
	apply_filters( 'do_shortcode_tag', $live . $dead, 'statchasers_matchup', array(), array() ),
	$live . '<span class="sct-mu-ps-link">Joshua Dobbs</span>',
	'every statchasers_ shortcode goes through it'
);
is(
	apply_filters( 'do_shortcode_tag', $dead, 'sc_team_hub', array(), array() ),
	'<span class="sct-mu-ps-link">Joshua Dobbs</span>',
	'and the Divi hub module'
);
is( apply_filters( 'do_shortcode_tag', $dead, 'gallery', array(), array() ), $dead, 'but not somebody else\'s shortcode' );

is(
	statchasers_player_unlink_missing( '<a class="sct-outlook-link" href="https://www.example.com/nfl/players/joshua-dobbs/" target="_top">Joshua Dobbs</a>' ),
	'Joshua Dobbs',
	'a link-only class leaves bare text, and www. is the same host'
);
is(
	statchasers_player_unlink_missing( '<a class="sct-player-hit" href="/nfl/players/joshua-dobbs/" aria-label="Joshua Dobbs, QB"></a>' ),
	'',
	'a stretched hit area with nothing to cover goes, relative href included'
);
is(
	statchasers_player_unlink_missing( '<a href="https://example.com/nfl/players/joshua-dobbs/stats/?format=half&amp;x=1#log">Stats</a>' ),
	'Stats',
	'a section, query and hash are still that player\'s page'
);

$kept = array(
	'another host'        => '<a href="https://other.example.org/nfl/players/joshua-dobbs/">Dobbs</a>',
	'the retired layout'  => '<a href="https://example.com/nfl/players/outlook/joshua-dobbs/">Dobbs</a>',
	'the players index'   => '<a href="https://example.com/nfl/players/">All players</a>',
	'a team hub'          => '<a href="https://example.com/nfl/teams/arizona-cardinals/">Cardinals</a>',
);
foreach ( $kept as $what => $html ) {
	is( statchasers_player_unlink_missing( $html ), $html, "$what is left alone" );
}
