# The news ingest and Cloudflare

**Runbook for:** production shows stale news, and `GET /api/status` reports a
`403: Forbidden` whose body starts `<!DOCTYPE html>...<title>Just a moment...</title>`.

**Current resolution:** the ingest calls the feed's Replit origin directly,
bypassing Cloudflare. See [The fix in place](#the-fix-in-place).

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

## The fix in place

Every Replit deployment stays reachable on its own `*.replit.app` hostname even
when a custom domain is attached. That hostname is **not proxied through
Cloudflare**, so Bot Fight Mode never sees the request.

The ingest therefore calls the API's Replit origin rather than its public domain:

```
DYNASTY_NEWS_API_URL = https://<api-app>.replit.app/api/news/nfl
```

Set on the **deployment**, then publish. Nothing else changes.

**What this costs and does not cost:**

- Bot Fight Mode stays fully on for `api.statchasers.com` and everything public.
  Only this one server-to-server call takes the direct path.
- That call gives up Cloudflare's caching and protection. It is one request per
  ten minutes from one caller to an endpoint that is public anyway, so the
  exposure is negligible.
- Keep `DYNASTY_NEWS_API_KEY` set. The ingest sends it as `X-SC-Ingest-Key` on
  every call, so the API can require it on the origin hostname if you ever want
  the direct path authenticated rather than merely obscure.

### The gotcha that silently defeats this

If the API redirects its `*.replit.app` hostname to the canonical
`api.statchasers.com` — a common "canonical host" redirect — then this does not
work, and **it fails looking exactly like the original bug.** Node's `fetch`
follows redirects by default, so the request lands back on Cloudflare and gets
the same challenge, with the same error in `/api/status`.

Check before you rely on it:

```bash
API_APP=your-api-app-name

curl -s -o /dev/null -w 'status=%{http_code} redirects=%{num_redirects} final=%{url_effective}\n' \
  -L "https://$API_APP.replit.app/api/news/nfl"
```

You want `status=200`, `redirects=0`, and a `final` URL still on `*.replit.app`.
(Use the variable — a literal `<api-app>` in a shell is read as input
redirection.)
If it redirects to `api.statchasers.com`, exempt `/api/*` from that redirect on
the API side, or use one of the alternatives below.

### Verifying after publish

```bash
curl -s https://newsfeed.replit.app/api/status
curl -s -X POST https://newsfeed.replit.app/api/ingest
```

Looking for:

```jsonc
{
  "feedConfigured": true,
  "feedHost": "<api-app>.replit.app",  // the origin, not the Cloudflare domain
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
| `feedHost` still `api.statchasers.com` | The deployment did not get the new value. Set it on the **deployment**, not the workspace, and republish — the value is read once at process start. |
| `lastError` still shows `Just a moment...` | The origin hostname is redirecting to the canonical domain. See the gotcha above. |
| `lastError` shows `404` or `ENOTFOUND` | Wrong hostname or path. Confirm both with the `curl` above. |
| `lastError: null` but the page looks stale | Not this problem. Staleness is bounded to 60s by `FRESHNESS_MAX_AGE_MS`; compare `archive.newestContentAt` against the feed. |

---

## Alternatives, if the origin path stops working

### Push instead of pull

Reverse the direction: the API POSTs new items to the news app when it publishes
them. Outbound requests *from* the API are not touched by Bot Fight Mode, so the
problem disappears structurally rather than being routed around. Requires a new
endpoint here that accepts items in the request body — today `POST /api/ingest`
still fetches the feed itself, so it does not help on its own.

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
