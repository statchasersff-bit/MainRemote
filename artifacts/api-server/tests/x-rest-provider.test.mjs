/**
 * The configurable API provider, against three different vendor shapes.
 *
 * The promise this feature makes is "switching where posts come from is a
 * config change". For the commercial APIs that resell X data, that promise
 * lives entirely in one normaliser — so it is tested against the three shapes
 * those vendors actually ship: X's own v1.1 tweet object (which most mirrors
 * copy), X API v2's flatter object with `referenced_tweets`, and the camelCase
 * shape the newer resellers prefer.
 *
 * No network: these are fixtures, because the thing under test is the reading,
 * not the fetching.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { normalizeApiTweet, findPosts, buildUrl, parseTimestamp } =
  await importModule("lib/x/rest-provider");

after(cleanupBundles);

const WHEN = Date.parse("2026-09-16T18:30:00Z");

/** Shape A: X's own v1.1 object, which most mirrors reproduce verbatim. */
const LEGACY = {
  id_str: "1900000000000000001",
  full_text: "Bears are signing OL Test Lineman to a two-year deal, per sources.",
  created_at: "Wed Sep 16 18:30:00 +0000 2026",
  lang: "en",
  user: { screen_name: "AdamSchefter", name: "Adam Schefter" },
  extended_entities: {
    media: [{ media_url_https: "https://pbs.twimg.com/media/a.jpg", type: "photo" }],
  },
};

/** Shape B: X API v2 — flat, with referenced_tweets carrying the relationships. */
const V2 = {
  id: "1900000000000000002",
  text: "Confirmed — he passed his physical.",
  created_at: "2026-09-16T18:30:00.000Z",
  lang: "en",
  referenced_tweets: [{ type: "quoted", id: "1899000000000000000" }],
};

/** Shape C: the camelCase shape the newer resellers ship. */
const MODERN = {
  id: "1900000000000000003",
  text: "RB Test Player is expected to miss multiple weeks.",
  createdAt: 1789583400,
  author: { userName: "RapSheet", name: "Ian Rapoport" },
  isReply: true,
  conversationId: "1899999999999999999",
  twitterUrl: "https://x.com/RapSheet/status/1900000000000000003",
  mediaUrls: ["https://pbs.twimg.com/media/b.jpg"],
};

describe("reading a vendor's post object", () => {
  test("X's own v1.1 shape", () => {
    const post = normalizeApiTweet(LEGACY, "adamschefter");
    assert.equal(post.externalId, "1900000000000000001");
    assert.equal(post.authorUsername, "AdamSchefter");
    assert.equal(post.authorName, "Adam Schefter");
    assert.equal(post.createdAtMs, WHEN);
    assert.equal(post.isReply, false);
    assert.equal(post.isRepost, false);
    assert.equal(post.isQuote, false);
    assert.deepEqual(post.media, ["https://pbs.twimg.com/media/a.jpg"]);
    assert.equal(
      post.url,
      "https://x.com/AdamSchefter/status/1900000000000000001",
    );
  });

  test("X API v2's shape, relationships and all", () => {
    const post = normalizeApiTweet(V2, "adamschefter");
    assert.equal(post.externalId, "1900000000000000002");
    assert.equal(post.createdAtMs, WHEN);
    assert.equal(post.isQuote, true);
    assert.equal(post.quoted.postId, "1899000000000000000");
    // No author object in the payload: the handle we asked for stands in.
    assert.equal(post.authorUsername, "adamschefter");
  });

  test("the camelCase reseller shape, including a seconds epoch", () => {
    const post = normalizeApiTweet(MODERN, "rapsheet");
    assert.equal(post.externalId, "1900000000000000003");
    assert.equal(post.authorUsername, "RapSheet");
    assert.equal(post.authorName, "Ian Rapoport");
    assert.equal(post.createdAtMs, WHEN);
    assert.equal(post.isReply, true);
    assert.deepEqual(post.media, ["https://pbs.twimg.com/media/b.jpg"]);
    // The vendor gave a canonical URL; it is used rather than rebuilt.
    assert.equal(post.url, "https://x.com/RapSheet/status/1900000000000000003");
  });

  test("a repost is recognised however the vendor reports it", () => {
    const nested = normalizeApiTweet(
      { ...LEGACY, retweeted_status: { id_str: "1", full_text: "original" } },
      "x",
    );
    const referenced = normalizeApiTweet(
      { ...V2, referenced_tweets: [{ type: "retweeted", id: "1" }] },
      "x",
    );
    const flagged = normalizeApiTweet({ ...MODERN, isRetweet: true }, "x");
    // The one that says so nowhere but in the text — several mirrors do this.
    const flattened = normalizeApiTweet(
      { id: "9", text: "RT @someone: their words here" },
      "x",
    );

    for (const post of [nested, referenced, flagged, flattened]) {
      assert.equal(post.isRepost, true);
    }
  });

  test("a thread-starting post is not a reply", () => {
    // conversation_id equal to the post's own id means it started the thread —
    // the trap in every vendor that exposes conversationId but not a reply flag.
    const starter = normalizeApiTweet(
      { ...MODERN, isReply: false, conversationId: MODERN.id },
      "rapsheet",
    );
    assert.equal(starter.isReply, false);
  });

  test("an object with no id is skipped rather than stored badly", () => {
    assert.equal(normalizeApiTweet({ text: "orphan" }, "x"), null);
  });
});

describe("finding the posts in a response", () => {
  const cases = [
    ["a bare array", [LEGACY, V2]],
    ["{data: [...]}", { data: [LEGACY, V2] }],
    ["{tweets: [...]}", { tweets: [LEGACY, V2] }],
    ["{data: {tweets: [...]}}", { data: { tweets: [LEGACY, V2] } }],
    ["{status, results: [...]}", { status: "ok", results: [LEGACY, V2] }],
  ];

  for (const [label, body] of cases) {
    test(label, () => {
      assert.equal(findPosts(body).length, 2);
    });
  }

  test("a response with no posts in it finds none rather than throwing", () => {
    assert.deepEqual(findPosts({ error: "quota exceeded" }), []);
    assert.deepEqual(findPosts(null), []);
    assert.deepEqual(findPosts("nope"), []);
    // An array of something that is not posts is not posts.
    assert.deepEqual(findPosts({ users: [{ id: "1", name: "someone" }] }), []);
  });
});

describe("building the request", () => {
  const TEMPLATE =
    "https://api.example.com/tweets?userName={username}&sinceId={sinceId}&count={limit}";

  test("fills the placeholders", () => {
    assert.equal(
      buildUrl(TEMPLATE, { username: "AdamSchefter", sinceId: "123", limit: 25 }),
      "https://api.example.com/tweets?userName=AdamSchefter&sinceId=123&count=25",
    );
  });

  test("drops a parameter whose value is empty rather than sending it blank", () => {
    // `&sinceId=` is not the same request as no sinceId, and some vendors 400 on it.
    assert.equal(
      buildUrl(TEMPLATE, { username: "AdamSchefter", sinceId: null, limit: 25 }),
      "https://api.example.com/tweets?userName=AdamSchefter&count=25",
    );
  });

  test("a handle is escaped, and a leading @ is not part of it", () => {
    assert.equal(
      buildUrl("https://api.example.com/{username}", { username: "@Rap Sheet" }),
      "https://api.example.com/Rap%20Sheet",
    );
  });
});

describe("timestamps", () => {
  test("seconds, milliseconds, ISO and X's own format all land on the same instant", () => {
    assert.equal(parseTimestamp(1789583400), WHEN);
    assert.equal(parseTimestamp(1789583400000), WHEN);
    assert.equal(parseTimestamp("1789583400"), WHEN);
    assert.equal(parseTimestamp("2026-09-16T18:30:00.000Z"), WHEN);
    assert.equal(parseTimestamp("Wed Sep 16 18:30:00 +0000 2026"), WHEN);
  });

  test("nothing usable is null, never a guess", () => {
    assert.equal(parseTimestamp(undefined), null);
    assert.equal(parseTimestamp("not a date"), null);
  });
});
