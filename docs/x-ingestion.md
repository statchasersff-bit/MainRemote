# X (Twitter) reporter posts in the news feed

> ## Status: built and tested, switched OFF. Resume here.
>
> Everything in this document is implemented and covered by tests (223 passing).
> Nothing is live: `X_NEWS_INGESTION_ENABLED` is unset, no X post has ever been
> stored in the archive, and the 37 seeded accounts sit idle with no watermarks.
>
> **The one open decision is which source to fund.** The free public route was
> measured and will not carry this watchlist (see `public` below). Three paid
> routes are built and waiting for a credential:
>
> | Route | Cost here | To go live |
> |---|---|---|
> | **Webhook** (recommended) | ~$2.50/mo | the four steps under "Real-time delivery by webhook" |
> | `X_PROVIDER=api` (polling a reseller) | ~$48/mo | set `X_API_URL` + `X_API_KEY` |
> | `X_PROVIDER=official` (X API v2) | ~$80–110/mo | set `X_API_BEARER_TOKEN` |
>
> The webhook route is both the cheapest and the freshest because it bills per
> matched post instead of per request - at 37 accounts, polling pays ~320,000
> times a month to be told "nothing new".
>
> **Verified so far:** the whole pipeline end to end against a fixture provider
> and a real delivery in the vendor's documented envelope (a Schefter post
> arrived, was tagged Christian McCaffrey / SF / Injury, and rendered at the top
> of the feed). **Not verified:** the vendor's own side, which needs an API key.
>
> **First thing to do next time:** decide the route, set the credential, and run
> `node scripts/x-webhook-rules.mjs` (dry run - it prints, it does not spend).

Public posts from a configurable list of NFL reporters are pulled into the
**existing** news tool: same table, same dedupe, same feed, same team pages,
same filters. There is no separate X application and no separate X page.

```
x_monitored_accounts  (the list, in the database)
        │
        ▼
XPostProvider         (public timeline | official API | anything later)
        │
        ▼
polling queue         (claim-by-UPDATE, staggered, backed off)
        │
        ▼
normalize  →  dedupe on post id  →  storeItems()   ← the SAME call the wire
        │                                             and the club feeds use
        ▼
player / team / category detection (the tool's own indexes)
        │
        ▼
news_items  →  /api/news  →  the feed, the filters, the team pages
```

## Turning it on

```
X_NEWS_INGESTION_ENABLED=true
```

Off by default. While it is off the scheduler never starts, nothing outbound is
ever requested, and the news tool behaves exactly as it did before the feature
existed. `/api/x/status` reports which state it is in.

## Managing reporters

`/admin/x` - add, remove, enable, disable, re-prioritise, and toggle
originals / replies / reposts / quotes per account. Adding a reporter is a row,
not a deploy.

Writes are guarded by `INGEST_SECRET` (the same secret `POST /api/ingest`
already uses, sent as `x-ingest-secret`); the page asks for it once per tab. If
`INGEST_SECRET` is unset every write answers 503 - the same shared guard
(`src/lib/ingest-auth.ts`) as `POST /api/ingest` and `POST /api/fpa/ingest`.

The 37 seed handles are in `src/lib/x/accounts.ts` and are applied
**additively** at startup: a row you disabled stays disabled, a priority you
changed stays changed, a reporter you removed does not come back.

## Providers

| `X_PROVIDER` | What it reads | Cost at this volume | Current? |
|---|---|---|---|
| `public` (default) | the profile timeline X publishes for embed widgets | free | **no - see below** |
| `api` | any commercial JSON API that resells X posts | ~$0.02–$0.15 per 1,000 posts | yes |
| `official` | X API v2 `/2/users/:id/tweets` | ~$0.005 per post read | yes |
| *(none)* | a provider's **webhook** pushes to us - see below | ~$0.00015 per matched tweet | yes, seconds |

Switching is two environment variables and a restart. Nothing else in the
application knows which one produced a post - that is what `XPostProvider` in
`src/lib/x/types.ts` is for.

### `public` - free, and measured

Two hard limits, both measured from this deployment on 2026-09-16 rather than
assumed:

1. **It is often stale.** The endpoint serves a cached, partly curated slice of
   a timeline, not a live chronological one. `@tompelissero` came back current
   to ~8 days; `@adamschefter` and `@rapsheet` returned months-old "greatest
   hits" sets with a pinned post on top.
2. **It rate-limits by IP, hard.** Twelve requests spaced **nine seconds apart**
   were all refused with `429`. An occasional single request succeeds again
   after a few minutes' idle.

So this route can carry a handful of reporters at a slow cadence. It cannot
carry a 37-account watchlist at any cadence, and the scheduler says so at
startup when more than eight accounts are enabled on it.

A `429` pauses **all** polling for `X_RATE_LIMIT_COOLDOWN_MS` (default 5 min) -
not just the account that received it, because the budget being spent is the
IP's, not the account's.

### `api` - the route to current posts at this price point

```
X_PROVIDER=api
X_API_URL=https://<vendor>/...?userName={username}&sinceId={sinceId}&count={limit}
X_API_KEY=...                 # sent as X-API-Key; override with X_API_KEY_HEADER
# or: X_API_BEARER_TOKEN=...  # sent as Authorization: Bearer
```

`{username}`, `{sinceId}` and `{limit}` are filled in; a query parameter whose
placeholder resolves to empty is dropped rather than sent blank.

One adapter rather than one per vendor, because they all mirror X's own tweet
object and differ only in spelling. The normalizer reads `id_str` / `id` /
`tweet_id` / `rest_id`, `full_text` / `text` / `content`, `created_at` /
`createdAt` / epoch seconds or milliseconds, `user.screen_name` /
`author.userName`, and detects reposts, replies and quotes from nested objects,
`referenced_tweets`, boolean flags, or an `RT @` prefix. The posts array is
found wherever the vendor put it (`data`, `tweets`, `data.tweets`, `results`, or
a bare array). All three shapes are pinned by `tests/x-rest-provider.test.mjs`.

This adapter does no scraping of its own - it is an HTTP client for an API the
operator has an account with. **These vendors obtain their data by scraping X,
and X's terms prohibit that**; the exposure sits with the vendor, the service
may break or disappear, and that is worth knowing before depending on one.

### `official` - authoritative, and priced accordingly

The `$200/month` Basic tier closed on 2026-06-01; new developers are on
pay-per-use at **$0.005 per post read**, capped at 2M reads/month. For 37
reporters that is roughly **$80–110/month**, not the $10–30 originally assumed.
`since_id` is passed on every call, so only new posts are ever read and billed.

### Push - posts this server did not fetch

```
POST /api/x/posts          # guarded by INGEST_SECRET
{"posts": [ ... ]}         # or a bare array
```

The counterpart to the poller, and the same idea as `POST /api/ingest`'s push
mode: whatever collected the posts is not this server's concern, and everything
after they arrive is. A pushed post goes through **the same `ingestPosts()`**
a polled post does - deduplicated on its post id, filtered by its author's
toggles, tagged with player, team and category, rendered on the same card.

The body is tolerant: a bare array or `{posts: [...]}`, with each post in the
normalized shape or any vendor shape the `api` provider understands. Whatever
your collector already holds is very likely postable unchanged.

```
X_PUSH_URL=https://<deployment>/api/x/posts INGEST_SECRET=...   node scripts/x-push.mjs posts.json        # or: ... | node scripts/x-push.mjs -
```

Notes:

* Push does **not** require `X_NEWS_INGESTION_ENABLED`. That flag governs
  whether this server polls anyone, which is a different question from whether
  it accepts posts you hand it.
* Push does **not** move a monitored account's `last_seen_post_id`. A push says
  what one collector saw; advancing the watermark past it would tell the poller
  to skip a range it may cover differently. Double-storage is already
  impossible, so there is nothing to gain by risking a gap.
* `maxAgeDays` in the body raises the age cutoff (capped at 365) for a
  deliberate backfill.
* 200 posts per request; the script batches for you.

This is the seam that keeps acquisition and storage separate. If you run a
collector under your own arrangement - an enterprise credential, a vendor
export, a permitted crawler, or a person with a keyboard - it drives the feed
without any change to the news tool.

### Real-time delivery by webhook - the cheapest and freshest route

Polling asks 37 questions every five minutes and is told "nothing new" almost
every time. A filter rule inverts it: the provider watches the accounts and
POSTs only when one of them posts. Lower latency, fewer moving parts here, and
with a provider that bills per *matched tweet* rather than per request, roughly
**20× cheaper** - because you stop paying for the silence.

Worked example with twitterapi.io (any provider with filter rules + webhooks
fits the same shape):

**1. See what needs registering** - built from the accounts enabled right now:

```
X_RULES_URL=https://<deployment>/api/x/webhook/rules node scripts/x-webhook-rules.mjs
```

The 37 seeded reporters come to ~740 characters as `from:` terms and the
provider caps a rule's filter at **255**, so this chunks them - currently into
three rules of 12–13 handles. Also shown in `/admin/x` under "Real-time filter
rules".

**2. Register them** (this is the step that starts costing money, so it is
explicit and never happens automatically):

```
X_RULES_URL=... X_API_KEY=<provider key> X_WEBHOOK_URL=https://<deployment>/api/x/webhook   node scripts/x-webhook-rules.mjs --register [--exclude-retweets] [--interval 60]
```

Keep the printed `rule_id`s - they are the only handle on a rule that is billing.

**3. Configure the app to accept deliveries:**

```
X_WEBHOOK_SECRET=<the key the provider will send in X-API-Key>
```

Without it the endpoint answers `503` and stores nothing - an unguarded public
URL that writes into the archive is a way to put arbitrary headlines on the
page, which is the same call `POST /api/ingest` makes about its push mode.

**4. Turn the poller off.** Webhook delivery needs neither
`X_NEWS_INGESTION_ENABLED` nor `X_PROVIDER`; running on webhooks alone is the
supported, cheaper configuration. Leave the poller on only as a backstop.

How the endpoint behaves, and why:

| Situation | Response | Reason |
|---|---|---|
| Good delivery | `200` + counts | |
| Wrong/missing key | `401` | nothing is stored |
| No `X_WEBHOOK_SECRET` set | `503` | refuses rather than accepting anonymous writes |
| `event_type` other than `tweet` | `200 {ignored}` | a ping is not zero posts |
| Body it cannot parse | `200` | retrying it produces the same nothing |
| Storage failed | `500` | this one *is* worth retrying |

`--exclude-retweets` appends `-filter:retweets` to every rule. Worth it when no
account has reposts switched on: a tweet excluded at the provider is never
matched, never delivered and never billed, whereas one dropped by our own
`shouldKeep()` has already been paid for. It is not applied automatically,
because the rules are global and the repost toggle is per account.

### What is deliberately NOT built

Scraping guides for X converge on: a guest token, X's internal GraphQL
endpoints with rotating `doc_id`s, headless browser rendering, residential
proxy rotation, and a commercial anti-bot-bypass flag. That is
access-control circumvention and evasion, it is explicitly out of scope for this
project, and none of it is in this codebase. Only publicly served content is
read, with an honest User-Agent, one request at a time, backing off when asked
to. If the free route is not enough - and measurably it is not - the answer is
to pay a provider, not to work around a refusal.

## Polling

Every `X_POLL_TICK_MS` (default 30s) the poller claims up to `X_POLL_BATCH`
(default 4) accounts whose own interval has elapsed - so 37 accounts on a
5-minute cadence spread themselves across ten ticks instead of arriving as one
burst of 37 requests.

| Setting | Default | |
|---|---|---|
| `X_POLL_INTERVAL_MS` | 5 min | normal priority |
| `X_POLL_INTERVAL_HIGH_MS` | 3 min | the national insiders |
| `X_POLL_INTERVAL_LOW_MS` | 20 min | |
| `X_POLL_JITTER` | 0.15 | drift, so accounts don't re-form a burst after a restart |
| `X_POLL_BACKOFF_CAP_MS` | 1 hour | ceiling on `interval × 2^failures` |
| `X_MAX_POST_AGE_DAYS` | 7 | older posts are never backfilled |
| `X_FETCH_TIMEOUT_MS` | 15s | per request |
| `X_POLL_REQUEST_GAP_MS` | 2s | pause between the requests inside one tick |
| `X_RATE_LIMIT_COOLDOWN_MS` | 5 min | how long a 429 pauses **all** polling |
| `X_SEED_ACCOUNTS` | on | off for tests |
| `X_WEBHOOK_SECRET` | - | the key a delivery must present; falls back to `X_API_KEY` |

**The claim is the write.** An account is moved to `last_checked_at = now()` by
an UPDATE whose WHERE clause still contains the due test, so two instances - or
a restart overlapping the tick it interrupted - cannot both claim it. There is
no in-memory queue to lose and no lock to leak, which is why a restart is
uneventful and why a post cannot be processed by two jobs.

## Deduplication

The X post id, everywhere:

* `x_posts.post_id` is the primary key, and the insert is `ON CONFLICT DO NOTHING`;
* the news row's id is `x-<postId>` and its `dedupe_key` is `x:<postId>` (unique index).

Note this is deliberately **not** the title fingerprint the wire uses: reporters
post the same sentence about two different players routinely, and a content
fingerprint would silently keep one and drop the other.

## What ends up in the feed

Default per account: original posts, plus quote posts that carry meaningful text
of their own. Excluded: pure reposts, routine replies, and anything older than
the age cutoff. All four are per-account toggles.

Each post is run through the tool's **existing** intelligence: the Sleeper
roster index resolves the player named in the text (and his team with him, which
is a fact rather than a guess), the club map resolves a single named team, and
`lib/news-category.ts` classifies it - injury, transaction, practice, depth
chart, rumor, fantasy, other. Category is **derived at read time and never
stored**, so improving the rules re-reads the whole archive with no backfill.

The card is the same card as every other one, with the reporter's name and
handle in the label slot the section tag used to occupy, and a hairline down the
left edge. Filters gained Source, X account and Category alongside the existing
player search and team picker; they are DOM filters like the existing ones, so
no new URL state and nothing for a crawler to index.

## Failure safety

* X ingestion cannot throw into startup, into a request, or into another provider.
* A failing account is recorded and backed off; the other 36 carry on.
* A `200` carrying an unparseable document is a **failure**, not a quiet success -
  the shape of this endpoint changes without notice and must not look like
  "the reporters went quiet".
* Logs are `[X INGEST]`-prefixed; per-post and per-failure lines only, so a quiet
  sweep writes nothing.

## Endpoints

| | |
|---|---|
| `GET /api/x/accounts` | the monitored list (open) |
| `POST /api/x/accounts` | add (guarded) |
| `PATCH /api/x/accounts/:username` | enable, priority, post-kind toggles (guarded) |
| `DELETE /api/x/accounts/:username` | stop monitoring; keeps the posts (guarded) |
| `POST /api/x/accounts/seed` | re-apply the seed list, additively (guarded) |
| `POST /api/x/ingest` | run a sweep now (guarded) |
| `POST /api/x/posts` | store posts collected elsewhere (guarded) |
| `POST /api/x/webhook` | a provider's real-time delivery (guarded by `X_WEBHOOK_SECRET`) |
| `GET /api/x/webhook/rules` | the filter expressions for the current watchlist |
| `GET /api/x/status` | is the poller running, and what did it last do |
| `GET /admin/x` | the management page |
