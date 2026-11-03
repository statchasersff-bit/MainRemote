#!/usr/bin/env bash
# Refresh the team hubs' depth-chart snapshot BY HAND.
#
# There is no automatic refresh and no push from WordPress (mak, 2026-11-03):
# the hub renders data/depth-charts/statchasers/depth-charts.json, and this
# is the only thing that moves it. It runs the plugin's own refresh (ESPN,
# Footballguys, FantasyPros) through the test shims, exactly as the WP admin
# button would, then prints the new stamp. Commit the two files it rewrites
# and publish; on the preview run scripts/dev-restart.sh (the data stamp is
# read once per process).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/artifacts/api-server/data/depth-charts"

php="${PHP:-$(command -v php || ls -d /nix/store/*-php-with-extensions-*/bin/php 2>/dev/null | head -1)}"
if [ -z "$php" ]; then
  echo "php not found (set PHP=/path/to/php)" >&2
  exit 1
fi

"$php" "$ROOT/wordpress-plugin/tests/depth-charts/snapshot.php" "$OUT" 2>"$OUT/../.depth-snapshot.log" || {
  echo "refresh failed; the request log is $OUT/../.depth-snapshot.log" >&2
  exit 1
}
rm -f "$OUT/../.depth-snapshot.log"

node -e '
const d = require(process.argv[1]);
const teams = d.teams.length, slotted = d.teams.filter((t) => t.slots && t.slots.length).length;
console.log(`snapshot: ${teams} teams (${slotted} with slot rows), fetched ${d.fetchedAt}`);
' "$OUT/statchasers/depth-charts.json"
echo "next: commit artifacts/api-server/data/depth-charts/statchasers/{depth-charts,meta}.json and publish; preview: scripts/dev-restart.sh"
