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
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

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
      const id = link.getAttribute("href").replace(/^#/, "");
      const panel = doc.getElementById(id);
      assert.ok(panel, `nav points at #${id}, which must exist`);
      assert.ok(panel.textContent.trim().length > 0, `#${id} must not be empty`);
    }
    // And the converse: every panel is reachable.
    for (const panel of doc.querySelectorAll("[data-scp-panel]")) {
      assert.ok(
        links.some((l) => l.getAttribute("href") === `#${panel.id}`),
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

    // Every percentile bar has the percentile printed beside it: the bar is a
    // second reading of the number, never the only one.
    for (const bar of doc.querySelectorAll(".scp-meter-bar")) {
      const row = bar.closest(".scp-meter");
      assert.ok(
        row.querySelector(".scp-meter-value").textContent.trim().length > 0,
        "a meter must print its value",
      );
    }

    // The stacked bar labels every tier in its legend, so identity never rests
    // on colour alone.
    const stack = doc.querySelector(".scp-stack");
    if (stack) {
      const segments = stack.querySelectorAll(".scp-stack-seg").length;
      const legend = stack.querySelectorAll(".scp-legend-item").length;
      assert.equal(segments, legend, "every segment has a legend entry");
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

  test("the injury tab points at the current report when there is one", async () => {
    // The two are deliberately separate — current designation in News, career
    // record in Injury & Health — so the cross-link is what stops the tab
    // named for the question from failing to answer it.
    let checked = 0;
    for (const player of roster.slice(0, 40)) {
      const res = await get(`/player/${player.slug}`);
      if (res.status !== 200) continue;
      const doc = new JSDOM(res.body).window.document;
      const report = doc.querySelector(".scp-report");
      const injury = doc.querySelector("#injury");
      if (!report || !injury) continue;
      checked += 1;

      const link = injury.querySelector(".scp-crosslink");
      assert.ok(link, "a designated player's injury tab links to the report");
      assert.equal(link.getAttribute("href"), "#news");
      assert.ok(
        doc.getElementById("news"),
        "and the anchor it points at is on the page",
      );
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

describe("the embedded fragment", () => {
  test("serves markup with no document around it", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    assert.equal(res.status, 200);
    assert.ok(!/<html/i.test(res.body), "fragment must not be a full document");
    assert.ok(!/<link\b/i.test(res.body), "fragment must not carry a stylesheet");
    assert.ok(!/<script\b/i.test(res.body), "fragment must not carry a bundle");
    assert.ok(res.body.includes("data-scp-root"));
  });

  test("no second H1 inside a host page that already has one", async () => {
    const res = await get(`/embed/player/${fixture.slug}`);
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    assert.equal(doc.querySelectorAll("h1").length, 0, "the host page owns the H1");
    assert.ok(doc.querySelector("h2"), "the name steps down to an H2");
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
