/**
 * The player profile header, rendered against hand-built states.
 *
 * tests/player.test.mjs checks the header on real pages, but which states the
 * real roster contains changes by the day: nobody may be on a bye next week, a
 * free agent may not have a page, and the offseason is months away. These
 * render renderHero() directly against the edge states in the header spec.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const render = await importModule("lib/player/header");

after(cleanupBundles);

const CARDINALS = {
  code: "ARI",
  slug: "arizona-cardinals",
  nickname: "Cardinals",
  fullName: "Arizona Cardinals",
  primaryColor: "#97233F",
  secondaryColor: "#FFB612",
  logo: "",
};

const GIANTS = { ...CARDINALS, code: "NYG", slug: "new-york-giants", nickname: "Giants", fullName: "New York Giants" };

/** 2026-10-04 17:00 UTC, which is 1:00 PM Eastern on a Sunday. */
const KICKOFF = Date.UTC(2026, 9, 4, 17, 0);

function state(overrides = {}) {
  return {
    player: {
      id: "123",
      slug: "jacoby-brissett",
      name: "Jacoby Brissett",
      position: "QB",
      number: 7,
      age: 33,
      height: "76",
      weight: "235",
      years_exp: 10,
      injury_status: null,
      headshotUrl: null,
    },
    team: CARDINALS,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    leagueWeek: 3,
    byeWeek: 8,
    stats: { gamesPlayed: 3, ppg: 16.5 },
    production: [{ season: 2026, posFinishPpg: 17, posFinishTotal: 16 }],
    seasonRank: 17,
    seasonRankTotal: 16,
    rosterPct: { owned: 13.4, started: null, season: 2026, week: 3 },
    upcoming: [
      {
        week: 4,
        homeAway: "away",
        opponent: GIANTS,
        opponentCode: "NYG",
        opponentName: "New York Giants",
        kickoffMs: KICKOFF,
        timeConfirmed: true,
        matchup: { rank: 8, fpa: 21.2, position: "QB" },
      },
    ],
    bioProfile: { draft: { year: 2016, round: 3, pick: 91 } },
    designation: null,
    fantasyOutlook2026: { season: 2026 },
    ...overrides,
  };
}

function header(data, options = {}, tab) {
  const html = render.renderHero(data, options, tab);
  return new JSDOM(`<body>${html}</body>`).window.document.querySelector("header");
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

describe("player header", () => {
  test("the reference state reads exactly as the spec's example", () => {
    const h = header(state());
    assert.equal(h.getAttribute("aria-label"), "Player summary");
    assert.match(h.getAttribute("style"), /--scp-team:#97233F/);

    assert.equal(text(h.querySelector(".scp-ptags")), "QB Arizona Cardinals #7");
    assert.equal(text(h.querySelector(".scp-phead-name")), "Jacoby Brissett");
    assert.equal(
      text(h.querySelector(".scp-phead-kind")),
      "Fantasy outlook, stats and Week 4 start/sit for 2026",
    );

    const spec = [...h.querySelectorAll(".scp-pspec > div")].map((d) => [
      text(d.querySelector("dt")),
      text(d.querySelector("dd")),
    ]);
    assert.deepEqual(spec, [
      ["Age", "33"],
      ["Height / weight", `6'4", 235 lb`],
      ["Experience", "11th season"],
      ["Drafted", "2016 R3, #91"],
    ]);

    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2026 season Through Week 3");
    const board = [...h.querySelectorAll(".scp-pboard-stats > div")].map((d) => text(d.querySelector("dd")));
    assert.deepEqual(board, ["16.5", "QB17", "13%"]);
    assert.ok(h.querySelector(".scp-pboard-stats > div:first-child").classList.contains("is-lead"));

    assert.equal(
      text(h.querySelector(".scp-pstrip-mu")),
      "Week 4 at Giants, Sun Oct 4, 1:00 PM ET 8th vs. QBs, favorable",
    );
    assert.ok(h.querySelector(".scp-mchip").classList.contains("is-good"));

    const [start, redraft] = h.querySelectorAll(".scp-pbtn");
    assert.equal(text(start), "Should I start Brissett in Week 4?");
    assert.equal(start.getAttribute("data-cta"), "startsit-header-overview");
    assert.equal(text(redraft), "Rest-of-season value in Redraft Command");
    assert.equal(redraft.getAttribute("href"), "https://statchasers.com/redraft-command/?player=jacoby-brissett");
    assert.equal(redraft.getAttribute("data-cta"), "redraft-command-header-overview");

    assert.equal(h.querySelector(".scp-pwell-num").getAttribute("aria-hidden"), "true");
    const img = h.querySelector(".scp-pwell-img");
    assert.equal(img.getAttribute("alt"), "Jacoby Brissett headshot");
    assert.ok(img.getAttribute("width") && img.getAttribute("height"), "the photo reserves its box");

    assert.ok(!h.textContent.includes("·"), "no middle dots anywhere in the header");
  });

  test("the H1 subtitle and analytics tags follow the tab", () => {
    const cases = {
      stats: "Stats: 2026 and career passing, rushing and fantasy numbers",
      "game-log": "Game log: 2026 weekly stats and fantasy points",
      outlook: "2026 fantasy outlook and rest-of-season projection",
      injury: "Injury status and history",
      news: "Latest news and fantasy analysis",
      bio: "Bio, career timeline and draft history",
    };
    for (const [tab, kind] of Object.entries(cases)) {
      const h = header(state(), {}, tab);
      assert.equal(text(h.querySelector(".scp-phead-kind")), kind, tab);
      const cta = tab.replace("-", "");
      assert.equal(h.querySelector(".scp-pbtn--line").getAttribute("data-cta"), `redraft-command-header-${cta}`);
    }
    const wr = header(state({ player: { ...state().player, position: "WR" } }), {}, "stats");
    assert.equal(text(wr.querySelector(".scp-phead-kind")), "Stats: 2026 and career receiving and fantasy numbers");
  });

  test("the heading is an H1 only on the standalone page", () => {
    assert.ok(header(state()).querySelector("h1.scp-phead-h1"), "standalone: H1");
    assert.ok(header(state(), { embed: true }).querySelector("h2.scp-phead-h1"), "embedded: H2");
    // When the tool supplies the heading, a panel's promoted heading is the H1.
    assert.ok(
      header(state(), { embed: true, ownHeading: true }).querySelector("h2.scp-phead-h1"),
      "embedded, tool supplies the heading: still H2",
    );
  });

  test("a bye next: the strip says so and the button targets the game after it", () => {
    const next = { ...state().upcoming[0], week: 5 };
    const h = header(state({ byeWeek: 4, upcoming: [next] }));
    assert.equal(
      text(h.querySelector(".scp-pstrip-mu")),
      "Week 4: bye. Next game Week 5 at Giants, Sun Oct 4, 1:00 PM ET 8th vs. QBs, favorable",
    );
    assert.equal(text(h.querySelector(".scp-pbtn--dark")), "Should I start Brissett in Week 5?");

    // Once the league has logged the bye week it is behind us, not next.
    const past = header(state({ byeWeek: 4, leagueWeek: 4, upcoming: [next] }));
    assert.ok(!text(past.querySelector(".scp-pstrip-mu")).includes("bye"));
  });

  test("the chip's band and word come from the opponent's rank", () => {
    const band = (rank) => {
      const game = { ...state().upcoming[0], matchup: { rank, fpa: 20, position: "QB" } };
      const chip = header(state({ upcoming: [game] })).querySelector(".scp-mchip");
      return [chip.className.split(" ")[1], text(chip)];
    };
    assert.deepEqual(band(10), ["is-good", "10th vs. QBs, favorable"]);
    assert.deepEqual(band(11), ["is-mid", "11th vs. QBs, neutral"]);
    assert.deepEqual(band(22), ["is-mid", "22nd vs. QBs, neutral"]);
    assert.deepEqual(band(23), ["is-bad", "23rd vs. QBs, tough"]);
  });

  test("before Week 1: last season final, and the button is the outlook", () => {
    const h = header(
      state({
        season: 2025,
        leagueWeek: 0,
        production: [{ season: 2025, posFinishPpg: 22, posFinishTotal: 20 }],
        stats: { gamesPlayed: 17, ppg: 14.2 },
      }),
    );
    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2025 final");
    assert.equal(text(h.querySelector(".scp-pbtn--dark")), "See Brissett's 2026 outlook");
    assert.match(h.querySelector(".scp-pbtn--dark").getAttribute("href"), /\/jacoby-brissett\/outlook\/$/);
    assert.equal(text(h.querySelector(".scp-phead-kind")), "Fantasy outlook and stats for 2026");
  });

  test("no games played: dashes, never 0.0", () => {
    const h = header(state({ stats: { gamesPlayed: 0, ppg: 0 }, rosterPct: null }));
    const board = [...h.querySelectorAll(".scp-pboard-stats dd")].map(text);
    assert.deepEqual(board, ["—", "—", "—"]);
  });

  test("a free agent: ink-2, no link, no strip", () => {
    const h = header(state({ team: null, upcoming: [] }));
    assert.equal(h.getAttribute("style"), null, "the stylesheet's ink-2 default answers");
    const team = h.querySelector(".scp-ptag-team");
    assert.equal(team.tagName, "SPAN");
    assert.equal(text(team), "Free agent");
    assert.equal(h.querySelector(".scp-pstrip"), null);
  });

  test("a designation is a pill linking to the Injury tab", () => {
    const pill = (status) =>
      header(state({ designation: { injuryStatus: status } })).querySelector(".scp-ptag-inj");
    assert.equal(text(pill("Questionable")), "Questionable");
    assert.ok(pill("Questionable").classList.contains("is-mid"));
    assert.ok(pill("Out").classList.contains("is-bad"));
    assert.ok(pill("Doubtful").classList.contains("is-bad"));
    assert.equal(text(pill("IR")), "IR");
    assert.equal(text(pill("Injured Reserve")), "IR");
    assert.ok(pill("IR").classList.contains("is-bad"));
    assert.match(pill("Out").getAttribute("href"), /\/jacoby-brissett\/injury\/$/);
  });

  test("rookies, surname particles and ownership rounding", () => {
    const rookie = header(state({ player: { ...state().player, years_exp: 0 } }));
    assert.ok(text(rookie.querySelector(".scp-pspec")).includes("Rookie"));

    const arsb = header(state({ player: { ...state().player, name: "Amon-Ra St. Brown" } }));
    assert.equal(text(arsb.querySelector(".scp-pbtn--dark")), "Should I start St. Brown in Week 4?");

    const owned = (value) =>
      text(header(state({ rosterPct: { owned: value } })).querySelector(".scp-pboard-stats > div:last-child dd"));
    assert.equal(owned(0.3), "<1%");
    assert.equal(owned(4.6), "5%");
    assert.equal(owned(99.6), "99%");
    assert.equal(owned(100), "100%");
  });

  test("a light club colour is replaced by one white text can sit on", () => {
    const luminance = (hex) => {
      const n = Number.parseInt(hex.slice(1), 16);
      const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
    };
    // Carolina: light primary AND light secondary.
    const ink = render.teamInk({ primaryColor: "#0085CA", secondaryColor: "#BFC0BF" });
    assert.notEqual(ink, "#0085CA");
    assert.ok(1.05 / (luminance(ink) + 0.05) >= 4.5, `${ink} passes AA against white`);
    // Cincinnati: the dark secondary is used as it is.
    assert.equal(render.teamInk({ primaryColor: "#FB4F14", secondaryColor: "#000000" }), "#000000");
    // Arizona: the primary already passes.
    assert.equal(render.teamInk(CARDINALS), "#97233F");
  });
});
