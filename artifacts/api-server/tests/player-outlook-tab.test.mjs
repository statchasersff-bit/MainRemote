/**
 * The Outlook tab's spec sections (lib/player/outlook-tab.ts), rendered
 * against hand-built states: in season, preseason, injured, and a record with
 * no advanced line. The driver field is the real data on disk: the current
 * season's advanced table when it carries a line for Jacoby Brissett (mak,
 * 2026-10-22), else his 2025 line on the outlook file - so the expected ranks
 * are computed from the same table rather than pinned.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const ol = await importModule("lib/player/outlook-tab");
const olp = await importModule("lib/player/outlook-premium");
const measures = await importModule("lib/player/outlook-tab-data");
const data = await importModule("lib/player/data");

after(cleanupBundles);

const ARI = {
  code: "ARI", slug: "arizona-cardinals", nickname: "Cardinals", fullName: "Arizona Cardinals",
  primaryColor: "#97233F", secondaryColor: "#FFB612", logo: "",
};
const team = (code, nickname) => ({ code, nickname, slug: nickname.toLowerCase() });

const qb = (week, pts) => ({
  week, opp: "SEA", team: "ARI", game_status: "active",
  stats: { pts_ppr: pts, pass_att: 30, pass_cmp: 20, pass_yd: 200, pass_td: 1, pass_int: 1 },
});

const record = data.loadFantasyOutlook2026()["3257"] ?? Object.values(data.loadFantasyOutlook2026()).find((r) => r.slug === "jacoby-brissett");

/**
 * What the drivers should say for Brissett's passing volume, from the same
 * table the tab reads: the current season's when he has a line there.
 */
function expectedVolume() {
  const table = data.loadAdvancedStats("qb", 2026);
  const row = table?.rows?.find((r) => r.playerId === "3257");
  if (row && table.week >= 1) {
    const min = measures.minGames(table.week);
    const field = table.rows.filter((r) => (r.games ?? 0) >= min && typeof r.attempts === "number").map((r) => r.attempts / r.games).sort((a, b) => b - a);
    const value = row.attempts / row.games;
    return { season: 2026, week: table.week, value: value.toFixed(1), rank: field.findIndex((v) => v <= value) + 1, of: field.length };
  }
  return { season: 2025, week: null, value: "34.6", rank: 5, of: 41 };
}
const volume = expectedVolume();

const game = (week, code, nickname, rank, homeAway = "away") => ({
  week, homeAway, opponent: team(code, nickname), opponentCode: code, opponentName: nickname,
  kickoffMs: null, timeConfirmed: false, matchup: { rank, fpa: 20, position: "QB" },
});

function state(overrides = {}) {
  return {
    player: { id: "3257", slug: "jacoby-brissett", name: "Jacoby Brissett", position: "QB", injury_status: null },
    team: ARI,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    leagueWeek: 3,
    production: [{ season: 2026, posFinishPpg: 17 }],
    seasonRank: 17,
    logCareer: [
      { season: 2026, weeks: [qb(1, 16.5), qb(2, 7.5), qb(3, 25.6)], finish: 20 },
      { season: 2025, weeks: Array.from({ length: 14 }, (_, i) => qb(i + 1, 16.8)), finish: 16 },
    ],
    upcoming: [game(4, "NYG", "Giants", 8), game(5, "DET", "Lions", 1, "home"), game(6, "LAR", "Rams", 20), game(7, "DEN", "Broncos", 22)],
    depth: { position: "QB", order: 1, next: { name: "Gardner Minshew II", slug: "gardner-minshew" } },
    teammates: [{ name: "Trey McBride", slug: "trey-mcbride", position: "TE" }, { name: "Michael Wilson", slug: null, position: "WR" }],
    fantasyOutlook2026: record,
    bioProfile: { draft: { year: 2016, round: 3, pick: 91, team: team("NE", "Patriots") }, stints: [] },
    designation: null,
    statsUpdatedMs: Date.parse("2026-09-29T12:00:00Z"),
    ...overrides,
  };
}

// The page's order (player-render.ts): the tab's body, the premium closing
// sections, then the footer and the FAQ.
const render = (s) => {
  const parts = ol.outlookTabParts(s, { playerPathPrefix: "/nfl/players/" }) ?? { body: "", foot: "", faq: "" };
  return new JSDOM(`<!doctype html><body>${parts.body}${olp.renderOutlookPremium(s)}${parts.foot}${parts.faq}</body>`).window.document;
};

describe("league fit", () => {
  test("the spec's QB cutoff table", () => {
    const labels = (r) => ol.leagueChips("QB", r).map((c) => c.label);
    assert.deepEqual(labels(10), ["Weekly starter", "Weekly starter", "Weekly starter"]);
    assert.deepEqual(labels(17), ["Weekly starter", "Streamer", "Streamer"]);
    assert.deepEqual(labels(25), ["Weekly starter", "Streamer", "Waiver wire"]);
    assert.deepEqual(labels(30), ["Streamer", "Waiver wire", "Waiver wire"]);
    assert.deepEqual(labels(40), ["Bench stash", "Waiver wire", "Waiver wire"]);
  });

  test("tiers by thirds", () => {
    assert.equal(measures.tierOf(5, 41), "good");
    assert.equal(measures.tierOf(25, 41), "mid");
    assert.equal(measures.tierOf(30, 41), "bad");
  });
});

describe("in season", () => {
  const doc = render(state());

  test("the sections, in order, each with an H2 (contract hidden; the take and the expectation row have none since 2026-10-22)", () => {
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-ol > section > h2, .scp-ol > section .scp-ol-take h2, .scp-ol > section .scp-ol-bar h2, .scp-olp-sec h2.scp-olp-bar-title")].map((h) => h.textContent),
      [
        "Jacoby Brissett Rest-of-Season Projection",
        "What Drives Jacoby Brissett's Fantasy Value?",
        "What Could Change His Value",
        "Jacoby Brissett Upcoming Matchups",
        "Jacoby Brissett Fantasy Outlook FAQ",
      ],
    );
    // "Our Take After Week n" is gone (mak, 2026-10-22). Since 2026-10-29 the
    // lead heading opens the read grid's prose column (so the sidebar starts
    // on its row), and the section is labelled by that heading.
    assert.equal(doc.querySelector("#scp-ol-read-h"), null);
    const read = doc.querySelector(".scp-ol-sec-read");
    assert.ok(read.classList.contains("scp-ol-sec-take"), "the take and the read are one section");
    assert.equal(read.getAttribute("aria-labelledby"), "scp-ol-take-h");
    assert.equal(doc.querySelectorAll(".scp-ol-sec-take").length, 1, "the hero is not printed twice");
    const col = read.querySelector(".scp-ox-read > div");
    assert.equal(col.firstElementChild.className, "scp-ol-take", "the heading opens the prose column");
    assert.ok(read.querySelector(".scp-ox-read > .scp-ox-aside"), "beside the sidebar");
  });

  test("the hero carries no lede or tier line (mak, 2026-10-22), and the expectation panels are gone", () => {
    assert.equal(doc.querySelector(".scp-ol-tier"), null);
    assert.equal(doc.querySelector(".scp-ol-lede"), null);
    assert.equal(doc.querySelector(".scp-ol-take .scp-ol-fits"), null, "the chips left the hero");
    // The Preseason / 2025 final / Through Week n row went 2026-10-22 (mak).
    assert.equal(doc.querySelector(".scp-ol-sec-expect"), null);
    assert.equal(doc.querySelector(".scp-ol-ex"), null);
    assert.equal(doc.querySelector("#scp-ol-exp-h"), null, "no Preseason Projection vs. Reality heading");
  });

  test("the sidebar: Redraft Command, then Best fit in place of the at-a-glance card", () => {
    const aside = doc.querySelector(".scp-ox-read > .scp-ox-aside");
    assert.deepEqual([...aside.querySelectorAll(".scp-ox-panel > h3")].map((h) => h.textContent), ["Redraft Command", "Best fit"]);
    assert.equal(aside.querySelector(".scp-ol-profile"), null, "no Outlook at a glance");
    assert.ok(!aside.textContent.includes("Outlook at a glance"));
    assert.deepEqual([...aside.querySelectorAll(".scp-ol-fit .scp-ol-chip")].map((c) => c.textContent), [
      "Weekly starter", "Streamer", "Streamer",
    ]);
    assert.deepEqual([...aside.querySelectorAll(".scp-ol-fit > span:first-child")].map((c) => c.textContent), [
      "Superflex / 2QB", "1QB, 12+ teams", "1QB, 10 teams",
    ]);
  });

  test("the hero: no meta line under the tier", () => {
    // The rank · PPG · headline stat line went 2026-10-05 (mak).
    assert.equal(doc.querySelector(".scp-ol-meta"), null);
    assert.equal(doc.querySelector(".scp-ol-sum"), null);
  });

  test("rank rails: one a driver from the server, his marker at the true ordinal, labeled", () => {
    // The premium rail (2026-11-05): a tick rail with his marker at
    // (rank - 1) / (of - 1) of the width, and the rank spelled out for a
    // screen reader.
    const rails = [...doc.querySelectorAll(".scp-olp-rail")];
    assert.equal(rails.length, 3);
    const first = rails[0];
    assert.equal(first.getAttribute("role"), "img");
    const ord = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
    assert.match(first.getAttribute("aria-label"), new RegExp(`^Jacoby Brissett ranks ${ord(volume.rank)} of ${volume.of} qualifying QBs in `));
    const pct = volume.of <= 1 ? 50 : ((volume.rank - 1) / (volume.of - 1)) * 100;
    assert.equal(first.querySelector(".scp-olp-me").getAttribute("style"), `left:${pct.toFixed(2)}%`);
    assert.equal(doc.querySelector(".scp-olp-drv .scp-olp-drv-value strong").textContent, volume.value);
    // The lede names the season the ranks are from, and the week in season.
    const lede = doc.querySelector(".scp-olp-sec.is-drivers .scp-olp-bar-sub").textContent;
    assert.match(lede, new RegExp(`^His ${volume.season} rank${volume.week ? ` through Week ${volume.week}` : ""} among the ${volume.of} quarterbacks`));
    // Our Take's second paragraph and the trigger evidence read the same season.
    assert.match(doc.body.textContent, volume.week ? new RegExp(`Through Week ${volume.week} he ranks`) : /Last season he ranked/);
    assert.match(doc.querySelector(".scp-olp-sec.is-change").textContent, new RegExp(`in ${volume.season}\.`));
  });

  test("exactly two Redraft Command links: the sidebar card and the risk-foot line", () => {
    // mak, 2026-10-01: one main CTA plus one subtle bottom CTA. The expect-panel
    // button and the prose link are gone; a third link reappearing is the bug.
    const ctas = [...doc.querySelectorAll('a[href*="redraft-command"]')].map((a) => [a.getAttribute("data-cta"), a.href.includes("?player=jacoby-brissett")]);
    for (const [, has] of ctas) assert.ok(has);
    const names = ctas.map(([c]) => c).filter(Boolean).sort();
    assert.deepEqual(names, ["redraft-command-outlook-premium", "redraft-command-outlook-sidebar"]);
  });

  test("no byline on the in-season take; the preseason piece is archived collapsed", () => {
    // mak, 2026-10-02: no "Preseason outlook originally published" line.
    assert.equal(doc.querySelector(".scp-st-byline"), null);
    assert.doesNotMatch(doc.querySelector(".scp-ol").textContent, /Contract terms aren't available/);
    const prev = doc.querySelector("details.scp-olp-prev");
    assert.ok(prev && !prev.open);
    assert.match(prev.querySelector("summary").textContent, /^Read our preseason outlook \(June 2026\)$/);
    // The brief (2026-11-05): history last. The archive is the final section of
    // the body, after the schedule, and says which scoring its numbers use.
    const sections = [...doc.querySelectorAll("#outlook-premium > .scp-olp-sec")];
    assert.ok(sections[sections.length - 1].contains(prev), "the archive closes the body");
    assert.match(prev.textContent, /as published in June; the figures above are PPR points per game/);
  });

  test("no generic risks: nobody 'could get hurt or benched' without evidence", () => {
    const claims = [...doc.querySelectorAll(".scp-olp-card.is-risk .scp-olp-claim")].map((c) => c.textContent);
    assert.ok(!claims.includes("Health"), claims.join(" | "));
    assert.ok(!claims.includes("Job security"), claims.join(" | "));
  });

  test("every upside and risk bullet is a claim with its evidence as subtext", () => {
    const items = [...doc.querySelectorAll(".scp-olp-items li")];
    assert.ok(items.length >= 2);
    for (const li of items) {
      // The claim line carries no period; the evidence under it keeps the
      // number or the name (mak, 2026-10-01).
      const claim = li.querySelector(".scp-olp-claim");
      const evid = li.querySelector(".scp-olp-evid");
      assert.ok(claim && evid, li.textContent);
      assert.doesNotMatch(claim.textContent, /\.$/);
      assert.match(evid.textContent, /\d|[A-Z][a-z]+ [A-Z]/, evid.textContent);
    }
  });

  test("names come from the data; no SEO in the fragment", () => {
    assert.match(doc.body.textContent, /Gardner Minshew II/);
    assert.match(doc.body.textContent, /Trey McBride and Michael Wilson/);
    assert.equal(doc.querySelector('script[type="application/ld+json"]'), null);
    // Forward-looking questions only (faq-engine.ts, 2026-09-30).
    const qs = [...doc.querySelectorAll(".scp-ol-faq summary")].map((q) => q.textContent);
    assert.ok(qs.length >= 5 && qs.length <= 15, `${qs.length} questions`);
    assert.equal(qs[0], "What is Jacoby Brissett's fantasy outlook for the rest of the 2026 season?");
    assert.ok(!qs.some((q) => /worth rostering|last season|in 2025\?/.test(q)), "rosterability and history are other tabs'");
    assert.ok(doc.querySelector(".scp-ol-faq details").open);
  });
});

describe("edge states", () => {
  test("preseason: the preseason piece as the read, under its own title, no panel row", () => {
    const doc = render(state({ leagueWeek: 0, logCareer: [state().logCareer[1]] }));
    assert.equal(doc.querySelector("#scp-ol-read-h").textContent, "Our 2026 Preseason Outlook");
    assert.equal(doc.querySelector("details.scp-olp-prev"), null);
    assert.equal(doc.querySelector(".scp-ol-ex"), null);
  });

  test("injured: a red status line, bench or waiver chips, the injury first in the risks", () => {
    const doc = render(state({ designation: { injuryStatus: "Out", injuryBodyPart: "Ankle" } }));
    assert.equal(doc.querySelector(".scp-ol-injured").textContent, "Out, ankle.");
    for (const chip of doc.querySelectorAll(".scp-ol-fit .scp-ol-chip")) {
      assert.match(chip.textContent, /Bench stash|Waiver wire/);
    }
    assert.equal(doc.querySelector(".scp-olp-card.is-risk li .scp-olp-claim").textContent, "Injury");
  });

  test("no advanced line: the drivers section is left out, the rest still renders", () => {
    // No line on the record and no row in the current season's table.
    const doc = render(state({ fantasyOutlook2026: { ...record, keyStats: null }, player: { ...state().player, id: "none" } }));
    assert.equal(doc.querySelector(".scp-olp-sec.is-drivers"), null);
    assert.ok(doc.querySelector("#scp-ol-take-h"));
  });

  test("a position the spec does not cover renders nothing", () => {
    assert.equal(ol.renderOutlookTab(state({ player: { ...state().player, position: "K" } })), "");
  });
});

/* ------------------------------------------------- the forward rebuild, 2026-11-05 */

const wrRecord = Object.values(data.loadFantasyOutlook2026()).find((r) => r.slug === "michael-wilson") ?? null;

const wrGame = (week, pts, tgt) => ({
  week, opp: "SEA", team: "ARI", game_status: "active",
  stats: { pts_ppr: pts, rec_tgt: tgt, rec: Math.round(tgt * 0.6), rec_yd: tgt * 8, rec_td: 0 },
});

/** A usage row shaped like outlook-context.ts builds it, with Wilson's Week 8 numbers. */
function usage(overrides = {}) {
  const weekly = [18.9, 26.9, 34, 37.1, 15.2, 20.6, 18.2, 36.6].map((ts, i) => ({ week: i + 1, ts, cs: 0, tgt: 7, car: 0, teamTgt: 30, teamCar: 25, snap: 90, rz: 1 }));
  const row = {
    id: "00-0038559", name: "Michael Wilson", slug: "michael-wilson", sleeperId: "10232", pos: "WR", games: 8,
    targets: 81, receptions: 45, carries: 3, targetShare: 25.9, airYardsShare: 39.6, wopr: 0.67, adot: 11.4, ezTargets: 15,
    firstReadShare: 32.3, snapShare: 89, rzTouches: 17, gzCarries: 0, wopp: 165, woppPerGame: 20.6, hvt: 45,
    lastSeasonWoppPerGame: null, situation: {}, longestRuns: [], designedRunRate: null, scrambleRate: null, sackRate: null,
    dropbacks: 0, passAdot: null, xfpPerGame: 19.4, fpoePerGame: -5.8, fpPerGame: 13.6, yacPerAtt: null, weekly,
    pct: {}, qualified: true, leagueRank: { metric: "target share", rank: 10 }, pool: 97,
    ...overrides.row,
  };
  const trend = (key) => {
    const vals = weekly.map((w) => w[key]);
    const recent = vals.slice(-3), base = vals.slice(-6, -3);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const delta = Math.round((mean(recent) - mean(base)) * 10) / 10;
    return { trail: recent, trailWeeks: [6, 7, 8], delta, baseWeek: 5, baseWeeks: [3, 4, 5], direction: Math.abs(delta) < 2 ? "flat" : delta > 0 ? "up" : "down", confirmed: false };
  };
  return {
    season: 2026, throughWeek: 8, builtAt: "2026-11-04T12:00:00Z", teamCode: "ARI", row,
    ts: trend("ts"), snap: trend("snap"),
    ranks: { xfpPerGame: { rank: 5, of: 97 }, fpoePerGame: { rank: 97, of: 97 }, firstReadShare: { rank: 7, of: 97 }, targetShare: { rank: 10, of: 97 }, airYardsShare: { rank: 7, of: 97 }, snapShare: { rank: 4, of: 97 } },
    leadsRz: true, rzCoLead: false, aheadOfHim: [],
    ...overrides,
  };
}

function wr(overrides = {}) {
  const weeks = [10.6, 3.8, 25.9, 16.5, 7.3, 7.2, 10.6, 26.8].map((pts, i) => wrGame(i + 1, pts, [7, 7, 17, 13, 7, 7, 8, 15][i]));
  return {
    player: { id: "10232", slug: "michael-wilson", name: "Michael Wilson", position: "WR", injury_status: null },
    team: ARI,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    leagueWeek: 8,
    production: [{ season: 2026, posFinishPpg: 24 }],
    seasonRank: 24,
    logCareer: [
      { season: 2026, weeks, finish: 24 },
      { season: 2025, weeks: Array.from({ length: 17 }, (_, i) => wrGame(i + 1, 13, 8)), finish: 10 },
    ],
    gameLog: weeks,
    // Three tough, one neutral: the brief's own example.
    upcoming: [game(9, "SEA", "Seahawks", 32), game(10, "LAR", "Rams", 28, "home"), game(11, "KC", "Chiefs", 31), game(12, "WAS", "Commanders", 11, "home")],
    upcomingSeason: [game(15, "NYJ", "Jets", 23, "home"), game(16, "NO", "Saints", 20), game(17, "LV", "Raiders", 10, "home")],
    depth: { position: "WR", order: 1, next: { name: "Reggie Virgil", slug: null } },
    // The season's leading passer, by attempts: not the man under center now.
    teammates: [{ name: "Jacoby Brissett", slug: "jacoby-brissett", position: "QB" }],
    startingQb: { name: "Gardner Minshew II", slug: "gardner-minshew-ii", attempts: 23, lastWeek: 8 },
    usage: usage(),
    rosRank: { rank: 23, position: "WR", updatedAt: "October 22, 2026", updatedAtIso: null },
    fantasyOutlook2026: wrRecord,
    bioProfile: { draft: { year: 2023, round: 3, pick: 94, team: ARI }, stints: [] },
    designation: null,
    statsUpdatedMs: Date.parse("2026-11-04T12:00:00Z"),
    ...overrides,
  };
}

describe("the forward-looking rebuild (the brief, 2026-11-05)", () => {
  const doc = render(wr());
  const text = doc.body.textContent;

  test("the quarterback is the listed starter, and a change is said as a change", () => {
    assert.doesNotMatch(text, /Brissett is his quarterback/);
    assert.match(text, /Gardner Minshew II is now the Cardinals' listed starting quarterback/);
    assert.ok([...doc.querySelectorAll(".scp-ol-tags .scp-ol-chip")].some((c) => c.textContent === "QB change"));
    const risks = [...doc.querySelectorAll(".scp-olp-card.is-risk .scp-olp-claim")].map((c) => c.textContent);
    assert.ok(risks.includes("A new quarterback"), risks.join(" | "));
    const qs = [...doc.querySelectorAll(".scp-ol-faq summary")].map((q) => q.textContent);
    assert.ok(qs.includes("Who is Michael Wilson's quarterback?"));
    // Suffixes drop from the surname: "Minshew", never "Minshew II's".
    assert.doesNotMatch(text, /Minshew II's|under Minshew II/);
  });

  test("no quarterback change: the starter is named plainly", () => {
    const same = render(wr({ teammates: [{ name: "Gardner Minshew II", slug: null, position: "QB" }] }));
    assert.match(same.body.textContent, /Gardner Minshew II is his quarterback\./);
    assert.ok(![...same.querySelectorAll(".scp-ol-tags .scp-ol-chip")].some((c) => c.textContent === "QB change"));
  });

  test("a schedule of three tough matchups is a risk, never an upside", () => {
    const up = [...doc.querySelectorAll(".scp-olp-card.is-up .scp-olp-claim")].map((c) => c.textContent);
    const risks = [...doc.querySelectorAll(".scp-olp-card.is-risk .scp-olp-claim")].map((c) => c.textContent);
    assert.ok(!up.some((c) => /schedule|soft/i.test(c)), up.join(" | "));
    assert.ok(risks.includes("Tough matchups"), risks.join(" | "));
    // The way through: his volume, said beside the risk rather than as a contradiction.
    assert.match(doc.querySelector(".scp-olp-card.is-risk").textContent, /25\.9% target share is the way through them/);
    assert.ok([...doc.querySelectorAll(".scp-ol-tags .scp-ol-chip")].some((c) => c.textContent === "Tough upcoming schedule"));
  });

  test("a soft stretch is an upside, never a risk; a split is neither", () => {
    const soft = render(wr({ upcoming: [game(9, "NYG", "Giants", 8), game(10, "DET", "Lions", 1, "home"), game(11, "LAR", "Rams", 20), game(12, "DEN", "Broncos", 22)] }));
    const softUp = [...soft.querySelectorAll(".scp-olp-card.is-up .scp-olp-claim")].map((c) => c.textContent);
    const softRisk = [...soft.querySelectorAll(".scp-olp-card.is-risk .scp-olp-claim")].map((c) => c.textContent);
    assert.ok(softUp.includes("A soft stretch"), softUp.join(" | "));
    assert.ok(!softRisk.some((c) => /matchup/i.test(c)), softRisk.join(" | "));
    const split = render(wr({ upcoming: [game(9, "NYG", "Giants", 8), game(10, "SEA", "Seahawks", 32, "home"), game(11, "LAR", "Rams", 20), game(12, "DEN", "Broncos", 18)] }));
    const claims = [...split.querySelectorAll(".scp-olp-items .scp-olp-claim")].map((c) => c.textContent);
    assert.ok(!claims.some((c) => /matchup|soft/i.test(c)), claims.join(" | "));
    assert.match(split.querySelector(".scp-olp-sec.is-schedule .scp-olp-read").textContent, /^A mixed stretch/);
  });

  test("Opportunity vs. Production leads with expected points against actual", () => {
    const h2s = [...doc.querySelectorAll(".scp-ol > section > h2, .scp-ol > section .scp-ol-take h2, .scp-ol > section .scp-ol-bar h2, .scp-olp-sec h2.scp-olp-bar-title")].map((h) => h.textContent);
    assert.deepEqual(h2s, [
      "Michael Wilson Rest-of-Season Projection",
      "Opportunity vs. Production",
      "What Drives Michael Wilson's Fantasy Value?",
      "What Could Change His Value",
      "Michael Wilson Upcoming Matchups",
      "Michael Wilson Fantasy Outlook FAQ",
    ]);
    const tiles = [...doc.querySelectorAll(".scp-ol-tile")].map((t) => `${t.querySelector("dt").textContent}=${t.querySelector("dd").textContent}`);
    assert.deepEqual(tiles.slice(0, 3), ["PPR points per game=13.6", "Expected points per game=19.4", "Points over expected=−5.8"]);
    assert.ok(tiles.includes("First-read share=32.3%"));
    // The read is the first takeaway row's sentence (one panel, not paragraphs).
    const read = doc.querySelector(".scp-ol-sec-opp .scp-ol-tk-row:first-child p").textContent;
    assert.match(read, /averaging 19\.4 expected PPR points a game but producing 13\.6/);
    assert.match(read, /does not guarantee improvement/);
    // The read opens on the same numbers.
    assert.match(doc.querySelector(".scp-ol-sec-read .scp-ox-prose").textContent, /averaging just 13\.6 PPR points against 19\.4 expected/);
    assert.ok([...doc.querySelectorAll(".scp-ol-tags .scp-ol-chip")].some((c) => c.textContent === "Scoring under expected"));
    assert.match(doc.querySelector(".scp-ol-more a").getAttribute("href"), /\/arizona-cardinals\/usage\/$/);
  });

  test("the drivers: target share, xFP, FPOE, first-read share, then air yards", () => {
    const labels = [...doc.querySelectorAll(".scp-olp-drv .scp-olp-h3")].map((h) => h.textContent);
    assert.deepEqual(labels, ["Target share", "Expected points", "Points over expected", "First-read share", "Downfield role"]);
    assert.ok(!labels.includes("Target volume"));
    const fpoe = [...doc.querySelectorAll(".scp-olp-drv")].find((d) => d.querySelector("h3").textContent === "Points over expected");
    assert.equal(fpoe.querySelector(".scp-olp-tier").textContent, "Under expected");
    assert.match(doc.querySelector(".scp-olp-sec.is-drivers .scp-olp-bar-sub").textContent, /Each row names its field/);
  });

  test("what could change: catalysts with evidence, the gap first", () => {
    const up = [...doc.querySelectorAll(".scp-olp-card.is-up .scp-olp-claim")].map((c) => c.textContent);
    assert.equal(up[0], "Room for the points to catch his role");
    assert.match(doc.querySelector(".scp-olp-card.is-up .scp-olp-evid").textContent, /19\.4 expected PPR points a game against 13\.6 scored/);
    // With a catalyst present the strips are not restated as "upside".
    assert.ok(!up.includes("Heavy target share"), up.join(" | "));
  });

  test("the hero: as-of line, tags, and what supports / threatens the value", () => {
    // No "Updated {date}" (mak, 2026-11-05): the week alone.
    assert.equal(doc.querySelector(".scp-ol-asof").textContent, "Through Week 8");
    const tags = [...doc.querySelectorAll(".scp-ol-tags .scp-ol-chip")].map((c) => c.textContent);
    assert.equal(tags[0], "High-volume starter");
    const cells = [...doc.querySelectorAll(".scp-ol-st-cell")].map((c) => c.textContent);
    assert.match(cells[0], /^What supports his valueHeavy target volume \(25\.9%, 10th of 97\)/);
    assert.match(cells[1], /Three difficult matchups in his next four and uncertainty over how targets are distributed with Minshew starting\./);
  });

  test("Best fit reads the ROS board and says what it assumes", () => {
    assert.deepEqual([...doc.querySelectorAll(".scp-ol-fit .scp-ol-chip")].map((c) => c.textContent), ["Weekly starter", "Flex play", "Weekly starter"]);
    const note = doc.querySelector(".scp-ol-fitnote").textContent;
    assert.match(note, /^Based on his StatChasers rest-of-season rank, WR23 \(updated October 22\)\. Assumes three receivers and a flex/);
    // Off the board: the season rank, and the note says so.
    const off = render(wr({ rosRank: null }));
    assert.match(off.querySelector(".scp-ol-fitnote").textContent, /^Based on his PPR points-per-game rank this season, WR24\./);
  });

  test("the FAQ answers from the same model: buy low on the gap, the schedule's verdict, the quarterback", () => {
    const faq = Object.fromEntries([...doc.querySelectorAll(".scp-ol-faq details")].map((d) => [d.querySelector("summary").textContent, d.textContent]));
    assert.match(faq["Should I buy low or sell high on Michael Wilson?"], /buy-low candidate on the numbers: 19\.4 expected PPR points a game against 13\.6 scored/);
    assert.match(faq["How difficult is Michael Wilson's remaining fantasy schedule?"], /^.*Difficult: of his next four games, zero come against a top-10 matchup/);
    assert.match(faq["What is Michael Wilson's fantasy football upside?"], /19\.4 expected points a game/);
    assert.doesNotMatch(faq["What is Michael Wilson's fantasy football upside?"], /top-10 matchup/);
    assert.match(faq["Who is Michael Wilson's quarterback?"], /Gardner Minshew II is the Cardinals' listed starting quarterback now/);
    assert.match(faq["Is Michael Wilson a good fantasy playoff option?"], /Jets .*Saints .*Raiders .*one of them is favorable/);
  });

  test("no usage row: the read falls back to the season line and the drivers, nothing invented", () => {
    const bare = render(wr({ usage: null, rosRank: null }));
    assert.equal(bare.querySelector("#scp-ol-opp-h"), null);
    assert.match(bare.querySelector(".scp-ol-sec-read .scp-ox-prose").textContent, /^Through 8 games he's WR24 at 13\.6 PPR points per game/);
    assert.doesNotMatch(bare.body.textContent, /expected PPR points/);
    assert.ok(bare.querySelector(".scp-olp-sec.is-change"), "the triggers still render");
  });
});

describe("the premium comparison of the four closing sections (mak's brief, 2026-11-05)", () => {
  const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const both = (s) => {
    const page = new JSDOM(`<!doctype html><body>${ol.renderOutlookTab(s, { playerPathPrefix: "/nfl/players/" })}${olp.renderOutlookPremium(s)}</body>`).window.document;
    return { page, orig: page.querySelector(".scp-ol"), prm: page.querySelector("#outlook-premium") };
  };

  test("the four closing sections are the premium block; the tab body carries none of the originals (mak, 2026-11-05)", () => {
    const { orig, prm } = both(state());
    assert.ok(prm, "the premium block renders");
    assert.equal(prm.querySelector(".scp-olp-flag"), null, "no comparison flag: these are the tab's sections");
    assert.deepEqual([...prm.querySelectorAll(".scp-olp-sec")].map((s) => s.className.replace("scp-olp-sec ", "")), ["is-drivers", "is-change", "is-schedule", "is-archive"]);
    for (const sel of [".scp-ol-drv", ".scp-ol-ur", "#scp-ol-drv-h", "#scp-ol-sch-h", ".scp-ol-sec-prev", ".scp-ol-cta"]) {
      assert.equal(orig.querySelector(sel), null, `${sel} is gone from the tab body`);
    }
    assert.equal(orig.querySelector("[class*='scp-olp']"), null, "the tab body carries none of the premium markup");
    // Drivers: his marker at the true ordinal position, the rank spelled out.
    const first = prm.querySelector(".scp-olp-drv");
    const pct = volume.of <= 1 ? 50 : ((volume.rank - 1) / (volume.of - 1)) * 100;
    assert.equal(first.querySelector(".scp-olp-me").getAttribute("style"), `left:${pct.toFixed(2)}%`);
    assert.match(first.querySelector(".scp-olp-rail").getAttribute("aria-label"), new RegExp(`^Jacoby Brissett ranks \\d+(st|nd|rd|th) of ${volume.of} qualifying QBs in `));
    assert.equal(text(first.querySelector(".scp-olp-drv-value strong")), volume.value);
    assert.match(text(prm.querySelector(".is-drivers .scp-olp-bar-title")), /^What Drives Jacoby Brissett's Fantasy Value\?$/);
    // The Redraft Command strip is the tab's one bottom link to it.
    assert.match(prm.querySelector(".scp-olp-cta-btn").getAttribute("href"), /redraft-command/);
    // Matchups: four cards, each a week, an opponent, a rank and a difficulty word.
    const games = [...prm.querySelectorAll(".scp-olp-game")];
    assert.equal(games.length, 4);
    for (const g of games) {
      assert.match(text(g.querySelector(".scp-olp-wk")), /^Wk \d+$/);
      assert.match(text(g.querySelector(".scp-olp-chip")), /^(Favorable|Neutral|Tough)$/);
    }
    assert.equal(prm.querySelector(".scp-olp-prev").hasAttribute("open"), false);
    assert.doesNotMatch(prm.textContent, /—/);
  });

  test("the drivers section is left out without an advanced line, the rest still renders", () => {
    const { prm } = both(state({ fantasyOutlook2026: { ...record, keyStats: null }, player: { ...state().player, id: "none" } }));
    assert.ok(prm);
    assert.equal(prm.querySelector(".is-drivers"), null);
    assert.ok(prm.querySelector(".is-schedule"));
  });

  test("a position the spec does not cover renders nothing", () => {
    assert.equal(olp.renderOutlookPremium(state({ player: { id: "1", slug: "x", name: "X Y", position: "K", injury_status: null } })), "");
  });
});
