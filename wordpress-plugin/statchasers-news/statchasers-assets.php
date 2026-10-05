<?php
/**
 * Shared plumbing: the webfont every tool's stylesheet asks for, the sitemap
 * helpers, and the sweep every tool's cache flush is built on.
 *
 * Its own file because these are the things all the tools need and none of
 * them owns, and because the main plugin file cannot be loaded in isolation -
 * it defines the origin and flush helpers that a test harness has to stub.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The webfont handle every tool's stylesheet depends on. */
const STATCHASERS_FONT_HANDLE = 'statchasers-font';

/**
 * Load Inter.
 *
 * Every one of these stylesheets asks for `Inter` first and falls back to the
 * system stack, and until now nothing on a WordPress page ever loaded it. The
 * tool's own standalone pages do - team.html and player.html carry a Google
 * Fonts <link> - so the hub looked right at the API's address and wrong on the
 * site that embeds it, which is the half of the split that matters.
 *
 * The failure was quiet in the worst way: a missing family is not an error, the
 * browser simply walks the stack. On Windows it lands on Segoe UI, and at the
 * 800 and 900 weights these headings use, on Segoe UI Black - a much heavier,
 * tighter face. Body copy degraded gracefully and the headings did not, so what
 * it looked like was a styling bug in the headings rather than an absent font.
 *
 * Registered as a dependency of each tool's stylesheet rather than enqueued on
 * its own, so it loads on exactly the pages that mount a tool, and WordPress
 * de-duplicates it if a theme already registered the same handle.
 *
 * Return '' from the filter for a site that serves Inter itself, or that would
 * rather not call fonts.googleapis.com - the stack falls back as before.
 */
function statchasers_font_url(): string {
	/**
	 * Filters the webfont stylesheet URL. '' disables it.
	 *
	 * @param string $url Google Fonts URL for Inter, or '' for none.
	 */
	return (string) apply_filters(
		'statchasers_font_url',
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
	);
}

/** Register the font handle, and hand back the dependency list for a stylesheet. */
function statchasers_font_dependency(): array {
	$url = statchasers_font_url();

	if ( '' === $url ) {
		return array();
	}

	if ( ! wp_style_is( STATCHASERS_FONT_HANDLE, 'registered' ) ) {
		// No version: the URL is the version, and appending ?ver= to a Google
		// Fonts request is a cache miss for nothing.
		wp_register_style( STATCHASERS_FONT_HANDLE, $url, array(), null );
	}

	return array( STATCHASERS_FONT_HANDLE );
}

/* ---------------------------------------------------------------- sitemaps */

/**
 * Whether this request is the first page of the sitemap being built.
 *
 * The tools append the URLs that have no post of their own (section, week,
 * position and matchup addresses) through `rank_math/sitemap/page_content`.
 * Once the page sitemap is long enough to paginate, which ~640 player pages
 * make it, that filter runs for page-sitemap1.xml, page-sitemap2.xml and so
 * on, and every appended URL would be listed once per file. Appending to the
 * first only lists each once. Rank Math numbers the files through `sitemap_n`,
 * empty on an unpaginated sitemap.
 */
function statchasers_sitemap_first_page(): bool {
	return (int) get_query_var( 'sitemap_n' ) <= 1;
}

/**
 * The legacy player addresses that now 301, as a URL path regex.
 *
 * /nfl/players/<section>/<slug>/ was a layout of real pages; they still exist
 * and Rank Math would keep listing them after they started redirecting. Only
 * canonical, indexable URLs belong in a sitemap.
 */
const STATCHASERS_LEGACY_PLAYER_PATH = '#/nfl/players/(?:stats|game-log|outlook|injury|news|bio|overview)/[^/]+/?$#';

/**
 * Keep the redirected legacy player pages out of Rank Math's sitemap.
 *
 * @param array<string,mixed>|false $url  The entry, with its `loc`.
 * @param string                    $type Sitemap type.
 * @return array<string,mixed>|false
 */
function statchasers_sitemap_drop_legacy( $url, $type = '' ) {
	if ( is_array( $url ) && isset( $url['loc'] ) ) {
		$path = (string) wp_parse_url( (string) $url['loc'], PHP_URL_PATH );
		if ( preg_match( STATCHASERS_LEGACY_PLAYER_PATH, $path ) ) {
			return false;
		}
	}
	return $url;
}
add_filter( 'rank_math/sitemap/entry', 'statchasers_sitemap_drop_legacy', 10, 2 );

/**
 * Drop the dead /sitemap-players.xml from Rank Math's sitemap index.
 *
 * Something on the WordPress side (not this plugin, not in our repo: a snippet
 * or an older plugin) appends it to the index with a fixed 2026-09-07 lastmod,
 * and the address 404s (found 2026-10-05). Search Console reports a sitemap
 * that 404s as an error against the whole index. The player URLs are already
 * in the page sitemap, through statchasers_player_sitemap_sections(). Last,
 * so it sees the entry whatever priority added it.
 *
 * @param string $xml Index entries added by filters.
 * @return string
 */
function statchasers_sitemap_drop_dead_players( $xml ) {
	return (string) preg_replace( '#\s*<sitemap>\s*<loc>[^<]*/sitemap-players\.xml</loc>.*?</sitemap>#s', '', (string) $xml );
}
add_filter( 'rank_math/sitemap/index', 'statchasers_sitemap_drop_dead_players', PHP_INT_MAX );

/* ------------------------------------------------------------------ caches */

/**
 * Delete one tool's cached renders: every `<prefix><hash>` transient and its
 * timeout row - and, only when $all is true, the `<prefix>bak_<hash>` backups
 * beside them.
 *
 * Every tool files a render twice: a fresh copy for a few minutes, and a
 * backup for a day or more that is served when the API is slow or down. The
 * flushes used to delete `_transient_<prefix>%`, and a LIKE on the prefix
 * matches the backups too - they share it. So "Clear cached renders", and the
 * team build that calls the same flush, quietly threw away the only thing that
 * keeps a page filled during an outage; one API hiccup in the next few minutes
 * and every tool printed an empty box. A routine flush exists to make the next
 * view ask the API again, which deleting the fresh copy alone achieves. The
 * backup is overwritten by that same successful fetch, so keeping it costs
 * nothing, and it is never served while the fresh copy is.
 *
 * $all is for deactivation, where nothing of the plugin's should stay behind.
 *
 * @param string $prefix Transient name prefix, e.g. 'sc_team_ssr_'.
 * @param bool   $all    Also delete the `bak_` backups.
 */
function statchasers_flush_transients( string $prefix, bool $all = false ): void {
	global $wpdb;

	$fresh   = $wpdb->esc_like( '_transient_' . $prefix ) . '%';
	$timeout = $wpdb->esc_like( '_transient_timeout_' . $prefix ) . '%';

	if ( $all ) {
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
				$fresh,
				$timeout
			)
		);
		return;
	}

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE ( option_name LIKE %s OR option_name LIKE %s ) AND option_name NOT LIKE %s AND option_name NOT LIKE %s",
			$fresh,
			$timeout,
			$wpdb->esc_like( '_transient_' . $prefix . 'bak_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_' . $prefix . 'bak_' ) . '%'
		)
	);
}
