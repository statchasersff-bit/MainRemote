/**
 * The handcuff refresh reads Ourlads' RB depth page with regexes
 * (scripts/rb-handcuffs/refresh.mjs). This pins it to the page as served on
 * 2026-09-30, trimmed to its depth-chart rows, so a markup change upstream
 * fails here instead of in the daily chain's "gave N teams" guard.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOurlads } from "../scripts/rb-handcuffs/refresh.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, "fixtures", "ourlads-rb-2026-09-30.html"), "utf8");
const teams = parseOurlads(html);

test("every team parses", () => {
  assert.equal(Object.keys(teams).length, 32);
});

test("the depth order is the page's order", () => {
  assert.deepEqual(teams.BUF, { rb1: "James Cook III", rb2: "Ty Johnson", rb3: "Ray Davis" });
});

test("Ourlads' own team codes are mapped to ours", () => {
  for (const code of ["ARI", "WAS", "LAR", "JAX"]) assert.ok(teams[code], code);
  for (const code of ["ARZ", "WSH", "LA", "JAC"]) assert.equal(teams[code], undefined, code);
});

test("a chart with two backs leaves the third empty rather than inventing one", () => {
  assert.deepEqual(teams.LAR, { rb1: "Kyren Williams", rb2: "Blake Corum", rb3: null });
});
