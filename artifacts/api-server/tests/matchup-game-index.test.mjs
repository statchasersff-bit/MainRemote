/**
 * The dated game pages the sitemap lists: /embed/matchup-games.json.
 *
 * Every row is a game that has an address of its own by the one rule the
 * redirect applies (meetingHasOwnAddress): final, kicked off more than two
 * weeks ago or with a rematch ahead. The route for each listed path must
 * therefore answer 200 and not 301 up to the pair's page.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const pair = await importModule("lib/matchup/pair");

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
  await cleanupBundles();
});

test("the own-address rule: two weeks after kickoff, or at once with a rematch ahead", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const day = 86_400_000;
  assert.equal(pair.meetingHasOwnAddress(now - 20 * day, true, now), true, "three weeks old");
  assert.equal(pair.meetingHasOwnAddress(now - 3 * day, true, now), false, "still the pair page's lead");
  assert.equal(pair.meetingHasOwnAddress(now - 3 * day, true, now, true), true, "unless a rematch is ahead");
  assert.equal(pair.meetingHasOwnAddress(now - 20 * day, false, now), false, "never for a fixture");
  assert.equal(pair.meetingHasOwnAddress(null, true, now), false, "never without a kickoff");
});

test("the index lists dated game pages, each of which answers at its own address", async () => {
  const res = await fetch(`${server.origin}/embed/matchup-games.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(String(body.season), /^\d{4}$/);
  assert.ok(Array.isArray(body.games));
  for (const game of body.games.slice(0, 50)) {
    assert.match(game.pair, /^[a-z0-9-]+-vs-[a-z0-9-]+$/);
    assert.match(game.game, /^\d{4}-(?:week-\d{1,2}|wild-card|divisional|conference-championship|super-bowl|postseason-week-\d{1,2})$/);
    assert.equal(game.path, `/nfl/${game.pair}/${game.game}/`);
    assert.match(game.kickoff, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.parse(game.kickoff) < Date.now(), "a played game");
  }
  const keys = body.games.map((g) => g.path);
  assert.equal(new Set(keys).size, keys.length, "each game once");
  // Sorted newest first.
  for (let i = 1; i < body.games.length; i++) {
    assert.ok(body.games[i - 1].kickoff >= body.games[i].kickoff, "newest first");
  }
  if (body.games.length > 0) {
    const page = await fetch(`${server.origin}${body.games[0].path}`, { redirect: "manual" });
    assert.equal(page.status, 200, `${body.games[0].path} should be a page, not a redirect`);
  }
});
