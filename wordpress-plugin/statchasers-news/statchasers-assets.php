<?php
/**
 * Shared plumbing: the webfonts the tools' stylesheets ask for, the sitemap
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

/** The webfont handle every tool's stylesheet depends on: Inter. */
const STATCHASERS_FONT_HANDLE = 'statchasers-font';

/** The display face the team hub and matchup pages add: Barlow + Barlow Condensed. */
const STATCHASERS_DISPLAY_FONT_HANDLE = 'statchasers-display-font';

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
 * 800 weight these headings use, on Segoe UI Black - a much heavier, tighter
 * face. Body copy degraded gracefully and the headings did not, so what
 * it looked like was a styling bug in the headings rather than an absent font.
 *
 * Registered as a dependency of each tool's stylesheet rather than enqueued on
 * its own, so it loads on exactly the pages that mount a tool, and WordPress
 * de-duplicates it if a theme already registered the same handle.
 *
 * Five weights, 400 to 800. The stylesheets ask for nothing heavier (every
 * `font-weight: 900` became 800 on 2026-10-07), so a sixth file would be
 * downloaded and never drawn.
 *
 * The URL is Google's, but on the live site OMGF rewrites it to a self-hosted
 * copy, which is also why this plugin prints no preconnect to Google's hosts:
 * there is nothing there to connect to once OMGF has done its work. Return ''
 * from the filter for a site that serves Inter some other way, or not at all -
 * the stack falls back as before.
 */
function statchasers_font_url(): string {
	/**
	 * Filters the webfont stylesheet URL. '' disables it.
	 *
	 * @param string $url Google Fonts URL for Inter, or '' for none.
	 */
	return (string) apply_filters(
		'statchasers_font_url',
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
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

/**
 * The display face: Barlow and Barlow Condensed.
 *
 * The team hub sets its numerals, section headings, scoreboard hero and the
 * matchup sections in these (see the --*-display tokens in team.css), so they
 * belong to team.css and load on exactly the pages that mount it: the 32 hubs
 * and the matchup pages. Player pages and the standalone tools never ask for
 * them. Two other families exist, each registered by the one file whose
 * stylesheet names it: Archivo for the player profile's header
 * (statchasers-player.php) and DM Sans + Space Grotesk for the NFL schedule,
 * which wears its source repo's type (statchasers-schedule.php).
 *
 * Four handles rather than one combined request, and every one of them a
 * dependency of a stylesheet rather than an enqueue of its own, so each page
 * pulls exactly the bundles its stylesheet names and WordPress prints each
 * once however many tools a page mounts:
 *
 *   every tool page   Inter                       STATCHASERS_FONT_HANDLE
 *   hub + matchup     Barlow, Barlow Condensed    STATCHASERS_DISPLAY_FONT_HANDLE
 *   player pages      Archivo                     statchasers-player-header-font
 *   schedule page     DM Sans, Space Grotesk      statchasers-schedule-font
 *
 * No stylesheet served by the API may @import a font and no page may carry a
 * font <link> of its own: those bypass the enqueue system, so they would load
 * twice, and they bypass OMGF, so they would still go to Google.
 *
 * Return '' from the filter to serve the fonts yourself or not at all; the
 * stacks fall back to Arial Narrow and the system face. The filter keeps its
 * old name from when statchasers-matchup.php owned it.
 */
function statchasers_matchup_font_url(): string {
	/**
	 * Filters the display webfont stylesheet URL. '' disables it.
	 *
	 * @param string $url Google Fonts URL for Barlow + Barlow Condensed, or '' for none.
	 */
	return (string) apply_filters(
		'statchasers_matchup_font_url',
		'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap'
	);
}

/** Register the display font handle, and hand back the dependency list for a stylesheet. */
function statchasers_display_font_dependency(): array {
	$url = statchasers_matchup_font_url();

	if ( '' === $url ) {
		return array();
	}

	if ( ! wp_style_is( STATCHASERS_DISPLAY_FONT_HANDLE, 'registered' ) ) {
		// No version: the URL is the version, as with the Inter handle.
		wp_register_style( STATCHASERS_DISPLAY_FONT_HANDLE, $url, array(), null );
	}

	return array( STATCHASERS_DISPLAY_FONT_HANDLE );
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

/* ------------------------------------------------------- header stability */

/**
 * The mobile header's layout rules, printed in <head> so they apply at first
 * paint.
 *
 * Divi's Critical CSS feature splits each page's generated CSS into an inline
 * "critical" block and a deferred file loaded with preload + onload. On this
 * site the Theme Builder header's own rules - zero padding on the logo bar's
 * section and row, zero padding on the section that holds the hidden mobile
 * menu overlay - land in the deferred file, while Divi's default section (50px)
 * and row (30px) padding is in the blocking CSS. So on a phone the header first
 * paints about 320px too tall, then collapses when the deferred file arrives,
 * and the whole page jumps up with it. Measured 2026-10-07 at 0.35 to 0.61 CLS
 * on the tool pages (docs/CLS-ANALYSIS.md); Google's "poor" line is 0.25.
 *
 * The same thing hides the menu overlay itself: its hide rules sit in a
 * <style> inside the header's Code module, after the overlay's markup, so on a
 * slow connection the open menu can paint in the flow for a moment before
 * being hidden.
 *
 * These rules repeat both sets with selectors that do not depend on Divi's
 * generated class names (`et_pb_section_2_tb_header` changes whenever the
 * header template is rebuilt): the row's own custom class and the overlay's
 * id, reached through `:has()`. Printed on every page because the header is on
 * every page. Turning Critical CSS off in Divi (Theme Options → Performance)
 * fixes the first set at the source; this keeps the pages stable either way.
 *
 * Return '' from `statchasers_header_css` to print nothing.
 */
function statchasers_header_css(): string {
	$css =
		'@media (max-width:980px){' .
			'.et_pb_section:has(>.et_pb_row.sc-mobile-header-row-single){padding-top:0!important;padding-bottom:0!important}' .
			'.et_pb_row.sc-mobile-header-row-single{padding:0!important;margin:0!important;width:100%!important;max-width:100%!important}' .
			'.et_pb_section:has(#sc-mobile-overlay){padding:0!important;margin:0!important}' .
			'.et_pb_section:has(#sc-mobile-overlay) .et_pb_row{padding:0!important;margin:0!important}' .
		'}' .
		// Id selectors so these outrank the Code module's `.sc-mobile-overlay`
		// rules; the open state has to be restated at the same weight or the
		// menu could never show.
		'#sc-mobile-overlay{position:fixed;inset:0;opacity:0;visibility:hidden;pointer-events:none}' .
		'#sc-mobile-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto}';

	/**
	 * Filters the head CSS that holds the mobile header still at first paint.
	 *
	 * @param string $css The rules, or '' for none.
	 */
	return (string) apply_filters( 'statchasers_header_css', $css );
}

add_action(
	'wp_head',
	static function (): void {
		$css = statchasers_header_css();
		if ( '' === $css ) {
			return;
		}
		echo '<style id="statchasers-header">' . $css . '</style>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static CSS from this file, filterable by site code only.
	},
	1
);
