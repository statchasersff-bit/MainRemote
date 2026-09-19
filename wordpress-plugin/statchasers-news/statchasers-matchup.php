<?php
/**
 * NFL matchup pages: /nfl/<team-a>-vs-<team-b>/.
 *
 * One evergreen page per pair of teams — 496 of them — with no post behind any
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

const STATCHASERS_MATCHUP_CACHE_TTL  = 5 * MINUTE_IN_SECONDS;
const STATCHASERS_MATCHUP_BACKUP_TTL = DAY_IN_SECONDS;
const STATCHASERS_MATCHUP_TIMEOUT    = 8;

/**
 * Whether the pair URLs are live. Off by default.
 *
 *     add_filter( 'statchasers_matchup_urls', '__return_true' );
 *
 * Then flush permalinks once. Same shape as the team section switch, and like
 * it, the sitemap entries move with the same flag so the sitemap can never
 * advertise an address the rewrite does not serve.
 */
function statchasers_matchup_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_matchup_urls', false );
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

/** The canonical public URL of a pair. */
function statchasers_matchup_url( string $slug ): string {
	return user_trailingslashit( home_url( '/' . STATCHASERS_MATCHUP_BASE . '/' . $slug ) );
}

/**
 * The reversed spelling is a 301, and a segment that is not a pair is a 404 —
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
			wp_safe_redirect( statchasers_matchup_url( $pair['slug'] ), 301 );
			exit;
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
function statchasers_matchup_fetch( string $slug ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin || '' === $slug ) {
		return null;
	}

	$key        = md5( $origin . '|matchup|' . $slug );
	$cache_key  = 'sc_matchup_ssr_' . $key;
	$backup_key = 'sc_matchup_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return $cached;
	}

	$response = wp_remote_get(
		$origin . '/embed/matchup/' . rawurlencode( $slug ),
		array(
			'timeout' => STATCHASERS_MATCHUP_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
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

	$data = statchasers_matchup_fetch( $pair['slug'] );
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
	return (string) apply_filters( 'statchasers_matchup_fragment_html', (string) $data['html'], $pair['slug'] );
}
add_shortcode( STATCHASERS_MATCHUP_SHORTCODE, 'statchasers_matchup_shortcode' );

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
 * Title and description for a pair, in a state.
 *
 * MIRRORS matchupPageMeta() in the API's src/lib/matchup/matchup-seo.ts.
 * Change one and change the other.
 *
 * @return array{title:string,description:string}
 */
function statchasers_matchup_meta( string $a, string $b, string $state, string $season, string $score = '' ): array {
	$table  = statchasers_team_table();
	$name_a = $table[ $a ][0] ?? $a;
	$name_b = $table[ $b ][0] ?? $b;
	$nick_a = substr( strrchr( ' ' . $name_a, ' ' ), 1 );
	$nick_b = substr( strrchr( ' ' . $name_b, ' ' ), 1 );
	$names  = $name_a . ' vs ' . $name_b;
	$season = '' === $season ? STATCHASERS_TEAM_SEASON : $season;

	switch ( $state ) {
		case 'upcoming':
			return array(
				'title'       => sprintf( '%s %s: Where to Watch, Stats, Injuries & History', $names, $season ),
				'description' => sprintf( '%1$s vs %2$s in %3$s: kickoff time, TV, venue, team stats side by side, injury designations and the head-to-head record.', $nick_a, $nick_b, $season ),
			);
		case 'recently_completed':
			// The score leads the description when the API sent one, exactly as
			// matchupScoreLine() wrote it. Absent header, same sentence without it.
			$lead = '' === trim( $score ) ? '' : trim( $score ) . ' ';
			return array(
				'title'       => sprintf( '%s %s: Score, Player Stats & Fantasy Recap', $names, $season ),
				'description' => sprintf( '%1$s%2$s vs %3$s %4$s final score, quarter-by-quarter scoring, full player stats and the fantasy takeaways from the game.', $lead, $nick_a, $nick_b, $season ),
			);
	}
	return array(
		'title'       => sprintf( '%s: Head-to-Head Record, Stats & History', $names ),
		'description' => sprintf( '%1$s vs %2$s: the regular-season head-to-head record, recent meetings, and %3$s team stats side by side.', $nick_a, $nick_b, $season ),
	);
}

/** This request's metadata, or null off a matchup URL. */
function statchasers_matchup_request_meta(): ?array {
	$pair = statchasers_matchup_current();
	if ( null === $pair || ! $pair['canonical'] ) {
		return null;
	}
	$data = statchasers_matchup_fetch( $pair['slug'] );
	return statchasers_matchup_meta(
		$pair['a'],
		$pair['b'],
		(string) ( $data['state'] ?? '' ),
		(string) ( $data['season'] ?? '' ),
		(string) ( $data['score'] ?? '' )
	);
}

function statchasers_matchup_canonical(): string {
	$pair = statchasers_matchup_current();
	return null === $pair ? '' : statchasers_matchup_url( $pair['slug'] );
}

add_filter( 'rank_math/frontend/title', function ( $title ) {
	$meta = statchasers_matchup_request_meta();
	return $meta ? $meta['title'] . ' | StatChasers' : $title;
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
		$parts['title'] = $meta['title'];
	}
	return $parts;
} );
add_filter( 'get_canonical_url', function ( $canonical ) {
	$url = statchasers_matchup_canonical();
	return '' === $url ? $canonical : $url;
} );

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

add_filter(
	'rank_math/sitemap/page_content',
	function ( $content ) {
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
		return $content . $extra;
	}
);

/* ---------------------------------------------------------- holder page */

/**
 * Create the holder page under the /nfl/ container, once. Called from the
 * Tools screen. Noindex by its own stored robots value: nothing should ever
 * rank at /nfl/matchup/ itself.
 *
 * @return int Page id, or 0 with an error message in $error.
 */
function statchasers_matchup_build_holder( string &$error ): int {
	$container = statchasers_team_container( true );
	if ( ! $container ) {
		$error = 'Could not create the /nfl/ container page.';
		return 0;
	}
	$segment = basename( STATCHASERS_MATCHUP_HOLDER );
	$id      = statchasers_team_find_page( $segment, $container );
	if ( $id ) {
		return $id;
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
	return (int) $id;
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

/** The panel on the Tools screen. */
function statchasers_matchup_panel(): void {
	$result = get_transient( 'statchasers_matchup_build_result' );
	if ( is_array( $result ) ) {
		delete_transient( 'statchasers_matchup_build_result' );
		if ( $result['id'] ) {
			echo '<div class="notice notice-success is-dismissible"><p><strong>Done.</strong> Matchup holder page is in place.</p></div>';
		} else {
			printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( (string) $result['error'] ) );
		}
	}

	$holder = get_page_by_path( STATCHASERS_MATCHUP_HOLDER );
	echo '<h2>Matchup pages</h2>';
	printf(
		'<p>Every pair of teams has one page at <code>/%s/&lt;team&gt;-vs-&lt;team&gt;/</code> — 496 addresses served by one holder page at <code>/%s/</code>, which is noindex itself. The pair URLs go live with <code>add_filter( \'statchasers_matchup_urls\', \'__return_true\' )</code> and a permalink flush.</p>',
		esc_html( STATCHASERS_MATCHUP_BASE ),
		esc_html( STATCHASERS_MATCHUP_HOLDER )
	);
	if ( $holder instanceof WP_Post ) {
		printf(
			'<p><strong>Holder page exists</strong> (post %d) &middot; pair URLs are <strong>%s</strong>.</p>',
			(int) $holder->ID,
			statchasers_matchup_urls_enabled() ? 'on' : 'off'
		);
	} else {
		echo '<form method="post">';
		wp_nonce_field( 'statchasers_matchup_build' );
		echo '<p><button type="submit" name="statchasers_matchup_build" value="1" class="button button-primary">Create the holder page</button></p>';
		echo '</form>';
	}
}
