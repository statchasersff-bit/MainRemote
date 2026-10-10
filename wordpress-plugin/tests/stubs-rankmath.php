<?php
/**
 * The pieces of Rank Math the plugin's game sitemap talks to, stubbed for
 * smoke.php: the provider interface it implements, the router that names a
 * sitemap file and the cache it invalidates. Namespaced, so this lives in a
 * file of its own; smoke.php requires it before the plugin loads.
 *
 * @package StatChasers\Tests
 */

namespace RankMath\Sitemap\Providers;

interface Provider {
	public function handles_type( $type );
	public function get_index_links( $max_entries );
	public function get_sitemap_links( $type, $max_entries, $current_page );
}

namespace RankMath\Sitemap;

class Router {
	public static function get_base_url( $page ) {
		return 'https://example.com/' . $page;
	}
}

class Cache {
	public static function invalidate_storage( $type = null ) {
		$GLOBALS['rank_math_invalidated'][] = $type;
	}
}
