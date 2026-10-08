<?php
/**
 * The strength of schedule shortcode: [statchasers_strength_of_schedule]
 *
 * Same posture as the other tools. The API serves /strength-of-schedule with
 * `noindex, indexifembedded`, so the board is invisible to search until
 * something embeds it - this file is that something.
 *
 * ## What this replaces
 *
 * The tool shipped as a standalone Vite app in its own repository
 * (statchasersff-bit/Strength-of-Schedule-SOS) and its own plugin, "StatChasers
 * Strength of Schedule" (`statchasers-sos`), which mounted it with the
 * shortcode [statchasers_sos]. That plugin shipped a June snapshot of the data
 * inside itself, printed a server-rendered copy of it, and then had its React
 * bundle attach a Shadow DOM over the top and draw the board again.
 *
 * Here the API computes the board from the live FPA table and the season's
 * schedule, renders it, and this shortcode prints it into the page like the
 * other tools. Every team's weekly opponents, every aFPA and every rank are in
 * the page's HTML; the bundle sorts, switches views and exports on top of it.
 *
 * Migrating: on /nfl/fantasy-football-strength-of-schedule/, replace
 * [statchasers_sos] with [statchasers_strength_of_schedule], then deactivate
 * and delete the old "StatChasers Strength of Schedule" plugin. The tags do not
 * collide, so the two can coexist while the swap is made - but the old plugin
 * sets its own title, description, canonical and schema on the page it mounts
 * on, and those filters fight the ones below, so do not leave both on one page.
 *
 * ## Addresses
 *
 * One page. The view (Team or Player SOS, the position, the scoring format) is
 * reflected in the page's own query string - `?tab=player&pos=wr&scoring=ppr` -
 * so a view can be shared, and this file reads those three to print the right
 * board with scripting off. They are NOT registered query vars, and they are
 * read only on the page that mounts the shortcode. The canonical is always the
 * bare page: 24 views of one board are one page.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_SOS_SHORTCODE = 'statchasers_strength_of_schedule';
const STATCHASERS_SOS_HANDLE    = 'statchasers-sos';

/**
 * How long a rendered fragment is reused before we ask the API again. An hour:
 * the board moves when the FPA table does, which is once a week in season.
 * `statchasers_news_flush()` clears this.
 */
const STATCHASERS_SOS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_SOS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up. */
const STATCHASERS_SOS_TIMEOUT = 8;

/**
 * The views the API renders, each list's first entry being its default. The
 * whitelist is the cache bound too: every accepted value is its own transient
 * and its own origin fetch, so nothing outside these lists reaches either.
 */
const STATCHASERS_SOS_VIEWS = array(
	'tab'     => array( 'team', 'player' ),
	'pos'     => array( 'rb', 'qb', 'wr', 'te' ),
	'scoring' => array( 'ppr', 'half-ppr', 'std' ),
);

/* ------------------------------------------------------------- the view */

/**
 * One view value, validated: lower-cased, trimmed, and only if it is on the
 * list. Anything else is ''.
 *
 * @param string $key   'tab', 'pos' or 'scoring'.
 * @param mixed  $value The raw value.
 */
function statchasers_sos_clean( string $key, $value ): string {
	if ( ! isset( STATCHASERS_SOS_VIEWS[ $key ] ) || ! is_scalar( $value ) ) {
		return '';
	}
	$value = strtolower( trim( sanitize_text_field( (string) $value ) ) );
	return in_array( $value, STATCHASERS_SOS_VIEWS[ $key ], true ) ? $value : '';
}

/**
 * The view the page's query string asks for, key by key, '' where it asks for
 * nothing usable. Read only on the page that mounts the board: the three names
 * are ordinary words, and an article at `?pos=wr` is not asking for anything.
 *
 * @return array{tab:string,pos:string,scoring:string}
 */
function statchasers_sos_query_view(): array {
	$view = array(
		'tab'     => '',
		'pos'     => '',
		'scoring' => '',
	);

	if ( ! statchasers_sos_post_has_shortcode() ) {
		return $view;
	}

	foreach ( array_keys( $view ) as $key ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
		if ( isset( $_GET[ $key ] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
			$view[ $key ] = statchasers_sos_clean( $key, wp_unslash( $_GET[ $key ] ) );
		}
	}

	return $view;
}

/**
 * The view to print: the page's query string first, because it IS the view the
 * reader shared or bookmarked; then the shortcode attribute, which is the
 * page's default; then the tool's own default.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{tab:string,pos:string,scoring:string}
 */
function statchasers_sos_args( array $atts ): array {
	$defaults = array();
	foreach ( STATCHASERS_SOS_VIEWS as $key => $allowed ) {
		$defaults[ $key ] = $allowed[0];
	}

	$atts = shortcode_atts( $defaults, $atts, STATCHASERS_SOS_SHORTCODE );
	$from = statchasers_sos_query_view();

	$args = array();
	foreach ( $defaults as $key => $default ) {
		$given        = statchasers_sos_clean( $key, $atts[ $key ] );
		$args[ $key ] = '' !== $from[ $key ] ? $from[ $key ] : ( '' !== $given ? $given : $default );
	}

	return $args;
}

/* ------------------------------------------------------------- the fetch */

/**
 * Fetch the server-rendered fragment for one view, cached.
 *
 * @param array{tab:string,pos:string,scoring:string} $args The view.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_sos_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$query = array(
		'tab'     => $args['tab'],
		'pos'     => $args['pos'],
		'scoring' => $args['scoring'],
	);

	$key        = md5( $origin . '|' . wp_json_encode( $query ) );
	$cache_key  = 'sc_sos_ssr_' . $key;
	$backup_key = 'sc_sos_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return '' === $cached['html'] ? null : $cached;
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/sos' ),
		array(
			'timeout' => STATCHASERS_SOS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the API has nothing to build the board from (no FPA table
	// yet) - a real state, not a transient error. Cached as a failure for a
	// minute so a deployment mid-setup costs one request a minute.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute, so the next views do not
			// each retry the origin and wait out the timeout.
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

	set_transient( $cache_key, $payload, STATCHASERS_SOS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_SOS_BACKUP_TTL );

	return $payload;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the board's compiled bundles. Its own handles, like the
 * other tools: a page mounting this shortcode should not download another
 * tool's stylesheet.
 */
function statchasers_sos_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_SOS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_SOS_HANDLE,
			statchasers_public_origin() . '/sos.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_SOS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_SOS_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-sos.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_SOS_HANDLE );
	wp_enqueue_script( STATCHASERS_SOS_HANDLE );

	// Caps the board at the site's content width. The weekly grid is twenty
	// columns wide, and on a builder page without the cap it ran the window.
	if ( statchasers_sos_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_team_full_width_css() );
	}

	// The grid's header row and first column are sticky, and must sit under
	// Divi's header; and a phone should not read the board through Divi's 10%
	// margins. See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the board?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoised for the same reason too.
 */
function statchasers_sos_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_SOS_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_sos_post_has_shortcode() ) {
			return;
		}
		statchasers_sos_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column? The CSS and the meta/body-class
 * filters are the team file's; only "does this page mount the tool" differs.
 */
function statchasers_sos_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_sos_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the strength of schedule board takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_sos_full_width', true );
}

/**
 * Remove the sidebar markup on the SOS page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_sos_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_sos_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_sos_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_sos_full_width_body_class( array $classes ): array {
	if ( ! statchasers_sos_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_sos_full_width_body_class', PHP_INT_MAX );

/* ------------------------------------------------------------ the shortcode */

/**
 * The shortcode: prints the server-rendered board into the page.
 *
 * Takes `tab`, `pos` and `scoring` as the page's default view; the query string
 * outranks them. Prints the page heading itself in tool mode, and nothing else
 * of the page's - its title, description and canonical come from the filters
 * below.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_sos_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Strength of Schedule:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_sos_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_sos_fetch( $args );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_sos_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Strength of Schedule:</strong> the API returned nothing. Check that the deployment is up and that its FPA table has been ingested.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered strength of schedule fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 * @param array  $args The view rendered: tab, pos, scoring.
	 */
	return statchasers_sos_shortcode_heading() . (string) apply_filters(
		'statchasers_sos_fragment_html',
		statchasers_sos_strip_islands( (string) $data['html'] ),
		$args
	);
}
add_shortcode( STATCHASERS_SOS_SHORTCODE, 'statchasers_sos_shortcode' );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoised: what the title filters and
 * the H1 read. The same view the shortcode resolves with no attributes, so on a
 * page whose shortcode carries none it is the same cached transient.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_sos_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$data = statchasers_sos_post_has_shortcode()
		? statchasers_sos_fetch( statchasers_sos_args( array() ) )
		: null;

	return $data;
}

/**
 * The page's title, H1 and description, as the API wrote them - every view
 * carries the same three, so which view was fetched does not matter.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_sos_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_sos_request_data();
	$copy = statchasers_sos_parse_copy( null === $data ? '' : (string) $data['html'] );

	return $copy;
}

/**
 * The title/H1/description island out of a rendered fragment. Validated rather
 * than trusted: tags stripped, empty and unknown keys dropped.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_sos_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="scsos-page-data">(.*?)</script>#s', $html, $m ) ) {
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

/** The document title, or '' to leave the page's own. */
function statchasers_sos_title(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['title'] ) ? $copy['title'] : '';
}

/** The page's H1, or '' to leave the theme's. */
function statchasers_sos_h1(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : '';
}

/** The meta description, or '' to leave the page's own. */
function statchasers_sos_description(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['description'] ) ? $copy['description'] : '';
}

/**
 * The page's canonical: the bare permalink, whatever view the query string
 * asks for, or '' off the SOS page. Stated rather than left to Rank Math,
 * because `?tab=&pos=&scoring=` is 24 addresses for one board and none of them
 * may become a canonical of its own.
 */
function statchasers_sos_canonical(): string {
	if ( ! statchasers_sos_post_has_shortcode() ) {
		return '';
	}
	$id = get_queried_object_id();
	return $id ? (string) get_permalink( $id ) : '';
}

/**
 * The heading the shortcode prints itself, in the site's own hero markup.
 *
 * The player stats table's arrangement: "Let the tool supply the heading"
 * empties the theme's title on every tool page, and a tool that answers with
 * nothing leaves the page with no H1. Off in every other mode unless the probe
 * or a filter says to print.
 */
function statchasers_sos_shortcode_heading(): string {
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_sos_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	return statchasers_page_heading_html( statchasers_sos_h1() );
}

/**
 * Rewrite the page's title, which is the theme's H1. Guarded the way every
 * `the_title` filter in this plugin is.
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

		$own = statchasers_sos_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

// The approved title already names the site's subject and season in full, so
// it is used as it is - no " | StatChasers" suffix, which would push it past
// what a results page shows.
add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_sos_title();
		return '' === $own ? $title : $own;
	}
);
add_filter(
	'pre_get_document_title',
	static function ( $title ) {
		$own = statchasers_sos_title();
		return '' === $own ? $title : $own;
	},
	20
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_sos_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $canonical : $own;
	}
);

/**
 * Drop the page-data island from the printed markup. It is transport for the
 * title filters above, which read the cached fetch rather than this string.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_sos_strip_islands( string $html ): string {
	if ( false === strpos( $html, 'scsos-page-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scsos-page-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_sos_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_sos_ssr_', $all );
}
