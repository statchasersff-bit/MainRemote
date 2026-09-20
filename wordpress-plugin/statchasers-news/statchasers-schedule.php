<?php
/**
 * The NFL schedule shortcode: [statchasers_schedule]
 *
 * Same posture as the other five tools. The API serves /schedule with
 * `noindex, indexifembedded`, so the board is invisible to search until
 * something embeds it — this file is that something.
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
 *    the response and uses that — the API already computes it (30s while a game
 *    is being played, 300s otherwise) and it is the side that knows.
 * 2. **There are four attributes, not two.** View, week, team and filter are
 *    the four pieces of state the board has, and a page that mounts
 *    `[statchasers_schedule view="team" team="NE"]` is a genuinely different
 *    page from the weekly board.
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
 * games.csv — the whole of NFL history in one file — before it can answer, and
 * that is a real first request rather than a hypothetical one. Every request
 * after it is served from the process's own cache.
 */
const STATCHASERS_SCHEDULE_TIMEOUT = 12;

/** The views the API understands. Anything else falls back. */
const STATCHASERS_SCHEDULE_VIEWS = array( 'week', 'team', 'matrix' );

/** The game filters. */
const STATCHASERS_SCHEDULE_FILTERS = array( 'all', 'division', 'international' );

/** A regular season is 18 weeks. Mirrors TOTAL_WEEKS in the API. */
const STATCHASERS_SCHEDULE_WEEKS = 18;

/* -------------------------------------------------------------- week URLs */

/**
 * Where the board lives, without its slashes.
 *
 * This is both the page the rewrite rules point at and the base the week URLs
 * hang off, so it MUST match `SC_SCHEDULE_PATH` on the API — that is what the
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
		// for week 2 — it is a second address for it, which is the whole thing
		// the path was moved out of the query string to avoid. Mirrors the
		// strictness of the /schedule/week-:week route in the API.
		add_rewrite_rule(
			'^' . $page . '/week-([1-9][0-9]?)/?$',
			'index.php?pagename=' . $page . '&sc_sched_week=$matches[1]',
			'top'
		);
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
	$raw  = trim( (string) get_query_var( 'sc_sched_week' ) );
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
 * `/nfl/nfl-schedule/week-23/` matches the rewrite — the pattern is the shape,
 * not the truth — and without this it would quietly render whatever week the
 * board opens on, at an address claiming to be week 23. The API answers the
 * same URL with a 404 for the same reason.
 */
add_action(
	'template_redirect',
	static function (): void {
		$raw = trim( (string) get_query_var( 'sc_sched_week' ) );
		if ( '' === $raw || statchasers_schedule_request_week() > 0 ) {
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
 * Note what is NOT validated here: the team. Resolving "ne", "NE", "patriots"
 * and "new-england-patriots" to one canonical team is the API's job and it has
 * the table for it (lib/team/teams.ts); a second copy of that table in PHP is a
 * second copy to keep current every time a franchise moves. An unresolvable
 * team falls through to the API, which renders the weekly board.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{view:string,week:int,team:string,filter:string,season:int}
 */
function statchasers_schedule_args( array $atts ): array {
	$atts = shortcode_atts(
		array(
			'view'   => 'week',
			'week'   => '',
			'team'   => '',
			'filter' => 'all',
			'season' => '',
		),
		$atts,
		STATCHASERS_SCHEDULE_SHORTCODE
	);

	$view = strtolower( trim( (string) $atts['view'] ) );
	if ( ! in_array( $view, STATCHASERS_SCHEDULE_VIEWS, true ) ) {
		$view = 'week';
	}

	$filter = strtolower( trim( (string) $atts['filter'] ) );
	if ( ! in_array( $filter, STATCHASERS_SCHEDULE_FILTERS, true ) ) {
		$filter = 'all';
	}

	// Left at 0, the API picks the week the season is actually on — which is
	// what a page should normally do. A pinned week is a page that still says
	// Week 1 in December.
	$week = (int) $atts['week'];
	if ( $week < 1 || $week > STATCHASERS_SCHEDULE_WEEKS ) {
		$week = 0;
	}

	// A week URL outranks the attribute, because it is an ADDRESS: a page
	// reached at /week-7/ that rendered week 3 would be a wrong answer at a
	// right-looking URL, and the board's own week links all point at addresses
	// now. Where no week URL is in play — any other page mounting the
	// shortcode — the attribute is untouched.
	$from_url = statchasers_schedule_request_week();
	if ( $from_url > 0 ) {
		$week = $from_url;
	}

	$team = strtolower( trim( (string) $atts['team'] ) );
	// Bounded so a pathological attribute cannot be used to mint unbounded
	// cache keys; the API does the real resolution.
	if ( strlen( $team ) > 40 || ! preg_match( '/^[a-z0-9 -]*$/', $team ) ) {
		$team = '';
	}

	// Same reasoning as the FPA table's season attribute.
	$season = (int) $atts['season'];
	if ( $season < 1999 || $season > 2100 ) {
		$season = 0;
	}

	return array(
		'view'   => $view,
		'week'   => $week,
		'team'   => $team,
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
 * @param array{view:string,week:int,team:string,filter:string,season:int} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_schedule_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_sched_ssr_' . $key;
	$backup_key = 'sc_sched_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array(
		'view'   => $args['view'],
		'filter' => $args['filter'],
	);
	if ( $args['week'] > 0 ) {
		$query['week'] = (string) $args['week'];
	}
	if ( '' !== $args['team'] ) {
		$query['team'] = $args['team'];
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
	// "nothing to show" — the last good board is far better than a hole in the
	// page, because a schedule that is a few hours stale is still almost
	// entirely correct.
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
function statchasers_schedule_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_SCHEDULE_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_SCHEDULE_HANDLE,
			$origin . '/schedule.css',
			array(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_SCHEDULE_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_SCHEDULE_HANDLE,
			$origin . '/dist/statchasers-schedule.js',
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
 * Same deliberate omissions as the other five — no canonical, no <h1>, no title
 * or meta description, nothing written to the URL. The page owns all of it, and
 * the board's own week and team controls are ordinary links back to whatever
 * SC_SCHEDULE_PATH names on the API side.
 *
 * The one thing it does read is the week, when the request came in at a week
 * URL: `/nfl/nfl-schedule/week-7/`. That is still the page owning its address —
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

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_schedule_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only relabels
		// kickoffs in markup that is already there. An empty string leaves the
		// rest of the page — the H1, the copy, the internal links — intact.
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
	 * @param array{view:string,week:int,team:string,filter:string,season:int} $args Render arguments.
	 */
	return (string) apply_filters(
		'statchasers_schedule_fragment_html',
		$data['html'],
		$args
	);
}
add_shortcode( STATCHASERS_SCHEDULE_SHORTCODE, 'statchasers_schedule_shortcode' );

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
	$page = trim( (string) get_the_title( get_queried_object_id() ) );
	if ( '' === $page ) {
		$page = 'NFL Schedule';
	}
	return sprintf( '%s: Week %d', $page, $week );
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

/** The canonical for a week URL, or '' when this is not one. */
function statchasers_schedule_week_canonical(): string {
	$week = statchasers_schedule_request_week();
	// A week is its own canonical, not a variant of the board: it is a
	// different set of games, which is the whole reason it has an address. The
	// API says the same thing about /schedule/week-7 in routes/schedule.ts.
	return 0 === $week ? '' : statchasers_schedule_week_url( $week );
}

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

/* ------------------------------------------------------------- the sitemap */

/**
 * The eighteen week URLs, appended to Rank Math's page sitemap.
 *
 * The board itself is a real page and Rank Math lists it. The week addresses
 * have no post behind them, so they have to be added — and only while the
 * rewrite is live and the page actually exists, or the sitemap would advertise
 * eighteen addresses that 404. Same switch as the rewrite, so the two cannot
 * disagree. Same caveat as the team sections: `{$type}_content` is the
 * documented filter for this and has not been verified against the installed
 * Rank Math build.
 */
add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
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
 */
function statchasers_schedule_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_sched_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_sched_ssr_' ) . '%'
		)
	);
}
