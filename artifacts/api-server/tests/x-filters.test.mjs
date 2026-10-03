/**
 * The feed's filters, driven by the real compiled bundle.
 *
 * The companion to x-ingest.test.mjs: that file proves an X post reaches the
 * feed, this one proves a reader can then narrow to it. It runs the shipped
 * `public/dist/statchasers-news.js` against markup produced by the SAME
 * renderer the server uses, in jsdom - so a filter that works only because the
 * test built its own convenient HTML would not pass.
 *
 * No server and no database: the markup is rendered here from fixed items, which
 * is what makes "three X cards, two reporters, two categories" something the
 * test can state rather than something it has to arrange in an archive.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

import { APP_DIR } from "./helpers/server.mjs";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { renderFragment } = await importModule("lib/render");

const windows = [];
let bundle;

before(() => {
  bundle = fs.readFileSync(
    path.join(APP_DIR, "public", "dist", "statchasers-news.js"),
    "utf8",
  );
});

after(async () => {
  for (const window of windows) {
    try {
      window.close();
    } catch {
      /* already closed */
    }
  }
  await cleanupBundles();
});

const NOW = Date.UTC(2026, 8, 16, 18, 0, 0);

const ITEMS = [
  {
    id: "wire-1",
    title: "Rachaad White: Working off to side at practice Thursday",
    pubDateMs: NOW,
    playerName: "Rachaad White",
    team: "tb",
    source: "Dynasty Command",
    sourceType: "wire",
    category: "practice",
  },
  {
    id: "x-1",
    title: "49ers RB Christian McCaffrey was limited at practice with a calf injury",
    link: "https://x.com/adamschefter/status/1",
    pubDateMs: NOW - 60_000,
    playerName: "Christian McCaffrey",
    team: "sf",
    source: "Adam Schefter",
    sourceType: "x",
    authorHandle: "adamschefter",
    category: "injury",
  },
  {
    id: "x-2",
    title: "Bears are signing OL Test Lineman to a two-year deal",
    link: "https://x.com/rapsheet/status/2",
    pubDateMs: NOW - 120_000,
    team: "chi",
    source: "Ian Rapoport",
    sourceType: "x",
    authorHandle: "rapsheet",
    category: "transaction",
  },
  {
    id: "x-3",
    title: "He has been named the starter for Week 3",
    link: "https://x.com/adamschefter/status/3",
    pubDateMs: NOW - 180_000,
    source: "Adam Schefter",
    sourceType: "x",
    authorHandle: "adamschefter",
    category: "depth-chart",
  },
  {
    id: "wire-2",
    title: "Justin Jefferson: Full participant Wednesday",
    pubDateMs: NOW - 240_000,
    playerName: "Justin Jefferson",
    team: "min",
    source: "Dynasty Command",
    sourceType: "wire",
    category: "practice",
  },
];

/** Render the fragment, run the shipped bundle against it, hand back the DOM. */
async function mount() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));

  // One page, so "visible" means "passed the filters" and never "is on page 2".
  const html = renderFragment(ITEMS, { pageSize: ITEMS.length, heading: false });

  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>t</title></head>` +
      `<body>${html}</body></html>`,
    { runScripts: "outside-only", url: "https://statchasers.com/nfl/player-news/", pretendToBeVisual: true, virtualConsole },
  );
  const { window } = dom;
  windows.push(window);

  // The widget polls for fresh items on a timer and on load. There is no server
  // here, and a refresh that replaced the list would be replacing the very
  // markup under test - so the fetch fails and the bundle keeps what it has,
  // which is its documented behaviour.
  window.fetch = async () => {
    throw new Error("offline");
  };

  window.eval(bundle);
  await new Promise((r) => setTimeout(r, 120));

  const doc = window.document;
  const visible = () =>
    [...doc.querySelectorAll(".sc-card-item")].filter(
      (li) => li.style.display !== "none",
    );

  /** Set a <select> and dispatch the event the bundle listens for. */
  const choose = (id, value) => {
    const select = doc.querySelector(`#${id}`);
    assert.ok(select, `${id} should be in the toolbar`);
    select.value = value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  return { window, doc, errors, visible, choose };
}

describe("the source filter", () => {
  test("the toolbar has the new controls and keeps the old ones", async () => {
    const { doc, errors } = await mount();
    assert.deepEqual(errors, [], "bundle threw while hydrating");

    for (const id of [
      "scFilterPlayer",
      "scFilterTeam",
      "scFilterCategory",
      "scFilterSource",
      "scFilterAccount",
    ]) {
      assert.ok(doc.querySelector(`#${id}`), `${id} missing from the toolbar`);
    }

    // The account menu lists the reporters that are actually in the feed, by
    // name, and nobody else.
    const accounts = [...doc.querySelectorAll("#scFilterAccount option")].map(
      (option) => [option.value, option.textContent],
    );
    assert.deepEqual(accounts, [
      ["", "All accounts"],
      ["adamschefter", "Adam Schefter"],
      ["rapsheet", "Ian Rapoport"],
    ]);
  });

  test("narrowing to X hides everything that is not from X", async () => {
    const { visible, choose } = await mount();
    assert.equal(visible().length, ITEMS.length);

    choose("scFilterSource", "x");
    const shown = visible();
    assert.equal(shown.length, 3);
    assert.ok(shown.every((li) => li.dataset.source === "x"));
  });

  test("narrowing to News hides the X posts", async () => {
    const { visible, choose } = await mount();
    choose("scFilterSource", "news");
    const shown = visible();
    assert.equal(shown.length, 2);
    assert.ok(shown.every((li) => li.dataset.source === "news"));
  });

  test("a reporter can be filtered to on their own", async () => {
    const { visible, choose } = await mount();
    choose("scFilterAccount", "adamschefter");
    const shown = visible();
    assert.equal(shown.length, 2);
    assert.ok(shown.every((li) => li.dataset.handle === "adamschefter"));
  });

  test("choosing News clears a chosen reporter rather than showing nothing", async () => {
    const { doc, visible, choose } = await mount();
    choose("scFilterAccount", "rapsheet");
    assert.equal(visible().length, 1);

    // The two together could only ever match nothing, so the narrower one goes.
    choose("scFilterSource", "news");
    assert.equal(doc.querySelector("#scFilterAccount").value, "");
    assert.equal(visible().length, 2);
  });

  test("the category filter works across both lanes", async () => {
    const { visible, choose } = await mount();

    choose("scFilterCategory", "injury");
    assert.equal(visible().length, 1);

    choose("scFilterCategory", "practice");
    const practice = visible();
    // One wire row and one wire row - the category is not an X-only concept.
    assert.equal(practice.length, 2);
    assert.ok(practice.every((li) => li.dataset.source === "news"));
  });

  test("filters combine, and clearing them brings everything back", async () => {
    const { visible, choose } = await mount();

    choose("scFilterSource", "x");
    choose("scFilterCategory", "transaction");
    assert.equal(visible().length, 1);

    choose("scFilterCategory", "");
    assert.equal(visible().length, 3);

    choose("scFilterSource", "");
    assert.equal(visible().length, ITEMS.length);
  });

  test("the count the reader is shown matches what is on screen", async () => {
    const { doc, visible, choose } = await mount();
    choose("scFilterSource", "x");
    assert.equal(
      doc.querySelector(".sc-filter-status").textContent,
      `${visible().length} of ${ITEMS.length} updates`,
    );
  });

  test("an X card shows its reporter and links to the post", async () => {
    const { doc } = await mount();
    const card = [...doc.querySelectorAll(".sc-card-item")].find(
      (li) => li.dataset.handle === "adamschefter",
    );

    const label = card.querySelector(".sc-card-label-x");
    assert.ok(label, "an X card carries the author byline, not the section tag");
    assert.match(label.textContent, /Adam Schefter/);
    assert.match(label.textContent, /@adamschefter/);
    assert.ok(label.querySelector("svg.sc-x-mark"), "the X mark is inline SVG");

    assert.equal(
      card.querySelector("a.sc-card-link").getAttribute("href"),
      "https://x.com/adamschefter/status/1",
    );
  });

  test("a news card carries its category, not an author byline", async () => {
    const { doc } = await mount();
    const cards = [...doc.querySelectorAll(".sc-card-item")];
    const card = cards.find((li) => li.dataset.source === "news");
    // "Practice", from ITEMS[0].category - the label is the item's own
    // category, not a fixed string every card shares. This used to read
    // "Player News" on all of them.
    assert.equal(card.querySelector(".sc-card-label").textContent, "Practice");
    assert.equal(card.querySelector(".sc-card-label-x"), null);

    // And it really does vary between cards, which is the whole point.
    const labels = cards
      .filter((li) => li.dataset.source === "news")
      .map((li) => li.querySelector(".sc-card-label").textContent);
    assert.ok(labels.length >= 1, "there is at least one wire card to label");
    assert.ok(
      !labels.includes("Player News"),
      "no card falls back to the old fixed label",
    );
  });
});
