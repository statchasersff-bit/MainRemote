/**
 * X ingestion end to end, against the built server and the real database.
 *
 * The one thing stubbed is the timeline document, served by a local HTTP server
 * that X_PUBLIC_TIMELINE_URL points the real PublicXProvider at. Everything
 * downstream of that fetch is the production path: the same provider, the same
 * claim, the same storeItems(), the same news_items table, the same feed query
 * and the same renderer. A test that mocked the store would prove the store's
 * mock works.
 *
 * Everything this writes is namespaced to handles and post ids that cannot
 * collide with anything real, and is deleted afterwards.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

/** Namespaced so the cleanup below cannot touch anything real. */
const REPORTER = "sc_test_reporter";
const QUIET = "sc_test_quiet";
const BROKEN = "sc_test_broken";
const MALFORMED = "sc_test_malformed";
const DISABLED = "sc_test_disabled";
const LIMITED = "sc_test_429";

const ALL = [REPORTER, QUIET, BROKEN, MALFORMED, DISABLED, LIMITED];

const SECRET = "x-test-secret";
/** Every write needs it: the guard refuses when the server has none, too. */
const AUTH = { "x-ingest-secret": SECRET };

/** Ids in a range no real post will ever have. */
const ID = {
  original: "9900000000000000001",
  reply: "9900000000000000002",
  repost: "9900000000000000003",
  quote: "9900000000000000004",
  older: "9900000000000000005",
};

let timeline;
let server;
let client;
/**
 * Accounts this file switched off for the duration, and puts back afterwards.
 *
 * The poller claims whatever is due across the whole table, so a run against a
 * database that already holds the 37 real reporters would point the fixture
 * timeline at their rows and leave a fixture watermark on each — which would
 * then silently suppress their real posts forever. Parking them is what makes
 * that impossible rather than merely unlikely.
 */
let parked = [];
/** Timeline requests received, by handle — the throttle and claim evidence. */
let hits = {};

function tweet(overrides) {
  return {
    created_at: new Date(Date.now() - 60_000).toUTCString().replace("GMT", "+0000"),
    lang: "en",
    user: { screen_name: REPORTER, name: "Test Reporter" },
    ...overrides,
  };
}

function timelinePage(tweets) {
  return (
    `<!DOCTYPE html><html><body>` +
    `<script id="__NEXT_DATA__" type="application/json">` +
    JSON.stringify({
      props: {
        pageProps: {
          timeline: {
            entries: tweets.map((t) => ({
              type: "tweet",
              entry_id: `tweet-${t.id_str}`,
              content: { tweet: t },
            })),
          },
        },
      },
    }) +
    `</script></body></html>`
  );
}

const POSTS = [
  tweet({
    id_str: ID.original,
    full_text:
      "Bears are signing OL Test Lineman to a two-year deal worth $12 million, per sources.",
  }),
  tweet({
    id_str: ID.reply,
    full_text: "More to come on this one.",
    in_reply_to_screen_name: REPORTER,
    in_reply_to_status_id_str: ID.original,
  }),
  tweet({
    id_str: ID.repost,
    retweeted_status: {
      id_str: "9800000000000000000",
      full_text: "Someone else broke this first.",
      user: { screen_name: "someone_else" },
    },
  }),
  tweet({
    id_str: ID.quote,
    full_text: "Confirmed — he passed his physical this morning and will practice.",
    quoted_tweet: {
      id_str: "9800000000000000001",
      full_text: "Is the deal done?",
      user: { screen_name: "someone_else" },
    },
  }),
  tweet({
    id_str: ID.older,
    full_text: "A post from long before the cutoff, which must not be backfilled.",
    // Well past X_MAX_POST_AGE_DAYS below.
    created_at: "Mon Jan 06 12:00:00 +0000 2020",
  }),
];

async function sweep() {
  const res = await fetch(`${server.origin}/api/x/ingest`, { method: "POST", headers: AUTH });
  // Read once: a failing sweep's body is the diagnostic, and a Response body
  // cannot be consumed twice.
  const body = await res.text();
  assert.equal(res.status, 200, body);
  return JSON.parse(body);
}

async function newsRows() {
  const { rows } = await client.query(
    "SELECT * FROM news_items WHERE id LIKE 'x-99%' ORDER BY pub_date_ms DESC",
  );
  return rows;
}

before(async () => {
  timeline = http.createServer((req, res) => {
    const handle = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
    hits[handle] = (hits[handle] ?? 0) + 1;

    if (handle === BROKEN) {
      // The profile is gone, renamed, or the endpoint is refusing us.
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>not found</body></html>");
      return;
    }
    if (handle === LIMITED) {
      // What the public endpoint actually does when this IP has spent its
      // budget — observed, not imagined.
      res.writeHead(429, { "Content-Type": "text/html" });
      res.end("Rate limit exceeded");
      return;
    }
    if (handle === MALFORMED) {
      // A 200 whose shape is not what we parse — the failure mode that would
      // otherwise look like "the reporter went quiet".
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>{definitely not the document we expect</body></html>");
      return;
    }
    if (handle === QUIET) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(timelinePage([tweet({ id_str: ID.older, full_text: "Old news.", created_at: "Mon Jan 06 12:00:00 +0000 2020" })]));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(timelinePage(POSTS));
  });
  await new Promise((resolve) => timeline.listen(0, "127.0.0.1", resolve));
  const { port } = timeline.address();

  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();

  for (const username of ALL) {
    await client.query(
      `INSERT INTO x_monitored_accounts (username, enabled, priority)
       VALUES ($1, $2, 'normal')`,
      // The rate-limited one starts disabled: a 429 pauses the WHOLE poller by
      // design, so it is enabled only in the last suite, once everything else
      // has run.
      [username, username !== DISABLED && username !== LIMITED],
    );
  }

  const { rows } = await client.query(
    `UPDATE x_monitored_accounts SET enabled = false
      WHERE enabled = true AND username NOT LIKE 'sc\\_test\\_%'
      RETURNING username`,
  );
  parked = rows.map((row) => row.username);

  server = await startServer({
    X_NEWS_INGESTION_ENABLED: "true",
    X_PROVIDER: "public",
    X_PUBLIC_TIMELINE_URL: `http://127.0.0.1:${port}/timeline/{username}`,
    // The seed list is 37 real reporters; this run must contain only its own
    // fixtures. See seedAccountsEnabled().
    X_SEED_ACCOUNTS: "false",
    // An hour, so the only sweeps that happen are the ones this file asks for.
    // A background tick landing mid-assertion would make "how many posts are
    // stored" a race.
    X_POLL_TICK_MS: String(60 * 60 * 1000),
    X_POLL_INTERVAL_MS: "0",
    X_POLL_JITTER: "0",
    X_POLL_BATCH: "10",
    X_MAX_POST_AGE_DAYS: "7",
    // Against a local stub there is nobody to be polite to, and the real gap
    // would add six seconds to every sweep in this file.
    X_POLL_REQUEST_GAP_MS: "0",
    X_RATE_LIMIT_COOLDOWN_MS: "60000",
    X_WEBHOOK_SECRET: "webhook-test-key",
    INGEST_SECRET: SECRET,
  });
});

async function cleanup() {
  // '99%' covers the polled (9900...), pushed (9910...) and delivered (9930...)
  // fixtures alike.
  await client.query("DELETE FROM x_posts WHERE post_id LIKE '99%'");
  await client.query("DELETE FROM news_items WHERE id LIKE 'x-99%'");
  await client.query("DELETE FROM x_monitored_accounts WHERE username LIKE 'sc\\_test\\_%'");
}

after(async () => {
  // The server first: nothing may still be polling while the real accounts are
  // being switched back on.
  await server?.stop();
  await new Promise((resolve) => timeline?.close(resolve));
  await cleanup();
  if (parked.length > 0) {
    await client.query(
      "UPDATE x_monitored_accounts SET enabled = true WHERE username = ANY($1)",
      [parked],
    );
  }
  await client?.end();
});

describe("a sweep", () => {
  test("stores the reporting and nothing else", async () => {
    const result = await sweep();

    assert.equal(result.ok, true);
    // Every enabled account was due (X_POLL_INTERVAL_MS=0) and claimed — and
    // the only enabled accounts are this file's own, because before() parked
    // the rest.
    assert.equal(result.checked, 4, JSON.stringify(result.accounts));
    assert.ok(
      result.accounts.every((a) => a.username.startsWith("sc_test_")),
      `a real account was polled: ${JSON.stringify(result.accounts)}`,
    );

    const rows = await newsRows();
    const ids = rows.map((row) => row.id).sort();

    // The original and the quote-with-text are news. The reply, the repost and
    // the post older than the cutoff are not — none by accident, each by a
    // different rule.
    assert.deepEqual(ids, [`x-${ID.original}`, `x-${ID.quote}`]);
  });

  test("the disabled account is never even fetched", () => {
    assert.equal(hits[DISABLED], undefined);
    assert.ok(hits[REPORTER] >= 1);
  });

  test("a post carries its author, its lane and a link back to X", async () => {
    const [row] = await client.query(
      "SELECT * FROM news_items WHERE id = $1",
      [`x-${ID.original}`],
    ).then((r) => r.rows);

    assert.equal(row.source_type, "x");
    assert.equal(row.author_handle, REPORTER);
    assert.equal(row.source, "Test Reporter");
    assert.equal(row.link, `https://x.com/${REPORTER}/status/${ID.original}`);
    assert.equal(row.dedupe_key, `x:${ID.original}`);
    // Ordered on the parsed timestamp, like every other row in the archive.
    assert.ok(Number(row.pub_date_ms) > Date.now() - 5 * 60_000);
  });

  test("the X-specific facts land in x_posts, keyed by the post id", async () => {
    const { rows } = await client.query(
      "SELECT * FROM x_posts WHERE post_id = $1",
      [ID.quote],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_quote, true);
    assert.equal(rows[0].is_reply, false);
    assert.equal(rows[0].quoted_post_id, "9800000000000000001");
    assert.equal(rows[0].quoted_text, "Is the deal done?");
    assert.equal(rows[0].news_item_id, `x-${ID.quote}`);
    // Categorised through the shared classifier, not an X-only one: "passed his
    // physical ... and will practice" is a practice note, and nothing in it
    // claims an injury.
    assert.equal(rows[0].category, "practice");
  });

  test("a failing profile is recorded against it, not thrown", async () => {
    const { rows } = await client.query(
      "SELECT * FROM x_monitored_accounts WHERE username = $1",
      [BROKEN],
    );
    assert.equal(rows[0].consecutive_failures, 1);
    assert.match(rows[0].last_error, /404/);
  });

  test("a 200 of the wrong shape is a failure, not a quiet success", async () => {
    const { rows } = await client.query(
      "SELECT * FROM x_monitored_accounts WHERE username = $1",
      [MALFORMED],
    );
    assert.equal(rows[0].consecutive_failures, 1);
    assert.match(rows[0].last_error, /no timeline entries/);
  });

  test("one failing account does not stop the others", async () => {
    // The two that failed are in the same sweep as the one that stored posts.
    assert.ok(hits[BROKEN] >= 1);
    assert.ok(hits[MALFORMED] >= 1);
    assert.equal((await newsRows()).length, 2);
  });
});

describe("the same post, seen again", () => {
  test("a second sweep of the same timeline stores nothing new", async () => {
    const before = await newsRows();
    const result = await sweep();

    assert.equal(result.stored, 0);
    const after = await newsRows();
    assert.equal(after.length, before.length);
    // And it did not spawn a second copy under a different id, either.
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM x_posts WHERE post_id = $1",
      [ID.original],
    );
    assert.equal(rows[0].n, 1);
  });

  test("two sweeps at once cannot both process the same account", async () => {
    // The overlap guard, from outside: whichever request arrives second is told
    // a sweep is already running rather than being allowed to claim alongside
    // it. Below this, the database is the backstop — the claim is a conditional
    // UPDATE and x_posts.post_id is a primary key — but this is the layer that
    // stops the work from being started twice in the first place.
    const [a, b] = await Promise.all([
      fetch(`${server.origin}/api/x/ingest`, { method: "POST", headers: AUTH }),
      fetch(`${server.origin}/api/x/ingest`, { method: "POST", headers: AUTH }),
    ]);

    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [200, 409]);

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM x_posts WHERE post_id = $1",
      [ID.original],
    );
    assert.equal(rows[0].n, 1);
  });

  test("a restart does not re-ingest what is already stored", async () => {
    const before = await newsRows();

    await server.stop();
    server = await startServer({
      X_NEWS_INGESTION_ENABLED: "true",
      X_PROVIDER: "public",
      X_PUBLIC_TIMELINE_URL: `http://127.0.0.1:${timeline.address().port}/timeline/{username}`,
      X_SEED_ACCOUNTS: "false",
      X_POLL_TICK_MS: String(60 * 60 * 1000),
      X_POLL_INTERVAL_MS: "0",
      X_POLL_JITTER: "0",
      X_POLL_BATCH: "10",
      X_MAX_POST_AGE_DAYS: "7",
      X_POLL_REQUEST_GAP_MS: "0",
      X_RATE_LIMIT_COOLDOWN_MS: "60000",
      X_WEBHOOK_SECRET: "webhook-test-key",
      INGEST_SECRET: SECRET,
    });

    const result = await sweep();
    assert.equal(result.stored, 0);
    assert.deepEqual(
      (await newsRows()).map((r) => r.id).sort(),
      before.map((r) => r.id).sort(),
    );
  });
});

describe("the feed", () => {
  test("serves X posts alongside the rest of the news", async () => {
    const res = await fetch(`${server.origin}/api/news?limit=250`);
    const body = await res.json();

    const mine = body.items.filter((item) => item.id.startsWith("x-99"));
    assert.equal(mine.length, 2, "both X posts should be in the main feed");

    const post = mine.find((item) => item.id === `x-${ID.original}`);
    assert.equal(post.sourceType, "x");
    assert.equal(post.authorHandle, REPORTER);
    assert.equal(post.link, `https://x.com/${REPORTER}/status/${ID.original}`);
    // Derived by the shared classifier, for X rows and wire rows alike.
    assert.equal(post.category, "transaction");

    // The lane did not swallow anything: the wire is still there.
    assert.ok(
      body.items.some((item) => !item.id.startsWith("x-")),
      "the existing news sources must still be in the feed",
    );
  });

  test("the list is ordered by when things were published, not by lane", async () => {
    const body = await fetch(`${server.origin}/api/news?limit=250`).then((r) =>
      r.json(),
    );
    const stamps = body.items
      .map((item) => item.pubDateMs)
      .filter((ms) => typeof ms === "number");

    for (let i = 1; i < stamps.length; i++) {
      assert.ok(
        stamps[i - 1] >= stamps[i],
        `feed out of order at ${i}: ${stamps[i - 1]} then ${stamps[i]}`,
      );
    }
  });

  test("the rendered page marks each card's source so the filter can read it", async () => {
    const html = await fetch(server.origin).then((r) => r.text());

    assert.ok(
      html.includes(`data-source="x"`),
      "X cards must be identifiable in the markup",
    );
    assert.ok(
      html.includes(`data-handle="${REPORTER}"`),
      "the account filter reads the handle off the card",
    );
    assert.ok(html.includes("sc-card-label-x"), "X cards carry the author byline");
    assert.ok(
      html.includes(`https://x.com/${REPORTER}/status/${ID.original}`),
      "the card links to the original post",
    );
    // The toolbar gained the controls, and did not lose the ones it had.
    assert.ok(html.includes('id="scFilterSource"'));
    assert.ok(html.includes('id="scFilterAccount"'));
    assert.ok(html.includes('id="scFilterCategory"'));
    assert.ok(html.includes('id="scFilterPlayer"'));
    assert.ok(html.includes('id="scFilterTeam"'));
  });
});

describe("the admin surface", () => {
  test("lists the monitored accounts", async () => {
    const body = await fetch(`${server.origin}/api/x/accounts`).then((r) =>
      r.json(),
    );
    // Filtered rather than counted outright: the table legitimately holds the
    // seeded reporters as well, and a test that asserts on the whole table is
    // asserting on whatever else has ever run.
    const mine = body.accounts.filter((a) => a.username.startsWith("sc_test_"));
    assert.equal(mine.length, ALL.length);
  });

  test("an account can be added, changed and removed without a deploy", async () => {
    const added = await fetch(`${server.origin}/api/x/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ username: "@SC_Test_Added", priority: "high" }),
    }).then((r) => r.json());

    assert.equal(added.ok, true);
    // Stored lowercase and without the @, so the same reporter cannot become
    // two rows.
    assert.equal(added.account.username, "sc_test_added");
    assert.equal(added.account.priority, "high");
    assert.equal(added.account.includeReplies, false);

    const patched = await fetch(`${server.origin}/api/x/accounts/sc_test_added`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ includeReplies: true, enabled: false }),
    }).then((r) => r.json());

    assert.equal(patched.account.includeReplies, true);
    assert.equal(patched.account.enabled, false);

    const removed = await fetch(`${server.origin}/api/x/accounts/sc_test_added`, {
      method: "DELETE",
      headers: AUTH,
    }).then((r) => r.json());
    assert.equal(removed.ok, true);

    const after = await fetch(`${server.origin}/api/x/accounts`).then((r) =>
      r.json(),
    );
    assert.ok(!after.accounts.some((a) => a.username === "sc_test_added"));
  });

  test("a bad handle is refused rather than stored", async () => {
    const res = await fetch(`${server.origin}/api/x/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ username: "not a handle!" }),
    });
    assert.equal(res.status, 400);
  });

  test("status reports what the poller is doing", async () => {
    const body = await fetch(`${server.origin}/api/x/status`).then((r) => r.json());
    assert.equal(body.enabled, true);
    assert.equal(body.provider, "public");
    assert.ok(body.ticks >= 1);
  });
});

describe("posts pushed in from elsewhere", () => {
  /** A post in the camelCase shape a collector is most likely to already hold. */
  const pushed = (overrides) => ({
    id: "9910000000000000001",
    text: "Chiefs are signing WR Pushed Player to a one-year deal, per sources.",
    createdAt: new Date().toISOString(),
    author: { userName: REPORTER, name: "Test Reporter" },
    ...overrides,
  });

  async function push(body, headers = AUTH) {
    const res = await fetch(`${server.origin}/api/x/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  test("a pushed post lands in the feed like any other", async () => {
    const { status, body } = await push({ posts: [pushed()] });

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.stored, 1);

    const { rows } = await client.query(
      "SELECT * FROM news_items WHERE id = $1",
      ["x-9910000000000000001"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_type, "x");
    assert.equal(rows[0].author_handle, REPORTER);
    assert.equal(
      rows[0].link,
      `https://x.com/${REPORTER}/status/9910000000000000001`,
    );

    // It went through the SAME pipeline, so it is tagged the same way.
    const { rows: posts } = await client.query(
      "SELECT * FROM x_posts WHERE post_id = $1",
      ["9910000000000000001"],
    );
    assert.equal(posts[0].category, "transaction");
    assert.equal(posts[0].news_item_id, "x-9910000000000000001");
  });

  test("pushing the same post again stores nothing", async () => {
    const { body } = await push({ posts: [pushed()] });
    assert.equal(body.kept, 1, "it still passes the filters");
    assert.equal(body.stored, 0, "but the archive already had it");

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM x_posts WHERE post_id = $1",
      ["9910000000000000001"],
    );
    assert.equal(rows[0].n, 1);
  });

  test("the author's own toggles apply to a pushed post too", async () => {
    // The fixture account leaves replies off, so this is dropped — the push
    // route is not a way around an account's configuration.
    const { body } = await push({
      posts: [
        pushed({ id: "9910000000000000002", isReply: true, conversationId: "1" }),
      ],
    });
    assert.equal(body.kept, 0);
    assert.equal(body.stored, 0);
  });

  test("a bare array works, and so does any vendor shape", async () => {
    const { status, body } = await push([
      // X's own v1.1 shape, rather than the camelCase one above.
      {
        id_str: "9910000000000000003",
        full_text:
          "Ravens QB Test Passer was limited at practice with a knee injury.",
        created_at: new Date().toUTCString().replace("GMT", "+0000"),
        user: { screen_name: REPORTER, name: "Test Reporter" },
      },
    ]);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.stored, 1);

    const { rows } = await client.query(
      "SELECT category FROM x_posts WHERE post_id = $1",
      ["9910000000000000003"],
    );
    assert.equal(rows[0].category, "injury");
  });

  test("a post from a reporter nobody has configured still works", async () => {
    const { body } = await push({
      posts: [
        pushed({
          id: "9910000000000000004",
          author: { userName: "some_unconfigured_reporter", name: "Someone" },
        }),
      ],
    });
    // Default rules: an original post is kept.
    assert.equal(body.stored, 1);

    const { rows } = await client.query(
      "SELECT author_handle FROM news_items WHERE id = $1",
      ["x-9910000000000000004"],
    );
    assert.equal(rows[0].author_handle, "some_unconfigured_reporter");
  });

  test("a push does not move the poller's watermark", async () => {
    // A push says what one collector saw. Advancing last_seen_post_id past it
    // would tell the poller to skip a range it may cover differently — and the
    // pushed ids are far higher than anything real.
    const { rows } = await client.query(
      "SELECT last_seen_post_id FROM x_monitored_accounts WHERE username = $1",
      [REPORTER],
    );
    assert.notEqual(rows[0].last_seen_post_id, "9910000000000000001");
  });

  test("junk is refused with a reason rather than stored", async () => {
    const empty = await push({ posts: [] });
    assert.equal(empty.status, 400);

    const unusable = await push({ posts: [{ text: "no id at all" }] });
    assert.equal(unusable.status, 400);
    assert.match(unusable.body.rejected[0], /no usable post id/);

    const tooMany = await push({
      posts: Array.from({ length: 201 }, (_, i) =>
        pushed({ id: `991000000000000${1000 + i}` }),
      ),
    });
    assert.equal(tooMany.status, 413);
  });

  test("the push route is guarded like every other write", async () => {
    const posts = [pushed({ id: "9910000000000000005" })];
    assert.equal((await push({ posts }, {})).status, 401);
    assert.equal((await push({ posts }, { "x-ingest-secret": "wrong" })).status, 401);

    const { body } = await push({ posts });
    assert.equal(body.stored, 1);
  });
});

describe("real-time delivery by webhook", () => {
  const KEY = "webhook-test-key";

  /** A delivery in the provider's documented envelope. */
  const delivery = (tweets) => ({
    event_type: "tweet",
    rule_id: "rule_test",
    rule_tag: "statchasers-nfl-1-of-1",
    tweets,
    timestamp: Date.now(),
  });

  const tweetFor = (id, overrides = {}) => ({
    id,
    text: "Sources: Colts are signing TE Test Target to a three-year deal.",
    author: { id: "9", username: REPORTER, name: "Test Reporter" },
    created_at: new Date().toISOString(),
    ...overrides,
  });

  async function deliver(body, key = KEY) {
    const res = await fetch(`${server.origin}/api/x/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key === null ? {} : { "X-API-Key": key }),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  test("a delivered post is in the feed", async () => {
    const { status, body } = await deliver(
      delivery([tweetFor("9930000000000000001")]),
    );

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.stored, 1);

    const rows = await client
      .query("SELECT * FROM news_items WHERE id = $1", ["x-9930000000000000001"])
      .then((r) => r.rows);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_type, "x");
    assert.equal(rows[0].author_handle, REPORTER);
    assert.equal(
      rows[0].link,
      `https://x.com/${REPORTER}/status/9930000000000000001`,
    );

    // Same pipeline as a polled post, so the same tagging.
    const posts = await client
      .query("SELECT category FROM x_posts WHERE post_id = $1", [
        "9930000000000000001",
      ])
      .then((r) => r.rows);
    assert.equal(posts[0].category, "transaction");
  });

  test("the same post delivered twice is stored once", async () => {
    // Providers retry, and a rule that overlaps another delivers twice. Neither
    // may produce a second card.
    const first = await deliver(delivery([tweetFor("9930000000000000002")]));
    const second = await deliver(delivery([tweetFor("9930000000000000002")]));

    assert.equal(first.body.stored, 1);
    assert.equal(second.body.stored, 0);
    assert.equal(second.status, 200, "a retry must still be acknowledged");

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM x_posts WHERE post_id = $1",
      ["9930000000000000002"],
    );
    assert.equal(rows[0].n, 1);
  });

  test("a delivery with several posts stores all of them", async () => {
    const { body } = await deliver(
      delivery([
        tweetFor("9930000000000000003"),
        tweetFor("9930000000000000004", {
          text: "QB Test Passer is questionable with an ankle injury.",
        }),
      ]),
    );
    assert.equal(body.stored, 2);
  });

  test("the account's toggles apply to delivered posts too", async () => {
    // Replies are off for this account, and a webhook is not a way around that
    // — the rule matched and we were billed, but it is still not news.
    const { body } = await deliver(
      delivery([
        tweetFor("9930000000000000005", {
          isReply: true,
          conversationId: "1",
        }),
      ]),
    );
    assert.equal(body.kept, 0);
    assert.equal(body.stored, 0);
  });

  test("a delivery without the right key is refused", async () => {
    const wrong = await deliver(delivery([tweetFor("9930000000000000006")]), "nope");
    assert.equal(wrong.status, 401);

    const missing = await deliver(delivery([tweetFor("9930000000000000006")]), null);
    assert.equal(missing.status, 401);

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM x_posts WHERE post_id = $1",
      ["9930000000000000006"],
    );
    assert.equal(rows[0].n, 0, "an unauthorized delivery must store nothing");
  });

  test("a ping is acknowledged, not mistaken for posts", async () => {
    const { status, body } = await deliver({ event_type: "ping" });
    assert.equal(status, 200);
    assert.equal(body.ignored, "ping");
  });

  test("an unreadable delivery is acknowledged rather than retried forever", async () => {
    // 2XX on purpose: a payload we cannot parse will not parse on the retry
    // either, and a provider re-sending it hourly helps nobody.
    const { status, body } = await deliver(
      delivery([{ text: "no id at all" }]),
    );
    assert.equal(status, 200);
    assert.equal(body.received, 0);
    assert.match(body.rejected[0], /no usable post id/);
  });

  test("the rules endpoint describes what to register", async () => {
    const body = await fetch(`${server.origin}/api/x/webhook/rules`).then((r) =>
      r.json(),
    );

    assert.equal(body.ok, true);
    assert.ok(body.rules.length >= 1);
    for (const rule of body.rules) {
      assert.ok(rule.value.startsWith("from:"));
      assert.ok(rule.length <= 255);
    }
    // Only enabled accounts: a rule for a disabled reporter would match, bill,
    // and be discarded on arrival.
    assert.ok(!body.rules.some((r) => r.value.includes(DISABLED)));
    assert.equal(body.webhookConfigured, true);
  });
});

/**
 * Last, deliberately: being rate-limited pauses every account, so anything
 * after this would be asserting against a poller that is asleep.
 */
describe("being rate limited", () => {
  test("pauses the whole poller, not just the account that got the 429", async () => {
    await fetch(`${server.origin}/api/x/accounts/${LIMITED}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ enabled: true }),
    });

    const first = await sweep();
    assert.ok(first.checked >= 1);
    assert.ok(
      first.accounts.some((a) => a.username === LIMITED && /429/.test(a.error)),
      JSON.stringify(first.accounts),
    );

    // The next sweep does no work at all — and, importantly, claims nothing, so
    // no account burns its due time on a tick that was never going to run.
    const second = await sweep();
    assert.equal(second.checked, 0);
    assert.ok(second.cooldownMs > 0);

    const before = hits[REPORTER];
    await sweep();
    assert.equal(hits[REPORTER], before, "no outbound request while paused");
  });
});
