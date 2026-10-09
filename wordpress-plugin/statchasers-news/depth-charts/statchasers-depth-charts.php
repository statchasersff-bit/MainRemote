<?php
/**
 * NFL Depth Charts: the loader for the depth-charts half of the plugin.
 *
 * Not a plugin of its own. This directory is the former standalone
 * "StatChasers Depth Charts" plugin (last shipped on its own as 1.7.0), moved
 * under statchasers-news/ so one zip installs everything. statchasers-news.php
 * requires this file, and the activation, deactivation and upgrade hooks that
 * used to be registered here against __FILE__ are now called by the parent
 * (scdc_activate(), scdc_deactivate(), scdc_after_upgrade()): WordPress only
 * fires those hooks for a plugin's main file, and this is not one.
 *
 * No "Plugin Name" header on purpose. WordPress only scans the top level of a
 * plugin directory for headers, but a header here would still invite someone
 * to copy the folder out as a plugin again, and two copies of these classes
 * on one site is a fatal on activation. If the standalone copy is still
 * active, statchasers-news.php leaves this file unloaded, deactivates it, and
 * loads this one on the next request.
 *
 * The constants, classes and hook names (scdc_*, SCDC_*) are unchanged from
 * the standalone plugin, so its options, uploads and scheduled refresh carry
 * over untouched.
 *
 * @package StatChasers\DepthCharts
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

/**
 * The depth-charts version: the asset `ver` for frontend.css, frontend.js and
 * hub.css. Bump it when those files change, or a browser keeps the old ones.
 * 1.7.0 was the last standalone release; 1.7.1 is the first embedded one.
 */
define( 'SCDC_VERSION', '1.7.1' );
define( 'SCDC_PLUGIN_FILE', __FILE__ );
define( 'SCDC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCDC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * The NFL season these pages describe. NFL season naming doesn't roll over on
 * January 1, so this is a deliberate single setting rather than date( 'Y' ):
 * change it here (or define SCDC_SEASON in wp-config.php, or use the
 * `scdc_season` filter) and every title, description, H1 and intro follows.
 */
if ( ! defined( 'SCDC_SEASON' ) ) {
	define( 'SCDC_SEASON', 2026 );
}

// Option key that stores refresh metadata (last refreshed time, status, error).
define( 'SCDC_META_OPTION', 'scdc_refresh_meta' );

// admin-post action name for the manual refresh form submission.
define( 'SCDC_REFRESH_ACTION', 'scdc_refresh_depth_charts' );

require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-store.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-teams.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-espn.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-footballguys.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-fantasypros.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-push.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-refresh.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-rewrite.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-pages.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-route.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-admin.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-shortcode.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-hub.php';

/**
 * Boot once all classes are loaded.
 */
function scdc_bootstrap() {
	SCDC_Rewrite::instance()->hooks();
	SCDC_Route::instance()->hooks();
	SCDC_Admin::instance()->hooks();
	SCDC_Shortcode::instance()->hooks();
	SCDC_Hub::instance()->hooks();
}
add_action( 'plugins_loaded', 'scdc_bootstrap' );

/**
 * Activation: provision the /nfl/ + /nfl/nfl-depth-charts/ pages, then register the
 * rewrite rules and flush so the pre-1.7.0 nested URLs redirect immediately.
 *
 * Called from the parent plugin's activation hook, and from scdc_after_upgrade()
 * the first time the embedded copy loads on a site that had the standalone one.
 *
 * @return void
 */
function scdc_activate() {
	SCDC_Pages::ensure_pages();
	SCDC_Rewrite::activate();
}

/**
 * Deactivation: drop the rewrite rules and the daily refresh. Called from the
 * parent plugin's deactivation hook.
 *
 * @return void
 */
function scdc_deactivate() {
	SCDC_Rewrite::deactivate();
	scdc_unschedule_refresh();
}

/**
 * Once per SCDC_VERSION, on the first request that loads this copy.
 *
 * An upload that replaces the installed plugin does not run the activation
 * hook, and neither does the switch from the standalone plugin to this
 * embedded copy (the standalone one is deactivated quietly, so its own
 * deactivation hook never flushes the rules it added). So the pages and the
 * rewrite rules are checked here instead: ensure_pages() reuses what exists,
 * and the flush is deferred to the parent's `statchasers_needs_flush` pass at
 * the end of `init`, once every rule on the site is registered.
 *
 * @return void
 */
function scdc_after_upgrade() {
	if ( SCDC_VERSION === (string) get_option( 'scdc_installed_version', '' ) ) {
		return;
	}
	SCDC_Pages::ensure_pages();
	update_option( 'statchasers_needs_flush', 1, false );
	update_option( 'scdc_installed_version', SCDC_VERSION, false );
}
add_action( 'init', 'scdc_after_upgrade', 20 );

/**
 * The daily refresh. Without it the charts went stale whenever nobody pressed
 * the button. Scheduled on init rather than on activation, because an update
 * does not re-run the activation hook. Same code and deadline as the button,
 * and the two share a lock (SCDC_Refresh::run_and_store).
 *
 * WP-Cron is traffic-driven; for a strict schedule, disable WP_CRON and hit
 * wp-cron.php from a system cron.
 *
 * @return void
 */
function scdc_schedule_refresh() {
	if ( ! wp_next_scheduled( SCDC_Refresh::CRON_HOOK ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', SCDC_Refresh::CRON_HOOK );
	}
}
add_action( 'init', 'scdc_schedule_refresh' );
add_action(
	SCDC_Refresh::CRON_HOOK,
	function () {
		SCDC_Refresh::run_and_store( 720 );
	}
);

/**
 * @return void
 */
function scdc_unschedule_refresh() {
	wp_clear_scheduled_hook( SCDC_Refresh::CRON_HOOK );
}
