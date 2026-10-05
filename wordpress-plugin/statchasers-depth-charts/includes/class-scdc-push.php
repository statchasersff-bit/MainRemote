<?php
/**
 * Sends each refresh to the StatChasers app, for the team hub's Depth Chart tab.
 *
 * The hub is rendered by the app (the [statchasers_team] shortcode fetches it),
 * and the app's host cannot reach this site, so it cannot read the cache file
 * itself. After every refresh that writes the file, the same document is POSTed
 * to <app origin>/api/depth-charts/ingest; the hub then shows exactly what this
 * tool shows.
 *
 * Configure in wp-config.php:
 *   define( 'STATCHASERS_INGEST_SECRET', '...' );   // the app's INGEST_SECRET
 * The origin is the one the StatChasers plugin already uses
 * (STATCHASERS_NEWS_ORIGIN), or define SCDC_PUSH_ORIGIN to send elsewhere.
 * With either missing the push is off and the refresh is unaffected.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Push {

	/** Path on the app, after the origin. */
	const PATH = '/api/depth-charts/ingest';

	/**
	 * The app's origin, without a trailing slash, or '' when not configured.
	 *
	 * @return string
	 */
	public static function origin() {
		$origin = '';
		if ( defined( 'SCDC_PUSH_ORIGIN' ) ) {
			$origin = (string) constant( 'SCDC_PUSH_ORIGIN' );
		} elseif ( function_exists( 'statchasers_news_origin' ) ) {
			$origin = statchasers_news_origin();
		}
		/**
		 * Filters where depth-chart refreshes are pushed.
		 *
		 * @param string $origin App origin, no trailing slash.
		 */
		$origin = (string) apply_filters( 'scdc_push_origin', $origin );
		return untrailingslashit( esc_url_raw( $origin ) );
	}

	/**
	 * The shared secret, or '' when not configured.
	 *
	 * @return string
	 */
	public static function secret() {
		return defined( 'STATCHASERS_INGEST_SECRET' ) ? trim( (string) constant( 'STATCHASERS_INGEST_SECRET' ) ) : '';
	}

	/**
	 * Send one payload. Never throws; the refresh has already succeeded.
	 *
	 * @param array $payload The document SCDC_Store::write() just wrote.
	 * @return array{status:string,message:string,at:string} status: ok | off | error
	 */
	public static function send( array $payload ) {
		$at     = gmdate( 'c' );
		$origin = self::origin();
		$secret = self::secret();
		if ( '' === $origin || '' === $secret ) {
			return array(
				'status'  => 'off',
				'message' => __( 'Not configured: set STATCHASERS_INGEST_SECRET (and the app origin) in wp-config.php.', 'statchasers-depth-charts' ),
				'at'      => $at,
			);
		}

		$response = wp_remote_post(
			$origin . self::PATH,
			array(
				'timeout' => 20,
				'headers' => array(
					'Content-Type'    => 'application/json',
					'X-Ingest-Secret' => $secret,
				),
				'body'    => wp_json_encode( $payload ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'status'  => 'error',
				'message' => $response->get_error_message(),
				'at'      => $at,
			);
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			$why  = is_array( $body ) && ! empty( $body['error'] ) ? (string) $body['error'] : '';
			return array(
				'status'  => 'error',
				/* translators: 1: HTTP status code, 2: the app's reason, if any. */
				'message' => trim( sprintf( __( 'The app answered %1$d. %2$s', 'statchasers-depth-charts' ), $code, $why ) ),
				'at'      => $at,
			);
		}
		return array(
			'status'  => 'ok',
			'message' => '',
			'at'      => $at,
		);
	}
}
