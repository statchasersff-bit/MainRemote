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
    const h1 = /Fantasy Outlook (\d{4})/.exec(
      (await (await fetch(`${server.origin}/embed/player/${player.slug}?section=outlook&h1=1`)).text()),
    )?.[1];
    if (!season || !h1 || season >= Number(h1)) continue;
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    assert.match(title, new RegExp(`Fantasy Outlook ${h1}:`), `${player.slug}: ${title}`);
    checked = player.slug;
    break;
  }
  assert.ok(checked, "found a player whose page is on an earlier season than the outlook");
});
