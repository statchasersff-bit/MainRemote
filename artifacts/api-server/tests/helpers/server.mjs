/**
 * Boots the built server on a free port for the test run and tears it down
 * afterwards. Tests run against the real compiled artefacts - dist/index.mjs
 * and public/dist/*.js - because the point of this suite is to catch a build
 * or plugin change that quietly breaks the crawlable output, and testing
 * source modules directly would miss exactly that.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * @param {Record<string,string>} env Extra environment for the server process.
 * @param {{cwd?: string}} [options] `cwd` starts the server from another
 *   directory, as the deployment does, to catch paths resolved from cwd.
 * @returns {Promise<{origin: string, stop: () => Promise<void>}>}
 */
export async function startServer(env = {}, options = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(APP_DIR, "dist", "index.mjs")], {
    cwd: options.cwd ?? APP_DIR,
    env: {
      ...process.env,
      // No live ingest during tests. Two reasons: the suite shouldn't depend on
      // a third-party feed being up, and a background ingest landing mid-run
      // legitimately changes the content version - which would make the ETag
      // and "last updated" assertions flap for reasons that aren't bugs. The
      // tests read the data already in the database.
      DYNASTY_NEWS_API_URL: "",
      // Open unless a test locks it (tests/embed-key.test.mjs). A key set as a
      // Replit secret reaches this shell too, and would 403 every other suite.
      SC_EMBED_KEY: "",
      SC_BROWSER_PROXY: "",
      ...env,
      PORT: String(port),
      // Overridable, because the development-only surfaces - the preview
      // switcher and the /preview/* harness - are otherwise untestable: their
      // single guard is this variable, so a suite that can only ever set it to
      // "test" can assert that they are ABSENT and nothing about whether they
      // are correct when present. That gap is how a tool went missing from the
      // switcher for a whole release.
      NODE_ENV: env.NODE_ENV ?? "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // BOTH pipes must be drained. The server logs every request through pino, so
  // an unread stdout pipe fills its buffer and the server process blocks
  // forever mid-write - which looks exactly like a hung test suite.
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
  });
  child.stdout.resume();

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (${child.exitCode}):\n${stderr}`);
    }
    try {
      const res = await fetch(`${origin}/api/healthz`);
      if (res.ok) {
        return {
          origin,
          stop: () =>
            new Promise((resolve) => {
              child.once("exit", () => resolve());
              child.kill("SIGTERM");
            }),
        };
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  child.kill("SIGKILL");
  throw new Error(`Server did not become healthy in time:\n${stderr}`);
}
