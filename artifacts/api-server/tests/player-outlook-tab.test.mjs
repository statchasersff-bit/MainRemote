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

// These fixtures set each week's stored total (pts_ppr) independently of its
// stat line, so they exercise the provider-total path and pin it; the house
// path (SC_SCORING_TOTALS=house, the deployed setting) is covered by
// tests/data-accuracy.test.mjs and the rendered-page verification.
process.env.SC_SCORING_TOTALS = "provider";


const ol = await importModule("lib/player/outlook-tab");
const olp = await importModule("lib/player/outlook-premium");
const olr = await importModule("lib/player/outlook-projection-premium");
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
  // As the page prints the tab (player-render.ts): the body (the preseason
  // piece, or nothing in season), the projection + opportunity block, the
  // closing sections, the footer, the FAQ.
  const opts = { playerPathPrefix: "/nfl/players/" };
  const parts = ol.outlookTabParts(s, opts) ?? { body: "", foot: "", faq: "" };
  return new JSDOM(`<!doctype html><body>${parts.body}${olr.renderOutlookProjectionPremium(s, opts)}${olp.renderOutlookPremium(s)}${parts.foot}${parts.faq}</body>`).window.document;
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

  test("the sections, in order, each with an H2 (the first two are the premium block since 2026-11-05, with the ids the originals carried)", () => {
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-ol > section > h2, .scp-olr-sec h2.scp-olr-bar-title, .scp-olp-sec h2.scp-olp-bar-title")].map((h) => h.textContent),
      [
        "Jacoby Brissett Rest-of-Season Projection",
        "What Drives Jacoby Brissett's Fantasy Value?",
        // What Could Change His Value folds into the matchups footer when the
        // matchups print (mak, 2026-11-27): no H2 of its own.
        "Jacoby Brissett Upcoming Matchups",
        "Jacoby Brissett Fantasy Outlook FAQ",
      ],
    );
    // "Our Take After Week n" is gone (mak, 2026-10-22); since 2026-11-05 the
    // original read, hero and sidebar are gone too: the projection section is
    // the premium block, labelled by its heading, the sidebar inside it.
    assert.equal(doc.querySelector("#scp-ol-read-h"), null);
    assert.equal(doc.querySelector(".scp-ol-sec-read, .scp-ol-sec-take, .scp-ol-take, .scp-ol-feat"), null, "the originals are gone");
    const proj = doc.querySelector(".scp-olr-sec.is-proj");
    assert.equal(proj.getAttribute("aria-labelledby"), "scp-ol-take-h");
    assert.equal(doc.querySelectorAll("#scp-ol-take-h").length, 1, "the hero is not printed twice");
    // 2026-11-27 (mak): one column, no sidebar; the start/sit link rides the verdict row.
    assert.equal(proj.querySelector(".scp-olr-side, .scp-olr-rc"), null, "no sidebar, no promo card");
    assert.ok(proj.querySelector(".scp-olr-verdict .scp-olr-btn.is-verdict"), "the start/sit link is in the verdict row");
    const own = [...doc.querySelectorAll(".scp-ol")];
    assert.equal(own.length, 1, "the tab's own in-season body is empty: one wrap, the FAQ's");
    assert.ok(own[0].querySelector(".scp-ol-faq"));
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

  test("Best fit: one compact row under the read, the leagues and their calls (mak, 2026-11-27)", () => {
    const aside = doc.querySelector(".scp-olr-fit.is-row");
    assert.equal(aside.querySelector(".scp-olr-fit-h").textContent, "Best fit");
    assert.equal(doc.querySelector(".scp-ol-profile"), null, "no Outlook at a glance");
    assert.ok(!doc.body.textContent.includes("Outlook at a glance"));
    assert.deepEqual([...aside.querySelectorAll(".scp-olr-fit-row .scp-olr-pill")].map((c) => c.textContent), [
      "Weekly starter", "Streamer", "Streamer",
    ]);
    assert.deepEqual([...aside.querySelectorAll(".scp-olr-fit-league")].map((c) => c.textContent), [
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
    assert.match([...doc.querySelectorAll(".scp-olr-ob.is-change")].map((li) => li.textContent).join(" "), new RegExp(`in ${volume.season}\.`));
  });

  test("exactly one Redraft Command link: the projection card", () => {
    // mak, 2026-10-01: one main CTA plus one subtle bottom CTA. Since the
    // 2026-11-26 audit (WEB-017) the main one opens his weekly start/sit page
    // (Redraft Command's player page is a noindex shell) and the bottom one,
    // "Compare them in Redraft Command", is gone: the shell compared nothing.
    const ctas = [...doc.querySelectorAll('a[href*="redraft-command"]')].map((a) => [a.getAttribute("data-cta"), a.href.endsWith("/redraft-command/who-should-i-start/jacoby-brissett")]);
    for (const [, has] of ctas) assert.ok(has);
    const names = ctas.map(([c]) => c).filter(Boolean).sort();
    assert.deepEqual(names, ["startsit-outlook-projection-premium"]);
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

  test("every upside and risk line is a claim with its evidence (in the projection's read since 2026-11-28)", () => {
    const items = [...doc.querySelectorAll(".scp-olr-ob.is-change")];
    assert.ok(items.length >= 1);
    for (const li of items) {
      // "Claim: evidence", the evidence keeping the number or the name
      // (mak, 2026-10-01); the claim carries no period of its own.
      const claim = li.querySelector("b").textContent;
      assert.match(claim, /[^.]:$/);
      const evid = li.querySelector("p").textContent.slice(claim.length);
      assert.match(evid, /\d|[A-Z][a-z]+ [A-Z]/, evid);
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
    // The injured sentence is the read's last observation, on the alert glyph.
    assert.match(doc.querySelector(".scp-olr-ob.is-alert p").textContent, /^He's out, ankle\. Until he's back, his value is a bench spot at most/);
    for (const chip of doc.querySelectorAll(".scp-olr-fit-row .scp-olr-pill")) {
      assert.match(chip.textContent, /Bench stash|Waiver wire/);
    }
    assert.equal(doc.querySelector(".scp-olr-ob.is-change.is-risk b").textContent, "Injury:");
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
    fieldNote: "6+ games and 1.5+ targets per team game",
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
    // The status pills went 2026-11-27 (mak); the change is the risk line.
    assert.equal(doc.querySelector(".scp-olr-tag"), null);
    const risks = [...doc.querySelectorAll(".scp-olr-ob.is-change.is-risk b")].map((c) => c.textContent);
    assert.ok(risks.includes("A new quarterback:"), risks.join(" | "));
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
    // The model's lists (the footer leaves the schedule items to the cards).
    const m = ol.outlookPremiumModel(wr());
    const up = m.triggers.up.map((i) => i.claim);
    const risks = m.triggers.risk.map((i) => i.claim);
    assert.ok(!up.some((c) => /schedule|soft/i.test(c)), up.join(" | "));
    assert.ok(risks.includes("Tough matchups"), risks.join(" | "));
    // The way through: his volume, said beside the risk rather than as a contradiction.
    assert.match(m.triggers.risk.find((i) => i.claim === "Tough matchups").evidence, /25\.9% target share is the way through them/);
    // On the page the matchup cards carry it: no footer line repeats it
    // (mak, 2026-11-27), and the section's verdict says the stretch.
    const lines = [...doc.querySelectorAll(".scp-olr-ob.is-change b")].map((c) => c.textContent);
    assert.ok(!lines.includes("Tough matchups:"), lines.join(" | "));
  });

  test("a soft stretch is an upside, never a risk; a split is neither", () => {
    const softState = wr({ upcoming: [game(9, "NYG", "Giants", 8), game(10, "DET", "Lions", 1, "home"), game(11, "LAR", "Rams", 20), game(12, "DEN", "Broncos", 22)] });
    const softM = ol.outlookPremiumModel(softState);
    const softUp = softM.triggers.up.map((i) => i.claim);
    const softRisk = softM.triggers.risk.map((i) => i.claim);
    assert.ok(softUp.includes("A soft stretch"), softUp.join(" | "));
    assert.ok(!softRisk.some((c) => /matchup/i.test(c)), softRisk.join(" | "));
    // The cards show the stretch; the footer does not repeat it (2026-11-27).
    const soft = render(softState);
    assert.ok(![...soft.querySelectorAll(".scp-olr-ob.is-change b")].some((c) => /soft/i.test(c.textContent)));
    // The stretch is said beside the heading (mak, 2026-11-28), no summary line under the cards.
    assert.equal(soft.querySelector(".scp-olp-sec.is-schedule .scp-olp-bar-aside").textContent, "Two of the next four rank in the top 12 for WRs, one in the bottom 12");
    assert.equal(soft.querySelector(".scp-olp-sec.is-schedule .scp-olp-read:not(.is-playoffs)"), null);
    const splitState = wr({ upcoming: [game(9, "NYG", "Giants", 8), game(10, "SEA", "Seahawks", 32, "home"), game(11, "LAR", "Rams", 20), game(12, "DEN", "Broncos", 18)] });
    const splitM = ol.outlookPremiumModel(splitState);
    const claims = [...splitM.triggers.up, ...splitM.triggers.risk].map((i) => i.claim);
    assert.ok(!claims.some((c) => /matchup|soft/i.test(c)), claims.join(" | "));
    const split = render(splitState);
    assert.match(split.querySelector(".scp-olp-sec.is-schedule .scp-olp-bar-aside").textContent, /^One top-12 and one bottom-12 WR matchups in the next four$/);
  });

  test("Opportunity vs. Production leads with expected points against actual", () => {
    const h2s = [...doc.querySelectorAll(".scp-ol > section > h2, .scp-olr-sec h2.scp-olr-bar-title, .scp-olp-sec h2.scp-olp-bar-title")].map((h) => h.textContent);
    assert.deepEqual(h2s, [
      "Michael Wilson Rest-of-Season Projection",
      "Opportunity vs. Production",
      "What Drives Michael Wilson's Fantasy Value?",
      "Michael Wilson Upcoming Matchups",
      "Michael Wilson Fantasy Outlook FAQ",
    ]);
    const tiles = [...doc.querySelectorAll(".scp-olr-kpi")].map((t) => `${t.querySelector("dt").textContent}=${t.querySelector("dd").textContent}`);
    // The primary row: actual, expected, the difference (mak, 2026-11-27).
    assert.deepEqual(tiles, ["PPR points per game=13.6", "Expected points per game=19.4", "Points over expected=−5.8"]);
    // The volume figures: one secondary row under it.
    const vol = [...doc.querySelectorAll(".scp-olr-vol-item")].map((t) => `${t.querySelector("dt").textContent}=${t.querySelector("dd").textContent}`);
    assert.ok(vol.includes("first-read share=32.3%"), vol.join(" | "));
    // The production callout is one sentence on what the gap means; the
    // figures it restated are the row above.
    const read = doc.querySelector(".scp-olr-sec.is-opp .scp-olr-gap").textContent;
    assert.doesNotMatch(read, /averaging 19\.4 expected PPR points a game but producing 13\.6/);
    assert.match(read, /^His opportunity profile is stronger than his output/);
    assert.match(read, /does not guarantee improvement\.$/);
    // The read opens on the same numbers.
    assert.match(doc.querySelector(".scp-olr-obs").textContent, /averaging just 13\.6 PPR points against 19\.4 expected/);
    assert.equal(doc.querySelector(".scp-olr-tag"), null, "no status pills");
    assert.match(doc.querySelector(".scp-olr-more a").getAttribute("href"), /\/arizona-cardinals\/usage\/$/);
  });

  test("the drivers: target share, first-read share, then air yards (xFP and FPOE are the row above)", () => {
    const labels = [...doc.querySelectorAll(".scp-olp-drv .scp-olp-h3")].map((h) => h.textContent);
    // Expected points and points over expected print in Opportunity vs.
    // Production just above, so the drivers leave them out (mak, 2026-11-27).
    assert.deepEqual(labels, ["Target share", "First-read share", "Downfield role"]);
    assert.ok(!labels.includes("Target volume"));
    const rows = ol.outlookPremiumModel(wr()).drivers.rows;
    const fpoe = rows.find((d) => d.label === "Points over expected");
    assert.equal(fpoe.word, "Under expected", "the model still carries them");
    // WEB-035 (2026-11-26): the Downfield row ranks in the usage field like
    // the rest, so every row is out of one field and the lede names it and
    // its rule (it read "Each row names its field" over 97 and the advanced
    // table's count).
    assert.match(doc.querySelector(".scp-olp-sec.is-drivers .scp-olp-bar-sub").textContent, /among the 97 receivers with 6\+ games and 1\.5\+ targets per team game\./);
    const air = [...doc.querySelectorAll(".scp-olp-drv")].find((d) => d.querySelector("h3").textContent === "Downfield role");
    assert.match(air.textContent, /39\.6%/);
    assert.match(air.textContent, /7th of 97/);
  });

  test("what could change: catalysts with evidence, the gap first", () => {
    const lines = [...doc.querySelectorAll(".scp-olr-ob.is-change.is-up")];
    const up = lines.map((c) => c.querySelector("b").textContent.replace(/:$/, ""));
    assert.equal(up[0], "Room for the points to catch his role");
    assert.match(lines[0].textContent, /19\.4 expected PPR points a game against 13\.6 scored/);
    // With a catalyst present the strips are not restated as "upside".
    assert.ok(!up.includes("Heavy target share"), up.join(" | "));
  });

  test("the hero: as-of line, tags, and what supports / threatens the value", () => {
    // No "Updated {date}" (mak, 2026-11-05), and no "Through Week N" either (2026-11-06).
    assert.equal(doc.querySelector(".is-proj .scp-olr-bar-sub"), null);
    // The status pills went 2026-11-27 (mak): the verdict says it.
    assert.equal(doc.querySelector(".scp-olr-tag"), null);
    assert.ok(doc.querySelector(".scp-olr-verdict .scp-olr-thesis"));
    const cells = [...doc.querySelectorAll(".scp-olr-factor")].map((c) => c.textContent);
    assert.match(cells[0], /^What supports his valueHeavy target volume \(25\.9%, 10th of 97\)/);
    assert.match(cells[1], /Three difficult matchups in his next four and uncertainty over how targets are distributed with Minshew starting\./);
  });

  test("Best fit reads the ROS board and says what it assumes", () => {
    assert.deepEqual([...doc.querySelectorAll(".scp-olr-fit-row .scp-olr-pill")].map((c) => c.textContent), ["Weekly starter", "Flex play", "Weekly starter"]);
    const note = doc.querySelector(".scp-olr-fit-note").textContent;
    assert.match(note, /^Based on his StatChasers rest-of-season rank, WR23 \(updated October 22\)\. Assumes three receivers and a flex/);
    // Off the board: the season rank, and the note says so.
    const off = render(wr({ rosRank: null }));
    assert.match(off.querySelector(".scp-olr-fit-note").textContent, /^Based on his PPR points-per-game rank this season, WR24\./);
    // Audit WEB-029: a rank quoted from the board links that position's board;
    // no rank quoted, no link.
    const link = doc.querySelector(".scp-olr-fit-note a");
    assert.equal(link.getAttribute("href"), "https://statchasers.com/fantasy-football/rest-of-season-rankings/wr/");
    assert.equal(link.textContent, "See the WR rest-of-season rankings.");
    assert.match(note, /See the WR rest-of-season rankings\.$/);
    assert.equal(off.querySelector(".scp-olr-fit-note a"), null);
  });

  test("the FAQ answers from the same model: buy low on the gap, the schedule's verdict, the quarterback", () => {
    const faq = Object.fromEntries([...doc.querySelectorAll(".scp-ol-faq details")].map((d) => [d.querySelector("summary").textContent, d.textContent]));
    assert.match(faq["Should I buy low or sell high on Michael Wilson?"], /buy-low candidate on the numbers: 19\.4 expected PPR points a game against 13\.6 scored/);
    assert.match(faq["How difficult is Michael Wilson's remaining fantasy schedule?"], /^.*Difficult: of his next four games, one comes against a top-12 matchup for WRs and three against one of the stingiest defenses/);
    assert.match(faq["What is Michael Wilson's fantasy football upside?"], /19\.4 expected points a game/);
    assert.doesNotMatch(faq["What is Michael Wilson's fantasy football upside?"], /top-1[02] matchup/);
    assert.match(faq["Who is Michael Wilson's quarterback?"], /Gardner Minshew II is the Cardinals' listed starting quarterback now/);
    assert.match(faq["Is Michael Wilson a good fantasy playoff option?"], /Jets .*Saints .*Raiders .*one of them is favorable/);
  });

  test("no usage row: the read falls back to the season line and the drivers, nothing invented", () => {
    const bare = render(wr({ usage: null, rosRank: null }));
    assert.equal(bare.querySelector("#scp-ol-opp-h"), null);
    assert.match(bare.querySelector(".scp-olr-obs").textContent.trim(), /^Through 8 games he's WR24 at 13\.6 PPR points per game/);
    assert.doesNotMatch(bare.body.textContent, /expected PPR points/);
    assert.ok(bare.querySelector(".scp-olr-ob.is-change, .scp-olp-changes, .scp-olp-sec.is-change"), "the triggers still render");
  });
});

describe("the premium comparison of the four closing sections (mak's brief, 2026-11-05)", () => {
  const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const both = (s) => {
    const page = new JSDOM(`<!doctype html><body>${ol.renderOutlookTab(s, { playerPathPrefix: "/nfl/players/" })}${olp.renderOutlookPremium(s)}</body>`).window.document;
    return { page, orig: page.querySelector(".scp-ol"), prm: page.querySelector("#outlook-premium") };
  };

  test("the four closing sections are the premium block; the tab body carries none of the originals (mak, 2026-11-05)", () => {
    const { orig, prm, model } = both(state());
    assert.ok(prm, "the premium block renders");
    assert.equal(prm.querySelector(".scp-olp-flag"), null, "no comparison flag: these are the tab's sections");
    assert.deepEqual([...prm.querySelectorAll(".scp-olp-sec")].map((s) => s.className.replace("scp-olp-sec ", "")), ["is-drivers", "is-schedule", "is-archive"]);
    // What Could Change rides the projection's read, not the matchups (mak,
    // 2026-11-28): the playoff schedule sits directly under the cards.
    assert.equal(prm.querySelector(".is-schedule .scp-olp-changes"), null);
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
    // The bottom "Compare them in Redraft Command" strip is gone (2026-11-26
    // audit, WEB-017): the projection card is the tab's one link to it.
    assert.equal(prm.querySelector(".scp-olp-cta-btn"), null);
    // Matchups: four two-line cards (mak, 2026-11-28), "Wk 13 · vs MIA" then
    // "6th vs QBs · Favorable"; no week pill, no grade badge.
    const games = [...prm.querySelectorAll(".scp-olp-game")];
    assert.equal(games.length, 4);
    for (const g of games) {
      assert.match(text(g.querySelector(".scp-olp-g1")), /^Wk \d+ · (vs|at) [A-Z]{2,3}$/);
      assert.match(text(g.querySelector(".scp-olp-g2")), /^\d+(st|nd|rd|th) vs [A-Z]{1,2}s · (Favorable|Neutral|Tough)$/);
      assert.equal(g.querySelector(".scp-olp-chip"), null);
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

describe("the projection and opportunity sections (mak's brief, 2026-11-05, no portrait; approved and the originals removed the same day)", () => {
  const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const both = (s) => {
    const opts = { playerPathPrefix: "/nfl/players/", teamPathPrefix: "/nfl/teams/" };
    const page = new JSDOM(`<!doctype html><body>${ol.renderOutlookTab(s, opts)}${olr.renderOutlookProjectionPremium(s, opts)}</body>`).window.document;
    return { page, orig: page.querySelector(".scp-ol"), prm: page.querySelector("#outlook-projection-premium"), model: ol.outlookProjectionModel(s, opts) };
  };
  const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
  const list = (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  test("the tab's own sections, printed from the model: every word, figure and link", () => {
    const { orig, prm, model } = both(wr());
    assert.ok(prm, "the premium block renders");
    assert.equal(prm.querySelector(".scp-olr-flag"), null, "no comparison flag: this is the tab");
    assert.equal(orig.querySelector(".scp-ol-sec-read, .scp-ol-sec-take, .scp-ol-sec-opp, .scp-ol-feat, .scp-ol-tile"), null, "the originals are gone");
    // No portrait, no image of any kind, no empty art column.
    assert.equal(prm.querySelectorAll("img, picture, .scp-ol-feat, .scp-ol-feat-art").length, 0);
    // The approved H2 ladder's first two headings, with the ids the originals carried.
    assert.deepEqual([...prm.querySelectorAll("h2.scp-olr-bar-title")].map((h) => `${h.id}:${text(h)}`), ["scp-ol-take-h:Michael Wilson Rest-of-Season Projection", "scp-ol-opp-h:Opportunity vs. Production"]);
    assert.equal(prm.querySelectorAll("h1, h3").length, 0);
    assert.equal(prm.querySelector(".scp-olr-sec.is-proj").getAttribute("aria-labelledby"), "scp-ol-take-h");
    assert.equal(prm.querySelector(".scp-olr-sec.is-opp").getAttribute("aria-labelledby"), "scp-ol-opp-h");
    assert.deepEqual([...prm.querySelectorAll(".scp-olr-bar-title")].map(text), ["Michael Wilson Rest-of-Season Projection", "Opportunity vs. Production"]);
    assert.equal(prm.querySelector(".is-proj .scp-olr-bar-sub"), null, "no as-of line (2026-11-06)");
    // No status pills (mak, 2026-11-27): they repeated the verdict.
    assert.equal(prm.querySelector(".scp-olr-tag, .scp-olr-tags"), null);
    // The takeaway and the read's sentences, with the figures bolded.
    assert.equal(text(prm.querySelector(".scp-olr-thesis")), model.headline);
    const paras = model.paragraphs;
    assert.deepEqual([...prm.querySelectorAll(".scp-olr-ob:not(.is-change) p")].map(text), paras);
    assert.ok(prm.querySelector(".scp-olr-ob p strong"), "figures are bolded");
    assert.match(prm.querySelector(".scp-olr-ob p").innerHTML, /<strong>19\.4<\/strong>/);
    // Supports / threatens: the same sentences.
    assert.deepEqual(
      [...prm.querySelectorAll(".scp-olr-factor p")].map(text),
      [[model.supports, model.supportsEmpty], [model.threatens, model.threatensEmpty]].map(([items, empty]) => (items.length ? `${cap(list(items))}.` : empty)),
    );
    assert.deepEqual([...prm.querySelectorAll(".scp-olr-factor-h")].map(text), ["What supports his value", "What threatens his value"]);
    // The start/sit link: in the verdict row, its own data-cta; the promo
    // card and its copy are gone (mak, 2026-11-27).
    const btn = prm.querySelector(".scp-olr-verdict .scp-olr-btn");
    assert.equal(btn.getAttribute("href"), model.rc.href);
    assert.equal(btn.getAttribute("data-cta"), "startsit-outlook-projection-premium");
    assert.equal(text(btn), "Should I start Wilson?");
    assert.equal(prm.querySelector(".scp-olr-rc"), null);
    // Best fit: the same rows and chips, the same assumptions line.
    assert.deepEqual(
      [...prm.querySelectorAll(".scp-olr-fit-row")].map((r) => `${text(r.querySelector(".scp-olr-fit-league"))}=${text(r.querySelector(".scp-olr-pill"))}`),
      model.fits.leagues.map((l, i) => `${l}=${model.fits.chips[i].label}`),
    );
    assert.equal(text(prm.querySelector(".scp-olr-fit-note")), model.fits.note);
    // Opportunity (mak, 2026-11-27): the first three figures are the primary
    // row (the first gold), the rest one secondary volume row.
    const kpis = [...prm.querySelectorAll(".scp-olr-kpis.is-primary .scp-olr-kpi")].map((t) => `${text(t.querySelector("dt"))}=${text(t.querySelector("dd"))}`);
    const tiles = model.opportunity.tiles.map((t) => `${t.label}=${t.value}`);
    assert.deepEqual(kpis, tiles.slice(0, 3));
    const vol = [...prm.querySelectorAll(".scp-olr-vol-item")].map((t) => `${text(t.querySelector("dt"))}=${text(t.querySelector("dd"))}`);
    assert.deepEqual(vol, model.opportunity.tiles.slice(3).map((t) => `${t.label.charAt(0).toLowerCase()}${t.label.slice(1)}=${t.value}`));
    assert.ok(prm.querySelector(".scp-olr-kpi:first-child").classList.contains("is-lead"));
    assert.deepEqual(
      [...prm.querySelectorAll(".scp-olr-kpi-sub, .scp-olr-vol-sub")].map(text),
      model.opportunity.tiles.filter((t) => t.sub).map((t) => t.sub),
    );
    assert.equal(text(prm.querySelector(".scp-olr-lede")), model.opportunity.lede);
    // The production reading: its last sentence, what the gap means; the
    // other readings keep their rows with the same claims and sentences.
    const [gapTake, ...trend] = model.opportunity.takes;
    assert.equal(text(prm.querySelector(".scp-olr-gap")), gapTake.meaning);
    // A name with a period in it ("St. Brown") never splits the sentence.
    assert.ok(gapTake.text.endsWith(gapTake.meaning));
    assert.deepEqual(
      [...prm.querySelectorAll(".scp-olr-read")].map((r) => `${text(r.querySelector(".scp-olr-read-claim"))} ${text(r.querySelector(".scp-olr-read-text"))}`),
      trend.map((t) => `${t.claim} ${t.text}`),
    );
    assert.equal(prm.querySelector(".scp-olr-more a").getAttribute("href"), model.opportunity.link.href);
    assert.match(prm.querySelector(".scp-olr-more a").getAttribute("href"), /^\/nfl\/teams\/arizona-cardinals\/usage\/$/);
    assert.doesNotMatch(prm.textContent, /—/);
    assert.doesNotMatch(prm.innerHTML, /&amp;#39;|&#39;s<strong>/, "apostrophes survive the bolding");
  });

  test("bolding the figures: entities and glued digits are left alone", () => {
    assert.equal(olr.emphasize("Wilson's 27.6% share, 6th of 97, Week 9, Top-8, WR16, 2QB, +0.4"), "Wilson&#39;s <strong>27.6%</strong> share, <strong>6th of 97</strong>, <strong>Week 9</strong>, Top-8, WR16, 2QB, <strong>+0.4</strong>");
  });

  test("an injured player: the designation badge, the injured sentence as the alert row, no usage-based supports when benched", () => {
    const s = wr({ player: { id: "10232", slug: "michael-wilson", name: "Michael Wilson", position: "WR", injury_status: "Out" }, designation: { injury_status: "Out", injury_body_part: "Knee" } });
    const { orig, prm, model } = both(s);
    if (!prm) return; // the originals render nothing for this state either
    assert.deepEqual([...prm.querySelectorAll(".scp-olr-ob:not(.is-change) p")].map(text), model.paragraphs);
    const reads = prm.querySelectorAll(".scp-olr-ob:not(.is-change)");
    const last = reads[reads.length - 1];
    if (reads.length > 1 && /out/i.test(text(last))) assert.ok(last.classList.contains("is-alert"));
  });

  test("no usage row (the QB fixture): the projection renders, the opportunity section is left out as in the original; a position the spec does not cover, or the preseason, renders nothing", () => {
    const { orig, prm, model } = both(state());
    assert.ok(prm);
    assert.ok(prm.querySelector(".scp-olr-sec.is-proj"));
    assert.equal(model.opportunity, null);
    assert.equal(prm.querySelector(".scp-olr-sec.is-opp"), null);
    assert.deepEqual([...prm.querySelectorAll(".scp-olr-ob:not(.is-change) p")].map(text), model.paragraphs);
    assert.equal(olr.renderOutlookProjectionPremium(state({ player: { ...state().player, position: "K" } })), "");
    assert.equal(olr.renderOutlookProjectionPremium(state({ leagueWeek: 0, season: 2026 })), "");
  });
});

// Player-page audit, 2026-11-20: from the Thursday game on, the league's
// logged week is the week in progress for every club. The Outlook FAQ said
// "through Week 11" for clubs yet to play it (Josh Allen, live); it names his
// club's completed week now, as the Stats FAQ does since d4d63e2.
test("Outlook FAQ: 'through Week N' is his club's completed week, not the Thursday game's", () => {
  const s = state({ leagueWeek: 4 }); // Week 4 opener logged; his Week 4 game is still ahead
  const text = render(s).body.textContent;
  assert.match(text, /through Week 3\b/);
  assert.doesNotMatch(text, /through Week 4\b/);
});

test("Outlook FAQ: a club that played Thursday reads through the week in progress", () => {
  // Week 4 logged and his own Week 4 game already played (next game Week 5).
  const s = state({ leagueWeek: 4, upcoming: state().upcoming.slice(1) });
  const text = render(s).body.textContent;
  assert.match(text, /through Week 4\b/);
});

/* ------------------------------------- audit WEB-030 / WEB-034 / WEB-035, 2026-11-26 */

describe("rank basis, ROS freshness and an unavailable player (audit 2026-11-26)", () => {
  const all = (doc) => doc.body.textContent.replace(/\s+/g, " ");
  const faqAnswer = (doc, q) => {
    const item = [...doc.querySelectorAll("details, .scp-faq-item, [itemprop='mainEntity']")].find((d) => d.textContent.includes(q));
    return item ? item.textContent.replace(/\s+/g, " ") : "";
  };

  test("a fresh ROS board sets the advice and is dated", () => {
    const doc = render(wr({ rosRank: { rank: 23, position: "WR", updatedAt: "November 24, 2026", updatedAtIso: "2026-11-24", stale: false } }));
    assert.match(doc.querySelector(".scp-olr-fit-note").textContent, /^Based on his StatChasers rest-of-season rank, WR23 \(updated November 24\)/);
    assert.match(all(doc), /WR23 on the StatChasers rest-of-season board/);
    // The FAQ dates the board's rank too, from the same meta (2026-11-27).
    assert.match(faqAnswer(doc, "rest-of-season fantasy ranking"), /WR23 on the StatChasers rest-of-season board \(updated November 24\)/);
  });

  test("a stale ROS board is dated, excluded from advice, and nowhere else on the tab", () => {
    const doc = render(wr({ rosRank: { rank: 3, position: "WR", updatedAt: "October 22, 2026", updatedAtIso: "2026-10-22", stale: true } }));
    const note = doc.querySelector(".scp-olr-fit-note").textContent;
    assert.match(note, /^Based on his PPR points-per-game rank this season, WR24\./);
    assert.match(note, /The rest-of-season board \(WR3\) was last updated October 22 and is not used for current advice\./);
    // WR3 appears in that one dated sentence and nowhere else: not in the
    // chips, the FAQ, the drivers or the generated recommendations.
    const mentions = all(doc).match(/\bWR3\b/g) ?? [];
    assert.equal(mentions.length, 1, all(doc));
    assert.doesNotMatch(faqAnswer(doc, "rest-of-season fantasy ranking"), /board/);
    // The chips are the season rank's (WR24), not the stale WR3's.
    assert.deepEqual([...doc.querySelectorAll(".scp-olr-fit-row .scp-olr-pill")].map((c) => c.textContent), ol.fitChips("WR", 24).map((c) => c.label));
  });

  test("no ROS board: no board sentence, season rank advice", () => {
    const doc = render(wr({ rosRank: null }));
    assert.doesNotMatch(all(doc), /rest-of-season board/);
    assert.match(doc.querySelector(".scp-olr-fit-note").textContent, /^Based on his PPR points-per-game rank this season, WR24\./);
  });

  test("a total-points rank is labeled by total points everywhere on the tab", () => {
    const doc = render(wr({ production: [{ season: 2026, posFinishTotal: 133 }], seasonRank: null, seasonRankTotal: 133, rosRank: null }));
    const txt = all(doc);
    assert.match(doc.querySelector(".scp-olr-fit-note").textContent, /^Based on his total PPR points rank this season, WR133\./);
    assert.match(txt, /the WR133 in total PPR points/);
    assert.doesNotMatch(txt, /WR133 (in|by) (PPR )?points per game/);
  });

  test("on IR with no game: status first, no schedule advice, no playoff read", () => {
    const s = wr({
      gameLog: [], logCareer: [{ season: 2025, weeks: Array.from({ length: 17 }, (_, i) => wrGame(i + 1, 13, 8)), finish: 10 }],
      production: [], seasonRank: null, usage: null, rosRank: null,
      designation: { injuryStatus: "IR", injuryBodyPart: null },
      currentStatus: { kind: "reserve", message: "On IR." },
      upcoming: [game(9, "SEA", "Seahawks", 2), game(10, "LAR", "Rams", 5, "home"), game(11, "KC", "Chiefs", 8), game(12, "WAS", "Commanders", 11, "home")],
    });
    const doc = render(s);
    const txt = all(doc);
    assert.match(txt, /Michael Wilson has not played in 2026\. On IR\./);
    assert.match(txt, /He is on injured reserve, so these matchups matter only once he is activated\./);
    assert.doesNotMatch(txt, /favorable stretch|Fantasy playoffs \(Weeks 15 to 17\)/);
    assert.doesNotMatch(txt, /remaining fantasy schedule\?|good fantasy playoff option\?/);
    // No upside built on the soft schedule he cannot play.
    assert.doesNotMatch(txt, /top-12 matchups? for WRs/);
  });

  test("on IR after playing: one predicate drops matchup risk and upside from the card, the FAQ and the FAQ schema; the schedule facts stay (mak, 2026-11-26)", () => {
    const irState = wr({ designation: { injuryStatus: "IR", injuryBodyPart: "Back" }, currentStatus: { kind: "reserve", message: "On IR." } });
    const onIr = render(irState);
    // The risk list from the model: on the page the schedule items are left
    // to the matchup cards (mak, 2026-11-27).
    const risks = (st) => ol.outlookPremiumModel(st).triggers.risk.map((i) => i.claim);
    const activeState = wr();
    const island = (doc) => [...doc.querySelectorAll("script.scp-faq-data")].map((x) => x.textContent).join(" ");
    const faq = (doc) => [...doc.querySelectorAll(".scp-ol-faq, .scp-tab-faq")].map((x) => x.textContent).join(" ");
    // Every FAQ candidate, before the 10-question cap: the visible FAQ and the schema are a selection of these.
    const pool = (st) => ol.outlookFaqCandidates(st, { playerPathPrefix: "/nfl/players/" }).map((c) => `${c.q} ${c.a}`).join(" ");
    // Active (the control): the advice is there.
    assert.ok(risks(activeState).includes("Tough matchups"), risks(activeState).join(" | "));
    assert.match(pool(wr()), /tough matchups?/);
    assert.match(pool(wr()), /remaining fantasy schedule\?/);
    // On IR: not in the card, the visible FAQ or the schema island.
    assert.ok(!risks(irState).includes("Tough matchups"), risks(irState).join(" | "));
    assert.ok(risks(irState).includes("Injury"), risks(irState).join(" | "));
    assert.ok([...onIr.querySelectorAll(".scp-olr-ob.is-change.is-risk b")].some((b) => b.textContent === "Injury:"));
    assert.doesNotMatch(faq(onIr), /tough matchups?|stingiest|remaining fantasy schedule\?|good fantasy playoff option\?/);
    assert.doesNotMatch(island(onIr), /tough matchups?|stingiest|remaining fantasy schedule|good fantasy playoff option/);
    assert.doesNotMatch(pool(wr({ designation: { injuryStatus: "IR", injuryBodyPart: "Back" }, currentStatus: { kind: "reserve", message: "On IR." } })), /tough matchups?|stingiest|remaining fantasy schedule\?|good fantasy playoff option\?|top-12 matchups?/);
    assert.ok(![...onIr.querySelectorAll(".scp-olr-tag")].some((c) => /upcoming schedule/.test(c.textContent)));
    assert.doesNotMatch(all(onIr), /difficult upcoming matchups/);
    // The schedule section still lists the games, as facts.
    const sched = onIr.querySelector(".scp-olp-sec.is-schedule");
    assert.ok(sched && sched.querySelectorAll(".scp-olp-mu, li, article").length >= 3, "the matchups are still listed");
    assert.match(sched.textContent, /matter only once he is activated/);
  });
});
