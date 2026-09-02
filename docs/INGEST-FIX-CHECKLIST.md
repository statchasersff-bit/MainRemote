# The news ingest: how it reaches the feed

**Resolved 2026-08-20 14:00 UTC.** The ingest calls Dynasty Command's Replit
address directly, authenticated with a scoped key, so Cloudflare is not in the
path. Bot Fight Mode stays on at full strength and nothing in Cloudflare was
changed.

```jsonc
"feedKeyConfigured": true,
"lastSource": "dynasty-command.replit.app",
"lastError": null,
"consecutiveFailures": 0,
"lastResult": { "inserted": 12, "updated": 13, "total": 25 }
```

Route A below is what is deployed. Routes B and C are kept as the alternatives
that were considered, in case the direct route ever stops working.

**The original situation:** Cloudflare challenged the news deployment's egress IP
in front of `api.statchasers.com`, so the server could not fetch the feed —
53 consecutive failures, archive ~17 hours behind. The block was scored on the
calling IP, not on anything in the request, so nothing in this app could argue
with it. What the app *could* do is take a different route to the same data.

---

## Route A — Call the API's Replit address (deployed)

A `*.replit.app` hostname is not proxied through Cloudflare, so Bot Fight Mode
never sees the request. The origin is **`dynasty-command.replit.app`** — the URL
`DYNASTY_NEWS_API_URL` pointed at before 2026-08-11 (`ba4cbad`).

### What the gate on that address actually is

Dynasty Command refuses requests that did not come through Cloudflare. **It is
not a hostname check.** Cloudflare injects `X-Edge-Secret` on every request it
forwards to the origin, and the app compares that header against `EDGE_SECRET`
with a timing-safe compare. No matching header means the request did not come
through the edge, so it is refused — which is why calling the `.replit.app`
address directly returned `403 {"error":"forbidden"}`.

> Earlier revisions of this file sketched a `req.hostname !== "api.statchasers.com"`
> guard. That guard does not exist and never did. The 403 on a path that does not
> exist (`/api/v1/does-not-exist`) does show the gate runs before routing — that
> part was right — but the refusal was a missing header, not a wrong hostname, and
> no amount of `Host`-header fiddling would have opened it.

Implementation, for reference: `server/originLock.ts`, middleware
`requireEdgeSecret`, mounted globally at `server/index.ts:306`.
`/api/health` is exempt on purpose — Replit's platform liveness probes hit the
`.replit.app` host directly.

### The exception that was added for this archiver

A second, deliberately narrow exception in the same middleware, checked *before*
the edge-secret check so a valid key short-circuits it:

| | |
|---|---|
| Header | `X-SC-Ingest-Key` |
| Compared against | `SC_INGEST_KEY` (Dynasty Command deployment secret) |
| Comparison | timing-safe, same as the edge check |
| Methods | `GET` and `HEAD` only |
| Paths | `/api/news` and `/api/news/…` only, prefix-exact |
| When unset | the exception does not exist; everything 403s as before |

**Treat this as a feed key, not an API credential.** The scoping is the reason it
could be granted at all — the key lives in *this* deployment, outside the system
it opens, so a leak here exposes aggregated public NFL headlines and nothing
else. Concretely:

- Any path outside `/api/news` returns `403 {"error":"forbidden"}` even with a
  valid key. `/api/newsletter` is **not** covered by the `/api/news` prefix.
- Writes are refused. `POST`/`PUT`/`PATCH`/`DELETE` to `/api/news/*` 403 with a
  valid key.
- If an endpoint outside `/api/news` is ever genuinely needed, **name it and ask**
  so it can be added to the prefix list on its merits. Do not assume the key
  reaches it and do not work around a refusal.
- Do not ask for `EDGE_SECRET`. It would work, and it would hand this deployment
  the master key to the entire protected API surface.
- Do not add a Cloudflare bot-management bypass to get in the front door instead.
  Routing around Cloudflare for one authenticated caller is strictly safer than
  punching a hole in it for everyone.

### Configuration, both sides

**Dynasty Command deployment**

```
SC_INGEST_KEY = <the shared key>
```

**This deployment**

```
DYNASTY_NEWS_API_KEY = <the same shared key>
DYNASTY_NEWS_API_URL = https://dynasty-command.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

Keep `api.statchasers.com` **last**. The list is tried in order, so if the direct
route ever breaks you degrade to the old behaviour instead of going dark.
`.replit`'s `[userenv.shared]` carries the same value, but that configures the
workspace only.

> **Replit gotcha — cost most of an hour.** A newly added secret is **not** picked
> up by a publish; the process keeps the environment it booted with. It needs a
> full **Stop → Start**. And reload the secrets pane to confirm the value is still
> listed before concluding anything — one silently failed to save and vanished.

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

## Verify

`GET /api/status` on this app is the authoritative check. It was right at every
stage of this incident and should be trusted sooner next time.

```bash
curl -s https://newsfeed.replit.app/api/status
```

- [ ] `ingest.lastError: null`
- [ ] `ingest.consecutiveFailures: 0`
- [ ] `ingest.lastSource` is `dynasty-command.replit.app` — the direct route, not
      the fallback
- [ ] `feedKeyConfigured: true`
- [ ] `archive.newestContentAt` is within the last hour or so

Then confirm the page itself: <https://newsfeed.replit.app/>

The backlog recovers on the first successful ingest — the feed carries roughly its
latest 25 items. Anything that ages out of that window before the ingest recovers
is gone for good; this archive is the only store of record.

### Do not diagnose this from Dynasty Command's request log

It cannot see the failure. The origin lock is mounted at `server/index.ts:306`
and the request logger at `server/index.ts:415`, so a refused request is answered
and dropped 109 lines before the logger runs — **a 403 from that gate leaves no
log line at all**.

During this incident that log showed a clean run of `GET /api/news/nfl 200` on a
tidy 10-minute cadence, which looked exactly like this archiver succeeding. It was
the Dynasty site's own news ticker, arriving through Cloudflare from browsers.
Absence of errors in that log is not evidence of anything.

What *does* report it is Dynasty Command's startup posture line:

```
news archiver origin exception (GET /api/news only) ... ON | INERT
```

`INERT` means `SC_INGEST_KEY` is not in that deployment's environment. Nothing on
this side will help until it reads `ON`.

### Reading the failure modes

| Symptom | Meaning |
|---|---|
| `lastError` contains `Just a moment...` | Went through Cloudflare. The direct URL is not being used, or the list fell back to it. |
| `lastError` contains `{"error":"forbidden"}` | Reached the app; the gate refused. Key missing or mismatched, or a path outside `/api/news`. |
| `lastError` contains `This app isn't live yet` | Replit's placeholder. The Dynasty deployment is down or restarting — not a code or key problem. |
| `lastSource` is `api.statchasers.com` | Direct route refused, fallback carried it. News flows, but the exception is broken — one Cloudflare scoring change from another outage. |
| `feedKeyConfigured: false` | `DYNASTY_NEWS_API_KEY` never reached **this** deployment. Remember a new secret needs Stop → Start, not a publish. |
| `feedHosts` does not match what you set | Value set on the workspace, not the deployment — or not restarted. Read once at process start. |
| `lastError` mentions `404` / `ENOTFOUND` | Not a real host, or the path differs. The list falls through. |
| `all N feed routes failed` | Every route is blocked or wrong. Go to Route B. |
| `lastError: null` but the page looks stale | Not this problem. Staleness is bounded to 60s by `FRESHNESS_MAX_AGE_MS`; compare `archive.newestContentAt` against the feed. |

---

## Monitoring

This outage ran for 17 hours before anyone noticed. Two things now close that gap.

### `GET /api/ingest/health` — point a monitor at this

Answers **503** when the ingest has stopped working, **200** when it is fine, so
any uptime checker (Replit's, UptimeRobot, a curl in cron) turns it into a
notification without this app needing to know how to send one. `/api/status`
always answers 200 — right for diagnosis, useless for alerting, since nothing
pages on a 200.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://newsfeed.replit.app/api/ingest/health
```

Unhealthy means either of:

| Condition | Default | Override |
|---|---|---|
| consecutive failures at or past a threshold | 3 (~30 min at the 10-minute cadence) | `INGEST_ALERT_MAX_FAILURES` |
| too long since the last success | 1 hour | `INGEST_ALERT_MAX_AGE_MS` |

Before a process's first success the age is measured from process start, so a
deployment that has *never* managed an ingest alerts rather than looking healthy
forever — the exact state production sat in for 17 hours.

The 503 body carries `reasons`, `lastError`, `lastSource` and the thresholds, so
the alert explains itself without opening the logs. It is **not** folded into
`/api/healthz`: that is the platform's liveness probe, and failing it would have
Replit restart a healthy process, which fixes nothing about a feed that is
refusing us.

### An empty feed counts as a failure

A 200 carrying zero items is treated as a bad route: the list falls through to
the next URL, and if every route comes back empty the run fails. Otherwise
`storeItems([])` would return `{inserted: 0, updated: 0}`, the run would be
recorded as a success, and the archive would freeze behind a `lastError: null`.
The feed is never legitimately empty — it carries a rolling ~25 items.

### Still worth doing by hand

- **Watch `lastSource`.** If it names the fallback rather than the direct route,
  the primary is quietly broken and you are one Cloudflare scoring change from
  another outage. Nothing alerts on this — a fallback that works looks healthy.
- **A scheduled ingest.** A Replit Scheduled Deployment pointed at
  `scripts/ingest.mjs` every 10 minutes both refreshes the data and wakes an idle
  instance.
# The news ingest: how it reaches the feed

**Resolved 2026-08-20 14:00 UTC.** The ingest calls Dynasty Command's Replit
address directly, authenticated with a scoped key, so Cloudflare is not in the
path. Bot Fight Mode stays on at full strength and nothing in Cloudflare was
changed.

```jsonc
"feedKeyConfigured": true,
"lastSource": "dynasty-command.replit.app",
"lastError": null,
"consecutiveFailures": 0,
"lastResult": { "inserted": 12, "updated": 13, "total": 25 }
```

Route A below is what is deployed. Routes B and C are kept as the alternatives
that were considered, in case the direct route ever stops working.

**The original situation:** Cloudflare challenged the news deployment's egress IP
in front of `api.statchasers.com`, so the server could not fetch the feed —
53 consecutive failures, archive ~17 hours behind. The block was scored on the
calling IP, not on anything in the request, so nothing in this app could argue
with it. What the app *could* do is take a different route to the same data.

---

## Route A — Call the API's Replit address (deployed)

A `*.replit.app` hostname is not proxied through Cloudflare, so Bot Fight Mode
never sees the request. The origin is **`dynasty-command.replit.app`** — the URL
`DYNASTY_NEWS_API_URL` pointed at before 2026-08-11 (`ba4cbad`).

### What the gate on that address actually is

Dynasty Command refuses requests that did not come through Cloudflare. **It is
not a hostname check.** Cloudflare injects `X-Edge-Secret` on every request it
forwards to the origin, and the app compares that header against `EDGE_SECRET`
with a timing-safe compare. No matching header means the request did not come
through the edge, so it is refused — which is why calling the `.replit.app`
address directly returned `403 {"error":"forbidden"}`.

> Earlier revisions of this file sketched a `req.hostname !== "api.statchasers.com"`
> guard. That guard does not exist and never did. The 403 on a path that does not
> exist (`/api/v1/does-not-exist`) does show the gate runs before routing — that
> part was right — but the refusal was a missing header, not a wrong hostname, and
> no amount of `Host`-header fiddling would have opened it.

Implementation, for reference: `server/originLock.ts`, middleware
`requireEdgeSecret`, mounted globally at `server/index.ts:306`.
`/api/health` is exempt on purpose — Replit's platform liveness probes hit the
`.replit.app` host directly.

### The exception that was added for this archiver

A second, deliberately narrow exception in the same middleware, checked *before*
the edge-secret check so a valid key short-circuits it:

| | |
|---|---|
| Header | `X-SC-Ingest-Key` |
| Compared against | `SC_INGEST_KEY` (Dynasty Command deployment secret) |
| Comparison | timing-safe, same as the edge check |
| Methods | `GET` and `HEAD` only |
| Paths | `/api/news` and `/api/news/…` only, prefix-exact |
| When unset | the exception does not exist; everything 403s as before |

**Treat this as a feed key, not an API credential.** The scoping is the reason it
could be granted at all — the key lives in *this* deployment, outside the system
it opens, so a leak here exposes aggregated public NFL headlines and nothing
else. Concretely:

- Any path outside `/api/news` returns `403 {"error":"forbidden"}` even with a
  valid key. `/api/newsletter` is **not** covered by the `/api/news` prefix.
- Writes are refused. `POST`/`PUT`/`PATCH`/`DELETE` to `/api/news/*` 403 with a
  valid key.
- If an endpoint outside `/api/news` is ever genuinely needed, **name it and ask**
  so it can be added to the prefix list on its merits. Do not assume the key
  reaches it and do not work around a refusal.
- Do not ask for `EDGE_SECRET`. It would work, and it would hand this deployment
  the master key to the entire protected API surface.
- Do not add a Cloudflare bot-management bypass to get in the front door instead.
  Routing around Cloudflare for one authenticated caller is strictly safer than
  punching a hole in it for everyone.

### Configuration, both sides

**Dynasty Command deployment**

```
SC_INGEST_KEY = <the shared key>
```

**This deployment**

```
DYNASTY_NEWS_API_KEY = <the same shared key>
DYNASTY_NEWS_API_URL = https://dynasty-command.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

Keep `api.statchasers.com` **last**. The list is tried in order, so if the direct
route ever breaks you degrade to the old behaviour instead of going dark.
`.replit`'s `[userenv.shared]` carries the same value, but that configures the
workspace only.

> **Replit gotcha — cost most of an hour.** A newly added secret is **not** picked
> up by a publish; the process keeps the environment it booted with. It needs a
> full **Stop → Start**. And reload the secrets pane to confirm the value is still
> listed before concluding anything — one silently failed to save and vanished.

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

## Verify

`GET /api/status` on this app is the authoritative check. It was right at every
stage of this incident and should be trusted sooner next time.

```bash
curl -s https://newsfeed.replit.app/api/status
```

- [ ] `ingest.lastError: null`
- [ ] `ingest.consecutiveFailures: 0`
- [ ] `ingest.lastSource` is `dynasty-command.replit.app` — the direct route, not
      the fallback
- [ ] `feedKeyConfigured: true`
- [ ] `archive.newestContentAt` is within the last hour or so

Then confirm the page itself: <https://newsfeed.replit.app/>

The backlog recovers on the first successful ingest — the feed carries roughly its
latest 25 items. Anything that ages out of that window before the ingest recovers
is gone for good; this archive is the only store of record.

### Do not diagnose this from Dynasty Command's request log

It cannot see the failure. The origin lock is mounted at `server/index.ts:306`
and the request logger at `server/index.ts:415`, so a refused request is answered
and dropped 109 lines before the logger runs — **a 403 from that gate leaves no
log line at all**.

During this incident that log showed a clean run of `GET /api/news/nfl 200` on a
tidy 10-minute cadence, which looked exactly like this archiver succeeding. It was
the Dynasty site's own news ticker, arriving through Cloudflare from browsers.
Absence of errors in that log is not evidence of anything.

What *does* report it is Dynasty Command's startup posture line:

```
news archiver origin exception (GET /api/news only) ... ON | INERT
```

`INERT` means `SC_INGEST_KEY` is not in that deployment's environment. Nothing on
this side will help until it reads `ON`.

### Reading the failure modes

| Symptom | Meaning |
|---|---|
| `lastError` contains `Just a moment...` | Went through Cloudflare. The direct URL is not being used, or the list fell back to it. |
| `lastError` contains `{"error":"forbidden"}` | Reached the app; the gate refused. Key missing or mismatched, or a path outside `/api/news`. |
| `lastError` contains `This app isn't live yet` | Replit's placeholder. The Dynasty deployment is down or restarting — not a code or key problem. |
| `lastSource` is `api.statchasers.com` | Direct route refused, fallback carried it. News flows, but the exception is broken — one Cloudflare scoring change from another outage. |
| `feedKeyConfigured: false` | `DYNASTY_NEWS_API_KEY` never reached **this** deployment. Remember a new secret needs Stop → Start, not a publish. |
| `feedHosts` does not match what you set | Value set on the workspace, not the deployment — or not restarted. Read once at process start. |
| `lastError` mentions `404` / `ENOTFOUND` | Not a real host, or the path differs. The list falls through. |
| `all N feed routes failed` | Every route is blocked or wrong. Go to Route B. |
| `lastError: null` but the page looks stale | Not this problem. Staleness is bounded to 60s by `FRESHNESS_MAX_AGE_MS`; compare `archive.newestContentAt` against the feed. |

---

## Monitoring

This outage ran for 17 hours before anyone noticed. Two things now close that gap.

### `GET /api/ingest/health` — point a monitor at this

Answers **503** when the ingest has stopped working, **200** when it is fine, so
any uptime checker (Replit's, UptimeRobot, a curl in cron) turns it into a
notification without this app needing to know how to send one. `/api/status`
always answers 200 — right for diagnosis, useless for alerting, since nothing
pages on a 200.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://newsfeed.replit.app/api/ingest/health
```

Unhealthy means either of:

| Condition | Default | Override |
|---|---|---|
| consecutive failures at or past a threshold | 3 (~30 min at the 10-minute cadence) | `INGEST_ALERT_MAX_FAILURES` |
| too long since the last success | 1 hour | `INGEST_ALERT_MAX_AGE_MS` |

Before a process's first success the age is measured from process start, so a
deployment that has *never* managed an ingest alerts rather than looking healthy
forever — the exact state production sat in for 17 hours.

The 503 body carries `reasons`, `lastError`, `lastSource` and the thresholds, so
the alert explains itself without opening the logs. It is **not** folded into
`/api/healthz`: that is the platform's liveness probe, and failing it would have
Replit restart a healthy process, which fixes nothing about a feed that is
refusing us.

### An empty feed counts as a failure

A 200 carrying zero items is treated as a bad route: the list falls through to
the next URL, and if every route comes back empty the run fails. Otherwise
`storeItems([])` would return `{inserted: 0, updated: 0}`, the run would be
recorded as a success, and the archive would freeze behind a `lastError: null`.
The feed is never legitimately empty — it carries a rolling ~25 items.

### Still worth doing by hand

- **Watch `lastSource`.** If it names the fallback rather than the direct route,
  the primary is quietly broken and you are one Cloudflare scoring change from
  another outage. Nothing alerts on this — a fallback that works looks healthy.
- **A scheduled ingest.** A Replit Scheduled Deployment pointed at
  `scripts/ingest.mjs` every 10 minutes both refreshes the data and wakes an idle
  instance.
