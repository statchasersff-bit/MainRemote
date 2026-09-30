/**
 * The stored recap box scores: data/matchup/boxscores/<season>.json.
 *
 * What is being held to: a stored game renders without ESPN answering, the
 * trim that makes the files small does not change what the parser reads out
 * of them, and every stored game still parses.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";
import { trimEspnSummary } from "../scripts/matchup/espn-summary-trim.mjs";

const STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "matchup", "boxscores");
const seasons = fs.readdirSync(STORE).filter((name) => /^\d{4}\.json$/.test(name));
const games = seasons.flatMap((name) =>
  Object.entries(JSON.parse(fs.readFileSync(path.join(STORE, name), "utf8")).games),
);

const box = await importModule("lib/matchup/boxscore");
after(cleanupBundles);

/** A copy with an unread key added to every object, the way ESPN's full document carries them. */
function padded(value) {
  if (Array.isArray(value)) return value.map(padded);
  if (value === null || typeof value !== "object") return value;
  const out = { unread: { article: "x".repeat(20) } };
  for (const [key, sub] of Object.entries(value)) out[key] = padded(sub);
  return out;
}

describe("stored box scores", () => {
  test("the current season is stored", () => {
    assert.ok(seasons.includes("2026.json"));
    assert.ok(games.length >= 48, `${games.length} games`);
  });

  test("every stored game parses to a two-sided final", () => {
    for (const [id, game] of games) {
      const parsed = box.parseEspnSummary(id, game.summary);
      assert.equal(parsed.lines.length, 2, id);
      assert.ok(parsed.players.length > 0, `${id} has no player lines`);
      assert.ok(game.fetchedAt && game.date, `${id} is missing its dates`);
    }
  });

  test("trimming drops only what the parser does not read", () => {
    for (const [id, game] of games.slice(0, 40)) {
      const full = padded(game.summary);
      assert.deepEqual(trimEspnSummary(full), game.summary, id);
      assert.deepEqual(box.parseEspnSummary(id, trimEspnSummary(full)), box.parseEspnSummary(id, full), id);
    }
  });

  test("a stored game is served with ESPN unreachable", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("offline");
    };
    try {
      const [id, game] = games[0];
      const got = await box.getGameBoxscore(id);
      assert.deepEqual(got, box.parseEspnSummary(id, game.summary));
      assert.equal(calls, 0);
      assert.equal(await box.getGameBoxscore("0"), null, "an unstored game still degrades to null");
    } finally {
      globalThis.fetch = real;
    }
  });
});
