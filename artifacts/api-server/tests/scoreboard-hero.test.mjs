/**
 * The scoreboard hero, as a component: one game object in, one <header> out.
 *
 * These drive it with game objects directly rather than through a served page,
 * because the cases that matter most - overtime, a tie, a Super Bowl, a game in
 * progress - are exactly the ones ESPN will not happen to be serving on the day
 * the suite runs. The served page is covered in matchup.test.mjs.
 *
 * The Wild Card is the real line (ESPN event 401326625). The others are shape
 * fixtures: real clubs and venues, with quarters chosen to exercise a case.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const hero = await importModule("lib/matchup/scoreboard-hero");
after(() => cleanupBundles());

const WILD_CARD = {
  status: "final",
  seasonLabel: "2021",
  gameType: "playoff",
  roundLabel: "NFC Wild Card",
  kickoff: "2022-01-17T20:15:00-05:00",
  venue: { name: "SoFi Stadium", city: "Inglewood", state: "CA", neutral: false },
  away: { abbr: "ARI", name: "Arizona Cardinals", short: "Cardinals", quarters: [0, 0, 8, 3], ot: null },
  home: { abbr: "LAR", name: "Los Angeles Rams", short: "Rams", quarters: [7, 14, 7, 6], ot: null },
};

const OVERTIME = {
  status: "final",
  seasonLabel: "2021",
  gameType: "playoff",
  roundLabel: "AFC Divisional Round",
  kickoff: "2022-01-23T18:30:00-05:00",
  venue: { name: "GEHA Field at Arrowhead Stadium", city: "Kansas City", state: "MO", neutral: false },
  away: { abbr: "BUF", name: "Buffalo Bills", short: "Bills", quarters: [0, 7, 3, 26], ot: 0 },
  home: { abbr: "KC", name: "Kansas City Chiefs", short: "Chiefs", quarters: [3, 14, 0, 19], ot: 6 },
};

const TIE = {
  status: "final",
  seasonLabel: "2022",
  gameType: "regular",
  roundLabel: "Week 1",
  kickoff: "2022-09-11T13:00:00-04:00",
  venue: { name: "NRG Stadium", city: "Houston", state: "TX", neutral: false },
  away: { abbr: "IND", name: "Indianapolis Colts", short: "Colts", quarters: [0, 3, 0, 17], ot: 0 },
  home: { abbr: "HOU", name: "Houston Texans", short: "Texans", quarters: [7, 6, 7, 0], ot: 0 },
};

const UPCOMING = {
  status: "upcoming",
  seasonLabel: "2026",
  gameType: "regular",
  roundLabel: "Week 6",
  kickoff: "2026-10-18T16:25:00-04:00",
  venue: { name: "SoFi Stadium", city: "Inglewood", state: "CA", neutral: false },
  away: { abbr: "ARI", name: "Arizona Cardinals", short: "Cardinals", quarters: [], ot: null },
  home: { abbr: "LAR", name: "Los Angeles Rams", short: "Rams", quarters: [], ot: null },
};

const LIVE = {
  ...UPCOMING,
  status: "in_progress",
  away: { ...UPCOMING.away, quarters: [7, 3] },
  home: { ...UPCOMING.home, quarters: [0, 10] },
};

const SUPER_BOWL = {
  status: "final",
  seasonLabel: "2024",
  gameType: "playoff",
  roundLabel: "Super Bowl",
  kickoff: "2025-02-09T18:30:00-05:00",
  venue: { name: "Caesars Superdome", city: "New Orleans", state: "LA", neutral: true },
  away: { abbr: "KC", name: "Kansas City Chiefs", short: "Chiefs", quarters: [0, 0, 6, 16], ot: null },
  home: { abbr: "PHI", name: "Philadelphia Eagles", short: "Eagles", quarters: [7, 17, 10, 6], ot: null },
};

function render(game, options) {
  const html = hero.renderScoreboardHero(game, options);
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
}

const text = (node) => node?.textContent.replace(/\s+/g, " ").trim() ?? null;

describe("the Cardinals–Rams Wild Card", () => {
  const doc = render(WILD_CARD);
  const header = doc.querySelector("header.sct-sbh");

  test("is a header labeled by its one H1", () => {
    assert.ok(header);
    assert.equal(doc.querySelectorAll("h1").length, 1);
    const h1 = doc.querySelector("h1");
    assert.equal(header.getAttribute("aria-labelledby"), h1.id);
    assert.equal(text(h1), "Arizona Cardinals vs Los Angeles Rams, Wild Card 2021");
  });

  test("the meta bar: badge, round with its conference, venue, kickoff in Eastern", () => {
    assert.equal(text(doc.querySelector(".sct-sbh-badge")), "Final");
    assert.equal(text(doc.querySelector(".sct-sbh-round")), "2021 NFC Wild Card");
    assert.equal(text(doc.querySelector(".sct-sbh-venue")), "SoFi Stadium");
    assert.equal(
      [...doc.querySelector(".sct-sbh-meta-where").children].map(text).join(" "),
      "SoFi Stadium, Inglewood, CA | Mon, Jan 17, 2022, 8:15 PM ET",
    );
    const time = doc.querySelector("time");
    assert.equal(text(time), "Mon, Jan 17, 2022, 8:15 PM ET");
    assert.equal(time.getAttribute("datetime"), WILD_CARD.kickoff);
  });

  test("away on the left and home on the right, as the game object says", () => {
    const parts = (side) => [...side.querySelectorAll("p, p > span")].map(text);
    const [away, home] = doc.querySelectorAll(".sct-sbh-team");
    assert.ok(away.classList.contains("is-away"));
    assert.deepEqual(parts(away), ["Arizona Cardinals", "Arizona Cardinals", "Away", "Away", "11"]);
    assert.ok(home.classList.contains("is-home"));
    assert.deepEqual(parts(home), [
      "Los Angeles Rams",
      "Los Angeles Rams",
      "HomeWon, advanced",
      "Home",
      "Won, advanced",
      "34",
    ]);
  });

  test("the scores are the quarters summed, the winner decided from them", () => {
    const scores = [...doc.querySelectorAll(".sct-sbh-score")];
    assert.deepEqual(
      scores.map((s) => s.getAttribute("aria-label")),
      ["Cardinals 11", "Rams 34"],
    );
    assert.ok(doc.querySelector(".is-home").classList.contains("is-winner"));
    assert.ok(doc.querySelector(".is-away").classList.contains("is-loser"));
    assert.equal(doc.querySelector(".sct-sbh-vs").getAttribute("aria-hidden"), "true");
  });

  test("the quarter table is a real table, away first, winner's final marked", () => {
    const table = doc.querySelector("table");
    assert.equal(text(table.querySelector("caption")), "Scoring by quarter");
    assert.deepEqual(
      [...table.querySelectorAll("thead th")].map(text),
      ["Team", "Q1", "Q2", "Q3", "Q4", "Final"],
    );
    const rows = [...table.querySelectorAll("tbody tr")];
    assert.deepEqual(
      rows.map((r) => [...r.children].map(text)),
      [
        ["Cardinals", "0", "0", "8", "3", "11"],
        ["Rams", "7", "14", "7", "6", "34"],
      ],
    );
    assert.equal(rows[0].querySelector("th").getAttribute("scope"), "row");
    assert.ok(rows[1].classList.contains("is-winner"));
  });

  test("the title and the structured data come from the same object", () => {
    assert.equal(
      hero.scoreboardTitleCandidates(WILD_CARD)[0],
      "Cardinals vs Rams Player Stats & Box Score, Wild Card 2021",
    );
    const event = hero.scoreboardSportsEvent(WILD_CARD);
    assert.equal(event["@type"], "SportsEvent");
    assert.equal(event.startDate, WILD_CARD.kickoff);
    assert.equal(event.homeTeam.name, "Los Angeles Rams");
    assert.equal(event.awayTeam.name, "Arizona Cardinals");
    assert.equal(event.location["@type"], "StadiumOrArena");
    assert.equal(event.location.address["@type"], "PostalAddress");
    assert.equal(event.location.address.addressLocality, "Inglewood");
    assert.equal(event.description, "Final: Los Angeles Rams 34, Arizona Cardinals 11.");
  });

  test("with no logoUrl there is no image; with one, a 48px crest named for the team", () => {
    assert.equal(doc.querySelectorAll("img").length, 0);
    const withLogo = render({
      ...WILD_CARD,
      away: { ...WILD_CARD.away, logoUrl: "https://example.test/ari.png" },
    });
    const img = withLogo.querySelector(".is-away img");
    assert.equal(img.getAttribute("alt"), "Arizona Cardinals");
    assert.equal(img.getAttribute("width"), "48");
    assert.equal(withLogo.querySelectorAll("img").length, 1);
  });
});

describe("overtime", () => {
  const doc = render(OVERTIME);

  test("adds an OT column and says so on the badge", () => {
    assert.equal(text(doc.querySelector(".sct-sbh-badge")), "Final/OT");
    assert.deepEqual(
      [...doc.querySelectorAll("thead th")].map(text),
      ["Team", "Q1", "Q2", "Q3", "Q4", "OT", "Final"],
    );
    assert.deepEqual(
      [...doc.querySelectorAll("tbody tr")].map((r) => [...r.children].map(text)),
      [
        ["Bills", "0", "7", "3", "26", "0", "36"],
        ["Chiefs", "3", "14", "0", "19", "6", "42"],
      ],
    );
  });

  test("counts the overtime points in the total", () => {
    assert.equal(doc.querySelector(".is-home .sct-sbh-score").textContent, "42");
    assert.equal(text(doc.querySelector(".sct-sbh-tag")), "Won, advanced");
  });
});

describe("a tie", () => {
  const doc = render(TIE);

  test("has no winner, no gold tag, and says tie", () => {
    assert.equal(text(doc.querySelector(".sct-sbh-badge")), "Final/OT, tie");
    assert.equal(doc.querySelectorAll(".is-winner, .is-loser, .sct-sbh-tag").length, 0);
    assert.ok(doc.querySelector("header").classList.contains("is-tie"));
    assert.deepEqual(
      [...doc.querySelectorAll(".sct-sbh-score")].map((s) => s.textContent),
      ["20", "20"],
    );
  });

  test("a regular-season H1 names the week", () => {
    assert.equal(text(doc.querySelector("h1")), "Indianapolis Colts vs Houston Texans, Week 1 2022");
  });
});

describe("an upcoming game", () => {
  const doc = render(UPCOMING);

  test("keeps the same H1 it will have when final", () => {
    assert.equal(text(doc.querySelector("h1")), "Arizona Cardinals vs Los Angeles Rams, Week 6 2026");
    const final = render({
      ...UPCOMING,
      status: "final",
      away: { ...UPCOMING.away, quarters: [7, 7, 0, 3] },
      home: { ...UPCOMING.home, quarters: [0, 7, 7, 0] },
    });
    assert.equal(text(final.querySelector("h1")), text(doc.querySelector("h1")));
  });

  test("has no scores and no table, and shows the kickoff large instead", () => {
    assert.equal(text(doc.querySelector(".sct-sbh-badge")), "Upcoming");
    assert.equal(doc.querySelectorAll(".sct-sbh-score, table").length, 0);
    assert.equal(text(doc.querySelector(".sct-sbh-kickoff-date")), "Sun, Oct 18, 2026");
    assert.equal(text(doc.querySelector(".sct-sbh-kickoff-time")), "4:25 PM ET");
  });

  test("the title carries no score, played or not", () => {
    const [first] = hero.scoreboardTitleCandidates(UPCOMING);
    assert.equal(first, "Cardinals vs Rams Player Stats & Box Score, Week 6 2026");
  });
});

describe("a game in progress", () => {
  const doc = render(LIVE);

  test("is Live, with the quarters so far and dashes for the rest", () => {
    assert.equal(text(doc.querySelector(".sct-sbh-badge")), "Live");
    assert.deepEqual(
      [...doc.querySelectorAll("tbody tr")].map((r) => [...r.children].map(text)),
      [
        ["Cardinals", "7", "3", "–", "–", "10"],
        ["Rams", "0", "10", "–", "–", "10"],
      ],
    );
    assert.equal(doc.querySelectorAll(".is-winner, .sct-sbh-tag").length, 0);
  });
});

describe("a Super Bowl", () => {
  const doc = render(SUPER_BOWL);

  test("at a neutral site has no Away or Home labels", () => {
    assert.equal(doc.querySelectorAll(".sct-sbh-label > span:not(.sct-sbh-tag)").length, 0);
    assert.doesNotMatch(doc.querySelector(".sct-sbh-board").textContent, /Away|Home/);
  });

  test("the winner's tag names the game", () => {
    assert.equal(text(doc.querySelector(".is-winner .sct-sbh-tag")), "Won Super Bowl");
    assert.equal(text(doc.querySelector(".sct-sbh-round")), "2024 Super Bowl");
    assert.equal(text(doc.querySelector("h1")), "Kansas City Chiefs vs Philadelphia Eagles, Super Bowl 2024");
  });
});

describe("the team colors", () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  test("all 32 clubs are in the map, Arizona and the Rams as specified", () => {
    assert.equal(Object.keys(hero.teamColors).length, 32);
    assert.equal(hero.teamColors.ARI.primary, "#97233F");
    assert.equal(hero.teamColors.LAR.primary, "#003594");
  });

  test("every side a club can be painted passes AA with white text", () => {
    for (const abbr of Object.keys(hero.teamColors)) {
      const color = hero.heroSideColor(abbr);
      // As laid: 90% over the navy.
      const navy = [0x0f, 0x1e, 0x33];
      const laid =
        "#" +
        [1, 3, 5]
          .map((i, k) =>
            Math.round(parseInt(color.slice(i, i + 2), 16) * 0.9 + navy[k] * 0.1)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
      const contrast = 1.05 / (luminance(laid) + 0.05);
      assert.ok(contrast >= 4.5, `${abbr} ${color}: ${contrast.toFixed(2)}`);
    }
  });

  test("a primary too pale for white text gives way to the secondary", () => {
    // Cincinnati's orange fails; its black does not.
    assert.equal(hero.heroSideColor("CIN"), hero.teamColors.CIN.secondary);
  });

  test("every club's text color and tile fill pass AA against white", () => {
    for (const abbr of Object.keys(hero.teamColors)) {
      const ink = hero.teamInk(abbr);
      const fill = hero.teamFill(abbr);
      assert.ok(hero.contrastRatio(ink, "#FFFFFF") >= 4.5, `${abbr} ink ${ink}`);
      assert.ok(hero.contrastRatio(ink, "#F5F7FA") >= 4.5, `${abbr} ink on paper ${ink}`);
      assert.ok(hero.contrastRatio(fill, "#FFFFFF") >= 4.5, `${abbr} fill ${fill}`);
    }
    assert.equal(hero.teamInk("ARI"), "#97233F");
    assert.equal(hero.teamInk("LAR"), "#003594");
  });

  test("two clubs that share a primary are still told apart, and still readable", () => {
    for (const [away, home] of [["NE", "SEA"], ["LV", "PIT"], ["NO", "LV"], ["ARI", "LAR"]]) {
      const c = hero.pairColors(away, home);
      assert.ok(!hero.tooClose(c.away.ink, c.home.ink), `${away}/${home}: ${c.away.ink} vs ${c.home.ink}`);
      for (const side of [c.away, c.home]) {
        assert.ok(hero.contrastRatio(side.ink, "#F5F7FA") >= 4.5);
        assert.ok(hero.contrastRatio(side.fill, "#FFFFFF") >= 4.5);
      }
    }
    assert.deepEqual(hero.pairColors("ARI", "LAR").home.ink, "#003594", "distinct pairs keep their primaries");
  });

  test("an unknown club falls back to #1E3A5F", () => {
    assert.equal(hero.heroSideColor("XXX"), "#1E3A5F");
  });
});
