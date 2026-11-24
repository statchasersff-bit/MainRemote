<?php
/**
 * The WordPress plugin's own team FAQ schema code, run against served HTML.
 *
 *     php team-faq-plugin.php < pages.json
 *
 * Input (stdin): {"<key>": "<embedded team fragment HTML>", ...}
 * Output (stdout): {"<key>": {
 *     "items":    the plugin's parsed Q&A (statchasers_team_faq_parse),
 *     "node":     the FAQPage it builds (statchasers_team_faq_node),
 *     "printed":  the fragment as the shortcode prints it
 *                 (statchasers_team_strip_faq_data),
 *     "graphs":   {"with_webpage": ..., "without_webpage": ...} - Rank Math's
 *                 graph after the plugin's rank_math/json_ld callback and
 *                 Rank Math's own FAQ merge, modeled as
 *                 tests/smoke-page-identity.php models it
 * }, ...}
 *
 * The functions are lifted out of statchasers-team.php and
 * statchasers-news.php by name and evaluated as written, not ported, so
 * this checks the code that ships. Only the request plumbing around them is
 * replaced: statchasers_team_faq_items() reads the page under test instead of
 * the shortcode's cached fetch, and wp_strip_all_tags() is WordPress's own
 * implementation (wp-includes/formatting.php).
 *
 * Used by tests/team-faq-schema.test.mjs.
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
	array( "$plugin/statchasers-team.php", 'statchasers_team_faq_parse' ),
	array( "$plugin/statchasers-team.php", 'statchasers_team_faq_node' ),
	array( "$plugin/statchasers-team.php", 'statchasers_team_rank_math_schema' ),
	array( "$plugin/statchasers-team.php", 'statchasers_team_strip_faq_data' ),
	array( "$plugin/statchasers-news.php", 'statchasers_news_schema_page_id' ),
) as $pair ) {
	eval( sc_lift( $pair[0], $pair[1] ) );
}

/** The page under test, in place of the shortcode's cached fetch. */
function statchasers_team_faq_items(): array {
	return statchasers_team_faq_parse( $GLOBALS['sc_page_html'] );
}

/**
 * Rank Math's graph for a page, then Frontend::change_webpage_entity
 * (priority 99): an FAQPage folds into WebPage, creating a bare one when
 * there is none - the model tests/smoke-page-identity.php uses.
 */
function sc_graph( bool $with_webpage ): array {
	$data = array(
		'BreadcrumbList' => array( '@type' => 'BreadcrumbList', '@id' => 'https://statchasers.com/team/x/#breadcrumb' ),
	);
	if ( $with_webpage ) {
		$data['WebPage'] = array( '@type' => 'WebPage', '@id' => 'https://statchasers.com/team/x/#webpage' );
	}
	$data = statchasers_team_rank_math_schema( $data );
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
	$node                    = statchasers_team_faq_node();
	$out[ $key ]             = array(
		'items'   => statchasers_team_faq_items(),
		'node'    => $node,
		'printed' => statchasers_team_strip_faq_data( $html ),
		'graphs'  => array(
			'with_webpage'    => sc_graph( true ),
			'without_webpage' => sc_graph( false ),
		),
	);
}

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
