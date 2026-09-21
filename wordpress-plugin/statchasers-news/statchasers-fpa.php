<?php
/**
 * The Fantasy Points Allowed shortcode: [statchasers_fpa]
 *
 * Same posture as the team hub and the player pages. The API serves /fpa with
 * `noindex, indexifembedded`, so the table is invisible to search until
 * something embeds it — this file is that something.
 *
 * ## What this replaces
 *
 * The FPA tool shipped with its own WordPress plugin, "StatChasers Data Tools",
 * built the other way round: WordPress cached the JSON, exposed it at
 * `/wp-json/statchasers/v1/fpa`, and a browser bundle drew the table from it.
 * That works for a reader and not for search — the page's own HTML was an empty
 * container, which is the exact problem the news tool was moved off an iframe
 * to solve. This shortcode prints the table as markup instead.
 *
 * Migrating: replace `[statchasers_fpa]` on the page — the shortcode NAME is
 * deliberately the same, so a page that already has it needs no edit — then
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
 * downloads two CSVs — and that path deliberately does not block the response,
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
 * Display state only — which of six renderings of one table to draw. It reads
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
 * Normalise the shortcode attributes.
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
	// Which keys the page set, asked BEFORE shortcode_atts fills in the rest —
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

	// A season is honoured only when it is plausibly one. Left at 0 the API
	// serves whatever it is configured to treat as current, which is what a
	// page should normally do — a hard-coded season is a page that silently
	// shows last year's table next September.
	$season = (int) $atts['season'];
	if ( $season < 1999 || $season > 2100 ) {
		$season = 0;
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

	// A 404 here means the API has no ingested data — which is a real state, not
	// a transient error, and retrying every page view will not fix it. Cached as
	// a failure so a deployment mid-setup costs one request a minute.
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
			$origin . '/fpa.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_FPA_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_FPA_HANDLE,
			$origin . '/dist/statchasers-fpa.js',
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
}

/**
 * Does the request being rendered mount the FPA table?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out at
 * length in statchasers-team.php: Divi swaps the global post while rendering a
 * Theme Builder layout. Memoised for the same reason too.
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
 * Same deliberate omissions as the other three — no canonical, no <h1>, no
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

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_fpa_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only adds sorting to
		// markup that is already there. An empty string leaves the rest of the
		// page — the H1, the copy, the internal links — intact.
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
 * takes whatever statchasers_fpa_args() makes of that — which on a page that
 * writes no attributes of its own is the same combination the shortcode is
 * about to ask for, query string included, and therefore the same cached fetch.
 * A page that hard-codes format="ppr" costs one extra fetch against a
 * fifteen-minute TTL, and asks the same nineteen questions either way.
 *
 * Memoised because the Rank Math filter and the fallback printer both ask.
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
 */
function statchasers_fpa_flush(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_sc_fpa_ssr_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_sc_fpa_ssr_' ) . '%'
		)
	);
}
