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
 * halfway is not a failure state — the cursor is in an option, every write is
 * idempotent, and pressing the button again resumes.
 *
 * WHERE THE LIST COMES FROM. The API, at /embed/players.json, exactly as
 * scripts/create-player-pages.sh reads it. There are six hundred of these and
 * the list moves every offseason; a copy pasted into this file would be wrong
 * by the time anybody ran it. The endpoint returns the INDEXED players only —
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
 * is spent — whichever comes first — and what actually varies is how many pages
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

	if ( ! $fresh ) {
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return $cached;
		}
	}

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return array();
	}

	$response = wp_remote_get(
		$origin . '/embed/players.json',
		array(
			'timeout' => 20,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return array();
	}

	$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

	if ( ! is_array( $body ) || empty( $body['players'] ) || ! is_array( $body['players'] ) ) {
		return array();
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
		// page's — see previousSlugsFor() on the other side.
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
		);
	}

	set_transient( $key, $rows, STATCHASERS_PLAYER_ROSTER_TTL );

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
 * @return array{container:int,present:array<string,int>,total:int}
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

	$status = array(
		'container' => $container,
		'present'   => $present,
		'total'     => count( statchasers_player_roster() ),
	);

	return $status;
}

/**
 * Move a profile page that is published at one of this player's old addresses.
 *
 * WHY MOVING AND NOT CREATING. A slug can change: two players share a name and
 * the claim on the bare form moves — Kenneth Walker's page was at
 * `kenneth-walker-8151` because a retired receiver with the same name had been
 * given `kenneth-walker` first — or a source corrects a spelling. The builder's
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
 * @return array{next:int,total:int,created:int,existing:int,moved:int,errors:array<int,string>}
 */
function statchasers_player_build_batch( int $offset ): array {
	$roster = statchasers_player_roster();
	$total  = count( $roster );

	$result = array(
		'next'     => $total,
		'total'    => $total,
		'created'  => 0,
		'existing' => 0,
		'moved'    => 0,
		'errors'   => array(),
	);

	if ( 0 === $total ) {
		$result['errors'][] = 'The roster came back empty. Check STATCHASERS_NEWS_ORIGIN and that the deployment is up.';
		return $result;
	}

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
			++$result['created'];
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
	$words = array(
		'QB' => 'quarterback',
		'RB' => 'running back',
		'WR' => 'wide receiver',
		'TE' => 'tight end',
		'K'  => 'kicker',
	);

	$position = $words[ $row['position'] ] ?? strtolower( $row['position'] );
	$where    = '' === $row['teamName'] ? '' : ' ' . $row['teamName'];

	return array(
		'title'       => sprintf( '%s Fantasy Football Stats & Analysis | StatChasers', $row['name'] ),
		'description' => trim(
			sprintf(
				'%1$s%2$s %3$s fantasy football profile: %4$s game log, weekly finishes, advanced metrics, injury history and career production.',
				$row['name'],
				$where,
				$position,
				STATCHASERS_TEAM_SEASON
			)
		),
	);
}

/**
 * Fill the container page, grouped by team.
 *
 * A parent page with no body is a thin page that still sits in the sitemap.
 * Six hundred links in one column is not much better, so they are grouped —
 * which also makes it a page a reader can use. The grouping is the tool's now:
 * the mount is [statchasers_player_index], which prints the same roster the
 * standalone /player page does, so the page that lists the profiles is drawn by
 * the thing that draws the profiles rather than by the theme's <ul> styling.
 *
 * Written when the page is empty, and over the stub the old version of this
 * function wrote. Anything else there is yours and is left alone — the same
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
 * Recognised by its own lead sentence plus a wall of links to the player path
 * and no shortcode of any kind. Nobody's hand-written page looks like that,
 * which is what makes replacing it safe: anything we do not positively
 * recognise is left alone, because an index somebody has edited is theirs.
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
 * looks the slug up as a POST — these are pages, nested two deep, and the
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

	if ( '' !== $section ) {
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
 * @param string $slug A sanitised slug.
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
 * @param string $slug A sanitised slug.
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
 * - `/nfl/players/<section>/<slug>/` — the old section-first layout. The
 *   Outlook half was real pages (`/nfl/players/outlook/josh-allen/`) carrying
 *   an older implementation, and the team hubs linked to them until the API's
 *   profile template was corrected. It becomes `/nfl/players/<slug>/<section>/`.
 * - `/fantasy-football/players/<slug>/[<section>/]` — the redraft-era profile.
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
 * Analysis" — the player and what the page is for, like the six beside it. It
 * was the bare name, which is the hero's words and says nothing about intent.
 * The Overview has no heading of its own: `/overview/` 301s to the profile.
 *
 * The name comes from the roster when it is cached and from the page's own
 * title when it is not — with the "(QB)" the builder appends taken back off,
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
		'news'     => 'News & Analysis',
		'bio'      => 'Bio',
	);

	if ( ! isset( $phrases[ $section ] ) ) {
		return $name . ' Fantasy Football Stats & Analysis';
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
 * shortcode is actually on — `the_title` is called for menu items, admin lists
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
 * position as a disambiguator for the admin list — "Kyler Murray (QB)" — and
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
 * already written per section. A profile has no such table — the builder writes
 * one description for the page and nothing for the seven addresses beneath it —
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

	// The profile itself takes the description the builder already wrote for it,
	// so the page and its Rank Math entry open on the same sentence. Without the
	// roster there is no team or position to write it from, so it falls back to
	// the one sentence that is true of every profile.
	$row = statchasers_player_roster_row( $slug );

	return null === $row
		? sprintf(
			'%1$s\'s %2$s fantasy football profile: game log, weekly finishes, advanced metrics, injury history and career production.',
			$name,
			STATCHASERS_TEAM_SEASON
		)
		: statchasers_player_page_meta( $row )['description'];
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
 * every batch is most of the cost of a build — WordPress boots the admin, the
 * screen re-queries the page status, every other panel on it redraws — for a
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
				'have'    => count( $status['present'] ),
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

/** The panel on the Tools screen. */
function statchasers_player_panel(): void {
	$status = statchasers_player_page_status( true );
	$cursor = (array) get_option( STATCHASERS_PLAYER_CURSOR, array() );
	$total  = (int) $status['total'];
	$have   = count( $status['present'] );

	echo '<h2>Player pages</h2>';

	printf(
		'<p>Profiles live at <code>/%s/&lt;player&gt;/</code>, one page each, carrying the <code>[%s]</code> shortcode and nothing else. ' .
		'The list is the API\'s indexed players — the ones with a game log and an advanced row behind them, not the whole league.</p>',
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
