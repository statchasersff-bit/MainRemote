<?php
/**
 * Rewrite rules for the depth charts page.
 *
 * The tool has one address, /nfl/nfl-depth-charts/. Until 1.7.0 it also
 * answered nested filter URLs:
 *
 *   /nfl/nfl-depth-charts/{view}/{team}/{position?}/
 *
 * Those are still recognised - the rules below map the segments to the query
 * vars sc_view / sc_team / sc_position and route the request to the real page
 * via `pagename` - but only so that SCDC_Route can 301 them to the page that
 * serves the request now (a team's own page, or the tool). Nothing links to
 * them any more.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Rewrite {

	/** @var SCDC_Rewrite|null */
	private static $instance = null;

	/**
	 * @return SCDC_Rewrite
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Path of the depth charts page relative to the site root, no leading/trailing
	 * slash (e.g. "nfl/nfl-depth-charts"). Filterable for non-standard setups.
	 *
	 * @return string
	 */
	public static function page_path() {
		$path = apply_filters( 'scdc_page_path', 'nfl/nfl-depth-charts' );
		return trim( (string) $path, '/' );
	}

	/**
	 * Register runtime hooks.
	 *
	 * @return void
	 */
	public function hooks() {
		add_action( 'init', array( __CLASS__, 'add_rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		// WordPress's own canonical redirect is left alone: SCDC_Route sends the
		// nested URLs on their way at `wp`, before it runs.
	}

	/**
	 * Register the rewrite rules for the pre-1.7.0 nested segments, so those
	 * URLs reach SCDC_Route instead of 404ing.
	 *
	 * @return void
	 */
	public static function add_rules() {
		$path     = self::page_path();
		$pagename = $path; // hierarchical page path used by the `pagename` query var.

		// {view}/{team}/{position}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/([^/]+)/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]&sc_team=$matches[2]&sc_position=$matches[3]',
			'top'
		);
		// {view}/{team}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]&sc_team=$matches[2]',
			'top'
		);
		// {view}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]',
			'top'
		);
	}

	/**
	 * Whitelist our filter query vars.
	 *
	 * @param array $vars Existing public query vars.
	 * @return array
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'sc_view';
		$vars[] = 'sc_team';
		$vars[] = 'sc_position';
		return $vars;
	}

	/**
	 * Activation: register rules then flush so nested URLs work immediately.
	 *
	 * @return void
	 */
	public static function activate() {
		self::add_rules();
		flush_rewrite_rules();
	}

	/**
	 * Deactivation: flush so our rules are dropped.
	 *
	 * @return void
	 */
	public static function deactivate() {
		flush_rewrite_rules();
	}
}
