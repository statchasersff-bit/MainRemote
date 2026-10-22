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

  test("the sections, in order, each with an H2 (contract hidden; the expectation row has none since 2026-10-22)", () => {
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-ol > section > h2, .scp-ol > section .scp-ol-take h2")].map((h) => h.textContent),
      [
        "Jacoby Brissett Rest-of-Season Outlook",
        "Our Take After Week 3",
        "What Drives His Outlook",
        "What Could Change His Value",
        "Jacoby Brissett Fantasy Outlook FAQ",
      ],
    );
  });

  test("the hero carries no lede or tier line (mak, 2026-10-22), and the chips sit on the expectation row", () => {
    assert.equal(doc.querySelector(".scp-ol-tier"), null);
    assert.equal(doc.querySelector(".scp-ol-lede"), null);
    assert.equal(doc.querySelector(".scp-ol-take .scp-ol-fits"), null, "the chips left the hero");
    const row = doc.querySelector(".scp-ol-sec-expect .scp-ol-exrow");
    assert.ok(row?.querySelector(".scp-ol-expect") && row?.querySelector(".scp-ol-fits"), "panels and chips share the row");
    assert.equal(doc.querySelector("#scp-ol-exp-h"), null, "no Preseason Projection vs. Reality heading");
    assert.equal(doc.querySelector(".scp-ol-sec-expect .scp-ox-lede"), null, "no lede on the row");
    assert.deepEqual([...doc.querySelectorAll(".scp-ol-fit .scp-ol-chip")].map((c) => c.textContent), [
      "Weekly starter", "Streamer", "Streamer",
    ]);
  });

  test("the expectation panels: ~QB30, QB16, QB17, and no rest-of-season cell", () => {
    const rks = [...doc.querySelectorAll(".scp-ol-ex .scp-ol-rk")].map((r) => r.textContent);
    assert.deepEqual(rks, ["~QB30", "QB16", "QB17"]);
    // Short labels (mak, 2026-10-01): "Preseason", "Through Week 3". The
    // "Rest of season / Live rank" cell went 2026-10-22 (mak).
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-ol-ex .scp-ol-when")].map((r) => r.textContent),
      ["Preseason", "2025 final", "Through Week 3"],
    );
    assert.equal(doc.querySelector(".scp-ol-ex.is-ros"), null);
    assert.equal(doc.querySelectorAll(".scp-ol-arrow[aria-hidden='true']").length, 2);
  });

  test("the hero: no meta line under the tier, and the chips under a Best fit label", () => {
    // The rank · PPG · headline stat line went 2026-10-05 (mak).
    assert.equal(doc.querySelector(".scp-ol-meta"), null);
    assert.equal(doc.querySelector(".scp-ol-sum"), null);
    assert.equal(doc.querySelector(".scp-ol-fithead").textContent, "Best fit");
  });

  test("rank strips: N bars from the server, his highlighted, labeled", () => {
    const strips = [...doc.querySelectorAll(".scp-ol-dots")];
    assert.equal(strips.length, 3);
    const first = strips[0];
    assert.equal(first.getAttribute("role"), "img");
    const ord = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
    assert.equal(first.getAttribute("aria-label"), `${ord(volume.rank)} of ${volume.of} QBs`);
    assert.equal(first.querySelectorAll("i").length, volume.of);
    assert.equal([...first.querySelectorAll("i")].findIndex((i) => i.classList.contains("is-me")), volume.rank - 1);
    assert.equal(doc.querySelector(".scp-ol-drv .scp-ol-val strong").textContent, volume.value);
    // The lede names the season the ranks are from, and the week in season.
    const lede = doc.querySelector("#scp-ol-drv-h + .scp-ox-lede").textContent;
    assert.match(lede, new RegExp(`^His ${volume.season} rank${volume.week ? ` through Week ${volume.week}` : ""} among the ${volume.of} quarterbacks`));
    // Our Take's second paragraph and the trigger evidence read the same season.
    assert.match(doc.body.textContent, volume.week ? new RegExp(`Through Week ${volume.week} he ranks`) : /Last season he ranked/);
    assert.match(doc.querySelector(".scp-ol-ur").textContent, new RegExp(`in ${volume.season}\.`));
  });

  test("exactly two Redraft Command links: the sidebar card and the risk-foot line", () => {
    // mak, 2026-10-01: one main CTA plus one subtle bottom CTA. The expect-panel
    // button and the prose link are gone; a third link reappearing is the bug.
    const ctas = [...doc.querySelectorAll('a[href*="redraft-command"]')].map((a) => [a.getAttribute("data-cta"), a.href.includes("?player=jacoby-brissett")]);
    for (const [, has] of ctas) assert.ok(has);
    const names = ctas.map(([c]) => c).filter(Boolean).sort();
    assert.deepEqual(names, ["redraft-command-outlook-risk", "redraft-command-outlook-sidebar"]);
  });

  test("no byline on the in-season take; the preseason piece is archived collapsed", () => {
    // mak, 2026-10-02: no "Preseason outlook originally published" line.
    assert.equal(doc.querySelector(".scp-st-byline"), null);
    assert.doesNotMatch(doc.querySelector(".scp-ol").textContent, /Contract terms aren't available/);
    const prev = doc.querySelector("details.scp-ol-prev");
    assert.ok(prev && !prev.open);
    assert.match(prev.querySelector("summary").textContent, /^Read our preseason outlook \(June 2026\)$/);
  });

  test("every upside and risk bullet is a claim with its evidence as subtext", () => {
    const items = [...doc.querySelectorAll(".scp-ol-ur li")];
    assert.ok(items.length >= 2);
    for (const li of items) {
      // The claim line carries no period; the evidence under it keeps the
      // number or the name (mak, 2026-10-01).
      const claim = li.querySelector(".scp-ol-claim");
      const evid = li.querySelector(".scp-ol-evid");
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
    assert.equal(doc.querySelector(".scp-ol-card.is-risk li .scp-ol-claim").textContent, "Injury");
  });

  test("no advanced line: the drivers section is left out, the rest still renders", () => {
    // No line on the record and no row in the current season's table.
    const doc = render(state({ fantasyOutlook2026: { ...record, keyStats: null }, player: { ...state().player, id: "none" } }));
    assert.equal(doc.querySelector("#scp-ol-drv-h"), null);
    assert.ok(doc.querySelector("#scp-ol-take-h"));
  });

  test("a position the spec does not cover renders nothing", () => {
    assert.equal(ol.renderOutlookTab(state({ player: { ...state().player, position: "K" } })), "");
  });
});
