<?php
/**
 * The RB handcuff rankings shortcode: [statchasers_rb_handcuffs]
 *
 * Same posture as the other tools. The API serves /rb-handcuff-rankings with
 * `noindex, indexifembedded`, so the board is invisible to search until
 * something embeds it — this file is that something.
 *
 * ## What this replaces
 *
 * The tool shipped as a standalone Vite app in its own repository
 * (statchasersff-bit/Redraft-RB-Handcuff-Rankings) and its own plugin,
 * `statchasers-handcuffs`, which mounted it at /rb-handcuff-rankings/ with the
 * shortcode [statchasers_handcuffs]. That plugin printed a plain snapshot
 * table, then its React bundle cleared the table and drew its own, so the page
 * carried two renderings of one data file, kept in step by a build script and
 * a hand-synced build hash.
 *
 * Here the API renders the board and this shortcode prints it into the page,
 * like the other tools: every backup, his starter, score, tier, type and the
 * reasons behind his rank are in the HTML, and the bundle re-ranks, sorts and
 * compares on top of it without replacing it.
 *
 * Migrating: on the /rb-handcuff-rankings/ page, replace [statchasers_handcuffs]
 * with [statchasers_rb_handcuffs], then deactivate and delete the
 * statchasers-handcuffs plugin. The tags do not collide, so the two can coexist
 * while the swap is made — but both add a schema node for the tool, so do not
 * leave both on one page.
 *
 * ## What it keeps from that plugin
 *
 * Rank Math stays the SEO authority: nothing here prints a canonical, a title,
 * a robots directive or a heading. What it adds is what Rank Math cannot
 * know — that the page is a tool, as a CreativeWork node on Rank Math's graph,
 * and the FAQ the fragment prints under the board, as a FAQPage node beside
 * it — each with a standalone fallback when Rank Math is absent. And the
 * crawlable "Related tools" line under the board, filterable as it was.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_RB_HANDCUFFS_SHORTCODE = 'statchasers_rb_handcuffs';
const STATCHASERS_RB_HANDCUFFS_HANDLE    = 'statchasers-rb-handcuffs';

/**
 * How long a rendered fragment is reused before we ask the API again. An
 * hour, like the stats table: the board moves when somebody commits a new
 * snapshot, not on its own. `statchasers_news_flush()` clears this.
 */
const STATCHASERS_RB_HANDCUFFS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_RB_HANDCUFFS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up. */
const STATCHASERS_RB_HANDCUFFS_TIMEOUT = 6;

/* ------------------------------------------------------------- the fetch */

/**
 * Fetch the server-rendered fragment, cached.
 *
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_rb_handcuffs_fetch(): ?array {
	static $memo = null;
	if ( null !== $memo ) {
		return $memo ?: null;
	}

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin );
	$cache_key  = 'sc_rbh_ssr_' . $key;
	$backup_key = 'sc_rbh_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		$memo = '' === $cached['html'] ? false : $cached;
		return $memo ?: null;
	}

	$response = wp_remote_get(
		$origin . '/embed/rb-handcuffs',
		array(
			'timeout' => STATCHASERS_RB_HANDCUFFS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the API has no snapshot — a real state, not a transient
	// error. Cached as a failure for a minute so a deployment mid-setup costs
	// one request a minute.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute, so the next views do not
			// each retry the origin and wait out the timeout.
			set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
			$memo = $backup;
			return $memo;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		$memo = false;
		return null;
	}

	$payload = array(
		'html'    => $body,
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, STATCHASERS_RB_HANDCUFFS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_RB_HANDCUFFS_BACKUP_TTL );

	$memo = $payload;
	return $memo;
}

/**
 * The NFL season the board describes, read off the fragment's root, which
 * carries it for exactly this. Without a fragment, the same rule the API
 * uses: the calendar year, less one in January and February.
 *
 * @param string|null $html The fragment, when there is one.
 */
function statchasers_rb_handcuffs_season( ?string $html = null ): int {
	if ( null === $html ) {
		$data = statchasers_rb_handcuffs_fetch();
		$html = null === $data ? '' : (string) $data['html'];
	}
	if ( 1 === preg_match( '/data-season="(\d{4})"/', $html, $m ) ) {
		return (int) $m[1];
	}
	$year  = (int) gmdate( 'Y' );
	$month = (int) gmdate( 'n' );
	return $month < 3 ? $year - 1 : $year;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the board's compiled bundles. Its own handles, like
 * the other tools: a page mounting this shortcode should not download another
 * tool's stylesheet.
 */
function statchasers_rb_handcuffs_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_RB_HANDCUFFS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_RB_HANDCUFFS_HANDLE,
			$origin . '/rb-handcuffs.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_RB_HANDCUFFS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_RB_HANDCUFFS_HANDLE,
			$origin . '/dist/statchasers-rb-handcuffs.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_RB_HANDCUFFS_HANDLE );
	wp_enqueue_script( STATCHASERS_RB_HANDCUFFS_HANDLE );

	// The compare tray and the player card sit over the page, and must sit
	// over Divi's header too; and a phone should not read the board through
	// Divi's 10% margins. See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_RB_HANDCUFFS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_RB_HANDCUFFS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the board?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoised for the same reason too.
 */
function statchasers_rb_handcuffs_post_has_shortcode(): bool {
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

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_RB_HANDCUFFS_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_rb_handcuffs_post_has_shortcode() ) {
			return;
		}
		statchasers_rb_handcuffs_enqueue_assets();
	}
);

/* ------------------------------------------------------------ the shortcode */

/**
 * Crawlable links to the sibling tools, printed under the board.
 *
 * Plain <a href> with the destination's own subject as the anchor text, as the
 * standalone plugin had them. Filterable so the destinations live with the site
 * rather than in a build; returning an empty array removes the line. A link to
 * the page it is on is skipped.
 */
function statchasers_rb_handcuffs_related_links(): string {
	$links = apply_filters(
		'statchasers_rb_handcuffs_related_links',
		array(
			'/nfl/fantasy-football-strength-of-schedule/' => 'Fantasy Football Strength of Schedule',
			'/nfl/players/'                              => 'Fantasy Football Player Database',
		)
	);

	if ( empty( $links ) || ! is_array( $links ) ) {
		return '';
	}

	$id   = get_queried_object_id();
	$self = $id ? untrailingslashit( (string) get_permalink( $id ) ) : '';

	$parts = array();
	foreach ( $links as $path => $label ) {
		$url = ( 0 === strpos( (string) $path, 'http' ) ) ? (string) $path : home_url( (string) $path );
		if ( '' !== $self && untrailingslashit( $url ) === $self ) {
			continue;
		}
		$parts[] = '<a href="' . esc_url( $url ) . '">' . esc_html( (string) $label ) . '</a>';
	}

	if ( empty( $parts ) ) {
		return '';
	}

	return '<p class="rbh-related" style="font-size:14px;margin:14px 0 0">Related tools: '
		. implode( ' &middot; ', $parts ) . '</p>';
}

/**
 * The shortcode: prints the server-rendered board into the page.
 *
 * Same deliberate omissions as the other tools — no canonical, no heading, no
 * title or meta description, nothing written to the URL. The page owns all of
 * it.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes (none are read).
 * @return string HTML.
 */
function statchasers_rb_handcuffs_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers RB Handcuffs:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$data = statchasers_rb_handcuffs_fetch();

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_rb_handcuffs_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers RB Handcuffs:</strong> the API returned nothing. Check that the deployment is up and that it carries <code>data/rb-handcuffs/rankings.json</code>.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered RB handcuffs fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 */
	$html = (string) apply_filters(
		'statchasers_rb_handcuffs_fragment_html',
		statchasers_rb_handcuffs_strip_faq_data( (string) $data['html'] )
	);

	return $html . statchasers_rb_handcuffs_related_links();
}
add_shortcode( STATCHASERS_RB_HANDCUFFS_SHORTCODE, 'statchasers_rb_handcuffs_shortcode' );

/* ------------------------------------------------------------- the schema */

/**
 * The tool's node: a CreativeWork, as the standalone plugin settled on after
 * WebApplication cost it a permanent "aggregateRating is required" error in
 * Search Console. There is no genuine rating to publish, so there is none.
 *
 * MIRRORS handcuffPageMeta() in the API's rb-handcuffs-seo.ts, which describes
 * the same tool.
 *
 * @param string $url The page's own permalink.
 * @return array<string,mixed>
 */
function statchasers_rb_handcuffs_schema( string $url ): array {
	$season = statchasers_rb_handcuffs_season();

	return array(
		'@type'               => 'CreativeWork',
		'@id'                 => $url . '#rb-handcuff-rankings',
		'name'                => $season . ' Fantasy Football RB Handcuff Rankings',
		'url'                 => $url,
		'description'         => sprintf(
			'Every NFL backup running back ranked as a fantasy football handcuff for the %d season, scored on backfield opportunity, path to opportunity and player quality, with adjustable scoring weights and side-by-side comparison.',
			$season
		),
		'genre'               => 'Fantasy Football',
		'keywords'            => 'RB handcuffs, fantasy football, running back, NFL, ' . $season . ' season',
		'isAccessibleForFree' => true,
		'inLanguage'          => 'en-US',
	);
}

/**
 * The schema.org page types the board may be the mainEntity of: WebPage and
 * the subtypes a Rank Math page node plausibly carries, whose mainEntity is
 * free for the page's subject. Never FAQPage or QAPage.
 */
const STATCHASERS_RB_HANDCUFFS_PAGE_TYPES = array( 'WebPage', 'CollectionPage', 'ItemPage', 'AboutPage', 'ProfilePage', 'SearchResultsPage' );

/**
 * Graft the tool node onto Rank Math's graph, as the page's mainEntity.
 *
 * The WebPage node is found by its @type rather than its array key, because
 * the key Rank Math uses varies by page type.
 *
 * By a closed list of page types, not "any @type containing Page". FAQPage
 * contains it too, and this runs at priority 99 — after the FAQ island has put
 * its node in the graph — so the substring test could hang the board on the
 * FAQPage, whose mainEntity is its list of questions, and throw them away.
 * QAPage is left off for the same reason. And a node that already names a
 * mainEntity keeps it: this is an addition to the graph, never a replacement
 * of something another filter decided.
 *
 * @param array<string,mixed> $data Rank Math's graph.
 * @return array<string,mixed>
 */
function statchasers_rb_handcuffs_rank_math_schema( $data ) {
	if ( ! is_array( $data ) || ! statchasers_rb_handcuffs_post_has_shortcode() ) {
		return $data;
	}

	$id  = get_queried_object_id();
	$url = $id ? (string) get_permalink( $id ) : '';
	if ( '' === $url ) {
		return $data;
	}

	$data['statchasersRbHandcuffs'] = statchasers_rb_handcuffs_schema( $url );

	foreach ( $data as $key => $node ) {
		if ( 'statchasersRbHandcuffs' === $key || ! is_array( $node ) || empty( $node['@type'] ) ) {
			continue;
		}
		if ( ! empty( $node['mainEntity'] ) ) {
			continue;
		}
		if ( array_intersect( (array) $node['@type'], STATCHASERS_RB_HANDCUFFS_PAGE_TYPES ) ) {
			$data[ $key ]['mainEntity'] = array( '@id' => $url . '#rb-handcuff-rankings' );
			break;
		}
	}

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_rb_handcuffs_rank_math_schema', 99 );

/**
 * The node on its own when Rank Math is absent — never alongside it, so there
 * can never be two graphs.
 */
function statchasers_rb_handcuffs_print_fallback_schema(): void {
	if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
		return;
	}
	if ( ! statchasers_rb_handcuffs_post_has_shortcode() ) {
		return;
	}
	$id  = get_queried_object_id();
	$url = $id ? (string) get_permalink( $id ) : '';
	if ( '' === $url ) {
		return;
	}
	$schema = array_merge( array( '@context' => 'https://schema.org' ), statchasers_rb_handcuffs_schema( $url ) );
	echo '<script type="application/ld+json">'
		. wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) // phpcs:ignore WordPress.Security.EscapeOutput
		. '</script>';
}
add_action( 'wp_footer', 'statchasers_rb_handcuffs_print_fallback_schema', 99 );

/* ------------------------------------------------------------- faq schema */

/**
 * The questions this request's fragment is carrying.
 *
 * The rankings' arrangement (statchasers-rankings.php): the fragment ships its
 * FAQ as an inert JSON island, lifted here into one FAQPage on Rank Math's
 * graph, and stripped from what is printed. The fetch is the memoised one the
 * shortcode makes, so this costs no second round trip.
 *
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_rb_handcuffs_faq_items(): array {
	static $items = null;

	if ( null !== $items ) {
		return $items;
	}

	$items = array();

	if ( ! statchasers_rb_handcuffs_post_has_shortcode() ) {
		return $items;
	}

	$data = statchasers_rb_handcuffs_fetch();
	if ( null === $data || '' === (string) $data['html'] ) {
		return $items;
	}

	$items = statchasers_rb_handcuffs_faq_parse( (string) $data['html'] );

	return $items;
}

/**
 * Pull the Q&A island out of a rendered fragment. Validated rather than
 * trusted, as statchasers_rankings_faq_parse() is: a malformed entry is
 * dropped rather than emitted half-built.
 *
 * @param string $html Rendered fragment.
 * @return array<int,array{q:string,a:string}>
 */
function statchasers_rb_handcuffs_faq_parse( string $html ): array {
	$items = array();

	if ( false === strpos( $html, 'rbh-faq-data' ) ) {
		return $items;
	}

	if ( ! preg_match_all( '#<script type="application/json" class="rbh-faq-data">(.*?)</script>#s', $html, $matches ) ) {
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
function statchasers_rb_handcuffs_faq_node( string $webpage_id = '' ) {
	$items = statchasers_rb_handcuffs_faq_items();

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
 * containing one graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_rb_handcuffs_rank_math_faq( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_rb_handcuffs_faq_node( statchasers_news_schema_page_id( $data ) );
	if ( null === $node ) {
		return $data;
	}

	$data['statchasersRbHandcuffsFaq'] = $node;

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_rb_handcuffs_rank_math_faq', 20 );

/**
 * Fallback FAQPage for sites with no schema-graph plugin. Only the FAQPage,
 * for the reason the rankings fallback gives.
 */
function statchasers_rb_handcuffs_print_fallback_faq(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	$node = statchasers_rb_handcuffs_faq_node();
	if ( null === $node ) {
		return;
	}

	$payload = array( '@context' => 'https://schema.org' ) + $node;

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . // phpcs:ignore WordPress.Security.EscapeOutput
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_rb_handcuffs_print_fallback_faq', 20 );

/**
 * Drop the Q&A island from the markup that is printed. It is a transport for
 * the node above; the node reads the cached fetch, not this string.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_rb_handcuffs_strip_faq_data( string $html ): string {
	if ( false === strpos( $html, 'rbh-faq-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="rbh-faq-data">.*?</script>#s',
		'',
		$html
	);
}

/**
 * Clear cached renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_rb_handcuffs_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_rbh_ssr_', $all );
}
