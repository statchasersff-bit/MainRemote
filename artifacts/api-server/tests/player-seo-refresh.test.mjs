/**
 * mak's title, description and answer-first refresh of 2026-10-09.
 *
 * The hub's title names its search ("X fantasy") and the year; the Injury
 * page opens on "Is X injured?" with a Yes/No sentence and dates its title to
 * the latest report; the Outlook switches wording by season phase; the Game
 * Log's description leads with the latest game. Everything is in the server
 * HTML, every title fits sixty characters, every description 155.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

let server;
let roster;
let fixture;
let longName;

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 155;

async function text(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
  return { status: res.status, body: await res.text() };
}

function head(html) {
  const doc = new JSDOM(html).window.document;
  return {
    doc,
    title: doc.querySelector("head > title")?.textContent ?? "",
    description: doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
  };
}

function island(html) {
  const m = html.match(/<script type="application\/json" class="scp-page-data">(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
}

before(async () => {
  server = await startServer();
  const body = await (await fetch(`${server.origin}/embed/players.json`)).json();
  roster = body.players ?? [];
  // A player with a game log on the page, so the hub has a rank to answer with.
  for (const player of roster.slice(0, 40)) {
    const { body: html } = await text(`/player/${player.slug}`);
    if (/scp-read-grid/.test(html)) {
      fixture = player;
      break;
    }
  }
  assert.ok(fixture, "no player with a rendered profile in the first forty");
  // The longest name on the roster: the title ladder's last rung has to fit it.
  longName = [...roster].sort((a, b) => b.name.length - a.name.length)[0];
});

after(async () => {
  await server?.stop();
});

test("the hub: title names the search and the year, the H1 is the name and the game", async () => {
  const { body } = await text(`/player/${fixture.slug}`);
  const { title, description } = head(body);
  const year = /data-season="(\d{4})"/.exec(body)?.[1];
  assert.match(
    title,
    new RegExp(`^${fixture.name} Fantasy(?: Football)? \\d{4}: Stats(?:, Outlook & News| & Outlook)$`),
    title,
  );
  assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
  assert.doesNotMatch(title, /StatChasers/);
  assert.ok(description.length <= DESCRIPTION_MAX, `${description.length}: ${description}`);
  assert.ok(
    /fantasy outlook: [A-Z]+\d+ with \d+\.\d [A-Z]+ points per game in \d{4}\. Week \d+ (?:vs|at) [A-Z]+: start\/sit call, injury status and trade value\.$/.test(
      description,
    ) || /fantasy football profile: \d{4} outlook, projections, stats, injury history and dynasty value\.$/.test(description),
    description,
  );
  assert.ok(year, "the page names its season");

  const { body: embed } = await text(`/embed/player/${fixture.slug}?h1=1`);
  const doc = new JSDOM(embed).window.document;
  const h1 = doc.querySelector("h1");
  assert.equal(h1.textContent, `${fixture.name} Fantasy Football`);
  const sub = h1.nextElementSibling;
  assert.ok(sub?.classList.contains("scp-head-sub"), "a small line under the H1");
  assert.match(sub.textContent, /^[A-Z]{1,3}, .+/, `position, team name: ${sub.textContent}`);
  assert.doesNotMatch(h1.textContent, /age|injury|stats/i, "the hub stays off the other tabs' words");

  // The answer sentence, server-rendered, with its two links.
  const answer = doc.querySelector("#overview .scp-answer");
  assert.ok(answer, "an answer sentence near the top of the Overview");
  assert.match(
    answer.textContent,
    new RegExp(`^${fixture.name} (?:is the|finished \\d{4} as the) [A-Z]+\\d+ in [A-Z]+(?: this season)? \\(\\d+\\.\\d points per game\\)`),
    answer.textContent,
  );
  const hrefs = [...answer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.ok(hrefs.some((h) => /who-should-i-start/.test(h)), `start/sit link: ${hrefs}`);
  assert.ok(hrefs.some((h) => /\/outlook\//.test(h)), `outlook link: ${hrefs}`);
  // The sentence precedes the snapshot grid.
  assert.ok(
    answer.compareDocumentPosition(doc.querySelector("#overview .scp-read-grid")) & 4,
    "the answer comes before the snapshot tiles",
  );
});

test("the longest name on the roster still gets a title within sixty characters", async () => {
  const { status, body } = await text(`/player/${longName.slug}`);
  assert.equal(status, 200, longName.slug);
  const { title } = head(body);
  assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
  assert.match(title, new RegExp(`^${longName.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} Fantasy`));
  if (`${longName.name} Fantasy Football 2026: Stats, Outlook & News`.length > TITLE_MAX) {
    assert.doesNotMatch(title, /Stats, Outlook & News$/, "the full wording gave way");
  }
});

test("the injury page: a dated title, the question and its Yes/No answer first, dateModified", async () => {
  const { status, body } = await text(`/player/${fixture.slug}/injury/`);
  if (status !== 200) {
    // No injury record: the section redirects to the profile. Find one that has it.
    let found = null;
    for (const player of roster.slice(0, 80)) {
      const res = await text(`/player/${player.slug}/injury/`);
      if (res.status === 200) {
        found = { player, body: res.body };
        break;
      }
    }
    assert.ok(found, "no player with an injury page in the first eighty");
    return check(found.player, found.body);
  }
  return check(fixture, body);

  async function check(player, html) {
    const { doc, title, description } = head(html);
    const dated = /^(.+) Injury Update(?: & History)? \((?:Updated )?([A-Z][a-z]{2} \d{1,2})\)$/.exec(title);
    assert.ok(dated, title);
    assert.equal(dated[1], player.name);
    assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
    assert.ok(description.length <= DESCRIPTION_MAX, `${description.length}: ${description}`);
    assert.match(
      description,
      /^(?:No injury designation|Questionable|Doubtful|Out|On injured reserve|On the PUP list|On the NFI list|Suspended)/,
      description,
    );
    assert.match(description, /\(checked [A-Z][a-z]{2} \d{1,2}\)\. .+ injury history/, description);

    const h2 = doc.querySelector("#injury .scp-in-ask h2");
    assert.equal(h2?.textContent, `Is ${player.name} injured?`);
    const answer = doc.querySelector("#injury .scp-in-answer");
    assert.match(answer.textContent, new RegExp(`^(Yes|No)\\. ${player.name} `), answer.textContent);
    assert.match(answer.textContent, /Last checked [A-Z][a-z]{2} \d{1,2}\.$/, answer.textContent);
    assert.match(doc.querySelector("#injury .scp-in-missedline").textContent, /Career games missed: \d+\.$/);

    // Before the history table and the status strip.
    const history = doc.querySelector("#injury .scp-in-tl, #injury .scp-in-parts");
    assert.ok(history, "a history table");
    assert.ok(h2.compareDocumentPosition(history) & 4, "the question precedes the history");
    assert.ok(h2.compareDocumentPosition(doc.querySelector("#injury .scp-in-statusbar")) & 4, "and the status strip");

    // The island carries the same date for the WebPage node.
    const { body: embed } = await text(`/embed/player/${player.slug}?section=injury`);
    const copy = island(embed);
    assert.equal(copy.title, title);
    assert.match(copy.modified, /^\d{4}-\d{2}-\d{2}$/);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [, m, d] = copy.modified.split("-").map(Number);
    assert.equal(`${months[m - 1]} ${d}`, dated[2], "the title's date is the island's");
  }
});

test("the outlook page: wording follows the season phase, and the body opens on 'fantasy outlook'", async () => {
  let page = null;
  for (const player of [fixture, ...roster.slice(0, 40)]) {
    const res = await text(`/player/${player.slug}/outlook/`);
    if (res.status === 200) {
      page = { player, ...res };
      break;
    }
  }
  assert.ok(page, "no player with an outlook page");
  const { doc, title, description } = head(page.body);
  assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
  assert.ok(description.length <= DESCRIPTION_MAX, `${description.length}: ${description}`);
  const live = /rest-of-season fantasy outlook/.test(description);
  if (live) {
    assert.match(title, /Fantasy Outlook \d{4}(?:: Rest-of-Season Value|: ROS Value)?$/, title);
    assert.doesNotMatch(description, /draft day/);
  } else {
    assert.match(title, /Fantasy Outlook \d{4}: Role(?:, Usage & Value| & Usage)$/, title);
    assert.match(description, /draft day\.$/);
  }
  const h1 = doc.querySelector("#outlook h1, #outlook h2.is-lead");
  assert.match(h1.textContent, /Rest-of-Season Outlook$/);
  const first = h1.nextElementSibling;
  assert.ok(first?.classList.contains("scp-ol-lede"), "a lede right under the heading");
  assert.match(first.textContent.split(/(?<=\.)\s/)[0], /fantasy outlook/, first.textContent);
});

test("the game log page: the description leads with the latest game", async () => {
  const { status, body } = await text(`/player/${fixture.slug}/game-log/`);
  assert.equal(status, 200);
  const { title, description } = head(body);
  assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
  assert.ok(description.length <= DESCRIPTION_MAX, `${description.length}: ${description}`);
  assert.match(
    description,
    new RegExp(`^${fixture.name} scored \\d+\\.\\d [A-Z]+ points in Week \\d+ (?:vs|at) [A-Z]+\\. Full \\d{4} game log: fantasy points`),
    description,
  );
});

test("every tab of the fixture fits the title and description budgets", async () => {
  for (const section of ["", "stats/", "game-log/", "outlook/", "injury/", "news/", "bio/"]) {
    const { status, body } = await text(`/player/${fixture.slug}/${section}`);
    if (status !== 200) continue;
    const { title, description } = head(body);
    assert.ok(title.length <= TITLE_MAX, `${section}: ${title.length}: ${title}`);
    assert.ok(description.length <= DESCRIPTION_MAX, `${section}: ${description.length}: ${description}`);
    assert.ok(title.startsWith(fixture.name) || title.startsWith(`Latest ${fixture.name}`), `${section}: name first: ${title}`);
    assert.doesNotMatch(title, /\| StatChasers/);
  }
});
