#!/usr/bin/env bash
# WEB-003: the league depth-chart page and one club's Depth Chart tab on
# statchasers.com, desktop then iPhone, 2 s apart. Read-only.
# Prints status, cf-cache-status, age, Cache-Control, X-SC-Depth-Cache, the
# league page's ?v= (the publication id) and the club's QB1 on the tab.
#   measure.sh public ""                     normal URLs (edge)
#   measure.sh origin "?zz=$(date +%s)"      edge + WP Rocket bypassed (WordPress render)
#   TEAM=dallas-cowboys measure.sh public ""
# usage: measure.sh <label> <query-suffix>
label=$1; q=$2; team=${TEAM:-buffalo-bills}
desktop="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
phone="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
for p in "nfl/nfl-depth-charts/" "nfl/teams/$team/depth-chart/"; do
  for kind in desktop phone; do
    ua=$desktop; [ "$kind" = phone ] && ua=$phone
    f=$(mktemp)
    m=$(curl -s -o "$f" -D "$f.h" -A "$ua" --max-time 90 -w '%{http_code} %{time_total}' "https://statchasers.com/$p$q")
    h() { tr -d '\r' < "$f.h" | awk -F': ' -v k="$1" 'tolower($1)==k{print $2}'; }
    v=$(grep -oE 'depth-charts\.json\?v=[0-9]+' "$f" | head -1 | sed 's/.*=//')
    qb=$(tr '<' '\n' < "$f" | grep -A40 -m1 'data-pos="QB" data-slot="qb"' | grep -m1 'sct-depth-name-long"' | sed 's/.*>//')
    printf '%s\t/%s\t%s\t%s\tcf=%s\tage=%s\tcc=%s\tx-sc=%s\tv=%s\tqb1=%s\n' "$label" "$p" "$kind" "$m" "$(h cf-cache-status)" "$(h age)" "$(h cache-control)" "$(h x-sc-depth-cache)" "${v:--}" "${qb:--}"
    rm -f "$f" "$f.h"; sleep 2
  done
done
