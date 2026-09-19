<?php
/**
 * One-click creation of the 32 team hub pages.
 *
 * The hubs only become indexable when a WordPress page embeds them — the API
 * serves them `noindex, indexifembedded` at its own URL — so the 32 pages are
 * not a nicety, they are the thing that makes any of this rank. Building them
 * by hand is 32 pages × (title, slug, parent, shortcode, three Rank Math
 * fields), and the slug is load-bearing: it is what selects the team.
 *
 * That work used to live in scripts/create-team-pages.sh, which needs WP-CLI
 * and therefore SSH. Plenty of hosting has neither. This is the same job driven
 * from Tools → StatChasers Team Pages, with a notice on any admin screen while
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
 * Mirrors src/lib/team/teams.ts on the API side. The slug is the shared key —
 * it is this page's URL segment AND the team the API renders — so the two lists
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
 * Resolves one path segment at a time rather than with get_page_by_path(), so
 * a partially built hierarchy — /nfl/ exists but /nfl/teams/ does not — is
 * completed rather than rejected.
 *
 * @param bool $create Whether to create missing segments.
 * @return int Page ID, or 0 when it does not exist and $create is false.
 */
function statchasers_team_container( bool $create = false ): int {
	$parent = 0;

	foreach ( explode( '/', STATCHASERS_TEAM_PATH ) as $segment ) {
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
 * things that change the answer deliberately — building the pages, saving a
 * page — clear it outright.
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
					// The page title is the <h1> the theme prints above the
					// shortcode; the fragment steps down to <h2> when embedded
					// so this one stays the page's heading.
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
		// design, so these three are the page's only ones — and the robots value
		// is the difference between a hub that ranks and 32 that quietly don't.
		//
		// The strings come from statchasers_team_section_meta() with no section,
		// which is the same function the virtual section URLs generate theirs
		// from. One place the hub's title is written, so it cannot say one thing
		// on a page created today and another on the five addresses beneath it.
		//
		// STORED, unlike the section URLs': this is a real page an editor may
		// rewrite, and fill_meta only ever fills an empty field. A team page
		// created before this wording existed therefore keeps its old title —
		// see the note in README.md on updating the 32 that already exist.
		$root = statchasers_team_section_meta( $slug, '' );

		statchasers_team_fill_meta(
			$id,
			'rank_math_title',
			$root['title'] . ' | StatChasers'
		);
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
 * Skipped when one is already set — which is what makes a run that timed out
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

	$file = download_url( 'https://sleepercdn.com/images/team_logos/nfl/' . $abbr . '.png', 20 );

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

/**
 * Give the container page a body listing all 32.
 *
 * A parent page with no content is a thin page that still sits in the sitemap.
 * Only written when it is empty — if you have written your own copy there, it
 * is yours.
 *
 * @param int $container Container page ID.
 */
function statchasers_team_write_index( int $container ): void {
	$content = (string) get_post_field( 'post_content', $container );

	if ( '' !== trim( $content ) ) {
		return;
	}

	$body     = '<p>Every NFL team hub: player news, injury designations, the offensive depth chart, the schedule and a weekly fantasy outlook.</p>';
	$division = '';

	foreach ( statchasers_team_table() as $slug => $row ) {
		if ( $row[2] !== $division ) {
			if ( '' !== $division ) {
				$body .= '</ul>';
			}
			$body    .= '<h2>' . esc_html( $row[2] ) . '</h2><ul>';
			$division = $row[2];
		}
		$body .= '<li><a href="/' . STATCHASERS_TEAM_PATH . '/' . $slug . '/">' . esc_html( $row[0] ) . '</a></li>';
	}

	$body .= '</ul>';

	wp_update_post(
		array(
			'ID'           => $container,
			'post_content' => $body,
		)
	);
}

/* --------------------------------------------------------------------- admin */

add_action(
	'admin_menu',
	static function (): void {
		add_management_page(
			'StatChasers Team Pages',
			'StatChasers Team Pages',
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
 * before any output — a POST that re-renders in place is one refresh away from
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
	echo '<h1>StatChasers Team Pages</h1>';

	if ( '' === $origin ) {
		echo '<div class="notice notice-error"><p><strong>No API origin set.</strong> Add ' .
			'<code>STATCHASERS_NEWS_ORIGIN</code> to <code>wp-config.php</code> first, or the ' .
			'pages will render empty.</p></div>';
	}

	printf(
		'<p>The hubs live at <code>/%s/&lt;team&gt;/</code>. Each page carries the ' .
		'<code>[%s]</code> shortcode and nothing else — the team is selected by the page slug.</p>',
		esc_html( STATCHASERS_TEAM_PATH ),
		esc_html( STATCHASERS_TEAM_SHORTCODE )
	);

	printf(
		'<p><strong>%d of 32</strong> pages exist. Container page: %s</p>',
		count( $status['present'] ),
		$status['container']
			? '<code>/' . esc_html( STATCHASERS_TEAM_PATH ) . '/</code> (post ' . (int) $status['container'] . ')'
			: '<em>not created yet — the button below will make it</em>'
	);

	if ( $missing > 0 ) {
		echo '<form method="post">';
		wp_nonce_field( 'statchasers_team_build' );
		echo '<p><label><input type="checkbox" name="with_images" value="1" /> ' .
			'Also import the 32 team crests as featured images ' .
			'<span class="description">(32 downloads — slower, and safe to re-run if it times out)</span>' .
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
	statchasers_matchup_panel();

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
 * src/lib/team-render.ts — keep the three lists together. A rewrite rule
 * pointing at a section the API will not scope to serves the hub under a URL
 * that promised one panel, which is duplicate content wearing a second address.
 *
 * `news` is addressable on the API but deliberately absent here. A team whose
 * archive is two stories is a thin page, and the hub already carries the tab;
 * the section is opened by adding it to this list once the data is dense enough
 * to carry its own URL.
 */
const STATCHASERS_TEAM_SECTIONS = array(
	'outlook',
	'stats',
	'schedule',
	'depth-chart',
	'matchups',
);

/**
 * Whether the nested section URLs are live. Off by default.
 *
 *     add_filter( 'statchasers_team_section_urls', '__return_true' );
 *
 * Then flush permalinks once (Settings > Permalinks > Save).
 *
 * WHAT IT DOES NOT DO: create pages. The rule points the section URL at the
 * team's EXISTING page and sets a query var the shortcode reads, so one page
 * per team serves every section address. 32 teams do not need 160 pages, and a
 * section is opened or closed by editing one list rather than by minting or
 * deleting rows in wp_posts.
 *
 * Same shape and the same switch as statchasers_player_section_urls(), because
 * the two page types are addressed the same way.
 */
function statchasers_team_section_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_team_section_urls', false );
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
	}
);

/* -------------------------------------------------- section metadata */

/**
 * The team this request is on, or '' when it is not a team page.
 *
 * The page slug is the team, exactly as it is for the shortcode — one key, so
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
 * actually rank — but a reader can reach either, and the two must say the same
 * thing. Changing one means changing the other.
 *
 * Generated rather than stored: 32 teams x 5 URLs is 160 title/description
 * pairs, and storing them would mean 160 rows to migrate every time a season
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
	// "Patriots" from "New England Patriots" — the form a sentence wants.
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

		case 'stats':
			return array(
				'title'       => sprintf( '%s Stats %s: Offense, Defense & NFL Rankings', $name, $season ),
				'description' => sprintf(
					'%1$s team stats for %2$s: points, yards, pace and play mix on offense and defense, each with the %3$s rank among all 32 teams.',
					$name,
					$season,
					$nick
				),
			);

		case 'schedule':
			return array(
				'title'       => sprintf( '%s Schedule %s: Dates, Opponents & Results', $name, $season ),
				'description' => sprintf(
					'The full %1$s %2$s schedule: every opponent, kickoff time and result, plus the %3$s bye week and what is next on the calendar.',
					$season,
					$name,
					$nick
				),
			);

		case 'matchups':
			return array(
				'title'       => sprintf( '%s Matchups %s: Opponents, Results & Head-to-Head', $name, $season ),
				'description' => sprintf(
					'Every %1$s opponent in %2$s, week by week, with results and a matchup page for each pair: team stats side by side, injuries and the head-to-head record.',
					$name,
					$season
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
		'title'       => sprintf( '%1$s %2$s: Record, Schedule, Stats & Fantasy Football', $name, $season ),
		'description' => sprintf(
			'Live %1$s player news and injury updates, the offensive depth chart, %2$s schedule, team stats with NFL ranks and a weekly fantasy outlook.',
			$nick,
			$season
		),
	);
}

/**
 * The metadata for THIS request, or null when it is not a section URL.
 *
 * Deliberately scoped to section URLs only. The 32 hub pages have stored Rank
 * Math fields that an editor may have rewritten, and this plugin's standing
 * promise is that it never overwrites them — so the hub is left alone and only
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
 * than by printing tags of its own — two canonicals is worse than a wrong one.
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
		return $meta ? $meta['title'] . ' | StatChasers' : $title;
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
 * canonical is — the callback hands back what it was given everywhere else, so
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
 * is the hub — five addresses all canonicalising to one, which is the split
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
 * URLs have no post, so they have to be added — and only while the rewrite is
 * live, or the sitemap would advertise 128 addresses that 404. Same switch as
 * the rewrite, so the two cannot disagree.
 *
 * Built from the pages that actually exist: a team whose hub has not been
 * created has no section URLs either, because they resolve THROUGH the hub.
 *
 * NOT VERIFIED against the installed Rank Math build: `{$type}_content` is the
 * documented filter for appending entries to a post-type sitemap. If the page
 * sitemap does not list the section URLs after enabling the flag, this is the
 * name to check.
 */
add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
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

			$hub     = trailingslashit( (string) get_permalink( $id ) );
			$lastmod = (string) get_post_modified_time( 'c', true, $id );

			foreach ( STATCHASERS_TEAM_SECTIONS as $section ) {
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
 * The old template was "<season> <team> Fantasy Football Hub | StatChasers".
 * Anything else that is not empty was typed by a person and is theirs.
 *
 * @param string $title Stored rank_math_title.
 * @param string $name  Team full name, e.g. "New England Patriots".
 */
function statchasers_team_title_is_generated( string $title, string $name ): bool {
	$title = trim( $title );
	if ( '' === $title ) {
		return true;
	}
	return 1 === preg_match(
		'/^\d{4} ' . preg_quote( $name, '/' ) . ' Fantasy Football Hub \| StatChasers$/',
		$title
	);
}

/**
 * Which hub pages the retitle would touch, and which it would leave alone.
 *
 * The dry run: read on the Tools screen so the count is on the button before
 * anything is written. Descriptions are not migrated — the generated wording
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
		$wanted  = statchasers_team_section_meta( $slug, '' )['title'] . ' | StatChasers';

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
		update_post_meta(
			$id,
			'rank_math_title',
			statchasers_team_section_meta( $slug, '' )['title'] . ' | StatChasers'
		);
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
		'<code>&lt;season&gt; &lt;team&gt; Fantasy Football Hub</code> wording, or no title, can be moved to it here. ' .
		'A title someone typed by hand is never touched.</p>',
		esc_html( statchasers_team_section_meta( 'new-england-patriots', '' )['title'] . ' | StatChasers' )
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
