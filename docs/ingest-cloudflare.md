# The news ingest and Cloudflare

**Runbook for:** production shows stale news, and `GET /api/status` reports a
`403: Forbidden` whose body starts `<!DOCTYPE html>...<title>Just a moment...</title>`.

**Resolved 2026-08-20 14:00 UTC.** The ingest now calls Dynasty Command's Replit
address directly, authenticated with a scoped key, so Cloudflare is not in the
path. Bot Fight Mode is still on at full strength and nothing in Cloudflare was
changed. See [The fix](#the-fix).

For context on how bad it got: 53 consecutive failures, no successful ingest for
roughly 17 hours, archive frozen at 2026-08-19 19:31 while upstream kept moving.

**Just want the steps?** → [`INGEST-FIX-CHECKLIST.md`](./INGEST-FIX-CHECKLIST.md)

---

## What is actually happening

`api.statchasers.com` is a Replit deployment sitting behind Cloudflare. Cloudflare
challenges the **news deployment's** requests with its JavaScript interstitial
("Just a moment…"). A server cannot solve a JS challenge, so the ingest gets a
403 every time and the archive stops moving.

Three things are worth knowing before changing anything:

- **The feed URL is not wrong.** This is not a misconfigured environment variable.
  `/api/status` reports the host it actually resolved.
- **It is scored on egress IP reputation, not on the request.** The workspace and
  the deployment send byte-identical calls - same code, same headers, same
  `User-Agent` - and only the deployment is challenged. That is why it works when
  you run it locally and fails once published, which looks contradictory until
  you read the response body.
- **Bot Fight Mode cannot be bypassed by a WAF rule.** On the Free plan it is
  zone-wide and is explicitly not compatible with the `Skip` action, custom rule
  exceptions, or page rules. Only Super Bot Fight Mode (Pro and above) can be
  skipped. Any plan that starts "add a WAF rule to allow it through" is a dead end
  unless you are on Pro.

### How to confirm it is this problem

```bash
curl -s https://newsfeed.replit.app/api/status
```

`ingest.lastError` containing `Just a moment...` is the signature. Cloudflare's
**Security → Events**, filtered to `api.statchasers.com`, shows the same requests
from the other side with their source IP, their `User-Agent`
(`StatChasersNews/1.0`), and the service that issued the challenge.

---

## The fix

Every Replit deployment stays reachable on its own `*.replit.app` hostname even
when a custom domain is attached. That hostname is **not proxied through
Cloudflare**, so Bot Fight Mode never sees the request.

The ingest therefore calls the API's Replit address - **`dynasty-command.replit.app`**,
the URL `DYNASTY_NEWS_API_URL` pointed at before `ba4cbad` (2026-08-11) - and
authenticates itself with a scoped key.

### What the gate on that address is

Dynasty Command refuses anything that did not arrive through Cloudflare.
**It is not a hostname check.** Cloudflare injects `X-Edge-Secret` on every
request it forwards to the origin; the app compares that header against
`EDGE_SECRET` with a timing-safe compare, and refuses when it does not match.
Calling the `.replit.app` address directly therefore returned
`403 {"error":"forbidden"}` - a missing header, not a wrong host.

Implementation: `server/originLock.ts`, middleware `requireEdgeSecret`, mounted
globally at `server/index.ts:306`. `/api/health` is exempt on purpose, because
Replit's platform liveness probes hit the `.replit.app` host directly.

> **Correction.** Earlier revisions of this file described a
> `req.hostname !== "api.statchasers.com"` guard and gave a code sketch for it.
> No such guard exists. The inference came from watching a non-existent path
> (`/api/v1/does-not-exist`) answer *forbidden* rather than *not found*: that
> correctly showed the gate runs before routing, but the mechanism behind it was
> guessed and the guess was wrong. Setting a `Host` header would not have helped,
> and the patch that sketch implied - opening all of `/api` to a key holder -
> would have exposed portfolio data, admin endpoints and valuation models. What
> shipped is deliberately much narrower.

### The exception that shipped

A second exception in the same middleware, checked *before* the edge-secret check
so a valid key short-circuits it:

| | |
|---|---|
| Header | `X-SC-Ingest-Key` |
| Compared against | `SC_INGEST_KEY` (Dynasty Command deployment secret) |
| Comparison | timing-safe, same as the edge check |
| Methods | `GET` and `HEAD` only |
| Paths | `/api/news` and `/api/news/…` only, prefix-exact |
| When unset | the exception does not exist; everything 403s as before |

**This is a feed key, not an API credential**, and the scoping is why it could be
granted at all: the key lives in the news deployment, outside the system it opens,
so a leak from this side exposes aggregated public NFL headlines and nothing else.

- Any path outside `/api/news` 403s even with a valid key. `/api/newsletter` is
  **not** covered by the `/api/news` prefix.
- Writes are refused - `POST`/`PUT`/`PATCH`/`DELETE` 403 with a valid key.
- Need something outside `/api/news`? **Name the endpoint and ask.** Do not assume
  the key reaches it, and do not work around a refusal.
- **Do not ask for `EDGE_SECRET`.** It would work, and it would hand this
  deployment the master key to the entire protected API surface.
- **Do not add a Cloudflare bot-management bypass** to come through the front door
  instead. Routing around Cloudflare for one authenticated caller is strictly
  safer than punching a hole in it for everyone.

### Configuration, both sides

**Dynasty Command deployment**

```
SC_INGEST_KEY = <the shared key>
```

**News archiver deployment**

```
DYNASTY_NEWS_API_KEY = <the same shared key>
DYNASTY_NEWS_API_URL = https://dynasty-command.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

`api.statchasers.com` stays **last** on purpose: the list is tried in order, so if
the direct route ever breaks, behaviour degrades to the old path rather than going
dark. `.replit`'s `[userenv.shared]` carries the same value but configures the
workspace only.

> **Replit gotcha - this cost most of an hour.** A newly added secret is **not**
> picked up by a publish; the process keeps the environment it booted with. It
> needs a full **Stop → Start**. Also reload the secrets pane and confirm the value
> is still listed before concluding anything: one silently failed to save and
> vanished from the pane.

### The other way this can fail: a redirect

If the API ever 301s its `*.replit.app` hostname to the canonical domain, Node's
`fetch` follows it by default, the request lands back on Cloudflare, and it fails
looking **exactly** like the original bug - same challenge page, same error string.
Check with:

```bash
curl -s -o /dev/null -w 'status=%{http_code} redirects=%{num_redirects} final=%{url_effective}\n' \
  -L https://dynasty-command.replit.app/api/news/nfl
```

Want `redirects=0` and a `final` URL still on `*.replit.app`.

### Verifying

```bash
curl -s https://newsfeed.replit.app/api/status
```

```jsonc
{
  "feedHosts": ["dynasty-command.replit.app", "api.statchasers.com"],
  "feedKeyConfigured": true,
  "ingest": {
    "lastSource": "dynasty-command.replit.app",  // the direct route won, not the edge
    "lastError": null,
    "consecutiveFailures": 0
  }
}
```

**`/api/status` is the authoritative check.** It was right at every stage of this
incident and should have been trusted sooner.

**Dynasty Command's request log cannot help you.** The origin lock is mounted at
`server/index.ts:306` and the request logger at `server/index.ts:415`, so a refused
request is answered and dropped 109 lines before the logger ever sees it - a 403
from that gate leaves **no log line at all**. During this incident that log showed
a clean run of `GET /api/news/nfl 200` every ten minutes, which looked exactly like
this archiver succeeding. It was the Dynasty site's own news ticker, coming through
Cloudflare from browsers. Absence of errors there is not evidence of anything.

What does report it is Dynasty Command's startup posture line:

```
news archiver origin exception (GET /api/news only) ... ON | INERT
```

`INERT` means `SC_INGEST_KEY` is not in that deployment's environment; no amount of
debugging on this side will help until it reads `ON`.

| Symptom | Meaning |
|---|---|
| `lastError` contains `Just a moment...` | Went through Cloudflare. The direct URL is not being used, or the list fell back to it. |
| `lastError` contains `{"error":"forbidden"}` | Reached the app; the gate refused. Key missing or mismatched, or a path outside `/api/news`. |
| `lastError` contains `This app isn't live yet` | Replit's placeholder - the Dynasty deployment is down or restarting. Not a code or key problem. |
| `lastSource` is `api.statchasers.com` | Direct route refused, fallback carried it. News flows, but the exception is broken. |
| `feedKeyConfigured: false` | `DYNASTY_NEWS_API_KEY` never reached the news deployment. New secrets need Stop → Start. |
| `feedHosts` still only `api.statchasers.com` | Value set on the workspace, not the deployment - or not restarted. |
| `lastError: null` but the page looks stale | Not this problem. Staleness is bounded to 60s by `FRESHNESS_MAX_AGE_MS`; compare `archive.newestContentAt` against the feed. |

---

## Alternatives, if the origin path stops working

### Push instead of pull

Reverse the direction: anything that can read the feed POSTs the items to the
news app, so this server makes no outbound call and Cloudflare is not in the
path. Outbound requests *from* the API are not touched by Bot Fight Mode either,
so the problem disappears structurally rather than being routed around.

`POST /api/ingest` accepts `{"items":[...]}` today, and `scripts/ingest.mjs`
drives it (set `FEED_URL` to switch it into push mode). It needs `INGEST_SECRET`
set on the deployment - push writes caller-supplied content straight into the
archive, so it is refused without one. `/api/status` reports
`pushModeAvailable`.

Structurally the soundest option, and the only one that survives any future
change to Cloudflare's scoring or Replit's hostnames.

### Super Bot Fight Mode (Pro) - rejected, kept for the record

**Do not pursue this.** Punching a bot-management hole in the edge for this caller
is strictly worse than routing one authenticated caller around it, and the API
owner has ruled it out. Documented only so nobody re-derives it as a fresh idea.

On Pro, Bot Fight Mode becomes skippable and everything can keep flowing through
Cloudflare with protection intact. The rule would be:

**Security → WAF → Custom rules → Create rule**, ordered **first**:

```
http.host eq "api.statchasers.com"
and starts_with(http.request.uri.path, "/api/news")
and any(http.request.headers["x-sc-ingest-key"][*] == "<SECRET>")
```

Action `Skip`, skipping Super Bot Fight Mode, Browser Integrity Check, Security
Level, and all remaining custom rules.

Generate `<SECRET>` with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`,
set it as `DYNASTY_NEWS_API_KEY` on the deployment, and never commit it. Note the
header name must be **lowercase** in the expression (Cloudflare's header map is
lowercase-keyed) while the value is case-sensitive.

Keyed on a secret rather than on `User-Agent` because a `User-Agent` is trivially
spoofable by anyone who reads it, and would hand every scraper the same bypass.
Not IP-allowlisted because Replit's egress addresses are not guaranteed stable.

---

## After it works

Nothing is stranded by an outage of this kind as long as it is caught within the
upstream window: the feed carries roughly its latest 25 items (about a day), and
a single successful ingest backfills everything inside that window. Stories older
than the window are gone for good - upstream does not serve them and this archive
is the only store of record.

That window is why the monitoring matters more than another fallback. See
[`INGEST-FIX-CHECKLIST.md` → Monitoring](./INGEST-FIX-CHECKLIST.md#monitoring)
for `GET /api/ingest/health` (503 when the ingest has stopped, so an uptime
checker can page), its thresholds, and why an empty 200 from the feed is now
treated as a failure rather than a successful no-op.

## Related

- `replit.md` → *Architecture decisions* - why `/api/status` exists, and why the
  freshness snapshot expires on a timer as well as on invalidation. That second
  fix is what stops an outage like this from freezing the page *permanently*
  rather than merely making it stale.
- `artifacts/api-server/src/routes/news.ts` - the ingest, the outgoing headers,
  and the status endpoint.
