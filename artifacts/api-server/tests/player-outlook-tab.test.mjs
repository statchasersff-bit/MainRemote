/**
 * The Outlook tab's spec sections (lib/player/outlook-tab.ts), rendered
 * against hand-built states: in season, preseason, injured, and a record with
 * no advanced line. The driver field is the real outlook file, so the
 * reference numbers for Jacoby Brissett's 2025 line hold here too.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const ol = await importModule("lib/player/outlook-tab");
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

const render = (s) => new JSDOM(`<!doctype html><body>${ol.renderOutlookTab(s, { playerPathPrefix: "/nfl/players/" })}</body>`).window.document;

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

  test("six sections, in order, each with an H2 (contract hidden for now)", () => {
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-ol > section > h2, .scp-ol > section .scp-ol-take h2")].map((h) => h.textContent),
      [
        "Jacoby Brissett Rest-of-Season Outlook",
        "Preseason Projection vs. Reality",
        "Our Take After Week 3",
        "What Drives His Outlook",
        "What Could Change His Value",
        "Jacoby Brissett Fantasy Outlook FAQ",
      ],
    );
  });

  test("the tier line is 4–8 words, no period, and the chips follow the rank", () => {
    const tier = doc.querySelector(".scp-ol-tier").textContent;
    assert.equal(tier, "Volume-driven QB2 with streaming weeks");
    const words = tier.split(" ").length;
    assert.ok(words >= 4 && words <= 8);
    assert.deepEqual([...doc.querySelectorAll(".scp-ol-fit .scp-ol-chip")].map((c) => c.textContent), [
      "Weekly starter", "Streamer", "Streamer",
    ]);
  });

  test("the expectation panels: ~QB30, QB16, QB17, and no number in the last one", () => {
    const rks = [...doc.querySelectorAll(".scp-ol-ex .scp-ol-rk")].map((r) => r.textContent);
    assert.deepEqual(rks, ["~QB30", "QB16", "QB17", "Live rank, updated after every game"]);
    assert.equal(doc.querySelectorAll(".scp-ol-arrow[aria-hidden='true']").length, 2);
  });

  test("rank strips: N bars from the server, his highlighted, labelled", () => {
    const strips = [...doc.querySelectorAll(".scp-ol-dots")];
    assert.equal(strips.length, 3);
    const first = strips[0];
    assert.equal(first.getAttribute("role"), "img");
    assert.equal(first.getAttribute("aria-label"), "5th of 41 QBs");
    assert.equal(first.querySelectorAll("i").length, 41);
    assert.equal([...first.querySelectorAll("i")].findIndex((i) => i.classList.contains("is-me")), 4);
    assert.equal(doc.querySelector(".scp-ol-drv .scp-ol-val strong").textContent, "34.6");
  });

  test("every Redraft Command link carries ?player= and its data-cta", () => {
    const ctas = [...doc.querySelectorAll('a[href*="redraft-command"]')].map((a) => [a.getAttribute("data-cta"), a.href.includes("?player=jacoby-brissett")]);
    for (const [, has] of ctas) assert.ok(has);
    const names = ctas.map(([c]) => c).filter(Boolean);
    for (const cta of ["redraft-command-outlook-expect", "redraft-command-outlook-prose", "redraft-command-outlook-sidebar", "redraft-command-outlook-risk"]) {
      assert.ok(names.includes(cta), cta);
    }
  });

  test("the byline dates only the preseason piece, which is archived collapsed", () => {
    const byline = doc.querySelector(".scp-st-byline").textContent;
    assert.match(byline, /^Preseason outlook originally published /);
    assert.doesNotMatch(byline, /Updated automatically/);
    assert.doesNotMatch(doc.querySelector(".scp-ol").textContent, /Contract terms aren't available/);
    const prev = doc.querySelector("details.scp-ol-prev");
    assert.ok(prev && !prev.open);
    assert.match(prev.querySelector("summary").textContent, /^Read our preseason outlook \(June 2026\)$/);
  });

  test("every upside and risk bullet carries a number or a name", () => {
    for (const li of doc.querySelectorAll(".scp-ol-ur li")) {
      assert.match(li.textContent, /\d|[A-Z][a-z]+ [A-Z]/, li.textContent);
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
  test("preseason: the take after last season, a Week 1 panel, the preseason piece as the read", () => {
    const doc = render(state({ leagueWeek: 0, logCareer: [state().logCareer[1]] }));
    assert.equal(doc.querySelector("#scp-ol-read-h").textContent, "Our 2026 Preseason Outlook");
    assert.equal(doc.querySelector("details.scp-ol-prev"), null);
    assert.match(doc.querySelector(".scp-ol-ex.is-now").textContent, /Season starts Week 4/);
  });

  test("injured: a red status line, bench or waiver chips, the injury first in the risks", () => {
    const doc = render(state({ designation: { injuryStatus: "Out", injuryBodyPart: "Ankle" } }));
    assert.equal(doc.querySelector(".scp-ol-injured").textContent, "Out, ankle.");
    for (const chip of doc.querySelectorAll(".scp-ol-fit .scp-ol-chip")) {
      assert.match(chip.textContent, /Bench stash|Waiver wire/);
    }
    assert.match(doc.querySelector(".scp-ol-card.is-risk li").textContent, /^Injury\./);
  });

  test("no advanced line: the drivers section is left out, the rest still renders", () => {
    const doc = render(state({ fantasyOutlook2026: { ...record, keyStats: null } }));
    assert.equal(doc.querySelector("#scp-ol-drv-h"), null);
    assert.ok(doc.querySelector("#scp-ol-take-h"));
  });

  test("a position the spec does not cover renders nothing", () => {
    assert.equal(ol.renderOutlookTab(state({ player: { ...state().player, position: "K" } })), "");
  });
});
