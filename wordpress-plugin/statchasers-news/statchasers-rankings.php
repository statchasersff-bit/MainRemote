<?php
/**
 * The rankings shortcodes: [statchasers_rankings] (the redraft board) and
 * [statchasers_ros_rankings] (the rest-of-season board).
 *
 * Two boards, each from its own file on the API, each on its own page:
 * /fantasy-football/redraft-rankings/ and /fantasy-football/rest-of-season-rankings/.
 *
 * Same posture as the team hub, the player pages and the FPA table. The API
 * serves both boards with `noindex, indexifembedded`, so they are invisible
 * to search until something embeds them — this file is that something.
 *
 * ## What this replaces
 *
 * The rankings shipped as a standalone Vite app in its own repository
 * (statchasersff-bit/Redraft-Rankings-table), mounted here through a
 * prerender-and-hydrate arrangement: a build step rendered the board to HTML,
 * WordPress served that, and a React bundle hydrated it in the browser. That is
 * strictly better than an iframe and still has two problems this file does not.
 *
 * First, the board was only as fresh as the last BUILD. Updating a ranking
 * meant re-running the prerender and redeploying the app, because the HTML
 * WordPress served was a build artefact. Here the rankings are a CSV the API
 * reads per request, cached on its mtime — publishing a new one is a commit,
 * and the shortcode picks it up within the TTL below.
 *
 * Second, only the fifty rows of the All board and the ACTIVE position panel
 * were ever in the markup; the rest lived in React state. The four boards
 * nobody had clicked were, to a crawler, not on the page. The server now
 * renders all five.
 *
 * Migrating: put `[statchasers_rankings]` on the page and remove the old app's
 * mount (its shortcode, block, or the container div its bundle looked for),
 * then stop deploying that app. Nothing here collides with it — the tag is new,
 * because the old one was not a WordPress shortcode to begin with.
 *
 * ## What differs from the other shortcodes
 *
 * There is no slug and no scoring attribute. One set of boards, one page, and
 * the rankings are published in PPR only — so the single piece of state worth
 * an attribute is which position panel opens first, for a page that wants to be
 * about running backs.
 *
 * ## Position URLs (rest-of-season board only)
 *
 * Each position has an address under the rest-of-season page:
 * `/fantasy-football/rest-of-season-rankings/rb/` and so on. One page serves
 * all five — a rewrite rule points the position URL at the page and sets a
 * query var the shortcode reads — and each gets its own title, description and
 * canonical. The API builds the tabs from its default of that page's path
 * (SC_ROS_RANKINGS_PATH overrides it), so the two have to name the same page
 * as statchasers_rankings_page_path(). The redraft board's tabs are in-page
 * anchors, as they always were, and it has no position URLs.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_RANKINGS_SHORTCODE = 'statchasers_rankings';

/**
 * The rest-of-season board: [statchasers_ros_rankings].
 *
 * Two boards, two pages, one implementation. [statchasers_rankings] is the
 * redraft board, the preseason rankings at /fantasy-football/redraft-rankings/,
 * and prints exactly what it printed before the rest-of-season board existed:
 * one address, in-page tabs, the page's own title and heading. This tag is the
 * rest-of-season board, from its own file on the API, and everything in this
 * file about position URLs, headings and the sitemap applies to it alone.
 */
const STATCHASERS_ROS_RANKINGS_SHORTCODE = 'statchasers_ros_rankings';
const STATCHASERS_RANKINGS_HANDLE    = 'statchasers-rankings';

/**
 * How long a rendered fragment is reused before we ask the API again.
 *
 * An hour, the longest of the four. The other tools are reading something that
 * moves on its own — news by the minute, FPA by the week. A rankings file moves
 * when somebody publishes one, which is a handful of times a season, so a
 * shorter TTL would buy nothing but round trips. `statchasers_news_flush()`
 * clears this, which is the path an editor who has just published takes.
 */
const STATCHASERS_RANKINGS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_RANKINGS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * Generous for what this is — a parse of a 14 kB CSV and 230 rows of string
 * building, both of which are cached server-side on the file's mtime. The only
 * request that does real work is the first one after a deploy.
 */
const STATCHASERS_RANKINGS_TIMEOUT = 6;

/** The panels the API will open on. Anything else falls back to the board. */
const STATCHASERS_RANKINGS_POSITIONS = array( 'all', 'qb', 'rb', 'wr', 'te' );

/**
 * Normalise the shortcode attributes.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @param string              $board 'redraft', 'ros', or '' for the page's.
 * @return array{pos:string,season:int,board:string}
 */
function statchasers_rankings_args( array $atts, string $board = '' ): array {
	// Which board: the tag says so when the shortcode is rendering; otherwise
	// (titles, schema) it is the board the page mounts.
	if ( 'ros' !== $board && 'redraft' !== $board ) {
		$board = statchasers_rankings_page_is_ros() ? 'ros' : 'redraft';
	}

	$atts = shortcode_atts(
		array(
			'pos'    => 'all',
			'season' => '',
		),
		$atts,
		STATCHASERS_RANKINGS_SHORTCODE
	);

	$pos = strtolower( trim( (string) $atts['pos'] ) );
	if ( ! in_array( $pos, STATCHASERS_RANKINGS_POSITIONS, true ) ) {
		$pos = 'all';
	}

	// The address outranks the attribute, the way a week URL outranks the
	// schedule's: /rb/ is a page about running backs whatever the shortcode
	// on it was written to open.
	$from_url = 'ros' === $board ? statchasers_rankings_request_pos() : '';
	if ( '' !== $from_url ) {
		$pos = $from_url;
	}

	// A season is honoured only when it is plausibly one. Left at 0 the API
	// serves the newest board it has, which is what a page should normally do —
	// a hard-coded season is a page that silently shows last year's rankings
	// next August.
	$season = (int) $atts['season'];
	if ( $season < 1999 || $season > 2100 ) {
		$season = 0;
	}

	return array(
		'pos'    => $pos,
		'season' => $season,
		'board'  => $board,
	);
}

/* ---------------------------------------------------------- position URLs */

/**
 * The page the board lives at, with no leading or trailing slash.
 *
 *     add_filter( 'statchasers_rankings_page_path', fn() => 'rankings' );
 *
 * Must name the same page as SC_ROS_RANKINGS_PATH on the API (default: this page), which is what the
 * tabs are built from.
 */
function statchasers_rankings_page_path(): string {
	$path = (string) apply_filters(
		'statchasers_rankings_page_path',
		'fantasy-football/rest-of-season-rankings'
	);
	return trim( $path, '/' );
}

/**
 * Whether the per-position addresses are live. On by default.
 *
 *     add_filter( 'statchasers_rankings_position_urls', '__return_false' );
 *
 * Off, the page is one address again and the tabs' links 404 — so turn it off
 * together with SC_ROS_RANKINGS_PATH, not on its own.
 */
function statchasers_rankings_position_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_rankings_position_urls', true );
}

/**
 * Where the page used to live, with no leading or trailing slash.
 *
 * WordPress keeps old slugs for posts, not for pages, so a renamed page's old
 * address is a 404 unless something answers it. This does, with a 301 — and
 * only once WordPress has found nothing there, so the redirect cannot shadow a
 * page that still exists. Return '' to switch it off.
 */
function statchasers_rankings_legacy_path(): string {
	$path = (string) apply_filters(
		'statchasers_rankings_legacy_path',
		// Off: the redraft page stays at its address, with its own board, so
		// there is nothing there to redirect. Kept as a filter for the day it
		// is retired.
		''
	);
	return trim( $path, '/' );
}

/** A position's public address: /fantasy-football/rest-of-season-rankings/rb/. */
function statchasers_rankings_position_url( string $pos ): string {
	$path = '/' . statchasers_rankings_page_path();
	if ( 'all' !== $pos ) {
		$path .= '/' . $pos;
	}
	return user_trailingslashit( home_url( $path ) );
}

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'sc_rank_pos';
		return $vars;
	}
);

add_action(
	'init',
	static function (): void {
		if ( ! statchasers_rankings_position_urls_enabled() ) {
			return;
		}
		$page = statchasers_rankings_page_path();
		if ( '' === $page ) {
			return;
		}
		// Lower case and no `all`: the All board is the page itself. Mirrors
		// the /rest-of-season-rankings/:pos route in the API, which redirects
		// the other spellings rather than serving them.
		add_rewrite_rule(
			'^' . preg_quote( $page, '#' ) . '/(qb|rb|wr|te)/?$',
			'index.php?pagename=' . $page . '&sc_rank_pos=$matches[1]',
			'top'
		);

		// A new rule is dead until the rule table is rebuilt, and an upgrade
		// does not run the activation hook that asks for that. So the rule's
		// own signature is remembered, and a change to it — a first install of
		// this version, or a filtered page path — asks for the flush that
		// statchasers-news.php performs at the end of this same `init`.
		$signature = md5( $page );
		if ( get_option( 'statchasers_rankings_rules' ) !== $signature ) {
			update_option( 'statchasers_rankings_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/**
 * The position this request's address names, or '' on the page itself.
 *
 * Not memoised, unlike the schedule's week: it is one array lookup, and a
 * static here is a value no test can change within a process.
 */
function statchasers_rankings_request_pos(): string {
	// Only on the page that mounts the rest-of-season board. The query var is
	// public, so without this `?sc_rank_pos=rb` on any article on the site
	// retitled it and pointed its canonical at the running back board.
	if ( ! statchasers_rankings_page_is_ros() ) {
		return '';
	}
	$raw = strtolower( trim( (string) get_query_var( 'sc_rank_pos' ) ) );
	return in_array( $raw, array( 'qb', 'rb', 'wr', 'te' ), true ) ? $raw : '';
}

/**
 * The old address, answered with a 301 to the new one.
 *
 * `/fantasy-football/redraft-rankings/` and anything the old page had beneath
 * it that now means something — `/redraft-rankings/rb/` never existed, but
 * costs nothing to send to the right board.
 */
add_action(
	'template_redirect',
	static function (): void {
		if ( ! is_404() ) {
			return;
		}
		$legacy = statchasers_rankings_legacy_path();
		if ( '' === $legacy ) {
			return;
		}
		$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
		if ( ! preg_match( '#^' . preg_quote( $legacy, '#' ) . '(?:/(qb|rb|wr|te))?$#i', $path, $match ) ) {
			return;
		}
		$pos = strtolower( $match[1] ?? '' );
		// The old board kept its position in the query string.
		// phpcs:ignore WordPress.Security.NonceVerification -- a read-only redirect.
		$from_query = strtolower( sanitize_key( (string) ( $_GET['pos'] ?? '' ) ) );
		if ( '' === $pos && in_array( $from_query, array( 'qb', 'rb', 'wr', 'te' ), true ) ) {
			$pos = $from_query;
		}
		wp_safe_redirect( statchasers_rankings_position_url( '' === $pos ? 'all' : $pos ), 301 );
		exit;
	},
	// Before core's redirect_canonical (10), whose 404 guesser would otherwise
	// send /redraft-rankings/ to any post whose slug merely starts with it —
	// "redraft-rankings-2025", on a fantasy site, is not a far-fetched slug.
	1
);

/**
 * The board's title, H1 and description, as the API wrote them.
 *
 * The fragment carries them in an inert `scr-page-data` island
 * (renderMetaIsland() in the API's rankings-render.ts), so the words — and the
 * season in them — live in one place, rankings-seo.ts, the way the player
 * stats page's do. Read from the same cached fetch the shortcode prints, so it
 * costs no second request. Empty on any page that does not mount the board,
 * and against an API older than the island, where the functions below fall
 * back to the page's own title plus the board's name.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_rankings_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	// The rest-of-season board only: the redraft page keeps the title, H1
	// and description its editor gave it.
	$copy = array();
	if ( ! statchasers_rankings_page_is_ros() ) {
		return $copy;
	}

	$data = statchasers_rankings_fetch( statchasers_rankings_args( array() ) );
	$copy = statchasers_rankings_parse_copy( null === $data ? '' : (string) $data['html'] );

	return $copy;
}

/**
 * The title/H1/description island out of a rendered fragment.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_rankings_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="scr-page-data">(.*?)</script>#s', $html, $m ) ) {
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
 * The page's H1, or '' to leave the theme's.
 *
 * Follows the board, as the title does: on /rb/ the heading names the running
 * back rankings. Without it the address, the title and the tab all said
 * running backs while the heading at the top of the page still named the whole
 * board. The bundle swaps it again when a tab switches boards in place.
 */
function statchasers_rankings_h1(): string {
	$copy = statchasers_rankings_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : statchasers_rankings_position_title();
}

/**
 * Rewrite the page's title, which is the theme's H1.
 *
 * Guarded the way every `the_title` filter in this plugin is: it is called for
 * menu items, admin lists and widgets, and renaming the page in any of those
 * renames it everywhere it is mentioned.
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

		$own = statchasers_rankings_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

/**
 * The heading the shortcode prints itself, in the site's own hero markup.
 *
 * The schedule's arrangement (statchasers_schedule_shortcode_heading()), for
 * the same reason: "Let the tool supply the heading" empties the theme's title
 * on every tool page, and a tool that answers with nothing leaves the page with
 * no H1. Off in every other mode unless the probe or a filter says to print.
 */
function statchasers_rankings_shortcode_heading(): string {
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_rankings_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	return statchasers_page_heading_html( statchasers_rankings_h1() );
}

/** Plural board names, for titles. */
const STATCHASERS_RANKINGS_POSITION_NAMES = array(
	'qb' => 'Quarterbacks',
	'rb' => 'Running Backs',
	'wr' => 'Wide Receivers',
	'te' => 'Tight Ends',
);

/**
 * The title on a position URL, or '' when this is not one.
 *
 * The page's stored name — `post_title`, not `get_the_title()`, for the
 * recursion reason statchasers_schedule_page_title() gives — plus the board.
 */
function statchasers_rankings_position_title(): string {
	$copy = statchasers_rankings_page_copy();
	if ( isset( $copy['title'] ) ) {
		return $copy['title'];
	}
	$pos = statchasers_rankings_request_pos();
	if ( '' === $pos ) {
		return '';
	}
	$queried = get_queried_object();
	$page    = $queried instanceof WP_Post ? trim( (string) $queried->post_title ) : '';
	if ( '' === $page ) {
		$page = 'Rest of Season Rankings';
	}
	return sprintf( '%s: %s', $page, STATCHASERS_RANKINGS_POSITION_NAMES[ $pos ] );
}

/** The description on a position URL, or '' when this is not one. */
function statchasers_rankings_position_description(): string {
	$copy = statchasers_rankings_page_copy();
	if ( isset( $copy['description'] ) ) {
		return $copy['description'];
	}
	$pos = statchasers_rankings_request_pos();
	if ( '' === $pos ) {
		return '';
	}
	return sprintf(
		'Rest-of-season fantasy football %s rankings for PPR leagues: every ranked %s by tier, with the other positions a tab away.',
		strtoupper( $pos ),
		strtolower( rtrim( STATCHASERS_RANKINGS_POSITION_NAMES[ $pos ], 's' ) )
	);
}

/**
 * The canonical on a position URL, or '' when this is not one.
 *
 * A board is its own canonical, not a variant of the page: it is the page
 * someone asking for RB rankings should land on. The API says the same about
 * /rest-of-season-rankings/rb.
 */
function statchasers_rankings_position_canonical(): string {
	$pos = statchasers_rankings_request_pos();
	return '' === $pos ? '' : statchasers_rankings_position_url( $pos );
}

add_filter( 'rank_math/frontend/title', function ( $title ) {
	$own = statchasers_rankings_position_title();
	return '' === $own ? $title : $own . ' | StatChasers';
} );
add_filter( 'rank_math/frontend/description', function ( $description ) {
	$own = statchasers_rankings_position_description();
	return '' === $own ? $description : $own;
} );
add_filter( 'rank_math/frontend/canonical', function ( $canonical ) {
	$own = statchasers_rankings_position_canonical();
	return '' === $own ? $canonical : $own;
} );
add_filter( 'rank_math/opengraph/url', function ( $url ) {
	$own = statchasers_rankings_position_canonical();
	return '' === $own ? $url : $own;
} );
add_filter( 'document_title_parts', function ( array $parts ): array {
	$own = statchasers_rankings_position_title();
	if ( '' !== $own && isset( $parts['title'] ) ) {
		$parts['title'] = $own;
	}
	return $parts;
} );
add_filter( 'get_canonical_url', function ( $canonical ) {
	$own = statchasers_rankings_position_canonical();
	return '' === $own ? $canonical : $own;
} );

/**
 * Fetch the server-rendered rankings fragment, cached.
 *
 * @param array{pos:string,season:int} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_rankings_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_rank_ssr_' . $key;
	$backup_key = 'sc_rank_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array( 'pos' => $args['pos'] );
	if ( 'ros' === ( $args['board'] ?? '' ) ) {
		$query['board'] = 'ros';
	}
	if ( $args['season'] > 0 ) {
		$query['season'] = (string) $args['season'];
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/rankings' ),
		array(
			'timeout' => STATCHASERS_RANKINGS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 here means the API has no rankings file — a real state, not a
	// transient error, and retrying every page view will not fix it. Cached as a
	// failure so a deployment mid-setup costs one request a minute.
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

	set_transient( $cache_key, $payload, STATCHASERS_RANKINGS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_RANKINGS_BACKUP_TTL );

	return $payload;
}

/**
 * Register and enqueue the board's compiled bundles.
 *
 * Its own handles, like the other four tools: a page mounting this shortcode
 * should not download the news tool's stylesheet. The version is shared because
 * the build hashes every asset into one number.
 */
function statchasers_rankings_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_RANKINGS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_RANKINGS_HANDLE,
			$origin . '/rankings.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_RANKINGS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_RANKINGS_HANDLE,
			$origin . '/dist/statchasers-rankings.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_RANKINGS_HANDLE );
	wp_enqueue_script( STATCHASERS_RANKINGS_HANDLE );

	if ( statchasers_rankings_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_RANKINGS_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not. A tool printing through
	// the site's header, and a phone reading it through a 43px margin on each
	// side, are wrong on every page that mounts a tool — whether or not that
	// page also wants the sidebar's share of the row back.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_RANKINGS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_RANKINGS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the rankings board?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out at
 * length in statchasers-team.php: Divi swaps the global post while rendering a
 * Theme Builder layout. Memoised for the same reason too.
 */
function statchasers_rankings_post_has_shortcode(): bool {
	return '' !== statchasers_rankings_page_board();
}

/** Does the request being rendered mount the rest-of-season board? */
function statchasers_rankings_page_is_ros(): bool {
	return 'ros' === statchasers_rankings_page_board();
}

/**
 * Which board the request's page mounts: 'ros', 'redraft', or '' for neither.
 *
 * The rest-of-season tag wins on a page that somehow carries both, because
 * it is the one whose addresses and headings this file manages.
 */
function statchasers_rankings_page_board(): string {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	if ( ! is_singular() ) {
		return '';
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return '';
	}

	$content = (string) $post->post_content;
	if ( has_shortcode( $content, STATCHASERS_ROS_RANKINGS_SHORTCODE ) ) {
		$answer = 'ros';
	} elseif ( has_shortcode( $content, STATCHASERS_RANKINGS_SHORTCODE ) ) {
		$answer = 'redraft';
	} else {
		$answer = '';
	}

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_rankings_post_has_shortcode() ) {
			return;
		}
		statchasers_rankings_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column?
 *
 * As load-bearing here as on the FPA table, and for the same reason: the All
 * board is five columns of player names, and Divi's 79.125% content column is
 * where the last of them starts getting squeezed on a desktop that has room for
 * all five.
 *
 * The CSS and the meta/body-class filters are the team file's; only the "does
 * this page mount the tool" question differs, so only that is restated.
 */
function statchasers_rankings_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_rankings_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the rankings board takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_rankings_full_width', true );
}

/**
 * Remove the sidebar markup on a rankings page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_rankings_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_rankings_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_rankings_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_rankings_full_width_body_class( array $classes ): array {
	if ( ! statchasers_rankings_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_rankings_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered boards into the page.
 *
 * Same deliberate omissions as the other four — no canonical, no <h1>, no title
 * or meta description, nothing written to the URL. The page owns all of it, and
 * the board's player links are ordinary links back to this app's own /player/,
 * which is why SC_PLAYER_PATH_PREFIX exists on the API side.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_rankings_shortcode( $atts = array() ): string {
	return statchasers_rankings_render( is_array( $atts ) ? $atts : array(), 'redraft' );
}

/**
 * [statchasers_ros_rankings]: the rest-of-season board.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_ros_rankings_shortcode( $atts = array() ): string {
	return statchasers_rankings_render( is_array( $atts ) ? $atts : array(), 'ros' );
}

/**
 * Both shortcodes' body.
 *
 * @param array<string,mixed> $atts  Shortcode attributes.
 * @param string              $board 'redraft' or 'ros'.
 * @return string HTML.
 */
function statchasers_rankings_render( array $atts, string $board ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Rankings:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_rankings_args( $atts, $board );
	$data = statchasers_rankings_fetch( $args );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_rankings_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only adds tab
		// behaviour to markup that is already there. An empty string leaves the
		// rest of the page — the H1, the copy, the internal links — intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Rankings:</strong> the API returned nothing. Check that the deployment is up and that it has a <code>data/rankings/' . ( 'ros' === $board ? 'ros' : 'redraft' ) . '-&lt;season&gt;.csv</code> file.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered rankings fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html   Rendered fragment.
	 * @param string $pos    The position panel opened first.
	 * @param int    $season The season requested, or 0 for the newest.
	 */
	// The heading is the rest-of-season board's alone; the redraft page's is
	// whatever its editor built, as it always was.
	$heading = 'ros' === $board ? statchasers_rankings_shortcode_heading() : '';

	return $heading . (string) apply_filters(
		'statchasers_rankings_fragment_html',
		statchasers_rankings_strip_faq_data( (string) $data['html'] ),
		$args['pos'],
		$args['season']
	);
}
add_shortcode( STATCHASERS_RANKINGS_SHORTCODE, 'statchasers_rankings_shortcode' );
add_shortcode( STATCHASERS_ROS_RANKINGS_SHORTCODE, 'statchasers_ros_rankings_shortcode' );

/* ------------------------------------------------------------- faq schema */

/**
 * The questions this request's rankings fragment is carrying.
 *
 * Simpler than the team hub's equivalent: there is one mount, one fragment and
 * one FAQ, and the questions do not vary by tab — the position changes which
 * panel opens and nothing about what is asked. The fetch is the cached one the shortcode is about to hit, so this
 * costs no second round trip, and the result is memoised because the Rank Math
 * filter and the fallback printer both ask.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_rankings_faq_items(): array {
	static $items = null;

	if ( null === $items ) {
		$items = statchasers_rankings_faq_parse( statchasers_rankings_page_html() );
	}

	return $items;
}

/**
 * The unprinted fragment for this request's board, or ''.
 *
 * What the schema nodes read their islands from. The default arguments —
 * which on a position URL include its position, so this is the fetch the
 * shortcode is about to make. A page passing a season gets the same questions:
 * they describe the rankings, not the open panel.
 *
 * @return string
 */
function statchasers_rankings_page_html(): string {
	static $html = null;

	if ( null !== $html ) {
		return $html;
	}

	$html = '';

	if ( ! statchasers_rankings_post_has_shortcode() ) {
		return $html;
	}

	$data = statchasers_rankings_fetch( statchasers_rankings_args( array() ) );

	if ( null === $data || ! isset( $data['html'] ) ) {
		return $html;
	}

	$html = (string) $data['html'];

	return $html;
}

/**
 * Pull the Q&A island out of a rendered fragment.
 *
 * Validated rather than trusted, for the reason statchasers_team_faq_parse()
 * gives: it is our own origin, but this ends up in the page's structured data
 * and a malformed island should drop an entry rather than emit a broken node.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_rankings_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'scr-faq-data' ) ) {
		return $items;
	}

	$found = preg_match_all(
		'#<script type="application/json" class="scr-faq-data">(.*?)</script>#s',
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
function statchasers_rankings_faq_node( string $webpage_id = '' ) {
	$items = statchasers_rankings_faq_items();

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
 * Same posture as the team and player files: append to the array Rank Math
 * hands us, so what ships is one <script> containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_rankings_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_rankings_faq_node( statchasers_news_schema_page_id( $data ) );

	if ( null === $node ) {
		return $data;
	}

	$data['statchasersRankingsFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_rankings_rank_math_schema', 20 );

/**
 * The boards as ItemLists: one per position the page shows, or none.
 *
 * The API builds them — rankings/rankings-schema.ts — and ships them as an
 * inert island this lifts out: four on the All board, one on a position page.
 * Checked for shape rather than trusted, like the FAQ island: a malformed list
 * is dropped rather than printed.
 *
 * @param string $webpage_id The graph's page node, or '' when there is none.
 * @return array<int,array<string,mixed>>
 */
function statchasers_rankings_list_nodes( string $webpage_id = '' ): array {
	$html = statchasers_rankings_page_html();

	if ( false === strpos( $html, 'scr-list-data' ) ) {
		return array();
	}

	if ( ! preg_match( '#<script type="application/json" class="scr-list-data">(.*?)</script>#s', $html, $match ) ) {
		return array();
	}

	$decoded = json_decode( $match[1], true );
	if ( ! is_array( $decoded ) ) {
		return array();
	}

	$nodes = array();
	foreach ( $decoded as $node ) {
		if (
			! is_array( $node )
			|| ( $node['@type'] ?? '' ) !== 'ItemList'
			|| empty( $node['itemListElement'] )
			|| ! is_array( $node['itemListElement'] )
		) {
			continue;
		}

		if ( '' !== $webpage_id ) {
			$node['isPartOf'] = array( '@id' => $webpage_id );
		}

		$nodes[] = $node;
	}

	return $nodes;
}

/**
 * Append the board lists to Rank Math's graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_rankings_rank_math_lists( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	foreach ( statchasers_rankings_list_nodes( statchasers_news_schema_page_id( $data ) ) as $i => $node ) {
		$data[ 'statchasersRankingsList' . $i ] = $node;
	}

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_rankings_rank_math_lists', 20 );

/**
 * Fallback FAQPage and board lists for sites with no schema-graph plugin.
 *
 * Prints ONLY those, for the reason the news fallback gives: with no SEO
 * plugin present, WebPage and Organization are a site-wide decision somebody
 * should make deliberately rather than something this tool improvises.
 */
function statchasers_rankings_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$nodes = statchasers_rankings_list_nodes();
	array_unshift( $nodes, statchasers_rankings_faq_node() );

	foreach ( $nodes as $node ) {
		if ( null === $node ) {
			continue;
		}

		$payload = array( '@context' => 'https://schema.org' ) + $node;

		echo '<script type="application/ld+json">' .
			wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
			'</script>' . "\n";
	}
}
add_action( 'wp_head', 'statchasers_rankings_print_fallback_schema', 20 );

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
function statchasers_rankings_strip_faq_data( string $html ): string {
	if (
		false === strpos( $html, 'scr-faq-data' )
		&& false === strpos( $html, 'scr-page-data' )
		&& false === strpos( $html, 'scr-list-data' )
	) {
		return $html;
	}

	// The page-copy and board-list islands too: what they carry is read from
	// the cached fetch, and printed they are dead weight.
	return (string) preg_replace(
		'#<script type="application/json" class="scr-(?:faq|page|list)-data">.*?</script>#s',
		'',
		$html
	);
}

/* ------------------------------------------------------------- the sitemap */

/**
 * The four board URLs, appended to Rank Math's page sitemap.
 *
 * Each board is its own canonical, and an address with no post behind it is
 * one Rank Math cannot list by itself — the player stats table adds its three
 * the same way. Only while the page exists and still mounts the board, and
 * only while the position URLs are on.
 */
add_filter(
	'rank_math/sitemap/page_content',
	static function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}

		if ( ! statchasers_rankings_position_urls_enabled() ) {
			return $content;
		}
		$page = get_page_by_path( statchasers_rankings_page_path() );
		if ( ! $page instanceof WP_Post || 'publish' !== $page->post_status ) {
			return $content;
		}
		if ( ! has_shortcode( (string) $page->post_content, STATCHASERS_ROS_RANKINGS_SHORTCODE ) ) {
			return $content;
		}
		$extra = '';
		foreach ( array( 'qb', 'rb', 'wr', 'te' ) as $pos ) {
			$extra .= statchasers_team_sitemap_entry( statchasers_rankings_position_url( $pos ), '' );
		}
		return $content . $extra;
	}
);

/**
 * Clear cached rankings renders. Called by statchasers_news_flush().
 */
function statchasers_rankings_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_rank_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_rank_ssr_' ) . '%'
		)
	);
}
