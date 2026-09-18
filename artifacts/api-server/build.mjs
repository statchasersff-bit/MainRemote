import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { readFile, rm, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

/**
 * Browser bundle for the news tool.
 *
 * The client used to be a hand-written public/app.js served as-is. It's now
 * compiled from src/client/main.ts so it can share src/lib/render.ts with the
 * server — that shared module is what lets the server-rendered HTML and any
 * client re-render come out identical. It also gives WordPress a real compiled
 * bundle to hand to wp_enqueue_script().
 */
async function buildClient() {
  const outDir = path.resolve(artifactDir, "public", "dist");
  await rm(outDir, { recursive: true, force: true });

  const shared = {
    platform: "browser",
    format: "iife",
    bundle: true,
    minify: true,
    sourcemap: "linked",
    // Matches the syntax used in src/client (optional chaining, nullish).
    target: ["es2020"],
    logLevel: "info",
  };

  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/client/main.ts")],
    outfile: path.join(outDir, "statchasers-news.js"),
  });

  // The team hub's enhancement bundle. Separate from the news bundle because
  // the two mount independently: a WordPress page with the news shortcode on it
  // should not download the team hub's code, and vice versa.
  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/client/team.ts")],
    outfile: path.join(outDir, "statchasers-team.js"),
  });

  // The player pages' enhancement bundle. Separate from the other two for the
  // same reason they are separate from each other: a WordPress page mounting
  // one shortcode should not download another tool's code.
  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/client/player.ts")],
    outfile: path.join(outDir, "statchasers-player.js"),
  });

  // Core Web Vitals reporting ships as a SEPARATE bundle, fetched at runtime
  // only when a site has configured an endpoint. Folding it into the main
  // bundle would make every visitor download monitoring code they don't use,
  // and would put it in front of the tool it's supposed to be measuring.
  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/client/vitals-entry.ts")],
    outfile: path.join(outDir, "statchasers-vitals.js"),
  });

  // A content hash over every asset WordPress enqueues. The filenames stay
  // stable (index.html references them directly); this is the `ver` query the
  // plugin appends so a deploy busts caches without renaming anything.
  const js = await readFile(path.join(outDir, "statchasers-news.js"));
  const css = await readFile(path.resolve(artifactDir, "public", "styles.css"));
  const teamJs = await readFile(path.join(outDir, "statchasers-team.js"));
  const teamCss = await readFile(path.resolve(artifactDir, "public", "team.css"));
  const playerJs = await readFile(path.join(outDir, "statchasers-player.js"));
  const playerCss = await readFile(path.resolve(artifactDir, "public", "player.css"));
  const version = createHash("sha256")
    .update(js)
    .update(css)
    .update(teamJs)
    .update(teamCss)
    .update(playerJs)
    .update(playerCss)
    .digest("hex")
    .slice(0, 12);

  await writeFile(
    path.join(outDir, "version.json"),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
  console.log(`  client asset version: ${version}`);
}

Promise.all([buildAll(), buildClient()]).catch((err) => {
  console.error(err);
  process.exit(1);
});
