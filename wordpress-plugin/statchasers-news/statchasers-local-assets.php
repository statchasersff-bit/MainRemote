<?php
/**
 * The API's built team assets, served from WordPress (WEB-023).
 *
 * The team hub's stylesheet and bundle (team.css, dist/statchasers-team.js)
 * are built by the API and normally load from the public asset host
 * (statchasers_public_origin(), news.statchasers.com). When that host is
 * unreachable for a reader the server-rendered fragment still arrives - it is
 * fetched server-side and cached - but it arrives without its layout and its
 * controls: the depth chart's view pills, the search box and the tab strip.
 *
 * So build-zip.sh copies the API's build output into this plugin at
 * assets/api/ (same relative paths as on the API: /team.css,
 * /dist/statchasers-team.js) with a manifest.json naming the API build they
 * came from, and the routes listed in statchasers_local_asset_sections() load
 * those copies from the WordPress origin instead.
 *
 * THE LOCKSTEP RULE. The fragment's markup and the stylesheet must come from
 * the same API build; a copy from another build styles markup it was not
 * written for. A bundled file is used only when it is the build the API is
 * serving now:
 *
 *   1. the manifest's version equals statchasers_news_asset_version() (the
 *      hash the API reports at /embed/assets.json, the same `ver=` the page
 *      prints) - the normal case right after a release; or
 *   2. the versions differ (the API was deployed since the zip was built, and
 *      its hash covers every tool's assets, not just these), but the API's
 *      live copy of THIS file is byte-identical to the bundled one: fetched
 *      server-side once per API version, compared by sha256, never written
 *      anywhere. A deploy that did not touch team.css keeps it local.
 *
 * Anything else - no manifest, a missing or truncated file, a different
 * build, an API that cannot be reached to compare - falls back to the public
 * asset host, which is exactly what every page did before this file existed.
 * The fallback can be no worse than the old behavior; serving a copy from a
 * different build could be.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Where build-zip.sh puts the API's built files, relative to this plugin. */
const STATCHASERS_LOCAL_ASSET_DIR = 'assets/api';

/** How long a "the live file differs" (or "could not compare") verdict is held. */
const STATCHASERS_LOCAL_ASSET_RETRY = 10 * MINUTE_IN_SECONDS;

/**
 * Team sections whose pages load the bundled copies.
 *
 * Only the depth chart for now. Extending to another tab is one string here
 * (or the filter); every team section shares the one handle, so the hub
 * itself (section '') can be added the same way.
 *
 * @return array<int,string>
 */
function statchasers_local_asset_sections(): array {
	return (array) apply_filters( 'statchasers_local_asset_sections', array( 'depth-chart' ) );
}

/**
 * The directory holding the bundled copies. Filtered only so the smoke test
 * can point it at a fixture.
 *
 * @return string Absolute path, no trailing slash.
 */
function statchasers_local_asset_dir(): string {
	return (string) apply_filters( 'statchasers_local_asset_dir', __DIR__ . '/' . STATCHASERS_LOCAL_ASSET_DIR );
}

/**
 * The bundled manifest, or null when this build of the plugin carries none.
 * Read once per request; $reload is for tests that swap fixtures under it.
 *
 * @param bool $reload Read the file again.
 * @return array{version:string,files:array<string,array{sha256:string,bytes:int}>}|null
 */
function statchasers_local_asset_manifest( bool $reload = false ): ?array {
	static $manifest = false;

	if ( false !== $manifest && ! $reload ) {
		return $manifest;
	}

	$manifest = null;
	$file     = statchasers_local_asset_dir() . '/manifest.json';

	if ( is_readable( $file ) ) {
		$data = json_decode( (string) file_get_contents( $file ), true );
		if (
			is_array( $data )
			&& isset( $data['version'], $data['files'] )
			&& is_string( $data['version'] ) && '' !== $data['version']
			&& is_array( $data['files'] )
		) {
			$manifest = array(
				'version' => $data['version'],
				'files'   => $data['files'],
			);
		}
	}

	return $manifest;
}

/**
 * The bundled copy of an API asset path is on disk and is the file the
 * manifest describes (size check - cheap, and catches a truncated upload).
 *
 * @param string $path API-relative path, e.g. '/team.css'.
 * @return array{sha256:string,bytes:int}|null The manifest entry, or null.
 */
function statchasers_local_asset_entry( string $path ): ?array {
	$manifest = statchasers_local_asset_manifest();
	if ( null === $manifest || ! isset( $manifest['files'][ $path ] ) || ! is_array( $manifest['files'][ $path ] ) ) {
		return null;
	}

	$entry = $manifest['files'][ $path ];
	if ( empty( $entry['sha256'] ) || ! isset( $entry['bytes'] ) ) {
		return null;
	}

	$file = statchasers_local_asset_dir() . $path;
	if ( ! is_file( $file ) || (int) filesize( $file ) !== (int) $entry['bytes'] ) {
		return null;
	}

	return array(
		'sha256' => (string) $entry['sha256'],
		'bytes'  => (int) $entry['bytes'],
	);
}

/**
 * Is the API's live copy of $path byte-identical to the bundled one?
 *
 * One server-side GET per API version and path, against the fetch origin
 * (statchasers_news_origin(), which this server already reads fragments
 * from), and the verdict is cached: a match until the version changes, a
 * mismatch or a failed fetch for ten minutes. The "no" is written BEFORE the
 * fetch, so concurrent requests during it take the fallback instead of each
 * fetching the file.
 *
 * @param string $path    API-relative path.
 * @param string $version The API's current asset version.
 * @param string $sha256  The bundled file's hash.
 */
function statchasers_local_asset_matches_live( string $path, string $version, string $sha256 ): bool {
	$key    = 'sc_local_asset_' . md5( $path . '|' . $version . '|' . $sha256 );
	$cached = get_transient( $key );
	if ( 'yes' === $cached ) {
		return true;
	}
	if ( 'no' === $cached ) {
		return false;
	}

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return false;
	}

	set_transient( $key, 'no', STATCHASERS_LOCAL_ASSET_RETRY );

	$response = wp_remote_get(
		$origin . $path . '?ver=' . rawurlencode( $version ),
		array( 'timeout' => 4 )
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return false;
	}

	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body || ! hash_equals( $sha256, hash( 'sha256', $body ) ) ) {
		return false;
	}

	set_transient( $key, 'yes', WEEK_IN_SECONDS );
	return true;
}

/**
 * The URL to load an API asset from, honoring the lockstep rule.
 *
 * @param string $path    API-relative path ('/team.css', '/dist/statchasers-team.js').
 * @param string $version The API's current asset version.
 * @param bool   $local   Whether this page is allowed the bundled copy at all.
 * @return array{url:string,local:bool}
 */
function statchasers_local_asset_url( string $path, string $version, bool $local ): array {
	$remote = array(
		'url'   => statchasers_public_origin() . $path,
		'local' => false,
	);

	if ( ! $local ) {
		return $remote;
	}

	$entry = statchasers_local_asset_entry( $path );
	if ( null === $entry ) {
		return $remote;
	}

	$manifest = statchasers_local_asset_manifest();
	$same     = null !== $manifest && hash_equals( $manifest['version'], $version );

	if ( ! $same && ! statchasers_local_asset_matches_live( $path, $version, $entry['sha256'] ) ) {
		return $remote;
	}

	return array(
		'url'   => plugin_dir_url( __FILE__ ) . STATCHASERS_LOCAL_ASSET_DIR . $path,
		'local' => true,
	);
}

/**
 * The team handle's two URLs for the request being rendered.
 *
 * @param string $section The team section this request is scoped to ('' = hub).
 * @param string $version The API's current asset version.
 * @return array{css:string,js:string,css_local:bool,js_local:bool}
 */
function statchasers_team_asset_urls( string $section, string $version ): array {
	$local = in_array( $section, statchasers_local_asset_sections(), true );
	$css   = statchasers_local_asset_url( '/team.css', $version, $local );
	$js    = statchasers_local_asset_url( '/dist/statchasers-team.js', $version, $local );

	return array(
		'css'       => $css['url'],
		'js'        => $js['url'],
		'css_local' => $css['local'],
		'js_local'  => $js['local'],
	);
}

/**
 * Keep the local stylesheet as it is served from the API: no minify (it is
 * already minified, and WP Rocket's copy would be a second URL to go stale)
 * and no async "load CSS asynchronously" rewrite (the external copy never got
 * one, and the chart would flash unstyled). Matched against the URL.
 *
 * @param mixed $exclusions Existing patterns.
 * @return array
 */
function statchasers_local_asset_css_exclusion( $exclusions ): array {
	if ( ! is_array( $exclusions ) ) {
		$exclusions = array();
	}
	$exclusions[] = '/' . STATCHASERS_LOCAL_ASSET_DIR . '/team.css';
	return $exclusions;
}
add_filter( 'rocket_exclude_css', 'statchasers_local_asset_css_exclusion' );
add_filter( 'rocket_exclude_async_css', 'statchasers_local_asset_css_exclusion' );
add_filter( 'rocket_rucss_excluded_stylesheets', 'statchasers_local_asset_css_exclusion' );
