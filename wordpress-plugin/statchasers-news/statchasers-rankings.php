<?php
/**
 * The redraft rankings shortcode: [statchasers_rankings]
 *
 * Same posture as the team hub, the player pages and the FPA table. The API
 * serves /rankings with `noindex, indexifembedded`, so the boards are invisible
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
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_RANKINGS_SHORTCODE = 'statchasers_rankings';
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
 * @return array{pos:string,season:int}
 */
function statchasers_rankings_args( array $atts ): array {
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
	);
}

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
}

/**
 * Does the request being rendered mount the rankings board?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out at
 * length in statchasers-team.php: Divi swaps the global post while rendering a
 * Theme Builder layout. Memoised for the same reason too.
 */
function statchasers_rankings_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_RANKINGS_SHORTCODE );

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
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Rankings:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_rankings_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_rankings_fetch( $args );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_rankings_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only adds tab
		// behaviour to markup that is already there. An empty string leaves the
		// rest of the page — the H1, the copy, the internal links — intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Rankings:</strong> the API returned nothing. Check that the deployment is up and that it has a <code>data/rankings/redraft-&lt;season&gt;.csv</code> file.</p>';
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
	return (string) apply_filters(
		'statchasers_rankings_fragment_html',
		statchasers_rankings_strip_faq_data( (string) $data['html'] ),
		$args['pos'],
		$args['season']
	);
}
add_shortcode( STATCHASERS_RANKINGS_SHORTCODE, 'statchasers_rankings_shortcode' );

/* ------------------------------------------------------------- faq schema */

/**
 * The questions this request's rankings fragment is carrying.
 *
 * Simpler than the team hub's equivalent: there is one mount, one fragment and
 * one FAQ, and the questions do not vary by tab — the five boards are one page,
 * so the position attribute changes which panel opens and nothing about what is
 * asked. The fetch is the cached one the shortcode is about to hit, so this
 * costs no second round trip, and the result is memoised because the Rank Math
 * filter and the fallback printer both ask.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_rankings_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$items = array();

	if ( ! statchasers_rankings_post_has_shortcode() ) {
		return $items;
	}

	// The default arguments. A page passing pos="rb" or a season gets the same
	// nine questions — they describe the rankings, not the open panel — so the
	// cheapest fetch that answers is the shared one.
	$data = statchasers_rankings_fetch( statchasers_rankings_args( array() ) );

	if ( null === $data || ! isset( $data['html'] ) || '' === $data['html'] ) {
		return $items;
	}

	$items = statchasers_rankings_faq_parse( (string) $data['html'] );

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
 * Fallback FAQPage for sites with no schema-graph plugin.
 *
 * Prints ONLY the FAQPage, for the reason the news fallback gives: with no SEO
 * plugin present, WebPage and Organization are a site-wide decision somebody
 * should make deliberately rather than something this tool improvises.
 */
function statchasers_rankings_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_rankings_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
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
	if ( false === strpos( $html, 'scr-faq-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scr-faq-data">.*?</script>#s',
		'',
		$html
	);
}

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
