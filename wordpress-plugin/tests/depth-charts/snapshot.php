<?php
/**
 * Build the depth-chart snapshot the Replit preview renders from.
 *
 * Runs the plugin's own refresh (SCDC_Refresh::run_and_store) against the
 * WordPress shims, with wp_remote_get backed by curl, and writes the cache file
 * where the preview reads it:
 *
 *   php snapshot.php <basedir>
 *   -> <basedir>/statchasers/depth-charts.json   the plugin's cache, unchanged
 *   -> <basedir>/statchasers/meta.json           scdc_refresh_meta, which on a
 *                                                real site lives in wp_options
 *
 * Same code path as the admin button, so the data is shaped exactly as the
 * live site's. Movement arrows diff against the snapshot already there, the
 * way the live refresh diffs against its last run.
 */

if ( empty( $argv[1] ) ) {
	fwrite( STDERR, "usage: php snapshot.php <basedir>\n" );
	exit( 2 );
}

require __DIR__ . '/wp-stubs.php';

$basedir = rtrim( $argv[1], '/' );
$GLOBALS['scdc_test_basedir'] = $basedir;

$meta_file = $basedir . '/statchasers/meta.json';
if ( is_file( $meta_file ) ) {
	$GLOBALS['wp_options']['scdc_refresh_meta'] = json_decode( (string) file_get_contents( $meta_file ), true );
} else {
	unset( $GLOBALS['wp_options']['scdc_refresh_meta'] );
}

function wp_remote_get( $url, $args = array() ) {
	$headers = array();
	foreach ( isset( $args['headers'] ) ? $args['headers'] : array() as $k => $v ) {
		$headers[] = $k . ': ' . $v;
	}
	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_TIMEOUT        => isset( $args['timeout'] ) ? (int) $args['timeout'] : 10,
			CURLOPT_USERAGENT      => isset( $args['user-agent'] ) ? $args['user-agent'] : 'Mozilla/5.0',
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_ENCODING       => '',
		)
	);
	$body = curl_exec( $ch );
	$code = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
	curl_close( $ch );
	fwrite( STDERR, sprintf( "%3d  %s\n", $code, $url ) );
	return array( 'code' => false === $body ? 0 : $code, 'body' => false === $body ? '' : $body );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
function get_category_by_slug( $slug ) { return false; }

require __DIR__ . '/../../statchasers-news/depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

$status = SCDC_Refresh::run_and_store();
$meta   = SCDC_Store::get_meta();

wp_mkdir_p( dirname( $meta_file ) );
file_put_contents( $meta_file, json_encode( $meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n" );

echo "status   {$status}\n";
echo 'teams_ok ' . ( isset( $meta['teams_ok'] ) ? $meta['teams_ok'] : 0 ) . "\n";
if ( ! empty( $meta['error'] ) ) {
	echo "error    {$meta['error']}\n";
}
exit( 'error' === $status ? 1 : 0 );
