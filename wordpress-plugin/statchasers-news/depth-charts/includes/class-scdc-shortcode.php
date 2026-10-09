<?php
/**
 * Front-end shortcode: [statchasers_depth_charts]
 *
 * Renders the StatChasers depth-chart UI from the locally cached JSON. The cache
 * file is fetched client-side from its uploads URL; if no cache exists yet, a
 * fallback message is shown and no assets are loaded.
 *
 * The page has one address. Nothing team-specific is rendered here any more:
 * the per-team H1, intro, summary and the 32-team link grid went with the team
 * routes in 1.7.0, because the team pages carry a team's depth chart now
 * (/nfl/teams/{slug}/depth-chart/). The view/team/position filters are client
 * state, kept in the URL fragment by assets/js/frontend.js.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Shortcode {

	const HANDLE = 'scdc-frontend';

	/** @var SCDC_Shortcode|null */
	private static $instance = null;

	/**
	 * @return SCDC_Shortcode
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register front-end hooks.
	 *
	 * @return void
	 */
	public function hooks() {
		add_shortcode( 'statchasers_depth_charts', array( $this, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );

		// Keep the front-end renderer out of "delay JavaScript until interaction"
		// optimizations. Those postpone the script until the first click/scroll,
		// which leaves the static "Loading depth charts…" placeholder up until the
		// visitor interacts. Mark the tag as non-deferrable and register the URL
		// with the common optimizers' exclusion lists.
		add_filter( 'script_loader_tag', array( $this, 'exclude_from_delay_js' ), 10, 2 );

		// WP Rocket: delay-JS, defer, and minify/combine exclusion lists (arrays).
		add_filter( 'rocket_delay_js_exclusions', array( $this, 'add_url_exclusion' ) );
		add_filter( 'rocket_exclude_defer_js', array( $this, 'add_url_exclusion' ) );
		add_filter( 'rocket_exclude_js', array( $this, 'add_url_exclusion' ) );

		// Autoptimize: exclusion list is a comma-separated STRING, not an array.
		add_filter( 'autoptimize_filter_js_exclude', array( $this, 'add_string_exclusion' ) );

		// --- Keep the stylesheet out of "Remove Unused CSS" ---
		// Almost every selector in frontend.css styles DOM the renderer builds at
		// runtime (.scdc-suggest-pos, .scdc-sg-logo, .scdc-team-card, …), so it is
		// absent from the server HTML that an unused-CSS pass scans. Stripped, the
		// dropdown's team logos and position codes collapse to zero width inside
		// their flex rows and disappear. Mark the tag, and register with the usual
		// optimizers' allowlists.
		add_filter( 'style_loader_tag', array( $this, 'exclude_style_from_optimization' ), 10, 2 );
		add_filter( 'rocket_exclude_css', array( $this, 'add_css_exclusion' ) );
		add_filter( 'rocket_rucss_safelist', array( $this, 'add_css_exclusion' ) );
		add_filter( 'rocket_rucss_excluded_stylesheets', array( $this, 'add_css_exclusion' ) );
		add_filter( 'litespeed_ucss_whitelist', array( $this, 'add_css_exclusion' ) );
		add_filter( 'perfmatters_rucss_safelist', array( $this, 'add_css_exclusion' ) );
		add_filter( 'autoptimize_filter_css_exclude', array( $this, 'add_css_exclusion' ) );
	}

	/**
	 * Selectors and file patterns that must survive CSS optimization. The whole
	 * prefix is listed rather than individual classes so the list can't drift out
	 * of date as the UI grows.
	 *
	 * @return string[]
	 */
	private function css_safelist() {
		return array(
			'assets/css/frontend.css',
			'statchasers-depth-charts',
			'.scdc-',
			'/^\\.scdc-/',
		);
	}

	/**
	 * Append the safelist to an optimizer's exclusion setting, matching whichever
	 * shape that plugin uses (array or comma-separated string), so a wrong guess
	 * can never hand a plugin a value it doesn't expect.
	 *
	 * @param mixed $exclusions Existing exclusions (array or string).
	 * @return mixed Same type as received.
	 */
	public function add_css_exclusion( $exclusions ) {
		$additions = $this->css_safelist();

		if ( is_string( $exclusions ) ) {
			$existing = '' === trim( $exclusions ) ? array() : array( trim( $exclusions ) );
			return implode( ', ', array_merge( $existing, $additions ) );
		}

		if ( ! is_array( $exclusions ) ) {
			$exclusions = array();
		}
		return array_merge( $exclusions, $additions );
	}

	/**
	 * Mark this plugin's <link rel="stylesheet"> so optimizers skip it, mirroring
	 * what exclude_from_delay_js() does for the script tag.
	 *
	 * @param string $tag    The full <link> HTML tag.
	 * @param string $handle The style's registered handle.
	 * @return string
	 */
	public function exclude_style_from_optimization( $tag, $handle ) {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		return str_replace(
			' href=',
			' data-no-optimize="1" data-noptimize="1" data-cfasync="false" href=',
			$tag
		);
	}

	/**
	 * Add "do not optimize" attributes to this plugin's script tag. WP Rocket
	 * reads data-no-defer / data-cfasync; Autoptimize skips any tag containing
	 * data-noptimize (note: no hyphen - distinct from WP Rocket's spelling).
	 *
	 * @param string $tag    The full <script> HTML tag.
	 * @param string $handle The script's registered handle.
	 * @return string
	 */
	public function exclude_from_delay_js( $tag, $handle ) {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		return str_replace(
			' src=',
			' data-no-optimize="1" data-noptimize="1" data-no-defer="1" data-cfasync="false" src=',
			$tag
		);
	}

	/**
	 * Append this plugin's script URL to an array-based exclusion list (WP Rocket).
	 *
	 * @param array $exclusions Existing exclusion patterns.
	 * @return array
	 */
	public function add_url_exclusion( $exclusions ) {
		if ( ! is_array( $exclusions ) ) {
			$exclusions = array();
		}
		$exclusions[] = 'assets/js/frontend.js';
		return $exclusions;
	}

	/**
	 * Append this plugin's script URL to a comma-separated exclusion string
	 * (Autoptimize's autoptimize_filter_js_exclude).
	 *
	 * @param string $exclude Existing comma-separated exclude list.
	 * @return string
	 */
	public function add_string_exclusion( $exclude ) {
		$exclude = is_string( $exclude ) ? trim( $exclude ) : '';
		if ( '' === $exclude ) {
			return 'assets/js/frontend.js';
		}
		return $exclude . ', assets/js/frontend.js';
	}

	/**
	 * Register (but don't enqueue) the front-end assets.
	 *
	 * @return void
	 */
	public function register_assets() {
		wp_register_style(
			self::HANDLE,
			SCDC_PLUGIN_URL . 'assets/css/frontend.css',
			array(),
			SCDC_VERSION
		);
		wp_register_script(
			self::HANDLE,
			SCDC_PLUGIN_URL . 'assets/js/frontend.js',
			array(),
			SCDC_VERSION,
			true
		);
	}

	/**
	 * The 32-team config as compact JSON for the front end: abbreviation =>
	 * { n: name, c: city, s: slug }. The fragment the script keeps its filter
	 * state in (#fantasy/buffalo-bills/rb) uses these slugs, the same ones the
	 * pre-1.7.0 URLs used, so an old deep link's fragment still resolves.
	 *
	 * @return string
	 */
	private function teams_json() {
		$map = array();
		foreach ( SCDC_Teams::all() as $slug => $team ) {
			$map[ $team['abbr'] ] = array(
				'n' => $team['name'],
				'c' => $team['city'],
				's' => $slug,
			);
		}
		return (string) wp_json_encode( $map );
	}

	/**
	 * Maximum width of the tool, as a CSS length ("1080px", "70rem") or "none".
	 *
	 * The tool fills whatever box the page builder gives it, which on a
	 * full-width section is the entire viewport - wider than the neighboring
	 * modules, and growing further as the page is zoomed out. This caps it at the
	 * site's content width and centers it. Returning an empty string leaves the
	 * stylesheet's default (1080px) in place.
	 *
	 * @return string
	 */
	private function max_width_style() {
		$max_width = trim( (string) apply_filters( 'scdc_max_width', '' ) );
		if ( '' === $max_width ) {
			return '';
		}
		return ' style="--scdc-max-width:' . esc_attr( $max_width ) . '"';
	}

	/**
	 * Render the shortcode output.
	 *
	 * @param array $atts Shortcode attributes (unused for now).
	 * @return string
	 */
	/**
	 * The StatChasers app's public origin, for its image derivatives.
	 *
	 * ESPN serves 350x254 PNG headshots and 500px PNG crests, which the script
	 * drew into boxes of 20 to 40 pixels. With the app's origin known, the
	 * script points those at the app's own resized WebP headshots
	 * (/news-image/athlete/<id>/...) and its SVG crests (/team-logos/<abbr>.svg)
	 * instead. The public name, as the StatChasers plugin defines it, not the
	 * fetch origin SCDC_Push uses. SCDC_IMAGE_ORIGIN overrides; '' (no
	 * StatChasers plugin and no constant) keeps ESPN's files.
	 *
	 * @return string Origin without a trailing slash, or ''.
	 */
	public static function image_origin() {
		$origin = '';
		if ( defined( 'SCDC_IMAGE_ORIGIN' ) ) {
			$origin = (string) constant( 'SCDC_IMAGE_ORIGIN' );
		} elseif ( function_exists( 'statchasers_public_origin' ) ) {
			$origin = (string) statchasers_public_origin();
		} elseif ( defined( 'STATCHASERS_PUBLIC_ORIGIN' ) ) {
			$origin = (string) constant( 'STATCHASERS_PUBLIC_ORIGIN' );
		} elseif ( defined( 'STATCHASERS_NEWS_ORIGIN' ) ) {
			$origin = (string) constant( 'STATCHASERS_NEWS_ORIGIN' );
		}
		/**
		 * Filters the origin the depth chart loads its imagery from.
		 *
		 * @param string $origin App origin, no trailing slash, or ''.
		 */
		$origin = (string) apply_filters( 'scdc_image_origin', $origin );
		return untrailingslashit( esc_url_raw( $origin ) );
	}

	public function render( $atts = array() ) {
		// Fallback when nothing has been cached yet.
		if ( ! SCDC_Store::has_data() ) {
			return '<div class="scdc-root"><div class="scdc-empty"><p>'
				. esc_html__( 'Depth chart data has not been refreshed yet.', 'statchasers-depth-charts' )
				. '</p></div></div>';
		}

		wp_enqueue_style( self::HANDLE );
		wp_enqueue_script( self::HANDLE );

		$endpoint = SCDC_Store::file_url();
		$meta     = SCDC_Store::get_meta();

		$last_updated = '';
		if ( ! empty( $meta['last_refreshed_ts'] ) ) {
			$last_updated = wp_date(
				get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
				(int) $meta['last_refreshed_ts']
			);
		}

		$id = 'scdc-' . wp_rand( 1000, 9999 );

		ob_start();
		?>
		<div class="scdc-page"<?php echo $this->max_width_style(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>>
			<div
				id="<?php echo esc_attr( $id ); ?>"
				class="scdc-root"
				data-endpoint="<?php echo esc_url( $endpoint ); ?>"
				data-image-origin="<?php echo esc_url( self::image_origin() ); ?>"
				data-last-updated="<?php echo esc_attr( $last_updated ); ?>"
				data-season="<?php echo esc_attr( (string) SCDC_Teams::season() ); ?>"
				data-teams="<?php echo esc_attr( $this->teams_json() ); ?>"
			>
				<div class="scdc-loading"><?php esc_html_e( 'Loading depth charts…', 'statchasers-depth-charts' ); ?></div>
			</div>
		</div>
		<?php
		return (string) ob_get_clean();
	}
}
