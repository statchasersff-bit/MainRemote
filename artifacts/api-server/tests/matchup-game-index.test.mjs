/**
 * The dated game pages the sitemap lists: /embed/matchup-games.json.
 *
 * Every row is a game that is canonical at its own address by the one rule
 * the pages apply (meetingHasOwnAddress): final, and not the game the pair's
 * page owns - this season's latest result, until the rematch is within six
 * days. The whole of the season before is listed as archives. Each listed
 * path must answer 200 and name itself as its canonical.
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

test("the ownership rule: the pair page keeps this season's latest game until the rematch is within six days", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const day = 86_400_000;
  const played = (daysAgo) => ({ kickoffMs: now - daysAgo * day, isFinal: true });
  const ahead = (daysOn) => ({ kickoffMs: now + daysOn * day, isFinal: false });
  const season = 2026;

  // One game played, nothing ahead: the pair page owns it for the rest of
  // the season, however long ago it was.
  assert.equal(pair.pairInPreviewMode([played(3)], now), false);
  assert.equal(pair.pairOwnsMeeting({ ...played(3), season }, [played(3)], season, now), true, "three days old");
  assert.equal(pair.pairOwnsMeeting({ ...played(40), season }, [played(40)], season, now), true, "forty days old");
  assert.equal(pair.meetingHasOwnAddress({ ...played(40), season }, [played(40)], season, now), false);

  // A rematch thirteen weeks out does not take the page away from the result.
  let meetings = [played(4), ahead(91)];
  assert.equal(pair.pairInPreviewMode(meetings, now), false, "preview waits for the rematch");
  assert.equal(pair.meetingHasOwnAddress({ ...played(4), season }, meetings, season, now), false, "still owned");

  // Six days out (or less) and the page is the preview; the dated page is its own.
  meetings = [played(60), ahead(6)];
  assert.equal(pair.pairInPreviewMode(meetings, now), true, "six days: preview");
  assert.equal(pair.meetingHasOwnAddress({ ...played(60), season }, meetings, season, now), true, "let go");
  meetings = [played(60), ahead(6.5)];
  assert.equal(pair.pairInPreviewMode(meetings, now), false, "six and a half days: not yet");

  // Nothing played yet: the page previews the first meeting whenever it is.
  assert.equal(pair.pairInPreviewMode([ahead(100)], now), true);
  assert.equal(pair.pairInPreviewMode([ahead(100), { kickoffMs: null, isFinal: false }], now), true);
  // An undated rematch is not within six days of anything.
  assert.equal(pair.pairInPreviewMode([played(10), { kickoffMs: null, isFinal: false }], now), false);

  // Only the latest result is owned: the earlier meeting of a pair that has
  // met twice has its own address at once.
  meetings = [played(50), played(8)];
  assert.equal(pair.meetingHasOwnAddress({ ...played(50), season }, meetings, season, now), true, "the earlier game");
  assert.equal(pair.meetingHasOwnAddress({ ...played(8), season }, meetings, season, now), false, "the latest is owned");

  // A game from the season before is an archive at its own address.
  assert.equal(pair.meetingHasOwnAddress({ ...played(300), season: season - 1 }, [played(300)], season, now), true);

  // Never for a fixture, never without a kickoff.
  assert.equal(pair.meetingHasOwnAddress({ kickoffMs: now - 20 * day, isFinal: false, season }, [], season, now), false);
  assert.equal(pair.meetingHasOwnAddress({ kickoffMs: null, isFinal: true, season }, [], season, now), false);
});

test("the index lists dated game pages, each of which answers at its own address", async () => {
  const res = await fetch(`${server.origin}/embed/matchup-games.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(String(body.season), /^\d{4}$/);
  assert.deepEqual(body.seasons, [body.season, body.season - 1], "this season and the one before");
  assert.ok(Array.isArray(body.games));
  assert.ok(
    body.games.some((g) => g.season === body.season - 1),
    "last season's games are archives in the sitemap",
  );
  for (const game of body.games.slice(0, 50)) {
    assert.match(game.pair, /^[a-z0-9-]+-vs-[a-z0-9-]+$/);
    assert.match(game.game, /^\d{4}-(?:week-\d{1,2}|wild-card|divisional|conference-championship|super-bowl|postseason-week-\d{1,2})$/);
    assert.equal(game.path, `/nfl/${game.pair}/${game.game}/`);
    assert.match(game.kickoff, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.parse(game.kickoff) < Date.now(), "a played game");
    assert.match(game.modified, /^\d{4}-\d{2}-\d{2}T/, "a lastmod for the sitemap");
    assert.ok(Date.parse(game.modified) >= Date.parse(game.kickoff), "stats are pulled after kickoff");
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
    const html = await page.text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.ok(canonical.endsWith(body.games[0].path), `${canonical} should be the page's own address`);
    assert.match(html, /"@type":"SportsEvent"/, "a page canonical at its own address carries the event");
  }
});
