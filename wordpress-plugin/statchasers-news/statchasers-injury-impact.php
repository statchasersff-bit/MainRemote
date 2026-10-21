<?php
/**
 * The injury tools: [statchasers_injury_impact] and [statchasers_injury_database]
 *
 * Same posture as the other tools. The API serves /injury-impact and
 * /injury-database with `noindex, indexifembedded`, so the tools are invisible
 * to search until something embeds them - this file is that something.
 *
 * ## What this replaces
 *
 * The tools were a React app in their own repository
 * (statchasersff-bit/RESEARCH-Injury-Impact-Analysis) with a standalone
 * "StatChasers Injury Tools" plugin that put each route in a self-sizing
 * iframe ([injury-analysis], [injury-database], [gridiron-medical]). That
 * plugin was never installed here. Here the API renders each page's default
 * view - every chart, table and sentence in the HTML - and these shortcodes
 * print it into the page like the other tools. The bundle redraws every other
 * view (filters, sorts, tabs, legends, the player panel) from data slices it
 * fetches through the browser proxy (statchasers-proxy.php,
 * embed/injury-impact/data/...).
 *
 * ## Addresses
 *
 * One page per shortcode, and no view in either address. The app kept its
 * filters in React state and wrote only the question hash to the URL, so this
 * file reads no query string at all, and the canonical is always the bare page.
 *
 * ## Heading
 *
 * No statchasers.com page mounts these yet, so there is no editor's hero to
 * defer to. Both are in statchasers_h1_mounts_a_tool() and print the H1 the
 * island names in "Let the tool supply the heading" mode, as the rookie hit
 * rates do. The island's title and description are the app's own words
 * (lib/injury-impact/render-shared.ts); new wording needs mak's approval.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_SCIN_SHORTCODE    = 'statchasers_injury_impact';
const STATCHASERS_SCIN_DB_SHORTCODE = 'statchasers_injury_database';
const STATCHASERS_SCIN_HANDLE       = 'statchasers-injury-impact';

/**
 * How long a rendered fragment is reused before we ask the API again. An hour:
 * the dataset is research and moves only when a new one is deployed.
 * `statchasers_news_flush()` clears this.
 */
const STATCHASERS_SCIN_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_SCIN_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up. */
const STATCHASERS_SCIN_TIMEOUT = 8;

/**
 * The two pages, by the key the rest of this file passes around: the
 * shortcode tag and the fragment path of each.
 *
 * @return array<string,array{shortcode:string,path:string,label:string}>
 */
function statchasers_scin_pages(): array {
	return array(
		'analysis' => array(
			'shortcode' => STATCHASERS_SCIN_SHORTCODE,
			'path'      => '/embed/injury-impact',
			'label'     => 'Injury Impact',
		),
		'database' => array(
			'shortcode' => STATCHASERS_SCIN_DB_SHORTCODE,
			'path'      => '/embed/injury-database',
			'label'     => 'Injury Database',
		),
	);
}

/* ------------------------------------------------------------- the fetch */

/**
 * Fetch one page's server-rendered fragment, cached. There is one per page:
 * the default view.
 *
 * @param string $page 'analysis' or 'database'.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_scin_fetch( string $page ): ?array {
	$origin = statchasers_news_origin();
	$pages  = statchasers_scin_pages();
	if ( '' === $origin || ! isset( $pages[ $page ] ) ) {
		return null;
	}

	$key        = md5( $origin . '|' . $page );
	$cache_key  = 'sc_scin_ssr_' . $key;
	$backup_key = 'sc_scin_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return '' === $cached['html'] ? null : $cached;
	}

	$response = wp_remote_get(
		$origin . $pages[ $page ]['path'],
		array(
			'timeout' => STATCHASERS_SCIN_TIMEOUT,
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

	set_transient( $cache_key, $payload, STATCHASERS_SCIN_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_SCIN_BACKUP_TTL );

	return $payload;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the tools' compiled bundles. One stylesheet and one
 * bundle serve both pages; a page mounting either should not download
 * another tool's code.
 */
function statchasers_scin_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_SCIN_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_SCIN_HANDLE,
			statchasers_public_origin() . '/injury-impact.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_SCIN_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_SCIN_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-injury-impact.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_SCIN_HANDLE );
	wp_enqueue_script( STATCHASERS_SCIN_HANDLE );

	// Caps the tool at the site's content width. The draft-capital table is a
	// dozen columns wide, and on a builder page without the cap a tool runs the window.
	if ( statchasers_scin_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_SCIN_HANDLE, statchasers_team_full_width_css() );
	}

	// The question tabs are sticky and must sit under Divi's header; and a
	// phone should not read the tool through Divi's 10% margins.
	// See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_SCIN_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_SCIN_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Which of the two pages the request being rendered mounts, or '' for neither.
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoized for the same reason too.
 */
function statchasers_scin_page_mounted(): string {
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

	$answer  = '';
	$content = (string) $post->post_content;
	foreach ( statchasers_scin_pages() as $page => $def ) {
		if ( has_shortcode( $content, $def['shortcode'] ) ) {
			$answer = $page;
			break;
		}
	}

	return $answer;
}

/** Does the request being rendered mount either tool? */
function statchasers_scin_post_has_shortcode(): bool {
	return '' !== statchasers_scin_page_mounted();
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_scin_post_has_shortcode() ) {
			return;
		}
		statchasers_scin_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column? The CSS and the meta/body-class
 * filters are the team file's; only "does this page mount the tool" differs.
 */
function statchasers_scin_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_scin_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting an injury tool takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_scin_full_width', true );
}

/**
 * Remove the sidebar markup on the injury pages.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_scin_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_scin_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_scin_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_scin_full_width_body_class( array $classes ): array {
	if ( ! statchasers_scin_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_scin_full_width_body_class', PHP_INT_MAX );

/* ------------------------------------------------------------ the shortcodes */

/**
 * Print one page's server-rendered tool into the page.
 *
 * Takes no attributes. Prints the page heading itself in tool mode, and nothing
 * else of the page's - its title, description and canonical come from the
 * filters below.
 *
 * @param string $page 'analysis' or 'database'.
 * @return string HTML.
 */
function statchasers_scin_render( string $page ): string {
	$origin = statchasers_news_origin();
	$label  = statchasers_scin_pages()[ $page ]['label'] ?? 'Injury Impact';

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers ' . esc_html( $label ) . ':</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$data = statchasers_scin_fetch( $page );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_scin_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers ' . esc_html( $label ) . ':</strong> the API returned nothing. Check that the deployment is up and carries data/injury-impact/.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered injury fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 * @param string $page Which page: 'analysis' or 'database'.
	 */
	return statchasers_scin_shortcode_heading( $page ) . (string) apply_filters(
		'statchasers_scin_fragment_html',
		statchasers_scin_strip_islands( (string) $data['html'] ),
		$page
	);
}

/** [statchasers_injury_impact] */
function statchasers_scin_shortcode(): string {
	return statchasers_scin_render( 'analysis' );
}
add_shortcode( STATCHASERS_SCIN_SHORTCODE, 'statchasers_scin_shortcode' );

/** [statchasers_injury_database] */
function statchasers_scin_db_shortcode(): string {
	return statchasers_scin_render( 'database' );
}
add_shortcode( STATCHASERS_SCIN_DB_SHORTCODE, 'statchasers_scin_db_shortcode' );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoized: what the title filters and
 * the H1 read. The same cached transient the shortcode prints.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_scin_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$page = statchasers_scin_page_mounted();
	$data = '' !== $page ? statchasers_scin_fetch( $page ) : null;

	return $data;
}

/**
 * The page's title, H1 and description, as the API wrote them.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_scin_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_scin_request_data();
	$copy = statchasers_scin_parse_copy( null === $data ? '' : (string) $data['html'] );

	return $copy;
}

/**
 * The title/H1/description island out of a rendered fragment. Validated rather
 * than trusted: tags stripped, empty and unknown keys dropped.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_scin_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="scin-page-data">(.*?)</script>#s', $html, $m ) ) {
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
function statchasers_scin_title(): string {
	$copy = statchasers_scin_page_copy();
	return isset( $copy['title'] ) ? $copy['title'] : '';
}

/** The page's H1, or '' to leave the theme's. */
function statchasers_scin_h1(): string {
	$copy = statchasers_scin_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : '';
}

/** The meta description, or '' to leave the page's own. */
function statchasers_scin_description(): string {
	$copy = statchasers_scin_page_copy();
	return isset( $copy['description'] ) ? $copy['description'] : '';
}

/**
 * The page's canonical: the bare permalink, or '' off the tools' pages. Stated
 * rather than left to Rank Math, so no query string a link carries becomes a
 * canonical of its own.
 */
function statchasers_scin_canonical(): string {
	if ( ! statchasers_scin_post_has_shortcode() ) {
		return '';
	}
	$id = get_queried_object_id();
	return $id ? (string) get_permalink( $id ) : '';
}

/**
 * The heading the shortcode prints itself, in "Let the tool supply the
 * heading" mode or when a theme asks through the filter. The H1 is the one
 * the island names; the plugin's shared helper prints it, so it matches every
 * other tool's.
 *
 * @param string $page Which page is printing.
 */
function statchasers_scin_shortcode_heading( string $page ): string {
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_scin_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	// The copy is the mounted page's; a shortcode printed elsewhere (a widget)
	// reads the fragment it fetched instead.
	$h1 = statchasers_scin_h1();
	if ( '' === $h1 || statchasers_scin_page_mounted() !== $page ) {
		$data = statchasers_scin_fetch( $page );
		$copy = statchasers_scin_parse_copy( null === $data ? '' : (string) $data['html'] );
		$h1   = isset( $copy['h1'] ) ? $copy['h1'] : '';
	}

	return '' === $h1 ? '' : statchasers_page_heading_html( $h1 );
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

		$own = statchasers_scin_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

// The title is the API's (injuryPageCopy), used as it is - no suffix added.
// Any new wording needs mak's approval.
add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_scin_title();
		return '' === $own ? $title : $own;
	}
);
add_filter(
	'pre_get_document_title',
	static function ( $title ) {
		$own = statchasers_scin_title();
		return '' === $own ? $title : $own;
	},
	20
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_scin_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_scin_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_scin_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_scin_canonical();
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
function statchasers_scin_strip_islands( string $html ): string {
	if ( false === strpos( $html, 'scin-page-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scin-page-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_scin_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_scin_ssr_', $all );
}
