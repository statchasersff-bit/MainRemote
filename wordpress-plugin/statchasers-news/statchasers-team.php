<?php
/**
 * The team hub shortcode: [statchasers_team]
 *
 * Same posture as the news shortcode in the main plugin file, and for the same
 * reason - the team hubs are the whole point of this half. The API serves them
 * at their own URL marked `noindex, indexifembedded`, which means they are
 * invisible to search until something embeds them. This file is that something.
 * Without it the pages exist and rank nowhere.
 *
 * Two things differ from the news mount, both forced by the endpoint:
 *
 *   1. `/embed/team/<slug>` returns raw HTML, not the `{ok, html, version}`
 *      JSON that `/embed/ssr` returns. So the fetch below reads the body
 *      directly and takes its version from the ETag the route already sets.
 *   2. It takes no render arguments. Everything the news shortcode passes as
 *      query parameters - heading, page size, link templates - is either fixed
 *      for a team page or configured server-side by environment variable.
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

const STATCHASERS_TEAM_SHORTCODE = 'statchasers_team';

/**
 * The index mount: [statchasers_team_index]
 *
 * The container page at /nfl/teams/ needs its own shortcode because it is the
 * one page in this hierarchy whose slug is not a team slug - [statchasers_team]
 * there asks the API for a team called "teams" and gets nothing.
 */
const STATCHASERS_TEAM_INDEX_SHORTCODE = 'statchasers_team_index';
const STATCHASERS_TEAM_HANDLE    = 'statchasers-team';

/** How long a rendered team fragment is reused before we ask the API again. */
const STATCHASERS_TEAM_CACHE_TTL = 5 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_TEAM_BACKUP_TTL = DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Longer than the news timeout: a team hub assembles ESPN season stats, a depth
 * chart, a schedule and the news archive, and a cold render is measurably
 * slower than a list of headlines. Five seconds turned a slow-but-fine render
 * into a fallback often enough to matter.
 */
const STATCHASERS_TEAM_TIMEOUT = 8;

/**
 * Which team to render.
 *
 * Defaults to the post slug, because the WordPress pages are at
 * /nfl/teams/<slug>/ and the API's slugs are the same strings - so 32 pages can
 * carry one identical shortcode with no attribute at all. `slug="..."` is there
 * for the pages where that isn't true.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return string Sanitized slug, or '' if there is nothing usable.
 */
function statchasers_team_slug( array $atts ): string {
	$atts = shortcode_atts(
		array( 'slug' => '' ),
		$atts,
		STATCHASERS_TEAM_SHORTCODE
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
	// team slug is treated as absent - better a missing section than a request
	// built from arbitrary post content.
	return preg_match( '/^[a-z0-9-]{2,40}$/', $slug ) ? $slug : '';
}

/**
 * Fetch the server-rendered team fragment, cached.
 *
 * @param string $slug    Team slug.
 * @param string $section Section to scope the render to, or '' for the hub.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_team_fetch( string $slug, string $section = '' ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	// The section is part of the identity of what comes back - one panel or
	// five, a different heading - so it is part of the cache key. Left out, the
	// first request to any section address would serve its markup to the hub
	// and to every other section on that team for the rest of the TTL.
	// The heading mode joins it for the same reason: it changes the markup the
	// API returns - the panel's opening <h2> comes back as the page's <h1> -
	// and a fragment cached under one mode must not be served under the other.
	$own_heading = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	$key        = md5(
		$origin . '|' . $slug . '|' . $section . '|' . ( $own_heading ? 'h1' : '' )
	);
	$cache_key  = 'sc_team_ssr_' . $key;
	$backup_key = 'sc_team_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array();
	if ( '' !== $section ) {
		$query['section'] = $section;
	}
	if ( $own_heading ) {
		$query['h1'] = '1';
	}

	$response = wp_remote_get(
		$origin . '/embed/team/' . rawurlencode( $slug ) .
			( $query ? '?' . http_build_query( $query ) : '' ),
		array(
			'timeout' => STATCHASERS_TEAM_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the slug is wrong, and no amount of retrying fixes that. It is
	// still cached as a failure below, so a mistyped slug costs one request per
	// TTL rather than one per page view.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute too: otherwise every view,
			// and every caller within a view, retries the origin and waits out
			// the timeout for as long as it stays down.
			set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		// The route sets a weak ETag over the same fingerprint it caches the
		// render under, so it identifies this exact fragment. Only used for
		// cache bookkeeping - the enqueue version comes from assets.json.
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, STATCHASERS_TEAM_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_TEAM_BACKUP_TTL );

	return $payload;
}

/**
 * Fetch the rendered index of all 32 hubs, cached.
 *
 * Its own cache key and its own TTL. The list changes when a team relocates,
 * which is to say never within a season, so it is held far longer than a hub
 * fragment: a hub carries a live depth chart, and this carries 32 names.
 *
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_team_index_fetch(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|index' );
	$cache_key  = 'sc_team_idx_' . $key;
	$backup_key = 'sc_team_idx_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$response = wp_remote_get(
		$origin . '/embed/teams',
		array(
			'timeout' => STATCHASERS_TEAM_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute too: otherwise every view,
			// and every caller within a view, retries the origin and waits out
			// the timeout for as long as it stays down.
			set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
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
	set_transient( $backup_key, $payload, STATCHASERS_TEAM_BACKUP_TTL );

	return $payload;
}

/**
 * The shortcode: prints the index of all 32 hubs into the container page.
 *
 * Same omissions as the hub shortcode - no canonical, no title, no H1. The
 * page owns those; this prints the grid beneath them.
 *
 * Before this existed the container page was whatever the builder wrote into it
 * once: a stub list of 32 links in the theme's own styling, standing in front of
 * 32 pages that look nothing like it. That stub was never meant to be the
 * finished page - it was there so the parent was not a thin page in the sitemap.
 *
 * @return string HTML.
 */
function statchasers_team_index_shortcode(): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Teams:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$data = statchasers_team_index_fetch();

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_team_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Teams:</strong> the API returned nothing for <code>/embed/teams</code>. Check that the deployment is up.</p>';
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
	return (string) apply_filters( 'statchasers_team_index_html', (string) $data['html'] );
}
add_shortcode( STATCHASERS_TEAM_INDEX_SHORTCODE, 'statchasers_team_index_shortcode' );

/**
 * Register and enqueue the team hub's compiled bundles.
 *
 * Separate handles from the news tool: different stylesheet, different bundle,
 * and a page that mounts one does not want the other's assets. The version is
 * shared because the build hashes all four files into one number.
 */
function statchasers_team_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_TEAM_HANDLE, 'registered' ) ) {
		// Inter like every tool, plus the hub's display face (Barlow, Barlow
		// Condensed) for its numerals, headings and the matchup hero. Both as
		// dependencies, so they print exactly where team.css does and nowhere
		// else. See statchasers-assets.php.
		wp_register_style(
			STATCHASERS_TEAM_HANDLE,
			statchasers_public_origin() . '/team.css',
			array_merge( statchasers_font_dependency(), statchasers_display_font_dependency() ),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_TEAM_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_TEAM_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-team.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_TEAM_HANDLE );
	wp_enqueue_script( STATCHASERS_TEAM_HANDLE );

	// Rides on the handle above, so it is scoped to hub pages by the same
	// condition that loads the stylesheet at all - no body class, no filter
	// priority, no theme internals in the way. See the divi layout section.
	if ( statchasers_team_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_TEAM_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not. A tool printing through
	// the site's header, and a phone reading it through a 43px margin on each
	// side, are wrong on every page that mounts a tool - whether or not that
	// page also wants the sidebar's share of the row back.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_TEAM_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_TEAM_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the team hub?
 *
 * Reads get_queried_object() rather than get_post(). Divi swaps the global post
 * while it renders a Theme Builder layout, so during that render get_post() is
 * the LAYOUT - whose content has no shortcode in it - and the page would answer
 * "no" to a question about itself. The queried object is the page either way.
 *
 * Memoized because the layout hooks below ask on every post-meta read, which on
 * a Divi page is hundreds of times per request.
 */
function statchasers_team_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_TEAM_SHORTCODE );

	return $answer;
}

/**
 * Is the INDEX mounted on the page being rendered?
 *
 * Deliberately separate from the question above rather than folded into it.
 * That one means "this page is a team hub", and half the plugin reads it that
 * way: it decides whether to build an FAQ node from the page's slug, and which
 * of two descriptions to fall back to. An index page is neither of those
 * things - it has no team, so a hub's FAQ would be built from a slug that
 * names no team, and a hub's description would be a sentence about a depth
 * chart on a page that has none.
 *
 * What the two pages genuinely share is the stylesheet, so that is the only
 * place they are OR'd together.
 */
function statchasers_team_post_has_index_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_TEAM_INDEX_SHORTCODE );

	return $answer;
}

/* ----------------------------------------------------- the container page */

/**
 * Is the page being rendered the container at /nfl/teams/?
 *
 * The one page in this hierarchy whose slug is not a team slug, and the one
 * page the builder cannot be relied on to mount. statchasers_team_write_index()
 * writes the index shortcode into a container that is empty or still carrying
 * the old stub, and treats anything else as the editor's own work - which is
 * the right promise everywhere except here, because a container somebody built
 * in Divi before the shortcode existed IS "anything else". It has a heading and
 * a paragraph in it, so the build steps over it, and the page ships with copy
 * and no grid. That was /nfl/teams/: a title, a sentence, and 32 bullets in the
 * theme's own styling.
 *
 * The exact twin of statchasers_player_is_container_page(), and deliberately a
 * separate function rather than a shared one: the two containers answer to
 * different paths and load different stylesheets, and the only thing they have
 * in common is the shape of the problem.
 *
 * Matched by PATH rather than by slug. "teams" is a slug several pages could
 * plausibly have; get_page_by_path() answers about the one page at nfl/teams,
 * which is the one the 32 hubs hang off.
 *
 * Reads get_queried_object() for the reason given on the predicates above: on a
 * Divi Theme Builder render the global post is the layout, not the page.
 */
function statchasers_team_is_container_page(): bool {
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

	// The constant lives in statchasers-team-pages.php, which the loader
	// requires after this file. That is fine at call time and not at parse
	// time, but the fallback costs nothing and keeps this file independent.
	$path      = defined( 'STATCHASERS_TEAM_PATH' ) ? STATCHASERS_TEAM_PATH : 'nfl/teams';
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
 * tool on - it is the parent WordPress needs to exist so that /nfl/teams/<slug>/
 * resolves at all, and a parent with no grid on it is a thin page standing in
 * front of 32 good ones.
 *
 * Three ways it declines, in order:
 *
 *   1. The content already renders the index - the shortcode is in the page, or
 *      in a Divi module in the page, and has already expanded by the time this
 *      filter runs at priority 20. Nothing to add.
 *   2. The page's own content carries the shortcode but it produced nothing.
 *      Then the mount is there and the API is what is broken, and appending a
 *      second copy of the same failure helps nobody.
 *   3. `statchasers_team_auto_index` is filtered false, for a site that wants
 *      the container to be something else entirely.
 *
 * Appended rather than prepended: whatever the page already says about the hubs
 * is an introduction to them, and the grid reads as the body.
 *
 * @param string $content Post content, shortcodes already expanded.
 * @return string
 */
function statchasers_team_auto_index( string $content ): string {
	static $done = false;

	if ( $done || is_admin() || ! is_main_query() ) {
		return $content;
	}

	// Past the head, or this is not the render the reader sees. An SEO plugin
	// building a meta description runs the_content filters in wp_head, and
	// without this the grid would be spent on that pass and the page below
	// would come out exactly as broken as before, with nothing to show for it.
	if ( ! did_action( 'wp_head' ) ) {
		return $content;
	}

	if ( ! statchasers_team_is_container_page() ) {
		return $content;
	}

	// the_content runs for whatever post is being rendered, which on a page
	// with a loop module in it is not necessarily the page. Only the container's
	// own body gets the grid appended to it.
	$post = get_post();
	if ( ! $post instanceof WP_Post || (int) $post->ID !== (int) get_queried_object_id() ) {
		return $content;
	}

	if (
		false !== strpos( $content, 'data-sct-index' )
		|| statchasers_team_post_has_index_shortcode()
	) {
		return $content;
	}

	/**
	 * Filters whether the container page mounts the index by itself.
	 *
	 * Return false to leave /nfl/teams/ as whatever the builder put there.
	 *
	 * @param bool $auto Whether to append the index.
	 */
	if ( ! (bool) apply_filters( 'statchasers_team_auto_index', true ) ) {
		return $content;
	}

	// Called directly, not through do_shortcode, so the unlinking that
	// do_shortcode_tag does for every other mount is done here.
	$html = statchasers_player_unlink_missing( statchasers_team_index_shortcode() );

	if ( '' === trim( $html ) ) {
		return $content;
	}

	$done = true;

	return $content . "\n" . $html;
}
// After do_shortcode (priority 11), so a page that mounts the index itself has
// already rendered it and is recognized as mounted.
add_filter( 'the_content', 'statchasers_team_auto_index', 20 );

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if (
			! statchasers_team_post_has_shortcode()
			&& ! statchasers_team_post_has_index_shortcode()
			// The container mounts itself (statchasers_team_auto_index), and
			// it does it at the_content - far too late to enqueue a stylesheet
			// into the head. Asked here so the grid arrives styled.
			&& ! statchasers_team_is_container_page()
		) {
			return;
		}
		statchasers_team_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Is the active theme Divi (or Extra, or a child of either)?
 *
 * Three checks OR'd together rather than one, because the cost of guessing
 * wrong is that the whole section below silently does nothing - which is
 * exactly what a single `function_exists( 'et_get_option' )` gate bought on the
 * first attempt at this fix.
 */
function statchasers_team_is_divi(): bool {
	// get_template() is the PARENT theme's directory, so a child theme still
	// answers "Divi" here.
	if ( in_array( get_template(), array( 'Divi', 'Extra' ), true ) ) {
		return true;
	}

	return defined( 'ET_CORE_VERSION' ) || function_exists( 'et_get_option' );
}

/**
 * Does this page want Divi's full-width column?
 *
 * Divi gives `#left-area` 79.125% of the row above 980px and reserves the rest
 * for a sidebar widget area. On a team page that widget area is empty, so what
 * a reader sees is the hub squeezed into three quarters of the page, a 1px gray
 * rule down the boundary, and a tall band of nothing beside it. Below 980px
 * Divi collapses the split by itself, which is why it looks fine on every phone
 * you check it on.
 *
 * Keyed on "this page mounts the shortcode" rather than on the slug, because
 * that is the actual condition. The companion Divi plugin answers the same
 * question from its table of 32 team slugs, which is right for the pages the
 * WP-CLI script creates and wrong for every hub mounted anywhere else - a
 * staging page, a page whose slug was auto-generated, a hub embedded partway
 * down a longer article. Those are exactly the pages where the empty column
 * turns up, and they are the reason this lives here as well.
 *
 * Both plugins may run. Everything below is idempotent so that is a no-op.
 */
function statchasers_team_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_team_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the hub takes the whole content column.
	 *
	 * Return false to keep the theme's own layout - for a page that really does
	 * have a populated sidebar and wants to keep it.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_team_full_width', true );
}

/**
 * Keep the site's own header above the tool.
 *
 * Every tool has sticky furniture - the hub's section nav, the profile's tab
 * bar, the sticky `thead` on the FPA, schedule and rankings tables - and each
 * carries a small z-index so it sits above the rows scrolling under it. Those
 * numbers are only ever meant to be read against the tool's own children. On
 * the published site they end up being read against the theme, and the tool
 * comes out on top of the header: open the mobile menu and the tab bar is
 * printed through the panel.
 *
 * Why the numbers win, when Divi's header is famously `z-index: 99999`: on a
 * Theme Builder header that 99999 is on the menu module, INSIDE
 * `.et-l--header`, and a wrapper with a z-index of its own is a stacking
 * context the 99999 cannot climb out of. So the header's real height in the
 * root stacking context is the wrapper's - 1, or 2, or nothing at all - and a
 * tab bar at 20 clears it. The `/nfl/teams/` grid is the page that looks fine,
 * and it is the one page with nothing sticky on it.
 *
 * z-index and nothing else, deliberately. The obvious companion is
 * `position: relative`, and it is wrong here: a Theme Builder header may be
 * `sticky`, and forcing it to `relative` would unstick the site's navigation
 * to fix a stacking bug. So the rule has to name an element Divi already
 * positions, and on a Theme Builder header that is NOT `.et-l--header`: on
 * statchasers.com that `<header>` has no position at all, so a z-index on it
 * is ignored and the header's real level in the page was Divi's own
 *
 *     .et_builder_inner_content { position: relative; z-index: 1 }
 *     header .et_builder_inner_content { z-index: 2 }
 *
 * - which is why the Tools dropdown drew behind a player page's 4px accent
 * bar (a z-index of 2 later in the DOM) and the player tab bar (20) printed
 * through the open mobile menu, with this rule on the page the whole time.
 * Lifting that inner wrapper is what lands: it is relative in Divi's own
 * stylesheet, the menu module and the mobile overlay both sit inside it, and
 * on a header that IS positioned the wrapper's 99999 is read inside the
 * header's own context, where it changes nothing. Divi's
 * `.et_builder_inner_content.has_et_pb_sticky { z-index: inherit }` is the
 * same specificity as a two-class selector, hence the `header` tag on ours.
 * Checked by injecting the rule into the live page in headless Chromium and
 * reading elementFromPoint under the open dropdown and the open mobile menu.
 *
 * No media query: a desktop dropdown is the same overlay as the mobile panel
 * and loses to the same rule.
 *
 * @return string
 */
function statchasers_tool_header_layer_css(): string {
	return '.et-l--header,#main-header,#top-header,header.et-l--header>.et_builder_inner_content{z-index:99999}';
}

/**
 * The side gutter below Divi's sidebar breakpoint.
 *
 * `statchasers_team_full_width_css()` only speaks inside `min-width: 981px`,
 * because above that the problem is the empty sidebar column. Below it Divi
 * collapses the columns by itself and the layout looks fine - but the gutter
 * does not come from the columns. It comes from
 *
 *     .container { width: 80%; max-width: 1080px; margin: auto }
 *
 * which is not in a media query at all, so it holds at every width. On a 390px
 * phone 80% is 312px and the tool is read through a 39px margin on each side:
 * a tenth of the screen given away twice over, on the one device where the
 * tables are already tight. That reads as the tool being narrow rather than
 * the page being padded, which is why it survives a desktop check.
 *
 * So: the content column takes the screen, and the gutter becomes the few
 * pixels that stop text touching glass. `max()` rather than a flat 4px so a
 * phone held sideways still clears its notch - on a device with no inset the
 * `env()` is 0 and the 4px wins, which is every phone held upright.
 *
 * Scoped to `#main-content` so the header and footer keep the site's own
 * `.container`, and `!important` because
 * `.et_pb_pagebuilder_layout #main-content .container` outweighs this
 * selector on any page that has been through the Divi Builder - the same
 * asymmetry that gave the team hubs and the player pages two different widths
 * from one rule. See the long note in statchasers-team.php.
 *
 * Shared, and enqueued against each tool's own handle, so it reaches exactly
 * the pages that already load that tool's stylesheet and no others. It started
 * out on the player pages alone, which was the wrong shape for about a day:
 * the gutter belongs to the HOST page, so every page that mounts a tool has
 * it. The teams index at /nfl/teams/ was the next one reported, and its grid
 * was reading through the same 43px margins.
 *
 * **The gutter is on `#main-content`, not on `.container`, and that is the
 * whole point of this rule.** The first version padded `.container`, which
 * fixed the player pages and did nothing at all to the team hubs: the hubs
 * still ran edge to edge on a phone after it shipped. The reason is not
 * specificity and not enqueueing - it is that on those pages there IS no
 * `.container`. Divi's `page.php` prints the `.container` / `#content-area` /
 * `#left-area` wrappers only when the page builder is NOT used:
 *
 *     if ( ! $is_page_builder_used ) : ?><div class="container">…
 *
 * A hub that has been through the builder (and the container page's own
 * history in statchasers-team-pages.php shows they have) goes straight into
 * `#main-content`, so every rule in this file that names `.container` or
 * `#left-area` is addressed to an element that is not on the page. The same
 * is true of a Theme Builder body layout, which renders as
 * `#main-content > .et-l--body`.
 *
 * `#main-content` is the one wrapper all three shapes print, so the gutter
 * goes there and `.container` is explicitly zeroed - one gutter, stated once,
 * with nothing to double up when both elements happen to exist. Measured at
 * 500px on the real embed fragment under both shapes: builder 0px → 4px,
 * plain 4px → 4px, desktop unchanged in both.
 *
 * @return string
 */
function statchasers_tool_mobile_gutter_css(): string {
	return implode(
		'',
		array(
			// Divi's own sidebar breakpoint, from the other side, so this and
			// statchasers_team_full_width_css() meet with no width between
			// them that neither one answers for.
			'@media (max-width:980px){',
			// The gutter itself, on the only wrapper every Divi page shape
			// prints: a plain page, a builder page (no `.container`, no
			// `#left-area`) and a Theme Builder body layout all render inside
			// `#main-content`. Padding the container instead is what left the
			// team hubs flush against the glass while the player pages were
			// already right.
			//
			// `box-sizing` is not decoration. `width: 100%` plus 8px of padding
			// is 8px WIDER than the column under content-box, and a document
			// wider than the screen is not merely a stray scrollbar: every
			// percentage width on the page then resolves against the wider box,
			// and `@container` answers "desktop" on a phone. Divi's own reset
			// makes this a no-op, which is exactly why it must be stated -
			// nothing here should depend on a theme's reset still being there.
			'#main-content{box-sizing:border-box!important;' .
				'padding-left:max(4px,env(safe-area-inset-left,0px))!important;' .
				'padding-right:max(4px,env(safe-area-inset-right,0px))!important}',
			// And the container gives up its own gutter rather than adding a
			// second one to the first. `width`/`max-width` because Divi's 80%
			// is in no media query; the zeroed padding because the gutter now
			// lives one element up, and two 4px gutters on the pages that have
			// both elements would read as 8px on the player pages and 4px on
			// the hubs - the same tool, two widths, which is the bug this file
			// keeps being written to stop.
			'#main-content .container{box-sizing:border-box!important;' .
				'width:100%!important;max-width:100%!important;' .
				'padding-left:0!important;padding-right:0!important}',
			// Belt: Divi's own horizontal padding on the column lives in the
			// min-width rule, but a child theme's need not.
			'#left-area{padding-left:0!important;padding-right:0!important}',
			// A shortcode dropped into a Divi Code or Text module sits inside
			// `.et_pb_row`, and Divi's `.et_pb_row { width: 80% }` holds at
			// every width, like `.container`'s - on a 390px phone that is 39px
			// of margin each side, the bug this function exists for, one
			// wrapper further in. Only the row that holds a tool is widened;
			// the rest of the page keeps its layout. Measured in the Divi sim,
			// 2026-09-24: 382px → 477px of tool at a 500px window.
			'#main-content .et_pb_row:has(' . statchasers_tool_root_selector() . '){' .
				'width:100%!important;max-width:100%!important}',
			'}',
		)
	);
}

/**
 * The width itself, as CSS.
 *
 * This is the belt to the two filters' braces, and it is here because the
 * filters are not enough on their own - not as a matter of taste, but because
 * of what Divi's stylesheet actually says:
 *
 *     @media (min-width: 981px) { #left-area { width: 79.125% } }
 *
 * The 79.125% is on the BARE id. It is not scoped to `.et_right_sidebar`, so
 * taking that class off the body changes nothing at all; the rule that undoes
 * it is `.et_full_width_page #left-area { width: 100% !important }`, which only
 * helps once the new class is actually on the body. That makes the body_class
 * filter load-bearing, and a filter is exactly the kind of thing that can be
 * outrun by another plugin, a cached body class or a theme that adds its layout
 * class later than you hooked. This stylesheet cannot be.
 *
 * Enqueued against STATCHASERS_TEAM_HANDLE, which is proven to load on hub
 * pages - it is how the hub is styled at all - so it needs no scoping of its
 * own beyond that.
 *
 * @return string
 */
function statchasers_team_full_width_css(): string {
	return implode(
		'',
		array(
			// Same breakpoint as Divi's own rule. Outside it Divi has already
			// collapsed the columns and there is nothing to correct.
			'@media (min-width:981px){',
			// The whole row, and no wider than the site's own content column.
			//
			// `width: 100%` takes the sidebar's share back. The max-width is
			// what stops that from meaning "the whole window", and it is not
			// paranoia - it is the fix for the team hubs rendering at ~1800px
			// beside player pages sitting in the site's ordinary column.
			//
			// Why one page type and not the other, when both get this exact
			// stylesheet: Divi widens the content CONTAINER on any page that
			// has been opened in the Divi Builder, so that a full-width SECTION
			// can bleed to the window -
			//
			//     .et_pb_pagebuilder_layout #main-content .container
			//         { width: 100%; max-width: 100% }
			//
			// A tool is not a section. It is page content, printed by a
			// shortcode into the same column as a paragraph would be. So on a
			// hub page that had been through the builder, `#left-area` at 100%
			// meant 100% of the window, and on a player page that had not, it
			// meant 100% of the content column - same rule, same file, two
			// widths, and nothing in either stylesheet to blame.
			//
			// Capping `#left-area` rather than un-widening `.container` because
			// it is the element the tool actually sits in, so this holds
			// whatever made the container wide: the builder layout above, a
			// Theme Builder template, or a content width someone raised in the
			// Customizer.
			'#left-area{width:100%!important;max-width:' . statchasers_team_content_width() . '!important;' .
				'margin-left:auto!important;margin-right:auto!important;' .
				'float:none!important;padding-right:0!important;padding-left:0!important}',
			// The 1px gray rule Divi draws down the column boundary, which
			// without a sidebar beside it is a line down the middle of nothing.
			// And the tool itself, capped at the same width. The rule above
			// caps `#left-area`, which Divi prints only on a page that has NOT
			// been through the builder: on a builder page or a Theme Builder
			// body layout the shortcode lands straight in `#main-content`, the
			// `#left-area` cap styles nothing, and the tool runs the width of
			// the window. The tool's root is on the page in every shape, so the
			// cap there is the one that always holds; on a plain page it is
			// already inside a capped column and changes nothing. Measured in
			// the Divi sim, 2026-09-24, on the rankings and player stats
			// fragments at a 1440px window: builder page 1425px → 1080px,
			// plain page 1080px → 1080px.
			//
			// The generated hero (statchasers_page_heading_html()) is printed
			// just before the tool, outside its root, so it takes the same cap
			// or the page's H1 starts at the window's edge while the tool beneath
			// it sits centered - measured on a builder page at 1780px, H1 at 0px
			// and the table at 343px. Both are block siblings in one column, so
			// the same cap and auto margins put their left edges together.
			'#main-content ' . statchasers_tool_root_selector() . ',#main-content .sc-lo-hero--generated{max-width:' . statchasers_team_content_width() . '!important;' .
				'margin-left:auto!important;margin-right:auto!important}',
			'#main-content .container:before{display:none!important}',
			// Belt: if some other plugin fills the widget area, the hub still
			// owns the row. Overridable through statchasers_team_full_width.
			'#sidebar{display:none!important}',
			'}',
		)
	);
}

/**
 * Every embedded tool's root element, as one selector.
 *
 * Each tool prints one root with its own short class and `is-embed` when it is
 * mounted on a WordPress page. The host rules above size that root, so a tool
 * added to the plugin and left off this list renders at whatever width its
 * page shape happens to give it - which is how the first four tools each
 * shipped with a width bug of their own.
 *
 * @return string
 */
function statchasers_tool_root_selector(): string {
	return ':is(.sct,.scp,.scf,.scr,.scs,.sca,.rbh,.scsos,.schr,.scds).is-embed';
}

/**
 * The site's own content column width, as a CSS length.
 *
 * Asked of the theme rather than written down here, because "as wide as the
 * rest of the site" is the actual requirement and any number in this file is a
 * guess at it. Divi keeps it in the Customizer under Website Content Width and
 * publishes it through `et_get_option( 'content_width' )` - the same value it
 * uses for its own `.container` and `.et_pb_row` rules, so a tool capped here
 * lines up with every hand-built row on the site by construction.
 *
 * 1080px is the fallback, which is Divi's own default: a site that has never
 * touched the setting reads back nothing and is 1080 anyway.
 *
 * Overridable, for a theme this cannot ask:
 *
 *     add_filter( 'statchasers_content_width', fn() => '1280px' );
 *
 * @return string A CSS length, e.g. '1080px'.
 */
function statchasers_team_content_width(): string {
	$width = '';

	if ( function_exists( 'et_get_option' ) ) {
		$width = trim( (string) et_get_option( 'content_width', '' ) );
	}

	if ( '' === $width ) {
		$width = '1080px';
	}

	// The Customizer control stores a number on some Divi versions and a length
	// on others. A bare number in a max-width is invalid and drops the whole
	// declaration, which would put the blowout straight back.
	if ( is_numeric( $width ) ) {
		$width .= 'px';
	}

	/**
	 * Filters the width a tool is held to inside its host page.
	 *
	 * @param string $width A CSS length.
	 */
	$width = (string) apply_filters( 'statchasers_content_width', $width );

	// Anything that is not a plain length is not going into a stylesheet.
	return preg_match( '/^\d+(\.\d+)?(px|em|rem|%|vw)$/', $width ) ? $width : '1080px';
}

/**
 * Remove the sidebar markup.
 *
 * page.php reads this meta to decide whether to call get_sidebar(). Filtered
 * rather than written to the database: these pages are created by WP-CLI (see
 * wordpress-plugin/scripts/), so a page added next season would arrive with the
 * default again, and "why is there an empty column on one team page" is not
 * something anyone should have to rediscover. The layout is a property of what
 * a hub IS, so it belongs in code beside the shortcode.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_team_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	// $object_id is whatever is being asked about, which during a Theme Builder
	// render can be the layout post. Only answer for the page itself.
	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_team_wants_full_width() ) {
		return $value;
	}

	// get_post_meta() with $single = true unwraps one level, so a short-circuit
	// has to return the array form or the caller gets the first character.
	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_team_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * `et_full_width_page` is the one that carries weight - see the note on the CSS
 * above. Dropping `et_right_sidebar` is tidiness rather than the fix.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_team_full_width_body_class( array $classes ): array {
	if ( ! statchasers_team_wants_full_width() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);

	// Guarded rather than appended: the companion Divi plugin adds the same
	// class on the 32 slugs it knows about, and a duplicate in body_class is
	// the kind of thing that shows up in a diff six months from now.
	if ( ! in_array( 'et_full_width_page', $classes, true ) ) {
		$classes[] = 'et_full_width_page';
	}

	return $classes;
}
// Last, not merely late. Divi adds its layout class at the default priority,
// but Theme Builder, a caching plugin or a child theme can all append after
// that, and anything that re-adds et_right_sidebar behind us wins.
add_filter( 'body_class', 'statchasers_team_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered team hub into the page.
 *
 * Same deliberate omissions as the news shortcode - no canonical, no title or
 * meta description, nothing written to the URL. The page owns all of it,
 * including the H1: statchasers_team_heading() supplies that through the_title,
 * so it is the theme that prints it and there is exactly one. The exception is
 * a template that prints no title at all - see
 * `statchasers_team_shortcode_h1` below. The fragment's own tab strip is `:target`-based, so the only URL state it
 * can produce is a hash, which is not a separate URL to a crawler.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_team_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Team:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$atts = is_array( $atts ) ? $atts : array();
	$slug = statchasers_team_slug( $atts );

	// An explicit section="..." wins; otherwise the URL decides, which is what
	// lets ONE page and ONE shortcode serve the hub and every section address
	// beneath it. See statchasers_team_section_from_url().
	$section = isset( $atts['section'] )
		? statchasers_team_section_id( (string) $atts['section'] )
		: statchasers_team_section_from_url();

	if ( '' === $slug ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Team:</strong> no team slug. This page\'s slug is not a team slug, so set one explicitly - <code>[statchasers_team slug="philadelphia-eagles"]</code>.</p>';
		}
		return '';
	}

	$data = statchasers_team_fetch( $slug, $section );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_team_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// Unlike the news tool there is no client-side render to fall back to:
		// the team bundle only enhances markup that is already there. An empty
		// string is the honest answer, and it leaves the rest of the page - the
		// H1, the copy, the internal links - intact.
		if ( current_user_can( 'manage_options' ) ) {
			return sprintf(
				'<p><strong>StatChasers Team:</strong> the API returned nothing for <code>%s</code>. Check the slug and that the deployment is up.</p>',
				esc_html( $slug )
			);
		}
		return '';
	}

	/**
	 * Filters the server-rendered team fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html    Rendered fragment.
	 * @param string $slug    Team slug.
	 * @param string $section Section the render was scoped to, or ''.
	 */
	$html = (string) apply_filters(
		'statchasers_team_fragment_html',
		statchasers_team_strip_faq_data( (string) $data['html'] ),
		$slug,
		$section
	);

	return statchasers_team_shortcode_heading( $slug, $section ) . $html;
}
add_shortcode( STATCHASERS_TEAM_SHORTCODE, 'statchasers_team_shortcode' );

/**
 * The <h1> the shortcode prints itself. Empty by default.
 *
 * On a normal template the theme prints the page title as the H1 and
 * statchasers_team_heading() has already rewritten it to the section-aware
 * phrase, so printing one here would give the page two. Turn this on for a
 * template that prints no title at all - a Divi full-width or Theme Builder
 * layout with no Post Title module is the case that happens - where the
 * the_title filter has nothing to rewrite and the page would otherwise have no
 * H1 at all, only the fragment's hero <h2>:
 *
 *     add_filter( 'statchasers_team_shortcode_h1', '__return_true' );
 *
 * Check before turning it on, because the two cases are indistinguishable from
 * here and both are wrong in one direction:
 *
 *     curl -s https://statchasers.com/nfl/teams/new-england-patriots/ \
 *       | grep -o '<h1[^>]*>[^<]*'
 *
 * The markup is the site's own hero block - see statchasers_page_heading_html()
 * - so a generated heading and a hand-written one are the same component. The
 * lead sentence is the description this URL already carries in Rank Math,
 * which is written per team and per section and so never says something the
 * page below it does not hold.
 *
 * @param string $slug    Team slug.
 * @param string $section Section id, or '' for the hub.
 * @return string An <h1>, or ''.
 */
function statchasers_team_shortcode_heading( string $slug, string $section ): string {
	if ( ! apply_filters( 'statchasers_team_shortcode_h1', false ) ) {
		return '';
	}

	// Declared in statchasers-team-pages.php, which is required after this file
	// - fine at call time, but guarded because a site that loads the shortcode
	// alone should degrade to no heading rather than fatal.
	if ( ! function_exists( 'statchasers_team_heading' ) ) {
		return '';
	}

	$meta = statchasers_team_section_meta( $slug, $section );

	return statchasers_page_heading_html(
		statchasers_team_heading( $slug, $section ),
		null === $meta ? '' : $meta['description']
	);
}



/* ------------------------------------------------------------- faq schema */

/**
 * The questions this request's team fragment is carrying.
 *
 * The team hub is one mount with a `:target` tab strip, so a single fetch
 * carries every tab's questions - the Outlook FAQ and the Stats FAQ both - and
 * this produces one node for the page rather than one per tab.
 *
 * Reads the cached fetch the shortcode is about to hit rather than costing a
 * second request, and is memoized because the filter and the fallback printer
 * both ask.
 *
 * The slug comes off the QUERIED object for the reason given on
 * statchasers_team_post_has_shortcode(): on a Divi page the global post is the
 * layout, not the page, so get_post() would answer about the wrong thing.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_team_faq_items(): array {
	static $items = null;

	if ( null === $items ) {
		$items = statchasers_team_faq_parse( statchasers_team_page_html() );
	}

	return $items;
}

/**
 * The unprinted fragment for this request's team page, or ''.
 *
 * What the schema nodes read their islands from. Hits the cached fetch the
 * shortcode is about to make rather than costing a request of its own.
 *
 * @return string
 */
function statchasers_team_page_html(): string {
	static $html = null;

	if ( null !== $html ) {
		return $html;
	}

	$html = '';

	if ( ! statchasers_team_post_has_shortcode() ) {
		return $html;
	}

	$queried = get_queried_object();
	if ( ! $queried instanceof WP_Post ) {
		return $html;
	}

	$slug = statchasers_team_slug( array( 'slug' => (string) $queried->post_name ) );
	if ( '' === $slug ) {
		return $html;
	}

	// Scoped to the same section the shortcode will print, or the questions in
	// Rank Math's graph describe a page this reader is not on - the Schedule
	// URL carrying the Stats tab's eight questions.
	$data = statchasers_team_fetch( $slug, statchasers_team_section_from_url() );

	if ( null === $data || ! isset( $data['html'] ) ) {
		return $html;
	}

	$html = (string) $data['html'];

	return $html;
}

/**
 * Pull the Q&A islands out of a rendered fragment.
 *
 * Validated rather than trusted. It is our own origin, but this ends up in the
 * page's structured data and a malformed island should drop an entry rather
 * than emit a broken node.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_team_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'sct-faq-data' ) ) {
		return $items;
	}

	$found = preg_match_all(
		'#<script type="application/json" class="sct-faq-data">(.*?)</script>#s',
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
function statchasers_team_faq_node( string $webpage_id = '' ) {
	$items = statchasers_team_faq_items();

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
 * Same posture as statchasers_player_rank_math_schema(): append to the array
 * Rank Math hands us, so what ships is one <script> containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_team_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_team_faq_node( statchasers_news_schema_page_id( $data ) );

	if ( null === $node ) {
		return $data;
	}

	$data['statchasersTeamFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_team_rank_math_schema', 20 );

/**
 * The Schedule page's games: an ItemList of SportsEvents, or null.
 *
 * It takes the place of the SoftwareApplication node the team pages used to
 * carry (see the structured-data comment in statchasers-news.php). The API
 * builds the list - team/schedule-schema.ts, which keeps only the games with a
 * kickoff and a venue - and ships it only on the Schedule section, as an inert
 * island this lifts out. Checked for shape rather than trusted, like the FAQ
 * islands: a malformed one drops the node rather than printing a broken one.
 *
 * @param string $webpage_id The graph's page node, or '' when there is none.
 * @return array<string,mixed>|null
 */
function statchasers_team_schedule_node( string $webpage_id = '' ) {
	$html = statchasers_team_page_html();

	if ( false === strpos( $html, 'sct-schedule-data' ) ) {
		return null;
	}

	if ( ! preg_match( '#<script type="application/json" class="sct-schedule-data">(.*?)</script>#s', $html, $match ) ) {
		return null;
	}

	$node = json_decode( $match[1], true );

	if (
		! is_array( $node )
		|| ( $node['@type'] ?? '' ) !== 'ItemList'
		|| empty( $node['itemListElement'] )
		|| ! is_array( $node['itemListElement'] )
	) {
		return null;
	}

	if ( '' !== $webpage_id ) {
		$node['isPartOf'] = array( '@id' => $webpage_id );
	}

	return $node;
}

/**
 * Append the Schedule page's game list to Rank Math's graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_team_rank_math_schedule( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_team_schedule_node( statchasers_news_schema_page_id( $data ) );

	if ( null !== $node ) {
		$data['statchasersTeamSchedule'] = $node;
	}

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_team_rank_math_schedule', 20 );

/**
 * Fallback FAQPage for sites with no schema-graph plugin.
 *
 * Prints ONLY the FAQPage and the Schedule page's game list. The page's WebPage
 * is the news fallback's; Organization and BreadcrumbList are a site-wide
 * decision somebody should make deliberately, not something this improvises.
 */
function statchasers_team_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	foreach ( array( statchasers_team_faq_node(), statchasers_team_schedule_node() ) as $node ) {
		if ( null === $node ) {
			continue;
		}

		$payload = array( '@context' => 'https://schema.org' ) + $node;

		echo '<script type="application/ld+json">' .
			wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
			'</script>' . "\n";
	}
}
add_action( 'wp_head', 'statchasers_team_print_fallback_schema', 20 );

/**
 * Drop the Q&A islands, and the Schedule page's game list, from the markup that
 * is printed.
 *
 * They are a transport for the node above, and once it is built they are a
 * second copy of every answer sitting in the page for nobody. The schema reads
 * from the cached fetch, not from this string, so removing them here costs the
 * node nothing.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_team_strip_faq_data( string $html ): string {
	if ( false === strpos( $html, 'sct-faq-data' ) && false === strpos( $html, 'sct-schedule-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="sct-(?:faq|schedule)-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached team renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_team_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_team_ssr_', $all );

	// The team index is only ever cleared on the way out. It has never been
	// part of the routine flush, and this is not the change to start.
	if ( $all ) {
		statchasers_flush_transients( 'sc_team_idx_', true );
	}
}
