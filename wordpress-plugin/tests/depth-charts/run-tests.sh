#!/usr/bin/env bash
# Route sweep. Runs the plugin's routing code against WordPress stubs and
# prints what each URL would return (the tool page, a 301 to where a pre-1.7.0
# URL lives now, or a 404), then runs the assertions in checks.php (the only
# part that can fail). Uses php on PATH, else the Nix store's.
set -u
cd "$(dirname "$0")"

php="${PHP:-$(command -v php || ls -d /nix/store/*-php-with-extensions-*/bin/php 2>/dev/null | head -1)}"
php() { "$php" "$@"; }

urls=(
  "/nfl/nfl-depth-charts/"
  "/nfl/nfl-depth-charts/fantasy/"
  "/nfl/nfl-depth-charts/fantasy/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/dallas-cowboys/"
  "/nfl/nfl-depth-charts/fantasy/buffalo-bills/"
  "/nfl/nfl-depth-charts/fantasy/houston-texans/rb/"
  "/nfl/nfl-depth-charts/offense/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/not-a-real-team/"
  "/nfl/nfl-depth-charts/bogus-view/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/Houston-Texans"
  "/nfl/nfl-depth-charts/fantasy/?team=houston-texans"
)

for url in "${urls[@]}"; do
  php render-url.php "$url"
  echo
done

echo "=== Assertions ==="
php checks.php
