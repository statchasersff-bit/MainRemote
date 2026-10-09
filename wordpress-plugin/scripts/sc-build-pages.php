<?php
/**
 * One-off builder for the 32 NFL team hub pages, for hosts without shell access.
 *
 * This is create-team-pages.sh done through WordPress's own API instead of
 * WP-CLI, for the case where you cannot get an SSH session. It does the same
 * work and makes the same promises: it never overwrites the content of a page
 * that already exists, it fills Rank Math fields only where they are empty, and
 * running it twice is a no-op.
 *
 * HOW TO USE IT
 *
 *   1. Upload this file to the WordPress root - the directory holding
 *      wp-load.php, usually public_html/.
 *   2. Give it a token. Add a line to wp-config.php, above "That's all, stop
 *      editing!":
 *
 *        define( 'SC_BUILD_PAGES_TOKEN', '<32 or more random characters>' );
 *
 *      or set an SC_BUILD_PAGES_TOKEN environment variable for PHP, if the host
 *      lets you. `openssl rand -hex 16` makes a good one. With neither, the
 *      script answers every request with a 403 and does nothing else.
 *   3. Log in to /wp-admin in the same browser. The script refuses to run for
 *      anyone who is not an administrator, token or no token.
 *   4. Visit it WITHOUT ?go=1 first. That prints the plan and writes nothing:
 *
 *        https://example.com/sc-build-pages.php?key=<token>
 *
 *   5. When the plan looks right, add &go=1 to do it:
 *
 *        https://example.com/sc-build-pages.php?key=<token>&go=1
 *
 *   6. Optionally add &images=1 to also sideload the 32 team crests as featured
 *      images. Off by default: it is 32 remote downloads in one request, and on
 *      shared hosting that is the one step likely to hit max_execution_time.
 *      It is resumable - pages that already have a featured image are skipped -
 *      so if it dies partway, just load the same URL again.
 *
 *   7. DELETE THIS FILE, and take the define() back out of wp-config.php. It
 *      is a page-creating endpoint sitting in your web root; the token and the
 *      admin check are seatbelts, not a reason to leave it there.
 *
 * WHAT IT DOES NOT DO
 *
 * No canonical, no <title>, no meta description of its own - Rank Math owns
 * those, and the three meta values written below are the page's only ones.
 * Same division of labor as the plugin.
 *
 * @package StatChasers\Scripts
 */

/*
 * No token lives in this file. It used to: a fixed secret, committed, which
 * made it the same secret on every site this file was ever uploaded to and
 * readable by anyone who could read the repository. The token now comes from
 * the site itself - SC_BUILD_PAGES_TOKEN in wp-config.php, or the environment
 * variable of the same name - so each install has its own and it is never in
 * version control. See step 2 above.
 */

/** Shortest token accepted. A guessable one is a seatbelt with no buckle. */
const SC_BUILD_TOKEN_MIN = 16;

/** Season, used in the Rank Math title and description only. */
const SC_BUILD_SEASON = '2026';

/** Where the hubs live. Must match SC_TEAM_PATH_PREFIX on the API deployment. */
const SC_BUILD_PARENT_PATH = 'nfl/teams';

/*
 * Mirrors the TEAMS array in create-team-pages.sh, which in turn mirrors
 * src/lib/team/teams.ts. slug => [ name, abbr, division ].
 */
$sc_build_teams = array(
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

/* ------------------------------------------------------------------ bootstrap */

/**
 * Refuse the request: a 403 with a plain-text reason, and nothing else.
 *
 * @param string $message What to print.
 */
function sc_forbidden( $message ) {
	header( 'HTTP/1.1 403 Forbidden' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	exit( $message );
}

/**
 * The token this site has configured, or '' for none.
 *
 * The environment first, because it can be read before WordPress loads; the
 * wp-config.php constant only exists once it has.
 *
 * @return string
 */
function sc_build_token() {
	$env = getenv( 'SC_BUILD_PAGES_TOKEN' );
	if ( is_string( $env ) && '' !== trim( $env ) ) {
		return trim( $env );
	}
	if ( defined( 'SC_BUILD_PAGES_TOKEN' ) && is_string( SC_BUILD_PAGES_TOKEN ) ) {
		return trim( SC_BUILD_PAGES_TOKEN );
	}
	return '';
}

/**
 * Check ?key= against the configured token, or stop with a 403.
 *
 * No token configured is a refusal, not an open door: the script does nothing
 * until the site has said what its secret is.
 *
 * @return string The token, for the links in the report.
 */
function sc_require_token() {
	$token = sc_build_token();
	if ( '' === $token ) {
		sc_forbidden(
			"Forbidden: no build token is configured, so this script will not run.\n\n" .
			"Add this line to wp-config.php, then load this URL again with ?key=<that token>:\n\n" .
			"  define( 'SC_BUILD_PAGES_TOKEN', '<32 or more random characters>' );\n\n" .
			"(An SC_BUILD_PAGES_TOKEN environment variable works too.)\n"
		);
	}
	if ( strlen( $token ) < SC_BUILD_TOKEN_MIN ) {
		sc_forbidden(
			'Forbidden: SC_BUILD_PAGES_TOKEN is shorter than ' . SC_BUILD_TOKEN_MIN . " characters. Use a longer, random one.\n"
		);
	}
	if ( ! isset( $_GET['key'] ) || ! hash_equals( $token, (string) $_GET['key'] ) ) {
		sc_forbidden( "Forbidden.\n" );
	}
	return $token;
}

// With the token in the environment it is checked before WordPress is even
// loaded, so a wrong guess costs an attacker nothing but a 403 and costs the
// server nothing at all. A wp-config.php token can only be checked once
// WordPress has loaded, which is below.
$sc_token = '' !== sc_build_token() ? sc_require_token() : '';

/**
 * Find the WordPress root from wherever this file happens to have been dropped.
 *
 * "Put it in the WordPress root" assumes you can tell which directory that is,
 * and on shared hosting you often cannot - the root may be public_html, or
 * public_html/<domain>, or somewhere a control panel calls something else
 * entirely. So look, rather than insist.
 *
 * Walks up first (handles being dropped in a subdirectory), then checks one
 * level down (handles being dropped in the directory ABOVE the install, which
 * is what happens when WordPress lives in public_html/<domain>).
 *
 * @return string|null Absolute path to the root, or null.
 */
function sc_find_wp_root() {
	$dir = __DIR__;

	for ( $i = 0; $i < 6; $i++ ) {
		if ( file_exists( $dir . '/wp-load.php' ) ) {
			return $dir;
		}
		$parent = dirname( $dir );
		if ( $parent === $dir ) {
			break;
		}
		$dir = $parent;
	}

	$children = @scandir( __DIR__ );
	if ( is_array( $children ) ) {
		foreach ( $children as $child ) {
			if ( '.' === $child || '..' === $child ) {
				continue;
			}
			$candidate = __DIR__ . '/' . $child;
			if ( is_dir( $candidate ) && file_exists( $candidate . '/wp-load.php' ) ) {
				return $candidate;
			}
		}
	}

	return null;
}

$sc_build_root = sc_find_wp_root();

if ( null === $sc_build_root ) {
	// No WordPress, so no wp-config.php, so no token to have checked unless the
	// environment supplied one. The directory listing below stays behind a
	// token either way; without one this is all anybody learns.
	if ( '' === $sc_token ) {
		sc_forbidden(
			"Forbidden: could not find wp-load.php, so no token from wp-config.php can be read.\n\n" .
			"Move this file to the WordPress root (the directory holding wp-admin, wp-content\n" .
			"and wp-includes) and load this URL again.\n"
		);
	}

	// Rather than repeat "put it in the root", show what is actually here so the
	// root can be picked out of the listing. Behind the token, names only.
	header( 'Content-Type: text/plain; charset=utf-8' );

	$listing = @scandir( __DIR__ );
	$dirs    = array();
	if ( is_array( $listing ) ) {
		foreach ( $listing as $entry ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}
			if ( is_dir( __DIR__ . '/' . $entry ) ) {
				$dirs[] = $entry . '/';
			}
		}
	}

	echo "Could not find wp-load.php.\n\n";
	echo 'This file is in: ' . __DIR__ . "\n\n";
	echo "Directories here:\n";
	echo $dirs ? '  ' . implode( "\n  ", $dirs ) . "\n" : "  (none)\n";
	echo "\nThe WordPress root is the directory holding wp-admin, wp-content and\n";
	echo "wp-includes. Move this file there and load this URL again.\n";
	exit;
}

require_once $sc_build_root . '/wp-load.php';

// wp-config.php has run, so its constant is readable now. Before anything else
// - the admin check included - so an unconfigured install says so plainly.
if ( '' === $sc_token ) {
	$sc_token = sc_require_token();
}

if ( ! function_exists( 'current_user_can' ) || ! current_user_can( 'manage_options' ) ) {
	header( 'HTTP/1.1 403 Forbidden' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	exit(
		"Forbidden: this runs as an administrator only.\n\n" .
		"Log in at /wp-admin in this same browser, then load this URL again.\n"
	);
}

$sc_go     = isset( $_GET['go'] ) && '1' === (string) $_GET['go'];
$sc_images = isset( $_GET['images'] ) && '1' === (string) $_GET['images'];

// A slow host plus 32 remote crest downloads is exactly the shape of request
// that gets cut off halfway. Ask for room; hosts may refuse, which is why the
// image pass is written to be resumable rather than relying on this.
if ( function_exists( 'set_time_limit' ) ) {
	@set_time_limit( 0 );
}
ignore_user_abort( true );

/* -------------------------------------------------------------------- helpers */

$sc_log = array();

/**
 * Where is the code actually coming from?
 *
 * Added because a plugin was re-uploaded repeatedly and kept reporting an old
 * version, and no amount of reasoning from outside the server could say why.
 * This does not guess. It asks PHP which file defines the running shortcode,
 * and lists every StatChasers file it can find with the version each one
 * declares - so "which copy is live" stops being a theory.
 *
 * @return array<int,array{0:string,1:string}> Label/value pairs.
 */
function sc_diagnostics() {
	$out = array();

	$out[] = array( 'WordPress root', ABSPATH );
	$out[] = array( 'Plugins dir', defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '(undefined)' );
	$out[] = array( 'Must-use dir', defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '(undefined)' );
	$out[] = array( 'Active theme', (string) get_option( 'stylesheet' ) );

	// The decisive one: the file that actually registered the shortcode this
	// request would run. If this is not the plugin you have been updating, that
	// is the whole answer.
	if ( isset( $GLOBALS['shortcode_tags']['statchasers_team'] ) ) {
		$callback = $GLOBALS['shortcode_tags']['statchasers_team'];
		try {
			$ref = is_string( $callback )
				? new ReflectionFunction( $callback )
				: new ReflectionFunction( Closure::fromCallable( $callback ) );
			$out[] = array(
				'[statchasers_team] is defined in',
				$ref->getFileName() . ':' . $ref->getStartLine(),
			);
		} catch ( Exception $e ) {
			$out[] = array( '[statchasers_team] is defined in', '(could not resolve: ' . $e->getMessage() . ')' );
		}
	} else {
		$out[] = array( '[statchasers_team]', 'NOT REGISTERED - no plugin is providing it' );
	}

	if ( defined( 'STATCHASERS_NEWS_VERSION' ) ) {
		$out[] = array( 'Running plugin version', STATCHASERS_NEWS_VERSION );
	} else {
		$out[] = array( 'Running plugin version', '(constant not defined)' );
	}

	// Every StatChasers-looking plugin, and the Version: header each declares.
	// Two rows here with different versions is the bug, made visible.
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$active = (array) get_option( 'active_plugins', array() );

	foreach ( get_plugins() as $file => $data ) {
		if ( false === stripos( $file, 'statchasers' ) && false === stripos( (string) $data['Name'], 'statchasers' ) ) {
			continue;
		}
		$out[] = array(
			'Plugin: ' . $data['Name'],
			sprintf(
				'v%s - %s - %s',
				$data['Version'],
				$file,
				in_array( $file, $active, true ) ? 'ACTIVE' : 'inactive'
			),
		);
	}

	foreach ( get_mu_plugins() as $file => $data ) {
		if ( false === stripos( $file, 'statchasers' ) && false === stripos( (string) $data['Name'], 'statchasers' ) ) {
			continue;
		}
		$out[] = array( 'MU-plugin: ' . $data['Name'], sprintf( 'v%s - %s - always on', $data['Version'], $file ) );
	}

	// Modification times say whether an upload landed at all.
	foreach ( array( 'statchasers-news', 'statchasers-news.php' ) as $candidate ) {
		$path = WP_PLUGIN_DIR . '/' . $candidate;
		if ( file_exists( $path ) ) {
			$target = is_dir( $path ) ? $path . '/statchasers-news.php' : $path;
			if ( file_exists( $target ) ) {
				$out[] = array(
					'File on disk',
					sprintf(
						'%s - modified %s - %d bytes',
						$target,
						gmdate( 'Y-m-d H:i:s', (int) filemtime( $target ) ) . ' UTC',
						(int) filesize( $target )
					),
				);
				$out[] = array( 'Writable?', is_writable( $target ) ? 'yes' : 'NO - uploads cannot replace it' );
			}
		}
	}

	return $out;
}

/**
 * Record one line of the report.
 *
 * @param string $status One of ok, skip, warn, plan.
 * @param string $message Human-readable line.
 */
function sc_say( $status, $message ) {
	global $sc_log;
	$sc_log[] = array( $status, $message );
}

/**
 * The page at this slug under this parent, or 0.
 *
 * @param string $slug   Page slug.
 * @param int    $parent Parent page ID.
 * @return int
 */
function sc_find_page( $slug, $parent ) {
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
 * Find or create a page.
 *
 * @param string $slug    Page slug.
 * @param string $title   Page title.
 * @param int    $parent  Parent page ID.
 * @param string $content Post content.
 * @param bool   $go      False to plan only.
 * @return int Page ID, or 0 when planning / on failure.
 */
function sc_ensure_page( $slug, $title, $parent, $content, $go ) {
	$existing = sc_find_page( $slug, $parent );

	if ( $existing ) {
		sc_say( 'skip', sprintf( 'exists: %s (post %d) - left alone', $slug, $existing ) );
		return $existing;
	}

	if ( ! $go ) {
		sc_say( 'plan', sprintf( 'would create page "%s" at slug %s', $title, $slug ) );
		return 0;
	}

	$id = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_parent'  => $parent,
			'post_content' => $content,
		),
		true
	);

	if ( is_wp_error( $id ) ) {
		sc_say( 'warn', sprintf( 'FAILED to create %s: %s', $slug, $id->get_error_message() ) );
		return 0;
	}

	sc_say( 'ok', sprintf( 'created: %s -> post %d', $slug, (int) $id ) );

	return (int) $id;
}

/**
 * Write a meta value, but only into an empty field.
 *
 * @param int    $id    Post ID.
 * @param string $key   Meta key.
 * @param mixed  $value Meta value.
 * @param bool   $go    False to plan only.
 */
function sc_set_meta( $id, $key, $value, $go ) {
	if ( ! $id ) {
		return;
	}

	$current = get_post_meta( $id, $key, true );
	if ( ! empty( $current ) ) {
		return;
	}

	if ( ! $go ) {
		sc_say( 'plan', sprintf( 'would set %s on post %d', $key, $id ) );
		return;
	}

	update_post_meta( $id, $key, $value );
}

/**
 * Sideload the team crest as the featured image.
 *
 * Skipped when one is already set, or every re-run would put another 32 copies
 * in the media library - which is also what makes the image pass resumable
 * after a timeout.
 *
 * @param int    $id   Post ID.
 * @param string $name Team name, for the attachment title and alt text.
 * @param string $abbr Team abbreviation, for the CDN path.
 * @param bool   $go   False to plan only.
 */
function sc_set_crest( $id, $name, $abbr, $go ) {
	if ( ! $id || get_post_meta( $id, '_thumbnail_id', true ) ) {
		return;
	}

	if ( ! $go ) {
		sc_say( 'plan', sprintf( 'would import crest for %s', $name ) );
		return;
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';

	// The API's PNG rendering of the crest it draws everywhere else
	// (/team-logos/<abbr>.png redirects to the current file); Sleeper's 150px
	// PNG only when the main plugin and its origin are not available.
	$origin = function_exists( 'statchasers_news_origin' ) ? rtrim( (string) statchasers_news_origin(), '/' ) : '';
	$url    = '' !== $origin
		? $origin . '/team-logos/' . rawurlencode( $abbr ) . '.png'
		: 'https://sleepercdn.com/images/team_logos/nfl/' . $abbr . '.png';
	$file   = download_url( $url, 30 );

	if ( is_wp_error( $file ) ) {
		sc_say( 'warn', sprintf( '%s: crest download failed (%s) - set it by hand', $name, $file->get_error_message() ) );
		return;
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
		// media_handle_sideload() deletes tmp_name on success but not on every
		// failure path, so this is the one place a temp file can leak.
		if ( file_exists( $file ) ) {
			@unlink( $file );
		}
		sc_say( 'warn', sprintf( '%s: crest import failed (%s)', $name, $attachment->get_error_message() ) );
		return;
	}

	update_post_meta( (int) $attachment, '_wp_attachment_image_alt', $name . ' logo' );
	set_post_thumbnail( $id, (int) $attachment );
	sc_say( 'ok', sprintf( '%s: crest set', $name ) );
}

/* ------------------------------------------------------------------- the work */

if ( ! shortcode_exists( 'statchasers_team' ) ) {
	sc_say( 'warn', 'The [statchasers_team] shortcode is not registered - is the StatChasers plugin active? Pages will be created but will render nothing until it is.' );
}

// The parents, resolved or created one path segment at a time.
$sc_parent_id = 0;
foreach ( explode( '/', SC_BUILD_PARENT_PATH ) as $sc_segment ) {
	$sc_segment_title = ucwords( str_replace( '-', ' ', $sc_segment ) );
	if ( 'nfl' === $sc_segment ) {
		$sc_segment_title = 'NFL';
	}
	if ( 'teams' === $sc_segment ) {
		$sc_segment_title = 'NFL Team Hubs';
	}

	$sc_next = sc_ensure_page( $sc_segment, $sc_segment_title, $sc_parent_id, '', $sc_go );

	if ( ! $sc_next ) {
		if ( $sc_go ) {
			sc_say( 'warn', sprintf( 'could not resolve or create /%s/ - stopping', $sc_segment ) );
			break;
		}
		// Planning: there is no real id to hang the children off, so the plan
		// below is printed against parent 0. That is honest about what it knows.
		$sc_next = 0;
	}

	$sc_parent_id = $sc_next;
}

$sc_teams_parent = $sc_parent_id;
$sc_created      = 0;
$sc_existing     = 0;

foreach ( $sc_build_teams as $sc_slug => $sc_row ) {
	list( $sc_name, $sc_abbr, $sc_division ) = $sc_row;

	// Nickname: everything after the last space. "San Francisco 49ers" -> "49ers".
	$sc_nick = substr( strrchr( ' ' . $sc_name, ' ' ), 1 );

	$sc_before = sc_find_page( $sc_slug, $sc_teams_parent );
	$sc_id     = sc_ensure_page( $sc_slug, $sc_name . ' Team Page', $sc_teams_parent, '[statchasers_team]', $sc_go );

	if ( $sc_before ) {
		++$sc_existing;

		$sc_content = (string) get_post_field( 'post_content', $sc_before );
		if ( false === strpos( $sc_content, 'statchasers_team' ) && false === strpos( $sc_content, 'sc_team_hub' ) ) {
			sc_say( 'warn', sprintf( '%s (post %d) has no [statchasers_team] in its content - nothing on it will be indexable.', $sc_slug, $sc_before ) );
		}
	} elseif ( $sc_id ) {
		++$sc_created;
	}

	// Rank Math. The plugin emits no title/description/robots of its own by
	// design, so these three are the page's only ones - and the robots value is
	// the difference between a hub that ranks and 32 pages that quietly don't.
	//
	// The title is the one the plugin's own builder writes (the no-section
	// branch of statchasers_team_section_meta()), so a hub built here and one
	// built from Tools cannot carry two titles for the same page.
	// The sixty-character ladder of statchasers_fit_title(): the shorter rung
	// for a name of twenty letters or more (mak, 2026-10-08), no brand.
	$sc_title = $sc_name . ' ' . SC_BUILD_SEASON . ': Record, Schedule, Stats & Fantasy';
	if ( strlen( $sc_title ) > 60 ) {
		$sc_title = $sc_name . ' ' . SC_BUILD_SEASON . ': Record, Schedule & Stats';
	}
	sc_set_meta( $sc_id, 'rank_math_title', $sc_title, $sc_go );
	sc_set_meta(
		$sc_id,
		'rank_math_description',
		'Live ' . $sc_nick . ' player news and injury updates, the offensive depth chart, ' .
		SC_BUILD_SEASON . ' schedule, team stats with NFL ranks and a weekly fantasy outlook.',
		$sc_go
	);
	sc_set_meta( $sc_id, 'rank_math_robots', array( 'index', 'follow' ), $sc_go );

	if ( $sc_images ) {
		sc_set_crest( $sc_id, $sc_name, $sc_abbr, $sc_go );
	}
}

// The index. A parent page with no body is a thin page that still sits in the
// sitemap; the hub's own switcher already links all 32 from every team page, so
// this exists for readers arriving from the nav.
if ( $sc_teams_parent ) {
	$sc_index_content = (string) get_post_field( 'post_content', $sc_teams_parent );

	/*
	 * The body is the intro and the MOUNT - not 32 links.
	 *
	 * This used to write the lead plus a <ul> of all 32 hubs, which is how the
	 * published /nfl/teams/ ended up showing the wall of links in the theme's
	 * serif and bullet styling with the tool's own grid appended underneath it:
	 * two indexes on one page, the good one last. The plugin has done the right
	 * thing for a while (statchasers_team_write_index()); this script is the
	 * other way the page gets built and it was never brought in step.
	 *
	 * Written when the page is empty, and OVER the stub the old version of this
	 * block wrote - recognized the same way the plugin recognizes it: our own
	 * lead sentence, a wall of links to the team path, and no shortcode of any
	 * kind. Anything else is somebody's own page and is left alone.
	 */
	$sc_index_lead = 'Every NFL team hub: player news, injury designations, the offensive depth chart, the schedule and a weekly fantasy outlook.';

	$sc_index_is_stub = false !== strpos( $sc_index_content, $sc_index_lead )
		&& false === strpos( $sc_index_content, '[' )
		&& substr_count( $sc_index_content, 'href="/' . SC_BUILD_PARENT_PATH . '/' ) >= 30;

	$sc_index_mounted = false !== strpos( $sc_index_content, '[statchasers_team_index' );

	if ( $sc_index_mounted ) {
		sc_say( 'skip', 'index page already mounts the grid - left alone' );
	} elseif ( '' === trim( $sc_index_content ) || $sc_index_is_stub ) {
		$sc_body = '<p>' . esc_html( $sc_index_lead ) . "</p>\n\n[statchasers_team_index]";
		$sc_what = $sc_index_is_stub ? 'replaced the 32-link stub with' : 'wrote';

		if ( $sc_go ) {
			wp_update_post(
				array(
					'ID'           => $sc_teams_parent,
					'post_content' => $sc_body,
				)
			);
			sc_say( 'ok', 'index: ' . $sc_what . ' the grid mount on /' . SC_BUILD_PARENT_PATH . '/' );
		} else {
			sc_say( 'plan', 'would ' . $sc_what . ' the grid mount on /' . SC_BUILD_PARENT_PATH . '/' );
		}
	} else {
		sc_say( 'skip', 'index page has content of its own - left alone' );
	}
}

if ( $sc_go ) {
	flush_rewrite_rules();

	// Drops the 5-minute fragment transients so the new pages render immediately
	// rather than after the first cold fetch.
	if ( function_exists( 'statchasers_news_flush' ) ) {
		statchasers_news_flush();
	}

	sc_say( 'ok', 'flushed rewrite rules and the plugin fragment cache' );
}

/* ---------------------------------------------------------------- the report */

$sc_self = esc_url( strtok( (string) $_SERVER['REQUEST_URI'], '?' ) );
$sc_key  = rawurlencode( $sc_token );

header( 'Content-Type: text/html; charset=utf-8' );
?>
<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>StatChasers - build team pages</title>
<style>
	body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	       max-width: 820px; margin: 40px auto; padding: 0 20px; color: #0b1634; }
	h1 { font-size: 1.4rem; margin: 0 0 4px; }
	.mode { display: inline-block; padding: 3px 10px; border-radius: 999px;
	        font-size: .78rem; font-weight: 700; }
	.dry { background: #fff3cd; color: #7a5b00; }
	.live { background: #d8f3dc; color: #1b5e33; }
	ol { padding-left: 0; list-style: none; }
	li { padding: 4px 0; border-bottom: 1px solid #eef1f6; font-size: .88rem; }
	code, .tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.tag { display: inline-block; min-width: 46px; font-size: .72rem; font-weight: 700; }
	.ok .tag { color: #1b5e33; } .skip .tag { color: #6b7280; }
	.warn .tag { color: #9b1c1c; } .plan .tag { color: #1d4ed8; }
	table.diag { border-collapse: collapse; width: 100%; margin: 8px 0 24px; }
	table.diag th { text-align: left; padding: 5px 12px 5px 0; white-space: nowrap;
	                vertical-align: top; font-size: .82rem; color: #475569; font-weight: 600; }
	table.diag td { padding: 5px 0; font-size: .8rem; word-break: break-all; }
	h2 { font-size: 1rem; margin: 26px 0 6px; }
	.next { margin-top: 28px; padding: 16px 18px; background: #f6f8fb; border-radius: 10px; }
	.danger { margin-top: 18px; padding: 16px 18px; background: #fdecec;
	          border: 1px solid #f5c2c2; border-radius: 10px; }
</style>

<h1>StatChasers - team page builder</h1>
<p>
	<span class="mode <?php echo $sc_go ? 'live' : 'dry'; ?>">
		<?php echo $sc_go ? 'LIVE - changes were written' : 'DRY RUN - nothing was written'; ?>
	</span>
</p>

<p>
	<?php if ( $sc_go ) : ?>
		<strong><?php echo (int) $sc_created; ?></strong> created,
		<strong><?php echo (int) $sc_existing; ?></strong> already existed.
	<?php else : ?>
		This is the plan. Nothing has been changed.
	<?php endif; ?>
</p>

<h2>Where the code is coming from</h2>
<table class="diag">
<?php foreach ( sc_diagnostics() as $sc_row ) : ?>
	<tr><th><?php echo esc_html( $sc_row[0] ); ?></th>
	    <td><code><?php echo esc_html( $sc_row[1] ); ?></code></td></tr>
<?php endforeach; ?>
</table>

<h2>What happened</h2>
<ol>
<?php foreach ( $sc_log as $sc_line ) : ?>
	<li class="<?php echo esc_attr( $sc_line[0] ); ?>">
		<span class="tag"><?php echo esc_html( strtoupper( $sc_line[0] ) ); ?></span>
		<?php echo esc_html( $sc_line[1] ); ?>
	</li>
<?php endforeach; ?>
</ol>

<div class="next">
	<?php if ( ! $sc_go ) : ?>
		<p><strong>Looks right?</strong> Run it for real:</p>
		<p><a href="<?php echo $sc_self; ?>?key=<?php echo $sc_key; ?>&amp;go=1">
			<code><?php echo $sc_self; ?>?key=…&amp;go=1</code></a></p>
		<p>Add <code>&amp;images=1</code> to also import the 32 team crests as
		featured images. That step is resumable - reload if it times out.</p>
	<?php else : ?>
		<p><strong>Done.</strong> Check one page before trusting the other 31:
		<code>/<?php echo SC_BUILD_PARENT_PATH; ?>/philadelphia-eagles/</code></p>
		<?php if ( ! $sc_images ) : ?>
			<p>Featured images were not imported. To add them:
			<a href="<?php echo $sc_self; ?>?key=<?php echo $sc_key; ?>&amp;go=1&amp;images=1">
			<code>&amp;go=1&amp;images=1</code></a></p>
		<?php endif; ?>
	<?php endif; ?>
</div>

<div class="danger">
	<strong>Delete this file now.</strong> It creates pages on request, and it is
	sitting in your web root. The token and the administrator check are seatbelts,
	not a reason to leave it there.
</div>
