#!/usr/bin/env bash
#
# Package divi/statchasers-divi-teams.php as the .zip WordPress accepts at
# Plugins -> Add New -> Upload Plugin.
#
#   bash wordpress-plugin/scripts/build-zip-divi.sh
#
# The sibling of build-zip.sh. This plugin is one
# file, so the checks are the two that apply: it parses, and it has a Version
# header. The archive holds "statchasers-divi-teams/<file>", because WordPress
# installs the top-level directory it finds.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$here/divi/statchasers-divi-teams.php"
dist="$here/dist"
out="$dist/statchasers-divi-teams.zip"

PHP="${PHP:-$(command -v php || true)}"
if [ -z "$PHP" ]; then
	PHP="$(ls -d /nix/store/*-php-with-extensions-*/bin/php 2>/dev/null | head -1 || true)"
fi

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR %s\n' "$*" >&2; exit 1; }

[ -f "$src" ] || die "no plugin file at $src"

if [ -n "$PHP" ]; then
	"$PHP" -l "$src" >/dev/null || die "$(basename "$src") does not parse."
	say "parse    ok"
else
	say "parse    SKIPPED - no php binary found"
fi

version="$(grep -m1 -oE "^ \* Version: +[0-9.]+" "$src" | grep -oE '[0-9.]+$' || true)"
[ -n "$version" ] || die "could not read the Version header."
say "version  $version"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/statchasers-divi-teams" "$dist"
cp "$src" "$stage/statchasers-divi-teams/"
rm -f "$out"
( cd "$stage" && zip -rq "$out" statchasers-divi-teams )

say "wrote    ${out#"$here"/} ($(du -h "$out" | cut -f1 | tr -d ' '))"
