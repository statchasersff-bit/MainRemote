<?php
/**
 * WEB-040: a schedule render with a game in progress never reaches the page
 * cache; a settled one still does.
 *
 * DONOTCACHEPAGE is a constant, so each verdict needs a process of its own:
 * smoke.php runs this twice, as STATCHASERS_SMOKE_GROUP=schedlive (the API
 * says X-SC-Schedule-Volatile: 1) and =schedfinal (it says 0). Running it
 * directly does nothing, because the plugin is not loaded.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_schedule_keep_volatile_out_of_page_cache' ) ) {
	fwrite( STDERR, "smoke-schedule-cache.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

$board               = new WP_Post();
$board->ID           = 3238;
$board->post_title   = 'NFL Schedule';
$board->post_content = '[statchasers_schedule]';

$GLOBALS['page'] = array(
	'singular' => true,
	'loop'     => true,
	'admin'    => false,
	'post'     => $board,
);
$GLOBALS['query']['sc_sched_week'] = '11';

$live = 'schedlive' === getenv( 'STATCHASERS_SMOKE_GROUP' );

$GLOBALS['http_code']    = 200;
$GLOBALS['http_body']    = '<div class="scs" data-scs-root data-scs-season="2026"><article class="scs-game" data-status="' . ( $live ? 'live' : 'final' ) . '"></article></div>';
$GLOBALS['http_headers'] = array(
	'etag'                   => 'W/"2026-13-x"',
	'cache-control'          => $live ? 'public, max-age=30' : 'public, max-age=300',
	'x-sc-schedule-volatile' => $live ? '1' : '0',
);

echo $live ? "\na live week board stays out of the page cache\n" : "\na settled week board may be cached\n";

$data = statchasers_schedule_fetch( statchasers_schedule_args( statchasers_schedule_mounted_atts() ) );
is( is_array( $data ) && ! empty( $data['volatile'] ), $live, 'the fetch carries the API\'s volatile flag' );

statchasers_schedule_keep_volatile_out_of_page_cache();
is( defined( 'DONOTCACHEPAGE' ), $live, $live ? 'template_redirect marks the page uncacheable' : 'a final board leaves the page cacheable' );

$html = statchasers_schedule_shortcode( array() );
is( str_contains( $html, 'data-status="' . ( $live ? 'live' : 'final' ) . '"' ), true, 'the board still prints' );
is( defined( 'DONOTCACHEPAGE' ), $live, 'and the shortcode agrees' );

