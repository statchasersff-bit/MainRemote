<?php
/**
 * Does this theme print an H1, and what should the shortcodes do about it?
 *
 * Every fragment this plugin mounts steps its own hero down to <h2> when it is
 * embedded, because the page is supposed to supply the H1. On a normal template
 * it does: the theme prints the post title, and the title filters in
 * statchasers-team-pages.php and statchasers-player-pages.php have already
 * rewritten that title into the section-aware phrase. On a template that prints
 * no title at all - a Divi full-width layout, a Theme Builder layout with no
 * Post Title module, a block theme whose template someone stripped - there is
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

/**
 * 'auto' (follow the probe), 'on' (always print), 'replace' (print, and blank
 * the theme's own title), 'off' (never print).
 */
const STATCHASERS_H1_MODE_OPTION = 'statchasers_h1_mode';

/** The modes that are a mode. Anything else read from the option is 'auto'. */
const STATCHASERS_H1_MODES = array( 'auto', 'on', 'replace', 'tool', 'off' );

/** Seconds to wait on the loopback request. */
const STATCHASERS_H1_TIMEOUT = 10;

/**
 * The stored mode.
 *
 * 'auto' is the default and the one anybody should need: it prints an H1 when
 * the probe found none and stays quiet otherwise. The two manual settings exist
 * because a probe is a measurement of one page and a site can always be the
 * exception - a template that prints a title on the team hub and not on the
 * player profiles, say.
 */
function statchasers_h1_mode(): string {
	$mode = (string) get_option( STATCHASERS_H1_MODE_OPTION, 'auto' );
	return in_array( $mode, STATCHASERS_H1_MODES, true ) ? $mode : 'auto';
}

/**
 * What a verdict is about.
 *
 * The stylesheet, the template and the theme's version, because a child theme
 * with its own page.php is a different answer from its parent, and a theme
 * update is exactly the event that can start or stop printing a title. Anything
 * that changes this string retires the stored verdict without deleting it - the
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
 * this file can recognize when it sees it.
 *
 * Two strings come back, and the second is the one that does the work.
 * `expect` is the heading the plugin would print. `anchor` is the team's name
 * alone - because an H1 somebody wrote by hand is not going to be the generated
 * phrase word for word, and demanding that it is turns "New England Patriots
 * Fantasy Football Hub" into a warning about a page that is completely fine.
 * The question worth asking is not "is this my string" but "is this heading
 * about this team", and the name is what answers it.
 *
 * @return array{url:string,expect:string,anchor:string,label:string}|null
 */
function statchasers_h1_probe_target( string $tool = 'team' ): ?array {
	if ( 'player' === $tool ) {
		return statchasers_h1_player_probe_target();
	}

	if ( 'schedule' === $tool ) {
		return statchasers_h1_schedule_probe_target();
	}

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

/**
 * The same question, asked of a player page.
 *
 * It has to be asked separately, and that is the whole point of this function.
 * The verdict used to be one measurement taken on one team hub and then applied
 * to every tool, on the reasoning that a theme prints its title the same way on
 * every page. It does not: a hub whose title comes from a builder layout and a
 * player page whose title comes from `page.php` are the same site answering the
 * question differently, and the published player pages showed it - two H1s, the
 * theme's plain one and the tool's designed one, on exactly the setting that is
 * supposed to prevent that.
 *
 * `anchor` is the player's name for the same reason the hub uses the team's:
 * the question worth asking is "is this heading about this player", not "is
 * this my exact string".
 *
 * @return array{url:string,expect:string,anchor:string,label:string}|null
 */
function statchasers_h1_player_probe_target(): ?array {
	if ( ! function_exists( 'statchasers_player_page_status' ) ) {
		return null;
	}

	$status = statchasers_player_page_status();

	foreach ( (array) ( $status['present'] ?? array() ) as $slug => $id ) {
		$url = (string) get_permalink( (int) $id );
		if ( '' === $url || 'publish' !== get_post_status( (int) $id ) ) {
			continue;
		}

		// The page's own title is the closest thing to the player's name that
		// this file can read without the tool's data to hand.
		$name = statchasers_h1_normalise( (string) get_the_title( (int) $id ) );

		return array(
			'url'    => $url,
			'expect' => function_exists( 'statchasers_player_heading' )
				? statchasers_player_heading( (string) $slug, '' )
				: '',
			'anchor' => $name,
			'label'  => (string) $slug,
		);
	}

	return null;
}

/**
 * The same question, asked of the schedule page.
 *
 * One page rather than a set, because that is what this tool is: one address
 * with eighteen week URLs hanging off it, all rendered by the same page. It is
 * found by its path rather than by a registry, because nothing creates it -
 * somebody wrote it and put the shortcode in it, and `statchasers_schedule_page_path()`
 * is where the plugin is told which page that is.
 *
 * `anchor` is the word "schedule" rather than a name. The other two probes ask
 * "is this heading about this team, this player"; here there is only one page,
 * so the question is whether the heading on it is about the schedule at all -
 * which is what separates a page whose theme names it from a page whose theme
 * prints the site name in an H1 on everything.
 *
 * @return array{url:string,expect:string,anchor:string,label:string}|null
 */
function statchasers_h1_schedule_probe_target(): ?array {
	if ( ! function_exists( 'statchasers_schedule_page_path' ) ) {
		return null;
	}

	$page = get_page_by_path( statchasers_schedule_page_path() );

	if ( ! $page instanceof WP_Post || 'publish' !== get_post_status( $page ) ) {
		return null;
	}

	$url = (string) get_permalink( $page );

	if ( '' === $url ) {
		return null;
	}

	return array(
		'url'    => $url,
		'expect' => statchasers_h1_normalise( (string) $page->post_title ),
		'anchor' => 'schedule',
		'label'  => 'schedule',
	);
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
 * to say so - silence would read as "no H1 found", which would be a wrong
 * answer arrived at confidently.
 *
 * @return array<string,mixed> The verdict, already stored.
 */
function statchasers_h1_probe(): array {
	$fingerprint = statchasers_h1_fingerprint();

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
		// One measurement per page type. See statchasers_h1_player_probe_target().
		'tools'       => array(),
	);

	foreach ( array( 'team', 'player', 'schedule' ) as $tool ) {
		$target = statchasers_h1_probe_target( $tool );

		if ( null === $target ) {
			// Only the hub's absence is worth reporting: it is the page type the
			// screen talks about, and a site with no player pages yet is not
			// misconfigured.
			if ( 'team' === $tool ) {
				$verdict['error'] = 'No published team hub page to probe. Create the pages first.';
			}
			continue;
		}

		$measured = statchasers_h1_measure( $target );

		$verdict['tools'][ $tool ] = $measured;

		// The hub also fills the top-level keys, which is the shape the admin
		// screen and every earlier verdict already speak.
		if ( 'team' === $tool ) {
			$verdict['url']     = $measured['url'];
			$verdict['expect']  = $measured['expect'];
			$verdict['count']   = $measured['count'];
			$verdict['texts']   = $measured['texts'];
			$verdict['matched'] = $measured['matched'];
			$verdict['error']   = $measured['error'];
		}
	}

	update_option( STATCHASERS_H1_OPTION, $verdict, false );

	return $verdict;
}

/**
 * Fetch one page and count the H1s the theme put in it.
 *
 * Split out of statchasers_h1_probe() so the same measurement can be taken on
 * more than one page type in a single run. Everything it decides is about the
 * page it was handed and nothing else.
 *
 * @param array{url:string,expect:string,anchor:string,label:string} $target
 * @return array<string,mixed>
 */
function statchasers_h1_measure( array $target ): array {
	$measured = array(
		'url'     => (string) $target['url'],
		'expect'  => (string) $target['expect'],
		'label'   => (string) ( $target['label'] ?? '' ),
		'count'   => null,
		'texts'   => array(),
		'matched' => false,
		'error'   => '',
	);

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
		$measured['error'] = $response->get_error_message();
		return $measured;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( 200 !== $code ) {
		$measured['error'] = sprintf( 'The page answered %d.', $code );
		return $measured;
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

	$measured['count'] = count( $matches[0] ?? array() );
	$measured['texts'] = array_slice( $texts, 0, 5 );

	// Either the generated phrase, or any heading that names the subject. The
	// second is what makes a hand-written hero - a Divi Code module carrying
	// its own <h1> - read as the page's heading rather than as a stray one.
	$expect = statchasers_h1_normalise( (string) $target['expect'] );
	$anchor = statchasers_h1_normalise( (string) ( $target['anchor'] ?? '' ) );

	foreach ( $texts as $text ) {
		$hit = ( '' !== $expect && ( false !== stripos( $text, $expect ) || false !== stripos( $expect, $text ) ) )
			|| ( '' !== $anchor && false !== stripos( $text, $anchor ) );

		if ( $hit ) {
			$measured['matched'] = true;
			break;
		}
	}

	return $measured;
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
function statchasers_h1_should_print( string $tool = '' ): bool {
	$mode = statchasers_h1_mode();

	if ( 'on' === $mode || 'replace' === $mode ) {
		return true;
	}

	// The tool prints the page's heading itself, out of its own markup, so the
	// plugin adds nothing above it. See statchasers_h1_tool_supplies_heading().
	if ( 'off' === $mode || 'tool' === $mode ) {
		return false;
	}

	$verdict = statchasers_h1_verdict();

	if ( null === $verdict ) {
		return false;
	}

	$measured = statchasers_h1_measurement_for( $verdict, $tool );

	if ( null === $measured || '' !== (string) $measured['error'] || null === $measured['count'] ) {
		return false;
	}

	return 0 === (int) $measured['count'];
}

/**
 * The measurement that answers for THIS page type.
 *
 * The rule that matters is the last one: a tool with no measurement of its own
 * gets no answer rather than somebody else's. Reusing the hub's count for a
 * player page is exactly how the published player pages ended up with two H1s -
 * the hub's title comes from a builder layout and the player page's comes from
 * `page.php`, so the hub honestly measured zero and the player page honestly
 * had one, and one number was being asked to describe both.
 *
 * A verdict stored before this file learned to measure per tool has no `tools`
 * key at all. That one still answers for the hub, which is the page it was
 * taken on, and for nothing else - so an upgrade quiets the duplicate heading
 * immediately and the screen asks for a fresh run to restore the rest.
 *
 * @param array<string,mixed> $verdict Stored verdict.
 * @param string              $tool    Page type, or '' for the stored default.
 * @return array<string,mixed>|null
 */
function statchasers_h1_measurement_for( array $verdict, string $tool ): ?array {
	if ( '' === $tool ) {
		return $verdict;
	}

	if ( isset( $verdict['tools'][ $tool ] ) && is_array( $verdict['tools'][ $tool ] ) ) {
		return $verdict['tools'][ $tool ];
	}

	// Pre-`tools` verdict: it was taken on a hub, so it speaks for hubs only.
	if ( ! isset( $verdict['tools'] ) && 'team' === $tool ) {
		return $verdict;
	}

	return null;
}

/**
 * Should the theme's own page title be emptied on these pages?
 *
 * Only in `replace`, and only ever deliberately. This is the plugin reaching
 * into markup it does not own, which is a different kind of act from adding
 * markup of its own, and it exists for one situation: a theme that prints a
 * page title from its template, with no builder layout to remove it from. Divi
 * is that theme - `<h1 class="entry-title main_title">` comes out of page.php -
 * and on a site whose other pages carry a hand-built hero with a heading, a
 * rule and a standfirst, the template's bare title is the one thing that cannot
 * be made to match.
 *
 * What it does NOT do is hide a heading and leave the page without one. It runs
 * only where the shortcode is printing a heading in its place, so the page ends
 * up with exactly one, in the site's own hero markup, naming the section the
 * reader is on.
 */
function statchasers_h1_should_replace(): bool {
	$mode = statchasers_h1_mode();

	// `tool` empties the theme's title too, but for the opposite reason: not so
	// the plugin can print a heading in its place, but so the fragment's own
	// section heading can be the page's <h1> without the theme printing the
	// same phrase above it.
	if ( 'tool' === $mode ) {
		return true;
	}

	return 'replace' === $mode && statchasers_h1_should_print();
}

/**
 * Does the mounted tool supply the page's <h1> itself?
 *
 * The player fragment opens each section with "<player> Stats 2026" and its
 * siblings, normally as an <h2> because the host page has the <h1>. On a
 * section address the theme prints that same phrase as the page title, so the
 * reader sees it twice - once in the theme's serif at the top, once with the
 * gold rule under it below the tab strip.
 *
 * In this mode the theme's title is emptied and the fragment is asked for the
 * promoted markup instead (`?h1=1`), so the heading a reader can see IS the
 * page's heading. One phrase, once, in the tool's own type.
 */
function statchasers_h1_tool_supplies_heading(): bool {
	return 'tool' === statchasers_h1_mode();
}

/**
 * Is this request a page that mounts one of the tools?
 *
 * The guards are the ones every `the_title` filter in this plugin carries, and
 * they matter more here than anywhere else: `the_title` is called for menu
 * items, admin lists, widgets and archive listings, and emptying it in any of
 * those renames the page everywhere it is mentioned rather than unheading the
 * one it is on.
 */
function statchasers_h1_mounts_a_tool(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	if ( is_admin() || ! is_singular() ) {
		return false;
	}

	$queried = get_queried_object();
	if ( ! $queried instanceof WP_Post ) {
		return false;
	}

	$content = (string) $queried->post_content;

	foreach ( array(
		defined( 'STATCHASERS_TEAM_SHORTCODE' ) ? STATCHASERS_TEAM_SHORTCODE : '',
		defined( 'STATCHASERS_PLAYER_SHORTCODE' ) ? STATCHASERS_PLAYER_SHORTCODE : '',
		defined( 'STATCHASERS_MATCHUP_SHORTCODE' ) ? STATCHASERS_MATCHUP_SHORTCODE : '',
		defined( 'STATCHASERS_SCHEDULE_SHORTCODE' ) ? STATCHASERS_SCHEDULE_SHORTCODE : '',
		// The rest-of-season board only. The redraft page's heading is its
		// editor's, as it was before the two boards were split.
		defined( 'STATCHASERS_ROS_RANKINGS_SHORTCODE' ) ? STATCHASERS_ROS_RANKINGS_SHORTCODE : '',
		defined( 'STATCHASERS_PLAYER_STATS_SHORTCODE' ) ? STATCHASERS_PLAYER_STATS_SHORTCODE : '',
		defined( 'STATCHASERS_SOS_SHORTCODE' ) ? STATCHASERS_SOS_SHORTCODE : '',
		defined( 'STATCHASERS_RHR_SHORTCODE' ) ? STATCHASERS_RHR_SHORTCODE : '',
	) as $tag ) {
		if ( '' !== $tag && has_shortcode( $content, $tag ) ) {
			$answer = true;
			return $answer;
		}
	}

	$answer = false;
	return $answer;
}

/**
 * Empty the theme's page title.
 *
 * Last, at PHP_INT_MAX, because the team and player files filter the same hook
 * to rewrite that title into the section-aware phrase. In `replace` they are
 * both right and this one is later: the phrase they produce is the phrase the
 * shortcode is about to print in the hero, so what the template gets is
 * nothing.
 *
 * The element itself survives - a filter on the text inside `<h1>` cannot
 * remove the `<h1>` - so what the theme prints is an empty heading, and the
 * rule below hides it. That husk is the honest cost of doing this without a
 * builder layout, and it is why `replace` is not the default.
 */
add_filter(
	'the_title',
	static function ( $title, $id = 0 ) {
		if ( ! statchasers_h1_should_replace() || ! in_the_loop() || ! is_main_query() ) {
			return $title;
		}

		$queried = get_queried_object();
		if ( ! $queried instanceof WP_Post || (int) $queried->ID !== (int) $id ) {
			return $title;
		}

		return statchasers_h1_mounts_a_tool() ? '' : $title;
	},
	PHP_INT_MAX,
	2
);

/**
 * Take the emptied title out of the document.
 *
 * The rule below hides the husk from readers, but not from anyone who reads
 * the source: an SEO audit of the player pages found
 * `<h1 class="entry-title main_title"></h1>` in View Source and reported the
 * page's H1 as empty - a second, blank H1 beside the one the tool supplies.
 * A filter on the text cannot remove the element, so this removes it from the
 * output instead.
 *
 * Buffered, which the file header argues against, but not the document. Divi's
 * page.php prints the title between the loop starting and `the_content()`, so
 * the buffer opens at `loop_start` and closes the first time `the_content` is
 * filtered: an <article> tag, the title, perhaps a thumbnail, and nothing that
 * this plugin is not already rewriting. The same guards as the title filter
 * decide when it opens at all, so it only ever exists on the page whose title
 * was emptied.
 *
 * `loop_end` flushes whatever is still open, for a template that never calls
 * `the_content()`. The level check keeps it from closing a buffer that
 * somebody else opened inside ours.
 */
function statchasers_h1_strip_husk( string $html ): string {
	return (string) preg_replace( '#<h1\b[^>]*\bentry-title\b[^>]*>\s*</h1>\s*#i', '', $html );
}

/** The buffer level `loop_start` opened, or 0 when none is open. */
function statchasers_h1_husk_level( ?int $set = null ): int {
	static $level = 0;

	if ( null !== $set ) {
		$level = $set;
	}

	return $level;
}

/** @param mixed $query The WP_Query that is starting its loop. */
function statchasers_h1_husk_open( $query ): void {
	if ( 0 !== statchasers_h1_husk_level() || ! statchasers_h1_should_replace() ) {
		return;
	}

	if ( ! is_object( $query ) || ! method_exists( $query, 'is_main_query' ) || ! $query->is_main_query() ) {
		return;
	}

	if ( ! statchasers_h1_mounts_a_tool() ) {
		return;
	}

	ob_start();
	statchasers_h1_husk_level( ob_get_level() );
}

/** Close the buffer, if it is still ours, and print it without the husk. */
function statchasers_h1_husk_close(): void {
	$level = statchasers_h1_husk_level();

	if ( 0 === $level ) {
		return;
	}

	// -1 rather than 0: the loop may run again (a second main-query loop in a
	// template), and the page has had its title printed once already.
	statchasers_h1_husk_level( -1 );

	if ( ob_get_level() !== $level ) {
		return;
	}

	echo statchasers_h1_strip_husk( (string) ob_get_clean() ); // phpcs:ignore WordPress.Security.EscapeOutput -- the theme's own output, minus one element.
}

add_action( 'loop_start', 'statchasers_h1_husk_open', 0 );
add_action( 'loop_end', 'statchasers_h1_husk_close', PHP_INT_MAX );
add_filter(
	'the_content',
	static function ( $content ) {
		statchasers_h1_husk_close();
		return $content;
	},
	0
);

/**
 * The two rules the plugin's own markup needs, and no more.
 *
 * Printed rather than enqueued: which stylesheet handle is on the page depends
 * on which tool it mounts, and neither of these belongs to any of them. The
 * hero's LOOK is still the site's own CSS - this file ships none of that, for
 * the reason given on statchasers_page_heading_html().
 *
 * 1. The gutter. A hand-built hero is a full-width module: it spans the window
 *    and constrains its own contents, with side padding - 40px on desktop, 28
 *    and 18 further down - and an inner shell held to the site's content width
 *    and centered. The generated one is printed into the same container as the
 *    fragment beneath it, and an embedded fragment runs flush to that container
 *    because the host owns the page gutter (`.sct.is-embed { --sct-gutter: 0 }`).
 *    So both halves of the module's own centering indent the heading past the
 *    tool it heads, and both have to go: the padding, and the max-width with
 *    the auto margins that go with it. Zeroing only the padding left the larger
 *    of the two in place - a container wider than the shell still inset the
 *    heading by half the difference, which is what a reader actually sees.
 *
 *    `!important`, which is not free and is worth saying why. The site's hero
 *    CSS lives in Divi > Theme Options > Custom CSS, and Divi prints that block
 *    from `wp_head` at the same priority this runs at; with the two rules at
 *    equal specificity the winner is whichever hook fired last, which is not
 *    something this file can know or should depend on. The element being forced
 *    is one the plugin generated itself, four lines down, and the declarations
 *    only ever undo centering - so the cost is bounded to the plugin's own copy,
 *    and the hand-written heroes on every other page are untouched.
 *
 * 2. The husk, when the theme's title has been emptied. `:empty` matches an
 *    element with no children at all, including text - which is exactly what
 *    `the_title` returning '' produces, and is why it cannot catch a heading
 *    that merely looks empty. A theme that wraps its title in whitespace needs
 *    a line of its own; the admin panel says so.
 */
add_action(
	'wp_head',
	static function (): void {
		if ( ! statchasers_h1_mounts_a_tool() ) {
			return;
		}

		$css = '';

		// Also in `tool` mode, where the schedule answers with the generated
		// hero rather than a heading of its own (statchasers-schedule.php).
		// The hubs and profiles print no generated hero in that mode, so there
		// the rule matches nothing.
		if ( statchasers_h1_should_print() || statchasers_h1_tool_supplies_heading() ) {
			$css .= '.sc-lo-hero--generated{padding-left:0!important;padding-right:0!important}' .
				'.sc-lo-hero--generated .sc-lo-hero__inner{' .
					'max-width:none!important;width:100%!important;' .
					'margin-left:0!important;margin-right:0!important;' .
					'padding-left:0!important;padding-right:0!important}';
		}

		if ( statchasers_h1_should_replace() ) {
			$css .= 'h1.entry-title:empty,h1.entry-title.main_title:empty{display:none!important}';
		}

		if ( '' === $css ) {
			return;
		}

		echo '<style id="statchasers-heading">' . $css . '</style>' . "\n";
	},
	100
);

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

	if ( 'replace' === $mode ) {
		return array(
			'level' => 'info',
			'text'  => 'Printing the heading <strong>and emptying the theme\'s own page title</strong> on pages that mount a tool. ' .
				'Check one of them: there should be exactly one H1, and it should be the hero\'s.',
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
				'in the site\'s own hero markup. <strong>The hero CSS has to be site-wide for that to look right</strong> - ' .
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
			'The page has %d H1, but it does not name the team - found %s. That is a heading written once and reused on every page (a site-wide hero module, or a theme printing the site name), so all 32 hubs are sharing it. The shortcodes will not add a second one; the fix is to make that heading name the page.',
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
 * two should never meet - but "should never" is not a reason to put a duplicate
 * id in the document if they ever do.
 */
const STATCHASERS_HEADING_ID = 'statchasers-page-title';

/**
 * A generated heading, in the site's own hero markup.
 *
 * The class names are the ones the hand-written hero modules already use, so
 * one stylesheet dresses both: the four pages written by hand and the ~1,100
 * generated addresses that nobody could write by hand - 32 hubs across six
 * sections each, several hundred profiles across seven, and 496 pair URLs that
 * all render from a single holder page and so have no module to write into.
 *
 * THE STYLESHEET IS NOT SHIPPED. It lives wherever the site keeps it, which
 * means Divi > Theme Options > Custom CSS rather than inside the Code module
 * that carries one hero. A copy in this plugin would be a second definition of
 * the design, and the first thing it would do is drift from the first one. The
 * consequence to know about: with the CSS still inline in a module, a generated
 * heading is unstyled - correct markup, no gold rule - and the admin panel says
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
	// change with it - and the fragment cannot find a heading it does not own
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
	if ( $value ) {
		return true;
	}

	// Which page type is asking. The check is per page type because the answer
	// is - see statchasers_h1_measurement_for().
	$map = array(
		'statchasers_team_shortcode_h1'    => 'team',
		'statchasers_player_shortcode_h1'  => 'player',
		'statchasers_matchup_shortcode_h1' => 'matchup',
		'statchasers_schedule_shortcode_h1' => 'schedule',
		// No probe of their own: in `auto` they get no answer and print
		// nothing, which leaves the theme's heading alone. See
		// statchasers_h1_measurement_for() on why nobody borrows the hub's.
		'statchasers_rankings_shortcode_h1'     => 'rankings',
		'statchasers_player_stats_shortcode_h1' => 'player_stats',
		'statchasers_sos_shortcode_h1'          => 'sos',
		'statchasers_rhr_shortcode_h1'          => 'rhr',
	);

	return statchasers_h1_should_print( $map[ current_filter() ] ?? '' );
}
add_filter( 'statchasers_team_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_player_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_matchup_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_schedule_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_rankings_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_player_stats_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_sos_shortcode_h1', 'statchasers_h1_filter' );
add_filter( 'statchasers_rhr_shortcode_h1', 'statchasers_h1_filter' );

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
				in_array( $mode, STATCHASERS_H1_MODES, true ) ? $mode : 'auto',
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
		'Most themes print one from the page title - which this plugin has already rewritten to name the team, player or section. ' .
		'A layout that prints no title leaves the page with no heading at all, so this checks a real published page and reports what it found.</p>'
	);

	printf(
		'<p class="description">When it does print one, it uses the same <code>%s</code> markup the hand-written hero modules use - ' .
		'section, H1, rule, lead - so the ~1,100 generated addresses and the handful of pages you write yourself are one component. ' .
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
		'auto'    => 'Follow the check (recommended) - print a heading only when the theme prints none.',
		'on'      => 'Always print a heading from the shortcode. Use this where the template prints no title of its own.',
		'replace' => 'Print the heading <strong>and empty the theme\'s page title</strong> - for a theme that prints one from its template with no layout to remove it from. The emptied heading is hidden with a rule this plugin prints; a theme that pads its title with whitespace will need one line of CSS of its own.',
		'tool'    => '<strong>Let the tool supply the heading</strong> - empties the theme\'s page title and promotes the section heading the tool already prints (&#8220;Jacoby Brissett Stats 2026&#8221;, with the gold rule) to the page\'s H1. One heading, in the tool\'s own type, instead of the same phrase twice. Applies to player pages and team hubs. The NFL schedule prints the site&#8217;s own hero heading instead; the other tools are unaffected.',
		'off'     => 'Never print one; the theme supplies the H1.',
	) as $value => $label ) {
		printf(
			'<p><label><input type="radio" name="statchasers_h1_mode" value="%s"%s /> %s</label></p>',
			esc_attr( $value ),
			checked( $mode, $value, false ),
			wp_kses_post( $label )
		);
	}
	echo '</fieldset>';

	echo '<p><button type="submit" name="statchasers_h1_mode_save" value="1" class="button">Save</button></p>';
	echo '</form>';
}
