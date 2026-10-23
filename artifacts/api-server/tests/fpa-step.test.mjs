/**
 * The FPA ingest as a builder child (2026-10-23).
 *
 * live-refresh.ts used to run the ingest inside the server, and one run left
 * ~300 MB resident behind for the life of the process. Now it is a child
 * (scripts/ingest-fpa.mjs) and the parent only drops its caches and records
 * the outcome for /api/status. These cover the summary parser, the opt-in
 * flag, the status bookkeeping, and - when a database is at hand - one real
 * child run end to end.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Bundled the way scripts/ingest-fpa.mjs bundles itself, not through
// helpers/bundle.mjs: that helper leaves every package to Node, and
// lib/fpa/refresh reaches @workspace/db, whose entry is TypeScript source
// with a directory import Node cannot resolve. Workspace packages bundled,
// node_modules external.
const dir = await mkdtemp(path.join(APP_DIR, ".test-bundle-"));
const entry = path.join(dir, "entry.ts");
const outfile = path.join(dir, "module.mjs");
await writeFile(
  entry,
  `export { refreshFpaStep, parseFpaSummary, fpaInProcess } from "../src/lib/player/live-refresh";
   export { fpaRefreshStatus, recordFpaRefresh } from "../src/lib/fpa/refresh";`,
  "utf8",
);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  plugins: [
    {
      name: "workspace-only",
      setup(b) {
        // Bare imports stay external (native modules among them); only the
        // @workspace/* packages are bundled, for the reason above.
        b.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (args.pluginData?.resolving || args.path.startsWith("@workspace/")) return undefined;
          // Resolved from the importer's own directory, then left external as
          // an absolute path: lib/db's dependencies live in lib/db's
          // node_modules, which a bare specifier in this bundle could not reach.
          const r = await b.resolve(args.path, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            pluginData: { resolving: true },
          });
          if (r.errors.length || !r.path) return { path: args.path, external: true };
          return { path: r.path, external: true };
        });
      },
    },
  ],
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outfile).href);

after(() => rm(dir, { recursive: true, force: true }));

describe("parseFpaSummary", () => {
  test("reads the child's in-season summary line", () => {
    const out =
      "Note: the running server still holds its old in-memory state.\n" +
      "FPA ingest complete: 96 snapshot rows, 8397 game rows, mode week_7 (week 7)\n";
    assert.deepEqual(mod.parseFpaSummary(out), {
      snapshotRows: 96,
      gameRows: 8397,
      dataMode: "week_7",
      weekNumber: 7,
    });
  });

  test("reads the preseason line with no week", () => {
    const out = "FPA ingest complete: 96 snapshot rows, 4200 game rows, mode preseason_baseline (preseason)\n";
    assert.deepEqual(mod.parseFpaSummary(out), {
      snapshotRows: 96,
      gameRows: 4200,
      dataMode: "preseason_baseline",
      weekNumber: null,
    });
  });

  test("is null for anything else", () => {
    assert.equal(mod.parseFpaSummary(""), null);
    assert.equal(mod.parseFpaSummary("FPA ingest failed: boom"), null);
  });
});

describe("fpaInProcess", () => {
  test("off unless SC_FPA_IN_PROCESS opts in", () => {
    const prior = process.env.SC_FPA_IN_PROCESS;
    try {
      delete process.env.SC_FPA_IN_PROCESS;
      assert.equal(mod.fpaInProcess(), false);
      process.env.SC_FPA_IN_PROCESS = "0";
      assert.equal(mod.fpaInProcess(), false);
      process.env.SC_FPA_IN_PROCESS = "1";
      assert.equal(mod.fpaInProcess(), true);
    } finally {
      if (prior === undefined) delete process.env.SC_FPA_IN_PROCESS;
      else process.env.SC_FPA_IN_PROCESS = prior;
    }
  });
});

describe("recordFpaRefresh", () => {
  test("a failure then a success leave /api/status with one account", () => {
    mod.recordFpaRefresh({ ok: false, error: "nflverse 503" });
    let s = mod.fpaRefreshStatus();
    assert.equal(s.lastError, "nflverse 503");
    assert.equal(s.consecutiveFailures, 1);
    assert.ok(s.lastAttemptMs);

    mod.recordFpaRefresh({
      ok: true,
      result: { snapshotRows: 96, gameRows: 10, weekNumber: 7, dataMode: "week_7" },
    });
    s = mod.fpaRefreshStatus();
    assert.equal(s.lastError, null);
    assert.equal(s.consecutiveFailures, 0);
    assert.equal(s.lastSuccessMs, s.lastAttemptMs);
    assert.deepEqual(s.lastResult, { snapshotRows: 96, gameRows: 10, weekNumber: 7, dataMode: "week_7" });
    assert.equal(s.running, false);
  });
});

describe("refreshFpaStep (child)", { skip: !process.env.DATABASE_URL && "needs DATABASE_URL" }, () => {
  test("runs scripts/ingest-fpa.mjs and records its figures", async () => {
    const before = Date.now();
    const ok = await mod.refreshFpaStep("test");
    assert.equal(ok, true);
    const s = mod.fpaRefreshStatus();
    assert.equal(s.lastError, null);
    assert.ok(s.lastSuccessMs >= before, "success stamped by this run");
    assert.ok(s.lastResult && s.lastResult.gameRows > 0, `figures parsed from the child: ${JSON.stringify(s.lastResult)}`);
    assert.ok(/^week_\d+$|^preseason_baseline$/.test(s.lastResult.dataMode));
  });
});
