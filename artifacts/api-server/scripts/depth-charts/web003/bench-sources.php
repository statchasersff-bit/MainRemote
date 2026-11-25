<?php
/**
 * WEB-003 depth-chart replay bench (local WordPress only, never production):
 * stands in for the three sources the league refresh reads, so the real
 * SCDC_Refresh::run_and_store() path can publish two recognizable snapshots
 * without touching ESPN, Footballguys or FantasyPros.
 *
 *  - ESPN's Bills depth chart answers with the captured fixture
 *    (wordpress-plugin/tests/depth-charts/fixtures/sources/espn-buf.json),
 *    its QB1 renamed to the option `dc_bench_qb1` (the snapshot marker);
 *  - every other source request fails, so the other 31 clubs are kept from
 *    the previous file (a partial refresh, which is still a publication).
 *
 * Requests to anything else (the app, the edge model) pass through.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter(
	'pre_http_request',
	static function ( $pre, $args, $url ) {
		$host = (string) wp_parse_url( (string) $url, PHP_URL_HOST );
		if ( ! preg_match( '/(espn\.com|footballguys\.com|fantasypros\.com)$/', $host ) ) {
			return $pre;
		}
		if ( preg_match( '#/teams/buf/depthcharts$#', (string) $url ) ) {
			$fixture = getenv( 'SC_BENCH_ESPN_BUF' );
			$data    = $fixture && is_file( $fixture ) ? json_decode( (string) file_get_contents( $fixture ), true ) : null;
			if ( is_array( $data ) ) {
				$qb1 = (string) get_option( 'dc_bench_qb1', 'Josh Allen' );
				foreach ( $data['depthchart'] as &$group ) {
					if ( isset( $group['positions']['qb']['athletes'][0] ) ) {
						$group['positions']['qb']['athletes'][0]['displayName'] = $qb1;
						$group['positions']['qb']['athletes'][0]['shortName']   = $qb1;
					}
				}
				unset( $group );
				return array(
					'headers'  => array( 'content-type' => 'application/json' ),
					'body'     => wp_json_encode( $data ),
					'response' => array( 'code' => 200, 'message' => 'OK' ),
					'cookies'  => array(),
					'filename' => null,
				);
			}
		}
		return new WP_Error( 'sc_bench_offline', 'source offline in the bench' );
	},
	10,
	3
);
