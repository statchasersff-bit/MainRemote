<?php
/**
 * The Fantasy Points Allowed shortcode: [statchasers_fpa]
 *
 * Same posture as the team hub and the player pages. The API serves /fpa with
 * `noindex, indexifembedded`, so the table is invisible to search until
 * something embeds it - this file is that something.
 *
 * ## What this replaces
 *
 * The FPA tool shipped with its own WordPress plugin, "StatChasers Data Tools",
 * built the other way round: WordPress cached the JSON, exposed it at
 * `/wp-json/statchasers/v1/fpa`, and a browser bundle drew the table from it.
 * That works for a reader and not for search - the page's own HTML was an empty
 * container, which is the exact problem the news tool was moved off an iframe
 * to solve. This shortcode prints the table as markup instead.
 *
 * Migrating: replace `[statchasers_fpa]` on the page - the shortcode NAME is
 * deliberately the same, so a page that already has it needs no edit - then
 * deactivate StatChasers Data Tools. Both plugins registering the same tag
 * would collide, and WordPress keeps whichever registered last.
 *
 * ## What differs from the other two shortcodes
 *
 * There is no slug. One table, one page, so the attributes are the two pieces
 * of state the table has: scoring format and raw/adjusted.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_FPA_SHORTCODE = 'statchasers_fpa';
const STATCHASERS_FPA_HANDLE    = 'statchasers-fpa';

/**
 * How long a rendered fragment is reused before we ask the API again.
 *
 * Fifteen minutes rather than the other tools' five. This table is rebuilt by a
 * weekly ingest, so a five-minute TTL would mean a hundred and twenty pointless
 * round trips a day to learn nothing changed. The API's ETag catches a real
 * change on the first request after it either way.
 */
const STATCHASERS_FPA_CACHE_TTL = 15 * MINUTE_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_FPA_BACKUP_TTL = 7 * DAY_IN_SECONDS;

/**
 * Seconds to wait on the API before giving up.
 *
 * The render is one indexed query over 96 rows, so this is generous. The one
 * case it protects against is a cold deployment running its lazy ingest, which
 * downloads two CSVs - and that path deliberately does not block the response,
 * so even then the API answers immediately.
 */
const STATCHASERS_FPA_TIMEOUT = 6;

/** The scoring formats the API understands. Anything else falls back. */
const STATCHASERS_FPA_FORMATS = array( 'standard', 'half', 'ppr' );

/** The two views. */
const STATCHASERS_FPA_VIEWS = array( 'raw', 'adjusted' );

/**
 * One of a fixed set, read off the query string.
 *
 * The table's scoring and view controls are ordinary links, and the bundle
 * intercepts them so that changing format does not change the address of the
 * page. This is what happens when it cannot: scripting off, or a click that
 * landed before the bundle did. Without it the link goes somewhere that renders
 * the DEFAULT table, which is a control that appears to work and does not.
 *
 * Display state only - which of six renderings of one table to draw. It reads
 * nothing about the reader, writes nothing, and anything not in $allowed is
 * dropped rather than corrected, so no nonce is involved and no value from the
 * URL reaches the API unvalidated.
 *
 * @param string   $key     Query variable to read.
 * @param string[] $allowed The values that mean anything.
 * @return string The value, or '' when it is absent or not one of them.
 */
function statchasers_fpa_query_choice( string $key, array $allowed ): string {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
	if ( ! isset( $_GET[ $key ] ) ) {
		return '';
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
	$value = strtolower( trim( sanitize_text_field( wp_unslash( $_GET[ $key ] ) ) ) );

	return in_array( $value, $allowed, true ) ? $value : '';
}

/**
 * Normalize the shortcode attributes.
 *
 * Precedence is attribute, then query string, then default. A page that writes
 * `[statchasers_fpa format="ppr"]` has made a decision about what that page
 * shows, and a URL should not be able to overrule it; a page that wrote no
 * attribute has not, so the link the reader followed decides.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{format:string,view:string,season:int}
 */
function statchasers_fpa_args( array $atts ): array {
	// Which keys the page set, asked BEFORE shortcode_atts fills in the rest -
	// afterwards "absent" and "set to the default" are the same string.
	$given = array_change_key_case( $atts, CASE_LOWER );

	$atts = shortcode_atts(
		array(
			'format' => 'half',
			'view'   => 'raw',
			'season' => '',
		),
		$atts,
		STATCHASERS_FPA_SHORTCODE
	);

	$format = strtolower( trim( (string) $atts['format'] ) );
	if ( ! isset( $given['format'] ) ) {
		$from_url = statchasers_fpa_query_choice( 'format', STATCHASERS_FPA_FORMATS );
		if ( '' !== $from_url ) {
			$format = $from_url;
		}
	}
	if ( ! in_array( $format, STATCHASERS_FPA_FORMATS, true ) ) {
		$format = 'half';
	}

	$view = strtolower( trim( (string) $atts['view'] ) );
	if ( ! isset( $given['view'] ) ) {
		$from_url = statchasers_fpa_query_choice( 'view', STATCHASERS_FPA_VIEWS );
		if ( '' !== $from_url ) {
			$view = $from_url;
		}
	}
	if ( ! in_array( $view, STATCHASERS_FPA_VIEWS, true ) ) {
		$view = 'raw';
	}

	// A season is honored only when it is plausibly one. Left at 0 the API
	// serves whatever it is configured to treat as current, which is what a
	// page should normally do - a hard-coded season is a page that silently
	// shows last year's table next September.
	$season = (int) $atts['season'];
	if ( $season < 1999 || $season > 2100 ) {
		$season = 0;
	}
	// An archive address names its season, and that is the table it shows
	// whatever the attribute says: /2025/ is the 2025 page.
	if ( function_exists( 'statchasers_fpa_request_season' ) && statchasers_fpa_request_season() > 0 ) {
		$season = statchasers_fpa_request_season();
	}

	return array(
		'format' => $format,
		'view'   => $view,
		'season' => $season,
	);
}

/**
 * Fetch the server-rendered FPA fragment, cached.
 *
 * @param array{format:string,view:string,season:int} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_fpa_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_fpa_ssr_' . $key;
	$backup_key = 'sc_fpa_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$query = array(
		'format' => $args['format'],
		'view'   => $args['view'],
	);
	if ( $args['season'] > 0 ) {
		$query['season'] = (string) $args['season'];
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/fpa' ),
		array(
			'timeout' => STATCHASERS_FPA_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 here means the API has no ingested data - which is a real state, not
	// a transient error, and retrying every page view will not fix it. Cached as
	// a failure so a deployment mid-setup costs one request a minute.
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

	set_transient( $cache_key, $payload, STATCHASERS_FPA_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_FPA_BACKUP_TTL );

	return $payload;
}

/**
 * Register and enqueue the table's compiled bundles.
 *
 * Its own handles, like the other three tools: a page mounting this shortcode
 * should not download the news tool's stylesheet. The version is shared because
 * the build hashes every asset into one number.
 */
function statchasers_fpa_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_FPA_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_FPA_HANDLE,
			statchasers_public_origin() . '/fpa.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_FPA_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_FPA_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-fpa.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_FPA_HANDLE );
	wp_enqueue_script( STATCHASERS_FPA_HANDLE );

	if ( statchasers_fpa_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_FPA_HANDLE, statchasers_team_full_width_css() );
	}

	// Both unconditional where the block above is not. A tool printing through
	// the site's header, and a phone reading it through a 43px margin on each
	// side, are wrong on every page that mounts a tool - whether or not that
	// page also wants the sidebar's share of the row back.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_FPA_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_FPA_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the FPA table?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out at
 * length in statchasers-team.php: Divi swaps the global post while rendering a
 * Theme Builder layout. Memoized for the same reason too.
 */
function statchasers_fpa_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_FPA_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_fpa_post_has_shortcode() ) {
			return;
		}
		statchasers_fpa_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column?
 *
 * More load-bearing here than on the other two tools: this is a twelve-column
 * table of numbers, and Divi's 79.125% content column is where it starts
 * scrolling sideways on a desktop that has room for all of it.
 *
 * The CSS and the meta/body-class filters are the team file's; only the "does
 * this page mount the tool" question differs, so only that is restated.
 */
function statchasers_fpa_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_fpa_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the FPA table takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_fpa_full_width', true );
}

/**
 * Remove the sidebar markup on an FPA page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_fpa_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_fpa_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_fpa_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_fpa_full_width_body_class( array $classes ): array {
	if ( ! statchasers_fpa_wants_full_width() ) {
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
add_filter( 'body_class', 'statchasers_fpa_full_width_body_class', PHP_INT_MAX );

/**
 * The shortcode: prints the server-rendered FPA table into the page.
 *
 * Same deliberate omissions as the other three - no canonical, no <h1>, no
 * title or meta description, nothing written to the URL. The page owns all of
 * it, and the table's own format/view controls are ordinary links back to this
 * app's own /fpa, which is why SC_FPA_PATH exists on the API side.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_fpa_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers FPA:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_fpa_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_fpa_fetch( $args );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_fpa_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only adds sorting to
		// markup that is already there. An empty string leaves the rest of the
		// page - the H1, the copy, the internal links - intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers FPA:</strong> the API returned nothing. Check that the deployment is up and that the FPA ingest has run (<code>pnpm --filter @workspace/api-server run ingest-fpa</code>).</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered FPA fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html   Rendered fragment.
	 * @param string $format Scoring format.
	 * @param string $view   Raw or adjusted.
	 */
	return (string) apply_filters(
		'statchasers_fpa_fragment_html',
		statchasers_fpa_strip_faq_data( (string) $data['html'] ),
		$args['format'],
		$args['view']
	);
}
add_shortcode( STATCHASERS_FPA_SHORTCODE, 'statchasers_fpa_shortcode' );

/* ------------------------------------------------------------- faq schema */

/**
 * The questions this request's FPA fragment is carrying.
 *
 * Same shape as the rankings file's equivalent, and simpler than the team hub's
 * for the same reason: one mount, one fragment, one FAQ. The questions describe
 * fantasy points allowed, not the open view, so this passes NO attributes and
 * takes whatever statchasers_fpa_args() makes of that - which on a page that
 * writes no attributes of its own is the same combination the shortcode is
 * about to ask for, query string included, and therefore the same cached fetch.
 * A page that hard-codes format="ppr" costs one extra fetch against a
 * fifteen-minute TTL, and asks the same nineteen questions either way.
 *
 * Memoized because the Rank Math filter and the fallback printer both ask.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_fpa_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$items = array();

	if ( ! statchasers_fpa_post_has_shortcode() ) {
		return $items;
	}

	$data = statchasers_fpa_fetch( statchasers_fpa_args( array() ) );

	if ( null === $data || ! isset( $data['html'] ) || '' === $data['html'] ) {
		return $items;
	}

	$items = statchasers_fpa_faq_parse( (string) $data['html'] );

	return $items;
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
function statchasers_fpa_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'scf-faq-data' ) ) {
		return $items;
	}

	$found = preg_match_all(
		'#<script type="application/json" class="scf-faq-data">(.*?)</script>#s',
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
function statchasers_fpa_faq_node( string $webpage_id = '' ) {
	$items = statchasers_fpa_faq_items();

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
 * Same posture as the team, player and rankings files: append to the array Rank
 * Math hands us, so what ships is one <script> containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_fpa_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_fpa_faq_node( statchasers_news_schema_page_id( $data ) );

	if ( null === $node ) {
		return $data;
	}

	$data['statchasersFpaFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_fpa_rank_math_schema', 20 );

/**
 * Fallback FAQPage for sites with no schema-graph plugin.
 *
 * Prints ONLY the FAQPage, for the reason the news fallback gives: with no SEO
 * plugin present, WebPage and Organization are a site-wide decision somebody
 * should make deliberately rather than something this tool improvises.
 */
function statchasers_fpa_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_fpa_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_fpa_print_fallback_schema', 20 );

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
function statchasers_fpa_strip_faq_data( string $html ): string {
	if ( false === strpos( $html, 'scf-faq-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scf-faq-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached FPA renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_fpa_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_fpa_ssr_', $all );
}

/* ---------------------------------------------------------- the addresses */

/*
 * Two addresses, since 1.10.37 (mak's spec of 2026-10-10, "Fantasy points
 * allowed: week range in the title, a 2025 archive, and start/sit links").
 *
 * The page itself always carries the current season. Beneath it, `/2025/` -
 * any finished season the API holds game rows for - is a page of its own: the
 * full-season table, its own title, H1, description and self-canonical, in the
 * page sitemap. A rewrite rule onto the one WordPress page (`sc_fpa_season`),
 * the way the strength of schedule's position pages work: one post, one
 * shortcode, nothing for an editor to keep in sync. Next season the base URL
 * carries 2027 and `/2026/` becomes an archive by itself, because the API
 * decides which season is current and which are finished.
 *
 * `?season=2025` on the base page 301s to `/2025/`, and `/2026/` - the current
 * season by name - 301s to the base page, so no table has two addresses.
 */

/** The query var the rewrite sets: the four-digit season, or unset. */
const STATCHASERS_FPA_SEASON_VAR = 'sc_fpa_season';

/** The island the fragment carries its page copy in; see fpa-render.ts. */
const STATCHASERS_FPA_COPY_ISLAND = 'scf-page-data';

/**
 * The FPA page's path, no leading or trailing slash: what the season rule
 * hangs off. Filterable for a site that mounts the table somewhere else.
 */
function statchasers_fpa_page_path(): string {
	$path = (string) apply_filters(
		'statchasers_fpa_page_path',
		'nfl/fantasy-points-allowed-by-position'
	);
	return trim( $path, '/' );
}

/**
 * Whether the archive addresses are live. On by default.
 *
 *     add_filter( 'statchasers_fpa_page_urls', '__return_false' );
 *
 * Off, the page is one address again and `?season=` is read as it was before
 * 1.10.37 - a view of the one page, canonical to it.
 */
function statchasers_fpa_page_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_fpa_page_urls', true );
}

/** A season's public address, or the page's own for 0. */
function statchasers_fpa_page_url( int $season = 0 ): string {
	$path = '/' . statchasers_fpa_page_path();
	if ( $season > 0 ) {
		$path .= '/' . $season;
	}
	return user_trailingslashit( home_url( $path ) );
}

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = STATCHASERS_FPA_SEASON_VAR;
		return $vars;
	}
);

add_action(
	'init',
	static function (): void {
		if ( ! statchasers_fpa_page_urls_enabled() ) {
			return;
		}
		$page = statchasers_fpa_page_path();
		if ( '' === $page ) {
			return;
		}
		// Resolved by pagename, exactly as WordPress resolves the bare address;
		// only the season is added. Four digits, 1999 onwards, so an address
		// like /2025/ is the rule's and /foo/ still falls through to the 404.
		$rule = '^' . preg_quote( $page, '#' ) . '/((?:19|20)\d{2})/?$';
		add_rewrite_rule(
			$rule,
			'index.php?pagename=' . $page . '&' . STATCHASERS_FPA_SEASON_VAR . '=$matches[1]',
			'top'
		);

		// Same remedy as the SOS, rankings and matchup rules: a new rule is
		// dead until the table is rebuilt, and an upgrade runs no activation
		// hook, so remember the rule's signature and ask for the flush that
		// statchasers-news.php performs at the end of `init`.
		$signature = md5( $rule );
		if ( get_option( 'statchasers_fpa_rules' ) !== $signature ) {
			update_option( 'statchasers_fpa_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/**
 * The season this request's address names, or 0 on the page itself and off
 * the FPA page altogether. The query var is public, so without the page guard
 * `?sc_fpa_season=2025` on any article would retitle it as the archive.
 */
function statchasers_fpa_request_season(): int {
	if ( ! statchasers_fpa_page_urls_enabled() || ! statchasers_fpa_post_has_shortcode() ) {
		return 0;
	}
	$season = (int) get_query_var( STATCHASERS_FPA_SEASON_VAR );
	return ( $season >= 1999 && $season <= 2100 ) ? $season : 0;
}

/**
 * Where a request goes, or '' when it stays put. Pure, for the smoke test;
 * the redirect below calls it.
 *
 *   - `?season=2025` is the archive's address: `/2025/`;
 *   - `?season=2026`, the current season by name, is the page: the base URL;
 *   - `/2026/`, the same thing as a path, is the base URL too;
 *   - a season that is not one is dropped, and the request stays where it is.
 *
 * `format` and `view` ride along when they are valid and not the default -
 * they are the table's state, and a reader following a link to the PPR
 * adjusted table should still land on it.
 *
 * @param array<string,mixed> $get         The request's query ($_GET).
 * @param int                 $page_season The season the address names, or 0.
 * @param int                 $current     The season the page serves, or 0 when unknown.
 * @param bool                $page_is_live Whether the fetched table for the
 *                                          address's season is the current one.
 */
function statchasers_fpa_redirect_target( array $get, int $page_season, int $current, bool $page_is_live = false ): string {
	$target = null;

	if ( isset( $get['season'] ) && is_scalar( $get['season'] ) ) {
		$season = (int) trim( (string) $get['season'] );
		if ( $season < 1999 || $season > 2100 ) {
			// Not a season. Drop it: the page, or the archive the address names.
			$target = $page_season;
		} elseif ( $season === $current ) {
			$target = 0;
		} else {
			$target = $season;
		}
	} elseif ( $page_season > 0 && ( $page_is_live || $page_season === $current ) ) {
		// The current season under its own name is the page.
		$target = 0;
	}

	if ( null === $target ) {
		return '';
	}

	$keep = array();
	foreach ( array( 'format' => STATCHASERS_FPA_FORMATS, 'view' => STATCHASERS_FPA_VIEWS ) as $key => $allowed ) {
		if ( ! isset( $get[ $key ] ) || ! is_scalar( $get[ $key ] ) ) {
			continue;
		}
		$value = strtolower( trim( (string) $get[ $key ] ) );
		if ( in_array( $value, $allowed, true ) && $value !== ( 'format' === $key ? 'half' : 'raw' ) ) {
			$keep[ $key ] = $value;
		}
	}

	$url = statchasers_fpa_page_url( $target );
	return $keep ? add_query_arg( $keep, $url ) : $url;
}

/**
 * `?season=` 301s to the season's address, and the current season's address
 * 301s to the page, before anything renders; a season the API has no table
 * for is a 404, not an empty page.
 */
function statchasers_fpa_season_redirect(): void {
	if ( ! statchasers_fpa_page_urls_enabled() || ! statchasers_fpa_post_has_shortcode() ) {
		return;
	}

	$page_season = statchasers_fpa_request_season();
	$copy        = statchasers_fpa_page_copy();
	$current     = isset( $copy['currentSeason'] ) ? (int) $copy['currentSeason'] : 0;
	$is_live     = isset( $copy['kind'] ) && 'live' === $copy['kind'];

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a read-only redirect.
	$target = statchasers_fpa_redirect_target( wp_unslash( $_GET ), $page_season, $current, $page_season > 0 && $is_live );
	if ( '' !== $target ) {
		wp_safe_redirect( $target, 301 );
		exit;
	}

	if ( $page_season > 0 && null === statchasers_fpa_request_data() ) {
		global $wp_query;
		if ( $wp_query instanceof WP_Query && method_exists( $wp_query, 'set_404' ) ) {
			$wp_query->set_404();
		}
		status_header( 404 );
		nocache_headers();
	}
}
add_action( 'template_redirect', 'statchasers_fpa_season_redirect', 9 );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoized: what the title filters,
 * the hero rewrite and the sitemap read. The same table the shortcode
 * resolves with no attributes - the address's season included - so on a page
 * whose shortcode carries none it is the same cached transient.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_fpa_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$data = statchasers_fpa_post_has_shortcode()
		? statchasers_fpa_fetch( statchasers_fpa_args( array() ) )
		: null;

	return $data;
}

/**
 * The page's words as the API wrote them (fpa-seo.ts): title, H1,
 * description, the Updated line and its date, which season and kind, and the
 * archive seasons. Empty off the FPA page and against an API older than the
 * island - except on an archive address, where the spec's own words stand in
 * so the address, the title and the H1 agree whatever the API's age.
 *
 * @return array<string,mixed>
 */
function statchasers_fpa_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_fpa_request_data();
	$copy = statchasers_fpa_parse_copy( null === $data ? '' : (string) $data['html'] );

	$season = statchasers_fpa_request_season();
	if ( $season > 0 && null !== $data && ! isset( $copy['h1'] ) ) {
		$copy = array(
			'title'       => sprintf( 'Fantasy Points Allowed by Position %d (Full Season)', $season ),
			'h1'          => sprintf( '%d Fantasy Points Allowed by Position', $season ),
			'description' => sprintf( 'Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses over the full %d season (Weeks 1–17), raw and schedule-adjusted.', $season ),
			'season'      => $season,
			'kind'        => 'archive',
		);
	}

	return $copy;
}

/**
 * The page-data island out of a rendered fragment. Validated rather than
 * trusted: strings stripped of tags, numbers cast, the season list filtered
 * to seasons, and unknown keys dropped.
 *
 * @param string $html Rendered fragment.
 * @return array<string,mixed>
 */
function statchasers_fpa_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="' . STATCHASERS_FPA_COPY_ISLAND . '">(.*?)</script>#s', $html, $m ) ) {
		return $copy;
	}

	$decoded = json_decode( $m[1], true );
	if ( ! is_array( $decoded ) ) {
		return $copy;
	}

	foreach ( array( 'title', 'h1', 'description', 'answer', 'updatedLine', 'updatedIso', 'updatedAt', 'kind' ) as $key ) {
		if ( isset( $decoded[ $key ] ) && is_string( $decoded[ $key ] ) ) {
			$value = trim( wp_strip_all_tags( $decoded[ $key ] ) );
			if ( '' !== $value ) {
				$copy[ $key ] = $value;
			}
		}
	}
	foreach ( array( 'season', 'weekNumber' ) as $key ) {
		if ( isset( $decoded[ $key ] ) && is_numeric( $decoded[ $key ] ) ) {
			$copy[ $key ] = (int) $decoded[ $key ];
		}
	}
	// The island does not carry the current season outright: the live table is
	// it, and an archive's list of other seasons is of finished ones only. So
	// it is the live table's own season, and otherwise unknown (0).
	if ( isset( $copy['kind'], $copy['season'] ) && 'live' === $copy['kind'] ) {
		$copy['currentSeason'] = (int) $copy['season'];
	} elseif ( isset( $decoded['currentSeason'] ) && is_numeric( $decoded['currentSeason'] ) ) {
		$copy['currentSeason'] = (int) $decoded['currentSeason'];
	}
	if ( isset( $decoded['archiveSeasons'] ) && is_array( $decoded['archiveSeasons'] ) ) {
		$seasons = array();
		foreach ( $decoded['archiveSeasons'] as $season ) {
			if ( is_numeric( $season ) && (int) $season >= 1999 && (int) $season <= 2100 ) {
				$seasons[] = (int) $season;
			}
		}
		$copy['archiveSeasons'] = array_values( array_unique( $seasons ) );
	}

	return $copy;
}

/** The document title, or '' to leave the page's own. */
function statchasers_fpa_title(): string {
	$copy = statchasers_fpa_page_copy();
	return isset( $copy['title'] ) ? (string) $copy['title'] : '';
}

/** The page's H1, or '' to leave the page's own. */
function statchasers_fpa_h1(): string {
	$copy = statchasers_fpa_page_copy();
	return isset( $copy['h1'] ) ? (string) $copy['h1'] : '';
}

/** The meta description, or '' to leave the page's own. */
function statchasers_fpa_description(): string {
	$copy = statchasers_fpa_page_copy();
	return isset( $copy['description'] ) ? (string) $copy['description'] : '';
}

/** "Updated Oct 8, through Week 5", or ''. */
function statchasers_fpa_updated_line(): string {
	$copy = statchasers_fpa_page_copy();
	return isset( $copy['updatedLine'] ) ? (string) $copy['updatedLine'] : '';
}

/**
 * The page's canonical: the season's address on an archive, else the bare
 * permalink, whatever format or view the query string asks for; '' off the
 * FPA page. Stated rather than left to Rank Math, because `?format=&view=`
 * is six addresses for one table and none of them may become a canonical.
 */
function statchasers_fpa_canonical(): string {
	if ( ! statchasers_fpa_post_has_shortcode() ) {
		return '';
	}
	$season = statchasers_fpa_request_season();
	if ( $season > 0 ) {
		return statchasers_fpa_page_url( $season );
	}
	$id = get_queried_object_id();
	return $id ? (string) get_permalink( $id ) : '';
}

// The title names the subject, the season and the week range in full, so it
// is used as it is - no " | StatChasers" suffix, which would push it past what
// a results page shows (mak, 2026-10-10).
add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_fpa_title();
		return '' === $own ? $title : $own;
	}
);
add_filter(
	'pre_get_document_title',
	static function ( $title ) {
		$own = statchasers_fpa_title();
		return '' === $own ? $title : $own;
	},
	20
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_fpa_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_fpa_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_fpa_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_fpa_canonical();
		return '' === $own ? $canonical : $own;
	}
);

/**
 * The theme's page title, where a template prints one. The FPA page's own
 * heading is a hero written into the page (below), so on the live site this
 * filter rewrites nothing visible; it is here so a template that does print
 * the title says the same thing the hero does.
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

		$own = statchasers_fpa_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

/**
 * Rewrite the page's hand-written hero.
 *
 * The FPA page carries its own heading: a `.sc-lo-hero` block written into a
 * Divi Code module, with the H1 and the lead paragraph as literal HTML. The
 * title filters cannot reach it, so this one does, on the finished content:
 * the H1's text becomes the API's ("Fantasy Points Allowed by Position: Weeks
 * 1–5, 2026", or the archive's), and the "Updated Oct 8, through Week 5" line
 * goes in under the gold rule, above the lead. A page with no hero of its own
 * gets the line printed above the table instead, and in "Let the tool supply
 * the heading" mode the generated hero too, as the other tools print theirs.
 *
 * Pure in the middle (statchasers_fpa_rewrite_hero) for the smoke test; the
 * filter around it carries the guards every content filter here carries.
 *
 * @param string $content The page's rendered content.
 * @param string $h1      The heading to print.
 * @param string $updated The Updated line, or ''.
 * @param bool   $hero    Whether to print a generated hero when the content has none.
 */
function statchasers_fpa_rewrite_hero( string $content, string $h1, string $updated, bool $hero = false ): string {
	if ( '' === $h1 && '' === $updated ) {
		return $content;
	}

	$updated_html = '' === $updated
		? ''
		: '<p class="sc-lo-hero__updated scf-updated">' . esc_html( $updated ) . '</p>';

	$pattern = '#(<h1\b[^>]*\bclass="[^"]*\bsc-lo-hero__h1\b[^"]*"[^>]*>)(.*?)(</h1>)#s';
	if ( preg_match( $pattern, $content ) ) {
		if ( '' !== $h1 ) {
			$content = (string) preg_replace( $pattern, '${1}' . str_replace( array( '\\', '$' ), array( '\\\\', '\$' ), esc_html( $h1 ) ) . '${3}', $content, 1 );
		}
		if ( '' !== $updated_html ) {
			$count   = 0;
			$content = (string) preg_replace(
				'#(<div class="sc-lo-hero__underline"[^>]*>\s*</div>)#',
				'${1}' . str_replace( array( '\\', '$' ), array( '\\\\', '\$' ), $updated_html ),
				$content,
				1,
				$count
			);
			if ( 0 === $count ) {
				// A hero with no rule: the line follows the heading itself.
				$content = (string) preg_replace( $pattern, '${0}' . str_replace( array( '\\', '$' ), array( '\\\\', '\$' ), $updated_html ), $content, 1 );
			}
		}
		return $content;
	}

	// No hero in the content. The line (and, when asked, a generated hero) go
	// in front of the fragment, which is the first thing on the page after it.
	$prefix = '';
	if ( $hero && '' !== $h1 && function_exists( 'statchasers_page_heading_html' ) ) {
		$prefix .= statchasers_page_heading_html( $h1, '' );
	}
	$prefix .= $updated_html;
	if ( '' === $prefix ) {
		return $content;
	}
	$count   = 0;
	$content = (string) preg_replace(
		'#<div class="scf is-embed"#',
		str_replace( array( '\\', '$' ), array( '\\\\', '\$' ), $prefix ) . '${0}',
		$content,
		1,
		$count
	);
	return $content;
}

add_filter(
	'the_content',
	static function ( $content ) {
		if ( ! is_string( $content ) || ! is_singular() || ! is_main_query() || ! statchasers_fpa_post_has_shortcode() ) {
			return $content;
		}
		// Once per request: Divi and the theme can run the content filter more
		// than once, and a second pass would find the heading already rewritten
		// and print the Updated line twice.
		static $done = false;
		if ( $done ) {
			return $content;
		}
		$done = true;

		$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' ) && statchasers_h1_tool_supplies_heading();

		return statchasers_fpa_rewrite_hero(
			$content,
			statchasers_fpa_h1(),
			statchasers_fpa_updated_line(),
			$tool_mode || (bool) apply_filters( 'statchasers_fpa_shortcode_h1', false )
		);
	},
	// After Divi has turned its modules into markup (it hooks the_content at
	// its default priority), so the hero is HTML by the time this reads it.
	PHP_INT_MAX
);

/**
 * Drop the page-data island from the printed markup. It is transport for the
 * filters above, which read the cached fetch rather than this string.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_fpa_strip_copy_island( string $html ): string {
	if ( false === strpos( $html, STATCHASERS_FPA_COPY_ISLAND ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="' . STATCHASERS_FPA_COPY_ISLAND . '">.*?</script>#s',
		'',
		$html
	);
}
add_filter( 'statchasers_fpa_fragment_html', 'statchasers_fpa_strip_copy_island', 5 );

/* ---------------------------------------------------------- modified time */

/**
 * The date the figures were written, as the page's modified time: Rank Math's
 * og:updated_time and article:modified_time (both spellings of the hook, as
 * the matchup file registers its og tags), and dateModified on the graph's
 * WebPage node - added when the graph has none, as on these pages, with the
 * FAQ made part of it. The post's own modified time is the day the page was
 * last edited, which said September while the table ran through Week 5.
 */
function statchasers_fpa_modified_iso(): string {
	$copy = statchasers_fpa_page_copy();
	if ( isset( $copy['updatedAt'] ) && '' !== $copy['updatedAt'] ) {
		return (string) $copy['updatedAt'];
	}
	return isset( $copy['updatedIso'] ) ? (string) $copy['updatedIso'] : '';
}

foreach ( array(
	'rank_math/opengraph/facebook/og_updated_time',
	'rank_math/opengraph/facebook/og:updated_time',
	'rank_math/opengraph/facebook/article_modified_time',
	'rank_math/opengraph/facebook/article:modified_time',
) as $statchasers_fpa_hook ) {
	add_filter(
		$statchasers_fpa_hook,
		static function ( $value ) {
			$own = statchasers_fpa_modified_iso();
			return '' === $own ? $value : $own;
		},
		20
	);
}
unset( $statchasers_fpa_hook );

/**
 * dateModified on the graph's page node.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_fpa_modified_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$copy = statchasers_fpa_page_copy();
	if ( empty( $copy['updatedIso'] ) ) {
		return $data;
	}

	// A date, not a datetime: the line under the heading carries a day.
	$modified = (string) $copy['updatedIso'];
	$url      = statchasers_fpa_canonical();

	foreach ( $data as $key => $node ) {
		if ( ! is_array( $node ) || empty( $node['@type'] ) ) {
			continue;
		}
		foreach ( (array) $node['@type'] as $type ) {
			if ( is_string( $type ) && false !== strpos( $type, 'Page' ) && 'FAQPage' !== $type ) {
				$data[ $key ]['dateModified'] = $modified;
				return $data;
			}
		}
	}

	$page_id = '' === $url ? '' : $url . '#webpage';
	$page    = array(
		'@type'        => 'WebPage',
		'name'         => statchasers_fpa_title(),
		'description'  => statchasers_fpa_description(),
		'dateModified' => $modified,
	);
	if ( '' !== $page_id ) {
		$page['@id'] = $page_id;
		$page['url'] = $url;
	}
	$data = array( 'statchasersFpaPage' => $page ) + $data;

	if ( '' !== $page_id && isset( $data['statchasersFpaFaq'] ) && is_array( $data['statchasersFpaFaq'] ) ) {
		$data['statchasersFpaFaq']['isPartOf'] = array( '@id' => $page_id );
	}

	return $data;
}
// After the FAQ node (priority 20), so the page node can claim it.
add_filter( 'rank_math/json_ld', 'statchasers_fpa_modified_schema', 25 );

/* ------------------------------------------------------------- the sitemap */

/**
 * The archive addresses, appended to Rank Math's page sitemap.
 *
 * Each is its own canonical, and an address with no post behind it is one
 * Rank Math cannot list by itself. Which seasons exist is the API's to say -
 * the island on the page's own table lists them - so this follows that list:
 * only while the page exists, is published, still mounts the table, the
 * archive addresses are on, and the API names at least one finished season.
 */
function statchasers_fpa_sitemap_entries(): string {
	if ( ! statchasers_fpa_page_urls_enabled() ) {
		return '';
	}
	$page = get_page_by_path( statchasers_fpa_page_path() );
	if ( ! $page instanceof WP_Post || 'publish' !== $page->post_status ) {
		return '';
	}
	if ( ! has_shortcode( (string) $page->post_content, STATCHASERS_FPA_SHORTCODE ) ) {
		return '';
	}
	// The page's own table, not this request's: the sitemap is built on a
	// request of its own, where no address names a season.
	$data = statchasers_fpa_fetch( array( 'format' => 'half', 'view' => 'raw', 'season' => 0 ) );
	$copy = statchasers_fpa_parse_copy( null === $data ? '' : (string) $data['html'] );
	if ( empty( $copy['archiveSeasons'] ) || ! is_array( $copy['archiveSeasons'] ) ) {
		return '';
	}
	$extra = '';
	foreach ( $copy['archiveSeasons'] as $season ) {
		$extra .= statchasers_team_sitemap_entry( statchasers_fpa_page_url( (int) $season ), '' );
	}
	return $extra;
}

add_filter(
	'rank_math/sitemap/page_content',
	static function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}
		return $content . statchasers_fpa_sitemap_entries();
	}
);
