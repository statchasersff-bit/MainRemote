#!/usr/bin/env bash
#
# Package statchasers-news/ as the .zip WordPress accepts at
# Plugins -> Add New -> Upload Plugin.
#
#   bash wordpress-plugin/scripts/build-zip.sh
#
# The zip in dist/ is the artifact that actually gets uploaded, and the one
# thing nobody notices going stale: it is built by hand, it looks fine in the
# directory listing, and a file added to the plugin since the last build simply
# is not in it. That is how a deployment ends up missing half its shortcodes.
# So this script does not take a file list - it takes the directory, every time.
#
# Three checks before it writes anything, because a broken plugin zip takes a
# site down on activation and the feedback loop is an FTP client:
#
#   1. Every .php file parses.
#   2. The Version header, readme.txt's Stable tag and STATCHASERS_NEWS_VERSION
#      all agree.
#   3. The loader requires every .php file that is not itself the loader.
#
# The third is the one that catches the mistake this project has actually made:
# a new file written, tested against a stub harness, and never added to the
# require block, so it does nothing on a real site and nothing says why.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plugin="$here/statchasers-news"
dist="$here/dist"
out="$dist/statchasers-news.zip"

# Nix keeps PHP out of PATH on this box; use whatever is there, and skip the
# parse check rather than fail the build if there is no interpreter at all.
PHP="${PHP:-$(command -v php || true)}"
if [ -z "$PHP" ]; then
	PHP="$(ls -d /nix/store/*-php-with-extensions-*/bin/php 2>/dev/null | head -1 || true)"
fi

say()  { printf '%s\n' "$*"; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }

[ -d "$plugin" ] || die "no plugin directory at $plugin"

# ------------------------------------------------------------------ 1. parse

if [ -n "$PHP" ]; then
	count=0
	while IFS= read -r file; do
		"$PHP" -l "$file" >/dev/null || die "${file#"$plugin"/} does not parse."
		count=$(( count + 1 ))
	done < <(find "$plugin" -name '*.php' -type f | sort)
	say "parse    ok ($count files)"
else
	say "parse    SKIPPED - no php binary found"
fi

# ------------------------------------------------------------------ 1b. load

# Parsing is not loading. tests/smoke.php stubs the WordPress API, includes
# every file in the order the loader does, and calls the functions whose output
# is a string somebody reads - which is what catches a function declared twice,
# a constant used before its file is required, or a heading that has quietly
# stopped agreeing with the API's.
if [ -n "$PHP" ] && [ -f "$here/tests/smoke.php" ]; then
	"$PHP" "$here/tests/smoke.php" >/dev/null || die "tests/smoke.php failed. Run it to see why."
	say "load     ok"
fi

# The depth charts (depth-charts/) have their own harness: tests/depth-charts
# stubs WordPress, loads the embedded copy and asserts what each URL returns.
if [ -n "$PHP" ] && [ -f "$here/tests/depth-charts/checks.php" ]; then
	( cd "$here/tests/depth-charts" && "$PHP" checks.php >/dev/null ) || die "tests/depth-charts/checks.php failed. Run it to see why."
	say "depth    ok"
fi

# Rookie Hit Rates (rookie-hit-rates/): the methodology table's numbers are
# regenerated from the app's CSVs on every build, so a data refresh cannot ship
# an old table, then its own harness checks the page markup.
if [ -d "$plugin/rookie-hit-rates" ]; then
	node "$here/scripts/rhr/build-summary.mjs" >/dev/null || die "rookie-hit-rates summary build failed."
	node "$here/scripts/rhr/build-summary.mjs" --check >/dev/null || die "rookie-hit-rates summary did not reproduce."
	say "rhr      summary ok"
	if [ -n "$PHP" ]; then
		"$PHP" "$here/tests/smoke-rhr-embed.php" >/dev/null || die "tests/smoke-rhr-embed.php failed. Run it to see why."
		say "rhr      smoke ok"
	fi
fi

# ---------------------------------------------------------------- 2. version

version="$(grep -m1 -oE '^ \* Version: +[0-9.]+' "$plugin/statchasers-news.php" | grep -oE '[0-9.]+$')"
stable="$(grep -m1 -oE '^Stable tag: [0-9.]+' "$plugin/readme.txt" | grep -oE '[0-9.]+$')"

[ -n "$version" ] || die "could not read the Version header."
[ "$version" = "$stable" ] || die "Version header is $version but readme.txt says $stable."

# The constant is the asset-version fallback when assets.json cannot be read,
# so a release that forgot it would keep serving the last release's ver=.
constant="$(grep -m1 -oE "^const STATCHASERS_NEWS_VERSION += '[0-9.]+'" "$plugin/statchasers-news.php" | grep -oE "[0-9.]+" || true)"
[ "$version" = "$constant" ] || die "Version header is $version but STATCHASERS_NEWS_VERSION is '${constant}'."

say "version  $version"

# ----------------------------------------------------------------- 3. loader

missing=""
for file in "$plugin"/*.php; do
	name="$(basename "$file")"
	[ "$name" = "statchasers-news.php" ] && continue
	grep -q "require_once __DIR__ . '/$name'" "$plugin/statchasers-news.php" \
		|| missing="$missing $name"
done

[ -z "$missing" ] || die "the loader does not require:$missing"

# The same for the depth charts' own loader and its includes/ directory, and the
# parent has to require that loader: an embedded tool nobody loads is the same
# mistake one level down.
depth="$plugin/depth-charts/statchasers-depth-charts.php"
[ -f "$depth" ] || die "no depth charts loader at ${depth#"$here"/}"
grep -q "require_once __DIR__ . '/depth-charts/statchasers-depth-charts.php'" "$plugin/statchasers-news.php" \
	|| die "the loader does not require depth-charts/statchasers-depth-charts.php"
grep -q "Plugin Name:" "$depth" && die "depth-charts/statchasers-depth-charts.php carries a Plugin Name header; it is not a plugin of its own."
for file in "$plugin"/depth-charts/includes/*.php; do
	name="$(basename "$file")"
	grep -q "includes/$name" "$depth" || missing="$missing depth-charts/includes/$name"
done
[ -z "$missing" ] || die "the depth charts loader does not require:$missing"

grep -q "require_once __DIR__ . '/rookie-hit-rates/rookie-hit-rates.php'" "$plugin/statchasers-news.php" \
	|| die "the loader does not require rookie-hit-rates/rookie-hit-rates.php"
grep -q "Plugin Name:" "$plugin/rookie-hit-rates/rookie-hit-rates.php" && die "rookie-hit-rates/rookie-hit-rates.php carries a Plugin Name header; it is not a plugin of its own."

say "loader   ok"

# ------------------------------------------------------------- 3b. api assets

# WEB-023: the team depth-chart route loads team.css and the team bundle from
# WordPress (statchasers-local-assets.php), and so does every page mounting the
# FPA table (fpa.css, the FPA bundle) and every player page (player.css, the
# player bundle), so the zip carries a copy of the API's BUILD OUTPUT - the
# exact bytes the API serves at /team.css, /dist/statchasers-team.js,
# /fpa.css, /dist/statchasers-fpa.js, /player.css and
# /dist/statchasers-player.js - with a manifest naming the build. Build the API
# (artifacts/api-server: node build.mjs) from the commit that is deployed, then
# run this. The plugin only uses the copy while it is that build (or
# byte-identical to it), so a stale copy costs nothing but the fallback to the
# asset host; a missing one fails here, because the zip would ship without it.
#
#   SC_API_DIST=/path/to/artifacts/api-server/public/dist   another build
#   SC_NO_API_ASSETS=1                                      a zip without them
api_dist="${SC_API_DIST:-$here/../artifacts/api-server/public/dist}"
api_out="$plugin/assets/api"
rm -rf "$api_out"

if [ "${SC_NO_API_ASSETS:-}" = "1" ]; then
	say "api      SKIPPED (SC_NO_API_ASSETS=1) - the depth-chart route, the FPA page and the player pages will load from the asset host"
else
	for need in version.json css/team.css statchasers-team.js css/fpa.css statchasers-fpa.js css/player.css statchasers-player.js; do
		[ -s "$api_dist/$need" ] || die "no $need under $api_dist - build the API first (cd artifacts/api-server && node build.mjs), or set SC_API_DIST."
	done
	api_version="$(grep -oE '"version": *"[^"]+"' "$api_dist/version.json" | sed -E 's/.*"([^"]+)"$/\1/')"
	[ -n "$api_version" ] && [ "$api_version" != "0" ] || die "$api_dist/version.json names no version."

	mkdir -p "$api_out/dist"
	cp "$api_dist/css/team.css" "$api_out/team.css"
	cp "$api_dist/statchasers-team.js" "$api_out/dist/statchasers-team.js"
	cp "$api_dist/css/fpa.css" "$api_out/fpa.css"
	cp "$api_dist/statchasers-fpa.js" "$api_out/dist/statchasers-fpa.js"
	cp "$api_dist/css/player.css" "$api_out/player.css"
	cp "$api_dist/statchasers-player.js" "$api_out/dist/statchasers-player.js"

	entry() { printf '"%s":{"sha256":"%s","bytes":%s}' "$1" "$(sha256sum "$api_out$1" | cut -d' ' -f1)" "$(wc -c < "$api_out$1" | tr -d ' ')"; }
	printf '{"version":"%s","files":{%s,%s,%s,%s,%s,%s}}\n' "$api_version" \
		"$(entry /team.css)" "$(entry /dist/statchasers-team.js)" \
		"$(entry /fpa.css)" "$(entry /dist/statchasers-fpa.js)" \
		"$(entry /player.css)" "$(entry /dist/statchasers-player.js)" > "$api_out/manifest.json"

	# Staleness is a warning, not an error: the runtime check decides.
	src="$(cd "$api_dist/../.." 2>/dev/null && pwd || true)"
	for sheet in team.css fpa.css player.css; do
		if [ -n "$src" ] && [ -f "$src/public/$sheet" ] && [ "$src/public/$sheet" -nt "$api_dist/version.json" ]; then
			say "WARNING  $src/public/$sheet is newer than the build; rebuild the API if it changed."
		fi
	done

	if [ -n "$PHP" ] && [ -f "$here/tests/smoke-local-assets.php" ]; then
		"$PHP" "$here/tests/smoke-local-assets.php" >/dev/null || die "tests/smoke-local-assets.php failed. Run it to see why."
	fi
	say "api      $api_version (team.css, dist/statchasers-team.js, fpa.css, dist/statchasers-fpa.js, player.css, dist/statchasers-player.js) from ${api_dist}"
fi

# -------------------------------------------------------------------- 4. zip

mkdir -p "$dist"
rm -f "$out"

# Zipped from the parent so the archive holds "statchasers-news/..." - WordPress
# installs the top-level directory it finds, and a flat zip installs as a plugin
# directory named after the zip instead.
( cd "$here" && zip -rq "$out" statchasers-news -x '*.DS_Store' '*/.*' )

say "wrote    ${out#"$here"/} ($(du -h "$out" | cut -f1 | tr -d ' '))"

# Every file the plugin can print a URL for has to be in the archive.
if [ -f "$api_out/manifest.json" ]; then
	listing="$(unzip -Z1 "$out")"
	for f in manifest.json team.css dist/statchasers-team.js fpa.css dist/statchasers-fpa.js player.css dist/statchasers-player.js; do
		grep -qx "statchasers-news/assets/api/$f" <<<"$listing" || die "the zip is missing statchasers-news/assets/api/$f"
	done
	# And the bytes in the archive are the ones the manifest names: a copy that
	# changed after the manifest was written would be served as the wrong build.
	for f in team.css dist/statchasers-team.js fpa.css dist/statchasers-fpa.js player.css dist/statchasers-player.js; do
		want="$(grep -oE "\"/$f\":\{\"sha256\":\"[0-9a-f]{64}\"" "$api_out/manifest.json" | grep -oE '[0-9a-f]{64}')"
		got="$(unzip -p "$out" "statchasers-news/assets/api/$f" | sha256sum | cut -d' ' -f1)"
		[ -n "$want" ] && [ "$want" = "$got" ] || die "statchasers-news/assets/api/$f in the zip does not match its manifest sha256."
	done
	say "api      in zip: assets/api/{manifest.json,team.css,dist/statchasers-team.js,fpa.css,dist/statchasers-fpa.js,player.css,dist/statchasers-player.js} (sha256 = manifest)"
fi
unzip -l "$out" | tail -n +4 | head -n -2 | awk '{ printf "         %s\n", $4 }'
