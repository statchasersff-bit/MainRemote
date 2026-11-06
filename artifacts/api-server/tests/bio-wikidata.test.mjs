/**
 * The Wikidata fold in scripts/player/buildBioSources.mjs. Wikidata moved many
 * places' names to the language-neutral "mul" label, and the label service
 * answers a missing label with the bare id ("Q16568"), which was stored as
 * the birthplace ("Q16568, FL" for Ashton Jeanty, 2026-11-06).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { foldWikidata } from "../scripts/player/buildBioSources.mjs";

const row = (extra) => ({
  pfr: { value: "J/JeanAs00" },
  item: { value: "http://www.wikidata.org/entity/Q122418057" },
  ...extra,
});

test("a birthplace label is the town, with its state", () => {
  const out = foldWikidata([row({ bpLabel: { value: "Jacksonville" }, stateCode: { value: "US-FL" } })]);
  assert.equal(out.JeanAs00.birthPlace, "Jacksonville, FL");
});

test("a bare id from the label service is never stored as a name", () => {
  const out = foldWikidata([
    row({ bpLabel: { value: "Q16568" }, stateCode: { value: "US-FL" } }),
    row({ school: { value: "x" }, schoolLabel: { value: "Q7654321" }, typeLabel: { value: "high school" } }),
  ]);
  assert.equal(out.JeanAs00.birthPlace, null);
  assert.deepEqual(out.JeanAs00.highSchools, []);
});

test("an unnamed country falls back to the town alone", () => {
  const out = foldWikidata([row({ bpLabel: { value: "Makati" }, countryLabel: { value: "Q928" } })]);
  assert.equal(out.JeanAs00.birthPlace, "Makati");
});
