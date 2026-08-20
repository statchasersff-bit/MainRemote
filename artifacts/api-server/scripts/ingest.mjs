// Refresh the deployed app's news archive, on a schedule (e.g. a Replit
// Scheduled Deployment) so data stays fresh even when the web instance is idle
// and its in-process 10-minute timer isn't firing.
//
// Two modes:
//
//   pull (default) — POST an empty body; the server fetches the feed itself.
//   push           — this script fetches the feed and POSTs the items, so the
//                    server never makes an outbound call.
//
// Push mode exists because the server cannot always reach the feed: Cloudflare
// challenges the deployment's egress IP in front of api.statchasers.com, and a
// server cannot solve a JS challenge. Wherever *this script* can read the feed
// — a laptop, a CI runner, any host that isn't challenged — it can keep the
// archive moving regardless.
//
// Required env:  INGEST_URL          e.g. https://<deployment>/api/ingest
// Push mode:     FEED_URL            the feed to read (enables push mode)
//                INGEST_SECRET       required by the server for push mode
// Optional:      INGEST_SECRET       for pull mode too, if the server sets it

const url = process.env.INGEST_URL;
if (!url) {
  console.error("INGEST_URL is required (e.g. https://<deployment>/api/ingest)");
  process.exit(1);
}

const secret = process.env.INGEST_SECRET;
const feedUrl = process.env.FEED_URL;
const push = Boolean(feedUrl);

if (push && !secret) {
  // The server refuses anonymous push for the same reason: push writes
  // caller-supplied content straight into the archive.
  console.error("FEED_URL is set (push mode) but INGEST_SECRET is not.");
  console.error("Set INGEST_SECRET here and on the server, or unset FEED_URL.");
  process.exit(1);
}

/** Read the feed. Accepts a bare array or { items: [...] }, like the server. */
async function readFeed() {
  const res = await fetch(feedUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "StatChasersNews-ingest/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).trim().slice(0, 200);
    throw new Error(`feed responded ${res.status} ${res.statusText} ${body}`);
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  if (!Array.isArray(items) || items.length === 0) {
    // Posting an empty list would silently fall back to pull mode on the server
    // and mask the fact that the feed gave us nothing.
    throw new Error("feed returned no items");
  }
  return items;
}

try {
  let body;
  if (push) {
    const items = await readFeed();
    console.log(`Read ${items.length} items from the feed`);
    body = JSON.stringify({ items });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-ingest-secret": secret } : {}),
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Ingest failed: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`Ingest OK (${push ? "push" : "pull"}): ${text}`);
} catch (err) {
  console.error("Ingest error:", err instanceof Error ? err.message : err);
  process.exit(1);
}
