#!/bin/bash
# WEB-001 release check: sitemap index + pagination, dated-game canonicals,
# numbered playoff alias redirect, reversed pair, invalid week.
#
#   scripts/web001-release-check.sh [origin]        default https://statchasers.com
#   BUST=1  appends ?scv=<epoch> to every URL, to read past WP Rocket / the edge
#           before a purge (WP Rocket never caches a query-string URL)
#   SLEEP=1.6  seconds between requests (the live site 429s above ~1 req/1.5 s)
#   UA=...  defaults to an iPhone UA (Googlebot crawls as a phone)
#
# Expected after WEB-001 (plugin 1.10.61 + API d2bdecb), at week 11 of 2026:
#   index: 8 game sitemaps, 0 with lastmod; pages 1-8, page 9 = 404;
#   1,586+ URLs, 0 duplicates, 0 lastmod; by season 2021:285 2022:284
#   2023:285 2024:285 2025:285 2026:162+ (grows as games finish);
#   every dated page = 200, one canonical equal to itself, robots index;
#   /2025-postseason-week-5/ = 301 to /2025-super-bowl/; reversed pair = 301;
#   an unplayed week = 404 noindex.
O="${1:-https://statchasers.com}"; SLEEP="${SLEEP:-1.6}"
UA="${UA:-Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1}"
Q=""; [ -n "$BUST" ] && Q="?scv=$(date +%s)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
get() { sleep "$SLEEP"; curl -s -A "$UA" -o "$T/b" -w "%{http_code} %{redirect_url}" "$O$1$Q"; }
echo "=== $O $(date -u +%FT%TZ)${Q:+ (cache-busted)}"
get /wp-content/plugins/statchasers-news/readme.txt >/dev/null; echo "plugin: $(grep -m1 'Stable tag' "$T/b")"
sleep "$SLEEP"; echo "api: $(curl -s -A "$UA" https://news.statchasers.com/api/status | grep -o '"build":{[^}]*}')"
get /sitemap_index.xml >/dev/null
idx=$(tr -d '\n\t' < "$T/b" | sed 's#</sitemap>#</sitemap>\n#g' | grep -o '<sitemap><loc>[^<]*game-sitemap[0-9]*\.xml</loc>.*</sitemap>')
echo "index: game sitemaps=$(echo "$idx" | grep -c game-sitemap) with-lastmod=$(echo "$idx" | grep -c lastmod)"
: > "$T/all"; n=""; pages=0; lm=0
while :; do code=$(get "/game-sitemap$n.xml" | cut -d' ' -f1); [ "$code" = 200 ] || break; pages=$((pages+1))
  grep -o '<loc>[^<]*</loc>' "$T/b" | sed 's#<loc>[a-z]*://[^/]*##; s#</loc>##' >> "$T/all"; lm=$((lm+$(grep -c '<lastmod>' "$T/b"))); n=$((pages+1)); done
echo "game sitemap pages=$pages (next=$code) urls=$(wc -l < "$T/all") dup=$(sort "$T/all" | uniq -d | wc -l) url-lastmod=$lm"
echo "by season: $(grep -o '/[0-9]\{4\}-' "$T/all" | tr -d '/-' | sort | uniq -c | awk '{printf "%s:%s ",$2,$1}')"
P=/nfl/houston-texans-vs-indianapolis-colts
for u in $P/2026-week-11/ $P/2026-week-3/ $P/ /nfl/new-england-patriots-vs-seattle-seahawks/2025-super-bowl/ /nfl/jacksonville-jaguars-vs-tennessee-titans/2021-week-5/ /nfl/new-england-patriots-vs-seattle-seahawks/2025-postseason-week-5/ /nfl/indianapolis-colts-vs-houston-texans/2026-week-11/ $P/2026-week-30/; do
  r=$(get "$u"); c=$(grep -o '<link rel="canonical" href="[^"]*"' "$T/b" | cut -d'"' -f4 | sed 's#^[a-z]*://[^/]*##' | tr '\n' ' ')
  echo "  $r | $u | canon=[${c% }] n=$(grep -c '<link rel="canonical"' "$T/b") robots=$(grep -o '<meta name="robots" content="[^"]*"' "$T/b" | cut -d'"' -f4 | cut -d, -f1)"
done
