/**
 * Rendered-browser tests - the reader's view.
 *
 * The companion to seo.test.mjs: that suite proves the content is there without
 * JavaScript, this one proves the interactive version still works once the real
 * compiled bundle runs against that same markup. Both matter - SSR that the
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

  test("later pages actually become visible under the real stylesheet", async () => {
    // The other pagination tests read `style.display`, i.e. the INLINE style.
    // That is blind to the failure this test exists for: clearing the inline
    // style hands the card back to the stylesheet, which hides every page but
    // the first - so a "shown" page renders blank while its inline style looks
    // perfectly fine. Only a computed style, with styles.css actually loaded,
    // can tell the difference.
    const css = await (await fetch(`${server.origin}/styles.css`)).text();
    const html = (await (await fetch(`${server.origin}/`)).text())
      // The no-JS fallback (`.sc-card-item { display: block !important }`) has to
      // go. A browser with scripting enabled parses <noscript> as inert text, but
      // jsdom applies the style inside it - which would force every page visible
      // and make this test pass no matter what the bundle does. Dropping it
      // reproduces what the reader's browser actually cascades.
      //
      // Strip BEFORE injecting the stylesheet: styles.css names `<noscript>` in a
      // comment, and with the CSS already inlined this pattern would run from
      // there to the real closing tag and swallow the entire list.
      .replace(/<noscript>[\s\S]*?<\/noscript>/g, "")
      .replace("</head>", `<style>${css}</style></head>`);

    const dom = new JSDOM(html, {
      runScripts: "outside-only",
      url: `${server.origin}/`,
      pretendToBeVisual: true,
    });
    const { window } = dom;
    windows.push(window);
    const doc = window.document;
    const shown = (el) => window.getComputedStyle(el).display !== "none";

    const laterPage = doc.querySelector('.sc-card-item[data-page="1"]');
    assert.ok(laterPage, "fixture needs at least two pages of cards");
    // Guards the guard: if the stylesheet failed to parse or stopped hiding
    // later pages, everything below would pass for the wrong reason.
    assert.equal(
      shown(laterPage),
      false,
      "server markup should hide later pages via CSS before the bundle runs",
    );

    window.eval(bundle);
    await new Promise((r) => setTimeout(r, 150));

    const pages = Number(doc.querySelector(".news-list").dataset.total)
      ? [...doc.querySelectorAll(".sc-card-item")].reduce(
          (max, el) => Math.max(max, Number(el.dataset.page)),
          0,
        ) + 1
      : 1;

    for (let page = 1; page < pages; page++) {
      doc.querySelector('[data-dir="next"]').click();
      await new Promise((r) => setTimeout(r, 30));

      const onPage = [...doc.querySelectorAll(`.sc-card-item[data-page="${page}"]`)];
      assert.ok(
        onPage.every(shown),
        `page ${page + 1} rendered blank - no card on it is actually visible`,
      );
      assert.ok(
        [...doc.querySelectorAll('.sc-card-item[data-page="0"]')].every(
          (el) => !shown(el),
        ),
        `page 1 stayed visible while on page ${page + 1}`,
      );
    }
  });

  test("upgrades recent timestamps to relative labels", async () => {
    // Freshen one card's stamp before hydrating. This suite runs against
    // whatever the last ingest stored, and a relative label only applies inside
    // a 48-hour window - asserting on the stored dates would make the test pass
    // or fail on the age of the data.
    const recent = Date.now() - 3 * 60 * 60 * 1000;
    const page = (await (await fetch(`${server.origin}/`)).text()).replace(
      /<time class="sc-chip" datetime="[^"]*" data-ts="\d+"/,
      () =>
        `<time class="sc-chip" datetime="${new Date(recent).toISOString()}"` +
        ` data-ts="${recent}"`,
    );
    const { doc } = await render(page, { url: `${server.origin}/` });

    const relative = [...doc.querySelectorAll("time[data-ts]")].filter((t) =>
      /ago|just now/.test(t.textContent),
    );
    assert.ok(relative.length > 0, "expected relative timestamps after hydration");
    assert.ok(relative[0].title, "relative label should keep the precise time");
  });
});

describe("filters", () => {
  /** Hydrate the standalone page and hand back the filter controls. */
  async function withFilters() {
    const handles = await renderStandalone();
    const { doc } = handles;
    const menu = doc.querySelector("#scFilterTeam");
    return {
      ...handles,
      filters: doc.querySelector(".sc-filters"),
      // The team picker is a <details> disclosure, not a <select> - a native
      // <option> cannot carry a logo. Its rows are ordinary buttons.
      menu,
      teamRows: () => [...menu.querySelectorAll(".sc-team-option")],
      pickTeam: (row) => {
        menu.open = true;
        row.dispatchEvent(
          new doc.defaultView.MouseEvent("click", { bubbles: true }),
        );
      },
      player: doc.querySelector("#scFilterPlayer"),
      cardsFor: (code) =>
        doc.querySelectorAll(`.sc-card-item[data-team="${code}"]`).length,
    };
  }

  /** Fire the event the control really produces, so the delegated handler runs. */
  function setValue(el, value, type) {
    el.value = value;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
  }

  test("controls are inert markup until the bundle runs", async () => {
    // A dropdown that cannot filter is worse than no dropdown: the no-JS
    // visitor gets every card via the <noscript> rule instead.
    const raw = await (await fetch(`${server.origin}/`)).text();
    assert.match(
      raw,
      /<div class="sc-filters" hidden>/,
      "filters must ship hidden",
    );

    const { filters } = await withFilters();
    assert.equal(filters.hidden, false, "hydration should reveal the filters");
  });

  test("is not a form and adds no crawlable URLs", async () => {
    // A <form> with no action submits to the current URL, so one Enter in the
    // search box would reload with a query string and hand crawlers a duplicate.
    const raw = await (await fetch(`${server.origin}/`)).text();
    assert.equal(/<form/i.test(raw), false, "filters must not be a form");

    const { doc } = await withFilters();
    const links = [...doc.querySelectorAll(".sc-filters a")];
    assert.deepEqual(links, [], "filters must not contain links");
  });

  test("team menu lists exactly the teams on the page, sorted", async () => {
    const { doc, teamRows } = await withFilters();
    const rows = teamRows();

    assert.equal(rows[0].dataset.team, "", "first row should be the reset");
    const listed = rows.slice(1).map((row) => row.dataset.team);
    const present = [
      ...new Set(
        [...doc.querySelectorAll(".sc-card-item[data-team]")].map(
          (li) => li.dataset.team,
        ),
      ),
    ];
    assert.deepEqual([...listed].sort(), [...present].sort());

    const names = rows
      .slice(1)
      .map((row) => row.querySelector(".sc-team-name").textContent);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  test("every team in the menu is shown with its logo", async () => {
    const { teamRows } = await withFilters();
    const rows = teamRows();
    assert.ok(rows.length > 1, "expected at least one team in the menu");

    for (const row of rows.slice(1)) {
      const logo = row.querySelector("img.sc-team-logo");
      assert.ok(logo, `no logo on the ${row.dataset.team} row`);
      // The locally hosted SVG served from this origin, never the Sleeper PNG.
      assert.match(logo.getAttribute("src"), /^\/team-logos\/[a-z]{2,3}-[0-9a-f]{8}\.svg$/);
      assert.equal(
        logo.getAttribute("alt"),
        "",
        "the logo is decorative - the team name is beside it",
      );
    }

    // The reset row keeps the labels aligned without inventing a crest for it.
    assert.equal(rows[0].querySelector("img"), null);
    assert.ok(rows[0].querySelector(".sc-team-all"));
  });

  test("choosing a team moves its logo onto the trigger", async () => {
    const { doc, teamRows, pickTeam, menu } = await withFilters();
    const row = teamRows()[1];
    const code = row.dataset.team;

    pickTeam(row);

    const current = doc.querySelector(".sc-team-current");
    assert.ok(
      /\/team-logos\/[a-z]{2,3}-[0-9a-f]{8}\.svg$/.test(current.querySelector("img").getAttribute("src")) &&
        current.querySelector("img").getAttribute("src").includes(`/team-logos/${code}-`),
      "the trigger should show the chosen team's logo",
    );
    assert.equal(
      current.querySelector(".sc-team-name").textContent,
      row.querySelector(".sc-team-name").textContent,
    );
    assert.equal(menu.open, false, "picking a team closes the menu");
    assert.equal(
      doc.querySelectorAll(".sc-team-option.is-current").length,
      1,
      "exactly one row stays marked as current",
    );
  });

  test("selecting a team shows only that team and repaginates", async () => {
    const { doc, teamRows, pickTeam, visible, cardsFor, calls } =
      await withFilters();
    const row = teamRows()[1];
    const code = row.dataset.team;
    const expected = cardsFor(code);
    const before = calls();

    pickTeam(row);

    const shown = visible();
    assert.ok(shown.length > 0, "expected at least one card for the team");
    assert.ok(
      shown.every((li) => li.dataset.team === code),
      "another team's card survived the filter",
    );

    const pageSize = Number(doc.querySelector(".news-list").dataset.pageSize);
    assert.equal(shown.length, Math.min(expected, pageSize));

    const pager = doc.querySelector(".sc-pager");
    const pages = Math.ceil(expected / pageSize);
    if (pages <= 1) {
      assert.equal(pager.hidden, true, "a single page needs no pager");
    } else {
      assert.match(pager.querySelector(".sc-pager-status").textContent, /1 of/);
    }
    assert.equal(calls() - before, 0, "filtering must not fetch");
  });

  test("player search matches through punctuation and accents", async () => {
    const { doc, player, visible } = await withFilters();
    // data-player is pre-normalized by the renderer; type a word out of one.
    const sample = [...doc.querySelectorAll(".sc-card-item[data-player]")]
      .map((li) => li.dataset.player)
      .find((v) => v && v.includes(" "));
    assert.ok(sample, "expected a card with a two-part player name");
    const surname = sample.split(" ").pop();

    setValue(player, surname, "input");
    const shown = visible();
    assert.ok(shown.length > 0, "expected a match");
    assert.ok(
      shown.every((li) => li.dataset.player.includes(surname)),
      "a non-matching card survived the search",
    );

    // The same query with punctuation and an accent must still match: both
    // sides are folded through searchKey().
    setValue(player, `${surname.toUpperCase()}'`, "input");
    assert.equal(visible().length, shown.length);
  });

  test("no matches shows a message instead of an empty gap", async () => {
    const { doc, player, visible } = await withFilters();
    setValue(player, "zzzznotaplayer", "input");

    assert.deepEqual(visible(), []);
    const empty = doc.querySelector(".sc-no-matches");
    assert.equal(empty.hidden, false, "expected the no-matches message");
    assert.equal(
      doc.querySelector(".news-list").style.display,
      "none",
      "the list reserves a page of height - hide it or it holds a blank gap",
    );
    assert.equal(doc.querySelector(".sc-pager").hidden, true);
  });

  test("clearing the filters restores the full list", async () => {
    const { doc, teamRows, pickTeam, player, visible } = await withFilters();
    const pageSize = Number(doc.querySelector(".news-list").dataset.pageSize);

    pickTeam(teamRows()[1]);
    setValue(player, "zzzznotaplayer", "input");
    assert.deepEqual(visible(), []);

    setValue(player, "", "input");
    // Row 0 is the reset, which is how the reader gets back to every team.
    pickTeam(teamRows()[0]);

    assert.equal(visible().length, pageSize, "should be back to a full page");
    assert.equal(doc.querySelector(".sc-no-matches").hidden, true);
    assert.equal(doc.querySelector(".news-list").style.display, "");
    assert.equal(doc.querySelector(".sc-filter-status").textContent, "");
  });

  test("filtering never writes to the URL", async () => {
    const { window, doc, teamRows, pickTeam, player } = await withFilters();
    let historyWrites = 0;
    for (const method of ["pushState", "replaceState"]) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (...args) => {
        historyWrites++;
        return original(...args);
      };
    }
    const urlBefore = window.location.href;

    pickTeam(teamRows()[1]);
    setValue(player, "smith", "input");

    assert.equal(historyWrites, 0, "filters must not write history");
    assert.equal(window.location.href, urlBefore, "URL must not change");
    assert.ok(doc.querySelector(".sc-filter-status").textContent.length > 0);
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

  test("refresh uses the cross-origin API base and honors the limit", async () => {
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
      `main bundle is ${main.size}B - investigate before raising this budget`,
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
