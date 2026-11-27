<?php
/**
 * WEB-003: the Fantasy Points Allowed publication check
 * (statchasers-fpa-cache.php), against the stub harness.
 *
 * The API is answered per URL ($GLOBALS['http_route']): the version document,
 * and each fragment with the ETag a test chooses, so a single variant can
 * fail or move. $GLOBALS['sc_order'] traces fetches, transient writes, the
 * WP Rocket clean and the edge purge in the order they happen. The full path
 * through a real WordPress, the WP Rocket model and the edge model is
 * scripts/fpa/web003/replay.mjs. smoke.php runs this as
 * STATCHASERS_SMOKE_GROUP=fpacache.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_fpa_publish_check' ) ) {
	fwrite( STDERR, "smoke-fpa-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

echo "\nFantasy Points Allowed publication (WEB-003)\n";

$base    = '/nfl/fantasy-points-allowed-by-position/';
$archive = '/nfl/fantasy-points-allowed-by-position/2025/';

/* ------------------------------------------------------------ the addresses */

$cur_paths = statchasers_fpa_purge_paths( 0 );
$arc_paths = statchasers_fpa_purge_paths( 2025 );
is( count( $cur_paths ), 18, 'paths: the address + 3 formats + 2 views + 6 pairs in both orders' );
is( $cur_paths[0], $base, 'paths: the canonical address first' );
foreach ( array( '?format=half', '?format=standard', '?format=ppr', '?view=adjusted', '?view=raw', '?format=half&view=adjusted', '?view=adjusted&format=half', '?format=ppr&view=adjusted', '?format=standard&view=raw' ) as $q ) {
	is( in_array( $base . $q, $cur_paths, true ), true, "paths: {$q} (a link, a bookmark or the old Half-PPR default)" );
}
is( count( array_filter( $cur_paths, static fn( $p ) => false !== strpos( $p, '/2025/' ) ) ), 0, 'paths: the current season purges nothing under /2025/' );
is( count( $arc_paths ), 18, 'paths: the archive has the same 18' );
is( count( array_filter( $arc_paths, static fn( $p ) => 0 !== strpos( $p, $archive ) ) ), 0, 'paths: the archive purges only under /2025/' );
is( array_keys( statchasers_fpa_variants( 0 ) ), array( 'standard-raw', 'standard-adjusted', 'half-raw', 'half-adjusted', 'ppr-raw', 'ppr-adjusted' ), 'variants: 3 formats x 2 views' );
is( statchasers_fpa_variants( 2025 )['half-adjusted'], array( 'format' => 'half', 'view' => 'adjusted', 'season' => 2025 ), 'variants: in the shortcode\'s argument order' );
$_GET = array();
is( statchasers_fpa_cache_keys( statchasers_fpa_args( array() ) ), statchasers_fpa_cache_keys( statchasers_fpa_variants( 0 )['ppr-raw'] ), 'keys: the page\'s default render is the ppr-raw variant\'s transient' );
$_GET = array( 'format' => 'half', 'view' => 'adjusted' );
is( statchasers_fpa_cache_keys( statchasers_fpa_args( array() ) ), statchasers_fpa_cache_keys( statchasers_fpa_variants( 0 )['half-adjusted'] ), 'keys: ?format=half&view=adjusted is the half-adjusted variant\'s transient' );
$_GET = array();
is( in_array( 'statchasers_fpa_published', statchasers_edge_retry_options(), true ), true, 'retry: the FPA record may take a retry warm-up' );

echo "\nthe edge lifetime\n";
is( statchasers_fpa_edge_ttl( 0, false ), 6 * 3600, 'current season: six hours, as the stats pages' );
is( statchasers_fpa_edge_ttl( 2025, false ), 30 * 86400, 'archive: 30 days' );
is( statchasers_fpa_edge_ttl( 2019, true ), 0, 'a season with no table: none (the 404 sends its own)' );

/* ---------------------------------------------------------------- the API */

$GLOBALS['sc_test_rocket'] = array();
if ( ! function_exists( 'rocket_clean_files' ) ) {
	function rocket_clean_files( $urls ) {
		$GLOBALS['sc_test_rocket'][] = $urls;
		if ( isset( $GLOBALS['sc_order'] ) ) {
			$GLOBALS['sc_order'][] = 'rocket';
		}
	}
}
$GLOBALS['sc_test_edge']        = array();
$GLOBALS['sc_test_edge_answer'] = 'ok';
add_filter(
	STATCHASERS_FPA_PURGE_FILTER,
	static function ( $result, $paths = array() ) {
		$GLOBALS['sc_test_edge'][] = $paths;
		if ( isset( $GLOBALS['sc_order'] ) ) {
			$GLOBALS['sc_order'][] = 'edge';
		}
		if ( 'fail' === $GLOBALS['sc_test_edge_answer'] ) {
			return array( 'failed' => $paths, 'text' => 'rocket.net refused' );
		}
		return array( 'failed' => array(), 'text' => 'rocket.net ok' );
	}
);

// The API's state: per season a version tag and a kind; a fragment answers
// with the ETag of its season's tag unless a test breaks one.
$GLOBALS['api'] = array(
	'up'      => true,
	'current' => 2026,
	'tags'    => array( 2026 => 'a', 2025 => 'x' ),
	'fail'    => '',
	'moved'   => '',
);
$etag_of = static fn( int $year, string $key, string $tag ): string => 'W/"' . $year . '-' . $key . '-' . $tag . '"';
$GLOBALS['http_route'] = static function ( string $url ) use ( $etag_of ) {
	$api = $GLOBALS['api'];
	if ( ! $api['up'] ) {
		return array( 503, '', array() );
	}
	if ( false !== strpos( $url, '/embed/fpa/version' ) ) {
		$seasons = array();
		foreach ( $api['tags'] as $year => $tag ) {
			$variants = array();
			foreach ( array_keys( statchasers_fpa_variants( 0 ) ) as $key ) {
				list( $format, $view ) = explode( '-', $key );
				$variants[ $key ]      = array( 'format' => $format, 'view' => $view, 'etag' => $etag_of( $year, $key, $tag ) );
			}
			$seasons[ (string) $year ] = array(
				'kind'       => $year === $api['current'] ? 'live' : 'archive',
				'version'    => $year . $tag,
				'weekNumber' => $year === $api['current'] ? 11 : 17,
				'updatedAt'  => '2026-11-25T10:00:00Z',
				'variants'   => $variants,
			);
		}
		return array( 200, json_encode( array( 'version' => md5( json_encode( $api['tags'] ) ), 'current' => $api['current'], 'seasons' => $seasons ) ), array() );
	}
	if ( false !== strpos( $url, '/embed/fpa?' ) ) {
		parse_str( (string) parse_url( $url, PHP_URL_QUERY ), $q );
		$year = isset( $q['season'] ) ? (int) $q['season'] : $api['current'];
		$key  = $q['format'] . '-' . $q['view'];
		if ( "{$year} {$key}" === $api['fail'] ) {
			return array( 500, '', array() );
		}
		$tag = "{$year} {$key}" === $api['moved'] ? 'zzz' : $api['tags'][ $year ];
		return array( 200, "<div class=\"scf\" data-format=\"{$q['format']}\">{$year} {$tag}</div>", array( 'etag' => $etag_of( $year, $key, $tag ) ) );
	}
	return array( 200, '', array() );
};

$reset = static function (): void {
	$GLOBALS['sc_test_rocket']   = array();
	$GLOBALS['sc_test_edge']     = array();
	$GLOBALS['scheduled']        = array();
	$GLOBALS['remote_urls']      = array();
	$GLOBALS['transient_writes'] = array();
	$GLOBALS['sc_order']         = array();
};
$fragment_gets = static fn(): array => array_values( array_filter( $GLOBALS['remote_urls'], static fn( $u ) => false !== strpos( $u, '/embed/fpa?' ) ) );
$first_index   = static function ( string $prefix ): int {
	foreach ( $GLOBALS['sc_order'] as $i => $step ) {
		if ( 0 === strpos( $step, $prefix ) ) {
			return $i;
		}
	}
	return -1;
};
$last_index = static function ( string $prefix ): int {
	$at = -1;
	foreach ( $GLOBALS['sc_order'] as $i => $step ) {
		if ( 0 === strpos( $step, $prefix ) ) {
			$at = $i;
		}
	}
	return $at;
};

echo "\nthe API is down\n";
$reset();
$GLOBALS['api']['up'] = false;
$r = statchasers_fpa_publish_check();
is( $r['result'], 'version unavailable; nothing changed', 'API down: reported' );
is( isset( $r['version'] ), false, 'API down: no version recorded' );
is( count( $GLOBALS['sc_test_rocket'] ) + count( $GLOBALS['sc_test_edge'] ) + count( $GLOBALS['transient_writes'] ), 0, 'API down: no copy written, no page cache cleared, no edge purge' );
$GLOBALS['api']['up'] = true;

echo "\nthe first publication: both seasons\n";
$reset();
$r = statchasers_fpa_publish_check();
is( $r['result'], 'published', 'first run: published' );
is( $r['changed'], array( 2026, 2025 ), 'first run: the current season and the archive (nothing on record yet)' );
is( count( $fragment_gets() ), 12, 'first run: 6 fragments per season' );
is( count( array_filter( $fragment_gets(), static fn( $u ) => false !== strpos( $u, 'season=2025' ) ) ), 6, 'first run: the archive\'s six ask for season=2025' );
is( count( array_filter( $fragment_gets(), static fn( $u ) => false !== strpos( $u, 'season=' ) && false === strpos( $u, 'season=2025' ) ) ), 0, 'first run: the current season\'s six name no season (the bare address\'s render)' );
is( count( $GLOBALS['transient_writes'] ), 24, 'first run: 12 fresh copies + 12 backups' );
$written = array_column( $GLOBALS['transient_writes'], 0 );
$keys    = statchasers_fpa_cache_keys( statchasers_fpa_variants( 0 )['ppr-raw'] );
is( in_array( $keys['fresh'], $written, true ) && in_array( $keys['backup'], $written, true ), true, 'first run: the page\'s own default transients are among them' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com' . $base, 'https://example.com' . $archive ) ), 'first run: WP Rocket cleared for both addresses' );
is( count( $GLOBALS['sc_test_edge'] ), 1, 'first run: one edge purge' );
is( count( $GLOBALS['sc_test_edge'][0] ), 36, 'first run: 18 paths per season' );
is( $last_index( 'get ' ) < $first_index( 'transient ' ), true, 'order: every fragment fetched before any copy is written' );
is( $last_index( 'transient ' ) < $first_index( 'rocket' ), true, 'order: every copy written before WP Rocket is cleared' );
is( $first_index( 'rocket' ) < $first_index( 'edge' ), true, 'order: WP Rocket cleared before the edge purge' );
is( array_column( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_FPA_WARM_HOOK === $e[0] ), 0 ), array( STATCHASERS_FPA_WARM_HOOK ), 'order: then the warm-up, a minute later' );
is( $r['to_warm'], array( 'https://example.com' . $base, 'https://example.com' . $archive ), 'warm: both addresses' );
is( array( $r['seasons']['2026']['version'], $r['seasons']['2026']['kind'], $r['seasons']['2026']['week'] ), array( '2026a', 'live', 11 ), 'record: the current season\'s version, kind and through-week' );
is( array( $r['seasons']['2025']['version'], $r['seasons']['2025']['kind'] ), array( '2025x', 'archive' ), 'record: the archive\'s' );
$reset();
$w = statchasers_fpa_warm();
is( count( $w ), 4, 'warm: each address once as a desktop and once as a phone' );
is( false !== strpos( (string) ( $GLOBALS['remote_args'][ count( $GLOBALS['remote_args'] ) - 1 ]['user-agent'] ?? '' ), 'iPhone' ), true, 'warm: the phone request is a phone' );

echo "\nnothing new\n";
$reset();
$r = statchasers_fpa_publish_check();
is( $r['result'], 'unchanged', 'same versions: unchanged' );
is( array( count( $fragment_gets() ), count( $GLOBALS['sc_test_rocket'] ), count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['transient_writes'] ) ), array( 0, 0, 0, 0 ), 'same versions: the version read only' );

echo "\nthe weekly ingest: the current season moves, the archive does not\n";
$reset();
$GLOBALS['api']['tags'][2026] = 'b';
$r = statchasers_fpa_publish_check();
is( array( $r['result'], $r['changed'] ), array( 'published', array( 2026 ) ), 'weekly: the current season only' );
is( count( $fragment_gets() ), 6, 'weekly: its six fragments' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com' . $base ) ), 'weekly: WP Rocket cleared for the current address only' );
is( $GLOBALS['sc_test_edge'], array( $cur_paths ), 'weekly: exactly the current season\'s 18 paths' );
is( $r['seasons']['2025']['version'], '2025x', 'weekly: the archive\'s record untouched' );

echo "\na fragment fails: the last complete dataset stays\n";
$reset();
$GLOBALS['api']['tags'][2026] = 'c';
$GLOBALS['api']['fail']       = '2026 half-adjusted';
$r = statchasers_fpa_publish_check();
is( $r['result'], 'fetch failed for 2026 half-adjusted; previous dataset kept', 'fetch failure: reported' );
is( array( count( $GLOBALS['transient_writes'] ), count( $GLOBALS['sc_test_rocket'] ), count( $GLOBALS['sc_test_edge'] ) ), array( 0, 0, 0 ), 'fetch failure: no copy written (backups untouched), no WP Rocket clean, no purge' );
is( array( $r['seasons']['2026']['version'], $r['version'] === md5( json_encode( array( 2026 => 'b', 2025 => 'x' ) ) ) ), array( '2026b', true ), 'fetch failure: the published record is still the last complete dataset' );
$reset();
$GLOBALS['api']['fail']  = '';
$GLOBALS['api']['moved'] = '2026 standard-raw';
$r = statchasers_fpa_publish_check();
is( $r['result'], '2026 standard-raw moved during the check; retrying next run', 'ETag moved: refused' );
is( array( count( $GLOBALS['transient_writes'] ), count( $GLOBALS['sc_test_edge'] ), $r['seasons']['2026']['version'] ), array( 0, 0, '2026b' ), 'ETag moved: nothing written, nothing purged' );
$reset();
$GLOBALS['api']['moved'] = '';
$r = statchasers_fpa_publish_check();
is( array( $r['result'], $r['seasons']['2026']['version'], count( $GLOBALS['sc_test_edge'] ) ), array( 'published', '2026c', 1 ), 'next run: the new dataset published' );

echo "\na historical correction: only the archive moves\n";
$reset();
$GLOBALS['api']['tags'][2025] = 'y';
$r = statchasers_fpa_publish_check();
is( $r['changed'], array( 2025 ), 'correction: the archive only' );
is( count( array_filter( $fragment_gets(), static fn( $u ) => false !== strpos( $u, 'season=2025' ) ) ), 6, 'correction: its six fragments, season=2025' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com' . $archive ) ), 'correction: WP Rocket cleared for /2025/ only' );
is( $GLOBALS['sc_test_edge'], array( $arc_paths ), 'correction: the archive\'s 18 paths, nothing of the current page' );
is( $r['to_warm'], array( 'https://example.com' . $archive ), 'correction: /2025/ warmed' );

echo "\nforced (the by-hand path)\n";
$reset();
$r = statchasers_fpa_publish_check( true );
is( array( $r['result'], $r['changed'], count( $GLOBALS['sc_test_edge'][0] ?? array() ) ), array( 'republished (forced)', array( 2026, 2025 ), 36 ), 'forced: every season refetched and purged' );

echo "\nthe edge refuses: retried, never warmed before it lands\n";
$reset();
$GLOBALS['sc_test_edge_answer'] = 'fail';
$GLOBALS['api']['tags'][2026]   = 'd';
$r = statchasers_fpa_publish_check();
is( array( $r['result'], $r['edge_state'], $r['edge_pending'] ), array( 'published', 'pending', 18 ), 'refused: published, the 18 paths pending' );
is( array( $r['to_warm'], count( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_FPA_WARM_HOOK === $e[0] ) ) ), array( array(), 0 ), 'refused: nothing warmed' );
$age = static function ( int $secs ): void {
	$rec = get_option( STATCHASERS_FPA_PUBLISHED_OPTION );
	foreach ( array( 'next_at', 'first_at', 'last_at' ) as $k ) {
		if ( ! empty( $rec['edge_retry'][ $k ] ) ) {
			$rec['edge_retry'][ $k ] -= $secs;
		}
	}
	update_option( STATCHASERS_FPA_PUBLISHED_OPTION, $rec );
};
$reset();
$age( 300 );
$GLOBALS['sc_test_edge_answer'] = 'ok';
$r = statchasers_fpa_publish_check();
is( array( $r['result'], $r['edge_state'], $r['retry'] ), array( 'unchanged', 'ok', 'attempt 2 of 6: rocket.net ok' ), 'retry: landed on the next due run' );
is( array( $GLOBALS['sc_test_edge'], count( $fragment_gets() ), count( $GLOBALS['sc_test_rocket'] ) ), array( array( $cur_paths ), 0, 0 ), 'retry: exactly the pending paths; no fragment fetch, no WP Rocket clean' );
$rw = array_values( array_filter( $GLOBALS['scheduled'], static fn( $e ) => STATCHASERS_EDGE_RETRY_WARM_HOOK === $e[0] ) );
is( $rw[0][3] ?? null, array( STATCHASERS_FPA_PUBLISHED_OPTION, STATCHASERS_FPA_WARM_TAG, array( 'https://example.com' . $base ) ), 'retry: then the page is warmed' );

echo "\nthe season rollover\n";
$reset();
$GLOBALS['api']['current'] = 2027;
$GLOBALS['api']['tags']    = array( 2027 => 'a', 2026 => 'd', 2025 => 'y' );
$r = statchasers_fpa_publish_check();
is( $r['changed'], array( 2027, 2026 ), 'rollover: the new season (the bare address) and 2026, now an archive at /2026/' );
is( $GLOBALS['sc_test_rocket'], array( array( 'https://example.com' . $base, 'https://example.com/nfl/fantasy-points-allowed-by-position/2026/' ) ), 'rollover: both addresses cleared; /2025/ left alone' );

echo "\nan incomplete version document is not a dataset\n";
$reset();
$GLOBALS['http_route_saved'] = $GLOBALS['http_route'];
$GLOBALS['http_route']       = static function ( string $url ) {
	if ( false !== strpos( $url, '/embed/fpa/version' ) ) {
		return array( 200, json_encode( array( 'version' => 'v', 'current' => 2027, 'seasons' => array( '2027' => array( 'version' => 'q', 'variants' => array( 'ppr-raw' => array( 'etag' => 'W/"x"' ) ) ) ) ) ), array() );
	}
	return null;
};
$r = statchasers_fpa_publish_check();
is( array( $r['result'], count( $GLOBALS['sc_test_edge'] ), count( $GLOBALS['transient_writes'] ) ), array( 'version unavailable; nothing changed', 0, 0 ), 'five variants missing: refused, nothing touched' );
$GLOBALS['http_route'] = $GLOBALS['http_route_saved'];
unset( $GLOBALS['sc_order'] );
