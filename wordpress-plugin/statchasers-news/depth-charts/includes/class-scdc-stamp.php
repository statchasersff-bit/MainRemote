<?php
/**
 * When the depth-chart data on the hub was updated.
 *
 * The time comes from the stored file - the document the page's script loads
 * and renders - never from the clock at render time, so a plugin deploy, a
 * cache refill, a page view or an unrelated WordPress edit cannot move it, and
 * an older file served after a failed refresh keeps its own date.
 *
 * Payload fields read (all written by SCDC_Refresh::run()):
 *
 *   updatedAt          newest team updatedAt in the file (ISO 8601, UTC)
 *   teamsKept          teams carried over from an earlier file by a partial run
 *   fetchedAt          when the file was built (files written before these
 *                      fields existed have only this one)
 *   teams[].updatedAt  when that team's chart was fetched
 *
 * A missing or invalid time is omitted everywhere (no line, no card stamp),
 * never replaced with a guess. frontend.js mirrors parse() and format().
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Stamp {

	/** The zone the human text is written in; "ET" covers EST and EDT. */
	const ZONE = 'America/New_York';

	/** How much of the file to read for the top-level fields (they precede "teams"). */
	const HEAD_BYTES = 8192;

	/**
	 * Parse an ISO 8601 date-time with an explicit zone (Z or an offset).
	 *
	 * A bare date, a time without a zone, or anything outside 2000-2099 is
	 * treated as invalid: the hub never shows a time it cannot place exactly.
	 *
	 * @param mixed $value Candidate value.
	 * @return int|null Unix time, or null.
	 */
	public static function parse( $value ) {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		if ( ! preg_match( '/^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/', $value, $m ) ) {
			return null;
		}
		$year = (int) $m[1];
		if ( $year < 2000 || $year > 2099 ) {
			return null;
		}
		try {
			$date = new DateTimeImmutable( $value );
		} catch ( Exception $e ) {
			return null;
		}
		// Reject rollovers such as 2026-02-31 that DateTime would quietly accept.
		if ( substr( $value, 0, 10 ) !== $date->format( 'Y-m-d' ) ) {
			return null;
		}
		return $date->getTimestamp();
	}

	/**
	 * The machine value for <time datetime>: UTC, with Z.
	 *
	 * @param int $ts Unix time.
	 * @return string
	 */
	public static function iso( $ts ) {
		return gmdate( 'Y-m-d\TH:i:s\Z', (int) $ts );
	}

	/**
	 * The human value, in Eastern time whatever the site's timezone setting:
	 * "Nov 24, 2026 at 7:00 AM ET".
	 *
	 * @param int $ts Unix time.
	 * @return string
	 */
	public static function format( $ts ) {
		$date = ( new DateTimeImmutable( '@' . (int) $ts ) )->setTimezone( new DateTimeZone( self::ZONE ) );
		return $date->format( 'M j, Y \a\t g:i A' ) . ' ET';
	}

	/**
	 * The hub's stamp for a decoded payload (or just its top-level fields).
	 *
	 * @param array|null $payload Payload.
	 * @return array{ts:int,iso:string,text:string,label:string,mixed:bool}|null
	 */
	public static function from_payload( $payload ) {
		if ( ! is_array( $payload ) ) {
			return null;
		}
		$ts = isset( $payload['updatedAt'] ) ? self::parse( $payload['updatedAt'] ) : null;
		if ( null === $ts && isset( $payload['fetchedAt'] ) ) {
			$ts = self::parse( $payload['fetchedAt'] );
		}
		if ( null === $ts ) {
			return null;
		}
		$mixed = ! empty( $payload['teamsKept'] ) && is_array( $payload['teamsKept'] );
		return array(
			'ts'    => $ts,
			'iso'   => self::iso( $ts ),
			'text'  => self::format( $ts ),
			// Every team from one refresh: the charts were updated then. Some
			// carried over from an earlier one: only the newest is this time,
			// and each card carries its own.
			'label' => $mixed ? __( 'Latest team update', 'statchasers-depth-charts' ) : __( 'Depth charts updated', 'statchasers-depth-charts' ),
			'mixed' => $mixed,
		);
	}

	/**
	 * The stamp for the stored file.
	 *
	 * The top-level fields are written before "teams", so the first few KB
	 * normally hold all of them and the ~900 KB of charts is never decoded.
	 * Anything unexpected falls back to decoding the whole file.
	 *
	 * @param string $path File path.
	 * @return array|null See from_payload().
	 */
	public static function for_file( $path ) {
		static $memo = array();
		if ( ! is_string( $path ) || ! is_file( $path ) ) {
			return null;
		}
		$key = $path . '|' . (int) @filemtime( $path ) . '|' . (int) @filesize( $path ); // phpcs:ignore
		if ( array_key_exists( $key, $memo ) ) {
			return $memo[ $key ];
		}

		$top  = null;
		$head = @file_get_contents( $path, false, null, 0, self::HEAD_BYTES ); // phpcs:ignore
		if ( is_string( $head ) ) {
			$cut = strpos( $head, ',"teams":' );
			if ( false !== $cut ) {
				$decoded = json_decode( substr( $head, 0, $cut ) . '}', true );
				if ( is_array( $decoded ) ) {
					$top = $decoded;
				}
			}
		}
		if ( null === $top ) {
			$raw = @file_get_contents( $path ); // phpcs:ignore
			$all = is_string( $raw ) ? json_decode( $raw, true ) : null;
			if ( is_array( $all ) ) {
				unset( $all['teams'] );
				$top = $all;
			}
		}

		$memo[ $key ] = self::from_payload( $top );
		return $memo[ $key ];
	}

	/**
	 * The line printed above the tool, or '' with no valid time.
	 *
	 * @param array|null $stamp See from_payload().
	 * @return string
	 */
	public static function html( $stamp ) {
		if ( ! is_array( $stamp ) || empty( $stamp['iso'] ) ) {
			return '';
		}
		return '<p class="scdc-updated"><span class="scdc-updated-label">' . esc_html( $stamp['label'] ) . '</span> '
			. '<time datetime="' . esc_attr( $stamp['iso'] ) . '">' . esc_html( $stamp['text'] ) . '</time></p>';
	}
}
