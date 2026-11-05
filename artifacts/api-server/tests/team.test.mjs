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
      const hubPanel = ["outlook", "draft", "contracts", "schedule"].includes(id);
      assert.equal(
        Boolean(doc.getElementById(id)),
        hubPanel,
        hubPanel ? `nav names a real panel: ${id}` : `${id} is not printed on the hub`,
      );
      assert.equal(
        link.getAttribute("href"),
        // The Outlook is the hub, so its tab links to the hub. Draft and
        // Contracts are hub-only hash tabs; Coaching has its own address
        // since mak's coaching brief (2026-11-05).
        // The Schedule is a preview on the hub (mak, 2026-11-03), so its
        // tab is a hash tab here and the panel's own link leads to the page.
        id === "outlook"
          ? "/team/new-england-patriots/"
          : id === "draft" || id === "contracts" || id === "schedule"
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
    const switcher = doc.querySelectorAll(".sct-tpb .sct-switch-team");
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
    assert.ok(priority[0].classList.contains("sct-tpb-logo"));
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
    assert.match(doc.querySelector(".sct-tpb-title").textContent, /Patriots/);
    assert.equal(doc.querySelector(".sct-tpb-title").tagName, "H2");
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

    // The navy banner heads the panel with the page's phrase (the section
    // page's H1) and the one-sentence summary naming listed starters (mak,
    // 2026-11-05: the premium design is the tab; no stamp, no notes).
    const panel = doc.querySelector("#depth-chart");
    assert.ok(panel.querySelector(".sct-dpp[data-sct-depth-premium]"), "the premium block is the tab");
    assert.equal(panel.querySelector(".sct-dc[data-sct-dc], .sct-dcx, .sct-dpp-flag"), null, "the old chart and the comparison flag are gone");
    assert.equal(panel.querySelector(".sct-dpp-hero .sct-h2").textContent.trim(), "New England Patriots Depth Chart");
    assert.ok(panel.querySelector(".sct-dpp-hero img.sct-dpp-logo"), "the banner carries the club's logo");
    assert.equal(panel.querySelector(".sct-dc-stamp"), null, "no season / updated stamp (mak, 2026-11-05)");
    const summary = panel.querySelector(".sct-dpp-sub").textContent;
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
      panels.map((p) => p.getAttribute("aria-label")),
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
      const labels = [...card.querySelectorAll(".sct-dpp-head > span")].map((s) => s.textContent);
      assert.deepEqual(labels, ["Pos", "Starter", "Second", "Third", "Fourth"]);
      const expected = ne.slots.filter((slot) => slot.side === side && slot.players.length);
      const rows = [...card.querySelectorAll(".sct-dpp-row")];
      assert.deepEqual(
        rows.map((r) => r.dataset.slot),
        expected.map((slot) => slot.key),
        `${key}: a row per slot, in the source's order`,
      );
      const more = [...card.querySelectorAll(".sct-dpp-more .sct-dpp-card")];
      for (const slot of expected) {
        const row = rows.find((r) => r.dataset.slot === slot.key);
        const pos = slot.slot === "PK" ? "K" : slot.slot;
        assert.equal(row.dataset.pos, pos);
        const cards = [...row.querySelectorAll(".sct-dpp-card")];
        assert.ok(cards.length <= 4, `${slot.key}: at most four strings across`);
        assert.ok(cards[0]?.classList.contains("is-starter") && !cards[1]?.classList.contains("is-starter"), `${slot.key}: the starter is set apart`);
        const deeper = more.filter((c) => c.querySelector(".sct-dpp-slot")?.textContent === `${pos}${c.dataset.rank}`);
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
          assert.ok(card.querySelector(".sct-dpp-well"), "headshot well");
          assert.equal(card.querySelector(".sct-dpp-slot"), null, "the row labels the slot");
        }
      }
      assert.equal(card.querySelectorAll(".sct-dpp-ppr").length, 0, `${key}: no PPR rank on the football chart`);
      assert.equal(card.querySelector(".sct-dpp-note"), null, `${key}: slotted, not folded`);
    }
    const offense = panels[0];
    assert.equal(offense.querySelectorAll('.sct-dpp-row[data-pos="WR"]').length, ne.slots.filter((s) => s.slot === "WR").length);
    // The strip: base personnel, then the two unit grades; none on special teams.
    assert.match(offense.querySelector(".sct-dpp-strip-label")?.textContent ?? "", /^Base offense: /);
    assert.deepEqual([...offense.querySelectorAll(".sct-dpp-strip-label")].slice(1).map((l) => l.textContent), ["Passing game", "Rushing attack"]);
    assert.equal(offense.querySelectorAll(".sct-dpp-grade").length, 2);
    assert.equal(panels[2].querySelector(".sct-dpp-strip"), null, "no scheme strip on special teams");
    assert.ok(offense.querySelector(".sct-dpp-rookie"), "a rookie tag on the chart");
    assert.equal(offense.querySelector(".sct-dpp-captain"), null, "no captain badge: the document has no captain field");

    // The fantasy card: one group per position under a long-tail heading,
    // every box labelled with its rank in the hierarchy, the four skill
    // positions carrying the league PPR rank too.
    const fantasy = panels[3];
    const groups = [...fantasy.querySelectorAll(".sct-dpp-row.is-fan")];
    assert.deepEqual(
      groups.map((g) => g.dataset.pos),
      ["QB", "RB", "WR", "TE", "K"].filter((pos) => (ne.positions[`FAN_${pos}`] ?? []).length),
    );
    assert.match(fantasy.querySelector(".sct-dpp-note").textContent, /^StatChasers' fantasy hierarchy/);
    for (const group of groups) {
      const pos = group.dataset.pos;
      const expected = [...ne.positions[`FAN_${pos}`]].sort((a, b) => a.rank - b.rank);
      const cards = [...group.querySelectorAll(".sct-dpp-card")];
      assert.deepEqual(cards.map(rowName), expected.map((p) => p.name), `${pos}: the fantasy order`);
      assert.deepEqual(
        cards.map((c) => c.querySelector(".sct-dpp-rank").textContent),
        expected.map((p) => `${pos}${p.rank}`),
        `${pos}: WR1 / WR2 labels`,
      );
    }
    const chips = [...fantasy.querySelectorAll(".sct-dpp-ppr")];
    assert.ok(chips.length > 0, "PPR ranks on the Fantasy view");
    for (const chip of chips) {
      assert.match(chip.textContent, /^PPR(QB|RB|WR|TE)\d+$/);
      const pos = chip.closest(".sct-dpp-row").dataset.pos;
      assert.ok(chip.textContent.startsWith(`PPR${pos}`), `${chip.textContent} on a ${pos} card`);
    }

    // The Fantasy columns carry no status in the document; each row borrows the
    // Offense column's for the same player.
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const offenseCol = ne.positions[pos] ?? [];
      for (const player of ne.positions[`FAN_${pos}`] ?? []) {
        const twin = offenseCol.find((o) => o.name === player.name);
        if (player.status || !twin?.status) continue;
        const card = [...fantasy.querySelectorAll(".sct-dpp-card")].find((c) => rowName(c) === player.name);
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
    assert.ok(panel.querySelectorAll(".sct-dpp-card a.sct-player-link[href]").length > 10, "player names link to profiles");
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
      ...doc.querySelectorAll('#depth-chart [data-sct-dc-panel="fantasy"] .sct-dpp-row[data-pos="WR"] .sct-dpp-card.is-sidelined'),
    ].map(rowName);
    for (const who of sidelined) {
      assert.ok(
        entries.some((e) => e.answer.includes(who)),
        `a sidelined receiver on the fantasy chart (${who}) goes unmentioned`,
      );
    }
    for (const row of doc.querySelectorAll('#depth-chart [data-sct-dc-panel="offense"] .sct-dpp-row')) {
      const first = row.querySelector(".sct-dpp-card");
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

  test("the Target and Rushing Distribution boards sit between the snap table and Situational Usage (mak, 2026-11-05)", async () => {
    const { doc } = await dom("/team/new-england-patriots/usage/");
    const boards = [...doc.querySelectorAll(".sct-us-board")];
    assert.deepEqual(
      boards.map((b) => b.querySelector(".sct-us-h3")?.textContent),
      ["Target Distribution", "Rushing Distribution"],
    );
    // The environment cards went 2026-11-02; since the NFL-first rebuild the
    // boards follow the snap table and lead into Situational Usage.
    // DOCUMENT_POSITION_FOLLOWING = 4.
    assert.equal(doc.querySelector(".sct-us-env"), null, "no environment cards");
    const situational = doc.querySelector("#situational");
    assert.ok(situational && boards[0].compareDocumentPosition(situational) & 4, "boards come before Situational Usage");
    assert.ok(doc.querySelector(".sct-us-snaps").compareDocumentPosition(boards[0]) & 4, "the snap table comes first");
    for (const [i, board] of boards.entries()) {
      // The first count cell per named row (the boards also carry Rec/Yds or Yds/YPC since 2026-11-05).
      const counts = [...board.querySelectorAll("tbody tr:not(.sct-us-board-more)")].map((tr) => Number(tr.querySelector("td.is-count").textContent));
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
describe("the team header (mak's pick of 2026-11-05: the bright blue hero and the light strip)", () => {
  test("the hero and the strip on the hub and on section pages: facts, switcher, tabs, heading, hooks", async () => {
    for (const path of ["/team/new-england-patriots", "/team/kansas-city-chiefs/coaching/", "/team/dallas-cowboys/stats/", "/team/new-york-jets/schedule/", "/team/washington-commanders/usage/"]) {
      const { doc } = await dom(path);
      const root = doc.querySelector("[data-sct-root]");
      const b = doc.querySelector(".sct-tpb");
      assert.ok(b, `${path}: the header renders`);
      assert.equal(root.firstElementChild, b, `${path}: first thing in the page`);
      assert.equal(doc.querySelectorAll(".sct-hero, .sct-nav, [data-sct-premium=\"team-header-b\"]").length, 0, "no old header or strip, and no B comparison block: B is the header");
      // Two separate blocks: the hero, then the strip as the next sibling (not inside the hero).
      const hero = b.querySelector("header.sct-tpb-hero");
      const strip = b.querySelector("nav.sct-tpb-navigation[data-sct-nav]");
      assert.ok(hero && strip);
      assert.equal(hero.nextElementSibling, strip);
      assert.equal(strip.getAttribute("aria-label"), "Team sections");
      // The left panel, the gold divider, the watermark, the top line: decorative, hidden.
      const decor = hero.querySelector(".sct-tpb-decor");
      assert.equal(decor.getAttribute("aria-hidden"), "true");
      for (const cls of ["sct-tpb-logo-panel", "sct-tpb-divider", "sct-tpb-watermark", "sct-tpb-topline"]) assert.ok(decor.querySelector(`.${cls}`), cls);
      // The crest on its white circle is the LCP candidate, named for assistive technology.
      const logo = hero.querySelector(".sct-tpb-logo-circle img.sct-tpb-logo");
      assert.equal(logo.getAttribute("fetchpriority"), "high");
      assert.equal(logo.getAttribute("alt"), `${hero.querySelector(".sct-tpb-title").textContent} logo`);
      // Standalone the club's name is the one H1; the page has no other.
      assert.equal(hero.querySelector(".sct-tpb-title").tagName, "H1");
      assert.equal(doc.querySelectorAll("h1").length, 1, `${path}: one H1`);
      assert.match(hero.querySelector(".sct-tpb-eyebrow").textContent, /^(AFC|NFC) (East|West|North|South) · \d{4} Season$/);
      const sub = hero.querySelector(".sct-tpb-sub");
      assert.equal(sub.textContent, `${hero.querySelector(".sct-tpb-title").textContent} fantasy football hub`);
      assert.equal(sub.getAttribute("data-sct-lead"), "", "the standfirst ships with the bundle's hook and no state");
      // The KPI cards: Record / Standing / Head Coach / Bye in that order, each with a gold icon.
      const kpis = [...hero.querySelectorAll(".sct-tpb-kpi")].map((k) => k.querySelector(".sct-tpb-kpi-label").textContent);
      const order = ["Record", "Standing", "Head Coach", "Bye"];
      // Tolerant of the providers: a fact ESPN did not return is not printed.
      assert.deepEqual(kpis, order.filter((l) => kpis.includes(l)), `${path}: facts in order`);
      for (const k of hero.querySelectorAll(".sct-tpb-kpi")) {
        assert.ok(k.querySelector(".sct-tpb-kpi-icon svg"), "an icon on every card");
        assert.ok(k.querySelector(".sct-tpb-kpi-value").textContent.length > 0);
      }
      // The freshness line is a stamp the bundle rewrites to relative time.
      const t = hero.querySelector(".sct-tpb-updated time");
      if (t) {
        assert.ok(t.getAttribute("datetime"));
        assert.ok(t.getAttribute("data-ts"));
      }
      // The switcher: wired, 32 destinations, the current club marked.
      const details = hero.querySelector(".sct-tpb-actions details.sct-switch[data-sct-switch]");
      assert.ok(details, "the switcher is the wired one");
      assert.equal(doc.querySelectorAll("[data-sct-switch]").length, 1);
      assert.equal(details.querySelectorAll(".sct-switch-team").length, 32);
      assert.equal(details.querySelector(".sct-switch-team.is-current").getAttribute("aria-current"), "page");
      // The strip: text-first links carrying the bundle's contract, one open.
      const links = [...strip.querySelectorAll(".sct-nav-list .sct-nav-link")];
      assert.ok(links.length >= 2);
      for (const a of links) {
        assert.ok(a.id.endsWith("-tab"));
        assert.equal(a.id, `${a.getAttribute("data-sct-panel-id")}-tab`);
        for (const attr of ["data-sct-heading", "data-sct-lead", "data-sc-title"]) assert.ok(a.getAttribute(attr), `${attr} on ${a.textContent}`);
        assert.match(a.getAttribute("href"), /^\/team\//);
        assert.equal(a.querySelector("svg"), null, "text-first tabs");
      }
      const open = links.filter((a) => a.classList.contains("is-active"));
      assert.equal(open.length, 1);
      assert.equal(open[0].getAttribute("aria-current"), "page");
      const ids = [...doc.querySelectorAll("[data-sct-root] [id]")].map((el) => el.id);
      assert.equal(new Set(ids).size, ids.length, `${path}: duplicate ids`);
      assert.doesNotMatch(b.textContent, /\u2014/);
    }
  });

  test("the open tab follows the address", async () => {
    for (const [path, id] of [["/team/new-england-patriots", "outlook"], ["/team/new-england-patriots/coaching/", "coaching"], ["/team/new-england-patriots/stats/", "stats"], ["/team/new-england-patriots/news/", "news"]]) {
      const { doc } = await dom(path);
      assert.equal(doc.querySelector(".sct-tpb .sct-nav-link.is-active").getAttribute("data-sct-panel-id"), id, path);
    }
  });

  test("the stylesheet: the header's rules are scoped, the strip is sticky, the old rules are gone", async () => {
    const css = (await get("/team.css")).body;
    assert.match(css, /\.sct \.sct-tpb-navigation \{[^}]*position:\s*sticky/);
    assert.match(css, /\.sct \.sct-tpb-navigation \{[^}]*top:\s*var\(--sct-nav-offset/);
    for (const dead of [/\n\.sct-hero\b/, /\n\.sct-nav\b/, /\.sct-facts/]) assert.doesNotMatch(css, dead, `${dead} still in team.css`);
    // The club's name is armoured against the host theme's heading sizes.
    assert.match(css, /\.sct \.sct-tpb-title \{[^}]*font-size:[^;]*!important/);
  });
});

describe("Premium Design A · Dark Navy, the comparison under the header (back at mak's request, 2026-11-05)", () => {
  test("directly under the header on the hub and on section pages, on the same facts, switcher and tabs, unwired", async () => {
    for (const path of ["/team/new-england-patriots", "/team/kansas-city-chiefs/coaching/", "/team/washington-commanders/usage/"]) {
      const { doc } = await dom(path);
      const b = doc.querySelector(".sct-tpb");
      const tp = doc.querySelector('[data-sct-premium="team-header"]');
      assert.ok(tp, `${path}: Design A renders`);
      assert.equal(b.nextElementSibling, tp, `${path}: directly under the header`);
      assert.equal(tp.querySelector(".sct-cp-flag").textContent, "Premium Design A · Dark Navy");
      assert.equal(tp.querySelector("h1, h2, h3, h4"), null, "no heading inside the comparison: the page keeps its one H1");
      assert.equal(doc.querySelectorAll("h1").length <= 1, true);
      // Isolation both ways.
      assert.equal(tp.querySelector('[class*="sct-tpb"]'), null, "no header classes inside A");
      assert.equal(b.querySelector('[class*="sct-tp-"], .sct-tp'), null, "no A classes inside the header");
      // The same identity, facts and stamp as the header.
      assert.equal(tp.querySelector(".sct-tp-title").textContent, b.querySelector(".sct-tpb-title").textContent);
      assert.equal(tp.querySelector(".sct-tp-eyebrow").textContent, b.querySelector(".sct-tpb-eyebrow").textContent);
      assert.equal(tp.querySelector(".sct-tp-sub").textContent, b.querySelector(".sct-tpb-sub").textContent);
      assert.equal(tp.querySelector(".sct-tp-logo").getAttribute("src"), b.querySelector(".sct-tpb-logo").getAttribute("src"));
      const facts = (root, card, label, value) => [...root.querySelectorAll(card)].map((k) => [k.querySelector(label).textContent, k.querySelector(value).textContent]);
      assert.deepEqual(facts(tp, ".sct-tp-kpi", ".sct-tp-kpi-label", ".sct-tp-kpi-value"), facts(b, ".sct-tpb-kpi", ".sct-tpb-kpi-label", ".sct-tpb-kpi-value"), `${path}: facts`);
      for (const k of tp.querySelectorAll(".sct-tp-kpi")) assert.ok(k.querySelector(".sct-tp-kpi-icon svg"), "a gold icon on every card");
      const t0 = b.querySelector(".sct-tpb-updated time");
      const t1 = tp.querySelector(".sct-tp-updated time");
      if (t0) {
        assert.equal(t1.getAttribute("datetime"), t0.getAttribute("datetime"));
        assert.equal(t1.getAttribute("data-ts"), t0.getAttribute("data-ts"));
      } else assert.equal(t1, null);
      // The switcher: the same 32 destinations and current club; only the header's is wired.
      const hrefs = (el) => [...el.querySelectorAll(".sct-switch-team")].map((a) => a.getAttribute("href"));
      assert.deepEqual(hrefs(tp), hrefs(b));
      assert.equal(tp.querySelector(".sct-switch-team.is-current").textContent, b.querySelector(".sct-switch-team.is-current").textContent);
      assert.ok(tp.querySelector("details.sct-switch.sct-tp-switch"));
      assert.equal(tp.querySelector("[data-sct-switch]"), null);
      assert.equal(doc.querySelectorAll("[data-sct-switch]").length, 1);
      // The strip: the same tabs, addresses and open tab as the header's; an icon on each; no hooks, no ids.
      const tabs = [...tp.querySelectorAll(".sct-tp-tab")];
      const links = [...b.querySelectorAll(".sct-nav-link")];
      assert.deepEqual(tabs.map((a) => a.querySelector(".sct-tp-tab-label").textContent), links.map((a) => a.textContent));
      assert.deepEqual(tabs.map((a) => a.getAttribute("href")), links.map((a) => a.getAttribute("href")));
      assert.deepEqual(tabs.map((a) => a.classList.contains("is-active")), links.map((a) => a.classList.contains("is-active")));
      assert.equal(tp.querySelector(".sct-tp-tab.is-active").getAttribute("aria-current"), "page");
      assert.equal(tp.querySelector(".sct-tp-tab svg"), null, "text-first tabs, like the header's");
      assert.equal(tp.querySelector(".sct-tp-nav").previousElementSibling, tp.querySelector(".sct-tp-hero"), "the strip is a separate block under the hero");
      assert.equal(tp.querySelector(".sct-nav-link, [data-sct-nav], [data-sct-panel-id], [data-sct-lead]"), null, "none of the bundle's hooks");
      assert.equal(tp.querySelector("[id]"), null, "no ids inside the comparison");
      const ids = [...doc.querySelectorAll("[data-sct-root] [id]")].map((el) => el.id);
      assert.equal(new Set(ids).size, ids.length, `${path}: duplicate ids`);
      assert.doesNotMatch(tp.textContent, /\u2014/);
    }
  });
});

describe("the Stats tab (mak's brief, 2026-11-05: teamstats.png; the old ladders removed the same day)", () => {
  test("the banner carries the heading; the panels carry the rows with the tab's bars, tiers and ranks", async () => {
    for (const path of ["/team/new-england-patriots/stats/", "/team/kansas-city-chiefs/stats/", "/team/new-york-jets/stats/"]) {
      const { doc } = await dom(path);
      const panel = doc.querySelector("#stats");
      const sp = panel.querySelector(".sct-sp");
      assert.ok(sp, `${path}: the tab renders`);
      assert.equal(panel.querySelectorAll(".sct-ladder, .sct-tiles, .sct-mix, .sct-hist, .sct-cp-flag, [data-sct-premium]").length, 0, "nothing of the old tab, no comparison label");
      // The tab's heading sits inside the banner: the .sct-h2 the section
      // address promotes to the H1 on the WordPress mount (see below); here,
      // standalone, the header's club name is the H1 and this is the H2.
      const heading = sp.querySelector(".sct-sp-hero h2.sct-h2.sct-sp-title");
      assert.ok(heading, "the banner carries the tab's heading");
      assert.match(heading.textContent, /Team Stats \d{4}$/);
      assert.equal(doc.querySelectorAll("h1").length, 1);
      assert.equal(sp.querySelectorAll(".sct-h2").length, 1, "one .sct-h2 in the tab: the banner's");
      // Section headings: Offense, Defense and the bands are H2s; inner panels and play-mix cards H3s.
      const h2s = [...sp.querySelectorAll("h2")].map((h) => h.textContent);
      for (const want of ["Offense", "Defense", "Efficiency", "Pass Protection & Pass Rush", "Possession & Discipline", "Pace & Play Style", "Season History"]) assert.ok(h2s.includes(want), `${path}: H2 "${want}" (${h2s.join(" | ")})`);
      assert.equal(new Set(h2s).size, h2s.length, "no heading printed twice");
      const h3s = [...sp.querySelectorAll("h3")].map((h) => h.textContent);
      for (const want of ["Offense Efficiency", "Defense Efficiency", "Pass Protection", "Pass Rush", "Turnovers, Downs & Penalties", "Snaps, Attempts & Scores"]) assert.ok(h3s.includes(want), `${path}: H3 "${want}"`);
      // Rows: label, bar, value, rank. A rank draws the fill; no rank draws an empty track and an unranked pill.
      const rows = [...sp.querySelectorAll(".sct-sp-row")];
      assert.ok(rows.length >= 30, `${path}: rows (${rows.length})`);
      for (const r of rows) {
        const bar = r.querySelector(".sct-sp-bar");
        const rank = r.querySelector(".sct-sp-rank:not(.is-none)");
        assert.equal(bar.getAttribute("aria-hidden"), "true");
        assert.ok(r.querySelector(".sct-sp-value").textContent.length > 0);
        if (rank) {
          assert.match(bar.querySelector(".sct-sp-fill").getAttribute("style"), /^width:\d+(\.\d+)?%$/);
          assert.match(rank.firstChild.textContent, /^(T-)?\d+(st|nd|rd|th)$/);
          assert.equal(rank.getAttribute("data-tier"), bar.getAttribute("data-tier"), "pill and bar agree");
        } else assert.ok(bar.classList.contains("is-empty"));
      }
      // Volume rows (pace, blitz rate, time to throw) are ranked but never tinted.
      for (const r of sp.querySelectorAll('[data-kind="pace"] .sct-sp-row')) {
        const label = r.querySelector(".sct-sp-label").firstChild.textContent;
        if (/\/G$/.test(label)) assert.equal(r.querySelector(".sct-sp-rank").getAttribute("data-tier"), "none", `${label} is untinted`);
      }
      // The play mix: two shares that sum to 100, pass then run.
      for (const m of sp.querySelectorAll(".sct-sp-mix")) {
        const keys = [...m.querySelectorAll(".sct-sp-mix-key")].map((k) => k.textContent);
        assert.match(keys[0], /^Pass \d+\.\d%$/);
        assert.match(keys[1], /^Run \d+\.\d%$/);
        const sum = keys.reduce((n, k) => n + Number.parseFloat(k.replace(/[^0-9.]/g, "")), 0);
        assert.ok(Math.abs(sum - 100) < 0.2, `${path}: ${keys.join(" + ")}`);
      }
      // The history: a real table, the live season marked, every cell a value over a rank, tinted by rank.
      const trs = [...sp.querySelectorAll(".sct-sp-h tbody tr")];
      assert.ok(trs.length >= 2, "two seasons at least");
      assert.ok(trs[0].classList.contains("is-current") && trs[0].querySelector(".sct-sp-h-now"), "the live season is marked");
      for (const td of sp.querySelectorAll(".sct-sp-h-cell:not(.is-empty)")) {
        const rank = td.querySelector(".sct-sp-h-rank")?.firstChild.textContent;
        const n = rank ? Number.parseInt(rank.replace(/^T-/, ""), 10) : null;
        const tier = td.getAttribute("data-tier");
        if (n === null) assert.equal(tier, "none");
        else assert.equal(tier, n <= 10 ? "good" : n >= 23 ? "poor" : "mid", `${path}: ${td.textContent} -> ${tier}`);
      }
      assert.equal(sp.querySelector("[id]"), null, "no ids inside the tab's blocks");
      assert.doesNotMatch(sp.textContent, /\u2014/);
    }
  });

  test("on the WordPress mount the banner's heading is the page's H1", async () => {
    const page = await get("/embed/team/ne?section=stats&h1=1");
    assert.equal(page.status, 200);
    const h1s = [...page.body.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
    // The page's own phrase (teamSectionHeading), in the banner's heading slot.
    assert.deepEqual(h1s, ["New England Patriots Stats 2026"]);
    assert.match(page.body, /<header class="sct-sp-hero">[\s\S]*?<h1 class="sct-h2 sct-sp-title">New England Patriots Stats 2026<\/h1>/, "promoted in place, inside the banner");
    assert.ok(!/<h2[^>]*>Patriots Team Stats 2026<\/h2>/.test(page.body), "and the tab's own heading is not printed a second time");
  });
});

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
        (node) => node.textContent.trim() === "Common Questions",
      );
      assert.equal(headings.length, 1, `${id}: one "Common Questions" heading`);
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
    // Two of the hub's OWN tabs: the Stats and Coaching questions live on
    // /stats/ and /coaching/ now, with the rest of those pages.
    assert.ok(
      faqEntries(doc, tailOf("outlook")).length > 0 && faqEntries(doc, tailOf("draft")).length > 0,
      "this test is only meaningful with both tabs carrying questions",
    );
    for (const id of ["usage", "coaching", "stats", "depth-chart"]) {
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

    const lead = doc.querySelector(".sct-tpb .sct-tpb-sub");
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
      /\.sct \.sct-tpb-sub\[data-sct-lead="off"\] \{\s*display:\s*none/,
      "the stylesheet hides the dropped state, and only that state",
    );
    // The hook alone must not hide anything, or the line would be off for
    // every reader with JavaScript disabled - which is the one case where
    // nothing can ever measure it and the full line is what ships.
    assert.ok(
      !/\.sct-tpb-sub\[data-sct-lead\] \{[^}]*display:\s*none/.test(css),
      "the bare hook must not hide it",
    );
    // And no width may do it either: this is measured, not a breakpoint.
    for (const [, block] of css.matchAll(/@(?:media|container)[^{]*max-width[^{]*\{([\s\S]*?)\n\}/g)) {
      assert.ok(
        !/\.sct-tpb-sub[^{]*\{[^}]*display:\s*none/.test(block),
        "no media or container query may hide the standfirst",
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
      /\.sct-section,\s*\n\.sct-tpb-hero\s*\{[^}]*scroll-margin-top:/,
      "sections carry scroll-margin-top for the sticky nav",
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
      "/preview/team/new-england-patriots/usage/",
      `/preview/player/${playerSlug}`,
      `/preview/player/${playerSlug}/injury/`,
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

    // Both switchers (the hero's and the premium preview's copy) must obey the rule; 32 distinct destinations.
    const hrefs = [...html.matchAll(/class="sct-switch-team[^"]*"\s+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(new Set(hrefs).size, 32, "every team is in the switcher");

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
    assert.equal(new Set(hrefs).size, 32);
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
    assert.equal(doc.querySelectorAll(".sct-tpb, .sct-tpb-hero").length, 0);
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
  // The panels of the Stats tab (team/stats-premium.ts): the Offense / Defense
  // units carry data-kind="" and name their week in the head; the inner
  // panels carry their bucket and name it in the sub-line.
  const ladders = (doc, kind) => [...doc.querySelectorAll(`.sct-sp-unit[data-kind="${kind}"], .sct-sp-panel[data-kind="${kind}"]`)];
  const captionWeek = (ladder) => {
    const caption = (ladder.querySelector(".sct-sp-week") ?? ladder.querySelector(".sct-sp-panel-sub"))?.textContent ?? "";
    const m = caption.match(/through Week (\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const titleOf = (ladder) => (ladder.querySelector(".sct-sp-unit-title") ?? ladder.querySelector(".sct-sp-panel-title"))?.textContent;
  const cell = (ladder, label) => {
    for (const li of ladder.querySelectorAll(".sct-sp-row")) {
      if (li.querySelector(".sct-sp-label")?.firstChild?.textContent?.trim() === label) {
        return li.querySelector(".sct-sp-value")?.textContent?.trim() ?? null;
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
        `${titleOf(ladder)}: the caption is the file's week`,
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
    const all = [...doc.querySelectorAll(".sct-sp-unit, .sct-sp-panel")];
    assert.ok(all.length >= 6, `the Stats tab renders its panels (${all.length})`);
    for (const ladder of all) {
      assert.ok(captionWeek(ladder), `${titleOf(ladder)}: the caption names a week`);
    }
    // Within a bucket the two units agree with each other, whatever the
    // sources say to one another.
    for (const kind of ["efficiency", "passrush", "possession", "pace", ""]) {
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
    const block = src.slice(src.indexOf("efficiency: {"), src.indexOf("possession: pickRows("));
    assert.ok(block.length > 0, "the Efficiency and Pass Rush rows are chosen");
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

    // Draft: a hub-only panel, so it switches in place. Stats owns an
    // address and is not printed here - its tab is a plain link, below.
    // (Coaching used to be the hub-only example; it has its own address
    // since mak's coaching brief, 2026-11-05.)
    const draft = doc.querySelector('.sct-nav-link[data-sct-panel-id="draft"]');
    assert.ok(draft, "the Draft tab is there");

    draft.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    assert.equal(
      window.location.pathname + window.location.hash,
      "/team/new-england-patriots/#draft",
      "the address bar names the section",
    );
    assert.ok(
      doc.getElementById("draft").classList.contains("is-active"),
      "the draft panel is the one showing",
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
    assert.equal(draft.getAttribute("aria-current"), "true");
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
  test("the hub carries the next draft's picks by round and the last five classes, in the premium design", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const panel = doc.getElementById("draft");
    assert.ok(panel, "the Draft panel is in the hub");
    assert.equal(doc.querySelector('.sct-nav-link[data-sct-panel-id="draft"]')?.textContent, "Draft");

    // Right of Stats on the strip (mak, 2026-10-23).
    const ids = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.getAttribute("data-sct-panel-id"));
    assert.equal(ids[ids.indexOf("stats") + 1], "draft", "Draft sits next to Stats");

    // The premium design is the tab (mak, 2026-11-05: built as a comparison,
    // then "remove the old version"): the banner carries the heading and the
    // intro sentence; no view switch, no comparison flag, no old rail.
    const premium = panel.querySelector(".sct-drp[data-sct-draft-premium]");
    assert.ok(premium, "the premium block is the tab");
    assert.equal(panel.querySelector(".sct-dr, [data-sct-dr-panel], .sct-drp-flag"), null, "the old layout and the flag are gone");
    assert.equal(panel.querySelectorAll("[data-sct-dc-view], [data-sct-dc]").length, 0, "no view switch");
    assert.equal(premium.querySelector(".sct-drp-hero h2.sct-h2.sct-drp-title").textContent, "Patriots Draft Picks & History");
    assert.match(premium.querySelector(".sct-drp-sub").textContent, /^Every pick the Patriots hold in the \d{4} NFL Draft, round by round, then the club's last 5 draft classes/);
    assert.ok(premium.querySelector(".sct-drp-hero img.sct-drp-logo"), "the banner carries the club's logo");
    assert.equal(premium.querySelectorAll("h1").length, 0, "no H1 in a hub panel");
    assert.deepEqual(
      [...premium.querySelectorAll(".sct-drp-rail > *")].map((el) => el.className.replace(/\s+/g, " ")),
      ["sct-drp-card is-capital", "sct-drp-card is-history", "sct-drp-card is-r1", "sct-drp-method"],
      "the rail: next draft, Last 5 Drafts, Round 1 picks, the position-group note",
    );

    // Picks: a seven-row ledger, each row counting what the club holds, with
    // an accessible sentence; three-stat strip, kicker, three-item legend.
    const rounds = [...premium.querySelectorAll(".sct-drp-ledger .sct-drp-lrow")];
    assert.equal(rounds.length, 7, "one row per round");
    const picks = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_picks_2027.json"), "utf8"),
    );
    const held = picks.teams.ne.holds.length;
    for (const [i, row] of rounds.entries()) {
      const inRound = picks.teams.ne.holds.filter((h) => h.round === i + 1).length;
      assert.equal(row.querySelector(".sct-drp-lcount").textContent, String(inRound), `Round ${i + 1} count`);
      assert.match(row.querySelector(".sct-visually-hidden").textContent, new RegExp(`^Round ${i + 1}: .* held\\.$`));
      assert.equal(row.querySelectorAll(".sct-drp-dot.is-own, .sct-drp-dot.is-from").length, inRound, `Round ${i + 1}: a marker per pick held`);
      assert.equal(row.querySelectorAll(".sct-drp-dot.is-sent").length, picks.teams.ne.sent.filter((h) => h.round === i + 1).length, `Round ${i + 1}: a marker per pick sent`);
    }
    const strip = [...premium.querySelectorAll(".sct-drp-card.is-capital .sct-drp-strip .sct-drp-num")].map((n) => n.textContent);
    assert.deepEqual(strip, [String(held), String(picks.teams.ne.holds.filter((h) => h.from).length), String(picks.teams.ne.sent.length)]);
    assert.ok(premium.querySelector(".sct-drp-ledger .sct-drp-dot.is-own"), "an own pick is a filled dot");
    assert.ok([...premium.querySelectorAll(".sct-drp-ledger .sct-drp-dot-club")].some((c) => c.querySelector("img.sct-drp-dot-crest")), "a club mark beside a moved pick");
    assert.equal(premium.querySelectorAll(".sct-drp-legend > span").length, 3, "a three-item legend");
    assert.ok(premium.querySelector(".sct-drp-card.is-capital .sct-drp-kicker")?.textContent?.length, "a kicker line");
    assert.match(premium.querySelector(".sct-drp-card.is-capital .sct-drp-foot").textContent, /^Compensatory picks are awarded in March/);

    // Last 5 Drafts: the strip, the takeaway, the bars with the count leading
    // and a gold dot on a group that drew a Round 1 pick; then the Round 1 list.
    const history = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_history.json"), "utf8"),
    );
    const window5 = history.teams.ne.filter((p) => p.season > history.latestSeason - 5);
    const hist = premium.querySelector(".sct-drp-card.is-history");
    assert.equal(hist.querySelector(".sct-drp-strip .sct-drp-num").textContent, String(window5.length));
    assert.match(hist.querySelector(".sct-drp-takeaway").textContent, /^\d+% of picks spent on /);
    const shares = [...hist.querySelectorAll(".sct-drp-share")];
    assert.equal(shares.reduce((n, li) => n + Number(li.querySelector(".sct-drp-share-n").textContent), 0), window5.length, "the bars sum to the window");
    assert.ok(shares[0].querySelector(".sct-drp-r1dot"), "the biggest group drew a Round 1 pick");
    const r1 = [...premium.querySelectorAll(".sct-drp-card.is-r1 .sct-drp-r1")];
    assert.deepEqual(
      r1.map((li) => `${li.querySelector(".sct-drp-r1-year").textContent} ${li.querySelector(".sct-dr-name").textContent} ${li.querySelector(".sct-drp-r1-pick").textContent}`),
      window5.filter((p) => p.round === 1).sort((a, b) => b.season - a.season).map((p) => `${p.season} ${p.name} Pick ${p.pick}`),
    );
    assert.match(premium.querySelector(".sct-drp-method").textContent, /Position groups are the broad ones/);

    // History: one year card per draft, newest first, from the register.
    const seasons = [...premium.querySelectorAll(".sct-drp-year .sct-drp-h3")].map((h) => h.textContent);
    assert.equal(seasons.length, 5, "five draft classes");
    assert.deepEqual(seasons, [...seasons].sort().reverse(), "newest first");
    assert.match(premium.querySelector(".sct-drp-year-sum").textContent, /^\d+ picks · \d+ in Round 1$/);
    const latest = history.teams.ne.filter((p) => p.season === history.latestSeason);
    const firstTable = premium.querySelector(".sct-drp-table tbody");
    assert.equal(firstTable.querySelectorAll("tr").length, latest.length, "every pick of the latest draft");
    assert.equal(firstTable.querySelector("tr .sct-dr-name")?.textContent, latest[0].name);
    assert.deepEqual(
      [...premium.querySelectorAll(".sct-drp-table thead th")].slice(0, 6).map((th) => th.textContent),
      ["Rd", "Pick", "Player", "Pos", "College", "Status"],
    );

    // Player column: a headshot well ahead of every name, the photo through
    // the image route for every pick the register paired with a Sleeper id
    // (mak, 2026-10-29: "add player images"); a pick without one keeps the
    // empty well so the names line up.
    const playerCells = [...premium.querySelectorAll(".sct-drp-table tbody th.is-player")];
    assert.ok(playerCells.every((c) => c.querySelector(".sct-drp-player > .sct-drp-face")), "every name has a face well");
    const withPhoto = playerCells.filter((c) => c.querySelector(".sct-drp-face img"));
    assert.ok(withPhoto.length > 0, "at least one pick has a photo");
    for (const c of withPhoto) {
      const img = c.querySelector(".sct-drp-face img");
      assert.match(img.getAttribute("src"), /\/news-image\/player\/\d+\/(latest|[0-9a-f]{10})\/160\.webp$/);
      assert.equal(img.getAttribute("alt"), "", "decorative: the name is beside it");
      assert.equal(img.getAttribute("loading"), "lazy");
    }
    const paired = latest.filter((p) => p.sleeperId);
    assert.ok(paired.length > 0, "the register pairs Sleeper ids");
    const firstRows = [...firstTable.querySelectorAll("tr")];
    for (const p of paired) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      assert.match(row.querySelector(".sct-drp-face img")?.getAttribute("src") ?? "", new RegExp(`/news-image/player/${p.sleeperId}/`), `${p.name} wears their own photo`);
    }

    // College column: the school's crest in a small square beside its
    // written-out name, through the image route's college source (same
    // date, "add college images"); a school with no pairing keeps the square.
    const logos = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "college_logos.json"), "utf8"));
    const collegeCells = [...premium.querySelectorAll(".sct-drp-table td.is-college")];
    assert.ok(collegeCells.every((c) => c.querySelector(".sct-drp-college > .sct-drp-crest + .sct-drp-college-name")), "crest square then the name");
    for (const p of latest) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      const logo = logos.logos[p.college];
      const img = row.querySelector(".sct-drp-crest img");
      if (logo) {
        assert.match(img?.getAttribute("src") ?? "", new RegExp(`/news-image/college/${logo.id}/(latest|[0-9a-f]{10})/80\\.webp$`), `${p.college} crest`);
        assert.match(img.getAttribute("srcset"), /80\.webp 80w, .*160\.webp 160w$/);
        assert.equal(img.getAttribute("alt"), "");
      } else {
        assert.equal(img, null, `${p.college} has no crest`);
      }
    }
    assert.ok(premium.querySelector(".sct-drp-crest img"), "at least one crest");

    // Pos column: the position with the depth-chart slot beneath where a
    // chart lists the player (mak, 2026-10-29).
    assert.ok(premium.querySelector(".sct-drp-table td.is-pos .sct-drp-pos + .sct-dr-slot"), "a slot under a position");

    // Status column: roster standing from the weekly rosters (mak,
    // 2026-10-29: "active, waived, traded, etc.") as a toned badge, with
    // where a departed player is now on a second line.
    const statusDoc = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "draft_status.json"), "utf8"));
    const statusCells = [...premium.querySelectorAll(".sct-drp-table td.is-status")];
    const labels = new Set(statusCells.map((c) => c.querySelector(".sct-drp-badge")?.textContent));
    for (const old of ["Starter", "Regular", "Rotational", "Limited", "No games", "Not active"]) assert.ok(!labels.has(old), `${old} is gone`);
    assert.ok(labels.has("Active"), "the current class is active");
    assert.ok(statusCells.every((c) => !c.querySelector(".sct-drp-badge") || c.querySelector(".sct-drp-badge").getAttribute("data-tone")), "every badge has a tone");
    for (const p of latest) {
      const row = firstRows.find((r) => r.querySelector(".sct-dr-name")?.textContent === p.name);
      const entry = statusDoc.players[p.gsisId];
      const cell = row.querySelector("td.is-status");
      if (!entry) continue;
      if (entry.left) {
        assert.equal(cell.querySelector(".sct-drp-badge").getAttribute("data-status"), entry.left.kind, `${p.name} shows how they left`);
        if (entry.now.kind !== "none" && entry.left.kind !== "retired") assert.match(cell.querySelector(".sct-drp-status-sub")?.textContent ?? "", /^now /, `${p.name} says where they are now`);
      } else {
        assert.equal(cell.querySelector(".sct-drp-badge").getAttribute("data-status"), entry.now.kind, `${p.name} shows their standing`);
      }
      // No row is muted (mak, 2026-10-29: "do not fade out players who are not on the team").
      assert.ok(!row.classList.contains("is-gone"), `${p.name} reads like every other row`);
    }
    assert.equal(premium.querySelector(".sct-drp-main .sct-drp-foot"), null, "no footnote under the tables");

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
