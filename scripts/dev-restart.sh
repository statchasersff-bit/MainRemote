#!/usr/bin/env bash
# Rebuild the api-server and restart whatever is serving the Replit preview.
#
# Editing public/*.css or public/*.html needs none of this: the dev server
# watches public/ and pushes a reload over SSE (lib/livereload.ts). Editing
# anything under src/ does, because the preview runs the bundle in dist/, and
# only a rebuild plus a fresh process picks the change up.
#
# Whoever holds the port is killed first, so this is safe to run repeatedly and
# safe to run against a server the Replit workflow started. Note that killing a
# workflow-owned server ends the workflow: the Run button will show stopped, and
# the replacement started here is detached from it.
set -euo pipefail

PORT="${PORT:-8080}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/artifacts/api-server"
ENTRY="$APP/dist/index.mjs"
LOG="${DEV_RESTART_LOG:-$APP/dev-server.log}"

# One restart at a time. build.mjs starts by removing dist/ wholesale, so two
# overlapping runs let one delete the bundle the other is about to launch -
# MODULE_NOT_FOUND, and a preview left with nothing on the port. A per-edit
# hook fires in exactly that bursty pattern, so the lock is not optional.
#
# The lock is held on fd 9 rather than through `flock <file> <cmd>`, because
# that form passes its lock descriptor down to everything it starts: the
# detached server would inherit it and hold the lock for as long as it ran,
# so the next restart would block forever instead of replacing it. Fd 9 is
# closed explicitly when the server is launched, below.
exec 9>"$APP/.dev-restart.lock"
flock -x 9

pnpm --filter @workspace/api-server run build

# The build is the only thing that writes the entry point, so if it is missing
# here the build did not produce what it reported and launching would only turn
# that into a confusing runtime error.
[ -f "$ENTRY" ] || { echo "build produced no $ENTRY" >&2; exit 1; }

# SIGTERM, then SIGKILL for anything that ignores it. `|| true` throughout: an
# empty port is the normal case on the first run.
pids="$(lsof -t -i ":$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    lsof -t -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
  pids="$(lsof -t -i ":$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
fi

# NODE_ENV=development is what arms the preview switcher, live reload and the
# no-store responses the team routes need - without it the preview is a
# production build and edits stop showing up at all.
cd "$APP"
setsid env NODE_ENV=development PORT="$PORT" \
  node --enable-source-maps "$ENTRY" > "$LOG" 2>&1 < /dev/null 9>&- &

for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null -m 2 "http://localhost:$PORT/" 2>/dev/null; then
    echo "preview restarted on :$PORT (log: $LOG)"
    exit 0
  fi
  sleep 0.5
done

echo "server did not answer on :$PORT within 20s; see $LOG" >&2
exit 1
