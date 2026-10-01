/**
 * The team hub's Coaching Profile & Tendencies section
 * (src/lib/team/coaching*.ts).
 *
 * Asserts the build spec's acceptance checklist on the served HTML. The Bills
 * are the reference implementation and the only club in
 * data/team/coaching_2026.json so far; a club with no entry must render no
 * section and no tab. The four feed-backed tendency rows are checked against
 * the committed usage file, since that is where their live numbers come from.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

let server;
let replay;

const coaching = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "data", "team", "coaching_2026.json"), "utf8"),
);
const usage = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "data", "team", "usage_2026.json"), "utf8"),
);

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
});

after(async () => {
  await server?.stop();
  await replay?.stop();
});

async function page(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);
  const body = await res.text();
  return { body, doc: new JSDOM(body).window.document };
}

describe("placement", () => {
  test("the panel sits between Usage and Stats, with id coaching", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const panels = [...doc.querySelectorAll("[data-sct-panel]")].map((s) => s.id);
    assert.deepEqual(panels.slice(0, 4), ["outlook", "usage", "coaching", "stats"]);
    const tabs = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.textContent);
    assert.deepEqual(tabs.slice(0, 4), ["Outlook", "Usage", "Coaching", "Stats"]);
  });

  test("the tab is a hub-only panel: hub address plus #coaching, no section URL", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(
      doc.querySelector("#coaching-tab").getAttribute("href"),
      "/team/buffalo-bills/#coaching",
    );
    // No public section page until the URL is approved.
    const res = await fetch(`${server.origin}/team/buffalo-bills/coaching/`, { redirect: "manual" });
    assert.notEqual(res.status, 200);
  });

  test("a club with no coaching entry renders no panel and no tab", async () => {
    const { doc } = await page("/team/new-england-patriots/");
    assert.equal(doc.querySelector("#coaching"), null);
    assert.equal(doc.querySelector("#coaching-tab"), null);
  });
});

describe("the ten components, in order", () => {
  test("header, intro, card+table grid, shifts, staff, dossier, finishes, rookie note, panels, bottom line", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const root = doc.querySelector("#coaching .sct-co");
    assert.ok(root, "section renders");
    const order = [
      ".sct-co-head",
      ".sct-co-intro",
      ".sct-co-grid",
      ".sct-co-shifts",
      ".sct-co-staff",
      ".sct-co-dossier",
      ".sct-co-finishes",
      ".sct-co-rookie",
      ".sct-co-panels",
      ".sct-co-bottom",
    ].map((sel) => root.querySelector(sel));
    order.forEach((el, i) => assert.ok(el, `component ${i} present`));
    const all = [...root.querySelectorAll("*")];
    const idx = order.map((el) => all.indexOf(el));
    assert.deepEqual([...idx].sort((a, b) => a - b), idx);
    // Two panel pairs: fingerprint (distribution + backfield), situational.
    assert.equal(root.querySelectorAll(".sct-co-panels").length, 2);
    assert.equal(root.querySelectorAll(".sct-co-panel").length, 4);
    assert.equal(
      root.querySelector(".sct-co-head h2").textContent,
      "Coaching Profile & Tendencies",
    );
  });

  test("the continuity principle opens the intro, in plain prose", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const intro = doc.querySelector(".sct-co-intro").textContent;
    assert.match(intro, /^Play-calling tendencies carry over from season to season/);
    assert.match(intro, /Joe Brady is a first-year head coach, but a third-year play-caller\./);
  });
});

describe("the coach card", () => {
  test("kicker, tree badge, career path, reliability word and ledger all render", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const card = doc.querySelector(".sct-co-card");
    assert.match(card.querySelector(".sct-co-kicker").textContent, /Head coach · First season · Primary play-caller/i);
    assert.equal(card.querySelector(".sct-co-name").textContent, "Joe Brady");
    assert.match(card.querySelector(".sct-co-tree").textContent, /Saints \/ Payton coaching tree/i);
    assert.equal(card.querySelectorAll(".sct-co-step").length, 4);
    // The rating is text, not just a bar, and the Bills rule to HIGH:
    // same play-caller, two prior seasons.
    assert.equal(card.querySelector(".sct-co-rating").textContent, "HIGH");
    assert.ok(card.querySelector(".sct-co-rating.is-high"));
    assert.ok(card.querySelector(".sct-co-relbar"));
    assert.match(card.querySelector(".sct-co-ledger-val").textContent, /^Brady — 3 of 3 games in 2026/);
  });
});

describe("the tendencies table", () => {
  test("ten rows with coloured change arrows and the adapted prior-role header", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const table = doc.querySelector("table.sct-co-table");
    assert.equal(table.querySelectorAll("tbody tr").length, 10);
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    assert.deepEqual(heads, ["Tendency", "2025 (as OC)", "2026 (as HC)", "Change", "NFL avg."]);
    assert.ok(table.querySelectorAll(".sct-co-change.is-up").length >= 1);
    // Ranks appear where the stored copy lists them.
    assert.match(table.textContent, /3rd in NFL/);
  });

  test("the feed-backed rows carry the usage file's live numbers, not the spec placeholders", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const rows = [...doc.querySelectorAll("table.sct-co-table tbody tr")];
    const env = usage.teams.buf.env;
    const current = (label) =>
      rows.find((r) => r.querySelector("th").textContent.startsWith(label)).querySelector(".is-now")
        .textContent;
    assert.equal(current("Pass rate (all downs)"), `${env.passRate.value}%`);
    assert.equal(current("Neutral pace"), `${env.pace.value.toFixed(1)}s`);
    assert.equal(current("Red-zone pass rate"), `${env.rzPassRate.value}%`);
    // PROE is signed either way.
    assert.match(current("Pass rate over expected"), /^[+−]/);
  });
});

describe("staff, dossier and finishes", () => {
  test("the OC card wears the delegation watch; the DC card speaks to offence fantasy", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const cards = [...doc.querySelectorAll(".sct-co-staffcard")];
    assert.equal(cards.length, 3);
    assert.ok(cards[0].classList.contains("is-watch"));
    assert.match(cards[0].querySelector(".sct-co-role").textContent, /Delegation watch/i);
    assert.match(cards[1].textContent, /Why this matters for offense fantasy/);
    assert.match(cards[2].querySelector(".sct-co-h4").textContent, /8 of 11 retained/);
  });

  test("the current dossier and finishes rows are the gold ones", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const dossier = [...doc.querySelectorAll("table.sct-co-dossier tbody tr")];
    assert.equal(dossier.length, 4);
    assert.ok(dossier[3].classList.contains("is-current"));
    assert.equal(doc.querySelectorAll("table.sct-co-dossier tbody tr.is-current").length, 1);
    const finishes = [...doc.querySelectorAll("table.sct-co-finishes tbody tr")];
    assert.equal(finishes.length, 5);
    assert.ok(finishes[4].classList.contains("is-current"));
    assert.match(finishes[4].textContent, /pace through Week 3/);
    assert.ok(doc.querySelectorAll(".sct-co-finish.is-good").length >= 6);
    assert.ok(doc.querySelectorAll(".sct-co-finish.is-bad").length >= 4);
  });
});

describe("panels", () => {
  test("distribution bars carry league-average markers and gold highlights, with the numbers in text", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const panel = [...doc.querySelectorAll(".sct-co-panel")][0];
    assert.match(panel.querySelector(".sct-co-h3").textContent, /How he distributes the ball/);
    assert.equal(panel.querySelectorAll(".sct-co-brow").length, 4);
    assert.equal(panel.querySelectorAll(".sct-co-bmark").length, 4);
    assert.equal(panel.querySelectorAll(".sct-co-bfill.is-gold").length, 2);
    assert.match(panel.textContent, /24% · NFL 19%/);
  });

  test("the backfield chart's current bar is live from the usage file, in gold", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const cols = [...doc.querySelectorAll(".sct-co-col")];
    assert.equal(cols.length, 6);
    const current = cols[cols.length - 1];
    assert.ok(current.classList.contains("is-current"));
    const lead = Math.round(
      Math.max(
        ...usage.teams.buf.players
          .filter((p) => p.pos === "RB")
          .map((p) => p.woppShare ?? 0),
      ),
    );
    assert.equal(current.querySelector(".sct-co-colval").textContent, `${lead}%`);
  });

  test("the situational pair closes with the gold bottom line", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const panels = [...doc.querySelectorAll(".sct-co-panel")];
    assert.match(panels[2].querySelector(".sct-co-h3").textContent, /Personnel groupings/);
    assert.match(panels[3].querySelector(".sct-co-h3").textContent, /Play-calling by score state/);
    assert.match(panels[3].textContent, /63% pass/);
    assert.match(
      doc.querySelector(".sct-co-bottom").textContent,
      /^The fantasy bottom line: continuity where it matters/,
    );
  });
});

describe("FAQ", () => {
  test("the coaching question is visible in its tail and links to #coaching", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const tail = doc.querySelector('[data-sct-faq-for="coaching"]');
    assert.ok(tail);
    assert.match(
      tail.querySelector(".sct-faq-q").textContent,
      /How does Joe Brady's offense affect Buffalo Bills fantasy players\?/,
    );
    assert.equal(tail.querySelector(".sct-faq-more a").getAttribute("href"), "#coaching");
  });

  test("…and is in the page's FAQPage with the answer the page shows", async () => {
    const { doc, body } = await page("/team/buffalo-bills/");
    const faq = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const entry = faq.mainEntity.find((q) => /Joe Brady/.test(q.name));
    assert.ok(entry, "coaching question in the FAQPage");
    assert.equal(entry.acceptedAnswer.text, coaching.teams.buf.faq.answer);
    assert.ok(body.includes(coaching.teams.buf.faq.answer));
  });
});

describe("reliability caveat", () => {
  test("a HIGH club's Outlook carries no new-play-caller caveat", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(doc.querySelector(".sct-co-caveat"), null);
  });
});
