<?php
/**
 * The depth-chart tool has one address: the page the shortcode sits on
 * (/nfl/nfl-depth-charts/). Filter state lives in the URL fragment, which the
 * browser never sends and search engines never index, so the tool cannot mint
 * a second URL.
 *
 * Until 1.7.0 the same page also served 32 "team routes"
 * (/nfl/nfl-depth-charts/fantasy/houston-texans/) with their own titles,
 * canonicals and sitemap. Those competed with the team pages, which now own
 * every team-specific address (/nfl/teams/houston-texans/depth-chart/). The
 * rewrite rules in SCDC_Rewrite still recognise the old shapes so that this
 * class can send them where they belong:
 *
 *   /{view}/{team}/{position?}/   team known      -> 301 to the team's depth chart page
 *   /{view}/ and /{view}/all-teams/{position?}/   -> 301 to the tool
 *   ?team= / ?view= / ?position= on the tool      -> 301 likewise
 *   anything else under the tool's path           -> 404
 *
 * Route types:
 *   none    - not the depth-chart page at all.
 *   main    - the tool's one address.
 *   legacy  - a pre-1.7.0 nested URL, about to be redirected.
 *   invalid - the tool's path with an unrecognised segment -> 404.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Route {

	const TYPE_NONE    = 'none';
	const TYPE_MAIN    = 'main';
	const TYPE_LEGACY  = 'legacy';
	const TYPE_INVALID = 'invalid';

	const DEFAULT_VIEW = 'fantasy';

	/** The team pages' section that replaced the team routes. */
	const TEAM_SECTION = 'depth-chart';

	/** @var SCDC_Route|null */
	private static $instance = null;

	/** @var array|null Memoized detection result. */
	private static $route = null;

	/**
	 * @return SCDC_Route
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register routing hooks: 404s for junk, 301s for the pre-1.7.0 URLs.
	 *
	 * @return void
	 */
	public function hooks() {
		// Runs right after the main query is set up, before any output and before
		// WordPress's own canonical redirect.
		add_action( 'wp', array( __CLASS__, 'handle_request' ), 1 );
	}

	// ---------------------------------------------------------------- detection

	/**
	 * Detect and validate the current route. Memoized per request.
	 *
	 * @return array{type:string,view:string,team:array|null,team_slug:string,position:string,reason:string}
	 */
	public static function get() {
		if ( null !== self::$route ) {
			return self::$route;
		}

		$route = array(
			'type'      => self::TYPE_NONE,
			'view'      => self::DEFAULT_VIEW,
			'team'      => null,
			'team_slug' => '',
			'position'  => '',
			'reason'    => 'not-depth-charts',
		);

		// Before the main query exists there is nothing to detect - and nothing to
		// remember either, so this answer is deliberately not memoized.
		if ( ! did_action( 'wp' ) ) {
			return $route;
		}

		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || is_feed() || is_robots() ) {
			self::$route = $route;
			return self::$route;
		}

		if ( ! self::is_tool_page() ) {
			self::$route = $route;
			return self::$route;
		}

		$raw_view     = sanitize_title( (string) get_query_var( 'sc_view' ) );
		$raw_team     = sanitize_title( (string) get_query_var( 'sc_team' ) );
		$raw_position = sanitize_title( (string) get_query_var( 'sc_position' ) );

		// --- the one address ---
		if ( '' === $raw_view ) {
			$route['type']   = self::TYPE_MAIN;
			$route['reason'] = 'tool-page';
			self::$route     = $route;
			return self::$route;
		}

		// --- a pre-1.7.0 nested URL: validate every segment, then redirect ---
		$views = SCDC_Teams::views();
		if ( ! isset( $views[ $raw_view ] ) ) {
			$route['type']   = self::TYPE_INVALID;
			$route['reason'] = 'unknown-view';
			self::$route     = $route;
			return self::$route;
		}
		$route['view'] = $raw_view;

		if ( '' === $raw_team || 'all-teams' === $raw_team ) {
			$route['type']   = self::TYPE_LEGACY;
			$route['reason'] = 'legacy-view-route';
		} else {
			$team = SCDC_Teams::get( $raw_team );
			if ( null === $team ) {
				$route['type']   = self::TYPE_INVALID;
				$route['reason'] = 'unknown-team';
				self::$route     = $route;
				return self::$route;
			}
			$route['type']      = self::TYPE_LEGACY;
			$route['team']      = $team;
			$route['team_slug'] = $team['slug'];
			$route['reason']    = 'legacy-team-route';
		}

		if ( '' !== $raw_position ) {
			if ( in_array( $raw_position, SCDC_Teams::positions( $route['view'] ), true ) ) {
				$route['position'] = $raw_position;
			} else {
				$route['type']   = self::TYPE_INVALID;
				$route['reason'] = 'unknown-position';
				self::$route     = $route;
				return self::$route;
			}
		}

		self::$route = $route;
		return self::$route;
	}

	/**
	 * Whether the current main query is the depth-chart tool page (bare or nested).
	 *
	 * @return bool
	 */
	private static function is_tool_page() {
		$page_id = SCDC_Pages::depth_charts_page_id();
		$queried = get_queried_object_id();

		if ( $page_id && (int) $queried === (int) $page_id ) {
			return true;
		}

		// Fallback for installs where the page ID option was never stored: compare
		// the queried page's path with the configured tool path.
		if ( is_page() && $queried ) {
			$uri = get_page_uri( $queried );
			if ( $uri && trim( (string) $uri, '/' ) === SCDC_Rewrite::page_path() ) {
				return true;
			}
		}

		return false;
	}

	/** @return string One of the TYPE_* constants. */
	public static function type() {
		$route = self::get();
		return $route['type'];
	}

	/** @return bool True on the tool's one address. */
	public static function is_main() {
		return self::TYPE_MAIN === self::type();
	}

	/** @return bool True on a pre-1.7.0 nested URL (which is about to redirect). */
	public static function is_legacy() {
		return self::TYPE_LEGACY === self::type();
	}

	/** @return bool True anywhere under the tool's path that is not a 404. */
	public static function is_tool() {
		return in_array( self::type(), array( self::TYPE_MAIN, self::TYPE_LEGACY ), true );
	}

	/** @return array|null The team a legacy URL named, or null. */
	public static function team() {
		$route = self::get();
		return $route['team'];
	}

	// ---------------------------------------------------------------------- URLs

	/**
	 * Trailing-slashed URL of the tool page, e.g.
	 * https://statchasers.com/nfl/nfl-depth-charts/
	 *
	 * @return string
	 */
	public static function base_url() {
		return SCDC_Pages::depth_charts_url();
	}

	/**
	 * The tool's one indexable address. Same as base_url(); kept as its own
	 * name so callers say what they mean.
	 *
	 * @return string
	 */
	public static function main_url() {
		return self::base_url();
	}

	/**
	 * Where a team's depth chart lives now: the team page's Depth Chart section
	 * (statchasers-news/statchasers-team-pages.php), /nfl/teams/{slug}/depth-chart/.
	 *
	 * Built from the team-pages plugin's own constants when it is active so the
	 * two can never disagree; the defaults match its defaults. Overridable with
	 * the `scdc_team_page_url` filter.
	 *
	 * @param string $team_slug Team slug, e.g. "houston-texans".
	 * @return string
	 */
	public static function team_page_url( $team_slug ) {
		$base = defined( 'STATCHASERS_TEAM_PATH' ) ? trim( (string) constant( 'STATCHASERS_TEAM_PATH' ), '/' ) : 'nfl/teams';

		// Section addresses can be switched off site-wide; then the hub itself is
		// the nearest page.
		$sections_on = function_exists( 'statchasers_team_section_urls_enabled' )
			? (bool) statchasers_team_section_urls_enabled()
			: true;

		$path = '/' . $base . '/' . strtolower( (string) $team_slug ) . '/';
		if ( $sections_on ) {
			$path .= self::TEAM_SECTION . '/';
		}

		return (string) apply_filters( 'scdc_team_page_url', home_url( $path ), $team_slug );
	}

	/**
	 * Where the current request should go, if it is a pre-1.7.0 URL.
	 *
	 * @return string '' when the request is not one.
	 */
	public static function legacy_destination() {
		$route = self::get();
		if ( self::TYPE_LEGACY !== $route['type'] ) {
			return '';
		}
		// /fantasy/?team=houston-texans named its team in the query string.
		$slug = '' !== $route['team_slug'] ? $route['team_slug'] : self::query_team_slug();
		return '' !== $slug ? self::team_page_url( $slug ) : self::main_url();
	}

	/**
	 * A valid team slug named by a ?team= query argument, or ''.
	 *
	 * @return string
	 */
	private static function query_team_slug() {
		if ( empty( $_SERVER['REQUEST_URI'] ) ) {
			return '';
		}
		$query_string = (string) wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_QUERY ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( '' === $query_string ) {
			return '';
		}
		$args = array();
		wp_parse_str( $query_string, $args );
		if ( ! isset( $args['team'] ) ) {
			return '';
		}
		$candidate = sanitize_title( (string) $args['team'] );
		return SCDC_Teams::is_valid( $candidate ) ? $candidate : '';
	}

	// ------------------------------------------------------------------ requests

	/**
	 * Junk slugs 404; the pre-1.7.0 nested URLs and the older ?team=/?view=
	 * query arguments 301 to the page that serves that request now.
	 *
	 * @return void
	 */
	public static function handle_request() {
		$route = self::get();

		if ( self::TYPE_INVALID === $route['type'] ) {
			self::send_404();
			return;
		}

		if ( self::TYPE_LEGACY === $route['type'] ) {
			self::redirect( self::legacy_destination() );
			return;
		}

		if ( self::TYPE_MAIN === $route['type'] ) {
			self::maybe_redirect_query_args();
		}
	}

	/**
	 * Turn the current request into a real 404 (status + template), so unknown
	 * slugs can never become indexable URLs.
	 *
	 * @return void
	 */
	private static function send_404() {
		global $wp_query;

		if ( ! $wp_query instanceof WP_Query ) {
			return;
		}

		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
	}

	/**
	 * @param string $destination Absolute URL.
	 * @return void
	 */
	private static function redirect( $destination ) {
		if ( '' === $destination || is_customize_preview() || is_preview() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
			return;
		}
		wp_safe_redirect( $destination, 301 );
		exit;
	}

	/**
	 * The oldest URL shape, ?team=houston-texans / ?view=offense on the tool page,
	 * goes the same way as the nested one: a named team to its team page, the
	 * rest to the tool. Unrelated query arguments are carried over.
	 *
	 * @return void
	 */
	private static function maybe_redirect_query_args() {
		if ( empty( $_SERVER['REQUEST_URI'] ) || empty( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== $_SERVER['REQUEST_METHOD'] ) {
			return;
		}

		$request      = wp_unslash( $_SERVER['REQUEST_URI'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$query_string = (string) wp_parse_url( $request, PHP_URL_QUERY );
		if ( '' === $query_string ) {
			return;
		}

		$args = array();
		wp_parse_str( $query_string, $args );
		if ( ! isset( $args['team'] ) && ! isset( $args['view'] ) && ! isset( $args['position'] ) ) {
			return;
		}

		$slug        = self::query_team_slug();
		$destination = '' !== $slug ? self::team_page_url( $slug ) : self::main_url();
		unset( $args['team'], $args['view'], $args['position'] );

		if ( ! empty( $args ) ) {
			$destination = add_query_arg( $args, $destination );
		}

		self::redirect( $destination );
	}
}
