<?php
/**
 * Divi's late-CSS loader, one link per file (WEB-024, 2026-11-24).
 *
 * Divi 4 prints a small script in the footer that adds its "late" dynamic
 * stylesheet after divi-style-css:
 *
 *     var file = ["https://.../et-cache/4825/et-divi-dynamic-tb-268-tb-269-4825-late.css"];
 *     if (0===document.querySelectorAll('link[href="' + file + '"]').length) {
 *         var link = document.createElement('link'); ... link.href = file; ...
 *     }
 *
 * `file` is an ARRAY and the script treats it as one URL. Two things go wrong
 * on the matchup template (page 4825), both seen live on 2026-11-24:
 *
 *   - A game address the plugin answers with a 404 (template_redirect,
 *     statchasers-matchup.php) is set to 404 AFTER Divi has named the holder
 *     page's late file, and the 404 layout adds its own, so the array holds
 *     two URLs. `link.href = file` joins them with a comma: one request to
 *     ".../4825-late.css,https://.../tb-268-tb-269-late.css", which fails.
 *   - On every matchup page the same file is already enqueued, as the
 *     `divi-dynamic-late` handle with a `?ver=` (Asset CleanUp turns it into a
 *     preload). The script's exact-href test misses the query string, so it
 *     asks for the file a second time.
 *
 * Divi's script cannot be filtered, so the footer is buffered on the requests
 * this applies to and the script is swapped for one that walks the array:
 * each distinct file gets its own <link>, and a file already linked (any
 * query string) is skipped. The array itself is left exactly as Divi built
 * it. Anything that does not look like Divi's loader passes through as is.
 *
 * @package StatChasers
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Whether this request gets the rewrite: the matchup template, every state of
 * it (pair page, dated game, preview, game 404). Filterable for the other
 * Divi templates that print the same loader.
 */
function statchasers_divi_late_css_applies(): bool {
	// The pair var only counts on the matchup holder (WEB-013): `?sc_matchup=`
	// on any other page is not the matchup template. A game 404 still renders
	// the holder, so it keeps the rewrite.
	$applies = function_exists( 'statchasers_matchup_raw' )
		? '' !== statchasers_matchup_raw()
		: '' !== (string) get_query_var( 'sc_matchup' );
	return (bool) apply_filters( 'statchasers_divi_late_css_applies', $applies );
}

/**
 * Divi's loader in $html, swapped for the per-file one. Pure: returns $html
 * unchanged when there is no loader, or when its array is not a list of
 * stylesheet URLs.
 */
function statchasers_divi_late_css_rewrite( string $html ): string {
	$pattern = '~<script\b[^>]*>\s*\(function\s*\(\)\s*\{\s*var\s+file\s*=\s*(\[[^\]]*\])\s*;(?:(?!</script>).)*?et-dynamic-late-css(?:(?!</script>).)*?</script>~s';
	return (string) preg_replace_callback(
		$pattern,
		static function ( array $m ): string {
			$files = json_decode( $m[1], true );
			if ( ! is_array( $files ) || array() === $files ) {
				return $m[0];
			}
			$clean = array();
			foreach ( $files as $file ) {
				if ( ! is_string( $file ) || ! preg_match( '~^https?://[^\s"\'<>,]+\.css(\?[^\s"\'<>,]*)?$~', $file ) ) {
					return $m[0];
				}
				if ( ! in_array( $file, $clean, true ) ) {
					$clean[] = $file;
				}
			}
			$json = json_encode( $clean, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- the flags matter here.
			if ( false === $json ) {
				return $m[0];
			}
			return '<script type="application/javascript" data-sc-late-css>' .
				'(function(){' .
				'var files=' . $json . ';' .
				'var handle=document.getElementById("divi-style-css");' .
				'if(!handle||!handle.parentNode)return;' .
				'var at=handle;' .
				'var bare=function(u){return String(u||"").split("?")[0].split("#")[0];};' .
				'var linked=function(u){var l=document.getElementsByTagName("link");' .
				'for(var j=0;j<l.length;j++){var h=l[j].getAttribute("href");if(h&&bare(h)===u)return true;}return false;};' .
				'for(var i=0;i<files.length;i++){' .
				'if(linked(bare(files[i])))continue;' .
				'var link=document.createElement("link");' .
				'link.rel="stylesheet";' .
				'link.id=i?"et-dynamic-late-css-"+i:"et-dynamic-late-css";' .
				'link.href=files[i];' .
				'at.parentNode.insertBefore(link,at.nextSibling);' .
				'at=link;' .
				'}' .
				'})();' .
				'</script>';
		},
		$html
	);
}

/** Buffer level of the footer buffer this file opened, or -1. */
function statchasers_divi_late_css_level( ?int $set = null ): int {
	static $level = -1;
	if ( null !== $set ) {
		$level = $set;
	}
	return $level;
}

/** First on wp_footer: start buffering what the footer prints. */
function statchasers_divi_late_css_start(): void {
	if ( is_admin() || ! statchasers_divi_late_css_applies() ) {
		return;
	}
	ob_start();
	statchasers_divi_late_css_level( ob_get_level() );
}

/**
 * Last on wp_footer: rewrite and print. A buffer someone else opened inside
 * the footer and left open means the levels no longer line up; then nothing is
 * touched, and the footer still prints when PHP flushes at shutdown.
 */
function statchasers_divi_late_css_finish(): void {
	$level = statchasers_divi_late_css_level();
	if ( $level < 1 || ob_get_level() !== $level ) {
		return;
	}
	statchasers_divi_late_css_level( -1 );
	echo statchasers_divi_late_css_rewrite( (string) ob_get_clean() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- the footer's own output, one script redrawn.
}

add_action( 'wp_footer', 'statchasers_divi_late_css_start', PHP_INT_MIN );
add_action( 'wp_footer', 'statchasers_divi_late_css_finish', PHP_INT_MAX );
