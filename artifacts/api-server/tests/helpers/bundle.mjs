/**
 * Import one `src` module directly, without starting a server.
 *
 * Every other test here drives the real HTTP surface, which is the right way to
 * test a route. It is the wrong way to test a parser: "does CDATA survive" and
 * "does a feed with one item parse as a list" are questions about ten lines of
 * code, and reaching them through a server means a database, a connection pool,
 * a log transport on its own thread, and 32 outbound requests standing between
 * the assertion and the thing it is asserting.
 *
 * So the module is bundled on demand with the esbuild that already builds this
 * app, and imported. Only modules that import nothing stateful are worth
 * reaching this way — that is why lib/news-merge.ts and lib/club-feed-parse.ts
 * are separate files at all.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const dirs = [];

/**
 * Bundle `src/<relative>.ts` and return its exports.
 *
 * Bundled rather than type-stripped: these modules use extensionless imports
 * (`from "./news-item"`), which TypeScript resolves and Node's own loader does
 * not, so stripping types alone would fail on the first import.
 */
export async function importModule(relative) {
  // Under the app rather than in os.tmpdir(): the bundle leaves its third-party
  // imports external (see below), and Node resolves those by walking up from the
  // file, which from /tmp finds no node_modules at all.
  const dir = await mkdtemp(path.join(APP_DIR, ".test-bundle-"));
  dirs.push(dir);
  const outfile = path.join(dir, "module.mjs");

  await build({
    entryPoints: [path.join(APP_DIR, "src", `${relative}.ts`)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Third-party code is left to Node to resolve from node_modules, so a
    // bundle of a 200-line parser does not also contain fast-xml-parser.
    packages: "external",
    logLevel: "silent",
  });

  return import(pathToFileURL(outfile).href);
}

/** Remove the temporary bundles. Call from a test file's `after`. */
export async function cleanupBundles() {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
