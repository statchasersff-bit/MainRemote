/**
 * Start/sit links only where Redraft Command has a populated page (2026-11-27
 * audit, item 5).
 *
 * On 2026-11-27 Aaron Rodgers's hub printed six "Should I start Rodgers?"
 * links to a start/sit address that answered 404 (Sleeper listed him as a
 * free agent), and about fifty more hubs linked to noindex "updating" pages.
 * data/player/startsit_pages.json (scripts/player/buildStartSitPages.mjs,
 * read off Redraft Command's own sitemap) is the list; this pins that the
 * list is well formed and that a player off it gets no start/sit link on any
 * tab. Which players are on it moves weekly, so the players are picked from
 * the committed data rather than named.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "data", "player");
const list = JSON.parse(fs.readFileSync(path.join(dataDir, "startsit_pages.json"), "utf8"));
const players = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json"), "utf8"));
const indexed = new Set(JSON.parse(fs.readFileSync(path.join(dataDir, "indexed_players.json"), "utf8")).slugs);
const listed = new Set(list.slugs);
const bySlug = new Map(players.map((p) => [p.slug, p]));

const onRoster = (p) => p && p.team && p.team !== "FA" && !/^(ir|pup|nfi|sus|dnr)/i.test(p.injury_status ?? "");

let server;
let data;
before(async () => {
  server = await startServer();
  data = await importModule("lib/player/data");
});
after(async () => {
  if (server) await server.stop();
  await cleanupBundles();
});

const html = async (p) => {
  const r = await fetch(server.origin + p, { headers: { connection: "close" } });
  return { status: r.status, body: await r.text() };
};
const startSitLinks = (body) => (body.match(/href="[^"]*\/redraft-command\/who-should-i-start\/[^"]*"/g) ?? []).length;

describe("startsit_pages.json", () => {
  test("a sorted list of our own player slugs, no pair pages, from Redraft Command's sitemap", () => {
    assert.equal(list.source, "https://statchasers.com/sitemaps/start-sit.xml");
    assert.equal(list.count, list.slugs.length);
    assert.ok(list.slugs.length >= 100, "a short list means the sitemap read failed");
    assert.deepEqual([...list.slugs].sort(), list.slugs);
    for (const slug of list.slugs) {
      assert.ok(bySlug.has(slug), `${slug} is one of our players`);
      assert.ok(!slug.includes("-or-"), `${slug} is a player, not a pair`);
    }
  });

  test("hasStartSitPage answers from the list", () => {
    for (const slug of list.slugs.slice(0, 25)) assert.equal(data.hasStartSitPage(slug), true, slug);
    assert.equal(data.hasStartSitPage("zz-not-a-player"), false);
    assert.equal(data.hasStartSitPage(""), false);
    assert.equal(data.hasStartSitPage(null), false);
  });
});

describe("player pages", () => {
  test("a rostered player with no populated start/sit page: no start/sit link on the hub or any tab", async () => {
    const off = [...indexed].find((s) => !listed.has(s) && onRoster(bySlug.get(s)));
    assert.ok(off, "an indexed, rostered player off the list");
    for (const tab of ["", "stats/", "game-log/", "outlook/", "injury/", "bio/", "news/"]) {
      const { status, body } = await html(`/player/${off}/${tab}`);
      if (status !== 200) continue; // a tab he has no content for
      assert.equal(startSitLinks(body), 0, `${off}/${tab}`);
    }
  });

  test("a listed player keeps his start/sit links wherever the page has a week to start him in", async () => {
    const on = [...indexed].find((s) => listed.has(s) && onRoster(bySlug.get(s)));
    assert.ok(on, "an indexed, rostered player on the list");
    const { status, body } = await html(`/player/${on}/`);
    assert.equal(status, 200);
    const n = startSitLinks(body);
    // No week ahead (offseason) prints none for anyone; otherwise the header has one.
    if (/class="scp-pstrip"/.test(body)) assert.ok(n >= 1, `${on}: ${n}`);
    for (const m of body.match(/who-should-i-start\/([a-z0-9-]+)/g) ?? []) assert.equal(m, `who-should-i-start/${on}`);
  });
});
