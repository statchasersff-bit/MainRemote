/**
 * The dated game pages the sitemap lists: /embed/matchup-games.json.
 *
 * Since WEB-001 (2026-11-24) every finished game is canonical at its own
 * dated address (meetingHasOwnAddress), so the list is every completed game
 * the page serves - the current season and the HISTORY_SEASONS before it -
 * each once. Each listed path must answer 200 and name itself as its
 * canonical; lastmod is the stored stats' fetch stamp, or absent.
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

test("every finished game has its own address, whatever the pair page leads with", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const day = 86_400_000;
  const played = (daysAgo) => ({ kickoffMs: now - daysAgo * day, isFinal: true });
  const ahead = (daysOn) => ({ kickoffMs: now + daysOn * day, isFinal: false });

  // The pair page still keeps the latest result until the rematch is within
  // six days - that decides what the pair page LEADS with, not where the
  // game is canonical.
  assert.equal(pair.pairInPreviewMode([played(3)], now), false);
  assert.equal(pair.pairInPreviewMode([played(4), ahead(91)], now), false, "preview waits for the rematch");
  assert.equal(pair.pairInPreviewMode([played(60), ahead(6)], now), true, "six days: preview");
  assert.equal(pair.pairInPreviewMode([played(60), ahead(6.5)], now), false, "six and a half days: not yet");
  assert.equal(pair.pairInPreviewMode([ahead(100)], now), true);
  assert.equal(pair.pairInPreviewMode([played(10), { kickoffMs: null, isFinal: false }], now), false);

  // The latest game, an earlier one, and last season's: all their own.
  assert.equal(pair.meetingHasOwnAddress(played(3)), true, "three days old");
  assert.equal(pair.meetingHasOwnAddress(played(40)), true, "forty days old, no rematch");
  assert.equal(pair.meetingHasOwnAddress(played(300)), true, "last season");
  assert.equal("pairOwnsMeeting" in pair, false, "the ownership rule is gone");

  // Links follow: a finished game opens its dated page in every state.
  // (meetingLinkTarget compares `game` to `meetings` by identity.)
  const season = 2026;
  const at = (m) => ({ ...m, season });
  for (const meetings of [[at(played(4)), at(ahead(91))], [at(played(60)), at(ahead(6))], [at(played(50)), at(played(8))]]) {
    for (const game of meetings.filter((x) => x.isFinal)) {
      assert.equal(pair.meetingLinkTarget(game, meetings, season, now), "own");
    }
  }
  // An unplayed game the pair page is previewing still links the pair page.
  const previewing = [at(played(60)), at(ahead(6))];
  assert.equal(pair.meetingLinkTarget(previewing[1], previewing, season, now), "pair");

  // Never for a fixture, never without a kickoff.
  assert.equal(pair.meetingHasOwnAddress({ kickoffMs: now - 20 * day, isFinal: false }), false);
  assert.equal(pair.meetingHasOwnAddress({ kickoffMs: null, isFinal: true }), false);
});

test("the index lists dated game pages, each of which answers at its own address", async () => {
  const res = await fetch(`${server.origin}/embed/matchup-games.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(String(body.season), /^\d{4}$/);
  assert.deepEqual(
    body.seasons,
    Array.from({ length: 6 }, (_, i) => body.season - i),
    "this season and the five before it, the window the page serves",
  );
  assert.ok(Array.isArray(body.games));
  assert.ok(
    body.games.some((g) => g.season === body.season - 1),
    "last season's games are archives in the sitemap",
  );
  for (const game of body.games) {
    assert.match(game.pair, /^[a-z0-9-]+-vs-[a-z0-9-]+$/);
    assert.match(game.game, /^\d{4}-(?:week-\d{1,2}|wild-card|divisional|conference-championship|super-bowl|postseason-week-\d{1,2})$/);
    assert.equal(game.path, `/nfl/${game.pair}/${game.game}/`);
    assert.match(game.kickoff, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.parse(game.kickoff) < Date.now(), "a played game");
    // The stored stats' fetch stamp, or null: never the kickoff stood in.
    if (game.modified !== null) {
      assert.match(game.modified, /^\d{4}-\d{2}-\d{2}T/, "a lastmod for the sitemap");
      assert.ok(Date.parse(game.modified) >= Date.parse(game.kickoff), "stats are pulled after kickoff");
    }
  }
  const keys = body.games.map((g) => g.path);
  assert.equal(new Set(keys).size, keys.length, "each game once");
  // Sorted newest first.
  for (let i = 1; i < body.games.length; i++) {
    assert.ok(body.games[i - 1].kickoff >= body.games[i].kickoff, "newest first");
  }
  // This season's latest meetings are there too (the pair page "owned" them
  // before WEB-001): a pair listed once this season is its only, and so its
  // latest, game.
  const thisSeason = body.games.filter((g) => g.season === body.season);
  if (thisSeason.length > 0) {
    const perPair = new Map();
    for (const g of thisSeason) perPair.set(g.pair, (perPair.get(g.pair) ?? 0) + 1);
    assert.ok([...perPair.values()].some((n) => n === 1), "a pair's only game this season is listed");
  }
  if (body.games.length > 0) {
    const page = await fetch(`${server.origin}${body.games[0].path}`, { redirect: "manual" });
    assert.equal(page.status, 200, `${body.games[0].path} should be a page, not a redirect`);
    const html = await page.text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.ok(canonical.endsWith(body.games[0].path), `${canonical} should be the page's own address`);
    assert.match(html, /"@type":"SportsEvent"/, "a page canonical at its own address carries the event");
  }
});
