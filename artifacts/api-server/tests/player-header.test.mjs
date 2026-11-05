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

function header(data, options = {}, tab, extras) {
  const html = render.renderHero(data, options, tab, extras);
  return new JSDOM(`<body>${html}</body>`).window.document.querySelector("header");
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

describe("player header", () => {
  test("the reference state: the panel, the tags, the heading, the bio line, the board, the cards, the actions, the strip", () => {
    const h = header(state());
    assert.equal(h.getAttribute("aria-label"), "Player summary");
    assert.match(h.getAttribute("style"), /--scp-team:#97233F/);
    assert.match(h.getAttribute("style"), /--scp-team-2:#FFB612/);

    // The portrait panel: the club's color, the number in outline, the photo.
    const well = h.querySelector(".scp-pwell");
    assert.ok(well.hasAttribute("data-scp-pwell"), "the client's hook for a failed photo");
    assert.equal(text(well.querySelector(".scp-pwell-num")), "7");
    assert.equal(well.querySelector(".scp-pwell-num").getAttribute("aria-hidden"), "true");
    assert.ok(well.querySelector(".scp-pwell-sil"), "the silhouette is under the photo");

    // The tags: position pill, the club (narrow-phone spelling alongside), no status without a classification.
    assert.equal(text(h.querySelector(".scp-ptag-pos")), "QB");
    assert.equal(text(h.querySelector(".scp-ptag-team-full")), "Arizona Cardinals");
    assert.equal(text(h.querySelector(".scp-ptag-team-abbr")), "ARI", "the narrow-phone spelling");
    assert.equal(h.querySelector(".scp-ptag-team").getAttribute("aria-label"), "Arizona Cardinals");
    assert.equal(h.querySelector(".scp-ptag-team").getAttribute("href"), "/team/arizona-cardinals/");
    assert.equal(h.querySelector(".scp-ptag-inj"), null);
    assert.equal(h.querySelector(".scp-ptag-status"), null, "never Active by default");

    // The heading: the name alone on the profile (mak's entity brief, 2026-11-03).
    assert.equal(text(h.querySelector(".scp-phead-name")), "Jacoby Brissett");
    assert.equal(h.querySelector(".scp-phead-kind"), null, "no second line on the profile");
    assert.equal(text(h.querySelector(".scp-phead-h1")), "Jacoby Brissett");
    assert.equal(text(h.querySelector(".scp-pp-under")), "#7 Quarterback");

    // One bio line, no labels; the readings survive as tooltips.
    assert.deepEqual([...h.querySelectorAll(".scp-pspec-i")].map(text), ["33 yrs", "6'4\", 235 lbs", "11th Season", "2016 R3, P91"]);
    assert.deepEqual(
      [...h.querySelectorAll(".scp-pspec-i")].map((i) => i.getAttribute("title")),
      ["Age", "Height, weight (lb)", "Experience", "Drafted 2016, round 3, pick 91"],
    );
    // The identity column reads: tags, heading, number and position, bio line.
    assert.deepEqual([...h.querySelector(".scp-pid").children].map((c) => c.className.split(" ")[0]), ["scp-ptags", "scp-phead-h1", "scp-pp-under", "scp-pspec"]);

    // The fantasy board: the trio under a caption that says it is fantasy, the rate leading.
    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2026 Fantasy Season");
    assert.ok(h.querySelector(".scp-pboard-wrap > .scp-pboard-cap + .scp-pboard"));
    assert.ok(h.querySelector(".scp-pid + .scp-pboard-wrap"), "the board follows the identity column");
    const fan = [...h.querySelectorAll(".scp-pboard .scp-pstat")];
    assert.deepEqual(fan.map((c) => text(c.querySelector("b"))), ["16.5", "QB17", "13%"]);
    assert.deepEqual(fan.map((c) => text(c.querySelector("abbr"))), ["FPPG · PPR", "POS RANK", "ROSTERED"]);
    assert.ok(fan[0].classList.contains("is-lead"));
    assert.equal(fan[0].querySelector("abbr").getAttribute("title"), "PPR fantasy points per game");
    assert.equal(fan[2].querySelector("abbr").getAttribute("title"), "Share of redraft leagues where he is rostered");
    assert.equal(h.querySelector(".scp-pp-cards"), null, "no game log, no stat cards");

    // The actions: Redraft Command in gold, the start/sit question in white.
    const [redraft, start] = h.querySelectorAll(".scp-pbtn");
    assert.ok(redraft.classList.contains("scp-pbtn--gold"));
    assert.equal(text(redraft), "View in Redraft Command");
    assert.equal(redraft.getAttribute("href"), "https://statchasers.com/redraft-command/?player=jacoby-brissett");
    assert.equal(redraft.getAttribute("data-cta"), "redraft-command-header-overview");
    assert.equal(redraft.getAttribute("data-scp-cta"), "redraft-command-header");
    assert.ok(start.classList.contains("scp-pbtn--white"));
    assert.equal(text(start), "Should I start Brissett?");
    assert.equal(start.getAttribute("data-cta"), "startsit-header-overview");
    assert.match(start.getAttribute("href"), /who-should-i-start\/jacoby-brissett$/);

    // The strip: the next fixture by its club's full name, the kickoff, the chip, the matchup page.
    const strip = h.querySelector(".scp-pstrip");
    assert.equal(text(strip.querySelector(".scp-pstrip-cap")), "Next matchup");
    assert.equal(text(strip.querySelector(".scp-pstrip-mu")), "Week 4 at New York Giants");
    assert.equal(text(strip.querySelector(".scp-pstrip-when")), "Sun Oct 4, 1:00 PM ET");
    assert.equal(text(strip.querySelector(".scp-mchip")), "8th vs. QBs, favorable");
    assert.ok(strip.querySelector(".scp-mchip").classList.contains("is-good"));
    assert.equal(strip.querySelector(".scp-pstrip-link"), null, "no matchup page handed in, no link");
    const linked = header(state(), {}, "overview", { matchupHref: "/nfl/cardinals-vs-giants/" });
    assert.equal(linked.querySelector(".scp-pstrip-link").getAttribute("href"), "/nfl/cardinals-vs-giants/");

    // No middle dots in the tags, the heading or the strip; the board's
    // labels are the one place ("FPPG · PPR").
    for (const zone of [".scp-ptags", ".scp-phead-h1", ".scp-pstrip"]) {
      assert.ok(!h.querySelector(zone).textContent.includes("·"), `no middle dots in ${zone}`);
    }
    assert.doesNotMatch(h.outerHTML, /—/, "no em dashes");
    assert.equal(h.querySelector(".scp-phead-hero").getAttribute("aria-label"), "Jacoby Brissett summary");
  });

  test("the heading's second line is the section's word, and the analytics tags follow the tab", () => {
    // The section H1s of mak's entity brief (2026-11-03): the name, then
    // the section's word, as one heading.
    const cases = {
      stats: "Stats",
      "game-log": "Game Log",
      outlook: "2026 Fantasy Outlook",
      injury: "Injury Status",
      news: "News",
      bio: "Bio",
    };
    for (const [tab, kind] of Object.entries(cases)) {
      const h = header(state(), {}, tab);
      assert.equal(text(h.querySelector(".scp-phead-kind")), kind, tab);
      assert.equal(text(h.querySelector(".scp-phead-h1")), `Jacoby Brissett ${kind}`, `${tab}: one heading`);
      const cta = tab.replace("-", "");
      assert.equal(h.querySelector(".scp-pbtn--gold").getAttribute("data-cta"), `redraft-command-header-${cta}`);
      assert.equal(h.querySelector(".scp-pbtn--white").getAttribute("data-cta"), `startsit-header-${cta}`);
    }
    assert.equal(render.headerKind(state(), "overview"), "");
  });

  test("the heading is an H1 wherever the hero may own one", () => {
    assert.ok(header(state()).querySelector("h1.scp-phead-h1"), "standalone: H1");
    assert.ok(header(state(), { embed: true }).querySelector("h2.scp-phead-h1"), "plain embed: H2, the host prints the title");
    assert.ok(header(state(), { embed: true, ownHeading: true }).querySelector("h1.scp-phead-h1"), "embedded, tool supplies the heading: H1");
    assert.equal(header(state()).querySelectorAll("h1").length, 1);
  });

  test("the college joins the bio line, and the stat cards sum the log, yards first", () => {
    const log = [
      { week: 1, game_status: "active", stats: { pass_att: 130, pass_cmp: 20, pass_yd: 250, pass_td: 2, pass_int: 1 } },
      { week: 2, game_status: "active", stats: { pass_att: 105, pass_cmp: 22, pass_yd: 300, pass_td: 1, pass_int: 0 } },
      { week: 3, game_status: "inactive", stats: {} },
    ];
    const h = header(state({ gameLog: log, bioProfile: { draft: { year: 2016, round: 3, pick: 91 }, college: "NC State" } }));
    assert.deepEqual([...h.querySelectorAll(".scp-pspec-i")].map(text), ["33 yrs", "6'4\", 235 lbs", "NC State", "11th Season", "2016 R3, P91"]);
    const cards = [...h.querySelectorAll(".scp-pp-card")];
    assert.deepEqual(cards.map((c) => [text(c.querySelector(".scp-pp-card-v")), text(c.querySelector(".scp-pp-card-l"))]), [
      ["550", "PASS YDS"],
      ["42/235", "CMP / ATT"],
      ["3", "PASS TD"],
      ["1", "INT"],
    ]);
    assert.equal(cards[0].getAttribute("title"), "Passing yards");
    assert.ok(cards[1].querySelector(".scp-pp-card-v").classList.contains("is-long"), "a two-figure value past five characters is set smaller");
    assert.ok(!cards[0].querySelector(".scp-pp-card-v").classList.contains("is-long"));
    assert.ok(!h.textContent.includes("through Week") && !h.textContent.includes("Updated"));

    // A receiver reads yards, receptions, TD, Y/R; a back yards, carries, TD, receptions.
    const wr = header(state({
      player: { ...state().player, position: "WR" },
      gameLog: [{ week: 1, game_status: "active", stats: { rec_tgt: 10, rec: 7, rec_yd: 91, rec_td: 1 } }],
    }));
    assert.deepEqual([...wr.querySelectorAll(".scp-pp-card-l")].map(text), ["REC YDS", "REC", "REC TD", "YPR"]);
    assert.deepEqual([...wr.querySelectorAll(".scp-pp-card-v")].map(text), ["91", "7", "1", "13.0"]);
    const rb = header(state({
      player: { ...state().player, position: "RB" },
      gameLog: [{ week: 1, game_status: "active", stats: { rush_att: 18, rush_yd: 80, rush_td: 1, rec: 3, rec_td: 1 } }],
    }));
    assert.deepEqual([...rb.querySelectorAll(".scp-pp-card-l")].map(text), ["RUSH YDS", "CARRIES", "TOTAL TD", "REC"]);
    assert.deepEqual([...rb.querySelectorAll(".scp-pp-card-v")].map(text), ["80", "18", "2", "3"]);
  });

  test("a bye next: the strip says so and the button still asks the question", () => {
    const next = { ...state().upcoming[0], week: 5 };
    const h = header(state({ byeWeek: 4, upcoming: [next] }));
    assert.equal(text(h.querySelector(".scp-pstrip-mu")), "Week 4: bye. Then Week 5 at New York Giants");
    assert.equal(text(h.querySelector(".scp-pbtn--white")), "Should I start Brissett?");
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

  test("before Week 1: last season final, and the second button is the outlook", () => {
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
    assert.equal(text(h.querySelector(".scp-pboard-cap")), "2025 Fantasy Season");
    assert.deepEqual([...h.querySelectorAll(".scp-pboard .scp-pstat b")].map(text), ["14.2", "QB22", "13%"]);
    assert.equal(text(h.querySelector(".scp-pbtn--white")), "Brissett's 2026 outlook");
    assert.match(h.querySelector(".scp-pbtn--white").getAttribute("href"), /\/jacoby-brissett\/outlook\/$/);
    assert.equal(h.querySelector(".scp-pbtn--white").getAttribute("data-cta"), "outlook-header-overview");
    assert.equal(h.querySelector(".scp-phead-kind"), null, "the profile's heading is the name alone");
  });

  test("before Week 1 with no Outlook tab, the second button is not drawn", () => {
    const h = header(
      state({
        season: 2025,
        leagueWeek: 0,
        fantasyOutlook2026: { season: 2026 },
        production: [{ season: 2025, posFinishPpg: 22, posFinishTotal: 20 }],
        stats: { gamesPlayed: 17, ppg: 14.2 },
      }),
    );
    assert.equal(h.querySelector(".scp-pbtn--white"), null);
    assert.equal(h.querySelector('a[href$="/outlook/"]'), null);
    assert.ok(h.querySelector(".scp-pbtn--gold"), "the Redraft Command button stays");
  });

  test("no games played: dashes, never 0.0", () => {
    const h = header(state({ stats: { gamesPlayed: 0, ppg: 0 }, rosterPct: null }));
    assert.deepEqual([...h.querySelectorAll(".scp-pboard .scp-pstat b")].map(text), ["-", "-", "-"]);
    assert.deepEqual([...h.querySelectorAll(".scp-pboard .scp-pstat abbr")].map(text), ["FPPG · PPR", "POS RANK", "ROSTERED"], "the labels still say what each dash stands for");
  });

  test("no number: no watermark", () => {
    const h = header(state({ player: { ...state().player, number: null } }));
    assert.equal(h.querySelector(".scp-pwell-num"), null);
    assert.equal(text(h.querySelector(".scp-pp-under")), "Quarterback");
  });

  test("a free agent: the stylesheet's ink, no link, no strip, the Redraft Command button alone", () => {
    const h = header(state({ team: null, upcoming: [] }));
    assert.equal(h.getAttribute("style"), null, "the stylesheet's default ink answers");
    const team = h.querySelector(".scp-ptag-team");
    assert.equal(team.tagName, "SPAN");
    assert.equal(text(team), "Free agent");
    assert.equal(h.querySelector(".scp-pstrip"), null);
    assert.equal(h.querySelector(".scp-pbtn--white"), null, "no club, no week to start him in");
    assert.ok(h.querySelector(".scp-pbtn--gold"));
    const classed = header(state({ team: null, upcoming: [], bioPage: { status: "free-agent" } }));
    assert.equal(text(classed.querySelector(".scp-ptag-status")), "Free Agent");
    assert.ok(classed.querySelector(".scp-ptag-status").classList.contains("is-none"));
  });

  test("the roster status pill comes from the bio pipeline's classification", () => {
    const active = header(state({ bioPage: { status: "active" } }));
    assert.equal(text(active.querySelector(".scp-ptag-status")), "Active");
    assert.ok(active.querySelector(".scp-ptag-status").classList.contains("is-good"));
    assert.equal(active.querySelector(".scp-ptag-inj"), null);
    const former = header(state({ bioPage: { status: "former" } }));
    assert.equal(text(former.querySelector(".scp-ptag-status")), "Former");
  });

  test("a designation is a pill linking to the Injury tab, and outranks the roster status", () => {
    // An injury record behind the designation, so the player has an Injury page.
    const pill = (status) =>
      header(state({ designation: { injuryStatus: status }, injury: { summary: { totalMissed: 0 } }, bioPage: { status: "active" } })).querySelector(".scp-ptag-inj");
    assert.equal(text(pill("Questionable")), "Questionable");
    assert.ok(pill("Questionable").classList.contains("is-mid"));
    assert.ok(pill("Out").classList.contains("is-bad"));
    assert.ok(pill("Doubtful").classList.contains("is-bad"));
    assert.equal(text(pill("IR")), "IR");
    assert.equal(text(pill("Injured Reserve")), "IR");
    assert.ok(pill("IR").classList.contains("is-bad"));
    assert.match(pill("Out").getAttribute("href"), /\/jacoby-brissett\/injury\/$/);
    const h = header(state({ designation: { injuryStatus: "Out" }, injury: { summary: { totalMissed: 0 } }, bioPage: { status: "active" } }));
    assert.equal(h.querySelector(".scp-ptag-status"), null, "no Active beside an Out");
  });

  test("a designation with no injury record is a pill, not a link", () => {
    const h = header(state({ designation: { injuryStatus: "Questionable" }, injury: null }));
    const pill = h.querySelector(".scp-ptag-inj");
    assert.equal(text(pill), "Questionable");
    assert.equal(pill.tagName, "SPAN");
    assert.equal(pill.getAttribute("href"), null);
    assert.equal(h.querySelector('a[href$="/injury/"]'), null, "nothing in the header links to the absent tab");
  });

  test("rookies, surname particles and ownership rounding", () => {
    const rookie = header(state({ player: { ...state().player, years_exp: 0 } }));
    assert.ok([...rookie.querySelectorAll(".scp-pspec-i")].map(text).includes("Rookie"));

    const arsb = header(state({ player: { ...state().player, name: "Amon-Ra St. Brown" } }));
    assert.equal(text(arsb.querySelector(".scp-pbtn--white")), "Should I start St. Brown?");

    const owned = (value) =>
      text(header(state({ rosterPct: { owned: value } })).querySelector(".scp-pboard .scp-pstat:nth-child(3) b"));
    assert.equal(owned(0.3), "<1%");
    assert.equal(owned(4.6), "5%");
    assert.equal(owned(99.6), "99%");
    assert.equal(owned(100), "100%");
  });

  test("the photo: the f200 derivative as src, f350 for the 300px slot, eager and at high priority", () => {
    const img = header(state({ player: { ...state().player, headshotUrl: "https://sleepercdn.com/content/nfl/players/thumb/123.jpg" } })).querySelector(".scp-pwell-img");
    assert.ok(img, "a photo");
    assert.equal(img.getAttribute("alt"), "Jacoby Brissett headshot");
    assert.ok(img.getAttribute("width") && img.getAttribute("height"), "the photo reserves its box");
    assert.equal(img.getAttribute("loading"), "eager");
    assert.equal(img.getAttribute("fetchpriority"), "high");
    assert.equal(img.getAttribute("data-no-lazy"), "1");
    // A player the image pipeline knows by id gets a photo without a source
    // URL; the silhouette is in the markup under it either way.
    assert.ok(header(state()).querySelector(".scp-pwell .scp-pwell-sil"));
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
