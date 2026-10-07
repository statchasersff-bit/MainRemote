<?php
/**
 * Plugin Name: StatChasers Divi Team Pages
 * Description: Per-team data for a single Divi Theme Builder template, plus the sticky-header offset the hub needs. Companion to the StatChasers plugin.
 * Version:     1.0.1
 *
 * Install as an mu-plugin: wp-content/mu-plugins/statchasers-divi-teams.php
 * (mu-plugins load unconditionally, so nothing here can be switched off by
 * accident on a page that needs it.) A child theme's functions.php works too.
 *
 * WHY THIS EXISTS
 *
 * Divi's Theme Builder can render one body template across all 32 team pages,
 * and its dynamic content covers the post title and the featured image. It has
 * no notion of "this page's team colour" - so a hero that is meant to be the
 * Eagles' hero rather than a generic one needs the team's own values from
 * somewhere. This file is that somewhere: the same 32 rows the API renders
 * from, exposed to Divi as CSS custom properties and a shortcode.
 *
 * It deliberately does NOT emit a title, canonical, description, robots
 * directive or schema. Rank Math owns those, exactly as with the main plugin.
 *
 * @package StatChasers\Divi
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The 32 teams, keyed by the page slug they live at.
 *
 * Mirrors artifacts/api-server/src/lib/team/teams.ts and the TEAM_COLORS /
 * TEAM_ACCENTS maps in src/lib/render.ts - the same values the hub paints its
 * own hero with, so a Divi hero above it cannot disagree about what colour a
 * team is. If a team ever moves or rebrands, both sides change together.
 */
const STATCHASERS_DIVI_TEAMS = array(
	'buffalo-bills' => array( 'abbr' => 'buf', 'name' => 'Buffalo Bills', 'nickname' => 'Bills', 'division' => 'AFC East', 'primary' => '#00338D', 'accent' => '#C60C30' ),
	'miami-dolphins' => array( 'abbr' => 'mia', 'name' => 'Miami Dolphins', 'nickname' => 'Dolphins', 'division' => 'AFC East', 'primary' => '#008E97', 'accent' => '#FC4C02' ),
	'new-england-patriots' => array( 'abbr' => 'ne', 'name' => 'New England Patriots', 'nickname' => 'Patriots', 'division' => 'AFC East', 'primary' => '#002244', 'accent' => '#C60C30' ),
	'new-york-jets' => array( 'abbr' => 'nyj', 'name' => 'New York Jets', 'nickname' => 'Jets', 'division' => 'AFC East', 'primary' => '#125740', 'accent' => '#FFFFFF' ),
	'baltimore-ravens' => array( 'abbr' => 'bal', 'name' => 'Baltimore Ravens', 'nickname' => 'Ravens', 'division' => 'AFC North', 'primary' => '#241773', 'accent' => '#9E7C0C' ),
	'cincinnati-bengals' => array( 'abbr' => 'cin', 'name' => 'Cincinnati Bengals', 'nickname' => 'Bengals', 'division' => 'AFC North', 'primary' => '#FB4F14', 'accent' => '#000000' ),
	'cleveland-browns' => array( 'abbr' => 'cle', 'name' => 'Cleveland Browns', 'nickname' => 'Browns', 'division' => 'AFC North', 'primary' => '#311D00', 'accent' => '#FF3C00' ),
	'pittsburgh-steelers' => array( 'abbr' => 'pit', 'name' => 'Pittsburgh Steelers', 'nickname' => 'Steelers', 'division' => 'AFC North', 'primary' => '#101820', 'accent' => '#FFB612' ),
	'houston-texans' => array( 'abbr' => 'hou', 'name' => 'Houston Texans', 'nickname' => 'Texans', 'division' => 'AFC South', 'primary' => '#03202F', 'accent' => '#A71930' ),
	'indianapolis-colts' => array( 'abbr' => 'ind', 'name' => 'Indianapolis Colts', 'nickname' => 'Colts', 'division' => 'AFC South', 'primary' => '#002C5F', 'accent' => '#FFFFFF' ),
	'jacksonville-jaguars' => array( 'abbr' => 'jax', 'name' => 'Jacksonville Jaguars', 'nickname' => 'Jaguars', 'division' => 'AFC South', 'primary' => '#006778', 'accent' => '#D7A22A' ),
	'tennessee-titans' => array( 'abbr' => 'ten', 'name' => 'Tennessee Titans', 'nickname' => 'Titans', 'division' => 'AFC South', 'primary' => '#0C2340', 'accent' => '#4B92DB' ),
	'denver-broncos' => array( 'abbr' => 'den', 'name' => 'Denver Broncos', 'nickname' => 'Broncos', 'division' => 'AFC West', 'primary' => '#FB4F14', 'accent' => '#002244' ),
	'kansas-city-chiefs' => array( 'abbr' => 'kc', 'name' => 'Kansas City Chiefs', 'nickname' => 'Chiefs', 'division' => 'AFC West', 'primary' => '#E31837', 'accent' => '#FFB81C' ),
	'las-vegas-raiders' => array( 'abbr' => 'lv', 'name' => 'Las Vegas Raiders', 'nickname' => 'Raiders', 'division' => 'AFC West', 'primary' => '#101820', 'accent' => '#A5ACAF' ),
	'los-angeles-chargers' => array( 'abbr' => 'lac', 'name' => 'Los Angeles Chargers', 'nickname' => 'Chargers', 'division' => 'AFC West', 'primary' => '#0080C6', 'accent' => '#FFC20E' ),
	'dallas-cowboys' => array( 'abbr' => 'dal', 'name' => 'Dallas Cowboys', 'nickname' => 'Cowboys', 'division' => 'NFC East', 'primary' => '#041E42', 'accent' => '#869397' ),
	'new-york-giants' => array( 'abbr' => 'nyg', 'name' => 'New York Giants', 'nickname' => 'Giants', 'division' => 'NFC East', 'primary' => '#0B2265', 'accent' => '#A71930' ),
	'philadelphia-eagles' => array( 'abbr' => 'phi', 'name' => 'Philadelphia Eagles', 'nickname' => 'Eagles', 'division' => 'NFC East', 'primary' => '#004C54', 'accent' => '#A5ACAF' ),
	'washington-commanders' => array( 'abbr' => 'was', 'name' => 'Washington Commanders', 'nickname' => 'Commanders', 'division' => 'NFC East', 'primary' => '#5A1414', 'accent' => '#FFB612' ),
	'chicago-bears' => array( 'abbr' => 'chi', 'name' => 'Chicago Bears', 'nickname' => 'Bears', 'division' => 'NFC North', 'primary' => '#0B162A', 'accent' => '#C83803' ),
	'detroit-lions' => array( 'abbr' => 'det', 'name' => 'Detroit Lions', 'nickname' => 'Lions', 'division' => 'NFC North', 'primary' => '#0076B6', 'accent' => '#B0B7BC' ),
	'green-bay-packers' => array( 'abbr' => 'gb', 'name' => 'Green Bay Packers', 'nickname' => 'Packers', 'division' => 'NFC North', 'primary' => '#203731', 'accent' => '#FFB612' ),
	'minnesota-vikings' => array( 'abbr' => 'min', 'name' => 'Minnesota Vikings', 'nickname' => 'Vikings', 'division' => 'NFC North', 'primary' => '#4F2683', 'accent' => '#FFC62F' ),
	'atlanta-falcons' => array( 'abbr' => 'atl', 'name' => 'Atlanta Falcons', 'nickname' => 'Falcons', 'division' => 'NFC South', 'primary' => '#A71930', 'accent' => '#A5ACAF' ),
	'carolina-panthers' => array( 'abbr' => 'car', 'name' => 'Carolina Panthers', 'nickname' => 'Panthers', 'division' => 'NFC South', 'primary' => '#0085CA', 'accent' => '#BFC0BF' ),
	'new-orleans-saints' => array( 'abbr' => 'no', 'name' => 'New Orleans Saints', 'nickname' => 'Saints', 'division' => 'NFC South', 'primary' => '#101820', 'accent' => '#D3BC8D' ),
	'tampa-bay-buccaneers' => array( 'abbr' => 'tb', 'name' => 'Tampa Bay Buccaneers', 'nickname' => 'Buccaneers', 'division' => 'NFC South', 'primary' => '#D50A0A', 'accent' => '#FF7900' ),
	'arizona-cardinals' => array( 'abbr' => 'ari', 'name' => 'Arizona Cardinals', 'nickname' => 'Cardinals', 'division' => 'NFC West', 'primary' => '#97233F', 'accent' => '#FFB612' ),
	'los-angeles-rams' => array( 'abbr' => 'lar', 'name' => 'Los Angeles Rams', 'nickname' => 'Rams', 'division' => 'NFC West', 'primary' => '#003594', 'accent' => '#FFD100' ),
	'san-francisco-49ers' => array( 'abbr' => 'sf', 'name' => 'San Francisco 49ers', 'nickname' => '49ers', 'division' => 'NFC West', 'primary' => '#AA0000', 'accent' => '#B3995D' ),
	'seattle-seahawks' => array( 'abbr' => 'sea', 'name' => 'Seattle Seahawks', 'nickname' => 'Seahawks', 'division' => 'NFC West', 'primary' => '#002244', 'accent' => '#69BE28' ),
);

/**
 * The team this request is rendering, or null if it isn't a team page.
 *
 * Reads `get_queried_object()` rather than `get_post()` on purpose. Divi swaps
 * the global post while it renders a Theme Builder layout, so a shortcode
 * placed inside the template sees the LAYOUT's post, not the page's - and the
 * team would come out wrong or empty. The queried object is the page either
 * way, which is what makes one template safe across all 32.
 *
 * @return array<string,string>|null Team row with `slug` and `logo` added.
 */
function statchasers_divi_team(): ?array {
	if ( is_admin() || ! is_singular() ) {
		return null;
	}

	$object = get_queried_object();
	if ( ! $object instanceof WP_Post ) {
		return null;
	}

	$slug = (string) $object->post_name;
	// array_key_exists rather than isset(): isset() cannot take a constant
	// array offset - that is a parse error, not a false.
	if ( ! array_key_exists( $slug, STATCHASERS_DIVI_TEAMS ) ) {
		return null;
	}

	$team         = STATCHASERS_DIVI_TEAMS[ $slug ];
	$team['slug'] = $slug;
	// The same crest the hub's own hero and the news cards draw - the SVG the
	// API serves from its own origin (/team-logos/<abbr>.svg redirects to the
	// current content-hashed file) - so a Divi hero above the hub shows the
	// identical mark rather than a second artwork kept in step by hand. The
	// Sleeper PNG the hub used to draw is the fallback when the main plugin,
	// which knows the API origin, is not active.
	$team['logo'] = statchasers_divi_crest_url( $team['abbr'] );

	return $team;
}

/**
 * The crest URL for a team code: the API's own SVG when its origin is known.
 *
 * @param string $abbr Sleeper's lowercase team code.
 * @return string
 */
function statchasers_divi_crest_url( string $abbr ): string {
	$origin = '';
	if ( function_exists( 'statchasers_news_origin' ) ) {
		$origin = (string) statchasers_news_origin();
	} elseif ( defined( 'STATCHASERS_NEWS_ORIGIN' ) ) {
		$origin = (string) constant( 'STATCHASERS_NEWS_ORIGIN' );
	}
	$origin = rtrim( $origin, '/' );
	if ( '' !== $origin ) {
		return $origin . '/team-logos/' . rawurlencode( $abbr ) . '.svg';
	}
	return 'https://sleepercdn.com/images/team_logos/nfl/' . rawurlencode( $abbr ) . '.png';
}

/**
 * Body classes so a Divi template - or plain CSS - can target team pages.
 *
 * `sc-team-page` for "any team hub", `sc-team-<slug>` for one team. WordPress
 * emits no slug-based class of its own, and `page-id-1234` is not something
 * you can write a stylesheet against and still read six months later.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_divi_body_class( array $classes ): array {
	$team = statchasers_divi_team();
	if ( null === $team ) {
		return $classes;
	}

	$classes[] = 'sc-team-page';
	$classes[] = 'sc-team-' . $team['slug'];

	return $classes;
}
add_filter( 'body_class', 'statchasers_divi_body_class' );

/**
 * Give every team page Divi's full-width layout.
 *
 * The hub is a full-bleed tool - a hero, a sticky tab strip, four-across metric
 * cards, a schedule grid. Divi's default page layout is `et_right_sidebar`,
 * which hands it about three quarters of the column and draws a vertical rule
 * down the boundary. The published Eagles page was the hub squeezed into 1120px
 * with an empty widgetless sidebar and that rule beside it for the full height
 * of the page.
 *
 * Filtering the meta rather than asking someone to set the dropdown on all 32
 * pages: WP-CLI creates these pages (see wordpress-plugin/scripts/), a new team
 * page would arrive with the default again, and "why is there a line down the
 * right of one team page" is not a thing anyone should have to rediscover. The
 * layout is a property of what a team page IS, so it belongs with the other 32
 * rows rather than in the database.
 *
 * Both hooks are needed and they do different jobs:
 *   - the meta filter is what page.php reads to decide whether to call
 *     get_sidebar(), so it removes the sidebar MARKUP;
 *   - the body_class filter swaps the class Divi's stylesheet keys its column
 *     widths and that vertical rule off, so it removes the LAYOUT.
 * Doing only one leaves either an empty sidebar in a full-width column or a
 * narrow column with nothing beside it.
 *
 * @param mixed  $value     Short-circuit value; null means "not handled".
 * @param int    $object_id Post ID being queried.
 * @param string $meta_key  Meta key being queried.
 * @return mixed Null to fall through to the stored value.
 */
function statchasers_divi_force_fullwidth( $value, $object_id, $meta_key ) {
	if ( '_et_pb_page_layout' !== $meta_key ) {
		return $value;
	}

	$team = statchasers_divi_team();
	// get_queried_object() is the page; $object_id is whatever is being asked
	// about, which during a Theme Builder render can be the layout post. Only
	// answer for the page itself.
	if ( null === $team || (int) $object_id !== (int) get_queried_object_id() ) {
		return $value;
	}

	// get_post_meta() with $single = true unwraps one level, so a short-circuit
	// has to return the array form or the caller gets the first character.
	return array( 'et_full_width_page' );
}
add_filter( 'get_post_metadata', 'statchasers_divi_force_fullwidth', 10, 3 );

/**
 * The body classes that go with that layout.
 *
 * Divi prints `et_right_sidebar` from the same meta, but it is added by a
 * filter that may already have run, so the class is corrected here rather than
 * assumed absent.
 *
 * @param string[] $classes Existing classes.
 * @return string[]
 */
function statchasers_divi_fullwidth_body_class( array $classes ): array {
	if ( null === statchasers_divi_team() ) {
		return $classes;
	}

	$classes = array_values(
		array_diff( $classes, array( 'et_right_sidebar', 'et_left_sidebar' ) )
	);
	$classes[] = 'et_full_width_page';

	return $classes;
}
// Priority 20: after statchasers_divi_body_class above, and after Divi's own
// layout class has been added, so there is something to take back out.
add_filter( 'body_class', 'statchasers_divi_fullwidth_body_class', 20 );

/**
 * The team's colours and crest, as custom properties on <body>.
 *
 * This is the whole trick behind "one Divi template, 32 team-coloured heroes":
 * the template's modules are given `var(--sc-team-primary)` in their custom
 * CSS fields once, and each page paints itself.
 *
 * Printed at priority 1 so it lands before Divi's own inline CSS and before any
 * module custom CSS that consumes it.
 */
function statchasers_divi_head_vars(): void {
	$team = statchasers_divi_team();
	if ( null === $team ) {
		return;
	}

	printf(
		"<style id=\"sc-team-vars\">body.sc-team-page{--sc-team-primary:%s;--sc-team-accent:%s;--sc-team-logo:url('%s')}</style>\n",
		esc_html( $team['primary'] ),
		esc_html( $team['accent'] ),
		esc_url( $team['logo'] )
	);
}
add_action( 'wp_head', 'statchasers_divi_head_vars', 1 );

/**
 * One team field, for a Divi Text/Code module in the hero.
 *
 * Divi's own dynamic content already covers the page title and the featured
 * image; this covers what it cannot know - the division, the nickname, the
 * colours, the crest URL.
 *
 *   [sc_team]                    Philadelphia Eagles
 *   [sc_team field="division"]   NFC East
 *   [sc_team field="nickname"]   Eagles
 *   [sc_team field="logo"]       <img …> (crest, 88px, decorative)
 *   [sc_team field="logo_url"]   the bare URL, for a module's image field
 *   [sc_team field="primary"]    #004C54
 *
 * Returns an empty string off a team page rather than a warning: a Theme
 * Builder template can be assigned somewhere unexpected, and a stray "Unknown
 * team" in a hero is worse than nothing being there.
 *
 * @param array<string,mixed>|string $atts Shortcode attributes.
 * @return string
 */
function statchasers_divi_team_shortcode( $atts = array() ): string {
	$team = statchasers_divi_team();
	if ( null === $team ) {
		return '';
	}

	$atts  = shortcode_atts( array( 'field' => 'name' ), is_array( $atts ) ? $atts : array(), 'sc_team' );
	$field = strtolower( trim( (string) $atts['field'] ) );

	if ( 'logo' === $field ) {
		return sprintf(
			// alt="" because the team's name is already the H1 beside it: a
			// screen reader announcing "Philadelphia Eagles logo, Philadelphia
			// Eagles Fantasy Football Hub" says the same thing twice.
			'<img class="sc-team-crest" src="%s" alt="" width="88" height="88" decoding="async" />',
			esc_url( $team['logo'] )
		);
	}

	if ( 'logo_url' === $field ) {
		return esc_url( $team['logo'] );
	}

	return isset( $team[ $field ] ) ? esc_html( $team[ $field ] ) : '';
}
add_shortcode( 'sc_team', 'statchasers_divi_team_shortcode' );

/**
 * The hub itself, resolved from the queried page.
 *
 * Use this instead of `[statchasers_team]` if you put the hub inside the Divi
 * Theme Builder template rather than in each page's content. The plain
 * shortcode defaults its slug from the global post, which Divi has swapped for
 * the layout by then; this one asks the queried object and is correct either
 * way.
 *
 * Putting the hub in page content and giving the template a Post Content module
 * is still the better arrangement - the content then survives the template
 * being unassigned, and it is what the WP-CLI script writes.
 *
 * @return string
 */
function statchasers_divi_hub_shortcode(): string {
	$team = statchasers_divi_team();
	if ( null === $team || ! function_exists( 'statchasers_team_shortcode' ) ) {
		return '';
	}

	return statchasers_team_shortcode( array( 'slug' => $team['slug'] ) );
}
add_shortcode( 'sc_team_hub', 'statchasers_divi_hub_shortcode' );

/**
 * Enqueue the hub's bundles on every team page, wherever the shortcode sits.
 *
 * The main plugin only enqueues when it finds the shortcode in post content.
 * A hub mounted from a Theme Builder layout is invisible to that check, so the
 * stylesheet would be enqueued mid-render and printed in the footer - the
 * flash of unstyled markup the plugin README warns about. Registering here on
 * `wp_enqueue_scripts` puts it back in the head. Idempotent: the plugin's own
 * function checks `wp_style_is()` before registering.
 */
function statchasers_divi_enqueue(): void {
	if ( null === statchasers_divi_team() || ! function_exists( 'statchasers_team_enqueue_assets' ) ) {
		return;
	}

	statchasers_team_enqueue_assets();
}
add_action( 'wp_enqueue_scripts', 'statchasers_divi_enqueue' );

/**
 * Keep the hub's sticky section nav clear of the Divi header.
 *
 * team.css exposes `--sct-nav-offset` for precisely this: the hub's section bar
 * is sticky and parks at top:0, which is underneath a fixed header. The API
 * cannot know what is above it, so the host page has to say.
 *
 * Measured rather than hard-coded - a Divi Theme Builder header is whatever you
 * built, it shrinks when `.et-fixed-header` kicks in, and it is a different
 * height on mobile. Reads the position too: a header that scrolls away needs no
 * offset at all, and hard-coding 80px there would leave a permanent gap.
 */
function statchasers_divi_nav_offset(): void {
	if ( null === statchasers_divi_team() ) {
		return;
	}
	?>
<script id="sc-team-nav-offset">
(function () {
	var header = document.querySelector('.et-l--header') || document.getElementById('main-header');
	var roots = document.querySelectorAll('[data-sct-root]');
	if (!header || !roots.length) { return; }

	var pending = false;

	function apply() {
		pending = false;
		var position = getComputedStyle(header).position;
		var offset = (position === 'fixed' || position === 'sticky')
			? Math.round(header.getBoundingClientRect().height)
			: 0;
		for (var i = 0; i < roots.length; i++) {
			roots[i].style.setProperty('--sct-nav-offset', offset + 'px');
		}
	}

	function schedule() {
		if (pending) { return; }
		pending = true;
		requestAnimationFrame(apply);
	}

	apply();
	addEventListener('resize', schedule);
	// Divi swaps in .et-fixed-header on scroll, which changes the height.
	addEventListener('scroll', schedule, { passive: true });
	addEventListener('load', apply);
})();
</script>
	<?php
}
add_action( 'wp_footer', 'statchasers_divi_nav_offset', 99 );
