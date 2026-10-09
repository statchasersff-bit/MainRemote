<?php
/**
 * The strength of schedule shortcode: [statchasers_strength_of_schedule]
 *
 * Same posture as the other tools. The API serves /strength-of-schedule with
 * `noindex, indexifembedded`, so the board is invisible to search until
 * something embeds it - this file is that something.
 *
 * ## What this replaces
 *
 * The tool shipped as a standalone Vite app in its own repository
 * (statchasersff-bit/Strength-of-Schedule-SOS) and its own plugin, "StatChasers
 * Strength of Schedule" (`statchasers-sos`), which mounted it with the
 * shortcode [statchasers_sos]. That plugin shipped a June snapshot of the data
 * inside itself, printed a server-rendered copy of it, and then had its React
 * bundle attach a Shadow DOM over the top and draw the board again.
 *
 * Here the API computes the board from the live FPA table and the season's
 * schedule, renders it, and this shortcode prints it into the page like the
 * other tools. Every team's weekly opponents, every aFPA and every rank are in
 * the page's HTML; the bundle sorts, switches views and exports on top of it.
 *
 * Migrating: on /nfl/fantasy-football-strength-of-schedule/, replace
 * [statchasers_sos] with [statchasers_strength_of_schedule], then deactivate
 * and delete the old "StatChasers Strength of Schedule" plugin. The tags do not
 * collide, so the two can coexist while the swap is made - but the old plugin
 * sets its own title, description, canonical and schema on the page it mounts
 * on, and those filters fight the ones below, so do not leave both on one page.
 *
 * ## Addresses
 *
 * Six, since 1.10.35 (mak's spec of 2026-10-09, "Strength of schedule: one
 * real page per position"): the page itself is the overview, and beneath it
 * `/qb/`, `/rb/`, `/wr/`, `/te/` and `/playoffs/` are pages of their own, each
 * with its own title, H1, description and self-canonical, each in the sitemap.
 * They are rewrite rules onto the one WordPress page (`sc_sos_page`), the way
 * the rest-of-season rankings' position addresses are (statchasers-rankings.php),
 * so there is one post and one shortcode to keep.
 *
 * The tab (Team or Player SOS) and the scoring format stay in the query string
 * - `?tab=player&scoring=half-ppr` - so a view can be shared, and this file
 * reads them to print the right board with scripting off. They are NOT
 * registered query vars, and they are read only on the page that mounts the
 * shortcode. They never move the canonical. `?pos=rb`, the old spelling of a
 * position, 301s to `/rb/`.
 *
 * @package StatChasers\News
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const STATCHASERS_SOS_SHORTCODE = 'statchasers_strength_of_schedule';
const STATCHASERS_SOS_HANDLE    = 'statchasers-sos';

/**
 * How long a rendered fragment is reused before we ask the API again. An hour:
 * the board moves when the FPA table does, which is once a week in season.
 * `statchasers_news_flush()` clears this.
 */
const STATCHASERS_SOS_CACHE_TTL = HOUR_IN_SECONDS;

/** How long the last good render is kept as a fallback when the API is down. */
const STATCHASERS_SOS_BACKUP_TTL = 30 * DAY_IN_SECONDS;

/** Seconds to wait on the API before giving up. */
const STATCHASERS_SOS_TIMEOUT = 8;

/**
 * The views the API renders, each list's first entry being its default. The
 * whitelist is the cache bound too: every accepted value is its own transient
 * and its own origin fetch, so nothing outside these lists reaches either.
 */
const STATCHASERS_SOS_VIEWS = array(
	'tab'     => array( 'team', 'player' ),
	'pos'     => array( 'rb', 'qb', 'wr', 'te' ),
	'scoring' => array( 'ppr', 'half-ppr', 'std' ),
);

/** The five sub-pages, in the order the controls list them. */
const STATCHASERS_SOS_PAGES = array( 'qb', 'rb', 'wr', 'te', 'playoffs' );

/**
 * Each sub-page's words (mak's spec of 2026-10-09), the fallback when the API
 * is older than the island that carries them. The API's copy wins when it is
 * there, so the season in the titles lives in one place; `%d` is the season.
 */
const STATCHASERS_SOS_PAGE_COPY = array(
	'qb'       => array(
		'title'       => 'QB Strength of Schedule %d: Fantasy Matchups',
		'h1'          => 'QB Strength of Schedule',
		'description' => 'Fantasy QB strength of schedule for %d: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed. Updated weekly.',
	),
	'rb'       => array(
		'title'       => 'RB Strength of Schedule %d: Fantasy Matchups',
		'h1'          => 'RB Strength of Schedule',
		'description' => 'Fantasy RB strength of schedule for %d: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to running backs.',
	),
	'wr'       => array(
		'title'       => 'WR Strength of Schedule %d: Fantasy Matchups',
		'h1'          => 'WR Strength of Schedule',
		'description' => 'Fantasy WR strength of schedule for %d: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to wide receivers.',
	),
	'te'       => array(
		'title'       => 'TE Strength of Schedule %d: Fantasy Matchups',
		'h1'          => 'TE Strength of Schedule',
		'description' => 'Fantasy TE strength of schedule for %d: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to tight ends.',
	),
	'playoffs' => array(
		'title'       => 'Fantasy Playoff Strength of Schedule (Weeks 15–17)',
		'h1'          => 'Fantasy Playoff Strength of Schedule',
		'description' => 'Which teams have the easiest fantasy playoff schedule? Weeks 15–17 strength of schedule for QB, RB, WR and TE, for all 32 teams.',
	),
);

/* -------------------------------------------------------------- the pages */

/**
 * The SOS page's path, no leading or trailing slash: where the overview lives
 * and what the five sub-page rules hang off. Filterable for a site that
 * mounts the board somewhere else.
 */
function statchasers_sos_page_path(): string {
	$path = (string) apply_filters(
		'statchasers_sos_page_path',
		'nfl/fantasy-football-strength-of-schedule'
	);
	return trim( $path, '/' );
}

/**
 * Whether the sub-page addresses are live. On by default.
 *
 *     add_filter( 'statchasers_sos_page_urls', '__return_false' );
 *
 * Off, the page is one address again, the controls' links 404 and `?pos=`
 * is read as it was before 1.10.35.
 */
function statchasers_sos_page_urls_enabled(): bool {
	return (bool) apply_filters( 'statchasers_sos_page_urls', true );
}

/** A sub-page's public address, or the overview's for anything else. */
function statchasers_sos_page_url( string $page ): string {
	$path = '/' . statchasers_sos_page_path();
	if ( in_array( $page, STATCHASERS_SOS_PAGES, true ) ) {
		$path .= '/' . $page;
	}
	return user_trailingslashit( home_url( $path ) );
}

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'sc_sos_page';
		return $vars;
	}
);

add_action(
	'init',
	static function (): void {
		if ( ! statchasers_sos_page_urls_enabled() ) {
			return;
		}
		$page = statchasers_sos_page_path();
		if ( '' === $page ) {
			return;
		}
		// The page itself is resolved by pagename, exactly as WordPress would
		// have resolved the bare address; only sc_sos_page is added. No new
		// post, no template, nothing for an editor to keep in sync.
		$rule = '^' . preg_quote( $page, '#' ) . '/(' . implode( '|', STATCHASERS_SOS_PAGES ) . ')/?$';
		add_rewrite_rule(
			$rule,
			'index.php?pagename=' . $page . '&sc_sos_page=$matches[1]',
			'top'
		);

		// A new rule is dead until the rule table is rebuilt, and an upgrade
		// does not run the activation hook that asks for that. Same remedy as
		// the rankings and matchup rules: remember the rule's signature and ask
		// for the flush that statchasers-news.php performs at the end of `init`.
		$signature = md5( $rule );
		if ( get_option( 'statchasers_sos_rules' ) !== $signature ) {
			update_option( 'statchasers_sos_rules', $signature, false );
			update_option( 'statchasers_needs_flush', 1, false );
		}
	}
);

/**
 * The sub-page this request's address names, or '' on the overview and off
 * the SOS page altogether. The query var is public, so without the page guard
 * `?sc_sos_page=rb` on any article would retitle it as the RB page.
 */
function statchasers_sos_request_page(): string {
	if ( ! statchasers_sos_page_urls_enabled() || ! statchasers_sos_post_has_shortcode() ) {
		return '';
	}
	$raw = strtolower( trim( (string) get_query_var( 'sc_sos_page' ) ) );
	return in_array( $raw, STATCHASERS_SOS_PAGES, true ) ? $raw : '';
}

/**
 * Where `?pos=` sends a request, or '' when it stays put: the position's own
 * page, with the rest of the query along minus the defaults (`tab=team`,
 * `scoring=ppr`), so `?tab=team&pos=rb` lands on a clean `/rb/`. Pure, for
 * the smoke test; the redirect below calls it.
 *
 * @param array<string,mixed> $get  The request's query ($_GET).
 * @param string              $page The sub-page the address already names, or ''.
 */
function statchasers_sos_redirect_target( array $get, string $page ): string {
	if ( ! isset( $get['pos'] ) ) {
		return '';
	}
	$pos = statchasers_sos_clean( 'pos', $get['pos'] );
	// A position the board lacks goes to the page the address already names,
	// or the overview: the bad parameter is dropped either way.
	$target = '' !== $pos ? $pos : $page;

	$keep = array();
	foreach ( $get as $key => $value ) {
		if ( 'pos' === $key || 'sc_sos_page' === $key || ! is_scalar( $value ) ) {
			continue;
		}
		$clean = strtolower( trim( (string) $value ) );
		if ( 'tab' === $key && ( 'team' === $clean || '' === $clean ) ) {
			continue;
		}
		if ( 'scoring' === $key && ( 'ppr' === $clean || '' === $clean ) ) {
			continue;
		}
		$keep[ (string) $key ] = (string) $value;
	}

	$url = statchasers_sos_page_url( $target );
	return $keep ? add_query_arg( $keep, $url ) : $url;
}

/**
 * `?pos=rb` is the RB page's address: 301 there, before anything renders, so
 * the old spelling is never an indexable copy of the new page.
 */
function statchasers_sos_pos_redirect(): void {
	if ( ! statchasers_sos_page_urls_enabled() || ! statchasers_sos_post_has_shortcode() ) {
		return;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a read-only redirect.
	$target = statchasers_sos_redirect_target( wp_unslash( $_GET ), statchasers_sos_request_page() );
	if ( '' === $target ) {
		return;
	}
	wp_safe_redirect( $target, 301 );
	exit;
}
add_action( 'template_redirect', 'statchasers_sos_pos_redirect', 9 );

/* ------------------------------------------------------------- the view */

/**
 * One view value, validated: lower-cased, trimmed, and only if it is on the
 * list. Anything else is ''.
 *
 * @param string $key   'tab', 'pos' or 'scoring'.
 * @param mixed  $value The raw value.
 */
function statchasers_sos_clean( string $key, $value ): string {
	if ( ! isset( STATCHASERS_SOS_VIEWS[ $key ] ) || ! is_scalar( $value ) ) {
		return '';
	}
	$value = strtolower( trim( sanitize_text_field( (string) $value ) ) );
	return in_array( $value, STATCHASERS_SOS_VIEWS[ $key ], true ) ? $value : '';
}

/**
 * The view the page's query string asks for, key by key, '' where it asks for
 * nothing usable. Read only on the page that mounts the board: the three names
 * are ordinary words, and an article at `?pos=wr` is not asking for anything.
 *
 * @return array{tab:string,pos:string,scoring:string}
 */
function statchasers_sos_query_view(): array {
	$view = array(
		'tab'     => '',
		'pos'     => '',
		'scoring' => '',
	);

	if ( ! statchasers_sos_post_has_shortcode() ) {
		return $view;
	}

	foreach ( array_keys( $view ) as $key ) {
		// With the sub-pages on, the position is the address's, never the
		// query's: `?pos=` redirects (statchasers_sos_pos_redirect) and so
		// is never printed from.
		if ( 'pos' === $key && statchasers_sos_page_urls_enabled() ) {
			continue;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
		if ( isset( $_GET[ $key ] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display state, read-only.
			$view[ $key ] = statchasers_sos_clean( $key, wp_unslash( $_GET[ $key ] ) );
		}
	}

	return $view;
}

/**
 * The view to print: the page's query string first, because it IS the view the
 * reader shared or bookmarked; then the shortcode attribute, which is the
 * page's default; then the tool's own default.
 *
 * @param array<string,mixed> $atts Raw shortcode attributes.
 * @return array{tab:string,pos:string,scoring:string}
 */
function statchasers_sos_args( array $atts ): array {
	$defaults = array();
	foreach ( STATCHASERS_SOS_VIEWS as $key => $allowed ) {
		$defaults[ $key ] = $allowed[0];
	}

	$atts = shortcode_atts( $defaults, $atts, STATCHASERS_SOS_SHORTCODE );
	$from = statchasers_sos_query_view();

	$args = array();
	foreach ( $defaults as $key => $default ) {
		$given        = statchasers_sos_clean( $key, $atts[ $key ] );
		$args[ $key ] = '' !== $from[ $key ] ? $from[ $key ] : ( '' !== $given ? $given : $default );
	}

	// A sub-page's board is its own: /rb/ is the running backs whatever the
	// attribute says, and the playoffs page has no player half.
	$page = statchasers_sos_request_page();
	if ( in_array( $page, STATCHASERS_SOS_VIEWS['pos'], true ) ) {
		$args['pos'] = $page;
	} elseif ( 'playoffs' === $page ) {
		$args['tab'] = 'team';
	}

	return $args;
}

/* ------------------------------------------------------------- the fetch */

/**
 * Fetch the server-rendered fragment for one view, cached.
 *
 * @param array{tab:string,pos:string,scoring:string} $args The view.
 * @return array{html:string,version:string}|null Null when nothing is available.
 */
function statchasers_sos_fetch( array $args ): ?array {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return null;
	}

	$query = array(
		'tab'     => $args['tab'],
		'pos'     => $args['pos'],
		'scoring' => $args['scoring'],
	);
	// The sub-page's fragment: its own answer, Updated line, controls and
	// Related block (sos-render.ts). The overview sends nothing.
	$page = statchasers_sos_request_page();
	if ( '' !== $page ) {
		$query['page'] = $page;
	}

	$key        = md5( $origin . '|' . wp_json_encode( $query ) );
	$cache_key  = 'sc_sos_ssr_' . $key;
	$backup_key = 'sc_sos_ssr_bak_' . $key;

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['html'] ) ) {
		return '' === $cached['html'] ? null : $cached;
	}

	$response = wp_remote_get(
		add_query_arg( $query, $origin . '/embed/sos' ),
		array(
			'timeout' => STATCHASERS_SOS_TIMEOUT,
			'headers' => array( 'Accept' => 'text/html' ),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$body = is_wp_error( $response ) ? '' : (string) wp_remote_retrieve_body( $response );

	// A 404 means the API has nothing to build the board from (no FPA table
	// yet) - a real state, not a transient error. Cached as a failure for a
	// minute so a deployment mid-setup costs one request a minute.
	if ( 200 !== $code || '' === trim( $body ) ) {
		$backup = get_transient( $backup_key );
		if ( is_array( $backup ) && isset( $backup['html'] ) ) {
			// Held under the fresh key for a minute, so the next views do not
			// each retry the origin and wait out the timeout.
			set_transient( $cache_key, $backup, MINUTE_IN_SECONDS );
			return $backup;
		}
		set_transient( $cache_key, array( 'html' => '', 'version' => '' ), MINUTE_IN_SECONDS );
		return null;
	}

	$payload = array(
		'html'    => $body,
		'version' => trim( (string) wp_remote_retrieve_header( $response, 'etag' ) ),
	);

	set_transient( $cache_key, $payload, STATCHASERS_SOS_CACHE_TTL );
	set_transient( $backup_key, $payload, STATCHASERS_SOS_BACKUP_TTL );

	return $payload;
}

/* ---------------------------------------------------------------- assets */

/**
 * Register and enqueue the board's compiled bundles. Its own handles, like the
 * other tools: a page mounting this shortcode should not download another
 * tool's stylesheet.
 */
function statchasers_sos_enqueue_assets(): void {
	$origin = statchasers_news_origin();
	if ( '' === $origin ) {
		return;
	}

	$version = statchasers_news_asset_version();

	if ( ! wp_style_is( STATCHASERS_SOS_HANDLE, 'registered' ) ) {
		wp_register_style(
			STATCHASERS_SOS_HANDLE,
			statchasers_public_origin() . '/sos.css',
			statchasers_font_dependency(),
			$version
		);
	}

	if ( ! wp_script_is( STATCHASERS_SOS_HANDLE, 'registered' ) ) {
		wp_register_script(
			STATCHASERS_SOS_HANDLE,
			statchasers_public_origin() . '/dist/statchasers-sos.js',
			array(),
			$version,
			array(
				'strategy'  => 'defer',
				'in_footer' => true,
			)
		);
	}

	wp_enqueue_style( STATCHASERS_SOS_HANDLE );
	wp_enqueue_script( STATCHASERS_SOS_HANDLE );

	// Caps the board at the site's content width. The weekly grid is twenty
	// columns wide, and on a builder page without the cap it ran the window.
	if ( statchasers_sos_wants_full_width() ) {
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_team_full_width_css() );
	}

	// The grid's header row and first column are sticky, and must sit under
	// Divi's header; and a phone should not read the board through Divi's 10%
	// margins. See statchasers-team.php.
	if ( statchasers_team_is_divi() ) {
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_tool_header_layer_css() );
		wp_add_inline_style( STATCHASERS_SOS_HANDLE, statchasers_tool_mobile_gutter_css() );
	}
}

/**
 * Does the request being rendered mount the board?
 *
 * Reads get_queried_object() rather than get_post(), for the reason set out in
 * statchasers-team.php: Divi swaps the global post while rendering a Theme
 * Builder layout. Memoized for the same reason too.
 */
function statchasers_sos_post_has_shortcode(): bool {
	static $answer = null;

	if ( null !== $answer ) {
		return $answer;
	}

	if ( ! is_singular() ) {
		return false;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	$answer = has_shortcode( (string) $post->post_content, STATCHASERS_SOS_SHORTCODE );

	return $answer;
}

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( ! statchasers_sos_post_has_shortcode() ) {
			return;
		}
		statchasers_sos_enqueue_assets();
	}
);

/* ------------------------------------------------------------ divi layout */

/**
 * Does this page want Divi's full-width column? The CSS and the meta/body-class
 * filters are the team file's; only "does this page mount the tool" differs.
 */
function statchasers_sos_wants_full_width(): bool {
	if ( ! statchasers_team_is_divi() || ! statchasers_sos_post_has_shortcode() ) {
		return false;
	}

	/**
	 * Filters whether a page mounting the strength of schedule board takes the whole column.
	 *
	 * @param bool $full_width Whether to take the whole column.
	 */
	return (bool) apply_filters( 'statchasers_sos_full_width', true );
}

/**
 * Remove the sidebar markup on the SOS page.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_sos_force_full_width_meta( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	if ( (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	if ( ! statchasers_sos_wants_full_width() ) {
		return $value;
	}

	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_sos_force_full_width_meta', 10, 3 );

/**
 * The body class that goes with it.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_sos_full_width_body_class( array $classes ): array {
	if ( ! statchasers_sos_wants_full_width() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);

	if ( ! in_array( 'et_full_width_page', $classes, true ) ) {
		$classes[] = 'et_full_width_page';
	}

	return $classes;
}
add_filter( 'body_class', 'statchasers_sos_full_width_body_class', PHP_INT_MAX );

/* ------------------------------------------------------------ the shortcode */

/**
 * The shortcode: prints the server-rendered board into the page.
 *
 * Takes `tab`, `pos` and `scoring` as the page's default view; the query string
 * outranks them. Prints the page heading itself in tool mode, and nothing else
 * of the page's - its title, description and canonical come from the filters
 * below.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string HTML.
 */
function statchasers_sos_shortcode( $atts = array() ): string {
	$origin = statchasers_news_origin();

	if ( '' === $origin ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Strength of Schedule:</strong> set <code>STATCHASERS_NEWS_ORIGIN</code> in <code>wp-config.php</code> to the API origin.</p>';
		}
		return '';
	}

	$args = statchasers_sos_args( is_array( $atts ) ? $atts : array() );
	$data = statchasers_sos_fetch( $args );

	// Idempotent - covers widgets/templates that wp_enqueue_scripts missed.
	statchasers_sos_enqueue_assets();

	if ( null === $data || '' === $data['html'] ) {
		// No client-side render to fall back to: the bundle only enhances
		// markup that is already there. An empty string leaves the rest of the
		// page intact.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>StatChasers Strength of Schedule:</strong> the API returned nothing. Check that the deployment is up and that its FPA table has been ingested.</p>';
		}
		return '';
	}

	/**
	 * Filters the server-rendered strength of schedule fragment before it is printed.
	 *
	 * Deliberately not escaped, for the reason given on the news filter: this is
	 * first-party markup from the origin the page already loads its bundle from.
	 *
	 * @param string $html Rendered fragment.
	 * @param array  $args The view rendered: tab, pos, scoring.
	 */
	return statchasers_sos_shortcode_heading() . (string) apply_filters(
		'statchasers_sos_fragment_html',
		statchasers_sos_strip_islands( (string) $data['html'] ),
		$args
	);
}
add_shortcode( STATCHASERS_SOS_SHORTCODE, 'statchasers_sos_shortcode' );

/* -------------------------------------------------- titles and headings */

/**
 * The fetch this request's page prints, memoized: what the title filters and
 * the H1 read. The same view the shortcode resolves with no attributes, so on a
 * page whose shortcode carries none it is the same cached transient.
 *
 * @return array{html:string,version:string}|null
 */
function statchasers_sos_request_data(): ?array {
	static $data = false;

	if ( false !== $data ) {
		return $data;
	}

	$data = statchasers_sos_post_has_shortcode()
		? statchasers_sos_fetch( statchasers_sos_args( array() ) )
		: null;

	return $data;
}

/**
 * The page's title, H1 and description, as the API wrote them - every view
 * carries the same three, so which view was fetched does not matter.
 *
 * @return array{title?:string,h1?:string,description?:string}
 */
function statchasers_sos_page_copy(): array {
	static $copy = null;

	if ( null !== $copy ) {
		return $copy;
	}

	$data = statchasers_sos_request_data();
	$copy = statchasers_sos_parse_copy( null === $data ? '' : (string) $data['html'] );

	// An API older than the sub-pages answers with the overview's island (or
	// none); on a sub-page the spec's own words stand in, so the address, the
	// title and the H1 agree whatever the API's age.
	$page = statchasers_sos_request_page();
	if ( '' !== $page && ( ! isset( $copy['h1'] ) || STATCHASERS_SOS_PAGE_COPY[ $page ]['h1'] !== $copy['h1'] ) ) {
		$season = (int) gmdate( 'Y' );
		if ( null !== $data && preg_match( '/data-season="(\d{4})"/', (string) $data['html'], $m ) ) {
			$season = (int) $m[1];
		}
		$copy = array(
			'title'       => sprintf( STATCHASERS_SOS_PAGE_COPY[ $page ]['title'], $season ),
			'h1'          => STATCHASERS_SOS_PAGE_COPY[ $page ]['h1'],
			'description' => sprintf( STATCHASERS_SOS_PAGE_COPY[ $page ]['description'], $season ),
		);
	}

	return $copy;
}

/**
 * The title/H1/description/lead island out of a rendered fragment. Validated rather
 * than trusted: tags stripped, empty and unknown keys dropped.
 *
 * @param string $html Rendered fragment.
 * @return array{title?:string,h1?:string,description?:string,lead?:string}
 */
function statchasers_sos_parse_copy( string $html ): array {
	$copy = array();

	if ( '' === $html || ! preg_match( '#<script type="application/json" class="scsos-page-data">(.*?)</script>#s', $html, $m ) ) {
		return $copy;
	}

	$decoded = json_decode( $m[1], true );
	if ( ! is_array( $decoded ) ) {
		return $copy;
	}

	foreach ( array( 'title', 'h1', 'description', 'lead' ) as $key ) {
		if ( isset( $decoded[ $key ] ) && is_string( $decoded[ $key ] ) ) {
			$value = trim( wp_strip_all_tags( $decoded[ $key ] ) );
			if ( '' !== $value ) {
				$copy[ $key ] = $value;
			}
		}
	}

	return $copy;
}

/** The document title, or '' to leave the page's own. */
function statchasers_sos_title(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['title'] ) ? $copy['title'] : '';
}

/** The page's H1, or '' to leave the theme's. */
function statchasers_sos_h1(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['h1'] ) ? $copy['h1'] : '';
}

/**
 * The paragraph under the H1 (the old standalone plugin's hero copy, now the
 * island's "lead"), or '' when the fragment carries none.
 */
function statchasers_sos_lead(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['lead'] ) ? $copy['lead'] : '';
}

/** The meta description, or '' to leave the page's own. */
function statchasers_sos_description(): string {
	$copy = statchasers_sos_page_copy();
	return isset( $copy['description'] ) ? $copy['description'] : '';
}

/**
 * The page's canonical: the sub-page's address on one, else the bare
 * permalink, whatever view the query string asks for; '' off the SOS page.
 * Stated rather than left to Rank Math, because `?tab=&scoring=` is six
 * addresses for one board and none of them may become a canonical of its own.
 */
function statchasers_sos_canonical(): string {
	if ( ! statchasers_sos_post_has_shortcode() ) {
		return '';
	}
	// A sub-page is its own canonical: it is the page someone searching "RB
	// strength of schedule" should land on, which is the point of it.
	$page = statchasers_sos_request_page();
	if ( '' !== $page ) {
		return statchasers_sos_page_url( $page );
	}
	$id = get_queried_object_id();
	return $id ? (string) get_permalink( $id ) : '';
}

/**
 * The heading the shortcode prints itself, in the site's own hero markup.
 *
 * The player stats table's arrangement: "Let the tool supply the heading"
 * empties the theme's title on every tool page, and a tool that answers with
 * nothing leaves the page with no H1. Off in every other mode unless the probe
 * or a filter says to print.
 */
function statchasers_sos_shortcode_heading(): string {
	$tool_mode = function_exists( 'statchasers_h1_tool_supplies_heading' )
		&& statchasers_h1_tool_supplies_heading();

	if ( ! $tool_mode && ! apply_filters( 'statchasers_sos_shortcode_h1', false ) ) {
		return '';
	}

	if ( ! function_exists( 'statchasers_page_heading_html' ) ) {
		return '';
	}

	return statchasers_page_heading_html( statchasers_sos_h1(), statchasers_sos_lead() );
}

/**
 * Rewrite the page's title, which is the theme's H1. Guarded the way every
 * `the_title` filter in this plugin is.
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

		$own = statchasers_sos_h1();

		return '' === $own ? $title : $own;
	},
	10,
	2
);

// The approved title already names the site's subject and season in full, so
// it is used as it is - no " | StatChasers" suffix, which would push it past
// what a results page shows.
add_filter(
	'rank_math/frontend/title',
	static function ( $title ) {
		$own = statchasers_sos_title();
		return '' === $own ? $title : $own;
	}
);
add_filter(
	'pre_get_document_title',
	static function ( $title ) {
		$own = statchasers_sos_title();
		return '' === $own ? $title : $own;
	},
	20
);
add_filter(
	'rank_math/frontend/description',
	static function ( $description ) {
		$own = statchasers_sos_description();
		return '' === $own ? $description : $own;
	}
);
add_filter(
	'rank_math/frontend/canonical',
	static function ( $canonical ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $canonical : $own;
	}
);
add_filter(
	'rank_math/opengraph/url',
	static function ( $url ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $url : $own;
	}
);
add_filter(
	'get_canonical_url',
	static function ( $canonical ) {
		$own = statchasers_sos_canonical();
		return '' === $own ? $canonical : $own;
	}
);

/**
 * Drop the page-data island from the printed markup. It is transport for the
 * title filters above, which read the cached fetch rather than this string.
 *
 * @param string $html Rendered fragment.
 * @return string
 */
function statchasers_sos_strip_islands( string $html ): string {
	if ( false === strpos( $html, 'scsos-page-data' ) ) {
		return $html;
	}

	return (string) preg_replace(
		'#<script type="application/json" class="scsos-page-data">.*?</script>#s',
		'',
		$html
	);
}

/* ------------------------------------------------------------- the sitemap */

/**
 * The five sub-page URLs, appended to Rank Math's page sitemap.
 *
 * Each is its own canonical, and an address with no post behind it is one
 * Rank Math cannot list by itself - the rankings' boards are added the same
 * way. Only while the page exists, is published and still mounts the board,
 * and only while the sub-page addresses are on.
 */
function statchasers_sos_sitemap_entries(): string {
	if ( ! statchasers_sos_page_urls_enabled() ) {
		return '';
	}
	$page = get_page_by_path( statchasers_sos_page_path() );
	if ( ! $page instanceof WP_Post || 'publish' !== $page->post_status ) {
		return '';
	}
	if ( ! has_shortcode( (string) $page->post_content, STATCHASERS_SOS_SHORTCODE ) ) {
		return '';
	}
	$extra = '';
	foreach ( STATCHASERS_SOS_PAGES as $sub ) {
		$extra .= statchasers_team_sitemap_entry( statchasers_sos_page_url( $sub ), '' );
	}
	return $extra;
}

add_filter(
	'rank_math/sitemap/page_content',
	static function ( $content ) {
		if ( ! statchasers_sitemap_first_page() ) {
			return $content;
		}
		return $content . statchasers_sos_sitemap_entries();
	}
);

/**
 * Clear cached renders. Called by statchasers_news_flush().
 *
 * The outage backups are kept unless $all: see statchasers_flush_transients().
 */
function statchasers_sos_flush( bool $all = false ): void {
	statchasers_flush_transients( 'sc_sos_ssr_', $all );
}
