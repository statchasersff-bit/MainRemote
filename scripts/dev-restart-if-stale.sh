#!/usr/bin/env bash
# Stop-hook entry point: restart the Replit preview, but only when it is stale.
#
# The Stop hook fires at the end of every turn, including turns that touched no
# code and the ones a clear/resume/compact triggers, so the check has to be
# cheap and has to say "nothing to do" most of the time. Two things make it
# stale, and neither is true on an ordinary turn:
#
#   * a file under src/ is newer than the bundle in dist/ — the preview serves
#     dist/, so a src/ edit is invisible until it is rebuilt; or
#   * nothing is listening on the port at all — the server died, or a previous
#     restart took the Replit workflow down with it.
#
# public/*.css and public/*.html are deliberately NOT checked: the dev server
# watches public/ and already pushes a reload over SSE (lib/livereload.ts).
set -uo pipefail

PORT="${PORT:-8080}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/artifacts/api-server"
ENTRY="$APP/dist/index.mjs"

emit() { printf '{"systemMessage": %s}\n' "$1"; }

stale=""
if [ ! -f "$ENTRY" ]; then
  stale="no build yet"
elif [ -n "$(find "$APP/src" -type f -newer "$ENTRY" -print -quit 2>/dev/null)" ]; then
  stale="src/ newer than the running bundle"
elif ! lsof -t -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  stale="nothing listening on :$PORT"
fi

[ -z "$stale" ] && exit 0

if out="$("$ROOT/scripts/dev-restart.sh" 2>&1)"; then
  emit "\"Replit preview rebuilt and restarted on :$PORT ($stale).\""
else
  # Never fail the turn over a dev server. Say what happened and let the
  # transcript carry the detail.
  emit "\"Preview restart FAILED ($stale). Last lines:\\n$(printf '%s' "$out" | tail -3 | sed 's/["\\]/\\&/g; s/$/\\n/' | tr -d '\n')\""
fi
exit 0
