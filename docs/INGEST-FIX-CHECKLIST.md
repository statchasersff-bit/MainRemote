# Checklist: get production refreshing again

Background and diagnosis live in [`ingest-cloudflare.md`](./ingest-cloudflare.md).
You do not need it to follow this.

**The situation:** Cloudflare challenges the news deployment's IP in front of
`api.statchasers.com`, so the server cannot fetch the feed. Nothing in this app
can change that — the block is on Cloudflare's side and is scored on the calling
IP, not on anything in the request. What the app *can* do is take a different
route to the same data. There are three, in order of least effort.

---

## Route A — Let the app try several URLs (start here)

`DYNASTY_NEWS_API_URL` now accepts a **comma-separated list**. Each is tried in
order until one works, so **a wrong entry costs one failed request, not an
outage**. That makes guessing the API's origin hostname risk-free: put guesses
first, and the current URL last as the safety net.

- [ ] Set on the **deployment**:

```
DYNASTY_NEWS_API_URL = https://GUESS-1.replit.app/api/news/nfl,https://GUESS-2.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

Replace the guesses with plausible Replit app names for whatever serves
`api.statchasers.com`. Keep `https://api.statchasers.com/api/news/nfl` **last** —
if every guess misses, behaviour is exactly as it is today, no worse.

- [ ] Publish
- [ ] Check which route won:

```bash
curl -s https://newsfeed.replit.app/api/status
```

`ingest.lastSource` names the host that actually served the feed. If it is one of
your guesses and `lastError` is `null`, **you are done** — trim the list to that
one URL when convenient.

### The exact answer, if guessing gets tiresome

Cloudflare dashboard → **statchasers.com** → **DNS** → the `api` record. Whatever
it points at *is* the origin. That is the 30-second version of this whole
checklist.

---

## Route B — Push the news in instead (works regardless of Cloudflare)

If no URL works, stop trying to fetch. `POST /api/ingest` now accepts the items
in the request body, so the server makes **no outbound call at all** and
Cloudflare is not in the path. Anything that can read the feed can drive the
archive.

- [ ] Set `INGEST_SECRET` on the deployment (push mode is refused without it —
      it writes caller-supplied content straight into the archive), and publish
- [ ] Confirm `pushModeAvailable: true` in `/api/status`
- [ ] Run it from somewhere that *can* read the feed:

```bash
export INGEST_URL=https://newsfeed.replit.app/api/ingest
export FEED_URL=https://api.statchasers.com/api/news/nfl
export INGEST_SECRET=the-secret-you-just-set

node artifacts/api-server/scripts/ingest.mjs
```

Setting `FEED_URL` is what switches the script into push mode: it reads the feed
itself and posts the items. Without it, it just asks the server to pull (the old
behaviour).

- [ ] Make it automatic — point a **Replit Scheduled Deployment** at that command
      every 10 minutes, with the same three environment variables

> Whether a Scheduled Deployment can read the feed is worth checking, since it
> runs on Replit infrastructure too. Run it once by hand first. If it is also
> challenged, run the same command from any machine that isn't — a laptop cron,
> a CI job, a small VM.

---

## Route C — Cloudflare (the permanent fix)

Bot Fight Mode is zone-wide on the Free plan and **cannot be bypassed by a WAF
rule, Skip action, or page rule**. To keep pulling through `api.statchasers.com`,
one of these has to change:

- [ ] Upgrade to Pro for Super Bot Fight Mode, then add the Skip rule in
      [`ingest-cloudflare.md`](./ingest-cloudflare.md), **or**
- [ ] Add an **IP Access Rule** (Security → WAF → Tools) with action *Allow* for
      the deployment's egress IP — simpler, but Replit's egress addresses are not
      guaranteed stable, so treat it as temporary, **or**
- [ ] Turn Bot Fight Mode off

---

## Verify, whichever route you took

```bash
curl -s https://newsfeed.replit.app/api/status
```

- [ ] `ingest.lastError: null`
- [ ] `ingest.consecutiveFailures: 0`
- [ ] `ingest.lastSource` names the route that worked (a hostname, or `push`)
- [ ] `archive.newestContentAt` is within the last hour or so

Then confirm the page itself: <https://newsfeed.replit.app/>

The backlog recovers on the first successful ingest — the feed still carries
roughly its latest 25 items, which reaches back past production's newest.

### If a step fails

| Symptom | Cause |
|---|---|
| `feedHosts` does not match what you set | Value set on the workspace, not the deployment — or not republished. The value is read once at process start. |
| `lastError` mentions `Just a moment...` | That route is being challenged by Cloudflare. Try another, or Route B. |
| `lastError` mentions `404` / `ENOTFOUND` | That guess is not a real host, or the path differs. Harmless — the list falls through. |
| `all N feed routes failed` | Every route is blocked or wrong. Go to Route B. |
| Push returns `401` | `INGEST_SECRET` is unset on the server, or the header does not match. |
| `lastError: null` but the page looks stale | Not this problem. Staleness is bounded to 60s by `FRESHNESS_MAX_AGE_MS`; compare `archive.newestContentAt` against the feed. |

---

## Worth doing once this is green

This outage ran for hours unnoticed. The gap is a signal, not another fallback:

- [ ] **Alert on `/api/status`** — `ingest.consecutiveFailures > 0`, or a large
      `ingest.secondsSinceLastSuccess`, fires while the page still looks fine,
      hours before the archive visibly falls behind.
- [ ] **Watch `lastSource`.** If it names a fallback rather than your intended
      route, the primary is quietly broken and you are one failure from an
      outage.
