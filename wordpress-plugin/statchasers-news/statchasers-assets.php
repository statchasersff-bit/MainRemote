<?php
/**
 * Shared asset plumbing: the webfont every tool's stylesheet asks for.
 *
 * Its own file because it is the one thing all six tools need and none of them
 * owns, and because the main plugin file cannot be loaded in isolation — it
 * defines the origin and flush helpers that a test harness has to stub.
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
 * tool's own standalone pages do — team.html and player.html carry a Google
 * Fonts <link> — so the hub looked right at the API's address and wrong on the
 * site that embeds it, which is the half of the split that matters.
 *
 * The failure was quiet in the worst way: a missing family is not an error, the
 * browser simply walks the stack. On Windows it lands on Segoe UI, and at the
 * 800 and 900 weights these headings use, on Segoe UI Black — a much heavier,
 * tighter face. Body copy degraded gracefully and the headings did not, so what
 * it looked like was a styling bug in the headings rather than an absent font.
 *
 * Registered as a dependency of each tool's stylesheet rather than enqueued on
 * its own, so it loads on exactly the pages that mount a tool, and WordPress
 * de-duplicates it if a theme already registered the same handle.
 *
 * Return '' from the filter for a site that serves Inter itself, or that would
 * rather not call fonts.googleapis.com — the stack falls back as before.
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
