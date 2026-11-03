/**
 * The outlook section's <title> names the outlook season, the same year as its
 * H1. It used to take the season the player last played, so a player with no
 * 2026 snaps yet got "Fantasy Outlook 2025" over a 2026 heading.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

test("a player whose page is on last season still gets this season's outlook title", async () => {
  const { players = [] } = await (await fetch(`${server.origin}/embed/players.json`)).json();
  let checked = null;
  for (const player of players.slice(0, 300)) {
    const res = await fetch(`${server.origin}/player/${player.slug}?section=outlook`);
    if (res.status !== 200) continue;
    const html = await res.text();
    const season = Number(/data-season="(\d{4})"/.exec(html)?.[1]);
    // The take's heading names the outlook season; the page's own season
    // (data-season) can be an earlier one for a player with no snaps yet.
    const take = /Rest-of-Season Outlook|(\d{4}) Outlook/.exec(html);
    if (!season || !take) continue;
    const title = (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&");
    // Evergreen since the entity brief (2026-11-03): the title names no
    // year at all, so it cannot name the wrong one.
    assert.match(title, /^.+ Fantasy Outlook(?:, Rankings & Projections| & Projections)?(?: \| StatChasers)?$/, `${player.slug}: ${title}`);
    assert.doesNotMatch(title, /\b20\d{2}\b/, `${player.slug}: no year in the title`);
    checked = player.slug;
    break;
  }
  assert.ok(checked, "found a player with an outlook page");
});
