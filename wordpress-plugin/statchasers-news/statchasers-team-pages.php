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
		$nickname = substr( strrchr( ' ' . $name, ' ' ), 1 );

		statchasers_team_fill_meta(
			$id,
			'rank_math_title',
			STATCHASERS_TEAM_SEASON . ' ' . $name . ' Fantasy Football Hub | StatChasers'
		);
		statchasers_team_fill_meta(
			$id,
			'rank_math_description',
			'Live ' . $nickname . ' player news and injury updates, the offensive depth chart, ' .
			STATCHASERS_TEAM_SEASON . ' schedule, team stats with NFL ranks and a weekly fantasy outlook.'
		);
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
