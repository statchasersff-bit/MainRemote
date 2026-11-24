<?php
/**
 * Plugin Name:       StatChasers — Rookie Hit Rates
 * Plugin URI:        https://statchasers.com/
 * Description:        Embed the StatChasers Rookie Hit Rates dynasty analytics tool anywhere with the [rookie_hit_rates] shortcode. The whole app is self-contained (runs in an isolated iframe) so it never conflicts with your theme's styles.
 * Version:           1.1.0
 * Author:            StatChasers
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 5.0
 * Requires PHP:      7.0
 *
 * Usage: place  [rookie_hit_rates]  into any page, post, or "Code" module.
 * Optional attributes:
 *   height     Initial iframe height in px before auto-resize kicks in. Default 1400.
 *   min_height Never shrink the iframe below this many px. Default 600.
 *   max_width  Max width of the embed in px (centered). Default 1380. Use 0 for full width.
 *   summary    "0" leaves out the server-rendered methodology + results table
 *              printed under the tool. Default "1".
 *
 * Example: [rookie_hit_rates height="1500" max_width="0"]
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

/**
 * Absolute URL to the bundled single-page app folder (with trailing slash).
 */
function scff_rhr_app_url() {
	return trailingslashit( plugins_url( 'app', __FILE__ ) );
}

/**
 * Render the [rookie_hit_rates] shortcode as a responsive, auto-resizing iframe.
 *
 * @param array $atts Shortcode attributes.
 * @return string HTML markup.
 */
function scff_rhr_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'height'     => '1400',
			'min_height' => '600',
			'max_width'  => '1380',
			'summary'    => '1',
		),
		$atts,
		'rookie_hit_rates'
	);

	$app        = esc_url( scff_rhr_app_url() . 'index.html' );
	$height     = max( 200, (int) $atts['height'] );
	$min_height = max( 0, (int) $atts['min_height'] );
	$max_width  = max( 0, (int) $atts['max_width'] );
	$uid        = 'rhr-' . wp_generate_uuid4();

	// Print the parent-side auto-resize listener only once per page load, no
	// matter how many embeds are on the page.
	static $listener_printed = false;
	$listener = '';
	if ( ! $listener_printed ) {
		$listener_printed = true;
		$listener        = '<script>(function(){window.addEventListener("message",function(e){var d=e.data;if(!d||d.__rhr!==true||d.type!=="rhr-height")return;var frames=document.querySelectorAll("iframe.rhr-embed-frame");for(var i=0;i<frames.length;i++){if(frames[i].contentWindow===e.source){var min=parseInt(frames[i].getAttribute("data-min-height"),10)||0;frames[i].style.height=Math.max(d.height,min)+"px";}}});})();</script>';
	}

	$wrap_style = 'width:100%;margin:0 auto;';
	if ( $max_width > 0 ) {
		$wrap_style .= 'max-width:' . $max_width . 'px;';
	}

	$frame_style = 'width:100%;height:' . $height . 'px;border:0;display:block;overflow:hidden;';

	$iframe = sprintf(
		// No loading="lazy": the embed is the page's main content, and deferring it
		// keeps the app from measuring itself until the reader scrolls down.
		'<iframe class="rhr-embed-frame" id="%1$s" src="%2$s" title="Rookie Hit Rates" scrolling="no" data-min-height="%3$d" style="%4$s"></iframe>',
		esc_attr( $uid ),
		$app,
		$min_height,
		esc_attr( $frame_style )
	);

	$summary = '0' === (string) $atts['summary'] ? '' : scff_rhr_summary_html( $max_width );

	return $listener
		. '<div class="rhr-embed-wrap" style="' . esc_attr( $wrap_style ) . '">'
		. $iframe
		. '</div>'
		. $summary;
}
add_shortcode( 'rookie_hit_rates', 'scff_rhr_shortcode' );
// Convenience alias.
add_shortcode( 'statchasers_rookie_hit_rates', 'scff_rhr_shortcode' );

/* ------------------------------------------------------------------ summary */

/**
 * The default view's numbers, computed at build time by the tool's own code.
 *
 * summary/hit-rates-summary.json is written by script/build-wp-summary.mjs in
 * the app repository (step 4 of script/build-wp-plugin.sh, every build) from
 * app/data/*.csv, the same two files the iframe loads. Reading it is one small
 * file per request, once; no network and no calculation here.
 *
 * Returns null when the file is missing or unreadable, or when the CSVs beside
 * it are not the ones it was computed from (a dataset refreshed without
 * rebuilding the summary): no table beats a table that disagrees with the tool.
 *
 * @return array|null
 */
function scff_rhr_summary() {
	static $memo = false;
	if ( false !== $memo ) {
		return $memo;
	}
	$memo = null;

	$dir  = plugin_dir_path( __FILE__ );
	$file = $dir . 'summary/hit-rates-summary.json';
	if ( ! is_readable( $file ) ) {
		return null;
	}
	$data = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $data ) || empty( $data['rows'] ) || empty( $data['total'] ) || empty( $data['settings'] ) || empty( $data['sources'] ) ) {
		return null;
	}
	foreach ( $data['sources'] as $name => $source ) {
		$csv = $dir . 'app/data/' . basename( (string) $name );
		if ( ! is_array( $source ) || ! isset( $source['bytes'] ) || ! is_file( $csv ) || (int) filesize( $csv ) !== (int) $source['bytes'] ) {
			return null;
		}
	}
	$memo = $data;
	return $memo;
}

/**
 * Methodology + results table, printed in the parent page under the iframe.
 *
 * Readable without JavaScript: when scripting is off the iframe (a JS app)
 * would be a blank 1400px box, so a <noscript> style hides it and this section
 * is what the reader gets.
 *
 * @param int $max_width The embed's max width, so the section lines up with it.
 * @return string
 */
function scff_rhr_summary_html( $max_width ) {
	$data = scff_rhr_summary();
	if ( null === $data ) {
		return '';
	}

	$set       = $data['settings'];
	$threshold = (int) $set['threshold'];
	$min_games = (int) $set['min_games'];
	$latest    = (int) $set['latest_season'];
	$first     = (int) $set['year_start'];
	$last      = min( (int) $set['year_end'], $latest );
	$rounds    = array_map( 'intval', (array) $set['rounds'] );
	$round_txt = count( $rounds ) > 1 ? 'rounds ' . min( $rounds ) . ' to ' . max( $rounds ) : 'round ' . reset( $rounds );
	$format    = 'sf' === $set['format'] ? 'Superflex' : '1QB';
	$scoring   = array(
		'ppr'  => 'PPR',
		'hppr' => 'half-PPR',
		'std'  => 'standard',
	)[ $set['scoring'] ] ?? strtoupper( (string) $set['scoring'] );
	$outcome   = 'Top-' . $threshold;
	$total     = $data['total'];

	// Classes that have had fewer than three seasons: the tool keeps them in the
	// sample (and its Draft Classes view marks them incomplete).
	$young = array();
	foreach ( (array) $data['classes'] as $class ) {
		if ( (int) $class['seasons_observed'] < 3 ) {
			$young[] = (int) $class['year'] . ' (' . (int) $class['seasons_observed'] . ' ' . ( 1 === (int) $class['seasons_observed'] ? 'season' : 'seasons' ) . ')';
		}
	}

	$width = $max_width > 0 ? 'max-width:' . (int) $max_width . 'px;' : '';
	$h     = '<noscript><style>.rhr-embed-wrap{display:none!important}</style></noscript>';
	$h    .= '<style>'
		. '.rhr-summary{box-sizing:border-box;width:100%;margin:28px auto 8px;padding:0 4px;color:#0b1220;font-size:16px;line-height:1.6}'
		. '.rhr-summary *{box-sizing:border-box}'
		. '.rhr-summary .rhr-summary__title{margin:0;padding:0;font-size:clamp(22px,2.6vw,30px);line-height:1.2;letter-spacing:-.02em;color:#0b1634;font-weight:800}'
		. '.rhr-summary .rhr-summary__rule{width:64px;height:3px;margin:12px 0 16px;border-radius:999px;background:linear-gradient(90deg,rgba(212,175,55,.25),#F5C84B,rgba(212,175,55,.25))}'
		. '.rhr-summary p{margin:0 0 12px;padding:0;max-width:95ch;color:rgba(11,15,25,.78)}'
		. '.rhr-summary .rhr-summary__body{display:flex;flex-wrap:wrap;gap:8px 32px;align-items:flex-start}'
		. '.rhr-summary .rhr-summary__text{flex:1 1 420px;min-width:0}'
		. '.rhr-summary .rhr-summary__figure{flex:0 1 420px;min-width:0;margin:0}'
		. '.rhr-summary table.rhr-summary__table{width:100%;margin:0;border:1px solid rgba(11,22,52,.14);border-collapse:collapse;border-radius:0;font-size:15px;line-height:1.3;font-variant-numeric:tabular-nums;background:#fff}'
		. '.rhr-summary .rhr-summary__table caption{caption-side:top;text-align:left;padding:0 0 8px;font-size:14px;font-weight:700;color:#0b1634}'
		. '.rhr-summary .rhr-summary__table th,.rhr-summary .rhr-summary__table td{padding:8px 12px;border:0;border-top:1px solid rgba(11,22,52,.10);text-align:right;vertical-align:middle;white-space:nowrap}'
		. '.rhr-summary .rhr-summary__table thead th{border-top:0;background:#0b1634;color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}'
		. '.rhr-summary .rhr-summary__table th[scope=row]{text-align:left;font-weight:700;color:#0b1634}'
		. '.rhr-summary .rhr-summary__table thead th:first-child{text-align:left}'
		. '.rhr-summary .rhr-summary__table tfoot th,.rhr-summary .rhr-summary__table tfoot td{border-top:2px solid #d4af37;font-weight:800;background:#faf7ec}'
		. '.rhr-summary .rhr-summary__note{margin:8px 0 0;font-size:13px;line-height:1.5;color:rgba(11,15,25,.68)}'
		. '@media (max-width:560px){.rhr-summary{font-size:15px;margin-top:20px}.rhr-summary .rhr-summary__table th,.rhr-summary .rhr-summary__table td{padding:7px 8px}.rhr-summary table.rhr-summary__table{font-size:14px}}'
		. '</style>';

	$h .= '<section class="rhr-summary" aria-labelledby="rhr-summary-title" style="' . esc_attr( $width ) . '">';
	$h .= '<h2 id="rhr-summary-title" class="rhr-summary__title">How We Count a Hit</h2>';
	$h .= '<div class="rhr-summary__rule" aria-hidden="true"></div>';
	$h .= '<div class="rhr-summary__body"><div class="rhr-summary__text">';
	$h .= '<p>A rookie is a <strong>hit</strong> when he finishes ' . esc_html( $outcome ) . ' or better at his position in at least one season, from his rookie year through ' . $latest . '. Only seasons in which he played at least ' . $min_games . ' games count. A season finish ranks every player at the position by regular-season ' . esc_html( $scoring ) . ' fantasy points. The threshold is the same for every position.</p>';
	$h .= '<p>The sample is every QB, RB, WR and TE in ' . esc_html( $round_txt ) . ' of ' . esc_html( $format . ' ' . $scoring ) . ' dynasty rookie drafts by rookie ADP, ' . $first . ' to ' . $last . ' classes: ' . number_format( (int) $total['total'] ) . ' rookies. Each rookie counts once, in the class and position he was drafted at.</p>';
	$h .= '<p>Every class stays in the sample, including ones with little follow-up';
	if ( $young ) {
		$h .= ': ' . esc_html( implode( ' and ', $young ) ) . ' so far';
	}
	$h .= '. Their misses can still become hits, so recent classes pull the rates down. Rookies with no qualifying season (including ' . (int) $data['rookies_without_seasons'] . ' with no season on record in the data) count as misses.</p>';
	$h .= '</div>';

	$h .= '<figure class="rhr-summary__figure"><table class="rhr-summary__table">';
	$h .= '<caption>' . esc_html( $outcome . ' hit rate by position, ' . $format . ' ' . $scoring . ', ' . $first . ' to ' . $last . ' classes' ) . '</caption>';
	$h .= '<thead><tr><th scope="col">Position</th><th scope="col">Hits</th><th scope="col">Rookies</th><th scope="col">Hit rate</th></tr></thead><tbody>';
	foreach ( $data['rows'] as $row ) {
		$h .= '<tr><th scope="row">' . esc_html( (string) $row['group'] ) . '</th><td>' . (int) $row['hits'] . '</td><td>' . (int) $row['total'] . '</td><td>' . esc_html( (string) $row['rate_display'] ) . '</td></tr>';
	}
	$h .= '</tbody><tfoot><tr><th scope="row">' . esc_html( (string) $total['group'] ) . '</th><td>' . (int) $total['hits'] . '</td><td>' . (int) $total['total'] . '</td><td>' . esc_html( (string) $total['rate_display'] ) . '</td></tr></tfoot></table>';
	$h .= '<p class="rhr-summary__note">Same data and rules as the tool above at its default settings: Overview tab, ' . esc_html( $format ) . ', ' . esc_html( $scoring ) . ', ' . esc_html( $outcome ) . ', seasons ' . $first . ' to ' . (int) $set['year_end'] . ', ' . esc_html( $round_txt ) . ', minimum ' . $min_games . ' games. Hit rate = hits / rookies, rounded to one decimal.</p>';
	$h .= '</figure></div></section>';

	return $h;
}
