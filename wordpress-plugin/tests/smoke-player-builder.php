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

/* ------------------------------------- the same-instant race (2026-11-26) */

// 11. Both inserts checked the slug before either landed, so WordPress gave
// BOTH the slug - no -2 for the rename check to see. D'Andre Swift (4928,
// 4929) and Tyson Bagent (4926, 4927), 2026-09-20. The oldest page wins.
echo "\ntwo inserts in the same instant keep one page, the oldest\n";

$GLOBALS['options']          = array();
$GLOBALS['deleted_posts']    = array();
$GLOBALS['pages']            = array( 500 => $nfl, 501 => $players, 502 => sc_test_profile( 502, 'josh-allen' ), 504 => sc_test_profile( 504, 'cole-kmet' ) );
$GLOBALS['insert_no_suffix'] = true;
$GLOBALS['before_insert']    = static function ( array $args ): void {
	// The other process, landing first and keeping the same slug.
	$GLOBALS['pages'][600] = sc_test_profile( 600, (string) $args['post_name'] );
};

$result = statchasers_player_build_batch( 0 );
$slugs  = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );

is( count( array_keys( $slugs, 'luther-burden', true ) ), 1, 'one luther-burden, not two with the same slug' );
is( isset( $GLOBALS['pages'][600] ), true, 'the older page (the other process\'s) is kept' );
is( count( $GLOBALS['deleted_posts'] ), 1, 'ours, the newer, is deleted' );
is( $result['created'], 0, 'and not counted as created' );
is( $result['existing'], 3, 'the kept page is counted as existing' );

// 11b. The other order: ours lands first, the other process a moment later.
// Ours is the oldest, so ours stays - and the other process, running the
// same check, deletes its own (statchasers_player_settle_slug_race).
$GLOBALS['deleted_posts'] = array();
$GLOBALS['pages']         = array( 500 => $nfl, 501 => $players, 502 => sc_test_profile( 502, 'josh-allen' ), 504 => sc_test_profile( 504, 'cole-kmet' ) );
$GLOBALS['after_insert']  = static function ( array $args ): void {
	$GLOBALS['pages'][900] = sc_test_profile( 900, (string) $args['post_name'] );
};
$result = statchasers_player_build_batch( 0 );
$ours   = array_keys( array_filter( $GLOBALS['pages'], static fn( $p ) => 'luther-burden' === $p->post_name && 900 !== $p->ID ) );
is( $result['created'], 1, 'ours landed first: created' );
is( count( $GLOBALS['deleted_posts'] ), 0, 'and kept' );
is( statchasers_player_settle_slug_race( 900, 'luther-burden', 501 ), $ours[0] ?? -1, 'the later process, checking, is told ours is the page' );
is( isset( $GLOBALS['pages'][900] ), false, 'and deletes its own' );
is( statchasers_player_settle_slug_race( $ours[0] ?? 0, 'luther-burden', 501 ), $ours[0] ?? -1, 'alone at the slug: nothing to settle' );
unset( $GLOBALS['insert_no_suffix'] );

/* ------------------------------------------------- the duplicate dry run */

echo "\nthe duplicate plan keeps the page the URL resolves to and retires only what is safe\n";

$GLOBALS['pages'] = array(
	500  => $nfl,
	501  => $players,
	4926 => sc_test_profile( 4926, 'tyson-bagent' ),
	4927 => sc_test_profile( 4927, 'tyson-bagent' ),
	4928 => sc_test_profile( 4928, 'dandre-swift' ),
	4929 => sc_test_profile( 4929, 'dandre-swift' ),
	5045 => sc_test_profile( 5045, 'jahmyr-gibbs' ),
);
$plan = statchasers_player_duplicate_plan();
is( count( $plan ), 2, 'two duplicate groups' );
is( array_map( static fn( $g ) => array( $g['slug'], $g['keep'], $g['retire'] ), $plan ), array( array( 'tyson-bagent', 4926, array( 4927 ) ), array( 'dandre-swift', 4928, array( 4929 ) ) ), 'keep the oldest (4926, 4928), retire the newer (4927, 4929)' );
is( $plan[0]['differences'][4927], array(), 'the retired page holds nothing its keeper does not' );
is( count( $GLOBALS['pages'] ), 7, 'the plan writes nothing' );

$GLOBALS['trashed_posts'] = array();
$done = statchasers_player_duplicate_apply( array( 4927, 4926, 5045 ) );
is( $done[4927], 'trashed', 'an authorized duplicate is trashed' );
is( 0 === strpos( $done[4926], 'skipped' ), true, 'the keeper is never trashed, even when named' );
is( 0 === strpos( $done[5045], 'skipped' ), true, 'nor a page that is not a duplicate' );
is( $GLOBALS['trashed_posts'], array( 4927 ), 'one page trashed, and only by trash' );
is( isset( $done[4929] ), false, 'a duplicate nobody authorized is left alone' );
is( $GLOBALS['pages'][4929]->post_status, 'publish', 'and stays published' );

$GLOBALS['pages'][4929]->post_content = '<p>Hand-written notes.</p>[statchasers_player]';
$held = statchasers_player_duplicate_apply( array( 4929 ) );
is( 0 === strpos( $held[4929], 'skipped: holds post_content' ), true, 'a duplicate with content of its own is not trashed' );
$GLOBALS['pages'][4929]->post_content = '[statchasers_player]';

/* ------------------------------------------------- the retitle dry run */

echo "\nthe retitle dry run and apply move stored titles only: no slug, no canonical\n";

if ( ! function_exists( 'update_meta_cache' ) ) {
	function update_meta_cache( $type, $ids ) { return true; }
}
$GLOBALS['pages'] = array(
	500 => $nfl,
	501 => $players,
	601 => sc_test_profile( 601, 'josh-allen' ),
	602 => sc_test_profile( 602, 'cole-kmet' ),
	603 => sc_test_profile( 603, 'luther-burden' ),
);
$GLOBALS['post_meta'] = array(
	// The stored wording the 4926/4928 pair carries on production.
	601 => array( 'rank_math_title' => 'Josh Allen Fantasy Football 2026: Stats, Outlook & News', 'rank_math_canonical_url' => 'https://example.com/nfl/players/josh-allen/' ),
	// A hand-written title: left alone.
	602 => array( 'rank_math_title' => 'Cole Kmet: our editor\'s take', 'rank_math_canonical_url' => '' ),
	// Already the current wording: nothing to do.
	603 => array( 'rank_math_title' => 'Luther Burden NFL Stats & News | StatChasers' ),
);
$GLOBALS['post_meta_writes'] = array();
$names_before = array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] );
$meta_before  = $GLOBALS['post_meta'];
$report       = statchasers_player_retitle_report();
echo '  sample: ' . json_encode( $report['rows'] ) . "\n";
is( array_keys( $report['rows'] ), array( 601 ), 'the dry run lists the one generated, outdated title' );
is( $report['rows'][601], array( 'old' => 'Josh Allen Fantasy Football 2026: Stats, Outlook & News', 'new' => 'Josh Allen NFL Stats & News | StatChasers', 'len' => 41 ), 'old => new, under 60' );
is( array_keys( $report['rows'][601] ), array( 'old', 'new', 'len' ), 'a row carries the title and nothing else: no slug, no URL' );
is( $report['custom'], 1, 'the hand-written title is counted as custom, not changed' );
is( $GLOBALS['post_meta_writes'], array(), 'the dry run writes nothing' );
is( $GLOBALS['post_meta'], $meta_before, 'stored meta untouched by the dry run' );

is( statchasers_player_retitle_apply(), 1, 'apply updates the one eligible page' );
is( array_map( static fn( $w ) => $w[1], $GLOBALS['post_meta_writes'] ), array( 'rank_math_title' ), 'only rank_math_title is written' );
is( array_map( static fn( $p ) => $p->post_name, $GLOBALS['pages'] ), $names_before, 'every slug unchanged' );
is( $GLOBALS['post_meta'][601]['rank_math_canonical_url'], 'https://example.com/nfl/players/josh-allen/', 'the stored canonical unchanged' );
is( $GLOBALS['post_meta'][602]['rank_math_title'], 'Cole Kmet: our editor\'s take', 'the custom title unchanged' );
$GLOBALS['post_meta'] = array();
$GLOBALS['post_meta_writes'] = array();

/* -------------------------------------------- one sitemap entry per slug */

echo "\nthe sitemap lists the page the URL resolves to, once\n";

$GLOBALS['pages'] = array(
	500  => $nfl,
	501  => $players,
	4957 => sc_test_profile( 4957, 'cole-kmet' ),
	4958 => sc_test_profile( 4958, 'cole-kmet' ),
	502  => sc_test_profile( 502, 'josh-allen' ),
);
statchasers_player_resolved_ids( true ); // The request's list is read once; this is a new request.
is( statchasers_player_sitemap_drop_left( $entry( 'cole-kmet' ), 'post', sc_test_row( $GLOBALS['pages'][4958] ) ), false, 'the shadowed duplicate\'s entry is dropped' );
is( statchasers_player_sitemap_drop_left( $entry( 'cole-kmet' ), 'post', sc_test_row( $GLOBALS['pages'][4957] ) ), $entry( 'cole-kmet' ), 'the page the URL resolves to is kept' );
is( statchasers_player_sitemap_drop_left( $entry( 'josh-allen' ), 'post', sc_test_row( $GLOBALS['pages'][502] ) ), $entry( 'josh-allen' ), 'a page alone at its slug is kept' );
$GLOBALS['query']['sitemap_n'] = '';
$xml = (string) apply_filters( 'rank_math/sitemap/page_content', '' );
is( substr_count( $xml, '/p/4957/stats/' ), 1, 'the keeper\'s sections are listed once' );
is( substr_count( $xml, '/p/4958/' ), 0, 'the duplicate\'s not at all' );

/* ------------------------------------------- one hop to the canonical URL */

echo "\nURL variants: one 301 to the canonical address, 404s left alone\n";

// The published list was read once, above: josh-allen is the profile here.
$cases = array(
	'/nfl/players/Josh-Allen/'                       => 'https://example.com/nfl/players/josh-allen/',
	'/NFL/Players/josh-allen/'                       => 'https://example.com/nfl/players/josh-allen/',
	'/nfl/players//josh-allen/'                      => 'https://example.com/nfl/players/josh-allen/',
	'/nfl/players/josh-allen'                        => 'https://example.com/nfl/players/josh-allen/',
	'/nfl/players/josh-allen/Stats/'                 => 'https://example.com/nfl/players/josh-allen/stats/',
	'/nfl/players/josh-allen//game-log'              => 'https://example.com/nfl/players/josh-allen/game-log/',
	'/nfl/players/josh-allen/overview/'              => 'https://example.com/nfl/players/josh-allen/',
	'/nfl/players/josh-allen/?log=2024'              => 'https://example.com/nfl/players/josh-allen/game-log/#log=2024',
	'/nfl/players/josh-allen/?log=2025'              => 'https://example.com/nfl/players/josh-allen/game-log/#log=2025',
	'/nfl/players/josh-allen/game-log/?log=2023'     => 'https://example.com/nfl/players/josh-allen/game-log/#log=2023',
	'/nfl/players/Josh-Allen/game-log/?log=2023&format=half' => 'https://example.com/nfl/players/josh-allen/game-log/?format=half#log=2023',
	'/nfl/players/josh-allen/stats/?log=abc'         => 'https://example.com/nfl/players/josh-allen/stats/',
	'/nfl/players/josh-allen/?log[]=2024'            => 'https://example.com/nfl/players/josh-allen/game-log/#log=2024',
	'/nfl/players/josh-allen-2/news/'                => 'https://example.com/nfl/players/josh-allen/news/',
	'/nfl/players/josh-allen/'                       => '',
	'/nfl/players/josh-allen/stats/'                 => '',
	'/nfl/players/josh-allen/?format=half'           => '',
	'/nfl/players/zach-ertz-unknown/'                => '',
	'/nfl/players/Zach-Ertz-Unknown/'                => '',
	'/nfl/players/josh-allen/badtab/'                => '',
	'/nfl/players/josh-allen/stats/extra/'           => '',
	'/nfl/players/outlook/josh-allen/'               => '',
	'/nfl/players/'                                  => '',
	'/nfl/teams/buffalo-bills/'                      => '',
);
foreach ( $cases as $from => $want ) {
	is( statchasers_player_canonical_target( $from ), $want, '' === $want ? "$from: no redirect" : "$from -> $want" );
}
