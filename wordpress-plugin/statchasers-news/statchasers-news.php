<?php
/**
 * Plugin Name:       StatChasers
 * Description:       Creates the NFL team, player and matchup pages for you, then mounts the StatChasers tools into them — the news feed, team hubs, player profiles, matchups, Fantasy Points Allowed, rest-of-season rankings, the schedule, advanced player stats and RB handcuff rankings. Server-rendered markup in the page's own HTML, with the compiled bundles loaded through the WordPress enqueue system. No iframe.
 * Version:           1.10.11
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            StatChasers
 * License:           GPL-2.0-or-later
 *
 * Why this exists
 * ---------------
 * The tool used to be embedded as a cross-origin <iframe>. That works for
 * readers but not for search: the parent page's HTML contained a frame and
 * nothing else, so none of the headlines, players or timestamps belonged to the
 * statchasers.com URL, and the content only existed after the frame loaded and
 * ran its own JavaScript.
 *
 * This plugin renders the same tool state on the server and prints it into the
 * page body, then enqueues the compiled JS/CSS so the client can enhance what
 * is already there. Same content for readers and crawlers — no bot-only markup,
 * no hidden keyword text, nothing gated behind a click.
 *
 * @package StatChasers\News
 */

// No `declare( strict_types = 1 )` on purpose: this file hooks core filters,
// and WordPress (and other plugins) are not consistent about passing exactly
// the scalar types a signature declares. Strict mode would turn a harmless
// null into a fatal on someone else's site.

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The plugin's own version: the Version header above, repeated.
 *
 * It is the enqueue `ver` whenever /embed/assets.json cannot be read, so it
 * has to change when the plugin does — it sat at 1.7.0 through every release
 * since, which pinned the fallback ver= to one string for good and made a
 * browser's cached CSS and JS outlive every upgrade that happened during an
 * outage. scripts/build-zip.sh refuses to build when this and the header
 * disagree, so a release bumps both or ships neither.
 */
const STATCHASERS_NEWS_VERSION       = '1.10.11';
const STATCHASERS_NEWS_SHORTCODE     = 'statchasers_news';
const STATCHASERS_NEWS_HANDLE        = 'statchasers-news';
const STATCHASERS_NEWS_OPTION_ORIGIN = 'statchasers_news_origin';

// The other tools' shortcodes. Required after the constants above and
// before any hook registration, because they reuse this file's origin,
// asset-version and canonical helpers — all of which are function declarations
// and so are available regardless of order, but the constants are not.
//
// The team file must come FIRST. The player, FPA, rankings, schedule and
// advanced stats files each reuse its Divi detection and full-width stylesheet
// rather than carrying a copy apiece, and while function declarations hoist
// within a file they do not hoist across an include that has not run yet.
require_once __DIR__ . '/statchasers-assets.php';
require_once __DIR__ . '/statchasers-team.php';
require_once __DIR__ . '/statchasers-team-pages.php';
require_once __DIR__ . '/statchasers-matchup.php';
require_once __DIR__ . '/statchasers-player.php';
require_once __DIR__ . '/statchasers-fpa.php';
require_once __DIR__ . '/statchasers-rankings.php';
require_once __DIR__ . '/statchasers-schedule.php';
require_once __DIR__ . '/statchasers-player-stats.php';
require_once __DIR__ . '/statchasers-rb-handcuffs.php';
// After the three they build on: the player builder uses the team file's
// fill_meta() and season constant, and the heading module asks the team file
// for a page to measure.
require_once __DIR__ . '/statchasers-player-pages.php';
require_once __DIR__ . '/statchasers-h1.php';

/** How long a rendered fragment is reused before we ask the API again. */
const STATCHASERS_NEWS_CACHE_TTL = 5 * MINUTE_IN_SECONDS;

/**
 * How long the last good render is kept as a fallback. If the API is slow or
 * down at render time we serve this rather than an empty page — a stale but
 * real list beats a blank container.
 */
const STATCHASERS_NEWS_BACKUP_TTL = DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up and using the backup. */
const STATCHASERS_NEWS_TIMEOUT = 5;

/**
 * Origin of the news API / asset host, without a trailing slash.
 *
 * Set it in wp-config.php:
 *   define( 'STATCHASERS_NEWS_ORIGIN', 'https://news.statchasers.com' );
 *
 * ...or filter `statchasers_news_origin`. Falls back to the option so it can be
 * set with WP-CLI without editing config.
 */
function statchasers_news_origin(): string {
	$origin = '';

	if ( defined( 'STATCHASERS_NEWS_ORIGIN' ) ) {
		$origin = (string) constant( 'STATCHASERS_NEWS_ORIGIN' );
	}

	if ( '' === $origin ) {
		$origin = (string) get_option( STATCHASERS_NEWS_OPTION_ORIGIN, '' );
	}

	/**
	 * Filters the StatChasers news origin.
	 *
	 * @param string $origin Origin URL, no trailing slash.
	 */
	$origin = (string) apply_filters( 'statchasers_news_origin', $origin );

	return untrailingslashit( esc_url_raw( $origin ) );
}

/**
 * Normalise shortcode attributes into the query the API understands.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{limit:int,page_size:int,heading:int,heading_text:string}
 */
function statchasers_news_args( array $atts ): array {
	$atts = shortcode_atts(
		array(
			'limit'        => 250,
			'page_size'    => 4,
			'heading'      => '1',
			'heading_text' => '',
			'player_url'   => '',
			'team_url'     => '',
			'related'      => '',
			'vitals'       => '',
		),
		$atts,
		STATCHASERS_NEWS_SHORTCODE
	);

	return array(
		'limit'        => max( 1, min( 250, (int) $atts['limit'] ) ),
		'page_size'    => max( 1, min( 50, (int) $atts['page_size'] ) ),
		// heading="0" when the page already has its own section heading above
		// the tool, so we don't emit a second one.
		'heading'      => in_array( (string) $atts['heading'], array( '0', 'false', 'no' ), true ) ? 0 : 1,
		// Word the tool's H2 to agree with the page's H1 and <title>. Google may
		// derive the displayed result title from any of them, so they should not
		// contradict one another.
		'heading_text' => sanitize_text_field( (string) $atts['heading_text'] ),
		// URL templates that turn player/team names already shown in the tool
		// into real internal links. Empty by default: only set these for pages
		// that actually exist, or you'll generate internal links to 404s.
		'player_url'   => sanitize_text_field( (string) $atts['player_url'] ),
		'team_url'     => sanitize_text_field( (string) $atts['team_url'] ),
		// "Label|/url; Label|/url" — crawlable links to related tools.
		'related'      => sanitize_text_field( (string) $atts['related'] ),
		// Endpoint for real-user Core Web Vitals reports. Empty = monitoring
		// off and the vitals bundle is never even downloaded.
		'vitals'       => esc_url_raw( (string) $atts['vitals'] ),
	);
}

/**
 * What a failed fetch returns: the last good render instead of a hole in the
 * page. Either way the outcome is held under the fresh key for a minute, so
 * while the origin is down each view does not retry it and wait out the
 * timeout — once a minute is enough to notice it is back.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_news_fetch_failed( string $cache_key, string $backup_key ): ?array {
	$backup = get_transient( $backup_key );
	if ( is_array( $backup ) && isset( $backup['html'] ) ) {
		set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
		return $backup;
	}
	set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
	return null;
}

/**
 * Fetch the server-rendered fragment, cached.
 *
 * @param array{limit:int,page_size:int,heading:int} $args Render arguments.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_news_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $args ) );
	$cache_key  = 'sc_news_ssr_' . $key;
	$backup_key = 'sc_news_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		// An empty render is a failure remembered for a minute (below).
		return '' === $cached['html'] ? null : $cached;
	}

	$query = array(
		'limit'     => $args['limit'],
		'page_size' => $args['page_size'],
		'heading'   => $args['heading'],
		// So Core Web Vitals measured inside the tool are attributed to the
		// page being ranked rather than to the API origin.
		'page_url'  => statchasers_news_canonical_guess(),
	);

	foreach ( array( 'heading_text', 'player_url', 'team_url', 'related' ) as $optional ) {
		if ( '' !== $args[ $optional ] ) {
			$query[ $optional ] = $args[ $optional ];
		}
	}

	if ( '' !== $args['vitals'] ) {
		$query['vitals_endpoint'] = $args['vitals'];
	}

	$url = add_query_arg( array_map( 'rawurlencode', $query ), $origin . '/embed/ssr' );

	$response = wp_remote_get(
		$url,
		array(
			'timeout' => STATCHASERS_NEWS_TIMEOUT,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return statchasers_news_fetch_failed( $cache_key, $backup_key );
	}

	$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

	if ( ! is_array( $body ) || empty( $body['ok'] ) || ! isset( $body['html'] ) || ! is_string( $body['html'] ) ) {
		return statchasers_news_fetch_failed( $cache_key, $backup_key );
	}

	$payload = array(
		'html'    => (string) $body['html'],
		'version' => isset( $body['version'] ) ? (string) $body['version'] : STATCHASERS_NEWS_VERSION,
	);

	set_transient( $cache_key, $payload, STATCHASERS_NEWS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_NEWS_BACKUP_TTL );

	return $payload;
}

/**
 * Content hash of the deployed bundles, used as the enqueue version so a deploy
 * busts caches. Cached on its own (rather than read off a rendered fragment) so
 * enqueuing never depends on which shortcode arguments a page happens to use.
 *
 * @return string
 */
function statchasers_news_asset_version(): string {
	$cached = get_transient( 'sc_news_asset_version' );
	if ( is_string( $cached ) && '' !== $cached ) {
		return $cached;
	}

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return STATCHASERS_NEWS_VERSION;
	}

	$response = wp_remote_get(
		$origin . '/embed/assets.json',
		array(
			'timeout' => STATCHASERS_NEWS_TIMEOUT,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	$version = STATCHASERS_NEWS_VERSION;

	if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		// ! empty() rather than isset(), and deliberately: "0" is the API's
		// sentinel for "I could not read my own version.json", not a version.
		// Taking it at face value would pin every browser's copy of the CSS and
		// JS to the literal string 0 forever. Falling back to the constant below
		// is the better of the two wrong answers — it at least changes when this
		// file does. If the enqueued ver= is stuck at STATCHASERS_NEWS_VERSION,
		// the deployment is not serving a built version.json and that is where
		// to look; nothing here can fix it.
		if ( is_array( $body ) && ! empty( $body['version'] ) ) {
			$version = (string) $body['version'];
		}
	}

	// Cache failures too, briefly, so an unreachable API doesn't add a timeout
	// to every page render.
	set_transient( 'sc_news_asset_version', $version, 15 * MINUTE_IN_SECONDS );

	return $version;
}

/**
 * Register and enqueue the tool's compiled bundles.
 *
 * Conditional by design — these only load on pages that actually render the
 * tool. The script is deferred and printed in the footer so it never blocks
 * rendering of the server-rendered markup it enhances.
 */
function statchasers_news_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_NEWS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_NEWS_HANDLE,
			$origin . '/styles.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_NEWS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_NEWS_HANDLE,
			$origin . '/dist/statchasers-news.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_NEWS_HANDLE );
	wp_enqueue_script( STATCHASERS_NEWS_HANDLE );
}

/**
 * Does the current request render the shortcode anywhere in post content?
 *
 * Used to enqueue the stylesheet during wp_enqueue_scripts (i.e. in <head>,
 * before paint) rather than during the_content, which would leave the tool
 * briefly unstyled. Shortcodes reached some other way — a widget, a template
 * part — still get their assets from the shortcode callback itself.
 */
function statchasers_news_post_has_shortcode(): bool {
	if ( ! is_singular() ) {
		return false;
	}

	$post = get_post();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	return has_shortcode( (string) $post->post_content, STATCHASERS_NEWS_SHORTCODE );
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_news_post_has_shortcode() ) {
			return;
		}
		statchasers_news_enqueue_assets();
	}
);

/**
 * The shortcode: prints the server-rendered tool into the page.
 *
 * Things this deliberately does NOT do, because they belong to WordPress and
 * duplicating them would create conflicting signals:
 *
 *   - emit a `rel="canonical"` tag. WordPress (or your SEO plugin) already
 *     outputs a self-referencing canonical for the page in the initial HTML.
 *     The tool must never add a second one, and must never make the canonical
 *     depend on tool state.
 *   - emit an `<h1>`, or touch <title>, og:title or the meta description. The
 *     page owns those. The tool contributes an `<h2>` — see `heading_text` if
 *     you need to word it to match the page's H1.
 *   - write anything to the URL. Pagination is DOM-only; there is no
 *     history.pushState and no `?page=`/`?filter=` state, so the tool cannot
 *     spawn crawlable filter permutations of the page.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_news_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers News:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the news API origin.</p>';
		}
		return '';
	}

	$args = statchasers_news_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_news_fetch( $args );

	// Idempotent — covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_news_enqueue_assets();

	if ( null === $data ) {
		// The API is unreachable and there's no cached copy. Emit the root
		// container anyway: the enqueued bundle finds it, fetches, and renders
		// client-side. Degraded for crawlers, but readers still get the tool.
		return sprintf(
			'<div class="statchasers-news" data-sc-root="1" data-sc-origin="%1$s" data-sc-page-size="%2$d"></div>',
			esc_attr( $origin ),
			(int) $args['page_size']
		);
	}

	/**
	 * Filters the server-rendered fragment before it is printed.
	 *
	 * Deliberately not escaped: this is first-party markup from the same origin
	 * the page already loads its executable bundle from, and escaping it would
	 * print tags as text. Sites that want belt-and-braces sanitising can run
	 * wp_kses() here — note the fragment includes a <noscript><style> block.
	 *
	 * @param string $html Rendered fragment.
	 * @param array  $args Render arguments.
	 */
	return (string) apply_filters( 'statchasers_news_fragment_html', $data['html'], $args );
}
add_shortcode( STATCHASERS_NEWS_SHORTCODE, 'statchasers_news_shortcode' );

/* -------------------------------------------------------------------------
 * Structured data
 *
 * Rank Math (or whichever SEO plugin the site runs) is the authority for SEO
 * output. It already emits the canonical, the title, the meta description, the
 * robots directives, and a schema graph containing WebPage / BreadcrumbList /
 * Organization nodes. This plugin does not reproduce ANY of that.
 *
 * It used to add a SoftwareApplication / WebApplication node for the tool on
 * every news and team page. Search Console held that type to the software-app
 * rich result's rules — offers.price plus an aggregateRating or review — and
 * flagged every URL carrying it, the team Schedule pages included. A news feed
 * and a team hub are pages people read, not applications, and the only rating
 * we could give is an invented one. So the node is gone: with Rank Math present
 * the page's WebPage + BreadcrumbList are Rank Math's and this adds nothing of
 * its own, and without it the fallback below prints a lone WebPage.
 *
 * A team's Schedule page adds an ItemList of SportsEvents — its games — on the
 * same terms as the FAQ below: statchasers_team_rank_math_schedule().
 *
 * The player and team mounts add one more, on the same terms: an FAQPage built
 * from the questions their fragment is actually rendering, injected into the
 * same graph (statchasers_player_rank_math_schema(), and the team equivalent).
 * It describes visible text word for word — the fragment hands the questions
 * over as an inert JSON island precisely so the node cannot drift from what the
 * reader sees — and the mount that has no FAQ on it contributes no node.
 *
 * Deliberately NOT emitted: Article, NewsArticle, ItemList, Dataset, Product,
 * Review, aggregateRating. Some of those would be easy to generate from the
 * news items, but they wouldn't accurately describe the page, and irrelevant or
 * fabricated markup is a liability rather than a ranking benefit.
 * ---------------------------------------------------------------------------
 */

/** Is either tool actually on the page being rendered? */
function statchasers_news_is_active(): bool {
	return statchasers_news_post_has_shortcode() || statchasers_team_post_has_shortcode();
}

/**
 * The WebPage node the fallback prints when no SEO plugin is publishing a graph.
 *
 * Not a SoftwareApplication: see the section comment above. And not added to
 * Rank Math's graph, which already has this page's WebPage node.
 *
 * @return array<string,mixed>
 */
function statchasers_news_schema_node(): array {
	$page_url = statchasers_news_canonical_guess();

	$node = array(
		'@type'               => 'WebPage',
		'@id'                 => $page_url . '#webpage',
		'name'                => wp_strip_all_tags( get_the_title() ),
		'description'         => statchasers_news_schema_description(),
		'url'                 => $page_url,
		'isAccessibleForFree' => true,
		'inLanguage'          => 'en-US',
	);

	/**
	 * Filters the fallback WebPage node before it is printed.
	 *
	 * @param array $node The node.
	 */
	return (array) apply_filters( 'statchasers_news_schema_node', $node );
}

/**
 * Description for the schema node. Prefers Rank Math's own description for the
 * page so the two never disagree, then the excerpt, then a sensible default.
 */
function statchasers_news_schema_description(): string {
	$description = '';

	if ( function_exists( 'rank_math' ) ) {
		$description = (string) get_post_meta( get_the_ID(), 'rank_math_description', true );
	}

	if ( '' === $description ) {
		$description = (string) get_the_excerpt();
	}

	if ( '' === $description ) {
		// Last resort only — reached when the page has neither a Rank Math
		// description nor an excerpt. Worded for whichever tool is mounted,
		// because describing a team hub as a news feed is worse than no node.
		$description = statchasers_team_post_has_shortcode()
			? 'An NFL team hub for fantasy football: team stats and NFL ranks, offensive depth chart, schedule, and the latest player news and injury designations.'
			: 'Browse NFL player news and injury updates for fantasy football, with headlines, publish times and sources for each report.';
	}

	return wp_strip_all_tags( $description );
}

/** The page's canonical, as WordPress/Rank Math sees it. Never invented here. */
function statchasers_news_canonical_guess(): string {
	$id = get_the_ID();
	if ( $id ) {
		$permalink = get_permalink( $id );
		if ( $permalink ) {
			return $permalink;
		}
	}
	return home_url( '/' );
}

/**
 * The @id of the page-level node in a schema graph, or ''.
 *
 * Found by shape rather than by key name, because the key varies by page type
 * (WebPage, CollectionPage, ItemPage, ProfilePage...) and an SEO plugin is free
 * to rename it. Shared with statchasers-player.php: two copies of this walk
 * would be one copy and one that no longer matches the graph.
 *
 * @param array<string,mixed> $data Schema nodes.
 * @return string
 */
function statchasers_news_schema_page_id( array $data ): string {
	foreach ( $data as $node ) {
		if ( ! is_array( $node ) || empty( $node['@type'] ) || empty( $node['@id'] ) ) {
			continue;
		}
		foreach ( (array) $node['@type'] as $type ) {
			if ( is_string( $type ) && false !== strpos( $type, 'Page' ) ) {
				return (string) $node['@id'];
			}
		}
	}

	return '';
}

/**
 * Is some other plugin already publishing a schema graph we've hooked into?
 *
 * Rank Math is handled above. If it's absent we fall back to printing our
 * single node ourselves — still just the one node, never a competing graph of
 * WebPage/Breadcrumb duplicates.
 */
function statchasers_news_graph_provider_present(): bool {
	$present = function_exists( 'rank_math' ) || class_exists( 'RankMath' );

	/**
	 * Filters whether an SEO plugin is already emitting a schema graph.
	 *
	 * Return true from here if you wire the node into another SEO plugin's
	 * graph (e.g. Yoast's `wpseo_schema_graph`), so the standalone fallback
	 * below stays switched off.
	 *
	 * @param bool $present
	 */
	return (bool) apply_filters( 'statchasers_news_graph_provider_present', $present );
}

/**
 * Fallback JSON-LD for sites with no schema-graph plugin.
 *
 * Prints ONLY a WebPage node. It does not add BreadcrumbList or Organization —
 * if the site has no SEO plugin, that's a site-wide decision to make
 * deliberately, not something this tool should improvise.
 */
function statchasers_news_print_fallback_schema(): void {
	if ( ! statchasers_news_is_active() || statchasers_news_graph_provider_present() ) {
		return;
	}

	$payload = array(
		'@context' => 'https://schema.org',
	) + statchasers_news_schema_node();

	echo '<script type="application/ld+json">' .
		wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
		'</script>' . "\n";
}
add_action( 'wp_head', 'statchasers_news_print_fallback_schema', 20 );

/**
 * Stop wpautop wrapping the shortcode in a <p>.
 *
 * On its own line the shortcode becomes <p>[statchasers_news]</p>, and once
 * expanded that is a <p> containing a <div> — invalid, and browsers close the
 * paragraph early, which breaks the layout. Registered at priority 10 so it
 * runs after core's wpautop (same priority, registered earlier) and before
 * core's do_shortcode at priority 11.
 *
 * @param string $content Post content.
 * @return string
 */
function statchasers_news_unwrap_shortcode( $content ) {
	if ( ! is_string( $content ) || '' === $content ) {
		return $content;
	}
	$tags    = STATCHASERS_NEWS_SHORTCODE . '|' . STATCHASERS_TEAM_SHORTCODE;
	$pattern = '#<p>\s*(\[(?:' . $tags . ')(?:\s[^\]]*)?/?\])\s*</p>#';
	return (string) preg_replace( $pattern, '$1', $content );
}
add_filter( 'the_content', 'statchasers_news_unwrap_shortcode', 10 );

/**
 * Let the browser start the connection to the asset origin during head parsing
 * rather than when the deferred script is reached.
 *
 * @param array<int,string> $urls Resource URLs.
 * @param string            $relation_type Relation being filtered.
 * @return array<int,string>
 */
function statchasers_news_resource_hints( array $urls, string $relation_type ): array {
	if ( 'preconnect' !== $relation_type ) {
		return $urls;
	}
	$mounted = wp_style_is( STATCHASERS_NEWS_HANDLE, 'enqueued' )
		|| wp_style_is( STATCHASERS_TEAM_HANDLE, 'enqueued' )
		|| statchasers_news_post_has_shortcode()
		|| statchasers_team_post_has_shortcode();

	if ( ! $mounted ) {
		return $urls;
	}

	$origin = statchasers_news_origin();
	if ( '' !== $origin ) {
		$urls[] = $origin;
	}

	return $urls;
}
add_filter( 'wp_resource_hints', 'statchasers_news_resource_hints', 10, 2 );

/**
 * Clear cached renders. Handy after a deploy: wp eval 'statchasers_news_flush();'
 *
 * Deletes the fresh copies only. The outage backups every tool keeps beside
 * them survive, so a flush followed by an API hiccup still serves yesterday's
 * render rather than an empty box — see statchasers_flush_transients(). This
 * is what "Clear cached renders" and the team build both call.
 *
 * @param bool $all Also delete the backups. statchasers_news_flush_all() is
 *                  the way to ask for that; this parameter is its plumbing.
 */
function statchasers_news_flush( bool $all = false ): void {
	delete_transient( 'sc_news_asset_version' );

	// Fragment transients are hashed per argument set, so match on the prefix.
	statchasers_flush_transients( 'sc_news_ssr_', $all );

	statchasers_team_flush( $all );
	statchasers_player_flush( $all );
	statchasers_fpa_flush( $all );
	statchasers_rankings_flush( $all );
	statchasers_schedule_flush( $all );
	statchasers_player_stats_flush( $all );
	statchasers_rb_handcuffs_flush( $all );

	// The matchup renders have no flush of their own (statchasers_matchup_
	// flush() is the permalink table, not the cache), so they were never
	// cleared here at all and only ever cleared by the next deactivation.
	// Left that way for a routine flush; swept on the way out.
	if ( $all ) {
		statchasers_flush_transients( 'sc_matchup_ssr_', true );
	}
}

/**
 * Everything the plugin cached, backups included. The deactivation cleanup.
 *
 * Its own function rather than statchasers_news_flush( true ) hooked directly,
 * because WordPress calls a deactivation callback WITH an argument — whether
 * the deactivation is network-wide — and that boolean would land in $all and
 * make an ordinary deactivation keep its backups.
 */
function statchasers_news_flush_all(): void {
	statchasers_news_flush( true );
}
register_deactivation_hook( __FILE__, 'statchasers_news_flush_all' );

// The daily player-page build (statchasers-player-pages.php) stops with the
// plugin rather than firing into a missing callback.
register_deactivation_hook(
	__FILE__,
	static function (): void {
		wp_clear_scheduled_hook( 'statchasers_player_auto_build' );
	}
);

/**
 * Activation: ask for a permalink flush on the next request.
 *
 * Not flushed here. Activation runs before `init`, so the rewrite rules the
 * team, player and matchup files add have not been registered yet and flushing
 * now would write a rule table without them — the exact failure the manual
 * "Settings > Permalinks > Save" step used to work around. The flag is read on
 * the next `init`, once every rule is in place.
 *
 * Deactivation does not flush. A site that turns the plugin off still has
 * WordPress's own rules; ours simply stop being registered, and rewriting the
 * whole table on the way out is work nobody asked for.
 */
register_activation_hook(
	__FILE__,
	static function (): void {
		update_option( 'statchasers_needs_flush', 1, false );
	}
);

add_action(
	'init',
	static function (): void {
		if ( ! get_option( 'statchasers_needs_flush' ) ) {
			return;
		}
		delete_option( 'statchasers_needs_flush' );
		flush_rewrite_rules();
	},
	PHP_INT_MAX
);
