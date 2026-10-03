<?php
/**
 * Refresh orchestrator - blends the three sources, exactly like the StatChasers app:
 *
 *   1. ESPN          - baseline for every column (fallback if others fail).
 *   2. Footballguys  - overrides the Offense / Defense / Special-Teams columns.
 *   3. FantasyPros   - fills the Fantasy tab's dedicated FAN_* columns (ECR order),
 *                      seeded from the canonical columns so the tab still renders
 *                      if FantasyPros is unavailable.
 *
 * Movement (↑/↓/NEW) is diffed against the previous cached snapshot.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Refresh {

	/**
	 * Worst case for one team, in seconds: the ESPN request plus the FantasyPros
	 * request, each at its own timeout (10s + 10s). A run with a deadline stops
	 * starting new teams once less than this is left.
	 */
	const TEAM_BUDGET = 20;

	/** The daily WP-Cron event. Scheduled from the main plugin file. */
	const CRON_HOOK = 'scdc_cron_refresh';

	/** Option holding the start time of the refresh in progress. */
	const LOCK_OPTION = 'scdc_refresh_lock';

	/**
	 * How long a lock is honoured. Past the 720s budget with room to spare, so
	 * only a run that died without releasing it (a fatal, a killed worker) is
	 * ever taken over.
	 */
	const LOCK_TTL = 900;

	/**
	 * Refresh and store: the admin button and the daily cron both come here.
	 *
	 * One at a time. Two overlapping runs each did the whole ~65-request job,
	 * and the second diffed its movement arrows against a snapshot the first
	 * was about to replace.
	 *
	 * @param int $budget Seconds to ask the host for.
	 * @return string success | partial | error | locked
	 */
	public static function run_and_store( $budget = 720 ) {
		if ( ! self::acquire_lock() ) {
			return 'locked';
		}
		try {
			return self::store( $budget );
		} finally {
			delete_option( self::LOCK_OPTION );
		}
	}

	/**
	 * Take the lock, or report that a live run holds it.
	 *
	 * add_option() is not a strict mutex, but it closes the cases that happen:
	 * a second click, or the cron firing, during a run of a minute or ten.
	 *
	 * @return bool
	 */
	private static function acquire_lock() {
		$now = time();
		if ( add_option( self::LOCK_OPTION, $now, '', 'no' ) ) {
			return true;
		}
		$held = (int) get_option( self::LOCK_OPTION, 0 );
		if ( $held > 0 && $now - $held < self::LOCK_TTL ) {
			return false;
		}
		// A run that died without releasing it: take it over.
		delete_option( self::LOCK_OPTION );
		return (bool) add_option( self::LOCK_OPTION, $now, '', 'no' );
	}

	/**
	 * The refresh itself, with a deadline, then the file and the meta.
	 *
	 * @param int $budget Seconds to ask the host for.
	 * @return string success | partial | error
	 */
	private static function store( $budget ) {
		// Blended refresh hits ESPN (32) + Footballguys (1) + FantasyPros (32).
		// A healthy run takes about a minute; the worst case, every request timing
		// out, is 15s + 32 × (10s + 10s) = 655s. Ask for $budget where the host
		// allows it, otherwise work within its own max_execution_time. Either way
		// the run gets a deadline 15s short of the limit: it stops starting new
		// teams there and keeps the rest from the last refresh, so a slow run
		// still writes what it fetched instead of dying with nothing written.
		$start = microtime( true );
		if ( ! function_exists( 'set_time_limit' ) || false === @set_time_limit( $budget ) ) { // phpcs:ignore
			$budget = (int) ini_get( 'max_execution_time' );
			$start  = isset( $_SERVER['REQUEST_TIME_FLOAT'] ) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : $start;
		}
		$deadline = $budget > 0 ? $start + $budget - 15 : 0;

		$previous = SCDC_Store::read();
		$result   = self::run( $previous, $deadline );

		$saved = false;
		if ( 'error' !== $result['status'] ) {
			$saved = SCDC_Store::write( $result['payload'] );
		}

		$now = time();
		if ( 'error' === $result['status'] || ! $saved ) {
			$status = 'error';
			$error  = ! empty( $result['error'] ) ? $result['error'] : __( 'Failed to write the cache file. Check uploads directory permissions.', 'statchasers-depth-charts' );
			// Preserve the prior last_refreshed time on hard failure.
			$meta                 = SCDC_Store::get_meta();
			$meta['status']       = $status;
			$meta['error']        = $error;
			$meta['teams_ok']     = (int) $result['teams_ok'];
			$meta['teams_failed'] = $result['teams_failed'];
		} else {
			$status = $result['status']; // success | partial
			$meta   = array(
				'status'            => $status,
				'error'             => $result['error'],
				'last_refreshed'    => gmdate( 'c', $now ),
				'last_refreshed_ts' => $now,
				'teams_ok'          => (int) $result['teams_ok'],
				'teams_failed'      => $result['teams_failed'],
				'teams_kept'        => $result['teams_kept'],
			);
		}
		SCDC_Store::set_meta( $meta );
		return $status;
	}

	/**
	 * Run a full blended refresh.
	 *
	 * A team whose ESPN fetch fails keeps its entry from the previous payload, so
	 * a partial refresh never makes a chart disappear; it is still reported in
	 * teams_failed (and in teams_kept when there was an entry to keep). Teams not
	 * reached before $deadline are treated the same way.
	 *
	 * @param array|null $previous Previous decoded payload (for movement diffing).
	 * @param float      $deadline Unix time (microtime) to stop starting new teams by; 0 = none.
	 * @return array{payload:array,teams_ok:int,teams_failed:array,teams_kept:array,status:string,error:string}
	 */
	public static function run( $previous = null, $deadline = 0 ) {
		$prev_positions = self::index_previous_positions( $previous );
		$prev_teams     = self::index_previous_teams( $previous );

		// Footballguys: one fetch for all 32 teams (null on failure -> ESPN stands).
		$footballguys = SCDC_Footballguys::fetch_all();

		$teams_out    = array();
		$teams_failed = array();
		$teams_kept   = array();
		$ok           = 0;
		$out_of_time  = false;
		// The configured season, not the calendar year: January to August the
		// calendar is a year ahead of the season being charted.
		$season       = SCDC_Teams::season();

		foreach ( SCDC_Espn::teams() as $team ) {
			$abbr = $team['abbr'];
			$name = $team['name'];

			// Near the deadline, stop starting teams; the rest fall back below.
			if ( ! $out_of_time && $deadline > 0 && microtime( true ) + self::TEAM_BUDGET > $deadline ) {
				$out_of_time = true;
			}

			$normalized = $out_of_time ? null : SCDC_Espn::fetch_team( $abbr, $name, $team['slug'] );
			if ( null === $normalized ) {
				$teams_failed[] = $abbr;
				if ( isset( $prev_teams[ $abbr ] ) ) {
					$teams_out[]  = $prev_teams[ $abbr ];
					$teams_kept[] = $abbr;
				}
				continue;
			}
			if ( ! empty( $normalized['season'] ) ) {
				$season = (int) $normalized['season'];
			}

			$positions = $normalized['positions'];

			// ESPN is the only source with headshots (built from its numeric athlete
			// ids). Capture them by name now, before the merges below replace players
			// with Footballguys / FantasyPros rows that carry no headshot.
			$espn_headshots = self::collect_headshots_by_name( $positions );

			// 2. Footballguys overrides Offense / Defense / Special columns.
			$fbg_team = ( $footballguys && isset( $footballguys[ $abbr ] ) ) ? $footballguys[ $abbr ] : null;
			SCDC_Footballguys::merge( $positions, $fbg_team );

			// 3. Fantasy tab: seed FAN_* from canonical, then overlay FantasyPros.
			SCDC_FantasyPros::seed_fantasy_columns( $positions );
			$fp_team = SCDC_FantasyPros::fetch_team( $name );
			SCDC_FantasyPros::merge( $positions, $fp_team );

			// Restore ESPN headshots onto the merged rows by matching player name.
			self::apply_headshots_by_name( $positions, $espn_headshots );

			// Movement vs the previous snapshot (blended positions, incl. FAN_*).
			$prev = isset( $prev_positions[ $abbr ] ) ? $prev_positions[ $abbr ] : null;
			self::apply_movement( $positions, $prev );

			$teams_out[] = array(
				'team'      => $normalized['team'],
				'positions' => $positions,
			);
			++$ok;
		}

		// Status counts fresh fetches only: a run where nothing was fetched is an
		// error (and is not written) even if every team could be kept.
		if ( 0 === $ok ) {
			$status = 'error';
			$error  = __( 'No teams could be fetched. Please try again.', 'statchasers-depth-charts' );
		} elseif ( ! empty( $teams_failed ) ) {
			$status = 'partial';
			$lost   = array_diff( $teams_failed, $teams_kept );
			$parts  = array();
			if ( $out_of_time ) {
				$parts[] = __( 'Stopped early to stay within the time limit.', 'statchasers-depth-charts' );
			}
			if ( ! empty( $teams_kept ) ) {
				/* translators: %s: comma-separated team abbreviations. */
				$parts[] = sprintf( __( 'Some teams failed to refresh and were kept from the last refresh: %s.', 'statchasers-depth-charts' ), implode( ', ', $teams_kept ) );
			}
			if ( ! empty( $lost ) ) {
				/* translators: %s: comma-separated team abbreviations. */
				$parts[] = sprintf( __( 'Some teams failed to refresh and have no earlier data to keep: %s.', 'statchasers-depth-charts' ), implode( ', ', $lost ) );
			}
			$error = implode( ' ', $parts );
		} else {
			$status = 'success';
			$error  = '';
		}

		$payload = array(
			'version'   => 1,
			'season'    => $season,
			'fetchedAt' => gmdate( 'c' ),
			'teams'     => $teams_out,
		);

		return array(
			'payload'      => $payload,
			'teams_ok'     => $ok,
			'teams_failed' => $teams_failed,
			'teams_kept'   => $teams_kept,
			'status'       => $status,
			'error'        => $error,
		);
	}

	/**
	 * Index a previous payload as abbr => team entry, for carrying a failed team
	 * forward unchanged.
	 *
	 * @param array|null $previous Decoded prior payload.
	 * @return array
	 */
	private static function index_previous_teams( $previous ) {
		$index = array();
		if ( ! is_array( $previous ) || empty( $previous['teams'] ) ) {
			return $index;
		}
		foreach ( $previous['teams'] as $team ) {
			if ( isset( $team['team']['abbr'], $team['positions'] ) ) {
				$index[ $team['team']['abbr'] ] = $team;
			}
		}
		return $index;
	}

	/**
	 * Index a previous payload as abbr => positions for movement diffing.
	 *
	 * @param array|null $previous Decoded prior payload.
	 * @return array
	 */
	private static function index_previous_positions( $previous ) {
		$index = array();
		if ( ! is_array( $previous ) || empty( $previous['teams'] ) ) {
			return $index;
		}
		foreach ( $previous['teams'] as $team ) {
			if ( isset( $team['team']['abbr'], $team['positions'] ) ) {
				$index[ $team['team']['abbr'] ] = $team['positions'];
			}
		}
		return $index;
	}

	/**
	 * Annotate each player's `movement` (up/down/new/null) vs the prior snapshot.
	 * Mutates $positions in place.
	 *
	 * @param array      $positions Current positions matrix (by reference).
	 * @param array|null $previous  Prior positions matrix for the same team.
	 * @return void
	 */
	private static function apply_movement( &$positions, $previous ) {
		foreach ( $positions as $pos_key => &$players ) {
			$prev_players = ( is_array( $previous ) && isset( $previous[ $pos_key ] ) ) ? $previous[ $pos_key ] : array();
			$prev_rank    = array();
			foreach ( $prev_players as $pp ) {
				$k               = ! empty( $pp['id'] ) ? $pp['id'] : strtolower( $pp['name'] );
				$prev_rank[ $k ] = (int) $pp['rank'];
			}
			foreach ( $players as &$player ) {
				if ( 'DEF' === $pos_key ) {
					$player['movement'] = null;
					continue;
				}
				$k        = ! empty( $player['id'] ) ? $player['id'] : strtolower( $player['name'] );
				$movement = null;
				if ( ! array_key_exists( $k, $prev_rank ) ) {
					$movement = ! empty( $prev_players ) ? 'new' : null;
				} elseif ( (int) $player['rank'] < $prev_rank[ $k ] ) {
					$movement = 'up';
				} elseif ( (int) $player['rank'] > $prev_rank[ $k ] ) {
					$movement = 'down';
				}
				$player['movement'] = $movement;
			}
			unset( $player );
		}
		unset( $players );
	}

	/**
	 * Normalize a player name for cross-source matching: lowercase, drop periods
	 * and generational suffixes, collapse whitespace. "T.J. Sanders" and "Michael
	 * Pittman Jr." both reduce to a stable key.
	 *
	 * @param string $name Player name.
	 * @return string
	 */
	private static function normalize_name_key( $name ) {
		$name  = strtolower( (string) $name );
		$name  = str_replace( array( '.', "'" ), '', $name );
		$name  = preg_replace( '/[^a-z0-9]+/', ' ', $name );
		$words = preg_split( '/\s+/', trim( $name ) );
		$suffixes = array( 'jr', 'sr', 'ii', 'iii', 'iv', 'v' );
		while ( count( $words ) > 1 && in_array( end( $words ), $suffixes, true ) ) {
			array_pop( $words );
		}
		return implode( ' ', $words );
	}

	/**
	 * Index a positions matrix's headshots by normalized name (ESPN populates
	 * these before the Footballguys / FantasyPros merges overwrite players).
	 *
	 * @param array $positions Positions matrix.
	 * @return array<string,string> name key => headshot URL
	 */
	private static function collect_headshots_by_name( $positions ) {
		$map = array();
		foreach ( $positions as $players ) {
			if ( ! is_array( $players ) ) {
				continue;
			}
			foreach ( $players as $p ) {
				if ( ! empty( $p['headshot'] ) && ! empty( $p['name'] ) ) {
					$key = self::normalize_name_key( $p['name'] );
					if ( ! isset( $map[ $key ] ) ) {
						$map[ $key ] = $p['headshot'];
					}
				}
			}
		}
		return $map;
	}

	/**
	 * Backfill headshots onto every player (in place) by normalized-name lookup,
	 * so merged-in Footballguys / FantasyPros rows recover the ESPN headshot. Only
	 * fills gaps - never clobbers a headshot the row already carries.
	 *
	 * @param array $positions Positions matrix (by reference).
	 * @param array $by_name   name key => headshot URL.
	 * @return void
	 */
	private static function apply_headshots_by_name( &$positions, $by_name ) {
		foreach ( $positions as &$players ) {
			if ( ! is_array( $players ) ) {
				continue;
			}
			foreach ( $players as &$p ) {
				if ( empty( $p['headshot'] ) && ! empty( $p['name'] ) ) {
					$key = self::normalize_name_key( $p['name'] );
					if ( isset( $by_name[ $key ] ) ) {
						$p['headshot'] = $by_name[ $key ];
					}
				}
			}
			unset( $p );
		}
		unset( $players );
	}
}
