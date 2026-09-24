<?php
/**
 * The advanced player stats shortcode: [statchasers_player_stats]
 *
 * Same posture as the other tools. The API serves /player-stats with
 * `noindex, indexifembedded`, so the tables are invisible to search until
 * something embeds them — this file is that something.
 *
 * ## What this replaces
 *
 * The tool shipped as a standalone Vite app in its own repository
 * (statchasersff-bit/NFL-Advanced-Player-Stats) and its own plugin,
 * `statchasers-analytics`, which mounted it at /nfl/nfl-player-stats/ as an
 * IFRAME with the shortcode [statchasers_analytics]. So the page's own HTML
 * was an empty frame: not one player or number on it was ever read by a
 * crawler, and the page had to message its parent to keep the address bar in
 * step with the position the frame was showing.
 *
 * Here the API renders the table and this shortcode prints it into the page,
 * like the other tools. Every player in the open table is in the HTML.
 *
 * Migrating: on the /nfl/nfl-player-stats/ page, replace [statchasers_analytics]
 * with [statchasers_player_stats]; deactivate and delete the statchasers-analytics
 * plugin; and remove the "StatChasers – route deep-link sub-paths" block it
 * wrote into .htaccess. The tags do not collide, so the two can coexist while
 * the swap is made.
 *
 * ## Addresses
 *
 * Each position is its own address, as it was in the standalone app:
 * /nfl/nfl-player-stats/ is the quarterback table, and /rb/, /wr/ and /te/
 * beneath it are the other three — a rewrite rule below puts the position in a
 * query var, and each of those addresses carries its own title, description
 * and canonical. /qb/ is the bare page, and 301s there, because one table has
 * one address; the standalone app's links to /qb land where they should.
 *
 * The season is not an address. It is a control: the bundle swaps seasons in
 * place, and with scripting off the season links carry `?season=`, which
 * {@see statchasers_player_stats_args()} reads.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_PLAYER_STATS_SHORTCODE = 'statchasers_player_stats';
const STATCHASERS_PLAYER_STATS_HANDLE    = 'statchasers-player-stats';

/**
 * How long a rendered fragment is reused before we ask the API again.
 *
 * An hour, like the rankings board, for the same reason: these are finished
 * seasons, and the tables move when somebody commits a new data file, not on
 * their own. `statchasers_news_flush()` clears this.
 */
const STATCHASERS_PLAYER_STATS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_PLAYER_STATS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * A little longer than the rankings' 6: the widest table is three seasons of
 * receivers, 319 rows by fifty columns, and the first request after a deploy
 * renders it cold.
 */
const STATCHASERS_PLAYER_STATS_TIMEOUT = 8;

/** The positions the API renders. The first is the bare page's. */
const STATCHASERS_PLAYER_STATS_POSITIONS = array( 'qb', 'rb', 'wr', 'te' );

/** Position names, for the titles the position addresses carry. */
const STATCHASERS_PLAYER_STATS_NAMES = array(
	'qb' => 'Quarterback',
	'rb' => 'Running Back',
	'wr' => 'Wide Receiver',
	'te' => 'Tight End',
);

/* ---------------------------------------------------------- position URLs */

/**
 * The page the shortcode lives on, without slashes.
 *
 * The address the standalone app was mounted at, and the one the team hubs
 * already link to. A site that mounts the shortcode somewhere else changes
 * this — and SC_PLAYER_STATS_PATH on the API, which is where the table's own
 * position links point.
 */
function statchasers_player_stats_page_path(): string {
	$path = (string) apply_filters( 'statchasers_player_stats_page_path', 'nfl/nfl-player-stats' );
	return trim( $path, '/' );
}

/** A position's public address. The quarterbacks are the bare page. */
function statchasers_player_stats_position_url( string $pos ): string {
	$page = statchasers_player_stats_page_path();
	return user_trailingslashit(
		home_url( '/' . $page . ( 'qb' === $pos ? '' : '/' . $pos ) )
	);
}

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'sc_stats_pos';
		return $vars;
	}
);

/**
 * The regex the position rule is registered under. Named once because the
 * self-check below looks it up in the stored rule table.
 */
function statchasers_player_stats_rule(): string {
	return '^' . preg_quote( statchasers_player_stats_page_path(), '#' ) . '/(qb|rb|wr|te)/?$';
}

add_action(
	'init',
	static function (): void {
		$page = statchasers_player_stats_page_path();
		if ( '' === $page ) {
			return;
		}
		// Lower case only. `/RB/` is not a slow way of asking for `/rb/`, it is
		// a second address for it, and WordPress's own 404 answers it.
		add_rewrite_rule(
			statchasers_player_stats_rule(),
			'index.php?pagename=' . $page . '&sc_stats_pos=$matches[1]',
			'top'
		);
	}
);

/**
 * Make sure the rule is actually in the stored table.
 *
 * A rewrite rule does nothing until the rules are flushed, and this plugin is
 * updated by uploading a zip, which does not reliably run the activation hook
 * that asks for a flush. Without this, the position addresses would 404 on
 * every site that updated rather than installed. Runs last on `init`, once
 * every file's rules are registered, and at most once an hour — a site whose
 * table cannot be written does not flush on every request.
 */
add_action(
	'init',
	static function (): void {
		if ( '' === statchasers_player_stats_page_path() ) {
			return;
		}
		$rules = get_option( 'rewrite_rules' );
		if ( ! is_array( $rules ) || isset( $rules[ statchasers_player_stats_rule() ] ) ) {
			return;
		}
		if ( get_transient( 'sc_stats_rules_flushed' ) ) {
			return;
		}
		set_transient( 'sc_stats_rules_flushed', 1, HOUR_IN_SECONDS );
		flush_rewrite_rules( false );
	},
	PHP_INT_MAX
);

/**
 * The position this request's ADDRESS names: 'rb', 'wr', 'te', or ''.
 *
 * '' for the bare page, which is the quarterbacks; 'qb' never comes back from
 * here, because /qb/ is redirected before anything renders.
 */
function statchasers_player_stats_request_position(): string {
	// Only on the page that mounts the table. The query var is public, so
	// without this `?sc_stats_pos=rb` on any article retitled it and pointed
	// its canonical at /nfl/nfl-player-stats/rb/.
	if ( ! statchasers_player_stats_post_has_shortcode() ) {
		return '';
	}
	$raw = strtolower( trim( (string) get_query_var( 'sc_stats_pos' ) ) );
	return in_array( $raw, array( 'rb', 'wr', 'te' ), true ) ? $raw : '';
}

/**
 * /qb/ is the bare page. A 301, with the query string kept, so a link to
 * `/qb/?season=2024` lands on the 2024 table.
 */
add_action(
	'template_redirect',
	static function (): void {
		if ( 'qb' !== strtolower( trim( (string) get_query_var( 'sc_stats_pos' ) ) ) ) {
			return;
		}
		// `?sc_stats_pos=qb` on any other page is not /qb/.
		if ( ! statchasers_player_stats_post_has_shortcode() ) {
			return;
		}
		$target = statchasers_player_stats_position_url( 'qb' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- only the query string is reused.
		$query = isset( $_SERVER['QUERY_STRING'] ) ? (string) wp_unslash( $_SERVER['QUERY_STRING'] ) : '';
		if ( '' !== $query ) {
			$target .= '?' . $query;
		}
		wp_safe_redirect( $target, 301 );
		exit;
	}
);

/* ------------------------------------------------------------- the fetch */

/**
 * The season the reader asked for with scripting off: `?season=2024` or
 * `?season=all`. Validated for shape only — the API knows which seasons it
 * has and falls back to the newest for anything else.
 */
function statchasers_player_stats_query_season(): string {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
	if ( ! isset( $_GET['season'] ) ) {
		return '';
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
	$value = strtolower( trim( sanitize_text_field( wp_unslash( $_GET['season'] ) ) ) );
	return ( 'all' === $value || 1 === preg_match( '/^\d{4}$/', $value ) ) ? $value : '';
}

/**
 * Normalise the shortcode attributes.
 *
 * The position: the address first, because it IS the address — a page reached
 * at /rb/ that rendered quarterbacks would be a wrong answer at a
 * right-looking URL — then the attribute, then quarterbacks. The season: the
 * attribute first, because a page that writes season="2024" has decided what
 * it shows, then the query string, then the API's newest.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{pos:string,season:string}
 */
function statchasers_player_stats_args( array $atts ): array {
	$given = $atts;
	$atts  = shortcode_atts(
		array(
			'pos'    => 'qb',
			'season' => '',
		),
		$atts,
		STATCHASERS_PLAYER_STATS_SHORTCODE
	);

	$pos = strtolower( trim( (string) $atts['pos'] ) );
	if ( ! in_array( $pos, STATCHASERS_PLAYER_STATS_POSITIONS, true ) ) {
		$pos = 'qb';
	}
	$from_url = statchasers_player_stats_request_position();
	if ( '' !== $from_url ) {
		$pos = $from_url;
	}

	$season = strtolower( trim( (string) $atts['season'] ) );
	if ( ! isset( $given['season'] ) || ( 'all' !== $season && 1 !== preg_match( '/^\d{4}$/', $season ) ) ) {
		$season = statchasers_player_stats_query_season();
	}

	return array(
		'pos'    => $pos,
		'season' => $season,
	);
}

/**
 * Fetch the server-rendered fragment, cached.
 *
 * @param array{pos:string,season:string} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_player_stats_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_stats_ssr_' . $key;
	$backup_key = 'sc_stats_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array( 'pos' => $args['pos'] );
	if ( '' !== $args['season'] ) {
		$query['season'] = $args['season'];
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/player-stats' ),
		array(
			'timeout' => STATCHASERS_PLAYER_STATS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the API has no table for this position and season — a real
	// state, not a transient error. Cached as a failure for a minute so a
	// deployment mid-setup costs one request a minute.
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

	set_transient( $cache_key, $payload, STATCHASERS_PLAYER_STATS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_PLAYER_STATS_BACKUP_TTL );

	return $payload;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the table's compiled bundles. Its own handles, like
 * the other tools: a page mounting this shortcode should not download
 * another tool's stylesheet.
 */
function statchasers_player_stats_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_PLAYER_STATS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_PLAYER_STATS_HANDLE,
			$origin . '/player-stats.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_PLAYER_STATS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_PLAYER_STATS_HANDLE,
			$origin . '/dist/statchasers-player-stats.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_PLAYER_STATS_HANDLE );
	wp_enqueue_script( STATCHASERS_PLAYER_STATS_HANDLE );

	if ( statchasers_player_stats_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_PLAYER_STATS_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not: the table's two header
	// rows are sticky, and a phone should not read it through Divi's 10%
	// margins. See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_PLAYER_STATS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_PLAYER_STATS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the table?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoised for the same reason too.
 */
function statchasers_player_stats_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_PLAYER_STATS_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_player_stats_post_has_shortcode() ) {
			return;
		}
		statchasers_player_stats_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column? More than any other tool: the
 * table is fifty columns wide, and every pixel of the sidebar Divi reserves is
 * a column scrolled off the right.
 */
function statchasers_player_stats_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_player_stats_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the advanced stats table takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_player_stats_full_width', true );
}

/**
 * Remove the sidebar markup on a stats page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_player_stats_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_player_stats_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_player_stats_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_player_stats_full_width_body_class( array $classes ): array {
	if ( ! statchasers_player_stats_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_player_stats_full_width_body_class', PHP_INT_MAX );

/* ------------------------------------------------------------ the shortcode */

/**
 * The shortcode: prints the server-rendered table into the page.
 *
 * Same deliberate omissions as the other tools — no canonical, no <h1>, no
 * title or meta description, nothing written to the URL. The page owns all of
 * it; the position addresses get theirs from the filters below.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_player_stats_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player Stats:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_player_stats_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_player_stats_fetch( $args );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_player_stats_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Player Stats:</strong> the API returned nothing. Check that the deployment is up and that it carries <code>data/player-stats/</code>.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered advanced stats fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html   Rendered fragment.
	 * @param string $pos    The position rendered.
	 * @param string $season The season requested, or '' for the newest.
	 */
	return statchasers_player_stats_shortcode_heading() . (string) apply_filters(
		'statchasers_player_stats_fragment_html',
		statchasers_player_stats_strip_islands( (string) $data['html'] ),
		$args['pos'],
		$args['season']
	);
}
add_shortcode( STATCHASERS_PLAYER_STATS_SHORTCODE, 'statchasers_player_stats_shortcode' );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoised: what the titles, the H1 and
 * the FAQ schema below are read from. The same arguments the shortcode passes,
 * so it is the same cached transient and costs no second request.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_player_stats_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$data = statchasers_player_stats_post_has_shortcode()
		? statchasers_player_stats_fetch( statchasers_player_stats_args( array() ) )
		: null;

	return $data;
}

/**
 * The address's title, H1 and description, as the API wrote them.
 *
 * The fragment carries them in an inert island (renderMetaIsland() in the
 * API's player-stats-render.ts), so the words live in one place —
 * stats-copy.ts — and the season in them is the one the API is serving. This
 * plugin used to keep its own copy of the position titles, less the season,
 * because it had no way to know which season that was.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_player_stats_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_player_stats_request_data();
	$copy = statchasers_player_stats_parse_copy( null === $data ? '' : (string) $data['html'] );

	return $copy;
}

/**
 * The title/H1/description island out of a rendered fragment.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_player_stats_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="sca-page-data">(.*?)</script>#s', $html, $m ) ) {
		return $copy;
	}

	$decoded = json_decode( $m[1], true );
	if ( ! is_array( $decoded ) ) {
		return $copy;
	}

	foreach ( array( 'title', 'h1', 'description' ) as $key ) {
		if ( isset( $decoded[ $key ] ) && is_string( $decoded[ $key ] ) ) {
			$value = trim( wp_strip_all_tags( $decoded[ $key ] ) );
			if ( '' !== $value ) {
				$copy[ $key ] = $value;
			}
		}
	}

	return $copy;
}

/**
 * The document title of this address, or '' to leave the page's own.
 *
 * Every address, the bare page included: it is "<season> NFL Player Stats &
 * Fantasy Football Stats" now, the master page of the SEO brief, rather than
 * whatever its editor titled it. With no island (an API older than the brief)
 * the position addresses fall back to the old wording and the bare page keeps
 * its editor's title.
 */
function statchasers_player_stats_title(): string {
	$copy = statchasers_player_stats_page_copy();
	if ( isset( $copy['title'] ) ) {
		return $copy['title'];
	}
	$pos = statchasers_player_stats_request_position();
	return '' === $pos
		? ''
		: sprintf( 'NFL %s Stats & Fantasy Football Stats', STATCHASERS_PLAYER_STATS_NAMES[ $pos ] );
}

/**
 * The heading the shortcode prints itself, in the site's own hero markup.
 *
 * The schedule's arrangement, for the same reason: "Let the tool supply the
 * heading" empties the theme's title on every tool page, and a tool that
 * answers with nothing leaves the page with no H1. No standfirst: the table's
 * own intro is the paragraph directly beneath. Off in every other mode unless
 * the probe or a filter says to print.
 */
function statchasers_player_stats_shortcode_heading(): string {
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_player_stats_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	return statchasers_page_heading_html( statchasers_player_stats_h1() );
}

/** The page's H1, or '' to leave the theme's. */
function statchasers_player_stats_h1(): string {
	$copy = statchasers_player_stats_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : statchasers_player_stats_title();
}

/** The meta description of this address, or '' to leave the page's own. */
function statchasers_player_stats_description(): string {
	$copy = statchasers_player_stats_page_copy();
	return isset( $copy['description'] ) ? $copy['description'] : '';
}

/**
 * The canonical of a position address, or ''. A position is its own
 * canonical, not a variant of the page: it is a different table of different
 * players, which is the whole reason it has an address.
 */
function statchasers_player_stats_canonical(): string {
	$pos = statchasers_player_stats_request_position();
	return '' === $pos ? '' : statchasers_player_stats_position_url( $pos );
}

/**
 * Rewrite the page's title, which is the theme's H1.
 *
 * Guarded the way every `the_title` filter in this plugin is: `the_title` is
 * called for menu items, admin lists and widgets, and renaming the page in any
 * of those renames it everywhere it is mentioned rather than reheading the one
 * it is on.
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

		$own = statchasers_player_stats_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_player_stats_title();
		return '' === $own ? $title : $own . ' | StatChasers';
	}
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_player_stats_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_player_stats_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_player_stats_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'document_title_parts',
	static function ( array $parts ): array {
		$own = statchasers_player_stats_title();
		if ( '' !== $own && isset( $parts['title'] ) ) {
			$parts['title'] = $own;
		}
		return $parts;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_player_stats_canonical();
		return '' === $own ? $canonical : $own;
	}
);

/* ------------------------------------------------------------------- faq */

/**
 * The FAQ the fragment prints, as questions and answers.
 *
 * The fragment carries them in an inert island beside the visible questions,
 * as the FPA and rankings fragments do, so this reads the array they were
 * built from rather than un-escaping rendered prose. Validated rather than
 * trusted, for the reason statchasers_fpa_faq_parse() gives.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_player_stats_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$data  = statchasers_player_stats_request_data();
	$items = statchasers_player_stats_parse_faq( null === $data ? '' : (string) $data['html'] );

	return $items;
}

/**
 * The Q&A island out of a rendered fragment.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_player_stats_parse_faq( string $html ): array {
	$items = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="sca-faq-data">(.*?)</script>#s', $html, $m ) ) {
		return $items;
	}

	$decoded = json_decode( $m[1], true );
	if ( ! is_array( $decoded ) ) {
		return $items;
	}

	foreach ( $decoded as $entry ) {
		if ( ! is_array( $entry ) || ! isset( $entry['q'], $entry['a'] ) || ! is_string( $entry['q'] ) || ! is_string( $entry['a'] ) ) {
			continue;
		}
		$question = trim( wp_strip_all_tags( $entry['q'] ) );
		$answer   = trim( wp_strip_all_tags( $entry['a'] ) );
		if ( '' !== $question && '' !== $answer ) {
			$items[] = array(
				'q' => $question,
				'a' => $answer,
			);
		}
	}

	return $items;
}

/**
 * One FAQPage node, or null when the page has no questions.
 *
 * @param string $webpage_id The graph's page node, or '' when there is none.
 * @return array<string,mixed>|null
 */
function statchasers_player_stats_faq_node( string $webpage_id = '' ) {
	$items = statchasers_player_stats_faq_items();

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
 * Append the FAQPage to Rank Math's graph, so what ships is one <script>
 * holding one graph — the posture of every other tool here.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_player_stats_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_player_stats_faq_node( statchasers_news_schema_page_id( $data ) );
	if ( null !== $node ) {
		$data['statchasersPlayerStatsFaq'] = $node;
	}

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_player_stats_rank_math_schema', 20 );

/** Fallback FAQPage for a site with no schema-graph plugin. */
function statchasers_player_stats_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_player_stats_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_player_stats_print_fallback_schema', 20 );

/**
 * Drop the islands from the printed markup. They are transport for the title
 * filters and the schema above, which read the cached fetch rather than this
 * string, so removing them costs those nothing.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_player_stats_strip_islands( string $html ): string {
	if ( false === strpos( $html, 'sca-faq-data' ) && false === strpos( $html, 'sca-page-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="sca-(?:faq|page)-data">.*?</script>#s',
		'',
		$html
	);
}

/* ------------------------------------------------------------- the sitemap */

/**
 * The three position URLs, appended to Rank Math's page sitemap.
 *
 * The page itself is a real post and Rank Math lists it. The position
 * addresses have no post behind them, so they have to be added — and only
 * while the page actually exists. Same caveat as the schedule's week URLs:
 * `{$type}_content` is the documented filter and has not been verified against
 * the installed Rank Math build.
 */
add_filter(
	'rank_math/sitemap/page_content',
	static function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}

		$page = get_page_by_path( statchasers_player_stats_page_path() );
		if ( ! $page instanceof WP_Post || 'publish' !== $page->post_status ) {
			return $content;
		}
		if ( ! has_shortcode( (string) $page->post_content, STATCHASERS_PLAYER_STATS_SHORTCODE ) ) {
			return $content;
		}
		$extra = '';
		foreach ( array( 'rb', 'wr', 'te' ) as $pos ) {
			$extra .= statchasers_team_sitemap_entry( statchasers_player_stats_position_url( $pos ), '' );
		}
		return $content . $extra;
	}
);

/**
 * Clear cached renders. Called by statchasers_news_flush().
 */
function statchasers_player_stats_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_stats_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_stats_ssr_' ) . '%'
		)
	);
}
