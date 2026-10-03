/**
 * Real-time delivery: the rule builder and the delivery reader.
 *
 * The two pieces that are specific to a provider watching accounts on our
 * behalf. Everything after a delivery is read is the shared pipeline, which is
 * tested where it lives - so what matters here is that a 37-account watchlist
 * becomes expressions a provider will actually accept, and that a delivery is
 * read without ever throwing at a payload we cannot use.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { buildFilterRules, readDelivery, ruleTag, MAX_RULE_LENGTH } =
  await importModule("lib/x/webhook");

after(cleanupBundles);

/** The real seeded watchlist - the case the chunker exists for. */
const WATCHLIST = [
  "adamschefter", "rapsheet", "tompelissero", "mikegarafolo", "albertbreer",
  "ryanmcfadden", "seifertespn", "colton_pouncy", "hayscarlyon", "nflstroud",
  "toddarcher", "marcraimondi", "nwagoner", "kguregian", "bengoessling",
  "adamjahns", "danwiederer", "ezlazar", "richcimini", "kat_terrell",
  "christomasson", "miketriplett", "mattparrino", "ben_baby", "alexzietlow05",
  "mike_e_kaye", "scottsbucs", "jeffzrebiec", "nickijhabvala", "bydanielflick",
  "jordanraanan", "gregauman", "krisrhim1", "akronjackson", "jayskurski",
  "e_woodyard", "ryandunleavy",
];

describe("turning a watchlist into filter rules", () => {
  test("every rule fits the provider's 255-character cap", () => {
    const rules = buildFilterRules(WATCHLIST);
    assert.ok(rules.length > 1, "37 handles cannot fit in one rule");
    for (const rule of rules) {
      assert.ok(
        rule.length <= MAX_RULE_LENGTH,
        `rule is ${rule.length} chars: ${rule}`,
      );
    }
  });

  test("every handle appears exactly once, across all the rules", () => {
    const rules = buildFilterRules(WATCHLIST);
    const terms = rules.flatMap((rule) => rule.split(" OR "));

    assert.deepEqual(
      [...terms].sort(),
      WATCHLIST.map((u) => `from:${u}`).sort(),
    );
    // A handle in two rules is a post delivered - and billed - twice.
    assert.equal(new Set(terms).size, terms.length);
  });

  test("it uses as few rules as it can", () => {
    // Greedy packing: each rule is filled before the next is started, because
    // rule count is what has to be registered and paid attention to.
    const rules = buildFilterRules(WATCHLIST);
    for (let i = 0; i < rules.length - 1; i++) {
      const firstOfNext = rules[i + 1].split(" OR ")[0];
      assert.ok(
        `${rules[i]} OR ${firstOfNext}`.length > MAX_RULE_LENGTH,
        `rule ${i + 1} had room for the next term and did not take it`,
      );
    }
  });

  test("a suffix is applied to every rule and counted against the cap", () => {
    const rules = buildFilterRules(WATCHLIST, { suffix: "-filter:retweets" });
    for (const rule of rules) {
      assert.ok(rule.endsWith(" -filter:retweets"));
      assert.ok(rule.length <= MAX_RULE_LENGTH, `${rule.length} chars`);
    }
  });

  test("handles are normalised, so @Name and name are one term", () => {
    assert.deepEqual(buildFilterRules(["@AdamSchefter", " RapSheet "]), [
      "from:adamschefter OR from:rapsheet",
    ]);
  });

  test("an empty watchlist produces no rules rather than an empty one", () => {
    // Registering `from:` with nothing after it would match either everything
    // or nothing, and both are expensive ways to find out.
    assert.deepEqual(buildFilterRules([]), []);
    assert.deepEqual(buildFilterRules(["", "  ", "@"]), []);
  });

  test("rules are tagged so a delivery can be traced to one", () => {
    assert.equal(ruleTag(0, 4), "statchasers-nfl-1-of-4");
    assert.equal(ruleTag(3, 4), "statchasers-nfl-4-of-4");
  });
});

describe("reading a delivery", () => {
  /** The documented payload shape. */
  const DELIVERY = {
    event_type: "tweet",
    rule_id: "rule_12345",
    rule_tag: "statchasers-nfl-1-of-4",
    tweets: [
      {
        id: "1900000000000000001",
        text: "Sources: 49ers RB Christian McCaffrey was limited at practice.",
        author: { id: "999", username: "AdamSchefter", name: "Adam Schefter" },
        created_at: "2026-09-16T18:30:00Z",
        retweet_count: 42,
        like_count: 420,
      },
    ],
    timestamp: 1789583400000,
  };

  test("reads the documented payload", () => {
    const delivery = readDelivery(DELIVERY);

    assert.equal(delivery.eventType, "tweet");
    assert.equal(delivery.ruleId, "rule_12345");
    assert.equal(delivery.ruleTag, "statchasers-nfl-1-of-4");
    assert.equal(delivery.posts.length, 1);

    const [post] = delivery.posts;
    assert.equal(post.externalId, "1900000000000000001");
    assert.equal(post.authorUsername, "AdamSchefter");
    assert.equal(post.authorName, "Adam Schefter");
    assert.equal(post.createdAtMs, Date.parse("2026-09-16T18:30:00Z"));
    assert.equal(post.url, "https://x.com/AdamSchefter/status/1900000000000000001");
  });

  test("a delivery with several posts keeps all of them", () => {
    const delivery = readDelivery({
      ...DELIVERY,
      tweets: [
        DELIVERY.tweets[0],
        { ...DELIVERY.tweets[0], id: "1900000000000000002" },
      ],
    });
    assert.equal(delivery.posts.length, 2);
  });

  test("a non-tweet event is reported as such, not as zero posts", () => {
    // A ping and a delivery that lost its posts need different responses, and
    // the route cannot tell them apart unless this does.
    const ping = readDelivery({ event_type: "ping" });
    assert.equal(ping.eventType, "ping");
    assert.equal(ping.posts.length, 0);
  });

  test("an unreadable entry is rejected with a reason, not dropped silently", () => {
    const delivery = readDelivery({
      event_type: "tweet",
      tweets: [{ text: "no id" }, { id: "1", text: "no author" }, "nonsense"],
    });
    assert.equal(delivery.posts.length, 0);
    assert.equal(delivery.rejected.length, 3);
    assert.match(delivery.rejected[0], /no usable post id/);
    assert.match(delivery.rejected[1], /no author handle/);
  });

  test("garbage never throws - an unacknowledgeable delivery is retried forever", () => {
    for (const body of [null, undefined, "", 42, [], { tweets: "not an array" }]) {
      const delivery = readDelivery(body);
      assert.equal(delivery.posts.length, 0);
    }
  });
});
