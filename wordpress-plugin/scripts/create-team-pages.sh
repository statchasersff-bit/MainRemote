#!/usr/bin/env bash
#
# Create the 32 NFL team hub pages under /nfl/teams/ on statchasers.com.
#
# Run it on the WordPress host, where `wp` can reach the database:
#
#   bash create-team-pages.sh --dry-run     # print what it would do
#   bash create-team-pages.sh               # do it
#   bash create-team-pages.sh --force       # also rewrite meta on pages that exist
#
# WHAT IT WRITES, AND WHAT IT WON'T
#
# New pages get their title, slug, parent, the [statchasers_team] shortcode as
# post content, Rank Math's title/description/robots, and the team crest as the
# featured image (which is what Divi's dynamic content reads in the hero).
#
# Pages that already exist are treated as yours. Content is never overwritten;
# Rank Math fields are filled only where they are empty. `--force` lifts that,
# and prints what it replaced. Re-running without --force is a no-op, so it is
# safe in a deploy script.
#
# The season appears in the SEO title and description only — the hub's own
# content rolls over by itself. Bump SEASON each September and re-run with
# --force to refresh the 32 meta pairs.

set -euo pipefail

# --------------------------------------------------------------------- config

SEASON="${SEASON:-2026}"

# The public path these pages live at. Must match SC_TEAM_PATH_PREFIX on the
# API deployment, or the hub's own team switcher will link 32 teams somewhere
# these pages are not.
PARENT_PATH="${PARENT_PATH:-nfl/teams}"

# `wp` plus whatever your install needs — e.g. WP_ARGS="--path=/var/www/html --allow-root"
WP="${WP_CLI:-wp}"
WP_ARGS="${WP_ARGS:-}"

DRY_RUN=0
FORCE=0
SKIP_IMAGES=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--force) FORCE=1 ;;
		--skip-images) SKIP_IMAGES=1 ;;
		-h|--help) sed -n '2,28p' "$0"; exit 0 ;;
		*) echo "Unknown option: $arg" >&2; exit 2 ;;
	esac
done

# slug|Full name|abbr|Division — mirrors src/lib/team/teams.ts.
TEAMS=(
  "buffalo-bills|Buffalo Bills|buf|AFC East"
  "miami-dolphins|Miami Dolphins|mia|AFC East"
  "new-england-patriots|New England Patriots|ne|AFC East"
  "new-york-jets|New York Jets|nyj|AFC East"
  "baltimore-ravens|Baltimore Ravens|bal|AFC North"
  "cincinnati-bengals|Cincinnati Bengals|cin|AFC North"
  "cleveland-browns|Cleveland Browns|cle|AFC North"
  "pittsburgh-steelers|Pittsburgh Steelers|pit|AFC North"
  "houston-texans|Houston Texans|hou|AFC South"
  "indianapolis-colts|Indianapolis Colts|ind|AFC South"
  "jacksonville-jaguars|Jacksonville Jaguars|jax|AFC South"
  "tennessee-titans|Tennessee Titans|ten|AFC South"
  "denver-broncos|Denver Broncos|den|AFC West"
  "kansas-city-chiefs|Kansas City Chiefs|kc|AFC West"
  "las-vegas-raiders|Las Vegas Raiders|lv|AFC West"
  "los-angeles-chargers|Los Angeles Chargers|lac|AFC West"
  "dallas-cowboys|Dallas Cowboys|dal|NFC East"
  "new-york-giants|New York Giants|nyg|NFC East"
  "philadelphia-eagles|Philadelphia Eagles|phi|NFC East"
  "washington-commanders|Washington Commanders|was|NFC East"
  "chicago-bears|Chicago Bears|chi|NFC North"
  "detroit-lions|Detroit Lions|det|NFC North"
  "green-bay-packers|Green Bay Packers|gb|NFC North"
  "minnesota-vikings|Minnesota Vikings|min|NFC North"
  "atlanta-falcons|Atlanta Falcons|atl|NFC South"
  "carolina-panthers|Carolina Panthers|car|NFC South"
  "new-orleans-saints|New Orleans Saints|no|NFC South"
  "tampa-bay-buccaneers|Tampa Bay Buccaneers|tb|NFC South"
  "arizona-cardinals|Arizona Cardinals|ari|NFC West"
  "los-angeles-rams|Los Angeles Rams|lar|NFC West"
  "san-francisco-49ers|San Francisco 49ers|sf|NFC West"
  "seattle-seahawks|Seattle Seahawks|sea|NFC West"
)

# -------------------------------------------------------------------- helpers

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }

wpc() {
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '  would run: wp %s\n' "$*" >&2
		return 0
	fi
	# shellcheck disable=SC2086
	"$WP" $WP_ARGS "$@"
}

# Reads never mutate anything, so they run even under --dry-run — the plan is
# only useful if it is computed against the real site.
wpq() {
	# shellcheck disable=SC2086
	"$WP" $WP_ARGS "$@" 2>/dev/null || true
}

# Nickname: everything after the last space. "San Francisco 49ers" -> "49ers".
nickname_of() { printf '%s' "${1##* }"; }

# ------------------------------------------------------------ page resolution

page_id() { # slug parent_id
	wpq post list --post_type=page --post_status=any \
		--name="$1" --post_parent="$2" --field=ID --format=ids | awk '{print $1}'
}

ensure_page() { # slug title parent_id content -> echoes ID
	local slug="$1" title="$2" parent="$3" content="$4" id
	id="$(page_id "$slug" "$parent")"

	if [ -n "$id" ]; then
		printf '%s' "$id"
		return 0
	fi

	if [ "$DRY_RUN" -eq 1 ]; then
		printf '  would create page "%s" (%s) under parent %s\n' "$title" "$slug" "$parent" >&2
		printf 'DRY'
		return 0
	fi

	# shellcheck disable=SC2086
	"$WP" $WP_ARGS post create --post_type=page --post_status=publish \
		--post_title="$title" --post_name="$slug" --post_parent="$parent" \
		--post_content="$content" --porcelain
}

meta_is_empty() { # id key
	local value
	value="$(wpq post meta get "$1" "$2")"
	[ -z "$value" ]
}

set_meta() { # id key value [--format=json]
	local id="$1" key="$2" value="$3"; shift 3
	if [ "$FORCE" -eq 0 ] && ! meta_is_empty "$id" "$key"; then
		return 0
	fi
	wpc post meta update "$id" "$key" "$value" "$@" >/dev/null
}

# ------------------------------------------------------------------ the parents

say "Season: $SEASON   Parent path: /$PARENT_PATH/"
[ "$DRY_RUN" -eq 1 ] && say "(dry run — no writes)"
say ""

command -v "$WP" >/dev/null 2>&1 || die "wp-cli not found. Set WP_CLI=/path/to/wp."
# shellcheck disable=SC2086
"$WP" $WP_ARGS core is-installed >/dev/null 2>&1 || die "wp-cli cannot reach this WordPress install. Set WP_ARGS=\"--path=/var/www/html\"."

parent_id=0
IFS='/' read -r -a segments <<< "$PARENT_PATH"
for segment in "${segments[@]}"; do
	title="$(printf '%s' "$segment" | tr '-' ' ')"
	# "nfl" -> "NFL"; anything else gets title case left to you in the admin.
	[ "$segment" = "nfl" ] && title="NFL"
	[ "$segment" = "teams" ] && title="NFL Team Hubs"

	next_id="$(ensure_page "$segment" "$title" "$parent_id" "")"
	if [ "$next_id" = "DRY" ]; then
		say "  (dry run: assuming /$segment/ exists as parent)"
		next_id=0
	fi
	[ -n "$next_id" ] || die "could not resolve or create the /$segment/ page."
	say "Parent /$segment/ -> post $next_id"
	parent_id="$next_id"
done

teams_parent="$parent_id"
say ""

# ------------------------------------------------------------------ the teams

created=0; existing=0

for row in "${TEAMS[@]}"; do
	IFS='|' read -r slug name abbr division <<< "$row"
	nick="$(nickname_of "$name")"

	# The page title, which is the <h1> Divi prints above the shortcode — the
	# fragment itself steps down to <h2> when embedded so this one stays the
	# page's heading. Deliberately NOT the same string as rank_math_title below:
	# that one is the <title> tag and competes in a search result, this one is
	# read by someone already on the page.
	title="$name Team Page"
	id="$(page_id "$slug" "$teams_parent")"

	if [ -z "$id" ]; then
		id="$(ensure_page "$slug" "$title" "$teams_parent" '[statchasers_team]')"
		created=$((created + 1))
		say "created  $slug  -> $id"
	else
		existing=$((existing + 1))
		content="$(wpq post get "$id" --field=post_content)"
		case "$content" in
			*statchasers_team*|*sc_team_hub*) ;;
			*)
				warn "$slug (post $id) exists but its content has no [statchasers_team] — nothing on it will be indexable. Add the shortcode, or mount [sc_team_hub] in the Divi template."
				;;
		esac
		say "existing $slug  -> $id"
	fi

	[ "$id" = "DRY" ] && continue

	# Rank Math. The plugin emits no title/description/robots of its own by
	# design, so these three are the page's only ones — and the robots value is
	# the difference between a hub that ranks and 32 pages that quietly don't.
	set_meta "$id" rank_math_title "$SEASON $name Fantasy Football Hub | StatChasers"
	set_meta "$id" rank_math_description \
		"Live $nick player news and injury updates, the offensive depth chart, $SEASON schedule, team stats with NFL ranks and a weekly fantasy outlook."
	set_meta "$id" rank_math_robots '["index","follow"]' --format=json

	# Featured image = the team crest, which is what Divi's dynamic content
	# pulls into the hero. Skipped when one is already set, or every re-run
	# would sideload 32 more copies into the media library.
	if [ "$SKIP_IMAGES" -eq 0 ] && meta_is_empty "$id" _thumbnail_id; then
		wpc media import "https://sleepercdn.com/images/team_logos/nfl/$abbr.png" \
			--post_id="$id" --featured_image \
			--title="$name logo" --alt="$name logo" >/dev/null \
			|| warn "$slug: crest import failed — set the featured image by hand."
	fi
done

# ----------------------------------------------------------------- the index

# A parent page with no body is a thin page that still sits in the sitemap. The
# hub's own switcher already links all 32 from every team page, so this exists
# for readers arriving from the nav — and to give the section one crawlable
# entry point.
if [ "$teams_parent" != "DRY" ] && [ "$teams_parent" != "0" ]; then
	index_content="$(wpq post get "$teams_parent" --field=post_content)"
	if [ -z "$(printf '%s' "$index_content" | tr -d '[:space:]')" ] || [ "$FORCE" -eq 1 ]; then
		body='<p>Every NFL team hub: player news, injury designations, the offensive depth chart, the schedule and a weekly fantasy outlook.</p>'
		current_division=""
		for row in "${TEAMS[@]}"; do
			IFS='|' read -r slug name abbr division <<< "$row"
			if [ "$division" != "$current_division" ]; then
				[ -n "$current_division" ] && body="$body</ul>"
				body="$body<h2>$division</h2><ul>"
				current_division="$division"
			fi
			body="$body<li><a href=\"/$PARENT_PATH/$slug/\">$name</a></li>"
		done
		body="$body</ul>"
		wpc post update "$teams_parent" --post_content="$body" >/dev/null
		say ""
		say "index    /$PARENT_PATH/ -> wrote 32 links"
	else
		say ""
		say "index    /$PARENT_PATH/ has content already — left alone (--force to rewrite)"
	fi
fi

# --------------------------------------------------------------------- finish

wpc rewrite flush >/dev/null || true
# Drops the 5-minute fragment transients so the new pages render immediately
# rather than after the first cold fetch.
wpc eval 'if ( function_exists( "statchasers_news_flush" ) ) { statchasers_news_flush(); }' >/dev/null || true

say ""
say "Done. $created created, $existing already existed."
say ""
say "Next: assign the Divi Theme Builder body template to these pages, then run"
say "the checks in wordpress-plugin/DEPLOY-CHECKLIST.md against one of them"
say "before trusting the other 31."
