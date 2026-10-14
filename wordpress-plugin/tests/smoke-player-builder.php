<?php
/**
 * The player page builder cannot make two pages for one player, and the
 * sitemap does not list the pages the plugin has already said noindex to.
 *
 * In a process of its own: statchasers_player_roster_row() and
 * statchasers_player_post_left_roster() memoize across a request, so the roster
 * and the container have to be the first ones this process sees. smoke.php
 * runs it as STATCHASERS_SMOKE_GROUP=playerbuilder.
 *
 * Two bugs, both from 2026-10-14's audit:
 *
 *  - Rank Math's sitemap passes a stdClass row to `rank_math/sitemap/entry`,
 *    and the drop rule demanded a WP_Post, so it dropped nothing: profiles of
 *    players who had left the roster (noindex) were still listed.
 *  - Two builds ran at once on 2026-09-20 and WordPress's slug suffixing let
 *    both inserts succeed: twenty-seven `<slug>-2` / `-3` pages.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_player_build_batch' ) ) {
	fwrite( STDERR, "smoke-player-builder.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

/*
 * A $wpdb that holds the option row the lock is, and reads the page tree the
 * builder writes. smoke.php's shared one answers nothing to everything, which
 * is right for every other test and wrong for a lock: an INSERT that always
 * reports zero rows is a lock nobody can take.
 */
$GLOBALS['wpdb'] = new class {
	public $posts   = 'wp_posts';
	public $options = 'wp_options';
	/** When true, the builder's opening page list is empty - the memo is blind. */
	public $blind = false;

	public function prepare( $q, ...$a ) {
		$quoted = array_map( static fn( $v ) => "'" . str_replace( "'", "''", (string) $v ) . "'", $a );
		return vsprintf( str_replace( '%d', '%s', (string) $q ), $quoted );
	}

	public function esc_like( $s ) {
		return $s;
	}

	/** statchasers_player_page_status(): every non-trash page under the container. */
	public function get_results( $q ) {
		if ( $this->blind || ! preg_match( "/post_parent = '(\d+)'/", (string) $q, $m ) ) {
			return array();
		}
		$rows = array();
		foreach ( (array) ( $GLOBALS['pages'] ?? array() ) as $id => $p ) {
			if ( (int) $p->post_parent === (int) $m[1] && 'trash' !== $p->post_status ) {
				$rows[] = (object) array( 'ID' => $id, 'post_name' => $p->post_name );
			}
		}
		return $rows;
	}

	/** statchasers_player_published_slugs(): the published ones. */
	public function get_col( $q ) {
		if ( ! preg_match( "/post_parent = '(\d+)'/", (string) $q, $m ) ) {
			return array();
		}
		$names = array();
		foreach ( (array) ( $GLOBALS['pages'] ?? array() ) as $p ) {
			if ( (int) $p->post_parent === (int) $m[1] && 'publish' === $p->post_status ) {
				$names[] = $p->post_name;
			}
		}
		return $names;
	}

	/** INSERT IGNORE into the options table: one row per name, ever. */
	public function query( $q ) {
		if ( preg_match( "/INSERT IGNORE INTO `wp_options`.*VALUES \( '([^']+)', '([^']*)'/s", (string) $q, $m ) ) {
			if ( isset( $GLOBALS['options'][ $m[1] ] ) ) {
				return 0;
			}
			$GLOBALS['options'][ $m[1] ] = $m[2];
			return 1;
		}
		return 0;
	}
};

/* ----------------------------------------------------------- the fixtures */

// The roster the API hands over: two active players. Anyone else has left.
$GLOBALS['http_body'] = json_encode(
	array(
		'ok'      => true,
		'players' => array(
			array( 'id' => '1', 'slug' => 'josh-allen', 'name' => 'Josh Allen', 'position' => 'QB', 'team' => 'BUF', 'teamName' => 'Buffalo Bills' ),
			array( 'id' => '2', 'slug' => 'cole-kmet', 'name' => 'Cole Kmet', 'position' => 'TE', 'team' => 'CHI', 'teamName' => 'Chicago Bears' ),
			array( 'id' => '3', 'slug' => 'luther-burden', 'name' => 'Luther Burden', 'position' => 'WR', 'team' => 'CHI', 'teamName' => 'Chicago Bears' ),
		),
	)
);

$nfl               = new WP_Post();
$nfl->ID           = 500;
$nfl->post_name    = 'nfl';
$players           = new WP_Post();
$players->ID       = 501;
$players->post_name   = 'players';
$players->post_parent = 500;
$GLOBALS['pages_by_path'] = array( 'nfl' => $nfl, 'nfl/players' => $players );

/** A profile page under the container, as the builder makes them. */
function sc_test_profile( int $id, string $slug, int $parent = 501, string $content = '[statchasers_player]' ): WP_Post {
	$p               = new WP_Post();
	$p->ID           = $id;
	$p->post_name    = $slug;
	$p->post_parent  = $parent;
	$p->post_content = $content;
	$p->post_title   = ucwords( str_replace( '-', ' ', $slug ) );
	return $p;
}

/** Rank Math's shape: the columns its provider selects, and nothing more. */
function sc_test_row( WP_Post $p, bool $with_content = true ): stdClass {
	$row = (object) array(
		'ID'                => $p->ID,
		'post_title'        => $p->post_title,
		'post_name'         => $p->post_name,
		'post_parent'       => $p->post_parent,
		'post_type'         => 'page',
		'post_modified_gmt' => '2026-10-14 12:00:00',
	);
	if ( $with_content ) {
		$row->post_content = $p->post_content;
	}
	return $row;
}

$allen   = sc_test_profile( 502, 'josh-allen' );
$ertz    = sc_test_profile( 503, 'zach-ertz' );     // left the roster: noindex
$kmet2   = sc_test_profile( 504, 'cole-kmet-2' );   // a duplicate: noindex
$about   = sc_test_profile( 505, 'about', 501, '<p>About these pages.</p>' );
$elsewhere = sc_test_profile( 506, 'josh-allen', 0 ); // same slug, not under the container

$GLOBALS['pages'] = array( 500 => $nfl, 501 => $players, 502 => $allen, 503 => $ertz, 504 => $kmet2, 505 => $about, 506 => $elsewhere );

/* ------------------------------------------------- the sitemap entry rule */

echo "\nthe sitemap keeps active profiles and drops the ones the plugin says noindex to\n";

$entry = static fn( string $slug ): array => array( 'loc' => 'https://example.com/nfl/players/' . $slug . '/' );

is( statchasers_player_post_left_roster( $allen ), false, 'an active player has not left' );
is( statchasers_player_post_left_roster( $ertz ), true, 'a player off the roster has' );
is( statchasers_player_post_left_roster( $kmet2 ), true, 'and so has a duplicate - its slug is nobody\'s' );
is( statchasers_player_post_left_roster( $about ), false, 'a page under the container without the shortcode is not a profile' );
is( statchasers_player_post_left_roster( $elsewhere ), false, 'nor is a page with a profile\'s slug somewhere else' );

// 4. The filter handed a WP_Post.
is( statchasers_player_sitemap_drop_left( $entry( 'josh-allen' ), 'post', $allen ), $entry( 'josh-allen' ), 'WP_Post: an active profile is kept' );
is( statchasers_player_sitemap_drop_left( $entry( 'zach-ertz' ), 'post', $ertz ), false, 'WP_Post: a left-roster profile is dropped' );
is( statchasers_player_sitemap_drop_left( $entry( 'cole-kmet-2' ), 'post', $kmet2 ), false, 'WP_Post: a duplicate is dropped' );

// 5. The filter handed what Rank Math actually passes: a row from its own query.
is( statchasers_player_sitemap_drop_left( $entry( 'josh-allen' ), 'post', sc_test_row( $allen ) ), $entry( 'josh-allen' ), 'stdClass row: an active profile is kept' );
is( statchasers_player_sitemap_drop_left( $entry( 'zach-ertz' ), 'post', sc_test_row( $ertz ) ), false, 'stdClass row: a left-roster profile is dropped' );
is( statchasers_player_sitemap_drop_left( $entry( 'cole-kmet-2' ), 'post', sc_test_row( $kmet2 ) ), false, 'stdClass row: a duplicate is dropped' );
is( statchasers_player_sitemap_drop_left( $entry( 'about' ), 'post', sc_test_row( $about ) ), $entry( 'about' ), 'stdClass row: a page without the shortcode is kept' );

// A row the provider trimmed the body from is completed from the post.
$GLOBALS['post_content_by_id'][503] = '[statchasers_player]';
is( statchasers_player_sitemap_drop_left( $entry( 'zach-ertz' ), 'post', sc_test_row( $ertz, false ) ), false, 'stdClass row without post_content: read from the post, still dropped' );
unset( $GLOBALS['post_content_by_id'][503] );

// Shapes the rule must shrug at.
is( statchasers_player_sitemap_drop_left( $entry( 'zach-ertz' ), 'term', sc_test_row( $ertz ) ), $entry( 'zach-ertz' ), 'another sitemap type is not this rule\'s' );
is( statchasers_player_sitemap_drop_left( false, 'post', sc_test_row( $ertz ) ), false, 'an entry already dropped stays dropped' );
is( statchasers_player_sitemap_drop_left( $entry( 'x' ), 'post', null ), $entry( 'x' ), 'no object: kept' );
is( statchasers_player_sitemap_drop_left( $entry( 'x' ), 'post', (object) array( 'term_id' => 9 ) ), $entry( 'x' ), 'an object that is not a post: kept' );
is( statchasers_player_post_fields( 503 )['name'] ?? '', 'zach-ertz', 'the helper also takes an id' );
is( statchasers_player_post_fields( array( 'post_name' => 'x', 'post_parent' => '501' ) )['parent'] ?? 0, 501, 'and an array' );

// 1-3 in the section half of the sitemap, which runs its own roster check.
$GLOBALS['query']['sitemap_n'] = '';
$xml = (string) apply_filters( 'rank_math/sitemap/page_content', '' );
is( false !== strpos( $xml, '<loc>https://example.com/p/502/stats/</loc>' ), true, 'an active profile\'s sections are listed' );
is( false === strpos( $xml, '/p/503/' ), true, 'a left-roster profile\'s are not' );
is( false === strpos( $xml, '/p/504/' ), true, 'nor a duplicate\'s' );

// And the page itself is told noindex, follow - the behavior the sitemap rule
// now agrees with rather than contradicts.
$GLOBALS['page'] = array( 'singular' => true, 'loop' => true, 'admin' => false, 'post' => $ertz );
$robots          = apply_filters( 'rank_math/frontend/robots', array( 'index' => 'index', 'follow' => 'follow' ) );
is( $robots['index'] ?? '', 'noindex', 'a left-roster profile is noindex' );
is( $robots['follow'] ?? '', 'follow', 'and still follow - the page stays, its links count' );
$GLOBALS['page'] = array();

/* --------------------------------------------------------- the builder */

echo "\nan existing slug is reused, never suffixed\n";

$GLOBALS['options'] = array();
$GLOBALS['pages']   = array( 500 => $nfl, 501 => $players, 504 => sc_test_profile( 504, 'cole-kmet' ) );

$result = statchasers_player_build_batch( 0 );
$slugs  = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );

is( $result['locked'], false, 'the build ran' );
is( $result['existing'], 1, 'the page that was there is counted as existing' );
is( $result['created'], 2, 'and the two that were not are created' );
is( in_array( 'cole-kmet-2', $slugs, true ), false, 'no cole-kmet-2' );
is( count( array_keys( $slugs, 'cole-kmet', true ) ), 1, 'one cole-kmet' );
is( count( $GLOBALS['pages'] ), 5, 'container, parent and three profiles' );

$again = statchasers_player_build_batch( 0 );
is( $again['created'], 0, 'running it again creates nothing' );
is( $again['existing'], 3, 'everything is existing' );
is( count( $GLOBALS['pages'] ), 5, 'and the tree is unchanged' );

// 6. The opening list is blind to the page (it was read before the page
// existed, or the query answered nothing): the check right before the insert
// still sees it.
echo "\nthe check before the insert does not trust the list read at the top of the batch\n";

$GLOBALS['wpdb']->blind = true;
$result = statchasers_player_build_batch( 0 );
$slugs  = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );
is( $result['created'], 0, 'nothing is created' );
is( $result['existing'], 3, 'every page is found by the fresh query' );
is( preg_grep( '/-\d+$/', $slugs ), array(), 'and no slug grew a suffix' );
$GLOBALS['wpdb']->blind = false;

// 7a. The narrowest race: a page appears between the check and the insert, so
// WordPress renames ours. The builder notices and undoes it.
echo "\na page that appears between the check and the insert wins, and ours is withdrawn\n";

$GLOBALS['pages'] = array( 500 => $nfl, 501 => $players, 502 => sc_test_profile( 502, 'josh-allen' ), 504 => sc_test_profile( 504, 'cole-kmet' ) );
$GLOBALS['deleted_posts'] = array();
$GLOBALS['before_insert'] = static function ( array $args ): void {
	// The other process, landing first.
	$GLOBALS['pages'][600] = sc_test_profile( 600, (string) $args['post_name'] );
};

$result = statchasers_player_build_batch( 0 );
$slugs  = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );

is( $result['created'], 0, 'the renamed page is not counted as created' );
is( $result['existing'], 3, 'the other process\'s page is the one kept' );
is( count( array_keys( $slugs, 'luther-burden', true ) ), 1, 'one luther-burden' );
is( in_array( 'luther-burden-2', $slugs, true ), false, 'no luther-burden-2' );
is( count( $GLOBALS['deleted_posts'] ), 1, 'the suffixed page was deleted' );
is( isset( $GLOBALS['pages'][600] ), true, 'and not the one that won the slug' );
unset( $GLOBALS['before_insert'] );

/* ------------------------------------------------------------- the lock */

echo "\none build at a time\n";

$GLOBALS['options'] = array();
$now                = time();

is( statchasers_player_lock_acquire( $now ), true, 'the lock is free to take' );
is( statchasers_player_lock_acquire( $now + 1 ), false, 'and taken means taken' );
is( (int) get_option( STATCHASERS_PLAYER_LOCK ), $now, 'it is stamped with when' );

// 7b. Two overlapping runs: the second finds the first's lock and writes nothing.
$GLOBALS['pages'] = array( 500 => $nfl, 501 => $players );
$second = statchasers_player_build_batch( 0 );
is( $second['locked'], true, 'a build that meets a held lock says so' );
is( $second['created'], 0, 'writes nothing' );
is( $second['next'], 0, 'and leaves the cursor where it was' );
is( count( $GLOBALS['pages'] ), 2, 'no page was made' );
is( (bool) preg_grep( '/Another build is running/', $second['errors'] ), true, 'and the panel is told why' );

// The cron finding the same lock comes back in a minute instead of spinning.
$GLOBALS['scheduled'] = array();
statchasers_player_auto_build();
is( count( $GLOBALS['pages'] ), 2, 'the cron under a held lock makes nothing' );
is( ( $GLOBALS['scheduled'][0][0] ?? '' ) === STATCHASERS_PLAYER_AUTO_HOOK && 'single' === ( $GLOBALS['scheduled'][0][2] ?? '' ), true, 'and books one retry' );
is( get_option( STATCHASERS_PLAYER_AUTO_CURSOR, null ), null, 'without touching its cursor' );

statchasers_player_lock_release();
is( get_option( STATCHASERS_PLAYER_LOCK, null ), null, 'release clears the row' );

$first = statchasers_player_build_batch( 0 );
is( $first['locked'], false, 'once released, the next build runs' );
is( $first['created'], 3, 'and makes the three pages' );
is( get_option( STATCHASERS_PLAYER_LOCK, null ), null, 'and gives the lock back when it is done' );

$slugs = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );
is( preg_grep( '/-\d+$/', $slugs ), array(), 'two overlapping runs, zero suffixed slugs' );

// 8. A lock left by a build that died is a lease that ran out.
echo "\na stale lock is taken over, a live one is respected\n";

$GLOBALS['options'] = array( STATCHASERS_PLAYER_LOCK => (string) ( $now - STATCHASERS_PLAYER_LOCK_TTL - 1 ) );
is( statchasers_player_lock_acquire( $now ), true, 'a stamp older than the TTL does not block the next build' );
is( (int) get_option( STATCHASERS_PLAYER_LOCK ), $now, 'which stamps it afresh' );

$GLOBALS['options'] = array( STATCHASERS_PLAYER_LOCK => (string) ( $now - 30 ) );
is( statchasers_player_lock_acquire( $now ), false, 'a stamp thirty seconds old is a build in progress' );
is( (int) get_option( STATCHASERS_PLAYER_LOCK ), $now - 30, 'and is left alone' );

$GLOBALS['options'] = array( STATCHASERS_PLAYER_LOCK => 'garbage' );
is( statchasers_player_lock_acquire( $now ), true, 'an unreadable stamp is treated as stale' );

$GLOBALS['options'] = array();
is( STATCHASERS_PLAYER_LOCK_TTL > STATCHASERS_PLAYER_AUTO_BUDGET && STATCHASERS_PLAYER_LOCK_TTL > STATCHASERS_PLAYER_BUDGET, true, 'the TTL outlasts the longest honest hold' );
is( STATCHASERS_PLAYER_LOCK_TTL < HOUR_IN_SECONDS, true, 'and a crash costs less than an hour' );

/* ------------------------------------------------- what did not change */

// 9. A retired address for a player with a page still redirects.
echo "\nretired addresses and missing players behave as before\n";

$GLOBALS['pages'] = array( 500 => $nfl, 501 => $players, 502 => sc_test_profile( 502, 'josh-allen' ) );
is( statchasers_player_legacy_target( 'nfl/players/outlook/josh-allen' ), 'https://example.com/p/502/outlook/', 'the old Outlook page still 301s to the Outlook section' );
is( statchasers_player_legacy_target( 'fantasy-football/players/josh-allen' ), 'https://example.com/p/502/', 'and the redraft-era profile to the profile' );

// 10. A player outside the index has no page, no redirect, and no link.
is( statchasers_player_page_for_slug( 'allen-lazard' ), 0, 'a player outside the index has no page' );
is( statchasers_player_legacy_target( 'nfl/players/outlook/allen-lazard' ), '', 'his retired address is left to 404' );
is(
	statchasers_player_unlink_missing( '<p><a class="sct-player-link" href="https://example.com/nfl/players/allen-lazard/">Allen Lazard</a> and <a href="https://example.com/nfl/players/josh-allen/">Josh Allen</a></p>' ),
	'<p>Allen Lazard and <a href="https://example.com/nfl/players/josh-allen/">Josh Allen</a></p>',
	'and a fragment that links him prints his name instead'
);
