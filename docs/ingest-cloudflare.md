# The news ingest and Cloudflare

**Runbook for:** production shows stale news, and `GET /api/status` reports a
`403: Forbidden` whose body starts `<!DOCTYPE html>...<title>Just a moment...</title>`.

**Current status (2026-08-20): not resolved.** Production has been failing this
way since roughly 20:31 on 2026-08-19 — `consecutiveFailures: 53`, no successful
ingest since the last restart, archive ~17 hours behind upstream.

The intended fix — call the feed's Replit origin and bypass Cloudflare — is
**blocked on a change to the API**, not on anything in this repo. The origin
hostname is confirmed (`dynasty-command.replit.app`, alive: `/api/health` → 200),
but the API refuses `/api/news/*` on it. See [The fix](#the-fix).

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
  the deployment send byte-identical calls — same code, same headers, same
  `User-Agent` — and only the deployment is challenged. That is why it works when
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

The ingest should therefore call the API's Replit origin rather than its public
domain. The origin is **`dynasty-command.replit.app`** — it is what
`DYNASTY_NEWS_API_URL` pointed at before `ba4cbad` (2026-08-11) switched it to
the public domain, and it is still up.

### Step 1 — the API has to allow it (this is the blocker)

The origin hostname is reachable but the API gates the feed to its canonical
host. Measured 2026-08-20:

| Request | Result |
|---|---|
| `GET dynasty-command.replit.app/api/health` | `200 {"status":"ok"}` |
| `GET dynasty-command.replit.app/api/news/nfl` | `403 {"error":"forbidden"}` |
| `GET statchasers.com/api/news/nfl` | `403` |
| `GET api.statchasers.com/api/news/nfl` | `200` (from an unchallenged IP) |

That 403 is **the API's own**, not Cloudflare's — a JSON body, no challenge page,
and it does not depend on `Origin` or `Referer`. Until it is lifted, pointing
`DYNASTY_NEWS_API_URL` at the origin swaps one 403 for another.

In the Dynasty Command API, let `/api/news/*` through when the request arrives on
`dynasty-command.replit.app`. Two ways, either is fine:

- **Host exemption** — skip the canonical-host gate for `/api/news/*`. Simplest.
- **Key exemption** — allow any host when the request carries `X-SC-Ingest-Key`
  matching a shared secret. Tighter, and it keeps the origin path closed to
  everyone else. This app already sends that header whenever
  `DYNASTY_NEWS_API_KEY` is set, so nothing changes here.

### Step 2 — point the ingest at it

`DYNASTY_NEWS_API_URL` takes a comma-separated list, tried in order, so the
public domain stays as a safety net and a premature switch costs one failed
request rather than an outage:

```
DYNASTY_NEWS_API_URL = https://dynasty-command.replit.app/api/news/nfl,https://api.statchasers.com/api/news/nfl
```

`.replit`'s `[userenv.shared]` already carries this value, but that configures the
**workspace**. Set the same value on the **deployment** and publish — it is read
once at process start.

`ingest.lastSource` in `/api/status` then names which route actually served the
feed, so a silent fall-through to Cloudflare is visible rather than looking
healthy.

**What this costs and does not cost:**

- Bot Fight Mode stays fully on for `api.statchasers.com` and everything public.
  Only this one server-to-server call takes the direct path.
- That call gives up Cloudflare's caching and protection. It is one request per
  ten minutes from one caller to an endpoint that is public anyway, so the
  exposure is negligible.
- Keep `DYNASTY_NEWS_API_KEY` set. The ingest sends it as `X-SC-Ingest-Key` on
  every call, so the API can require it on the origin hostname if you ever want
  the direct path authenticated rather than merely obscure.

### Two ways a canonical-host rule defeats this

A "canonical host" rule on the API can express itself as either a **403** or a
**redirect**, and both land you back at a stale archive:

- **403 (what is actually happening today).** The API answers
  `{"error":"forbidden"}` on the origin hostname. Distinguishable from the
  Cloudflare block by the body: JSON, not `<!DOCTYPE html>...Just a moment...`.
- **Redirect.** If the API instead 301s `*.replit.app` → `api.statchasers.com`,
  Node's `fetch` follows it by default, the request lands back on Cloudflare, and
  it fails looking **exactly** like the original bug — same challenge page, same
  error string in `/api/status`.

Check before you rely on it:

```bash
API_APP=dynasty-command

curl -s -o /dev/null -w 'status=%{http_code} redirects=%{num_redirects} final=%{url_effective}\n' \
  -L "https://$API_APP.replit.app/api/news/nfl"
```

You want `status=200`, `redirects=0`, and a `final` URL still on `*.replit.app`.
(Use the variable — a literal `<api-app>` in a shell is read as input
redirection.) As of 2026-08-20 this reports `status=403 redirects=0`, which is
the host gate in [Step 1](#step-1--the-api-has-to-allow-it-this-is-the-blocker),
not a redirect.

### Verifying after publish

```bash
curl -s https://newsfeed.replit.app/api/status
curl -s -X POST https://newsfeed.replit.app/api/ingest
```

Looking for:

```jsonc
{
  "feedConfigured": true,
  "feedHosts": ["dynasty-command.replit.app", "api.statchasers.com"],
  "ingest": { "lastSource": "dynasty-command.replit.app" },  // the origin won, not the edge
  "feedKeyConfigured": true,
  "ingest": {
    "lastError": null,
    "lastSuccess": "…",
    "consecutiveFailures": 0
  }
}
```

| Symptom | Meaning |
|---|---|
| `feedHosts` still only `api.statchasers.com` | The deployment did not get the new value. Set it on the **deployment**, not the workspace, and republish — the value is read once at process start. |
| `lastSource` is `api.statchasers.com` while the origin is listed first | The origin route is still refused and the list fell through to the edge. Working for now, one Cloudflare scoring change away from another outage — finish Step 1. |
| `lastError` mentions `{"error":"forbidden"}` | The API's host gate, not Cloudflare. Step 1 is not done. |
| `lastError` still shows `Just a moment...` | The origin hostname is redirecting to the canonical domain. See the gotcha above. |
| `lastError` shows `404` or `ENOTFOUND` | Wrong hostname or path. Confirm both with the `curl` above. |
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
set on the deployment — push writes caller-supplied content straight into the
archive, so it is refused without one. `/api/status` reports
`pushModeAvailable`.

Structurally the soundest option, and the only one that survives any future
change to Cloudflare's scoring or Replit's hostnames.

### Super Bot Fight Mode (Pro)

On Pro, Bot Fight Mode becomes skippable and everything can keep flowing through
Cloudflare with protection intact. The rule:

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
than the window are gone for good — upstream does not serve them and this archive
is the only store of record.

This outage ran for hours before anyone noticed, so the thing worth adding is not
another fallback but a signal:

- **A scheduled ingest.** Point a Replit Scheduled Deployment at
  `scripts/ingest.mjs` (every 10 minutes). It POSTs `/api/ingest`, which both
  refreshes the data and wakes an idle instance.
- **A check on `/api/status`.** `ingest.consecutiveFailures > 0`, or a large
  `ingest.secondsSinceLastSuccess`, is the earliest possible signal — it fires
  while the page still looks fine, because the archive only visibly falls behind
  some hours later.

## Related

- `replit.md` → *Architecture decisions* — why `/api/status` exists, and why the
  freshness snapshot expires on a timer as well as on invalidation. That second
  fix is what stops an outage like this from freezing the page *permanently*
  rather than merely making it stale.
- `artifacts/api-server/src/routes/news.ts` — the ingest, the outgoing headers,
  and the status endpoint.
