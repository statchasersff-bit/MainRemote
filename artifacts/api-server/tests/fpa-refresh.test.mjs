/**
 * POST /api/fpa/ingest - the scheduled refresh.
 *
 * This endpoint exists because of a specific failure: the FPA table is written
 * by a script, the script writes to whatever database the process running it is
 * pointed at, and so production served figures written on the day it was
 * seeded while a development shell refreshed development every week. The
 * endpoint runs the ingest inside the deployment instead. What has to hold:
 *
 *   - **the guard.** With INGEST_SECRET set, an unauthenticated POST must not
 *     start an ingest - not merely be answered 401 after starting one.
 *   - **it actually writes, and the page picks it up.** The point is the served
 *     table moving, not a 200.
 *   - **one at a time.** A run downloads two large CSVs. Two callers arriving
 *     together must produce one ingest, one set of downloads, and both must be
 *     told which of them ran it.
 *   - **the status endpoint says how old the figures are.** The line whose
 *     absence let a stale table look healthy.
 *
 * nflverse is stubbed through NFLVERSE_BASE_URL - no 14MB of GitHub traffic in
 * a test run - and every write is confined to seasons 1999 and 2000, which the
 * real ingest never touches, and deleted afterwards. The live 2026 rows this
 * suite reads for the status assertions are never written to.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

const SECRET = "test-fpa-ingest-secret";

/** Seasons no real ingest writes: the baseline and the "current" one. */
const TEST_BASELINE = 1999;
const TEST_CURRENT = 2000;

/**
 * Delay on every stubbed release, so "two callers arriving together" has a
 * window to arrive in. Without it the first ingest can finish before the
 * second request is read, and the test would be asserting scheduling luck.
 */
const STUB_DELAY_MS = 400;

const COLUMNS = [
  "player_display_name",
  "position",
  "season",
  "week",
  "season_type",
  "team",
  "opponent_team",
  "passing_yards",
  "passing_tds",
  "rushing_yards",
  "rushing_tds",
  "receiving_yards",
  "receiving_tds",
  "receptions",
];

/** One scored player-week, with only the columns the scorer reads. */
function row(season, week, team, opponent, position, stats = {}) {
  const base = {
    player_display_name: `Test ${position}`,
    position,
    season,
    week,
    season_type: "REG",
    team,
    opponent_team: opponent,
  };
  return COLUMNS.map((c) => String(base[c] ?? stats[c] ?? 0)).join(",");
}

/**
 * A season's worth of stub CSV: two teams, playing each other.
 *
 * Both sides of every game, because FPA is "points this defense allowed" and a
 * defense with no opponent rows is a defense the ingest never sees.
 */
function csv(season, weeks) {
  const rows = [COLUMNS.join(",")];
  for (const week of weeks) {
    rows.push(
      row(season, week, "KC", "DET", "QB", { passing_yards: 300, passing_tds: 3 }),
      row(season, week, "KC", "DET", "RB", { rushing_yards: 100, rushing_tds: 1 }),
      row(season, week, "DET", "KC", "QB", { passing_yards: 200, passing_tds: 1 }),
      row(season, week, "DET", "KC", "WR", {
        receiving_yards: 90,
        receiving_tds: 1,
        receptions: 6,
      }),
      row(season, week, "DET", "KC", "TE", {
        receiving_yards: 40,
        receptions: 4,
      }),
    );
  }
  return rows.join("\n");
}

/**
 * Stands in for the nflverse release host.
 *
 * `hits` is the assertion that matters for the one-at-a-time guarantee: one
 * ingest reads each season once, so two ingests would read four times.
 */
function stubReleases() {
  // `currentStatus` / `currentWeeks` let a test play a bad upstream day for the
  // current season without touching the baseline.
  const state = { hits: 0, paths: [], currentStatus: 200, currentWeeks: [1] };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    state.paths.push(req.url);

    const season = /stats_player_week_(\d+)\.csv/.exec(req.url ?? "")?.[1];
    const isCurrent = season === String(TEST_CURRENT);
    const body =
      season === String(TEST_BASELINE)
        ? csv(TEST_BASELINE, [1, 2, 3])
        : isCurrent && state.currentStatus === 200
          ? csv(TEST_CURRENT, state.currentWeeks)
          : null;

    setTimeout(() => {
      if (isCurrent && state.currentStatus !== 200) {
        res.writeHead(state.currentStatus).end("stubbed failure");
        return;
      }
      if (body === null) {
        res.writeHead(404).end("no such release");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/csv" }).end(body);
    }, STUB_DELAY_MS);
  });
  state.server = server;
  state.listen = () =>
    new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${server.address().port}`),
      ),
    );
  state.close = () => new Promise((resolve) => server.close(resolve));
  return state;
}

let server;
let stub;

async function withDb(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Remove everything this suite can have written. */
async function cleanup() {
  await withDb(async (client) => {
    for (const table of [
      "fantasy_points_allowed_snapshots",
      "fantasy_points_allowed_games",
    ]) {
      await client.query(`delete from ${table} where season = any($1)`, [
        [TEST_BASELINE, TEST_CURRENT],
      ]);
    }
  });
}

before(async () => {
  stub = stubReleases();
  const origin = await stub.listen();
  server = await startServer({
    INGEST_SECRET: SECRET,
    NFLVERSE_BASE_URL: origin,
  });
});

after(async () => {
  await server?.stop();
  await stub?.close();
  await cleanup();
});

function ingest({ secret = SECRET, query = "" } = {}) {
  return fetch(`${server.origin}/api/fpa/ingest${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "x-ingest-secret": secret }),
    },
  });
}

const TEST_SEASONS = `?baseline=${TEST_BASELINE}&current=${TEST_CURRENT}`;

async function snapshotRowCount() {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select count(*)::int as n from fantasy_points_allowed_snapshots where season = $1",
      [TEST_CURRENT],
    );
    return rows[0].n;
  });
}

describe("POST /api/fpa/ingest - the guard", () => {
  test("no secret is 401 and starts nothing", async () => {
    const before = stub.hits;
    const res = await ingest({ secret: null, query: TEST_SEASONS });

    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: "unauthorized" });
    // The refusal has to happen before the ingest, not alongside it.
    assert.equal(stub.hits, before, "a rejected POST fetched from upstream");
    assert.equal(await snapshotRowCount(), 0);
  });

  test("the wrong secret is 401", async () => {
    const res = await ingest({ secret: "nope", query: TEST_SEASONS });
    assert.equal(res.status, 401);
    assert.equal(await snapshotRowCount(), 0);
  });
});

describe("POST /api/fpa/ingest - the refresh", () => {
  test("writes the season it was asked for, and the page serves it", async () => {
    const res = await ingest({ query: TEST_SEASONS });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.joined, false);
    assert.equal(body.season, TEST_CURRENT);
    assert.equal(body.baselineSeason, TEST_BASELINE);
    assert.equal(body.isPreseason, false);
    // One week of the stubbed "current" season.
    assert.equal(body.weekNumber, 1);
    assert.equal(body.dataMode, "week_1");
    // Two defenses, three scoring formats.
    assert.equal(body.snapshotRows, 6);
    assert.ok(body.gameRows > 0);
    assert.ok(
      Date.now() - Date.parse(body.snapshotWrittenAt) < 60_000,
      `snapshotWrittenAt should be just now, got ${body.snapshotWrittenAt}`,
    );

    // The served page, not just the write: a refresh nobody can see is the bug
    // this endpoint was built for.
    const page = await fetch(
      `${server.origin}/embed/fpa?season=${TEST_CURRENT}&format=half&view=raw`,
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Kansas City Chiefs/);
    assert.match(html, /Detroit Lions/);
  });

  test("two callers arriving together produce one ingest", async () => {
    const before = stub.hits;

    const [a, b] = await Promise.all([
      ingest({ query: TEST_SEASONS }),
      ingest({ query: TEST_SEASONS }),
    ]);

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const bodies = [await a.json(), await b.json()];
    assert.ok(bodies.every((x) => x.ok));

    // One ran it, one joined it. Both got the same answer.
    assert.deepEqual(
      bodies.map((x) => x.joined).sort(),
      [false, true],
      "expected exactly one caller to have joined the other's run",
    );
    assert.equal(bodies[0].dataMode, bodies[1].dataMode);

    // Two seasons read once each. Four would mean two ingests raced.
    assert.equal(
      stub.hits - before,
      2,
      `expected 2 upstream reads, saw ${stub.hits - before}: ${stub.paths.join(" ")}`,
    );
  });

  test("the ingest is idempotent - a second run replaces, never accumulates", async () => {
    const first = await snapshotRowCount();
    const res = await ingest({ query: TEST_SEASONS });
    assert.equal(res.status, 200);
    assert.equal(await snapshotRowCount(), first);
  });
});

describe("GET /api/status - the FPA block", () => {
  test("reports how old the served figures are", async () => {
    const res = await fetch(`${server.origin}/api/status`);
    assert.equal(res.status, 200);

    const { fpa } = await res.json();
    assert.ok(fpa, "/api/status must report the FPA table");
    assert.equal(fpa.error, undefined, `snapshot state unreadable: ${fpa.error}`);
    assert.equal(fpa.ingestGuarded, true);

    // The live table, whatever is in it. Both fields present and agreeing on
    // whether anything has been ingested at all is the whole assertion: this is
    // the line that has to be able to say "written two days ago".
    if (fpa.snapshotWrittenAt === null) {
      assert.equal(fpa.secondsSinceSnapshot, null);
      assert.equal(fpa.dataMode, null);
    } else {
      assert.ok(Number.isFinite(Date.parse(fpa.snapshotWrittenAt)));
      assert.equal(typeof fpa.secondsSinceSnapshot, "number");
      assert.match(fpa.dataMode, /^(preseason_baseline|week_\d+)$/);
    }

    // This process ran ingests above, so its own state must show them.
    assert.equal(fpa.running, false);
    assert.equal(fpa.consecutiveFailures, 0);
    assert.equal(fpa.lastError, null);
    assert.ok(fpa.lastSuccess, "an ingest ran in this process and must be recorded");
    assert.equal(fpa.lastResult.dataMode, "week_1");
  });
});

/**
 * A bad upstream day must never replace the table.
 *
 * The failure this guards: a 5xx or rate limit on the current season was read
 * as "not published yet", and the ingest swapped a live in-season table for a
 * baseline-only one. Runs last, because it leaves failures in the process's
 * refresh state that the status block above asserts are absent.
 */
describe("POST /api/fpa/ingest - a bad upstream day", () => {
  async function storedWeek() {
    return withDb(async (client) => {
      const { rows } = await client.query(
        "select max(week_number) as w from fantasy_points_allowed_snapshots where season = $1",
        [TEST_CURRENT],
      );
      return rows[0].w;
    });
  }

  before(async () => {
    stub.currentWeeks = [1, 2];
    const res = await ingest({ query: TEST_SEASONS });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dataMode, "week_2");
  });

  after(() => {
    stub.currentStatus = 200;
    stub.currentWeeks = [1];
  });

  test("a 5xx on the current season fails the run and keeps the table", async () => {
    const rowsBefore = await snapshotRowCount();
    stub.currentStatus = 503;
    try {
      const res = await ingest({ query: TEST_SEASONS });
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /HTTP 503/);
    } finally {
      stub.currentStatus = 200;
    }
    assert.equal(await storedWeek(), 2);
    assert.equal(await snapshotRowCount(), rowsBefore);
  });

  test("a season that 404s after it was ingested is refused, not reset", async () => {
    stub.currentStatus = 404;
    try {
      const res = await ingest({ query: TEST_SEASONS });
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /week 2 to preseason/);
    } finally {
      stub.currentStatus = 200;
    }
    assert.equal(await storedWeek(), 2);
  });

  test("fewer weeks than the table holds is refused", async () => {
    stub.currentWeeks = [1];
    const res = await ingest({ query: TEST_SEASONS });
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /week 2 to week 1/);
    assert.equal(await storedWeek(), 2);
  });
});
