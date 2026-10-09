#!/usr/bin/env bash
# Verify the INITIAL server response for the depth-chart URLs on a live site.
# curl never runs JavaScript, so everything it prints came from PHP.
#
#   ./verify-live.sh                          # defaults to https://statchasers.com
#   ./verify-live.sh https://staging.example.com
set -u
BASE="${1:-https://statchasers.com}"
TOOL="$BASE/nfl/nfl-depth-charts"

# Cache-busting is deliberate: we want the origin's answer, not a CDN copy.
CURL=(curl -sS --compressed -A "Mozilla/5.0 (compatible; SCDC-verify)" -H 'Cache-Control: no-cache')

head_tags() {
  "${CURL[@]}" "$1" \
    | grep -oiE '<title>[^<]*</title>|<meta[^>]+name="description"[^>]*>|<link[^>]+rel="canonical"[^>]*>|<h1[^>]*>[^<]*</h1>' \
    | sed 's/^/    /'
}

status_of() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$1"; }
redirect_of() { "${CURL[@]}" -o /dev/null -w '%{redirect_url}' "$1"; }

section() { printf '\n=== %s\n' "$1"; }

section "$TOOL/  (the one address; its own page title + canonical)  [$(status_of "$TOOL/")]"
head_tags "$TOOL/"
printf '    team-link anchors in the markup: %s (must be 0)\n' \
  "$("${CURL[@]}" "$TOOL/" | grep -c 'data-scdc-team-link' || true)"

section 'Pre-1.7.0 team routes must 301 to the team pages'
for team in houston-texans dallas-cowboys buffalo-bills; do
  u="$TOOL/fantasy/$team/"
  printf '    %s %s -> %s\n' "$(status_of "$u")" "$u" "$(redirect_of "$u")"
done

section 'Pre-1.7.0 view routes and ?team= must 301'
for u in "$TOOL/fantasy/" "$TOOL/offense/all-teams/wr/" "$TOOL/fantasy/Houston-Texans" "$TOOL/?team=houston-texans"; do
  printf '    %s %s -> %s\n' "$(status_of "$u")" "$u" "$(redirect_of "$u")"
done

section 'Invalid slugs must 404 (not 200, not a soft 404)'
for bad in not-a-real-team random-keyword houston-texans-2; do
  printf '    %s  %s/fantasy/%s/\n' "$(status_of "$TOOL/fantasy/$bad/")" "$TOOL" "$bad"
done

section 'The retired sitemap is gone'
printf '    %s  %s/nfl-depth-charts-sitemap.xml\n' "$(status_of "$BASE/nfl-depth-charts-sitemap.xml")" "$BASE"

section 'Googlebot must be able to fetch the depth-chart data'
printf '    robots.txt uploads rules: %s\n' \
  "$("${CURL[@]}" "$BASE/robots.txt" | grep -iE 'wp-content|uploads' | tr '\n' ';' || echo none)"
