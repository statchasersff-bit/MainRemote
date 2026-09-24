/**
 * Player page regression tests.
 *
 * Same posture as team.test.mjs and seo.test.mjs: fetch the served HTML and
 * assert on it WITHOUT executing any JavaScript, because the whole point of
 * these pages is that they arrive complete. If someone moves a tab behind a
 * client fetch, drops the canonical, or lets a profile render a second <h1>
 * inside a WordPress page, these fail.
 *
 * Tolerant of what can legitimately be missing. A player's advanced row, injury
 * history, bio and news all come from separate sources and any of them can be
 * absent for a given player; the page is designed to drop those tabs rather
 * than render them empty. So the assertions cover what the page owes
 * regardless — identity, navigation, the honesty rules — plus the rule that a
 * section which has no data must be ABSENT rather than full of placeholders.
 *
 * The fixture player is chosen at runtime from /embed/players.json rather than
 * hard-coded, because the roster changes every offseason and a test pinned to
 * one player is a test that fails for a trade.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";

/**
 * A GET with exactly the headers given.
 *
 * Not fetch(): undici attaches its own cache directives, which is enough to
 * stop a conditional request ever revalidating. team.test.mjs and seo.test.mjs
 * carry the same helper for the same reason.
 */
function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let server;
/** A player with a game log, picked once so every test looks at the same page. */
let fixture;
let roster;

before(async () => {
  server = await startServer();

  const res = await fetch(`${server.origin}/embed/players.json`);
  const body = await res.json();
  roster = body.players ?? [];

  // The first player whose page renders a game log — the tests below assert on
  // numbers, and a player with no recorded football has none to assert on.
  for (const player of roster.slice(0, 40)) {
    const page = await fetch(`${server.origin}/player/${player.slug}`);
    const html = await page.text();
    if (page.status === 200 && html.includes('id="game-log"')) {
      fixture = player;
      break;
    }
  }
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

async function get(pathname, options = {}) {
  const res = await fetch(`${server.origin}${pathname}`, {
    redirect: "manual",
    ...options,
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function dom(pathname) {
  const res = await get(pathname);
  assert.equal(res.status, 200, `${pathname} should be 200`);
  return { ...res, doc: new JSDOM(res.body).window.document };
}

/** The compiled player bundle, read once. */
let playerBundle;
const windows = [];

/**
 * The page with its own JavaScript actually run.
 *
 * Everything else in this file asserts on the HTML as sent, which is what a
 * crawler reads. Two behaviours are different in kind rather than in polish and
 * invisible in the served markup: the tab strip, which switches the panel,
 * rewrites the heading above the fragment and puts a different URL in the
 * address bar; and the state swap, which re-renders the page from another
 * scoring format or season and deliberately does NOT touch the address bar.
 * Mirrors team.test.mjs.
 */
async function hydrated(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);

  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));

  playerBundle ??= fs.readFileSync(
    path.join(APP_DIR, "public", "dist", "statchasers-player.js"),
    "utf8",
  );

  const jsdom = new JSDOM(await res.text(), {
    runScripts: "outside-only",
    url: `${server.origin}${pathname}`,
    pretendToBeVisual: true,
    virtualConsole,
  });
  windows.push(jsdom.window);
  // jsdom ships no fetch, and the bundle's state swap — the scoring toggle and
  // the season chips — is the one behaviour that needs one. Bridged to Node's,
  // against the same test server the page was loaded from, so a click here goes
  // through the real route and comes back as real HTML.
  jsdom.window.fetch = async (input, init) => {
    const target = new URL(String(input), jsdom.window.location.href);
    const response = await fetch(target, { headers: init?.headers });
    const body = await response.text();
    return { ok: response.ok, status: response.status, text: async () => body };
  };
  jsdom.window.eval(playerBundle);
  await new Promise((r) => setTimeout(r, 50));
  return { window: jsdom.window, doc: jsdom.window.document, errors };
}

describe("player routes", () => {
  test("the roster endpoint lists indexed players only", async () => {
    assert.ok(roster.length > 100, "expected a few hundred indexed players");
    assert.ok(roster.length < 2000, "the whole dictionary must not be listed");
    for (const player of roster.slice(0, 20)) {
      assert.match(player.slug, /^[a-z0-9][a-z0-9-]*$/);
      assert.ok(player.name, "every row carries a name");
      assert.ok(player.id, "every row carries the Sleeper id the CDN needs");
    }
  });

  test("a canonical slug serves the profile", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1, "exactly one H1 on the standalone page");
    assert.match(h1[0].textContent, new RegExp(fixture.name.split(" ")[0]));

    const root = doc.querySelector("[data-scp-root]");
    assert.ok(root, "root element present");
    assert.equal(root.getAttribute("data-player"), fixture.slug);
  });

  test("an unknown slug is a 404 with a way back", async () => {
    const res = await get("/player/not-a-real-person");
    assert.equal(res.status, 404);
    assert.match(res.body, /\/player/);
  });

  test("a slug that is not slug-shaped is refused without a lookup", async () => {
    const res = await get("/player/..%2F..%2Fetc%2Fpasswd");
    assert.equal(res.status, 404);
  });

  test("the news tool and the team hubs are untouched", async () => {
    const news = await get("/");
    assert.equal(news.status, 200);
    assert.ok(news.body.includes("statchasers-news.js"));

    const team = await get("/team/new-england-patriots");
    assert.equal(team.status, 200);
    assert.ok(team.body.includes("data-sct-root"));
  });
});

describe("player page content", () => {
  test("the page ships its content, not a shell", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const text = doc.body.textContent;

    // Every panel is in the first response — the tabs hide them with CSS, they
    // are not fetched. This is the whole reason the page exists.
    const panels = doc.querySelectorAll("[data-scp-panel]");
    assert.ok(panels.length >= 2, "at least two panels shipped");

    const log = doc.querySelector("#game-log table tbody");
    assert.ok(log, "the game log table is in the HTML");
    assert.ok(log.querySelectorAll("tr").length > 0, "with rows in it");

    assert.ok(text.length > 1500, "the page carries real prose and numbers");
  });

  /*
   * The header's responsive contract.
   *
   * Ported from the start/sit tool's player header, whose rule is that
   * breakpoints decide topology and measurement decides everything inside. The
   * measuring itself runs in the browser and these tests execute no
   * JavaScript, so what is asserted here is what the SERVER owes the fitter:
   * complete, correctly sized markup that needs no script to be right, and the
   * hooks the fitter reads.
   */
  test("the header arrives complete and at full size, with no script", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    const hero = doc.querySelector("[data-scp-hero]");
    assert.ok(hero, "the header carries the hook the fitter looks for");

    // No scales written by the server. The fitter writes them from what it
    // measures; until it does, player.css's `, 1` fallbacks are the answer,
    // and a reader with JavaScript off keeps that answer for good.
    const style = hero.getAttribute("style") ?? "";
    assert.ok(
      !style.includes("--scp-hero-"),
      "the server writes no scale — the header is full size until measured",
    );

    // The probe is built by cloning in the browser, never served: an extra
    // copy of the player's name and club in a document whose whole job is to
    // be indexed for that name is a cost this page will not pay.
    assert.equal(
      doc.querySelectorAll("[data-scp-hero-probe], .scp-hero-probe").length,
      0,
      "no measuring copies in the served HTML",
    );
  });

  test("the header's short forms are attributes, never its text", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const hero = doc.querySelector("[data-scp-hero]");

    // Below 480px the phone fitter may draw "J. Brissett" and "ARI Cardinals"
    // (mak's call: shrink the name, then initial it, rather than wrap). Both
    // are generated content from attributes, so the served text — what a
    // crawler indexes and a screen reader reads — is always the full form.
    // The older multi-length swaps are still gone.
    assert.equal(
      hero.querySelectorAll(".scp-swap, [data-initial]").length,
      0,
      "no swapped copies of the text are shipped",
    );

    const first = hero.querySelector(".scp-title-first");
    if (first) {
      assert.equal(
        first.getAttribute("data-scp-initial"),
        `${first.textContent.charAt(0)}.`,
        "the initial is the given name's first letter, as an attribute",
      );
    }

    // Every fact the header states, stated whole.
    const facts = hero.querySelector(".scp-hero-facts")?.textContent ?? "";
    if (fixture.years_exp) {
      assert.match(facts, /Exp \d+ yrs|Rookie/, "the experience is on the line");
    }

    const teamLink = hero.querySelector("a.scp-hero-team");
    if (teamLink) {
      const title = teamLink.getAttribute("title") ?? "";
      assert.ok(title.length > 0, "the club's link carries its full name");
      assert.equal(
        teamLink.textContent.trim(),
        title,
        "and prints that same name, not a code standing in for it",
      );
      assert.match(
        teamLink.getAttribute("data-scp-short") ?? "",
        /^[A-Z]{2,3} \S/,
        "the phone tier's short club form is a code and nickname attribute",
      );
    }
  });

  test("the header's figures each say what they are, and nothing else", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const cells = [...doc.querySelectorAll(".scp-hero-stats .scp-hero-stat")];

    // A player with no season has no panel at all, which is the designed
    // answer rather than an empty one — so there is nothing to assert about.
    if (cells.length === 0) return;

    // Scoring first and gold, because the panel is ordered: what he scores,
    // where that puts him, who has him. A panel whose lead is not the first
    // cell is a panel with two answers competing to be read first.
    assert.ok(
      cells[0].className.includes("is-lead"),
      "the scoring cell leads the panel",
    );
    assert.equal(
      doc.querySelectorAll(".scp-hero-stat.is-lead").length,
      1,
      "exactly one cell is the lead",
    );

    for (const cell of cells) {
      const label = cell.querySelector(".scp-hero-stat-label")?.textContent.trim();
      const value = cell.querySelector(".scp-hero-stat-value")?.textContent.trim();
      assert.ok(label, "every cell says what its figure is");
      assert.ok(value, "every cell has a figure");
      // The panel drops a cell it has no figure for rather than filling it.
      // A dash here would be a cell taking the room of an answer to say it
      // has none, which is the rule the rest of this page is built on.
      assert.ok(
        !value.includes("\u2014"),
        `${label} is a figure, not a placeholder`,
      );

      // The panel is three figures and their labels, nothing else. The
      // qualifiers that used to sit under them — the games count, which way a
      // rank was measured, whose ownership pool — are drawn in full further
      // down the page, and a second line of grey under every figure was
      // reading as noise against the figures themselves.
      assert.equal(
        cell.querySelector(".scp-hero-stat-sub"),
        null,
        `${label} carries no sub-line`,
      );
      if (label === "Rostered") {
        assert.match(value, /^\d+(\.\d)?%$/, "ownership is a percentage");
      }
      if (label === "Pos rank") {
        assert.match(value, /^[A-Z]+\d+$/, "a rank is a position and a place");
      }
    }
  });

  test("the heading is the player's name, whatever the header does to it", async () => {
    // The two-line setting and the fitter are both presentation. Nothing they
    // do may change the string an H1 hands a crawler or a screen reader — and
    // nothing shortens it either: the header briefly contracted the given name
    // at its narrowest width, and an initial is not what a reader came for.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const heading = doc.querySelector(".scp-hero h1.scp-title");
    assert.ok(heading, "the header sets the name as the document's H1");
    assert.equal(
      heading.textContent.replace(/\s+/g, " ").trim(),
      fixture.name,
      "the H1 reads exactly the player's name",
    );
    assert.equal(
      heading.querySelectorAll(".scp-swap").length,
      0,
      "and carries no swap, so it cannot be shortened out from under itself",
    );

    const given = heading.querySelector(".scp-title-first");
    if (given) {
      assert.equal(
        given.textContent,
        fixture.name.slice(0, given.textContent.length),
        "the given name span holds the front of the player's name",
      );
      assert.equal(
        given.getAttribute("data-initial"),
        null,
        "and no old-style swap attribute (the phone initial is data-scp-initial)",
      );
    }
  });

  test("nothing in the header is hidden at a breakpoint", async () => {
    // The anti-pattern this port exists to remove. The headshot used to be
    // `display: none` under 680px; it now shrinks to 65% and, below 460px,
    // moves behind the name. A header whose player has no face is a smaller
    // page, not a better one.
    const css = await get("/player.css");
    assert.equal(css.status, 200);

    const photoRules = css.body.match(/\.scp-photo\s*\{[^}]*\}/g) ?? [];
    assert.ok(photoRules.length > 0, "the headshot has rules to check");
    for (const rule of photoRules) {
      assert.ok(
        !/display:\s*none/.test(rule),
        `the headshot is never hidden, but a rule does it: ${rule}`,
      );
    }

    // And every size in the header is written against a scale with a
    // fallback of 1, so the unmeasured header is the full-size one.
    for (const variable of ["pad", "gap", "bust", "id", "tbl", "tblp"]) {
      assert.ok(
        css.body.includes(`var(--scp-hero-${variable}, 1)`),
        `--scp-hero-${variable} is used with a fallback of 1`,
      );
    }
  });

  test("the tables a reader scrolls carry the filled header row", async () => {
    // The fill is what makes a sticky column row read as the table's edge
    // rather than as another row, so it belongs on the three tables with a
    // body long enough to slide under it — and on no others.
    const { doc } = await dom(`/player/${fixture.slug}`);

    for (const selector of [
      "table.scp-table--log",
      "table.scp-table--career",
      "table.scp-table--regions",
    ]) {
      for (const table of doc.querySelectorAll(selector)) {
        assert.ok(
          table.classList.contains("scp-table--filled"),
          `${selector} carries the filled header row`,
        );
      }
    }

    for (const table of doc.querySelectorAll("table.scp-table--role")) {
      assert.ok(
        !table.classList.contains("scp-table--filled"),
        "the role table has nothing to scroll under it",
      );
    }
  });

  test("head metadata is server-rendered and self-referencing", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const canonical = doc.querySelector('link[rel="canonical"]');
    assert.ok(canonical, "a canonical is present");
    assert.match(canonical.getAttribute("href"), new RegExp(`/player/${fixture.slug}$`));

    assert.match(
      doc.querySelector('meta[name="robots"]').getAttribute("content"),
      /noindex, indexifembedded/,
    );
    assert.ok(doc.querySelector("title").textContent.includes(fixture.name));
    assert.ok(doc.querySelector('meta[name="description"]').getAttribute("content"));
    assert.equal(
      doc.querySelector('meta[property="og:type"]').getAttribute("content"),
      "profile",
    );
  });

  test("the canonical ignores scoring format in the query string", async () => {
    const plain = await dom(`/player/${fixture.slug}`);
    const half = await dom(`/player/${fixture.slug}?format=half`);
    assert.equal(
      half.doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      plain.doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      "three scoring formats are one page, not three",
    );
  });

  test("the scoring format actually changes the numbers", async () => {
    // A receiving player, whose PPR and standard points genuinely differ. A
    // quarterback's would not, so asserting on one would be a test that passes
    // for the wrong reason.
    const receiver = roster.find((p) => p.position === "WR" || p.position === "TE");
    assert.ok(receiver, "the roster has a pass catcher in it");

    const ppr = await get(`/player/${receiver.slug}`);
    const standard = await get(`/player/${receiver.slug}?format=standard`);
    assert.equal(ppr.status, 200);
    assert.equal(standard.status, 200);
    assert.notEqual(
      ppr.headers.get("etag"),
      standard.headers.get("etag"),
      "a different format must produce a different render",
    );
  });

  test("the navigation only points at sections that rendered", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const links = [...doc.querySelectorAll(".scp-nav-link")];
    assert.ok(links.length >= 2, "a tab strip with something to switch between");
    for (const link of links) {
      // The href is the section's own address now; the panel it switches to
      // without a load is named by the dataset.
      const id = link.getAttribute("data-scp-panel-id");
      const panel = doc.getElementById(id);
      assert.ok(panel, `nav names the panel ${id}, which must exist`);
      assert.equal(
        link.getAttribute("href"),
        // The Overview is the profile, so its tab links to the profile.
        id === "overview" ? `/player/${fixture.slug}/` : `/player/${fixture.slug}/${id}/`,
        `${id}: the tab links to the section's own URL`,
      );
      assert.ok(panel.textContent.trim().length > 0, `#${id} must not be empty`);
    }
    // And the converse: every panel is reachable.
    for (const panel of doc.querySelectorAll("[data-scp-panel]")) {
      assert.ok(
        links.some((l) => l.getAttribute("data-scp-panel-id") === panel.id),
        `panel #${panel.id} has no tab pointing at it`,
      );
    }
  });

  test("no placeholder values anywhere on the page", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const text = doc.body.textContent;
    assert.ok(!/\bN\/A\b/.test(text), "no N/A placeholders");
    assert.ok(!/undefined|NaN|\[object Object\]/.test(text));
    assert.ok(!/\bnull\b/.test(text));
  });

  test("the page never claims a clean bill of health", async () => {
    // The injury data says what was logged; it cannot say what was not. A page
    // that prints "Healthy" as a STATUS for a player with no injury record is
    // asserting something nobody checked.
    //
    // Scoped to the page's own furniture — the hero flag and the injury panel —
    // rather than to the whole body, because the generated prose uses the word
    // in its ordinary sense ("a healthy pecking order") and banning the word
    // outright would be a test about vocabulary rather than about claims.
    for (const player of roster.slice(0, 12)) {
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;

      const flag = doc.querySelector(".scp-hero-flag");
      if (flag) {
        assert.ok(
          !/healthy|no injur|cleared/i.test(flag.textContent),
          `${player.slug}: the hero flag reports a designation, never its absence`,
        );
      }

      // The News tab's report card is rendered only when a designation exists,
      // so its mere presence is a claim — and it must never be the claim that
      // nothing is wrong.
      const report = doc.querySelector(".scp-report");
      if (report) {
        assert.ok(
          report.querySelector(".scp-report-pill")?.textContent.trim(),
          `${player.slug}: a report card without a designation should not exist`,
        );
        assert.ok(
          !/healthy|no injur|cleared/i.test(report.textContent),
          `${player.slug}: the report card reports a designation, never its absence`,
        );
      }

      const injury = doc.querySelector("#injury");
      if (injury) {
        assert.ok(
          !/\bno known injuries\b|\bfully healthy\b|\bclean bill\b/i.test(
            injury.textContent,
          ),
          `${player.slug}: the injury panel must not assert health it has not verified`,
        );
      }
    }
  });

  test("a chart that is drawn carries its numbers too", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    // Every efficiency reading carries the number that earned it. "Elite for
    // the position" on its own is a verdict a reader cannot check; with
    // "73% · 85th percentile" under it, the page has shown its working.
    const readings = [...doc.querySelectorAll(".scp-dr-row")];
    for (const row of readings) {
      assert.ok(
        row.querySelector(".scp-dr-value").textContent.trim().length > 0,
        "an efficiency row must state its reading",
      );
      const detail = row.querySelector(".scp-dr-detail");
      if (detail) {
        assert.match(
          detail.textContent,
          /\d/,
          "the evidence line under a reading carries a number",
        );
      }
    }

    // And both tabs render that block from one function, so a row on Stats and
    // the same row on Overview cannot disagree about what it says.
    const text = (root, sel) =>
      [...root.querySelectorAll(sel)].map((el) => el.textContent.trim()).join("|");
    const overview = doc.querySelector("#overview");
    const stats = doc.querySelector("#stats");
    if (overview?.querySelector(".scp-dr") && stats?.querySelector(".scp-dr")) {
      assert.equal(
        text(overview, ".scp-dr-row .scp-dr-value"),
        text(stats, ".scp-dr-row .scp-dr-value"),
        "the same percentiles read the same way on both tabs",
      );
    }

    // The stacked bar labels every tier in its legend, so identity never rests
    // on colour alone. The legend may name MORE tiers than the bar draws — a
    // tier he never reached is a reading worth printing and has no width to
    // give it a segment — but never fewer, which is the direction that would
    // leave a colour unexplained.
    const stack = doc.querySelector(".scp-stack");
    if (stack) {
      const segments = stack.querySelectorAll(".scp-stack-seg").length;
      const drawn = stack.querySelectorAll(
        '.scp-legend-item:not([data-empty="1"])',
      ).length;
      assert.equal(segments, drawn, "every segment has a legend entry");
      assert.ok(
        stack.querySelectorAll(".scp-legend-item").length >= segments,
        "the legend never has fewer entries than the bar has segments",
      );
    }

    // The line chart has two series, so it carries a legend.
    const figure = doc.querySelector(".scp-figure");
    if (figure) {
      assert.ok(
        figure.querySelectorAll(".scp-legend-item").length >= 2,
        "a two-series chart names both series",
      );
      const svg = figure.querySelector("svg");
      assert.ok(svg.getAttribute("aria-label"), "the chart describes itself");
      assert.ok(
        !svg.hasAttribute("preserveAspectRatio"),
        "the chart scales uniformly; stretching distorts strokes and markers",
      );
    }
  });
});

describe("the game log's season", () => {
  /**
   * Pages showing the current season, with their weekly rows.
   *
   * The page picks the newest season a player actually played in, so mid-season
   * some players are on the current year and some — injured, inactive, not yet
   * on a roster — are still on the last one. Both are correct, and this only
   * looks at the first group.
   */
  async function currentSeasonPages(limit = 25) {
    const year = new Date().getUTCFullYear();
    const pages = [];
    for (const player of roster.slice(0, 160)) {
      if (pages.length >= limit) break;
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const root = doc.querySelector("[data-scp-root]");
      const season = Number(root?.getAttribute("data-season"));
      // March is the league-year boundary — see seasonYear() in lib/seo.ts.
      const current = new Date().getUTCMonth() >= 2 ? year : year - 1;
      if (season !== current) continue;

      const rows = [...doc.querySelectorAll("#game-log table.scp-table--log .scp-row")].map((row) => ({
        week: Number(row.querySelector("th")?.textContent.trim()),
        status: row.getAttribute("data-status"),
      }));
      if (rows.length === 0) continue;
      pages.push({ slug: player.slug, season, rows, doc });
    }
    return pages;
  }

  test("an in-progress season is not padded to a full one", async () => {
    // The log used to pad every season to its full 18 weeks. For a season that
    // has finished, the weeks a player is missing from are weeks he missed. In
    // September it is a different claim entirely: sixteen rows of "Did not
    // play" for weeks nobody has played, under a player who has missed nothing.
    const pages = await currentSeasonPages(60);
    if (pages.length === 0) return; // offseason, or no current-season logs yet

    const full = 18;
    const latest = pages.map((page) => Math.max(...page.rows.map((r) => r.week)));

    for (const week of latest) {
      assert.ok(week >= 1 && week <= full, `a log runs to week ${week}`);
    }

    // If a log IS padded to the full season, the season had better be over —
    // which means somebody among sixty players played the last week of it.
    // Deliberately not asserting that every page agrees: the padding is per
    // TEAM, because the league does not play a week at once. On a Friday in
    // September two teams have played the Thursday game and thirty have not.
    if (latest.some((week) => week === full)) {
      const playedFinalWeek = pages.some((page) =>
        page.rows.some((r) => r.week === full && r.status === "active"),
      );
      assert.ok(
        playedFinalWeek,
        `logs run to week ${full} but nobody in the sample has played it`,
      );
    }
  });

  test("a log never ends on a game the team has not played", async () => {
    // The padding is the team's own schedule. A trailing "Did not play" for a
    // game that has not kicked off is both a false absence on the log and, once
    // the injury tab counts games missed off it, a false absence in a number.
    const pages = await currentSeasonPages(60);
    if (pages.length === 0) return;

    // Every team in the sample that has played week N has SOMEBODY active in
    // week N, so a page padded past its team's schedule shows a trailing row
    // no page of that team can account for. The check that catches it without
    // needing the schedule: the last row is never an unexplained absence on a
    // page whose player has played at all this season.
    for (const page of pages) {
      const active = page.rows.filter((r) => r.status === "active");
      if (active.length === 0) continue;
      const last = page.rows[page.rows.length - 1];
      const lastActive = Math.max(...active.map((r) => r.week));
      assert.ok(
        last.week <= Math.max(lastActive, ...page.rows.map((r) => r.week)),
        `${page.slug}: the log runs past its own last row`,
      );
      // The real assertion: no page may show MORE weeks than the busiest team
      // in the sample has played.
      const leaguePlayed = Math.max(
        ...pages.flatMap((p) =>
          p.rows.filter((r) => r.status === "active").map((r) => r.week),
        ),
      );
      assert.ok(
        last.week <= leaguePlayed,
        `${page.slug}: the log runs to week ${last.week}, past the ${leaguePlayed} the league has played`,
      );
    }
  });

  test("a finished season still shows its whole shape", async () => {
    // The other half of the same rule: a PRIOR season short of a full log is
    // missing data, not unplayed, and the absences are the point of the table.
    let checked = 0;
    for (const player of roster.slice(0, 120)) {
      if (checked >= 3) break;
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const season = Number(
        doc.querySelector("[data-scp-root]")?.getAttribute("data-season"),
      );
      const year = new Date().getUTCFullYear();
      const current = new Date().getUTCMonth() >= 2 ? year : year - 1;
      if (!Number.isFinite(season) || season >= current) continue;

      const weeks = [...doc.querySelectorAll("#game-log table.scp-table--log .scp-row th")].map((th) =>
        Number(th.textContent.trim()),
      );
      if (weeks.length === 0) continue;
      assert.equal(
        Math.max(...weeks),
        season >= 2021 ? 18 : 17,
        `${player.slug}: ${season} is over and should show every week`,
      );
      checked += 1;
    }
  });

  test("a kicker's attempts count as having played", async () => {
    // hasParticipation() is position-aware — a kicker's participation is his
    // attempts, not targets and carries — and the game log used to call it with
    // a null position. Every kicker's log therefore read "Did not play" for
    // every game he kicked in.
    let checked = 0;
    for (const player of roster.slice(0, 200)) {
      if (checked >= 2) break;
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const root = doc.querySelector("[data-scp-root]");
      if (root?.getAttribute("data-position") !== "K") continue;

      const rows = [...doc.querySelectorAll("#game-log table.scp-table--log .scp-row")];
      if (rows.length === 0) continue;

      // A row carrying fantasy points is a row he played in, whatever the
      // status attribute says.
      const scored = rows.filter((row) => {
        const pts = row.querySelector(".scp-pts")?.textContent.trim();
        return pts && Number(pts) > 0;
      });
      if (scored.length === 0) continue;

      for (const row of scored) {
        assert.equal(
          row.getAttribute("data-status"),
          "active",
          `${player.slug}: a week with points on it is marked as not played`,
        );
      }
      checked += 1;
    }
    assert.ok(checked > 0, "expected at least one kicker with a scored week");
  });
});

describe("the game log tab", () => {
  /** The game log's header cells, in order, for a player who has one. */
  async function logHeaders(slug, query = "") {
    const { doc } = await dom(`/player/${slug}${query}`);
    return {
      doc,
      headers: [...doc.querySelectorAll("#game-log table.scp-table--log thead th")].map(
        (th) => th.textContent.trim(),
      ),
    };
  }

  test("fantasy points lead the stat columns", async () => {
    // The one ordering decision this table makes that the mainstream box scores
    // do not, and the reason a fantasy reader is on this page rather than one of
    // theirs. If FPTS drifts back behind the passing columns, the tab has quietly
    // become a generic box score.
    //
    // Result is optional, and its absence is not a regression: final scores come
    // from a different source than the logs do, and a season that source has not
    // filed renders no Result column rather than eighteen empty cells under one.
    // What is NOT optional is that FPTS comes straight after the identity
    // columns, whichever of them are present.
    const { headers } = await logHeaders(fixture.slug);
    assert.ok(headers.length > 4, "the log has a header row");
    assert.deepEqual(headers.slice(0, 2), ["Wk", "Opp"], "the log opens on the game");
    const rest = headers[2] === "Result" ? headers.slice(3) : headers.slice(2);
    assert.equal(rest[0], "FPTS", "fantasy points lead the stat columns");
  });

  test("the columns are the position's, not one universal set", async () => {
    // A receiver's log with a PASS TD column in it is a template someone pointed
    // at a player, and a reader can tell.
    const seen = new Map();
    for (const player of roster.slice(0, 120)) {
      if (seen.size >= 3) break;
      if (!player.position || seen.has(player.position)) continue;
      if (!["QB", "RB", "WR"].includes(player.position)) continue;

      const { headers } = await logHeaders(player.slug);
      if (headers.length === 0) continue;
      seen.set(player.position, headers);
    }

    const qb = seen.get("QB");
    if (qb) {
      assert.ok(qb.includes("CMP/ATT"), "a quarterback's log shows completions");
      assert.ok(!qb.includes("TGT"), "a quarterback's log has no target column");
    }

    const wr = seen.get("WR");
    if (wr) {
      assert.ok(wr.includes("TGT"), "a receiver's log shows targets");
      assert.ok(!wr.includes("PASS YDS"), "a receiver's log has no passing column");
    }

    const rb = seen.get("RB");
    if (rb) {
      assert.ok(rb.includes("CAR"), "a back's log shows carries");
      assert.ok(!rb.includes("PASS TD"), "a back's log has no passing column");
    }
  });

  test("every week played carries its own detail, in the HTML", async () => {
    // The detail is collapsed by client/player.ts, never by the server: a page
    // whose script does not run has to arrive complete rather than with its
    // content behind a button that cannot work.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const table = doc.querySelector("#game-log table.scp-table--log");
    assert.ok(table, "the game log table is in the HTML");

    const rows = [...table.querySelectorAll("tr.scp-row[data-status='active']")];
    assert.ok(rows.length > 0, "at least one week was played");

    for (const row of rows) {
      const id = row.getAttribute("data-detail");
      if (!id) continue; // a week with nothing to add gets no detail row
      const detail = table.querySelector(`tr.scp-detail[id="${id}"]`);
      assert.ok(detail, `week ${row.cells[0].textContent} has its detail row`);
      assert.ok(
        !detail.hasAttribute("hidden"),
        "the detail is not hidden by the server",
      );
      assert.ok(
        detail.textContent.includes("Week "),
        "the detail names the week it belongs to",
      );
    }
  });

  test("the scoring breakdown accounts for the points beside it", async () => {
    // A breakdown that quietly balances itself is worth less than one that shows
    // where it cannot: anything the coefficients do not model is its own line.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const table = doc.querySelector("#game-log table.scp-table--log");

    for (const row of [...table.querySelectorAll("tr.scp-row[data-status='active']")]) {
      const id = row.getAttribute("data-detail");
      if (!id) continue;
      const detail = table.querySelector(`tr.scp-detail[id="${id}"]`);
      const parts = [...detail.querySelectorAll(".scp-breakdown-pts")].map((el) =>
        Number(el.textContent.trim()),
      );
      if (parts.length === 0) continue;

      const points = Number(row.querySelector(".scp-pts").textContent.trim());
      const sum = parts.reduce((total, value) => total + value, 0);
      assert.ok(
        Math.abs(sum - points) < 0.06,
        `the breakdown sums to ${sum.toFixed(2)} against ${points} on the row`,
      );
      return; // one week is enough to prove the arithmetic
    }
  });

  test("the season selector leads with All and offers every season but the one on screen", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const chips = [...doc.querySelectorAll("#game-log .scp-season-opt")];
    if (chips.length === 0) return; // a single-season player gets no selector

    // All is the resting state and comes first: it is where the selector is
    // when the URL asks for nothing, and what it opens is the career table.
    assert.equal(chips[0].getAttribute("data-season"), "all");
    assert.equal(chips[0].textContent.trim(), "All");
    assert.ok(chips[0].classList.contains("is-active"), "All is the default");
    assert.equal(chips[0].getAttribute("aria-current"), "true");
    assert.ok(
      !chips[0].getAttribute("href").includes("log="),
      "All is the bare address, not a pinned one",
    );

    // Past that, the switcher is an archive: it offers somewhere to GO, and
    // the year already rendered above is not somewhere to go.
    const shown = Number(
      doc.querySelector("[data-scp-root]")?.getAttribute("data-log-season"),
    );
    const years = chips.slice(1).map((a) => Number(a.textContent.trim()));
    assert.ok(
      years.every(Number.isFinite),
      "every chip after All is a year",
    );
    assert.ok(
      !years.includes(shown),
      `the selector offers ${shown}, which is the season it is standing on`,
    );
    assert.equal(
      chips.filter((a) => a.classList.contains("is-active")).length,
      1,
      "exactly one chip is lit, and with nothing pinned it is All",
    );

    assert.deepEqual(
      years,
      [...years].sort((a, b) => b - a),
      "seasons run newest first",
    );

    for (const chip of chips) {
      // One game log is the page that ranks; a pinned season is a rendering of
      // it rather than a second address competing with it.
      assert.equal(
        chip.getAttribute("rel"),
        "nofollow",
        "an off-season link is not offered to the crawler",
      );
    }
  });

  test("All opens the career table, and a year replaces it", async () => {
    // What the All chip is FOR. The reader is standing in front of eleven
    // years being asked to pick one; this is the screen that says which is
    // worth opening. Exactly one block sits under the selector either way —
    // All's career table, or the pinned season's log, never both.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const nav = doc.querySelector("#game-log .scp-seasonnav");
    if (!nav) return; // a single-season player gets no selector and no All

    const blocks = [...doc.querySelectorAll("#game-log .scp-archive")];
    assert.equal(blocks.length, 1, "one block under the selector");
    assert.equal(blocks[0].getAttribute("data-season"), "all");
    // The selector rides the heading of the block it opened, so the block
    // CONTAINS it: the row of years and the name of what they produced are one
    // line, and the table follows both.
    assert.equal(
      nav.closest(".scp-archive"),
      blocks[0],
      "the selector sits on the heading of the block resting on All",
    );
    assert.ok(
      nav.compareDocumentPosition(blocks[0].querySelector("table")) & 4,
      "and the table it opened comes after it",
    );

    const table = blocks[0].querySelector("table.scp-table--career");
    assert.ok(table, "All shows the Stats tab's career table");
    assert.match(
      blocks[0].querySelector(".scp-sect-title").textContent,
      /Career By Season/,
    );
    // Every season the selector offers has a line in it, which is what makes
    // the table an index to the logs rather than a second copy of Stats.
    const listed = [...table.querySelectorAll("tbody tr th")].map((th) =>
      Number(th.textContent.trim().slice(0, 4)),
    );
    for (const year of [...nav.querySelectorAll('.scp-season-opt:not([data-season="all"])')]) {
      const n = Number(year.textContent.trim());
      assert.ok(listed.includes(n), `${n} is offered but has no career row`);
    }

    // Pinning a year swaps the block rather than adding to it.
    const pinnedUrl = nav
      .querySelector('.scp-season-opt:not([data-season="all"])')
      .getAttribute("href");
    const pinned = await dom(pinnedUrl);
    const after = [...pinned.doc.querySelectorAll("#game-log .scp-archive")];
    assert.equal(after.length, 1, "still one block under the selector");
    assert.equal(
      after[0].querySelector("table.scp-table--career"),
      null,
      "a pinned year shows its log, not the career table",
    );
  });

  test("the season archive sits under the fixtures, not above the numbers", async () => {
    // It used to stand between a heading that had just named the season and the
    // numbers that answer it. A reader arriving on this tab wants this year.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const nav = doc.querySelector("#game-log .scp-seasonnav");
    if (!nav) return; // a single-season player gets no archive

    const table = doc.querySelector("#game-log table.scp-table--log");
    assert.ok(
      table.compareDocumentPosition(nav) & 4,
      "the archive comes after the log it is an archive of",
    );
    assert.ok(
      nav.closest(".scp-archive"),
      "and it rides that archive block's heading rather than standing alone",
    );

    const fixtures = doc.querySelector("#game-log .scp-nexts");
    if (fixtures) {
      assert.ok(
        fixtures.compareDocumentPosition(nav) & 4,
        "the archive comes after the fixtures",
      );
    }
  });

  /** The Game Log tab's own blocks — never the pinned archive season's. */
  function currentSeasonBlock(doc) {
    const own = (selector) =>
      [...doc.querySelectorAll(`#game-log ${selector}`)].find(
        (el) => !el.closest(".scp-archive"),
      );
    return {
      heading: own(".scp-h2")?.textContent.trim(),
      tiles: own(".scp-tiles--log")?.outerHTML,
      intro: own(".scp-logintro")?.outerHTML,
      table: own("table.scp-table--log")?.outerHTML,
      fixtures: own(".scp-nexts")?.outerHTML,
    };
  }

  test("a pinned season opens under the selector and leaves the tab alone", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const chips = [...doc.querySelectorAll("#game-log .scp-season-opt")];
    const other = chips.find((a) => !a.classList.contains("is-active"));
    if (!other) return;

    const year = Number(other.textContent.trim());
    const pinned = await dom(`${other.getAttribute("href")}`);

    // The whole point of the selector's new behaviour: picking 2025 ADDS 2025.
    // The current season's heading, tiles, prose, table and fixtures have to
    // come back byte for byte, or "do not touch the current season" is a
    // comment rather than a property.
    assert.deepEqual(
      currentSeasonBlock(pinned.doc),
      currentSeasonBlock(doc),
      "pinning a season changed the season above it",
    );

    // ...and the year the reader asked for is below the selector, named.
    const archive = pinned.doc.querySelector("#game-log .scp-archive");
    assert.ok(archive, `${year} is rendered`);
    assert.equal(archive.getAttribute("data-season"), String(year));
    assert.match(
      archive.querySelector(".scp-sect-title").textContent,
      new RegExp(String(year)),
    );
    assert.ok(
      archive.querySelector("table.scp-table--log"),
      "the archive season brings its table",
    );
    assert.ok(
      archive.textContent.includes(String(year)),
      `the archive prose names ${year}`,
    );

    const nav = pinned.doc.querySelector("#game-log .scp-seasonnav");
    assert.equal(
      nav.closest(".scp-archive"),
      archive,
      "the selector sits on the heading of the season it opened",
    );
    assert.ok(
      nav.compareDocumentPosition(archive.querySelector("table")) & 4,
      "and that season's numbers come after it",
    );

    // A finished season has no fixtures and no form to read, so the blocks
    // that are about a season in progress stay out of it.
    assert.equal(archive.querySelector(".scp-nexts"), null);
    assert.equal(archive.querySelector(".scp-spark"), null);

    // The lit chip is the way back out.
    const lit = nav.querySelector(".scp-season-opt.is-active");
    assert.equal(lit.textContent.trim(), String(year));
    assert.equal(lit.getAttribute("aria-current"), "true");
    assert.ok(
      !lit.getAttribute("href").includes("log="),
      "clicking the lit year clears it rather than re-pinning it",
    );

    // And the rest of the profile is untouched: pinning the log is not a second
    // profile at an old season's numbers.
    assert.equal(
      pinned.doc.querySelector("[data-scp-root]").getAttribute("data-season"),
      doc.querySelector("[data-scp-root]").getAttribute("data-season"),
      "the active season is unchanged by the game log's own selector",
    );
    assert.equal(
      pinned.doc.querySelector("[data-scp-root]").getAttribute("data-log-season"),
      doc.querySelector("[data-scp-root]").getAttribute("data-log-season"),
      "the year in the document title is the tab's, not the archive's",
    );
  });

  test("the season selector never offers the season already on screen", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const root = doc.querySelector("[data-scp-root]");
    const active = root.getAttribute("data-season");

    const years = [...doc.querySelectorAll("#game-log .scp-seasonnav .scp-season-opt")]
      .map((a) => a.textContent.trim());
    assert.ok(!years.includes(active), `${active} is the tab, not a destination`);
    assert.equal(new Set(years).size, years.length, "no year is offered twice");
  });

  test("an unplayed season is ignored rather than rendered empty", async () => {
    const { doc } = await dom(`/player/${fixture.slug}?log=1998`);
    const rows = [...doc.querySelectorAll("#game-log table.scp-table--log .scp-row")];
    assert.ok(rows.length > 0, "an impossible season falls back to a real one");
  });

  test("the scoped page carries the start/sit button, once", async () => {
    // The section page carries the control bar now, so the button is in the
    // header where the full profile's is. The bar used to hold a scoring
    // toggle here and it used to be printed a second time inside the panel;
    // one control for one job, in one place, is what replaced both.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const buttons = doc.querySelectorAll(".scp-startsit");
    assert.equal(buttons.length, 1, "exactly one start/sit button on the page");
    assert.equal(
      doc.querySelector("#game-log .scp-startsit"),
      null,
      "and it is not a second copy inside the panel",
    );
    assert.equal(
      doc.querySelectorAll(".scp-format, .scp-format-opt").length,
      0,
      "the scoring toggle is gone, not merely hidden",
    );

    const href = buttons[0].getAttribute("href");
    assert.equal(
      href,
      `https://statchasers.com/redraft-command/launch/who-should-i-start/${fixture.slug}`,
      "the button opens this player in Redraft Command",
    );
    assert.match(
      buttons[0].textContent.trim(),
      new RegExp(`^Should I Start or Sit ${fixture.name}\\b.*\\?$`),
      "and it asks the reader's question in full, naming the player",
    );
  });

  test("the button names the week the player plays next", async () => {
    // The week is the next fixture on this player's schedule — the one the
    // Upcoming Matchups cards lead with — and it is dropped rather than
    // guessed at when the schedule has nothing left on it.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const label = doc.querySelector(".scp-startsit").textContent.trim();
    const next = doc.querySelector(".scp-next-week, .scp-nexts li");
    const week = next ? /Week (\d+)/.exec(next.textContent)?.[1] : null;

    if (week) {
      assert.ok(
        label.endsWith(`Week ${week}?`),
        `the button says ${label}, the next fixture is week ${week}`,
      );
    } else {
      assert.ok(!/Week/.test(label), "no fixture left to name, so no week named");
    }
  });

  test("the intro restates the table and nothing else", async () => {
    // It opens the tab now, where the season's caption used to be. Leading with
    // prose only works if the prose is the same generated restatement it always
    // was — an opening paragraph is exactly where a claim nobody measured would
    // get written.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const intro = doc.querySelector("#game-log .scp-logintro");
    assert.ok(intro, "the generated intro is in the HTML");
    assert.ok(
      intro.querySelector(".scp-lede"),
      "the totals sentence is always there when a game has been played",
    );

    const table = doc.querySelector("#game-log table.scp-table--log");
    if (table) {
      assert.ok(
        intro.compareDocumentPosition(table) & 4,
        "the season in words comes before the season in rows",
      );
    }

    // Between the two, not above both: the tiles are the faster answer, and
    // the paragraph reads as a gloss on them.
    const tiles = doc.querySelector("#game-log .scp-tiles--log");
    if (tiles) {
      assert.ok(
        tiles.compareDocumentPosition(intro) & 4,
        "the tiles come before the paragraph that glosses them",
      );
    }

    const text = intro.textContent;
    assert.ok(text.includes(fixture.name), "it names the player");

    // The second paragraph divides the season, so it only exists where there
    // is a season to divide. With one game played the quotient IS the
    // dividend, and the paragraph is dropped rather than saying the sentence
    // above it a second time.
    const summary = intro.querySelector(".scp-note");
    const games = doc.querySelectorAll(
      '#game-log table.scp-table--log tbody tr.scp-row[data-status="active"]',
    ).length;
    if (games > 1) {
      assert.ok(summary, "a season of games is summarised per game");
      assert.ok(/per game/.test(summary.textContent), "it talks in per-game terms");
    } else {
      assert.equal(summary, null, "one game gets no divided-season paragraph");
      assert.ok(
        !/averaged/.test(text),
        "one game is not an average, and is not reported as one",
      );
      assert.ok(
        !/\bthat week\b/.test(text),
        "the single week's finish is the table's Finish column, not prose",
      );
    }

    // Rule 3: this page describes what happened and never what happens next.
    for (const word of ["will ", "expect", "projected", "should "]) {
      assert.ok(!text.toLowerCase().includes(word), `the summary avoids "${word.trim()}"`);
    }
  });

  /** The Game Log FAQ on a page, as {question, answer} pairs. */
  async function logFaq(slug, section = "/game-log/") {
    const { doc } = await dom(`/player/${slug}${section}`);
    return [...doc.querySelectorAll("#game-log .scp-faq-item")].map((item) => ({
      question: item.querySelector(".scp-faq-q")?.textContent.trim() ?? "",
      answer: item.querySelector(".scp-faq-a")?.textContent.trim() ?? "",
    }));
  }

  test("the FAQ answers weekly questions from the table above it", async () => {
    // The FAQ exists to be lifted as an answer, so every claim in it has to be
    // one the table already made. The games-played count is the one that would
    // silently drift: it is derived twice, once for the tiles and once here.
    let checked = 0;

    for (const player of roster.slice(0, 40)) {
      const { doc } = await dom(`/player/${player.slug}/game-log/`);
      const items = [...doc.querySelectorAll("#game-log .scp-faq-item")];
      if (items.length === 0) continue;

      const played = doc.querySelectorAll(
        "#game-log tr.scp-row[data-status='active']",
      ).length;
      const games = items[0].querySelector(".scp-faq-a")?.textContent ?? "";
      assert.match(
        games,
        new RegExp(`played ${played} games?\\b`),
        `${player.slug}: the FAQ counts a different number of games than the table`,
      );

      for (const item of items) {
        const q = item.querySelector(".scp-faq-q")?.textContent.trim() ?? "";
        const a = item.querySelector(".scp-faq-a")?.textContent.trim() ?? "";
        assert.ok(q.endsWith("?"), `${player.slug}: "${q}" is not a question`);
        assert.ok(a.length > 20, `${player.slug}: "${q}" has no real answer`);
        assert.ok(!/ {2}/.test(a), `${player.slug}: "${a}" has a doubled space`);

        // Rule 3, in the place it is easiest to break: the questions people
        // type about a game log are mostly reaching for next week.
        for (const word of ["will ", "expect", "projected", "should ", "on pace"]) {
          assert.ok(
            !a.toLowerCase().includes(word),
            `${player.slug}: an answer predicts — "${word.trim()}"`,
          );
        }
      }
      checked += 1;
      if (checked >= 6) break;
    }
    assert.ok(checked > 0, "expected a game log FAQ in the snapshot");
  });

  test("the FAQ answers the season the tab is showing, not the pinned one", async () => {
    // The FAQ is the page's, and the page is the current season — pinning an
    // archive year adds a block, it does not re-scope what the page is about.
    // Answering a live season in the past tense, or a filed one in the present
    // continuous, is the single wrong thing this FAQ could say; keeping it on
    // one season is what makes the tense a property rather than a coin flip.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const seasons = [...doc.querySelectorAll("#game-log .scp-season-opt")]
      .map((el) => Number(el.textContent.trim()))
      .filter(Number.isFinite);
    const current = Number(
      doc.querySelector("[data-scp-root]")?.getAttribute("data-season"),
    );
    const past = seasons.find((year) => year !== current);
    if (past === undefined) return;

    const plain = await logFaq(fixture.slug, "/game-log/");
    const pinned = await logFaq(fixture.slug, `/game-log/?log=${past}`);
    assert.ok(plain.length > 0, "the season has an FAQ");
    assert.deepEqual(pinned, plain, `pinning ${past} rewrote the FAQ`);

    // It is still the current season's FAQ, which is the thing that would
    // quietly stop being true if the pinned year ever leaked into it. (The
    // archive question names other years on purpose — that is its job — so the
    // check is that the CURRENT one is answered, not that no other appears.)
    assert.ok(
      pinned.some(({ question, answer }) =>
        `${question} ${answer}`.includes(String(current)),
      ),
      `the FAQ answers ${current}`,
    );
  });

  test("the archive question names seasons the selector actually offers", async () => {
    // "You can also view 2019" is a promise the season chips have to keep.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    // Years only — All is a view of the whole career, not a season the FAQ
    // could name.
    const offered = [
      ...doc.querySelectorAll('#game-log .scp-season-opt:not([data-season="all"])'),
    ].map((el) => el.textContent.trim());
    const items = [...doc.querySelectorAll("#game-log .scp-faq-item")].map((item) =>
      item.querySelector(".scp-faq-q")?.textContent.trim() ?? "",
    );
    const archive = items.some((q) => /previous seasons/.test(q));

    if (offered.length <= 1) {
      assert.ok(!archive, "a one-season player is not offered an archive");
      return;
    }

    assert.ok(archive, "a player with several seasons is told where they are");
    const answer =
      [...doc.querySelectorAll("#game-log .scp-faq-item")]
        .find((item) => /previous seasons/.test(item.textContent))
        ?.querySelector(".scp-faq-a")?.textContent ?? "";
    for (const year of answer.match(/\b20\d{2}\b/g) ?? []) {
      assert.ok(
        offered.includes(year),
        `the FAQ names ${year}, which the selector does not offer`,
      );
    }
  });


  test("upcoming games sit below the completed log, never inside it", async () => {
    // The distinction the whole block exists to keep: results are a table,
    // fixtures are cards. A future game rendered as a table row with dashes in
    // its stat columns reads exactly like a week the player was inactive.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const list = doc.querySelector("#game-log .scp-nexts");
    if (!list) return; // season over, or no schedule

    const table = doc.querySelector("#game-log table.scp-table--log");
    const summary = doc.querySelector("#game-log .scp-logintro .scp-note");
    const faq = doc.querySelector("#game-log .scp-faq");

    assert.ok(
      table.compareDocumentPosition(list) & 4,
      "the completed table comes before the fixtures",
    );
    if (summary) {
      assert.ok(
        summary.compareDocumentPosition(list) & 4,
        "the season in words comes before the fixtures",
      );
    }
    if (faq) {
      assert.ok(
        list.compareDocumentPosition(faq) & 4,
        "the FAQ comes after the fixtures",
      );
    }

    // No fixture ever became a row: every row in the table carries a status.
    for (const row of table.querySelectorAll("tbody tr.scp-row")) {
      assert.ok(
        ["active", "bye", "out"].includes(row.getAttribute("data-status")),
        "a game-log row is a recorded week, not a scheduled one",
      );
    }
  });

  test("the matchup-rank caption links the table it is measured from", async () => {
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const note = doc.querySelector("#game-log .scp-next-note");
    if (!note) return; // season over, or no schedule

    // The definition is only checkable against the points-allowed table, so
    // the phrase it defines is the way there.
    const link = note.querySelector("a.scp-caption-link");
    assert.ok(link, "the caption carries a link");
    assert.equal(link.getAttribute("href"), "/fpa");
    assert.equal(link.textContent, "fantasy points allowed");
    assert.match(note.textContent, /1st allows the most, 32nd the fewest/);

    // Embedded, it has to leave this origin's default and point at wherever
    // the FPA page is mounted — a link back to /fpa from a WordPress page
    // would drop the reader onto the bare tool.
    const frag = await get(`/embed/player/${fixture.slug}?section=game-log`);
    assert.match(frag.body, /class="scp-caption-link" href="\/fpa\?embed=1"/);
  });

  test("every fixture opens the pair's page, at its canonical address", async () => {
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const cards = [...doc.querySelectorAll("#game-log .scp-next")];
    if (cards.length === 0) return;

    const teamSlug = doc
      .querySelector(".scp-hero a[href*='/team/']")
      ?.getAttribute("href")
      ?.match(/\/team\/([a-z0-9-]+)/)?.[1];

    for (const card of cards) {
      const cta = card.querySelector(".scp-next-cta");
      // A card with an opponent this server cannot resolve gets no link rather
      // than one pointing at a page that is not there.
      if (!cta) continue;

      const href = cta.getAttribute("href");
      const slug = /\/([a-z0-9-]+-vs-[a-z0-9-]+)\//.exec(href)?.[1];
      assert.ok(slug, `the fixture links a pair, not "${href}"`);

      // One page per pair, not one per direction: the two halves are in
      // alphabetical order, so this player's fixture and the opponent's own
      // page are the same URL rather than two competing for the query.
      const [a, b] = slug.split("-vs-");
      assert.ok(a < b, `${slug} is not the canonical ordering`);

      if (teamSlug) {
        assert.ok(
          a === teamSlug || b === teamSlug,
          `${slug} does not name the player's own club`,
        );
      }

      assert.match(
        cta.textContent,
        /View matchup/,
        "the button says where it goes",
      );
    }
  });

  test("a fixture card carries the week, the opponent, home/away and the time", async () => {
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const cards = [...doc.querySelectorAll("#game-log .scp-next")];
    if (cards.length === 0) return;

    assert.ok(cards.length <= 4, `${cards.length} fixtures — at most four`);

    const weeks = [];
    for (const card of cards) {
      assert.match(
        card.querySelector(".scp-next-week").textContent.trim(),
        /^Week \d+$/,
        "the card names its week",
      );
      weeks.push(Number(/\d+/.exec(card.querySelector(".scp-next-week").textContent)[0]));

      const ha = card.getAttribute("data-homeaway");
      assert.ok(["home", "away"].includes(ha), "home or away, never neither");
      // The marker is on the focal line, so it is readable in one glance.
      assert.equal(
        card.querySelector(".scp-next-ha").textContent.trim(),
        ha === "away" ? "@" : "vs",
      );
      assert.ok(
        card.querySelector(".scp-next-code").textContent.trim().length > 0,
        "the opponent has a code",
      );
      // And the words are there for a screen reader, which cannot read a glyph.
      assert.match(
        card.querySelector(".scp-next-name").textContent,
        ha === "away" ? /^Away at / : /^Home vs /,
      );
    }

    // Ascending, and no week repeated — a bye is absent rather than rendered.
    for (let i = 1; i < weeks.length; i += 1) {
      assert.ok(weeks[i] > weeks[i - 1], `weeks run ${weeks[i - 1]} then ${weeks[i]}`);
    }
  });

  test("no fixture claims a stat, and none is a finished game", async () => {
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const cards = [...doc.querySelectorAll("#game-log .scp-next")];
    if (cards.length === 0) return;

    // Every played week in the table is behind every scheduled week on a card.
    const played = [...doc.querySelectorAll("#game-log tr.scp-row[data-status='active']")]
      .map((row) => Number(row.querySelector("th").textContent.trim()))
      .filter(Number.isFinite);
    const firstUpcoming = Number(
      /\d+/.exec(cards[0].querySelector(".scp-next-week").textContent)[0],
    );
    for (const week of played) {
      assert.ok(
        week < firstUpcoming,
        `week ${week} is both played and upcoming`,
      );
    }

    // Projected points are not invented to fill the card: this codebase has no
    // per-game projection, so no card may print one.
    for (const card of cards) {
      assert.ok(
        !/proj/i.test(card.textContent),
        "a card shows a projection the data layer cannot supply",
      );
    }
  });

  test("the matchup rank names its position and its direction", async () => {
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const cards = [...doc.querySelectorAll("#game-log .scp-next")];
    if (cards.length === 0) return;

    const position = doc
      .querySelector("[data-scp-root]")
      .getAttribute("data-position");

    for (const card of cards) {
      const rank = card.querySelector(".scp-next-rank");
      if (!rank) continue;
      assert.match(rank.textContent.trim(), /^\d+(st|nd|rd|th)$/);
      const value = Number.parseInt(rank.textContent, 10);
      assert.ok(value >= 1 && value <= 32, `rank ${value} is outside the league`);
      assert.equal(
        card.querySelector(".scp-next-vs").textContent.trim(),
        `vs ${position}`,
        "the rank is against this player's own position",
      );
    }

    // The direction is stated rather than implied, and never as "easiest".
    const note = doc.querySelector("#game-log .scp-next-note").textContent;
    assert.match(note, /1st allows the most/, "the caption states which end is which");
    assert.ok(
      !/easiest|hardest/i.test(note),
      "the caption avoids a direction word it has not earned",
    );
  });

  test("the scoring format reaches the matchup ranks", async () => {
    // The ranks come from a format-specific table, so the note has to name the
    // format the page is actually in — otherwise a reader on Standard is shown
    // PPR ranks under a PPR sentence.
    for (const [query, label] of [["", "PPR"], ["?format=standard", "Standard"]]) {
      const { doc } = await dom(`/player/${fixture.slug}/game-log/${query}`);
      const note = doc.querySelector("#game-log .scp-next-note");
      if (!note) continue;
      assert.ok(
        note.textContent.includes(label),
        `the ${label} page names ${label} in the matchup caption`,
      );
    }
  });

  test("the tab leads with games; totals only under the All chip", async () => {
    // Stats is totals, Game Log is games, and the tab still OPENS on games.
    // The career table is allowed back only as the All selection, under the
    // season selector at the foot — an index to the eleven logs, not a second
    // copy of the Stats tab standing in front of this week's numbers.
    const { doc } = await dom(`/player/${fixture.slug}/game-log/`);
    const career = doc.querySelector("#game-log .scp-table--career");
    if (!career) return; // a single-season player gets no selector and no All

    assert.ok(
      career.closest(".scp-archive[data-season='all']"),
      "the career table appears only as what All opens",
    );
    const nav = doc.querySelector("#game-log .scp-seasonnav");
    assert.ok(
      nav.compareDocumentPosition(career) & 4,
      "totals come after the selector, never before the games",
    );
    assert.equal(
      nav.closest(".scp-archive"),
      career.closest(".scp-archive"),
      "the selector is that block's own heading control",
    );
    const log = doc.querySelector("#game-log table.scp-table--log");
    assert.ok(
      log.compareDocumentPosition(career) & 4,
      "this season's log is still the first table on the tab",
    );
  });
});

describe("the outlook tab", () => {
  /**
   * The categories the driver strip is allowed to use, per position.
   *
   * The whole point of that strip is that it is NOT the same four cards on
   * every player — see lib/player/outlook-drivers.ts. Pinning the sets here is
   * what stops it quietly collapsing back into one generic set, which is the
   * exact failure it was built to avoid.
   */
  const DRIVER_SETS = {
    QB: ["Role", "Passing Volume", "Rushing", "Efficiency"],
    RB: ["Role", "Touches", "Receiving", "Goal-Line"],
    WR: ["Routes", "Targets", "Air Yards", "Competition"],
    TE: ["Routes", "Targets", "Red Zone", "Role Security"],
  };

  /** Player pages that render an Outlook tab, one per position where possible. */
  async function withOutlook(limit = 4) {
    const found = new Map();
    for (const player of roster.slice(0, 220)) {
      if (found.size >= limit) break;
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200 || !res.body.includes('id="outlook"')) continue;
      const doc = new JSDOM(res.body).window.document;
      const position = doc
        .querySelector("[data-scp-root]")
        ?.getAttribute("data-position");
      if (!position || !DRIVER_SETS[position] || found.has(position)) continue;
      found.set(position, { player, doc });
    }
    return found;
  }

  test("the tab owns an h2, and it is the head of the written read", async () => {
    const found = await withOutlook(1);
    assert.ok(found.size > 0, "at least one player has an outlook tab");
    const { doc } = [...found.values()][0];
    const outlook = doc.querySelector("#outlook");

    const heading = outlook.querySelector("h2");
    assert.ok(heading, "the tab owns an h2");
    // The head IS the heading, and it is the page's ordinary section heading —
    // the same .scp-h2 that heads "<name> stats <year>" on the Stats tab, not
    // the 11px gold eyebrow this section used to wear instead of one.
    assert.equal(
      heading.className,
      "scp-h2",
      "the written read opens on the page's section heading",
    );
    assert.match(
      heading.textContent.trim(),
      /^\d{4} Outlook$/,
      "the heading names the season the outlook is for",
    );
    assert.equal(outlook.querySelectorAll("h2").length, 1);

    // No card around it. The read is the tab's first section, not something
    // set apart from the column it sits in, and the chips below it carry the
    // only frame this head needs.
    assert.equal(outlook.querySelector(".scp-verdict"), null);

    // The name, the identity line and the quick take are gone from the head.
    assert.equal(outlook.querySelector(".scp-verdict-name"), null);
    assert.equal(outlook.querySelector(".scp-verdict-id"), null);
    assert.equal(outlook.querySelector(".scp-take-label"), null);
    assert.ok(
      outlook.querySelector(".scp-take .scp-take-body"),
      "the written read opens the tab",
    );
  });

  test("the driver categories adapt to the position", async () => {
    const found = await withOutlook();
    assert.ok(found.size >= 2, "expected at least two positions in the snapshot");

    for (const [position, { player, doc }] of found) {
      const labels = [
        ...doc.querySelectorAll("#outlook .scp-driver-label"),
      ].map((el) => el.textContent.trim());
      if (labels.length === 0) continue;

      const allowed = DRIVER_SETS[position];
      for (const label of labels) {
        assert.ok(
          allowed.includes(label),
          `${player.slug} (${position}) rendered "${label}", not one of ${allowed.join(" / ")}`,
        );
      }
      assert.ok(labels.length <= 4, "at most four cards");
      assert.equal(new Set(labels).size, labels.length, "no category twice");
    }
  });

  test("every driver card carries a real measurement", async () => {
    const found = await withOutlook();
    let checked = 0;

    for (const [, { player, doc }] of found) {
      for (const card of doc.querySelectorAll("#outlook .scp-driver")) {
        const value = card.querySelector(".scp-driver-value")?.textContent.trim();
        const detail = card.querySelector(".scp-driver-detail")?.textContent.trim();
        assert.ok(value, `${player.slug}: a card with no value`);
        assert.ok(detail, `${player.slug}: a card with no measurement under it`);
        // The rule the whole page runs on: a number nobody measured is not
        // rendered as a dash, it is not rendered.
        assert.ok(
          !value.includes("\u2014") && !detail.includes("\u2014"),
          `${player.slug}: "${value}" / "${detail}" stands in for a missing number`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0, "expected some driver cards in the snapshot");
  });

  test("an unwritten decision layer is absent, not an empty label", async () => {
    // Every block below is authored into fantasy_outlook_2026.json and none of
    // it can be derived. A record without those fields must produce a SHORTER
    // tab — never a labelled hole, a dash, or a chip with nothing in it.
    const found = await withOutlook();
    assert.ok(found.size > 0);

    for (const [, { player, doc }] of found) {
      const outlook = doc.querySelector("#outlook");
      for (const selector of [
        ".scp-chip",
        ".scp-range",
        ".scp-moves",
        ".scp-usage",
        ".scp-final",
      ]) {
        for (const node of outlook.querySelectorAll(selector)) {
          assert.ok(
            node.textContent.trim().length > 0,
            `${player.slug}: ${selector} rendered with nothing in it`,
          );
        }
      }

      // A rendered range must be a real spectrum: the marker and the band are
      // positioned from authored ranks, and a percentage outside the axis means
      // the bands were inconsistent and should have been dropped whole.
      for (const node of outlook.querySelectorAll(".scp-range-marker, .scp-range-band")) {
        const left = Number((node.getAttribute("style") ?? "").match(/left:([\d.]+)%/)?.[1]);
        assert.ok(
          Number.isFinite(left) && left >= 0 && left <= 100,
          `${player.slug}: a range element sits off the axis`,
        );
      }
    }
  });

  test("the measured strip is stamped with the season it measured", async () => {
    // The one tab allowed to talk about a season nobody has played is also the
    // one where a measured block could be mistaken for a projection. The stamp
    // is what keeps the two kinds of claim apart.
    const found = await withOutlook();
    let checked = 0;
    for (const [, { player, doc }] of found) {
      const outlook = doc.querySelector("#outlook");
      if (!outlook.querySelector(".scp-driver")) continue;
      const sub = outlook.querySelector(".scp-sub")?.textContent ?? "";
      assert.match(
        sub,
        /Measured from/,
        `${player.slug}: the driver strip does not say what it measured`,
      );
      checked += 1;
    }
    assert.ok(checked > 0, "expected a driver strip in the snapshot");
  });
});

describe("the injury tab", () => {
  async function withInjury(limit = 3) {
    const found = [];
    for (const player of roster.slice(0, 160)) {
      if (found.length >= limit) break;
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200 || !res.body.includes('id="injury"')) continue;
      found.push({ player, doc: new JSDOM(res.body).window.document });
    }
    return found;
  }

  test("the status block leads, and never claims a clean bill of health", async () => {
    // The dominant intent is "is he hurt right now". That answer used to live
    // one tab away under News, and the tab opened on a durability grade.
    const found = await withInjury();
    assert.ok(found.length > 0, "at least one player has an injury tab");

    for (const { player, doc } of found) {
      const tab = doc.querySelector("#injury");
      const status = tab.querySelector(".scp-status");
      assert.ok(status, `${player.slug}: no status block`);

      // First, ahead of the grade and the tiles.
      const glance = tab.querySelector(".scp-injury-top");
      if (glance) {
        assert.ok(
          status.compareDocumentPosition(glance) &
            doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
          `${player.slug}: the durability grade comes before the status`,
        );
      }

      // The roster snapshot reports what clubs have FILED. "Nothing filed" and
      // "fit" are different claims and the page must only make the first.
      const text = status.textContent.toLowerCase();
      for (const forbidden of ["healthy", "no injury concerns", "fully fit"]) {
        assert.ok(
          !text.includes(forbidden),
          `${player.slug}: the status block claims "${forbidden}"`,
        );
      }
    }
  });

  test("the history prints every injury as real text", async () => {
    // The point of the timeline is long-tail search — somebody looking for one
    // specific injury is looking for the words in that paragraph. Text behind
    // an interaction answers nobody.
    const found = await withInjury();
    let checked = 0;

    for (const { player, doc } of found) {
      const episodes = [...doc.querySelectorAll("#injury .scp-episode")];
      if (episodes.length === 0) continue;
      for (const episode of episodes) {
        assert.ok(
          episode.querySelector(".scp-episode-head")?.textContent.trim(),
          `${player.slug}: an entry with no heading`,
        );
        assert.ok(
          episode.querySelector(".scp-episode-meta")?.textContent.trim(),
          `${player.slug}: an entry with no when/cost line`,
        );
        // Not inside a <details>, and not hidden.
        assert.equal(
          episode.closest("details"),
          null,
          `${player.slug}: the history is behind a disclosure`,
        );
      }
      checked += 1;
    }
    assert.ok(checked > 0, "expected a history in the snapshot");
  });

  test("a preseason injury says so rather than losing its timing", async () => {
    // Week 0 is how the record files a preseason injury. It used to render as
    // nothing at all, so the entry lost the one piece of timing it had.
    const found = await withInjury(40);
    let seen = 0;
    for (const { doc } of found) {
      for (const meta of doc.querySelectorAll("#injury .scp-episode-meta")) {
        const text = meta.textContent.trim();
        assert.ok(
          !/^week 0\b/i.test(text),
          `a preseason entry rendered as "${text}"`,
        );
        if (/preseason/i.test(text)) seen += 1;
      }
    }
    // Not asserting that any player HAS one — only that none renders as Week 0.
    assert.ok(seen >= 0);
  });

  test("the FAQ answers from the record and never predicts", async () => {
    const found = await withInjury();
    let checked = 0;

    for (const { player, doc } of found) {
      const items = [...doc.querySelectorAll("#injury .scp-faq-item")];
      if (items.length === 0) continue;

      for (const item of items) {
        const q = item.querySelector(".scp-faq-q")?.textContent.trim() ?? "";
        const a = item.querySelector(".scp-faq-a")?.textContent.trim() ?? "";
        assert.ok(q.endsWith("?"), `${player.slug}: "${q}" is not a question`);
        assert.ok(a.length > 20, `${player.slug}: "${q}" has no real answer`);

        // Rule 3: the page describes, it does not forecast. "Is he playing?"
        // is answered with the designation and his last appearance, never with
        // a claim about a game that has not been played.
        for (const forbidden of ["expected to play", "should play", "will play", "likely to"]) {
          assert.ok(
            !a.toLowerCase().includes(forbidden),
            `${player.slug}: an answer predicts — "${forbidden}"`,
          );
        }
      }
      checked += 1;
    }
    assert.ok(checked > 0, "expected an FAQ in the snapshot");
  });


  test("the FAQ leads with the two questions people actually type", async () => {
    // "Is he injured" and "is he playing this week" are the highest-volume
    // queries this page can answer, and they are the two whose answers move
    // week to week. If a static question ever drifts to the top, the tab has
    // stopped answering the search that brought somebody to it.
    const found = await withInjury(4);
    let checked = 0;

    for (const { player, doc } of found) {
      const questions = [...doc.querySelectorAll("#injury .scp-faq-q")].map((el) =>
        el.textContent.trim(),
      );
      if (questions.length === 0) continue;

      assert.equal(questions[0], `Is ${player.name} injured?`);
      assert.equal(questions[1], `Is ${player.name} playing this week?`);
      assert.ok(
        questions.length >= 2 && questions.length <= 7,
        `${player.slug}: ${questions.length} questions — the FAQ is meant to be 5-7`,
      );
      // Every question is asked once. A duplicate is a template bug that reads
      // as a page repeating itself.
      assert.equal(
        new Set(questions).size,
        questions.length,
        `${player.slug}: a question is asked twice`,
      );
      checked += 1;
    }
    assert.ok(checked > 0, "expected an FAQ in the snapshot");
  });

  test("the FAQ's numbers agree with the record above it", async () => {
    const found = await withInjury(5);
    let checked = 0;

    for (const { player, doc } of found) {
      const answers = [...doc.querySelectorAll("#injury .scp-faq-item")].map((item) => [
        item.querySelector(".scp-faq-q").textContent.trim(),
        item.querySelector(".scp-faq-a").textContent.trim(),
      ]);
      if (answers.length === 0) continue;

      const missed = answers.find(([q]) => q.includes("missed due to injury"));
      const worst = answers.find(([q]) => q.includes("worst injury"));
      if (!missed || !worst) continue;

      // The total in the answer is the total on the page's own summary tile.
      const tiles = [...doc.querySelectorAll("#injury .scp-tile")].map((tile) => [
        tile.querySelector(".scp-tile-label")?.textContent.trim() ?? "",
        tile.querySelector(".scp-tile-value")?.textContent.trim() ?? "",
      ]);
      const tile = tiles.find(([label]) => /games? missed/i.test(label));
      const stated = Number(/missed (\d+) game/.exec(missed[1])?.[1]);

      if (tile && Number.isFinite(Number(tile[1])) && Number.isFinite(stated)) {
        assert.equal(
          stated,
          Number(tile[1]),
          `${player.slug}: the FAQ says ${stated} games missed, the tile says ${tile[1]}`,
        );
      }

      // The worst injury never claims more games than the career total.
      const worstGames = Number(/costing (\d+) game/.exec(worst[1])?.[1]);
      if (Number.isFinite(worstGames) && Number.isFinite(stated)) {
        assert.ok(
          worstGames <= stated,
          `${player.slug}: one injury cost ${worstGames} of ${stated} career games missed`,
        );
      }
      checked += 1;
    }
    assert.ok(checked > 0, "expected a countable FAQ in the snapshot");
  });

  test("the FAQ never prints a raw record in the middle of a sentence", async () => {
    // The injury type is stored as "PCL Sprain" and "Thumb Fracture". Dropped
    // into prose unchanged it reads like a database row; lowercased wholesale
    // it becomes "pcl sprain". Both have shipped, hence this.
    const found = await withInjury(6);

    for (const { player, doc } of found) {
      for (const item of doc.querySelectorAll("#injury .scp-faq-item")) {
        const a = item.querySelector(".scp-faq-a").textContent;

        // A known initialism must keep its capitals.
        for (const term of ["acl", "mcl", "pcl", "ucl", "mri"]) {
          assert.ok(
            !a.includes(` ${term} `),
            `${player.slug}: an answer lowercases "${term.toUpperCase()}"`,
          );
        }

        // And a body part must be named as an injury, not as anatomy:
        // "was a shoulder in 2024" was the bug this catches.
        assert.ok(
          !/\bwas an? (shoulder|hamstring|knee|ankle|back|groin|foot|hip) in \b/.test(a),
          `${player.slug}: an answer names a body part where an injury belongs`,
        );
      }
    }
  });

  test("an answer with nothing behind it is not asked", async () => {
    // A player whose record has no games missed must not be handed "0 games of
    // those fall in 2026", and a player with one injury must not be asked
    // whether it recurred.
    const found = await withInjury(8);

    for (const { player, doc } of found) {
      for (const item of doc.querySelectorAll("#injury .scp-faq-item")) {
        const a = item.querySelector(".scp-faq-a").textContent;
        assert.ok(
          !/\b0 games\b/.test(a),
          `${player.slug}: an answer states a zero as though it were news`,
        );
        assert.ok(
          !/undefined|NaN|\[object/.test(a),
          `${player.slug}: an answer leaked a value`,
        );
      }
    }
  });

  test("a section URL is one section, with its own title", async () => {
    const found = await withInjury(1);
    const slug = found[0].player.slug;

    const scoped = await get(`/player/${slug}/injury/`);
    assert.equal(scoped.status, 200);
    const doc = new JSDOM(scoped.body).window.document;

    const panels = [...doc.querySelectorAll("[data-scp-panel]")].map((p) => p.id);
    assert.deepEqual(panels, ["injury"], "a section URL renders one section");

    const h1 = doc.querySelector("h1")?.textContent.replace(/\s+/g, " ").trim();
    assert.equal(h1, found[0].player.name, "the H1 is the player, as on every tab");
    assert.match(
      doc.querySelector("#injury .scp-h2")?.textContent ?? "",
      /Injury Update & History$/,
      "and the section carries the search phrase",
    );
    assert.match(
      doc.querySelector("title")?.textContent ?? "",
      /Injury Update, Status & History/,
      "and the title targets both intents",
    );

    // The whole point of scoping: the other six sections are NOT here, or the
    // two URLs are the same page twice.
    assert.equal(doc.querySelector("#game-log"), null);
    assert.equal(doc.querySelector("#news"), null);

    // ...and the unscoped URL is unaffected. The section is part of the render
    // cache key; without that, whichever URL is requested first wins for both.
    const full = await get(`/player/${slug}`);
    const fullDoc = new JSDOM(full.body).window.document;
    assert.ok(
      [...fullDoc.querySelectorAll("[data-scp-panel]")].length > 1,
      "the full profile still renders every section",
    );
    assert.equal(
      fullDoc.querySelector("h1")?.textContent.trim(),
      found[0].player.name,
      "and its H1 is still the player's name",
    );
  });
});

describe("the news tab", () => {
  /** The first player whose page renders a News tab. */
  async function withNews() {
    for (const player of roster.slice(0, 40)) {
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200 || !res.body.includes('id="news"')) continue;
      return { player, doc: new JSDOM(res.body).window.document };
    }
    return null;
  }

  test("carries the team's reporting, not just the player's", async () => {
    const found = await withNews();
    assert.ok(found, "at least one player has a news tab");

    const news = found.doc.querySelector("#news");
    const lists = news.querySelectorAll("ul.scp-news");
    assert.ok(lists.length >= 1, "at least one list of stories");

    // Every card is a real link with real text — this section is the one most
    // likely to quietly render empty shells if a feed changes shape.
    for (const item of news.querySelectorAll(".scp-news-item")) {
      const title = item.querySelector(".scp-news-title");
      assert.ok(title, "every card has a headline");
      assert.ok(title.textContent.trim().length > 0, "the headline has text");
      const link = title.querySelector("a");
      if (link) {
        assert.match(link.getAttribute("href"), /^https?:\/\//);
        assert.equal(link.getAttribute("rel"), "noopener noreferrer");
      }
    }
  });

  test("a story is never listed twice under two headings", async () => {
    const found = await withNews();
    const news = found.doc.querySelector("#news");
    const hrefs = [...news.querySelectorAll(".scp-news-title a")].map((a) =>
      a.getAttribute("href"),
    );
    assert.equal(
      new Set(hrefs).size,
      hrefs.length,
      "the player's news and their team's must be deduped against each other",
    );
  });

  test("headlines sit below the section heading in the outline", async () => {
    const found = await withNews();
    const news = found.doc.querySelector("#news");
    assert.ok(news.querySelector("h2"), "the tab owns an h2");
    // h4 rather than h3: the subsection headings ("Latest on X", "Around the
    // Y") are the h3s, so a headline at h3 would flatten the outline.
    assert.equal(news.querySelectorAll("h3.scp-news-title").length, 0);
    assert.ok(news.querySelectorAll("h4.scp-news-title").length > 0);
  });

  test("a designation is stamped with the snapshot it came from", async () => {
    // Every report card must say when it was read. A designation shown without
    // a time can look current indefinitely, which is the exact failure this
    // page is least allowed to have.
    let checked = 0;
    for (const player of roster.slice(0, 40)) {
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const report = doc.querySelector(".scp-report");
      if (!report) continue;
      checked += 1;

      assert.ok(
        report.querySelector(".scp-report-pill").textContent.trim(),
        "the card names the designation",
      );
      const stamp = report.querySelector(".scp-report-stamp time");
      assert.ok(stamp, "the card carries a snapshot time");
      assert.ok(stamp.getAttribute("datetime"), "machine-readable");
      assert.ok(Number(stamp.getAttribute("data-ts")) > 0, "and refinable by the client");
      assert.match(
        report.getAttribute("data-severity"),
        /^(out|doubtful|questionable|probable)$/,
      );
      if (checked >= 3) break;
    }
    assert.ok(checked > 0, "expected at least one designated player in the snapshot");
  });

  test("the news tab hands a reader on to the injury history", async () => {
    // The cross-link used to run the other way: the designation lived in News
    // and the Injury tab pointed at it. The status now leads the Injury tab,
    // so News is the one that should hand a reader on — otherwise the card
    // beside the reporting is the end of the road.
    let checked = 0;
    for (const player of roster.slice(0, 40)) {
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const report = doc.querySelector(".scp-report");
      const news = doc.querySelector("#news");
      if (!report || !news || !doc.getElementById("injury")) continue;
      checked += 1;

      const link = news.querySelector(".scp-crosslink");
      assert.ok(link, "a designated player's news tab links to the history");
      assert.equal(link.getAttribute("href"), "#injury");
      if (checked >= 2) break;
    }
    assert.ok(checked > 0, "expected at least one designated player");
  });

  test("the team's news offers a way through to the hub", async () => {
    const found = await withNews();
    const more = found.doc.querySelector("#news .scp-news-more-link");
    if (more) {
      assert.match(more.getAttribute("href"), /^\/team\//);
      assert.equal(
        more.getAttribute("target"),
        "_top",
        "a link into the site must break out of the legacy frame",
      );
    }
  });
});

describe("the bio tab", () => {
  /** The first few players whose page renders a Bio section. */
  async function bioPages(limit = 6) {
    const pages = [];
    for (const player of roster.slice(0, 120)) {
      if (pages.length >= limit) break;
      const res = await get(`/player/${player.slug}/bio/`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      if (!doc.querySelector("#bio .scp-bio")) continue;
      pages.push({ player, doc, body: res.body });
    }
    return pages;
  }

  test("the bio opens on the paragraph, and the paragraph carries the facts", async () => {
    const pages = await bioPages(4);
    assert.ok(pages.length > 0, "at least one player has a bio");

    for (const page of pages) {
      // The labelled fact grid is gone; the opening paragraph is the only
      // place these answers live now, so it has to actually contain them.
      // Born-on and the college are the two every bio derives — a birth date
      // gives the age, and the college line is the one searched for by name.
      const prose = page.doc.querySelector("#bio .scp-bio").textContent;
      assert.equal(page.doc.querySelector("#bio .scp-facts"), null);
      assert.match(
        prose,
        /Born on \w+ \d{1,2}, \d{4}/,
        `${page.player.slug}: the paragraph gives the birth date`,
      );
      assert.match(
        prose,
        /played college football at /,
        `${page.player.slug}: the paragraph names the college`,
      );

      const narrative = page.doc.querySelector("#bio .scp-bio");
      const timeline = page.doc.querySelector("#bio .scp-stints");
      if (timeline) {
        assert.ok(
          narrative.compareDocumentPosition(timeline) & 4,
          "the paragraph opens the tab, above the timeline",
        );
      }
    }
  });

  test("bio is about the person, never about fantasy", async () => {
    // The whole architectural point of this tab. Overview, Stats, Game Log,
    // Outlook and Injury each answer a lineup question; Bio answers "who is
    // he?", and a page that does both ranks for neither set of queries as well
    // as either would alone.
    const banned = [
      "fantasy",
      "ppg",
      "points per game",
      "boom",
      "bust",
      "ceiling",
      "floor",
      "waiver",
      "lineup",
      "td-dependent",
      "volume-driven",
      "efficiency",
      "target share",
      "snap share",
    ];

    for (const page of await bioPages(6)) {
      const text = page.doc.querySelector("#bio").textContent.toLowerCase();
      for (const word of banned) {
        assert.ok(
          !text.includes(word),
          `${page.player.slug}: the bio says "${word}", which belongs on another tab`,
        );
      }
    }
  });

  test("the career timeline runs forwards and never predates the draft", async () => {
    for (const page of await bioPages(6)) {
      const stints = [...page.doc.querySelectorAll("#bio .scp-stint[data-kind='nfl']")];
      if (stints.length === 0) continue;

      const years = stints.map((stint) => {
        const text = stint.querySelector(".scp-stint-years").textContent.trim();
        return Number(text.slice(0, 4));
      });

      for (let i = 1; i < years.length; i += 1) {
        assert.ok(
          years[i] > years[i - 1],
          `${page.player.slug}: the timeline runs ${years[i - 1]} then ${years[i]}`,
        );
      }

      // The bug this is here for: the upstream stats API answers for seasons a
      // player was not in the league by handing back his CURRENT team with an
      // empty stat line, which put a 2016 draftee on a roster in 2005.
      //
      // Read off the paragraph, which is where the draft year lives now that
      // the fact grid is gone: "... in the third round of the 2016 NFL Draft".
      const prose = page.doc.querySelector("#bio .scp-bio")?.textContent ?? "";
      const draftYear = Number(prose.match(/(\d{4}) NFL Draft/)?.[1]);
      if (!Number.isFinite(draftYear)) continue;
      assert.ok(
        years[0] >= draftYear,
        `${page.player.slug}: the timeline starts in ${years[0]}, before the ${draftYear} draft`,
      );
    }
  });

  /*
   * A player who went back to a club. Deebo Samuel: drafted by the 49ers, a
   * 2025 season in Washington, back in San Francisco. The FAQ used to answer
   * "the San Francisco 49ers, Washington Commanders and San Francisco 49ers",
   * and the paragraph said he had "since played for the Washington Commanders
   * and San Francisco 49ers", as if the first spell had not happened.
   */
  test("a club he went back to is named once, and the return is said", async (t) => {
    const res = await get("/player/deebo-samuel/bio/");
    if (res.status !== 200) return t.skip("no deebo-samuel profile in this data");
    const doc = new JSDOM(res.body).window.document;
    const clubs = [...doc.querySelectorAll("#bio .scp-stint[data-kind='nfl']")].map((n) =>
      n.textContent,
    );
    const sf = clubs.filter((text) => /49ers/.test(text)).length;
    if (sf < 2 || !clubs.some((text) => /Commanders/.test(text))) {
      return t.skip("the data no longer has him leaving and returning");
    }

    const prose = doc.querySelector("#bio .scp-bio").textContent;
    assert.match(prose, /has since played for the Washington Commanders and returned to the San Francisco 49ers\./);

    const answer = [...doc.querySelectorAll("script, .scp-faq-a, [class*='faq'] p")]
      .map((n) => n.textContent)
      .join(" ")
      .match(/Deebo Samuel has played for the [^."]*\./)?.[0];
    assert.ok(answer, "the FAQ answers which teams");
    assert.equal(
      answer,
      "Deebo Samuel has played for the San Francisco 49ers (two stints) and Washington Commanders.",
    );
  });

  test("a draft is printed only when it is known, never guessed", async () => {
    // draft.json writes year: null both for a player who went undrafted and for
    // one it could not resolve — Marvin Harrison Jr. went fourth overall and
    // carries a null row. So the page must never print "undrafted".
    for (const page of await bioPages(8)) {
      assert.ok(
        !/undrafted/i.test(page.doc.querySelector("#bio").textContent),
        `${page.player.slug}: the bio claims a draft status the data cannot support`,
      );

      // The draft has no block of its own and no cell of its own — the
      // paragraph carries it, and it names a year or it is not mentioned.
      assert.equal(page.doc.querySelector("#bio .scp-draft"), null);
      assert.equal(page.doc.querySelector("#bio .scp-facts"), null);

      const prose = page.doc.querySelector("#bio .scp-bio")?.textContent ?? "";
      if (!/NFL Draft/.test(prose)) continue;
      assert.match(
        prose,
        /\d{4} NFL Draft/,
        "a draft the paragraph mentions names its year",
      );
    }
  });

  test("the questions are answered directly, and marked up as answers", async () => {
    const pages = await bioPages(3);
    for (const page of pages) {
      const items = [...page.doc.querySelectorAll("#bio .scp-faq-item")];
      if (items.length === 0) continue;

      for (const item of items) {
        const q = item.querySelector(".scp-faq-q").textContent.trim();
        const a = item.querySelector(".scp-faq-a").textContent.trim();
        assert.ok(q.endsWith("?"), `"${q}" is a question`);
        assert.ok(a.length > 0 && a.endsWith("."), `"${q}" has a real answer`);
        assert.ok(
          a.includes(page.player.name) || a.startsWith("No"),
          `"${q}" is answered about the player by name`,
        );
      }

      // The standalone page carries FAQPage; the embedded fragment must not,
      // because WordPress owns the document's schema there.
      assert.match(page.body, /"@type":\s*"FAQPage"/, "the bio page ships FAQ schema");
    }

    const fragment = await get(`/embed/player/${pages[0].player.slug}?section=bio`);
    assert.ok(
      !/FAQPage/.test(fragment.body),
      "the embedded fragment leaves schema to the host page",
    );
  });

  test("the bio page names itself for the queries it answers", async () => {
    const pages = await bioPages(1);
    const { doc } = pages[0];
    const name = pages[0].player.name;

    // The H1 is the player, whatever the tab: the hero does not caption itself
    // with the open panel. The phrase this page answers for is the section's
    // own heading, and the title below.
    assert.equal(
      doc.querySelector("h1").textContent.replace(/\s+/g, " ").trim(),
      name,
    );
    assert.equal(doc.querySelector("#bio .scp-h2").textContent.trim(), `${name} Bio`);
    assert.match(
      doc.querySelector("title").textContent,
      /Bio: Age, Height, College, Draft & Career/,
      "the title targets the biographical cluster",
    );
    assert.ok(
      !/fantasy/i.test(doc.querySelector("meta[name=description]").getAttribute("content")),
      "the description does not promise fantasy analysis",
    );
  });
});

/**
 * The search above the header.
 *
 * It is the one control on the page that does not work without the bundle —
 * see renderPlayerSearch() — so what the server owes it is narrow and exact:
 * the box, SHIPPED HIDDEN so a reader without the script never meets a field
 * that swallows typing; the whole roster beside it, because a fragment printed
 * into a WordPress page cannot fetch one from this origin without CORS and an
 * absolute URL it does not carry; and the link prefix, so a result inside
 * WordPress goes to statchasers.com rather than back to the bare tool.
 *
 * These execute no JavaScript, like the rest of the suite. What the keyboard
 * and the filtering do is client/player-search.ts's business; what is asserted
 * here is that the raw materials arrive and that the page still costs what it
 * is supposed to.
 */
describe("the player search", () => {
  test("ships above the header, hidden until the bundle runs", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    const widget = doc.querySelector("[data-scp-search]");
    assert.ok(widget, "the search is in the served HTML");
    assert.ok(
      widget.hasAttribute("hidden"),
      "it must ship hidden: with no script it is a box that answers nothing",
    );

    const root = doc.querySelector("[data-scp-root]");
    assert.equal(root.firstElementChild, widget, "it is the first thing in the tool");
    assert.equal(
      widget.compareDocumentPosition(doc.querySelector("[data-scp-hero]")) &
        doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      "and it comes before the header, not after it",
    );

    // One <input>, no <form>: a form with no action submits to the current URL,
    // so Enter would mint /player/<slug>?= and hand a crawler a duplicate of a
    // page this tool works hard to have exactly one address for.
    assert.equal(widget.querySelectorAll("form").length, 0, "never a form");
    assert.equal(widget.querySelectorAll("input").length, 1);

    // The roles are the client's to add, because they promise behaviour that
    // does not exist until it runs.
    const input = widget.querySelector("input");
    assert.equal(input.getAttribute("role"), null);
    assert.equal(input.getAttribute("type"), "search");
    assert.ok(widget.querySelector(".scp-sr"), "the field is labelled");
  });

  test("carries the whole roster inline, and nothing that runs", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    const island = doc.querySelector("[data-scp-roster]");
    assert.ok(island, "the roster is inlined beside the box");
    assert.equal(
      island.getAttribute("type"),
      "application/json",
      "inert data, not a script — the page loads exactly one bundle",
    );

    const { rows, teams } = JSON.parse(island.textContent);
    assert.ok(Array.isArray(rows));
    assert.equal(
      rows.length,
      roster.length,
      "every player with a page is reachable from every other page",
    );

    const slugs = new Set();
    for (const row of rows) {
      const [slug, name, position, team, id] = row.split("|");
      assert.match(slug, /^[a-z0-9][a-z0-9-]*$/, `slug-shaped: ${row}`);
      assert.ok(name, `every row names somebody: ${row}`);
      assert.ok(/^[A-Z]*$/.test(position), `position is a code or empty: ${row}`);
      assert.ok(/^[A-Z]*$/.test(team), `team is a code or empty: ${row}`);
      // Sleeper's id, which is what the portrait CDN is keyed by. Without it
      // the dropdown draws eight empty wells.
      assert.match(id, /^\w+$/, `every row carries an id: ${row}`);
      // The club is named once in `teams` and referenced from the row — a code
      // with no entry there is a result with no badge and no club.
      if (team) assert.ok(teams[team], `${team} is described once, beside the rows`);
      slugs.add(slug);
    }

    for (const [code, club] of Object.entries(teams)) {
      assert.match(code, /^[A-Z]{2,3}$/);
      assert.ok(club.name, `${code} carries a nickname`);
      assert.match(club.logo, /^https:\/\//, `${code} carries an absolute logo`);
    }
    assert.ok(
      Object.keys(teams).length <= 32,
      "one entry per club, not one per player",
    );
    assert.equal(slugs.size, rows.length, "no player listed twice");
    assert.ok(slugs.has(fixture.slug), "including the player being looked at");

    // The slugs are the site's own, never derived from the name: "A.J. Brown"
    // is aj-brown, not a-j-brown, and a search that guessed would hand out
    // links to pages that do not exist.
    for (const player of roster.slice(0, 40)) {
      assert.ok(slugs.has(player.slug), `${player.name} is searchable`);
    }
  });

  test("the island carries all 32 clubs as destinations of their own", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const { clubs, teams } = JSON.parse(
      doc.querySelector("[data-scp-roster]").textContent,
    );

    assert.ok(Array.isArray(clubs));
    assert.equal(clubs.length, 32, "every hub is reachable from every page");
    assert.equal(
      Object.keys(teams).length,
      32,
      "and every one of them is described, whether or not it has a player indexed",
    );

    const slugs = new Set();
    for (const row of clubs) {
      const [code, slug, city, nickname, division] = row.split("|");
      assert.match(code, /^[A-Z]{2,3}$/, row);
      assert.match(slug, /^[a-z][a-z0-9-]*$/, row);
      assert.ok(city && nickname, `a club is a city and a nickname: ${row}`);
      assert.match(division, /^(AFC|NFC) (East|North|South|West)$/, row);
      // The logo is not repeated in the row: it is already beside it, once
      // per code, for the players on that club.
      assert.match(teams[code].logo, /^https:\/\//, `${code} has a mark to draw`);
      slugs.add(slug);
    }
    assert.equal(slugs.size, 32, "no club listed twice");
  });

  test("the roster is a fraction of the page, not a second one", async () => {
    const res = await get(`/player/${fixture.slug}`);
    const island = res.body.match(/data-scp-roster>(.*?)<\/script>/s);
    assert.ok(island, "the island is in the raw HTML");

    // It is paid for on every page, so it has a budget. Comfortable at ~575
    // players and ~36 bytes a row; a change that doubles the row (a headshot
    // URL, a team's full name) trips this before it ships.
    const share = island[1].length / res.body.length;
    assert.ok(
      share < 0.35,
      `the inlined roster is ${(share * 100).toFixed(1)}% of the document`,
    );
  });

  /*
   * Booted separately, because the behaviour IS the environment: the fragment's
   * links are built from SC_PLAYER_PATH_PREFIX, and one server cannot answer
   * for both configurations. Same shape as the team switcher's test.
   */
  test("the fragment points its results at the public site", async () => {
    const srv = await startServer({
      SC_PLAYER_PATH_PREFIX: "/nfl/players/",
      SC_TEAM_PATH_PREFIX: "/nfl/teams/",
    });
    try {
      const res = await fetch(`${srv.origin}/embed/player/${fixture.slug}`);
      assert.equal(res.status, 200);
      const doc = new JSDOM(`<body>${await res.text()}</body>`).window.document;

      const widget = doc.querySelector("[data-scp-search]");
      assert.ok(widget, "the search is in the WordPress fragment too");
      assert.equal(widget.getAttribute("data-scp-prefix"), "/nfl/players/");
      // The box answers with clubs as well as players, and a club lives under
      // a different WordPress page than a player does.
      assert.equal(widget.getAttribute("data-scp-team-prefix"), "/nfl/teams/");
      // `embed` is a reserved WordPress query var: /nfl/players/<slug>/?embed=1
      // serves its oEmbed template instead of the page. Off-origin links drop
      // it, exactly as the team switcher's do.
      assert.equal(widget.getAttribute("data-scp-query"), "");

      // The peers rail is the page's other way out, and it is built from the
      // same prefix — a card pointing back at the bare tool would take the
      // reader off statchasers.com mid-visit.
      const peers = [...doc.querySelectorAll("a.scp-peer")].map((a) =>
        a.getAttribute("href"),
      );
      assert.ok(peers.length > 0, "the fragment carries the rail too");
      for (const href of peers) {
        assert.match(href, /^\/nfl\/players\/[a-z0-9-]+$/);
      }
    } finally {
      await srv.stop();
    }
  });

  test("on this origin the results stay in embedded mode", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    const widget = doc.querySelector("[data-scp-search]");
    assert.equal(widget.getAttribute("data-scp-prefix"), "/player/");
    assert.equal(widget.getAttribute("data-scp-team-prefix"), "/team/");
    assert.equal(widget.getAttribute("data-scp-query"), "?embed=1");
  });

  test("it answers with clubs as well as players", async () => {
    const { doc, window } = await hydrated("/player");
    const input = doc.querySelector(".scp-search-input");

    const type = (value) => {
      input.value = value;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      return [...doc.querySelectorAll(".scp-search-opt")].map((a) => ({
        kind: a.dataset.kind,
        name: a.querySelector(".scp-search-name").textContent,
        tag: a.tagName,
      }));
    };

    // A nickname finds the club, and only the club — no player is a Raven.
    // On THIS page the club row is a button, not a link: the index is the
    // roster, so picking a club filters it rather than leaving for the hub.
    // The profile's own box still links out; that is asserted below.
    const ravens = type("ravens");
    assert.deepEqual(ravens, [
      { kind: "team", name: "Baltimore Ravens", tag: "BUTTON" },
    ]);
    const raven = doc.querySelector('.scp-search-opt[data-kind="team"]');
    assert.equal(raven.getAttribute("href"), null, "a filter has no address");
    assert.equal(raven.dataset.club, "BAL", "it names the card it filters to");

    // The code, which neither the city nor the nickname begins with. Without
    // it "gb" is the one spelling of Green Bay the box cannot answer.
    assert.ok(
      type("gb").some((hit) => hit.name === "Green Bay Packers"),
      "a club answers to its own code",
    );

    // A player's name still finds the player. "jackson" also opens
    // "Jacksonville", so the club leads — the string is genuinely ambiguous
    // and both answers are on screen together. What must not happen is the
    // players being pushed off the list to make room for the club.
    const jackson = type("jackson");
    assert.equal(jackson[0].kind, "team", "the city leads an ambiguous string");
    assert.ok(
      jackson.some((hit) => hit.kind === "player"),
      "the men called Jackson are still under it",
    );
    // A surname no city shares answers with players only.
    const mahomes = type("mahomes");
    assert.ok(mahomes.length > 0);
    assert.ok(
      mahomes.every((hit) => hit.kind === "player"),
      "no club is named Mahomes",
    );

    // Clubs lead, and never take more than half the panel.
    const mixed = type("b");
    const firstPlayer = mixed.findIndex((hit) => hit.kind === "player");
    assert.ok(firstPlayer > 0, "clubs come first");
    assert.ok(firstPlayer <= 4, "and at most four of them");
    assert.ok(
      mixed.slice(firstPlayer).every((hit) => hit.kind === "player"),
      "the two kinds are not interleaved",
    );
    assert.ok(mixed.length <= 8, "one panel's worth, whatever the mix");
  });

  test("on a profile a club is still somewhere to go", async () => {
    // The mode is the index's alone, and the profile is where the widget
    // behaves as it always did: there is no roster on a player's page to
    // filter, so a club row is a link to the club's hub.
    const { doc } = await dom(`/player/${fixture.slug}`);
    const widget = doc.querySelector("[data-scp-search]");
    assert.equal(
      widget.hasAttribute("data-scp-club-filter"),
      false,
      "a profile does not ask for filtering",
    );

    const { doc: live, window } = await hydrated(`/player/${fixture.slug}`);
    const input = live.querySelector(".scp-search-input");
    input.value = "ravens";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    const hit = live.querySelector('.scp-search-opt[data-kind="team"]');
    assert.equal(hit.tagName, "A", "still a link");
    assert.equal(hit.getAttribute("href"), "/team/baltimore-ravens");
    assert.equal(hit.getAttribute("target"), "_top", "and still breaks the frame");
  });
});

/**
 * The Nearby Positional Peers rail.
 *
 * Ported from the standalone app's RankNeighborsRail, which fetched
 * /api/players/:slug/related from the browser. Here it is arithmetic over logs
 * already in memory, so it ships in the HTML — which is what these assert,
 * along with the property that makes the block trustworthy: the rank on the
 * reader's own card is the rank the header printed. A rail built on a
 * different measure from the header's would put two different answers to
 * "which QB is he?" on one page.
 */
describe("the positional peers rail", () => {
  test("ships in the HTML, in rank order, with the reader marked", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    const rail = doc.querySelector("[data-scp-peers]");
    assert.ok(rail, "the rail is server-rendered, not fetched");

    const cards = [...rail.querySelectorAll(".scp-peer")];
    assert.ok(cards.length >= 2, "a neighbourhood, not a card on its own");
    assert.ok(cards.length <= 7, "three either side and the player himself");

    const ranks = cards.map((card) =>
      Number(card.querySelector(".scp-peer-rank").textContent.replace(/^[A-Z]+/, "")),
    );
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
      "cards read down the table, best rank first",
    );
    assert.equal(new Set(ranks).size, ranks.length, "one card per rank");

    const current = rail.querySelectorAll(".scp-peer.is-current");
    assert.equal(current.length, 1, "exactly one card is the reader's own");
    assert.match(current[0].textContent, /You are here/i);
    assert.match(current[0].querySelector(".scp-peer-name").textContent, /\S/);
    // Not a link back to the page you are standing on.
    assert.equal(current[0].tagName, "DIV");
    assert.equal(current[0].getAttribute("aria-current"), "page");

    for (const card of cards) {
      if (card.classList.contains("is-current")) continue;
      assert.equal(card.tagName, "A", "every other card is a real link");
      assert.match(card.getAttribute("href"), /^\/player\/[a-z0-9-]+$/);
      // Same as every other link in the fragment: out of the legacy frame.
      assert.equal(card.getAttribute("target"), "_top");
    }
  });

  test("the card the reader is on agrees with the header", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);

    const cells = [...doc.querySelectorAll(".scp-hero-stat")];
    const rankCell = cells.find((cell) =>
      /pos rank/i.test(cell.querySelector(".scp-hero-stat-label").textContent),
    );
    const current = doc.querySelector(".scp-peer.is-current .scp-peer-rank");
    assert.ok(current, "the reader's card carries its rank");

    // The header only prints a rank when it has one; when it does, the rail
    // must be the slice of the table that rank came from.
    if (rankCell) {
      assert.equal(
        current.textContent.trim(),
        rankCell.querySelector(".scp-hero-stat-value").textContent.trim(),
        "one player, one positional rank, whatever measure produced it",
      );
    }
  });

  test("every peer is a page that resolves", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const hrefs = [...doc.querySelectorAll("a.scp-peer")].map((a) =>
      a.getAttribute("href"),
    );
    assert.ok(hrefs.length > 0);

    // The dictionary is thousands of names deep and only the indexed players
    // have a page, so the neighbourhood skips the ones that do not — the whole
    // reason it is walked outwards rather than sliced.
    for (const href of hrefs) {
      const res = await get(href);
      assert.equal(res.status, 200, `${href} must not be a dead card`);
    }
  });

  test("stands under whichever tab is open", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const rail = doc.querySelector(".scp-peers");
    assert.ok(rail);
    assert.equal(
      rail.closest("[data-scp-panel]"),
      null,
      "outside the panels, or it would vanish with its tab",
    );

    // And on a section-scoped page too, which is that page's version of a tab.
    const scoped = await dom(`/player/${fixture.slug}/bio/`);
    assert.ok(
      scoped.doc.querySelector("[data-scp-peers]"),
      "the section page keeps the way out of the page",
    );
  });

  test("the subheading says which measure ranked them", async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    const sub = doc.querySelector(".scp-peers .scp-head-sub").textContent;
    assert.match(sub, /points per game|points scored/);
    assert.match(sub, /PPR|HALF|STD/);
    // The season the rest of the page is a reading of, not some other one.
    const season = doc.querySelector("[data-scp-root]").getAttribute("data-season");
    assert.ok(sub.includes(season), `the subheading names ${season}`);

    // Half-PPR is a different table, so it is a different neighbourhood — the
    // format toggle must reach this block like it reaches the rest.
    const half = await dom(`/player/${fixture.slug}?format=half`);
    assert.match(
      half.doc.querySelector(".scp-peers .scp-head-sub").textContent,
      /HALF/,
    );
  });
});

describe("the embedded fragment", () => {
  test("serves markup with no document around it", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    assert.equal(res.status, 200);
    assert.ok(!/<html/i.test(res.body), "fragment must not be a full document");
    assert.ok(!/<link\b/i.test(res.body), "fragment must not carry a stylesheet");
    assert.ok(res.body.includes("data-scp-root"));

    // The fragment may carry INERT data — the FAQ's Q&A, which the WordPress
    // plugin lifts into Rank Math's schema graph. What it must never carry is
    // anything that runs: the host page loads the bundle through
    // wp_enqueue_script(), and a fragment that brought its own would load it
    // twice on a page with two mounts.
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    for (const script of doc.querySelectorAll("script")) {
      assert.equal(
        script.getAttribute("type"),
        "application/json",
        "the only scripts in a fragment are inert data",
      );
      assert.ok(!script.getAttribute("src"), "a fragment loads nothing");
    }
  });

  test("one FAQPage for the document, however many tabs carry questions", async () => {
    // The profile mounts every tab at once, and each of four of them carries an
    // FAQ. Emitted per block that was four FAQPage nodes in one document, which
    // is the case a crawler drops outright rather than merging — so the node is
    // built once, from the sections that actually shipped.
    const res = await get(`/player/${fixture.slug}`);
    assert.equal(res.status, 200);
    const doc = new JSDOM(res.body).window.document;

    const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => JSON.parse(node.textContent))
      .filter((json) => json["@type"] === "FAQPage");
    assert.equal(nodes.length, 1, "exactly one FAQPage on the profile");

    const rendered = [...doc.querySelectorAll(".scp-faq-item")].map((item) => ({
      question: item.querySelector(".scp-faq-q").textContent.trim(),
      answer: item.querySelector(".scp-faq-a").textContent.trim(),
    }));
    // Only meaningful while the profile really does carry more than one tab's
    // worth; a fixture that lost its FAQs would otherwise pass this silently.
    assert.ok(
      rendered.length > 8,
      `expected several tabs of questions, got ${rendered.length}`,
    );

    const asked = nodes[0].mainEntity.map((q) => ({
      question: q.name,
      answer: q.acceptedAnswer.text,
    }));
    // Equality, not a spot check: structured data describing something the
    // reader cannot see is the one thing it must never do.
    assert.deepEqual(asked, rendered);
  });

  test("a section page describes its own questions and no others", async () => {
    // A section-scoped URL renders every section and then shows one. If the
    // node were built from everything rendered rather than from what shipped,
    // the Bio page would claim the game log's questions — present in the schema,
    // nowhere on the page.
    const res = await get(`/player/${fixture.slug}/bio/`);
    assert.equal(res.status, 200);
    const doc = new JSDOM(res.body).window.document;

    const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => JSON.parse(node.textContent))
      .filter((json) => json["@type"] === "FAQPage");
    assert.equal(nodes.length, 1, "exactly one FAQPage on the section page");

    const rendered = [...doc.querySelectorAll(".scp-faq-item")].map((item) =>
      item.querySelector(".scp-faq-q").textContent.trim(),
    );
    assert.ok(rendered.length > 0, "the bio page carries questions");
    assert.deepEqual(
      nodes[0].mainEntity.map((q) => q.name),
      rendered,
    );
  });

  test("the FAQ ships as data for the host's schema graph, not as a second graph", async () => {
    // Embedded, WordPress owns the document's schema, so the API prints no
    // FAQPage — it hands the questions over as JSON and statchasers-player.php
    // appends them to the graph Rank Math already emits. If this island ever
    // stops matching the rendered Q&A, the page's structured data starts
    // describing something the reader cannot see, which is the one thing
    // structured data must never do.
    const res = await get(`/embed/player/${fixture.slug}?section=game-log`);
    assert.ok(
      !/application\/ld\+json/.test(res.body),
      "an embedded fragment emits no schema of its own",
    );

    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    const island = doc.querySelector("script.scp-faq-data");
    const rendered = [...doc.querySelectorAll("#game-log .scp-faq-item")];
    if (rendered.length === 0) return;

    assert.ok(island, "the rendered FAQ ships its data island");
    const items = JSON.parse(island.textContent);
    assert.equal(
      items.length,
      rendered.length,
      "the island carries every question on the page",
    );

    for (const [i, item] of items.entries()) {
      assert.equal(
        item.q,
        rendered[i].querySelector(".scp-faq-q").textContent.trim(),
        "a question in the data differs from the one rendered",
      );
      assert.equal(
        item.a,
        rendered[i].querySelector(".scp-faq-a").textContent.trim(),
        "an answer in the data differs from the one rendered",
      );
    }
  });

  test("no second H1 inside a host page that already has one", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    assert.equal(doc.querySelectorAll("h1").length, 0, "the host page owns the H1");
    assert.ok(doc.querySelector("h2"), "the name steps down to an H2");
  });

  /*
   * `?h1=1` is the plugin's "the tool supplies the heading" mode: the host has
   * emptied its own title, so the fragment carries the page's only H1. Every
   * indexable address gets one naming the player AND what that address is for.
   * On the profile that H1 used to be the opening panel's "2026 Fantasy
   * Snapshot" — the same words on every profile, naming nobody. An SEO audit
   * of /nfl/players/josh-allen/ found it.
   */
  const h1Of = (body) => {
    const doc = new JSDOM(`<body>${body}</body>`).window.document;
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1, "exactly one H1");
    return { doc, h1: h1[0], text: h1[0].textContent.replace(/\s+/g, " ").trim() };
  };

  test("?h1=1: the profile's one H1 names the player and the page", async () => {
    const { doc, h1, text } = h1Of((await get(`/embed/player/${fixture.slug}?h1=1`)).body);
    assert.equal(text, `${fixture.name} Fantasy Football Stats & Analysis`);
    assert.ok(h1.matches("#overview h1.scp-h2"), "the opening panel's heading, promoted");
    assert.ok(doc.querySelector(".scp-hero h2.scp-title"), "the hero's name stays an H2");
  });

  test("?h1=1: each section page's H1 is its own phrase", async () => {
    for (const [section, want] of [
      ["stats", new RegExp(`^${fixture.name} Stats 2\\d{3}$`)],
      ["game-log", new RegExp(`^${fixture.name} Game Log 2\\d{3}$`)],
      ["outlook", new RegExp(`^${fixture.name} Fantasy Outlook 2\\d{3}$`)],
    ]) {
      const res = await get(`/embed/player/${fixture.slug}?section=${section}&h1=1`);
      const { doc, text } = h1Of(res.body);
      assert.match(text, want, section);
      assert.ok(doc.querySelector(".scp-hero h2.scp-title"), `${section}: the name stays an H2`);
    }
  });

  test("emits no canonical, document title or robots directive", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    assert.ok(!/rel="canonical"/i.test(res.body));
    assert.ok(!/name="robots"/i.test(res.body));

    // A <title> INSIDE an <svg> is that graphic's accessible name and belongs
    // there; a <title> outside one would be a second document title competing
    // with the WordPress page's own. Only the second is a problem, so this
    // parses rather than pattern-matching.
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    for (const title of doc.querySelectorAll("title")) {
      assert.ok(
        title.closest("svg"),
        "a <title> outside an <svg> would compete with the host page's own",
      );
    }
  });

  test("the shell drops its own background and gutter when embedded", async () => {
    const res = await get(`/player/${fixture.slug}?embed=1`);
    assert.match(res.body, /class="scp-page is-embed"/);
    assert.match(res.body, /class="scp is-embed"/);
  });

  test("an unknown slug is a plain 404, not a rendered page", async () => {
    const res = await get("/embed/player/nobody-at-all");
    assert.equal(res.status, 404);
    assert.ok(!/data-scp-root/.test(res.body));
  });
});

describe("the development switcher", () => {
  /**
   * The preview switcher and the /preview/* harness are development-only, and
   * every other suite here runs with NODE_ENV=test — which is the right default
   * and also means nothing ever exercised them switched ON. So this suite
   * starts its own server in development mode.
   *
   * It exists because a real failure: the player pages shipped with routes,
   * a shortcode and tests, and were absent from the switcher, so the only way
   * to reach them in the Replit preview was to type the URL.
   */
  let dev;
  let devSlug;

  before(async () => {
    dev = await startServer({ NODE_ENV: "development" });
    const body = await (await fetch(`${dev.origin}/embed/players.json`)).json();
    devSlug = body.players[0].slug;
  });

  after(async () => {
    await dev?.stop();
  });

  async function devGet(pathname) {
    const res = await fetch(`${dev.origin}${pathname}`, { redirect: "manual" });
    return { status: res.status, body: await res.text() };
  }

  test("every tool is reachable from every other one", async () => {
    // The whole point of the bar. Checked from each tool's own page, because a
    // tool that lists itself but not its siblings is the failure mode.
    for (const path of ["/", "/team/new-england-patriots", `/player/${devSlug}`]) {
      const res = await devGet(path);
      assert.equal(res.status, 200, `${path} should be 200`);
      assert.ok(res.body.includes("scdev"), `${path} carries the switcher`);

      for (const shortcode of [
        "statchasers_news",
        "statchasers_team",
        "statchasers_player",
      ]) {
        assert.ok(
          res.body.includes(`[${shortcode}]`),
          `${path} must offer ${shortcode}`,
        );
      }
    }
  });

  test("the player tool offers every mount, and each one resolves", async () => {
    const res = await devGet(`/player/${devSlug}`);
    const doc = new JSDOM(res.body).window.document;
    const bar = doc.querySelector("[data-scdev]");
    assert.ok(bar, "the bar is present");

    const hrefs = [...bar.querySelectorAll("a")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href.includes("player"));
    assert.ok(hrefs.length >= 4, "page, embed, shortcode and raw at least");

    // Every link in the bar must actually go somewhere — the bug this suite
    // exists for was a dead end, and a 404 behind a switcher button is the same
    // dead end wearing a button.
    for (const href of new Set(hrefs)) {
      const target = await devGet(href);
      assert.equal(target.status, 200, `${href} must resolve`);
    }
  });

  test("the picker offers the whole roster, on player pages only", async () => {
    const onPlayer = await devGet(`/player/${devSlug}`);
    const doc = new JSDOM(onPlayer.body).window.document;
    const select = doc.querySelector("[data-scdev] select[data-scdev-goto]");
    assert.ok(select, "a picker is present on a player page");
    assert.ok(
      select.querySelectorAll("option").length > 100,
      "and it lists the roster, not a handful",
    );
    for (const option of [...select.querySelectorAll("option")].slice(0, 5)) {
      assert.match(option.getAttribute("value"), /player/);
    }

    // Six hundred options is ~40KB, so it must not ride along on the news tool.
    const onNews = await devGet("/");
    assert.ok(
      !new JSDOM(onNews.body).window.document.querySelector(
        "[data-scdev] select",
      ),
      "the picker must not be injected into a tool that cannot use it",
    );
  });

  test("the preview harness assembles the player shortcode", async () => {
    const res = await devGet(`/preview/player/${devSlug}`);
    assert.equal(res.status, 200);
    // The host page enqueues exactly what the plugin enqueues, and nothing else.
    assert.ok(res.body.includes("/player.css"));
    assert.ok(res.body.includes("/dist/statchasers-player.js"));
    assert.ok(res.body.includes("data-scp-root"));
    assert.ok(
      !res.body.includes("/team.css") && !res.body.includes("/styles.css"),
      "one tool's preview must not pull another tool's assets",
    );
  });

  test("the raw view shows the fragment as source", async () => {
    const res = await devGet(`/preview/raw/player/${devSlug}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("/embed/player/"), "it names the endpoint");
    // Escaped into a <pre>, so the markup is shown rather than rendered.
    assert.ok(res.body.includes("&lt;div"), "the fragment is escaped source");
  });

  test("an unknown player is a 404 in the harness too", async () => {
    for (const path of [
      "/preview/player/not-a-real-person",
      "/preview/raw/player/not-a-real-person",
    ]) {
      assert.equal((await devGet(path)).status, 404, `${path} should 404`);
    }
  });
});

describe("caching", () => {
  test("repeat requests revalidate to 304", async () => {
    const first = await get(`/player/${fixture.slug}`);
    const etag = first.headers.get("etag");
    assert.ok(etag, "an ETag is served");

    const second = await rawGet(`/player/${fixture.slug}`, {
      "If-None-Match": etag,
    });
    assert.equal(second.status, 304);
    assert.equal(second.body, "", "a 304 carries no body");
  });

  test("the fragment carries its own validator", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    assert.ok(res.headers.get("etag"), "the fragment is revalidatable");
    assert.match(res.headers.get("cache-control"), /max-age=60/);
  });

  test("every route keeps this origin out of the index on its own", async () => {
    for (const path of [
      "/player",
      `/player/${fixture.slug}`,
      `/embed/player/${fixture.slug}`,
    ]) {
      const res = await get(path);
      assert.match(
        res.headers.get("x-robots-tag"),
        /noindex, indexifembedded/,
        `${path} must ship the embed-only robots posture`,
      );
    }
  });
});

/**
 * Section-scoped player URLs.
 *
 * `/player/<slug>/<section>/` is the public address: the one the canonical
 * names, the tab strip links to and the WordPress rewrite mirrors as
 * /nfl/players/<slug>/<section>/. `?section=` is the internal spelling the
 * plugin fetches the fragment with. These assertions are what makes the pretty
 * address a different PAGE rather than the profile wearing a second URL. Same
 * contract as the team hubs.
 *
 * Which sections a given player has is not fixed — injury, news and bio all
 * depend on data that can be absent — so the list under test is read from the
 * fixture's own strip rather than written down here.
 */
describe("player section URLs", () => {
  /**
   * The heading each section prints for itself.
   *
   * NOT the H1 any more. The hero is the player's name on every one of these
   * addresses — it stopped taking the section's phrase under the name, because
   * a header that rewrites itself on a tab click reads as a different page. The
   * phrase is the section's own H2, which is where it was always going to end
   * up once the hero refused it, and the document title is what names the
   * address.
   */
  const PHRASES = {
    stats: /Stats 2\d{3}$/,
    injury: /Injury Update & History$/,
    "game-log": /Game Log 2\d{3}$/,
    outlook: /Outlook$/,
    news: /News & Analysis$/,
    bio: /Bio$/,
  };

  /*
   * Every tab id in the strip, and the ones that are pages of their own. The
   * Overview is the profile — its tab links to the profile and `/overview/`
   * 301s there — so it has no section page to assert about.
   */
  let sections;
  let pages;
  const at = (id) => `/player/${fixture.slug}/${id}/`;
  const tabHref = (id, base = "/player/") =>
    id === "overview" ? `${base}${fixture.slug}/` : `${base}${fixture.slug}/${id}/`;

  before(async () => {
    const { doc } = await dom(`/player/${fixture.slug}`);
    sections = [...doc.querySelectorAll(".scp-nav-link")].map((link) =>
      link.getAttribute("data-scp-panel-id"),
    );
    assert.ok(sections.length > 1, "the fixture profile has a strip to follow");
    pages = sections.filter((id) => id !== "overview");
  });

  test("each section is one panel, named for what it holds", async () => {
    for (const id of pages) {
      const { doc } = await dom(at(id));

      const root = doc.querySelector("[data-scp-root]");
      assert.equal(root.getAttribute("data-section"), id, `${id}: scoped root`);

      const panels = doc.querySelectorAll("[data-scp-panel]");
      assert.equal(panels.length, 1, `${id}: exactly one panel`);
      assert.equal(panels[0].getAttribute("id"), id, `${id}: it is the right one`);

      const h1 = doc.querySelectorAll("h1");
      assert.equal(h1.length, 1, `${id}: exactly one H1`);
      assert.equal(
        h1[0].textContent.replace(/\s+/g, " ").trim(),
        fixture.name,
        `${id}: the H1 is the player, and only the player`,
      );

      const own = panels[0].querySelector(".scp-h2");
      assert.ok(own, `${id}: the section heads itself`);
      assert.match(
        own.textContent.replace(/\s+/g, " ").trim(),
        PHRASES[id],
        `${id}: and says which page this is`,
      );
    }
  });

  test("the head names the section, once, at its pretty address", async () => {
    // Every URL-bearing tag is the pretty self-reference — never the profile,
    // never the ?section= spelling. The Rank Math filters on the WordPress side
    // owe the same things; this is the origin's half.
    for (const id of pages) {
      const { doc } = await dom(at(id));
      const one = (selector) => {
        const found = doc.querySelectorAll(selector);
        assert.equal(found.length, 1, `${id}: exactly one ${selector}`);
        return found[0];
      };
      const canonical = one('link[rel="canonical"]').getAttribute("href");
      assert.ok(canonical.endsWith(at(id)), `${id}: canonical is the pretty path`);
      assert.equal(one('meta[property="og:url"]').getAttribute("content"), canonical);
      assert.ok(!canonical.includes("?section="), "no query-string canonical");
      // `head > title`, not `title`: a <title> inside an <svg> is that
      // graphic's accessible name and belongs there — the sparkline gives one
      // to every dot it draws — and only a second title in the HEAD would
      // compete with this one. The embed test above draws the same line.
      one("head > title");
      one('meta[name="description"]');
    }
  });

  test("a section page carries the strip, marking the one it is", async () => {
    // It used to carry none, on the grounds that six tabs all leaving the URL
    // is navigation pretending to be tabs. That was right while they were
    // `#hash` links and wrong once they became addresses: a reader who arrived
    // here from search had no way to reach the other six, and those six had
    // nothing linking to them.
    for (const id of pages) {
      const { doc } = await dom(at(id));
      const links = [...doc.querySelectorAll(".scp-nav-link")];
      assert.ok(links.length > 1, `${id}: the strip is here`);

      const current = links.filter((a) => a.classList.contains("is-active"));
      assert.equal(current.length, 1, `${id}: one tab marked current`);
      assert.equal(
        current[0].getAttribute("data-scp-panel-id"),
        id,
        `${id}: and it is this one`,
      );

      // Every tab is an address, and each names a page that resolves. One panel
      // still: the strip navigates, it does not smuggle the other six sections
      // onto an address that promised one.
      for (const link of links) {
        assert.equal(
          link.getAttribute("href"),
          tabHref(link.getAttribute("data-scp-panel-id")),
          `${id}: the strip links to section addresses`,
        );
      }
      assert.equal(
        doc.querySelectorAll("[data-scp-panel]").length,
        1,
        `${id}: still exactly one panel`,
      );
    }
  });

  test("the strip on a section page is links, not tabs", async () => {
    // Six of the seven hrefs load a different page, so the bundle must decline
    // the takeover here — a tablist whose tabs navigate is a promise the roles
    // cannot keep. wireTabs() declines by finding fewer than two panels.
    const { doc, errors } = await hydrated(at(pages[0]));
    assert.deepEqual(errors, [], "the bundle ran without throwing");

    const list = doc.querySelector(".scp-nav-list");
    assert.equal(list.getAttribute("role"), null, "no tablist on a section page");
    for (const link of doc.querySelectorAll(".scp-nav-link")) {
      assert.equal(link.getAttribute("role"), null, "and no tab roles");
    }
  });

  /**
   * The whole point of the tab strip being addresses.
   *
   * Without JavaScript a tab is a link and loads the section page — which the
   * tests above cover. With it, the panel switches in place and the URL still
   * becomes the section's own, so what the reader is looking at and what the
   * address bar says cannot disagree. This asserts the things that have to move
   * together, and that Back moves them all back.
   */
  test("a tab click switches in place and takes the URL with it", async () => {
    const { window, doc, errors } = await hydrated(`/player/${fixture.slug}`);
    assert.deepEqual(errors, [], "the bundle ran without throwing");

    const heading = doc.querySelector("h1");
    const landed = heading.textContent.replace(/\s+/g, " ").trim();
    const first = sections[0];
    const target = sections.find((id) => id === "game-log") ?? sections[1];

    const tab = doc.querySelector(`.scp-nav-link[data-scp-panel-id="${target}"]`);
    assert.ok(tab, `the ${target} tab is there`);

    tab.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    assert.equal(
      window.location.pathname,
      at(target),
      "the address bar names the section",
    );
    assert.ok(
      doc.getElementById(target).classList.contains("is-active"),
      "the section's panel is the one showing",
    );
    assert.equal(
      doc.getElementById(first).classList.contains("is-active"),
      false,
      "and the one it replaced is not",
    );
    assert.equal(
      heading.textContent.replace(/\s+/g, " ").trim(),
      landed,
      "the H1 did not follow — the hero is the player on every tab",
    );

    // Nothing loaded: the other panels are still in the document, which is what
    // separates this from having navigated.
    assert.ok(
      doc.querySelectorAll("[data-scp-panel]").length > 1,
      "the whole profile is still here",
    );

    window.history.back();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(window.location.pathname, `/player/${fixture.slug}`);
    assert.equal(
      heading.textContent.replace(/\s+/g, " ").trim(),
      landed,
      "Back restores the heading",
    );
    assert.ok(doc.getElementById(first).classList.contains("is-active"));
  });

  test("a section that is not one of ours is a 404, not a copy of the profile", async () => {
    // Any path segment resolving to the profile is an unbounded supply of
    // indexable duplicates — a whole roster of them, multiplied out.
    for (const id of ["not-a-real-section", "Stats", "GAME-LOG", "stats.html"]) {
      const res = await get(`/player/${fixture.slug}/${id}/`);
      assert.equal(res.status, 404, `${id}`);
      // The right player and the wrong page: the way back is the profile they
      // nearly reached, not the top of the roster.
      assert.match(res.body, new RegExp(`href="/player/${fixture.slug}"`), id);
    }
    const unknown = await get("/player/not-a-real-person/stats/");
    assert.equal(unknown.status, 404, "unknown player");
  });

  test("the ?section= spelling redirects to the pretty address", async () => {
    // One address per page. The query form is what the plugin fetches the
    // fragment with; a reader or crawler holding it is sent to the real one.
    // The rest of the query rides along: ?format=half names a different set of
    // numbers, not a different page.
    for (const [path, target] of [
      [`/player/${fixture.slug}?section=stats`, at("stats")],
      [`/player/${fixture.slug}?section=game-log`, at("game-log")],
      [
        `/player/${fixture.slug}?section=game-log&format=standard`,
        `${at("game-log")}?format=standard`,
      ],
    ]) {
      const res = await get(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get("location"), target, path);
    }
  });

  /*
   * The profile opens on the Overview, so `/overview/` was the same page at a
   * second self-canonical address. The profile keeps it: `/overview/` is a
   * 301, and the old URL is indexed, so it must not become a 404.
   */
  test("the Overview's address is the profile's", async () => {
    for (const [path, target] of [
      [at("overview"), `/player/${fixture.slug}`],
      [`${at("overview")}?format=standard`, `/player/${fixture.slug}?format=standard`],
      [`/player/${fixture.slug}?section=overview`, `/player/${fixture.slug}`],
    ]) {
      const res = await get(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get("location"), target, path);
    }

    const { doc } = await dom(`/player/${fixture.slug}`);
    const tab = doc.querySelector('.scp-nav-link[data-scp-panel-id="overview"]');
    assert.equal(tab.getAttribute("href"), tabHref("overview"), "the tab links to the profile");
    assert.equal(
      tab.getAttribute("data-scp-heading"),
      `${fixture.name} Fantasy Football Stats & Analysis`,
      "and carries the profile's heading",
    );
  });

  test("a fragment asked for the Overview is the whole profile", async () => {
    // The plugin redirects /overview/ before it fetches, but a cached or stale
    // ?section=overview must not mint a one-panel copy of the profile.
    const res = await get(`/embed/player/${fixture.slug}?section=overview`);
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    assert.equal(doc.querySelector("[data-scp-root]").getAttribute("data-section"), null);
    assert.ok(doc.querySelectorAll("[data-scp-panel]").length > 1);
  });

  test("an unrecognised ?section= still falls through to the profile", async () => {
    // Defensive: a stale link is worth a full page, not a 404 — the pretty
    // route is where a bad section is refused.
    for (const query of ["?section=bogus", "?section=", ""]) {
      const { doc } = await dom(`/player/${fixture.slug}${query}`);
      assert.ok(
        doc.querySelectorAll(".scp-nav-link").length > 1,
        `${query || "(none)"}: the full profile`,
      );
      assert.equal(
        doc.querySelector("[data-scp-root]").getAttribute("data-section"),
        null,
      );
    }
  });

  test("the WordPress fragment still scopes with ?section=", async () => {
    // The plugin fetches it that way — see statchasers_player_fetch(). The
    // pretty address is for readers and crawlers; this one is an internal call.
    const scoped = await get(`/embed/player/${fixture.slug}?section=game-log`);
    assert.equal(scoped.status, 200);
    assert.match(scoped.body, /data-section="game-log"/);
    assert.match(scoped.body, /scp-nav-link/, "the scoped fragment carries the strip");
    assert.ok(!/<h1\b/i.test(scoped.body), "the fragment never carries an H1");
  });

  test("the strip in a fragment points at the public site, not this origin", async () => {
    // Same rule every other link in a fragment follows: on a WordPress mount
    // the sections live under /nfl/players/, and a tab pointing back here would
    // drop the reader onto the bare tool.
    const server = await startServer({
      SC_PLAYER_PATH_PREFIX: "/nfl/players/",
    });
    try {
      const res = await fetch(
        `${server.origin}/embed/player/${fixture.slug}?section=game-log`,
      );
      const body = await res.text();
      const doc = new JSDOM(body).window.document;
      const links = [...doc.querySelectorAll(".scp-nav-link")];
      assert.ok(links.length > 1, "the strip is in the fragment");
      for (const link of links) {
        assert.equal(
          link.getAttribute("href"),
          tabHref(link.getAttribute("data-scp-panel-id"), "/nfl/players/"),
          "a tab names the public section address",
        );
      }
    } finally {
      await server.stop();
    }
  });
});

/**
 * The index: /player, and the fragment /nfl/players/ mounts.
 *
 * The page is a list of six hundred names, so the only thing worth asserting
 * about it is the thing that makes it readable: the rank bands. Every row
 * carries the band its standing puts it in, the club header counts by the same
 * rule, and both survive a position filter — because the header and the list
 * disagreeing is the one failure a reader would believe rather than notice.
 */
/**
 * A state control changes the page, not the address.
 *
 * `?log=2024` is still a real URL: the server renders it, the season chips
 * still link to it, and with scripting off following one is how the selection
 * changes — the tests above cover that side. What these cover is the side a
 * reader sees. One player is one page with one address, and pressing a control
 * on the page they are already on must not leave them holding a different one.
 *
 * These used to be driven through the scoring toggle, which was the first and
 * loudest member of this family. The control bar trades it for the start/sit
 * button now (see renderStartSit), so the season chips — same wiring, same
 * pageUrl(), same swap — are what exercises it.
 */
describe("a state swap", () => {
  /** Wait for the swapped-in render, which is a real request to the server. */
  async function settled(read, want) {
    for (let i = 0; i < 100; i++) {
      if (read() === want) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  /** The game log's season chips, which a single-season player does not get. */
  function chips(doc) {
    return [...doc.querySelectorAll("#game-log .scp-season-opt")];
  }

  test("picking a season re-renders in place and leaves the URL alone", async () => {
    const landed = `/player/${fixture.slug}`;
    const { window, doc, errors } = await hydrated(landed);
    assert.deepEqual(errors, [], "the bundle ran without throwing");

    const pinned = () =>
      doc.querySelector("[data-scp-root]").getAttribute("data-archive-season") ?? "";
    assert.equal(pinned(), "", "the page arrives with nothing pinned");

    const year = chips(doc).find((chip) => chip.getAttribute("data-season") !== "all");
    if (!year) return; // a single-season player has no selector to press
    const want = year.getAttribute("data-season");

    year.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    assert.ok(await settled(pinned, want), `the page re-rendered on ${want}`);

    assert.equal(window.location.pathname, landed, "the address bar did not move");
    assert.equal(window.location.search, "", "and nothing was appended to it");

    const active = doc.querySelector("#game-log .scp-season-opt.is-active");
    assert.equal(
      active.getAttribute("data-season"),
      want,
      "the lit chip is the one the reader chose",
    );
    assert.ok(
      doc.querySelectorAll("[data-scp-panel]").length > 1,
      "and it is the whole profile that came back, not one section of it",
    );
  });

  test("clearing the pin is the bare slug again, not a cleaned-up query", async () => {
    const landed = `/player/${fixture.slug}`;
    const { window, doc } = await hydrated(landed);
    const pinned = () =>
      doc.querySelector("[data-scp-root]").getAttribute("data-archive-season") ?? "";

    const pick = (season) =>
      chips(doc).find((chip) => chip.getAttribute("data-season") === season);

    const year = chips(doc).find((chip) => chip.getAttribute("data-season") !== "all");
    if (!year) return;
    const want = year.getAttribute("data-season");

    year.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.ok(await settled(pinned, want), `${want} pinned`);

    // All is the resting state, so its chip is the bare address — the one the
    // reader is standing on. Following it must still swap rather than navigate.
    pick("all").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    assert.ok(await settled(pinned, ""), "the pin came off");
    assert.equal(window.location.pathname + window.location.search, landed);
  });

  test("the tab the reader is on survives the swap", async () => {
    const { window, doc } = await hydrated(`/player/${fixture.slug}`);
    const pinned = () =>
      doc.querySelector("[data-scp-root]").getAttribute("data-archive-season") ?? "";

    const click = (el) =>
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    click(doc.querySelector('.scp-nav-link[data-scp-panel-id="game-log"]'));
    assert.ok(doc.getElementById("game-log").classList.contains("is-active"));

    const year = chips(doc).find((chip) => chip.getAttribute("data-season") !== "all");
    if (!year) return;
    click(year);
    assert.ok(await settled(pinned, year.getAttribute("data-season")));

    assert.ok(
      doc.getElementById("game-log").classList.contains("is-active"),
      "the reader is still looking at the game log, on the season they picked",
    );
  });

  test("a modifier click is left to the browser", async () => {
    // Ctrl- or cmd-clicking one of these is how a reader deliberately opens
    // the other season in a new tab. Swallowing that would be taking a real
    // link away from them.
    const { window, doc } = await hydrated(`/player/${fixture.slug}`);
    const year = chips(doc).find((chip) => chip.getAttribute("data-season") !== "all");
    if (!year) return;

    const event = new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    year.dispatchEvent(event);

    assert.equal(event.defaultPrevented, false, "the navigation was not cancelled");
    assert.equal(
      doc.querySelector("[data-scp-root]").getAttribute("data-archive-season"),
      null,
      "and nothing was swapped underneath it",
    );
  });
});

describe("the player index", () => {
  test("it opens on the directory, with no hero of its own", async () => {
    // It used to carry one: a two-part H1 over a line of facts. Both mounts
    // now sit under the heading their host page supplies, which is what every
    // other fragment here already did. Asserted rather than merely untested,
    // because the markup is easy to put back by habit.
    const { doc } = await dom("/player");
    assert.equal(doc.querySelectorAll(".scp-hero").length, 0);
    assert.equal(doc.querySelectorAll("h1").length, 0);
    // The title tag still names the page — the heading went, not the page.
    assert.equal(doc.title, "NFL Player Pages | StatChasers");
    assert.ok(doc.querySelector("[data-scp-dir]"), "the directory still opens it");
  });

  test("the standalone page ships the bundle its controls need", async () => {
    // The search box and the position chips are both sent hidden for a client
    // to reveal. This page had no client: they were on screen — a `display` of
    // their own beats the `hidden` attribute — and wired to nothing.
    const { doc } = await dom("/player");
    const src = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    assert.ok(
      src.includes("/dist/statchasers-player.js"),
      "the index has to carry the same bundle a profile does",
    );
    assert.equal(
      doc.querySelector("[data-scp-dir-filters]").hasAttribute("hidden"),
      true,
      "the chips are still sent hidden for the client to reveal",
    );
  });

  test("every row is banded, and a row with nothing to show is idle", async () => {
    const { doc } = await dom("/player");
    const rows = [...doc.querySelectorAll(".scp-dir-item")];
    assert.ok(rows.length > 100, "expected a few hundred rows");

    const bands = new Set(["elite", "starter", "streaming", "depth", "poor", "idle"]);
    for (const row of rows) {
      assert.ok(bands.has(row.dataset.band), `unknown band ${row.dataset.band}`);
    }
    // The page is worth banding only if the bands are actually populated.
    for (const band of ["elite", "idle"]) {
      assert.ok(
        rows.some((row) => row.dataset.band === band),
        `no row landed in the ${band} band`,
      );
    }

    for (const row of rows) {
      const value = row.querySelector(".scp-dir-value");
      // A dash means no games; a 0.0 means games with nothing to show for
      // them. Both are noise on a page about production, and both drop to the
      // quietest band the card has.
      if (!value || Number.parseFloat(value.textContent) === 0) {
        assert.equal(row.dataset.band, "idle", row.textContent.trim());
      }
    }
  });

  test("a kicker is banded against the kickers, not against the receivers", async () => {
    // There are 32 kickers and one starts per club, so the scale is the
    // quarterback's and not the receivers' — which is cut for a pool 36 deep
    // and used to read the top twelve of THIRTY-TWO as elite, spend the rest
    // of itself on the top two thirds, and grade the worst kicker alive
    // "Flex". The bottom two bands were unreachable. This pins the cuts.
    const { doc } = await dom("/player");
    const scale = [
      [5, "elite"],
      [12, "starter"],
      [20, "streaming"],
      [32, "depth"],
      [Infinity, "poor"],
    ];

    const seen = new Set();
    for (const row of doc.querySelectorAll('.scp-dir-item[data-pos="K"]')) {
      const pill = row.querySelector(".scp-dir-rank");
      // No rank, or a rank with no points behind it, is the idle band — which
      // is about production, not about the pool, and is asserted above.
      if (!pill || row.dataset.band === "idle") continue;
      const rank = Number(pill.textContent.replace(/\D/g, ""));
      const expected = scale.find(([end]) => rank <= end)[1];
      assert.equal(row.dataset.band, expected, `K${rank}`);
      seen.add(expected);
    }

    assert.ok(seen.size >= 3, "the kickers should spread across the scale");
  });

  test("a club header counts scoring players by the rows' own rule", async () => {
    const { doc } = await dom("/player");
    for (const club of doc.querySelectorAll("[data-scp-club]")) {
      const rows = [...club.querySelectorAll(".scp-dir-item")];
      const scoring = rows.filter((row) => row.dataset.band !== "idle").length;
      const head = club.querySelector("[data-scp-club-scoring]");
      assert.equal(Number(head.textContent), scoring, club.dataset.team);
      assert.equal(
        Number(club.querySelector("[data-scp-club-count]").textContent),
        rows.length,
        club.dataset.team,
      );
    }
  });

  test("a position run opens with a rule, and the card's first row does not", async () => {
    const { doc } = await dom("/player");
    for (const list of doc.querySelectorAll("[data-scp-dir-list]")) {
      const rows = [...list.querySelectorAll(".scp-dir-item")];
      assert.equal(
        rows[0].hasAttribute("data-lead"),
        false,
        "a rule across the top of a list is a border, not a grouping",
      );
      for (let i = 1; i < rows.length; i += 1) {
        assert.equal(
          rows[i].hasAttribute("data-lead"),
          rows[i].dataset.pos !== rows[i - 1].dataset.pos,
          `${rows[i].textContent.trim()} is marked wrong`,
        );
      }
    }
  });

  test("a position chip refilters the rows, the counts and the rules", async () => {
    const { doc } = await hydrated("/player");
    assert.equal(
      doc.querySelector("[data-scp-dir-filters]").hidden,
      false,
      "the client reveals the chips",
    );

    const club = doc.querySelector('[data-scp-club][data-team="ARI"]');
    const rows = [...club.querySelectorAll(".scp-dir-item")];
    const qbs = rows.filter((row) => row.dataset.pos === "QB");
    assert.ok(qbs.length > 0, "the fixture club has quarterbacks");

    doc.querySelector('[data-scp-pos="QB"]').click();

    assert.deepEqual(
      rows.filter((row) => !row.hidden),
      qbs,
      "only the quarterbacks are left",
    );
    assert.equal(
      Number(club.querySelector("[data-scp-club-count]").textContent),
      qbs.length,
    );
    assert.equal(
      Number(club.querySelector("[data-scp-club-scoring]").textContent),
      qbs.filter((row) => row.dataset.band !== "idle").length,
      "the header recounts by the same rule it was built with",
    );
    // Filtered to one position there are no runs, so the first rule would be a
    // line under the header dividing nothing.
    assert.equal(
      doc.querySelectorAll("[data-scp-dir-list][data-grouped]").length,
      0,
    );

    doc.querySelector('[data-scp-pos="all"]').click();
    assert.equal(
      rows.filter((row) => row.hidden).length,
      0,
      "All puts everybody back",
    );
    assert.ok(
      doc.querySelectorAll("[data-scp-dir-list][data-grouped]").length > 0,
      "and the position rules with them",
    );
  });

  test("the toolbar ships the club pill hidden and empty", async () => {
    // Same contract as the chips and the box: the server sends the words, the
    // client fills in the club. Hidden rather than absent so the string lives
    // with the rest of the page's words instead of inside the bundle, and the
    // widget above it asks for the filtering mode that fills it.
    const { doc } = await dom("/player");
    const pill = doc.querySelector("[data-scp-dir-club]");
    assert.ok(pill, "the pill is in the served markup");
    assert.equal(pill.hasAttribute("hidden"), true, "no club is on yet");
    assert.equal(doc.querySelector("[data-scp-dir-club-name]").textContent, "");
    assert.ok(doc.querySelector("[data-scp-dir-club-clear]"), "and a way out of it");
    assert.equal(
      doc.querySelector("[data-scp-search]").hasAttribute("data-scp-club-filter"),
      true,
      "the box on this page filters rather than navigates",
    );
  });

  test("a club picked out of the box filters the list to that club", async () => {
    const { doc, window } = await hydrated("/player");

    const input = doc.querySelector(".scp-search-input");
    input.value = "chiefs";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    const hit = doc.querySelector('.scp-search-opt[data-kind="team"]');
    assert.equal(hit.dataset.club, "KC", "the Chiefs are the first club answer");
    hit.click();

    const cards = [...doc.querySelectorAll("[data-scp-club]")];
    assert.deepEqual(
      cards.filter((card) => !card.hidden).map((card) => card.dataset.team),
      ["KC"],
      "one club is on the page",
    );

    const kc = doc.querySelector('[data-scp-club][data-team="KC"]');
    const kcRows = [...kc.querySelectorAll(".scp-dir-item")];
    assert.equal(kcRows.filter((row) => row.hidden).length, 0, "all of them");
    assert.equal(
      Number(doc.querySelector("[data-scp-dir-count]").textContent),
      kcRows.length,
      "and the count line counts the club, not the league",
    );

    // The pill names the club, off the card's own heading.
    const pill = doc.querySelector("[data-scp-dir-club]");
    assert.equal(pill.hidden, false);
    assert.equal(
      doc.querySelector("[data-scp-dir-club-name]").textContent,
      "Kansas City Chiefs",
    );
    // And the grid knows it is showing one card, which is what stops auto-fill
    // leaving it in the first of four tracks.
    assert.equal(doc.querySelector("[data-scp-dir]").dataset.club, "KC");

    // The box has answered and emptied itself rather than offering the filter
    // the reader already has.
    assert.equal(input.value, "");
    assert.equal(doc.querySelector(".scp-search-panel").hidden, true);

    // The chip counts are the club's now. League-wide numbers over one club's
    // card are the lie the server avoided by counting what it actually had.
    const chip = (pos) => doc.querySelector(`[data-scp-pos="${pos}"]`);
    const chipN = (pos) => Number(chip(pos).querySelector(".scp-dir-chip-n").textContent);
    assert.equal(chipN("all"), kcRows.length);
    assert.equal(
      chipN("QB"),
      kcRows.filter((row) => row.dataset.pos === "QB").length,
    );

    // Both filters compose: the club stays, the position narrows it.
    chip("QB").click();
    assert.deepEqual(
      kcRows.filter((row) => !row.hidden).map((row) => row.dataset.pos),
      kcRows.filter((row) => row.dataset.pos === "QB").map((row) => row.dataset.pos),
      "the club's quarterbacks, and nobody else's",
    );
    assert.deepEqual(
      cards.filter((card) => !card.hidden).map((card) => card.dataset.team),
      ["KC"],
      "and still one club",
    );

    // Clearing gives the league back, including the counts.
    doc.querySelector("[data-scp-dir-club-clear]").click();
    assert.equal(pill.hidden, true);
    assert.equal(doc.querySelector("[data-scp-dir]").dataset.club, undefined);
    assert.ok(
      cards.filter((card) => !card.hidden).length > 20,
      "every club is back",
    );
    assert.equal(
      chipN("all"),
      doc.querySelectorAll(".scp-dir-item").length,
      "and the chips count the league again",
    );
    assert.equal(
      doc.activeElement,
      input,
      "focus goes to the box the next club would be typed in",
    );
  });

  test("a position the club has nobody at loses its chip", async () => {
    const { doc, window } = await hydrated("/player");

    // Driven off the data rather than a hard-coded pair: which clubs carry a
    // kicker or a fullback on this roster changes week to week.
    const positions = [...doc.querySelectorAll("[data-scp-pos]")]
      .map((c) => c.dataset.scpPos)
      .filter((pos) => pos !== "all");
    let found = null;
    for (const card of doc.querySelectorAll("[data-scp-club]")) {
      const has = new Set(
        [...card.querySelectorAll(".scp-dir-item")].map((row) => row.dataset.pos),
      );
      const missing = positions.find((pos) => !has.has(pos));
      if (missing) {
        found = { code: card.dataset.team, missing };
        break;
      }
    }
    if (!found) return;

    // Chosen league-wide first, so this also pins the other half of the rule:
    // a club that cannot answer the reader's position resets it rather than
    // handing them a filtered page with nothing on it.
    doc.querySelector(`[data-scp-pos="${found.missing}"]`).click();

    const input = doc.querySelector(".scp-search-input");
    input.value = found.code;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const hit = doc.querySelector(`.scp-search-opt[data-club="${found.code}"]`);
    assert.ok(hit, `${found.code} answers to its own code`);
    hit.click();

    assert.equal(
      doc.querySelector(`[data-scp-pos="${found.missing}"]`).hidden,
      true,
      "a chip with nothing behind it is off the row",
    );
    assert.equal(
      doc.querySelector('[data-scp-pos="all"]').getAttribute("aria-pressed"),
      "true",
      "and the position the club cannot answer is not still on",
    );
    const card = doc.querySelector(`[data-scp-club][data-team="${found.code}"]`);
    assert.equal(card.hidden, false, "the club the reader asked for is showing");
    assert.ok(
      [...card.querySelectorAll(".scp-dir-item")].some((row) => !row.hidden),
      "with players on it",
    );
  });
});

/**
 * A profile whose address changed still answers at the old one.
 *
 * Slugs move. Two players share a name and the claim on the bare form changes
 * hands — the Kansas City running back publishes at `kenneth-walker` now, and
 * did not before — or a source corrects a spelling. The page is the same page,
 * so the old URL owes a 301 rather than a 404: it is indexed under that
 * address and the links to it are in other people's posts.
 *
 * Driven off `previousSlugs` in /embed/players.json rather than a hard-coded
 * pair, for the same reason the fixture above is picked at runtime. When no
 * slug has ever moved there is nothing to assert and the block skips.
 */
describe("a slug that has moved", () => {
  let moved;

  before(() => {
    moved = roster.find((player) => (player.previousSlugs ?? []).length > 0);
  });

  test("the old profile address is a 301 to the new one", async (t) => {
    if (!moved) return t.skip("no slug in this roster has moved");

    const res = await rawGet(`/player/${moved.previousSlugs[0]}`);
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, `/player/${moved.slug}`);
  });

  test("a section address moves with it, in one hop", async (t) => {
    if (!moved) return t.skip("no slug in this roster has moved");

    const res = await rawGet(`/player/${moved.previousSlugs[0]}/injury`);
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, `/player/${moved.slug}/injury/`);
  });

  test("the reader's query survives the move", async (t) => {
    if (!moved) return t.skip("no slug in this roster has moved");

    // ?section= is the internal spelling and becomes a path segment; ?format=
    // names a set of numbers and has to arrive intact. Both in one redirect,
    // because two 301s for one click is a round trip nobody needs.
    const res = await rawGet(
      `/player/${moved.previousSlugs[0]}?section=stats&format=half`,
    );
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, `/player/${moved.slug}/stats/?format=half`);
  });

  test("the new address renders, and an unknown one still 404s", async (t) => {
    if (!moved) return t.skip("no slug in this roster has moved");

    assert.equal((await rawGet(`/player/${moved.slug}`)).status, 200);
    assert.equal((await rawGet("/player/nobody-by-that-name")).status, 404);
  });

  test("the embed resolves the old slug rather than redirecting it", async (t) => {
    if (!moved) return t.skip("no slug in this roster has moved");

    // Nobody types this address and nothing indexes it — it is the fetch a
    // WordPress page makes for its own body — so a 301 would only cost that
    // page a round trip.
    const res = await rawGet(`/embed/player/${moved.previousSlugs[0]}`);
    assert.equal(res.status, 200);
  });
});
