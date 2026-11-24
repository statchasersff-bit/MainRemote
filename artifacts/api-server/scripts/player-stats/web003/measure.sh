#!/usr/bin/env bash
# WEB-002/WEB-003: one request per stats route against statchasers.com, 2 s apart.
# Prints status, TTFB/total, cf-cache-status, age, whether WP Rocket served the
# file, rows, Weeks, Updated and Last-Modified. UA=... overrides the agent.
#   measure.sh public ""           normal URLs (edge)
#   measure.sh origin "?zz=$(date +%s)"   edge + WP Rocket bypassed (WordPress render)
# usage: measure.sh <label> <query-suffix>   one request per route, 2 s apart
label=$1; q=$2; UA=${UA:-"Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36"}
for p in "" rb/ wr/ te/; do
  f=$(mktemp)
  m=$(curl -s -o "$f" -D "$f.h" -A "$UA" --max-time 90 -w '%{http_code} %{time_starttransfer} %{time_total}' "https://statchasers.com/nfl/nfl-player-stats/$p$q")
  cf=$(tr -d '\r' < "$f.h" | awk -F': ' 'tolower($1)=="cf-cache-status"{print $2}')
  age=$(tr -d '\r' < "$f.h" | awk -F': ' 'tolower($1)=="age"{print $2}')
  lm=$(tr -d '\r' < "$f.h" | awk -F': ' 'tolower($1)=="last-modified"{print $2}')
  rocket=$(grep -c "This website is like a Rocket" "$f")
  rows=$(grep -o 'class="sca-row' "$f" | wc -l)
  wk=$(grep -oE 'Weeks [0-9]+–[0-9]+' "$f" | head -1)
  upd=$(grep -oE 'sca-meta-updated">Updated <time datetime="[^"]+">[^<]+' "$f" | sed 's/.*">//' | head -1)
  end=$(grep -c '</html>' "$f")
  printf '%s\t/%s\t%s\tcf=%s\tage=%s\trocket=%s\trows=%s\t%s\t%s\thtmlend=%s\tlm=%s\n' "$label" "$p" "$m" "${cf:--}" "${age:--}" "$rocket" "$rows" "$wk" "$upd" "$end" "$lm"
  rm -f "$f" "$f.h"; sleep 2
done
