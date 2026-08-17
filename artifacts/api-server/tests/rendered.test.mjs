/**
 * Rendered-browser tests — the reader's view.
 *
 * The companion to seo.test.mjs: that suite proves the content is there without
 * JavaScript, this one proves the interactive version still works once the real
 * compiled bundle runs against that same markup. Both matter — SSR that the
 * client tears down, or a client that never hydrates, would each pass one suite
 * and fail the other.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const HOST_PAGE = "https://statchasers.com/nfl/player-news/";

let server;
let bundle;

/**
 * Every jsdom window created here, so they can be torn down.
 *
 * The widget installs a two-minute refresh interval and several timeouts. Those
 * keep Node's event loop alive, so leaving windows open makes the test file
 * hang after the last assertion passes rather than exiting.
 */
const windows = [];

before(async () => {
  server = await startServer({
    PLAYER_PROFILE_URL_TEMPLATE: "/nfl/players/{slug}",
    TEAM_PAGE_URL_TEMPLATE: "/nfl/teams/{slug}",
  });
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
  await server?.stop();
});

/**
 * Load a document, run the real bundle against it, and return handles plus any
 * runtime errors it produced.
 */
async function render(html, { url = HOST_PAGE } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url,
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  windows.push(window);

  let networkCalls = 0;
  window.fetch = async (input) => {
    networkCalls++;
    const res = await fetch(String(input));
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };

  window.eval(bundle);
  await new Promise((r) => setTimeout(r, 150));

  return {
    window,
    doc: window.document,
    errors,
    calls: () => networkCalls,
    visible: () =>
      [...window.document.querySelectorAll(".sc-card-item")].filter(
        (li) => li.style.display !== "none",
      ),
  };
}

/** The standalone app page, as the iframe/legacy path serves it. */
async function renderStandalone() {
  return render(await (await fetch(`${server.origin}/`)).text(), {
    url: `${server.origin}/`,
  });
}

/** The WordPress mount: host page + inlined fragment, cross-origin. */
async function renderMounted(query = "") {
  const { html } = await (
    await fetch(`${server.origin}/embed/ssr${query}`)
  ).json();
  return render(
    `<!doctype html><html lang="en"><head>` +
      `<title>Player News | StatChasers</title>` +
      `<link rel="canonical" href="${HOST_PAGE}" />` +
      `</head><body><h1>2026 Fantasy Football Player News</h1>${html}</body></html>`,
  );
}

describe("hydration", () => {
  test("enhances the server markup without discarding it", async () => {
    const before = await (await fetch(`${server.origin}/`)).text();
    const beforeCount = (before.match(/<article/g) ?? []).length;

    const { doc, errors } = await renderStandalone();
    assert.deepEqual(errors, [], "bundle threw during hydration");

    assert.equal(
      doc.querySelectorAll("article.sc-card").length,
      beforeCount,
      "hydration must not drop server-rendered items",
    );
  });

  test("reveals the pager and shows one page", async () => {
    const { doc, visible } = await renderStandalone();
    const pager = doc.querySelector(".sc-pager");
    assert.equal(pager.hasAttribute("hidden"), false, "pager should be revealed");

    const pageSize = Number(
      doc.querySelector(".news-list").getAttribute("data-page-size"),
    );
    assert.equal(visible().length, pageSize);
  });

  test("paginating makes no network request and does not touch the URL", async () => {
    const { doc, window, visible, calls } = await renderStandalone();

    let historyWrites = 0;
    for (const method of ["pushState", "replaceState"]) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (...args) => {
        historyWrites++;
        return original(...args);
      };
    }

    const urlBefore = window.location.href;
    const before = calls();

    doc.querySelector('[data-dir="next"]').click();
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(visible()[0].dataset.page, "1", "should be on page 2");
    assert.equal(calls() - before, 0, "pagination must not fetch");
    assert.equal(historyWrites, 0, "pagination must not write history");
    assert.equal(window.location.href, urlBefore, "URL must not change");
  });

  test("upgrades recent timestamps to relative labels", async () => {
    const { doc } = await renderStandalone();
    const relative = [...doc.querySelectorAll("time[data-ts]")].filter((t) =>
      /ago|just now/.test(t.textContent),
    );
    assert.ok(relative.length > 0, "expected relative timestamps after hydration");
    assert.ok(relative[0].title, "relative label should keep the precise time");
  });
});

describe("WordPress mount", () => {
  test("does not add a second canonical, title or H1", async () => {
    const { doc } = await renderMounted();
    assert.equal(doc.querySelectorAll('link[rel="canonical"]').length, 1);
    assert.equal(doc.querySelectorAll("title").length, 1);
    assert.equal(doc.querySelectorAll("h1").length, 1);
    assert.equal(
      doc.querySelectorAll("[data-sc-root] h1").length,
      0,
      "the tool must not emit its own H1",
    );
  });

  test("refresh uses the cross-origin API base and honours the limit", async () => {
    const { doc, window } = await renderMounted("?limit=20&page_size=5");

    let requested = null;
    window.fetch = async (input) => {
      requested = String(input);
      const res = await fetch(requested);
      return { ok: res.ok, status: res.status, json: () => res.json() };
    };

    doc.dispatchEvent(new window.Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(requested, `${server.origin}/api/news?limit=20`);
  });

  test("client re-render preserves entity links", async () => {
    const { doc, window } = await renderMounted("?limit=12");
    const before = doc.querySelectorAll("a.sc-entity-link").length;
    assert.ok(before > 0, "expected entity links from the server");

    doc.dispatchEvent(new window.Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(
      doc.querySelectorAll("a.sc-entity-link").length,
      before,
      "re-render dropped internal links",
    );
  });
});

describe("performance characteristics", () => {
  test("vitals bundle is not loaded unless an endpoint is configured", async () => {
    const { doc } = await renderMounted();
    assert.equal(
      doc.querySelectorAll("script[data-sc-vitals]").length,
      0,
      "monitoring must be opt-in",
    );
  });

  test("vitals bundle loads when an endpoint is configured", async () => {
    const { doc } = await renderMounted(
      "?vitals_endpoint=" + encodeURIComponent("https://example.com/rum"),
    );
    const script = doc.querySelector("script[data-sc-vitals]");
    assert.ok(script, "expected the vitals bundle to be requested");
    assert.ok(script.src.endsWith("/dist/statchasers-vitals.js"));
    assert.equal(script.async, true, "monitoring must not block the tool");
  });

  test("vitals ships as a separate bundle, not inside the main one", () => {
    const main = fs.statSync(
      path.join(APP_DIR, "public", "dist", "statchasers-news.js"),
    );
    const vitals = path.join(APP_DIR, "public", "dist", "statchasers-vitals.js");
    assert.ok(fs.existsSync(vitals), "vitals bundle should be built separately");
    assert.ok(
      !bundle.includes("onINP") || !bundle.includes("web-vitals"),
      "web-vitals must not be bundled into the main script",
    );
    // Keep the tool's own payload small; this is a regression guard, not a
    // hard budget. Raise it deliberately if the tool genuinely grows.
    assert.ok(
      main.size < 40_000,
      `main bundle is ${main.size}B — investigate before raising this budget`,
    );
  });

  test("a refresh returning unchanged data does not rebuild the list", async () => {
    const { doc, window } = await renderMounted("?limit=12");
    const firstCard = doc.querySelector("article.sc-card");

    doc.dispatchEvent(new window.Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(
      doc.querySelector("article.sc-card"),
      firstCard,
      "unchanged data must not trigger a full re-render",
    );
  });
});
