<?php
/**
 * The player page shortcode: [statchasers_player]
 *
 * Same posture as the team hub in statchasers-team.php, and for the same
 * reason. The API serves every player route with `noindex, indexifembedded`,
 * which means those pages are invisible to search until something embeds them —
 * `indexifembedded` with no embed is just `noindex`. This file is the embed.
 * Without it the content exists and ranks nowhere.
 *
 * What differs from the team mount:
 *
 *   1. There are several hundred of these rather than 32, so the cache TTL is
 *      the same but the volume is not. That is fine — a player fragment is
 *      cheap to render (the API assembles it from local JSON, with no upstream
 *      in the request path) and each is cached under its own key.
 *   2. It takes a `format` attribute. Scoring format genuinely changes every
 *      number in the fragment, and a site that runs half-PPR leagues should be
 *      able to say so once per page rather than asking every reader to switch.
 *   3. There is no alias resolution. A team has a handful of well-known aliases
 *      worth redirecting; a player slug has thousands of near-misses, so a slug
 *      that does not resolve is reported to an administrator rather than
 *      guessed at.
 *
 * Everything else is shared with the news file: the origin, the asset version,
 * the canonical guess. This file is required from statchasers-news.php and is
 * not a plugin of its own.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_PLAYER_SHORTCODE = 'statchasers_player';

/**
 * The index mount: [statchasers_player_index]
 *
 * The container page at /nfl/players/ needs its own shortcode because it is the
 * one page in this hierarchy whose slug is not a player slug — the profile
 * shortcode there asks the API for a player called "players" and gets nothing.
 */
const STATCHASERS_PLAYER_INDEX_SHORTCODE = 'statchasers_player_index';

/**
 * Sections a URL can be scoped to. Mirrors SECTIONS in the API's
 * src/routes/player.ts — keep the two lists together.
 */
const STATCHASERS_PLAYER_SECTIONS = array(
	'overview',
	'stats',
	'game-log',
	'outlook',
	'injury',
	'news',
	'bio',
);
const STATCHASERS_PLAYER_HANDLE    = 'statchasers-player';

/** How long a rendered player fragment is reused before we ask the API again. */
const STATCHASERS_PLAYER_CACHE_TTL = 5 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_PLAYER_BACKUP_TTL = DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Shorter than the team hub's eight. A team page waits on ESPN for a schedule,
 * a record and two statistics documents; a player page waits on nothing —
 * every number in it is arithmetic over JSON the API already holds in memory.
 * Six seconds is generous for that and still well inside what a page render can
 * absorb.
 */
const STATCHASERS_PLAYER_TIMEOUT = 6;

/** The scoring formats the API understands. Anything else falls back to PPR. */
const STATCHASERS_PLAYER_FORMATS = array( 'standard', 'half', 'ppr' );

/**
 * Which player to render, and in which scoring format.
 *
 * The slug defaults to the post slug, because the WordPress pages are at
 * /nfl/players/<slug>/ and the API's slugs are the same strings — so several
 * hundred pages can carry one identical shortcode with no attribute at all.
 * `slug="..."` is there for the pages where that isn't true.
 *
 * `section` scopes the mount to ONE part of the profile, for the per-section
 * URLs — `/fantasy-football/players/<slug>/injury/` mounts
 * `[statchasers_player section="injury"]`. The API then renders that panel as
 * the whole page, with its own heading, and no tab strip. Without it the mount
 * is the full profile exactly as before.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{slug:string,format:string,section:string,log:string}
 */
function statchasers_player_args( array $atts ): array {
	$atts = shortcode_atts(
		array(
			'slug'    => '',
			'format'  => '',
			'section' => '',
		),
		$atts,
		STATCHASERS_PLAYER_SHORTCODE
	);

	$slug = sanitize_title( (string) $atts['slug'] );

	if ( '' === $slug ) {
		$post = get_post();
		if ( $post instanceof WP_Post ) {
			$slug = (string) $post->post_name;
		}
	}

	// The slug goes into a URL path, so it is constrained to what the API's own
	// slugs look like rather than merely escaped. A value that isn't a plausible
	// player slug is treated as absent — better a missing section than a request
	// built from arbitrary post content.
	if ( ! preg_match( '/^[a-z0-9][a-z0-9-]{1,63}$/', $slug ) ) {
		$slug = '';
	}

	$format = strtolower( trim( (string) $atts['format'] ) );
	if ( '' === $format ) {
		// No attribute: take it from the URL. The profile's own scoring toggle is
		// gone — the control bar carries the start/sit button now — but
		// `?format=half` is still a real address the API renders, and a reader
		// holding one of those links has to get the numbers it names rather than
		// a page that quietly ignores them.
		$format = statchasers_player_query_value( 'format' );
	}
	if ( ! in_array( $format, STATCHASERS_PLAYER_FORMATS, true ) ) {
		$format = 'ppr';
	}

	// Which season the Game Log tab is pinned to, from the URL only — there is
	// no attribute for it, because it is a reader's choice on the page rather
	// than something an editor sets when placing the shortcode. Constrained to a
	// plausible NFL season; the API drops anything this player did not play.
	$log  = statchasers_player_query_value( 'log' );
	$year = (int) $log;
	$log  = ( $year >= 1999 && $year <= (int) gmdate( 'Y' ) + 1 ) ? (string) $year : '';

	// A closed list, matching SECTIONS in the API's routes/player.ts. An
	// unrecognised value is dropped rather than passed through: the API would
	// ignore it and serve the full profile, which at a URL promising one section
	// is the whole page duplicated at a second address.
	$section = strtolower( trim( (string) $atts['section'] ) );
	if ( '' === $section ) {
		// No attribute: take it from the URL, so one page and one shortcode
		// serve both /nfl/players/<slug>/ and /nfl/players/<slug>/injury/.
		$section = statchasers_player_section_from_url();
	}
	if ( '' === $section ) {
		// And as a plain query parameter, which is the shape the API's own
		// in-page links use. Without it, changing the scoring format on a
		// section page silently returns the reader to the full profile.
		$section = statchasers_player_query_value( 'section' );
	}
	if ( ! in_array( $section, STATCHASERS_PLAYER_SECTIONS, true ) ) {
		$section = '';
	}

	return array(
		'slug'    => $slug,
		'format'  => $format,
		'section' => $section,
		'log'     => $log,
	);
}

/**
 * One lowercased query parameter, or ''.
 *
 * Everything read through here is validated against a closed list or a numeric
 * range by its caller before it reaches a URL or a cache key — these values
 * come from the address bar, so "sanitised" is the floor and not the bar.
 */
function statchasers_player_query_value( string $key ): string {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$raw = isset( $_GET[ $key ] ) ? wp_unslash( $_GET[ $key ] ) : '';

	// `?log[]=1` makes this an array, and casting one to a string is a PHP
	// warning printed into the page's <head>. Anything that is not a scalar is
	// not a value this function has been asked for.
	if ( ! is_scalar( $raw ) ) {
		return '';
	}

	return strtolower( trim( sanitize_text_field( (string) $raw ) ) );
}

/**
 * Fetch the server-rendered player fragment, cached.
 *
 * Like the team endpoint, `/embed/player/<slug>` returns raw HTML rather than
 * the `{ok, html, version}` JSON `/embed/ssr` returns, so the body is read
 * directly and the version comes from the ETag the route already sets.
 *
 * @param string $slug    Player slug.
 * @param string $format  Scoring format.
 * @param string $section Section to scope to, or '' for the whole profile.
 * @param string $log     Season the Game Log is pinned to, or '' for the latest.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_player_fetch( string $slug, string $format, string $section = '', string $log = '' ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	// The section is in the cache key because it changes the whole render. Left
	// out, the injury URL and the profile URL share one cached fragment and
	// whichever is requested first wins for both.
	// The Game Log's season is in the key for the same reason the section is: it
	// changes the table, and two readers on two seasons must not share a render.
	// The heading mode is in the key for the same reason the section is: it
	// changes the markup the API returns — one panel's <h2> comes back as the
	// page's <h1> — and a fragment cached under one mode must not be served
	// under the other.
	$own_heading = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	$key        = md5(
		$origin . '|' . $slug . '|' . $format . '|' . $section . '|' . $log .
		'|' . ( $own_heading ? 'h1' : '' )
	);
	$cache_key  = 'sc_player_ssr_' . $key;
	$backup_key = 'sc_player_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$url = $origin . '/embed/player/' . rawurlencode( $slug );
	if ( 'ppr' !== $format ) {
		$url = add_query_arg( 'format', $format, $url );
	}
	if ( '' !== $section ) {
		$url = add_query_arg( 'section', $section, $url );
	}
	if ( '' !== $log ) {
		$url = add_query_arg( 'log', $log, $url );
	}
	if ( $own_heading ) {
		$url = add_query_arg( 'h1', '1', $url );
	}

	$response = wp_remote_get(
		$url,
		array(
			'timeout' => STATCHASERS_PLAYER_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the slug is wrong, and no amount of retrying fixes that. It is
	// still cached as a failure below, so a mistyped slug costs one request per
	// minute rather than one per page view.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		// The route sets a weak ETag over the same fingerprint it caches the
		// render under, so it identifies this exact fragment. Only used for
		// cache bookkeeping — the enqueue version comes from assets.json.
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, STATCHASERS_PLAYER_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_PLAYER_BACKUP_TTL );

	return $payload;
}

/**
 * Fetch the rendered index of every profile, cached.
 *
 * Its own cache key and its own TTL. A profile carries a live game log and is
 * held for five minutes; this carries names and positions, and changes when
 * somebody signs. An hour is the difference.
 *
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_player_index_fetch(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|index' );
	$cache_key  = 'sc_player_idx_' . $key;
	$backup_key = 'sc_player_idx_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$response = wp_remote_get(
		$origin . '/embed/players',
		array(
			'timeout' => STATCHASERS_PLAYER_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	set_transient( $backup_key, $payload, STATCHASERS_PLAYER_BACKUP_TTL );

	return $payload;
}

/**
 * The shortcode: prints the index of every profile into the container page.
 *
 * Same omissions as the profile shortcode — no canonical, no title, no H1. The
 * page owns those; this prints the roster beneath them.
 *
 * Before this existed the container page was whatever the builder had written
 * into it once: a stub list of six hundred links in the theme's own styling,
 * standing in front of the profiles it points at. That stub was never meant to
 * be the finished page — it was there so the parent was not a thin page in the
 * sitemap.
 *
 * @return string HTML.
 */
function statchasers_player_index_shortcode(): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Players:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$data = statchasers_player_index_fetch();

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_player_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Players:</strong> the API returned nothing for <code>/embed/players</code>. Check that the deployment is up.</p>';
		}
		return '';
	}

	/**
	 * Filters the rendered index fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 */
	return (string) apply_filters( 'statchasers_player_index_html', (string) $data['html'] );
}
add_shortcode( STATCHASERS_PLAYER_INDEX_SHORTCODE, 'statchasers_player_index_shortcode' );

/**
 * Register and enqueue the player page's compiled bundles.
 *
 * Separate handles from the news tool and the team hub: three stylesheets,
 * three bundles, and a page that mounts one does not want the others' assets.
 * The version is shared because the build hashes all six files into one number.
 */
function statchasers_player_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_PLAYER_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_PLAYER_HANDLE,
			$origin . '/player.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_PLAYER_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_PLAYER_HANDLE,
			$origin . '/dist/statchasers-player.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_PLAYER_HANDLE );
	wp_enqueue_script( STATCHASERS_PLAYER_HANDLE );

	// Rides on the handle above, so it is scoped to player pages by the same
	// condition that loads the stylesheet at all. See the divi layout section
	// in statchasers-team.php for why this is not left to body classes.
	if ( statchasers_player_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_PLAYER_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not. A tool printing through
	// the site's header, and a phone reading it through a 43px margin on each
	// side, are wrong on every page that mounts a tool — whether or not that
	// page also wants the sidebar's share of the row back.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_PLAYER_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_PLAYER_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount a player page?
 *
 * Reads get_queried_object() rather than get_post(), for the reason given at
 * length in statchasers-team.php: Divi swaps the global post while it renders a
 * Theme Builder layout, so during that render get_post() is the LAYOUT — whose
 * content has no shortcode in it — and the page would answer "no" to a question
 * about itself.
 *
 * Memoised because the layout hooks ask on every post-meta read, which on a
 * Divi page is hundreds of times per request.
 */
function statchasers_player_post_has_shortcode(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	// Before the main query there is no page to inspect. Answer false without
	// caching it, or an early asker would pin the answer for the whole request.
	if ( ! is_singular() ) {
		return false;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_PLAYER_SHORTCODE );

	return $answer;
}

/**
 * Is the INDEX mounted on the page being rendered?
 *
 * Deliberately separate from the question above rather than folded into it,
 * for the reason given on its team twin: that one means "this page is a player
 * profile", and the FAQ node and the heading filters read it that way. An
 * index page has no player, so a profile's FAQ would be built from a slug that
 * names nobody.
 *
 * What the two pages genuinely share is the stylesheet, so that is the only
 * place they are OR'd together.
 */
function statchasers_player_post_has_index_shortcode(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	if ( ! is_singular() ) {
		return false;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_PLAYER_INDEX_SHORTCODE );

	return $answer;
}

/* ----------------------------------------------------- the container page */

/**
 * Is the page being rendered the container at /nfl/players/?
 *
 * The one page in this hierarchy whose slug is not a player slug, and the one
 * page the builder cannot be relied on to mount. statchasers_player_write_index()
 * writes the index shortcode into a container that is empty or still carrying
 * the old stub, and treats anything else as the editor's own work — which is
 * the right promise everywhere except here, because a container somebody built
 * in Divi before the shortcode existed IS "anything else". It has a heading and
 * a paragraph in it, so the build steps over it, and the page ships with copy
 * and no roster. That was /nfl/players/: a title, a sentence, and nothing
 * underneath.
 *
 * Matched by PATH rather than by slug. "players" is a slug several pages could
 * plausibly have; get_page_by_path() answers about the one page at nfl/players,
 * which is the one the six hundred profiles hang off.
 *
 * Reads get_queried_object() for the reason given on the predicates above: on a
 * Divi Theme Builder render the global post is the layout, not the page.
 */
function statchasers_player_is_container_page(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	if ( ! is_singular() ) {
		return false;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post || 'page' !== $post->post_type ) {
		return false;
	}

	// The constant lives in statchasers-player-pages.php, which the loader
	// requires after this file. That is fine at call time and not at parse
	// time, but the fallback costs nothing and keeps this file independent.
	$path      = defined( 'STATCHASERS_PLAYER_PATH' ) ? STATCHASERS_PLAYER_PATH : 'nfl/players';
	$container = get_page_by_path( $path );

	$answer = $container instanceof WP_Post && (int) $container->ID === (int) $post->ID;

	return $answer;
}

/**
 * Print the index on the container page even when nothing mounted it.
 *
 * Every other page in this plugin is mounted by a shortcode somebody placed,
 * and that is the right default: an editor decides where a tool goes. The
 * container is the exception, because it is not a page an editor chose to put a
 * tool on — it is the parent WordPress needs to exist so that /nfl/players/<slug>/
 * resolves at all, and a parent with no roster on it is a thin page standing in
 * front of six hundred good ones.
 *
 * Three ways it declines, in order:
 *
 *   1. The content already renders the index — the shortcode is in the page, or
 *      in a Divi module in the page, and has already expanded by the time this
 *      filter runs at priority 20. Nothing to add.
 *   2. The page's own content carries the shortcode but it produced nothing.
 *      Then the mount is there and the API is what is broken, and appending a
 *      second copy of the same failure helps nobody.
 *   3. `statchasers_player_auto_index` is filtered false, for a site that wants
 *      the container to be something else entirely.
 *
 * Appended rather than prepended: whatever the page already says about the
 * profiles is an introduction to them, and the roster reads as the body.
 *
 * @param string $content Post content, shortcodes already expanded.
 * @return string
 */
function statchasers_player_auto_index( string $content ): string {
	static $done = false;

	if ( $done || is_admin() || ! is_main_query() ) {
		return $content;
	}

	// Past the head, or this is not the render the reader sees. An SEO plugin
	// building a meta description runs the_content filters in wp_head, and
	// without this the roster would be spent on that pass and the page below
	// would come out exactly as broken as before, with nothing to show for it.
	if ( ! did_action( 'wp_head' ) ) {
		return $content;
	}

	if ( ! statchasers_player_is_container_page() ) {
		return $content;
	}

	// the_content runs for whatever post is being rendered, which on a page
	// with a loop module in it is not necessarily the page. Only the container's
	// own body gets the roster appended to it.
	$post = get_post();
	if ( ! $post instanceof WP_Post || (int) $post->ID !== (int) get_queried_object_id() ) {
		return $content;
	}

	if (
		false !== strpos( $content, 'data-scp-index' )
		|| statchasers_player_post_has_index_shortcode()
	) {
		return $content;
	}

	/**
	 * Filters whether the container page mounts the index by itself.
	 *
	 * Return false to leave /nfl/players/ as whatever the builder put there.
	 *
	 * @param bool $auto Whether to append the index.
	 */
	if ( ! (bool) apply_filters( 'statchasers_player_auto_index', true ) ) {
		return $content;
	}

	$html = statchasers_player_index_shortcode();

	if ( '' === trim( $html ) ) {
		return $content;
	}

	$done = true;

	return $content . "\n" . $html;
}
// After do_shortcode (priority 11), so a page that mounts the index itself has
// already rendered it and is recognised as mounted.
add_filter( 'the_content', 'statchasers_player_auto_index', 20 );

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if (
			! statchasers_player_post_has_shortcode()
			&& ! statchasers_player_post_has_index_shortcode()
			// The container mounts itself (statchasers_player_auto_index), and
			// it does it at the_content — far too late to enqueue a stylesheet
			// into the head. Asked here so the roster arrives styled.
			&& ! statchasers_player_is_container_page()
		) {
			return;
		}
		statchasers_player_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column?
 *
 * Exactly the team hub's problem and exactly its answer — see the long note on
 * `statchasers_team_wants_full_width()`. Divi gives `#left-area` 79.125% of the
 * row above 980px and reserves the rest for a sidebar that these pages do not
 * have, so without this the profile renders in three quarters of the page with
 * a grey rule and a tall band of nothing beside it.
 *
 * The CSS and the meta/body-class filters are the team file's; only the
 * "does this page mount the tool" question is different, so only that is
 * restated here. Both plugins may run, and everything involved is idempotent.
 */
function statchasers_player_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_player_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting a player profile takes the whole column.
	 *
	 * Return false to keep the theme's own layout — for a page that really does
	 * have a populated sidebar and wants to keep it.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_player_full_width', true );
}

/**
 * Remove the sidebar markup on a player page.
 *
 * page.php reads this meta to decide whether to call get_sidebar(). Filtered
 * rather than written to the database: these pages are created by WP-CLI (see
 * scripts/create-player-pages.sh), so a player added next season would arrive
 * with the default again.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_player_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	// $object_id is whatever is being asked about, which during a Theme Builder
	// render can be the layout post. Only answer for the page itself.
	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_player_wants_full_width() ) {
		return $value;
	}

	// get_post_meta() with $single = true unwraps one level, so a short-circuit
	// has to return the array form or the caller gets the first character.
	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_player_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * `et_full_width_page` is the one that carries weight — see the note on the CSS
 * in statchasers-team.php. Guarded rather than appended, because the team
 * filter may have added the same class already.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_player_full_width_body_class( array $classes ): array {
	if ( ! statchasers_player_wants_full_width() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);

	if ( ! in_array( 'et_full_width_page', $classes, true ) ) {
		$classes[] = 'et_full_width_page';
	}

	return $classes;
}
// Last, not merely late — same reasoning as the team filter.
add_filter( 'body_class', 'statchasers_player_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered player profile into the page.
 *
 * Same deliberate omissions as the news and team shortcodes — no canonical, no
 * <h1>, no title or meta description, nothing written to the URL. The page owns
 * all of it. The fragment's tab strip is `:target`-based, so the only URL state
 * it can produce is a hash, which is not a separate URL to a crawler.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_player_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_player_args( is_array( $atts ) ? $atts : array() );

	if ( '' === $args['slug'] ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player:</strong> no player slug. This page\'s slug is not a player slug, so set one explicitly — <code>[statchasers_player slug="kyler-murray"]</code>.</p>';
		}
		return '';
	}

	$data = statchasers_player_fetch(
		$args['slug'],
		$args['format'],
		$args['section'],
		$args['log']
	);

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_player_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// Unlike the news tool there is no client-side render to fall back to:
		// the player bundle only enhances markup that is already there. An empty
		// string is the honest answer, and it leaves the rest of the page — the
		// H1, the copy, the internal links — intact.
		if ( current_user_can( 'manage_options' ) ) {
			return sprintf(
				'<p><strong>StatChasers Player:</strong> the API returned nothing for <code>%s</code>. Check the slug and that the deployment is up.</p>',
				esc_html( $args['slug'] )
			);
		}
		return '';
	}

	/**
	 * Filters the server-rendered player fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html   Rendered fragment.
	 * @param string $slug   Player slug.
	 * @param string $format Scoring format.
	 */
	// Stripped before the filter, so anything hooking it sees the markup that
	// will actually be printed rather than the transport for the FAQ node.
	return (string) apply_filters(
		'statchasers_player_fragment_html',
		statchasers_player_strip_faq_data( (string) $data['html'] ),
		$args['slug'],
		$args['format']
	);
}
add_shortcode( STATCHASERS_PLAYER_SHORTCODE, 'statchasers_player_shortcode' );

/* --------------------------------------------------------------- FAQ schema */

/**
 * The FAQ schema for a mounted player page.
 *
 * The fragment carries its own Q&A as inert JSON (see renderFaq() in the API's
 * player-render.ts) precisely so this can exist: the API does not print an
 * FAQPage into an embedded mount, because the host document owns its schema and
 * a second <script> competing with Rank Math's graph is the problem, not the
 * fix. So the questions arrive as data and get appended to the graph the page
 * was already going to print.
 *
 * This matters more since the per-section URLs below: /nfl/players/<slug>/game-log/
 * mounts ONE section, so the page carries one FAQ about one subject, which is
 * the shape an FAQPage is supposed to describe. On the unsectioned profile every
 * section's questions merge into a single node — still one FAQPage, because
 * four of them on one URL is four candidates for the same page and Google picks
 * one of them for you.
 */

/**
 * The Q&A the fragment for THIS request is carrying.
 *
 * Resolved and fetched here rather than handed over by the shortcode, because
 * Rank Math prints its graph in wp_head and the shortcode does not run until
 * the_content — by then the <head> is long gone. The fetch is transient-cached
 * on exactly the arguments the shortcode will use, so this warms the cache the
 * shortcode then hits rather than costing a second request.
 *
 * Memoised: the filter and the fallback printer both ask.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_player_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$items = array();

	if ( ! statchasers_player_post_has_shortcode() ) {
		return $items;
	}

	// The slug comes off the QUERIED object rather than being left to
	// statchasers_player_args()'s get_post() fallback, for the reason given on
	// statchasers_player_post_has_shortcode(): the global post is not reliably
	// this page. Everything else — section, format, season — is read from the
	// URL, which is where a reader's choices live.
	//
	// An editor who hard-coded slug="..." on a page with a different slug gets
	// no node rather than the wrong one: the API has nothing for a slug that is
	// not a player, so the fetch comes back empty and this returns nothing.
	$queried = get_queried_object();
	$args    = statchasers_player_args(
		array(
			'slug' => $queried instanceof WP_Post ? (string) $queried->post_name : '',
		)
	);

	if ( '' === $args['slug'] ) {
		return $items;
	}

	$data = statchasers_player_fetch(
		$args['slug'],
		$args['format'],
		$args['section'],
		$args['log']
	);

	if ( null === $data || ! isset( $data['html'] ) || '' === $data['html'] ) {
		return $items;
	}

	$items = statchasers_player_faq_parse( (string) $data['html'] );

	return $items;
}

/**
 * Pull the Q&A islands out of a rendered fragment.
 *
 * Every island on the page is merged, in document order, so the profile mount
 * produces one node rather than one per tab.
 *
 * Validated rather than trusted. It is our own origin, but this ends up in the
 * page's structured data and a malformed island should drop an entry rather
 * than emit a broken node.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_player_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'scp-faq-data' ) ) {
		return $items;
	}

	$found = preg_match_all(
		'#<script type="application/json" class="scp-faq-data">(.*?)</script>#s',
		$html,
		$matches
	);

	if ( ! $found ) {
		return $items;
	}

	foreach ( $matches[1] as $json ) {
		$decoded = json_decode( $json, true );
		if ( ! is_array( $decoded ) ) {
			continue;
		}

		foreach ( $decoded as $entry ) {
			if ( ! is_array( $entry ) || ! isset( $entry['q'], $entry['a'] ) ) {
				continue;
			}
			if ( ! is_string( $entry['q'] ) || ! is_string( $entry['a'] ) ) {
				continue;
			}

			$question = trim( wp_strip_all_tags( $entry['q'] ) );
			$answer   = trim( wp_strip_all_tags( $entry['a'] ) );

			if ( '' === $question || '' === $answer ) {
				continue;
			}

			$items[] = array(
				'q' => $question,
				'a' => $answer,
			);
		}
	}

	return $items;
}

/**
 * One FAQPage node from the questions this request is carrying.
 *
 * @param string $webpage_id The graph's page node, or '' when there is none.
 * @return array<string,mixed>|null Null when there is nothing to describe.
 */
function statchasers_player_faq_node( string $webpage_id = '' ) {
	$items = statchasers_player_faq_items();

	if ( empty( $items ) ) {
		return null;
	}

	$questions = array();
	foreach ( $items as $item ) {
		$questions[] = array(
			'@type'          => 'Question',
			'name'           => $item['q'],
			'acceptedAnswer' => array(
				'@type' => 'Answer',
				'text'  => $item['a'],
			),
		);
	}

	$node = array(
		'@type'      => 'FAQPage',
		'mainEntity' => $questions,
	);

	if ( '' !== $webpage_id ) {
		$node['isPartOf'] = array( '@id' => $webpage_id );
	}

	return $node;
}

/**
 * Append the FAQPage to Rank Math's graph.
 *
 * Append to the array Rank Math hands us, so what ships is one <script>
 * containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_player_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_player_faq_node( statchasers_news_schema_page_id( $data ) );

	if ( null === $node ) {
		return $data;
	}

	$data['statchasersPlayerFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_player_rank_math_schema', 20 );

/**
 * Fallback FAQPage for sites with no schema-graph plugin.
 *
 * Prints ONLY the FAQPage, for the reason the news fallback gives: with no SEO
 * plugin present, WebPage and Organization are a site-wide decision somebody
 * should make deliberately rather than something this tool improvises.
 */
function statchasers_player_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_player_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_player_print_fallback_schema', 20 );

/**
 * Drop the Q&A islands from the markup that is printed.
 *
 * They are a transport for the node above, and once it is built they are a
 * second copy of every answer sitting in the page for nobody. The schema reads
 * from the cached fetch, not from this string, so removing them here costs the
 * node nothing.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_player_strip_faq_data( string $html ): string {
	if ( false === strpos( $html, 'scp-faq-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scp-faq-data">.*?</script>#s',
		'',
		$html
	);
}

/* -------------------------------------------------------------- section URLs */

/**
 * Per-section player URLs, e.g. /nfl/players/jacoby-brissett/injury/.
 *
 * ON BY DEFAULT. It was off while the rule was new — rewrite rules are
 * site-wide and a wrong one takes out URLs that have nothing to do with this
 * plugin — and the rule has since been anchored to the player base and the
 * seven section ids, so it cannot match anything else. Turn it off with:
 *
 *     add_filter( 'statchasers_player_section_urls', '__return_false' );
 *
 * The plugin flushes permalinks itself on activation and after a build.
 *
 * WHAT IT DOES NOT DO: create pages. The rule points the section URL at the
 * player's EXISTING page and sets a query var the shortcode reads, so one page
 * per player serves every section address. Several hundred players do not need
 * several thousand pages.
 *
 * The base defaults to the path the player pages already live at. Change it
 * with:
 *
 *     add_filter( 'statchasers_player_url_base', fn() => 'fantasy-football/players' );
 *
 * and set up 301s from the old base before you do — the old URLs are indexed.
 */
function statchasers_player_section_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_player_section_urls', true );
}

/** The path player pages live under, with no leading or trailing slash. */
function statchasers_player_url_base(): string {
	$base = (string) apply_filters( 'statchasers_player_url_base', 'nfl/players' );
	return trim( $base, '/' );
}

add_filter(
	'query_vars',
	function ( array $vars ): array {
		$vars[] = 'sc_section';
		return $vars;
	}
);

add_action(
	'init',
	function (): void {
		if ( ! statchasers_player_section_urls_enabled() ) {
			return;
		}

		$base     = statchasers_player_url_base();
		$sections = implode( '|', array_map( 'preg_quote', STATCHASERS_PLAYER_SECTIONS ) );

		// The page itself is resolved by pagename, exactly as WordPress would
		// have resolved the bare player URL; only sc_section is added.
		add_rewrite_rule(
			'^' . $base . '/([^/]+)/(' . $sections . ')/?$',
			'index.php?pagename=' . $base . '/$matches[1]&sc_section=$matches[2]',
			'top'
		);
	}
);

/**
 * The section a request is scoped to, from the URL.
 *
 * Read by the shortcode when no explicit `section` attribute is given, which is
 * what lets one page and one shortcode serve both the profile URL and every
 * section URL beneath it.
 */
function statchasers_player_section_from_url(): string {
	$section = strtolower( trim( (string) get_query_var( 'sc_section' ) ) );
	return in_array( $section, STATCHASERS_PLAYER_SECTIONS, true ) ? $section : '';
}

/**
 * Send `/<slug>/overview/` to the profile, 301.
 *
 * The profile opens on the Overview, so the two addresses were one page, each
 * self-canonical. The profile keeps it, the Overview tab links there (the API
 * renders the strip), and the old address — indexed — redirects instead of
 * 404ing, which is why 'overview' stays in STATCHASERS_PLAYER_SECTIONS and so in
 * the rewrite. The reader's query rides along: ?format=half is a set of numbers.
 */
function statchasers_player_overview_redirect(): void {
	if ( 'overview' !== statchasers_player_section_from_url() ) {
		return;
	}

	$queried = get_queried_object();
	$target  = $queried instanceof WP_Post ? get_permalink( $queried ) : '';

	if ( ! $target ) {
		return;
	}

	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$query = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_QUERY );

	wp_safe_redirect( '' === $query ? $target : $target . '?' . $query, 301 );
	exit;
}

add_action( 'template_redirect', 'statchasers_player_overview_redirect', 9 );

/**
 * The season the Game Log is showing, read off the fragment the page will print.
 *
 * The title needs the year — "Game Log 2026" is the phrase people type — and
 * only the API knows which year that is: the newest season this player actually
 * appeared in, or the one `?log=` pinned. Guessing it from the calendar is wrong
 * for exactly the players whose season ended early, which is the group whose
 * game log gets looked up.
 *
 * Cheap, despite being an HTTP fetch: this is the same cached call the shortcode
 * makes a moment later on the same render, so a miss here is a request that was
 * going to happen anyway rather than a second one.
 *
 * Returns '' when the fragment says nothing, and the title then carries no year
 * — better than carrying a wrong one.
 *
 * @param array{slug:string,format:string,section:string,log:string} $args Mount arguments.
 */
function statchasers_player_log_season( array $args ): string {
	$data = statchasers_player_fetch(
		$args['slug'],
		$args['format'],
		$args['section'],
		$args['log']
	);
	if ( ! is_array( $data ) || ! isset( $data['html'] ) ) {
		return '';
	}

	if ( ! preg_match( '/data-log-season="(\d{4})"/', (string) $data['html'], $match ) ) {
		return '';
	}

	return $match[1];
}

/**
 * The document title on a section URL.
 *
 * Without this, the section URL inherits the profile page's title and the two
 * addresses compete for the same query with the same string. The API renders
 * the matching <h2> inside the fragment; the <h1> is the theme's and is the one
 * piece of this that has to be changed there.
 */
add_filter(
	'document_title_parts',
	function ( array $parts ): array {
		$section = statchasers_player_section_from_url();
		if ( '' === $section || ! isset( $parts['title'] ) ) {
			return $parts;
		}

		$phrases = array(
			'stats'    => 'Stats',
			'injury'   => 'Injury Update, Status & History',
			'game-log' => 'Game Log',
			'outlook'  => 'Fantasy Outlook',
			'news'     => 'News & Analysis',
			'overview' => 'Season Overview',
			'bio'      => 'Bio',
		);

		if ( ! isset( $phrases[ $section ] ) ) {
			return $parts;
		}

		$title = $parts['title'] . ' ' . $phrases[ $section ];

		// "Jacoby Brissett Game Log 2026: Fantasy Points & Stats by Week" — the
		// season, then what the page actually holds. Only the game log takes the
		// suffix; the other sections read as themselves.
		// "Jacoby Brissett Bio: Age, Height, College, Draft & Career" — the
		// biographical cluster named outright. Bio is the one section whose
		// queries are not fantasy queries, and its title says so.
		if ( 'bio' === $section ) {
			$title .= ': Age, Height, College, Draft & Career';
		}

		if ( 'game-log' === $section ) {
			$args   = statchasers_player_args( array() );
			$season = '' === $args['slug'] ? '' : statchasers_player_log_season( $args );
			if ( '' !== $season ) {
				$title .= ' ' . $season;
			}
			$title .= ': Fantasy Points & Stats by Week';
		}

		$parts['title'] = $title;

		return $parts;
	}
);

/**
 * Clear cached player renders. Called by statchasers_news_flush().
 */
function statchasers_player_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_player_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_player_ssr_' ) . '%'
		)
	);
}
