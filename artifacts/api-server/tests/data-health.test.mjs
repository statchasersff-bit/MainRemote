/**
 * GET /api/data/health: the data checks a monitor points at, kept apart from
 * /api/healthz, which is the platform's liveness probe and must stay 200.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

const servers = [];
after(async () => {
  for (const server of servers) await server.stop();
});

describe("GET /api/data/health", () => {
  test("answers with a verdict and its reasons, never cached", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.origin}/api/data/health`);
    const body = await res.json();
    assert.ok([200, 503].includes(res.status), String(res.status));
    assert.equal(body.ok, res.status === 200);
    assert.ok(Array.isArray(body.reasons));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!body.reasons.includes("database unreachable"), body.reasons.join("; "));
  });

  test("a database it cannot reach is a 503 that says so, while healthz stays ok", async () => {
    const server = await startServer({ DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:9/none" });
    servers.push(server);
    const res = await fetch(`${server.origin}/api/data/health`);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.ok(body.reasons.includes("database unreachable"), body.reasons.join("; "));
    assert.equal((await fetch(`${server.origin}/api/healthz`)).status, 200);
  });
});
