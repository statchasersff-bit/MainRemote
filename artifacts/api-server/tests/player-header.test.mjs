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

    assert.equal(text(h.querySelector(".scp-ptag-team-full")), "Arizona Cardinals");
    assert.equal(text(h.querySelector(".scp-ptag-team-abbr")), "ARI", "the narrow-phone spelling");
    assert.equal(h.querySelector(".scp-ptag-team").getAttribute("aria-label"), "Arizona Cardinals");
    assert.equal(
      text(h.querySelector(".scp-ptags")).replace("ARI", "").replace(/\s+/g, " "),
      "QB Arizona Cardinals #7",
    );
    assert.equal(text(h.querySelector(".scp-phead-name")), "Jacoby Brissett");
    // The profile's heading is the name alone (mak's entity brief, 2026-11-03).
    assert.equal(h.querySelector(".scp-phead-kind"), null, "no second line on the profile");
    assert.equal(text(h.querySelector(".scp-phead-h1")), "Jacoby Brissett");

    // One dotted line, no labels (mak, 2026-11-04); the readings survive
    // as tooltips.
    assert.equal(text(h.querySelector(".scp-pspec")), `33 yrs · 6'4", 235 · 11th season · 2016 R3 #91`);
    assert.equal(h.querySelector(".scp-pspec").tagName, "P");
    assert.deepEqual(
      [...h.querySelectorAll(".scp-pspec-i")].map((i) => i.getAttribute("title")),
      ["Age", "Height, weight (lb)", "Experience", "Drafted 2016, round 3, pick 91"],
    );
    assert.equal(h.querySelector(".scp-pspec dt"), null, "no labels");

    // The fantasy board: one dotted run in the navy card, beside the
    // identity under a caption that says it is fantasy (mak, 2026-11-04).
    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2026 Fantasy Season");
    assert.ok(h.querySelector(".scp-pboard-wrap > .scp-pboard-cap + .scp-pboard"));
    assert.ok(h.querySelector(".scp-pid + .scp-pboard-wrap"), "the board follows the identity column");
    assert.equal(h.querySelector(".scp-pid .scp-pboard"), null, "not inside it");
    assert.equal(text(h.querySelector(".scp-pboard-fan")), "16.5 PPG · QB17 · 13% rostered");
    assert.equal(h.querySelector(".scp-pline"), null, "no game log, no counting line");
    const fan = [...h.querySelectorAll(".scp-pboard-fan .scp-pstat")];
    assert.deepEqual(fan.map((c) => text(c.querySelector("b"))), ["16.5", "QB17", "13%"]);
    assert.ok(fan[0].classList.contains("is-lead"));
    assert.equal(fan[0].querySelector("abbr").getAttribute("title"), "PPR fantasy points per game");
    assert.equal(fan[1].querySelector("abbr"), null, "QB17 says what it is");

    assert.equal(
      text(h.querySelector(".scp-pstrip-mu")),
      "Week 4 at Giants, Sun Oct 4, 1:00 PM ET 8th vs. QBs, favorable",
    );
    assert.ok(h.querySelector(".scp-mchip").classList.contains("is-good"));

    const [start, redraft] = h.querySelectorAll(".scp-pbtn");
    assert.equal(text(start), "Should I start Brissett in Week 4?");
    assert.equal(start.getAttribute("data-cta"), "startsit-header-overview");
    assert.equal(text(redraft), "ROS Value in Fantasy");
    assert.equal(redraft.getAttribute("href"), "https://statchasers.com/redraft-command/?player=jacoby-brissett");
    assert.equal(redraft.getAttribute("data-cta"), "redraft-command-header-overview");

    assert.equal(h.querySelector(".scp-pwell-num").getAttribute("aria-hidden"), "true");
    const img = h.querySelector(".scp-pwell-img");
    assert.equal(img.getAttribute("alt"), "Jacoby Brissett headshot");
    assert.ok(img.getAttribute("width") && img.getAttribute("height"), "the photo reserves its box");

    // The dotted runs are the only middle dots: none in the tags, the
    // heading or the action strip.
    for (const zone of [".scp-ptags", ".scp-phead-h1", ".scp-pstrip"]) {
      assert.ok(!h.querySelector(zone).textContent.includes("·"), `no middle dots in ${zone}`);
    }
  });

  test("the heading's second line is the section's word, and the analytics tags follow the tab", () => {
    // The section H1s of mak's entity brief (2026-11-03): the name, then
    // the section's word, as one heading.
    const cases = {
      stats: "Stats",
      "game-log": "Game Log",
      outlook: "Fantasy Outlook",
      injury: "Injury Status",
      news: "News",
      bio: "Bio",
    };
    for (const [tab, kind] of Object.entries(cases)) {
      const h = header(state(), {}, tab);
      assert.equal(text(h.querySelector(".scp-phead-kind")), kind, tab);
      assert.equal(text(h.querySelector(".scp-phead-h1")), `Jacoby Brissett ${kind}`, `${tab}: one heading`);
      const cta = tab.replace("-", "");
      assert.equal(h.querySelector(".scp-pbtn--line").getAttribute("data-cta"), `redraft-command-header-${cta}`);
    }
    assert.equal(render.headerKind(state(), "overview"), "");
  });

  test("the heading is an H1 wherever the hero may own one", () => {
    assert.ok(header(state()).querySelector("h1.scp-phead-h1"), "standalone: H1");
    assert.ok(header(state(), { embed: true }).querySelector("h2.scp-phead-h1"), "plain embed: H2, the host prints the title");
    // When the tool supplies the heading, the hero's heading is the H1 (the
    // entity brief, 2026-11-03): no panel heading is promoted any more.
    assert.ok(
      header(state(), { embed: true, ownHeading: true }).querySelector("h1.scp-phead-h1"),
      "embedded, tool supplies the heading: H1",
    );
  });

  test("the college joins the bio line, and the strip's second group sums the log", () => {
    const log = [
      { week: 1, game_status: "active", stats: { pass_att: 30, pass_cmp: 20, pass_yd: 250, pass_td: 2, pass_int: 1 } },
      { week: 2, game_status: "active", stats: { pass_att: 35, pass_cmp: 22, pass_yd: 300, pass_td: 1, pass_int: 0 } },
      { week: 3, game_status: "inactive", stats: {} },
    ];
    const h = header(state({ gameLog: log, bioProfile: { draft: { year: 2016, round: 3, pick: 91 }, college: "NC State" }, statsUpdatedMs: Date.UTC(2026, 10, 2, 12) }));
    assert.equal(text(h.querySelector(".scp-pspec")), `33 yrs · 6'4", 235 · NC State · 11th season · 2016 R3 #91`);
    // The counting line is a second text line under the bio line, not part
    // of the board (mak, 2026-11-04); its suffix says how far the season has
    // run. The old "2026 season, through Week 3" caption and "Updated"
    // stamp are gone, the stamp surviving as the suffix's tooltip.
    assert.equal(text(h.querySelector(".scp-pboard-fan")), "16.5 PPG · QB17 · 13% rostered");
    assert.equal(text(h.querySelector(".scp-pline")), "42/65 cmp · 550 yds · 3 TD · 1 INT · thru Wk 3");
    assert.equal(h.querySelector(".scp-pline").tagName, "P");
    assert.equal(h.querySelector(".scp-pboard .scp-pline"), null, "not inside the navy board");
    const raw = [...h.querySelectorAll(".scp-pline .scp-pstat")].map((c) => [text(c.querySelector("b")), text(c.querySelector("abbr"))]);
    assert.deepEqual(raw, [["42/65", "cmp"], ["550", "yds"], ["3", "TD"], ["1", "INT"]]);
    assert.equal(h.querySelector(".scp-pline .scp-pstat abbr").getAttribute("title"), "Completions and attempts");
    assert.equal(h.querySelector(".scp-pline-thru").getAttribute("title"), "Updated Nov 2, 2026");
    assert.equal(h.querySelector(".scp-pline-wrap"), null);
    assert.equal(h.querySelector(".scp-pline-upd"), null);
    assert.ok(!h.textContent.includes("through Week"));
    assert.ok(!h.textContent.includes("Updated"));
    // The identity column reads: tags, name, bio line, counting line.
    const pid = h.querySelector(".scp-pid");
    assert.deepEqual([...pid.children].map((c) => c.className.split(" ")[0]), ["scp-ptags", "scp-phead-h1", "scp-pspec", "scp-pline"]);

    // No log: no counting line, and no suffix anywhere (the caption scopes the board).
    const none = header(state());
    assert.equal(none.querySelector(".scp-pline"), null);
    assert.equal(none.querySelector(".scp-pline-thru"), null);
    // A receiver reads rec, yds, TD, Y/R; a back car, yds, TD, rec.
    const wr = header(state({
      player: { ...state().player, position: "WR" },
      gameLog: [{ week: 1, game_status: "active", stats: { rec_tgt: 10, rec: 7, rec_yd: 91, rec_td: 1 } }],
    }));
    assert.equal(text(wr.querySelector(".scp-pline")), "7 rec · 91 yds · 1 TD · 13.0 Y/R · thru Wk 3");
    const rb = header(state({
      player: { ...state().player, position: "RB" },
      gameLog: [{ week: 1, game_status: "active", stats: { rush_att: 18, rush_yd: 80, rush_td: 1, rec: 3, rec_td: 1 } }],
    }));
    assert.equal(text(rb.querySelector(".scp-pline")), "18 car · 80 yds · 2 TD · 3 rec · thru Wk 3");
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
        // A written take, so the player has an Outlook tab for the button to open.
        fantasyOutlook2026: { season: 2026, body: "A take." },
        production: [{ season: 2025, posFinishPpg: 22, posFinishTotal: 20 }],
        stats: { gamesPlayed: 17, ppg: 14.2 },
      }),
    );
    // A finished season's figures: the caption names it.
    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2025 Fantasy Season");
    assert.equal(text(h.querySelector(".scp-pboard-fan")), "14.2 PPG · QB22 · 13% rostered");
    assert.equal(text(h.querySelector(".scp-pbtn--dark")), "See Brissett's 2026 outlook");
    assert.match(h.querySelector(".scp-pbtn--dark").getAttribute("href"), /\/jacoby-brissett\/outlook\/$/);
    assert.equal(h.querySelector(".scp-phead-kind"), null, "the profile's heading is the name alone");
  });

  test("before Week 1 with no Outlook tab, the button is not drawn", () => {
    // A record with nothing written and no drivers renders no tab, so the
    // header offers no way to a page that would only redirect back.
    const h = header(
      state({
        season: 2025,
        leagueWeek: 0,
        fantasyOutlook2026: { season: 2026 },
        production: [{ season: 2025, posFinishPpg: 22, posFinishTotal: 20 }],
        stats: { gamesPlayed: 17, ppg: 14.2 },
      }),
    );
    assert.equal(h.querySelector(".scp-pbtn--dark"), null);
    assert.equal(h.querySelector('a[href$="/outlook/"]'), null);
    assert.ok(h.querySelector(".scp-pbtn--line"), "the Redraft Command button stays");
  });

  test("no games played: dashes, never 0.0", () => {
    const h = header(state({ stats: { gamesPlayed: 0, ppg: 0 }, rosterPct: null }));
    const board = [...h.querySelectorAll(".scp-pboard-fan .scp-pstat b")].map(text);
    assert.deepEqual(board, ["-", "-", "-"]);
    // The dash cannot say what it stands for, so the rank's word comes back.
    assert.equal(text(h.querySelector(".scp-pboard-fan")), "- PPG · - rank · - rostered");
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
    // An injury record behind the designation, so the player has an Injury page.
    const pill = (status) =>
      header(state({ designation: { injuryStatus: status }, injury: { summary: { totalMissed: 0 } } })).querySelector(".scp-ptag-inj");
    assert.equal(text(pill("Questionable")), "Questionable");
    assert.ok(pill("Questionable").classList.contains("is-mid"));
    assert.ok(pill("Out").classList.contains("is-bad"));
    assert.ok(pill("Doubtful").classList.contains("is-bad"));
    assert.equal(text(pill("IR")), "IR");
    assert.equal(text(pill("Injured Reserve")), "IR");
    assert.ok(pill("IR").classList.contains("is-bad"));
    assert.match(pill("Out").getAttribute("href"), /\/jacoby-brissett\/injury\/$/);
  });

  test("a designation with no injury record is a pill, not a link", () => {
    // No Injury page to go to: /injury/ would only 302 back to the profile.
    const h = header(state({ designation: { injuryStatus: "Questionable" }, injury: null }));
    const pill = h.querySelector(".scp-ptag-inj");
    assert.equal(text(pill), "Questionable");
    assert.equal(pill.tagName, "SPAN");
    assert.equal(pill.getAttribute("href"), null);
    assert.equal(h.querySelector('a[href$="/injury/"]'), null, "nothing in the header links to the absent tab");
  });

  test("rookies, surname particles and ownership rounding", () => {
    const rookie = header(state({ player: { ...state().player, years_exp: 0 } }));
    assert.ok(text(rookie.querySelector(".scp-pspec")).includes("Rookie"));

    const arsb = header(state({ player: { ...state().player, name: "Amon-Ra St. Brown" } }));
    assert.equal(text(arsb.querySelector(".scp-pbtn--dark")), "Should I start St. Brown in Week 4?");

    const owned = (value) =>
      text(header(state({ rosterPct: { owned: value } })).querySelector(".scp-pboard-fan .scp-pstat:nth-child(3) b"));
    assert.equal(owned(0.3), "<1%");
    assert.equal(owned(4.6), "5%");
    assert.equal(owned(99.6), "99%");
    assert.equal(owned(100), "100%");
  });

  test("a light club color is replaced by one white text can sit on", () => {
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
