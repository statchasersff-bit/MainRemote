/**
 * Team hub regression tests.
 *
 * Same posture as seo.test.mjs: fetch the served HTML and assert on it WITHOUT
 * executing any JavaScript, because the whole point of these pages is that they
 * arrive complete. If someone moves a section behind a client fetch, drops the
 * canonical, or lets a team page render a second <h1> inside a WordPress page,
 * these fail.
 *
 * Offline. Schedule, record and season statistics come from ESPN and the NFL
 * state from Sleeper, and every server here is pointed at a local replay of
 * those responses as recorded on 2026-09-30 (helpers/upstream-replay.mjs). It
 * used to call them live and pass when they were down, which left three
 * sections untested whenever they were. The assertions stay tolerant of an
 * absent section anyway, because the page must omit what it cannot load
 * rather than render placeholders, and a team not in the recording is
 * exactly that case.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

/**
 * A GET with exactly the headers given.
 *
 * Not fetch(): undici attaches its own cache directives, which is enough to
 * stop a conditional request ever revalidating. seo.test.mjs carries the same
 * helper for the same reason.
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
/**
 * A player slug that resolves right now.
 *
 * Read from the manifest rather than pinned, because a pinned name is one that
 * retires or is traded out of the indexed list, and the resulting failure looks
 * like a bug in the routes rather than in the fixture.
 */
let playerSlug;
let replay;

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
  const roster = await (await fetch(`${server.origin}/embed/players.json`)).json();
  playerSlug = roster.players[0]?.slug ?? "";
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
  await replay?.stop();
});

async function get(pathname, options = {}) {
  const res = await fetch(`${server.origin}${pathname}`, {
    redirect: "manual",
    ...options,
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/** The compiled team bundle, read once. */
let teamBundle;
const windows = [];

/**
 * The page with its own JavaScript actually run.
 *
 * Everything else in this file asserts on the HTML as sent, which is what a
 * crawler reads. The tab strip is the one place where the scripted behavior is
 * different in kind rather than in polish - it switches the panel, rewrites the
 * heading above the fragment and puts a different URL in the address bar - and
 * none of that is visible in the served markup.
 */
async function hydrated(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);

  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));

  teamBundle ??= fs.readFileSync(
    path.join(APP_DIR, "public", "dist", "statchasers-team.js"),
    "utf8",
  );

  const jsdom = new JSDOM(await res.text(), {
    runScripts: "outside-only",
    url: `${server.origin}${pathname}`,
    pretendToBeVisual: true,
    virtualConsole,
  });
  windows.push(jsdom.window);
  jsdom.window.eval(teamBundle);
  await new Promise((r) => setTimeout(r, 50));
  return { window: jsdom.window, doc: jsdom.window.document, errors };
}

async function dom(pathname) {
  const res = await get(pathname);
  assert.equal(res.status, 200, `${pathname} should be 200`);
  return { ...res, doc: new JSDOM(res.body).window.document };
}

/**
 * A tab's questions live in its tail, which renders after the tools block - NOT
 * inside the panel. Scoping to "#outlook" finds nothing.
 */
const tailOf = (id) => `[data-sct-faq-for="${id}"]`;

/** Every question/answer pair on the page, or inside one scope. */
/**
 * The page's questions and answers as the FAQPage must carry them. An answer
 * is every `.sct-faq-a` part of the item (the Draft and Contracts FAQs have
 * several since 2026-11-02): paragraphs joined by a blank line, a list as
 * "- " lines - the same join faq-block.ts makes.
 */
function faqEntries(doc, scope = "") {
  const prefix = scope ? `${scope} ` : "";
  const part = (el) =>
    el.tagName === "UL"
      ? [...el.querySelectorAll("li")].map((li) => `- ${li.textContent.trim()}`).join("\n")
      : el.textContent.trim();
  return [...doc.querySelectorAll(`${prefix}.sct-faq-item`)].map((item) => ({
    question: item.querySelector(".sct-faq-q")?.textContent?.trim() ?? "",
    answer: [...item.querySelectorAll(".sct-faq-a")].map(part).join("\n\n"),
  }));
}


describe("team routes", () => {
  test("the canonical slug serves the hub", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1, "exactly one H1 on the standalone page");
    assert.match(h1[0].textContent, /New England Patriots/);
    assert.ok(doc.querySelector("[data-sct-root]"), "root element present");
    assert.equal(
      doc.querySelector("[data-sct-root]").getAttribute("data-team"),
      "ne",
    );
  });

  test("every one of the 32 teams resolves", async () => {
    // The point of a configuration-driven page: no team may be special-cased,
    // and none may be missing. Cheap because the providers are cached across
    // these requests.
    const { doc } = await dom("/team");
    const links = [...doc.querySelectorAll('a[href^="/team/"]')].map((a) =>
      a.getAttribute("href"),
    );
    const slugs = [...new Set(links)];
    assert.equal(slugs.length, 32, "index lists all 32 teams");

    for (const slug of slugs) {
      const res = await get(slug);
      assert.equal(res.status, 200, `${slug} should render`);
    }
  });

  test("an abbreviation or nickname redirects to the canonical URL", async () => {
    for (const [input, expected] of [
      ["/team/NE", "/team/new-england-patriots"],
      ["/team/patriots", "/team/new-england-patriots"],
      // Relocated franchises: a saved link or a shortcode written years ago
      // should still land somewhere real.
      ["/team/oakland", "/team/las-vegas-raiders"],
      ["/team/WSH", "/team/washington-commanders"],
    ]) {
      const res = await get(input);
      assert.equal(res.status, 301, `${input} should redirect`);
      assert.equal(res.headers.get("location"), expected);
    }
  });

  test("an unknown team is a 404, not a redirect to an arbitrary one", async () => {
    const res = await get("/team/not-a-real-team");
    assert.equal(res.status, 404);
    assert.match(res.body, /Team not found/);
  });

  test("the news tool is untouched", async () => {
    // The team pages are additive. "/" is still the news tool and still 404s
    // everything it used to.
    const root = await get("/");
    assert.equal(root.status, 200);
    assert.match(root.body, /statchasers-news/);
    assert.equal((await get("/nonsense")).status, 404);
  });

  test("the standing breaks ties instead of sharing a place", async () => {
    // Recorded 2026-10-03: the Jets and Patriots are both 1-2, and ESPN's team
    // document calls them both "2nd in AFC East". The tiebreakers put the Jets
    // ahead.
    const ne = await get("/team/new-england-patriots");
    assert.match(ne.body, /3rd in AFC East/);
    assert.doesNotMatch(ne.body, /2nd in AFC East/);
  });
});

describe("crawlable HTML (no JavaScript executed)", () => {
  test("the page ships its content, not a shell", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    // Section navigation is real anchors to real ADDRESSES - the section
    // pages - each naming the panel it switches to without a load.
    const navLinks = [...doc.querySelectorAll(".sct-nav-link")];
    assert.ok(navLinks.length >= 2, "section nav rendered");
    for (const link of navLinks) {
      const id = link.getAttribute("data-sct-panel-id");
      // The hub prints the panels that are its own - the Outlook, the hub-only
      // tabs and the schedule preview. A section with an address of its own
      // (Usage, Stats, News, Depth Chart) is printed ONLY there, so its tab
      // names no panel in this document: it is a link to that address, and
      // the hub's HTML does not carry a second copy of that page's content
      // (see ownsAddress in team-render.ts).
      const hubPanel = ["outlook", "coaching", "draft", "contracts", "schedule"].includes(id);
      assert.equal(
        Boolean(doc.getElementById(id)),
        hubPanel,
        hubPanel ? `nav names a real panel: ${id}` : `${id} is not printed on the hub`,
      );
      assert.equal(
        link.getAttribute("href"),
        // The Outlook is the hub, so its tab links to the hub. Coaching is
        // hub-only - its public URL waits on approval - so its tab is the
        // hub's address plus the panel hash (see team-render.ts).
        // The Schedule is a preview on the hub (mak, 2026-11-03), so its
        // tab is a hash tab here and the panel's own link leads to the page.
        id === "outlook"
          ? "/team/new-england-patriots/"
          : id === "coaching" || id === "draft" || id === "contracts" || id === "schedule"
            ? `/team/new-england-patriots/#${id}`
            : `/team/new-england-patriots/${id}/`,
        `${id}: the tab links to the section's own URL`,
      );
      // What the H1 above the fragment becomes when this tab is chosen. The
      // heading lives outside the fragment, so the bundle cannot derive it.
      assert.ok(
        (link.getAttribute("data-sct-heading") ?? "").includes("New England Patriots"),
        `${id}: carries the heading its URL loads with`,
      );
      assert.ok(
        (link.getAttribute("data-sct-lead") ?? "").length > 40,
        `${id}: carries the standfirst too`,
      );
    }
    // The team switcher is 32 crawlable internal links, not a scripted menu.
    const switcher = doc.querySelectorAll(".sct-switch-team");
    assert.equal(switcher.length, 32, "switcher links every team");
    for (const link of switcher) {
      assert.match(link.getAttribute("href"), /^\/team\/[a-z0-9-]+/);
    }
  });

  test("head metadata is server-rendered and self-referencing", async () => {
    const { doc, headers } = await dom("/team/new-england-patriots");
    const canonical = doc.querySelector('link[rel="canonical"]');
    assert.ok(canonical, "canonical present in the HTML");
    assert.match(canonical.getAttribute("href"), /\/team\/new-england-patriots$/);
    assert.match(doc.title, /New England Patriots/);
    assert.ok(doc.querySelector('meta[name="description"]').content.length > 50);
    // Out of the index on this origin, still usable when embedded - the same
    // posture as the news tool.
    assert.match(headers.get("x-robots-tag"), /noindex, indexifembedded/);
  });

  test("the canonical ignores tool state in the query string", async () => {
    const embedded = await dom("/team/new-england-patriots?embed=1");
    const canonical = embedded.doc
      .querySelector('link[rel="canonical"]')
      .getAttribute("href");
    assert.ok(
      !canonical.includes("?"),
      "query string must never produce a second canonical",
    );
  });

  test("images carry dimensions and a deliberate loading strategy", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const images = [...doc.querySelectorAll("img")];
    assert.ok(images.length > 0);
    for (const img of images) {
      assert.ok(img.getAttribute("width"), `${img.src} needs a width`);
      assert.ok(img.getAttribute("height"), `${img.src} needs a height`);
    }
    // Exactly one eager, high-priority image: the hero crest, which is the LCP
    // candidate. Marking more would dilute the signal.
    const priority = images.filter(
      (img) => img.getAttribute("fetchpriority") === "high",
    );
    assert.equal(priority.length, 1);
    assert.ok(priority[0].classList.contains("sct-hero-logo"));
    for (const img of images) {
      if (img === priority[0]) continue;
      assert.equal(
        img.getAttribute("loading"),
        "lazy",
        `${img.src} should be lazy`,
      );
    }
  });
});

describe("embedded mode", () => {
  test("no second H1 inside a host page that already has one", async () => {
    const { doc } = await dom("/team/new-england-patriots?embed=1");
    assert.equal(
      doc.querySelectorAll("h1").length,
      0,
      "the WordPress page supplies the H1",
    );
    // The team name is still the visual heading, just demoted.
    assert.match(doc.querySelector(".sct-title").textContent, /Patriots/);
    assert.equal(doc.querySelector(".sct-title").tagName, "H2");
  });

  test("the shell drops its own background and gutter", async () => {
    const { doc } = await dom("/team/new-england-patriots?embed=1");
    assert.ok(doc.body.classList.contains("is-embed"));
    assert.ok(doc.querySelector(".sct").classList.contains("is-embed"));
  });

  test("the fragment endpoint serves markup with no document around it", async () => {
    const res = await get("/embed/team/ne");
    assert.equal(res.status, 200);
    assert.ok(!/<html/i.test(res.body), "fragment must not be a full document");
    assert.match(res.body, /data-sct-root/);
    assert.match(res.body, /sct is-embed/);
    // Accepts a slug as well as an abbreviation, because the shortcode does.
    const bySlug = await get("/embed/team/new-england-patriots");
    assert.equal(bySlug.status, 200);
    assert.equal(bySlug.body, res.body);
  });

  test("player names link to the site's own slug, not one derived from the name", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const links = [...doc.querySelectorAll("a.sct-player-link")];
    assert.ok(links.length > 0, "player names are linked");

    const byName = new Map(
      links.map((a) => [a.textContent.trim(), a.getAttribute("href")]),
    );
    // The whole reason this goes through the player dictionary rather than
    // slugify(): the site spells him "aj-brown", and deriving the slug from
    // the name gives "a-j-brown" and a 404.
    const brown = byName.get("A.J. Brown");
    assert.ok(brown, "A.J. Brown is on the Patriots page and linked");
    // The profile itself - not the retired /nfl/players/outlook/<slug>/
    // layout, whose stale pages these links kept alive.
    assert.match(brown, /\/nfl\/players\/aj-brown\/$/);

    for (const href of byName.values()) {
      assert.match(href, /^https?:\/\//, "absolute, for the WordPress mount");
      // A slug the dictionary supplied, never a name pushed through a slugifier
      // - the giveaway is the single letters a dotted initial leaves behind.
      const slug = href.split("/nfl/players/")[1]?.replace(/\/$/, "") ?? "";
      assert.ok(slug, `no slug in ${href}`);
      assert.ok(
        !/(^|-)[a-z](-|$)/.test(slug),
        `${slug} looks slugified from the name, not looked up`,
      );
    }
  });

  test("a player the site publishes no profile for stays plain text", async () => {
    // The rule the empty template used to enforce wholesale, now enforced per
    // name: the dictionary indexes ~600 players and carries ~4,000, so a name
    // it does not index gets no link rather than a link to a page that is not
    // there.
    // The injury list is the News tab's rail, which prints at /news/ now.
    const { doc } = await dom("/team/new-england-patriots/news/");
    const unlinked = [...doc.querySelectorAll("span.sct-injury-name")];
    const linked = [...doc.querySelectorAll("a.sct-injury-name")];
    assert.ok(
      unlinked.length + linked.length > 0,
      "this test needs an injury list to be meaningful",
    );
    for (const span of unlinked) {
      assert.equal(span.tagName, "SPAN");
      assert.equal(span.querySelector("a"), null, "no link inside either");
    }
  });

  test("the Schedule tab indexes every pair page this team is half of", async () => {
    // 294 of the 496 pair pages had no inbound link (Rank Math crawl,
    // 2026-10-08): the schedule rows only reach this season's opponents, and
    // a finished meeting's row moves on to the game's dated page. The index
    // under the board names all 31 opponents, so every pair is reached from
    // both of its hubs whether or not the clubs meet this year.
    const { doc } = await dom("/team/new-england-patriots/schedule/");
    const links = [...doc.querySelectorAll("#schedule .sct-series a.sct-series-link")];
    assert.equal(links.length, 31, "one link per opponent");
    const hrefs = links.map((a) => a.getAttribute("href"));
    assert.equal(new Set(hrefs).size, 31, "every link opens a different pair page");
    for (const href of hrefs) {
      assert.match(href, /^\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\/$/);
      assert.ok(href.includes("new-england-patriots"), `${href} is one of this team's pairs`);
      assert.notEqual(href, "/nfl/new-england-patriots-vs-new-england-patriots/");
    }
    // The anchor text carries both clubs even though only the opponent shows.
    assert.match(links[0].textContent, /^Patriots vs \S/);
    // Eight division groups, the Patriots' own with three teams in it.
    const groups = [...doc.querySelectorAll("#schedule .sct-series-group")];
    assert.equal(groups.length, 8);
    const east = groups.find((g) => g.querySelector(".sct-series-div").textContent === "AFC East");
    assert.equal(east.querySelectorAll("a").length, 3);
  });

  test("the Schedule page links every game to its pair page, so Matchups need not", async () => {
    const { doc } = await dom("/team/new-england-patriots/schedule/");
    // The Matchups tab was the same fixture list a second time. It came off the
    // strip on the condition that Schedule carries the links it existed for, so
    // that is what this asserts: every row that names a resolvable opponent
    // offers the pair page, and the upcoming cards do too.
    const rows = [...doc.querySelectorAll("#schedule .sct-srow:not(.is-bye)")];
    assert.ok(rows.length > 0, "the schedule rendered rows");
    for (const row of rows) {
      const cell = row.querySelector(".sct-srow-view");
      assert.ok(cell, "every row carries the cell, so the grid keeps its shape");
      // An opponent with no canonical pair leaves the cell empty rather than
      // dropping it; anything else is a link.
      if (cell.tagName === "A") {
        assert.match(cell.getAttribute("href"), /\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\//);
        // "View recap" once the game is final (mak, 2026-10-22), "View
        // matchup" ahead of it.
        const played = !!row.querySelector(".sct-result");
        assert.equal(
          cell.textContent.trim().startsWith(played ? "View recap" : "View matchup"),
          true,
          `row ${row.textContent.trim().slice(0, 30)}: ${cell.textContent.trim()}`,
        );
      }
    }
    const linked = rows.filter((r) => r.querySelector("a.sct-srow-view"));
    assert.ok(linked.length > 0, "at least some rows link to a pair page");

    // The hub's preview cards offer the same links.
    const hub = await dom("/team/new-england-patriots");
    const cards = [...hub.doc.querySelectorAll("#schedule .sct-game")];
    assert.ok(cards.length > 0, "the preview cards rendered");
    for (const card of cards) {
      const cta = card.querySelector(".sct-game-cta a");
      assert.ok(cta, "a preview card offers its matchup or recap");
      assert.match(cta.getAttribute("href"), /\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\//);
    }
  });

  test("the season shape rail only ever counts the rows beside it", async () => {
    const { doc } = await dom("/team/new-england-patriots/schedule/");
    const rows = [...doc.querySelectorAll("#schedule .sct-srow:not(.is-bye)")];
    const shape = doc.querySelector("#schedule .sct-shape");
    if (rows.length === 0) {
      assert.equal(shape, null, "no fixtures, nothing to draw a shape from");
      return;
    }
    assert.ok(shape, "the schedule rendered rows, so the rail rendered");

    // Every figure in the rail is arithmetic on the table beside it - that is
    // the whole claim the cards make, and the one a future change to either
    // side could break silently.
    const figures = new Map(
      [...shape.querySelectorAll(".sct-snap-cell")].map((cell) => [
        cell.querySelector(".sct-snap-label").textContent.trim(),
        cell.querySelector(".sct-snap-value").textContent.trim(),
      ]),
    );
    const home = rows.filter((row) =>
      row.querySelector('.sct-srow-ha[data-kind="home"]'),
    ).length;
    const neutral = rows.filter((row) =>
      row.querySelector('.sct-srow-ha[data-kind="neutral"]'),
    ).length;

    assert.equal(figures.get("Games"), String(rows.length));
    assert.equal(figures.get("Home"), String(home));
    assert.equal(figures.get("Away"), String(rows.length - home - neutral));
    assert.equal(figures.get("Neutral") ?? "0", String(neutral));

    // The strip is the same season again: one cell per home and away row, and
    // a bye cell only where the table gave the bye a row of its own.
    const kinds = [...shape.querySelectorAll(".sct-path-week")].map((cell) =>
      cell.getAttribute("data-kind"),
    );
    const byeRow = doc.querySelector("#schedule .sct-srow.is-bye");
    assert.equal(kinds.filter((kind) => kind === "home").length, home);
    assert.equal(
      kinds.filter((kind) => kind === "away").length,
      rows.length - home - neutral,
    );
    assert.equal(kinds.filter((kind) => kind === "neutral").length, neutral);
    assert.equal(kinds.filter((kind) => kind === "bye").length, byeRow ? 1 : 0);
    assert.equal(
      figures.get("Bye week"),
      byeRow
        ? byeRow.querySelector(".sct-srow-week").textContent.trim()
        : "TBD",
    );

    // The rows carry no DIV pill any more - the slate card IS where the table
    // says which games are divisional, so what is checkable is that it agrees
    // with the table about them: every meeting it lists is a week the table
    // prints, the Division figure is that many, and the home/away split adds
    // back up to it.
    const weeks = new Set(
      rows.map((row) => row.querySelector(".sct-srow-week").textContent.trim()),
    );
    const slate = [...shape.querySelectorAll(".sct-slate-row")];
    assert.equal(figures.get("Division"), String(slate.length));
    for (const game of slate) {
      const week = game.querySelector(".sct-slate-week").textContent.trim();
      assert.ok(week, "a slate row names its week");
      assert.ok(
        weeks.has(week),
        `the slate puts a division game in ${week}, which the table does not`,
      );
    }
    if (slate.length) {
      const caption = shape
        .querySelector('[data-kind="slate"] .sct-mix-caption')
        .textContent.trim();
      const [slateHome, slateAway] = caption
        .match(/(\d+) home · (\d+) away/)
        .slice(1)
        .map(Number);
      assert.equal(slateHome + slateAway, slate.length);
    }

    // Every opponent is filed under exactly one division and one conference,
    // so both tallies have to come back to the number of games played.
    const sum = (selector) =>
      [...shape.querySelectorAll(selector)].reduce(
        (total, node) => total + Number(node.textContent.trim()),
        0,
      );
    const unresolved = rows.filter(
      (row) => !row.querySelector(".sct-srow-logo"),
    ).length;
    // Scoped to the opponent card. The snapshot card draws its home/road split
    // on the same bars, and an unscoped sum counts the season twice.
    assert.equal(
      sum('[data-kind="opponents"] .sct-shape-bar-value'),
      rows.length - unresolved,
    );
    assert.equal(sum(".sct-shape-conf-cell dd"), rows.length - unresolved);

    // And the split bars are the two figures above them drawn, not a third
    // count of the same season.
    assert.deepEqual(
      [...shape.querySelectorAll(".sct-snap-bars .sct-shape-bar")].map(
        (bar) => [
          bar.querySelector(".sct-shape-bar-label").textContent.trim(),
          bar.querySelector(".sct-shape-bar-value").textContent.trim(),
        ],
      ),
      [
        ["Home", figures.get("Home")],
        ["Away", figures.get("Away")],
        // A third bar only for a club with a neutral-site game (Munich,
        // London, ...), drawn from the same figure.
        ...(figures.has("Neutral") ? [["Neutral", figures.get("Neutral")]] : []),
      ],
    );
  });

  test("the schedule FAQ answers from the rows above it", async () => {
    const { doc } = await dom("/team/new-england-patriots/schedule/");
    const entries = faqEntries(doc, tailOf("schedule"));
    assert.ok(entries.length >= 5, `expected a schedule FAQ, got ${entries.length}`);

    for (const entry of entries) {
      assert.match(entry.question, /\?$/, `not a question: ${entry.question}`);
      assert.match(entry.answer, /[.!?]$/, `unpunctuated: ${entry.answer}`);
    }

    // Every week an answer names is a week the table prints. That is the whole
    // point of deriving these from the fixtures rather than writing them: an
    // answer cannot put a game in a week the schedule above does not. The bye
    // row counts - it is a week in the table with no fixture against it.
    const weeks = new Set(
      [...doc.querySelectorAll("#schedule .sct-srow-week")].map((n) =>
        n.textContent.trim().replace(/^W/, ""),
      ),
    );
    assert.ok(weeks.size > 0, "the schedule rendered weeks to check against");
    for (const entry of entries) {
      for (const [, week] of entry.answer.matchAll(/Week (\d+)/g)) {
        assert.ok(
          weeks.has(week),
          `an answer names Week ${week}, which the table does not: ${entry.answer}`,
        );
      }
    }

    // The bye is the answer most likely to be quoted at a fantasy deadline, so
    // it has to be the week the table gives it, not a week ESPN's gaps implied.
    const byeRow = doc.querySelector("#schedule .sct-srow.is-bye .sct-srow-week");
    if (byeRow) {
      const week = byeRow.textContent.trim().replace(/^W/, "");
      const bye = entries.find((e) => /bye week/i.test(e.question));
      assert.ok(bye, "the table shows a bye but the FAQ does not answer for it");
      assert.ok(
        bye.answer.includes(`Week ${week}`),
        `the bye answer disagrees with the table's Week ${week}: ${bye.answer}`,
      );
    }

    // "Next" is the next UNPLAYED game - see the note at the top of
    // lib/team/schedule-faq.ts. Once the season is over the cards fall back to
    // its tail and the question is not asked at all, which is why this pairs
    // the card with the answer rather than asserting the answer exists.
    const card = doc.querySelector('#schedule .sct-ng-cell[data-kind="next"]');
    const next = entries.find((e) => /play next\?$/.test(e.question));
    if (card && next) {
      const week = card.querySelector(".sct-ng-week").textContent.trim();
      assert.ok(
        next.answer.includes(week),
        `the next-game answer is not about ${week}: ${next.answer}`,
      );
      const opponent = [...card.querySelectorAll(".sct-ng-team")]
        .map((n) => n.textContent.trim())
        .find((name) => name !== "New England Patriots");
      assert.ok(
        next.answer.includes(opponent),
        `the next-game answer names a different opponent than the module (${opponent}): ${next.answer}`,
      );
    }
  });

  test("Matchups is off the tab strip but keeps its own URL", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const labels = [...doc.querySelectorAll(".sct-nav-link")].map((a) =>
      a.textContent.trim(),
    );
    assert.ok(labels.length > 0, "the tab strip rendered");
    assert.ok(!labels.includes("Matchups"), `Matchups still a tab: ${labels}`);
    assert.equal(doc.querySelector("#matchups"), null, "and no panel for it");
    // Still a section, though - dropping it from the strip must not take the
    // public page with it. (matchup.test.mjs covers what that page contains.)
    const page = await get("/team/new-england-patriots/matchups/");
    assert.equal(page.status, 200, "the section page still renders");
  });

  test("every opponent carries a shorter spelling, and only to the eye", async () => {
    const { doc } = await dom("/team/new-england-patriots/schedule/");
    const cells = [...doc.querySelectorAll("#schedule .sct-srow-name")];
    assert.ok(cells.length > 0, "the schedule rendered opponent names");

    let paired = 0;
    for (const cell of cells) {
      const long = cell.querySelector(".sct-srow-name-long");
      const brief = cell.querySelector(".sct-srow-name-brief");
      if (!brief) {
        // Only an opponent this server could not resolve to a team, which has
        // no nickname and no code to fall back to. One text node, not half a
        // pair of spans.
        assert.equal(long, null, `${cell.textContent}: half a pair`);
        assert.equal(
          cell.closest(".sct-srow").querySelector(".sct-srow-logo"),
          null,
          `${cell.textContent}: a known team with no shorter spelling`,
        );
        continue;
      }
      paired += 1;
      assert.ok(long, "the full name is carried alongside the nickname");
      // The nickname is decorative: the row's accessible name stays the full
      // one, so a screen reader never reads "Chargers" as the team.
      assert.equal(brief.getAttribute("aria-hidden"), "true");
      assert.equal(long.hasAttribute("aria-hidden"), false);
      assert.ok(
        brief.textContent.trim().length < long.textContent.trim().length,
        "a shorter spelling that is not shorter is not worth having",
      );
      assert.ok(
        long.textContent.trim().endsWith(brief.textContent.trim()),
        `${brief.textContent} is not the tail of ${long.textContent}`,
      );
    }
    assert.ok(paired > 0, "this test needs a resolvable opponent");
  });

  /** A depth row's name: the full spelling, where a brief one rides alongside. */
  const rowName = (row) =>
    (row.querySelector(".sct-depth-name-long") ?? row.querySelector(".sct-depth-name")).textContent.trim();

  test("the Depth Chart tab is the football chart first, the fantasy chart last", async () => {
    const { doc } = await dom("/team/new-england-patriots/depth-chart/");
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data/depth-charts/statchasers/depth-charts.json"), "utf8"),
    );
    const ne = snapshot.teams.find((t) => t.team.abbr === "NE");
    assert.ok(ne, "the snapshot has the Patriots");
    assert.ok(Array.isArray(ne.slots) && ne.slots.length > 0, "the snapshot carries slot rows");

    // The panel heads itself with the page's phrase, then the stamp (the
    // document's own refresh time, never the render time) and a one-paragraph
    // summary naming listed starters.
    const panel = doc.querySelector("#depth-chart");
    assert.equal(panel.querySelector(".sct-h2").textContent.trim(), "New England Patriots Depth Chart");
    const stamp = panel.querySelector(".sct-dc-stamp");
    assert.match(stamp.textContent, new RegExp(`^${snapshot.season} NFL season`));
    assert.equal(stamp.querySelector("time").getAttribute("datetime"), new Date(snapshot.fetchedAt).toISOString());
    assert.equal(panel.querySelector(".sct-dc-note"), null, "no instructional view notes");
    const summary = panel.querySelector(".sct-dc-summary").textContent;
    assert.match(summary, /^The New England Patriots depth chart has .+ starting at quarterback/);
    const qbSlot = ne.slots.find((slot) => slot.key === "qb");
    assert.ok(summary.includes(qbSlot.players[0].name), "the summary names the listed QB1");

    // Four views behind a filter, Offense first and pressed; every card is in
    // the HTML, not fetched; Fantasy is last.
    const buttons = [...panel.querySelectorAll("[data-sct-dc-view]")];
    assert.deepEqual(
      buttons.map((b) => b.textContent.trim()),
      ["Offense", "Defense", "Special Teams", "Fantasy"],
    );
    assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
    const panels = [...panel.querySelectorAll("[data-sct-dc-panel]")];
    assert.deepEqual(
      panels.map((p) => p.dataset.sctDcPanel),
      buttons.map((b) => b.dataset.sctDcView),
    );
    assert.deepEqual(
      panels.map((p) => p.querySelector(".sct-dcx-title").textContent.trim()),
      [
        "New England Patriots Offense Depth Chart",
        "New England Patriots Defense Depth Chart",
        "New England Patriots Special Teams Depth Chart",
        "New England Patriots Fantasy Depth Chart",
      ],
    );

    // The football cards: Position | Starter | Second | Third | Fourth, one
    // row per SLOT in the source's order (a base offense has three WR rows),
    // the source's ranks, nothing re-sorted, no fantasy rank anywhere.
    const sides = { offense: "offense", defense: "defense", special: "specialTeams" };
    for (const [key, side] of Object.entries(sides)) {
      const card = panels.find((p) => p.dataset.sctDcPanel === key);
      const labels = [...card.querySelectorAll(".sct-dcx-labels > span")].map((s) => s.textContent);
      assert.deepEqual(labels, ["Pos", "Starter", "Second", "Third", "Fourth"]);
      const expected = ne.slots.filter((slot) => slot.side === side && slot.players.length);
      const rows = [...card.querySelectorAll(".sct-dcx-row")];
      assert.deepEqual(
        rows.map((r) => r.dataset.slot),
        expected.map((slot) => slot.key),
        `${key}: a row per slot, in the source's order`,
      );
      const more = [...card.querySelectorAll(".sct-dcx-more .sct-dcx-card")];
      for (const slot of expected) {
        const row = rows.find((r) => r.dataset.slot === slot.key);
        const pos = slot.slot === "PK" ? "K" : slot.slot;
        assert.equal(row.dataset.pos, pos);
        const cards = [...row.querySelectorAll(".sct-dcx-card")];
        assert.ok(cards.length <= 4, `${slot.key}: at most four strings across`);
        const deeper = more.filter((c) => c.querySelector(".sct-dcx-subpos")?.textContent === `${pos}${c.dataset.rank}`);
        const players = [...slot.players].sort((a, b) => a.rank - b.rank);
        assert.deepEqual(
          [...cards, ...deeper].map(rowName),
          players.map((p) => p.name),
          `${slot.key}: names in the source's order`,
        );
        assert.deepEqual(
          [...cards, ...deeper].map((c) => Number(c.dataset.rank)),
          players.map((p) => p.rank),
          `${slot.key}: the source's ranks`,
        );
        for (const card of cards) {
          assert.ok(card.querySelector(".sct-dcx-well"), "headshot well");
          assert.equal(card.querySelector(".sct-dcx-subpos"), null, "the row labels the slot");
        }
      }
      assert.equal(card.querySelectorAll(".sct-dcx-rank").length, 0, `${key}: no PPR rank on the football chart`);
      assert.equal(card.querySelector(".sct-dcx-folded"), null, `${key}: slotted, not folded`);
    }
    const offense = panels[0];
    assert.equal(offense.querySelectorAll('.sct-dcx-row[data-pos="WR"]').length, ne.slots.filter((s) => s.slot === "WR").length);
    assert.match(offense.querySelector(".sct-dcx-formation")?.textContent ?? "", /^Base offense: /);

    // The fantasy card: one group per position under a long-tail heading,
    // every box labelled with its rank in the hierarchy, the four skill
    // positions carrying the league PPR rank too.
    const fantasy = panels[3];
    const groups = [...fantasy.querySelectorAll(".sct-dcx-fan")];
    assert.deepEqual(
      groups.map((g) => g.querySelector(".sct-dcx-fan-title").textContent.trim()),
      ["QB", "RB", "WR", "TE", "K"]
        .filter((pos) => (ne.positions[`FAN_${pos}`] ?? []).length)
        .map((pos) => `New England Patriots ${{ QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", K: "Kicker" }[pos]} Depth Chart`),
    );
    for (const group of groups) {
      const pos = group.dataset.pos;
      const expected = [...ne.positions[`FAN_${pos}`]].sort((a, b) => a.rank - b.rank);
      const cards = [...group.querySelectorAll(".sct-dcx-card")];
      assert.deepEqual(cards.map(rowName), expected.map((p) => p.name), `${pos}: the fantasy order`);
      assert.deepEqual(
        cards.map((c) => c.querySelector(".sct-dcx-subpos").textContent),
        expected.map((p) => `${pos}${p.rank}`),
        `${pos}: WR1 / WR2 labels`,
      );
    }
    const chips = [...fantasy.querySelectorAll(".sct-dcx-rank")];
    assert.ok(chips.length > 0, "PPR ranks on the Fantasy view");
    for (const chip of chips) {
      assert.match(chip.textContent, /^PPR(QB|RB|WR|TE)\d+$/);
      const pos = chip.closest(".sct-dcx-fan").dataset.pos;
      assert.ok(chip.textContent.startsWith(`PPR${pos}`), `${chip.textContent} on a ${pos} card`);
    }

    // The Fantasy columns carry no status in the document; each row borrows the
    // Offense column's for the same player.
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const offenseCol = ne.positions[pos] ?? [];
      for (const player of ne.positions[`FAN_${pos}`] ?? []) {
        const twin = offenseCol.find((o) => o.name === player.name);
        if (player.status || !twin?.status) continue;
        const card = [...fantasy.querySelectorAll(".sct-dcx-card")].find((c) => rowName(c) === player.name);
        assert.ok(card?.querySelector(".sct-injury-badge"), `${player.name} lost the ${twin.status} the Offense view has`);
      }
    }

    // Under the questions: this club's pages, then the fantasy tools, every
    // player name on the chart a crawlable link where a profile exists.
    const tail = doc.querySelector(tailOf("depth-chart"));
    const clusters = [...tail.querySelectorAll(".sct-dc-links .sct-h2")].map((h) => h.textContent.trim());
    assert.deepEqual(clusters, ["More New England Patriots", "Fantasy Football Tools"]);
    const own = [...tail.querySelector(".sct-dc-links").querySelectorAll(".sct-dc-link")].map((a) => a.getAttribute("href"));
    assert.ok(own.includes("/team/new-england-patriots/") && own.includes("/team/new-england-patriots/schedule/"), own.join(" "));
    assert.ok(panel.querySelectorAll(".sct-dcx-card a.sct-player-link[href]").length > 10, "player names link to profiles");
  });

  test("the depth chart FAQ names the players the chart above it lists", async () => {
    const { doc } = await dom("/team/new-england-patriots/depth-chart/");
    const scope = '[data-sct-faq-for="depth-chart"]';
    const entries = faqEntries(doc, scope);
    assert.ok(entries.length >= 5, `expected a depth FAQ, got ${entries.length}`);

    for (const entry of entries) {
      assert.match(entry.question, /\?$/, `not a question: ${entry.question}`);
      assert.match(entry.answer, /[.!?]$/, `unpunctuated: ${entry.answer}`);
      // Present tense throughout: a depth chart is not scoped to a season, and
      // an answer claiming one would be a claim a trade can falsify.
      assert.ok(
        !/\b(19|20)\d{2}\b/.test(entry.answer),
        `a depth chart answer should not name a season: ${entry.answer}`,
      );
    }

    // Every name in an answer is a name the chart itself rendered - this is the
    // one thing deriving the FAQ is supposed to guarantee.
    const charted = new Set(
      [...doc.querySelectorAll("#depth-chart .sct-depth-name-long, #depth-chart .sct-depth-name")]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
    assert.ok(charted.size > 0, "the chart rendered names to check against");
    // A sidelined receiver in the fantasy hierarchy is named as such in the
    // fantasy WR1 answer, so an order that skips him reads as an injury and
    // not as a wrong chart; a listed football starter who is out is named
    // with his designation in the starter answer.
    const sidelined = [
      ...doc.querySelectorAll('#depth-chart [data-sct-dc-panel="fantasy"] .sct-dcx-fan[data-pos="WR"] .sct-dcx-card.is-sidelined'),
    ].map(rowName);
    for (const who of sidelined) {
      assert.ok(
        entries.some((e) => e.answer.includes(who)),
        `a sidelined receiver on the fantasy chart (${who}) goes unmentioned`,
      );
    }
    for (const row of doc.querySelectorAll('#depth-chart [data-sct-dc-panel="offense"] .sct-dcx-row')) {
      const first = row.querySelector(".sct-dcx-card");
      if (!first?.classList.contains("is-sidelined") || !["QB", "RB", "TE"].includes(row.dataset.pos)) continue;
      const who = rowName(first);
      assert.ok(
        entries.some((e) => e.answer.includes(who) && /(injured reserve|PUP list|non-football injury|suspended|is out)/.test(e.answer)),
        `the listed ${row.dataset.pos} starter ${who} is out and the answer does not say so`,
      );
    }

    const starter = entries.find((e) => /starting quarterback\?$/.test(e.question));
    assert.ok(starter, "the FAQ answers who the starting quarterback is");
    assert.ok(
      [...charted].some((name) => starter.answer.includes(name)),
      `the QB answer names nobody on the chart: ${starter.answer}`,
    );
  });

  test("'Use this research' is off the team pages (mak, 2026-10-09)", async () => {
    // The block (products + usage report + next matchup) used to close every
    // tab. It is unmounted, not deleted - renderResources() still exists - so
    // this guards against it quietly coming back at either mount point.
    for (const path of [
      "/team/new-england-patriots/",
      "/team/new-england-patriots?embed=1",
      "/team/new-england-patriots/usage/",
    ]) {
      const { doc } = await dom(path);
      assert.equal(doc.getElementById("resources"), null, `${path}: block rendered`);
      assert.equal(doc.querySelectorAll(".sct-resource-link").length, 0, `${path}: cards rendered`);
    }
    // The /usage/ page keeps its own conversion block.
    const usage = await dom("/team/new-england-patriots/usage/");
    assert.ok(usage.doc.querySelector(".sct-us-convert"));
  });

  test("the Targets and Carries boards sit above the environment cards (mak, 2026-11-02)", async () => {
    const { doc } = await dom("/team/new-england-patriots/usage/");
    const boards = [...doc.querySelectorAll(".sct-us-board")];
    assert.deepEqual(
      boards.map((b) => b.querySelector(".sct-us-h3")?.textContent),
      ["Targets", "Carries"],
    );
    // The environment cards went 2026-11-02; the boards now lead into the
    // first card (the backfield split). DOCUMENT_POSITION_FOLLOWING = 4.
    assert.equal(doc.querySelector(".sct-us-env"), null, "no environment cards");
    const firstCard = doc.querySelector(".sct-us-card");
    assert.ok(firstCard && boards[0].compareDocumentPosition(firstCard) & 4, "boards come before the first card");
    for (const [i, board] of boards.entries()) {
      const counts = [...board.querySelectorAll("td.is-count")].map((td) => Number(td.textContent));
      assert.ok(counts.length > 0 && counts.length <= 8, `${i}: ${counts.length} rows`);
      assert.ok(counts.every((c, j) => j === 0 || c <= counts[j - 1]), `${i}: not sorted: ${counts}`);
      assert.equal(board.querySelectorAll(".sct-us-face").length, counts.length, `${i}: a face well per row`);
      assert.equal(board.querySelectorAll(".sct-slot").length, counts.length, `${i}: a position chip per row`);
      assert.equal(board.querySelectorAll("tbody .sct-us-share").length, counts.length, `${i}: one track per row`);
      // The badge is the difference of the two printed numbers (mak's audit, 2026-11-02).
      for (const tr of board.querySelectorAll("tbody tr:not(.sct-us-board-more)")) {
        const season = Number(tr.querySelector(".sct-us-share-val").textContent.replace("%", ""));
        const recentEl = tr.querySelector(".sct-us-recent-val");
        if (!recentEl) continue;
        const recent = Number(recentEl.textContent.replace("%", ""));
        const badge = tr.querySelector(".sct-us-arrow");
        const delta = recent - season;
        if (Math.abs(delta) >= 3) {
          assert.ok(badge, `${tr.textContent.trim().slice(0, 30)}: badge expected for ${delta}`);
          assert.equal(badge.textContent.replace(/up|down/, ""), `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}`);
        } else {
          assert.equal(badge, null, `${tr.textContent.trim().slice(0, 30)}: no badge for ${delta}`);
        }
        assert.ok(season > 0, "no 0% rows are named");
      }
    }
    assert.match(boards[0].querySelector("thead").textContent, /Tgt.*Season share.*Last 3 wk.*Air yds/);
    assert.match(boards[1].querySelector("thead").textContent, /Car.*Season share.*Last 3 wk/);
    assert.ok(!/Air yds/.test(boards[1].querySelector("thead").textContent), "no air yards on the carries board");
  });
});

/**
 * The FAQs on the Outlook and Stats tabs.
 *
 * Every answer is built from what the tab already rendered - the outlook cards
 * (lib/team/outlook-faq.ts) and the stat ladders (lib/team/stats-faq.ts) - so
 * what these assert is the three things derivation cannot guarantee on its own:
 * that the blocks reach the page, that the structured data agrees with the
 * visible text, and that there is exactly one FAQPage for the whole document
 * however many tabs carry questions.
 */
describe("tab FAQs", () => {

  test("the outlook carries questions answered in full sentences", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const entries = faqEntries(doc, tailOf("outlook"));
    assert.ok(entries.length >= 5, `expected an FAQ, got ${entries.length} items`);
    for (const entry of entries) {
      assert.match(entry.question, /\?$/, `not a question: ${entry.question}`);
      // A one-word answer is the failure mode a derived FAQ has: a missing
      // field rendering as an empty phrase rather than the entry being skipped.
      assert.ok(
        entry.answer.length > 40,
        `answer too short to be one: ${entry.answer}`,
      );
      assert.match(entry.answer, /[.!?]$/, `unpunctuated: ${entry.answer}`);
    }
  });

  test("the Stats tab answers from its own numbers", async () => {
    const { doc } = await dom("/team/new-england-patriots/stats/");
    const entries = faqEntries(doc, tailOf("stats"));
    assert.ok(entries.length >= 4, `expected a stats FAQ, got ${entries.length}`);

    // The point of deriving these: every figure quoted must be one the tab
    // printed. Pull the numbers out of the answers and check each appears
    // somewhere in the stat rows above them.
    const rendered = doc.querySelector("#stats").textContent;
    for (const entry of entries) {
      assert.match(entry.question, /\?$/, `not a question: ${entry.question}`);
      for (const figure of entry.answer.match(/\d+\.\d+/g) ?? []) {
        assert.ok(
          rendered.includes(figure),
          `${figure} is in an answer but nowhere on the tab: ${entry.answer}`,
        );
      }
    }
  });

  test("the Stats FAQ says how many games it is built on", async () => {
    const { doc } = await dom("/team/new-england-patriots/stats/");
    const entries = faqEntries(doc, tailOf("stats"));
    // A per-game rate with no denominator is the one way this block can
    // mislead, and early in a season it is the whole story.
    // Case-insensitive: the window is a leading clause in some answers and a
    // trailing one in others, so it is capitalized in some of them.
    const framed = entries.filter((e) =>
      /through \d+ games?|in the \d{4} regular season/i.test(e.answer),
    );
    assert.equal(
      framed.length,
      entries.length,
      "every stats answer must say what window it covers",
    );
  });

  test("the questions stay their own tab's, and one level under their heading", async () => {
    // Each section with an address of its own prints there and nowhere else
    // (ownsAddress in team-render.ts), so each tab is read on its own page;
    // the Outlook is the hub's.
    const pages = {
      outlook: (await dom("/team/new-england-patriots")).doc,
      stats: (await dom("/team/new-england-patriots/stats/")).doc,
      "depth-chart": (await dom("/team/new-england-patriots/depth-chart/")).doc,
      schedule: (await dom("/team/new-england-patriots/schedule/")).doc,
    };
    // The questions render after the "Explore StatChasers" block rather than
    // inside their panel, but they are still a tab's questions, not a shared
    // FAQ: each tail carries exactly one block, and the tail names the panel it
    // belongs to. Both take an <h2> and put their questions at <h3>, because
    // the tool list they follow is an <h2> - a deeper heading would file them
    // in the outline under the tool list, which is neither where they are nor
    // what they are about.
    for (const id of ["outlook", "stats", "depth-chart", "schedule"]) {
      const doc = pages[id];
      const scope = `[data-sct-faq-for="${id}"]`;
      const questions = doc.querySelectorAll(`${scope} .sct-faq-item`);
      assert.ok(questions.length > 0, `${id} must carry questions`);
      for (const item of questions) {
        assert.equal(item.querySelector(".sct-faq-q").tagName, "H3");
      }
      assert.equal(
        doc.querySelectorAll(`${scope} .sct-faq`).length,
        1,
        `one FAQ block on the ${id} tail`,
      );
      // Out of the panel: the tail is a sibling of it, after the panels.
      assert.equal(
        doc.querySelector(`#${id} .sct-faq`),
        null,
        `${id}: the questions left the panel`,
      );
      assert.equal(
        doc.querySelector(`#${id} ~ ${scope}`) !== null,
        true,
        `${id}: the tail follows its panel`,
      );
    }
  });

  test("the answers fold, one per question, and the questions all show", async () => {
    // The block itself does not fold - the questions are the index, so a reader
    // scanning for the one they arrived with sees all of them without opening
    // anything. Each question is its own <details> with no `open`, and the
    // question sits in the <summary>: it is the thing a reader clicks, and it
    // keeps the outline identical whether the answer is open or not. The
    // answers stay in the DOM: the FAQPage node above is only honest if they
    // are on the page.
    // Each tab on its own page (see the test above).
    const pages = {
      outlook: (await dom("/team/new-england-patriots")).doc,
      stats: (await dom("/team/new-england-patriots/stats/")).doc,
      "depth-chart": (await dom("/team/new-england-patriots/depth-chart/")).doc,
      schedule: (await dom("/team/new-england-patriots/schedule/")).doc,
    };
    for (const [id, tag] of [
      ['[data-sct-faq-for="outlook"]', "H3"],
      ['[data-sct-faq-for="stats"]', "H3"],
      ['[data-sct-faq-for="depth-chart"]', "H3"],
      ['[data-sct-faq-for="schedule"]', "H3"],
    ]) {
      const doc = pages[id.match(/for="([^"]+)"/)[1]];
      assert.equal(
        doc.querySelector(`${id} details.sct-faq-fold`),
        null,
        `${id}: the block itself is not a fold`,
      );

      const items = doc.querySelectorAll(`${id} .sct-faq .sct-faq-item`);
      assert.ok(items.length > 0, `${id} must carry questions`);
      for (const item of items) {
        assert.equal(item.tagName, "DETAILS", `${id}: each question is a fold`);
        assert.equal(item.hasAttribute("open"), false, `${id}: shut by default`);

        const summary = item.querySelector(":scope > summary.sct-faq-q-row");
        assert.ok(summary, `${id}: the question is the summary`);
        const heading = summary.querySelector(":scope > .sct-faq-q");
        assert.equal(heading.tagName, tag);
        assert.ok(heading.textContent.trim(), `${id}: the question has text`);

        const answer = item.querySelector(":scope > .sct-faq-a");
        assert.ok(answer, `${id}: the answer is inside the fold`);
      }
    }

    // The heading above the block stays on the page, unwrapped.
    for (const [id, selector] of [
      ['[data-sct-faq-for="outlook"]', ".sct-h2"],
      ['[data-sct-faq-for="stats"]', ".sct-h2"],
      ['[data-sct-faq-for="depth-chart"]', ".sct-h2"],
      ['[data-sct-faq-for="schedule"]', ".sct-h2"],
    ]) {
      const doc = pages[id.match(/for="([^"]+)"/)[1]];
      const headings = [...doc.querySelectorAll(`${id} ${selector}`)].filter(
        (node) => node.textContent.trim() === "Common questions",
      );
      assert.equal(headings.length, 1, `${id}: one "Common questions" heading`);
      assert.equal(
        headings[0].closest("summary"),
        null,
        `${id}: the heading is not a summary`,
      );
    }
  });

  test("one FAQPage for the document, covering every tab that has questions", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const entries = faqEntries(doc);
    // Two of the hub's OWN tabs: the Stats questions live on /stats/ now,
    // with the rest of that page.
    assert.ok(
      faqEntries(doc, tailOf("outlook")).length > 0 && faqEntries(doc, tailOf("coaching")).length > 0,
      "this test is only meaningful with both tabs carrying questions",
    );
    for (const id of ["usage", "stats", "depth-chart"]) {
      assert.equal(doc.querySelector(tailOf(id)), null, `${id}: its questions are not on the hub`);
    }

    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => JSON.parse(node.textContent))
      .filter((json) => json["@type"] === "FAQPage");
    // One node, not one per tab: a second FAQPage is what gets the whole lot
    // ignored rather than merged.
    assert.equal(blocks.length, 1, "exactly one FAQPage on the page");

    const asked = blocks[0].mainEntity.map((q) => ({
      question: q.name,
      answer: q.acceptedAnswer.text,
    }));
    // Markup that says something the page does not is the whole reason schema
    // gets a page penalized, so this is equality rather than a spot check.
    assert.deepEqual(asked, entries);
  });

  test("embedded, the questions ship as data for the host to place", async () => {
    // Rank Math owns the graph on statchasers.com, so the fragment must not
    // inject a second <script type="application/ld+json"> - one graph competes
    // with the other rather than adding to it.
    //
    // It does NOT follow that the questions should be withheld. The indexed URL
    // is the WordPress one, and emitting nothing there is what left these
    // questions rendered for readers and invisible to crawlers. So the fragment
    // ships them as an inert island, and statchasers-team.php lifts it into
    // Rank Math's graph and strips it before printing.
    for (const path of ["/team/new-england-patriots?embed=1", "/embed/team/ne"]) {
      const res = await get(path);
      assert.equal(res.status, 200);
      assert.ok(
        !/FAQPage/.test(res.body),
        `${path} must not emit FAQPage markup of its own`,
      );
      // The visible questions still ship - it is only the node that is deferred.
      assert.match(res.body, /sct-faq-q/, `${path} should still render the FAQ`);

      const island = res.body.match(
        /<script type="application\/json" class="sct-faq-data">(.*?)<\/script>/s,
      );
      assert.ok(island, `${path} must carry the FAQ data island`);

      // The island has to describe what is on the page, not a second version of
      // it: markup that says something the page does not is the whole reason
      // schema gets a page penalized. Same equality the standalone node gets.
      const carried = JSON.parse(island[1]).map((entry) => ({
        question: entry.q,
        answer: entry.a,
      }));
      const { doc } = await dom(path);
      assert.deepEqual(carried, faqEntries(doc));
    }
  });

  test("every team with an outlook gets an FAQ, and no team without one does", async () => {
    // Scoped to Outlook: the Stats tab answers from a different source and
    // renders on teams whose outlook has not been written.
    // Cheap breadth check: the FAQ must not be special-cased to the team it was
    // written against, and a team whose outlook has not been written must not
    // render an empty block with a heading over it.
    for (const slug of ["buffalo-bills", "cincinnati-bengals", "baltimore-ravens"]) {
      const { doc } = await dom(`/team/${slug}`);
      const hasOutlook = !!doc.querySelector("#outlook .sct-outlook-player");
      const entries = faqEntries(doc, tailOf("outlook"));
      if (hasOutlook) {
        assert.ok(entries.length > 0, `${slug} has an outlook but no FAQ`);
      } else {
        assert.equal(entries.length, 0, `${slug} has an FAQ but no outlook`);
      }
    }
  });
});

describe("honest empty states", () => {
  test("no placeholder values anywhere on the page", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const text = doc.querySelector(".sct").textContent;
    // The rule the whole data layer exists to enforce: a field we do not have
    // is absent, never filled in with a dash or an N/A.
    assert.ok(!/\bN\/A\b/.test(text), "no N/A placeholders");
    assert.ok(!/\bTBD TBD\b/.test(text));
    assert.ok(!/undefined|NaN|\[object Object\]/.test(text));
  });

  test("the navigation only points at sections that rendered", async () => {
    // Checked across several teams, since which sections are available varies
    // with what the providers returned.
    for (const slug of [
      "new-england-patriots",
      "carolina-panthers",
      "green-bay-packers",
    ]) {
      const { doc } = await dom(`/team/${slug}`);
      for (const link of doc.querySelectorAll(".sct-nav-link")) {
        const id = link.getAttribute("data-sct-panel-id");
        const href = link.getAttribute("href");
        // A tab to another address renders there, not here: that page is
        // one panel, and it is this one.
        const section = href.includes("#") || id === "outlook"
          ? doc.getElementById(id)
          : (await dom(href)).doc.querySelector(`[data-sct-root][data-section="${id}"] [data-sct-panel]#${id}`);
        assert.ok(section, `${slug}: #${id} exists`);
        assert.ok(
          section.textContent.trim().length > 0,
          `${slug}: #${id} is not an empty shell`,
        );
      }
    }
  });

  test("a team with no archived news says so instead of showing nothing", async () => {
    // Whichever team it is today, the empty state and a populated list are
    // mutually exclusive and one of them must be present.
    const { doc } = await dom("/team/carolina-panthers/news/");
    const hasCards = doc.querySelectorAll(".sct-news").length > 0;
    const hasEmpty = doc.querySelectorAll(".sct-empty").length > 0;
    assert.ok(hasCards || hasEmpty, "news section is never simply blank");
  });
});

describe("caching", () => {
  test("repeat requests revalidate to 304", async () => {
    // Warm the page first. The ETag fingerprints every provider's fetch stamp,
    // so the FIRST request for a team - the one that populates those providers
    // - legitimately produces a different validator from the one after it. The
    // assertion here is about a warm page, which is every request but the first.
    await rawGet("/team/new-england-patriots");

    const first = await rawGet("/team/new-england-patriots");
    const etag = first.headers["etag"];
    assert.ok(etag, "team page carries an ETag");

    const second = await rawGet("/team/new-england-patriots", {
      "If-None-Match": etag,
    });
    assert.equal(second.status, 304);
    assert.equal(second.body, "", "a 304 must not carry a body");
  });
});

describe("mobile layout", () => {
  /**
   * The team switcher is thirty-two internal links and the only way to move
   * between hubs, and it is trivially easy to break by clipping.
   *
   * `.sct-hero` used to carry `overflow: hidden` for the aura and the
   * watermark. An absolutely positioned panel inside an overflow-hidden
   * ancestor is cut off at that ancestor's edge, and this panel opens BELOW its
   * summary - so most of it was thrown away, and nearly all of it on a phone
   * where the hero is short. The fix moves the clip onto an inner decoration
   * layer. Both halves of that are asserted here because either one alone
   * silently restores the bug: the wrapper with no clip lets the decorations
   * bleed, and the clip back on the hero eats the panel again.
   */
  test("the hero clips its decorations without clipping the switcher", async () => {
    const { doc } = await dom("/team/new-england-patriots");

    const decor = doc.querySelector(".sct-hero > .sct-hero-decor");
    assert.ok(decor, "the hero's decorations live in their own layer");
    assert.ok(
      decor.querySelector(".sct-hero-aura") &&
        decor.querySelector(".sct-hero-watermark"),
      "both decorations are inside that layer, so the layer is what clips",
    );

    const css = await get("/team.css");
    assert.equal(css.status, 200);
    // The declaration block alone. The comment above .sct-hero-decor explains
    // the very property being asserted against, so a wider slice matches its
    // own prose.
    const heroAt = css.body.indexOf("\n.sct-hero {");
    assert.ok(heroAt > 0, "located the .sct-hero rule");
    const hero = css.body.slice(heroAt, css.body.indexOf("}", heroAt));
    assert.ok(
      !/overflow:\s*hidden/.test(hero),
      ".sct-hero must not clip - that clips the open team switcher with it",
    );
    assert.ok(
      /\.sct-hero-decor\s*\{[^}]*overflow:\s*hidden/.test(css.body),
      ".sct-hero-decor is the element that clips",
    );
  });

  /**
   * The watermark, in the stacked hero, is bottom-right and bigger.
   *
   * Centered on the right edge is a desktop arrangement: there, half of an
   * 1100px hero is empty. Stacked there is no empty half - the chips and the
   * switcher are opaque cards filling the width - so a 240px mark centered
   * behind them showed in the gaps between cards and nowhere else, which is
   * what mak reported as too small to see. The corner under the switcher is
   * the one part of this hero that is reliably not a card.
   *
   * The transform is the trap and the reason this is pinned: the desktop rule
   * centers with `translateY(-50%)`, which pairs with `top: 50%`. Left in
   * place alongside `bottom`, it lifts the mark by half its own height and
   * puts it back behind the cards - a change that looks like nothing in the
   * diff and undoes the whole rule.
   */
  test("the stacked hero hangs its watermark in the corner", async () => {
    const css = (await get("/team.css")).body;

    const desktopAt = css.indexOf("\n.sct-hero-watermark {");
    assert.ok(desktopAt > 0, "located the desktop watermark rule");
    const desktop = css.slice(desktopAt, css.indexOf("}", desktopAt));
    assert.match(desktop, /top:\s*50%/, "the desktop mark is centered");
    assert.match(desktop, /transform:\s*translateY\(-50%\)/);

    const phone = css.slice(
      css.indexOf("@media (max-width: 720px)"),
      css.indexOf("@media (max-width: 420px)"),
    );
    const phoneAt = phone.indexOf(".sct-hero-watermark {");
    assert.ok(phoneAt > 0, "the phone block places it again");
    const stacked = phone.slice(phoneAt, phone.indexOf("}", phoneAt));

    assert.match(stacked, /top:\s*auto/, "off the vertical center");
    assert.match(stacked, /bottom:\s*-?\d+px/, "and anchored to the bottom");
    assert.match(
      stacked,
      /transform:\s*none/,
      "with the centering transform canceled - see this test's note",
    );

    const size = (block) => Number(block.match(/width:\s*(\d+)px/)[1]);
    assert.ok(
      size(stacked) > size(desktop) * 0.9,
      "and no smaller than the desktop mark: it was 240 against 300",
    );
    const weight = (block) => Number(block.match(/opacity:\s*([\d.]+)/)[1]);
    assert.ok(
      weight(stacked) > weight(desktop),
      "at more weight, because what shows here is only the part clear of a card",
    );

    // And below 450px it is gone. A 300px mark in a 358px hero is not a
    // watermark, it is a picture the content is printed over - there is no
    // part of the card it is not behind, so what shows is whatever the gaps
    // between the chips expose. The crest beside the name still carries the
    // club at that width.
    const small = css.slice(
      css.indexOf("@media (max-width: 450px)"),
      css.indexOf("@media (max-width: 420px)"),
    );
    assert.ok(small.length > 0, "located the 450px block");
    assert.match(
      small,
      /\.sct-hero-watermark \{\s*display:\s*none/,
      "the smallest screens have no watermark",
    );
    // Source order is the whole mechanism here: both rules are one class, so
    // a 450px block written ABOVE the 720px one would be overruled by it and
    // the mark would come back.
    assert.ok(
      css.indexOf("@media (max-width: 450px)") >
        css.indexOf("@media (max-width: 720px)"),
      "and that block has to come after the one it overrules",
    );
  });

  /**
   * The hero's top row breaks on the name, not at a width.
   *
   * It used to restack at 900px, which is a number that fits no team: the
   * switcher is a pill as wide as the club's name, so at 900 "Philadelphia
   * Eagles" still had room to spare while "Washington Commanders" had been
   * wrapping to two lines for fifty pixels. The row is a flex line now, and
   * what makes it break is the name's own width - which is only true while the
   * name cannot wrap and the block holding it keeps its automatic minimum.
   * Both halves are asserted because either alone puts the old behavior back:
   * a wrapping name shrinks to nothing and the switcher never moves, and
   * `min-width: 0` lets the row squeeze the name instead of breaking.
   */
  test("the hero's name and switcher share a row until the name needs it", async () => {
    const { doc } = await dom("/team/washington-commanders");

    const head = doc.querySelector(".sct-hero-inner > .sct-hero-head");
    assert.ok(head, "the three blocks beside the crest share one flex row");
    for (const part of ["sct-hero-text", "sct-hero-meta", "sct-hero-actions"]) {
      assert.ok(head.querySelector(`:scope > .${part}`), `${part} is in it`);
    }
    // The chips stay ahead of the switcher in the markup; `order` is what puts
    // them under it. See renderHero().
    const order = [...head.children].map((el) => el.className);
    assert.deepEqual(order, [
      "sct-hero-text",
      "sct-hero-meta",
      "sct-hero-actions",
    ]);

    const css = await get("/team.css");
    assert.equal(css.status, 200);

    const textAt = css.body.indexOf("\n.sct-hero-text {");
    assert.ok(textAt > 0, "located the .sct-hero-text rule");
    const text = css.body.slice(textAt, css.body.indexOf("}", textAt));
    assert.ok(
      !/min-width:\s*0/.test(text),
      ".sct-hero-text keeps its automatic minimum - that is the breakpoint",
    );

    assert.ok(
      /\.sct-hero-text \.sct-title \{[^}]*white-space:\s*nowrap/.test(css.body),
      "the hub hero's name is what cannot wrap",
    );
    // Scoped, because .sct-title is also the matchup strip's heading: "Tampa
    // Bay Buccaneers vs Jacksonville Jaguars" is a sentence and must wrap.
    const titleAt = css.body.indexOf("\n.sct-title {");
    assert.ok(titleAt > 0, "located the .sct-title rule");
    const title = css.body.slice(titleAt, css.body.indexOf("}", titleAt));
    assert.ok(
      !/white-space/.test(title),
      ".sct-title itself must not be armed with it - the matchup heading wraps",
    );

    // And no width may put the switcher back on a row of its own above the
    // phone stack, which is the rule this replaced.
    const tablet = css.body.slice(
      css.body.indexOf("@media (max-width: 900px)"),
      css.body.indexOf("@media (max-width: 720px)"),
    );
    assert.ok(tablet.length > 0, "located the tablet block");
    assert.ok(
      !/\.sct-hero-(inner|actions)\s*\{/.test(tablet),
      "the 900px block must not lay the hero out again",
    );
  });

  /**
   * The crest and the name stay on one row, at every width.
   *
   * The phone hero used to stack them - a 72px disc, then the eyebrow, then
   * the name, then the standfirst, four things down the screen where the first
   * says the least and the hero ran to about 400px before a reader reached the
   * chips. mak asked for the mark and the name back on one line, which is also
   * what they are: one statement of whose page this is.
   *
   * Only the top row pairs up. The chips and the switcher keep full rows of
   * their own underneath, both being wider than what a 360px screen has left
   * once the crest has taken its 64 - so this asserts the areas, not just that
   * the grid has two columns.
   */
  test("the phone hero keeps the crest beside the name", async () => {
    const css = (await get("/team.css")).body;
    const phone = css.slice(
      css.indexOf("@media (max-width: 720px)"),
      css.indexOf("@media (max-width: 420px)"),
    );
    assert.ok(phone.length > 0, "located the phone block");

    const innerAt = phone.indexOf(".sct-hero-inner {");
    assert.ok(innerAt > 0, "the phone block lays the hero out");
    const inner = phone.slice(innerAt, phone.indexOf("}", innerAt));

    assert.match(
      inner,
      /grid-template-columns:\s*auto minmax\(0, 1fr\)/,
      "the crest's column and the name's column",
    );
    // Whitespace-insensitive: the declaration is written over three lines.
    const areas = inner.match(/grid-template-areas:([^;]*);/);
    assert.ok(areas, "the phone hero names its areas");
    assert.deepEqual(
      areas[1].match(/"[^"]*"/g),
      ['"crest text"', '"meta meta"', '"actions actions"'],
      "crest beside the name, then the chips, then the switcher",
    );

    // The name has to be allowed to wrap beside it - the desktop nowrap is
    // what makes the flex row break on the name's length, and inside a column
    // that is now 64px narrower it would set the hero's width instead.
    assert.match(
      phone,
      /\.sct-hero-text \.sct-title \{\s*white-space:\s*normal/,
      "and the name may wrap in the column the crest left it",
    );

    // The timestamp is the 2x2 grid's footnote, so it is centered under it:
    // the grid has two columns and a center rather than a left end for a line
    // to hang off. Left-aligned on a desktop, where the chips are a row.
    assert.match(
      phone,
      /\.sct-hero-updated \{[^}]*text-align:\s*center/,
      "the timestamp is centered under the stacked chips",
    );
    const deskAt = css.indexOf("\n.sct-hero-updated {");
    assert.ok(deskAt > 0, "located the desktop timestamp rule");
    assert.ok(
      !/text-align/.test(css.slice(deskAt, css.indexOf("}", deskAt))),
      "and takes the root's left alignment everywhere else",
    );
  });

  /**
   * The standfirst goes rather than taking a second line.
   *
   * "<Club> fantasy football hub" is the club's own name plus four words, so
   * the width where it stops fitting on one line is a different width for all
   * 32: measured at 470px for Washington and 360px for Buffalo. A media query
   * would take it off a third of the league while it still fits, which is the
   * same argument the chips ladder makes, so the bundle measures it - and what
   * it measures is a Range over the contents, because getClientRects() on a
   * block <p> returns one rect whatever is inside it.
   *
   * The line is never removed from the DOCUMENT. That is the half this test
   * can assert directly: the server prints it at every width, with a hook and
   * no value, so what a crawler reads does not depend on a viewport.
   */
  test("the hero standfirst ships with a hook and is only ever hidden", async () => {
    const { doc } = await dom("/team/washington-commanders");

    const lead = doc.querySelector(".sct-hero .sct-subtitle");
    assert.ok(lead, "the standfirst is server-rendered");
    assert.equal(
      lead.textContent,
      "Washington Commanders fantasy football hub",
      "and it says what it always said",
    );
    assert.ok(lead.hasAttribute("data-sct-lead"), "with the bundle's hook on it");
    assert.equal(
      lead.getAttribute("data-sct-lead"),
      "",
      "and no state: nothing is dropped until something has measured it",
    );

    const css = (await get("/team.css")).body;
    assert.match(
      css,
      /\.sct-subtitle\[data-sct-lead="off"\] \{\s*display:\s*none/,
      "the stylesheet hides the dropped state, and only that state",
    );
    // The hook alone must not hide anything, or the line would be off for
    // every reader with JavaScript disabled - which is the one case where
    // nothing can ever measure it and the full line is what ships.
    assert.ok(
      !/\.sct-subtitle\[data-sct-lead\] \{[^}]*display:\s*none/.test(css),
      "the bare hook must not hide it",
    );
    // And no width may do it either: this is measured, not a breakpoint.
    for (const [, block] of css.matchAll(/@media[^{]*max-width[^{]*\{([\s\S]*?)\n\}/g)) {
      assert.ok(
        !/\.sct-subtitle[^{]*\{[^}]*display:\s*none/.test(block),
        "no media query may hide the standfirst",
      );
    }

    const bundle = await get("/dist/statchasers-team.js");
    assert.equal(bundle.status, 200);
    assert.ok(
      bundle.body.includes("data-sct-lead"),
      "the bundle is what sets the state",
    );
    assert.ok(
      bundle.body.includes("selectNodeContents"),
      "and it counts line boxes with a range, not the block's own rect",
    );
  });

  /**
   * The chips row shortens itself rather than wrapping.
   *
   * Five chips need 555–617px on one line depending on the club, and under
   * that the Bye chip drops to a row of its own for one short word. Two chips
   * carry a shorter spelling for that, spent in the order a reader can most
   * afford them: the standing's division first ("2nd in AFC East" → "2nd",
   * which is the chip two to its left anyway), then the bye ("Week 11" →
   * "W11", under a label that still reads BYE). Both spellings ship; which one
   * shows is client/team.ts's, after it measures the row.
   *
   * Under both rungs there is a third, and it is not a spelling: the Bye chip
   * leaves the row. "W11" is the shortest true form of the fact, so a row that
   * still will not fit it has only the two endings - the chip alone on a
   * second line, which is what mak asked to stop seeing, or no chip. The bye
   * is the one fact in this row the hub states in full a tab away, on the
   * Schedule tab, which is what makes it the affordable one.
   *
   * Tolerant of the providers, like the rest of this file: either fact can be
   * absent when ESPN is down, so each is asserted only if it rendered, and the
   * stylesheet half of the contract is asserted either way.
   */
  test("the fact chips carry short forms for a row that will not fit", async () => {
    const { doc } = await dom("/team/new-england-patriots");

    const chips = [...doc.querySelectorAll(".sct-facts .sct-fact")];
    const chipFor = (label) =>
      chips.find(
        (chip) =>
          chip.querySelector(".sct-fact-label")?.textContent.trim() === label,
      );

    // Rung, and how the short form relates to the full one.
    const ladder = [
      // ESPN also sends bare places ("1st"), which have nothing to shorten -
      // hence a standing chip with no swap at all is allowed.
      { label: "Standing", spend: "short", optional: true },
      { label: "Bye", spend: "tight", optional: false },
    ];

    for (const rung of ladder) {
      const chip = chipFor(rung.label);
      if (!chip) continue;
      const full = chip.querySelector(".sct-swap--full");
      const short = chip.querySelector(".sct-swap--short");
      if (!full && !short && rung.optional) continue;

      assert.ok(full && short, `${rung.label} ships both spellings or neither`);
      assert.ok(
        short.textContent.length < full.textContent.length,
        `${rung.label}'s short form must be shorter`,
      );
      assert.equal(
        chip.getAttribute("data-sct-spend"),
        rung.spend,
        `${rung.label} gives way at the ${rung.spend} rung`,
      );
      assert.equal(
        chip.getAttribute("title"),
        full.textContent,
        `${rung.label}'s full text stays answerable on the chip's title`,
      );
    }

    const css = await get("/team.css");
    assert.equal(css.status, 200);
    assert.ok(
      /\.sct-swap--short \{[^}]*display:\s*none/.test(css.body),
      "the short forms are off until something turns them on",
    );
    // `~=`, because the row's attribute LISTS the rungs spent: "short", then
    // "short tight". An `=` here would put the standing back the moment the
    // bye was spent.
    for (const rung of ladder) {
      assert.ok(
        css.body.includes(
          `[data-sct-facts-form~="${rung.spend}"] [data-sct-spend="${rung.spend}"] .sct-swap--full`,
        ),
        `the ${rung.spend} rung swaps the chips that spend at it`,
      );
    }

    // The attribute those rules wait for has to have an author.
    const bundle = await get("/dist/statchasers-team.js");
    assert.equal(bundle.status, 200);
    assert.ok(
      bundle.body.includes("data-sct-facts-form"),
      "the hub bundle is what sets the form",
    );
    for (const rung of ladder) {
      assert.ok(
        bundle.body.includes(`"${rung.spend}"`),
        `the bundle knows the ${rung.spend} rung`,
      );
    }
    assert.ok(bundle.body.includes('"drop"'), "and the rung under them both");
  });

  /**
   * The last rung: the Bye chip leaves rather than wrapping.
   *
   * Two halves, and the reason there are two is that the row is two different
   * layouts. Above 720px it is a flex row the bundle measures, so the chip
   * goes only when it would actually have wrapped - which is a different width
   * for all 32 clubs, the coach's name being the widest thing in the row. At
   * 720px and under the row is a two-column grid where the fifth chip is
   * ALWAYS on a row of its own with an empty cell beside it, so no measuring
   * is needed or wanted and the stylesheet takes it off outright.
   */
  test("the bye chip is the one the row may drop, and does under 720px", async () => {
    const { doc } = await dom("/team/new-england-patriots");

    const chips = [...doc.querySelectorAll(".sct-facts .sct-fact")];
    const droppable = chips.filter((chip) => chip.hasAttribute("data-sct-drop"));
    const bye = chips.find(
      (chip) => chip.querySelector(".sct-fact-label")?.textContent.trim() === "Bye",
    );
    if (bye) {
      assert.deepEqual(droppable, [bye], "the bye, and nothing else, may go");
      // It ships in the HTML either way: what is dropped is dropped by CSS at
      // a width, or by the bundle after measuring, never by the renderer.
      assert.ok(bye.querySelector(".sct-swap--short"), "it still shortens first");
    } else {
      assert.equal(droppable.length, 0, "no bye, nothing marked droppable");
    }

    const css = (await get("/team.css")).body;
    assert.match(
      css,
      /\[data-sct-facts-form~="drop"\] \[data-sct-drop\] \{\s*display:\s*none/,
      "the rung the bundle spends takes the chip off the flex row",
    );

    // The grid half. Asserted inside the 720px block rather than anywhere in
    // the file, because that is the layout it is a statement about.
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    const stanza = narrow.slice(0, narrow.indexOf("@media (max-width: 420px)"));
    // `:nth-child(odd):last-child`, not the bye's own name: the condition is
    // "this chip has nothing beside it in a two-column grid", which is true of
    // the fifth of five and false of the fourth of four. A club out of season
    // with no record and no standing keeps its bye, because there it shares a
    // row like everything else.
    assert.match(
      stanza,
      /\.sct-fact\[data-sct-drop\]:nth-child\(odd\):last-child \{\s*display:\s*none/,
      "and at 720px and under the stranded cell goes, unmeasured",
    );
  });

  /**
   * Anchor targets. `scroll-padding-top` on .sct does nothing - scroll padding
   * applies to the scroll container and .sct is not one - so every section the
   * nav links to needs its own `scroll-margin-top`, or each link lands its
   * heading underneath the sticky bar. Worst on a phone, where the bar is a
   * larger share of the screen.
   */
  /**
   * A container query carries no specificity of its own, so a base rule further
   * down the file beats the query that was meant to override it. That is how
   * the team name vanished from the schedule rows in the squeeze band: the
   * full spelling was hidden there and the shorter one, held back by a
   * `display: none` written later in the file, never took its place.
   */
  test("the schedule row always shows a team name at every width", async () => {
    const css = await get("/team.css");
    assert.equal(css.status, 200);

    const base = css.body.indexOf(".sct-srow-name-brief {");
    const query = css.body.indexOf("@container (max-width: 700px)");
    assert.ok(base > 0, "the shorter spelling has a base rule");
    assert.ok(query > 0, "the squeeze band has a container query");
    assert.ok(
      base < query,
      "the base rule must precede the query that flips it, or neither name shows",
    );

    // And inside the band, exactly one of the pair is taken out of flow.
    const block = css.body.slice(query, css.body.indexOf("\n}", query));
    assert.match(block, /\.sct-srow-name-long\s*\{[^}]*position:\s*absolute/);
    assert.match(block, /\.sct-srow-name-brief\s*\{[^}]*display:\s*inline/);

    // The query is only answerable if something declares itself the container.
    // Without this the rule never fires at any width and the long name just
    // stays, ellipsed - which is the failure it exists to prevent.
    assert.match(
      css.body,
      /\.sct-sboard\s*\{[^}]*container-type:\s*inline-size/,
      "the board must be the container the row measures itself against",
    );
  });

  test("sections clear the sticky nav when linked to", async () => {
    const css = await get("/team.css");
    assert.match(
      css.body,
      /\.sct-section,\s*\n\.sct-hero\s*\{[^}]*scroll-margin-top:/,
      "sections carry scroll-margin-top for the sticky nav",
    );
  });

  /**
   * The sticky bar has to span the page gutter, or the page is visible
   * scrolling through the strip either side of it. It cancels the gutter with a
   * negative margin, which only works while both come from the same property.
   */
  test("the sticky nav spans the page gutter", async () => {
    const css = await get("/team.css");
    assert.match(
      css.body,
      /\.sct\s*\{[^}]*--sct-gutter:/,
      "the gutter is a custom property",
    );
    assert.match(
      css.body,
      /\.sct-nav\s*\{[^}]*margin:\s*0 calc\(var\(--sct-gutter[^)]*\) \* -1\)/,
      "the nav cancels exactly that gutter",
    );
  });
});

describe("preview switcher", () => {
  /**
   * The development view switcher (lib/devbar.ts) is injected into finished
   * HTML on the way out rather than rendered by either tool, which is what lets
   * it exist at all: the news page's markup IS the WordPress fragment, so a
   * switcher inside the renderer would ship to statchasers.com.
   *
   * The whole arrangement rests on one guard - NODE_ENV - and this suite runs
   * with NODE_ENV=test, so every response here is a response the bar must not
   * be in. That makes this the cheap check that the guard is still wired: if
   * someone injects the bar unconditionally, or moves it into a renderer, one
   * of these routes starts carrying it.
   */
  test("never appears outside development", async () => {
    for (const route of [
      "/",
      "/team",
      "/team/new-england-patriots",
      "/team/new-england-patriots?embed=1",
      "/embed/team/ne",
      "/embed/ssr.html",
      "/player",
      `/player/${playerSlug}`,
      `/embed/player/${playerSlug}`,
      "/fpa",
    ]) {
      const res = await get(route);
      assert.equal(res.status, 200, `${route} should be 200`);
      assert.ok(
        !res.body.includes("scdev"),
        `${route} must not carry the preview switcher`,
      );
    }
  });
});

describe("shortcode preview harness", () => {
  /**
   * /preview/* assembles a fragment the way WordPress assembles it - the
   * plugin's stylesheet and bundle, inside a host page - because the fragment
   * endpoints deliberately ship neither, and a bare fragment in a browser is an
   * unstyled wall of markup you cannot judge anything by.
   *
   * It is development-only for the same reason the dev bar is: it is a SECOND
   * way to assemble the tool, and two differently-assembled copies of the same
   * markup on the public internet is exactly the duplicate-content problem the
   * canonical work exists to avoid. This suite runs with NODE_ENV=test, so the
   * routes must 404 here.
   */
  test("is development-only", async () => {
    for (const route of [
      "/preview/news",
      "/preview/team/new-england-patriots",
      "/preview/team/ne",
      `/preview/player/${playerSlug}`,
      `/preview/raw/player/${playerSlug}`,
      "/preview/fpa",
      "/preview/raw/fpa",
      "/preview/schedule",
      "/preview/raw/schedule",
    ]) {
      const res = await get(route);
      assert.equal(res.status, 404, `${route} must not exist outside development`);
    }
  });

  /**
   * The fragment endpoints must stay bare. If one ever starts shipping its own
   * <link> or executable <script>, WordPress would enqueue the assets a second
   * time and the harness above would stop representing what the plugin does.
   *
   * Two inert payloads are allowed through, neither of which carries code:
   *
   *   an FAQ's questions - `scp-faq-data` on the player mount, `sct-faq-data`
   *   on the team hub, `scf-faq-data` on the FPA table - which the plugin that
   *   owns that mount lifts into Rank Math's graph and strips before any of the
   *   markup is printed, so it never reaches the rendered page at all - and on
   *   the same terms, the team Schedule page's games, `sct-schedule-data`;
   *
   *   the player search's roster, `data-scp-roster`, which does reach the page
   *   and is meant to: it is the list the search above the header filters, and
   *   it is inlined precisely so the fragment needs no request back to this
   *   origin from a page on statchasers.com.
   *
   * Both matched exactly rather than waved past by type, so a real script that
   * happened to sit next to one would still fail this.
   */
  test("the fragments it wraps ship no assets of their own", async () => {
    const INERT = [
      /<script type="application\/json" class="sc[fpt]-faq-data">.*?<\/script>/gs,
      /<script type="application\/json" class="sct-schedule-data">.*?<\/script>/gs,
      /<script type="application\/json" data-scp-roster>.*?<\/script>/gs,
    ];

    for (const route of [
      "/embed/ssr.html",
      "/embed/team/ne",
      `/embed/player/${playerSlug}`,
      "/embed/fpa",
    ]) {
      const res = await get(route);
      assert.equal(res.status, 200);
      assert.ok(!/<link\b/i.test(res.body), `${route} must not carry a stylesheet`);
      const code = INERT.reduce((body, island) => body.replace(island, ""), res.body);
      assert.ok(!/<script\b/i.test(code), `${route} must not carry a script`);
    }
  });
});

describe("the preview switcher never leaves the pane", () => {
  /**
   * Everything in the bar has to be an in-place navigation.
   *
   * The Raw view used to be the exception: it linked straight at
   * /embed/ssr.html, and because the bar is deliberately never injected into a
   * fragment, that link had to carry target="_blank" or it would strand you in
   * bare markup with no way back. A new tab is the wrong answer in a preview
   * pane - the whole point is to alternate between views in one frame - so Raw
   * now points at /preview/raw/*, which shows the same bytes as source on an
   * ordinary page that does carry the bar.
   *
   * Asserted against production output rather than the bar itself, which is
   * absent here: what this locks is the property that made the new tab
   * necessary. If a fragment endpoint ever stops being bare, or the raw view
   * stops existing, the reasoning above needs revisiting.
   */
  test("the raw view shows the same bytes the endpoint serves", async () => {
    // Production: the harness is off, so this is the endpoint on its own.
    const endpoint = await get("/embed/team/ne");
    assert.equal(endpoint.status, 200);
    assert.match(endpoint.body, /data-sct-root/);

    // And it is bare - which is exactly why it cannot carry the bar, and why
    // the source view has to exist at all. The FAQ data island is not an asset
    // and not the bar: it carries no code, and the plugin strips it before the
    // markup is printed. Same exemption, and same exactness, as the asset guard
    // above.
    const withoutIsland = endpoint.body.replace(
      /<script type="application\/json" class="sct-faq-data">.*?<\/script>/gs,
      "",
    );
    assert.ok(!/<link\b/i.test(endpoint.body));
    assert.ok(!/<script\b/i.test(withoutIsland));

    // The source view wrapping it is development-only, like the rest of /preview.
    const raw = await get("/preview/raw/team/ne");
    assert.equal(raw.status, 404, "the source view must not exist in production");
  });
});

/**
 * The WordPress mount's switcher links.
 *
 * `?embed=1` is meaningful only against this origin's own /team/:slug, where it
 * asks for the chrome-less render. Once SC_TEAM_PATH_PREFIX points the switcher
 * at statchasers.com the query is actively harmful: `embed` is a reserved
 * WordPress public query var, so /nfl/teams/<slug>/?embed=1 serves WordPress's
 * oEmbed template instead of the page - 31 of them per team page, each a
 * crawlable variant of a URL that already exists clean.
 *
 * Booted separately from the suite above because the behavior IS the
 * environment: one server cannot answer for both configurations.
 */
describe("the WordPress fragment's team switcher", () => {
  async function fragment(env) {
    const srv = await startServer({ ...replay.env, ...env });
    try {
      const res = await fetch(`${srv.origin}/embed/team/phi`);
      assert.equal(res.status, 200);
      return await res.text();
    } finally {
      await srv.stop();
    }
  }

  test("drops ?embed=1 once the links leave this origin", async () => {
    const html = await fragment({ SC_TEAM_PATH_PREFIX: "/nfl/teams/" });

    const hrefs = [...html.matchAll(/class="sct-switch-team[^"]*"\s+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(hrefs.length, 32, "every team is in the switcher");

    for (const href of hrefs) {
      assert.ok(
        href.startsWith("/nfl/teams/"),
        `switcher link must use the configured prefix, got ${href}`,
      );
      assert.ok(
        !href.includes("embed="),
        `an off-origin switcher link must not carry embed= (${href}) - ` +
          `WordPress serves its oEmbed template for that URL`,
      );
    }
  });

  test("keeps ?embed=1 while the prefix is still this origin's own", async () => {
    const html = await fragment({});
    const hrefs = [...html.matchAll(/class="sct-switch-team[^"]*"\s+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(hrefs.length, 32);
    for (const href of hrefs) {
      assert.match(href, /^\/team\/[a-z0-9-]+\/\?embed=1$/);
    }
  });

  test("SC_TEAM_LINK_QUERY overrides both", async () => {
    const html = await fragment({
      SC_TEAM_PATH_PREFIX: "/nfl/teams/",
      SC_TEAM_LINK_QUERY: "?src=hub",
    });
    assert.match(html, /href="\/nfl\/teams\/dallas-cowboys\/\?src=hub"/);
  });
});

/**
 * The index of all 32, and the fragment the container page mounts.
 *
 * /nfl/teams/ used to be a stub list the plugin wrote into the page once -
 * eight <h2>s and 32 bullets in the theme's own styling, standing in front of
 * 32 hubs that look nothing like it. It has a mount now, and these are what
 * that mount owes: the switcher's grid, all 32 crests, links that leave this
 * origin, and no document furniture, because the WordPress page supplies it.
 */
describe("the team index", () => {
  async function indexFragment(env = {}) {
    const srv = await startServer({ ...replay.env, ...env });
    try {
      const res = await fetch(`${srv.origin}/embed/teams`);
      assert.equal(res.status, 200);
      return { body: await res.text(), headers: res.headers };
    } finally {
      await srv.stop();
    }
  }

  test("the fragment is markup with no document around it", async () => {
    const { body } = await indexFragment();
    assert.ok(!/<!DOCTYPE/i.test(body), "no doctype");
    assert.ok(!/<html|<head|<body/i.test(body), "no document furniture");
    // The container page prints the H1 and the lead; a second one inside the
    // fragment is the duplicate-heading bug every other mount here avoids.
    assert.ok(!/<h1\b/i.test(body), "the fragment never carries an H1");
    assert.ok(!/<title/i.test(body), "and no title");
  });

  test("it is two conference bands of four division cards, with all 32 and their crests", async () => {
    const { body } = await indexFragment();
    const doc = new JSDOM(body).window.document;

    assert.ok(doc.querySelector(".sct-switch-grid.is-index"), "the index grid");
    const links = [...doc.querySelectorAll(".sct-switch-team")];
    assert.equal(links.length, 32, "every team is listed");
    for (const link of links) {
      const logo = link.querySelector("img.sct-switch-logo");
      assert.ok(logo, `${link.textContent.trim()} has a crest`);
      assert.equal(logo.getAttribute("alt"), "", "a crest beside its own name is decorative");
    }

    // Conference, then division: the grouping is what makes 32 links a page a
    // reader can use rather than a column of names.
    assert.equal(doc.querySelectorAll(".sct-switch-conf").length, 2);
    assert.equal(doc.querySelectorAll(".sct-switch-div").length, 8);

    // And the divisions sit four across inside their conference rather than
    // stacked down a column, which is the switcher's shape and the thing this
    // page stopped being. Structural, because the layout itself is CSS: what
    // is asserted here is the wrapper the four-column rule hangs off.
    for (const conf of doc.querySelectorAll(".sct-switch-conf")) {
      const row = conf.querySelector(".sct-index-divs");
      assert.ok(row, "each conference holds its divisions in one row");
      assert.equal(row.querySelectorAll(".sct-index-div").length, 4);
    }
  });

  test("each division card is a standings table: places, W-L-T, PCT, the leader tinted", async () => {
    // The league table the hubs place themselves from (recorded 2026-10-03),
    // printed once for all 32: a reader looking at the league finds the
    // standings, a reader looking for a hub still finds the crest.
    const { body } = await indexFragment();
    const doc = new JSDOM(body).window.document;

    assert.equal(doc.querySelector(".sct-switch-grid.is-index").dataset.standings, "1");
    const cards = [...doc.querySelectorAll(".sct-index-div")];
    assert.equal(cards.length, 8);
    for (const card of cards) {
      assert.ok(card.classList.contains("has-standings"), "every card has its table");
      assert.deepEqual(
        [...card.querySelectorAll(".sct-index-cols span")].map((el) => el.textContent),
        ["W", "L", "T", "PCT"],
      );
      // The four clubs in tiebreaker order, 1 to 4, and exactly one leader.
      assert.deepEqual(
        [...card.querySelectorAll(".sct-index-place")].map((el) => el.textContent),
        ["1", "2", "3", "4"],
      );
      const leaders = card.querySelectorAll("li.is-leader");
      assert.equal(leaders.length, 1);
      assert.equal(leaders[0].querySelector(".sct-index-place").textContent, "1");
      // Every row carries a record with four figures and a bar whose width is
      // the percentage - so a 1.000 is a full bar and a .000 an empty one.
      for (const row of card.querySelectorAll(".sct-switch-team")) {
        const nums = [...row.querySelectorAll(".sct-index-num")].map((el) => el.textContent);
        assert.equal(nums.length, 4, row.textContent);
        assert.match(nums[3], /^(1\.000|\.\d{3})$/, `PCT prints like a standings table (${nums[3]})`);
        const pct = Number(nums[3]);
        const fill = row.querySelector(".sct-index-bar-fill").getAttribute("style");
        assert.equal(fill, `width:${Math.round(pct * 100)}%`);
      }
    }

    // The Bills led the AFC East on the recorded date; the Dolphins were last.
    const east = cards[0];
    assert.equal(east.querySelector(".sct-switch-div-title").textContent, "AFC East");
    const names = [...east.querySelectorAll(".sct-index-name")].map((el) => el.textContent);
    assert.equal(names[0], "Bills");
    assert.equal(names[3], "Dolphins");
    // The nickname is the row; the full club name rides on the link's title.
    assert.equal(east.querySelector(".sct-switch-team").getAttribute("title"), "Buffalo Bills");
  });

  test("without the league table the cards keep every link and drop the numbers", async () => {
    // ESPN down (here: pointed at a path the replay never recorded). The
    // index is 32 links first; a standings outage must not cost it that.
    const { body } = await indexFragment({
      SC_ESPN_SITE_BASE: `${replay.env.SC_ESPN_SITE_BASE}-down`,
    });
    const doc = new JSDOM(body).window.document;
    assert.equal(doc.querySelector(".sct-switch-grid.is-index").dataset.standings, undefined);
    assert.equal(doc.querySelectorAll(".sct-switch-team").length, 32);
    assert.equal(doc.querySelectorAll(".sct-index-rec, .sct-index-place, .sct-index-cols, .is-leader").length, 0);
    // The hover arrow comes back as the row's affordance.
    assert.equal(doc.querySelectorAll(".sct-switch-team .sct-arrow").length, 32);
    // Canonical division order, since there is no table to order by.
    const east = [...doc.querySelector(".sct-index-div").querySelectorAll(".sct-index-name")].map(
      (el) => el.textContent,
    );
    assert.deepEqual(east, ["Bills", "Dolphins", "Patriots", "Jets"]);
  });

  test("the links point at the public site, not at this origin", async () => {
    // Same rule the hub's switcher follows, and for the same reason: a reader
    // clicking a team inside a WordPress page belongs on statchasers.com.
    const { body } = await indexFragment({ SC_TEAM_PATH_PREFIX: "/nfl/teams/" });
    const hrefs = [...body.matchAll(/class="sct-switch-team"\s+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(hrefs.length, 32);
    for (const href of hrefs) {
      assert.match(href, /^\/nfl\/teams\/[a-z0-9-]+\/$/, href);
      assert.ok(
        !href.includes("embed="),
        `an off-origin link must not carry embed= (${href})`,
      );
    }
  });

  test("the standalone page and the fragment list the same 32", async () => {
    // They share one renderer precisely so they cannot drift; this is the
    // assertion that keeps it that way if someone splits them again.
    const srv = await startServer(replay.env);
    try {
      const teamsOf = async (path) => {
        const res = await fetch(`${srv.origin}${path}`);
        assert.equal(res.status, 200, path);
        const doc = new JSDOM(await res.text()).window.document;
        // The name span specifically: the row also carries the hover arrow,
        // which is a span too and would double every count here.
        return [...doc.querySelectorAll(".sct-switch-team .sct-index-name")].map(
          (el) => el.textContent.trim(),
        );
      };
      const page = await teamsOf("/team");
      const fragment = await teamsOf("/embed/teams");
      assert.equal(page.length, 32);
      assert.deepEqual(fragment, page, "the two mounts disagree about the league");
    } finally {
      await srv.stop();
    }
  });

  test("the standalone page opens on the index, with no hero of its own", async () => {
    // It used to carry one: an eyebrow, an H1 and a subtitle over the grid.
    // Both mounts now sit under the heading their host page supplies, which is
    // the division of labor every other fragment here already followed - and
    // the reason this asserts rather than merely no longer testing the hero is
    // that the markup is easy to put back by habit.
    const { doc } = await dom("/team");
    assert.equal(doc.querySelectorAll(".sct-hero").length, 0);
    assert.equal(doc.querySelectorAll("h1").length, 0);
    // The title tag still names the page - the heading went, not the page.
    assert.equal(doc.title, "NFL Team Hubs | StatChasers");
    assert.ok(doc.querySelector(".sct-section"), "the grid still opens it");
  });

  test("it revalidates and keeps this origin out of the index", async () => {
    // Both requests go to the SAME server: the crests are now this origin's
    // own files, printed absolute for the host that was asked, so a fragment
    // from a server on another port is legitimately a different fragment.
    const first = await rawGet("/embed/teams");
    assert.equal(first.status, 200);
    const etag = first.headers["etag"];
    assert.ok(etag, "the fragment is revalidatable");
    assert.match(first.headers["x-robots-tag"], /noindex, indexifembedded/);

    const second = await rawGet("/embed/teams", { "If-None-Match": etag });
    assert.equal(second.status, 304);
    assert.equal(second.body, "", "a 304 carries no body");
  });
});

/**
 * Host-page survivability.
 *
 * The hub is printed into a WordPress page whose theme this server has never
 * seen, and the cascade there is not the cascade in the standalone preview.
 * These assert the two rules that failed in production - a palette published
 * on `:root`, and typography left to inheritance - against the stylesheet as
 * served, because that is what the plugin enqueues.
 *
 * Read from the CSS text rather than by rendering: jsdom does not resolve the
 * cascade, and a real browser is not in this suite's dependencies. The
 * properties below are structural enough that their presence in the file is
 * the whole assertion.
 */
describe("team.css survives a host theme", () => {
  async function css() {
    const res = await get("/team.css");
    assert.equal(res.status, 200, "team.css should be served");
    return res.body;
  }

  test("the palette is not published on :root", async () => {
    const sheet = await css();

    // `:root` is <html>. Every element between it and .sct outranks it for an
    // inherited custom property, so a host that defines any --sc-* name of its
    // own repaints the hub with no contest - statchasers.com defines --sc-navy
    // as #0b3a7a, and the published hero, every h2, the active tab and every
    // solid button drew in it. Declaring on the fragment root instead is what
    // makes the tokens unreachable from above. It also stops the reverse leak:
    // on :root these were overwriting the SITE's --sc-* names for the whole
    // page.
    const rootBlocks = sheet.match(/(^|\})\s*:root\s*\{[^}]*\}/g) ?? [];
    const leaked = rootBlocks.filter((block) => /--sc-/.test(block));
    assert.deepEqual(
      leaked,
      [],
      "custom properties must be declared on .sct / body.sct-page, not :root",
    );

    assert.match(
      sheet,
      /:where\(\.sct\),\s*\n\s*:where\(body\.sct-page\)\s*\{/,
      "the token block is scoped to the fragment root",
    );
    assert.match(sheet, /--sc-navy:\s*#0b1634/, "brand navy is still ours");
  });

  test("typography and list markers are armoured", async () => {
    const sheet = await css();

    // Inheritance loses to any rule naming the element, so `h2 { font-family }`
    // in a theme took every heading in the hub while our own color and size
    // rules kept winning. And the marker belongs to the <li>, so `list-style:
    // none` on the <ul> alone left the tab strip reading "• Stats • News".
    assert.match(
      sheet,
      /font-family:\s*var\(--sc-font\)\s*!important/,
      "the fragment forces its own font family",
    );
    assert.match(
      sheet,
      /\.sct :is\(ul, ol, li\)\s*\{\s*list-style:\s*none\s*!important/,
      "list markers are cleared on the <li>, not only the <ul>",
    );
  });

  /*
   * Every heading class the renderer prints, armed - checked against the
   * RENDERER rather than against a list written out here, because a list
   * written out here is a list that goes stale. Divi's typography panel emits
   * `#left-area h3 { font-size: 38px }`, an id, so a class in this file loses
   * to it unless it says !important; `.sct-faq-q` did not, and shipped an FAQ
   * whose questions rendered at 38px and read as section headings.
   *
   * The size is what is asserted. Color is armed alongside it on most of
   * these but not all - .sct-band-label and friends take a color the theme
   * cannot reach - whereas font-size is the one Divi always sets.
   */
  test("every heading class the hub prints is armoured", async () => {
    const sheet = await css();
    const src = fs.readFileSync(
      new URL("../src/lib/team-render.ts", import.meta.url),
      "utf8",
    );

    // `<h3 class="sct-news-title"` and the two that pick their level at
    // runtime, `<${tag} class="sct-faq-q"`.
    const classes = new Set(
      [...src.matchAll(/<(?:h[1-6]|\$\{\w+\}) class="(sct-[a-z0-9-]+)"/g)].map(
        (m) => m[1],
      ),
    );
    // h2() prints this one through a helper rather than inline.
    classes.add("sct-h2");

    assert.ok(classes.size >= 8, `found only ${classes.size} heading classes`);

    const unarmed = [...classes].filter((cls) => {
      // Anchored to the start of a line so that a DESCENDANT rule - ".sct-hero-text
      // .sct-title", which sets one property and arms nothing - cannot be read
      // as the class's own rule and fail a class that is in fact armoured.
      const rule = sheet.match(
        new RegExp(`(?:^|\\n)\\.${cls} \\{[^}]*\\}`),
      );
      return !rule || !/font-size:[^;]*!important/.test(rule[0]);
    });

    assert.deepEqual(
      unarmed,
      [],
      "these heading classes take the host theme's font-size",
    );
  });

  /*
   * The host column rules used to live in team.css and this test read them
   * from the served sheet. They were moved into the plugin - one copy for all
   * five tools, in `statchasers_team_full_width_css()` - and the assertion was
   * left pointing at the stylesheet, where a comment ABOUT the rules still
   * quotes them. The regex matched that prose, the test went on passing on a
   * file that no longer carried the rules, and then failed on a comment edit.
   * It now reads the file the rules are actually in.
   */
  test("the host's sidebar column is taken back", async () => {
    const plugin = fs.readFileSync(
      new URL(
        "../../../wordpress-plugin/statchasers-news/statchasers-team.php",
        import.meta.url,
      ),
      "utf8",
    );
    const fn = plugin.match(
      /function statchasers_team_full_width_css\(\): string \{[\s\S]*?\n\}/,
    );
    assert.ok(fn, "statchasers_team_full_width_css() is where the rules live");
    const rules = fn[0];

    // Divi puts `width: 79.125%` on the BARE id, not on `.et_right_sidebar`,
    // so the class swap everyone reaches for first is a no-op and the hub
    // renders in three quarters of the page with an empty widget column beside
    // it. Only above 980px, which is why it survived every check on a phone.
    assert.match(
      rules,
      /@media\s*\(min-width:\s*981px\)/,
      "the override is inside a min-width:981px block",
    );
    assert.match(
      rules,
      /#left-area\{[^}]*width:\s*100%\s*!important/,
      "the host column is widened, not merely unfloated",
    );
    assert.match(
      rules,
      /#left-area\{[^}]*float:\s*none\s*!important/,
      "and unfloated too",
    );

    // Taking the sidebar's share back must not mean taking the window. Divi
    // widens the content container on any page that has been through the Divi
    // Builder, so `width: 100%` there meant the whole screen - which is how
    // the hubs came out ~700px wider than the player pages carrying this same
    // stylesheet. The cap is the site's own content width, read from the theme.
    assert.match(
      rules,
      /#left-area\{[^}]*max-width:'\s*\.\s*statchasers_team_content_width\(\)\s*\.\s*'!important/,
      "and held to the site's content column, not the window",
    );
    assert.match(
      rules,
      /#left-area\{[^}]*margin-left:auto!important;margin-right:auto!important/,
      "and centered in it, as the rest of the site's content is",
    );

    // Both of these are the difference between "full width" and "full width
    // with a gray line down it and the widgets dumped underneath".
    assert.match(
      rules,
      /#main-content \.container:before\{display:\s*none\s*!important/,
      "the column divider rule is removed",
    );
    assert.match(
      rules,
      /#sidebar\{display:\s*none\s*!important/,
      "an emptied sidebar cannot land under the hub",
    );
  });

  /*
   * The hub and the player pages have to come out the same width on the same
   * site, and the only way to guarantee that is for neither to carry a width
   * of its own once embedded - the host column decides, and the plugin holds
   * that column to the site's content width for both.
   *
   * This asserts the two stylesheets AGREE rather than asserting a number.
   * A number here would be the same guess that made the hub 1280 while every
   * other tool was 1180.
   */
  test("embedded, the hub takes its width from the host, as player pages do", async () => {
    const sheet = await css();
    const player = await (async () => {
      const res = await get("/player.css");
      assert.equal(res.status, 200, "player.css should be served");
      return res.body;
    })();

    const embedded = (text, cls) => {
      const rule = text.match(
        new RegExp(`\\${cls}\\.is-embed \\{[\\s\\S]*?\\n\\}`),
      );
      assert.ok(rule, `${cls}.is-embed is defined`);
      const width = rule[0].match(/max-width:\s*([^;]+);/);
      assert.ok(width, `${cls}.is-embed states a max-width`);
      return width[1].trim();
    };

    assert.equal(
      embedded(sheet, ".sct"),
      embedded(player, ".scp"),
      "the hub and a player page hand width to the host on the same terms",
    );

    // The standalone measure, which the host never sees, still matches the
    // other four tools. The hub carried 1280 of its own for a while.
    const shell = sheet.match(/--sc-shell:\s*(\d+)px/);
    assert.ok(shell, "--sc-shell is defined");
    assert.equal(shell[1], "1180", "the standalone hub is the tools' measure");
  });

  test("the host page's H1 gets the tool's gold rule", async () => {
    const sheet = await css();

    // Same bar as .sct-h2::after. The token is out of reach outside .sct, so
    // the color is written out - keep it equal to --sc-gold.
    const gold = sheet.match(/--sc-gold:\s*(#[0-9a-f]{6})/i);
    assert.ok(gold, "--sc-gold is defined");
    assert.match(
      sheet,
      new RegExp(
        "#left-area \\.entry-title\\.main_title::after \\{[^}]*width:\\s*44px[^}]*height:\\s*3px[^}]*background:\\s*" + gold[1],
        "i",
      ),
      "the H1 bar is 44x3 in --sc-gold",
    );
    assert.match(
      sheet,
      /\.entry-title\.main_title:empty::after \{\s*display:\s*none/,
      "no bar under an empty title",
    );
  });

  test("the page gutter is a real gutter", async () => {
    const sheet = await css();

    // A find-and-replace once turned 24px into 2.4px here, and 16px into 1.6px
    // on the phone breakpoint - a gutter that is not there.
    assert.match(sheet, /--sct-gutter:\s*24px/, "desktop gutter is 24px");
    assert.doesNotMatch(
      sheet,
      /--sct-gutter:[^;]*\d\.\d+px/,
      "no sub-pixel gutter",
    );
  });
});

/**
 * Section-scoped team URLs.
 *
 * `/team/<slug>/<section>/` is the public address: the one the canonical
 * names, the hub links to and the WordPress rewrite mirrors as
 * /nfl/teams/<slug>/<section>/. `?section=` is the internal spelling the
 * plugin fetches the fragment with. These assertions are what makes the pretty
 * address a different PAGE rather than the hub wearing a second URL. Same
 * contract as the player pages.
 */
describe("the Stats heading", () => {
  /*
   * The heading names the season its NUMBERS describe, not the season the page
   * asked for. getTeamSnapshot() falls back a year while ESPN has nothing for
   * the current one, which through Week 1 is every team - and a heading reading
   * "Bills Team Stats 2026" over a block of 2025 figures is worse than the
   * generic "Team Snapshot" it replaced.
   *
   * Both the heading and the note beneath it are built from `snapshot.season`,
   * so they cannot disagree unless someone re-keys one of them to
   * `state.season`. Asserting that they AGREE tests it on a live page in any
   * week, with no fixture that has to be kept in step with a real season.
   */
  test("the heading and the note describe the same season", async () => {
    const { doc } = await dom("/team/new-england-patriots/stats/");

    const heading = doc.querySelector("[data-sct-panel] .sct-h2");
    assert.ok(heading, "the Stats panel heads itself");

    const headingYear = heading.textContent.match(/\b(2\d{3})\b/);
    assert.ok(headingYear, `the heading carries a season: "${heading.textContent.trim()}"`);

    // In season the heading stands alone (mak, 2026-10-20): the "regular
    // season to date" caption under it is gone. The note renders only in the
    // fallback window, as a warning that the numbers are last season's - and
    // then it must name the same season the heading does.
    const note = heading.parentElement.querySelector(".sct-note");
    if (!note) return;
    const noteYear = note.textContent.match(/\b(2\d{3})\b/);
    assert.ok(noteYear, `the note names a season: "${note.textContent.trim()}"`);

    assert.equal(headingYear[1], noteYear[1], "one season, stated twice");
  });

  /*
   * Read from the SOURCE, deliberately.
   *
   * The test above is the real invariant but it cannot fail today: outside the
   * fallback window `snapshot.season` and `state.season` are the same number,
   * so a page rendered from the wrong one is indistinguishable from a page
   * rendered from the right one. It starts biting exactly when it matters and
   * not one day earlier - which is no use to whoever makes the change.
   *
   * Nothing here stubs ESPN, so there is no way to render the fallback on
   * demand. This is the next best thing: the one line the bug would live on.
   */
  test("the heading is keyed to the snapshot's season, not the page's", async () => {
    const src = fs.readFileSync(
      new URL("../src/lib/team-render.ts", import.meta.url),
      "utf8",
    );

    const call = src.match(/h2\(`\$\{data\.team\.nickname\} Team Stats \$\{([^}]+)\}`\)/);
    assert.ok(call, "the Stats block heads itself with the club and a season");
    assert.equal(
      call[1],
      "snapshot.season",
      "state.season is the season the page ASKED for; through Week 1 the numbers are last season's",
    );
  });

  /*
   * `?h1=1` promotes the panel's opening heading to the page's <h1>. It also
   * has to be part of the fragment cache key, or the first request for a slug
   * decides the answer for every later one - and both directions are wrong:
   *
   *   - plain first: a host running "let the tool supply the heading" gets the
   *     un-promoted render. That mode ALSO empties the theme's page title, so
   *     the page ships with no <h1> at all.
   *   - h1=1 first: a plain mount gets the promoted render and prints two.
   *
   * The order below is the regression, not decoration: the same three requests
   * passed before the fix as long as the promoted one went first.
   */
  test("the promoted heading is cached apart from the plain one", async () => {
    const at = (query) =>
      get(`/embed/team/new-england-patriots?section=stats${query}`);
    const h1s = (body) => (body.match(/<h1\b/g) ?? []).length;

    const before = await at("");
    const promoted = await at("&h1=1");
    const after = await at("");

    assert.equal(h1s(before.body), 0, "a plain fragment prints no H1 of its own");
    assert.equal(h1s(promoted.body), 1, "?h1=1 promotes exactly one heading");
    assert.equal(
      h1s(after.body),
      0,
      "and the promoted render is not served back to a plain request",
    );

    // It is the Stats heading that was promoted, not some other <h2>.
    assert.match(
      promoted.body,
      /<h1 class="sct-h2[^"]*">New England Patriots Stats 2\d{3}<\/h1>/,
      "the H1 is the section's own heading, in the address's words",
    );
  });

  /**
   * Every address its own H1, in the words of what the address is for.
   *
   * The hub used to promote its opening panel's heading, "2026 Fantasy
   * Outlook" - no team in it, the same on all 32 hubs, and word for word the
   * H1 of `/outlook/`, which served the same page. The Outlook is the hub now,
   * and its H1 names the club and the intent.
   */
  test("the hub and each section promote a heading of their own", async () => {
    const h1 = async (query) => {
      const { body } = await get(`/embed/team/new-england-patriots?h1=1${query}`);
      const found = [...body.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
      assert.equal(found.length, 1, `${query || "(hub)"}: exactly one H1`);
      return found[0].replace(/&amp;/g, "&");
    };
    const expected = {
      "": /^New England Patriots Fantasy Football Outlook & Stats 2\d{3}$/,
      // Still asked for by anything holding the old spelling: it gets the hub.
      "&section=outlook": /^New England Patriots Fantasy Football Outlook & Stats 2\d{3}$/,
      "&section=stats": /^New England Patriots Stats 2\d{3}$/,
      "&section=schedule": /^New England Patriots Schedule$/,
      "&section=depth-chart": /^New England Patriots Depth Chart$/,
      "&section=matchups": /^New England Patriots Matchups 2\d{3}$/,
      "&section=news": /^New England Patriots News 2\d{3}$/,
    };
    for (const [query, heading] of Object.entries(expected)) {
      assert.match(await h1(query), heading, query || "(hub)");
    }

    const { doc } = await dom("/embed/team/new-england-patriots?h1=1&section=outlook");
    assert.equal(doc.querySelectorAll("[data-sct-panel]").length > 1, true, "the hub, not one panel");
    const tab = doc.querySelector('.sct-nav-link[data-sct-panel-id="outlook"]');
    assert.match(
      tab.getAttribute("data-sct-heading"),
      /^New England Patriots Fantasy Football Outlook & Stats 2\d{3}$/,
      "the Outlook tab hands the host the hub's heading",
    );
  });

  test("it names the club, so 32 pages do not share one H1", async () => {
    const seen = new Set();
    for (const slug of ["new-england-patriots", "buffalo-bills", "dallas-cowboys"]) {
      const { doc } = await dom(`/team/${slug}/stats/`);
      const own = doc.querySelector("[data-sct-panel] .sct-h2");
      assert.ok(own, `${slug}: the section heads itself`);
      seen.add(own.textContent.trim());
    }
    assert.equal(seen.size, 3, `each club gets its own heading: ${[...seen].join(" | ")}`);
  });
});

describe("the Stats ladders never mix weeks", () => {
  /*
   * Two sources feed the Stats tab on two clocks: the stats provider's
   * document is live and cumulative, data/team/efficiency_<season>.json moves
   * when its builder runs. On 2026-10-26 the Bears' Defense Efficiency ladder
   * printed Week 6 EPA rows over Week 7 yardage rows under one "through Week
   * 6" caption (mak: "we can't be mixing weeks like this"). Since then every
   * row on the Efficiency, Pass Protection and Pass Rush ladders comes from
   * the file, and every ladder's caption names the week its own source has
   * reached.
   *
   * The replayed provider document is from 2026-09-30 and the file is
   * whatever the last build wrote, so the two sources sit weeks apart here:
   * exactly the state that used to leak into one ladder.
   */
  const ladders = (doc, kind) => [...doc.querySelectorAll(`.sct-ladder[data-kind="${kind}"]`)];
  const captionWeek = (ladder) => {
    const caption = ladder.querySelector(".sct-ladder-caption")?.textContent ?? "";
    const m = caption.match(/through Week (\d+)/);
    return m ? Number(m[1]) : null;
  };
  const cell = (ladder, label) => {
    for (const li of ladder.querySelectorAll(".sct-stat")) {
      if (li.querySelector(".sct-stat-label")?.firstChild?.textContent?.trim() === label) {
        return li.querySelector(".sct-stat-value")?.textContent?.trim() ?? null;
      }
    }
    return null;
  };

  test("the play-by-play ladders carry the file's week and the file's numbers", async () => {
    const { doc } = await dom("/team/new-england-patriots/stats/");
    const heading = doc.querySelector("[data-sct-panel] .sct-h2");
    const season = heading?.textContent.match(/\b(2\d{3})\b/)?.[1];
    assert.ok(season, "the Stats panel names its season");

    let file;
    try {
      file = JSON.parse(
        fs.readFileSync(path.join(APP_DIR, "data", "team", `efficiency_${season}.json`), "utf8"),
      );
    } catch {
      // No file for the season: the provider's rows stand in, one source still.
      return;
    }
    const team = file.teams?.ne;
    assert.ok(team, "the file carries the Patriots");

    const efficiency = ladders(doc, "efficiency");
    const passRush = ladders(doc, "passrush");
    assert.equal(efficiency.length, 2, "an Efficiency ladder per unit");
    assert.equal(passRush.length, 2, "Pass Protection and Pass Rush");

    for (const ladder of [...efficiency, ...passRush]) {
      assert.equal(
        captionWeek(ladder),
        file.throughWeek,
        `${ladder.querySelector(".sct-ladder-title")?.textContent}: the caption is the file's week`,
      );
    }

    // The yardage rows and the sack counts read the FILE, not the provider:
    // the values on the page are the file's values for this club.
    const [offEff, defEff] = efficiency;
    const [protection, rush] = passRush;
    const fixed = (metric, places) =>
      metric && typeof metric.value === "number" ? metric.value.toFixed(places) : null;
    if (team.offense.yardsPerPlay) {
      assert.equal(cell(offEff, "Yds/Play"), fixed(team.offense.yardsPerPlay, 2));
      assert.equal(cell(offEff, "Passer Rtg"), fixed(team.offense.passerRating, 1));
    }
    if (team.defense.yardsPerPassAttempt) {
      assert.equal(cell(defEff, "Yds/Pass Att"), fixed(team.defense.yardsPerPassAttempt, 2));
      assert.equal(cell(defEff, "Yds/Carry"), fixed(team.defense.yardsPerCarry, 2));
    }
    if (team.offense.sacks) {
      assert.equal(cell(protection, "Sacks Allowed"), String(team.offense.sacks.value));
    }
    if (team.defense.sacks) {
      assert.equal(cell(rush, "Sacks"), String(team.defense.sacks.value));
    }
  });

  test("every ladder says which week its source has reached", async () => {
    const { doc } = await dom("/team/new-england-patriots/stats/");
    const all = [...doc.querySelectorAll(".sct-ladder")];
    assert.ok(all.length >= 6, `the Stats tab renders its ladders (${all.length})`);
    for (const ladder of all) {
      const title = ladder.querySelector(".sct-ladder-title")?.textContent;
      assert.ok(captionWeek(ladder), `${title}: the caption names a week`);
    }
    // Within a bucket the two units agree with each other, whatever the
    // sources say to one another.
    for (const kind of ["efficiency", "passrush", ""]) {
      const weeks = new Set(
        all
          .filter((l) => (l.getAttribute("data-kind") ?? "") === kind)
          .map(captionWeek),
      );
      assert.equal(weeks.size, 1, `one week per bucket (${kind || "production"}): ${[...weeks]}`);
    }
  });

  /*
   * Read from the source: the provider's per-play rows must not be dealt onto
   * the play-by-play ladders beside the file's rows, which is the mix itself.
   */
  test("the Efficiency ladders are built from the file alone when it exists", () => {
    const src = fs.readFileSync(
      new URL("../src/lib/team-render.ts", import.meta.url),
      "utf8",
    );
    const block = src.slice(src.indexOf('"Offense Efficiency"'), src.indexOf('"Pass Rush"'));
    assert.ok(block.length > 0, "the Efficiency ladders are rendered");
    assert.ok(
      !/\.\.\.pickRows\(stats\.(offense|defense|situational)/.test(block),
      "no provider rows are spread in beside the file's rows",
    );
    assert.ok(
      /eff \? efficiencyRows\(eff, "offense"\) : pickRows\(/.test(block),
      "the provider's rows stand in only when there is no file",
    );
  });
});

describe("team section URLs", () => {
  /**
   * The heading each section prints for itself - NOT the H1.
   *
   * The hero is the club's name on every one of these addresses. It used to
   * take the page's subject instead ("New England Patriots Depth Chart 2026"),
   * which meant the header rewrote itself on every tab a reader clicked; the
   * phrase belongs to the section, and the document title is what names the
   * address.
   */
  // No Outlook: it is the hub, and `/outlook/` 301s there.
  const SECTIONS = [
    ["stats", /^Patriots Team Stats 2\d{3}$/],
    ["schedule", /Patriots Schedule$/],
    ["depth-chart", /^New England Patriots Depth Chart$/],
  ];
  const TEAM = "New England Patriots";
  const at = (id) => `/team/new-england-patriots/${id}/`;

  test("each section is one panel, named for what it holds", async () => {
    for (const [id, heading] of SECTIONS) {
      const { doc } = await dom(at(id));

      const root = doc.querySelector("[data-sct-root]");
      assert.equal(root.getAttribute("data-section"), id, `${id}: scoped root`);

      const panels = doc.querySelectorAll("[data-sct-panel]");
      assert.equal(panels.length, 1, `${id}: exactly one panel`);
      assert.equal(panels[0].getAttribute("id"), id, `${id}: it is the right one`);

      const h1 = doc.querySelectorAll("h1");
      assert.equal(h1.length, 1, `${id}: exactly one H1`);
      assert.equal(h1[0].textContent.trim(), TEAM, `${id}: the H1 is the club`);

      const own = panels[0].querySelector(".sct-h2");
      assert.ok(own, `${id}: the section heads itself`);
      assert.match(own.textContent.trim(), heading, `${id}: and it names the section`);
    }
  });

  test("the head names the section, once, at its pretty address", async () => {
    // One of each, and every URL-bearing tag is the pretty self-reference -
    // never the hub, never the ?section= spelling. The Rank Math filters on the
    // WordPress side owe the same four things; this is the origin's half.
    for (const [id] of SECTIONS) {
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
      // Scoped to the head for the reason player.test.mjs is: an <svg> may
      // carry a <title> of its own, and that one is a graphic's name rather
      // than a second document title.
      one("head > title");
      one('meta[name="description"]');
      one('meta[name="robots"]');
    }
  });

  /**
   * The two public sections that draw no questions: `matchups` is a list of
   * fixtures and `news` is an archive, and neither has anything an FAQ would
   * restate. They are still addresses, so they owe everything an address owes
   * - one panel, one H1, one self-referencing canonical - which is what the
   * FAQ-bearing list above cannot assert for them.
   */
  test("the FAQ-less sections are still pages of their own", async () => {
    for (const [id, heading] of [
      ["matchups", /^Patriots Matchups$/],
      ["news", /^Latest Patriots News$/],
    ]) {
      const { doc } = await dom(at(id));

      const panels = doc.querySelectorAll("[data-sct-panel]");
      assert.equal(panels.length, 1, `${id}: exactly one panel`);
      assert.equal(panels[0].getAttribute("id"), id, `${id}: it is the right one`);

      const h1 = doc.querySelectorAll("h1");
      assert.equal(h1.length, 1, `${id}: exactly one H1`);
      assert.equal(h1[0].textContent.trim(), TEAM, `${id}: the H1 is the club`);

      const own = panels[0].querySelector(".sct-h2");
      assert.ok(own, `${id}: the section heads itself`);
      assert.match(own.textContent.trim(), heading, `${id}: and it names the section`);

      const canonical = doc
        .querySelector('link[rel="canonical"]')
        .getAttribute("href");
      assert.ok(canonical.endsWith(at(id)), `${id}: canonical is the pretty path`);
    }
  });

  test("a section page carries the strip, marking the one it is", async () => {
    // It used to carry none, on the grounds that five tabs all leaving the URL
    // is navigation pretending to be tabs. That was right while they were
    // `#hash` links and wrong once they became addresses: a reader who arrived
    // here from search had no way to reach the other five, and those five had
    // nothing linking to them.
    for (const [id] of SECTIONS) {
      const { doc } = await dom(at(id));
      const links = [...doc.querySelectorAll(".sct-nav-link")];
      assert.ok(links.length > 1, `${id}: the strip is here`);

      const current = links.filter((a) => a.classList.contains("is-active"));
      assert.equal(current.length, 1, `${id}: one tab marked current`);
      assert.equal(
        current[0].getAttribute("data-sct-panel-id"),
        id,
        `${id}: and it is this one`,
      );

      // One panel still. The strip navigates; it does not smuggle the other
      // five sections onto an address that promised one.
      assert.equal(
        doc.querySelectorAll("[data-sct-panel]").length,
        1,
        `${id}: still exactly one panel`,
      );
      assert.equal(doc.querySelectorAll(".sct-pages").length, 0, `${id}: no link strip`);
    }
  });

  /**
   * The whole point of the tab strip being addresses.
   *
   * Without JavaScript a tab is a link and loads the section page - which the
   * tests above cover. With it, the panel switches in place and the URL still
   * becomes the section's own, so what the reader is looking at and what the
   * address bar says cannot disagree. This asserts the three things that have
   * to move together, and that Back moves them all back.
   */
  test("a tab click switches in place and takes the URL with it", async () => {
    const { window, doc, errors } = await hydrated("/team/new-england-patriots");
    assert.deepEqual(errors, [], "the bundle ran without throwing");

    const heading = doc.querySelector("h1");
    const landed = heading.textContent.trim();

    // Coaching: a hub-only panel, so it switches in place. Stats owns an
    // address and is not printed here - its tab is a plain link, below.
    const coaching = doc.querySelector('.sct-nav-link[data-sct-panel-id="coaching"]');
    assert.ok(coaching, "the Coaching tab is there");

    coaching.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    assert.equal(
      window.location.pathname + window.location.hash,
      "/team/new-england-patriots/#coaching",
      "the address bar names the section",
    );
    assert.ok(
      doc.getElementById("coaching").classList.contains("is-active"),
      "the coaching panel is the one showing",
    );
    assert.equal(
      doc.getElementById("outlook").classList.contains("is-active"),
      false,
      "and the one it replaced is not",
    );
    assert.equal(
      heading.textContent.trim(),
      landed,
      "the H1 did not follow - the hero is the club on every tab",
    );

    // Nothing loaded: the hub's other panels are still in the document, which
    // is what separates this from having navigated.
    assert.equal(doc.querySelectorAll("[data-sct-panel]").length >= 2, true);

    // The Stats tab is a link to the Stats page and nothing else: no panel of
    // its own here, no tab role claimed for it, and the strip is not a
    // tablist, because a tablist whose children load other pages lies to a
    // screen reader. The hub's own tabs mark the current one with aria-current.
    const stats = doc.querySelector('.sct-nav-link[data-sct-panel-id="stats"]');
    assert.ok(stats, "the Stats tab is there");
    assert.equal(stats.getAttribute("href"), "/team/new-england-patriots/stats/");
    assert.equal(doc.getElementById("stats"), null, "the Stats panel is not on the hub");
    assert.equal(stats.getAttribute("role"), null);
    assert.equal(doc.querySelector(".sct-nav-list").getAttribute("role"), null);
    assert.equal(coaching.getAttribute("aria-current"), "true");
    // Intent prefetches the page the link leads to.
    stats.dispatchEvent(new window.Event("mouseenter"));
    assert.ok(
      doc.querySelector('link[rel="prefetch"][href="/team/new-england-patriots/stats/"]'),
      "hovering the Stats tab prefetches the Stats page",
    );

    window.history.back();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(window.location.pathname, "/team/new-england-patriots");
    assert.equal(heading.textContent.trim(), landed, "Back restores the heading");
    assert.ok(doc.getElementById("outlook").classList.contains("is-active"));
  });

  test("a section page heads its panel, and never twice", async () => {
    // The mirror of what this used to assert. While the hero carried the
    // section's phrase, these three dropped their own heading so it was not
    // printed twice; the hero is the club's name now, so the section's heading
    // is back - and it is still the only one.
    for (const id of ["schedule", "depth-chart", "matchups"]) {
      const { doc } = await dom(at(id));
      const h1 = doc.querySelector("h1").textContent.trim();
      const headings = [...doc.querySelectorAll(`#${id} h2`)].map((h) =>
        h.textContent.trim(),
      );
      assert.ok(headings.length > 0, `${id}: the panel is headed`);
      for (const text of headings) {
        assert.notEqual(text, h1, `${id}: the hero's name printed twice`);
      }
      assert.equal(
        new Set(headings).size,
        headings.length,
        `${id}: no heading printed twice`,
      );
    }
  });

  test("the FAQ describes the page it is on, not the hub", async () => {
    const nodes = (doc) =>
      [...doc.querySelectorAll('script[type="application/ld+json"]')]
        .map((n) => JSON.parse(n.textContent))
        .filter((json) => json["@type"] === "FAQPage");

    // All four public sections draw questions now, so the thing each page owes
    // is that its FAQPage is ITS list - the hub's four lists on a Schedule page
    // is structured data describing a page the reader is not on.
    for (const [id] of SECTIONS) {
      const { doc } = await dom(at(id));
      const scoped = nodes(doc);
      assert.equal(scoped.length, 1, `${id}: one FAQPage of its own`);

      const asked = [...doc.querySelectorAll(`${tailOf(id)} .sct-faq-q`)].map((q) =>
        q.textContent.trim(),
      );
      assert.ok(asked.length > 0, `${id}: the page asks something`);
      assert.deepEqual(scoped[0].mainEntity.map((q) => q.name), asked);
      // Nothing from the other tabs rode along in the markup either.
      assert.equal(
        doc.querySelectorAll(".sct-faq-q").length,
        asked.length,
        `${id}: only its own questions are on the page`,
      );
    }
  });

  test("the title and description are written for the section's query", async () => {
    // MIRRORED IN PHP: statchasers_team_section_meta() builds the same strings
    // for Rank Math, which is what actually ranks. If these change, that
    // changes too.
    // Sixty characters at most and no " | StatChasers" (mak, 2026-10-08):
    // a twenty-letter name lands on the shorter rung of each ladder.
    const expected = {
      stats: "New England Patriots Stats 2026: Offense & Defense Rankings",
      // The full ladder rung is 63 characters for this club, so fitTitle()
      // drops to the second one; "Indianapolis Colts" keeps "& Results".
      schedule: "New England Patriots Schedule 2026: Dates, Times & TV",
      "depth-chart": "New England Patriots Depth Chart 2026: Starters & Backups",
      news: "New England Patriots News 2026: Injuries & Roster Moves",
      matchups: "New England Patriots Matchups 2026: Opponents & Head-to-Head",
    };
    for (const [id, title] of Object.entries(expected)) {
      const { doc } = await dom(at(id));
      assert.equal(doc.querySelector("title").textContent, title);
      assert.ok(title.length <= 60, `${id}: ${title.length} characters`);
      assert.ok(
        (doc.querySelector('meta[name="description"]')?.content ?? "").length > 80,
        `${id}: carries its own description`,
      );
    }
  });

  test("a section that is not public is a 404, not a copy of the hub", async () => {
    // Any path segment resolving to the hub is an unbounded supply of
    // indexable duplicates. `news` is public now, so the list that must 404 is
    // the sections this page does not have and the spellings it does not use.
    for (const id of ["not-a-real-section", "overview", "Stats", "NEWS"]) {
      const res = await get(`/team/new-england-patriots/${id}/`);
      assert.equal(res.status, 404, `${id}`);
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
    }
    assert.equal((await get("/team/nowhere/stats/")).status, 404, "unknown team");
  });

  test("the ?section= spelling redirects to the pretty address", async () => {
    // One address per page. The query form is what the plugin fetches the
    // fragment with; a reader or crawler holding it is sent to the real one.
    for (const [path, target] of [
      ["/team/new-england-patriots?section=stats", "/team/new-england-patriots/stats/"],
      ["/team/ne?section=schedule", "/team/new-england-patriots/schedule/"],
      ["/team/ne/depth-chart/", "/team/new-england-patriots/depth-chart/"],
      // The Outlook is the hub, so both of its spellings land there.
      ["/team/ne?section=outlook&embed=1", "/team/new-england-patriots?embed=1"],
      ["/team/new-england-patriots/outlook/", "/team/new-england-patriots"],
      ["/team/new-england-patriots/outlook/?embed=1", "/team/new-england-patriots?embed=1"],
      ["/team/ne/outlook/", "/team/new-england-patriots"],
    ]) {
      const res = await get(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get("location"), target, path);
    }
  });

  test("an unrecognized ?section= still falls through to the hub", async () => {
    // Defensive: a stale link is worth a full page, not a 404 - the pretty
    // route is where a bad section is refused.
    for (const query of ["?section=bogus", "?section=", ""]) {
      const { doc } = await dom(`/team/new-england-patriots${query}`);
      assert.ok(doc.querySelectorAll(".sct-nav-link").length > 1, `${query || "(none)"}: the hub`);
      assert.equal(doc.querySelector("[data-sct-root]").getAttribute("data-section"), null);
    }
  });

  test("the WordPress fragment scopes with ?section=", async () => {
    const scoped = await get("/embed/team/ne?section=depth-chart");
    assert.equal(scoped.status, 200);
    assert.match(scoped.body, /data-section="depth-chart"/);
    // The strip is here too, and its links are the public section addresses -
    // which on a WordPress mount are statchasers.com's, not this origin's.
    assert.match(scoped.body, /sct-nav-link/, "the scoped fragment carries the strip");
    assert.ok(!/<h1\b/i.test(scoped.body), "the fragment never carries an H1");
    assert.ok(!/sct-pages/.test(scoped.body), "no link strip in a fragment");
  });

  test("a section render is cached apart from the hub's", async () => {
    const hub = await get("/embed/team/ne");
    const scoped = await get("/embed/team/ne?section=schedule");
    assert.notEqual(hub.headers.get("etag"), scoped.headers.get("etag"));
    assert.match(hub.body, /sct-nav-link/);
    // Both carry the strip now, so what separates them is the panel count: the
    // hub ships every section, a scoped render ships one.
    assert.ok(
      (hub.body.match(/data-sct-panel/g) ?? []).length >
        (scoped.body.match(/data-sct-panel/g) ?? []).length,
    );
  });

  /**
   * The Schedule page's structured data is its games, not an application.
   *
   * The plugin used to hang a SoftwareApplication node on every team URL, and
   * Search Console flagged each one for the software-app rich result's missing
   * rating. What replaced it is an ItemList of SportsEvents, carried as an inert
   * island the plugin grafts into Rank Math's graph - and only on the Schedule
   * page, because on the hub it would describe one tab of five.
   */
  test("the Schedule fragment carries its games as an ItemList of SportsEvents", async (t) => {
    const scoped = await get("/embed/team/ne?section=schedule");
    assert.equal(scoped.status, 200);
    assert.ok(!/SoftwareApplication|WebApplication/.test(scoped.body));

    const island = scoped.body.match(
      /<script type="application\/json" class="sct-schedule-data">(.*?)<\/script>/s,
    );
    if (/temporarily unavailable/.test(scoped.body)) {
      assert.equal(island, null, "no schedule, no list");
      t.skip("schedule provider unreachable from this host");
      return;
    }
    assert.ok(island, "the Schedule fragment must carry the schedule island");

    const list = JSON.parse(island[1]);
    assert.equal(list["@type"], "ItemList");
    assert.ok(list.itemListElement.length > 0);
    assert.equal(list.numberOfItems, list.itemListElement.length);
    list.itemListElement.forEach((entry, i) => {
      assert.equal(entry.position, i + 1);
      const game = entry.item;
      assert.equal(game["@type"], "SportsEvent");
      // Google reads these as Events: without either, Search Console errors.
      assert.ok(game.startDate, "every game has a startDate");
      assert.ok(game.location?.name, "every game has a location");
      assert.match(game.name, /New England Patriots/);
      assert.ok(
        [game.homeTeam.name, game.awayTeam.name].includes("New England Patriots"),
      );
    });
    assert.ok(!/aggregateRating|review/i.test(island[1]));

    const hub = await get("/embed/team/ne");
    assert.ok(!/sct-schedule-data/.test(hub.body), "the hub carries no game list");
  });
});

describe("draft tab FAQ (mak, 2026-11-02)", () => {
  test("a club-specific FAQ closes the tab, every figure the view's own, and the questions are in the FAQPage", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    assert.ok(doc.getElementById("draft"), "the Draft panel is in the hub");
    const faq = doc.querySelector(`${tailOf("draft")} .sct-dr-faq`);
    assert.ok(faq, "the FAQ block is the Draft tail");
    assert.equal(faq.querySelector("h2").textContent, "New England Patriots Draft Picks & History FAQ");
    const items = [...faq.querySelectorAll(".sct-faq-item")];
    const qs = items.map((d) => d.querySelector("h3.sct-faq-q").textContent);
    assert.ok(qs.length >= 12 && qs.length <= 16, `${qs.length} questions`);
    const capital = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_picks_2027.json"), "utf8")).teams.ne;
    const history = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_history.json"), "utf8")).teams.ne;
    // The pick count and the pick-by-round list come from the capital file.
    assert.equal(qs[0], "How many picks do the Patriots have in the 2027 NFL Draft?");
    assert.ok(items[0].textContent.includes(`currently hold ${capital.holds.length} picks in the 2027 NFL Draft`));
    const byRound = [...items[1].querySelectorAll("ul.sct-faq-list li")].map((li) => li.textContent);
    assert.equal(byRound.length, new Set(capital.holds.map((h) => h.round)).size);
    assert.equal(byRound[0], "Round 1: Patriots' own pick");
    // The first-round list is the last five classes' Round 1 picks, newest first.
    const firsts = history.filter((p) => p.season >= 2022 && p.round === 1).sort((a, b) => b.season - a.season);
    const r1 = items.find((d) => /last .* first-round draft picks/.test(d.textContent));
    const lines = [...r1.querySelectorAll("ul.sct-faq-list li")].map((li) => li.textContent);
    assert.deepEqual(lines, firsts.map((p) => `${p.season}: ${p.name}, ${{ OT: "offensive tackle", QB: "quarterback", DB: "defensive back", OL: "offensive lineman" }[p.position]}, Pick No. ${p.pick}`));
    // The class count is the history file's.
    const total = history.filter((p) => p.season >= 2022).length;
    assert.ok(faq.textContent.includes(`The Patriots selected ${total} players from the 2022 through 2026 NFL Drafts.`));
    assert.ok(qs.includes("When did the Patriots draft Drake Maye?"));
    assert.ok(qs.includes("Do the Patriots have a first-round pick in the 2027 NFL Draft?"));
    // In the FAQPage (mak approved 2026-11-02), list answers as lines.
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join("");
    assert.ok(ld.includes("What draft picks do the Patriots have in 2027?"));
    assert.ok(ld.includes("- Round 1: Patriots' own pick"));
  });
});

describe("draft tab", () => {
  test("the hub carries the next draft's picks by round and the last five classes", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const panel = doc.getElementById("draft");
    assert.ok(panel, "the Draft panel is in the hub");
    assert.equal(doc.querySelector('.sct-nav-link[data-sct-panel-id="draft"]')?.textContent, "Draft");

    // Right of Stats on the strip (mak, 2026-10-23).
    const ids = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.getAttribute("data-sct-panel-id"));
    assert.equal(ids[ids.indexOf("stats") + 1], "draft", "Draft sits next to Stats");

    // One continuous view (mak, 2026-10-29): picks above history, no switch.
    assert.equal(panel.querySelectorAll("[data-sct-dc-view], [data-sct-dc]").length, 0, "no view switch");
    const stacked = [...panel.querySelectorAll("[data-sct-dr-panel]")].map((s) => s.getAttribute("data-sct-dr-panel"));
    assert.deepEqual(stacked, ["picks", "history"]);
    assert.ok(!panel.querySelector("[data-sct-dr-panel][hidden]"), "both panels show");

    // Picks: a seven-row dot ledger (2026-10-29), each row counting what the club holds.
    const rounds = [...panel.querySelectorAll(".sct-dr-ledger .sct-dr-row")];
    assert.equal(rounds.length, 7, "one row per round");
    const picks = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_picks_2027.json"), "utf8"),
    );
    const held = picks.teams.ne.holds.length;
    assert.equal(
      rounds.reduce((n, r) => n + Number(r.getAttribute("data-count")), 0),
      held,
      "the rows add up to the picks the file holds",
    );
    assert.match(panel.querySelector(".sct-dr-strip .sct-dr-num")?.textContent ?? "", new RegExp(`^${held}$`));
    assert.ok(panel.querySelector(".sct-dr-ledger .sct-dr-dot.is-own"), "an own pick is a filled dot");
    assert.equal(
      panel.querySelectorAll(".sct-dr-ledger .sct-dr-dot.is-own, .sct-dr-ledger .sct-dr-dot.is-from").length,
      held,
      "one dot per pick held",
    );
    assert.equal(panel.querySelectorAll(".sct-dr-legend .sct-dr-legend-item").length, 3, "a three-item legend");
    assert.ok(panel.querySelector(".sct-dr-kicker")?.textContent?.length, "a kicker line");
    assert.equal(panel.querySelector(".sct-dr-tile"), null, "the tiles are gone");

    // History: one table per draft, newest first, from the register.
    const seasons = [...panel.querySelectorAll(".sct-dr-season .sct-dr-h4")].map((h) => h.textContent);
    assert.equal(seasons.length, 5, "five draft classes");
    assert.deepEqual(seasons, [...seasons].sort().reverse(), "newest first");
    const history = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_history.json"), "utf8"),
    );
    const latest = history.teams.ne.filter((p) => p.season === history.latestSeason);
    const firstTable = panel.querySelector(".sct-dr-table tbody");
    assert.equal(firstTable.querySelectorAll("tr").length, latest.length, "every pick of the latest draft");
    assert.equal(firstTable.querySelector("tr .sct-dr-name")?.textContent, latest[0].name);

    // Player column: a headshot well ahead of every name, the photo through
    // the image route for every pick the register paired with a Sleeper id
    // (mak, 2026-10-29: "add player images"); a pick without one keeps the
    // empty well so the names line up.
    const playerCells = [...panel.querySelectorAll(".sct-dr-table tbody th.is-player")];
    assert.ok(playerCells.every((c) => c.querySelector(".sct-dr-player > .sct-dr-face")), "every name has a face well");
    const withPhoto = playerCells.filter((c) => c.querySelector(".sct-dr-face img"));
    assert.ok(withPhoto.length > 0, "at least one pick has a photo");
    for (const c of withPhoto) {
      const img = c.querySelector(".sct-dr-face img");
      assert.match(img.getAttribute("src"), /\/news-image\/player\/\d+\/(latest|[0-9a-f]{10})\/160\.webp$/);
      assert.equal(img.getAttribute("alt"), "", "decorative: the name is beside it");
      assert.equal(img.getAttribute("loading"), "lazy");
    }
    const paired = latest.filter((p) => p.sleeperId);
    assert.ok(paired.length > 0, "the register pairs Sleeper ids");
    const firstRows = [...firstTable.querySelectorAll("tr")];
    for (const p of paired) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      assert.match(row.querySelector(".sct-dr-face img")?.getAttribute("src") ?? "", new RegExp(`/news-image/player/${p.sleeperId}/`), `${p.name} wears their own photo`);
    }

    // College column: the school's crest in a small square beside its
    // written-out name, through the image route's college source (same
    // date, "add college images"); a school with no pairing keeps the square.
    const logos = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "college_logos.json"), "utf8"));
    const collegeCells = [...panel.querySelectorAll(".sct-dr-table td.is-college")];
    assert.ok(collegeCells.every((c) => c.querySelector(".sct-dr-college > .sct-dr-crest + .sct-dr-college-name")), "crest square then the name");
    for (const p of latest) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      const logo = logos.logos[p.college];
      const img = row.querySelector(".sct-dr-crest img");
      if (logo) {
        assert.match(img?.getAttribute("src") ?? "", new RegExp(`/news-image/college/${logo.id}/(latest|[0-9a-f]{10})/80\\.webp$`), `${p.college} crest`);
        assert.match(img.getAttribute("srcset"), /80\.webp 80w, .*160\.webp 160w$/);
        assert.equal(img.getAttribute("alt"), "");
      } else {
        assert.equal(img, null, `${p.college} has no crest`);
      }
    }
    assert.ok(panel.querySelector(".sct-dr-crest img"), "at least one crest");

    // Status column: roster standing from the weekly rosters (mak,
    // 2026-10-29: "active, waived, traded, etc."), with where a departed
    // player is now on a second line; the old participation tiers are gone.
    const statusDoc = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_status.json"), "utf8"));
    const statusCells = [...panel.querySelectorAll(".sct-dr-table td.is-status")];
    const labels = new Set(statusCells.map((c) => c.querySelector(".sct-dr-status").textContent));
    for (const old of ["Starter", "Regular", "Rotational", "Limited", "No games", "Not active"]) assert.ok(!labels.has(old), `${old} is gone`);
    assert.ok(labels.has("Active"), "the current class is active");
    for (const p of latest) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      const entry = statusDoc.players[p.gsisId];
      const cell = row.querySelector("td.is-status");
      if (!entry) continue;
      if (entry.left) {
        assert.equal(cell.querySelector(".sct-dr-status").getAttribute("data-status"), entry.left.kind, `${p.name} shows how they left`);
        if (entry.now.kind !== "none" && entry.left.kind !== "retired") assert.match(cell.querySelector(".sct-dr-status-sub")?.textContent ?? "", /^now /, `${p.name} says where they are now`);
      } else {
        assert.equal(cell.querySelector(".sct-dr-status").getAttribute("data-status"), entry.now.kind, `${p.name} shows their standing`);
      }
      // No row is muted (mak, 2026-10-29: "do not fade out players who are not on the team").
      assert.ok(!row.classList.contains("is-gone"), `${p.name} reads like every other row`);
    }
    // The Status footnote came out the same day.
    assert.equal(panel.querySelector(".sct-dr-classes .sct-dr-foot"), null, "no footnote under the tables");

    // No outside source is named in the page.
    assert.doesNotMatch(panel.innerHTML, /nflverse|tankathon|pro-football-reference|espn/i);
  });
});

describe("contracts tab", () => {
  test("with the bundle, a head press sorts the sheet and a second press flips it (mak, 2026-11-02)", async () => {
    const { doc, window, errors } = await hydrated("/team/new-england-patriots/");
    const table = doc.querySelector(".sct-ct-table");
    const apy = table.querySelector("thead th.is-apy");
    const nums = () =>
      [...table.querySelectorAll("tbody tr")].map((tr) => tr.querySelector(".is-apy").dataset.sort).filter((v) => v !== "");
    const sortedDesc = (a) => a.every((v, i) => i === 0 || Number(a[i - 1]) >= Number(v));
    apy.querySelector("[data-sct-ct-sort]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(apy.getAttribute("aria-sort"), "descending");
    assert.equal(table.querySelector("thead th.is-cap").getAttribute("aria-sort"), null);
    assert.ok(sortedDesc(nums()), "APY largest first");
    // Unpriced rows sit at the bottom.
    const tail = [...table.querySelectorAll("tbody tr")].slice(-1)[0].querySelector(".is-apy").dataset.sort;
    const blanks = [...table.querySelectorAll("tbody tr .is-apy")].filter((td) => td.dataset.sort === "").length;
    if (blanks) assert.equal(tail, "");
    apy.querySelector("[data-sct-ct-sort]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(apy.getAttribute("aria-sort"), "ascending");
    assert.ok(sortedDesc([...nums()].reverse()), "APY smallest first");
    const player = table.querySelector("thead th.is-player");
    player.querySelector("[data-sct-ct-sort]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(player.getAttribute("aria-sort"), "ascending");
    const keys = [...table.querySelectorAll("tbody tr .is-player")].map((th) => th.dataset.sort);
    assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(errors, []);
  });

  test("a club-specific FAQ closes the tab, under the sheet and the rail (mak, 2026-11-02)", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const panel = doc.getElementById("contracts");
    // A tail like the other tabs' questions: after the page's furniture, shown with the panel.
    const faq = doc.querySelector(`${tailOf("contracts")} .sct-ct-faq`);
    assert.ok(faq, "the FAQ block is the Contracts tail");
    assert.equal(faq.querySelector("h2").textContent, "New England Patriots Contracts & Salary Cap FAQ");
    const qs = [...faq.querySelectorAll("h3.sct-faq-q")].map((h) => h.textContent);
    assert.ok(qs.length >= 10 && qs.length <= 14, `${qs.length} questions`);
    assert.equal(qs[0], "How much salary cap space do the Patriots have in 2026?");
    assert.ok(qs.includes("How much dead money do the Patriots have in 2026?"));
    assert.ok(qs.includes("Who are the highest-paid Patriots in 2026?"));
    assert.ok(qs.includes('What does "Net if cut" mean for a Patriots contract?'));
    // Every figure in the answers is the view's own: the cap-space answer
    // carries the data attribute's number, and the largest cap hit opens
    // the biggest-hit answer.
    const capSpace = Number(panel.querySelector("[data-cap-space]").dataset.capSpace);
    const a1 = faq.querySelectorAll(".sct-faq-item")[0].querySelector(".sct-faq-a").textContent;
    assert.ok(a1.includes(`$${capSpace.toFixed(1)} million`), a1);
    const topName = panel.querySelector(".sct-ct-table tbody tr .is-player").textContent.trim();
    const a2 = [...faq.querySelectorAll(".sct-faq-item")].find((d) => /biggest salary cap hit/.test(d.textContent)).querySelector(".sct-faq-a").textContent;
    assert.ok(a2.startsWith(topName.split(/\s{2,}|\n/)[0].trim().split(" ").slice(0, 2).join(" ")), `${a2} starts with ${topName}`);
    // In the page's FAQPage too (mak approved 2026-11-02), with the answer the page shows.
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join("");
    assert.ok(ld.includes("How much salary cap space do the Patriots have in 2026?"));
    assert.ok(ld.includes(JSON.stringify(a1).slice(1, 40)));
  });

  test("the hub carries this season's contracts, largest cap number first", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const panel = doc.getElementById("contracts");
    assert.ok(panel, "the Contracts panel is in the hub");
    const ids = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.getAttribute("data-sct-panel-id"));
    assert.equal(ids[ids.indexOf("draft") + 1], "contracts", "Contracts sits next to Draft");

    const file = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "contracts_2026.json"), "utf8"),
    );
    const ne = file.teams.ne;
    // Every register row with a cap number, plus everyone the cap page has
    // on the club that the register lacks a cap row for (the draft class,
    // the practice squad), paired with the page's cap number (2026-10-23).
    const snapshotFile = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "cap_snapshot_2026.json"), "utf8"),
    );
    const onSheet = new Set(ne.players.map((p) => p.otcId));
    const paired = Object.entries(snapshotFile.teams.ne.players).filter(
      ([id, p]) => !onSheet.has(Number(id)) && p.capNumber > 0,
    );
    const expectedRows = ne.players.length + paired.length;
    const rows = [...panel.querySelectorAll(".sct-ct-table tbody tr")];
    assert.equal(rows.length, expectedRows, "every contract with a cap number is a row");
    assert.ok(paired.length > 0, "the cap page adds rows the register has no cap row for");
    assert.equal(rows[0].querySelector(".sct-ct-name")?.textContent, ne.players[0].name, "largest cap number first");
    const caps = rows.map((r) => r.querySelector(".is-cap").textContent);
    assert.match(caps[0], /^\$\d+(\.\d)?M$/, "cap numbers print as money");

    // Every row is open (mak, 2026-10-30: "show full table"): no fold mark,
    // no Show-all button, the count in the head above the sheet.
    assert.ok(rows.length > 10, "the club has more than ten contracts");
    assert.equal(panel.querySelector("tr.is-more"), null, "no row is folded");
    assert.equal(panel.querySelector("[data-sct-ct-more]"), null, "no Show all button");
    assert.match(panel.querySelector(".sct-ct-season-sum")?.textContent ?? "", new RegExp(`^${expectedRows} contracts`));

    // One row per player: the register's duplicate active deals are folded.
    const names = rows.map((r) => r.querySelector(".sct-ct-name").textContent);
    assert.equal(new Set(names).size, names.length, "no player is listed twice");

    // The cap ledger (2026-10-29): three groups, eight rows, the first the
    // club's cap space with its league rank, read from the cap snapshot.
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "cap_snapshot_2026.json"), "utf8"),
    );
    // Two groups since 2026-11-02: Dead Money has its own card at the foot of the rail.
    assert.equal(panel.querySelectorAll(".sct-ct-ledger .sct-ct-lg").length, 2, "two groups");
    const tiles = [...panel.querySelectorAll(".sct-ct-ledger .sct-ct-lg-row")];
    assert.equal(tiles.length, 6, "six rows");
    assert.deepEqual(
      tiles.slice(3).map((l) => l.querySelector(".sct-ct-lg-label").textContent),
      ["Cut savings", "Locked in", "Value gap"],
      "Flexibility: cut savings, then the sunk counterpart, then the value gap",
    );
    assert.match(tiles[0].textContent, /cap space/i);
    assert.match(tiles[0].textContent, /\$\d+(\.\d)?M/);
    assert.match(tiles[0].querySelector(".sct-ct-rank")?.textContent ?? "", /^\d+(st|nd|rd|th)/);
    assert.ok(tiles[0].classList.contains("is-lead"), "cap space leads its group");
    assert.equal(panel.querySelectorAll(".sct-ct-ledger .is-lead").length, 2, "one lead per group");
    // The Dead Money card: its three figures over the list, the lead one live.
    const dead = panel.querySelector(".sct-ct-dead");
    assert.equal(dead.querySelector(".sct-ct-lg-h").textContent, "2026 Dead Money");
    assert.match(dead.querySelector(".sct-ct-strip").textContent, /players? carried$/);
    assert.deepEqual(
      [...dead.querySelectorAll(".sct-ct-lg-label")].map((l) => l.textContent),
      ["On the books"],
    );
    assert.ok(dead.querySelector('.sct-ct-lg-row.is-lead [data-sct-ct-out="dead"]'));
    // The lead row reconciles the page's total with the names below it.
    const itemized = snapshot.teams.ne.dead.reduce((n, d) => n + d.amount, 0);
    const lead = dead.querySelector(".sct-ct-lg-row.is-lead .sct-ct-lg-sub")?.textContent ?? "";
    if (Math.abs(snapshot.teams.ne.deadTotal - itemized) >= 0.05) {
      assert.match(lead, new RegExp(`across the ${snapshot.teams.ne.dead.length} names below; \\$[\\d.]+[MK] more`));
    }
    assert.ok(dead.querySelector(".sct-ct-dead-list"), "the list sits in the same card");
    // Sortable heads (2026-11-02): a button per column, cap hit sorted first.
    const sorts = [...panel.querySelectorAll(".sct-ct-table thead [data-sct-ct-sort]")].map((b) => b.dataset.sctCtSort);
    assert.deepEqual(sorts, ["player", "pos", "cap", "apy", "worth", "gtd", "signed", "save", "dead"]);
    assert.equal(panel.querySelector(".sct-ct-table thead th.is-cap").getAttribute("aria-sort"), "descending");
    for (const r of rows) {
      assert.match(r.querySelector(".is-cap").dataset.sort, /^\d+(\.\d+)?$/);
      assert.match(r.querySelector(".is-player").dataset.sort, /^[^,]+, /);
    }
    assert.ok(panel.querySelector('[data-sct-ct-out="space"]'), "the scenario still writes cap space");
    assert.ok(panel.querySelector('[data-sct-ct-out="dead"]'), "the scenario still writes dead money");
    assert.equal(panel.querySelector(".sct-ct-lg-kicker"), null, "the kicker line went 2026-11-02");
    assert.equal(panel.querySelector("[data-sct-ct]").getAttribute("data-cap-space"), String(snapshot.teams.ne.capSpace));

    // Every row carries the release figures the scenario sums, before and
    // after June 1, and a pick box; the bar is in the HTML for the bundle.
    for (const r of rows) {
      for (const k of ["data-pre-save", "data-pre-dead", "data-post-save", "data-post-dead"]) {
        assert.match(r.getAttribute(k) ?? "", /^-?\d+(\.\d+)?$/, `${k} on every row`);
      }
      assert.ok(r.querySelector("[data-sct-ct-pick]"), "a pick box on every row");
    }
    assert.ok(panel.querySelector("[data-sct-ct-scen]"), "the scenario bar is rendered");
    assert.equal(panel.querySelectorAll("[data-sct-ct-timing]").length, 2);

    // Worth: priced rows carry a figure, tagged rows a pill, and the note
    // explaining the model is on the page.
    const worth = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "worth_2026.json"), "utf8"),
    );
    const priced = ne.players.filter((p) => worth.players[String(p.otcId)]);
    assert.equal(panel.querySelectorAll(".sct-ct-td.is-worth").length, priced.length, "every priced row shows Worth");
    const tagged = priced.filter((p) => worth.players[String(p.otcId)].tag);
    assert.equal(panel.querySelectorAll(".sct-ct-tag").length, tagged.length, "every tagged row wears its pill");
    assert.match(panel.querySelector(".sct-ct-how")?.textContent ?? "", /Overpaid/);

    // The dead-money block lists what the snapshot has, largest first.
    const deadRows = [...panel.querySelectorAll(".sct-ct-dead-row")];
    assert.equal(deadRows.length, snapshot.teams.ne.dead.length);
    if (deadRows.length) assert.match(deadRows[0].textContent, new RegExp(snapshot.teams.ne.dead[0].name.split(" ")[0]));
    // ...and closes the rail, under the cap ledger and the release panel
    // (mak, 2026-10-30).
    // Every row names the current club: a crest linked to its hub, or "FA".
    for (const r of deadRows) {
      assert.ok(r.querySelector(".sct-ct-dead-club img, .sct-ct-dead-fa"), `crest or FA on ${r.textContent}`);
    }
    const railKids = [...(panel.querySelector(".sct-ct-rail")?.children ?? [])].map((el) => el.className);
    assert.deepEqual(railKids, ["sct-ct-ledger", "sct-ct-cuts", "sct-ct-dead"], "rail order: ledger, releases, dead money");

    // The release rail says it is a reading, not a call; at most six names.
    const cuts = panel.querySelectorAll(".sct-ct-cut");
    assert.ok(cuts.length >= 1 && cuts.length <= 6, "cut rail has one to six names");
    assert.match(panel.querySelector(".sct-ct-cuts .sct-ct-dek")?.textContent ?? "", /not a prediction/i);

    // No outside source is named in the page.
    assert.doesNotMatch(panel.innerHTML, /nflverse|over ?the ?cap|spotrac|pro-football-reference/i);
  });
});
