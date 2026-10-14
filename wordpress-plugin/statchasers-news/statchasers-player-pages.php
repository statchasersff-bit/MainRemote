<?php
/**
 * One-click creation of the player profile pages, and the H1 they carry.
 *
 * The team hubs got this treatment first (statchasers-team-pages.php) and the
 * reasoning is identical: a profile only becomes indexable when a WordPress
 * page mounts it, because the API serves its own copy `noindex,
 * indexifembedded`. Until the page exists the URL 404s and nothing on it can
 * rank.
 *
 * What is different is the scale. There are thirty-two teams and roughly six
 * hundred indexed players, which is more than a shared host will do in one
 * request. So this builder is a loop the browser drives: each POST writes a
 * batch, stores where it got to, and comes back for the next one. Stopping
 * halfway is not a failure state - the cursor is in an option, every write is
 * idempotent, and pressing the button again resumes.
 *
 * WHERE THE LIST COMES FROM. The API, at /embed/players.json, exactly as
 * scripts/create-player-pages.sh reads it. There are six hundred of these and
 * the list moves every offseason; a copy pasted into this file would be wrong
 * by the time anybody ran it. The endpoint returns the INDEXED players only -
 * the dictionary holds every player in the league and most have no game log, no
 * advanced row and no bio, so a page each would be several thousand thin pages.
 *
 * WHAT IT WRITES, AND WHAT IT WON'T. New pages get a title, the slug, the
 * parent and the [statchasers_player] shortcode, plus Rank Math's title,
 * description and robots. A page that already exists is yours: its content is
 * never touched and a Rank Math field is filled only where it is empty. Running
 * it again is a no-op.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Where the profiles live. Must match SC_PLAYER_PATH_PREFIX on the API. */
const STATCHASERS_PLAYER_PATH = 'nfl/players';

/**
 * The ceiling on one request, and the time budget that usually decides it.
 *
 * A fixed batch size is the wrong control. Pick it low enough for the slowest
 * host and every other host does twenty-three round trips it did not need; pick
 * it for a fast host and a slow one dies halfway through a request. So the
 * batch writes until the roster runs out, the ceiling is reached, or the budget
 * is spent - whichever comes first - and what actually varies is how many pages
 * a given host gets through in ten seconds.
 *
 * Ten seconds against a `max_execution_time` that is 30 on most shared hosting,
 * leaving room for the request that is already in flight when the budget is
 * checked. The ceiling is there so one request cannot hold a connection open
 * for the whole roster on a fast box.
 */
const STATCHASERS_PLAYER_BATCH = 200;

/** Seconds of writing per request before it hands control back. */
const STATCHASERS_PLAYER_BUDGET = 10.0;

/** Where the resume cursor lives while a build is running. */
const STATCHASERS_PLAYER_CURSOR = 'statchasers_player_build_cursor';

/** How long the fetched roster is kept before it is asked for again. */
const STATCHASERS_PLAYER_ROSTER_TTL = 6 * HOUR_IN_SECONDS;

/** The last good roster, for when the API does not answer. */
const STATCHASERS_PLAYER_ROSTER_BACKUP_TTL = 7 * DAY_IN_SECONDS;

/**
 * How long a failed fetch is remembered. The roster is read from the_title on
 * every player page, so without this each view during an outage would retry
 * and wait out the timeout.
 */
const STATCHASERS_PLAYER_ROSTER_RETRY = 5 * MINUTE_IN_SECONDS;

/**
 * The build lock: one builder at a time.
 *
 * WHY. On 2026-09-20 two builds ran at once - the daily cron and a press of
 * the button, or two batches of the browser-driven loop - and each read the
 * same "no page yet" for the same rookies. Both inserted. WordPress keeps a
 * slug unique among siblings by appending -2, -3, so the second insert did not
 * fail: it published `cole-kmet-2` next to `cole-kmet`, an empty shell with a
 * canonical title, and twenty-seven of them went into the sitemap.
 *
 * HOW. The same primitive core uses for its own updater (WP_Upgrader::create_lock):
 * an `INSERT IGNORE` of one option row, which the database makes atomic - two
 * processes racing for it get exactly one success - stamped with the time it
 * was taken. A holder that dies without releasing it leaves a stamp behind, so
 * the lock is also a lease: a stamp older than the TTL is a crashed build, and
 * the next builder takes the lock over rather than waiting for somebody to
 * notice. Nothing else is blocked; a page view never asks for this.
 *
 * The TTL is well above the longest honest hold (one batch is ten seconds of
 * writing, one cron run twenty) and well below the daily cadence, so a crash
 * costs at most one skipped cron minute.
 */
const STATCHASERS_PLAYER_LOCK     = 'statchasers_player_build_lock';
const STATCHASERS_PLAYER_LOCK_TTL = 5 * MINUTE_IN_SECONDS;

/**
 * Take the build lock, or report that another build holds it.
 *
 * @param int|null $now The clock, for tests.
 * @return bool True when this process now holds the lock.
 */
function statchasers_player_lock_acquire( ?int $now = null ): bool {
	global $wpdb;

	$now = $now ?? time();

	// INSERT IGNORE: a row that already exists is left alone and the statement
	// reports zero rows, which is the whole test. No SELECT first, because the
	// gap between a SELECT and an INSERT is exactly the race this closes.
	$taken = $wpdb->query(
		$wpdb->prepare(
			"INSERT IGNORE INTO `{$wpdb->options}` ( `option_name`, `option_value`, `autoload` ) VALUES ( %s, %s, 'no' )",
			STATCHASERS_PLAYER_LOCK,
			(string) $now
		)
	);

	if ( $taken ) {
		// The row went in behind the options cache's back; keep the two in step
		// so a get_option() in this request sees the lock it holds.
		wp_cache_delete( STATCHASERS_PLAYER_LOCK, 'options' );
		return true;
	}

	// Somebody holds it. Alive, or a leftover from a build that died?
	wp_cache_delete( STATCHASERS_PLAYER_LOCK, 'options' );
	$stamp = (int) get_option( STATCHASERS_PLAYER_LOCK, 0 );

	if ( $stamp > 0 && $stamp > $now - STATCHASERS_PLAYER_LOCK_TTL ) {
		return false;
	}

	// Expired (or unreadable). Clear it and try once more - once, so two
	// builders finding the same stale lock still resolve to one winner.
	statchasers_player_lock_release();

	$taken = $wpdb->query(
		$wpdb->prepare(
			"INSERT IGNORE INTO `{$wpdb->options}` ( `option_name`, `option_value`, `autoload` ) VALUES ( %s, %s, 'no' )",
			STATCHASERS_PLAYER_LOCK,
			(string) $now
		)
	);
	wp_cache_delete( STATCHASERS_PLAYER_LOCK, 'options' );

	return (bool) $taken;
}

/** Give the build lock back. Safe to call without holding it. */
function statchasers_player_lock_release(): void {
	delete_option( STATCHASERS_PLAYER_LOCK );
	wp_cache_delete( STATCHASERS_PLAYER_LOCK, 'options' );
}

/**
 * The page already published at this slug under the container, or 0.
 *
 * A fresh query, not statchasers_player_page_status()'s memo: that list was
 * read at the top of the batch, and the question here is what the database
 * holds NOW, a moment before an insert. Any status but trash counts - a draft
 * at this address would make WordPress rename the new page just the same.
 *
 * @param string $slug      The canonical slug.
 * @param int    $container The /nfl/players/ page.
 * @return int
 */
function statchasers_player_sibling_page( string $slug, int $container ): int {
	if ( '' === $slug || ! $container ) {
		return 0;
	}

	$found = get_posts(
		array(
			'post_type'        => 'page',
			'post_parent'      => $container,
			'post_status'      => 'any',
			'name'             => $slug,
			'numberposts'      => 1,
			'fields'           => 'ids',
			'no_found_rows'    => true,
			'suppress_filters' => false,
		)
	);

	return empty( $found ) ? 0 : (int) $found[0];
}

/**
 * The indexed players, as the API lists them.
 *
 * Cached, because a build is two dozen requests and each one needs the whole
 * list to find its slice of it. The cache is short enough that a roster change
 * lands the same day and long enough that a build is not six hundred rows
 * fetched twenty-three times.
 *
 * @param bool $fresh Skip the cache.
 * @return array<int,array<string,string>> Rows, or [] when the API is unreachable.
 */
function statchasers_player_roster( bool $fresh = false ): array {
	$key = 'sc_player_roster';

	$backup = get_transient( $key . '_bak' );

	if ( ! $fresh ) {
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		// A recent fetch failed: the last good list, without asking again.
		if ( get_transient( $key . '_fail' ) ) {
			return is_array( $backup ) ? $backup : array();
		}
	}

	// What a fetch falls back to when the API does not answer: the list it had,
	// rather than none. An empty list would have the builder report every
	// profile present because it was asked about nobody.
	$current  = get_transient( $key );
	$fallback = is_array( $current ) ? $current : ( is_array( $backup ) ? $backup : array() );

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return $fallback;
	}

	$response = wp_remote_get(
		$origin . '/embed/players.json',
		array(
			// The builder can afford to wait; a reader's page view cannot.
			'timeout' => $fresh ? 20 : 8,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	$body = is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response )
		? null
		: json_decode( (string) wp_remote_retrieve_body( $response ), true );

	if ( ! is_array( $body ) || empty( $body['players'] ) || ! is_array( $body['players'] ) ) {
		set_transient( $key . '_fail', 1, STATCHASERS_PLAYER_ROSTER_RETRY );
		return $fallback;
	}

	$rows = array();

	foreach ( $body['players'] as $player ) {
		if ( ! is_array( $player ) ) {
			continue;
		}

		$slug = sanitize_title( (string) ( $player['slug'] ?? '' ) );
		$name = trim( (string) ( $player['name'] ?? '' ) );

		if ( '' === $slug || '' === $name ) {
			continue;
		}

		// Addresses this player has published at before. The API only sends one
		// when it has been dropped by everybody, so a slug here is never a live
		// page's - see previousSlugsFor() on the other side.
		$previous = array();
		foreach ( (array) ( $player['previousSlugs'] ?? array() ) as $old ) {
			$old = sanitize_title( (string) $old );
			if ( '' !== $old && $old !== $slug ) {
				$previous[] = $old;
			}
		}

		$rows[] = array(
			'slug'     => $slug,
			'name'     => $name,
			'position' => strtoupper( trim( (string) ( $player['position'] ?? '' ) ) ),
			'team'     => strtoupper( trim( (string) ( $player['team'] ?? '' ) ) ),
			'teamName' => trim( (string) ( $player['teamName'] ?? '' ) ),
			'id'       => trim( (string) ( $player['id'] ?? '' ) ),
			'previous' => $previous,
			// The Bio spec's index rule: false keeps /bio/ out of the sitemap.
			'bioIndex' => false !== ( $player['bioIndex'] ?? true ),
			// Section URLs with nothing behind them (a healthy player's
			// /injury/, a kicker's /outlook/). They redirect to the profile,
			// so the sitemap leaves them out.
			'empty'    => array_values( array_intersect( (array) ( $player['emptySections'] ?? array() ), STATCHASERS_PLAYER_INDEXED_SECTIONS ) ),
		);
	}

	set_transient( $key, $rows, STATCHASERS_PLAYER_ROSTER_TTL );
	set_transient( $key . '_bak', $rows, STATCHASERS_PLAYER_ROSTER_BACKUP_TTL );
	delete_transient( $key . '_fail' );

	return $rows;
}

/** One roster row by slug, or null. @return array<string,string>|null */
function statchasers_player_roster_row( string $slug ): ?array {
	static $index = null;

	if ( null === $index ) {
		$index = array();
		foreach ( statchasers_player_roster() as $row ) {
			$index[ $row['slug'] ] = $row;
		}
	}

	return $index[ $slug ] ?? null;
}

/**
 * The /nfl/players/ container, creating the chain of parents if asked.
 *
 * Same shape as statchasers_team_container(): the path may be more than one
 * segment deep, and every segment has to exist as a page for WordPress to
 * resolve the child.
 */
function statchasers_player_container( bool $create = false ): int {
	$parent = 0;

	foreach ( explode( '/', trim( STATCHASERS_PLAYER_PATH, '/' ) ) as $segment ) {
		$existing = get_page_by_path(
			// get_page_by_path wants the whole path, so it is rebuilt as we go.
			$parent ? get_page_uri( $parent ) . '/' . $segment : $segment
		);

		if ( $existing instanceof WP_Post ) {
			$parent = (int) $existing->ID;
			continue;
		}

		if ( ! $create ) {
			return 0;
		}

		$title = ucwords( str_replace( '-', ' ', $segment ) );
		if ( 'nfl' === $segment ) {
			$title = 'NFL';
		}
		if ( 'players' === $segment ) {
			$title = 'NFL Players';
		}

		$id = wp_insert_post(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_title'  => $title,
				'post_name'   => $segment,
				'post_parent' => $parent,
			),
			true
		);

		if ( is_wp_error( $id ) ) {
			return 0;
		}

		$parent = (int) $id;
	}

	return $parent;
}

/**
 * How many profile pages exist.
 *
 * One query rather than six hundred get_page_by_path() calls: the builder asks
 * this on every batch and the admin screen asks it on every load.
 *
 * @return array{container:int,present:array<string,int>,have:int,total:int}
 */
function statchasers_player_page_status( bool $fresh = false ): array {
	static $status = null;

	if ( null !== $status && ! $fresh ) {
		return $status;
	}

	global $wpdb;

	$container = statchasers_player_container();
	$present   = array();

	if ( $container ) {
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ID, post_name FROM {$wpdb->posts}
				 WHERE post_type = 'page' AND post_parent = %d AND post_status != 'trash'",
				$container
			)
		);

		foreach ( (array) $rows as $row ) {
			$present[ (string) $row->post_name ] = (int) $row->ID;
		}
	}

	// `have` is the roster's pages only. The container also holds pages for
	// players who have left the index (kept, never deleted), and counting those
	// read "659 of 615 pages exist" - more than all, with some still missing.
	$roster = statchasers_player_roster();
	$have   = 0;
	foreach ( $roster as $row ) {
		if ( isset( $present[ $row['slug'] ] ) ) {
			++$have;
		}
	}

	$status = array(
		'container' => $container,
		'present'   => $present,
		'have'      => $have,
		'total'     => count( $roster ),
	);

	return $status;
}

/**
 * The profile slugs a reader can open: published pages under the container.
 *
 * Not statchasers_player_page_status()'s list, which counts drafts too - right
 * for "does the builder need to write this one", wrong for "will this link
 * 404". Memoized for the request; a page renders a few hundred player links.
 *
 * @return array<string,true> post_name => true. Empty when there is no container.
 */
function statchasers_player_published_slugs(): array {
	static $slugs = null;

	if ( null !== $slugs ) {
		return $slugs;
	}

	global $wpdb;

	$slugs     = array();
	$container = statchasers_player_container();

	if ( $container ) {
		$names = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_name FROM {$wpdb->posts}
				 WHERE post_type = 'page' AND post_parent = %d AND post_status = 'publish'",
				$container
			)
		);
		foreach ( (array) $names as $name ) {
			$slugs[ (string) $name ] = true;
		}
	}

	return $slugs;
}

/**
 * Turn links to player profiles that do not exist here yet into plain names.
 *
 * WHY HERE AND NOT ON THE API. The API links a name when the player is in its
 * index, which it rebuilds at 14:00 UTC and on every boot. This site creates
 * the pages at 15:00 UTC (statchasers_player_auto_build), or when somebody
 * presses the builder. Between the two, every recap, hub and ranking linked a
 * new signing to a 404, and a crawl on 2026-09-28 found them. Only this side
 * knows which pages are published, so this side decides - the same rule the
 * API follows when a name has no slug at all: print the name, not a guess.
 *
 * What it rewrites: an <a> whose href is this site's /nfl/players/<slug>/ (with
 * or without a section, query or hash) where <slug> has no published page. The
 * anchor becomes a <span> keeping its typographic classes, which is the markup
 * the API prints for an unlinked name. Classes that only mean "this is a link"
 * go, and so does an anchor with no text - the cornerstone card's stretched
 * hit area, which has nothing left to cover.
 *
 * What it leaves alone: other hosts, the retired /nfl/players/<section>/<slug>/
 * layout (301s, not 404s), and everything when no page is published at all -
 * a missing container or a failed query would otherwise strip every player
 * link on the site, and a 404 is the lesser harm than losing them all.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_player_unlink_missing( string $html ): string {
	$marker = '/' . STATCHASERS_PLAYER_PATH . '/';

	if ( false === strpos( $html, $marker ) ) {
		return $html;
	}

	$published = statchasers_player_published_slugs();
	if ( ! $published ) {
		return $html;
	}

	$home = strtolower( preg_replace( '/^www\./i', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) );
	$path = '#^/' . preg_quote( STATCHASERS_PLAYER_PATH, '#' ) . '/([a-z0-9-]+)(?:/[a-z0-9-]+)?/?$#';

	return (string) preg_replace_callback(
		'#<a\b([^>]*)>(.*?)</a>#is',
		static function ( array $m ) use ( $home, $path, $published ): string {
			if ( ! preg_match( '/\bhref\s*=\s*(["\'])(.*?)\1/is', $m[1], $href ) ) {
				return $m[0];
			}

			$url  = html_entity_decode( $href[2], ENT_QUOTES, 'UTF-8' );
			$host = strtolower( preg_replace( '/^www\./i', '', (string) wp_parse_url( $url, PHP_URL_HOST ) ) );
			if ( '' !== $host && $host !== $home ) {
				return $m[0];
			}

			$url_path = (string) wp_parse_url( $url, PHP_URL_PATH );
			if (
				! preg_match( $path, $url_path, $slug )
				|| preg_match( STATCHASERS_LEGACY_PLAYER_PATH, $url_path )
				|| isset( $published[ $slug[1] ] )
			) {
				return $m[0];
			}

			if ( '' === trim( $m[2] ) ) {
				return '';
			}

			$classes = array();
			if ( preg_match( '/\bclass\s*=\s*(["\'])(.*?)\1/is', $m[1], $class ) ) {
				$classes = array_diff(
					preg_split( '/\s+/', trim( $class[2] ) ),
					array( '', 'sct-player-link', 'sct-outlook-link' )
				);
			}

			return $classes
				? '<span class="' . implode( ' ', $classes ) . '">' . $m[2] . '</span>'
				: $m[2];
		},
		$html
	);
}

add_filter(
	'do_shortcode_tag',
	static function ( $output, $tag ) {
		if ( ! is_string( $output ) || ( 0 !== strpos( (string) $tag, 'statchasers_' ) && 'sc_team_hub' !== $tag ) ) {
			return $output;
		}
		return statchasers_player_unlink_missing( $output );
	},
	10,
	2
);

/**
 * Move a profile page that is published at one of this player's old addresses.
 *
 * WHY MOVING AND NOT CREATING. A slug can change: two players share a name and
 * the claim on the bare form moves - Kenneth Walker's page was at
 * `kenneth-walker-8151` because a retired receiver with the same name had been
 * given `kenneth-walker` first - or a source corrects a spelling. The builder's
 * only test used to be "is there a page at the current slug", so a rename read
 * as a new player: it published a second page and left the first one up.
 * Two pages, both indexed, both about the same man, each holding half the
 * links. Renaming the one that exists is the only version of this that is not
 * a mess to undo.
 *
 * ONLY OURS. The page has to carry the shortcode, which is the same signature
 * every other write in this file checks before it touches anything. A page
 * somebody made by hand at that address keeps it, and the builder creates the
 * new one beside it.
 *
 * wp_update_post() records the address it is leaving in `_wp_old_slug`, which
 * is what statchasers_player_old_slug_redirect() reads. Any earlier address is
 * added alongside it, so a page that has moved twice still answers at both.
 *
 * @param array<string,mixed>   $row     Roster row.
 * @param array<string,int>     $present post_name => page id, for this container.
 * @return int|WP_Error Page id when one was moved, 0 when there was none.
 */
function statchasers_player_move_page( array $row, array $present ) {
	foreach ( (array) ( $row['previous'] ?? array() ) as $old ) {
		$id = (int) ( $present[ $old ] ?? 0 );
		if ( ! $id ) {
			continue;
		}

		$post = get_post( $id );
		if ( ! $post instanceof WP_Post ) {
			continue;
		}
		if ( ! has_shortcode( (string) $post->post_content, STATCHASERS_PLAYER_SHORTCODE ) ) {
			continue;
		}

		$moved = wp_update_post(
			array(
				'ID'        => $id,
				'post_name' => (string) $row['slug'],
			),
			true
		);

		if ( is_wp_error( $moved ) ) {
			return $moved;
		}

		// Core stored the address it just left. The rest of the history is
		// ours to keep: a page that moved twice is still linked from both.
		$known = (array) get_post_meta( $id, '_wp_old_slug', false );
		foreach ( (array) ( $row['previous'] ?? array() ) as $previous ) {
			if ( $previous !== $row['slug'] && ! in_array( $previous, $known, true ) ) {
				add_post_meta( $id, '_wp_old_slug', $previous );
				$known[] = $previous;
			}
		}

		return $id;
	}

	return 0;
}

/**
 * Write one batch of profile pages.
 *
 * @param int $offset Index into the roster to start at.
 * @return array{next:int,total:int,created:int,existing:int,moved:int,errors:array<int,string>,locked:bool}
 */
function statchasers_player_build_batch( int $offset ): array {
	// A build that starts from the top asks the API afresh. The list is cached
	// for six hours, and a build run right after an API deploy used to work from
	// the list before it: the players the deploy added got no page. The batches
	// after the first reuse what the first fetched, so one build sees one list.
	$roster = statchasers_player_roster( 0 === $offset );
	$total  = count( $roster );

	$result = array(
		'next'     => $total,
		'total'    => $total,
		'created'  => 0,
		'existing' => 0,
		'moved'    => 0,
		'errors'   => array(),
		// True when another build held the lock and nothing was written. The
		// cursor stays where it was, so the caller can simply come back.
		'locked'   => false,
	);

	if ( 0 === $total ) {
		$result['errors'][] = 'The roster came back empty. Check STATCHASERS_NEWS_ORIGIN and that the deployment is up.';
		return $result;
	}

	// One builder at a time. See STATCHASERS_PLAYER_LOCK.
	if ( ! statchasers_player_lock_acquire() ) {
		$result['next']     = max( 0, $offset );
		$result['locked']   = true;
		$result['errors'][] = 'Another build is running. Nothing was written; try again in a minute.';
		return $result;
	}

	try {
		return statchasers_player_build_batch_locked( $offset, $roster, $result );
	} finally {
		statchasers_player_lock_release();
	}
}

/**
 * The body of statchasers_player_build_batch(), run while holding the lock.
 *
 * @param int                                  $offset Index into the roster.
 * @param array<int,array<string,mixed>>       $roster The list this build works from.
 * @param array<string,mixed>                  $result The tally to fill.
 * @return array<string,mixed>
 */
function statchasers_player_build_batch_locked( int $offset, array $roster, array $result ): array {
	$total     = count( $roster );
	$container = statchasers_player_container( true );

	if ( ! $container ) {
		$result['errors'][] = sprintf( 'Could not create the /%s/ container page.', STATCHASERS_PLAYER_PATH );
		return $result;
	}

	$status  = statchasers_player_page_status( true );
	$slice   = array_slice( $roster, max( 0, $offset ), STATCHASERS_PLAYER_BATCH );
	$started = microtime( true );
	$done    = 0;

	foreach ( $slice as $row ) {
		// Checked before the write rather than after, so the budget is what is
		// left rather than what was left one page ago.
		if ( $done > 0 && microtime( true ) - $started > STATCHASERS_PLAYER_BUDGET ) {
			break;
		}
		++$done;

		$id = $status['present'][ $row['slug'] ] ?? 0;

		// Nothing at the current address does not mean there is no page. Check
		// the addresses this player has published at before, and move the page
		// rather than publish a second one next to it.
		if ( $id ) {
			++$result['existing'];
		} else {
			$moved = statchasers_player_move_page( $row, $status['present'] );

			if ( is_wp_error( $moved ) ) {
				$result['errors'][] = sprintf( '%s: %s', $row['name'], $moved->get_error_message() );
				continue;
			}

			if ( $moved ) {
				$id = (int) $moved;
				++$result['moved'];
				// Kept in step so a later row in this same batch cannot match
				// the address this page has just left.
				foreach ( (array) ( $row['previous'] ?? array() ) as $old ) {
					unset( $status['present'][ $old ] );
				}
				$status['present'][ $row['slug'] ] = $id;
			}
		}

		// The list above was read once at the top of the batch. Ask the
		// database again, right before writing: a page that appeared since -
		// another batch, a hand-made draft - must be reused, not duplicated.
		if ( ! $id ) {
			$id = statchasers_player_sibling_page( (string) $row['slug'], $container );
			if ( $id ) {
				++$result['existing'];
				$status['present'][ $row['slug'] ] = $id;
			}
		}

		if ( ! $id ) {
			// The stored title, which on a normal template is the H1. The
			// position is in it because six hundred names in an admin list are
			// hard to tell apart; statchasers_player_heading() takes it back off
			// for the heading a reader sees.
			$title = '' === $row['position']
				? $row['name']
				: sprintf( '%s (%s)', $row['name'], $row['position'] );

			$id = wp_insert_post(
				array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					'post_title'   => $title,
					'post_name'    => $row['slug'],
					'post_parent'  => $container,
					'post_content' => '[' . STATCHASERS_PLAYER_SHORTCODE . ']',
				),
				true
			);

			if ( is_wp_error( $id ) ) {
				$result['errors'][] = sprintf( '%s: %s', $row['name'], $id->get_error_message() );
				continue;
			}

			$id = (int) $id;

			// WordPress never refuses a taken slug; it appends -2 and publishes.
			// That is how twenty-seven `<slug>-2` pages came to exist. So the
			// address the page actually got is checked against the one asked
			// for, and a renamed page is undone on the spot - it is seconds old,
			// empty, and ours - in favor of the sibling that won the slug.
			$made = get_post( $id );
			$got  = $made instanceof WP_Post ? (string) $made->post_name : (string) $row['slug'];
			if ( $got !== (string) $row['slug'] ) {
				wp_delete_post( $id, true );
				$id = statchasers_player_sibling_page( (string) $row['slug'], $container );
				if ( ! $id ) {
					$result['errors'][] = sprintf( '%s: the slug "%s" was taken by a page that could not be found.', $row['name'], $row['slug'] );
					continue;
				}
				++$result['existing'];
				$status['present'][ $row['slug'] ] = $id;
			} else {
				++$result['created'];
				$status['present'][ $row['slug'] ] = $id;
			}
		}

		$meta = statchasers_player_page_meta( $row );

		statchasers_team_fill_meta( $id, 'rank_math_title', $meta['title'] );
		statchasers_team_fill_meta( $id, 'rank_math_description', $meta['description'] );
		statchasers_team_fill_meta( $id, 'rank_math_robots', array( 'index', 'follow' ) );
	}

	$result['next'] = min( $total, max( 0, $offset ) + $done );

	if ( $result['next'] >= $total ) {
		statchasers_player_write_index( $container );
		flush_rewrite_rules();
	}

	return $result;
}

/**
 * Rank Math's three fields for one profile.
 *
 * MIRRORED FROM scripts/create-player-pages.sh, which wrote the same strings
 * from WP-CLI. The two exist for different hosting rather than for different
 * output, so they have to agree.
 *
 * @param array<string,string> $row Roster row.
 * @return array{title:string,description:string}
 */
function statchasers_player_page_meta( array $row ): array {

	// "Bijan Robinson (RB, ATL)" - the opening the API's profileMeta() uses.
	$who = $row['name'];
	if ( '' !== $row['position'] && '' !== $row['team'] ) {
		$who = sprintf( '%s (%s, %s)', $row['name'], $row['position'], $row['team'] );
	} elseif ( '' !== $row['position'] ) {
		$who = sprintf( '%s (%s)', $row['name'], $row['position'] );
	}

	return array(
		// mak's refresh of 2026-10-09: the hub's search is "X fantasy", so the
		// title leads with it and the year, and gives way by rungs for the long
		// names (statchasers_player_title_ladder). No " | StatChasers" since
		// 2026-10-08. statchasers_player_retitle_apply() moves the stored
		// titles over.
		'title'       => statchasers_fit_title( statchasers_player_title_ladder( $row['name'] ) ),
		// The offseason wording. In season the API builds one from live data
		// (rank, rate, next game) and the plugin prefers it: see
		// statchasers_player_request_meta().
		'description' => sprintf(
			'%1$s fantasy football profile: %2$s outlook, projections, stats, injury history and dynasty value.',
			$who,
			STATCHASERS_TEAM_SEASON
		),
	);
}

/**
 * The profile title's rungs, fullest first. MIRRORS profileMeta() in the
 * API's src/lib/player-seo.ts. Change one and change the other.
 *
 * @return string[]
 */
function statchasers_player_title_ladder( string $name ): array {
	return array(
		sprintf( '%s Fantasy Football %s: Stats, Outlook & News', $name, STATCHASERS_TEAM_SEASON ),
		sprintf( '%s Fantasy Football %s: Stats & Outlook', $name, STATCHASERS_TEAM_SEASON ),
		sprintf( '%s Fantasy %s: Stats & Outlook', $name, STATCHASERS_TEAM_SEASON ),
	);
}

/**
 * Fill the container page, grouped by team.
 *
 * A parent page with no body is a thin page that still sits in the sitemap.
 * Six hundred links in one column is not much better, so they are grouped -
 * which also makes it a page a reader can use. The grouping is the tool's now:
 * the mount is [statchasers_player_index], which prints the same roster the
 * standalone /player page does, so the page that lists the profiles is drawn by
 * the thing that draws the profiles rather than by the theme's <ul> styling.
 *
 * Written when the page is empty, and over the stub the old version of this
 * function wrote. Anything else there is yours and is left alone - the same
 * promise every other write here makes.
 */
/** The intro paragraph above the index. Also the stub's signature; see below. */
const STATCHASERS_PLAYER_INDEX_LEAD = 'Fantasy football profiles for every rostered NFL skill player: game logs, weekly finishes, advanced metrics, injury history and career production.';

/**
 * Is this body the bare list this function used to write?
 *
 * It used to build the index itself: a paragraph, a heading per team and a
 * bullet per player, styled by whatever the theme does with a <ul>. That was
 * only ever there so the parent was not a thin page in the sitemap, and it
 * shipped looking nothing like the profiles it points at. The shortcode
 * replaces it.
 *
 * Recognized by its own lead sentence plus a wall of links to the player path
 * and no shortcode of any kind. Nobody's hand-written page looks like that,
 * which is what makes replacing it safe: anything we do not positively
 * recognize is left alone, because an index somebody has edited is theirs.
 *
 * @param string $content Page body.
 */
function statchasers_player_index_is_stub( string $content ): bool {
	if ( false === strpos( $content, STATCHASERS_PLAYER_INDEX_LEAD ) ) {
		return false;
	}

	// Both helpers live in statchasers-team-pages.php; see the note there for
	// why neither test is spelled out inline any more.
	if ( statchasers_index_has_shortcode( $content ) ) {
		return false;
	}

	return statchasers_index_link_count( $content, STATCHASERS_PLAYER_PATH ) >= 50;
}

function statchasers_player_write_index( int $container ): void {
	$post = get_post( $container );

	if ( ! $post instanceof WP_Post ) {
		return;
	}

	$content = (string) $post->post_content;

	// Already mounted. Re-running the build must not churn the page.
	if ( has_shortcode( $content, STATCHASERS_PLAYER_INDEX_SHORTCODE ) ) {
		return;
	}

	if ( '' !== trim( $content ) && ! statchasers_player_index_is_stub( $content ) ) {
		return;
	}


	// The body we are replacing was stored inside a builder's wrapper, so the
	// flag that says "this page is built with the builder" has to come off with
	// it. Left on, Divi keeps claiming a layout that is no longer there: the
	// editor opens on an empty canvas and the front end can re-wrap the plain
	// body in section markup the page no longer has any use for.
	if ( statchasers_index_is_builder_content( $content ) ) {
		delete_post_meta( $container, '_et_pb_use_builder' );
		delete_post_meta( $container, '_et_pb_old_content' );
	}

	wp_update_post(
		array(
			'ID'           => $container,
			'post_content' => '<p>' . esc_html( STATCHASERS_PLAYER_INDEX_LEAD ) . '</p>' .
				"\n\n[" . STATCHASERS_PLAYER_INDEX_SHORTCODE . ']',
		)
	);
}

/* ----------------------------------------------------------------- redirects */

/**
 * A profile that has moved answers at its old address, as a 301.
 *
 * WHY NOT CORE'S. wp_old_slug_redirect() exists and is already hooked, but it
 * does not reach these URLs. It only runs when the query carries `name`, and it
 * looks the slug up as a POST - these are pages, nested two deep, and the
 * section addresses (`/nfl/players/<player>/injury/`) are a rewrite of ours
 * that core has never heard of. So the lookup is done here, scoped to the
 * player container, and the section segment is carried across with it.
 *
 * WHAT IT READS. `_wp_old_slug`, which WordPress writes whenever a post_name
 * changes and which statchasers_player_move_page() tops up with any earlier
 * address. That is a local record: it keeps working when the API is
 * unreachable, which is exactly when a 404 would be most expensive.
 *
 * Only a 404 is considered, so this can never take a URL that resolves.
 */
add_action( 'template_redirect', 'statchasers_player_old_slug_redirect', 9 );

function statchasers_player_old_slug_redirect(): void {
	if ( ! is_404() ) {
		return;
	}

	$base = function_exists( 'statchasers_player_url_base' )
		? statchasers_player_url_base()
		: STATCHASERS_PLAYER_PATH;

	$wp      = $GLOBALS['wp'] ?? null;
	$request = $wp instanceof WP ? trim( (string) $wp->request, '/' ) : '';

	if ( '' === $request || 0 !== strpos( $request . '/', $base . '/' ) ) {
		return;
	}

	$rest = array_values( array_filter( explode( '/', trim( substr( $request, strlen( $base ) ), '/' ) ) ) );

	if ( empty( $rest ) || count( $rest ) > 2 ) {
		return;
	}

	$slug    = sanitize_title( $rest[0] );
	$section = isset( $rest[1] ) ? sanitize_title( $rest[1] ) : '';

	if ( '' === $slug ) {
		return;
	}

	// A second segment that is not one of ours is not a section URL, and
	// guessing at it would turn a correct 404 into a redirect to the profile.
	if ( '' !== $section && ! in_array( $section, STATCHASERS_PLAYER_SECTIONS, true ) ) {
		return;
	}

	$found = statchasers_player_page_by_old_slug( $slug );

	if ( ! $found ) {
		return;
	}

	$target = get_permalink( $found );

	if ( ! $target ) {
		return;
	}

	// Overview is the profile itself, so an old slug's /overview/ goes straight
	// there rather than through the new slug's /overview/ and a second 301.
	if ( '' !== $section && 'overview' !== $section ) {
		$target = user_trailingslashit( trailingslashit( $target ) . $section );
	}

	// The query is the reader's, not the address's: ?format=half names a set of
	// numbers and has to survive the move.
	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$query = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_QUERY );

	if ( '' !== $query ) {
		$target .= '?' . $query;
	}

	wp_safe_redirect( $target, 301 );
	exit;
}

/**
 * The profile page that used to answer at this slug, or 0.
 *
 * @param string $slug A sanitized slug.
 * @return int
 */
function statchasers_player_page_by_old_slug( string $slug ): int {
	$container = statchasers_player_container();

	if ( ! $container || '' === $slug ) {
		return 0;
	}

	$found = get_posts(
		array(
			'post_type'        => 'page',
			'post_parent'      => $container,
			'post_status'      => 'publish',
			'numberposts'      => 1,
			'fields'           => 'ids',
			'no_found_rows'    => true,
			'suppress_filters' => false,
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_meta_query -- one indexed
			// meta lookup, on a 404 or a legacy address only, against a few
			// hundred child pages.
			'meta_key'         => '_wp_old_slug',
			'meta_value'       => $slug,
		)
	);

	return empty( $found ) ? 0 : (int) $found[0];
}

/**
 * The profile page for a slug, current or former, or 0.
 *
 * @param string $slug A sanitized slug.
 * @return int
 */
function statchasers_player_page_for_slug( string $slug ): int {
	$container = statchasers_player_container();

	if ( ! $container || '' === $slug ) {
		return 0;
	}

	$found = get_posts(
		array(
			'post_type'        => 'page',
			'post_parent'      => $container,
			'post_status'      => 'publish',
			'name'             => $slug,
			'numberposts'      => 1,
			'fields'           => 'ids',
			'no_found_rows'    => true,
			'suppress_filters' => false,
		)
	);

	return empty( $found ) ? statchasers_player_page_by_old_slug( $slug ) : (int) $found[0];
}

/**
 * Where a retired player address lives now, or '' when it is not one.
 *
 * Two earlier structures are indexed and still crawled:
 *
 * - `/nfl/players/<section>/<slug>/` - the old section-first layout. The
 *   Outlook half was real pages (`/nfl/players/outlook/josh-allen/`) carrying
 *   an older implementation, and the team hubs linked to them until the API's
 *   profile template was corrected. It becomes `/nfl/players/<slug>/<section>/`.
 * - `/fantasy-football/players/<slug>/[<section>/]` - the redraft-era profile.
 *   It 404s now; it becomes the profile at the same section.
 *
 * `overview` goes to the profile itself, as `/<slug>/overview/` does. Only a
 * player who has a page today is redirected: an address whose player has no
 * profile keeps answering as it does, rather than being sent to a 404. A second
 * segment that is not one of the sections is not a match.
 *
 * @param string $request The request path, without the leading slash.
 * @return string Absolute target, or ''.
 */
function statchasers_player_legacy_target( string $request ): string {
	$base     = statchasers_player_url_base();
	$segments = array_values( array_filter( explode( '/', trim( $request, '/' ) ), 'strlen' ) );
	$request  = implode( '/', $segments );
	$slug     = '';
	$section  = '';

	if ( 0 === strpos( $request . '/', $base . '/' ) ) {
		$rest = array_slice( $segments, count( explode( '/', $base ) ) );
		if ( 2 !== count( $rest ) || ! in_array( $rest[0], STATCHASERS_PLAYER_SECTIONS, true ) ) {
			return '';
		}
		$section = $rest[0];
		$slug    = $rest[1];
	} elseif ( 0 === strpos( $request . '/', 'fantasy-football/players/' ) ) {
		$rest = array_slice( $segments, 2 );
		if ( 1 === count( $rest ) ) {
			$slug = $rest[0];
		} elseif ( 2 === count( $rest ) && in_array( $rest[1], STATCHASERS_PLAYER_SECTIONS, true ) ) {
			$slug    = $rest[0];
			$section = $rest[1];
		} else {
			return '';
		}
	} else {
		return '';
	}

	$page = statchasers_player_page_for_slug( sanitize_title( $slug ) );
	if ( ! $page ) {
		return '';
	}

	$target = (string) get_permalink( $page );
	if ( '' === $target ) {
		return '';
	}

	if ( '' !== $section && 'overview' !== $section ) {
		$target = user_trailingslashit( trailingslashit( $target ) . $section );
	}

	return $target;
}

/**
 * 301 a retired player address to its profile. See the function above.
 *
 * Not limited to 404s, unlike the old-slug redirect: the old Outlook pages
 * still resolve, and resolving is the problem.
 */
function statchasers_player_legacy_redirect(): void {
	$wp      = $GLOBALS['wp'] ?? null;
	$request = $wp instanceof WP ? (string) $wp->request : '';

	if ( '' === $request ) {
		return;
	}

	$target = statchasers_player_legacy_target( $request );

	if ( '' === $target ) {
		return;
	}

	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$query = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_QUERY );

	wp_safe_redirect( '' === $query ? $target : $target . '?' . $query, 301 );
	exit;
}
add_action( 'template_redirect', 'statchasers_player_legacy_redirect', 8 );

/* ------------------------------------------------------------------ headings */

/**
 * The H1 for one profile URL, built from the player and the section.
 *
 * MIRRORS sectionHeading() and profileHeading() in the API's
 * src/lib/player-render.ts, including which sections carry a year: stats, the
 * game log and the outlook do, because the year is part of the phrase people
 * type for those three and not for the others.
 *
 * The profile itself (no section) is "Josh Allen Fantasy Football Stats &
 * Analysis" - the player and what the page is for, like the six beside it. It
 * was the bare name, which is the hero's words and says nothing about intent.
 * The Overview has no heading of its own: `/overview/` 301s to the profile.
 *
 * The name comes from the roster when it is cached and from the page's own
 * title when it is not - with the "(QB)" the builder appends taken back off,
 * since that is a disambiguator for an admin list rather than a heading.
 */
function statchasers_player_heading( string $slug, string $section ): string {
	$name = statchasers_player_name( $slug );

	if ( '' === $name ) {
		return '';
	}

	$phrases = array(
		'stats'    => 'Stats',
		'injury'   => 'Injury Update & History',
		'game-log' => 'Game Log',
		'outlook'  => 'Fantasy Outlook',
		// Was "News & Analysis"; mak approved the change on 2026-09-30.
		'news'     => 'News & Updates',
		'bio'      => 'Bio',
	);

	if ( ! isset( $phrases[ $section ] ) ) {
		// "{Name} Fantasy Football" since 2026-10-09 (mak); "Stats" belongs to
		// the Stats tab's heading. The small line under it is the lead.
		return $name . ' Fantasy Football';
	}

	if ( 'news' === $section ) {
		return sprintf( 'Latest %s %s', $name, $phrases['news'] );
	}

	$dated = in_array( $section, array( 'stats', 'game-log', 'outlook' ), true );

	return $dated
		? sprintf( '%s %s %s', $name, $phrases[ $section ], STATCHASERS_TEAM_SEASON )
		: sprintf( '%s %s', $name, $phrases[ $section ] );
}

/**
 * Rewrite the page title on a profile, which is the theme's H1.
 *
 * Same filter and the same three guards as the team version: only the main
 * query's own title, only in the loop, and only on a page this plugin's
 * shortcode is actually on - `the_title` is called for menu items, admin lists
 * and widgets, and rewriting those would rename the page everywhere it is
 * mentioned rather than heading the one it is.
 *
 * Without this, a section URL inherits the profile's stored title and six
 * addresses share one heading.
 */
add_filter(
	'the_title',
	static function ( $title, $id = 0 ) {
		if ( ! is_singular( 'page' ) || ! in_the_loop() || ! is_main_query() ) {
			return $title;
		}

		$queried = get_queried_object();
		if ( ! $queried instanceof WP_Post || (int) $queried->ID !== (int) $id ) {
			return $title;
		}

		if ( ! has_shortcode( (string) $queried->post_content, STATCHASERS_PLAYER_SHORTCODE ) ) {
			return $title;
		}

		$heading = statchasers_player_heading(
			(string) $queried->post_name,
			function_exists( 'statchasers_player_section_from_url' )
				? statchasers_player_section_from_url()
				: ''
		);

		return '' === $heading ? $title : $heading;
	},
	10,
	2
);

/**
 * The <h1> the player shortcode prints itself. Off unless the probe says so.
 *
 * Identical in shape and reasoning to statchasers_team_shortcode_heading():
 * on a template that prints the page title there is already an H1 and a second
 * would be worse than none. statchasers-h1.php answers the question from a
 * measurement rather than a guess.
 *
 * @param string $slug    Player slug.
 * @param string $section Section id, or ''.
 */
function statchasers_player_shortcode_heading( string $slug, string $section ): string {
	if ( ! apply_filters( 'statchasers_player_shortcode_h1', false ) ) {
		return '';
	}

	return statchasers_page_heading_html(
		statchasers_player_heading( $slug, $section ),
		statchasers_player_lead( $slug, $section )
	);
}

/**
 * The player's name, from the roster if it is cached and from the page if not.
 *
 * Both callers need it and both used to find it separately, which is how the
 * lead ended up empty on a site whose roster cache had not warmed yet: the
 * heading had a fallback and the lead did not. The stored title carries the
 * position as a disambiguator for the admin list - "Kyler Murray (QB)" - and
 * that is a label rather than a heading, so it comes back off.
 */
function statchasers_player_name( string $slug ): string {
	$row = statchasers_player_roster_row( $slug );

	if ( null !== $row && '' !== $row['name'] ) {
		return $row['name'];
	}

	$queried = get_queried_object();

	return $queried instanceof WP_Post
		? trim( (string) preg_replace( '/\s*\([A-Z]{1,3}\)\s*$/', '', $queried->post_title ) )
		: '';
}

/**
 * The sentence under a profile's heading.
 *
 * The team pages take theirs from statchasers_team_section_meta(), which is
 * already written per section. A profile has no such table - the builder writes
 * one description for the page and nothing for the seven addresses beneath it -
 * so the per-section wording is here, and it names what that panel actually
 * holds rather than describing the profile seven times.
 *
 * No pronouns, on purpose. These are generated for several hundred real people
 * from a roster feed that does not carry one.
 */
function statchasers_player_lead( string $slug, string $section ): string {
	$name = statchasers_player_name( $slug );

	if ( '' === $name ) {
		return '';
	}

	// Whole sentences rather than a stem plus a fragment: "Kyler Murray's 2026
	// week by week" is what the fragment version produced, and there is no stem
	// that works for all seven.
	$leads = array(
		'stats'    => '%1$s\'s %2$s season stats, with the per-game rates and the efficiency marks behind them.',
		'game-log' => 'Every %2$s game %1$s has played, week by week, with the fantasy points each one produced.',
		'outlook'  => 'The %2$s fantasy outlook for %1$s: the role, the usage behind it and what it is worth on draft day.',
		'injury'   => '%1$s\'s current injury designation, and the history behind it.',
		'news'     => 'The latest %1$s news, and what each item changes for fantasy.',
		'overview' => '%1$s\'s %2$s season at a glance: the finishes, the usage and the trend.',
		'bio'      => '%1$s\'s age, height, college, draft position and career production.',
	);

	if ( isset( $leads[ $section ] ) ) {
		return sprintf( $leads[ $section ], $name, STATCHASERS_TEAM_SEASON );
	}

	// The profile's lead is the small line under its H1 - "RB, Atlanta
	// Falcons" (mak, 2026-10-09) - which the API prints the same way under
	// the heading it supplies. Without the roster there is nothing to write
	// it from, and the heading stands alone.
	$row = statchasers_player_roster_row( $slug );
	if ( null === $row ) {
		return '';
	}

	return implode( ', ', array_filter( array( $row['position'], $row['teamName'] ) ) );
}

add_filter(
	'statchasers_player_fragment_html',
	static function ( $html, $slug = '' ) {
		$section = function_exists( 'statchasers_player_section_from_url' )
			? statchasers_player_section_from_url()
			: '';

		return statchasers_player_shortcode_heading( (string) $slug, $section ) . (string) $html;
	},
	10,
	2
);

/* --------------------------------------------------------------------- admin */

/**
 * One batch, over AJAX.
 *
 * This is what the loop actually runs on. The POST handler below still works
 * and is what happens with no JavaScript, but a full admin page render between
 * every batch is most of the cost of a build - WordPress boots the admin, the
 * screen re-queries the page status, every other panel on it redraws - for a
 * request whose real work is a few dozen inserts. Against ~575 players that
 * overhead was the build.
 *
 * Same writes, same cursor, same idempotence; only the transport is different.
 */
add_action(
	'wp_ajax_statchasers_player_build',
	static function (): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Not allowed.' ), 403 );
		}

		check_ajax_referer( 'statchasers_player_build' );

		$offset = isset( $_POST['offset'] ) ? absint( wp_unslash( $_POST['offset'] ) ) : 0;
		$result = statchasers_player_build_batch( $offset );
		$status = statchasers_player_page_status( true );

		wp_send_json_success(
			array(
				'next'    => (int) $result['next'],
				'total'   => (int) $result['total'],
				'have'    => (int) $status['have'],
				'done'    => (int) $result['next'] >= (int) $result['total'],
				'created' => (int) $result['created'],
				'moved'   => (int) $result['moved'],
				'errors'  => array_values( (array) $result['errors'] ),
			)
		);
	}
);

/**
 * Drive the batch loop without JavaScript.
 *
 * One POST per batch, with the cursor in the form rather than in the session:
 * a refresh re-runs a batch that has already been written, which is a no-op,
 * and closing the tab halfway leaves the pages that were written in place.
 */
add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_player_build'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_player_build' );

		// The loop below resumes itself whenever this screen is opened with a
		// cursor still set, so there has to be something that clears it that is
		// not "close the tab before the next batch".
		if ( isset( $_POST['statchasers_player_stop'] ) ) {
			delete_option( STATCHASERS_PLAYER_CURSOR );
			wp_safe_redirect(
				add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) )
			);
			exit;
		}

		$offset = isset( $_POST['offset'] ) ? absint( wp_unslash( $_POST['offset'] ) ) : 0;
		$result = statchasers_player_build_batch( $offset );

		$running = (array) get_option( STATCHASERS_PLAYER_CURSOR, array() );

		update_option(
			STATCHASERS_PLAYER_CURSOR,
			array(
				'next'     => (int) $result['next'],
				'total'    => (int) $result['total'],
				'created'  => (int) ( $running['created'] ?? 0 ) + (int) $result['created'],
				'existing' => (int) ( $running['existing'] ?? 0 ) + (int) $result['existing'],
				'moved'    => (int) ( $running['moved'] ?? 0 ) + (int) $result['moved'],
				'errors'   => array_slice(
					array_merge( (array) ( $running['errors'] ?? array() ), $result['errors'] ),
					0,
					20
				),
				'done'     => (int) $result['next'] >= (int) $result['total'],
			),
			false
		);

		wp_safe_redirect(
			add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) )
		);
		exit;
	}
);

/* ---------------------------------------------------------- the retitle */

/**
 * The profile title the builder writes for a player, from the stored title it
 * wrote before, or '' when the stored title is not one of ours.
 *
 * Two templates: "<name> Fantasy Football Stats & Analysis", with and without
 * the brand, was the builder's wording until 2026-10-09, and the dated ladder
 * of statchasers_player_title_ladder() is the wording since. Anything else
 * that is not empty was typed by a person and is theirs.
 *
 * @param string $title Stored rank_math_title.
 * @return string The current wording for that name, or '' for a custom title.
 */
function statchasers_player_generated_title( string $title ): string {
	$title = trim( $title );
	// The wording until 2026-10-09, with and without the brand.
	if ( 1 === preg_match( '/^(.+) Fantasy Football Stats & Analysis(?: \| StatChasers)?$/', $title, $m ) ) {
		return statchasers_fit_title( statchasers_player_title_ladder( $m[1] ) );
	}
	// The wording since: any rung of the ladder, for any year.
	if ( 1 === preg_match( '/^(.+) Fantasy(?: Football)? (\d{4}): Stats(?:, Outlook & News| & Outlook)$/', $title, $m ) ) {
		return statchasers_fit_title( statchasers_player_title_ladder( $m[1] ) );
	}
	return '';
}

/**
 * Which profile pages the retitle would touch, and which it would leave alone.
 *
 * Every page under the container, not the roster's: a player who has left the
 * index keeps his page (see statchasers_player_page_status()) and it carries
 * the old wording like the rest. A page with no title at all is filled from
 * the roster when the player is on it, and left alone when he is not - there
 * is nothing to write it from.
 *
 * @return array{eligible:array<int,string>,custom:array<int,string>}
 */
function statchasers_player_retitle_plan(): array {
	global $wpdb;

	$plan      = array( 'eligible' => array(), 'custom' => array() );
	$container = statchasers_player_container();
	if ( ! $container ) {
		return $plan;
	}

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_name FROM {$wpdb->posts}
			 WHERE post_type = 'page' AND post_parent = %d AND post_status != 'trash'",
			$container
		)
	);
	$ids = array_map( static fn( $row ) => (int) $row->ID, (array) $rows );
	if ( $ids ) {
		update_meta_cache( 'post', $ids ); // One query for all the titles, not one each.
	}

	$roster = array();
	foreach ( statchasers_player_roster() as $row ) {
		$roster[ $row['slug'] ] = $row['name'];
	}

	foreach ( (array) $rows as $row ) {
		$id      = (int) $row->ID;
		$slug    = (string) $row->post_name;
		$current = trim( (string) get_post_meta( $id, 'rank_math_title', true ) );

		if ( '' === $current ) {
			if ( isset( $roster[ $slug ] ) ) {
				$plan['eligible'][ $id ] = statchasers_fit_title( statchasers_player_title_ladder( $roster[ $slug ] ) );
			}
			continue;
		}

		$wanted = statchasers_player_generated_title( $current );
		if ( '' === $wanted ) {
			$plan['custom'][ $id ] = $slug;
		} elseif ( $wanted !== $current ) {
			$plan['eligible'][ $id ] = $wanted;
		}
	}

	return $plan;
}

/**
 * Apply the plan: the eligible pages only.
 *
 * @return int Pages updated.
 */
function statchasers_player_retitle_apply(): int {
	$done = 0;
	foreach ( statchasers_player_retitle_plan()['eligible'] as $id => $title ) {
		update_post_meta( $id, 'rank_math_title', $title );
		++$done;
	}
	return $done;
}

add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_player_retitle'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_player_retitle' );

		set_transient( 'statchasers_player_retitle_result', statchasers_player_retitle_apply(), MINUTE_IN_SECONDS );

		wp_safe_redirect( add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) ) );
		exit;
	}
);

/** The retitle panel on the Tools screen. Printed by statchasers_team_pages_screen(). */
function statchasers_player_retitle_panel(): void {
	$result = get_transient( 'statchasers_player_retitle_result' );
	if ( false !== $result ) {
		delete_transient( 'statchasers_player_retitle_result' );
		printf(
			'<div class="notice notice-success is-dismissible"><p><strong>Done.</strong> %d profile title%s updated.</p></div>',
			(int) $result,
			1 === (int) $result ? '' : 's'
		);
	}

	$plan     = statchasers_player_retitle_plan();
	$eligible = count( $plan['eligible'] );
	$custom   = count( $plan['custom'] );

	echo '<h2>Profile titles</h2>';
	echo '<p>The profile title is now <code>&lt;player&gt; Fantasy Football Stats &amp; Analysis</code>, with no ' .
		'<code>| StatChasers</code>: with the brand, every name past twelve letters ran over the sixty characters ' .
		'a results page shows. Pages still carrying it, or no title, can be moved here. ' .
		'A title someone typed by hand is never touched.</p>';
	printf(
		'<p><strong>%d eligible &middot; %d custom title%s left alone</strong></p>',
		$eligible,
		$custom,
		1 === $custom ? '' : 's'
	);

	if ( $custom ) {
		echo '<p class="description">Custom: <code>' . esc_html( implode( '</code>, <code>', array_slice( $plan['custom'], 0, 40 ) ) ) . '</code>' .
			( $custom > 40 ? esc_html( sprintf( ' and %d more', $custom - 40 ) ) : '' ) . '</p>';
	}

	if ( $eligible ) {
		echo '<form method="post">';
		wp_nonce_field( 'statchasers_player_retitle' );
		printf(
			'<p><button type="submit" name="statchasers_player_retitle" value="1" class="button button-primary">Update %d title%s</button></p>',
			$eligible,
			1 === $eligible ? '' : 's'
		);
		echo '</form>';
	} else {
		echo '<p>Nothing to update.</p>';
	}
}

/* ------------------------------------------------ the daily automatic build */

/**
 * New signings get their pages without anybody pressing the button.
 *
 * The API rebuilds its player index once a day (src/lib/player/live-refresh.ts
 * on the API side, 14:00 UTC). A player it adds had no page here until
 * somebody ran the builder on the Tools screen, and until then his address
 * 404ed. This runs the same batches from WP-cron an hour later: the same
 * writes, the same idempotence, the same page moves for renamed players.
 *
 * Nothing happens on a day the roster did not change and every page exists -
 * one request for the list, one query for the pages. A build too long for one
 * cron run keeps its place in an option and continues a minute later, so a
 * shared host's time limit cannot leave it half done for a day.
 */
const STATCHASERS_PLAYER_AUTO_HOOK   = 'statchasers_player_auto_build';
const STATCHASERS_PLAYER_AUTO_CURSOR = 'statchasers_player_auto_cursor';
const STATCHASERS_PLAYER_AUTO_HASH   = 'statchasers_player_auto_hash';

/** Seconds of batches per cron run, inside a 30-second max_execution_time. */
const STATCHASERS_PLAYER_AUTO_BUDGET = 20.0;

add_action(
	'init',
	static function (): void {
		if ( wp_next_scheduled( STATCHASERS_PLAYER_AUTO_HOOK ) ) {
			return;
		}
		$next = strtotime( 'today 15:00 UTC' );
		if ( $next <= time() ) {
			$next += DAY_IN_SECONDS;
		}
		wp_schedule_event( $next, 'daily', STATCHASERS_PLAYER_AUTO_HOOK );
	}
);

add_action( STATCHASERS_PLAYER_AUTO_HOOK, 'statchasers_player_auto_build' );

/** What the roster says, reduced to what decides pages: slugs and old slugs. */
function statchasers_player_roster_hash( array $roster ): string {
	$shape = array();
	foreach ( $roster as $row ) {
		$shape[] = array( $row['slug'], (array) ( $row['previous'] ?? array() ) );
	}
	return md5( (string) wp_json_encode( $shape ) );
}

/** One cron run: resume or start a build, as far as the budget allows. */
function statchasers_player_auto_build(): void {
	$cursor = get_option( STATCHASERS_PLAYER_AUTO_CURSOR );
	$offset = is_array( $cursor ) ? (int) ( $cursor['next'] ?? 0 ) : 0;

	if ( 0 === $offset ) {
		$roster = statchasers_player_roster( true );
		if ( ! $roster ) {
			// The API did not answer. Tomorrow's run tries again.
			return;
		}
		$status  = statchasers_player_page_status( true );
		$missing = 0;
		foreach ( $roster as $row ) {
			if ( ! isset( $status['present'][ $row['slug'] ] ) ) {
				++$missing;
			}
		}
		if ( 0 === $missing && get_option( STATCHASERS_PLAYER_AUTO_HASH ) === statchasers_player_roster_hash( $roster ) ) {
			return;
		}
	}

	$started = microtime( true );
	do {
		$result = statchasers_player_build_batch( $offset );
		if ( ! empty( $result['locked'] ) ) {
			// Somebody else is building - the button, most likely. Their
			// pages are the same pages; come back when they are done.
			wp_schedule_single_event( time() + MINUTE_IN_SECONDS, STATCHASERS_PLAYER_AUTO_HOOK );
			return;
		}
		$offset = (int) $result['next'];
		$total  = (int) $result['total'];
	} while ( $offset < $total && microtime( true ) - $started < STATCHASERS_PLAYER_AUTO_BUDGET );

	if ( $offset >= $total ) {
		delete_option( STATCHASERS_PLAYER_AUTO_CURSOR );
		update_option( STATCHASERS_PLAYER_AUTO_HASH, statchasers_player_roster_hash( statchasers_player_roster() ), false );
		return;
	}

	update_option( STATCHASERS_PLAYER_AUTO_CURSOR, array( 'next' => $offset ), false );
	wp_schedule_single_event( time() + MINUTE_IN_SECONDS, STATCHASERS_PLAYER_AUTO_HOOK );
}

/** The panel on the Tools screen. */
function statchasers_player_panel(): void {
	$status = statchasers_player_page_status( true );
	$cursor = (array) get_option( STATCHASERS_PLAYER_CURSOR, array() );
	$total  = (int) $status['total'];
	$have   = (int) $status['have'];

	echo '<h2>Player pages</h2>';

	printf(
		'<p>Profiles live at <code>/%s/&lt;player&gt;/</code>, one page each, carrying the <code>[%s]</code> shortcode and nothing else. ' .
		'The list is the API\'s indexed players - the ones with a game log and an advanced row behind them, not the whole league.</p>',
		esc_html( STATCHASERS_PLAYER_PATH ),
		esc_html( STATCHASERS_PLAYER_SHORTCODE )
	);

	if ( 0 === $total ) {
		echo '<div class="notice notice-error inline"><p>The player list could not be read from the API. ' .
			'Check <code>STATCHASERS_NEWS_ORIGIN</code> and that the deployment is up.</p></div>';
		return;
	}

	printf(
		'<p><strong>%d of %d</strong> pages exist.</p>',
		(int) $have,
		(int) $total
	);

	$others = count( $status['present'] ) - $have;
	if ( $others > 0 ) {
		printf(
			'<p class="description">%d more pages under <code>/%s/</code> belong to players no longer on the list. They are kept, not deleted.</p>',
			(int) $others,
			esc_html( STATCHASERS_PLAYER_PATH )
		);
	}

	foreach ( array_slice( (array) ( $cursor['errors'] ?? array() ), 0, 5 ) as $error ) {
		printf( '<div class="notice notice-error inline"><p>%s</p></div>', esc_html( (string) $error ) );
	}

	$running = ! empty( $cursor ) && empty( $cursor['done'] );
	$offset  = $running ? (int) $cursor['next'] : 0;

	if ( ! empty( $cursor['done'] ) ) {
		$moved = (int) ( $cursor['moved'] ?? 0 );

		printf(
			'<div class="notice notice-success inline"><p><strong>Done.</strong> %d created, %d already existed%s.</p></div>',
			(int) ( $cursor['created'] ?? 0 ),
			(int) ( $cursor['existing'] ?? 0 ),
			// Worth naming: a move changes a live URL, and the old one is only
			// a 301 from here on rather than a page.
			$moved
				? esc_html( sprintf( ', %d moved to a new address', $moved ) )
				: ''
		);
		delete_option( STATCHASERS_PLAYER_CURSOR );
	}

	if ( $have >= $total && ! $running ) {
		echo '<p><strong>Every profile has a page.</strong> Nothing to do.</p>';
		return;
	}

	echo '<form method="post" id="sc-player-build">';
	wp_nonce_field( 'statchasers_player_build' );
	printf( '<input type="hidden" name="offset" value="%d" />', (int) $offset );

	printf(
		'<p><progress id="sc-player-bar" value="%d" max="%d" style="width:320px"></progress> ' .
		'<span id="sc-player-count">%d of %d</span></p>',
		(int) $have,
		(int) $total,
		(int) $have,
		(int) $total
	);

	printf(
		'<p><button type="submit" name="statchasers_player_build" value="1" class="button button-primary button-hero" id="sc-player-go">%s</button> ' .
		'<button type="submit" name="statchasers_player_stop" value="1" class="button" id="sc-player-stop" hidden>Stop</button></p>',
		$running
			? esc_html( sprintf( 'Continue from %d', $offset ) )
			: esc_html( sprintf( 'Create the %d missing pages', max( 0, $total - $have ) ) )
	);

	echo '<p class="description" id="sc-player-note">Writes for ten seconds at a time so a shared ' .
		'host does not time out, then asks for the next lot. Safe to stop and resume: existing ' .
		'pages are never modified.</p>';

	echo '</form>';

	// The loop. Each round is one admin-ajax request that writes for ten
	// seconds; with JS off the button above posts the form and does exactly one
	// of those per click, which is the same build at a slower pace.
	printf(
		'<script>(function(){
			var form=document.getElementById("sc-player-build");
			var go=document.getElementById("sc-player-go");
			var stop=document.getElementById("sc-player-stop");
			var bar=document.getElementById("sc-player-bar");
			var count=document.getElementById("sc-player-count");
			var note=document.getElementById("sc-player-note");
			var offset=%1$d, total=%2$d, stopped=false;
			function round(){
				if(stopped){return;}
				var body=new FormData();
				body.append("action","statchasers_player_build");
				body.append("_ajax_nonce",%3$s);
				body.append("offset",offset);
				fetch(%4$s,{method:"POST",credentials:"same-origin",body:body})
					.then(function(r){return r.json();})
					.then(function(res){
						if(!res||!res.success){throw new Error("bad response");}
						var d=res.data;
						offset=d.next; total=d.total;
						bar.value=d.have; bar.max=d.total;
						count.textContent=d.have+" of "+d.total;
						if(d.errors&&d.errors.length){note.textContent=d.errors[0];}
						if(d.done){
							go.disabled=false; go.textContent="Done";
							stop.hidden=true;
							note.textContent="Finished. Every profile has a page.";
							return;
						}
						round();
					})
					.catch(function(){
						stopped=true; go.disabled=false; stop.hidden=true;
						note.textContent="The last batch failed. Press the button to resume from where it stopped.";
					});
			}
			form.addEventListener("submit",function(e){
				if(e.submitter&&e.submitter.id==="sc-player-stop"){return;}
				e.preventDefault();
				stopped=false; go.disabled=true; stop.hidden=false;
				go.textContent="Working\u2026";
				round();
			});
			stop.addEventListener("click",function(e){
				e.preventDefault();
				stopped=true; go.disabled=false; stop.hidden=true;
				go.textContent="Continue from "+offset;
				note.textContent="Stopped. Nothing written so far is lost.";
			});
		})();</script>',
		(int) $offset,
		(int) $total,
		wp_json_encode( wp_create_nonce( 'statchasers_player_build' ) ),
		wp_json_encode( admin_url( 'admin-ajax.php' ) )
	);
}
