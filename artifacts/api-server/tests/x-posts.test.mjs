/**
 * The X integration's judgment calls, tested without a network or a database.
 *
 * Everything here is one of the decisions that actually shapes the feed: which
 * posts are reporting and which are chatter, what a post is about, what kind of
 * news it is, and what a post's identity is. They are pure functions precisely
 * so they can be pinned down like this - the same reason shouldRefresh() and
 * evaluateIngestHealth() are pure in routes/news.ts.
 *
 * The timeline document below is a trimmed copy of what
 * syndication.twitter.com served on 2026-09-16, with the text replaced: the
 * SHAPE is the thing under test, since that is what changes without notice and
 * would otherwise fail silently as "the reporters went quiet".
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule, importSource } from "./helpers/bundle.mjs";

const { parseTimelineHtml, normalizeTweet } = await importModule(
  "lib/x/public-provider",
);
const { shouldKeep, postHeadline, dedupeKeyForPost, newsIdForPost } =
  await importModule("lib/x/post-shape");
const { categorize } = await importModule("lib/news-category");
const { isNewerId, maxId } = await importModule("lib/x/types");

// entities reads the roster index that lives inside lib/team/roster, so the two
// have to come out of one bundle - see importSource.
const roster = await importSource(`
  export { indexRoster } from "../src/lib/team/roster";
  export { detectEntities, findPlayer, findTeam } from "../src/lib/x/entities";
`);

after(cleanupBundles);

roster.indexRoster(
  {
    "1": {
      player_id: "4034",
      full_name: "Christian McCaffrey",
      search_full_name: "christianmccaffrey",
      position: "RB",
      team: "SF",
    },
    "2": {
      player_id: "6794",
      full_name: "Justin Jefferson",
      search_full_name: "justinjefferson",
      position: "WR",
      team: "MIN",
    },
    // Two players, one name: the index must refuse to guess which, and so must
    // the matcher built on it.
    "3": {
      player_id: "1",
      full_name: "Josh Allen",
      search_full_name: "joshallen",
      position: "QB",
      team: "BUF",
    },
    "4": {
      player_id: "2",
      full_name: "Josh Allen",
      search_full_name: "joshallen",
      position: "LB",
      team: "JAX",
    },
  },
  Date.now(),
);

/** One entry of the embed page's timeline, as the real document shapes it. */
function entry(tweet) {
  return { type: "tweet", entry_id: `tweet-${tweet.id_str}`, content: { tweet } };
}

function page(tweets) {
  return (
    `<!DOCTYPE html><html><head></head><body>` +
    `<script id="__NEXT_DATA__" type="application/json">` +
    JSON.stringify({
      props: { pageProps: { timeline: { entries: tweets.map(entry) } } },
    }) +
    `</script></body></html>`
  );
}

const ORIGINAL = {
  id_str: "1900000000000000001",
  full_text:
    "49ers RB Christian McCaffrey was limited at practice Wednesday with a calf injury, per sources.",
  created_at: "Wed Sep 16 18:30:00 +0000 2026",
  lang: "en",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
  extended_entities: {
    media: [{ media_url_https: "https://pbs.twimg.com/media/abc.jpg", type: "photo" }],
  },
};

const REPLY = {
  id_str: "1900000000000000002",
  full_text: "More on this shortly.",
  created_at: "Wed Sep 16 18:35:00 +0000 2026",
  in_reply_to_screen_name: "AdamSchefter",
  in_reply_to_status_id_str: "1900000000000000001",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
};

const REPOST = {
  id_str: "1900000000000000003",
  created_at: "Wed Sep 16 18:40:00 +0000 2026",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
  retweeted_status: {
    id_str: "1899999999999999999",
    full_text: "Someone else's post entirely.",
    user: { screen_name: "SomeoneElse", name: "Someone Else" },
  },
};

const QUOTE_WITH_TEXT = {
  id_str: "1900000000000000004",
  full_text: "Confirmed - the Vikings are signing him to a two-year deal.",
  created_at: "Wed Sep 16 18:45:00 +0000 2026",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
  quoted_tweet: {
    id_str: "1899000000000000000",
    full_text: "Justin Jefferson to test the market?",
    user: { screen_name: "SomeoneElse" },
  },
};

const BARE_QUOTE = {
  id_str: "1900000000000000005",
  full_text: "This.",
  created_at: "Wed Sep 16 18:50:00 +0000 2026",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
  quoted_tweet: { id_str: "1899000000000000001", full_text: "Something." },
};

const ALL_ON = {
  includeOriginals: true,
  includeReplies: true,
  includeReposts: true,
  includeQuotes: true,
};

const DEFAULTS = {
  includeOriginals: true,
  includeReplies: false,
  includeReposts: false,
  includeQuotes: true,
};

describe("the public timeline parser", () => {
  test("reads the embedded timeline document", () => {
    const tweets = parseTimelineHtml(page([ORIGINAL, REPLY]));
    assert.equal(tweets.length, 2);
    assert.equal(tweets[0].id_str, ORIGINAL.id_str);
  });

  test("a document of the wrong shape parses to nothing rather than throwing", () => {
    // Each of these is a real failure mode: the page served without the blob,
    // the blob truncated, the JSON valid but restructured upstream.
    assert.deepEqual(parseTimelineHtml("<html><body>nope</body></html>"), []);
    assert.deepEqual(
      parseTimelineHtml(
        `<script id="__NEXT_DATA__" type="application/json">{"props":</script>`,
      ),
      [],
    );
    assert.deepEqual(
      parseTimelineHtml(
        `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>`,
      ),
      [],
    );
  });

  test("normalizes an original post, media and all", () => {
    const post = normalizeTweet(ORIGINAL, "adamschefter");
    assert.equal(post.externalId, ORIGINAL.id_str);
    assert.equal(post.authorUsername, "AdamSchefter");
    assert.equal(post.authorName, "Adam Schefter");
    assert.equal(post.url, "https://x.com/AdamSchefter/status/1900000000000000001");
    assert.equal(post.isReply, false);
    assert.equal(post.isRepost, false);
    assert.equal(post.isQuote, false);
    assert.deepEqual(post.media, ["https://pbs.twimg.com/media/abc.jpg"]);
    assert.equal(post.createdAtMs, Date.parse("Wed Sep 16 18:30:00 +0000 2026"));
  });

  test("flags replies, reposts and quotes for the filter to act on", () => {
    assert.equal(normalizeTweet(REPLY, "adamschefter").isReply, true);
    assert.equal(normalizeTweet(REPOST, "adamschefter").isRepost, true);

    const quote = normalizeTweet(QUOTE_WITH_TEXT, "adamschefter");
    assert.equal(quote.isQuote, true);
    assert.equal(quote.quoted.postId, "1899000000000000000");
    assert.equal(quote.quoted.text, "Justin Jefferson to test the market?");
  });

  test("a post with no usable id is dropped rather than stored badly", () => {
    assert.equal(normalizeTweet({ full_text: "orphan" }, "adamschefter"), null);
  });
});

describe("which posts count as reporting", () => {
  const post = (raw) => normalizeTweet(raw, "adamschefter");

  test("by default: originals in, replies and reposts out", () => {
    assert.equal(shouldKeep(post(ORIGINAL), DEFAULTS), true);
    assert.equal(shouldKeep(post(REPLY), DEFAULTS), false);
    assert.equal(shouldKeep(post(REPOST), DEFAULTS), false);
  });

  test("a quote post is kept only when it says something itself", () => {
    assert.equal(shouldKeep(post(QUOTE_WITH_TEXT), DEFAULTS), true);
    // "This." over someone else's post is a repost with extra steps.
    assert.equal(shouldKeep(post(BARE_QUOTE), DEFAULTS), false);
  });

  test("the account's own settings are what decide - nothing is hard-coded", () => {
    assert.equal(shouldKeep(post(REPLY), ALL_ON), true);
    assert.equal(shouldKeep(post(REPOST), ALL_ON), true);
    assert.equal(
      shouldKeep(post(ORIGINAL), { ...ALL_ON, includeOriginals: false }),
      false,
    );
    assert.equal(
      shouldKeep(post(QUOTE_WITH_TEXT), { ...ALL_ON, includeQuotes: false }),
      false,
    );
  });
});

describe("post identity", () => {
  test("the post id is the dedupe key, not the text", () => {
    assert.equal(dedupeKeyForPost("123"), "x:123");
    assert.notEqual(dedupeKeyForPost("123"), dedupeKeyForPost("124"));
    assert.equal(newsIdForPost("123"), "x-123");
  });

  test("ids compare numerically past what a double can hold", () => {
    // Both of these are indistinguishable as Number(): 2^53 has been exceeded
    // by every id minted since 2015, which is why the comparison is on digits.
    assert.equal(isNewerId("1900000000000000002", "1900000000000000001"), true);
    assert.equal(isNewerId("1900000000000000001", "1900000000000000002"), false);
    assert.equal(isNewerId("19000000000000000000", "1900000000000000002"), true);
    assert.equal(isNewerId("123", null), true);
    assert.equal(maxId("1900000000000000001", "1900000000000000002"), "1900000000000000002");
    assert.equal(maxId(null, "5"), "5");
  });
});

describe("the headline a card shows", () => {
  test("the first sentence becomes the headline", () => {
    assert.equal(
      postHeadline(ORIGINAL.full_text),
      "49ers RB Christian McCaffrey was limited at practice Wednesday with a calf injury, per sources.",
    );
  });

  test("links are not headlines", () => {
    assert.equal(
      postHeadline("Story here: https://t.co/abc123"),
      "Story here:",
    );
  });

  test("a long post is cut on a word boundary and says so", () => {
    const headline = postHeadline("word ".repeat(80));
    assert.ok(headline.length <= 151, headline.length);
    assert.ok(headline.endsWith("…"));
    assert.ok(!headline.includes("wor…"));
  });
});

describe("who and what a post is about", () => {
  test("finds the player named in the text, and his team with him", () => {
    const { player, team } = roster.detectEntities(ORIGINAL.full_text);
    assert.equal(player?.name, "Christian McCaffrey");
    assert.equal(player?.id, "4034");
    // From the roster, not from the "49ers" in the sentence.
    assert.equal(team, "sf");
  });

  test("reads the quoted post too, since that is often where the name is", () => {
    const { player } = roster.detectEntities(
      "Confirmed.",
      "Justin Jefferson to test the market?",
    );
    assert.equal(player?.name, "Justin Jefferson");
  });

  test("a name on two teams is attributed to neither", () => {
    assert.equal(roster.findPlayer("Josh Allen had a big game"), null);
  });

  test("a club is found by nickname, code or city", () => {
    assert.equal(roster.findTeam("The Eagles are signing a guard"), "phi");
    assert.equal(roster.findTeam("Niners make a move"), "sf");
    assert.equal(roster.findTeam("KC is expected to activate him"), "kc");
  });

  test("two clubs in one sentence means neither is the subject", () => {
    assert.equal(
      roster.findTeam("Detroit is dealing a pick to the Rams"),
      null,
    );
  });

  test("handles and links are not evidence of a team", () => {
    // @Chargers is a mention, and a URL containing a club name is a URL.
    assert.equal(roster.findTeam("via @Chargers https://nfl.com/bears/news"), null);
  });
});

describe("what kind of news it is", () => {
  const cases = [
    [ORIGINAL.full_text, "injury"],
    ["The Bears are signing OL Mason Smith to a two-year deal", "transaction"],
    ["Full participant in practice today, no injury designation", "injury"],
    ["Everyone was on the field for the walkthrough", "practice"],
    ["He has been named the starter for Week 3", "depth-chart"],
    ["Teams are believed to have interest in a trade", "transaction"],
    ["A solid waiver wire add this week", "fantasy"],
    ["Great atmosphere at the stadium tonight", "other"],
    // Availability, which has no body part, no move and no practice in it.
    // Every one of these used to land in "other".
    ["Won't play in Saturday's preseason game", "status"],
    ["In line to play in Friday's preseason contest", "status"],
    ["Done for season", "status"],
    ["Feels on track for Week 1", "status"],
    // Participation. A bare `practice` missed the -ing form, which is the
    // shape the wire files most of these in.
    ["Not practicing Wednesday", "practice"],
    ["Takes part in 7-on-7 drills", "practice"],
    ["Had a rest day Tuesday", "practice"],
    // Role notes, which read as depth chart rather than as nothing.
    ["Still Dallas' clear TE1", "depth-chart"],
    ["Embracing complementary role", "depth-chart"],
    ["Wins kicker competition in Washington", "depth-chart"],
    // `back` is a body part, a direction and a position: it counts as an
    // injury only with an injury word beside it, or as a return to play.
    ["Back for Year 2 with Steelers", "other"],
    ["Viewed as three-down back", "depth-chart"],
    ["Dealing with lower back tightness", "injury"],
    ["Working back at his own pace", "injury"],
    // ...and `out for` needs a duration, or "works out for" is an injury.
    ["Officially works out for Rams again", "other"],
    ["Out for at least one month with MCL sprain", "injury"],
    // The club lane's own genres. None of these name a player fact at all,
    // and every one of them used to be "other".
    ["How to Watch: Buccaneers vs. Browns | Week 2 2026", "preview"],
    ["Know Your Foe: The Texans' Look To Slow Joe Burrow", "preview"],
    ["Expert Game Picks: Raiders or Chargers?", "preview"],
    ["Bills 41, Lions 31 | Final Score, recap + highlights", "recap"],
    ["Top 3 things we learned from Bills vs. Lions | Week 2", "recap"],
    ["2026 Bucs NFL Power Rankings Week 2", "analysis"],
    ["Transcript: DC Sean Duggan Press Conference - September 17", "media"],
    ["Mailbag: How to contain running QBs?", "media"],
    ["Colts, Versiti announce dates for 2026 Bleed Blue Blood Drives", "club"],
    ["Miami Dolphins Academy Hosts Flag Football Clinics for Youth", "club"],
    // A player fact published by a club is still the player fact: the genre
    // rules sit below every rule above them.
    ["Colts rule out WR Ashton Dulin for Week 2 game against Kansas City", "injury"],
    ["INACTIVES: Lions vs. Bills", "status"],
    ["Carson Wentz to Start for Vikings in Week 2 at Bears", "depth-chart"],
  ];

  for (const [text, expected] of cases) {
    test(`"${text.slice(0, 44)}…" -> ${expected}`, () => {
      assert.equal(categorize(text), expected);
    });
  }

  test("an item with nothing to read is 'other', never a guess", () => {
    assert.equal(categorize(null, undefined, ""), "other");
  });
});
