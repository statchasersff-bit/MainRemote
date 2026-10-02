/**
 * The inbound-route watchdog (src/lib/watchdog.ts).
 *
 * Drives watchdogTick with injected probes — no timers, no network — through
 * the three stories that matter: the proxy losing the VM while localhost
 * still answers (the 10-01/10-02 outage signature, three strikes then exit),
 * a blip that recovers before the third strike, and the restart kill-switch.
 */

import test, { describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let watchdogTick;
let watchdogEnabled;
before(async () => {
  ({ watchdogTick, watchdogEnabled } = await importModule("lib/watchdog"));
});
after(cleanupBundles);

const saved = {};
beforeEach(() => {
  for (const k of ["SC_WATCHDOG", "SC_WATCHDOG_RESTART", "SC_SELF_URL", "NODE_ENV"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** probe fn from a map of url-substring -> result; notes and exits recorded. */
function harness(answers) {
  const calls = { notes: [], exits: [] };
  const deps = {
    probe: async (url) => {
      for (const [needle, result] of Object.entries(answers)) {
        if (url.includes(needle)) return result;
      }
      return "ok";
    },
    exit: (code) => calls.exits.push(code),
    note: (line) => calls.notes.push(line),
  };
  return { deps, calls };
}

describe("watchdogEnabled", () => {
  test("defaults to production only, SC_WATCHDOG overrides both ways", () => {
    assert.equal(watchdogEnabled(), false);
    process.env.NODE_ENV = "production";
    assert.equal(watchdogEnabled(), true);
    process.env.SC_WATCHDOG = "0";
    assert.equal(watchdogEnabled(), false);
    delete process.env.NODE_ENV;
    process.env.SC_WATCHDOG = "1";
    assert.equal(watchdogEnabled(), true);
  });
});

describe("watchdogTick", () => {
  test("inbound-only failure: three strikes, named as the proxy losing the VM, then exit(1)", async () => {
    const { deps, calls } = harness({ "replit.app": "timed out", "127.0.0.1": "ok" });
    const state = { publicFailures: 0 };
    await watchdogTick(state, 8080, deps);
    await watchdogTick(state, 8080, deps);
    assert.equal(calls.exits.length, 0, "no exit before the third strike");
    await watchdogTick(state, 8080, deps);
    assert.deepEqual(calls.exits, [1]);
    assert.match(calls.notes[0], /FAILED \(1\/3\)/);
    assert.match(calls.notes[0], /inbound-only failure, the proxy has lost this VM/);
    assert.match(calls.notes.at(-1), /exiting for a supervisor restart/);
  });

  test("localhost failing too is named as the app wedged, and still exits", async () => {
    const { deps, calls } = harness({ "replit.app": "timed out", "127.0.0.1": "fetch failed" });
    const state = { publicFailures: 2 };
    await watchdogTick(state, 8080, deps);
    assert.deepEqual(calls.exits, [1]);
    assert.match(calls.notes[0], /also failing \(fetch failed\) — the app is wedged/);
  });

  test("a recovery resets the count and says so once", async () => {
    const { deps, calls } = harness({ "replit.app": "timed out" });
    const state = { publicFailures: 0 };
    await watchdogTick(state, 8080, deps);
    assert.equal(state.publicFailures, 1);
    const healthy = harness({});
    await watchdogTick(state, 8080, healthy.deps);
    assert.equal(state.publicFailures, 0);
    assert.match(healthy.calls.notes[0], /recovered.*after 1 failed probe/);
    await watchdogTick(state, 8080, healthy.deps);
    assert.equal(healthy.calls.notes.length, 1, "quiet while healthy");
    assert.equal(calls.exits.length, 0);
  });

  test("a 5xx from the proxy still counts as the route failing", async () => {
    const { deps } = harness({ "replit.app": "answered 502" });
    const state = { publicFailures: 0 };
    await watchdogTick(state, 8080, deps);
    assert.equal(state.publicFailures, 1);
  });

  test("SC_WATCHDOG_RESTART=0 keeps the lines but never exits", async () => {
    process.env.SC_WATCHDOG_RESTART = "0";
    const { deps, calls } = harness({ "replit.app": "timed out", "127.0.0.1": "ok" });
    const state = { publicFailures: 0 };
    for (let i = 0; i < 5; i += 1) await watchdogTick(state, 8080, deps);
    assert.equal(calls.exits.length, 0);
    assert.match(calls.notes.at(-1), /restart disabled/);
  });

  test("SC_SELF_URL redirects the public probe", async () => {
    process.env.SC_SELF_URL = "https://example.com/";
    const seen = [];
    const deps = {
      probe: async (url) => {
        seen.push(url);
        return "ok";
      },
      exit: () => {},
      note: () => {},
    };
    await watchdogTick({ publicFailures: 0 }, 9090, deps);
    assert.ok(seen.includes("https://example.com/api/healthz"), seen.join(", "));
    assert.ok(seen.includes("http://127.0.0.1:9090/api/healthz"), seen.join(", "));
  });
});
