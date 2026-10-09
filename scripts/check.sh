#!/usr/bin/env bash
#
# Everything that should pass before a publish, in one command:
#
#   pnpm run check
#
# There is no CI here: the Replit deployment builds straight from the
# workspace, and the GitHub remote is not pushed. So this is the gate. It runs
# every step even after one fails, then prints a summary and exits non-zero if
# anything did.
#
#   1. typecheck, every package
#   2. the api-server suite (builds first; needs DATABASE_URL, as the app does)
#   3. the three WordPress plugins: lint, version and loader checks, and zips
#      (build-zip*.sh, which run the news plugin's smoke tests)
#   4. the depth-charts plugin's route, SEO and refresh checks
#
# INGEST_SECRET is unset for the suite: the tests set their own, and one of the
# shell's leaking in has failed a run before.

set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

results=()
run() {
	local name="$1"
	shift
	printf '\n=== %s\n' "$name"
	if "$@"; then
		results+=("ok    $name")
	else
		results+=("FAIL  $name")
	fi
}

run "typecheck" pnpm run typecheck
run "api-server tests" env -u INGEST_SECRET pnpm --filter @workspace/api-server test
run "news plugin" bash wordpress-plugin/scripts/build-zip.sh
run "divi plugin" bash wordpress-plugin/scripts/build-zip-divi.sh
run "depth-charts checks" bash -c 'bash wordpress-plugin/tests/depth-charts/run-tests.sh >/dev/null'

printf '\n=== summary\n'
failed=0
for line in "${results[@]}"; do
	printf '%s\n' "$line"
	case "$line" in FAIL*) failed=1 ;; esac
done
exit "$failed"
