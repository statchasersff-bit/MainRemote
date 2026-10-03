<?php
/**
 * The rewrite rules ask for their own flush, in a process of its own.
 *
 * A changed rule does nothing until WordPress rebuilds its rule table, and an
 * upgrade by zip does not run the activation hook that asks for that. So each
 * file that adds or changes a rule remembers the rule's signature and raises
 * `statchasers_needs_flush` when it differs - which statchasers-news.php acts
 * on at the end of `init`. The schedule's week rule had no such thing, and the
 * matchup game rule changed shape (it learned the postseason) without one, so
 * both would have 404ed on every site that updated rather than installed.
 *
 * Split out because it runs every `init` callback the plugin registered, with
 * the options table empty, which is not a state the main group can be left in.
 *
 * smoke.php includes this with STATCHASERS_SMOKE_GROUP=rules set; running it
 * directly does nothing, because the plugin is not loaded.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_heading' ) ) {
	fwrite( STDERR, "smoke-rules.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

// What the other `init` callbacks reach for, and the main group never calls.
if ( ! function_exists( 'wp_next_scheduled' ) ) {
	function wp_next_scheduled( $hook ) { return 1; }
}
if ( ! function_exists( 'wp_schedule_event' ) ) {
	function wp_schedule_event() { return true; }
}

/** Every `init` callback, in registration order: what WordPress does. */
function statchasers_smoke_run_init(): void {
	foreach ( $GLOBALS['hooks']['init'] ?? array() as $fn ) {
		$fn();
	}
}

echo "\na new or changed rewrite rule asks for its own flush\n";

$GLOBALS['options'] = array();
statchasers_smoke_run_init();

is( (int) ( $GLOBALS['options']['statchasers_needs_flush'] ?? 0 ), 1, 'the first request after an upgrade asks for a flush' );
is( '' !== (string) ( $GLOBALS['options']['statchasers_schedule_rules'] ?? '' ), true, 'the schedule week rule is remembered' );
is( '' !== (string) ( $GLOBALS['options']['statchasers_matchup_rules'] ?? '' ), true, 'and so is the matchup game rule' );

unset( $GLOBALS['options']['statchasers_needs_flush'] );
statchasers_smoke_run_init();
is( isset( $GLOBALS['options']['statchasers_needs_flush'] ), false, 'the next request, rules unchanged, does not' );

// An install that last flushed with the week-only game rule.
$GLOBALS['options']['statchasers_matchup_rules'] = md5( '^nfl/([a-z0-9-]+-vs-[a-z0-9-]+)/(\d{4}-week-\d{1,2})/?$|nfl/matchup' );
statchasers_smoke_run_init();
is( (int) ( $GLOBALS['options']['statchasers_needs_flush'] ?? 0 ), 1, 'a site upgrading from the week-only matchup rule flushes' );

unset( $GLOBALS['options']['statchasers_needs_flush'] );
$GLOBALS['options']['statchasers_schedule_rules'] = 'something-older';
statchasers_smoke_run_init();
is( (int) ( $GLOBALS['options']['statchasers_needs_flush'] ?? 0 ), 1, 'and so does one whose schedule rule changed' );
