<?php
/**
 * NFL matchup pages: /nfl/<team-a>-vs-<team-b>/.
 *
 * One evergreen page per pair of teams - 496 of them - with no post behind any
 * of them. A rewrite rule sends every pair URL to ONE holder page carrying the
 * shortcode, with the pair in a query var; the shortcode fetches that pair's
 * fragment from the API and the filters below give the page its own title,
 * description, canonical and og:url. The holder itself is noindex: it is a
 * template, not a page.
 *
 * The canonical order of a pair is decided once, on the API (matchup/pair.ts),
 * and mirrored here only far enough to redirect the reversed spelling before
 * a fetch: the two team slugs sorted alphabetically. Which team's hub sent the
 * reader here cannot reach the URL.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_MATCHUP_SHORTCODE = 'statchasers_matchup';

/** The holder page's path, under the same container as the team hubs. */
const STATCHASERS_MATCHUP_HOLDER = 'nfl/matchup';

/** Public base for pair URLs. Must match SC_MATCHUP_PATH_PREFIX on the API. */
const STATCHASERS_MATCHUP_BASE = 'nfl';

/**
 * The postseason rounds, as they are spelled in a game address, keyed by
 * ESPN's week number within its postseason, with the name the page prints.
 *
 * MIRRORS ROUND_SLUGS in the API's src/lib/matchup/pair.ts (the slugs) and
 * POSTSEASON_WEEKS in src/lib/team/schedule.ts (the labels). Week 4 is the Pro
 * Bowl, which has no name here because it is never a meeting between a pair.
 */
const STATCHASERS_MATCHUP_ROUNDS = array(
	1 => array( 'wild-card', 'Wild Card' ),
	2 => array( 'divisional', 'Divisional Round' ),
	3 => array( 'conference-championship', 'Conference Championship' ),
	5 => array( 'super-bowl', 'Super Bowl' ),
);

/**
 * The SHAPE of a game segment, for the rewrite rule: every spelling
 * gameSegment() in pair.ts can produce - `2026-week-1`, `2025-super-bowl`, and
 * `2025-postseason-week-4` for a round the API has no name for.
 *
 * Only the shape. The rewrite cannot say "a week no higher than 25" or "a
 * season after 1920", so a segment that matches this can still be a 404:
 * statchasers_matchup_game() is the validator, and it decides at request time
 * exactly as the pair's own validity is decided. What this must never do is
 * be NARROWER than the API, which is what it was: the rule knew only the
 * regular-season spelling, so every postseason link the API printed - and it
 * prints them on every pair that has met in January - was a WordPress 404
 * before the validator was ever asked.
 */
const STATCHASERS_MATCHUP_GAME_SHAPE = '\d{4}-(?:week-\d{1,2}|postseason-week-\d{1,2}|wild-card|divisional|conference-championship|super-bowl)';

const STATCHASERS_MATCHUP_CACHE_TTL  = 5 * MINUTE_IN_SECONDS;
const STATCHASERS_MATCHUP_BACKUP_TTL = DAY_IN_SECONDS;
const STATCHASERS_MATCHUP_TIMEOUT    = 8;

/**
 * Whether the pair URLs are live. On by default.
 *
 *     add_filter( 'statchasers_matchup_urls', '__return_false' );
 *
 * Same shape as the team section switch, and like it, the sitemap entries move
 * with the same flag so the sitemap can never advertise an address the rewrite
 * does not serve. The holder page has to exist for any of it to resolve, which
 * is what the Tools screen builds.
 */
function statchasers_matchup_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_matchup_urls', true );
}

/**
 * A pair from a URL segment, or null.
 *
 * @return array{a:string,b:string,slug:string,canonical:bool}|null
 */
function statchasers_matchup_pair( string $segment ): ?array {
	$at = strpos( $segment, '-vs-' );
	if ( false === $at || 0 === $at ) {
		return null;
	}
	$left  = substr( $segment, 0, $at );
	$right = substr( $segment, $at + 4 );
	if ( '' === $right || false !== strpos( $right, '-vs-' ) ) {
		return null;
	}

	$table = statchasers_team_table();
	if ( ! isset( $table[ $left ], $table[ $right ] ) || $left === $right ) {
		return null;
	}

	$a    = strcmp( $left, $right ) < 0 ? $left : $right;
	$b    = $a === $left ? $right : $left;
	$slug = $a . '-vs-' . $b;

	return array(
		'a'         => $a,
		'b'         => $b,
		'slug'      => $slug,
		'canonical' => $slug === $segment,
	);
}

add_filter(
	'query_vars',
	function ( array $vars ): array {
		$vars[] = 'sc_matchup';
		$vars[] = 'sc_matchup_game';
		return $vars;
	}
);

add_action(
	'init',
	function (): void {
		if ( ! statchasers_matchup_urls_enabled() ) {
			return;
		}
		// Two slug-shaped segments joined by -vs-. Validity is checked at
		// request time: the rule is the shape, the team table is the truth.
		add_rewrite_rule(
			'^' . STATCHASERS_MATCHUP_BASE . '/([a-z0-9-]+-vs-[a-z0-9-]+)/?$',
			'index.php?pagename=' . STATCHASERS_MATCHUP_HOLDER . '&sc_matchup=$matches[1]',
			'top'
		);
		// One address per meeting, beneath the pair: /nfl/<a>-vs-<b>/2026-week-1/.
		// Same holder page and the same one validation path - the extra segment
		// only names which game, and whether that game exists is a question only
		// the API can answer, so it is asked at request time like the pair is.
		//
		// Registered before the pair rule would swallow it? It cannot: the pair
		// rule is anchored to a single segment. Both are 'top' and both are
		// exact, so their order between themselves does not matter.
		//
		// The game group is non-capturing inside, so the game is still
		// $matches[2] whichever half of the season it names.
		$game_rule = '^' . STATCHASERS_MATCHUP_BASE . '/([a-z0-9-]+-vs-[a-z0-9-]+)/(' . STATCHASERS_MATCHUP_GAME_SHAPE . ')/?$';
		add_rewrite_rule(
			$game_rule,
			'index.php?pagename=' . STATCHASERS_MATCHUP_HOLDER .
				'&sc_matchup=$matches[1]&sc_matchup_game=$matches[2]',
			'top'
		);

		// A changed rule is dead until the rule table is rebuilt, and an
		// upgrade does not run the activation hook that asks for that - so the
		// postseason addresses would have gone on 404ing on every site that
		// updated rather than installed. Same remedy as the rankings file: the
		// rule's own signature is remembered, and a change to it asks for the
		// flush that statchasers-news.php performs at the end of this `init`.
		$signature = md5( $game_rule . '|' . STATCHASERS_MATCHUP_HOLDER );
		if ( get_option( 'statchasers_matchup_rules' ) !== $signature ) {
			update_option( 'statchasers_matchup_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/** The pair this request is for, validated, or null. */
function statchasers_matchup_current(): ?array {
	static $pair = null;
	static $done = false;
	if ( $done ) {
		return $pair;
	}
	$done = true;
	$raw  = (string) get_query_var( 'sc_matchup' );
	$pair = '' === $raw ? null : statchasers_matchup_pair( $raw );
	return $pair;
}

/**
 * A game segment, read: season, which half of the season, the week within that
 * half, and what to call it. Null for anything that is not an address.
 *
 * MIRRORS parseGameSegment() in the API's src/lib/matchup/pair.ts, including
 * its strictness: a leading zero, a capital letter or a different spelling of
 * "week" is not this address and is not redirected to it. The order matters
 * the same way it does there - `postseason-week-N` is tried before the named
 * rounds, because the round pattern's `[a-z-]+` would otherwise swallow it and
 * then fail to find it in the table.
 *
 * @return array{season:int,week:int,post:bool,label:string}|null
 */
function statchasers_matchup_parse_game( string $raw ): ?array {
	if ( preg_match( '/^(\d{4})-week-([1-9]\d?)$/', $raw, $match ) ) {
		$post  = false;
		$week  = (int) $match[2];
		$label = 'Week ' . $week;
	} elseif ( preg_match( '/^(\d{4})-postseason-week-([1-9]\d?)$/', $raw, $match ) ) {
		$post  = true;
		$week  = (int) $match[2];
		$label = array_key_exists( $week, STATCHASERS_MATCHUP_ROUNDS ) ? STATCHASERS_MATCHUP_ROUNDS[ $week ][1] : 'Postseason week ' . $week;
	} elseif ( preg_match( '/^(\d{4})-([a-z-]+)$/', $raw, $match ) ) {
		$post  = true;
		$week  = 0;
		$label = '';
		foreach ( STATCHASERS_MATCHUP_ROUNDS as $number => $round ) {
			if ( $round[0] === $match[2] ) {
				$week  = $number;
				$label = $round[1];
			}
		}
		if ( 0 === $week ) {
			return null;
		}
	} else {
		return null;
	}

	$season = (int) $match[1];
	// The bounds keep a parsed-but-impossible ref from reaching the API, not
	// express a real limit - the same two numbers pair.ts uses.
	if ( $season < 1920 || $season > 2200 || $week > 25 ) {
		return null;
	}

	return array(
		'season' => $season,
		'week'   => $week,
		'post'   => $post,
		'label'  => $label,
	);
}

/**
 * The game segment this request is for, validated, or ''.
 *
 * Handed to the API's `?game=` exactly as the URL spelled it: only a segment
 * statchasers_matchup_parse_game() accepts gets this far, and every such
 * segment is one the API parses to the same game.
 */
function statchasers_matchup_game(): string {
	$raw = trim( (string) get_query_var( 'sc_matchup_game' ) );
	if ( '' === $raw ) {
		return '';
	}
	return null === statchasers_matchup_parse_game( $raw ) ? '' : $raw;
}

/**
 * The canonical public URL of a pair, or of one meeting under it.
 *
 * @param string $slug Pair slug.
 * @param string $game Validated game segment, or '' for the pair itself.
 */
function statchasers_matchup_url( string $slug, string $game = '' ): string {
	$path = '/' . STATCHASERS_MATCHUP_BASE . '/' . $slug;
	if ( '' !== $game ) {
		$path .= '/' . $game;
	}
	return user_trailingslashit( home_url( $path ) );
}

/**
 * The reversed spelling is a 301, and a segment that is not a pair is a 404 -
 * before anything renders, so neither is ever an indexable copy of the holder.
 */
add_action(
	'template_redirect',
	function (): void {
		$raw = (string) get_query_var( 'sc_matchup' );
		if ( '' === $raw ) {
			return;
		}
		$pair = statchasers_matchup_current();
		if ( null === $pair ) {
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			return;
		}
		if ( ! $pair['canonical'] ) {
			wp_safe_redirect(
				statchasers_matchup_url( $pair['slug'], statchasers_matchup_game() ),
				301
			);
			exit;
		}

		// A game address answers to the API, because only the API knows the
		// schedule: whether those two played that week, and whether the pair's
		// own page has let the game go yet. Both answers ride in on the fetch
		// the shortcode is about to reuse from the same transient.
		$game = statchasers_matchup_game();
		if ( '' === $game ) {
			// A segment that got past the rewrite but not the validator - a
			// leading zero, a week past the end of a season. Never a page.
			if ( '' !== trim( (string) get_query_var( 'sc_matchup_game' ) ) ) {
				global $wp_query;
				$wp_query->set_404();
				status_header( 404 );
				nocache_headers();
			}
			return;
		}

		$data = statchasers_matchup_fetch( $pair['slug'], $game );

		// Null is the origin being unreachable, which is not an answer about
		// this URL. Leaving the page alone keeps a cached render serving rather
		// than turning an outage into a 404 Google will act on.
		if ( null === $data ) {
			return;
		}

		if ( ! empty( $data['missing'] ) ) {
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			return;
		}

		if ( 'current' === $data['game'] ) {
			// The pair's own page owns this game (this season's latest result,
			// until the rematch is within six days): the dated page renders,
			// with its canonical pointing at the pair's address and no
			// SportsEvent of its own (statchasers_matchup_canonical,
			// statchasers_matchup_event_node). Mirrors the API's own page.
			// Was a 301 until 1.10.38 (the SEO brief of 2026-10-10).
			return;
		}
	}
);

/**
 * Fetch the pair's fragment, cached. The API says which state the page is in
 * through response headers, and that rides along in the cache so the title
 * filter can read it without a second request.
 *
 * @return array{html:string,version:string,state:string,season:string}|null
 */
function statchasers_matchup_fetch( string $slug, string $game = '' ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	$key        = md5( $origin . '|matchup|' . $slug . '|' . $game );
	$cache_key  = 'sc_matchup_ssr_' . $key;
	$backup_key = 'sc_matchup_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	// `?game=` is what the origin takes; the pretty path is WordPress's own
	// spelling and never leaves this side. Same split as the team sections.
	$url = $origin . '/embed/matchup/' . rawurlencode( $slug );
	if ( '' !== $game ) {
		$url = add_query_arg( 'game', rawurlencode( $game ), $url );
	}

	$response = wp_remote_get(
		$url,
		array(
			'timeout' => STATCHASERS_MATCHUP_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 on a game address is an answer, not an outage: these two did not
	// play that week. It must not fall through to the backup copy, which would
	// serve the pair's last good render under a URL that means something else.
	if ( 404 === $code && '' !== $game ) {
		$missing = array(
			'html'    => '',
			'version' => '',
			'state'   => '',
			'season'  => '',
			'score'   => '',
			'game'    => '',
			'missing' => true,
		);
		set_transient( $cache_key, $missing, STATCHASERS_MATCHUP_CACHE_TTL );
		return $missing;
	}

	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute too: otherwise every view,
			// and every caller within a view, retries the origin and waits out
			// the timeout for as long as it stays down.
			set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '', 'state' => '', 'season' => '', 'score' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
		'state'   => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-state' ) ),
		'season'  => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-season' ) ),
		'score'   => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-score' ) ),
		// "Week 2" while the pair's page leads with one of this season's played
		// games, which retitles it (statchasers_matchup_meta); empty otherwise.
		'week'    => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-week' ) ),
		// "current" means the pair's own page is still leading with this game,
		// so this address does not exist yet. "archived" means it does.
		'game'    => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-game' ) ),
		// The H1 and <title> as the API wrote them, percent-encoded because the
		// title's score carries an en dash. Empty from an API that predates
		// them, in which case the builders below stand in.
		'heading' => rawurldecode( trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-heading' ) ) ),
		'title'   => rawurldecode( trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-title' ) ) ),
		// A completed game's description, and its share image: a path on the
		// API origin (made absolute in statchasers_matchup_share_image()) with
		// its alt text. Empty from an older API, or on any other page.
		'description' => rawurldecode( trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-description' ) ) ),
		'image'       => trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-image' ) ),
		'image_alt'   => rawurldecode( trim( (string) wp_remote_retrieve_header( $response, 'x-matchup-image-alt' ) ) ),
		'missing' => false,
	);

	set_transient( $cache_key, $payload, STATCHASERS_MATCHUP_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_MATCHUP_BACKUP_TTL );

	return $payload;
}

/** The shortcode: prints the pair's fragment. Team assets, same bundle. */
function statchasers_matchup_shortcode(): string {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return current_user_can( 'manage_options' )
			? '<p><strong>StatChasers Matchup:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code>.</p>'
			: '';
	}

	$pair = statchasers_matchup_current();
	if ( null === $pair ) {
		return current_user_can( 'manage_options' )
			? '<p><strong>StatChasers Matchup:</strong> this page is the holder for <code>/' . esc_html( STATCHASERS_MATCHUP_BASE ) . '/&lt;team&gt;-vs-&lt;team&gt;/</code> and renders nothing at its own address.</p>'
			: '';
	}

	$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
	statchasers_team_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		return current_user_can( 'manage_options' )
			? sprintf( '<p><strong>StatChasers Matchup:</strong> the API returned nothing for <code>%s</code>.</p>', esc_html( $pair['slug'] ) )
			: '';
	}

	/**
	 * Filters the server-rendered matchup fragment before it is printed.
	 *
	 * @param string $html Rendered fragment.
	 * @param string $slug Pair slug.
	 */
	$html = statchasers_matchup_strip_event_data( (string) $data['html'] );

	// The H1 belongs inside the scoreboard hero. When this page supplies the
	// heading, the hero's is promoted and nothing is printed above it; an API
	// render with no hero heading to promote gets the separate block as before.
	//
	// In the "tool supplies the heading" mode the theme's title is emptied
	// (statchasers_h1_should_replace) and the per-tool filter answers no, so
	// until 1.10.34 the matchup pages had no H1 at all: the hero's wording sat
	// in an <h2> under an emptied title. The hero IS the heading this tool
	// supplies, so that mode promotes it too (mak, 2026-10-09).
	$heading   = '';
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' ) && statchasers_h1_tool_supplies_heading();
	if ( $tool_mode || apply_filters( 'statchasers_matchup_shortcode_h1', false ) ) {
		$promoted = statchasers_matchup_promote_heading( $html );
		if ( null !== $promoted ) {
			$html = $promoted;
		} elseif ( ! $tool_mode ) {
			$heading = statchasers_matchup_shortcode_heading();
		}
	}

	return $heading .
		(string) apply_filters( 'statchasers_matchup_fragment_html', $html, $pair['slug'] );
}
add_shortcode( STATCHASERS_MATCHUP_SHORTCODE, 'statchasers_matchup_shortcode' );

/**
 * The fragment with its hero heading made the page's H1, or null.
 *
 * The API renders the scoreboard hero's heading as an H2 marked
 * `data-sct-hero-heading` inside an embed, so a plugin that prints its own H1
 * above the fragment (1.10.12 and earlier) still gets exactly one. This is the
 * other half: promote that H2 in place, so the one H1 is inside the hero.
 * Null when there is no such heading to promote.
 *
 * @param string $html Rendered fragment.
 * @return string|null
 */
function statchasers_matchup_promote_heading( string $html ): ?string {
	if ( false === strpos( $html, 'data-sct-hero-heading' ) ) {
		return null;
	}

	$promoted = preg_replace(
		'#<h2(\s[^>]*\bdata-sct-hero-heading\b[^>]*)>(.*?)</h2>#s',
		'<h1$1>$2</h1>',
		$html,
		1,
		$count
	);

	return ( null === $promoted || 1 !== $count ) ? null : $promoted;
}

/**
 * Drop the SportsEvent, FAQ and VideoObject islands from the printed markup.
 *
 * It is a transport for statchasers_matchup_event_node(), which reads the
 * cached fetch rather than this string, so removing it here costs the node
 * nothing.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_matchup_strip_event_data( string $html ): string {
	if ( false === strpos( $html, 'sct-matchup-event-data' ) && false === strpos( $html, 'sct-matchup-faq-data' ) && false === strpos( $html, 'sct-matchup-video-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="sct-matchup-(?:event|faq|video)-data">.*?</script>#s',
		'',
		$html
	);
}

/* -------------------------------------------------------------- headings */

/**
 * The H1 for the pair URL this request is on.
 *
 * MIRRORS heroHeading() in the API's src/lib/matchup/matchup-render.ts: the
 * two team names for the pair's own page, and the meeting named after them on
 * a dated one, because two pages headed "Patriots vs Eagles" are two pages
 * competing for one query.
 *
 * This matters more here than anywhere else in the plugin. One holder page
 * serves 496 addresses, so without a filter rewriting the title, 496 URLs
 * share a single H1 - the holder's - and none of them says which game it is.
 */
function statchasers_matchup_heading(): string {
	$pair = statchasers_matchup_current();

	if ( null === $pair ) {
		return '';
	}

	// The API's own words when it sent them. A game page's H1 runs away then
	// home, which only the API knows; the pair's names below are the fallback
	// for an API that predates the header.
	if ( '' !== statchasers_news_origin() ) {
		$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
		if ( is_array( $data ) && '' !== ( $data['heading'] ?? '' ) ) {
			return (string) $data['heading'];
		}
	}

	$names  = statchasers_matchup_names( $pair );
	$parsed = statchasers_matchup_parse_game( statchasers_matchup_game() );

	if ( null === $parsed ) {
		return $names;
	}

	// A game page's H1 (the SEO brief of 2026-10-10): "{Away} vs {Home} Box
	// Score & Player Stats: Week {N}, {Year}", MIRRORING scoreboardPageHeading()
	// in the API's scoreboard-hero.ts - nicknames, in the pair's order here
	// since only the API knows which side was away.
	$table  = statchasers_team_table();
	$nick_a = substr( strrchr( ' ' . ( $table[ $pair['a'] ][0] ?? $pair['a'] ), ' ' ), 1 );
	$nick_b = substr( strrchr( ' ' . ( $table[ $pair['b'] ][0] ?? $pair['b'] ), ' ' ), 1 );
	return sprintf( '%s vs %s Box Score & Player Stats: %s, %d', $nick_a, $nick_b, $parsed['label'], $parsed['season'] );
}

/**
 * "New England Patriots vs Philadelphia Eagles": the pair's two full names, in
 * the pair's own order.
 *
 * @param array{a:string,b:string} $pair A validated pair.
 */
function statchasers_matchup_names( array $pair ): string {
	$table = statchasers_team_table();
	return sprintf(
		'%s vs %s',
		$table[ $pair['a'] ][0] ?? $pair['a'],
		$table[ $pair['b'] ][0] ?? $pair['b']
	);
}

/**
 * Rewrite the holder page's title, which is the theme's H1.
 *
 * Guarded the same way the team and player filters are: the main query's own
 * title, in the loop, and only when the request actually resolved to a pair.
 * Off a pair URL the holder keeps its own name.
 */
add_filter(
	'the_title',
	static function ( $title, $id = 0 ) {
		if ( ! is_singular( 'page' ) || ! in_the_loop() || ! is_main_query() ) {
			return $title;
		}

		$queried = get_queried_object();
		if ( ! $queried instanceof WP_Post || (int) $queried->ID !== (int) $id ) {
			return $title;
		}

		$heading = statchasers_matchup_heading();

		return '' === $heading ? $title : $heading;
	},
	10,
	2
);

/**
 * The <h1> the shortcode prints itself. Off unless the probe says to.
 *
 * Same contract as the team and player versions - see statchasers-h1.php for
 * how that question is answered, and why it is answered by measurement rather
 * than by a guess about the template.
 */
function statchasers_matchup_shortcode_heading(): string {
	if ( ! apply_filters( 'statchasers_matchup_shortcode_h1', false ) ) {
		return '';
	}

	$meta = statchasers_matchup_request_meta();

	return statchasers_page_heading_html(
		statchasers_matchup_heading(),
		null === $meta ? '' : (string) $meta['description']
	);
}

/*
 * The hero's webfonts (Barlow, Barlow Condensed) ride on team.css as a
 * dependency - see statchasers_display_font_dependency() in
 * statchasers-assets.php - and the Google Fonts preconnect is shared there
 * too, so a matchup page enqueues the hub's assets and nothing more.
 */
add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( null !== statchasers_matchup_current() ) {
			statchasers_team_enqueue_assets();
		}
	}
);

/* -------------------------------------------------------------- metadata */

/**
 * The first title candidate that fits in 60 characters, most descriptive first.
 *
 * MIRRORS fitMatchupTitle() in the API's src/lib/matchup/matchup-seo.ts, which
 * is the shared statchasers_fit_title() budget. No brand since 2026-10-08
 * (was 70 characters with " | StatChasers" tried first). The last candidate
 * is short enough to fit for every pair.
 *
 * @param string[] $candidates Titles, most descriptive first.
 */
function statchasers_matchup_fit_title( array $candidates ): string {
	return statchasers_fit_title( $candidates );
}

/**
 * Title and description for a pair, in a state.
 *
 * MIRRORS matchupPageMeta() in the API's src/lib/matchup/matchup-seo.ts.
 * Change one and change the other.
 *
 * @param string $week "Week 2" (X-Matchup-Week) while the pair's page leads
 *                     with one of this season's played games; '' otherwise.
 * @return array{title:string,description:string}
 */
function statchasers_matchup_meta( string $a, string $b, string $state, string $season, string $score = '', string $week = '' ): array {
	$table  = statchasers_team_table();
	$name_a = $table[ $a ][0] ?? $a;
	$name_b = $table[ $b ][0] ?? $b;
	$nick_a = substr( strrchr( ' ' . $name_a, ' ' ), 1 );
	$nick_b = substr( strrchr( ' ' . $name_b, ' ' ), 1 );
	$names  = $name_a . ' vs ' . $name_b;
	$short  = $nick_a . ' vs ' . $nick_b;
	$season = '' === $season ? STATCHASERS_TEAM_SEASON : $season;

	// A pair that has played this season leads with that game, just played or
	// back in Week 2: "Browns vs Buccaneers Player Stats & Fantasy Points
	// (Week 2, 2026)", mak's wording (2026-10-09), same words in the H1 the
	// API sends. MIRRORS the seasonGameLead() branch of matchupPageMeta(): the
	// spec's string runs past sixty for most pairs, so the year goes first
	// ("Player Stats" outranks "2026" in the searches these pages get), then
	// the shorter wordings. Head-to-head wording is now only for a pair that
	// has not met this season.
	if ( '' !== $week && ( 'recently_completed' === $state || 'historical' === $state ) ) {
		$when = "($week, $season)";
		$lead = '' === trim( $score ) ? '' : trim( $score ) . ' ';
		return array(
			'title'       => statchasers_matchup_fit_title(
				array(
					"$short Player Stats & Fantasy Points $when",
					"$short Player Stats & Fantasy Points ($week)",
					"$short Stats & Fantasy Points $when",
					"$short Player Stats $when",
				)
			),
			'description' => sprintf( '%1$s%2$s vs %3$s %4$s %5$s player stats and fantasy points by player, plus the final score and the head-to-head record.', $lead, $nick_a, $nick_b, $week, $season ),
		);
	}

	switch ( $state ) {
		case 'upcoming':
			return array(
				'title'       => statchasers_matchup_fit_title(
					array(
						"$names $season: Where to Watch, Stats & Injuries",
						"$names $season: Where to Watch & Stats",
						"$names $season: Where to Watch",
						"$short $season: Where to Watch",
					)
				),
				'description' => sprintf( '%1$s vs %2$s in %3$s: kickoff time, TV, venue, team stats side by side, injury designations and the head-to-head record.', $nick_a, $nick_b, $season ),
			);
		case 'recently_completed':
			// The score leads the description when the API sent one, exactly as
			// matchupScoreLine() wrote it. Absent header, same sentence without it.
			$lead = '' === trim( $score ) ? '' : trim( $score ) . ' ';
			return array(
				'title'       => statchasers_matchup_fit_title(
					array(
						"$names $season: Score, Player Stats & Fantasy Recap",
						"$names $season: Score & Fantasy Recap",
						"$names $season Score & Stats",
						"$short $season: Score & Fantasy Recap",
					)
				),
				'description' => sprintf( '%1$s%2$s vs %3$s %4$s final score, quarter-by-quarter scoring, full player stats and the fantasy takeaways from the game.', $lead, $nick_a, $nick_b, $season ),
			);
	}
	return array(
		'title'       => statchasers_matchup_fit_title(
			array(
				"$names: Head-to-Head Record & History",
				"$names: Head-to-Head History",
				"$short: Head-to-Head Record & History",
			)
		),
		'description' => sprintf( '%1$s vs %2$s: the regular-season head-to-head record, recent meetings, and %3$s team stats side by side.', $nick_a, $nick_b, $season ),
	);
}

/**
 * Title and description for one meeting's own page.
 *
 * MIRRORS the `data.pinned` branch of matchupPageMeta() in the API's
 * src/lib/matchup/matchup-seo.ts (the SEO brief of 2026-10-10: "{Away} vs
 * {Home} Player Stats & Box Score, Week {N} {Year}"). Answered before the
 * pair's three states, there and here, because "patriots seahawks week 1
 * 2026" is a different search from "patriots vs seahawks" and two pages must
 * not answer it with one string. The API's title header wins whenever it is
 * sent (it knows which side was away); these are the strings for an API
 * that sent none, and they name the pair in its canonical order.
 *
 * @param string $a     Pair's first team slug.
 * @param string $b     Pair's second team slug.
 * @param string $game  Validated game segment, e.g. `2026-week-1` or `2025-super-bowl`.
 * @param string $score The result in one clause, from the API, or ''.
 * @return array{title:string,description:string}
 */
function statchasers_matchup_game_meta( string $a, string $b, string $game, string $score = '' ): array {
	$table  = statchasers_team_table();
	$name_a = $table[ $a ][0] ?? $a;
	$name_b = $table[ $b ][0] ?? $b;
	$nick_a = substr( strrchr( ' ' . $name_a, ' ' ), 1 );
	$nick_b = substr( strrchr( ' ' . $name_b, ' ' ), 1 );
	$names  = $name_a . ' vs ' . $name_b;
	$short  = $nick_a . ' vs ' . $nick_b;

	// The round's name rather than its number in the postseason: "Week 5
	// 2025" is not what anybody calls a Super Bowl. For a regular-season
	// game the label IS "Week N", so those strings are the API's exactly.
	$parsed = statchasers_matchup_parse_game( $game );
	$season = null === $parsed ? STATCHASERS_TEAM_SEASON : (string) $parsed['season'];
	$label  = null === $parsed ? 'Week' : $parsed['label'];
	$in     = null !== $parsed && $parsed['post'] ? 'the ' . $label : $label;

	$lead = '' === trim( $score ) ? '' : trim( $score ) . ' ';

	return array(
		'title'       => statchasers_matchup_fit_title(
			array(
				"$short Player Stats & Box Score, $label $season",
				"$short Box Score, $label $season",
				// "Buccaneers vs Commanders Box Score, Conference Championship":
				// the longest nicknames with the longest round still fit sixty.
				"$short Box Score, $label",
			)
		),
		'description' => sprintf(
			'%1$s%2$s vs %3$s, %4$s %5$s: full box score, fantasy points for every player, scoring summary and team stats.',
			$lead,
			$nick_a,
			$nick_b,
			$label,
			$season
		),
	);
}

/** This request's metadata, or null off a matchup URL. */
function statchasers_matchup_request_meta(): ?array {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}
	$game = statchasers_matchup_game();
	$data = statchasers_matchup_fetch( $pair['slug'], $game );

	// A game address that got this far is an archived one - the missing and the
	// still-current cases both left through template_redirect above.
	$meta = '' !== $game
		? statchasers_matchup_game_meta(
			$pair['a'],
			$pair['b'],
			$game,
			(string) ( $data['score'] ?? '' )
		)
		: statchasers_matchup_meta(
			$pair['a'],
			$pair['b'],
			(string) ( $data['state'] ?? '' ),
			(string) ( $data['season'] ?? '' ),
			(string) ( $data['score'] ?? '' ),
			(string) ( $data['week'] ?? '' )
		);

	// The API's title wins when it sent one: it is built from the same game
	// object as the hero ("Cardinals vs Rams Wild Card 2021: Final Score
	// 34–11, Stats & Recap"), which the builders above cannot see.
	if ( '' !== ( $data['title'] ?? '' ) ) {
		$meta['title'] = (string) $data['title'];
	}
	// Likewise the description, which on a completed game is the recap's:
	// the result, the venue and what the page holds.
	if ( '' !== ( $data['description'] ?? '' ) ) {
		$meta['description'] = (string) $data['description'];
	}

	return $meta;
}

/**
 * This request's share image - absolute URL, size and alt - or null.
 *
 * The API draws one per completed game at /og/<away>-vs-<home>-<season>-<round>.png
 * and names it in X-Matchup-Image. The path is served publicly from the API
 * origin (it is outside the embed key), so crawlers can fetch it directly.
 *
 * @return array{url:string,width:int,height:int,alt:string}|null
 */
function statchasers_matchup_share_image(): ?array {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}
	$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
	$path = is_array( $data ) ? (string) ( $data['image'] ?? '' ) : '';
	if ( '' === $path || 0 !== strpos( $path, '/og/' ) ) {
		return null;
	}
	$origin = statchasers_public_origin();
	if ( '' === $origin ) {
		return null;
	}
	return array(
		'url'    => rtrim( $origin, '/' ) . $path,
		'width'  => 1200,
		'height' => 630,
		'alt'    => (string) ( $data['image_alt'] ?? '' ),
	);
}

/**
 * The featured game as a SportsEvent, or null.
 *
 * The API builds it from the same game object the scoreboard hero draws
 * (scoreboardSportsEvent() in scoreboard-hero.ts) and ships it as an inert
 * island; this lifts it into Rank Math's graph so it arrives in the <head>,
 * inside the one <script> the page already emits. Checked for shape rather
 * than trusted, like the team islands: an Event without a startDate or a
 * location is a Search Console error, so a malformed one drops the node.
 *
 * @return array<string,mixed>|null
 */
function statchasers_matchup_event_node() {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}

	$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
	$html = is_array( $data ) ? (string) ( $data['html'] ?? '' ) : '';
	// A dated page the pair's page owns canonicalizes up to it, and the
	// pair's page carries the event. The API leaves the island out of such a
	// fragment; this is the same rule for an API that did not.
	if ( is_array( $data ) && 'current' === ( $data['game'] ?? '' ) ) {
		return null;
	}

	if ( ! preg_match( '#<script type="application/json" class="sct-matchup-event-data">(.*?)</script>#s', $html, $match ) ) {
		return null;
	}

	$node = json_decode( $match[1], true );

	if (
		! is_array( $node )
		|| ( $node['@type'] ?? '' ) !== 'SportsEvent'
		|| empty( $node['startDate'] )
		|| empty( $node['location'] )
		|| empty( $node['homeTeam'] )
		|| empty( $node['awayTeam'] )
	) {
		return null;
	}

	return $node;
}

/**
 * The recap page's FAQPage node, or null.
 *
 * Built by the API from the same array its <details> were drawn from
 * (recapFaq() in recap-body.ts), so what the graph says and what the page
 * shows are one list. Checked for shape: every question needs a name and an
 * answer, or the node is dropped rather than printed broken.
 *
 * @return array<string,mixed>|null
 */
function statchasers_matchup_faq_node() {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}

	$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
	$html = is_array( $data ) ? (string) ( $data['html'] ?? '' ) : '';

	if ( ! preg_match( '#<script type="application/json" class="sct-matchup-faq-data">(.*?)</script>#s', $html, $match ) ) {
		return null;
	}

	$node = json_decode( $match[1], true );

	if ( ! is_array( $node ) || ( $node['@type'] ?? '' ) !== 'FAQPage' || empty( $node['mainEntity'] ) || ! is_array( $node['mainEntity'] ) ) {
		return null;
	}

	foreach ( $node['mainEntity'] as $question ) {
		if ( ! is_array( $question ) || '' === (string) ( $question['name'] ?? '' ) || '' === (string) ( $question['acceptedAnswer']['text'] ?? '' ) ) {
			return null;
		}
	}

	return $node;
}

/**
 * The recap's highlights as a VideoObject, or null. Same island pattern as
 * the SportsEvent: built by the API (videoSchema() in recap-extras.ts) from
 * the video the page shows, checked for shape here.
 *
 * @return array<string,mixed>|null
 */
function statchasers_matchup_video_node() {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}

	$data = statchasers_matchup_fetch( $pair['slug'], statchasers_matchup_game() );
	$html = is_array( $data ) ? (string) ( $data['html'] ?? '' ) : '';

	if ( ! preg_match( '#<script type="application/json" class="sct-matchup-video-data">(.*?)</script>#s', $html, $match ) ) {
		return null;
	}

	$node = json_decode( $match[1], true );

	if (
		! is_array( $node )
		|| ( $node['@type'] ?? '' ) !== 'VideoObject'
		|| empty( $node['name'] )
		|| empty( $node['thumbnailUrl'] )
		|| empty( $node['uploadDate'] )
	) {
		return null;
	}

	return $node;
}

/**
 * Append the SportsEvent to Rank Math's graph.
 *
 * @param array<string,mixed> $data Rank Math's schema nodes.
 * @return array<string,mixed>
 */
function statchasers_matchup_rank_math_schema( $data ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}

	$node = statchasers_matchup_event_node();
	if ( null !== $node ) {
		$data['statchasersMatchupEvent'] = $node;
	}

	$faq = statchasers_matchup_faq_node();
	if ( null !== $faq ) {
		$data['statchasersMatchupFaq'] = $faq;
	}

	$video = statchasers_matchup_video_node();
	if ( null !== $video ) {
		$data['statchasersMatchupVideo'] = $video;
	}

	return $data;
}
add_filter( 'rank_math/json_ld', 'statchasers_matchup_rank_math_schema', 20 );

/** The SportsEvent and the FAQ on their own, for a site with no schema-graph plugin. */
function statchasers_matchup_print_fallback_schema(): void {
	if ( statchasers_news_graph_provider_present() ) {
		return;
	}

	foreach ( array( statchasers_matchup_event_node(), statchasers_matchup_faq_node(), statchasers_matchup_video_node() ) as $node ) {
		if ( null === $node ) {
			continue;
		}

		echo '<script type="application/ld+json">' .
			wp_json_encode( array( '@context' => 'https://schema.org' ) + $node, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) .
			'</script>' . "\n";
	}
}
add_action( 'wp_head', 'statchasers_matchup_print_fallback_schema', 20 );

function statchasers_matchup_canonical(): string {
	$pair = statchasers_matchup_current();
	if ( null === $pair ) {
		return '';
	}
	$game = statchasers_matchup_game();
	// A dated page the pair's page still owns (X-Matchup-Game: current) is a
	// copy of the pair's page and says so; once the pair has moved on, the
	// dated page is the only canonical address that game has.
	if ( '' !== $game && statchasers_matchup_game_is_owned( $pair['slug'], $game ) ) {
		return statchasers_matchup_url( $pair['slug'] );
	}
	return statchasers_matchup_url( $pair['slug'], $game );
}

/**
 * Does the pair's own page own this dated game (X-Matchup-Game: current)?
 *
 * Read from the same cached fetch the shortcode uses. An unreachable origin
 * answers false, so the page keeps its own canonical rather than switching
 * on an outage.
 */
function statchasers_matchup_game_is_owned( string $slug, string $game ): bool {
	if ( '' === $game ) {
		return false;
	}
	$data = statchasers_matchup_fetch( $slug, $game );
	return is_array( $data ) && 'current' === ( $data['game'] ?? '' );
}

add_filter( 'rank_math/frontend/title', function ( $title ) {
	$meta = statchasers_matchup_request_meta();
	// The brand is already in the title when it fit; see statchasers_matchup_fit_title().
	return $meta ? $meta['title'] : $title;
} );
add_filter( 'rank_math/frontend/description', function ( $description ) {
	$meta = statchasers_matchup_request_meta();
	return $meta ? $meta['description'] : $description;
} );
add_filter( 'rank_math/frontend/canonical', function ( $canonical ) {
	$url = statchasers_matchup_canonical();
	return '' === $url ? $canonical : $url;
} );
add_filter( 'rank_math/opengraph/url', function ( $url ) {
	$own = statchasers_matchup_canonical();
	return '' === $own ? $url : $own;
} );
/*
 * A completed game's share card: og:type article, the 1200×630 image and a
 * large Twitter card. Rank Math's hook names have varied between versions, so
 * both spellings are registered, as the depth-charts SEO class does; a filter
 * on a tag that is never emitted is a no-op.
 */
foreach ( array( 'rank_math/opengraph/type', 'rank_math/opengraph/facebook/og_type', 'rank_math/opengraph/facebook/og:type' ) as $statchasers_hook ) {
	add_filter( $statchasers_hook, function ( $type ) {
		return null !== statchasers_matchup_share_image() ? 'article' : $type;
	}, 20 );
}
foreach ( array( 'rank_math/opengraph/twitter/card_type', 'rank_math/opengraph/twitter/twitter_card', 'rank_math/opengraph/twitter/twitter:card' ) as $statchasers_hook ) {
	add_filter( $statchasers_hook, function ( $card ) {
		return null !== statchasers_matchup_share_image() ? 'summary_large_image' : $card;
	}, 20 );
}
foreach ( array( 'facebook', 'twitter' ) as $statchasers_network ) {
	add_action( "rank_math/opengraph/{$statchasers_network}/add_images", function ( $images ) {
		$image = statchasers_matchup_share_image();
		if ( null === $image || ! is_object( $images ) || ! method_exists( $images, 'add_image' ) ) {
			return;
		}
		$images->add_image(
			array(
				'url'    => $image['url'],
				'width'  => $image['width'],
				'height' => $image['height'],
				'alt'    => $image['alt'],
			)
		);
	}, 5 );
}

/** The share card on a site with no Rank Math: printed here instead. */
function statchasers_matchup_print_fallback_social(): void {
	if ( function_exists( 'rank_math' ) || class_exists( 'RankMath' ) ) {
		return;
	}
	$image = statchasers_matchup_share_image();
	if ( null === $image ) {
		return;
	}
	echo '<meta property="og:type" content="article" />' . "\n";
	printf( '<meta property="og:image" content="%s" />' . "\n", esc_url( $image['url'] ) );
	printf( '<meta property="og:image:width" content="%d" />' . "\n", (int) $image['width'] );
	printf( '<meta property="og:image:height" content="%d" />' . "\n", (int) $image['height'] );
	printf( '<meta property="og:image:alt" content="%s" />' . "\n", esc_attr( $image['alt'] ) );
	echo '<meta name="twitter:card" content="summary_large_image" />' . "\n";
	printf( '<meta name="twitter:image" content="%s" />' . "\n", esc_url( $image['url'] ) );
	printf( '<meta name="twitter:image:alt" content="%s" />' . "\n", esc_attr( $image['alt'] ) );
}
add_action( 'wp_head', 'statchasers_matchup_print_fallback_social', 5 );

add_filter( 'rank_math/frontend/robots', function ( $robots ) {
	if ( null === statchasers_matchup_request_meta() ) {
		return $robots;
	}
	// The holder is noindex so that its bare address stays out; a pair URL is
	// the page and says so explicitly, overriding what it inherits.
	$robots['index']  = 'index';
	$robots['follow'] = 'follow';
	return $robots;
} );
add_filter( 'document_title_parts', function ( array $parts ): array {
	$meta = statchasers_matchup_request_meta();
	if ( $meta && isset( $parts['title'] ) ) {
		// The whole title, brand included when it fit, so WordPress must not
		// append the site name a second time.
		return array( 'title' => $meta['title'] );
	}
	return $parts;
} );
add_filter( 'get_canonical_url', function ( $canonical ) {
	$url = statchasers_matchup_canonical();
	return '' === $url ? $canonical : $url;
} );

/**
 * The breadcrumb trail for a pair URL, or for one meeting under it.
 *
 * Rank Math builds the trail from the page the rewrite resolved to, which is
 * the holder - so every one of the 496 pairs, and every dated game, carried a
 * BreadcrumbList ending at /nfl/matchup/: a noindex template, named as the
 * page's parent, in a trail that is meant to say where the page sits. The
 * holder's crumb is taken out, and the pair is appended in its place, then the
 * game on a dated address: Home › NFL › Patriots vs Eagles › Week 1 2026.
 *
 * The holder is recognized by its address rather than by position, because
 * which crumbs Rank Math prints (a Home label, the ancestors) is a setting.
 * Only on a canonical pair: the reversed spelling and a bad game segment have
 * already left through the 301 and 404 in template_redirect.
 *
 * @param array<int,array<int|string,mixed>> $crumbs Rank Math's crumbs.
 * @return array<int,array<int|string,mixed>>
 */
function statchasers_matchup_breadcrumbs( $crumbs ) {
	$pair = statchasers_matchup_current();
	if ( ! is_array( $crumbs ) || null === $pair || ! $pair['canonical'] ) {
		return $crumbs;
	}

	$raw_game = trim( (string) get_query_var( 'sc_matchup_game' ) );
	$game     = statchasers_matchup_game();
	if ( '' !== $raw_game && '' === $game ) {
		return $crumbs;
	}

	$holder = untrailingslashit( home_url( '/' . STATCHASERS_MATCHUP_HOLDER ) );
	$kept   = array();
	foreach ( $crumbs as $crumb ) {
		$url = is_array( $crumb ) && isset( $crumb[1] ) ? untrailingslashit( (string) $crumb[1] ) : '';
		if ( $url === $holder ) {
			continue;
		}
		$kept[] = $crumb;
	}

	$kept[] = array( statchasers_matchup_names( $pair ), statchasers_matchup_url( $pair['slug'] ), 'hide_in_schema' => false );

	$parsed = '' === $game ? null : statchasers_matchup_parse_game( $game );
	if ( null !== $parsed ) {
		$kept[] = array(
			$parsed['label'] . ' ' . $parsed['season'],
			statchasers_matchup_url( $pair['slug'], $game ),
			'hide_in_schema' => false,
		);
	}

	return $kept;
}
add_filter( 'rank_math/frontend/breadcrumb/items', 'statchasers_matchup_breadcrumbs', 20 );

/* --------------------------------------------------------------- sitemap */

/** Every canonical pair slug, alphabetical: 32 × 31 / 2 = 496. */
function statchasers_matchup_all_slugs(): array {
	$slugs = array_keys( statchasers_team_table() );
	sort( $slugs, SORT_STRING );
	$pairs = array();
	$n     = count( $slugs );
	for ( $i = 0; $i < $n; $i++ ) {
		for ( $j = $i + 1; $j < $n; $j++ ) {
			$pairs[] = $slugs[ $i ] . '-vs-' . $slugs[ $j ];
		}
	}
	return $pairs;
}

/** How long the game index is kept; a game joins the list when the pair's page moves on, so an hour is plenty. */
const STATCHASERS_MATCHUP_GAMES_TTL = HOUR_IN_SECONDS;
/** After a failed fetch, how long the last good list is served without asking again. */
const STATCHASERS_MATCHUP_GAMES_RETRY = 10 * MINUTE_IN_SECONDS;

/**
 * Every dated game page canonical at its own address - this season by the
 * ownership rule, the whole of the season before as archives - from the
 * API's /embed/matchup-games.json (lib/matchup/game-index.ts), as
 * `[ [ 'pair-slug', '2026-week-2', '2026-09-30' ], ... ]`, the third value
 * the page's lastmod: the day the stored stats were last pulled (a stat
 * correction moves it), else the kickoff.
 *
 * The API applies the one rule that decides when a dated address is canonical
 * (the pair's page owns this season's latest result until the rematch is
 * within six days), so the plugin keeps no copy of it. Cached an hour with a
 * backup, like the roster: a sitemap request must never wait on the API, and
 * a failed fetch serves the last list.
 *
 * @return array<int,array{0:string,1:string,2:string}>
 */
function statchasers_matchup_games(): array {
	$key    = 'sc_matchup_games';
	$cached = get_transient( $key );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$backup = get_transient( $key . '_bak' );
	if ( get_transient( $key . '_fail' ) ) {
		return is_array( $backup ) ? $backup : array();
	}

	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return is_array( $backup ) ? $backup : array();
	}

	$response = wp_remote_get(
		$origin . '/embed/matchup-games.json',
		array(
			'timeout' => 8,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	$body = is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response )
		? null
		: json_decode( (string) wp_remote_retrieve_body( $response ), true );

	$rows = statchasers_matchup_games_rows( is_array( $body ) ? $body : array() );
	if ( null === $rows ) {
		set_transient( $key . '_fail', 1, STATCHASERS_MATCHUP_GAMES_RETRY );
		return is_array( $backup ) ? $backup : array();
	}

	set_transient( $key, $rows, STATCHASERS_MATCHUP_GAMES_TTL );
	set_transient( $key . '_bak', $rows, WEEK_IN_SECONDS );

	// A new game joined (or one left): Rank Math's copy of /game-sitemap.xml
	// is a file it rebuilds only when told, and nothing else tells it about
	// addresses that have no post behind them.
	if ( ! is_array( $backup ) || $backup !== $rows ) {
		statchasers_matchup_games_invalidate_sitemap();
	}
	return $rows;
}

/** The Rank Math sitemap type the game pages are published under: /game-sitemap.xml. */
const STATCHASERS_MATCHUP_SITEMAP_TYPE = 'game';

/** Drop Rank Math's cached /game-sitemap.xml so the next request rebuilds it. */
function statchasers_matchup_games_invalidate_sitemap(): void {
	if ( class_exists( '\RankMath\Sitemap\Cache' ) && method_exists( '\RankMath\Sitemap\Cache', 'invalidate_storage' ) ) {
		\RankMath\Sitemap\Cache::invalidate_storage( STATCHASERS_MATCHUP_SITEMAP_TYPE );
	}
}

/**
 * The index's rows, validated, or null for a body that is not the index.
 *
 * An empty `games` list is a valid answer (the first fortnight of a season);
 * a body with no `ok` or no list is not, and must not replace the backup.
 *
 * @param array<string,mixed> $body Decoded JSON.
 * @return array<int,array{0:string,1:string,2:string}>|null
 */
function statchasers_matchup_games_rows( array $body ): ?array {
	if ( empty( $body['ok'] ) || ! isset( $body['games'] ) || ! is_array( $body['games'] ) ) {
		return null;
	}
	$rows = array();
	foreach ( $body['games'] as $game ) {
		if ( ! is_array( $game ) ) {
			continue;
		}
		$pair    = (string) ( $game['pair'] ?? '' );
		$segment = (string) ( $game['game'] ?? '' );
		// The last stat pull when the API sends one (1.10.38), the kickoff before.
		$modified = (string) ( $game['modified'] ?? $game['kickoff'] ?? '' );
		if ( ! preg_match( '/^[a-z0-9-]+-vs-[a-z0-9-]+$/', $pair ) || ! preg_match( '/^' . STATCHASERS_MATCHUP_GAME_SHAPE . '$/', $segment ) ) {
			continue;
		}
		$rows[] = array( $pair, $segment, substr( $modified, 0, 10 ) );
	}
	return $rows;
}

/**
 * The dated game pages as Rank Math sitemap links: one per game, the day its
 * stats were last pulled as lastmod (the kickoff for a game whose stats are
 * not stored), newest first as the API lists them.
 *
 * @param array<int,array{0:string,1:string,2:string}> $games statchasers_matchup_games().
 * @return array<int,array{loc:string,mod?:string}>
 */
function statchasers_matchup_games_links( array $games ): array {
	$links = array();
	foreach ( $games as $row ) {
		$link = array( 'loc' => statchasers_matchup_url( $row[0], $row[1] ) );
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) ( $row[2] ?? '' ) ) ) {
			$link['mod'] = $row[2];
		}
		$links[] = $link;
	}
	return $links;
}

/**
 * The game sitemap's own address: Rank Math's base when it is loaded, so a
 * site that serves its sitemaps from a sub-directory gets the right one.
 *
 * @param int $page The sitemap page, 0 for the unnumbered first file.
 */
function statchasers_matchup_games_sitemap_url( int $page = 0 ): string {
	$file = STATCHASERS_MATCHUP_SITEMAP_TYPE . '-sitemap' . ( $page > 1 ? $page : '' ) . '.xml';
	if ( class_exists( '\RankMath\Sitemap\Router' ) && method_exists( '\RankMath\Sitemap\Router', 'get_base_url' ) ) {
		return (string) \RankMath\Sitemap\Router::get_base_url( $file );
	}
	return home_url( '/' . $file );
}

/**
 * The index entries for /game-sitemap.xml: one per page of games, none while
 * there are no games (the first fortnight of a season), so the index never
 * advertises an empty file. Pure, for the smoke test; the provider calls it.
 *
 * @param array<int,array{loc:string,mod?:string}> $links       statchasers_matchup_games_links().
 * @param int                                     $max_entries Rank Math's items-per-page setting.
 * @return array<int,array{loc:string,lastmod:string}>
 */
function statchasers_matchup_games_index_links( array $links, int $max_entries ): array {
	if ( ! $links ) {
		return array();
	}
	$per   = max( 1, $max_entries );
	$pages = (int) ceil( count( $links ) / $per );
	$index = array();
	for ( $n = 1; $n <= $pages; $n++ ) {
		$slice   = array_slice( $links, ( $n - 1 ) * $per, $per );
		$newest  = '';
		foreach ( $slice as $link ) {
			if ( isset( $link['mod'] ) && $link['mod'] > $newest ) {
				$newest = $link['mod'];
			}
		}
		$index[] = array(
			'loc'     => statchasers_matchup_games_sitemap_url( $n ),
			'lastmod' => $newest,
		);
	}
	return $index;
}

/**
 * The game pages' own sitemap, /game-sitemap.xml, in Rank Math's index
 * (mak, 2026-10-09: "add a sitemap for the game pages").
 *
 * Until 1.10.36 the dated pages sat in the page sitemap beside 4,300 other
 * URLs; a file of their own is the one a reader of the index can find, and
 * the one whose lastmod moves when a game is added. Rank Math takes outside
 * sitemaps through `rank_math/sitemap/providers`: an object with the three
 * Provider methods, which its router serves at `<type>-sitemap.xml` and
 * caches like its own (invalidated above when the list changes). The class
 * is declared inside the filter because the interface it implements exists
 * only once Rank Math has loaded.
 */
add_filter(
	'rank_math/sitemap/providers',
	static function ( $providers ) {
		if ( ! is_array( $providers ) || ! interface_exists( '\RankMath\Sitemap\Providers\Provider' ) ) {
			return $providers;
		}
		if ( ! statchasers_matchup_urls_enabled() ) {
			return $providers;
		}
		$holder = get_page_by_path( STATCHASERS_MATCHUP_HOLDER );
		if ( ! $holder instanceof WP_Post || 'publish' !== $holder->post_status ) {
			return $providers;
		}

		$providers[] = new class() implements \RankMath\Sitemap\Providers\Provider {
			/** @param string $type */
			public function handles_type( $type ) {
				return STATCHASERS_MATCHUP_SITEMAP_TYPE === $type;
			}

			/** @param int $max_entries */
			public function get_index_links( $max_entries ) {
				return statchasers_matchup_games_index_links(
					statchasers_matchup_games_links( statchasers_matchup_games() ),
					(int) $max_entries
				);
			}

			/**
			 * @param string $type
			 * @param int    $max_entries
			 * @param int    $current_page
			 */
			public function get_sitemap_links( $type, $max_entries, $current_page ) {
				$links = statchasers_matchup_games_links( statchasers_matchup_games() );
				$per   = max( 1, (int) $max_entries );
				$page  = max( 1, (int) $current_page );
				return array_slice( $links, ( $page - 1 ) * $per, $per );
			}
		};

		return $providers;
	}
);

add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}

		if ( ! statchasers_matchup_urls_enabled() ) {
			return $content;
		}
		$holder = get_page_by_path( STATCHASERS_MATCHUP_HOLDER );
		if ( ! $holder instanceof WP_Post || 'publish' !== $holder->post_status ) {
			return $content;
		}
		$extra = '';
		foreach ( statchasers_matchup_all_slugs() as $slug ) {
			$extra .= statchasers_team_sitemap_entry( statchasers_matchup_url( $slug ), '' );
		}
		// The dated game pages have a sitemap of their own since 1.10.36
		// (/game-sitemap.xml, the provider above), so they are not repeated here.
		return $content . $extra;
	}
);

/* ---------------------------------------------------------- holder page */

/**
 * The page the holder hangs off: whatever STATCHASERS_MATCHUP_HOLDER's own
 * parent path is, which is `nfl` - a SIBLING of the hubs' `nfl/teams`.
 *
 * @param bool $create Whether to create missing segments.
 */
function statchasers_matchup_container( bool $create = false ): int {
	$parent = trim( dirname( STATCHASERS_MATCHUP_HOLDER ), '/.' );
	if ( '' === $parent ) {
		return 0;
	}
	return statchasers_team_path_container( $parent, $create );
}

/**
 * A holder page that exists but sits at the wrong address, or 0.
 *
 * The bug this repairs: this function's caller used to resolve its parent with
 * statchasers_team_container(), which is the HUBS' container - `nfl/teams` -
 * so the page it built landed at `/nfl/teams/matchup/` while every other line
 * in this file addresses it as `nfl/matchup`. Nothing complained, and the two
 * halves failed in opposite directions:
 *
 *   - The Tools panel asks get_page_by_path( 'nfl/matchup' ), got null, and
 *     kept offering "Create the holder page".
 *   - The builder asks for the segment under the teams container, found the
 *     page it made last time, and returned "Done" without creating anything.
 *     Pressing the button again did nothing, forever.
 *   - Every pair URL rewrote to `pagename=nfl/matchup`, which resolves to no
 *     page, so WordPress 404'd it - and then, because WP_Query reduces an
 *     unresolved `pagename` to its last segment as `name`, redirect_canonical's
 *     404 guess matched the stray page by slug and sent the reader to
 *     `/nfl/teams/matchup/`. Which is the holder, at its own address, with no
 *     pair in the query - so it printed the "this page is the holder" notice.
 *     That is the whole of the "View matchup goes nowhere" report.
 *
 * Scoped to the hubs' container rather than "any page called matchup", because
 * that is the one place the old code could have put it, and re-parenting a page
 * someone else made is not this function's business.
 */
function statchasers_matchup_stray_holder(): int {
	$teams = statchasers_team_container( false );
	if ( ! $teams ) {
		return 0;
	}
	$id = statchasers_team_find_page( basename( STATCHASERS_MATCHUP_HOLDER ), $teams );
	if ( ! $id ) {
		return 0;
	}
	// Ours only: the shortcode is the signature. A page someone made by hand at
	// that address keeps it.
	$post = get_post( $id );
	if ( ! $post instanceof WP_Post || ! has_shortcode( (string) $post->post_content, STATCHASERS_MATCHUP_SHORTCODE ) ) {
		return 0;
	}
	return $id;
}

/**
 * Create the holder page under the /nfl/ container, once - or move one that an
 * earlier version of this file built in the wrong place. Called from the Tools
 * screen. Noindex by its own stored robots value: nothing should ever rank at
 * /nfl/matchup/ itself.
 *
 * @return int Page id, or 0 with an error message in $error.
 */
function statchasers_matchup_build_holder( string &$error ): int {
	$container = statchasers_matchup_container( true );
	if ( ! $container ) {
		// Plain text: the Tools screen escapes it on the way out.
		$error = 'Could not create the /' . trim( dirname( STATCHASERS_MATCHUP_HOLDER ), '/.' ) . '/ container page.';
		return 0;
	}
	$segment = basename( STATCHASERS_MATCHUP_HOLDER );
	$id      = statchasers_team_find_page( $segment, $container );
	if ( $id ) {
		statchasers_matchup_flush();
		return $id;
	}

	// Move rather than make a second one: the stray page is this plugin's, and
	// leaving it behind means two pages carrying the shortcode and a leftover
	// address that the 404 guess can still reach.
	$stray = statchasers_matchup_stray_holder();
	if ( $stray ) {
		$moved = wp_update_post(
			array(
				'ID'          => $stray,
				'post_parent' => $container,
				'post_name'   => $segment,
			),
			true
		);
		if ( is_wp_error( $moved ) ) {
			$error = $moved->get_error_message();
			return 0;
		}
		statchasers_team_fill_meta( $stray, 'rank_math_robots', array( 'noindex', 'follow' ) );
		statchasers_matchup_flush();
		return $stray;
	}

	$id = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => 'NFL Matchups',
			'post_name'    => $segment,
			'post_parent'  => $container,
			'post_content' => '[' . STATCHASERS_MATCHUP_SHORTCODE . ']',
		),
		true
	);
	if ( is_wp_error( $id ) ) {
		$error = $id->get_error_message();
		return 0;
	}
	statchasers_team_fill_meta( (int) $id, 'rank_math_robots', array( 'noindex', 'follow' ) );
	statchasers_matchup_flush();
	return (int) $id;
}

/**
 * Rebuild the rewrite rules after the holder moves.
 *
 * The rules themselves do not change - they name the holder by path, and the
 * path is a constant - but what they resolve TO only exists once the page is
 * where the path says. Flushing here means the pair URLs work on the redirect
 * back to the Tools screen rather than on the next plugin activation, which is
 * what "the permalink flush happens on activation" quietly cost.
 */
function statchasers_matchup_flush(): void {
	flush_rewrite_rules( false );
}

add_action(
	'admin_init',
	static function (): void {
		if ( ! isset( $_POST['statchasers_matchup_build'] ) ) {
			return;
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to do this.' );
		}
		check_admin_referer( 'statchasers_matchup_build' );
		$error = '';
		$id    = statchasers_matchup_build_holder( $error );
		set_transient( 'statchasers_matchup_build_result', array( 'id' => $id, 'error' => $error ), MINUTE_IN_SECONDS );
		wp_safe_redirect( add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) ) );
		exit;
	}
);

/**
 * A nudge on any admin screen while the pair URLs cannot resolve.
 *
 * Same shape and the same argument as the team-pages notice: the holder is the
 * one page that makes 496 addresses exist, and its absence is invisible from
 * the front end except as a matchup link that lands on the wrong page. Nobody
 * goes looking on the Tools screen for a problem they have not been told about,
 * which is how a holder at the wrong address survived a deploy.
 *
 * Suppressed on the Tools screen itself, where the panel says more.
 */
add_action(
	'admin_notices',
	static function (): void {
		if ( ! current_user_can( 'manage_options' ) || ! statchasers_matchup_urls_enabled() ) {
			return;
		}

		$screen = get_current_screen();
		if ( $screen && false !== strpos( (string) $screen->id, STATCHASERS_TEAM_PAGES_SCREEN ) ) {
			return;
		}

		$holder = get_page_by_path( STATCHASERS_MATCHUP_HOLDER );
		if ( $holder instanceof WP_Post && 'publish' === $holder->post_status ) {
			return;
		}

		$stray = statchasers_matchup_stray_holder();

		printf(
			'<div class="notice notice-warning"><p><strong>StatChasers:</strong> the matchup holder page is %1$s, so every <code>/%2$s/&lt;team&gt;-vs-&lt;team&gt;/</code> URL - and every &ldquo;View matchup&rdquo; link on the 32 team hubs - fails to resolve. <a href="%3$s">%4$s</a>.</p></div>',
			$stray ? 'at the wrong address' : 'missing',
			esc_html( STATCHASERS_MATCHUP_BASE ),
			esc_url( add_query_arg( 'page', STATCHASERS_TEAM_PAGES_SCREEN, admin_url( 'tools.php' ) ) ),
			$stray ? 'Move it' : 'Create it'
		);
	}
);

/** The panel on the Tools screen. */
function statchasers_matchup_panel(): void {
	$result = get_transient( 'statchasers_matchup_build_result' );
	if ( is_array( $result ) ) {
		delete_transient( 'statchasers_matchup_build_result' );
		if ( $result['id'] ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p><strong>Done.</strong> The matchup holder is at <code>/%s/</code> and the permalinks have been rebuilt. Open any <code>View matchup</code> link to check it.</p></div>',
				esc_html( STATCHASERS_MATCHUP_HOLDER )
			);
		} else {
			printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( (string) $result['error'] ) );
		}
	}

	$holder = get_page_by_path( STATCHASERS_MATCHUP_HOLDER );
	echo '<h2>Matchup pages</h2>';
	printf(
		'<p>Every pair of teams has one page at <code>/%s/&lt;team&gt;-vs-&lt;team&gt;/</code> - 496 addresses served by one holder page at <code>/%s/</code>, which is noindex itself. The pair URLs are live as soon as the holder exists at that exact path - the button below also rebuilds the permalinks, so there is nothing to do afterwards.</p>',
		esc_html( STATCHASERS_MATCHUP_BASE ),
		esc_html( STATCHASERS_MATCHUP_HOLDER )
	);
	if ( $holder instanceof WP_Post ) {
		printf(
			'<p><strong>Holder page exists</strong> (post %d) &middot; pair URLs are <strong>%s</strong>.</p>',
			(int) $holder->ID,
			statchasers_matchup_urls_enabled() ? 'on' : 'off'
		);
		return;
	}

	// The wrong-address case gets its own words. Told only "the holder does not
	// exist", the obvious move is to press Create - which is exactly what an
	// earlier version of this plugin let you do over and over while the page
	// sat one level too deep and every pair URL bounced to it. See
	// statchasers_matchup_stray_holder().
	$stray = statchasers_matchup_stray_holder();
	if ( $stray ) {
		printf(
			'<div class="notice notice-warning inline"><p><strong>The holder page is at the wrong address.</strong> ' .
			'Post %1$d sits at <code>%2$s</code>, one level too deep, so every ' .
			'<code>/%3$s/&lt;team&gt;-vs-&lt;team&gt;/</code> URL fails to resolve and WordPress bounces the reader to the holder itself. ' .
			'Moving it to <code>/%4$s/</code> fixes every pair URL at once; nothing else about the page changes.</p></div>',
			(int) $stray,
			esc_html( (string) wp_parse_url( (string) get_permalink( $stray ), PHP_URL_PATH ) ),
			esc_html( STATCHASERS_MATCHUP_BASE ),
			esc_html( STATCHASERS_MATCHUP_HOLDER )
		);
	}

	echo '<form method="post">';
	wp_nonce_field( 'statchasers_matchup_build' );
	printf(
		'<p><button type="submit" name="statchasers_matchup_build" value="1" class="button button-primary">%s</button></p>',
		$stray ? 'Move the holder page' : 'Create the holder page'
	);
	echo '</form>';
}
