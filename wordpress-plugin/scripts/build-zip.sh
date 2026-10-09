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

say "loader   ok"

# -------------------------------------------------------------------- 4. zip

mkdir -p "$dist"
rm -f "$out"

# Zipped from the parent so the archive holds "statchasers-news/..." - WordPress
# installs the top-level directory it finds, and a flat zip installs as a plugin
# directory named after the zip instead.
( cd "$here" && zip -rq "$out" statchasers-news -x '*.DS_Store' '*/.*' )

say "wrote    ${out#"$here"/} ($(du -h "$out" | cut -f1 | tr -d ' '))"
unzip -l "$out" | tail -n +4 | head -n -2 | awk '{ printf "         %s\n", $4 }'
