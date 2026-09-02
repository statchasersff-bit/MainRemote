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
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

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

before(async () => {
  server = await startServer();
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
    // Section navigation is real anchors to real sections.
    const navLinks = [...doc.querySelectorAll(".sct-nav-link")];
    assert.ok(navLinks.length >= 2, "section nav rendered");
    for (const link of navLinks) {
      const id = link.getAttribute("href").replace(/^#/, "");
      assert.ok(doc.getElementById(id), `nav points at a real section: #${id}`);
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
        const id = link.getAttribute("href").replace(/^#/, "");
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
   * Anchor targets. `scroll-padding-top` on .sct does nothing — scroll padding
   * applies to the scroll container and .sct is not one — so every section the
   * nav links to needs its own `scroll-margin-top`, or each link lands its
   * heading underneath the sticky bar. Worst on a phone, where the bar is a
   * larger share of the screen.
   */
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
    ]) {
      const res = await get(route);
      assert.equal(res.status, 404, `${route} must not exist outside development`);
    }
  });

  /**
   * The fragment endpoints must stay bare. If one ever starts shipping its own
   * <link> or <script>, WordPress would enqueue the assets a second time and
   * the harness above would stop representing what the plugin actually does.
   */
  test("the fragments it wraps ship no assets of their own", async () => {
    for (const route of ["/embed/ssr.html", "/embed/team/ne"]) {
      const res = await get(route);
      assert.equal(res.status, 200);
      assert.ok(!/<link\b/i.test(res.body), `${route} must not carry a stylesheet`);
      assert.ok(!/<script\b/i.test(res.body), `${route} must not carry a script`);
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
    // the source view has to exist at all.
    assert.ok(!/<link\b/i.test(endpoint.body));
    assert.ok(!/<script\b/i.test(endpoint.body));

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
