<?php
/**
 * Does this theme print an H1, and what should the shortcodes do about it?
 *
 * Every fragment this plugin mounts steps its own hero down to <h2> when it is
 * embedded, because the page is supposed to supply the H1. On a normal template
 * it does: the theme prints the post title, and the title filters in
 * statchasers-team-pages.php and statchasers-player-pages.php have already
 * rewritten that title into the section-aware phrase. On a template that prints
 * no title at all — a Divi full-width layout, a Theme Builder layout with no
 * Post Title module, a block theme whose template someone stripped — there is
 * nothing to rewrite, and the page ships with no H1 at all.
 *
 * The two cases are indistinguishable from inside PHP. The theme decides what
 * it prints at render time, from a template this plugin cannot read, so the
 * only honest way to know is to look at the finished page. That is what this
 * file does: it fetches one published page over HTTP, counts the <h1> elements,
 * and remembers the answer against the theme that produced it.
 *
 * WHY NOT OUTPUT BUFFERING. The alternative is to buffer the whole document and
 * inspect it on the way out, which is always right and always on. It also means
 * every byte the theme produces passes through this plugin on every request, on
 * hosting we do not control, for a question whose answer changes when the theme
 * changes and at no other time. A cached verdict and one HTTP request per theme
 * buys the same answer without standing in that path.
 *
 * WHAT IT DOES NOT DO. It never edits the theme's markup and it never removes
 * an H1 somebody else printed. The only thing a verdict changes is whether the
 * shortcodes print one of their own, which is a decision about markup this
 * plugin already owns.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Where the verdict lives. Keyed by theme inside, not by option name. */
const STATCHASERS_H1_OPTION = 'statchasers_h1_verdict';

/** 'auto' (follow the probe), 'on' (always print), 'off' (never print). */
const STATCHASERS_H1_MODE_OPTION = 'statchasers_h1_mode';

/** Seconds to wait on the loopback request. */
const STATCHASERS_H1_TIMEOUT = 10;

/**
 * The stored mode.
 *
 * 'auto' is the default and the one anybody should need: it prints an H1 when
 * the probe found none and stays quiet otherwise. The two manual settings exist
 * because a probe is a measurement of one page and a site can always be the
 * exception — a template that prints a title on the team hub and not on the
 * player profiles, say.
 */
function statchasers_h1_mode(): string {
	$mode = (string) get_option( STATCHASERS_H1_MODE_OPTION, 'auto' );
	return in_array( $mode, array( 'auto', 'on', 'off' ), true ) ? $mode : 'auto';
}

/**
 * What a verdict is about.
 *
 * The stylesheet, the template and the theme's version, because a child theme
 * with its own page.php is a different answer from its parent, and a theme
 * update is exactly the event that can start or stop printing a title. Anything
 * that changes this string retires the stored verdict without deleting it — the
 * old one stays readable in the admin as "measured against a different theme".
 */
function statchasers_h1_fingerprint(): string {
	$theme = wp_get_theme();

	return implode(
		'|',
		array(
			(string) get_stylesheet(),
			(string) get_template(),
			(string) $theme->get( 'Version' ),
		)
	);
}

/**
 * The stored verdict, or null when there is none for this theme.
 *
 * @return array<string,mixed>|null
 */
function statchasers_h1_verdict(): ?array {
	$stored = get_option( STATCHASERS_H1_OPTION );

	if ( ! is_array( $stored ) || ! isset( $stored['fingerprint'] ) ) {
		return null;
	}

	return $stored['fingerprint'] === statchasers_h1_fingerprint() ? $stored : null;
}

/**
 * The last verdict whatever theme it was measured against.
 *
 * Only the admin screen uses this, to say "this was measured against a theme
 * you are no longer running" instead of silently showing nothing.
 *
 * @return array<string,mixed>|null
 */
function statchasers_h1_verdict_any(): ?array {
	$stored = get_option( STATCHASERS_H1_OPTION );
	return is_array( $stored ) && isset( $stored['fingerprint'] ) ? $stored : null;
}

/**
 * A published page that mounts one of the shortcodes, and the H1 it should have.
 *
 * A team hub is the first choice because it is the one page type whose heading
 * this file can recognise when it sees it.
 *
 * Two strings come back, and the second is the one that does the work.
 * `expect` is the heading the plugin would print. `anchor` is the team's name
 * alone — because an H1 somebody wrote by hand is not going to be the generated
 * phrase word for word, and demanding that it is turns "New England Patriots
 * Fantasy Football Hub" into a warning about a page that is completely fine.
 * The question worth asking is not "is this my string" but "is this heading
 * about this team", and the name is what answers it.
 *
 * @return array{url:string,expect:string,anchor:string,label:string}|null
 */
function statchasers_h1_probe_target(): ?array {
	if ( ! function_exists( 'statchasers_team_page_status' ) ) {
		return null;
	}

	$status = statchasers_team_page_status();

	foreach ( (array) $status['present'] as $slug => $id ) {
		$url = (string) get_permalink( (int) $id );
		if ( '' === $url || 'publish' !== get_post_status( (int) $id ) ) {
			continue;
		}

		$table = function_exists( 'statchasers_team_table' ) ? statchasers_team_table() : array();

		return array(
			'url'    => $url,
			'expect' => function_exists( 'statchasers_team_heading' )
				? statchasers_team_heading( (string) $slug, '' )
				: '',
			'anchor' => (string) ( $table[ (string) $slug ][0] ?? '' ),
			'label'  => (string) $slug,
		);
	}

	return null;
}

/** Text as it compares: tags gone, entities decoded, whitespace collapsed. */
function statchasers_h1_normalise( string $html ): string {
	$text = wp_strip_all_tags( $html );
	$text = html_entity_decode( $text, ENT_QUOTES, 'UTF-8' );
	$text = preg_replace( '/\s+/u', ' ', $text );

	return trim( (string) $text );
}

/**
 * Fetch one page and count what the theme put in it.
 *
 * Runs as a logged-out visitor, which is the state that matters: an admin bar
 * is not what a crawler sees, and some themes print different chrome to a
 * logged-in user.
 *
 * Failures are recorded rather than thrown away. A host that blocks its own
 * loopback requests is a real configuration and the admin screen has to be able
 * to say so — silence would read as "no H1 found", which would be a wrong
 * answer arrived at confidently.
 *
 * @return array<string,mixed> The verdict, already stored.
 */
function statchasers_h1_probe(): array {
	$fingerprint = statchasers_h1_fingerprint();
	$target      = statchasers_h1_probe_target();

	$verdict = array(
		'fingerprint' => $fingerprint,
		'theme'       => (string) wp_get_theme()->get( 'Name' ),
		'time'        => time(),
		'url'         => '',
		'count'       => null,
		'texts'       => array(),
		'expect'      => '',
		'matched'     => false,
		'error'       => '',
	);

	if ( null === $target ) {
		$verdict['error'] = 'No published team hub page to probe. Create the pages first.';
		update_option( STATCHASERS_H1_OPTION, $verdict, false );
		return $verdict;
	}

	$verdict['url']    = $target['url'];
	$verdict['expect'] = $target['expect'];

	$response = wp_remote_get(
		$target['url'],
		array(
			'timeout'     => STATCHASERS_H1_TIMEOUT,
			'redirection' => 3,
			'headers'     => array( 'Accept' => 'text/html' ),
			// Nothing is written by the request, but a cached copy of a page
			// from before the last change would be a stale measurement.
			'cookies'     => array(),
		)
	);

	if ( is_wp_error( $response ) ) {
		$verdict['error'] = $response->get_error_message();
		update_option( STATCHASERS_H1_OPTION, $verdict, false );
		return $verdict;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( 200 !== $code ) {
		$verdict['error'] = sprintf( 'The page answered %d.', $code );
		update_option( STATCHASERS_H1_OPTION, $verdict, false );
		return $verdict;
	}

	$body = (string) wp_remote_retrieve_body( $response );

	preg_match_all( '#<h1\b[^>]*>(.*?)</h1>#is', $body, $matches );

	$texts = array();
	foreach ( (array) ( $matches[1] ?? array() ) as $inner ) {
		$text = statchasers_h1_normalise( (string) $inner );
		if ( '' !== $text ) {
			$texts[] = $text;
		}
	}

	$verdict['count'] = count( $matches[0] ?? array() );
	$verdict['texts'] = array_slice( $texts, 0, 5 );

	// Either the generated phrase, or any heading that names the team. The
	// second is what makes a hand-written hero — a Divi Code module carrying
	// its own <h1> — read as the page's heading rather than as a stray one.
	$expect = statchasers_h1_normalise( $target['expect'] );
	$anchor = statchasers_h1_normalise( (string) ( $target['anchor'] ?? '' ) );

	foreach ( $texts as $text ) {
		$hit = ( '' !== $expect && ( false !== stripos( $text, $expect ) || false !== stripos( $expect, $text ) ) )
			|| ( '' !== $anchor && false !== stripos( $text, $anchor ) );

		if ( $hit ) {
			$verdict['matched'] = true;
			break;
		}
	}

	update_option( STATCHASERS_H1_OPTION, $verdict, false );

	return $verdict;
}

/**
 * Should a shortcode print its own H1 on this site?
 *
 * Three answers and one refusal:
 *
 *   no H1 on the page          -> yes, print one; that is the whole point
 *   an H1, and it is the page's -> no, the theme is doing its job
 *   an H1 that is something else -> no, and the admin screen says why
 *   no verdict at all           -> no
 *
 * The third case is a theme printing the site name in an H1 on every page. Two
 * H1s is worse than one that names the wrong thing, and the fix is in the
 * theme's settings rather than here, so this refuses to add a second and the
 * admin screen reports what it found instead of quietly papering over it.
 *
 * The fourth is the important one. Without a measurement this prints nothing:
 * a plugin that guesses wrong here either leaves a page with no heading or
 * gives it two, and both are worse than the state before it was installed.
 */
function statchasers_h1_should_print(): bool {
	$mode = statchasers_h1_mode();

	if ( 'on' === $mode ) {
		return true;
	}

	if ( 'off' === $mode ) {
		return false;
	}

	$verdict = statchasers_h1_verdict();

	if ( null === $verdict || '' !== (string) $verdict['error'] || null === $verdict['count'] ) {
		return false;
	}

	return 0 === (int) $verdict['count'];
}

/**
 * The verdict as one sentence, for the admin screen and the notice.
 *
 * @return array{level:string,text:string}
 */
function statchasers_h1_summary(): array {
	$mode = statchasers_h1_mode();

	if ( 'on' === $mode ) {
		return array(
			'level' => 'info',
			'text'  => 'Set to always print a heading, whatever the theme does.',
		);
	}

	if ( 'off' === $mode ) {
		return array(
			'level' => 'info',
			'text'  => 'Set to never print a heading. The theme is expected to supply the H1.',
		);
	}

	$verdict = statchasers_h1_verdict();

	if ( null === $verdict ) {
		$old = statchasers_h1_verdict_any();

		return array(
			'level' => 'warning',
			'text'  => null === $old
				? 'Not checked yet. Until it is, the shortcodes print no heading of their own.'
				: 'The last check was against a different theme, so it no longer applies. Run it again.',
		);
	}

	if ( '' !== (string) $verdict['error'] ) {
		return array(
			'level' => 'error',
			'text'  => 'The check could not read the page: ' . (string) $verdict['error'],
		);
	}

	$count = (int) $verdict['count'];

	if ( 0 === $count ) {
		return array(
			'level' => 'success',
			'text'  => 'The theme prints no H1 on these pages, so the shortcodes print the heading themselves, ' .
				'in the site\'s own hero markup. <strong>The hero CSS has to be site-wide for that to look right</strong> — ' .
				'Divi &rarr; Theme Options &rarr; Custom CSS, not inside the Code module of one page.',
		);
	}

	if ( $verdict['matched'] ) {
		return array(
			'level' => 'success',
			'text'  => sprintf(
				'The theme prints the page heading as the H1 (%d found). The shortcodes add nothing.',
				$count
			),
		);
	}

	return array(
		'level' => 'warning',
		'text'  => sprintf(
			'The page has %d H1, but it does not name the team — found %s. That is a heading written once and reused on every page (a site-wide hero module, or a theme printing the site name), so all 32 hubs are sharing it. The shortcodes will not add a second one; the fix is to make that heading name the page.',
			$count,
			'"' . implode( '", "', array_map( 'esc_html', (array) $verdict['texts'] ) ) . '"'
		),
	);
}

/* ------------------------------------------------------------------ markup */

/**
 * The id on the generated heading.
 *
 * Deliberately NOT `sc-lo-hero-title`, which is the id in the hand-written hero
 * module. The generated heading only renders on a page that has no H1, so the
 * two should never meet — but "should never" is not a reason to put a duplicate
 * id in the document if they ever do.
 */
const STATCHASERS_HEADING_ID = 'statchasers-page-title';

/**
 * A generated heading, in the site's own hero markup.
 *
 * The class names are the ones the hand-written hero modules already use, so
 * one stylesheet dresses both: the four pages written by hand and the ~1,100
 * generated addresses that nobody could write by hand — 32 hubs across six
 * sections each, several hundred profiles across seven, and 496 pair URLs that
 * all render from a single holder page and so have no module to write into.
 *
 * THE STYLESHEET IS NOT SHIPPED. It lives wherever the site keeps it, which
 * means Divi > Theme Options > Custom CSS rather than inside the Code module
 * that carries one hero. A copy in this plugin would be a second definition of
 * the design, and the first thing it would do is drift from the first one. The
 * consequence to know about: with the CSS still inline in a module, a generated
 * heading is unstyled — correct markup, no gold rule — and the admin panel says
 * so rather than leaving it to be discovered on the front end.
 *
 * @param string $heading The H1 text.
 * @param string $lead    A sentence under the rule, or '' for none.
 */
function statchasers_page_heading_html( string $heading, string $lead = '' ): string {
	$heading = trim( $heading );

	if ( '' === $heading ) {
		return '';
	}

	// `data-sct-page-title` and `data-sct-page-lead` are the contract with the
	// tool's own bundle. Switching a tab changes which section the reader is on
	// and pushes that section's URL, so the heading above the fragment has to
	// change with it — and the fragment cannot find a heading it does not own
	// without being told which element it is. The bundle falls back to the
	// document's first H1, so a hand-written hero still gets the swap; these
	// attributes are what make it exact.
	$html = sprintf(
		'<section class="sc-lo sc-lo-hero sc-lo-hero--generated" aria-labelledby="%1$s">' .
			'<div class="sc-lo-hero__inner"><div class="sc-lo-hero__copy">' .
			'<h1 id="%1$s" class="sc-lo-hero__h1" data-sct-page-title>%2$s</h1>' .
			'<div class="sc-lo-hero__underline" aria-hidden="true"></div>',
		esc_attr( STATCHASERS_HEADING_ID ),
		esc_html( $heading )
	);

	if ( '' !== trim( $lead ) ) {
		$html .= sprintf(
			'<p class="sc-lo-hero__lead" data-sct-page-lead>%s</p>',
			esc_html( trim( $lead ) )
		);
	}

	$html .= '</div></div></section>';

	/**
	 * Filters the generated heading's markup.
	 *
	 * The whole block, not the text: a site whose hero is a different shape
	 * replaces it here rather than restyling class names it does not use.
	 *
	 * @param string $html    The rendered block.
	 * @param string $heading The H1 text.
	 * @param string $lead    The lead sentence, or ''.
	 */
	return (string) apply_filters( 'statchasers_page_heading_html', $html, $heading, $lead );
}

/**
 * Wire the verdict into the shortcodes.
 *
 * `$value` is respected when it is already true, so an explicit
 * `add_filter( 'statchasers_team_shortcode_h1', '__return_true' )` in a theme
 * keeps working and does not depend on which callback ran first.
 *
 * @param mixed $value Whatever an earlier filter decided.
 */
function statchasers_h1_filter( $value ): bool {
	return $value ? true : statchasers_h1_should_print();
}
add_filter( 'statchasers_team_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_player_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_matchup_shortcode_h1', 'statchasers_h1_filter' );

/**
 * A theme switch retires the verdict.
 *
 * Deleted rather than re-probed on the spot: switch_theme fires in the middle
 * of an admin request that is already doing something, and a page nobody has
 * looked at yet is not a good measurement. The screen and the notice both say
 * it needs running again.
 */
add_action(
	'switch_theme',
	static function (): void {
		delete_option( STATCHASERS_H1_OPTION );
	}
);

/* --------------------------------------------------------------------- admin */

/**
 * Run the probe when the admin asks, and after a build.
 *
 * Both entry points are admin-side. Nothing here ever runs during a front-end
 * request: a page render that makes an HTTP call to its own site is a way to
 * turn one slow request into two.
 */
add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_h1_check'] ) && ! isset( $_POST['statchasers_h1_mode_save'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}

		check_admin_referer( 'statchasers_h1' );

		if ( isset( $_POST['statchasers_h1_mode_save'] ) ) {
			$mode = isset( $_POST['statchasers_h1_mode'] )
				? sanitize_key( wp_unslash( $_POST['statchasers_h1_mode'] ) )
				: 'auto';

			update_option(
				STATCHASERS_H1_MODE_OPTION,
				in_array( $mode, array( 'auto', 'on', 'off' ), true ) ? $mode : 'auto',
				false
			);
		}

		if ( isset( $_POST['statchasers_h1_check'] ) ) {
			statchasers_h1_probe();
		}

		wp_safe_redirect(
			add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) )
		);
		exit;
	}
);

/** The panel on the Tools screen. */
function statchasers_h1_panel(): void {
	$summary = statchasers_h1_summary();
	$verdict = statchasers_h1_verdict();
	$mode    = statchasers_h1_mode();

	echo '<h2>Page headings</h2>';

	printf(
		'<p>Every mounted fragment starts at <code>&lt;h2&gt;</code> because the page is meant to supply the <code>&lt;h1&gt;</code>. ' .
		'Most themes print one from the page title — which this plugin has already rewritten to name the team, player or section. ' .
		'A layout that prints no title leaves the page with no heading at all, so this checks a real published page and reports what it found.</p>'
	);

	printf(
		'<p class="description">When it does print one, it uses the same <code>%s</code> markup the hand-written hero modules use — ' .
		'section, H1, rule, lead — so the ~1,100 generated addresses and the handful of pages you write yourself are one component. ' .
		'No stylesheet ships with the plugin; the site owns that CSS.</p>',
		esc_html( 'sc-lo-hero' )
	);

	printf(
		'<div class="notice notice-%s inline"><p>%s</p></div>',
		esc_attr( 'error' === $summary['level'] ? 'error' : ( 'success' === $summary['level'] ? 'success' : 'warning' ) ),
		wp_kses_post( $summary['text'] )
	);

	if ( null !== $verdict && '' !== (string) $verdict['url'] ) {
		printf(
			'<p class="description">Last checked %s against <a href="%s" target="_blank" rel="noopener">%s</a>, on the <strong>%s</strong> theme.</p>',
			esc_html( human_time_diff( (int) $verdict['time'] ) . ' ago' ),
			esc_url( (string) $verdict['url'] ),
			esc_html( (string) $verdict['url'] ),
			esc_html( (string) $verdict['theme'] )
		);
	}

	echo '<form method="post">';
	wp_nonce_field( 'statchasers_h1' );

	echo '<p><button type="submit" name="statchasers_h1_check" value="1" class="button">Check the headings now</button></p>';

	echo '<fieldset><legend class="screen-reader-text">Heading mode</legend>';
	foreach ( array(
		'auto' => 'Follow the check (recommended) — print a heading only when the theme prints none.',
		'on'   => 'Always print a heading from the shortcode.',
		'off'  => 'Never print one; the theme supplies the H1.',
	) as $value => $label ) {
		printf(
			'<p><label><input type="radio" name="statchasers_h1_mode" value="%s"%s /> %s</label></p>',
			esc_attr( $value ),
			checked( $mode, $value, false ),
			esc_html( $label )
		);
	}
	echo '</fieldset>';

	echo '<p><button type="submit" name="statchasers_h1_mode_save" value="1" class="button">Save</button></p>';
	echo '</form>';
}
