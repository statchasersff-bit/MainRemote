#!/usr/bin/env bash
#
# Package statchasers-depth-charts/ as the .zip WordPress accepts at
# Plugins -> Add New -> Upload Plugin.
#
#   bash wordpress-plugin/scripts/build-zip-depth.sh
#
# Sibling to build-zip.sh, which does the same job for statchasers-news. They
# are two scripts rather than one parameterized script because the two plugins
# are not the same shape: statchasers-news is a flat directory of shortcode
# files whose loader requires each of them by name, while this one is a class
# per concern under includes/. The checks below are the same three ideas, asked
# the way this layout can answer them.
#
#   1. Every .php file parses.
#   2. The Version header and SCDC_VERSION agree.
#   3. The loader requires every file in includes/.
#
# Check 3 is the one that matters here for the same reason it does next door: a
# class file added to includes/ and never added to the require block is absent
# on a real site, and nothing says why - the shortcode simply renders nothing.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plugin="$here/statchasers-depth-charts"
loader="$plugin/statchasers-depth-charts.php"
dist="$here/dist"
out="$dist/statchasers-depth-charts.zip"

# Nix keeps PHP out of PATH on this box; use whatever is there, and skip the
# parse check rather than fail the build if there is no interpreter at all.
PHP="${PHP:-$(command -v php || true)}"
if [ -z "$PHP" ]; then
	PHP="$(ls -d /nix/store/*-php-with-extensions-*/bin/php 2>/dev/null | head -1 || true)"
fi

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR %s\n' "$*" >&2; exit 1; }

[ -d "$plugin" ] || die "no plugin directory at $plugin"
[ -f "$loader" ] || die "no loader at $loader"

# ------------------------------------------------------------------ 1. parse

if [ -n "$PHP" ]; then
	count=0
	while IFS= read -r file; do
		"$PHP" -l "$file" >/dev/null || die "$(basename "$file") does not parse."
		count=$(( count + 1 ))
	done < <(find "$plugin" -name '*.php' -type f)
	say "parse    ok ($count files)"
else
	say "parse    SKIPPED - no php binary found"
fi

# ---------------------------------------------------------------- 2. version

# The plugin carries its version twice: the header WordPress reads on the
# Plugins screen, and the SCDC_VERSION constant that cache-busts the enqueued
# CSS and JS. When they drift, the site shows the new number and serves the old
# stylesheet from the browser cache.
version="$(grep -m1 -oE "^ \* Version: +[0-9.]+" "$loader" | grep -oE '[0-9.]+$')"
constant="$(grep -m1 -oE "define\( 'SCDC_VERSION', '[0-9.]+'" "$loader" | grep -oE "[0-9.]+")"

[ -n "$version" ] || die "could not read the Version header."
[ -n "$constant" ] || die "could not read SCDC_VERSION."
[ "$version" = "$constant" ] || die "Version header is $version but SCDC_VERSION is $constant."

say "version  $version"

# ----------------------------------------------------------------- 3. loader

missing=""
for file in "$plugin"/includes/*.php; do
	name="$(basename "$file")"
	grep -q "includes/$name" "$loader" || missing="$missing $name"
done

[ -z "$missing" ] || die "the loader does not require:$missing"

say "loader   ok"

# -------------------------------------------------------------------- 4. zip

mkdir -p "$dist"
rm -f "$out"

# Zipped from the parent so the archive holds "statchasers-depth-charts/..." -
# WordPress installs the top-level directory it finds, and a flat zip installs
# as a plugin directory named after the zip instead.
( cd "$here" && zip -rq "$out" statchasers-depth-charts -x '*.DS_Store' '*/.*' )

say "wrote    ${out#"$here"/} ($(du -h "$out" | cut -f1 | tr -d ' '))"
unzip -l "$out" | tail -n +4 | head -n -2 | awk '{ printf "         %s\n", $4 }'
