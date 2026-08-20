# Checklist: get production refreshing again

Background and diagnosis live in [`ingest-cloudflare.md`](./ingest-cloudflare.md).
You do not need it to follow this.

**The situation:** Cloudflare challenges the news deployment's IP in front of
`api.statchasers.com`, so the server cannot fetch the feed. Nothing in this app
can change that — the block is on Cloudflare's side and is scored on the calling
IP, not on anything in the request. What the app *can* do is take a different
route to the same data. There are three, in order of least effort.

---

## Route A — Call the API's origin instead (start here)

The origin behind `api.statchasers.com` is **`dynasty-command.replit.app`** —
the URL `DYNASTY_NEWS_API_URL` used before 2026-08-11 (`ba4cbad`). A
`*.replit.app` hostname is not proxied through Cloudflare, so Bot Fight Mode
never sees the request. No guessing required, and no Cloudflare plan change.

One thing is in the way, and it is **on the API, not here**:

```bash
curl -s https://dynasty-command.replit.app/api/health      # {"status":"ok"}  ← up
curl -s https://dynasty-command.replit.app/api/news/nfl    # {"error":"forbidden"}  ← gated
```

That 403 is the API's own JSON, not a Cloudflare challenge page — the API serves
the feed only on its canonical host. It does not depend on `Origin` or
`Referer`; those were tested.

- [ ] **In the Dynasty Command API**, allow `/api/news/*` on the origin hostname.
      Either exempt that path from the canonical-host gate, or allow any host
      when the request carries `X-SC-Ingest-Key` matching a shared secret. This
      app already sends that header whenever `DYNASTY_NEWS_API_KEY` is set, so
      nothing changes on this side.

- [ ] If you took the key route, set `DYNASTY_NEWS_API_KEY` on **this**
      deployment to the same secret.

- [ ] Confirm the gate is open (want `status=200 redirects=0`, final URL still on
      `*.replit.app` — a redirect back to the public domain lands on Cloudflare
      and fails looking identical to the original bug):

```bash
curl -s -o /dev/null -w 'status=%{http_code} redirects=%{num_redirects} final=%{url_effective}\n' \
  -L https://dynasty-command.replit.app/api/news/nfl
```

- [ ] Set on the **deployment** (`.replit`'s `[userenv.shared]` already carries
      this value, but that configures the workspace only):

```
DYNASTY_NEWS_API_URL = https://dynasty-command.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

The public domain stays last as the safety net: if the origin route is refused,
behaviour is exactly what it is today, no worse.

- [ ] Publish
- [ ] Check which route won:

```bash
curl -s https://newsfeed.replit.app/api/status
```

`ingest.lastSource` names the host that actually served the feed. Want
`dynasty-command.replit.app` with `lastError: null`. If it says
`api.statchasers.com`, the list fell through — the archive is moving again, but
the origin gate is still shut and you are one Cloudflare scoring change from
another outage.

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
| `lastError` mentions `{"error":"forbidden"}` | The API's own host gate on the origin hostname, not Cloudflare. Route A step 1 is not done. |
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
