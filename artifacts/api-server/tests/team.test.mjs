/**
 * Team hub regression tests.
 *
 * Same posture as seo.test.mjs: fetch the served HTML and assert on it WITHOUT
 * executing any JavaScript, because the whole point of these pages is that they
 * arrive complete. If someone moves a section behind a client fetch, drops the
 * canonical, or lets a team page render a second <h1> inside a WordPress page,
 * these fail.
 *
 * Deliberately tolerant of the upstream providers. Schedule, record and season
 * statistics come from ESPN and the roster from Sleeper; any of them can be
 * down when this runs, and the page is designed to omit those sections rather
 * than break. So the assertions cover what the page owes regardless — identity,
 * navigation, links, embed behaviour — plus the rule that a section which
 * cannot load must be ABSENT rather than rendered full of placeholders.
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

before(async () => {
  server = await startServer();
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
 * crawler reads. The tab strip is the one place where the scripted behaviour is
 * different in kind rather than in polish — it switches the panel, rewrites the
 * heading above the fragment and puts a different URL in the address bar — and
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
 * A tab's questions live in its tail, which renders after the tools block — NOT
 * inside the panel. Scoping to "#outlook" finds nothing.
 */
const tailOf = (id) => `[data-sct-faq-for="${id}"]`;

/** Every question/answer pair on the page, or inside one scope. */
function faqEntries(doc, scope = "") {
  const prefix = scope ? `${scope} ` : "";
  return [...doc.querySelectorAll(`${prefix}.sct-faq-item`)].map((item) => ({
    question: item.querySelector(".sct-faq-q")?.textContent?.trim() ?? "",
    answer: item.querySelector(".sct-faq-a")?.textContent?.trim() ?? "",
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
});

describe("crawlable HTML (no JavaScript executed)", () => {
  test("the page ships its content, not a shell", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    // Section navigation is real anchors to real ADDRESSES — the section
    // pages — each naming the panel it switches to without a load.
    const navLinks = [...doc.querySelectorAll(".sct-nav-link")];
    assert.ok(navLinks.length >= 2, "section nav rendered");
    for (const link of navLinks) {
      const id = link.getAttribute("data-sct-panel-id");
      assert.ok(doc.getElementById(id), `nav names a real panel: ${id}`);
      assert.equal(
        link.getAttribute("href"),
        `/team/new-england-patriots/${id}/`,
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
    // Out of the index on this origin, still usable when embedded — the same
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
    assert.match(brown, /\/nfl\/players\/outlook\/aj-brown\/$/);

    for (const href of byName.values()) {
      assert.match(href, /^https?:\/\//, "absolute, for the WordPress mount");
      // A slug the dictionary supplied, never a name pushed through a slugifier
      // — the giveaway is the single letters a dotted initial leaves behind.
      const slug = href.split("/outlook/")[1]?.replace(/\/$/, "") ?? "";
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
    const { doc } = await dom("/team/new-england-patriots");
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

  test("the Schedule tab links every game to its pair page, so Matchups need not", async () => {
    const { doc } = await dom("/team/new-england-patriots");
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
        assert.equal(cell.textContent.trim().startsWith("View matchup"), true);
      }
    }
    const linked = rows.filter((r) => r.querySelector("a.sct-srow-view"));
    assert.ok(linked.length > 0, "at least some rows link to a pair page");

    const cards = [...doc.querySelectorAll("#schedule .sct-game")];
    assert.ok(cards.length > 0, "the upcoming cards rendered");
    for (const card of cards) {
      const cta = card.querySelector(".sct-game-cta a");
      assert.ok(cta, "an upcoming card offers its matchup");
      assert.match(cta.getAttribute("href"), /\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\//);
    }
  });

  test("the season shape rail only ever counts the rows beside it", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const rows = [...doc.querySelectorAll("#schedule .sct-srow:not(.is-bye)")];
    const shape = doc.querySelector("#schedule .sct-shape");
    if (rows.length === 0) {
      assert.equal(shape, null, "no fixtures, nothing to draw a shape from");
      return;
    }
    assert.ok(shape, "the schedule rendered rows, so the rail rendered");

    // Every figure in the rail is arithmetic on the table beside it — that is
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

    assert.equal(figures.get("Games"), String(rows.length));
    assert.equal(figures.get("Home"), String(home));
    assert.equal(figures.get("Away"), String(rows.length - home));

    // The strip is the same season again: one cell per home and away row, and
    // a bye cell only where the table gave the bye a row of its own.
    const kinds = [...shape.querySelectorAll(".sct-path-week")].map((cell) =>
      cell.getAttribute("data-kind"),
    );
    const byeRow = doc.querySelector("#schedule .sct-srow.is-bye");
    assert.equal(kinds.filter((kind) => kind === "home").length, home);
    assert.equal(
      kinds.filter((kind) => kind === "away").length,
      rows.length - home,
    );
    assert.equal(kinds.filter((kind) => kind === "bye").length, byeRow ? 1 : 0);
    assert.equal(
      figures.get("Bye week"),
      byeRow
        ? byeRow.querySelector(".sct-srow-week").textContent.trim()
        : "TBD",
    );

    // The rows carry no DIV pill any more — the slate card IS where the table
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
      ],
    );
  });

  test("the schedule FAQ answers from the rows above it", async () => {
    const { doc } = await dom("/team/new-england-patriots");
    const entries = faqEntries(doc, tailOf("schedule"));
    assert.ok(entries.length >= 5, `expected a schedule FAQ, got ${entries.length}`);

    for (const entry of entries) {
      assert.match(entry.question, /\?$/, `not a question: ${entry.question}`);
      assert.match(entry.answer, /[.!?]$/, `unpunctuated: ${entry.answer}`);
    }

    // Every week an answer names is a week the table prints. That is the whole
    // point of deriving these from the fixtures rather than writing them: an
    // answer cannot put a game in a week the schedule above does not. The bye
    // row counts — it is a week in the table with no fixture against it.
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

    // "Next" is the next UNPLAYED game — see the note at the top of
    // lib/team/schedule-faq.ts. Once the season is over the cards fall back to
    // its tail and the question is not asked at all, which is why this pairs
    // the card with the answer rather than asserting the answer exists.
    const card = doc.querySelector('#schedule .sct-game[data-next="1"]');
    const next = entries.find((e) => /play next\?$/.test(e.question));
    if (card && next) {
      const week = card.querySelector(".sct-game-week").textContent.trim();
      assert.ok(
        next.answer.includes(week),
        `the next-game answer is not about ${week}: ${next.answer}`,
      );
      const nickname = card
        .querySelector(".sct-game-opp")
        .textContent.trim()
        .replace(/^(vs|at)\s+/, "");
      assert.ok(
        next.answer.includes(nickname),
        `the next-game answer names a different opponent than the card (${nickname}): ${next.answer}`,
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
    // Still a section, though — dropping it from the strip must not take the
    // public page with it. (matchup.test.mjs covers what that page contains.)
    const page = await get("/team/new-england-patriots/matchups/");
    assert.equal(page.status, 200, "the section page still renders");
  });

  test("every opponent carries a shorter spelling, and only to the eye", async () => {
    const { doc } = await dom("/team/new-england-patriots");
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

  test("a designated player Sleeper demoted is still on the chart, outside the order", async () => {
    const { doc } = await dom("/team/new-england-patriots/depth-chart/");
    const out = [...doc.querySelectorAll(".sct-depth-row.is-out")];
    if (out.length === 0) return; // Nobody relevant is out for this team today.

    for (const row of out) {
      const name = row.querySelector(".sct-depth-name-long, .sct-depth-name");
      assert.ok(name?.textContent.trim(), "an out row still names the player");
      // No slot chip: Sleeper's number for an injured player is the demoted
      // one, and "WR6" beside a receiver who is the WR1 when fit is the claim
      // the row exists to correct.
      assert.equal(
        row.querySelector(".sct-slot-chip"),
        null,
        "an out row carries no slot number",
      );
      assert.ok(
        row.querySelector(".sct-injury-badge"),
        "an out row says what is wrong",
      );
    }

    // The numbered rows keep a clean 1..n, with the out rows after them.
    for (const col of doc.querySelectorAll(".sct-depth-col")) {
      const rows = [...col.querySelectorAll(".sct-depth-row")];
      const firstOut = rows.findIndex((r) => r.classList.contains("is-out"));
      if (firstOut === -1) continue;
      assert.ok(
        rows.slice(firstOut).every((r) => r.classList.contains("is-out")),
        "out rows sit after the running order, not inside it",
      );
      // The count above the column describes the rows under it.
      const shown = col.querySelector(".sct-depth-count").textContent.trim();
      assert.equal(Number.parseInt(shown, 10), rows.length);
    }
  });

  test("the depth chart FAQ names the players the chart above it lists", async () => {
    const { doc } = await dom("/team/new-england-patriots");
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

    // Every name in an answer is a name the chart itself rendered — this is the
    // one thing deriving the FAQ is supposed to guarantee.
    const charted = new Set(
      [...doc.querySelectorAll("#depth-chart .sct-depth-name-long, #depth-chart .sct-depth-name")]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
    assert.ok(charted.size > 0, "the chart rendered names to check against");
    // Sleeper demotes an injured player on the depth chart, so a genuine WR1 on
    // IR falls off the four-deep preview and the chart correctly shows someone
    // else first. The answer has to say why, or it reads as a wrong answer to
    // anyone who knows the roster.
    const charted2 = [...doc.querySelectorAll("#depth-chart .sct-depth-name-long, #depth-chart .sct-depth-name")]
      .map((n) => n.textContent.trim());
    const outNames = [...doc.querySelectorAll(".sct-injury-name")]
      .map((n) => n.textContent.trim())
      .filter((n) => n && !charted2.includes(n));
    if (outNames.length) {
      const mentioned = entries.some((e) =>
        outNames.some((who) => e.answer.includes(who)),
      );
      assert.ok(
        mentioned,
        `a designated player off the chart (${outNames[0]}) goes unmentioned`,
      );
    }

    const starter = entries.find((e) => /starting quarterback\?$/.test(e.question));
    assert.ok(starter, "the FAQ answers who the starting quarterback is");
    assert.ok(
      [...charted].some((name) => starter.answer.includes(name)),
      `the QB answer names nobody on the chart: ${starter.answer}`,
    );
  });

  test("links into StatChasers break out of the frame", async () => {
    const { doc } = await dom("/team/new-england-patriots?embed=1");
    const resources = [...doc.querySelectorAll(".sct-resource-link")];
    assert.ok(resources.length > 0, "resource cards rendered");
    for (const link of resources) {
      // A plain link would load the whole site inside the iframe.
      assert.equal(link.getAttribute("target"), "_top");
      assert.match(link.getAttribute("href"), /^https?:\/\//);
    }
  });
});

/**
 * The FAQs on the Outlook and Stats tabs.
 *
 * Every answer is built from what the tab already rendered — the outlook cards
 * (lib/team/outlook-faq.ts) and the stat ladders (lib/team/stats-faq.ts) — so
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
    const { doc } = await dom("/team/new-england-patriots");
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
    const { doc } = await dom("/team/new-england-patriots");
    const entries = faqEntries(doc, tailOf("stats"));
    // A per-game rate with no denominator is the one way this block can
    // mislead, and early in a season it is the whole story.
    // Case-insensitive: the window is a leading clause in some answers and a
    // trailing one in others, so it is capitalised in some of them.
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
    const { doc } = await dom("/team/new-england-patriots");
    // The questions render after the "Explore StatChasers" block rather than
    // inside their panel, but they are still a tab's questions, not a shared
    // FAQ: each tail carries exactly one block, and the tail names the panel it
    // belongs to. Both take an <h2> and put their questions at <h3>, because
    // the tool list they follow is an <h2> — a deeper heading would file them
    // in the outline under the tool list, which is neither where they are nor
    // what they are about.
    for (const id of ["outlook", "stats", "depth-chart", "schedule"]) {
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
      // Out of the panel, and after the tools block it now follows.
      assert.equal(
        doc.querySelector(`#${id} .sct-faq`),
        null,
        `${id}: the questions left the panel`,
      );
      // querySelectorAll returns document order, so the tool list coming back
      // first is the assertion.
      const order = [...doc.querySelectorAll(`#resources, ${scope}`)];
      assert.equal(order.length, 2, `${id}: both blocks on the page`);
      assert.equal(
        order[0].id,
        "resources",
        `${id}: the questions come after the tools block`,
      );
    }
  });

  test("the answers fold, one per question, and the questions all show", async () => {
    // The block itself does not fold — the questions are the index, so a reader
    // scanning for the one they arrived with sees all of them without opening
    // anything. Each question is its own <details> with no `open`, and the
    // question sits in the <summary>: it is the thing a reader clicks, and it
    // keeps the outline identical whether the answer is open or not. The
    // answers stay in the DOM: the FAQPage node above is only honest if they
    // are on the page.
    const { doc } = await dom("/team/new-england-patriots");
    for (const [id, tag] of [
      ['[data-sct-faq-for="outlook"]', "H3"],
      ['[data-sct-faq-for="stats"]', "H3"],
      ['[data-sct-faq-for="depth-chart"]', "H3"],
      ['[data-sct-faq-for="schedule"]', "H3"],
    ]) {
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
    assert.ok(
      faqEntries(doc, tailOf("outlook")).length > 0 && faqEntries(doc, tailOf("stats")).length > 0,
      "this test is only meaningful with both tabs carrying questions",
    );

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
    // gets a page penalised, so this is equality rather than a spot check.
    assert.deepEqual(asked, entries);
  });

  test("embedded, the questions ship as data for the host to place", async () => {
    // Rank Math owns the graph on statchasers.com, so the fragment must not
    // inject a second <script type="application/ld+json"> — one graph competes
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
      // The visible questions still ship — it is only the node that is deferred.
      assert.match(res.body, /sct-faq-q/, `${path} should still render the FAQ`);

      const island = res.body.match(
        /<script type="application\/json" class="sct-faq-data">(.*?)<\/script>/s,
      );
      assert.ok(island, `${path} must carry the FAQ data island`);

      // The island has to describe what is on the page, not a second version of
      // it: markup that says something the page does not is the whole reason
      // schema gets a page penalised. Same equality the standalone node gets.
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
        const section = doc.getElementById(id);
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
    const { doc } = await dom("/team/carolina-panthers");
    const hasCards = doc.querySelectorAll(".sct-news").length > 0;
    const hasEmpty = doc.querySelectorAll(".sct-empty").length > 0;
    assert.ok(hasCards || hasEmpty, "news section is never simply blank");
  });
});

describe("caching", () => {
  test("repeat requests revalidate to 304", async () => {
    // Warm the page first. The ETag fingerprints every provider's fetch stamp,
    // so the FIRST request for a team — the one that populates those providers
    // — legitimately produces a different validator from the one after it. The
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
   * summary — so most of it was thrown away, and nearly all of it on a phone
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
      ".sct-hero must not clip — that clips the open team switcher with it",
    );
    assert.ok(
      /\.sct-hero-decor\s*\{[^}]*overflow:\s*hidden/.test(css.body),
      ".sct-hero-decor is the element that clips",
    );
  });

  /**
   * The hero's top row breaks on the name, not at a width.
   *
   * It used to restack at 900px, which is a number that fits no team: the
   * switcher is a pill as wide as the club's name, so at 900 "Philadelphia
   * Eagles" still had room to spare while "Washington Commanders" had been
   * wrapping to two lines for fifty pixels. The row is a flex line now, and
   * what makes it break is the name's own width — which is only true while the
   * name cannot wrap and the block holding it keeps its automatic minimum.
   * Both halves are asserted because either alone puts the old behaviour back:
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
      ".sct-hero-text keeps its automatic minimum — that is the breakpoint",
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
      ".sct-title itself must not be armed with it — the matchup heading wraps",
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
      // ESPN also sends bare places ("1st"), which have nothing to shorten —
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
  });

  /**
   * Anchor targets. `scroll-padding-top` on .sct does nothing — scroll padding
   * applies to the scroll container and .sct is not one — so every section the
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
    // stays, ellipsed — which is the failure it exists to prevent.
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
   * The whole arrangement rests on one guard — NODE_ENV — and this suite runs
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
   * /preview/* assembles a fragment the way WordPress assembles it — the
   * plugin's stylesheet and bundle, inside a host page — because the fragment
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
   *   an FAQ's questions — `scp-faq-data` on the player mount, `sct-faq-data`
   *   on the team hub, `scf-faq-data` on the FPA table — which the plugin that
   *   owns that mount lifts into Rank Math's graph and strips before any of the
   *   markup is printed, so it never reaches the rendered page at all;
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
   * pane — the whole point is to alternate between views in one frame — so Raw
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

    // And it is bare — which is exactly why it cannot carry the bar, and why
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
 * oEmbed template instead of the page — 31 of them per team page, each a
 * crawlable variant of a URL that already exists clean.
 *
 * Booted separately from the suite above because the behaviour IS the
 * environment: one server cannot answer for both configurations.
 */
describe("the WordPress fragment's team switcher", () => {
  async function fragment(env) {
    const srv = await startServer(env);
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
        `an off-origin switcher link must not carry embed= (${href}) — ` +
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
      assert.match(href, /^\/team\/[a-z0-9-]+\?embed=1$/);
    }
  });

  test("SC_TEAM_LINK_QUERY overrides both", async () => {
    const html = await fragment({
      SC_TEAM_PATH_PREFIX: "/nfl/teams/",
      SC_TEAM_LINK_QUERY: "?src=hub",
    });
    assert.match(html, /href="\/nfl\/teams\/dallas-cowboys\?src=hub"/);
  });
});

/**
 * The index of all 32, and the fragment the container page mounts.
 *
 * /nfl/teams/ used to be a stub list the plugin wrote into the page once —
 * eight <h2>s and 32 bullets in the theme's own styling, standing in front of
 * 32 hubs that look nothing like it. It has a mount now, and these are what
 * that mount owes: the switcher's grid, all 32 crests, links that leave this
 * origin, and no document furniture, because the WordPress page supplies it.
 */
describe("the team index", () => {
  async function indexFragment(env = {}) {
    const srv = await startServer(env);
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

  test("it is a conference band of four division cards, with all 32 and their crests", async () => {
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

  test("the links point at the public site, not at this origin", async () => {
    // Same rule the hub's switcher follows, and for the same reason: a reader
    // clicking a team inside a WordPress page belongs on statchasers.com.
    const { body } = await indexFragment({ SC_TEAM_PATH_PREFIX: "/nfl/teams/" });
    const hrefs = [...body.matchAll(/class="sct-switch-team"\s+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(hrefs.length, 32);
    for (const href of hrefs) {
      assert.match(href, /^\/nfl\/teams\/[a-z0-9-]+$/, href);
      assert.ok(
        !href.includes("embed="),
        `an off-origin link must not carry embed= (${href})`,
      );
    }
  });

  test("the standalone page and the fragment list the same 32", async () => {
    // They share one renderer precisely so they cannot drift; this is the
    // assertion that keeps it that way if someone splits them again.
    const srv = await startServer();
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
    // the division of labour every other fragment here already followed — and
    // the reason this asserts rather than merely no longer testing the hero is
    // that the markup is easy to put back by habit.
    const { doc } = await dom("/team");
    assert.equal(doc.querySelectorAll(".sct-hero").length, 0);
    assert.equal(doc.querySelectorAll("h1").length, 0);
    // The title tag still names the page — the heading went, not the page.
    assert.equal(doc.title, "NFL Team Hubs | StatChasers");
    assert.ok(doc.querySelector(".sct-section"), "the grid still opens it");
  });

  test("it revalidates and keeps this origin out of the index", async () => {
    const { headers } = await indexFragment();
    const etag = headers.get("etag");
    assert.ok(etag, "the fragment is revalidatable");
    assert.match(headers.get("x-robots-tag"), /noindex, indexifembedded/);

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
 * These assert the two rules that failed in production — a palette published
 * on `:root`, and typography left to inheritance — against the stylesheet as
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
    // own repaints the hub with no contest — statchasers.com defines --sc-navy
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
    // in a theme took every heading in the hub while our own colour and size
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
   * Every heading class the renderer prints, armed — checked against the
   * RENDERER rather than against a list written out here, because a list
   * written out here is a list that goes stale. Divi's typography panel emits
   * `#left-area h3 { font-size: 38px }`, an id, so a class in this file loses
   * to it unless it says !important; `.sct-faq-q` did not, and shipped an FAQ
   * whose questions rendered at 38px and read as section headings.
   *
   * The size is what is asserted. Colour is armed alongside it on most of
   * these but not all — .sct-band-label and friends take a colour the theme
   * cannot reach — whereas font-size is the one Divi always sets.
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
      // Anchored to the start of a line so that a DESCENDANT rule — ".sct-hero-text
      // .sct-title", which sets one property and arms nothing — cannot be read
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
   * from the served sheet. They were moved into the plugin — one copy for all
   * five tools, in `statchasers_team_full_width_css()` — and the assertion was
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
    // Builder, so `width: 100%` there meant the whole screen — which is how
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
      "and centred in it, as the rest of the site's content is",
    );

    // Both of these are the difference between "full width" and "full width
    // with a grey line down it and the widgets dumped underneath".
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
   * of its own once embedded — the host column decides, and the plugin holds
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
    // the colour is written out — keep it equal to --sc-gold.
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
    // on the phone breakpoint — a gutter that is not there.
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
   * the current one, which through Week 1 is every team — and a heading reading
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

    const note = heading.parentElement.querySelector(".sct-note");
    assert.ok(note, "and the block states which season it is showing");
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
   * not one day earlier — which is no use to whoever makes the change.
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
   * decides the answer for every later one — and both directions are wrong:
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
      /<h1 class="sct-h2[^"]*">Patriots Team Stats 2\d{3}<\/h1>/,
      "the H1 is the section's own heading",
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

describe("team section URLs", () => {
  /**
   * The heading each section prints for itself — NOT the H1.
   *
   * The hero is the club's name on every one of these addresses. It used to
   * take the page's subject instead ("New England Patriots Depth Chart 2026"),
   * which meant the header rewrote itself on every tab a reader clicked; the
   * phrase belongs to the section, and the document title is what names the
   * address.
   */
  const SECTIONS = [
    ["outlook", /^2\d{3} Fantasy Outlook$/],
    ["stats", /^Patriots Team Stats 2\d{3}$/],
    ["schedule", /Patriots Schedule$/],
    ["depth-chart", /^Patriots Fantasy Depth Chart$/],
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
    // One of each, and every URL-bearing tag is the pretty self-reference —
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
   * — one panel, one H1, one self-referencing canonical — which is what the
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
   * Without JavaScript a tab is a link and loads the section page — which the
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

    const stats = doc.querySelector('.sct-nav-link[data-sct-panel-id="stats"]');
    assert.ok(stats, "the Stats tab is there");

    stats.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    assert.equal(
      window.location.pathname,
      "/team/new-england-patriots/stats/",
      "the address bar names the section",
    );
    assert.ok(
      doc.getElementById("stats").classList.contains("is-active"),
      "the stats panel is the one showing",
    );
    assert.equal(
      doc.getElementById("outlook").classList.contains("is-active"),
      false,
      "and the one it replaced is not",
    );
    assert.equal(
      heading.textContent.trim(),
      landed,
      "the H1 did not follow — the hero is the club on every tab",
    );

    // Nothing loaded: the other four panels are still in the document, which is
    // what separates this from having navigated.
    assert.equal(doc.querySelectorAll("[data-sct-panel]").length >= 5, true);

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
    // is back — and it is still the only one.
    for (const id of ["outlook", "schedule", "depth-chart", "matchups"]) {
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
    // is that its FAQPage is ITS list — the hub's four lists on a Schedule page
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
    const expected = {
      outlook: "New England Patriots Fantasy Football Outlook 2026",
      stats: "New England Patriots Stats 2026: Offense, Defense & NFL Rankings",
      schedule: "New England Patriots Schedule 2026: Dates, Opponents & Results",
      "depth-chart": "New England Patriots Depth Chart 2026: Starters & Backups",
      news: "New England Patriots News 2026: Injuries, Roster Moves & Fantasy Impact",
    };
    for (const [id, title] of Object.entries(expected)) {
      const { doc } = await dom(at(id));
      assert.equal(doc.querySelector("title").textContent, `${title} | StatChasers`);
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
      ["/team/ne?section=outlook&embed=1", "/team/new-england-patriots/outlook/?embed=1"],
    ]) {
      const res = await get(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get("location"), target, path);
    }
  });

  test("an unrecognised ?section= still falls through to the hub", async () => {
    // Defensive: a stale link is worth a full page, not a 404 — the pretty
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
    // The strip is here too, and its links are the public section addresses —
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
});
