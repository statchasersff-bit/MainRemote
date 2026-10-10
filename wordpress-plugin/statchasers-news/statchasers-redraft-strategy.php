<?php
/**
 * The redraft draft strategy shortcode: [statchasers_redraft_strategy]
 *
 * Same posture as the other tools. The API serves /redraft-strategy with
 * `noindex, indexifembedded`, so the tool is invisible to search until
 * something embeds it - this file is that something.
 *
 * ## What this replaces
 *
 * The tool was a React app in its own repository
 * (statchasersff-bit/RESEARCH-Redraft-Draft-Analysis) that shipped as the
 * standalone "StatChasers Redraft Analyzer" plugin: a Vite bundle, 200 KB of
 * scoped Tailwind and 19 MB of JSON inside wp-content, mounted by
 * [statchasers_redraft] and drawn entirely in the browser. Here the API
 * renders the default view - the ranking chart, every table and the draft
 * board, with every number in the HTML - and this shortcode prints it into
 * the page like the other tools. The bundle redraws every other view (format,
 * scoring, TE premium, league size, season, the 2021-2025 comparison) from
 * 12-20 KB data slices it fetches through the browser proxy
 * (statchasers-proxy.php, embed/redraft-strategy/data/...).
 *
 * The standalone plugin's functions are statchasers_redraft_*; nothing here
 * shares a name with them, so both can be active while the page's shortcode
 * is swapped. Deactivate and delete the old one afterwards.
 *
 * ## Addresses
 *
 * One page, and no view in its address. The app's WordPress build kept its
 * filters in memory and never wrote them to the URL, so this file reads no
 * query string at all, and the canonical is always the bare page.
 *
 * ## Heading
 *
 * The page's heading is its editor's: /redraft-draft-strategy/ carries a
 * Divi code module with the H1, the gold rule and the lead paragraph above
 * the shortcode. So this file is NOT in statchasers_h1_mounts_a_tool() and
 * prints no H1 of its own unless a theme says so through the
 * `statchasers_redraft_strategy_shortcode_h1` filter; the island's title and
 * description are the page's own words, carried by the API.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_RDS_SHORTCODE = 'statchasers_redraft_strategy';
const STATCHASERS_RDS_HANDLE    = 'statchasers-redraft-strategy';

/**
 * How long a rendered fragment is reused before we ask the API again. An hour:
 * the dataset is history and moves only when a new one is deployed.
 * `statchasers_news_flush()` clears this.
 */
const STATCHASERS_RDS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_RDS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up. */
const STATCHASERS_RDS_TIMEOUT = 8;

/* ------------------------------------------------------------- the fetch */

/**
 * Fetch the server-rendered fragment, cached. There is one: the default view.
 *
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_rds_fetch(): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin );
	$cache_key  = 'sc_rds_ssr_' . $key;
	$backup_key = 'sc_rds_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return '' === $cached['html'] ? null : $cached;
	}

	$response = wp_remote_get(
		$origin . '/embed/redraft-strategy',
		array(
			'timeout' => STATCHASERS_RDS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the API has no dataset - a real state, not a transient
	// error. Cached as a failure for a minute so a deployment mid-setup costs
	// one request a minute.
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

	set_transient( $cache_key, $payload, STATCHASERS_RDS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_RDS_BACKUP_TTL );

	return $payload;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the tool's compiled bundles. Its own handles, like the
 * other tools: a page mounting this shortcode should not download another
 * tool's stylesheet.
 */
function statchasers_rds_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_RDS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_RDS_HANDLE,
			statchasers_public_origin() . '/redraft-strategy.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_RDS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_RDS_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-redraft-strategy.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_RDS_HANDLE );
	wp_enqueue_script( STATCHASERS_RDS_HANDLE );

	// Caps the tool at the site's content width. The draft board is a dozen
	// columns wide, and on a builder page without the cap a tool runs the window.
	if ( statchasers_rds_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_RDS_HANDLE, statchasers_team_full_width_css() );
	}

	// The draft board's slot row is sticky and must sit under Divi's header;
	// and a phone should not read the tool through Divi's 10% margins.
	// See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_RDS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_RDS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the tool?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoized for the same reason too.
 */
function statchasers_rds_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_RDS_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_rds_post_has_shortcode() ) {
			return;
		}
		statchasers_rds_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column? The CSS and the meta/body-class
 * filters are the team file's; only "does this page mount the tool" differs.
 */
function statchasers_rds_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_rds_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the redraft strategy tool takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_rds_full_width', true );
}

/**
 * Remove the sidebar markup on the redraft strategy page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_rds_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_rds_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_rds_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_rds_full_width_body_class( array $classes ): array {
	if ( ! statchasers_rds_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_rds_full_width_body_class', PHP_INT_MAX );

/* ------------------------------------------------------------ the shortcode */

/**
 * The shortcode: prints the server-rendered tool into the page.
 *
 * Takes no attributes. Prints the page heading itself in tool mode, and nothing
 * else of the page's - its title, description and canonical come from the
 * filters below.
 *
 * @return string HTML.
 */
function statchasers_rds_shortcode(): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Redraft Strategy:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$data = statchasers_rds_fetch();

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_rds_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Redraft Strategy:</strong> the API returned nothing. Check that the deployment is up and carries data/redraft-strategy/.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered redraft strategy fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 */
	return statchasers_rds_shortcode_heading() . (string) apply_filters(
		'statchasers_rds_fragment_html',
		statchasers_rds_strip_islands( (string) $data['html'] )
	);
}
add_shortcode( STATCHASERS_RDS_SHORTCODE, 'statchasers_rds_shortcode' );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoized: what the title filters and
 * the H1 read. The same cached transient the shortcode prints.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_rds_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$data = statchasers_rds_post_has_shortcode()
		? statchasers_rds_fetch()
		: null;

	return $data;
}

/**
 * The page's title, H1 and description, as the API wrote them.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_rds_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_rds_request_data();
	$copy = statchasers_rds_parse_copy( null === $data ? '' : (string) $data['html'] );

	return $copy;
}

/**
 * The title/H1/description island out of a rendered fragment. Validated rather
 * than trusted: tags stripped, empty and unknown keys dropped.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_rds_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="scds-page-data">(.*?)</script>#s', $html, $m ) ) {
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
function statchasers_rds_title(): string {
	$copy = statchasers_rds_page_copy();
	return isset( $copy['title'] ) ? $copy['title'] : '';
}

/** The page's H1, or '' to leave the theme's. */
function statchasers_rds_h1(): string {
	$copy = statchasers_rds_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : '';
}

/** The meta description, or '' to leave the page's own. */
function statchasers_rds_description(): string {
	$copy = statchasers_rds_page_copy();
	return isset( $copy['description'] ) ? $copy['description'] : '';
}

/**
 * The page's canonical: the bare permalink, or '' off the tool's page. Stated
 * rather than left to Rank Math, so no query string a link carries becomes a
 * canonical of its own.
 */
function statchasers_rds_canonical(): string {
	if ( ! statchasers_rds_post_has_shortcode() ) {
		return '';
	}
	$id = get_queried_object_id();
	return $id ? (string) get_permalink( $id ) : '';
}

/**
 * The heading the shortcode prints itself: nothing, unless asked.
 *
 * The page's H1 is the editor's hero above the shortcode, so printing one
 * here would be a second H1 - the redraft rankings board's arrangement, not
 * the rookie hit rates'. A theme that wants the tool to print it answers
 * the filter.
 */
function statchasers_rds_shortcode_heading(): string {
	if ( ! apply_filters( 'statchasers_rds_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	return statchasers_page_heading_html( statchasers_rds_h1() );
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

		$own = statchasers_rds_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

// The title is the page's own, carried by the API (rdsPageCopy), so it is used
// as it is - no suffix added. Any new wording needs mak's approval.
add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_rds_title();
		return '' === $own ? $title : $own;
	}
);
add_filter(
	'pre_get_document_title',
	static function ( $title ) {
		$own = statchasers_rds_title();
		return '' === $own ? $title : $own;
	},
	20
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_rds_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_rds_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_rds_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_rds_canonical();
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
function statchasers_rds_strip_islands( string $html ): string {
	if ( false === strpos( $html, 'scds-page-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scds-page-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_rds_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_rds_ssr_', $all );
}
