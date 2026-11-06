/**
 * The national outlets lane (lib/outlet-news.ts): PFT, Yahoo Sports and CBS
 * Sports RSS, headline only, tagged to a player or one club.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { parseOutletFeed, buildTagger, tagHeadline, toOutletItems, OUTLETS } = await importModule("lib/outlet-news");

after(cleanupBundles);

const roster = [
  { id: "1", name: "Joe Milton", team: "PHI", position: "QB" },
  { id: "2", name: "Harold Fannin Jr.", team: "CLE", position: "TE" },
  { id: "3", name: "Mike Williams", team: "NYJ", position: "WR" },
  { id: "4", name: "Mike Williams", team: "PIT", position: "WR" },
  { id: "5", name: "Cincinnati Bengals", team: "CIN", position: "DEF" },
  { id: "6", name: "Old Guy", team: "FA", position: "RB" },
];
const tagger = buildTagger(roster);

const feed = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Eagles&#39; switch: Joe Milton starts]]></title><link>https://example.com/a</link>
<guid>a</guid><pubDate>Fri, 06 Nov 2026 07:00:00 GMT</pubDate><description>Body text we must never keep.</description></item>
<item><title>No guid or link</title></item>
</channel></rss>`;

describe("outlet news", () => {
  test("three outlets, ESPN not among them", () => {
    assert.deepEqual(OUTLETS.map((o) => o.key), ["pft", "yahoo", "cbs"]);
  });

  test("parse decodes entities, drops undated-and-unlinked items, never reads the description", () => {
    const items = parseOutletFeed(feed);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Eagles' switch: Joe Milton starts");
    assert.equal(JSON.stringify(items).includes("Body text"), false);
  });

  test("tags the first named player, with his team", () => {
    assert.deepEqual(tagHeadline("Joe Milton on his first start", tagger), { playerName: "Joe Milton", playerId: "1", team: "phi" });
  });

  test("a suffix is optional; a shared name is never guessed; free agents and defenses are not players", () => {
    assert.equal(tagHeadline("Browns add TE Harold Fannin to injury report", tagger).playerName, "Harold Fannin Jr.");
    assert.equal(tagHeadline("Mike Williams released", tagger), null);
    assert.equal(tagHeadline("Old Guy retires", tagger), null);
    assert.equal(tagHeadline("Cincinnati Bengals news: practice notes", tagger).playerName, null);
  });

  test("no player: one club by nickname, two clubs is no tag", () => {
    assert.deepEqual(tagHeadline("Ravens rule out a safety", tagger), { playerName: null, playerId: null, team: "bal" });
    assert.equal(tagHeadline("3 keys to a Bengals victory vs. the Falcons", tagger), null);
  });

  test("stored items are headline only, credited, and always carry a team", () => {
    const [item] = toOutletItems(OUTLETS[0], parseOutletFeed(feed), tagger, Date.UTC(2026, 10, 6, 12));
    assert.equal(item.id, "outlet:pft:a");
    assert.equal(item.source, "ProFootballTalk");
    assert.equal(item.teamAbbr, "phi");
    assert.equal(item.playerName, "Joe Milton");
    assert.equal("summary" in item, false);
  });

  test("older than two weeks is dropped", () => {
    const counts = { untagged: 0, tooOld: 0 };
    assert.equal(toOutletItems(OUTLETS[0], parseOutletFeed(feed), tagger, Date.UTC(2026, 11, 6), counts).length, 0);
    assert.equal(counts.tooOld, 1);
  });
});
