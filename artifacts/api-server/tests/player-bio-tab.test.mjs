/**
 * The Bio spec (2026-09-30): the fact store's reconcile rules and polite
 * client (scripts/player/bio/), the page facts (lib/player/bio-tab-data.ts)
 * and the rendered sections on a real page.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";
import { startServer } from "./helpers/server.mjs";

const d = await importModule("lib/player/bio-tab-data");
const rec = await import("../scripts/player/bio/reconcile.mjs");
process.env.SC_BIO_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bio-cache-"));
const polite = await import("../scripts/player/bio/polite.mjs");
const wikitext = await import("../scripts/player/bio/wikitext.mjs");
const cand = await import("../scripts/player/bio/candidates.mjs");
const logs = await import("../scripts/player/bio/verifyAgainstLogs.mjs");

after(cleanupBundles);

describe("reconcile (Stage 3)", () => {
  test("two sources agreeing are approved at 0.95; one alone at 0.9", () => {
    const two = rec.reconcileField("birth_date", [rec.candidate("a", "1992-12-11"), rec.candidate("b", "1992-12-11")]);
    assert.equal(two.records[0].confidence, 0.95);
    assert.equal(two.records[0].status, "approved");
    assert.equal(two.conflict, null);
    const one = rec.reconcileField("birth_date", [rec.candidate("a", "1992-12-11"), rec.candidate("b", null)]);
    assert.equal(one.records[0].confidence, 0.9);
  });

  test("a disagreement keeps the first-ranked source and logs the conflict", () => {
    const r = rec.reconcileField("weight_lb", [rec.candidate("rosters", 235), rec.candidate("players", 231), rec.candidate("sleeper", 231)]);
    assert.equal(r.records[0].value, 235);
    assert.deepEqual(r.records.slice(1).map((x) => x.status), ["superseded", "superseded"]);
    assert.equal(r.conflict.dropped.length, 2);
  });

  test("birth dates go by majority", () => {
    const r = rec.reconcileField("birth_date", [rec.candidate("nfl", "1995-09-09"), rec.candidate("sleeper", "1995-09-15"), rec.candidate("wd", "1995-09-15")], { majority: true });
    assert.equal(r.records[0].value, "1995-09-15");
    assert.equal(r.records[0].source, "sleeper");
  });

  test("school names are matched across feeds", () => {
    assert.ok(rec.sameSchool("Plant (FL)", "Henry B. Plant High School"));
    assert.ok(rec.sameSchool("William T. Dwyer (FL)", "William T. Dwyer High School"));
    assert.ok(!rec.sameSchool("IMG Academy (FL)", "Nazareth Academy"));
    assert.ok(rec.sameCollege("N.C. State", "North Carolina State"));
    assert.ok(rec.sameCollege("USC", "Southern California"));
    assert.ok(!rec.sameCollege("Miami", "Miami (OH)"));
  });
});

describe("polite client (Part 7.1)", () => {
  const res = (status, body = "", headers = {}) => new Response(status === 304 ? null : body, { status, headers });

  test("Retry-After is honoured, and a 304 is served from the cache", async () => {
    const waits = [];
    const calls = [];
    const replies = [res(429, "", { "retry-after": "7" }), res(200, "hello", { etag: '"v1"' }), res(304)];
    const c = polite.politeClient("t1", { minGapMs: 0, wait: async (ms) => waits.push(ms), fetchImpl: async (url, init) => (calls.push(init.headers), replies.shift()) });
    const a = await c.fetch("https://x.test/a");
    assert.equal(a.body, "hello");
    assert.ok(waits.includes(7000));
    assert.match(calls[0]["User-Agent"], /^StatChasersBot\/1\.0/);
    const b = await c.fetch("https://x.test/a");
    assert.equal(calls[2]["If-None-Match"], '"v1"');
    assert.equal(b.fromCache, true);
    assert.equal(b.body, "hello");
  });

  test("three 403s in a row pause the source", async () => {
    const c = polite.politeClient("t2", { minGapMs: 0, wait: async () => {}, fetchImpl: async () => res(403) });
    await assert.rejects(c.fetch("https://x.test/1"));
    await assert.rejects(c.fetch("https://x.test/2"));
    await assert.rejects(c.fetch("https://x.test/3"), polite.SourcePaused);
    await assert.rejects(c.fetch("https://x.test/4"), polite.SourcePaused);
    assert.equal(c.paused, true);
  });
});

describe("Wikipedia, read by code", () => {
  const box = `{{Infobox gridiron football biography
| name = Test
| high_school  = [[William T. Dwyer High School|William T. Dwyer]] {{nowrap|([[Palm Beach Gardens, Florida]])}}
| college      = {{ubl|[[Florida Gators football|Florida]] (2011–2012)|[[NC State Wolfpack football|NC State]] (2013–2015)}}
| draftyear = 2016
| draftround = 3
| draftpick = 91
| pastteams =
* [[New England Patriots]] ({{NFL Year|2016}})
* [[Oakland Raiders]] ({{NFL Year|2019}})*
* [[Arizona Cardinals]] ({{NFL Year|2025}}–present)
| highlights =
* 2× [[Super Bowl champion]] ([[Super Bowl LI|LI]], [[Super Bowl LIII|LIII]])
* 3× [[Pro Bowl]] (2019, 2020, 2021)
* First-team [[All-Pro]] (2020)
}}`;

  test("the infobox gives school, colleges, draft, career history and highlights", () => {
    const b = wikitext.parseInfobox(box);
    assert.deepEqual(b.high_school, { name: "William T. Dwyer", place: "Palm Beach Gardens, Florida" });
    assert.deepEqual(b.college, ["Florida", "NC State"]);
    assert.deepEqual(b.draft, { year: 2016, round: 3, pick: 91 });
    assert.deepEqual(b.teams.map((t) => [t.team, t.from, t.to, t.offseason]), [["NE", 2016, 2016, false], ["LV", 2019, 2019, true], ["ARI", 2025, null, false]]);
    assert.deepEqual(b.highlights, { superBowls: ["LI", "LIII"], proBowls: 3, allProFirst: 1 });
    assert.deepEqual(wikitext.parseInfobox("{{Infobox gridiron football biography\n| college = Nebraska (2018–2021)<br />Kansas State\n}}").college, ["Nebraska", "Kansas State"]);
    assert.equal(wikitext.parseInfobox("no box here"), null);
  });

  test("a candidate stands only on a verbatim quote that states its date, club and move", () => {
    const text = "Brissett was released.\n\nOn March 11, 2025,  Brissett signed a two-year, $12.5 million contract with the Arizona Cardinals.";
    const ok = { type: "Signed", date: "2025-03-11", team: "ARI", quote: "On March 11, 2025, Brissett signed a two-year, $12.5 million contract with the Arizona Cardinals." };
    assert.equal(cand.checkFact(ok, text), null);
    assert.match(cand.checkFact({ ...ok, quote: ok.quote.replace("two-year", "2-year") }, text), /not found verbatim/);
    assert.match(cand.checkFact({ ...ok, date: "2025-03-12" }, text), /does not state the date/);
    assert.match(cand.checkFact({ ...ok, team: "NE" }, text), /does not name the club/);
    assert.match(cand.checkFact({ ...ok, type: "Waived" }, text), /does not say/);
    assert.match(cand.checkFact({ ...ok, date: "2025-02-30" }, text), /does not exist/);
    // The year may sit earlier in the quote; the nearest one before the date must be it.
    assert.ok(cand.statesDate("On March 13, 2024, the Broncos traded Jeudy. On March 19, Jeudy signed an extension.", 2024, 3, 19));
    assert.ok(!cand.statesDate("On March 13, 2024, he was traded. In 2025, on March 19, he signed.", 2024, 3, 19));
    assert.ok(cand.statesDate("Santos was signed by the Chiefs on 19 May 2014.", 2014, 5, 19));
    assert.equal(cand.checkFact({ ...ok, terms: { years: 2, totalM: 12.5 } }, text), null);
    assert.match(cand.checkFact({ ...ok, terms: { years: 3, totalM: 12.5 } }, text), /contract terms/);
    assert.match(cand.checkFact({ ...ok, terms: { years: 2, totalM: 15 } }, text), /contract terms/);
  });

  test("a day with no year takes it from a season heading, March to December only", () => {
    const text = "==== 2025 season ====\nOn August 4, the Falcons signed Robinson to a four-year extension.\n\nOn January 5, he was placed on injured reserve by the Falcons.\n==== Minnesota Vikings ====\nOn August 4, the Vikings signed him.";
    const f = { type: "Contract", date: "2025-08-04", team: "ATL", yearFrom: "heading", quote: "On August 4, the Falcons signed Robinson to a four-year extension." };
    assert.equal(cand.checkFact(f, text), null);
    assert.match(cand.checkFact({ ...f, date: "2024-08-04" }, text), /puts August 4 in 2025/);
    assert.match(cand.checkFact({ type: "Placed on IR", date: "2026-01-05", team: "ATL", yearFrom: "heading", quote: "On January 5, he was placed on injured reserve by the Falcons." }, text), /either year/);
    assert.match(cand.checkFact({ type: "Signed", date: "2025-08-04", team: "MIN", yearFrom: "heading", quote: "On August 4, the Vikings signed him." }, text), /not a season/);
    assert.equal(cand.checkFact({ type: "Tender", date: "2020-04-20", team: "CLE", quote: "On April 20, 2020, Hunt signed his restricted free agent tender with the Browns." }, "On April 20, 2020, Hunt signed his restricted free agent tender with the Browns."), null);
    assert.ok(cand.statesDate("kept him until March 12, the start of the 2025 NFL year", 2025, 3, 12));
    assert.ok(!cand.statesDate("He signed on July 21. He was the last 2015 first-round pick to sign.", 2015, 7, 21));
  });
});

describe("official transaction logs", () => {
  const N = [["lloyd", "marshawn lloyd"], ["brooks", "chris brooks"], ["rice", "rashee rice"], ["dicker", "cameron dicker"], ["smith", "devonta smith"], ["lucas", "chase lucas"], ["cab", "jason cabinda"], ["rodgers", "aaron rodgers"]];
  const kinds = (text) => logs.movesIn(text, N).map((m) => `${m.slug}:${m.kind}`);

  test("each player named takes his own verb, before or after his name, clause by clause", () => {
    assert.deepEqual(kinds("The Detroit Lions waive CB Chase Lucas and LB Trevor Nowaske and activate FB Jason Cabinda from Reserve/Injured."), ["lucas:waive", "cab:activate"]);
    assert.deepEqual(kinds("RB Chris Brooks signed to the active roster from the practice squad; RB MarShawn Lloyd placed on injured reserve"), ["brooks:promote", "lloyd:place-ir"]);
    assert.deepEqual(kinds("Ethan Downs (DE) signed to active roster contracts; Trent McDuffie (CB), Rashee Rice (WR), Tyquan Thornton (WR) placed on Reserve/Injured"), ["rice:place-ir"]);
    assert.deepEqual(kinds("Exercised the fifth-year option on WR DeVonta Smith. Agreed to terms on a three-year contract extension with WR DeVonta Smith."), ["smith:tag", "smith:sign"]);
  });

  test("'Waived/No Recall' is a waiver, and moving off Reserve/Injured is an activation", () => {
    assert.deepEqual(kinds("Waived/No Recall P Cameron Dicker, OT Adrian Ealy."), ["dicker:waive"]);
    assert.deepEqual(kinds("Moved QB Aaron Rodgers from Reserve/Injured to the active roster."), ["rodgers:activate"]);
  });
});

describe("page facts (Stage 4)", () => {
  const f = (field, value, source = "s") => ({ field, value, source, method: "structured", confidence: 0.9, status: "approved" });
  const wk = (week, team, stats) => ({ week, opp: "X", team, stats });
  const input = (over = {}) => ({
    name: "Test Player",
    position: "QB",
    number: 7,
    team: { code: "ARI", fullName: "Arizona Cardinals", nickname: "Cardinals" },
    entry: {
      ids: {},
      facts: [
        f("birth_date", "1992-12-11"),
        f("draft", { year: 2016, round: 3, pick: 91, team: "NE" }),
        f("qb_starts", { "2016:NE": 1, "2017:IND": 1 }),
        f("team_by_season", { 2016: "NE", 2017: "ARI", 2018: "ARI", 2019: "ARI" }),
        f("trades", [{ date: "2017-09-02", from: "NE", to: "IND", return: [{ player: "Phillip Dorsett", pos: "WR" }] }]),
        { ...f("birth_place", "Nowhere, FL"), status: "candidate" },
      ],
    },
    sources: { s: { name: "Source S", url: "u", retrievedAt: "", revision: null } },
    changedAt: null,
    logCareer: [
      { season: 2016, finish: null, weeks: [wk(1, "NE", { pass_yd: 100 }), wk(2, "NE", { pass_yd: 50 })] },
      { season: 2017, finish: 20, weeks: [wk(1, "IND", { pass_yd: 300, pass_td: 2 }), wk(9, "ARI", { pass_yd: 10 })] },
      { season: 2019, finish: null, weeks: [wk(1, "ARI", { pass_yd: 20 })] },
    ],
    currentSeason: 2019,
    points: (e) => (e.stats.pass_yd ?? 0) / 25,
    now: new Date("2026-09-30T12:00:00Z"),
    ...over,
  });

  test("stops split a traded season, bridge an IR year and count widths", () => {
    const page = d.buildBioPage(input());
    assert.deepEqual(page.stops.map((s) => [s.code, s.from, s.to, s.games, s.width]), [
      ["NE", 2016, 2016, 2, 1],
      ["IND", 2017, 2017, 1, 0.5],
      ["ARI", 2017, 2019, 2, 2.5],
    ]);
    assert.equal(page.stops[2].current, true);
    assert.deepEqual(page.axis, [2016, 2017, 2018, 2019]);
  });

  test("only approved facts are read; role wording follows the spec table", () => {
    const page = d.buildBioPage(input());
    assert.ok(!page.quick.some((q) => q.label === "Birthplace"));
    assert.equal(d.roleWords(12, 15), "the starter");
    assert.equal(d.roleWords(5, 11), "a part-time starter");
    assert.equal(d.roleWords(2, 16), "made 2 starts");
    assert.equal(d.roleWords(0, 3), "a backup");
    assert.match(page.stops[1].sentences.join(" "), /Acquired in a trade with the New England Patriots on September 2, 2017/);
  });

  test("dated trades become transactions, with their return", () => {
    const page = d.buildBioPage(input());
    assert.deepEqual(page.transactions.filter((t) => t.type === "Traded").map((t) => t.text), ["Traded by the New England Patriots to the Indianapolis Colts for WR Phillip Dorsett."]);
  });

  test("no fact record, no spec sections", () => {
    assert.equal(d.buildBioPage(input({ entry: null })), null);
  });

  test("a missing draft record hides the Drafted row; it never reads Undrafted", () => {
    const facts = input().entry.facts.filter((x) => x.field !== "draft");
    const page = d.buildBioPage(input({ entry: { ids: {}, facts } }));
    assert.ok(!page.quick.some((q) => q.label === "Drafted"));
    const shown = [...page.quick.map((q) => q.value), ...page.paragraphs, ...page.transactions.map((t) => t.text)].join(" ");
    assert.doesNotMatch(shown, /undrafted/i);
    const und = d.buildBioPage(input({ entry: { ids: {}, facts: [...facts, f("undrafted", { year: 2016 })] } }));
    assert.equal(und.quick.find((q) => q.label === "Drafted").value, "Undrafted (2016)");
    assert.equal(und.transactions.at(-1).text, "Signed as an undrafted free agent with the New England Patriots.");
  });

  test("transactions carry the precision their source has, and nothing finer", () => {
    const page = d.buildBioPage(input());
    assert.deepEqual(page.transactions.map((t) => [t.precision, t.when, t.type]), [
      ["season", "2017", "Joined"],
      ["day", "Sep 2, 2017", "Traded"],
      ["season", "2016 draft", "Drafted"],
    ]);
    // First game with the club in Week 9: not called an offseason move.
    assert.equal(page.transactions[0].text, "Joined the Arizona Cardinals; his first game with them was Week 9.");
    assert.equal(page.tradesOnly, false);
    // A club he played for from Week 1 was joined in the offseason.
    const wk1 = input({
      logCareer: [
        { season: 2016, finish: null, weeks: [wk(1, "NE", {})] },
        { season: 2017, finish: null, weeks: [wk(1, "ARI", {})] },
      ],
      entry: { ids: {}, facts: [f("draft", { year: 2016, round: 3, pick: 91, team: "NE" })] },
    });
    const joined = d.buildBioPage(wk1).transactions.find((t) => t.type === "Joined");
    assert.deepEqual([joined.when, joined.date], ["2017 offseason", "2017"]);
  });

  test("off quarterback, the role comes from snap share, 2012 on only", () => {
    assert.equal(d.snapRole({ g: 10, s50: 6, s25: 9 }), "starter");
    assert.equal(d.snapRole({ g: 10, s50: 5, s25: 6 }), "rotational");
    assert.equal(d.snapRole({ g: 10, s50: 1, s25: 5 }), "reserve");
    const wr = (from) =>
      d.buildBioPage(
        input({
          position: "WR",
          entry: { ids: {}, facts: [f("snap_games", { [`${from}:ARI`]: { g: 2, s50: 2, s25: 2 } })] },
          logCareer: [{ season: from, finish: null, weeks: [wk(1, "ARI", {}), wk(2, "ARI", {})] }],
          currentSeason: from,
        }),
      );
    assert.equal(wr(2019).stops[0].sentences.join(" "), "He was a starter, playing at least half the offensive snaps in 2 of 2 games.");
    assert.deepEqual(wr(2011).stops[0].sentences, [], "before 2012, games only: no role label");
  });

  test("Super Bowl teams: named for the roster, not the game", () => {
    assert.equal(d.superBowlName(2016), "LI");
    assert.equal(d.superBowlName(2015), "50");
    assert.equal(d.superBowlName(2013), "XLVIII");
    const page = d.buildBioPage(input({ entry: { ids: {}, facts: [...input().entry.facts, f("super_bowls", [{ season: 2016, team: "NE" }])] } }));
    assert.equal(page.quick.find((q) => q.label === "Super Bowl").value, "LI (2016 Patriots)");
    assert.ok(page.stops[0].sentences.includes("Member of the Super Bowl LI champion Patriots."));
    // A career that began before the weekly rosters (2002) could have more: no row.
    const early = d.buildBioPage(
      input({ entry: { ids: {}, facts: [f("draft", { year: 2000, round: 6, pick: 199, team: "NE" }), f("super_bowls", [{ season: 2016, team: "NE" }])] } }),
    );
    assert.ok(!early.quick.some((q) => /Super Bowl|Teams|Experience/.test(q.label)));
  });

  test("reviewed Wikipedia moves join the list at their own precision, and replace the season-level row", () => {
    const tx = [
      { type: "Signed", date: "2017-03-11", precision: "day", team: "ARI", terms: { years: 2, totalM: 12.5 }, quote: "q", url: "u" },
      { type: "Waived", date: "2018-08", precision: "month", team: "ARI", quote: "q", url: "u" },
    ];
    const page = d.buildBioPage(input({ entry: { ids: {}, facts: [...input().entry.facts, f("wiki_transactions", tx)] } }));
    const rows = page.transactions.filter((t) => t.type !== "Traded").map((t) => [t.when, t.type, t.text]);
    assert.deepEqual(rows.slice(0, 2), [
      ["Aug 2018", "Waived", "Waived by the Arizona Cardinals."],
      ["Mar 11, 2017", "Signed", "Signed a two-year, $12.5 million contract with the Arizona Cardinals."],
    ]);
    assert.ok(!page.transactions.some((t) => t.type === "Joined"), "the dated signing replaces the season-level Joined row");
    assert.equal(page.hasDatedMoves, true);
  });

  test("before the weekly rosters, the infobox's titles and career history stand in", () => {
    const facts = [
      f("draft", { year: 2000, round: 6, pick: 199, team: "NE" }),
      f("super_bowl_titles", ["XXXVI", "LV"]),
      f("career_teams", [{ team: "NE", from: 2000, to: 2019, offseason: false }, { team: "TB", from: 2020, to: 2022, offseason: false }]),
    ];
    const page = d.buildBioPage(input({ entry: { ids: {}, facts } }));
    const quick = Object.fromEntries(page.quick.map((q) => [q.label, q.value]));
    assert.equal(quick["Super Bowls"], "XXXVI (2001 Patriots), LV (2020 Buccaneers)");
    assert.equal(quick.Teams, "2");
    // A title the career history cannot place with a club: the row is not shown at all.
    const gap = d.buildBioPage(input({ entry: { ids: {}, facts: [facts[0], facts[1], f("career_teams", [facts[2].value[1]])] } }));
    assert.ok(!gap.quick.some((q) => /Super Bowl/.test(q.label)));
  });

  test("contract rows say agreed, signed, extension or restructure as the source does", () => {
    const t = (quote, terms) => ({ quote, terms });
    assert.equal(d.contractWords("Detroit Lions", t("On August 6, Gibbs agreed to a three-year, $67.5 million contract extension.", { years: 3, totalM: 67.5 }), null),
      "Agreed to a three-year, $67.5 million contract extension with the Detroit Lions.");
    assert.equal(d.contractWords("Cleveland Browns", t("Watson signed a five-year, $230 million contract.", { years: 5, totalM: 230 }), null),
      "Signed a five-year, $230 million contract with the Cleveland Browns.");
    assert.equal(d.contractWords("Kansas City Chiefs", t("The Chiefs restructured his contract on March 12."), null), "Restructured his contract with the Kansas City Chiefs.");
    assert.equal(d.contractWords("Houston Texans", t("He agreed to terms, with a $20 million signing bonus."), null), "Agreed to a contract with the Houston Texans.");
    assert.equal(d.contractWords("Houston Texans", t("He signed with the Texans."), "Signed with the Houston Texans."), "Signed with the Houston Texans.");
  });

  test("the bio text says nothing about fantasy", () => {
    const page = d.buildBioPage(input());
    assert.doesNotMatch(page.paragraphs.join(" "), /fantasy|points/i);
    assert.doesNotMatch(page.stops.flatMap((s) => s.sentences).join(" "), /fantasy/i);
  });
});

describe("rendered (Brissett)", async () => {
  const server = await startServer();
  after(() => server.stop?.());

  test("the spec sections replace the old ones, sit above the FAQ, and match Appendix B", async () => {
    const html = await (await fetch(`${server.origin}/player/jacoby-brissett/bio/`)).text();
    const doc = new JSDOM(html).window.document;
    const bo = doc.querySelector(".scp-bo");
    assert.ok(bo, "spec sections render");
    assert.equal(doc.querySelector(".scp-stints"), null, "the old timeline is gone");
    assert.equal(doc.querySelector(".scp-bio"), null, "the old narrative is gone");
    const faq = doc.querySelector("[data-faq-tab='bio'], [class*='faq']");
    if (faq) assert.ok(bo.compareDocumentPosition(faq) & 4, "the FAQ stays last");
    const h2s = [...doc.querySelectorAll("#bio h2, .scp-bo h2")].map((h) => h.textContent.trim());
    // "Transactions", not "Trades and team changes": Brissett has approved dated moves since the 2026-09-30 bulk approval.
    assert.ok(h2s.includes("Jacoby Brissett Bio") && h2s.includes("Career Timeline") && h2s.includes("Transactions"), h2s.join(" | "));
    const rail = [...bo.querySelectorAll(".scp-bo-st b")].map((b) => b.textContent);
    assert.deepEqual(rail, ["400", "6,059", "1,283", "2,608", "224", "826", "4,018"]);
    assert.match(bo.textContent, /15,418 yards and 80 touchdowns/);
    assert.ok(bo.querySelector('[data-cta="redraft-command-bio-sidebar"]'));
    assert.ok(bo.querySelector('[data-cta="redraft-command-bio-inline"]'));
    assert.match(bo.querySelector(".scp-bo-txlog").textContent, /Phillip Dorsett/);
    assert.match(bo.querySelector(".scp-bo-txlog").textContent, /2016 draft/);
    const quick = Object.fromEntries([...bo.querySelectorAll(".scp-bo-facts dt")].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
    assert.equal(quick["Super Bowl"], "LI (2016 Patriots)");
    // No SEO without mak's approval: the Bio spec adds nothing to the JSON-LD.
    assert.doesNotMatch(html, /"@type":\s*"ProfilePage"/);
  });

  test("undrafted only when the nflverse files agree; a top pick keeps his draft", async () => {
    const quick = async (slug) => {
      const html = await (await fetch(`${server.origin}/player/${slug}/bio/`)).text();
      const dl = new JSDOM(html).window.document.querySelector(".scp-bo-facts dl");
      return dl ? Object.fromEntries([...dl.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])) : {};
    };
    assert.equal((await quick("austin-ekeler")).Drafted, "Undrafted (2017)");
    assert.match((await quick("marvin-harrison")).Drafted ?? "", /^2024, Rd 1, #4/);
  });
});
