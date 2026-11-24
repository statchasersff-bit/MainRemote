#!/usr/bin/env bash
#
# Package statchasers-rookie-hit-rates/ (the standalone Rookie Hit Rates
# plugin, [rookie_hit_rates], used by /nfl/rookie-hit-rates/) as an upload zip.
#
#   bash wordpress-plugin/scripts/build-zip-rhr.sh
#
# The app/ folder is the upstream Vite build (statchasersff-bit/Rookie-Hit-Rate,
# script/build-wp-plugin.sh). A dataset refresh means new app/data/*.csv from
# there; this script then REGENERATES summary/hit-rates-summary.json from those
# CSVs before zipping, so the table printed in the page can never describe an
# older dataset than the iframe loads.
#
#   1. summary  regenerated from app/data with the tool's own calculation
#   2. parse    every .php file
#   3. smoke    tests/smoke-rhr-embed.php
#   4. version  Version header == readme Stable tag
#   5. zip      dist/statchasers-rookie-hit-rates-<version>.zip

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plugin="$here/statchasers-rookie-hit-rates"
dist="$here/dist"

PHP="${PHP:-$(command -v php || true)}"
if [ -z "$PHP" ]; then
	for cand in /nix/store/*-php-with-extensions-*/bin/php; do
		[ -x "$cand" ] && "$cand" -r 'exit(function_exists("mb_strlen")?0:1);' && { PHP="$cand"; break; }
	done
fi

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR %s\n' "$*" >&2; exit 1; }

[ -d "$plugin" ] || die "no plugin directory at $plugin"

node "$here/scripts/rhr/build-summary.mjs" || die "summary build failed"
node "$here/scripts/rhr/build-summary.mjs" --check >/dev/null || die "summary did not reproduce"

if [ -n "$PHP" ]; then
	count=0
	while IFS= read -r file; do
		"$PHP" -l "$file" >/dev/null || die "${file#"$plugin"/} does not parse."
		count=$(( count + 1 ))
	done < <(find "$plugin" -name '*.php' -type f | sort)
	say "parse    ok ($count files)"
	"$PHP" "$here/tests/smoke-rhr-embed.php" || die "tests/smoke-rhr-embed.php failed."
else
	die "no php binary found"
fi

version="$(grep -m1 -oE '^ \* Version: +[0-9.]+' "$plugin/statchasers-rookie-hit-rates.php" | grep -oE '[0-9.]+$')"
stable="$(grep -m1 -oE '^Stable tag: [0-9.]+' "$plugin/readme.txt" | grep -oE '[0-9.]+$')"
[ -n "$version" ] && [ "$version" = "$stable" ] || die "Version header is '$version' but readme.txt says '$stable'."
say "version  $version"

mkdir -p "$dist"
out="$dist/statchasers-rookie-hit-rates-$version.zip"
rm -f "$out"
# From the parent, so the archive holds statchasers-rookie-hit-rates/... and
# WordPress replaces the installed folder of the same name.
( cd "$here" && zip -rqX "$out" statchasers-rookie-hit-rates -x '*.DS_Store' '*/.*' )
say "wrote    ${out#"$here"/} ($(du -h "$out" | cut -f1 | tr -d ' ')) sha256 $(sha256sum "$out" | cut -c1-16)"
