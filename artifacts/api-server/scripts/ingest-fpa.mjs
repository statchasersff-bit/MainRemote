#!/usr/bin/env node
/**
 * Run the Fantasy Points Allowed ingest.
 *
 *   node scripts/ingest-fpa.mjs
 *   node scripts/ingest-fpa.mjs --baseline 2025 --current 2026
 *
 * Schedule this weekly in season. It fetches two ~7MB CSVs from nflverse,
 * scores every player-week in three formats and replaces the stored figures in
 * one transaction, so running it twice leaves what running it once does.
 *
 * Deliberately a script rather than something the server does on a timer. The
 * news ingest is hung off request traffic because news goes stale in minutes;
 * FPA changes once a week, and putting a 7MB download on a request path to
 * discover that nothing has changed would be a poor trade. The server does keep
 * a one-time lazy fallback for a cold database - see lib/fpa/fpa-ssr.ts.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

// Bundled on demand with the esbuild that already builds this app, for the same
// reason tests/helpers/bundle.mjs does it: the source uses extensionless
// imports, which Node's own loader does not resolve.
const dir = await mkdtemp(path.join(appDir, ".ingest-fpa-"));

// The exit code is decided here and applied after the cleanup below, not inside
// the try: `process.exit()` does not run a pending `finally`, so exiting from
// the success path left the temporary bundle directory behind on every run.
let code = 0;

/**
 * Tell the running server its memory is stale (Phase 1, 2026-10-14).
 *
 * This script writes the table directly, so the server that serves it does
 * not see the write: it answers from in-memory state that only its own
 * writers move. With CACHE_RELOAD_URL and INGEST_SECRET set, the reload is
 * posted here; without them it is said out loud, because a silent skip is
 * how a stale page would go unexplained.
 */
async function reloadServerCaches() {
  const url = process.env.CACHE_RELOAD_URL;
  const secret = process.env.INGEST_SECRET;
  if (!url || !secret) {
    console.log(
      "Note: the running server still holds its old in-memory state. " +
        "POST /api/cache/reload with the ingest secret, or set CACHE_RELOAD_URL and INGEST_SECRET here.",
    );
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-ingest-secret": secret },
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`Cache reload: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.error(`Cache reload failed (the server still holds its old state): ${err?.message ?? err}`);
  }
}

try {
  const outfile = path.join(dir, "ingest.mjs");
  await build({
    entryPoints: [path.join(appDir, "src/lib/fpa/ingest.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Workspace packages are BUNDLED and node_modules are not. `packages:
    // "external"` would leave @workspace/db to Node, which cannot resolve a
    // directory import of TypeScript source - the package's entry point is
    // src/index.ts and it imports ./schema.
    external: ["pg", "pg-native", "pino", "pino-pretty", "thread-stream", "*.node"],
    logLevel: "silent",
  });

  const { ingestFpa } = await import(pathToFileURL(outfile).href);

  const result = await ingestFpa({
    baselineSeason: arg("baseline", undefined),
    currentSeason: arg("current", undefined),
  });

  console.log(
    `FPA ingest complete: ${result.snapshotRows} snapshot rows, ` +
      `${result.gameRows} game rows, mode ${result.dataMode}` +
      (result.isPreseason ? " (preseason)" : ` (week ${result.weekNumber})`),
  );
  await reloadServerCaches();
} catch (err) {
  console.error("FPA ingest failed:", err?.stack ?? err);
  code = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

// Explicit, because the database pool keeps the loop alive and the process
// would otherwise hang after the work is done.
process.exit(code);
