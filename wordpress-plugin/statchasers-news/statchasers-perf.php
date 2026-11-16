<?php
/**
 * Interaction performance (INP) for every StatChasers tool bundle.
 *
 * INP audit, 2026-11-15 (docs/INP-AUDIT.md in the app repo). WP Rocket's
 * "Delay JavaScript execution" holds every script on the page back until the
 * reader's first click, tap, key or scroll, then downloads and runs them all
 * at once - jQuery, Divi, gtag and our own tool bundle - and replays the
 * click afterwards. Measured on the live site with a throttled phone: the
 * first tap on the mobile menu opened it 1.0-1.7s later (0.1-0.2s with
 * nothing delayed), and every control a bundle builds (the handcuff and SOS
 * sort buttons, the team hub's in-place tabs) did not exist until then.
 *
 * What this file can do from the plugin is take OUR scripts out of that
 * burst: they run at load (deferred, as before), so the controls exist from
 * the start and the burst after the first tap is shorter by their boot time.
 * It cannot remove the first-tap wait itself - Rocket intercepts that tap
 * while ANY script is still delayed (tested: un-delaying just the menu's
 * inline scripts changed nothing). That is the Delay JS setting, documented
 * in the audit for the site owner to decide.
 *
 * The team hub's bundle already opted out on 2026-11-06 for the hash-tab
 * scroll bug (statchasers_team_script_tag). This extends the same opt-out to
 * every bundle the plugin serves from the app's /dist/: they have no
 * dependencies, are deferred, and are small. Theme, jQuery and third-party
 * scripts are untouched.
 *
 * Two mechanisms, as for the team bundle: attributes on the tag that WP
 * Rocket, Autoptimize, LiteSpeed, Cloudflare Rocket Loader and SG Optimizer
 * all honor, and WP Rocket's own exclusion lists (matched against the URL).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** URL fragment every tool bundle shares (public/dist/statchasers-*.js). */
const STATCHASERS_PERF_BUNDLE_PATH = '/dist/statchasers-';

/**
 * Whether a script URL is one of the app's tool bundles.
 *
 * @param string $src Script URL.
 */
function statchasers_perf_is_bundle( string $src ): bool {
	if ( '' === $src || false === strpos( $src, STATCHASERS_PERF_BUNDLE_PATH ) ) {
		return false;
	}
	$path = (string) wp_parse_url( $src, PHP_URL_PATH );
	return 1 === preg_match( '#/dist/statchasers-[a-z0-9-]+\.js$#', $path );
}

/**
 * Mark a tool bundle's tag so no optimizer delays or re-defers it.
 *
 * @param string $tag    The full <script> tag.
 * @param string $handle Script handle.
 * @param string $src    Script URL.
 */
function statchasers_perf_script_tag( string $tag, string $handle, string $src = '' ): string {
	// Already marked (the team bundle marks itself), or not ours.
	if ( false !== strpos( $tag, 'data-no-defer' ) || ! statchasers_perf_is_bundle( $src ) ) {
		return $tag;
	}
	return preg_replace(
		'/ src=/',
		' data-no-optimize="1" data-noptimize="1" data-no-defer="1" data-cfasync="false" nowprocket src=',
		$tag,
		1
	);
}
add_filter( 'script_loader_tag', 'statchasers_perf_script_tag', 10, 3 );

/**
 * WP Rocket's exclusion lists: Delay JS, and minify/combine.
 *
 * @param mixed $exclusions Existing patterns.
 * @return array
 */
function statchasers_perf_rocket_exclusions( $exclusions ): array {
	if ( ! is_array( $exclusions ) ) {
		$exclusions = array();
	}
	$exclusions[] = STATCHASERS_PERF_BUNDLE_PATH;
	return $exclusions;
}
add_filter( 'rocket_delay_js_exclusions', 'statchasers_perf_rocket_exclusions' );
add_filter( 'rocket_exclude_js', 'statchasers_perf_rocket_exclusions' );
