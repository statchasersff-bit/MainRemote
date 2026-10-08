<?php
/**
 * Plugin Name: StatChasers Request Profiler
 * Description: Times every stage of a WordPress request before and during the template - plugin file loads, each callback on the bootstrap hooks, every database query and every remote HTTP call - and reports them. Inert unless SC_PROFILE_KEY is defined and the request carries it. A diagnostic: remove the file when the investigation is over.
 * Version:     1.0.0
 * Author:      StatChasers
 *
 * INSTALL
 *   1. Copy this file to wp-content/mu-plugins/00-statchasers-profile.php
 *      (the "00-" keeps it first among mu-plugins so it sees the others load).
 *   2. In wp-config.php, ABOVE the "That's all, stop editing" line:
 *          define( 'SC_PROFILE_KEY', 'a-long-random-string' );
 *          define( 'SAVEQUERIES', true );   // optional: also times the queries WordPress runs before mu-plugins load
 *   3. Request any page with ?sc_profile=<key>  (or header X-SC-Profile: <key>).
 *
 * OUTPUT
 *   - Server-Timing response header: sc-* stage durations (visible in Chrome DevTools > Network > Timing).
 *   - &sc_profile_out=text   plain-text report instead of the page (curl-friendly).
 *   - &sc_profile_out=json   JSON report instead of the page.
 *   - default                the page, with the text report appended as an HTML comment.
 *   The response is sent with Cache-Control: no-store and DONOTCACHEPAGE so neither
 *   WP Rocket nor the edge keeps it.
 *
 * WHAT IT MEASURES
 *   php-before-wp     REQUEST_TIME_FLOAT -> WP_START_TIMESTAMP (wp-config, advanced-cache.php)
 *   core-before-mu    wp-settings up to this file (core includes, db connect, alloptions)
 *   mu-plugins        each mu-plugin file include
 *   plugin-files      each active plugin file include (per plugin, via plugin_loaded)
 *   plugins_loaded    every callback, timed and attributed to its plugin/theme
 *   theme-functions   setup_theme -> after_setup_theme (the theme's functions.php)
 *   init / wp_loaded / parse_request / pre_get_posts / wp / template_redirect / rest_api_init
 *   template          template_include -> shutdown (only when the page renders)
 *   db                every query (SAVEQUERIES), per stage and per callback, slowest listed
 *   http              every wp_remote_* call with duration, status, stage and caller
 *   cron              DISABLE_WP_CRON, whether this request spawned cron, overdue events
 *   cache             external object cache, alloptions size, opcache, WP_CACHE drop-in
 *
 * @package StatChasers\Profiler
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'SC_PROFILE_KEY' ) || '' === (string) SC_PROFILE_KEY ) {
	return;
}

$sc_profile_key = (string) ( $_GET['sc_profile'] ?? $_SERVER['HTTP_X_SC_PROFILE'] ?? '' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
if ( '' === $sc_profile_key || ! hash_equals( (string) SC_PROFILE_KEY, $sc_profile_key ) ) {
	unset( $sc_profile_key );
	return;
}
unset( $sc_profile_key );

if ( ! defined( 'SAVEQUERIES' ) ) {
	define( 'SAVEQUERIES', true );
}
if ( ! defined( 'DONOTCACHEPAGE' ) ) {
	define( 'DONOTCACHEPAGE', true );
}

/**
 * Everything the profiler knows about this request. One static holder rather
 * than a dozen globals; nothing here is meant to be used outside this file.
 */
final class SC_Profile {

	/** @var float WP_START_TIMESTAMP, the zero of every stage time. */
	public static $t0 = 0.0;

	/** @var array<string,float> Named moments, seconds since $t0. */
	public static $marks = array();

	/** @var array<int,array<string,mixed>> Per-file include times. */
	public static $files = array();

	/** @var array<int,array<string,mixed>> Per-callback timings on the watched hooks. */
	public static $callbacks = array();

	/** @var array<int,array<string,mixed>> Remote HTTP calls. */
	public static $http = array();

	/** @var array<int,array<string,mixed>> Open HTTP calls keyed by request id. */
	private static $http_open = array();

	/** @var string The stage a callback, query or HTTP call is attributed to. */
	public static $stage = 'core-before-mu';

	/** @var int Queries WordPress had run before this file loaded (untimed unless SAVEQUERIES is in wp-config). */
	public static $queries_before_mu = 0;

	/** @var int ob_get_level() when our buffer was opened. */
	public static $ob_level = 0;

	/** @var array<string,float> Stage -> seconds the stage began. */
	private static $stage_started = array();

	/** @var array<string,array{ms:float,queries:int,query_ms:float,http:int}> Per-stage totals. */
	public static $stages = array();

	/** @var array<string,int> Query index at the start of each stage. */
	private static $stage_query_index = array();

	/** @var bool Whether spawn_cron fired during this request. */
	public static $cron_spawned = false;

	/** Hooks whose every callback gets timed individually. */
	const WATCHED_HOOKS = array(
		'muplugins_loaded',
		'plugins_loaded',
		'setup_theme',
		'after_setup_theme',
		'init',
		'wp_loaded',
		'parse_request',
		'parse_query',
		'pre_get_posts',
		'wp',
		'template_redirect',
		'rest_api_init',
	);

	public static function boot(): void {
		global $wpdb;

		self::$t0 = defined( 'WP_START_TIMESTAMP' ) ? (float) WP_START_TIMESTAMP : (float) ( $GLOBALS['timestart'] ?? microtime( true ) );
		self::$queries_before_mu = isset( $wpdb ) ? (int) $wpdb->num_queries : 0;
		self::mark( 'mu-profiler-loaded' );
		self::begin_stage( 'mu-plugins' );

		self::$ob_level = ob_get_level();
		ob_start();
		// Core flushes every buffer at shutdown priority 1; the report needs ours intact until PHP_INT_MAX.
		remove_action( 'shutdown', 'wp_ob_end_flush_all', 1 );

		// Per-file include times: core fires these after each include.
		add_action( 'mu_plugin_loaded', array( __CLASS__, 'file_loaded' ), PHP_INT_MIN );
		add_action( 'plugin_loaded', array( __CLASS__, 'file_loaded' ), PHP_INT_MIN );
		add_action( 'network_plugin_loaded', array( __CLASS__, 'file_loaded' ), PHP_INT_MIN );

		// Stage boundaries. The ordering mirrors wp-settings.php.
		self::boundary( 'muplugins_loaded', 'muplugins_loaded', 'plugin-files' );
		self::boundary( 'plugins_loaded', 'plugins_loaded', 'core-after-plugins' );
		self::boundary( 'setup_theme', 'setup_theme', 'theme-functions' );
		self::boundary( 'after_setup_theme', 'after_setup_theme', 'core-before-init' );
		self::boundary( 'init', 'init', 'core-after-init' );
		self::boundary( 'wp_loaded', 'wp_loaded', 'request-parse' );
		self::boundary( 'parse_request', 'parse_request', 'main-query' );
		self::boundary( 'pre_get_posts', 'pre_get_posts', 'main-query' );
		self::boundary( 'wp', 'wp', 'core-before-template_redirect' );
		self::boundary( 'template_redirect', 'template_redirect', 'template-resolve' );
		self::boundary( 'rest_api_init', 'rest_api_init', 'rest-dispatch' );

		add_filter(
			'template_include',
			static function ( $template ) {
				self::mark( 'template_include' );
				self::begin_stage( 'template' );
				return $template;
			},
			PHP_INT_MAX
		);

		// Per-callback wrapping on the watched hooks, installed just before each hook runs.
		foreach ( self::WATCHED_HOOKS as $hook ) {
			$installer = static function () use ( $hook ) {
				self::wrap_hook( $hook );
			};
			self::$mine[ spl_object_id( $installer ) ] = true;
			add_action( $hook, $installer, PHP_INT_MIN );
		}

		// Remote HTTP.
		add_filter( 'pre_http_request', array( __CLASS__, 'http_start' ), PHP_INT_MIN, 3 );
		add_action( 'http_api_debug', array( __CLASS__, 'http_end' ), PHP_INT_MIN, 5 );

		// Cron spawn (a loopback request WordPress makes from inside a visitor's request).
		add_filter(
			'cron_request',
			static function ( $cron ) {
				self::$cron_spawned = true;
				return $cron;
			},
			PHP_INT_MAX
		);

		add_action( 'shutdown', array( __CLASS__, 'report' ), PHP_INT_MAX );
	}

	/* ---------------------------------------------------------------- marks */

	public static function mark( string $name ): void {
		self::$marks[ $name ] = microtime( true ) - self::$t0;
	}

	private static function now(): float {
		return microtime( true ) - self::$t0;
	}

	public static function begin_stage( string $stage ): void {
		global $wpdb;
		self::end_stage();
		self::$stage                       = $stage;
		self::$stage_started[ $stage ]     = self::now();
		self::$stage_query_index[ $stage ] = isset( $wpdb->queries ) && is_array( $wpdb->queries ) ? count( $wpdb->queries ) : 0;
		if ( ! isset( self::$stages[ $stage ] ) ) {
			self::$stages[ $stage ] = array(
				'ms'       => 0.0,
				'queries'  => 0,
				'query_ms' => 0.0,
				'http'     => 0,
			);
		}
	}

	private static function end_stage(): void {
		global $wpdb;
		$stage = self::$stage;
		if ( ! isset( self::$stage_started[ $stage ] ) ) {
			return;
		}
		$q = self::query_totals( self::$stage_query_index[ $stage ] ?? 0 );

		self::$stages[ $stage ]['ms']       += ( self::now() - self::$stage_started[ $stage ] ) * 1000;
		self::$stages[ $stage ]['queries']  += $q['count'];
		self::$stages[ $stage ]['query_ms'] += $q['ms'];
		unset( self::$stage_started[ $stage ] );
	}

	/**
	 * A hook's first and last callback: the hook itself becomes a stage, and
	 * the core code that runs after it until the next hook becomes another.
	 */
	private static function boundary( string $hook, string $stage_during, string $stage_after = '' ): void {
		if ( '' === $stage_after ) {
			$stage_after = $stage_during;
		}
		$start = static function () use ( $hook, $stage_during ) {
			self::mark( $hook . ':start' );
			self::begin_stage( $stage_during );
		};
		$end   = static function () use ( $hook, $stage_after ) {
			self::mark( $hook . ':end' );
			self::begin_stage( $stage_after );
		};
		self::$mine[ spl_object_id( $start ) ] = true;
		self::$mine[ spl_object_id( $end ) ]   = true;
		add_action( $hook, $start, PHP_INT_MIN );
		add_action( $hook, $end, PHP_INT_MAX );
	}

	/* --------------------------------------------------------- file loads */

	private static $last_file_mark = null;

	public static function file_loaded( $file ): void {
		$now  = self::now();
		$from = null === self::$last_file_mark ? ( self::$marks['mu-profiler-loaded'] ?? 0.0 ) : self::$last_file_mark;
		// The plugin loop starts after muplugins_loaded; do not charge the gap to the first plugin.
		if ( isset( self::$marks['muplugins_loaded:end'] ) && $from < self::$marks['muplugins_loaded:end'] ) {
			$from = self::$marks['muplugins_loaded:end'];
		}
		self::$last_file_mark = $now;
		self::$files[]        = array(
			'file'   => self::relative( (string) $file ),
			'source' => self::source_of( (string) $file ),
			'ms'     => round( ( $now - $from ) * 1000, 2 ),
			'stage'  => self::$stage,
		);
	}

	/* ----------------------------------------------------------- callbacks */

	/**
	 * Replace every callback still to run on $hook with a timed wrapper.
	 *
	 * Runs as the hook's PHP_INT_MIN callback. WP_Hook reads each priority's
	 * callback list when it reaches that priority, so rewriting the later
	 * priorities here takes effect for this very run.
	 */
	public static function wrap_hook( string $hook ): void {
		global $wp_filter;
		if ( ! isset( $wp_filter[ $hook ] ) || ! $wp_filter[ $hook ] instanceof WP_Hook ) {
			return;
		}
		foreach ( $wp_filter[ $hook ]->callbacks as $priority => &$list ) {
			foreach ( $list as $idx => &$entry ) {
				$fn = $entry['function'];
				if ( $fn instanceof Closure && ( isset( self::$wrapped[ spl_object_id( $fn ) ] ) || isset( self::$mine[ spl_object_id( $fn ) ] ) ) ) {
					continue;
				}
				$label = self::describe( $fn );
				$wrap  = static function ( ...$args ) use ( $fn, $label, $hook, $priority ) {
					global $wpdb;
					$t      = microtime( true );
					$qi     = isset( $wpdb->queries ) && is_array( $wpdb->queries ) ? count( $wpdb->queries ) : 0;
					$hi     = count( self::$http );
					$result = $fn( ...$args );
					$q      = self::query_totals( $qi );
					self::$callbacks[] = array(
						'hook'     => $hook,
						'priority' => PHP_INT_MAX === $priority ? 'max' : ( PHP_INT_MIN === $priority ? 'min' : $priority ),
						'callback' => $label['name'],
						'source'   => $label['source'],
						'ms'       => round( ( microtime( true ) - $t ) * 1000, 2 ),
						'queries'  => $q['count'],
						'query_ms' => round( $q['ms'], 2 ),
						'http'     => count( self::$http ) - $hi,
					);
					return $result;
				};
				self::$wrapped[ spl_object_id( $wrap ) ] = true;
				$entry['function']                        = $wrap;
			}
			unset( $entry );
		}
		unset( $list );
	}

	/** @var array<int,bool> spl_object_id of wrappers we created. */
	private static $wrapped = array();

	/** @var array<int,bool> spl_object_id of the profiler's own hook callbacks, never wrapped. */
	private static $mine = array();

	/**
	 * @param mixed $fn A callable as stored in $wp_filter.
	 * @return array{name:string,source:string}
	 */
	private static function describe( $fn ): array {
		$name = 'unknown';
		$file = '';
		try {
			if ( $fn instanceof Closure ) {
				$r    = new ReflectionFunction( $fn );
				$file = (string) $r->getFileName();
				$name = 'closure@' . self::relative( $file ) . ':' . $r->getStartLine();
			} elseif ( is_string( $fn ) ) {
				if ( false !== strpos( $fn, '::' ) ) {
					list( $class, $method ) = explode( '::', $fn, 2 );
					$r                      = new ReflectionMethod( $class, $method );
					$name                   = $fn;
				} else {
					$r    = new ReflectionFunction( $fn );
					$name = $fn;
				}
				$file = (string) $r->getFileName();
			} elseif ( is_array( $fn ) && 2 === count( $fn ) ) {
				$class = is_object( $fn[0] ) ? get_class( $fn[0] ) : (string) $fn[0];
				$r     = new ReflectionMethod( $class, (string) $fn[1] );
				$file  = (string) $r->getFileName();
				$name  = $class . '::' . $fn[1];
			} elseif ( is_object( $fn ) && method_exists( $fn, '__invoke' ) ) {
				$r    = new ReflectionMethod( $fn, '__invoke' );
				$file = (string) $r->getFileName();
				$name = get_class( $fn ) . '::__invoke';
			}
		} catch ( Throwable $e ) {
			$name = is_string( $fn ) ? $fn : 'unreflectable';
		}
		return array(
			'name'   => $name,
			'source' => self::source_of( $file ),
		);
	}

	/* ---------------------------------------------------------------- http */

	public static function http_start( $pre, $args, $url ) {
		$id = count( self::$http );
		self::$http[]            = array(
			'url'     => (string) $url,
			'method'  => (string) ( $args['method'] ?? 'GET' ),
			'timeout' => $args['timeout'] ?? null,
			'stage'   => self::$stage,
			'ms'      => null,
			'status'  => null,
			'error'   => '',
			'caller'  => function_exists( 'wp_debug_backtrace_summary' ) ? substr( (string) wp_debug_backtrace_summary( 'WP_Http', 0, true ), 0, 240 ) : '',
		);
		self::$http_open[ $id ] = microtime( true );
		return $pre;
	}

	public static function http_end( $response, $context, $class, $args, $url ): void {
		// Match the most recent open call for this URL (requests are not concurrent in PHP).
		$id = null;
		foreach ( array_reverse( self::$http, true ) as $i => $call ) {
			if ( isset( self::$http_open[ $i ] ) && $call['url'] === (string) $url ) {
				$id = $i;
				break;
			}
		}
		if ( null === $id ) {
			return;
		}
		self::$http[ $id ]['ms'] = round( ( microtime( true ) - self::$http_open[ $id ] ) * 1000, 2 );
		unset( self::$http_open[ $id ] );
		if ( is_wp_error( $response ) ) {
			self::$http[ $id ]['error'] = $response->get_error_message();
		} else {
			self::$http[ $id ]['status'] = (int) wp_remote_retrieve_response_code( $response );
		}
	}

	/* ------------------------------------------------------------- queries */

	/**
	 * @return array{count:int,ms:float}
	 */
	private static function query_totals( int $from_index ): array {
		global $wpdb;
		$count = 0;
		$ms    = 0.0;
		if ( isset( $wpdb->queries ) && is_array( $wpdb->queries ) ) {
			$n = count( $wpdb->queries );
			for ( $i = $from_index; $i < $n; $i++ ) {
				$count++;
				$ms += (float) ( $wpdb->queries[ $i ][1] ?? 0 ) * 1000;
			}
		}
		return array(
			'count' => $count,
			'ms'    => $ms,
		);
	}

	private static function classify_query( string $sql ): string {
		$s = ltrim( $sql );
		if ( false !== stripos( $s, '_transient_' ) || false !== stripos( $s, '_site_transient_' ) ) {
			return 0 === stripos( $s, 'SELECT' ) ? 'transient-read' : 'transient-write';
		}
		if ( preg_match( '/options\b.*autoload\s*=\s*[\'"]?yes/is', $s ) || false !== stripos( $s, "autoload IN ( 'yes'" ) || false !== stripos( $s, 'autoload IN (' ) ) {
			return 'alloptions';
		}
		if ( preg_match( '/options\b/i', $s ) ) {
			return 0 === stripos( $s, 'SELECT' ) ? 'option-read' : 'option-write';
		}
		foreach ( array( 'postmeta', 'posts', 'term_relationships', 'term_taxonomy', 'terms', 'termmeta', 'usermeta', 'users', 'comments', 'commentmeta' ) as $table ) {
			if ( preg_match( '/\b[a-z0-9_]*' . $table . '\b/i', $s ) ) {
				return $table;
			}
		}
		return 'other';
	}

	/* -------------------------------------------------------------- report */

	public static function report(): void {
		global $wpdb, $wp_object_cache;

		self::mark( 'shutdown' );
		self::end_stage();

		// Queries: totals, by type, slowest.
		$by_type = array();
		$slowest = array();
		$total   = array(
			'count' => 0,
			'ms'    => 0.0,
		);
		if ( isset( $wpdb->queries ) && is_array( $wpdb->queries ) ) {
			foreach ( $wpdb->queries as $i => $q ) {
				$sql  = (string) ( $q[0] ?? '' );
				$ms   = (float) ( $q[1] ?? 0 ) * 1000;
				$type = self::classify_query( $sql );
				if ( ! isset( $by_type[ $type ] ) ) {
					$by_type[ $type ] = array(
						'count' => 0,
						'ms'    => 0.0,
					);
				}
				$by_type[ $type ]['count']++;
				$by_type[ $type ]['ms'] += $ms;
				$total['count']++;
				$total['ms'] += $ms;
				$slowest[] = array(
					'ms'     => round( $ms, 2 ),
					'type'   => $type,
					'stage'  => self::stage_of_query_start( (float) ( $q[3] ?? 0 ) ),
					'caller' => substr( (string) ( $q[2] ?? '' ), 0, 200 ),
					'sql'    => substr( preg_replace( '/\s+/', ' ', $sql ), 0, 220 ),
				);
			}
		}
		usort(
			$slowest,
			static function ( $a, $b ) {
				return $b['ms'] <=> $a['ms'];
			}
		);
		$slowest = array_slice( $slowest, 0, 15 );
		foreach ( $by_type as &$t ) {
			$t['ms'] = round( $t['ms'], 2 );
		}
		unset( $t );
		arsort( $by_type );

		// Callbacks: slowest, and per-source rollup.
		$callbacks = self::$callbacks;
		usort(
			$callbacks,
			static function ( $a, $b ) {
				return $b['ms'] <=> $a['ms'];
			}
		);
		$by_source = array();
		foreach ( self::$callbacks as $c ) {
			$k = $c['source'];
			if ( ! isset( $by_source[ $k ] ) ) {
				$by_source[ $k ] = array(
					'ms'        => 0.0,
					'callbacks' => 0,
					'queries'   => 0,
					'http'      => 0,
				);
			}
			$by_source[ $k ]['ms']        += $c['ms'];
			$by_source[ $k ]['callbacks'] += 1;
			$by_source[ $k ]['queries']   += $c['queries'];
			$by_source[ $k ]['http']      += $c['http'];
		}
		foreach ( self::$files as $f ) {
			$k = $f['source'];
			if ( ! isset( $by_source[ $k ] ) ) {
				$by_source[ $k ] = array(
					'ms'        => 0.0,
					'callbacks' => 0,
					'queries'   => 0,
					'http'      => 0,
				);
			}
			$by_source[ $k ]['ms'] += $f['ms'];
		}
		foreach ( $by_source as &$s ) {
			$s['ms'] = round( $s['ms'], 2 );
		}
		unset( $s );
		uasort(
			$by_source,
			static function ( $a, $b ) {
				return $b['ms'] <=> $a['ms'];
			}
		);

		$files = self::$files;
		usort(
			$files,
			static function ( $a, $b ) {
				return $b['ms'] <=> $a['ms'];
			}
		);

		foreach ( self::$stages as &$st ) {
			$st['ms']       = round( $st['ms'], 2 );
			$st['query_ms'] = round( $st['query_ms'], 2 );
		}
		unset( $st );
		foreach ( self::$http as $h ) {
			if ( isset( self::$stages[ $h['stage'] ] ) ) {
				self::$stages[ $h['stage'] ]['http']++;
			}
		}

		$request_start = isset( $_SERVER['REQUEST_TIME_FLOAT'] ) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : self::$t0;
		$alloptions    = function_exists( 'wp_load_alloptions' ) ? wp_load_alloptions() : array();
		$cron          = function_exists( '_get_cron_array' ) ? _get_cron_array() : array();
		$overdue       = 0;
		$cron_total    = 0;
		if ( is_array( $cron ) ) {
			foreach ( $cron as $ts => $hooks ) {
				if ( ! is_array( $hooks ) ) {
					continue;
				}
				$n = 0;
				foreach ( $hooks as $events ) {
					$n += is_array( $events ) ? count( $events ) : 0;
				}
				$cron_total += $n;
				if ( (int) $ts <= time() ) {
					$overdue += $n;
				}
			}
		}

		$report = array(
			'url'         => ( isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : '' ) . ( $_SERVER['REQUEST_URI'] ?? '' ),
			'time'        => gmdate( 'c' ),
			'php'         => PHP_VERSION,
			'wp'          => $GLOBALS['wp_version'] ?? '',
			'totals_ms'   => array(
				'php-before-wp'    => round( ( self::$t0 - $request_start ) * 1000, 2 ),
				'core-before-mu'   => round( ( self::$marks['mu-profiler-loaded'] ?? 0 ) * 1000, 2 ),
				'wp-before-template' => isset( self::$marks['template_include'] ) ? round( self::$marks['template_include'] * 1000, 2 ) : null,
				'wp-total'         => round( ( self::$marks['shutdown'] ?? 0 ) * 1000, 2 ),
				'peak-memory-mb'   => round( memory_get_peak_usage( true ) / 1048576, 1 ),
			),
			'stages'      => self::$stages,
			'marks_ms'    => array_map(
				static function ( $v ) {
					return round( $v * 1000, 2 );
				},
				self::$marks
			),
			'by_source'   => $by_source,
			'files'       => array_slice( $files, 0, 40 ),
			'callbacks'   => array_slice( $callbacks, 0, 60 ),
			'http'        => self::$http,
			'db'          => array(
				'queries_before_mu_untimed' => isset( $wpdb->num_queries ) ? max( 0, (int) $wpdb->num_queries - ( isset( $wpdb->queries ) && is_array( $wpdb->queries ) ? count( $wpdb->queries ) : 0 ) ) : self::$queries_before_mu,
				'total'                     => array(
					'count' => $total['count'],
					'ms'    => round( $total['ms'], 2 ),
				),
				'by_type'                   => $by_type,
				'slowest'                   => $slowest,
			),
			'environment' => array(
				'ext_object_cache'  => function_exists( 'wp_using_ext_object_cache' ) ? (bool) wp_using_ext_object_cache() : null,
				'object_cache_class' => is_object( $wp_object_cache ) ? get_class( $wp_object_cache ) : null,
				'cache_hits'        => is_object( $wp_object_cache ) && isset( $wp_object_cache->cache_hits ) ? (int) $wp_object_cache->cache_hits : null,
				'cache_misses'      => is_object( $wp_object_cache ) && isset( $wp_object_cache->cache_misses ) ? (int) $wp_object_cache->cache_misses : null,
				'alloptions_count'  => is_array( $alloptions ) ? count( $alloptions ) : null,
				'alloptions_kb'     => is_array( $alloptions ) ? round( strlen( serialize( $alloptions ) ) / 1024 ) : null, // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize
				'opcache'           => function_exists( 'opcache_get_status' ) ? (bool) ( opcache_get_status( false )['opcache_enabled'] ?? false ) : null,
				'wp_cache_dropin'   => defined( 'WP_CACHE' ) && WP_CACHE && file_exists( WP_CONTENT_DIR . '/advanced-cache.php' ),
				'disable_wp_cron'   => defined( 'DISABLE_WP_CRON' ) ? (bool) DISABLE_WP_CRON : false,
				'cron_spawned_here' => self::$cron_spawned,
				'cron_events'       => $cron_total,
				'cron_overdue'      => $overdue,
				'active_plugins'    => (array) get_option( 'active_plugins', array() ),
				'theme'             => function_exists( 'get_template' ) ? get_template() : '',
				'is_rest'           => defined( 'REST_REQUEST' ) && REST_REQUEST,
				'is_admin'          => function_exists( 'is_admin' ) && is_admin(),
			),
		);

		self::emit( $report );
	}

	private static function stage_of_query_start( float $start ): string {
		if ( $start <= 0 ) {
			return '';
		}
		$rel  = $start - self::$t0;
		$best = 'core-before-mu';
		foreach ( self::$marks as $name => $t ) {
			if ( $t <= $rel && ( ! isset( self::$marks[ $best ] ) || $t >= self::$marks[ $best ] ) ) {
				$best = $name;
			}
		}
		return $best;
	}

	private static function emit( array $report ): void {
		$mode = (string) ( $_GET['sc_profile_out'] ?? 'html' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		// Our buffer holds the whole response; close anything opened above it.
		while ( ob_get_level() > self::$ob_level + 1 ) {
			ob_end_flush();
		}
		$body = ob_get_level() > self::$ob_level ? (string) ob_get_clean() : '';

		if ( ! headers_sent() ) {
			header( 'Cache-Control: no-store, private, max-age=0' );
			header( 'X-SC-Profile: 1' );
			$timing = array();
			foreach ( $report['stages'] as $name => $st ) {
				$timing[] = 'sc-' . preg_replace( '/[^a-z0-9_-]/i', '-', $name ) . ';dur=' . $st['ms'];
			}
			foreach ( $report['totals_ms'] as $name => $ms ) {
				if ( null !== $ms ) {
					$timing[] = 'sc-' . $name . ';dur=' . $ms;
				}
			}
			header( 'Server-Timing: ' . implode( ', ', $timing ), false );
		}

		if ( 'json' === $mode ) {
			if ( ! headers_sent() ) {
				header_remove( 'Location' );
				header( 'Content-Type: application/json; charset=utf-8', true, 200 );
			}
			echo wp_json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
			return;
		}
		if ( 'text' === $mode ) {
			if ( ! headers_sent() ) {
				header_remove( 'Location' );
				header( 'Content-Type: text/plain; charset=utf-8', true, 200 );
			}
			echo self::text( $report );
			return;
		}

		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- the page, unchanged.
		if ( false !== stripos( $body, '</html>' ) || false !== stripos( $body, '<html' ) ) {
			echo "\n<!-- sc-profile\n" . str_replace( '--', '- -', self::text( $report ) ) . "\n-->\n";
		}
	}

	private static function text( array $r ): string {
		$out   = array();
		$out[] = 'StatChasers request profile  ' . $r['url'] . '  ' . $r['time'];
		$out[] = 'PHP ' . $r['php'] . '  WP ' . $r['wp'] . '  theme ' . $r['environment']['theme'];
		$out[] = '';
		$out[] = '== Totals (ms) ==';
		foreach ( $r['totals_ms'] as $k => $v ) {
			$out[] = sprintf( '  %-22s %s', $k, null === $v ? '-' : $v );
		}
		$out[] = '';
		$out[] = '== Stages (ms, in request order) ==';
		$out[] = sprintf( '  %-30s %9s %7s %9s %5s', 'stage', 'ms', 'queries', 'query_ms', 'http' );
		foreach ( $r['stages'] as $name => $st ) {
			$out[] = sprintf( '  %-30s %9.2f %7d %9.2f %5d', $name, $st['ms'], $st['queries'], $st['query_ms'], $st['http'] );
		}
		$out[] = '';
		$out[] = '== By source (plugin/theme/core): file loads + watched-hook callbacks ==';
		$out[] = sprintf( '  %-44s %9s %5s %7s %5s', 'source', 'ms', 'cbs', 'queries', 'http' );
		foreach ( $r['by_source'] as $src => $s ) {
			$out[] = sprintf( '  %-44s %9.2f %5d %7d %5d', $src, $s['ms'], $s['callbacks'], $s['queries'], $s['http'] );
		}
		$out[] = '';
		$out[] = '== File includes (slowest) ==';
		foreach ( array_slice( $r['files'], 0, 25 ) as $f ) {
			$out[] = sprintf( '  %9.2f  %s', $f['ms'], $f['file'] );
		}
		$out[] = '';
		$out[] = '== Callbacks (slowest, watched hooks) ==';
		$out[] = sprintf( '  %9s %7s %9s %4s  %-18s %-44s %s', 'ms', 'queries', 'query_ms', 'http', 'hook', 'source', 'callback' );
		foreach ( array_slice( $r['callbacks'], 0, 40 ) as $c ) {
			$out[] = sprintf( '  %9.2f %7d %9.2f %4d  %-18s %-44s %s', $c['ms'], $c['queries'], $c['query_ms'], $c['http'], $c['hook'] . '@' . $c['priority'], substr( $c['source'], 0, 44 ), $c['callback'] );
		}
		$out[] = '';
		$out[] = '== Remote HTTP ==';
		if ( empty( $r['http'] ) ) {
			$out[] = '  none';
		}
		foreach ( $r['http'] as $h ) {
			$out[] = sprintf( '  %9s  %-6s %s  [%s] status=%s %s', null === $h['ms'] ? 'open' : $h['ms'], $h['method'], $h['url'], $h['stage'], null === $h['status'] ? '-' : $h['status'], $h['error'] );
			if ( '' !== $h['caller'] ) {
				$out[] = '             via ' . $h['caller'];
			}
		}
		$out[] = '';
		$out[] = '== Database ==';
		$out[] = sprintf( '  total %d queries, %.2f ms; untimed before mu-plugins: %d', $r['db']['total']['count'], $r['db']['total']['ms'], $r['db']['queries_before_mu_untimed'] );
		foreach ( $r['db']['by_type'] as $type => $t ) {
			$out[] = sprintf( '  %-18s %5d  %9.2f ms', $type, $t['count'], $t['ms'] );
		}
		$out[] = '  slowest:';
		foreach ( $r['db']['slowest'] as $q ) {
			$out[] = sprintf( '  %9.2f  %-16s %-22s %s', $q['ms'], $q['type'], $q['stage'], $q['sql'] );
			$out[] = '             via ' . $q['caller'];
		}
		$out[] = '';
		$out[] = '== Environment ==';
		foreach ( $r['environment'] as $k => $v ) {
			if ( is_array( $v ) ) {
				$v = implode( ', ', $v );
			} elseif ( is_bool( $v ) ) {
				$v = $v ? 'yes' : 'no';
			} elseif ( null === $v ) {
				$v = '-';
			}
			$out[] = sprintf( '  %-20s %s', $k, $v );
		}
		return implode( "\n", $out ) . "\n";
	}

	/* ------------------------------------------------------------- helpers */

	public static function relative( string $file ): string {
		$file = str_replace( '\\', '/', $file );
		$root = str_replace( '\\', '/', rtrim( ABSPATH, '/\\' ) );
		if ( 0 === strpos( $file, $root . '/' ) ) {
			return substr( $file, strlen( $root ) + 1 );
		}
		return $file;
	}

	public static function source_of( string $file ): string {
		if ( '' === $file ) {
			return 'core';
		}
		$file = str_replace( '\\', '/', $file );
		$maps = array(
			'plugin'    => defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '',
			'mu-plugin' => defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '',
			'theme'     => defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/themes' : '',
		);
		foreach ( $maps as $kind => $dir ) {
			$dir = str_replace( '\\', '/', rtrim( (string) $dir, '/' ) );
			if ( '' !== $dir && 0 === strpos( $file, $dir . '/' ) ) {
				$rest = substr( $file, strlen( $dir ) + 1 );
				$seg  = explode( '/', $rest );
				return $kind . ':' . ( 'mu-plugin' === $kind ? $rest : $seg[0] );
			}
		}
		if ( defined( 'WP_CONTENT_DIR' ) && 0 === strpos( $file, str_replace( '\\', '/', WP_CONTENT_DIR ) . '/' ) ) {
			return 'wp-content:' . basename( $file );
		}
		if ( false !== strpos( $file, '/wp-admin/' ) ) {
			return 'core-admin';
		}
		return 'core';
	}
}

SC_Profile::boot();
