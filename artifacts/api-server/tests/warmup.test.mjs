/**
 * The boot warm-up (lib/warmup-core.ts): what is warmed, in what order, and
 * how the walk behaves when a page fails, the budget runs out, or the work
 * that waits on it has to start anyway.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const core = await importModule("lib/warmup-core");

after(cleanupBundles);

const INPUT = {
  teams: ["buffalo-bills", "dallas-cowboys"],
  sections: ["usage", "schedule"],
  players: ["josh-allen", "ceedee-lamb", "bench-guy"],
  maxPlayers: 2,
  pairs: ["buffalo-bills-vs-kansas-city-chiefs"],
  ownHeading: true,
};

describe("planWarmup", () => {
  test("team hubs first, then matchups, the hottest players, then the team sections", () => {
    assert.deepEqual(core.planWarmup(INPUT), [
      "/embed/team/buffalo-bills?h1=1",
      "/embed/team/dallas-cowboys?h1=1",
      "/embed/matchup/buffalo-bills-vs-kansas-city-chiefs",
      "/embed/player/josh-allen?h1=1",
      "/embed/player/ceedee-lamb?h1=1",
      "/embed/team/buffalo-bills?section=usage&h1=1",
      "/embed/team/dallas-cowboys?section=usage&h1=1",
      "/embed/team/buffalo-bills?section=schedule&h1=1",
      "/embed/team/dallas-cowboys?section=schedule&h1=1",
    ]);
  });

  test("asks the way the plugin does: no h1 when the host prints the heading", () => {
    const paths = core.planWarmup({ ...INPUT, ownHeading: false });
    assert.equal(paths[0], "/embed/team/buffalo-bills");
    assert.equal(paths[3], "/embed/player/josh-allen");
    assert.equal(paths[5], "/embed/team/buffalo-bills?section=usage");
  });

  test("the player cap from the environment: blank is the default, not zero", () => {
    assert.equal(core.parsePlayerCap(undefined, 150), 150);
    assert.equal(core.parsePlayerCap("", 150), 150);
    assert.equal(core.parsePlayerCap("  ", 150), 150);
    assert.equal(core.parsePlayerCap("0", 150), 0);
    assert.equal(core.parsePlayerCap("40", 150), 40);
    assert.equal(core.parsePlayerCap("lots", 150), 150);
    assert.equal(core.parsePlayerCap("-3", 150), 150);
  });

  test("a player cap of zero warms no players; duplicates are asked once", () => {
    const paths = core.planWarmup({ ...INPUT, maxPlayers: 0, pairs: ["a-vs-b", "a-vs-b"] });
    assert.ok(!paths.some((p) => p.startsWith("/embed/player/")));
    assert.equal(paths.filter((p) => p === "/embed/matchup/a-vs-b").length, 1);
  });
});

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("runWarmup", () => {
  test("walks every page in order, one at a time, yielding between them", async () => {
    const clock = fakeClock();
    const seen = [];
    const notes = [];
    const summary = await core.runWarmup(
      ["/a", "/b", "/c"],
      {
        fetch: async (p) => {
          seen.push(p);
          clock.advance(100);
          return 200;
        },
        sleep: async (ms) => {
          seen.push(`sleep ${ms}`);
          clock.advance(ms);
        },
        now: clock.now,
        note: (l) => notes.push(l),
      },
      { budgetMs: 60_000, yieldMs: 40 },
    );
    assert.deepEqual(seen, ["/a", "sleep 40", "/b", "sleep 40", "/c"]);
    assert.deepEqual(summary, { planned: 3, ok: 3, failed: 0, skipped: 0, ms: 380 });
    assert.match(notes.at(-1), /done: 3 ok, 0 failed, 0 skipped of 3/);
  });

  test("a failed or erroring page is counted and named, and the walk goes on", async () => {
    const clock = fakeClock();
    const notes = [];
    const summary = await core.runWarmup(
      ["/ok", "/gone", "/boom", "/ok2"],
      {
        fetch: async (p) => {
          if (p === "/boom") throw new Error("socket hang up");
          return p === "/gone" ? 404 : 200;
        },
        sleep: async () => undefined,
        now: clock.now,
        note: (l) => notes.push(l),
      },
      { budgetMs: 60_000, yieldMs: 0 },
    );
    assert.equal(summary.ok, 2);
    assert.equal(summary.failed, 2);
    assert.ok(notes.some((l) => l === "/gone answered 404"));
    assert.ok(notes.some((l) => l.startsWith("/boom failed: socket hang up")));
  });

  test("stops at the memory floor and reports what it skipped", async () => {
    const clock = fakeClock();
    const seen = [];
    const notes = [];
    const free = [1500, 1200, 700, 650];
    const summary = await core.runWarmup(
      ["/1", "/2", "/3", "/4"],
      {
        fetch: async (p) => {
          seen.push(p);
          return 200;
        },
        sleep: async () => undefined,
        now: clock.now,
        note: (l) => notes.push(l),
        availableMb: () => free.shift(),
      },
      { budgetMs: 60_000, yieldMs: 0, minFreeMb: 800 },
    );
    assert.deepEqual(seen, ["/1", "/2"]);
    assert.equal(summary.ok, 2);
    assert.equal(summary.skipped, 2);
    assert.ok(notes.some((l) => l.startsWith("memory floor: 700MB available, under 800MB, after 2 pages; 2 skipped")));
  });

  test("an unreadable memory figure never stops the walk", async () => {
    const clock = fakeClock();
    const summary = await core.runWarmup(
      ["/1", "/2"],
      { fetch: async () => 200, sleep: async () => undefined, now: clock.now, note: () => undefined, availableMb: () => -1 },
      { budgetMs: 60_000, yieldMs: 0, minFreeMb: 800 },
    );
    assert.equal(summary.ok, 2);
    assert.equal(summary.skipped, 0);
  });

  test("stops when the budget is spent and reports what it skipped", async () => {
    const clock = fakeClock();
    const seen = [];
    const summary = await core.runWarmup(
      ["/1", "/2", "/3", "/4"],
      {
        fetch: async (p) => {
          seen.push(p);
          clock.advance(1000);
          return 200;
        },
        sleep: async () => undefined,
        now: clock.now,
        note: () => undefined,
      },
      { budgetMs: 2500, yieldMs: 0 },
    );
    assert.deepEqual(seen, ["/1", "/2", "/3"]);
    assert.equal(summary.ok, 3);
    assert.equal(summary.skipped, 1);
  });
});

describe("afterWarmup", () => {
  // A fake wait that resolves when the test says so, keyed by the ms asked for.
  function waits() {
    const pending = new Map();
    return {
      wait: (ms) => new Promise((resolve) => pending.set(ms, resolve)),
      fire: (ms) => pending.get(ms)(),
      has: (ms) => pending.has(ms),
    };
  }

  test("waits for the warm-up, but not less than the floor", async () => {
    const w = waits();
    let warmDone;
    const warm = new Promise((r) => (warmDone = r));
    let resolved = false;
    const p = core.afterWarmup(warm, 300, 1000, w.wait).then(() => (resolved = true));
    warmDone();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(resolved, false, "floor not reached yet");
    w.fire(300);
    await p;
    assert.equal(resolved, true);
  });

  test("gives up waiting at the cap, warm-up or not", async () => {
    const w = waits();
    const never = new Promise(() => undefined);
    const p = core.afterWarmup(never, 300, 1000, w.wait);
    w.fire(300);
    w.fire(1000);
    await p;
  });

  test("a warm-up that rejected counts as finished", async () => {
    const w = waits();
    const p = core.afterWarmup(Promise.reject(new Error("no")), 300, 1000, w.wait);
    w.fire(300);
    await p;
  });

  test("no warm-up at all is just the floor", async () => {
    const w = waits();
    const p = core.afterWarmup(undefined, 300, 1000, w.wait);
    w.fire(300);
    await p;
  });
});
