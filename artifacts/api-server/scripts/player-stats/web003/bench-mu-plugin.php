<?php
/**
 * WEB-003 replay bench (local WordPress only, never production): models the
 * two caches production has and this machine does not.
 *
 *  - WP Rocket: a page file per path and device, served before the template
 *    and written when the page finishes (skipped for query strings and
 *    DONOTCACHEPAGE, as Rocket does). rocket_clean_files() deletes them.
 *  - Rocket.net's CDN Cache Plugin: CDN_Clear_Cache_Api::cache_api_call()
 *    posts the paths to the replay's edge model (SC_BENCH_EDGE_PURGE).
 *
 * Every fragment fetch the plugin makes is counted in the option
 * bench_fragment_fetches, for the concurrency check.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sc_bench_rocket_file( string $path, bool $mobile ): string {
	return WP_CONTENT_DIR . '/cache/sc-bench/' . md5( $path ) . ( $mobile ? '-mobile' : '' ) . '.html';
}

function sc_bench_is_mobile(): bool {
	return (bool) preg_match( '/iPhone|Android|Mobile/i', (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) );
}

if ( ! function_exists( 'rocket_clean_files' ) ) {
	function rocket_clean_files( $urls ) {
		foreach ( (array) $urls as $url ) {
			$path = (string) wp_parse_url( $url, PHP_URL_PATH );
			foreach ( array( false, true ) as $mobile ) {
				$file = sc_bench_rocket_file( $path, $mobile );
				if ( is_file( $file ) ) {
					unlink( $file );
				}
			}
		}
		$log   = get_option( 'bench_rocket_cleans', array() );
		$log[] = array( time(), array_values( (array) $urls ) );
		update_option( 'bench_rocket_cleans', $log, false );
	}
}

if ( ! class_exists( 'CDN_Clear_Cache_Api' ) ) {
	class CDN_Clear_Cache_Api {
		public static function cache_api_call( $files, $action = 'purge' ) {
			$target = getenv( 'SC_BENCH_EDGE_PURGE' );
			if ( ! $target ) {
				return array();
			}
			$r = wp_remote_post(
				$target,
				array(
					'timeout' => 5,
					'headers' => array( 'Content-Type' => 'application/json' ),
					'body'    => wp_json_encode( array( 'files' => array_values( (array) $files ), 'action' => $action ) ),
				)
			);
			return is_wp_error( $r ) ? array() : json_decode( (string) wp_remote_retrieve_body( $r ) );
		}
	}
}

// Serve a stored page file before the template, as advanced-cache.php would.
add_action(
	'template_redirect',
	static function (): void {
		if ( 'GET' !== ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) || '' !== (string) ( $_SERVER['QUERY_STRING'] ?? '' ) ) {
			return;
		}
		$path = (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH );
		$file = sc_bench_rocket_file( $path, sc_bench_is_mobile() );
		if ( is_file( $file ) ) {
			header( 'X-Bench-Rocket: HIT' );
			readfile( $file );
			exit;
		}
		ob_start(
			static function ( $html ) use ( $file ) {
				if ( defined( 'DONOTCACHEPAGE' ) || 200 !== http_response_code() || false === strpos( (string) $html, '</html>' ) ) {
					return $html;
				}
				if ( ! is_dir( dirname( $file ) ) ) {
					mkdir( dirname( $file ), 0777, true );
				}
				file_put_contents( $file, $html . "\n<!-- sc-bench rocket file -->" );
				return $html;
			}
		);
	},
	1
);

add_action(
	'http_api_debug',
	static function ( $response, $context, $class, $args, $url ) {
		if ( is_string( $url ) && false !== strpos( $url, '/embed/player-stats?' ) ) {
			global $wpdb;
			$wpdb->query( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('bench_fragment_fetches', '1', 'off') ON DUPLICATE KEY UPDATE option_value = option_value + 1" );
		}
	},
	10,
	5
);
