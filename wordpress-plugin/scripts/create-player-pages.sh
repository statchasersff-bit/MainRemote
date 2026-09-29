#!/usr/bin/env bash
#
# Create the NFL player pages under /nfl/players/ on statchasers.com.
#
# Run it on the WordPress host, where `wp` can reach the database:
#
#   ORIGIN=https://your-api.example.com bash create-player-pages.sh --dry-run
#   ORIGIN=https://your-api.example.com bash create-player-pages.sh
#   ORIGIN=https://your-api.example.com bash create-player-pages.sh --force
#
# WHERE THE PLAYER LIST COMES FROM
#
# From the API, at /embed/players.json — not from a table in this file. There
# are roughly six hundred of these and the list moves every offseason, so a
# copy pasted in here would be wrong by the time anybody ran it. The deployment
# is the thing that knows which slugs resolve, so it is the thing asked.
#
# It returns the INDEXED players only: the dictionary holds every player in the
# league, and most have no game log, no advanced row and no bio. A page each
# would be several thousand thin pages, which is the opposite of the point.
#
# WHAT IT WRITES, AND WHAT IT WON'T
#
# New pages get their title, slug, parent, the [statchasers_player] shortcode as
# post content, and Rank Math's title/description/robots.
#
# Pages that already exist are treated as yours. Content is never overwritten;
# Rank Math fields are filled only where they are empty. `--force` lifts that.
# Re-running without --force is a no-op, so it is safe in a deploy script.
#
# Unlike the team script this does NOT import a featured image by default. Six
# hundred headshot sideloads is a large media library and a long run for an
# image the profile already renders itself; --with-images turns it on for a
# site whose template needs one.
#
# The season appears in the SEO title and description only — the profile's own
# content rolls over by itself. Bump SEASON each September and re-run with
# --force to refresh the meta.

set -euo pipefail

# --------------------------------------------------------------------- config

SEASON="${SEASON:-2026}"

# The API origin. Same value as STATCHASERS_NEWS_ORIGIN in wp-config.php.
ORIGIN="${ORIGIN:-}"

# The public path these pages live at. Must match SC_PLAYER_PATH_PREFIX on the
# API deployment, or links inside the profile will point somewhere these pages
# are not.
PARENT_PATH="${PARENT_PATH:-nfl/players}"

# `wp` plus whatever your install needs — e.g. WP_ARGS="--path=/var/www/html --allow-root"
WP="${WP_CLI:-wp}"
WP_ARGS="${WP_ARGS:-}"

# Stop after N players. For a first run against a staging site.
LIMIT="${LIMIT:-0}"

DRY_RUN=0
FORCE=0
WITH_IMAGES=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--force) FORCE=1 ;;
		--with-images) WITH_IMAGES=1 ;;
		-h|--help) sed -n '2,40p' "$0"; exit 0 ;;
		*) echo "Unknown option: $arg" >&2; exit 2 ;;
	esac
done

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

# ---------------------------------------------------------------- the roster

[ -n "$ORIGIN" ] || die "set ORIGIN to the API origin, e.g. ORIGIN=https://news.statchasers.com"
command -v curl >/dev/null 2>&1 || die "curl not found."
command -v "$WP" >/dev/null 2>&1 || die "wp-cli not found. Set WP_CLI=/path/to/wp."
# shellcheck disable=SC2086
"$WP" $WP_ARGS core is-installed >/dev/null 2>&1 || die "wp-cli cannot reach this WordPress install. Set WP_ARGS=\"--path=/var/www/html\"."

roster_json="$(mktemp)"
trap 'rm -f "$roster_json"' EXIT

# SC_EMBED_KEY: the app's key, when it is locked to WordPress (the same value
# as STATCHASERS_EMBED_KEY in wp-config.php). Unset, no header is sent.
key_header=()
[ -n "${SC_EMBED_KEY:-}" ] && key_header=(-H "X-StatChasers-Key: ${SC_EMBED_KEY}")
curl -fsS --max-time 30 ${key_header[@]+"${key_header[@]}"} "${ORIGIN%/}/embed/players.json" -o "$roster_json" \
	|| die "could not read ${ORIGIN%/}/embed/players.json — is the deployment up?"

# Parsed with wp-cli's PHP rather than jq: jq is not installed on every managed
# host, and `wp` is by definition present here. The output is one pipe-delimited
# row per player, which is the same shape the team script's table has.
roster="$(wpq eval "
\$raw = file_get_contents('$roster_json');
\$data = json_decode(\$raw, true);
if ( ! is_array(\$data) || empty(\$data['players']) ) { exit(1); }
foreach ( \$data['players'] as \$p ) {
    printf(\"%s|%s|%s|%s|%s|%s\n\",
        \$p['slug'] ?? '',
        str_replace('|', ' ', \$p['name'] ?? ''),
        \$p['position'] ?? '',
        \$p['team'] ?? '',
        str_replace('|', ' ', \$p['teamName'] ?? ''),
        \$p['id'] ?? ''
    );
}
")"

[ -n "$roster" ] || die "the roster came back empty or unparseable."

total="$(printf '%s\n' "$roster" | grep -c '|' || true)"

say "Season: $SEASON   Parent path: /$PARENT_PATH/   Players: $total"
[ "$DRY_RUN" -eq 1 ] && say "(dry run — no writes)"
[ "$LIMIT" -gt 0 ] && say "(limited to the first $LIMIT)"
say ""

# ------------------------------------------------------------------ the parents

parent_id=0
IFS='/' read -r -a segments <<< "$PARENT_PATH"
for segment in "${segments[@]}"; do
	title="$(printf '%s' "$segment" | tr '-' ' ')"
	[ "$segment" = "nfl" ] && title="NFL"
	[ "$segment" = "players" ] && title="NFL Players"

	next_id="$(ensure_page "$segment" "$title" "$parent_id" "")"
	if [ "$next_id" = "DRY" ]; then
		say "  (dry run: assuming /$segment/ exists as parent)"
		next_id=0
	fi
	[ -n "$next_id" ] || die "could not resolve or create the /$segment/ page."
	say "Parent /$segment/ -> post $next_id"
	parent_id="$next_id"
done

players_parent="$parent_id"
say ""

# ----------------------------------------------------------------- the players

created=0; existing=0; done_n=0

while IFS='|' read -r slug name position team team_name player_id; do
	[ -n "$slug" ] || continue
	[ "$LIMIT" -gt 0 ] && [ "$done_n" -ge "$LIMIT" ] && break
	done_n=$((done_n + 1))

	# The page title, which is the <h1> the theme prints above the shortcode —
	# the fragment steps down to <h2> when embedded so this stays the page's
	# heading. Deliberately NOT the same string as rank_math_title: that one is
	# the <title> tag competing in a search result, this one is read by somebody
	# already on the page.
	title="$name"
	[ -n "$position" ] && title="$name ($position)"

	id="$(page_id "$slug" "$players_parent")"

	if [ -z "$id" ]; then
		id="$(ensure_page "$slug" "$title" "$players_parent" '[statchasers_player]')"
		created=$((created + 1))
		say "created  $slug  -> $id"
	else
		existing=$((existing + 1))
		content="$(wpq post get "$id" --field=post_content)"
		case "$content" in
			*statchasers_player*) ;;
			*)
				warn "$slug (post $id) exists but its content has no [statchasers_player] — nothing on it will be indexable."
				;;
		esac
		say "existing $slug  -> $id"
	fi

	[ "$id" = "DRY" ] && continue

	# Rank Math. The plugin emits no title/description/robots of its own by
	# design, so these three are the page's only ones — and the robots value is
	# the difference between a profile that ranks and one that quietly doesn't.
	pos_words="$position"
	case "$position" in
		QB) pos_words="quarterback" ;;
		RB) pos_words="running back" ;;
		WR) pos_words="wide receiver" ;;
		TE) pos_words="tight end" ;;
		K)  pos_words="kicker" ;;
	esac

	where=""
	[ -n "$team_name" ] && where=" $team_name"

	set_meta "$id" rank_math_title "$name Fantasy Football Stats & Analysis | StatChasers"
	set_meta "$id" rank_math_description \
		"$name$where $pos_words fantasy football profile: $SEASON game log, weekly finishes, advanced metrics, injury history and career production."
	set_meta "$id" rank_math_robots '["index","follow"]' --format=json

	if [ "$WITH_IMAGES" -eq 1 ] && meta_is_empty "$id" _thumbnail_id; then
		# Sleeper's thumbnail, keyed by SLEEPER'S id — the slug is ours and means
		# nothing to their CDN. Failures are a warning, never fatal: the profile
		# renders its own headshot regardless of what the featured image holds.
		if [ -z "$player_id" ]; then
			warn "$slug: no player id in the roster, skipping the headshot import."
		else
			wpc media import "https://sleepercdn.com/content/nfl/players/thumb/$player_id.jpg" \
				--post_id="$id" --featured_image \
				--title="$name" --alt="$name" >/dev/null \
				|| warn "$slug: headshot import failed — set the featured image by hand if the template needs one."
		fi
	fi
done <<< "$roster"

# ----------------------------------------------------------------- the index

# A parent page with no body is a thin page that still sits in the sitemap. This
# gives the section one crawlable entry point, grouped by team so it is a usable
# page rather than six hundred links in a column.
if [ "$players_parent" != "DRY" ] && [ "$players_parent" != "0" ]; then
	index_content="$(wpq post get "$players_parent" --field=post_content)"
	if [ -z "$(printf '%s' "$index_content" | tr -d '[:space:]')" ] || [ "$FORCE" -eq 1 ]; then
		body='<p>Fantasy football profiles for every rostered NFL skill player: game logs, weekly finishes, advanced metrics, injury history and career production.</p>'
		current_team=""
		# Sorted by team so the index groups; the roster arrives in that order
		# already, but sorting makes it independent of the endpoint's ordering.
		while IFS='|' read -r slug name position team team_name player_id; do
			[ -n "$slug" ] || continue
			if [ "$team_name" != "$current_team" ]; then
				[ -n "$current_team" ] && body="$body</ul>"
				body="$body<h2>${team_name:-Free agents}</h2><ul>"
				current_team="$team_name"
			fi
			body="$body<li><a href=\"/$PARENT_PATH/$slug/\">$name</a>"
			[ -n "$position" ] && body="$body ($position)"
			body="$body</li>"
		done <<< "$(printf '%s\n' "$roster" | sort -t'|' -k5,5 -k2,2)"
		body="$body</ul>"
		wpc post update "$players_parent" --post_content="$body" >/dev/null
		say ""
		say "index    /$PARENT_PATH/ -> wrote $total links"
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
say "Next: set SC_PLAYER_PATH_PREFIX=/$PARENT_PATH/ on the API deployment, assign"
say "the Divi Theme Builder body template to these pages, then run the checks in"
say "wordpress-plugin/DEPLOY-CHECKLIST.md against one of them before trusting the rest."
