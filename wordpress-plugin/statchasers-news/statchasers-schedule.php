<?php
/**
 * The NFL schedule shortcode: [statchasers_schedule]
 *
 * Same posture as the other five tools. The API serves /schedule with
 * `noindex, indexifembedded`, so the board is invisible to search until
 * something embeds it - this file is that something.
 *
 * ## What differs from the other shortcodes
 *
 * Two things, and both come from the same fact: this is the only tool whose
 * data can change while a reader is looking at it.
 *
 * 1. **The cache TTL is the API's, not ours.** Every other tool here picks a
 *    number and lives with it, because their data is rebuilt by an ingest that
 *    runs hourly at best. This board carries live scores on thirteen Sunday
 *    afternoons a year and is otherwise static for days. A fixed TTL is either
 *    wrong all season or wrong every Sunday, so the plugin reads `max-age` off
 *    the response and uses that - the API already computes it (30s while a game
 *    is being played, 300s otherwise) and it is the side that knows.
 * 2. **There are three attributes that matter.** View, week and filter. The
 *    team lens (`view="team" team="NE"`) is gone - a team's schedule is the
 *    team hub's Schedule tab now - so a mount that still names it gets the
 *    season grid, the same answer the API gives, and `team` is not sent.
 *
 * ## What the page's own address says
 *
 * The bare page is the season grid - `view` defaults to `matrix` - and a week
 * URL (`/nfl/nfl-schedule/week-7/`) is the weekly board. The rewrite rule below
 * puts the week in a query var, and `statchasers_schedule_args()` lets it
 * override both the week AND the view, so the two addresses cannot disagree
 * with what they render. The API decides the same way, from its own path.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_SCHEDULE_SHORTCODE = 'statchasers_schedule';
const STATCHASERS_SCHEDULE_HANDLE    = 'statchasers-schedule';

/**
 * Bounds on the TTL the API asks for.
 *
 * The response's max-age is trusted, but not unconditionally: a misconfigured
 * proxy rewriting the header should not be able to pin a page for a day or
 * hammer the origin on every view.
 */
const STATCHASERS_SCHEDULE_TTL_MIN = 30;
const STATCHASERS_SCHEDULE_TTL_MAX = 15 * MINUTE_IN_SECONDS;

/** Used when the response carries no usable max-age at all. */
const STATCHASERS_SCHEDULE_TTL_DEFAULT = 5 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_SCHEDULE_BACKUP_TTL = 7 * DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Longer than the FPA table's six. A cold process has to download nflverse's
 * games.csv - the whole of NFL history in one file - before it can answer, and
 * that is a real first request rather than a hypothetical one. Every request
 * after it is served from the process's own cache.
 */
const STATCHASERS_SCHEDULE_TIMEOUT = 12;

/** The views the API understands. Anything else falls back. */
const STATCHASERS_SCHEDULE_VIEWS = array( 'week', 'matrix' );

/** The game filters. */
const STATCHASERS_SCHEDULE_FILTERS = array( 'all', 'division', 'international' );

/** A regular season is 18 weeks. Mirrors TOTAL_WEEKS in the API. */
const STATCHASERS_SCHEDULE_WEEKS = 18;

/* -------------------------------------------------------------- week URLs */

/**
 * Where the board lives, without its slashes.
 *
 * This is both the page the rewrite rules point at and the base the week URLs
 * hang off, so it MUST match `SC_SCHEDULE_PATH` on the API - that is what the
 * board's own week links are built from, and a mismatch means every link on
 * the page 404s. A site that mounts the shortcode somewhere else changes both.
 */
function statchasers_schedule_page_path(): string {
	$path = (string) apply_filters( 'statchasers_schedule_page_path', 'nfl/nfl-schedule' );
	return trim( $path, '/' );
}

/**
 * Whether the per-week addresses are live. On by default.
 *
 *     add_filter( 'statchasers_schedule_week_urls', '__return_false' );
 *
 * Same shape as the matchup switch, and like it the sitemap entries move with
 * the same flag, so the sitemap can never advertise an address the rewrite does
 * not serve. Turning it off leaves `[statchasers_schedule]` exactly as it was:
 * one page, showing whatever week the season is on.
 */
function statchasers_schedule_week_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_schedule_week_urls', true );
}

/** A week's public address: /nfl/nfl-schedule/week-7/. */
function statchasers_schedule_week_url( int $week ): string {
	return user_trailingslashit(
		home_url( '/' . statchasers_schedule_page_path() . '/week-' . $week )
	);
}

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'sc_sched_week';
		return $vars;
	}
);

add_action(
	'init',
	static function (): void {
		if ( ! statchasers_schedule_week_urls_enabled() ) {
			return;
		}
		$page = statchasers_schedule_page_path();
		if ( '' === $page ) {
			return;
		}
		// One segment, one spelling. The leading zero is excluded HERE rather
		// than validated later, because "week-02" is not a slow way of asking
		// for week 2 - it is a second address for it, which is the whole thing
		// the path was moved out of the query string to avoid. Mirrors the
		// strictness of the /schedule/week-:week route in the API.
		$rule = '^' . $page . '/week-([1-9][0-9]?)/?$';
		add_rewrite_rule(
			$rule,
			'index.php?pagename=' . $page . '&sc_sched_week=$matches[1]',
			'top'
		);

		// A new rule is dead until the rule table is rebuilt, and an upgrade
		// does not run the activation hook that asks for that - which is why
		// the week URLs used to need a Settings > Permalinks save before they
		// stopped 404ing. Same self-heal as the rankings file: the rule's own
		// signature is remembered, and a change to it - a first install of this
		// version, or a filtered page path - asks for the flush that
		// statchasers-news.php performs at the end of this same `init`.
		$signature = md5( $rule );
		if ( get_option( 'statchasers_schedule_rules' ) !== $signature ) {
			update_option( 'statchasers_schedule_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/**
 * The week this request names, or 0.
 *
 * MIRRORS parseWeek() in the API's schedule-data.ts: a week the season does not
 * have is not a week. The rewrite's own pattern already rejects the spellings;
 * what is left to check is the range.
 */
function statchasers_schedule_request_week(): int {
	static $week = null;

	if ( null !== $week ) {
		return $week;
	}

	$week = 0;
	// Only on the page that mounts the schedule. The query var is public, so
	// without this `?sc_sched_week=7` on any article on the site retitled it
	// and pointed its canonical at week 7 - the bug rankings and player stats
	// already had fixed.
	if ( ! statchasers_schedule_post_has_shortcode() ) {
		return $week;
	}
	$raw = trim( (string) get_query_var( 'sc_sched_week' ) );
	if ( '' !== $raw && ctype_digit( $raw ) ) {
		$asked = (int) $raw;
		if ( $asked >= 1 && $asked <= STATCHASERS_SCHEDULE_WEEKS ) {
			$week = $asked;
		}
	}

	return $week;
}

/**
 * A week the season does not have is a 404, not the current week.
 *
 * `/nfl/nfl-schedule/week-23/` matches the rewrite - the pattern is the shape,
 * not the truth - and without this it would quietly render whatever week the
 * board opens on, at an address claiming to be week 23. The API answers the
 * same URL with a 404 for the same reason.
 */
add_action(
	'template_redirect',
	static function (): void {
		$raw = trim( (string) get_query_var( 'sc_sched_week' ) );
		// Elsewhere the var means nothing, so it cannot make a page a 404 either.
		if ( '' === $raw || ! statchasers_schedule_post_has_shortcode() || statchasers_schedule_request_week() > 0 ) {
			return;
		}
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
	}
);

/**
 * Normalise the shortcode attributes.
 *
 * `team` is no longer read: the API dropped the team view, so sending it only
 * split this file's cache for renders that came back identical.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{view:string,week:int,filter:string,season:int}
 */
function statchasers_schedule_args( array $atts ): array {
	$atts = shortcode_atts(
		array(
			'view'   => 'matrix',
			'week'   => '',
			'filter' => 'all',
			'season' => '',
		),
		$atts,
		STATCHASERS_SCHEDULE_SHORTCODE
	);

	$view = strtolower( trim( (string) $atts['view'] ) );
	if ( ! in_array( $view, STATCHASERS_SCHEDULE_VIEWS, true ) ) {
		$view = 'matrix';
	}

	$filter = strtolower( trim( (string) $atts['filter'] ) );
	if ( ! in_array( $filter, STATCHASERS_SCHEDULE_FILTERS, true ) ) {
		$filter = 'all';
	}

	// Left at 0, the API picks the week the season is actually on - which is
	// what a page should normally do. A pinned week is a page that still says
	// Week 1 in December.
	$week = (int) $atts['week'];
	if ( $week < 1 || $week > STATCHASERS_SCHEDULE_WEEKS ) {
		$week = 0;
	}

	// A week URL outranks the attribute, because it is an ADDRESS: a page
	// reached at /week-7/ that rendered week 3 would be a wrong answer at a
	// right-looking URL, and the board's own week links all point at addresses
	// now. Where no week URL is in play - any other page mounting the
	// shortcode - the attribute is untouched.
	//
	// It outranks the view for the same reason, and this is the pair that makes
	// the page's two addresses work: the bare page is the season grid, and
	// /week-7/ is the weekly board. Mirrors the API, where the path is the only
	// thing that says which view a rendering is.
	$from_url = statchasers_schedule_request_week();
	if ( $from_url > 0 ) {
		$week = $from_url;
		$view = 'week';
	}

	// The grid ignores the filter, so a grid keeps only one cache entry.
	if ( 'week' !== $view ) {
		$filter = 'all';
	}

	// Same reasoning as the FPA table's season attribute.
	$season = (int) $atts['season'];
	if ( $season < 1999 || $season > 2100 ) {
		$season = 0;
	}

	return array(
		'view'   => $view,
		'week'   => $week,
		'filter' => $filter,
		'season' => $season,
	);
}

/**
 * How long to hold this render, according to the response that carried it.
 *
 * @param array<string,mixed>|WP_Error $response The wp_remote_get result.
 * @return int Seconds, clamped.
 */
function statchasers_schedule_ttl( $response ): int {
	if ( is_wp_error( $response ) ) {
		return STATCHASERS_SCHEDULE_TTL_DEFAULT;
	}

	$header = (string) wp_remote_retrieve_header( $response, 'cache-control' );
	if ( ! preg_match( '/max-age\s*=\s*(\d+)/i', $header, $match ) ) {
		return STATCHASERS_SCHEDULE_TTL_DEFAULT;
	}

	return max(
		STATCHASERS_SCHEDULE_TTL_MIN,
		min( STATCHASERS_SCHEDULE_TTL_MAX, (int) $match[1] )
	);
}

/**
 * Fetch the server-rendered schedule fragment, cached.
 *
 * @param array{view:string,week:int,filter:string,season:int} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_schedule_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	// Never `?h1=1`, unlike the team hubs and player pages. Their promoted
	// heading is a section heading already dressed in the site's style; the
	// schedule's is the source repo's Space Grotesk title, which is not the
	// site's hero and read as a second design on the page. In the heading mode
	// that asks the tool for its H1, this file prints the site's own hero
	// instead - see statchasers_schedule_shortcode_heading().
	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_sched_ssr_' . $key;
	$backup_key = 'sc_sched_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array( 'view' => $args['view'] );
	if ( 'all' !== $args['filter'] ) {
		$query['filter'] = $args['filter'];
	}
	if ( $args['week'] > 0 ) {
		$query['week'] = (string) $args['week'];
	}
	if ( $args['season'] > 0 ) {
		$query['season'] = (string) $args['season'];
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/schedule' ),
		array(
			'timeout' => STATCHASERS_SCHEDULE_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// The API answers 503 rather than an empty shell when the upstream feed is
	// unavailable, precisely so this branch can tell "down right now" from
	// "nothing to show" - the last good board is far better than a hole in the
	// page, because a schedule that is a few hours stale is still almost
	// entirely correct.
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

	set_transient( $cache_key, $payload, statchasers_schedule_ttl( $response ) );
	set_transient( $backup_key, $payload, STATCHASERS_SCHEDULE_BACKUP_TTL );

	return $payload;
}

/**
 * Register and enqueue the board's compiled bundles.
 *
 * Its own handles, like the other five tools: a page mounting this shortcode
 * should not download the news tool's stylesheet. The version is shared because
 * the build hashes every asset into one number.
 */
/**
 * The schedule's own webfonts: DM Sans for text, Space Grotesk for titles,
 * scores and TV marks - the source repo's type, which this tool keeps (see
 * the head of schedule.css). Until 2026-10-07 schedule.css loaded them itself
 * with an @import, which bypassed the enqueue system and OMGF both. Now a
 * dependency of the stylesheet, so they load on the schedule page and nowhere
 * else. Return '' from the filter to serve them yourself or not at all.
 */
function statchasers_schedule_font_url(): string {
	return (string) apply_filters(
		'statchasers_schedule_font_url',
		'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap'
	);
}

function statchasers_schedule_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_SCHEDULE_HANDLE, 'registered' ) ) {
		$deps = statchasers_font_dependency();
		$font = statchasers_schedule_font_url();
		if ( '' !== $font ) {
			// No version: the URL is the version, as with the Inter handle.
			wp_register_style( 'statchasers-schedule-font', $font, array(), null );
			$deps[] = 'statchasers-schedule-font';
		}
		wp_register_style(
			STATCHASERS_SCHEDULE_HANDLE,
			statchasers_public_origin() . '/schedule.css',
			$deps,
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_SCHEDULE_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_SCHEDULE_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-schedule.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_SCHEDULE_HANDLE );
	wp_enqueue_script( STATCHASERS_SCHEDULE_HANDLE );

	if ( statchasers_schedule_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_SCHEDULE_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not. A tool printing through
	// the site's header, and a phone reading it through a 43px margin on each
	// side, are wrong on every page that mounts a tool - whether or not that
	// page also wants the sidebar's share of the row back.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_SCHEDULE_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_SCHEDULE_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the schedule?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out at
 * length in statchasers-team.php: Divi swaps the global post while rendering a
 * Theme Builder layout. Memoised for the same reason too.
 */
function statchasers_schedule_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_SCHEDULE_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_schedule_post_has_shortcode() ) {
			return;
		}
		statchasers_schedule_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column?
 *
 * As load-bearing as it is on the FPA table, and for the same reason: the
 * season matrix is 32 rows by 18 columns, and Divi's 79.125% content column is
 * where it starts scrolling sideways on a desktop with room for all of it.
 */
function statchasers_schedule_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_schedule_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the schedule takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_schedule_full_width', true );
}

/**
 * Remove the sidebar markup on a schedule page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_schedule_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_schedule_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_schedule_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_schedule_full_width_body_class( array $classes ): array {
	if ( ! statchasers_schedule_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_schedule_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered schedule into the page.
 *
 * Same deliberate omissions as the other five - no canonical, no <h1>, no title
 * or meta description, nothing written to the URL. The page owns all of it, and
 * the board's own week and team controls are ordinary links back to whatever
 * SC_SCHEDULE_PATH names on the API side.
 *
 * The one thing it does read is the week, when the request came in at a week
 * URL: `/nfl/nfl-schedule/week-7/`. That is still the page owning its address -
 * the rewrite rule above put the week in a query var before the shortcode ran,
 * and the filters below give that address its own title and canonical.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_schedule_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Schedule:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_schedule_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_schedule_fetch( $args );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_schedule_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only relabels
		// kickoffs in markup that is already there. An empty string leaves the
		// rest of the page - the H1, the copy, the internal links - intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Schedule:</strong> the API returned nothing. Check that the deployment is up and that it can reach the nflverse schedule feed.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered schedule fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 * @param array{view:string,week:int,filter:string,season:int} $args Render arguments.
	 */
	$html = (string) apply_filters(
		'statchasers_schedule_fragment_html',
		statchasers_schedule_strip_faq_data( (string) $data['html'] ),
		$args
	);

	// The season the board is showing, read off the board itself: the page's
	// title is where this file otherwise learns the year, and a standfirst
	// that can say "2026" should, as the API's own page does.
	$season = preg_match( '/data-scs-season="(\d{4})"/', $html, $m ) ? (int) $m[1] : 0;

	// Above the board, because it is the page's heading rather than the
	// fragment's: on a page whose theme prints no title of its own, this IS the
	// <h1>. Empty on every other site, which is every site whose theme is
	// already printing one.
	return statchasers_schedule_shortcode_heading( $season ) . $html;
}
add_shortcode( STATCHASERS_SCHEDULE_SHORTCODE, 'statchasers_schedule_shortcode' );

/**
 * The <h1> the shortcode prints itself. Off unless the probe says to.
 *
 * The other half of the heading story. Where the theme prints the page title,
 * the `the_title` filter below makes that title week-aware and this prints
 * nothing; where the theme prints no title at all - a Divi full-width layout, a
 * Theme Builder layout with no Post Title module - this supplies the heading
 * and the standfirst in the site's own hero markup, and the week URLs get one
 * each. See statchasers-h1.php for how that question is answered, and why it is
 * answered by measuring a rendered page rather than by guessing at the
 * template.
 *
 * Both halves say the same phrase, from the same two functions, so a site that
 * switches modes does not switch headings.
 */
function statchasers_schedule_shortcode_heading( int $season = 0 ): string {
	// "Let the tool supply the heading" empties the theme's title on every
	// tool page. The hubs and profiles answer with their own promoted section
	// heading; the schedule answers with the site's hero, which is the heading
	// every hand-built page on the site already wears.
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_schedule_shortcode_h1', false ) ) {
		return '';
	}

	return statchasers_page_heading_html(
		statchasers_schedule_heading(),
		statchasers_schedule_lead( $season )
	);
}

/* ----------------------------------------------------- what a week page is */

/**
 * The title a week URL should carry.
 *
 * Built from the page's own title rather than from the season, because the page
 * is where the season is written ("2026 NFL Schedule") and this file has no
 * business knowing the year. Eighteen addresses sharing one title is eighteen
 * pages a search engine has no reason to tell apart, which is the only thing
 * that would make the week URLs worse than the parameter they replaced.
 */
function statchasers_schedule_week_title(): string {
	$week = statchasers_schedule_request_week();
	if ( 0 === $week ) {
		return '';
	}
	return sprintf( '%s: Week %d', statchasers_schedule_page_title(), $week );
}

/**
 * The page's own name, as it is stored.
 *
 * `post_title` rather than `get_the_title()`, and that is not a detail: this
 * file now filters `the_title` to APPEND the week, so a title read through that
 * filter while computing what the filter should return is a title with the week
 * on it already - "2026 NFL Schedule: Week 7: Week 7". Reading the stored
 * string is the version of this that cannot recurse.
 */
function statchasers_schedule_page_title(): string {
	$queried = get_queried_object();
	$page    = $queried instanceof WP_Post ? trim( (string) $queried->post_title ) : '';

	return '' === $page ? 'NFL Schedule' : $page;
}

/** The description for a week URL, or '' when this is not one. */
function statchasers_schedule_week_description(): string {
	$week = statchasers_schedule_request_week();
	return 0 === $week
		? ''
		: sprintf(
			'Every Week %d game of the NFL regular season: matchups, dates, kickoff times, TV networks, the teams on bye, and the market\'s posted spreads and totals.',
			$week
		);
}

/**
 * The heading this request's page should carry.
 *
 * The page's own title on the bare page - the grid is the schedule here, so it
 * needs no qualifier - and that same title with the week appended on a week
 * URL. MIRRORS `scheduleHeading()` in the API's schedule-render.ts, except for
 * the season: the API knows the year because it has the slate, and this side
 * reads it out of the page's title, for the reason given on
 * statchasers_schedule_week_title() above.
 *
 * Never '' - unlike the week title, which returns '' to mean "leave what is
 * there alone". This one is asked for a heading to print, so it always answers
 * with one.
 */
function statchasers_schedule_heading(): string {
	$week = statchasers_schedule_week_title();

	return '' === $week ? statchasers_schedule_page_title() : $week;
}

/**
 * The sentence under that heading.
 *
 * MIRRORS `scheduleLede()` in schedule-render.ts word for word when the
 * season is known - the shortcode reads it off the fragment. Without it, the
 * week case falls back to the description the week URLs already carry.
 */
function statchasers_schedule_lead( int $season = 0 ): string {
	$week = statchasers_schedule_request_week();

	if ( $season > 0 ) {
		return 0 === $week
			? sprintf( 'View the full %d NFL schedule for every team in one board. Compare opponents, home and away games, and bye weeks across the entire regular season.', $season )
			: sprintf( 'Every Week %1$d game of the %2$d NFL regular season: matchups, dates, kickoff times in ET, TV networks, the teams on bye, and the market\'s posted spreads and totals.', $week, $season );
	}

	$week = statchasers_schedule_week_description();

	return '' === $week
		? 'View the full NFL schedule for every team in one board. Compare opponents, home and away games, and bye weeks across the entire regular season.'
		: $week;
}

/** The canonical for a week URL, or '' when this is not one. */
function statchasers_schedule_week_canonical(): string {
	$week = statchasers_schedule_request_week();
	// A week is its own canonical, not a variant of the board: it is a
	// different set of games, which is the whole reason it has an address. The
	// API says the same thing about /schedule/week-7 in routes/schedule.ts.
	return 0 === $week ? '' : statchasers_schedule_week_url( $week );
}

/**
 * Rewrite the page's title on a week URL, which is the theme's H1.
 *
 * Guarded the way every `the_title` filter in this plugin is, and for the
 * reason set out in statchasers-h1.php: `the_title` is called for menu items,
 * admin lists, widgets and archive listings, and renaming the page in any of
 * those renames it everywhere it is mentioned rather than reheading the one it
 * is on. Off a week URL the page keeps its own name.
 *
 * This is the half of the job that needs no configuration: where the theme
 * prints the page title as the H1 - Divi's page.php does - `/week-7/` now says
 * Week 7 at the top of the page as well as in the tab. The other half, for a
 * template that prints no title at all, is
 * statchasers_schedule_shortcode_heading() below.
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

		$own = statchasers_schedule_week_title();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

add_filter( 'rank_math/frontend/title', function ( $title ) {
	$own = statchasers_schedule_week_title();
	return '' === $own ? $title : $own . ' | StatChasers';
} );
add_filter( 'rank_math/frontend/description', function ( $description ) {
	$own = statchasers_schedule_week_description();
	return '' === $own ? $description : $own;
} );
add_filter( 'rank_math/frontend/canonical', function ( $canonical ) {
	$own = statchasers_schedule_week_canonical();
	return '' === $own ? $canonical : $own;
} );
add_filter( 'rank_math/opengraph/url', function ( $url ) {
	$own = statchasers_schedule_week_canonical();
	return '' === $own ? $url : $own;
} );
add_filter( 'document_title_parts', function ( array $parts ): array {
	$own = statchasers_schedule_week_title();
	if ( '' !== $own && isset( $parts['title'] ) ) {
		$parts['title'] = $own;
	}
	return $parts;
} );
add_filter( 'get_canonical_url', function ( $canonical ) {
	$own = statchasers_schedule_week_canonical();
	return '' === $own ? $canonical : $own;
} );

/**
 * The week as the last breadcrumb, at its own address.
 *
 * Rank Math's trail on a week URL ends at the schedule page - the page the
 * rewrite resolves to - so the BreadcrumbList on /nfl/nfl-schedule/week-4/
 * said the page was the season grid, while its title and canonical said Week
 * 4. Same fix as the team and player section crumbs. Scoped exactly as the
 * title and canonical are, through statchasers_schedule_request_week(): only
 * on the page that mounts the schedule and only for a week the season has, so
 * the public query var cannot add a crumb to anything else.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_schedule_breadcrumbs( $crumbs ) {
	$week = statchasers_schedule_request_week();
	if ( ! is_array( $crumbs ) || 0 === $week ) {
		return $crumbs;
	}

	$crumbs[] = array( 'Week ' . $week, statchasers_schedule_week_url( $week ), 'hide_in_schema' => false );

	return $crumbs;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_schedule_breadcrumbs', 20 );

/* ------------------------------------------------------------- faq schema */

/**
 * The attributes the page's own shortcode was written with.
 *
 * The other four tools' FAQ sections fetch with default arguments, because
 * their questions do not vary by attribute - the rankings' five boards are one
 * page, and the position attribute only says which panel opens. This tool is
 * the exception: `view` decides WHICH SET of questions the fragment carries,
 * the weekly board's or the season grid's. Fetching with the defaults here
 * would describe the grid on a page that had mounted the weekly board, and the
 * page's structured data would be about a board nobody can see.
 *
 * So the attributes are read off the post that is about to render, with the
 * shortcode API's own parser rather than a regular expression of our own.
 * `statchasers_schedule_args()` then resolves them exactly as the shortcode
 * will, including the rule that a week URL overrides both the week and the
 * view - which is what makes `/nfl/nfl-schedule/week-7/` get week 7's
 * questions and the bare page get the grid's.
 *
 * The first mount wins. A page with two schedules on it is not a thing that
 * exists, and if it ever were, one FAQPage describing the first is a better
 * answer than two competing nodes.
 *
 * @return array<string,mixed> Raw attributes, or an empty array.
 */
function statchasers_schedule_mounted_atts(): array {
	static $atts = null;

	if ( null !== $atts ) {
		return $atts;
	}

	$atts = array();

	if ( ! statchasers_schedule_post_has_shortcode() ) {
		return $atts;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return $atts;
	}

	$pattern = get_shortcode_regex( array( STATCHASERS_SCHEDULE_SHORTCODE ) );
	if ( ! preg_match( '/' . $pattern . '/s', (string) $post->post_content, $match ) ) {
		return $atts;
	}

	// Group 3 is the attribute string; shortcode_parse_atts() returns '' for a
	// shortcode written with none.
	$parsed = shortcode_parse_atts( isset( $match[3] ) ? $match[3] : '' );
	if ( is_array( $parsed ) ) {
		$atts = $parsed;
	}

	return $atts;
}

/**
 * The questions this request's schedule fragment is carrying.
 *
 * The fetch is the cached one the shortcode is about to hit - same arguments,
 * same transient key - so this costs no second round trip, and the result is
 * memoised because the Rank Math filter and the fallback printer both ask.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_schedule_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$items = array();

	if ( ! statchasers_schedule_post_has_shortcode() ) {
		return $items;
	}

	$data = statchasers_schedule_fetch(
		statchasers_schedule_args( statchasers_schedule_mounted_atts() )
	);

	if ( null === $data || ! isset( $data['html'] ) || '' === $data['html'] ) {
		return $items;
	}

	$items = statchasers_schedule_faq_parse( (string) $data['html'] );

	return $items;
}

/**
 * Pull the Q&A island out of a rendered fragment.
 *
 * Validated rather than trusted, for the reason the other four give: it is our
 * own origin, but this ends up in the page's structured data and a malformed
 * island should drop an entry rather than emit a broken node.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_schedule_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'scs-faq-data' ) ) {
		return $items;
	}

	$found = preg_match_all(
		'#<script type="application/json" class="scs-faq-data">(.*?)</script>#s',
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
function statchasers_schedule_faq_node( string $webpage_id = '' ) {
	$items = statchasers_schedule_faq_items();

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
 * Same posture as the other four: append to the array Rank Math hands us, so
 * what ships is one <script> containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_schedule_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_schedule_faq_node( statchasers_news_schema_page_id( $data ) );

	if ( null === $node ) {
		return $data;
	}

	$data['statchasersScheduleFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_schedule_rank_math_schema', 20 );

/**
 * Fallback FAQPage for sites with no schema-graph plugin.
 *
 * Prints ONLY the FAQPage, for the reason the news fallback gives: with no SEO
 * plugin present, WebPage and Organization are a site-wide decision somebody
 * should make deliberately rather than something this tool improvises.
 */
function statchasers_schedule_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_schedule_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_schedule_print_fallback_schema', 20 );

/**
 * Drop the Q&A island from the markup that is printed.
 *
 * It is a transport for the node above, and once that is built it is a second
 * copy of every answer sitting in the page for nobody. The schema reads from
 * the cached fetch, not from this string, so removing it here costs the node
 * nothing.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_schedule_strip_faq_data( string $html ): string {
	if ( false === strpos( $html, 'scs-faq-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scs-faq-data">.*?</script>#s',
		'',
		$html
	);
}

/* ------------------------------------------------------------- the sitemap */

/**
 * The eighteen week URLs, appended to Rank Math's page sitemap.
 *
 * The board itself is a real page and Rank Math lists it. The week addresses
 * have no post behind them, so they have to be added - and only while the
 * rewrite is live and the page actually exists, or the sitemap would advertise
 * eighteen addresses that 404. Same switch as the rewrite, so the two cannot
 * disagree. Same caveat as the team sections: `{$type}_content` is the
 * documented filter for this and has not been verified against the installed
 * Rank Math build.
 */
add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}

		if ( ! statchasers_schedule_week_urls_enabled() ) {
			return $content;
		}
		$page = get_page_by_path( statchasers_schedule_page_path() );
		if ( ! $page instanceof WP_Post || 'publish' !== $page->post_status ) {
			return $content;
		}
		$extra = '';
		for ( $week = 1; $week <= STATCHASERS_SCHEDULE_WEEKS; $week++ ) {
			$extra .= statchasers_team_sitemap_entry(
				statchasers_schedule_week_url( $week ),
				''
			);
		}
		return $content . $extra;
	}
);

/**
 * Clear cached schedule renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_schedule_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_sched_ssr_', $all );
}
