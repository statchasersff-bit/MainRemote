/**
 * Which wire stories land on a team's News section.
 *
 * Team is derived per row - from the headshot's player, then from the player's
 * name - against the current Sleeper map, so it could not be a WHERE clause and
 * every render used to read up to 4,000 wire rows and filter them in JS. The
 * filter is in SQL now (lib/news-query.ts, wireCandidatesFor), as a superset
 * the JS still narrows. These are the three ways a story belongs to a team, and
 * the one way it does not, each seeded as a real row.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const TEAM = "kc";
const OTHER = "cin";
const PREFIX = "test:team-news-query:";

const teams = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "player-teams.json"), "utf8")).teams;
const named = Object.values(
  JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team-roster.json"), "utf8")).playerByName,
);

const onTeam = named.find((p) => p.team === TEAM && teams[p.id] === TEAM && /a/.test(p.name));
const elsewhere = named.find((p) => p.team === OTHER && teams[p.id] === OTHER);

const rows = [
  // By headshot: the image names a player on the team.
  { key: "image", image: `https://sleepercdn.com/content/nfl/players/thumb/${onTeam.id}.jpg`, name: onTeam.name, wanted: true },
  // By name only: no headshot, so the name decides.
  { key: "name", image: null, name: onTeam.name, wanted: true },
  // By an accented spelling of the name, which SQL cannot fold.
  { key: "accent", image: null, name: onTeam.name.replace("a", "á"), wanted: true },
  // Another team's player: must not appear.
  { key: "other", image: `https://sleepercdn.com/content/nfl/players/thumb/${elsewhere.id}.jpg`, name: elsewhere.name, wanted: false },
];

const title = (key) => `Team news query probe (${key})`;

async function withClient(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

let server;

before(async () => {
  const now = new Date();
  await withClient(async (c) => {
    await c.query("DELETE FROM news_items WHERE id LIKE $1", [`${PREFIX}%`]);
    for (const row of rows) {
      await c.query(
        `INSERT INTO news_items
           (id, dedupe_key, title, link, pub_date, pub_date_ms, player_name, image,
            source, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'TEST', $9, $9)`,
        [PREFIX + row.key, PREFIX + row.key, title(row.key), "https://example.com/probe",
         now.toUTCString(), now.getTime(), row.name, row.image, now],
      );
    }
  });
  server = await startServer();
});

after(async () => {
  await server?.stop();
  await withClient((c) => c.query("DELETE FROM news_items WHERE id LIKE $1", [`${PREFIX}%`]));
});

describe("a team's news section", () => {
  test("carries its players' stories by headshot, by name, and by accented name - and no one else's", async () => {
    const hub = await fetch(`${server.origin}/team/${TEAM}`, { redirect: "manual" });
    const slug = hub.headers.get("location").replace(/^.*\/team\//, "").replace(/\/.*$/, "");
    const html = await (await fetch(`${server.origin}/embed/team/${slug}?section=news`)).text();
    for (const row of rows) {
      assert.equal(html.includes(title(row.key)), row.wanted, `${row.key}: ${row.wanted ? "missing" : "should not be here"}`);
    }
  });
});
