<?php
/**
 * One-click creation of the 32 team hub pages.
 *
 * The hubs only become indexable when a WordPress page embeds them - the API
 * serves them `noindex, indexifembedded` at its own URL - so the 32 pages are
 * not a nicety, they are the thing that makes any of this rank. Building them
 * by hand is 32 pages × (title, slug, parent, shortcode, three Rank Math
 * fields), and the slug is load-bearing: it is what selects the team.
 *
 * That work used to live in scripts/create-team-pages.sh, which needs WP-CLI
 * and therefore SSH. Plenty of hosting has neither. This is the same job driven
 * from Tools → StatChasers Pages, with a notice on any admin screen while
 * pages are still missing.
 *
 * The promises are the shell script's, unchanged: a page that already exists is
 * yours and its content is never touched, Rank Math fields are filled only
 * where they are empty, and running it again does nothing.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Where the hubs live. Must match SC_TEAM_PATH_PREFIX on the API deployment. */
const STATCHASERS_TEAM_PATH = 'nfl/teams';

/** Season, used in the Rank Math title and description only. */
const STATCHASERS_TEAM_SEASON = '2026';

/** Menu slug for the admin screen. */
const STATCHASERS_TEAM_PAGES_SCREEN = 'statchasers-team-pages';

/**
 * The 32 teams: slug => [ name, abbr, division ].
 *
 * Mirrors src/lib/team/teams.ts on the API side. The slug is the shared key -
 * it is this page's URL segment AND the team the API renders - so the two lists
 * cannot drift without a page rendering the wrong team or nothing at all.
 *
 * @return array<string,array{0:string,1:string,2:string}>
 */
function statchasers_team_table(): array {
	return array(
		'buffalo-bills'         => array( 'Buffalo Bills', 'buf', 'AFC East' ),
		'miami-dolphins'        => array( 'Miami Dolphins', 'mia', 'AFC East' ),
		'new-england-patriots'  => array( 'New England Patriots', 'ne', 'AFC East' ),
		'new-york-jets'         => array( 'New York Jets', 'nyj', 'AFC East' ),
		'baltimore-ravens'      => array( 'Baltimore Ravens', 'bal', 'AFC North' ),
		'cincinnati-bengals'    => array( 'Cincinnati Bengals', 'cin', 'AFC North' ),
		'cleveland-browns'      => array( 'Cleveland Browns', 'cle', 'AFC North' ),
		'pittsburgh-steelers'   => array( 'Pittsburgh Steelers', 'pit', 'AFC North' ),
		'houston-texans'        => array( 'Houston Texans', 'hou', 'AFC South' ),
		'indianapolis-colts'    => array( 'Indianapolis Colts', 'ind', 'AFC South' ),
		'jacksonville-jaguars'  => array( 'Jacksonville Jaguars', 'jax', 'AFC South' ),
		'tennessee-titans'      => array( 'Tennessee Titans', 'ten', 'AFC South' ),
		'denver-broncos'        => array( 'Denver Broncos', 'den', 'AFC West' ),
		'kansas-city-chiefs'    => array( 'Kansas City Chiefs', 'kc', 'AFC West' ),
		'las-vegas-raiders'     => array( 'Las Vegas Raiders', 'lv', 'AFC West' ),
		'los-angeles-chargers'  => array( 'Los Angeles Chargers', 'lac', 'AFC West' ),
		'dallas-cowboys'        => array( 'Dallas Cowboys', 'dal', 'NFC East' ),
		'new-york-giants'       => array( 'New York Giants', 'nyg', 'NFC East' ),
		'philadelphia-eagles'   => array( 'Philadelphia Eagles', 'phi', 'NFC East' ),
		'washington-commanders' => array( 'Washington Commanders', 'was', 'NFC East' ),
		'chicago-bears'         => array( 'Chicago Bears', 'chi', 'NFC North' ),
		'detroit-lions'         => array( 'Detroit Lions', 'det', 'NFC North' ),
		'green-bay-packers'     => array( 'Green Bay Packers', 'gb', 'NFC North' ),
		'minnesota-vikings'     => array( 'Minnesota Vikings', 'min', 'NFC North' ),
		'atlanta-falcons'       => array( 'Atlanta Falcons', 'atl', 'NFC South' ),
		'carolina-panthers'     => array( 'Carolina Panthers', 'car', 'NFC South' ),
		'new-orleans-saints'    => array( 'New Orleans Saints', 'no', 'NFC South' ),
		'tampa-bay-buccaneers'  => array( 'Tampa Bay Buccaneers', 'tb', 'NFC South' ),
		'arizona-cardinals'     => array( 'Arizona Cardinals', 'ari', 'NFC West' ),
		'los-angeles-rams'      => array( 'Los Angeles Rams', 'lar', 'NFC West' ),
		'san-francisco-49ers'   => array( 'San Francisco 49ers', 'sf', 'NFC West' ),
		'seattle-seahawks'      => array( 'Seattle Seahawks', 'sea', 'NFC West' ),
	);
}

/**
 * The page at this slug under this parent, or 0.
 *
 * Matches on slug AND parent rather than on path, so a team page is found even
 * if some other page elsewhere on the site happens to share its slug.
 *
 * @param string $slug   Page slug.
 * @param int    $parent Parent page ID.
 * @return int
 */
function statchasers_team_find_page( string $slug, int $parent ): int {
	$found = get_posts(
		array(
			'post_type'        => 'page',
			'name'             => $slug,
			'post_parent'      => $parent,
			'post_status'      => 'any',
			'numberposts'      => 1,
			'fields'           => 'ids',
			'suppress_filters' => false,
		)
	);

	return empty( $found ) ? 0 : (int) $found[0];
}

/**
 * The container page the 32 hubs hang off, creating it if asked.
 *
 * @param bool $create Whether to create missing segments.
 * @return int Page ID, or 0 when it does not exist and $create is false.
 */
function statchasers_team_container( bool $create = false ): int {
	return statchasers_team_path_container( STATCHASERS_TEAM_PATH, $create );
}

/**
 * The page at an arbitrary path, creating the hierarchy if asked.
 *
 * Resolves one path segment at a time rather than with get_page_by_path(), so
 * a partially built hierarchy - /nfl/ exists but /nfl/teams/ does not - is
 * completed rather than rejected.
 *
 * Taking the path as an argument rather than reading STATCHASERS_TEAM_PATH is
 * what stops the one caller that is NOT under the hubs from landing there
 * anyway: the matchup holder lives at `nfl/matchup`, a sibling of `nfl/teams`,
 * and building it through the hubs' own container silently put it at
 * `nfl/teams/matchup` - a page every pair URL then failed to resolve to. See
 * statchasers_matchup_build_holder().
 *
 * @param string $path   Slash-separated page path, no leading or trailing slash.
 * @param bool   $create Whether to create missing segments.
 * @return int Page ID, or 0 when it does not exist and $create is false.
 */
function statchasers_team_path_container( string $path, bool $create = false ): int {
	$parent = 0;

	foreach ( explode( '/', trim( $path, '/' ) ) as $segment ) {
		if ( '' === $segment ) {
			continue;
		}
		$id = statchasers_team_find_page( $segment, $parent );

		if ( ! $id ) {
			if ( ! $create ) {
				return 0;
			}

			$title = ucwords( str_replace( '-', ' ', $segment ) );
			if ( 'nfl' === $segment ) {
				$title = 'NFL';
			}
			if ( 'teams' === $segment ) {
				$title = 'NFL Team Hubs';
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
		}

		$parent = (int) $id;
	}

	return $parent;
}

/**
 * Which of the 32 have a page, and which do not.
 *
 * Cached, because the admin notice below asks on every screen in wp-admin and
 * the answer costs 33 queries. Ten minutes is short enough that a page deleted
 * by hand shows up as missing while you are still looking for it, and the two
 * things that change the answer deliberately - building the pages, saving a
 * page - clear it outright.
 *
 * @param bool $fresh Skip the cache.
 * @return array{container:int,present:array<string,int>,missing:array<string,array>}
 */
function statchasers_team_page_status( bool $fresh = false ): array {
	if ( ! $fresh ) {
		$cached = get_transient( 'statchasers_team_page_status' );
		if ( is_array( $cached ) && isset( $cached['container'], $cached['present'], $cached['missing'] ) ) {
			return $cached;
		}
	}

	$container = statchasers_team_container( false );
	$present   = array();
	$missing   = array();

	foreach ( statchasers_team_table() as $slug => $row ) {
		$id = $container ? statchasers_team_find_page( $slug, $container ) : 0;
		if ( $id ) {
			$present[ $slug ] = $id;
		} else {
			$missing[ $slug ] = $row;
		}
	}

	$status = array(
		'container' => $container,
		'present'   => $present,
		'missing'   => $missing,
	);

	set_transient( 'statchasers_team_page_status', $status, 10 * MINUTE_IN_SECONDS );

	return $status;
}

/** Forget the cached page status. */
function statchasers_team_forget_status(): void {
	delete_transient( 'statchasers_team_page_status' );
}

// Any page created, edited, trashed or deleted can change the answer, and the
// notice saying "9 pages are missing" right after you made the ninth is exactly
// the kind of wrong that makes someone stop trusting the tool.
add_action( 'save_post_page', 'statchasers_team_forget_status' );
add_action( 'deleted_post', 'statchasers_team_forget_status' );
add_action( 'trashed_post', 'statchasers_team_forget_status' );
add_action( 'untrashed_post', 'statchasers_team_forget_status' );

/**
 * Write a meta value, but only into an empty field.
 *
 * @param int    $id    Post ID.
 * @param string $key   Meta key.
 * @param mixed  $value Meta value.
 */
/**
 * The longest title that fits a results page.
 *
 * Google shows about 60 characters of a title and rewrites or cuts the rest,
 * and the 2026-10-08 crawl found 2,373 of the site's generated titles past it.
 * A player's or a team's name is the part people search, so it stays whole and
 * the tail after it gives way: every generated title is a ladder of candidates,
 * most descriptive first, the first that fits is used, and the last rung is
 * written short enough for every name there is (and is returned even when it
 * is not). No " | StatChasers" on any of them (mak, 2026-10-08): the brand
 * spent fourteen of the sixty on every page.
 *
 * MIRRORS fitTitle() in the API's src/lib/title-fit.ts. Change one and change
 * the other.
 *
 * @param string[] $candidates Titles, most descriptive first.
 * @param int      $max        The budget, in bytes - the strings are ASCII.
 */
function statchasers_fit_title( array $candidates, int $max = 60 ): string {
	foreach ( $candidates as $candidate ) {
		if ( strlen( $candidate ) <= $max ) {
			return $candidate;
		}
	}
	return (string) end( $candidates );
}

function statchasers_team_fill_meta( int $id, string $key, $value ): void {
	$current = get_post_meta( $id, $key, true );
	if ( empty( $current ) ) {
		update_post_meta( $id, $key, $value );
	}
}

/**
 * Create every missing team page.
 *
 * @param bool $with_images Also sideload the team crests as featured images.
 * @return array{created:int,existing:int,errors:string[]}
 */
function statchasers_team_build_pages( bool $with_images = false ): array {
	$created  = 0;
	$existing = 0;
	$errors   = array();

	$container = statchasers_team_container( true );

	if ( ! $container ) {
		return array(
			'created'  => 0,
			'existing' => 0,
			'errors'   => array( sprintf( 'Could not create the /%s/ container page.', STATCHASERS_TEAM_PATH ) ),
		);
	}

	foreach ( statchasers_team_table() as $slug => $row ) {
		list( $name, $abbr ) = $row;

		$id = statchasers_team_find_page( $slug, $container );

		if ( $id ) {
			++$existing;
		} else {
			$id = wp_insert_post(
				array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					// The stored title, which is what the admin list and
					// any nav menu show. It is NOT the H1: the_title is
					// filtered above to statchasers_team_heading(), so the
					// heading follows the section the URL is on rather than
					// this one fixed string. The fragment steps its hero down
					// to <h2> when embedded either way.
					'post_title'   => $name . ' Team Page',
					'post_name'    => $slug,
					'post_parent'  => $container,
					'post_content' => '[' . STATCHASERS_TEAM_SHORTCODE . ']',
				),
				true
			);

			if ( is_wp_error( $id ) ) {
				$errors[] = sprintf( '%s: %s', $name, $id->get_error_message() );
				continue;
			}

			$id = (int) $id;
			++$created;
		}

		// Rank Math. The plugin emits no title/description/robots of its own by
		// design, so these three are the page's only ones - and the robots value
		// is the difference between a hub that ranks and 32 that quietly don't.
		//
		// The strings come from statchasers_team_section_meta() with no section,
		// which is the same function the virtual section URLs generate theirs
		// from. One place the hub's title is written, so it cannot say one thing
		// on a page created today and another on the five addresses beneath it.
		//
		// STORED, unlike the section URLs': this is a real page an editor may
		// rewrite, and fill_meta only ever fills an empty field. A team page
		// created before this wording existed therefore keeps its old title -
		// see the note in README.md on updating the 32 that already exist.
		$root = statchasers_team_section_meta( $slug, '' );

		statchasers_team_fill_meta( $id, 'rank_math_title', $root['title'] );
		statchasers_team_fill_meta( $id, 'rank_math_description', $root['description'] );
		statchasers_team_fill_meta( $id, 'rank_math_robots', array( 'index', 'follow' ) );

		if ( $with_images ) {
			$error = statchasers_team_set_crest( $id, $name, $abbr );
			if ( '' !== $error ) {
				$errors[] = $error;
			}
		}
	}

	statchasers_team_write_index( $container );

	statchasers_team_forget_status();

	flush_rewrite_rules();
	if ( function_exists( 'statchasers_news_flush' ) ) {
		statchasers_news_flush();
	}

	return array(
		'created'  => $created,
		'existing' => $existing,
		'errors'   => $errors,
	);
}

/**
 * Sideload a team crest as the page's featured image.
 *
 * Skipped when one is already set - which is what makes a run that timed out
 * safe to repeat, rather than putting another 32 copies in the media library.
 *
 * @param int    $id   Post ID.
 * @param string $name Team name.
 * @param string $abbr Team abbreviation.
 * @return string Error message, or '' on success/skip.
 */
function statchasers_team_set_crest( int $id, string $name, string $abbr ): string {
	if ( get_post_meta( $id, '_thumbnail_id', true ) ) {
		return '';
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';

	// The API's own rendering of the crest (a PNG of the SVG it draws
	// everywhere else; /team-logos/<abbr>.png redirects to the current file).
	// The media library does not accept SVG, hence the PNG. Sleeper's 150px
	// PNG only when no origin is configured.
	$origin = rtrim( statchasers_news_origin(), '/' );
	$source = '' !== $origin
		? $origin . '/team-logos/' . rawurlencode( $abbr ) . '.png'
		: 'https://sleepercdn.com/images/team_logos/nfl/' . rawurlencode( $abbr ) . '.png';
	$file = download_url( $source, 20 );

	if ( is_wp_error( $file ) ) {
		return sprintf( '%s: crest download failed (%s)', $name, $file->get_error_message() );
	}

	$attachment = media_handle_sideload(
		array(
			'name'     => $abbr . '.png',
			'tmp_name' => $file,
		),
		$id,
		$name . ' logo'
	);

	if ( is_wp_error( $attachment ) ) {
		// Deleted for us on success, but not on every failure path.
		if ( file_exists( $file ) ) {
			wp_delete_file( $file );
		}
		return sprintf( '%s: crest import failed (%s)', $name, $attachment->get_error_message() );
	}

	update_post_meta( (int) $attachment, '_wp_attachment_image_alt', $name . ' logo' );
	set_post_thumbnail( $id, (int) $attachment );

	return '';
}

/** The intro paragraph above the index. Also the stub's signature; see below. */
const STATCHASERS_TEAM_INDEX_LEAD = 'Every NFL team hub: player news, injury designations, the offensive depth chart, the schedule and a weekly fantasy outlook.';

/**
 * Is this body the bare list this function used to write?
 *
 * It used to build the index itself: a paragraph, eight <h2>s and 32 bullets,
 * styled by whatever the theme does with a <ul>. That was only ever there so
 * the parent was not a thin page in the sitemap, and it shipped looking nothing
 * like the 32 hubs it points at. The shortcode replaces it.
 *
 * Recognised by its own lead sentence plus a wall of links to the team path and
 * no shortcode of any kind. Nobody's hand-written page looks like that, which
 * is what makes replacing it safe: anything we do not positively recognise is
 * left alone, because an index somebody has edited is theirs.
 *
 * @param string $content Page body.
 */
/**
 * How many links in this body point at a path, however they are written.
 *
 * `substr_count( $content, 'href="/nfl/teams/' )` is what this replaces, and it
 * was wrong in a way that only showed up on a real site: it required the link
 * to be root-relative and double-quoted, which is how the build script writes
 * them and is NOT how a page survives a visit to a block editor. WonderBlocks,
 * Gutenberg and Divi all happily rewrite `/nfl/teams/buffalo-bills/` to the
 * absolute `https://example.com/nfl/teams/buffalo-bills/` on save, and the
 * count silently became zero - so the container that most needed rebuilding
 * reported as somebody's own page and was left alone, which is exactly the
 * state the rebuild button was added to get out of.
 *
 * Matches either form, and single quotes, and whitespace around the `=`.
 *
 * @param string $content Page body.
 * @param string $path    Path without leading or trailing slashes.
 */
function statchasers_index_link_count( string $content, string $path ): int {
	return (int) preg_match_all(
		'#href\s*=\s*["\'][^"\']*/' . preg_quote( $path, '#' ) . '/#i',
		$content
	);
}

/**
 * The shortcode tags in a body, in the order they appear, deduplicated.
 *
 * Named rather than counted, because "carries a shortcode" was a true statement
 * that explained nothing: it is the difference between a page somebody mounted
 * something on and a page a builder has wrapped, and the screen could not say
 * which.
 *
 * @param string $content Page body.
 * @return string[]
 */
function statchasers_index_shortcode_tags( string $content ): array {
	preg_match_all( '/\[([a-z_][a-z0-9_-]*)/i', $content, $m );

	return array_values( array_unique( array_map( 'strtolower', (array) ( $m[1] ?? array() ) ) ) );
}

/**
 * Tags that are a page builder's scaffolding rather than somebody's mount.
 *
 * A builder wraps whatever is already on the page the first time it is opened,
 * so the generated stub comes back as the same words inside `[et_pb_section]`
 * `[et_pb_row]` `[et_pb_column]` `[et_pb_text]`. Treating that as "somebody
 * arranged this page" is what left /nfl/teams/ untouched: the wrapper was read
 * as intent when it is packaging.
 *
 * It is also why the grid was landing in the footer. `the_content` appends
 * after the closing `[/et_pb_section]`, so the tool's markup came out beyond
 * the last Divi section, below everything the builder had laid out.
 */
function statchasers_index_is_builder_tag( string $tag ): bool {
	foreach ( array( 'et_pb_', 'et_builder', 'vc_', 'fusion_', 'wpb_', 'wonderblocks', 'wb_' ) as $prefix ) {
		if ( 0 === strpos( $tag, $prefix ) ) {
			return true;
		}
	}

	return false;
}

/**
 * Does this body carry a shortcode somebody put there?
 *
 * The old test was `strpos( $content, '[' )`, which is any bracket at all -
 * including one in prose. This asks the question that was meant, and excludes
 * a builder's own scaffolding from the answer: those tags say how the page is
 * stored, not what an editor chose to put on it.
 *
 * @param string $content Page body.
 */
function statchasers_index_has_shortcode( string $content ): bool {
	foreach ( statchasers_index_shortcode_tags( $content ) as $tag ) {
		if ( ! statchasers_index_is_builder_tag( $tag ) ) {
			return true;
		}
	}

	return false;
}

/** Is this body stored inside a page builder's wrapper? */
function statchasers_index_is_builder_content( string $content ): bool {
	foreach ( statchasers_index_shortcode_tags( $content ) as $tag ) {
		if ( statchasers_index_is_builder_tag( $tag ) ) {
			return true;
		}
	}

	return false;
}

function statchasers_team_index_is_stub( string $content ): bool {
	if ( false === strpos( $content, STATCHASERS_TEAM_INDEX_LEAD ) ) {
		return false;
	}

	if ( statchasers_index_has_shortcode( $content ) ) {
		return false;
	}

	return statchasers_index_link_count( $content, STATCHASERS_TEAM_PATH ) >= 30;
}

/**
 * Give the container page a body: the intro, and the index mount.
 *
 * A parent page with no content is a thin page that still sits in the sitemap.
 * The mount is [statchasers_team_index], which prints the same grid the hubs'
 * own team switcher uses - so the page that lists 32 hubs is drawn by the tool
 * that draws the hubs, rather than by the theme's <ul> styling.
 *
 * Written when the page is empty, and over the stub the old version of this
 * function wrote. Anything else there is yours and is left alone.
 *
 * @param int $container Container page ID.
 */
function statchasers_team_write_index( int $container ): void {
	$content = (string) get_post_field( 'post_content', $container );

	// Already mounted. Re-running the build must not churn the page.
	if ( has_shortcode( $content, STATCHASERS_TEAM_INDEX_SHORTCODE ) ) {
		return;
	}

	if ( '' !== trim( $content ) && ! statchasers_team_index_is_stub( $content ) ) {
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
			'post_content' => '<p>' . esc_html( STATCHASERS_TEAM_INDEX_LEAD ) . '</p>' .
				"\n\n[" . STATCHASERS_TEAM_INDEX_SHORTCODE . ']',
		)
	);
}


/* ------------------------------------------------------ the index pages */

/**
 * What state a container page's body is in.
 *
 * The container is the parent WordPress needs so that the children resolve, and
 * its body should be the lead sentence plus the index mount. Three of the five
 * answers below are states the rebuild button acts on; the other two are
 * reasons it does nothing, and both are worth printing rather than hiding,
 * because "nothing happened" and "there was nothing to do" look identical from
 * the outside.
 *
 * @param int      $container Container page ID, 0 when it does not exist.
 * @param string   $shortcode The index shortcode the page should carry.
 * @param callable $is_stub   Predicate recognising the generated stub.
 * @return string  missing|mounted|empty|stub|custom
 */
function statchasers_index_state( int $container, string $shortcode, callable $is_stub ): string {
	if ( $container <= 0 ) {
		return 'missing';
	}

	$content = (string) get_post_field( 'post_content', $container );

	if ( has_shortcode( $content, $shortcode ) ) {
		return 'mounted';
	}

	if ( '' === trim( $content ) ) {
		return 'empty';
	}

	return $is_stub( $content ) ? 'stub' : 'custom';
}

/** The two container pages, each with the state of its body. */
function statchasers_index_containers(): array {
	$out = array();

	$team = statchasers_team_page_status();
	$out['teams'] = array(
		'label' => 'Teams',
		'path'  => STATCHASERS_TEAM_PATH,
		'lead'  => STATCHASERS_TEAM_INDEX_LEAD,
		'id'    => (int) ( $team['container'] ?? 0 ),
		'state' => statchasers_index_state(
			(int) ( $team['container'] ?? 0 ),
			STATCHASERS_TEAM_INDEX_SHORTCODE,
			'statchasers_team_index_is_stub'
		),
	);

	if ( function_exists( 'statchasers_player_page_status' ) ) {
		$player = statchasers_player_page_status();
		$out['players'] = array(
			'label' => 'Players',
			'path'  => STATCHASERS_PLAYER_PATH,
			'lead'  => STATCHASERS_PLAYER_INDEX_LEAD,
			'id'    => (int) ( $player['container'] ?? 0 ),
			'state' => statchasers_index_state(
				(int) ( $player['container'] ?? 0 ),
				STATCHASERS_PLAYER_INDEX_SHORTCODE,
				'statchasers_player_index_is_stub'
			),
		);
	}

	return $out;
}

/**
 * Why a container was not recognised.
 *
 * "Your own content" is the right answer for a page somebody wrote, and a
 * useless one for a page that IS the stub but fails a test - which is how the
 * published /nfl/teams/ sat untouched through two releases. Recognition is
 * three questions; this prints the answers so the screen can never again say
 * "left alone" without saying what it looked at.
 *
 * @param string $content Page body.
 * @param string $path    Path its links should point at.
 * @param string $lead    The lead sentence the generated body opens with.
 */
function statchasers_index_explain( string $content, string $path, string $lead ): string {
	$has_lead  = false !== strpos( $content, $lead );
	$has_short = statchasers_index_has_shortcode( $content );
	$links     = statchasers_index_link_count( $content, $path );

	$parts = array(
		$has_lead ? 'our lead sentence: yes' : 'our lead sentence: no',
		sprintf( 'links to /%s/: %d', $path, $links ),
	);

	$tags = statchasers_index_shortcode_tags( $content );

	if ( array() !== $tags ) {
		$parts[] = 'shortcodes: ' . implode( ', ', array_slice( $tags, 0, 6 ) );
	}

	if ( $has_short ) {
		$parts[] = 'at least one is not a page builder wrapper, so this is left alone';
	}

	return implode( ' &middot; ', $parts );
}

/**
 * The index pages, and a button that mounts the grid on them.
 *
 * This exists because the write was only ever reachable from the build: both
 * `statchasers_team_write_index()` and `statchasers_player_write_index()` run
 * at the end of a page build, and the build button is only rendered while pages
 * are missing. On a site where all 32 hubs already exist the screen said "All
 * 32 pages exist. Nothing to do." and there was no way left to press it - so a
 * container still carrying the old 32-link stub stayed that way, the theme
 * printed the wall of links in its own list styling, and the plugin appended
 * the real grid underneath it. Two indexes on one page, and no button.
 *
 * Only `empty` and `stub` are written. A page somebody has edited is theirs.
 */
function statchasers_index_panel(): void {
	$containers = statchasers_index_containers();
	$actionable = 0;

	echo '<h2>Index pages</h2>';

	echo '<p>The parent page each set of pages hangs off. Its body should be the ' .
		'lead sentence and the index mount, so the page that lists them is drawn by ' .
		'the tool rather than by the theme&#8217;s list styling.</p>';

	echo '<table class="widefat striped" style="max-width:52em"><tbody>';

	foreach ( $containers as $row ) {
		$say = array(
			'missing' => array( 'not created yet', 'The build button above makes it.' ),
			'mounted' => array( 'mounts the grid', 'Nothing to do.' ),
			'empty'   => array( 'empty', 'The button below will write the mount.' ),
			'stub'    => array( 'carrying the old list of links', 'The button below will replace it with the mount.' ),
			'custom'  => array( 'your own content', 'Left alone. Add the shortcode yourself to mount the grid.' ),
		);

		$state = (string) $row['state'];
		if ( 'empty' === $state || 'stub' === $state ) {
			++$actionable;
		}

		$note = $say[ $state ][1];

		// Say so before the button does it, not after: replacing the body of a
		// page a builder claims also takes the builder's claim off it.
		if ( 'stub' === $state && (int) $row['id'] > 0
			&& statchasers_index_is_builder_content( (string) get_post_field( 'post_content', (int) $row['id'] ) )
		) {
			$note .= ' <strong>The page builder layout around it is removed with it</strong> - ' .
				'it is the generated list in a wrapper, and the wrapper is why the grid ' .
				'was printing below everything else on the page.';
		}

		// A refusal shows its working. See statchasers_index_explain().
		if ( 'custom' === $state && (int) $row['id'] > 0 ) {
			$note .= '<br /><code>' . statchasers_index_explain(
				(string) get_post_field( 'post_content', (int) $row['id'] ),
				(string) $row['path'],
				(string) $row['lead']
			) . '</code>';
		}

		printf(
			'<tr><td style="width:7em"><strong>%s</strong></td>' .
			'<td><code>/%s/</code></td>' .
			'<td>%s</td><td class="description">%s</td></tr>',
			esc_html( (string) $row['label'] ),
			esc_html( (string) $row['path'] ),
			esc_html( $say[ $state ][0] ),
			wp_kses_post( $note )
		);
	}

	echo '</tbody></table>';

	if ( 0 === $actionable ) {
		echo '<p><strong>Nothing to rebuild.</strong></p>';
		return;
	}

	echo '<form method="post">';
	wp_nonce_field( 'statchasers_team_reindex' );
	printf(
		'<p><button type="submit" name="statchasers_team_reindex" value="1" class="button button-primary">Rebuild %d index page%s</button></p>',
		(int) $actionable,
		1 === $actionable ? '' : 's'
	);
	echo '<p class="description">Writes the lead sentence and the index shortcode. ' .
		'A container you have edited yourself is never touched.</p>';
	echo '</form>';
}

/**
 * Handle the rebuild button.
 *
 * The same shape as the build handler above and for the same reason: redirect
 * before any output, so a refresh cannot run it twice. Both writes are
 * idempotent and both decline on a page they do not recognise, so the worst a
 * double press does is nothing.
 */
add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_team_reindex'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_team_reindex' );

		$before = statchasers_index_containers();

		foreach ( $before as $key => $row ) {
			if ( (int) $row['id'] <= 0 ) {
				continue;
			}

			if ( 'teams' === $key ) {
				statchasers_team_write_index( (int) $row['id'] );
			} elseif ( function_exists( 'statchasers_player_write_index' ) ) {
				statchasers_player_write_index( (int) $row['id'] );
			}
		}

		statchasers_team_forget_status();

		if ( function_exists( 'statchasers_news_flush' ) ) {
			statchasers_news_flush();
		}

		wp_safe_redirect(
			add_query_arg(
				'page',
				STATCHASERS_TEAM_PAGES_SCREEN,
				admin_url( 'tools.php' )
			)
		);
		exit;
	}
);

/* --------------------------------------------------------------------- admin */

add_action(
	'admin_menu',
	static function (): void {
		add_management_page(
			'StatChasers Pages',
			'StatChasers Pages',
			'manage_options',
			STATCHASERS_TEAM_PAGES_SCREEN,
			'statchasers_team_pages_screen'
		);
	}
);

/**
 * Handle the build button.
 *
 * On admin_init rather than inside the screen callback so the redirect happens
 * before any output - a POST that re-renders in place is one refresh away from
 * running twice, and while this is idempotent, "did that work?" should not need
 * to be answered by reading the page count.
 */
add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_team_build'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_team_build' );

		$with_images = isset( $_POST['with_images'] );
		$result      = statchasers_team_build_pages( $with_images );

		// The probe needs a published hub to look at, and this is the moment
		// one first exists. Running it here is what makes the headings correct
		// without anybody being told to go and check them.
		if ( function_exists( 'statchasers_h1_probe' ) ) {
			statchasers_h1_probe();
		}

		set_transient( 'statchasers_team_build_result', $result, MINUTE_IN_SECONDS );

		wp_safe_redirect(
			add_query_arg(
				'page',
				STATCHASERS_TEAM_PAGES_SCREEN,
				admin_url( 'tools.php' )
			)
		);
		exit;
	}
);

/**
 * A nudge on any admin screen while the pages are missing.
 *
 * Suppressed on the tool's own screen, where it would be telling you something
 * the page already says.
 */
add_action(
	'admin_notices',
	static function (): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( $screen && false !== strpos( (string) $screen->id, STATCHASERS_TEAM_PAGES_SCREEN ) ) {
			return;
		}

		$status  = statchasers_team_page_status();
		$missing = count( $status['missing'] );

		if ( 0 === $missing ) {
			return;
		}

		printf(
			'<div class="notice notice-warning"><p><strong>StatChasers:</strong> %d of 32 team hub pages are missing, so those URLs 404 and nothing on them can rank. <a href="%s">Create them</a>.</p></div>',
			(int) $missing,
			esc_url( add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) ) )
		);
	}
);

/**
 * Clear the cached renders.
 *
 * Every fragment is held in a transient for five minutes and the asset version
 * for fifteen, so a deployment of the API is invisible on the site for up to a
 * quarter of an hour after it lands. `statchasers_news_flush()` has always
 * emptied both, but the only ways to call it were WP-CLI - which shared
 * hosting often does not have - and deactivating the plugin, which is a
 * strange thing to have to do to see a deploy.
 */
add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_flush'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_flush' );

		if ( function_exists( 'statchasers_news_flush' ) ) {
			statchasers_news_flush();
		}

		set_transient( 'statchasers_flushed', 1, MINUTE_IN_SECONDS );

		wp_safe_redirect(
			add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) )
		);
		exit;
	}
);

/** The panel on the Tools screen. */
function statchasers_flush_panel(): void {
	if ( get_transient( 'statchasers_flushed' ) ) {
		delete_transient( 'statchasers_flushed' );
		echo '<div class="notice notice-success is-dismissible"><p><strong>Cleared.</strong> ' .
			'The next page view fetches fresh markup and a fresh asset version.</p></div>';
	}

	echo '<h2>After a deploy</h2>';
	echo '<p>Rendered fragments are cached for five minutes and the CSS/JS version for fifteen, ' .
		'so a new build of the API takes up to a quarter of an hour to show. This empties both now. ' .
		'The last good copy of each render is kept, so the pages still fill if the API is down. ' .
		'It does not touch your page cache - clear that too.</p>';

	echo '<form method="post">';
	wp_nonce_field( 'statchasers_flush' );
	echo '<p><button type="submit" name="statchasers_flush" value="1" class="button">Clear cached renders</button></p>';
	echo '</form>';
}

/** The Tools screen. */
function statchasers_team_pages_screen(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$result = get_transient( 'statchasers_team_build_result' );
	if ( is_array( $result ) ) {
		delete_transient( 'statchasers_team_build_result' );

		printf(
			'<div class="notice notice-success is-dismissible"><p><strong>Done.</strong> %d created, %d already existed.</p></div>',
			(int) $result['created'],
			(int) $result['existing']
		);

		foreach ( (array) $result['errors'] as $error ) {
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html( (string) $error )
			);
		}
	}

	$status  = statchasers_team_page_status();
	$missing = count( $status['missing'] );
	$origin  = statchasers_news_origin();

	echo '<div class="wrap">';
	echo '<h1>StatChasers Pages</h1>';
	echo '<h2>Team pages</h2>';

	if ( '' === $origin ) {
		echo '<div class="notice notice-error"><p><strong>No API origin set.</strong> Add ' .
			'<code>STATCHASERS_NEWS_ORIGIN</code> to <code>wp-config.php</code> first, or the ' .
			'pages will render empty.</p></div>';
	}

	printf(
		'<p>The hubs live at <code>/%s/&lt;team&gt;/</code>. Each page carries the ' .
		'<code>[%s]</code> shortcode and nothing else - the team is selected by the page slug.</p>',
		esc_html( STATCHASERS_TEAM_PATH ),
		esc_html( STATCHASERS_TEAM_SHORTCODE )
	);

	printf(
		'<p><strong>%d of 32</strong> pages exist. Container page: %s</p>',
		count( $status['present'] ),
		$status['container']
			? '<code>/' . esc_html( STATCHASERS_TEAM_PATH ) . '/</code> (post ' . (int) $status['container'] . ')'
			: '<em>not created yet - the button below will make it</em>'
	);

	if ( $missing > 0 ) {
		echo '<form method="post">';
		wp_nonce_field( 'statchasers_team_build' );
		echo '<p><label><input type="checkbox" name="with_images" value="1" /> ' .
			'Also import the 32 team crests as featured images ' .
			'<span class="description">(32 downloads - slower, and safe to re-run if it times out)</span>' .
			'</label></p>';
		printf(
			'<p><button type="submit" name="statchasers_team_build" value="1" class="button button-primary button-hero">Create %d missing page%s</button></p>',
			(int) $missing,
			1 === $missing ? '' : 's'
		);
		echo '<p class="description">Existing pages are never modified. Rank Math fields are ' .
			'filled only where they are empty.</p>';
		echo '</form>';
	} else {
		echo '<p><strong>All 32 pages exist.</strong> Nothing to do.</p>';
	}

	statchasers_team_retitle_panel();
	statchasers_index_panel();
	statchasers_player_panel();
	statchasers_player_retitle_panel();
	statchasers_matchup_panel();
	statchasers_h1_panel();
	statchasers_flush_panel();

	echo '<h2>Teams</h2>';
	echo '<table class="widefat striped"><thead><tr>' .
		'<th>Team</th><th>Slug</th><th>Status</th></tr></thead><tbody>';

	foreach ( statchasers_team_table() as $slug => $row ) {
		$id = $status['present'][ $slug ] ?? 0;

		printf(
			'<tr><td>%s</td><td><code>%s</code></td><td>%s</td></tr>',
			esc_html( $row[0] ),
			esc_html( $slug ),
			$id
				? sprintf(
					'<a href="%s">edit</a> &middot; <a href="%s" target="_blank" rel="noopener">view</a>',
					esc_url( get_edit_post_link( $id ) ?? '' ),
					esc_url( (string) get_permalink( $id ) )
				)
				: '<span style="color:#b32d2e">missing</span>'
		);
	}

	echo '</tbody></table></div>';
}

/* ------------------------------------------------------- section URLs */

/**
 * Sections a team URL can be scoped to.
 *
 * Mirrors SECTIONS in the API's src/routes/team.ts and the tab ids in
 * src/lib/team-render.ts - keep the three lists together. A rewrite rule
 * pointing at a section the API will not scope to serves the hub under a URL
 * that promised one panel, which is duplicate content wearing a second address.
 *
 * `news` was held back here while a team's archive was two stories deep. It is
 * open now and addressed like the other five, which is why this list and the
 * API's are once again the same six strings.
 */
const STATCHASERS_TEAM_SECTIONS = array(
	'outlook',
	'usage',
	'stats',
	'schedule',
	'depth-chart',
	'matchups',
	'news',
);

/**
 * Whether the nested section URLs are live. On by default.
 *
 * It was off while the rewrite was new and the sitemap entries had not been
 * confirmed against a live Rank Math build. Six addresses per team that the
 * plugin renders correctly and never advertises is not a safe default, it is a
 * quiet one, so it is on now and the plugin flushes permalinks itself on
 * activation and after a build. To go back:
 *
 *     add_filter( 'statchasers_team_section_urls', '__return_false' );
 *
 * WHAT IT DOES NOT DO: create pages. The rule points the section URL at the
 * team's EXISTING page and sets a query var the shortcode reads, so one page
 * per team serves every section address. 32 teams do not need 192 pages, and a
 * section is opened or closed by editing one list rather than by minting or
 * deleting rows in wp_posts.
 *
 * Same shape and the same switch as statchasers_player_section_urls(), because
 * the two page types are addressed the same way.
 */
function statchasers_team_section_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_team_section_urls', true );
}

/** A section id, or '' if it is not one we serve. */
function statchasers_team_section_id( string $raw ): string {
	$section = strtolower( trim( $raw ) );
	return in_array( $section, STATCHASERS_TEAM_SECTIONS, true ) ? $section : '';
}

/**
 * The section a request is scoped to, from the URL.
 *
 * Read by the shortcode when no explicit `section` attribute is given, and by
 * the metadata filters below so the title, description and canonical describe
 * the section rather than the hub.
 *
 * `sc_section` is the same query var the player pages use; it is registered
 * there and reused here rather than adding a second name for one idea.
 */
function statchasers_team_section_from_url(): string {
	return statchasers_team_section_id( (string) get_query_var( 'sc_section' ) );
}

add_action(
	'init',
	function (): void {
		if ( ! statchasers_team_section_urls_enabled() ) {
			return;
		}

		$base     = trim( STATCHASERS_TEAM_PATH, '/' );
		$sections = implode( '|', array_map( 'preg_quote', STATCHASERS_TEAM_SECTIONS ) );

		// The page itself is resolved by pagename, exactly as WordPress would
		// have resolved the bare team URL; only sc_section is added. No new
		// post, no template override, nothing for an editor to keep in sync.
		add_rewrite_rule(
			'^' . $base . '/([^/]+)/(' . $sections . ')/?$',
			'index.php?pagename=' . $base . '/$matches[1]&sc_section=$matches[2]',
			'top'
		);

		// A changed section list is dead until the rule table is rebuilt, and
		// an upgrade does not run the activation hook that asks for that (the
		// Usage section, 1.10.20). Same remedy as the matchup and rankings
		// rules: remember the rule's signature and ask for the flush that
		// statchasers-news.php performs at the end of this `init`.
		$signature = md5( $base . '|' . $sections );
		if ( get_option( 'statchasers_team_rules' ) !== $signature ) {
			update_option( 'statchasers_team_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/**
 * Send `/<team>/outlook/` to the hub, 301.
 *
 * The hub opens on the Outlook, so the two addresses were one page, each
 * self-canonical. The hub keeps it, the Outlook tab links there (the API
 * renders the strip), and the old address - indexed - redirects instead of
 * 404ing, which is why 'outlook' stays in STATCHASERS_TEAM_SECTIONS and so in
 * the rewrite. The twin of statchasers_player_overview_redirect().
 */
function statchasers_team_outlook_redirect(): void {
	if ( 'outlook' !== statchasers_team_section_from_url() ) {
		return;
	}

	if ( '' === statchasers_team_current_slug() ) {
		return;
	}

	$target = get_permalink( get_queried_object() );
	if ( ! $target ) {
		return;
	}

	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$query = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_QUERY );
	// Not the section itself: `?sc_section=outlook` would otherwise ride along to
	// the target, match again there, and redirect to itself forever.
	$query = trim( (string) preg_replace( '/(^|&)sc_section=[^&]*/', '', $query ), '&' );

	wp_safe_redirect( '' === $query ? $target : $target . '?' . $query, 301 );
	exit;
}

add_action( 'template_redirect', 'statchasers_team_outlook_redirect', 9 );

/* -------------------------------------------------- section metadata */

/**
 * The team this request is on, or '' when it is not a team page.
 *
 * The page slug is the team, exactly as it is for the shortcode - one key, so
 * the URL, the render and the metadata cannot disagree about which team they
 * are describing.
 */
function statchasers_team_current_slug(): string {
	$queried = get_queried_object();
	if ( ! $queried instanceof WP_Post ) {
		return '';
	}

	$slug = (string) $queried->post_name;
	return isset( statchasers_team_table()[ $slug ] ) ? $slug : '';
}

/**
 * Title and description for one team URL, built from team + section + season.
 *
 * MIRRORS sectionMeta() in the API's src/lib/team-seo.ts. The API origin is
 * noindex and Rank Math owns the indexed title, so these are the strings that
 * actually rank - but a reader can reach either, and the two must say the same
 * thing. Changing one means changing the other.
 *
 * Generated rather than stored: 32 teams x 6 URLs is 192 title/description
 * pairs, and storing them would mean 192 rows to migrate every time a season
 * rolls over or a phrase is reworded. The season is a constant at the top of
 * this file, so a rollover is one edit.
 *
 * @param string $slug    Team slug.
 * @param string $section Section id, or '' for the hub.
 * @return array{title:string,description:string}|null Null for an unknown team.
 */
function statchasers_team_section_meta( string $slug, string $section ): ?array {
	$row = statchasers_team_table()[ $slug ] ?? null;
	if ( null === $row ) {
		return null;
	}

	$name   = $row[0];
	$season = STATCHASERS_TEAM_SEASON;
	// "Patriots" from "New England Patriots" - the form a sentence wants.
	$nick = substr( strrchr( ' ' . $name, ' ' ), 1 );

	switch ( $section ) {
		case 'outlook':
			return array(
				'title'       => sprintf( '%s Fantasy Football Outlook %s', $name, $season ),
				'description' => sprintf(
					'%1$s fantasy outlook for %2$s: projected win total, offensive pace and pass rate, the %3$s players who carry fantasy value and the roles behind them.',
					$name,
					$season,
					$nick
				),
			);

		case 'usage':
			return array(
				// Every title is a statchasers_fit_title() ladder: the fullest
				// wording that fits sixty characters, then a shorter rung for
				// the long names (mak approved the wording, 2026-10-08).
				'title'       => statchasers_fit_title(
					array(
						sprintf( '%s Target Share & Snap Counts %s: Usage Report', $name, $season ),
						sprintf( '%s Target Share & Snap Counts %s', $name, $season ),
					)
				),
				'description' => sprintf(
					'%1$s target share, snap share and red-zone touches for %2$s, updated every Tuesday: the %3$s target tree, backfield split, pass map and buy-low / sell-high signals.',
					$name,
					$season,
					$nick
				),
			);

		case 'stats':
			return array(
				'title'       => statchasers_fit_title(
					array(
						sprintf( '%s Stats %s: Offense, Defense & NFL Rankings', $name, $season ),
						sprintf( '%s Stats %s: Offense & Defense Rankings', $name, $season ),
					)
				),
				'description' => sprintf(
					'%1$s team stats for %2$s: points, yards, pace and play mix on offense and defense, each with the %3$s rank among all 32 teams.',
					$name,
					$season,
					$nick
				),
			);

		case 'schedule':
			return array(
				'title'       => statchasers_fit_title(
					array(
						sprintf( '%s Schedule %s: Dates, Opponents & Results', $name, $season ),
						sprintf( '%s Schedule %s: Opponents & Results', $name, $season ),
					)
				),
				'description' => sprintf(
					'The full %1$s %2$s schedule: every opponent, kickoff time and result, plus the %3$s bye week and what is next on the calendar.',
					$season,
					$name,
					$nick
				),
			);

		case 'matchups':
			return array(
				'title'       => statchasers_fit_title(
					array(
						sprintf( '%s Matchups %s: Opponents & Head-to-Head', $name, $season ),
						sprintf( '%s Matchups %s: Opponents & Results', $name, $season ),
					)
				),
				'description' => sprintf(
					'Every %1$s opponent in %2$s, week by week, with results and a matchup page for each pair: team stats side by side, injuries and the head-to-head record.',
					$name,
					$season
				),
			);

		case 'news':
			return array(
				'title'       => statchasers_fit_title(
					array(
						sprintf( '%s News %s: Injuries, Moves & Fantasy Impact', $name, $season ),
						sprintf( '%s News %s: Injuries & Roster Moves', $name, $season ),
					)
				),
				'description' => sprintf(
					'The latest %1$s news: injury designations, roster moves and depth-chart changes through the %2$s season, each with what it means for %3$s fantasy value.',
					$name,
					$season,
					$nick
				),
			);

		case 'depth-chart':
			return array(
				'title'       => sprintf( '%s Depth Chart %s: Starters & Backups', $name, $season ),
				'description' => sprintf(
					'The %1$s offensive depth chart for %2$s: starters and backups by position, with the %3$s roles that decide fantasy value.',
					$name,
					$season,
					$nick
				),
			);
	}

	return array(
		'title'       => statchasers_fit_title(
			array(
				sprintf( '%1$s %2$s: Record, Schedule, Stats & Fantasy', $name, $season ),
				sprintf( '%1$s %2$s: Record, Schedule & Stats', $name, $season ),
			)
		),
		'description' => sprintf(
			'Live %1$s player news and injury updates, the offensive depth chart, %2$s schedule, team stats with NFL ranks and a weekly fantasy outlook.',
			$nick,
			$season
		),
	);
}

/**
 * The H1 for one team URL, built from team + section + season.
 *
 * MIRRORS teamSectionHeading() in the API's src/lib/team-render.ts, whose own
 * comment names this side as the owner: the fragment steps its hero down to
 * <h2> when embedded, "where WordPress supplies the H1". This is that H1, and
 * until it existed there was none - the page inherited whatever the stored
 * post_title said, on the hub and on all six section addresses alike.
 *
 * The phrase alone, where statchasers_team_section_meta()'s title adds the
 * clause after the colon: "Stats 2026" here, "Stats 2026: Offense, Defense &
 * NFL Rankings" in the <title>.
 *
 * The hub (no section) is "New England Patriots Fantasy Football Outlook &
 * Stats 2026", mirroring teamHubHeading(). The Outlook has no heading of its
 * own: the hub opens on it, so `/outlook/` 301s to the hub (see
 * statchasers_team_outlook_redirect()) and the hub's heading is the Outlook's.
 *
 * @param string $slug    Team slug.
 * @param string $section Section id, or '' for the hub.
 * @return string Heading, or '' for an unknown team.
 */
function statchasers_team_heading( string $slug, string $section ): string {
	$row = statchasers_team_table()[ $slug ] ?? null;
	if ( null === $row ) {
		return '';
	}

	// Mirrors SECTION_HEADINGS in src/lib/team-render.ts, saying the same
	// words. The Outlook is the hub, so it takes the hub's phrase below.
	$phrases = array(
		'usage'       => 'Usage & Opportunity Report',
		'stats'       => 'Stats',
		'schedule'    => 'Schedule',
		'depth-chart' => 'Depth Chart',
		'matchups'    => 'Matchups',
		'news'        => 'News',
	);

	// The hub's phrase mirrors teamHubHeading(). It was "Team Hub", which says
	// nothing a reader searches for.
	$phrase = $phrases[ $section ] ?? 'Fantasy Football Outlook & Stats';

	return sprintf( '%s %s %s', $row[0], $phrase, STATCHASERS_TEAM_SEASON );
}

/**
 * Rewrite the page title on a team page, which is the theme's H1.
 *
 * One filter covers all 32 pages and all 192 addresses, with nothing stored and
 * no page edited: the heading is computed per request from the slug the URL
 * resolved to and the section the rewrite rule set, so a season rollover is the
 * same one-line edit as the titles (STATCHASERS_TEAM_SEASON), and a team page
 * created tomorrow is covered the moment it exists.
 *
 * WHY NOT the stored post_title: it is one string and this needs five per team,
 * chosen per request. The stored title stays "<Team> Team Page", which is what
 * the admin list and any nav menu want - a menu item is its own post and its
 * own id, so the guard below leaves it spelled that way.
 *
 * `in_the_loop()` is NOT part of the guard. Divi's Theme Builder renders the
 * post title outside the main loop, and requiring the loop would silently do
 * nothing on exactly the layout these pages use. Matching the queried object's
 * id is the guard that matters: it admits the page's own title and nothing
 * else's, in or out of the loop.
 */
add_filter(
	'the_title',
	function ( $title, $post_id = 0 ) {
		if ( is_admin() || ! is_singular() ) {
			return $title;
		}

		if ( (int) $post_id !== get_queried_object_id() ) {
			return $title;
		}

		$slug = statchasers_team_current_slug();
		if ( '' === $slug ) {
			return $title;
		}

		$heading = statchasers_team_heading( $slug, statchasers_team_section_from_url() );
		if ( '' === $heading ) {
			return $title;
		}

		/**
		 * Filters the H1 a team page prints.
		 *
		 * Return $title to hand the heading back to whatever the page stored.
		 *
		 * @param string $heading Generated heading.
		 * @param string $slug    Team slug.
		 * @param string $section Section id, or '' for the hub.
		 * @param string $title   The stored post title.
		 */
		return (string) apply_filters(
			'statchasers_team_page_heading',
			$heading,
			$slug,
			statchasers_team_section_from_url(),
			$title
		);
	},
	10,
	2
);

/**
 * The metadata for THIS request, or null when it is not a section URL.
 *
 * Deliberately scoped to section URLs only. The 32 hub pages have stored Rank
 * Math fields that an editor may have rewritten, and this plugin's standing
 * promise is that it never overwrites them - so the hub is left alone and only
 * the virtual addresses, which have no row to store anything in, are generated.
 *
 * @return array{title:string,description:string,section:string}|null
 */
function statchasers_team_request_meta(): ?array {
	$section = statchasers_team_section_from_url();
	if ( '' === $section ) {
		return null;
	}

	$slug = statchasers_team_current_slug();
	if ( '' === $slug ) {
		return null;
	}

	$meta = statchasers_team_section_meta( $slug, $section );
	if ( null === $meta ) {
		return null;
	}

	$meta['section'] = $section;
	return $meta;
}

/** The self-referencing canonical for a section URL. */
function statchasers_team_section_canonical(): string {
	$section = statchasers_team_section_from_url();
	$slug    = statchasers_team_current_slug();

	if ( '' === $section || '' === $slug ) {
		return '';
	}

	$page = get_page_by_path( trim( STATCHASERS_TEAM_PATH, '/' ) . '/' . $slug );
	if ( ! $page instanceof WP_Post ) {
		return '';
	}

	// Built from the hub's permalink so it inherits the site's scheme, host and
	// trailing-slash convention rather than guessing at any of them.
	return user_trailingslashit(
		trailingslashit( (string) get_permalink( $page ) ) . $section
	);
}

/**
 * Rank Math owns the title, description, canonical and robots on this site, so
 * a section URL has to say its piece through Rank Math's own filters rather
 * than by printing tags of its own - two canonicals is worse than a wrong one.
 *
 * NOT VERIFIED against the installed Rank Math build. These four filter names
 * are the documented ones; each callback returns the value it was handed when
 * this is not a section URL, so a renamed filter degrades to Rank Math's own
 * output rather than to a broken tag. The document_title_parts fallback below
 * covers the title if Rank Math is absent entirely.
 */
add_filter(
	'rank_math/frontend/title',
	function ( $title ) {
		$meta = statchasers_team_request_meta();
		return $meta ? $meta['title'] : $title;
	}
);

add_filter(
	'rank_math/frontend/description',
	function ( $description ) {
		$meta = statchasers_team_request_meta();
		return $meta ? $meta['description'] : $description;
	}
);

add_filter(
	'rank_math/frontend/canonical',
	function ( $canonical ) {
		$url = statchasers_team_section_canonical();
		return '' === $url ? $canonical : $url;
	}
);

/**
 * og:url on a section page is the section, not the hub. Scoped exactly as the
 * canonical is - the callback hands back what it was given everywhere else, so
 * ordinary pages' OpenGraph output is untouched.
 */
add_filter(
	'rank_math/opengraph/url',
	function ( $url ) {
		$section = statchasers_team_section_canonical();
		return '' === $section ? $url : $section;
	}
);

add_filter(
	'rank_math/frontend/robots',
	function ( $robots ) {
		if ( null === statchasers_team_request_meta() ) {
			return $robots;
		}

		// These exist to be indexed; that is the whole point of splitting them
		// off the hub. Stated rather than left to a default that a site-wide
		// setting could have turned into noindex for everything but posts.
		$robots['index']  = 'index';
		$robots['follow'] = 'follow';
		return $robots;
	}
);

/**
 * Title and canonical without Rank Math.
 *
 * Core prints the canonical from the post's permalink, which on a section URL
 * is the hub - five addresses all canonicalising to one, which is the split
 * buying nothing. Rank Math short-circuits both of these when it is active.
 */
add_filter(
	'document_title_parts',
	function ( array $parts ): array {
		$meta = statchasers_team_request_meta();
		if ( $meta && isset( $parts['title'] ) ) {
			$parts['title'] = $meta['title'];
		}
		return $parts;
	}
);

add_filter(
	'get_canonical_url',
	function ( $canonical ) {
		$url = statchasers_team_section_canonical();
		return '' === $url ? $canonical : $url;
	}
);


/**
 * The section as the last breadcrumb, at its canonical URL. Rank Math's trail
 * on a section URL ends at the hub the rewrite resolves to.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_team_breadcrumbs( $crumbs ) {
	$meta = statchasers_team_request_meta();
	$url  = statchasers_team_section_canonical();
	if ( ! is_array( $crumbs ) || null === $meta || '' === $url ) {
		return $crumbs;
	}

	$labels = array(
		'usage'       => 'Usage',
		'stats'       => 'Stats',
		'schedule'    => 'Schedule',
		'depth-chart' => 'Depth Chart',
		'matchups'    => 'Matchups',
		'news'        => 'News',
	);

	if ( isset( $labels[ $meta['section'] ] ) ) {
		$crumbs[] = array( $labels[ $meta['section'] ], $url, 'hide_in_schema' => false );
	}

	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_team_breadcrumbs', 20 );

/* ------------------------------------------------------------- sitemap */

/**
 * One <url> entry, as Rank Math's page sitemap prints them.
 *
 * @param string $loc     Absolute URL.
 * @param string $lastmod ISO 8601 date, or '' to omit.
 */
function statchasers_team_sitemap_entry( string $loc, string $lastmod ): string {
	return "\t<url>\n" .
		"\t\t<loc>" . esc_url( $loc ) . "</loc>\n" .
		( '' === $lastmod ? '' : "\t\t<lastmod>" . esc_html( $lastmod ) . "</lastmod>\n" ) .
		"\t</url>\n";
}

/**
 * The section URLs, appended to Rank Math's page sitemap.
 *
 * The hub pages are real posts and Rank Math lists them itself. The section
 * URLs have no post, so they have to be added - and only while the rewrite is
 * live, or the sitemap would advertise 128 addresses that 404. Same switch as
 * the rewrite, so the two cannot disagree.
 *
 * Built from the pages that actually exist: a team whose hub has not been
 * created has no section URLs either, because they resolve THROUGH the hub.
 * And only from pages that ARE hubs - carrying [statchasers_team], the same
 * test statchasers_team_post_has_shortcode() applies - so a page someone made
 * at a team's slug for another purpose does not have five section addresses
 * advertised beneath it.
 *
 * NOT VERIFIED against the installed Rank Math build: `{$type}_content` is the
 * documented filter for appending entries to a post-type sitemap. If the page
 * sitemap does not list the section URLs after enabling the flag, this is the
 * name to check.
 */
add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}

		if ( ! statchasers_team_section_urls_enabled() ) {
			return $content;
		}

		$container = statchasers_team_container( false );
		if ( ! $container ) {
			return $content;
		}

		$extra = '';
		foreach ( array_keys( statchasers_team_table() ) as $slug ) {
			$id = statchasers_team_find_page( $slug, $container );
			if ( ! $id || 'publish' !== get_post_status( $id ) ) {
				continue;
			}
			$post = get_post( $id );
			if ( ! $post instanceof WP_Post || ! has_shortcode( (string) $post->post_content, STATCHASERS_TEAM_SHORTCODE ) ) {
				continue;
			}

			$hub     = trailingslashit( (string) get_permalink( $id ) );
			$lastmod = (string) get_post_modified_time( 'c', true, $id );

			foreach ( STATCHASERS_TEAM_SECTIONS as $section ) {
				// The Outlook is the hub, which Rank Math lists itself.
				if ( 'outlook' === $section ) {
					continue;
				}
				$extra .= statchasers_team_sitemap_entry( user_trailingslashit( $hub . $section ), $lastmod );
			}
		}

		return $content . $extra;
	}
);

/* ------------------------------------------------- hub title migration */

/**
 * Whether a stored hub title is one this plugin wrote, in any season.
 *
 * Three templates, each with the season as any four digits:
 *
 *   - the oldest, "<season> <team> Fantasy Football Hub | StatChasers";
 *   - the 2026-09 one, "<team> <season>: Record, Schedule, Stats & Fantasy
 *     Football | StatChasers";
 *   - the current one, "<team> <season>: Record, Schedule, Stats & Fantasy"
 *     or its shorter rung "<team> <season>: Record, Schedule & Stats", with no
 *     brand (mak, 2026-10-08) - statchasers_team_section_meta() with no
 *     section, which is what the builder writes now.
 *
 * The second is what makes the season rollover a button press. Recognising
 * only the old wording meant every hub built with the current one read as
 * CUSTOM the moment STATCHASERS_TEAM_SEASON moved on - "New England Patriots
 * 2026: Record, …" is not the 2027 title, and nothing said it was ours - so
 * the retitle left all 32 on last season's year. Anything else that is not
 * empty was typed by a person and is theirs.
 *
 * @param string $title Stored rank_math_title.
 * @param string $name  Team full name, e.g. "New England Patriots".
 */
function statchasers_team_title_is_generated( string $title, string $name ): bool {
	$title = trim( $title );
	if ( '' === $title ) {
		return true;
	}
	$team = preg_quote( $name, '/' );
	return 1 === preg_match(
		'/^(?:(?:\d{4} ' . $team . ' Fantasy Football Hub|' . $team . ' \d{4}: Record, Schedule, Stats & Fantasy Football) \| StatChasers' .
		'|' . $team . ' \d{4}: Record, Schedule(?:, Stats & Fantasy| & Stats))$/',
		$title
	);
}

/**
 * Which hub pages the retitle would touch, and which it would leave alone.
 *
 * The dry run: read on the Tools screen so the count is on the button before
 * anything is written. Descriptions are not migrated - the generated wording
 * did not change, so there is nothing to move them to.
 *
 * @return array{eligible:array<int,string>,custom:array<int,string>,missing:int}
 */
function statchasers_team_retitle_plan(): array {
	$plan      = array( 'eligible' => array(), 'custom' => array(), 'missing' => 0 );
	$container = statchasers_team_container( false );

	foreach ( statchasers_team_table() as $slug => $row ) {
		$id = $container ? statchasers_team_find_page( $slug, $container ) : 0;
		if ( ! $id ) {
			++$plan['missing'];
			continue;
		}

		$current = (string) get_post_meta( $id, 'rank_math_title', true );
		$wanted  = statchasers_team_section_meta( $slug, '' )['title'];

		if ( $current === $wanted ) {
			continue; // Already there.
		}

		if ( statchasers_team_title_is_generated( $current, $row[0] ) ) {
			$plan['eligible'][ $id ] = $slug;
		} else {
			$plan['custom'][ $id ] = $slug;
		}
	}

	return $plan;
}

/**
 * Apply the plan: the eligible pages only.
 *
 * @return int Pages updated.
 */
function statchasers_team_retitle_apply(): int {
	$done = 0;
	foreach ( statchasers_team_retitle_plan()['eligible'] as $id => $slug ) {
		update_post_meta( $id, 'rank_math_title', statchasers_team_section_meta( $slug, '' )['title'] );
		++$done;
	}
	return $done;
}

add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_team_retitle'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_team_retitle' );

		set_transient( 'statchasers_team_retitle_result', statchasers_team_retitle_apply(), MINUTE_IN_SECONDS );

		wp_safe_redirect( add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) ) );
		exit;
	}
);

/** The retitle panel on the Tools screen. Printed by statchasers_team_pages_screen(). */
function statchasers_team_retitle_panel(): void {
	$result = get_transient( 'statchasers_team_retitle_result' );
	if ( false !== $result ) {
		delete_transient( 'statchasers_team_retitle_result' );
		printf(
			'<div class="notice notice-success is-dismissible"><p><strong>Done.</strong> %d hub title%s updated.</p></div>',
			(int) $result,
			1 === (int) $result ? '' : 's'
		);
	}

	$plan     = statchasers_team_retitle_plan();
	$eligible = count( $plan['eligible'] );
	$custom   = count( $plan['custom'] );

	echo '<h2>Hub titles</h2>';
	printf(
		'<p>The hub title is now <code>%s</code>. Pages still carrying the old ' .
		'<code>&lt;season&gt; &lt;team&gt; Fantasy Football Hub</code> or ' .
		'<code>&lt;team&gt; &lt;season&gt;: Record, Schedule, Stats &amp; Fantasy Football | StatChasers</code> wording, ' .
		'this wording with an earlier season, or no title, can be moved to it here. ' .
		'A title someone typed by hand is never touched.</p>',
		esc_html( statchasers_team_section_meta( 'new-england-patriots', '' )['title'] )
	);
	printf(
		'<p><strong>%d eligible &middot; %d custom title%s left alone%s</strong></p>',
		$eligible,
		$custom,
		1 === $custom ? '' : 's',
		$plan['missing'] ? sprintf( ' &middot; %d page%s missing', $plan['missing'], 1 === $plan['missing'] ? '' : 's' ) : ''
	);

	if ( $custom ) {
		echo '<p class="description">Custom: <code>' . esc_html( implode( '</code>, <code>', $plan['custom'] ) ) . '</code></p>';
	}

	if ( $eligible ) {
		echo '<form method="post">';
		wp_nonce_field( 'statchasers_team_retitle' );
		printf(
			'<p><button type="submit" name="statchasers_team_retitle" value="1" class="button button-primary">Update %d title%s</button></p>',
			$eligible,
			1 === $eligible ? '' : 's'
		);
		echo '</form>';
	} else {
		echo '<p>Nothing to update.</p>';
	}
}
