#!/usr/bin/env bash
# Purge statchasers.com, then warm it: the one way to purge after a release.
#
# Why this exists (SEO investigation, 2026-11-20): every publish is followed
# by a purge, and the purge throws away what the server's boot-time warm
# crawl (lib/live-warm.ts) just filled. Afterwards every page was a cold
# render for whoever asked first - Googlebot included: 1.56 s median, 4.3 s
# p90, 18 s worst over 169 live URLs that afternoon, against 0.07-0.1 s for a
# cached copy. And phones have their own copy of every page (WP Rocket's
# mobile cache and Rocket.net's edge); a desktop request warms nothing for
# the smartphone crawler Google indexes with.
#
# Order, each step only after the one before succeeded:
#   1. WP Rocket: rocket_clean_domain() (desktop and mobile files) and
#      rocket_clean_minify(), over SSH with WP-CLI.
#   2. Rocket.net edge: `wp cdn purge`.
#   3. Check: a probe page must answer MISS/EXPIRED (not HIT) as a desktop
#      AND as a phone, so the warm fills fresh renders, not stale ones.
#   4. Warm as a phone: every sitemap page (teams, player hubs, player tabs).
#   5. Warm as a desktop: teams and player hubs.
# At 1.6 s a page (the site rate-limits above ~1 request / 1.5 s) step 4 is
# about 2 h and step 5 about 25 min; run it in the background:
#   nohup scripts/purge-and-warm.sh > ~/purge-and-warm.log 2>&1 &
#
# Options:
#   --no-purge    skip steps 1-3 (warm only, e.g. after mak purged by hand)
#   --quick       phones get teams + hubs only (no player tabs): ~50 min total
#   --limit <n>   pass through to warm-live (testing)
#   --dry-run     print what would run, touch nothing
#
# Needs: the SSH config in .local/ssh (see memory: rocket-ssh-access) for
# steps 1-2; node for steps 4-5. Read-only for the app: it only GETs pages.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The main checkout, also from a git worktree (.local/ssh lives only there).
WORKSPACE="$(cd "$(git -C "$HERE" rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd || (cd "$HERE/../../.." && pwd))"
SSH_CONFIG="${SC_SSH_CONFIG:-$WORKSPACE/.local/ssh/config}"
SSH_HOST="${SC_SSH_HOST:-rocket-statchasers}"
SITE="https://statchasers.com"
PROBE="$SITE/nfl/teams/kansas-city-chiefs/"
DESKTOP_UA="Mozilla/5.0 (X11; Linux x86_64) Chrome/120 StatChasers-WarmLive/1 (+https://statchasers.com)"
PHONE_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 StatChasers-WarmLive/1"

purge=1 quick=0 dry=0 limit=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-purge) purge=0 ;;
    --quick) quick=1 ;;
    --dry-run) dry=1 ;;
    --limit) shift; limit=(--limit "${1:?--limit needs a number}") ;;
    *) echo "purge-and-warm: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '[purge-and-warm] %s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
run() { if [ "$dry" = 1 ]; then say "dry-run: $*"; else "$@"; fi; }
remote() { run ssh -F "$SSH_CONFIG" -o BatchMode=yes "$SSH_HOST" "cd ~/public_html && $1"; }

cache_status() { # $1 = user agent; prints the edge's cf-cache-status for the probe
  curl -s -o /dev/null -D - -A "$1" "$PROBE" | tr -d '\r' | awk -F': ' 'tolower($1)=="cf-cache-status"{print toupper($2)}'
}

if [ "$purge" = 1 ]; then
  say "1/5 WP Rocket: clean domain (desktop + mobile) and minify"
  remote 'wp eval "rocket_clean_domain(); rocket_clean_minify();"'
  say "2/5 Rocket.net edge purge"
  remote 'wp cdn purge'
  say "3/5 probe check: $PROBE"
  if [ "$dry" = 0 ]; then
    sleep 5
    for ua in "$DESKTOP_UA" "$PHONE_UA"; do
      status="$(cache_status "$ua")"
      kind=desktop; [ "$ua" = "$PHONE_UA" ] && kind=phone
      say "  $kind: ${status:-no cf-cache-status}"
      if [ "$status" = "HIT" ]; then
        say "  the $kind copy is still cached after the purge: stopping before warming stale pages"
        say "  (see memory rocket-net-edge-purge: the Rocket.net dashboard purge is the full-site fallback)"
        exit 1
      fi
      sleep 2
    done
  fi
else
  say "purge skipped (--no-purge)"
fi

tabs=(--all-tabs); [ "$quick" = 1 ] && tabs=()
say "4/5 warm as a phone: ${tabs[*]:-teams + hubs}"
run node "$HERE/warm-live.mjs" --mobile "${tabs[@]}" "${limit[@]}"
say "5/5 warm as a desktop: teams + hubs"
run node "$HERE/warm-live.mjs" "${limit[@]}"
say "done"
