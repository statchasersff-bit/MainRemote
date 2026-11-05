/**
 * The RotoWire wire: parsing a team page into the archive's item shape.
 *
 * No network. The markup is a byte-for-byte trim of what
 * rotowire.com/football/news.php?team=NYG served on 2026-11-05: one note
 * with an injury tag and an inline reporter link, one without.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const parse = await importModule("lib/rotowire-parse");
const { TEAMS } = await importModule("lib/team/teams");
const { newsDedupeKey } = await importModule("lib/news-item");

after(cleanupBundles);

const PAGE = `
<div class="news-update is-injured">
<div class="news-update__top">
<img class="news-update__logo" src="https://assets.rotowire.com/images/teamlogo/football/NYG.svg?v=12" alt="NYG">
<div class="news-update__playerhead"><a class="news-update__player-link" href="/football/player/malik-nabers-17704">Malik Nabers</a><a target="_blank" class="news-update__headline" href="/football/headlines/malik-nabers-injury-offers-positive-update-646072">Offers positive update</a></div>
</div>
<div class="news-update__meta"><div><b class="news-update__pos">WR</b>New York Giants</div><div class="news-update__inj">Undisclosed</div></div>
<div class="news-update__main">
<div class="news-update__timestamp">November 5, 2026</div>
<div class="news-update__news">Nabers (undisclosed) said Thursday, &quot;I'll be good,&quot; for Sunday's game at Philadelphia, <a href="https://x.com/art_stapleton/status/2118439319991992772">Art Stapleton of USA Today</a> reports.</div>
<div class="news-update__analysis"><b>ANALYSIS</b><br><a href="/subscribe/">Subscribe now</a> to instantly reveal our take on this news.</div>
</div>
</div><div class="news-update">
<div class="news-update__top">
<img class="news-update__logo" src="https://assets.rotowire.com/images/teamlogo/football/NYG.svg?v=12" alt="NYG">
<div class="news-update__playerhead"><a class="news-update__player-link" href="/football/player/aaron-rodgers-4307">Aaron Rodgers</a><a target="_blank" class="news-update__headline" href="/football/headlines/aaron-rodgers-wont-play-in-second-preseason-game-634220">Won&#39;t play in second preseason game</a></div>
</div>
<div class="news-update__meta"><div><b class="news-update__pos">QB</b>Pittsburgh Steelers</div></div>
<div class="news-update__main">
<div class="news-update__timestamp">August 19, 2026</div>
<div class="news-update__news">Rodgers will sit out Saturday's game.</div>
<div class="news-update__analysis"><b>ANALYSIS</b><br>Hidden.</div>
</div>
</div>
`;

describe("team page parsing", () => {
  test("every note, in page order, with its fields", () => {
    const notes = parse.parseRotowirePage(PAGE);
    assert.equal(notes.length, 2);

    const [nabers, rodgers] = notes;
    assert.equal(nabers.noteId, "646072");
    assert.equal(nabers.playerName, "Malik Nabers");
    assert.equal(nabers.playerSlug, "malik-nabers-17704");
    assert.equal(nabers.headline, "Offers positive update");
    assert.equal(nabers.headlineUrl, "https://www.rotowire.com/football/headlines/malik-nabers-injury-offers-positive-update-646072");
    assert.equal(nabers.teamCode, "NYG");
    assert.equal(nabers.position, "WR");
    assert.equal(nabers.injury, "Undisclosed");
    assert.equal(nabers.dateText, "November 5, 2026");

    assert.equal(rodgers.noteId, "634220");
    assert.equal(rodgers.injury, null);
    assert.equal(rodgers.position, "QB");
  });

  test("the blurb loses its tags and decodes its entities; the analysis is not read", () => {
    const [nabers, rodgers] = parse.parseRotowirePage(PAGE);
    assert.equal(
      nabers.news,
      `Nabers (undisclosed) said Thursday, "I'll be good," for Sunday's game at Philadelphia, Art Stapleton of USA Today reports.`,
    );
    assert.equal(rodgers.headline, "Won't play in second preseason game");
    assert.ok(!JSON.stringify(nabers).includes("Subscribe"));
  });

  test("a block without a headline id or a player is skipped, not guessed", () => {
    const broken = PAGE.replace('href="/football/headlines/malik-nabers-injury-offers-positive-update-646072"', 'href="/football/headlines/"');
    assert.equal(parse.parseRotowirePage(broken).length, 1);
    assert.equal(parse.parseRotowirePage("<html><body>nothing here</body></html>").length, 0);
  });
});

describe("the archive's item", () => {
  test("carries the relay's id and title, so the same story is the same row", () => {
    const [nabers] = parse.parseRotowirePage(PAGE);
    const item = parse.rotowireItem(nabers, "2026-11-05T20:30:17.000Z", "https://sleepercdn.com/content/nfl/players/thumb/11631.jpg");
    assert.equal(item.id, "rotowire:nfl646072");
    assert.equal(item.title, "Malik Nabers: Offers positive update");
    assert.equal(item.playerName, "Malik Nabers");
    assert.equal(item.pubDate, "2026-11-05T20:30:17.000Z");
    assert.equal(item.link, nabers.headlineUrl);
    assert.equal(item.image, "https://sleepercdn.com/content/nfl/players/thumb/11631.jpg");
    assert.match(item.summary, /^Nabers \(undisclosed\)/);
    // The relay stored this story under its title; the sweep's key is the same.
    assert.equal(
      newsDedupeKey({ title: item.title, id: item.id }),
      newsDedupeKey({ title: "Malik Nabers: Offers positive update", id: "rotowire:nfl646072" }),
    );
  });

  test("no picture and no summary when there is none", () => {
    const [, rodgers] = parse.parseRotowirePage(PAGE);
    const item = parse.rotowireItem({ ...rodgers, news: "" }, "2026-08-19T17:00:00.000Z", null);
    assert.equal("image" in item, false);
    assert.equal("summary" in item, false);
  });
});

describe("times", () => {
  test("the headline page's datePublished, or the data layer's copy", () => {
    assert.equal(
      parse.parseHeadlineTime('<script>{"datePublished":"2026-11-05T12:30:17-08:00"}</script>'),
      "2026-11-05T20:30:17.000Z",
    );
    assert.equal(
      parse.parseHeadlineTime('dataLayer.push({"article_publish_date":"2026-11-05T12:30:17-08:00"})'),
      "2026-11-05T20:30:17.000Z",
    );
    assert.equal(parse.parseHeadlineTime("<html></html>"), null);
    assert.equal(parse.parseHeadlineTime('{"datePublished":"not a date"}'), null);
  });

  test("a page date alone becomes noon Eastern on that day", () => {
    assert.equal(parse.noonEasternOf("November 5, 2026"), "2026-11-05T17:00:00.000Z");
    assert.equal(parse.noonEasternOf("not a date"), null);
  });
});

describe("team pages", () => {
  test("every club has a page", () => {
    assert.equal(TEAMS.length, 32);
    const urls = new Set(TEAMS.map((t) => parse.rotowireTeamUrl(t)));
    assert.equal(urls.size, 32);
    assert.equal(parse.rotowireTeamUrl({ abbreviation: "pit" }), "https://www.rotowire.com/football/news.php?team=PIT");
    assert.throws(() => parse.rotowireTeamUrl({ abbreviation: "xyz" }), /no RotoWire team code/);
  });
});
