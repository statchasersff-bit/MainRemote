<?php
/**
 * The WordPress plugin's own player FAQ schema code, run against served HTML
 * (WEB-044 / WEB-030, 2026-11-26; modeled on team-faq-plugin.php).
 *
 *     php player-faq-plugin.php < pages.json
 *
 * Input (stdin): {"<key>": "<embedded player fragment HTML>", ...}
 * Output (stdout): {"<key>": {
 *     "items":   the plugin's parsed Q&A (statchasers_player_faq_parse),
 *     "node":    the FAQPage it builds (statchasers_player_faq_node),
 *     "printed": the fragment as the shortcode prints it
 *                (statchasers_player_strip_faq_data),
 *     "graph":   Rank Math's graph after statchasers_player_rank_math_schema
 *                and Rank Math's FAQ merge into the WebPage entity
 * }, ...}
 *
 * The functions are lifted out of statchasers-player.php and
 * statchasers-news.php by name and evaluated as written, not ported. Only
 * statchasers_player_faq_items() (a static per-request cache around the
 * shortcode's fetch) is replaced, to read the page under test.
 *
 * Used by tests/player-faq-schema.test.mjs.
 */

define( 'ABSPATH', '/tmp/fake-wp/' );

function add_filter( $hook, $fn, $priority = 10, $args = 1 ) {}
function add_action( $hook, $fn, $priority = 10, $args = 1 ) {}

function wp_strip_all_tags( $text, $remove_breaks = false ) {
	if ( is_null( $text ) ) {
		return '';
	}
	$text = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', $text );
	$text = strip_tags( $text );
	if ( $remove_breaks ) {
		$text = preg_replace( '/[\r\n\t ]+/', ' ', $text );
	}
	return trim( $text );
}

$plugin = dirname( __DIR__, 4 ) . '/wordpress-plugin/statchasers-news';

/** One top-level function's source, from "function name(" to its closing brace. */
function sc_lift( string $file, string $name ): string {
	$src = file_get_contents( $file );
	if ( ! preg_match( '/^function ' . preg_quote( $name, '/' ) . '\s*\(.*?^\}$/ms', $src, $m ) ) {
		fwrite( STDERR, "missing function $name in $file\n" );
		exit( 2 );
	}
	return $m[0];
}

foreach ( array(
	array( "$plugin/statchasers-player.php", 'statchasers_player_faq_parse' ),
	array( "$plugin/statchasers-player.php", 'statchasers_player_faq_node' ),
	array( "$plugin/statchasers-player.php", 'statchasers_player_rank_math_schema' ),
	array( "$plugin/statchasers-player.php", 'statchasers_player_strip_faq_data' ),
	array( "$plugin/statchasers-news.php", 'statchasers_news_schema_page_id' ),
) as $pair ) {
	eval( sc_lift( $pair[0], $pair[1] ) );
}

/** The page under test, in place of the request's cached fetch. */
function statchasers_player_faq_items(): array {
	return statchasers_player_faq_parse( $GLOBALS['sc_page_html'] );
}

/** Rank Math's graph, then its FAQ merge into the WebPage entity. */
function sc_graph(): array {
	$data = array(
		'BreadcrumbList' => array( '@type' => 'BreadcrumbList', '@id' => 'https://statchasers.com/nfl/players/x/#breadcrumb' ),
		'WebPage'        => array( '@type' => 'WebPage', '@id' => 'https://statchasers.com/nfl/players/x/#webpage' ),
	);
	$data = statchasers_player_rank_math_schema( $data );
	foreach ( $data as $key => $node ) {
		if ( is_array( $node ) && 'FAQPage' === ( $node['@type'] ?? null ) ) {
			$data['WebPage']['@type']      = 'FAQPage';
			$data['WebPage']['mainEntity'] = $node['mainEntity'];
			unset( $data[ $key ] );
			break;
		}
	}
	return $data;
}

$pages = json_decode( stream_get_contents( STDIN ), true );
$out   = array();

foreach ( $pages as $key => $html ) {
	$GLOBALS['sc_page_html'] = $html;
	$out[ $key ]             = array(
		'items'   => statchasers_player_faq_items(),
		'node'    => statchasers_player_faq_node(),
		'printed' => statchasers_player_strip_faq_data( $html ),
		'graph'   => sc_graph(),
	);
}

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
