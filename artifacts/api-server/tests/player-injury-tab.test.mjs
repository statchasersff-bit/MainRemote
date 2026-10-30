/**
 * The Injury tab's spec sections (lib/player/injury-tab.ts): the counting
 * rules first (Part 4.9 of the spec: every count agrees across tiles, map,
 * table, timeline and FAQ), then the body map, the practice grid's days and
 * readings, the NFL.com report parser, and rendered states.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";
import { parseReport, practiceValue, reportDate, mergeWeek } from "../scripts/player/buildPracticeReports.mjs";

const d = await importModule("lib/player/injury-tab-data");
const tab = await importModule("lib/player/injury-tab");
const dur = await importModule("lib/player/injury-durability");

after(cleanupBundles);

// Jacoby Brissett's record, as player_injuries.json has it.
const BRISSETT = [
  { season: 2024, week: 0, type: "Shoulder", bodyPart: "shoulder", side: "right", gamesMissed: 0, description: "Preseason hit." },
  { season: 2023, week: 17, type: "Hamstring", bodyPart: "hamstring", side: "unknown", gamesMissed: 2, description: "Hamstring in practice." },
  { season: 2019, week: 9, type: "MCL Sprain", bodyPart: "knee", side: "left", gamesMissed: 1, description: "Left MCL." },
  { season: 2016, week: 3, type: "Thumb Fracture", bodyPart: "wrist", side: "right", gamesMissed: 8, description: "Placed on injured reserve after surgery." },
];

describe("counting rules", () => {
  test("categories read the injury type before the body part", () => {
    assert.equal(d.categorize({ type: "Thumb Fracture", bodyPart: "wrist" }), "Hand / thumb");
    assert.equal(d.categorize({ type: "MCL Sprain", bodyPart: "knee" }), "Knee");
    assert.equal(d.categorize({ type: "Concussion", bodyPart: "head" }), "Concussion");
    assert.equal(d.categorize({ type: "Illness", bodyPart: "unknown" }), "Other");
    assert.equal(d.categorize({ type: "Achilles Tear", bodyPart: "ankle" }), "Achilles");
  });

  test("totals: 4 injuries, 11 games, 4 parts, longest is the 2016 thumb", () => {
    const evs = d.buildEvents(BRISSETT);
    const t = d.totals(evs);
    assert.equal(t.injuries, 4);
    assert.equal(t.games, 11);
    assert.equal(t.parts, 4);
    assert.equal(t.longest.season, 2016);
    assert.equal(t.latest.season, 2024);
    assert.deepEqual(t.rows.map((r) => [r.category, r.injuries, r.games]), [
      ["Hand / thumb", 1, 8],
      ["Hamstring", 1, 2],
      ["Knee", 1, 1],
      ["Shoulder", 1, 0],
    ]);
    // The table's total is the tiles' total.
    assert.equal(t.rows.reduce((n, r) => n + r.games, 0), t.games);
    assert.equal(t.rows.reduce((n, r) => n + r.injuries, 0), t.injuries);
  });

  test("the same part re-hurt in one season is one entry, games summed", () => {
    const evs = d.buildEvents([
      { season: 2022, week: 3, type: "Hamstring", bodyPart: "hamstring", side: "left", gamesMissed: 1 },
      { season: 2022, week: 9, type: "Hamstring Strain", bodyPart: "hamstring", side: "left", gamesMissed: 3 },
      { season: 2023, week: 2, type: "Hamstring", bodyPart: "hamstring", side: "left", gamesMissed: 1 },
    ]);
    assert.equal(evs.length, 2);
    assert.equal(evs[1].games, 4);
    assert.equal(evs[1].merged, 2);
  });

  test("postseason games are excluded; a preseason injury keeps its regular-season games", () => {
    const evs = d.buildEvents([
      { season: 2023, week: 20, type: "Ankle", bodyPart: "ankle", side: "right", gamesMissed: 2 },
      { season: 2019, week: 18, type: "Knee", bodyPart: "knee", side: "right", gamesMissed: 1 },
      { season: 2024, week: 0, type: "Foot", bodyPart: "foot", side: "left", gamesMissed: 3 },
    ]);
    const byYear = Object.fromEntries(evs.map((e) => [e.season, e]));
    assert.equal(byYear[2023].phase, "POST");
    assert.equal(byYear[2023].games, 0);
    // Week 18 of 2019 was the postseason: the 17-week era.
    assert.equal(byYear[2019].phase, "POST");
    assert.equal(byYear[2024].phase, "PRE");
    assert.equal(byYear[2024].games, 3);
  });

  test("risk factors follow the spec's thresholds", () => {
    const evs = d.buildEvents(BRISSETT);
    const f = Object.fromEntries(d.riskFactors(evs, d.totals(evs), 2026, 11).map((x) => [x.title, x]));
    assert.equal(f["Recurring injuries"].level, "good");
    assert.equal(f["Recent history"].level, "good");
    assert.equal(f["Career time lost"].level, "good"); // 1.0 per season
    assert.equal(f["Injury concentration"].level, "good");
    assert.match(f["Career time lost"].evidence, /11 games in 11 seasons, 8 of them in 2016/);

    const repeat = d.buildEvents([
      { season: 2021, week: 5, type: "Hamstring", bodyPart: "hamstring", gamesMissed: 1 },
      { season: 2023, week: 5, type: "Hamstring", bodyPart: "hamstring", gamesMissed: 1 },
      { season: 2026, week: 2, type: "Ankle", bodyPart: "ankle", gamesMissed: 2 },
    ]);
    const g = Object.fromEntries(d.riskFactors(repeat, d.totals(repeat), 2026, 4).map((x) => [x.title, x]));
    // Twice within two seasons with games missed both times.
    assert.equal(g["Recurring injuries"].level, "bad");
    assert.match(g["Recurring injuries"].evidence, /Hamstring injuries in 2021 and 2023/);
    assert.equal(g["Recent history"].level, "bad");
    assert.equal(g["Injury concentration"].level, "mid"); // 3 / 2 = 1.5
  });
});

describe("body map", () => {
  test("coordinates, sizes, dashed rings and the side-not-recorded rule", () => {
    const map = d.bodyMap(d.buildEvents(BRISSETT));
    const at = (x, y) => map.markers.find((m) => m.x === x && m.y === y);
    // Player's right on the viewer's left.
    assert.equal(at(89, 216).r, 16); // 8 games, capped at 16
    assert.equal(at(118, 90).thru, true);
    assert.equal(at(118, 90).r, 8);
    assert.equal(at(168, 304).r, 9); // left knee, 1 game
    // Hamstring side unknown: the player's left column.
    assert.equal(at(168, 248).r, 10);
    assert.deepEqual(map.sideless, ["hamstring"]);
    // Drawn big to small.
    const radii = map.markers.map((m) => m.r);
    assert.deepEqual(radii, [...radii].sort((a, b) => b - a));
    assert.equal(at(118, 90).title, "R. shoulder");
    assert.equal(at(118, 90).sub, "2024, played thru");
  });

  test("repeats share a marker with ×n; labels keep 36px apart and stay in 30–390", () => {
    const evs = d.buildEvents(
      Array.from({ length: 16 }, (_, i) => ({
        season: 2010 + i,
        week: 4,
        type: ["Ankle", "Knee", "Hamstring", "Foot", "Calf", "Hip", "Shoulder", "Concussion"][i % 8],
        bodyPart: "",
        side: i % 2 ? "left" : "right",
        gamesMissed: i % 3,
      })),
    );
    const map = d.bodyMap(evs);
    assert.ok(map.markers.some((m) => / ×2$/.test(m.title)));
    for (const col of ["left", "right"]) {
      const ys = map.labels.filter((l) => l.column === col).map((l) => l.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= 36, `${col} labels ${ys}`);
      for (const y of ys) assert.ok(y >= 30 && y <= 390);
    }
  });

  test("no injuries: no markers", () => {
    assert.equal(d.bodyMap([]).markers.length, 0);
  });
});

describe("practice", () => {
  test("report days follow the game day", () => {
    assert.deepEqual(d.practiceDays("2026-10-04").map((x) => x.day), ["Wed", "Thu", "Fri"]); // Sunday
    assert.deepEqual(d.practiceDays("2026-10-01").map((x) => x.day), ["Mon", "Tue", "Wed"]); // Thursday
    assert.deepEqual(d.practiceDays("2026-10-05").map((x) => x.day), ["Thu", "Fri", "Sat"]); // Monday
    assert.deepEqual(d.practiceDays("2026-12-26").map((x) => x.day), ["Wed", "Thu", "Fri"]); // Saturday
    assert.equal(d.practiceDays("2026-10-04")[0].date, "2026-09-30");
  });

  test("what it means, by pattern", () => {
    assert.match(d.practiceRead(["FULL"], "Hip", true), /lowest-concern/);
    assert.match(d.practiceRead(["LIMITED", "FULL"], "Hip", true), /trending toward playing/);
    assert.match(d.practiceRead(["LIMITED", "LIMITED", "LIMITED"], "Hip", true), /game-time decision/);
    assert.match(d.practiceRead(["DNP", "LIMITED"], "Hip", true), /Improving/);
    assert.match(d.practiceRead(["DNP", "DNP", "DNP"], "Hip", true), /unlikely to play/);
    assert.match(d.practiceRead(["DNP"], null, true), /rest day/);
  });

  test("the NFL.com report parser: rows by club, and the page's own week", () => {
    const html =
      `<select><option selected>2026</option><option selected>WEEK 3</option></select>` +
      `<div class="d3-o-section-sub-title"><span>Cardinals</span></div><table><tbody>` +
      `<tr><td scope="row" tabindex="0"><a href="/players/jacoby-brissett/" class="x"> Jacoby Brissett </a></td><td>QB</td><td>Hip</td><td>Full Participation in Practice</td><td></td></tr>` +
      `<tr><td scope="row" tabindex="0"><a href="/players/roy-lopez/" class="x"> Roy Lopez </a></td><td>DT</td><td>Groin</td><td>Limited Participation in Practice</td><td>Questionable</td></tr>` +
      `</tbody></table>`;
    const r = parseReport(html);
    assert.equal(r.week, 3);
    assert.deepEqual(r.teams.Cardinals["jacoby-brissett"], {
      name: "Jacoby Brissett", pos: "QB", injury: "Hip", practice: "FULL", estimated: false, gameStatus: null,
    });
    assert.equal(r.teams.Cardinals["roy-lopez"].gameStatus, "Questionable");
    assert.equal(practiceValue("Did Not Participate In Practice"), "DNP");
  });

  test("a read before the release hour files under the day before", () => {
    // 10:00 ET on Thursday Oct 1 → Wednesday's report.
    assert.equal(reportDate(new Date("2026-10-01T14:00:00Z")), "2026-09-30");
    // 19:00 ET → Thursday's.
    assert.equal(reportDate(new Date("2026-10-01T23:00:00Z")), "2026-10-01");
  });

  test("merging keeps earlier days and files only the live week", () => {
    const parsed = { week: 4, teams: { Cardinals: { "a-b": { name: "A B", pos: "QB", injury: "Hip", practice: "LIMITED", estimated: false, gameStatus: null } } } };
    const wed = mergeWeek(undefined, parsed, { date: "2026-09-30", fetchedAt: "x", url: "u" });
    parsed.teams.Cardinals["a-b"].practice = "FULL";
    const thu = mergeWeek(wed, parsed, { date: "2026-10-01", fetchedAt: "y", url: "u" });
    assert.deepEqual(thu.teams.Cardinals["a-b"].days, { "2026-09-30": "LIMITED", "2026-10-01": "FULL" });
    const past = mergeWeek(undefined, parsed, { date: "2026-10-01", fetchedAt: "y", url: "u", live: false });
    assert.deepEqual(past.teams.Cardinals["a-b"].days, {});
    assert.equal(past.teams.Cardinals["a-b"].final, "FULL");
  });
});

/* ------------------------------------------------------------------ render */

const ARI = { code: "ARI", abbreviation: "ari", slug: "arizona-cardinals", nickname: "Cardinals", fullName: "Arizona Cardinals", primaryColor: "#97233F", secondaryColor: "#FFB612" };
const NYG = { code: "NYG", nickname: "Giants", slug: "new-york-giants" };
const WEEK4_KICK = Date.parse("2026-10-04T17:00:00Z");
const NOW = Date.parse("2026-09-29T16:00:00Z");

function state(overrides = {}) {
  return {
    player: { id: "3257", slug: "jacoby-brissett", name: "Jacoby Brissett", position: "QB", years_exp: 10 },
    team: ARI,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    gameLog: [1, 2, 3].map((week) => ({ week, opp: "SEA", team: "ARI", game_status: "active", stats: {} })),
    upcoming: [{ week: 4, homeAway: "away", opponent: NYG, opponentCode: "NYG", opponentName: "Giants", kickoffMs: WEEK4_KICK, timeConfirmed: true, matchup: null }],
    schedule: [
      { week: 3, kickoffMs: Date.parse("2026-09-27T20:05:00Z"), homeAway: "away", opponent: { code: "SF" }, opponentName: "49ers" },
      { week: 4, kickoffMs: WEEK4_KICK, homeAway: "away", opponent: NYG, opponentName: "Giants" },
    ],
    seasonClubs: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [2016 + i, ["ARI"]])),
    logSeasons: [],
    depth: { position: "QB", order: 1, next: { name: "Gardner Minshew II", slug: "gardner-minshew" } },
    teammates: [
      { name: "Trey McBride", slug: "trey-mcbride", position: "TE" },
      { name: "Michael Wilson", slug: null, position: "WR" },
    ],
    designation: null,
    rosterFetchedAt: Date.parse("2026-09-29T08:00:00Z"),
    fantasyOutlook2026: { body: "An outlook." },
    outlookDrivers: [],
    injury: {
      history: { grade: "A+", score: 99, nfl: BRISSETT, college: [] },
      seasonMissed: 0,
      lastPlayedWeek: 3,
    },
    ...overrides,
  };
}

function render(overrides) {
  const html = tab.renderInjuryTab(state(overrides), { now: NOW, playerPathPrefix: "/nfl/players/" });
  return { html, doc: new JSDOM(`<main>${html}</main>`).window.document };
}

describe("rendered", () => {
  test("the answer first, in the status panel, then the headed parts in order", () => {
    const { doc } = render();
    // No "Is he injured?" heading since 2026-09-30: the panel answers it
    // straight under the tab's H1.
    assert.ok(doc.querySelector(".scp-in > .scp-ox-sec.scp-in-now:first-child .scp-in-statusbar"));
    const h2 = [...doc.querySelectorAll("h2")].map((h) => h.textContent);
    assert.deepEqual(h2, [
      // Back by mak's refresh of 2026-10-09, with a Yes/No sentence under it.
      "Is Jacoby Brissett injured?",
      "Injury History at a Glance",
      "Where He's Been Hurt",
      "Jacoby Brissett Injury History",
      "If Brissett Misses Time",
      // Redraft Command's injury card, under everything above (mak, 2026-10-30).
      "Durability Profile",
      "Jacoby Brissett Injury FAQ",
    ]);
    // The methodology footer left the tab 2026-10-22 (mak).
    assert.equal(doc.querySelector("footer.scp-st-foot"), null);
    assert.equal(
      doc.querySelector(".scp-in-main p").textContent,
      "No injury designation for Week 4 at the Giants. Brissett has not missed a game this season.",
    );
    assert.equal(doc.querySelector(".scp-in-big").textContent, "Active");
    assert.ok(doc.querySelector(".scp-in-main.is-good"));
    // "Status checked" is the snapshot time, not the render time.
    assert.equal(doc.querySelector(".scp-in-checked time").getAttribute("datetime"), "2026-09-29T08:00:00.000Z");
  });

  test("counts agree across tiles, table, timeline, map and FAQ", () => {
    const { doc } = render();
    const tiles = [...doc.querySelectorAll(".scp-in-gl")].map((t) => t.querySelector(".scp-in-glv").textContent);
    assert.deepEqual(tiles.slice(1, 3), ["11", "4"]);
    const total = doc.querySelector(".scp-in-parts tr.is-tot");
    assert.deepEqual([...total.querySelectorAll("td")].map((c) => c.textContent), ["4", "11"]);
    // Timeline: four injury entries plus the "Healthy" 2026 entry.
    const items = [...doc.querySelectorAll(".scp-in-tl > li")];
    assert.equal(items.length, 5);
    assert.match(items[0].textContent, /Healthy/);
    const chipGames = items.map((li) => Number((li.querySelector(".scp-in-chip.is-bad")?.textContent ?? "0").replace(/\D/g, "")));
    assert.equal(chipGames.reduce((a, b) => a + b, 0), 11);
    assert.equal(doc.querySelectorAll(".scp-in-bodymap circle.scp-bm-hit, .scp-in-bodymap circle.scp-bm-thru").length, 4);
    // The state-aware Injury FAQ (faq-engine.ts, 2026-09-30): a healthy
    // player gets no "what injury" or "why isn't he playing".
    const faq = [...doc.querySelectorAll(".scp-in-faq details")];
    const qs = faq.map((d) => d.querySelector("summary").textContent);
    assert.deepEqual(qs, [
      "Is Jacoby Brissett injured?",
      "Is Jacoby Brissett playing this week?",
      "Has Jacoby Brissett missed any games this season?",
      "What is Jacoby Brissett's injury history?",
      "What was Jacoby Brissett's most recent injury?",
      "Does Jacoby Brissett have any recurring injuries?",
      "What was Jacoby Brissett's worst injury?",
    ]);
    assert.match(faq[3].textContent, /4 logged NFL injuries, which have cost him 11 games in all: 8 for a right thumb fracture in 2016, 2 for a hamstring injury in 2023 and 1 for a left MCL sprain in 2019\./);
    assert.match(faq[0].textContent, /As of September 29, 2026/);
    assert.ok(faq[0].hasAttribute("open"));
    assert.equal(doc.querySelector("#scp-faq-injury-h").textContent, "Jacoby Brissett Injury FAQ");
  });

  test("the practice card with nothing on file says so", () => {
    const { doc } = render({ team: { ...ARI, code: "ZZZ" } });
    assert.match(doc.querySelector(".scp-in-practice").textContent, /hasn't appeared on an injury report this season/);
  });

  test("questionable: amber, the lede leads with the designation, FAQ says game-time", () => {
    const { doc } = render({ designation: { injuryStatus: "Questionable", injuryBodyPart: "Hip" } });
    assert.ok(doc.querySelector(".scp-in-main.is-mid"));
    assert.equal(doc.querySelector(".scp-in-big").textContent, "Questionable");
    assert.match(doc.querySelector(".scp-in-main p").textContent, /^Brissett is questionable for Week 4 with a hip injury\./);
    assert.match(doc.querySelectorAll(".scp-in-faq details")[1].textContent, /game-time decision/);
  });

  test("out: red, and 'if he misses time' moves up under the status", () => {
    const { doc } = render({ designation: { injuryStatus: "Out", injuryBodyPart: "Ankle" } });
    assert.ok(doc.querySelector(".scp-in-main.is-bad"));
    const h2 = [...doc.querySelectorAll("h2")].map((h) => h.textContent);
    assert.equal(h2[0], "Is Jacoby Brissett injured?");
    assert.equal(h2[1], "If Brissett Misses Time");
    // The answer sentence left the page 2026-10-22; it still feeds the SEO copy.
    assert.equal(doc.querySelector(".scp-in-answer"), null);
    assert.equal(doc.querySelector(".scp-in-pread"), null);
    assert.equal(doc.querySelector(".scp-in-plegend"), null);
    assert.ok(doc.querySelector(".scp-in-urgent"));
  });

  test("a backup gets no 'if he misses time'; CTAs carry the spec's data-cta values", () => {
    const { doc, html } = render({ depth: { position: "QB", order: 2, next: null } });
    assert.ok(![...doc.querySelectorAll("h2")].some((h) => /misses time/.test(h.textContent)));
    assert.match(html, /data-cta="redraft-command-injury-sidebar"/);
    assert.match(html, /data-cta="startsit-injury-faq"/);
    const starter = render().html;
    assert.match(starter, /data-cta="redraft-command-injury-backup"/);
    assert.match(starter, /redraft-command\/\?position=qb/);
  });

  test("15+ injuries: the newest ten, then a Show all", () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ season: 2010 + i, week: 5, type: i % 2 ? "Ankle" : "Knee", bodyPart: "", side: "right", gamesMissed: 1 }));
    const { doc } = render({ injury: { history: { grade: "C", score: 70, nfl: many, college: [] }, seasonMissed: 0, lastPlayedWeek: 3 } });
    assert.match(doc.querySelector(".scp-in-more summary").textContent, /Show all 16 injuries/);
    assert.ok(doc.querySelector(".scp-in-gl.is-mid"));
  });

  test("the tab itself feeds no sink: the page pushes its FAQ (renderInjury)", () => {
    const sink = [];
    tab.renderInjuryTab(state(), { now: NOW, faqSink: sink });
    assert.equal(sink.length, 0);
  });

  test("no injury record: nothing rendered", () => {
    assert.equal(tab.renderInjuryTab(state({ injury: null }), { now: NOW }), "");
  });
});

/* ------------------------------------------------- durability profile card */

describe("durability profile (Redraft Command's injury card, mak 2026-10-30)", () => {
  const ep = (o) => ({
    season: 2023, week: 5, injury: "Hamstring", gamesMissed: 0, seasonEnding: false, ongoing: false,
    returnWeek: null, returnedInPlayoffs: false, reportWeeks: 1, worstStatus: null, worstPractice: null, inGame: null, ...o,
  });

  test("an episode is told as a sentence or three: how, what it cost, first or recurring", () => {
    const first = ep({ gamesMissed: 3, returnWeek: 9, inGame: { week: 4, opponent: "SF", qtr: 2, clock: "8:12" } });
    assert.deepEqual(dur.tellEpisode(first, null, 0, "thigh"), {
      tag: "First",
      text: "Hurt during the Week 4 game vs SF (Q2, 8:12). Missed 3 games and returned in Week 9. First thigh issue on record.",
    });
    const again = ep({ week: 14, worstStatus: "Questionable", reportWeeks: 2 });
    assert.deepEqual(dur.tellEpisode(again, first, 1, "thigh"), {
      tag: "Re-aggravated",
      text: "Listed Questionable across 2 weeks on the report but didn't miss a game. Re-aggravated in the same season as the Week 5 injury.",
    });
    const later = ep({ season: 2025, week: 2, seasonEnding: true, gamesMissed: 15 });
    assert.deepEqual(dur.tellEpisode(later, again, 2, "thigh"), {
      tag: "Recurring",
      text: "Missed the rest of the season (15 games). 3rd thigh issue; the last was in 2023.",
    });
    assert.equal(dur.tellEpisode(ep({ worstPractice: "Did Not Participate" }), null, 0, "knee").text, "Sat out practice but didn't miss a game. First knee issue on record.");
    assert.equal(dur.tellEpisode(ep({ ongoing: true, gamesMissed: 2 }), null, 0, "knee").text, "Still out, 2 games missed so far. First knee issue on record.");
  });

  test("lost weeks run from the first game missed to the return, missed games only", () => {
    assert.deepEqual(dur.regionLostWeeks([ep({ gamesMissed: 3, week: 6, returnWeek: 10 }), ep({ season: 2024, gamesMissed: 0 })]), { 2023: [6, 7, 8, 9] });
    assert.deepEqual(dur.regionLostWeeks([ep({ season: 2024, week: null, gamesMissed: 2, inGame: { week: 11, opponent: "DAL", qtr: null, clock: null } })]), { 2024: [12, 13, 14, 15, 16, 17, 18] });
  });

  test("the card: worst region open, pills worst first, markers on the figure, the bar in the tier's color", () => {
    const { doc } = render();
    const card = doc.querySelector("[data-scp-durability]");
    assert.ok(card, "Brissett has a durability profile");
    const pills = [...card.querySelectorAll(".scp-in-rp")];
    assert.ok(pills.length >= 2);
    const missed = pills.map((p) => Number(/· (\d+) games missed/.exec(p.getAttribute("title"))[1]));
    assert.deepEqual(missed, [...missed].sort((a, b) => b - a), "pills run worst first");
    const on = card.querySelectorAll(".scp-in-rp.is-on");
    assert.equal(on.length, 1);
    const worst = on[0].getAttribute("data-region");
    assert.equal(pills[0].getAttribute("data-region"), worst);
    // One record open, the worst region's, carrying the weeks the grid outlines.
    const open = [...card.querySelectorAll("[data-region-detail]")].filter((d) => !d.hidden);
    assert.equal(open.length, 1);
    assert.equal(open[0].getAttribute("data-region-detail"), worst);
    assert.doesNotThrow(() => JSON.parse(open[0].getAttribute("data-lost")));
    assert.ok(open[0].querySelector(".scp-in-rd-tag").textContent.length > 0);
    // The figure: one marker per pill, the worst one selected, the kit's colors on the frame.
    const fig = card.querySelector("[data-scp-figure]");
    assert.equal(fig.querySelectorAll(".scp-in-mk").length, pills.length);
    assert.equal(fig.querySelector(".scp-in-mk.is-on").getAttribute("data-region"), worst);
    assert.match(fig.getAttribute("data-primary"), /^#[0-9a-f]{6}$/i);
    assert.ok(fig.querySelector("img").getAttribute("src").endsWith("/injury-figure/player-base.webp"));
    // The body map's callouts beside the frame: one per marker, tied by a leader line,
    // worded like the map above ("R. thumb ×2" / "2016, 2017: 10 games"), the worst one on.
    const wrap = fig.parentElement;
    assert.ok(wrap.classList.contains("scp-in-figwrap"));
    const labels = [...wrap.querySelectorAll(".scp-in-fl")];
    assert.equal(labels.length, pills.length);
    assert.equal(wrap.querySelectorAll(".scp-in-fl-lines line").length, pills.length);
    assert.deepEqual(new Set(labels.map((l) => l.getAttribute("data-region"))), new Set(pills.map((p) => p.getAttribute("data-region"))));
    assert.equal(wrap.querySelector(".scp-in-fl.is-on").getAttribute("data-region"), worst);
    const hand = labels.find((l) => l.getAttribute("data-region") === "hand");
    assert.ok(hand, "Brissett's thumb is on the figure");
    assert.match(hand.querySelector("b").textContent, /thumb/i);
    assert.match(hand.querySelector("span").textContent, /^20\d\d(, 20\d\d)*[,:] (\d+ games?|played thru)$/);
    for (const l of labels) assert.match(l.getAttribute("style"), /^top:\d+(\.\d+)?%$/);
    // The health bar and the status line.
    const hp = card.querySelector(".scp-in-hp");
    assert.match(hp.getAttribute("aria-label"), /^Durability \d+\.\d of 100, /);
    assert.match(hp.getAttribute("style"), /--hp:#/);
    assert.equal(card.querySelector(".scp-in-dur-status b").textContent, "Healthy");
    // The grid: a row per season, outlined missed weeks only where the record says.
    assert.ok(card.querySelectorAll(".scp-in-av-row").length >= 2);
    for (const b of card.querySelectorAll(".scp-in-ab.is-mark")) assert.ok(b.classList.contains("is-r"));
    // Four tiles.
    assert.deepEqual([...card.querySelectorAll(".scp-in-dt-k")].map((k) => k.textContent), ["Major Injuries", "Soft-Tissue Events", "Games Missed", "Missed / Season"]);
  });

  test("a player outside the durability set gets no card", () => {
    const { doc } = render({ player: { id: "999999999", slug: "nobody", name: "No Body", position: "QB", years_exp: 1 } });
    assert.equal(doc.querySelector("[data-scp-durability]"), null);
  });
});
