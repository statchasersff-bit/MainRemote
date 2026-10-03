// Push X posts into the news tool from wherever you collected them.
//
// The counterpart to scripts/ingest.mjs, for the X lane. The server's poller
// (lib/x/*) is one way posts arrive; this is the other, and it exists because
// acquisition and storage are separate problems. Whatever gathered these posts
// - a collector of your own, a vendor's export, an enterprise credential, a
// person with a keyboard - runs wherever it needs to run, and this hands the
// result to the archive.
//
// Everything after the POST is identical to a polled post: deduplicated on the
// X post id, filtered by the author's toggles, tagged with a player, a team and
// a category, and rendered on the same card.
//
// Usage:
//   X_PUSH_URL=https://<deployment>/api/x/posts \
//   INGEST_SECRET=... \
//   node scripts/x-push.mjs posts.json
//
//   ... | node scripts/x-push.mjs -            # or read stdin
//
// The input may be a bare array, {posts: [...]}, or any response body the
// server's tolerant reader can find posts in - X's own v1.1 objects, X API v2
// objects, or the camelCase shape the resellers use. If your collector already
// holds the JSON, it is very likely postable unchanged.
//
// Required env:  X_PUSH_URL      e.g. https://<deployment>/api/x/posts
//                INGEST_SECRET   the server refuses every push without it
// Optional:      X_PUSH_MAX_AGE_DAYS  accept posts older than the poller would
//                X_PUSH_BATCH         posts per request (default 100, max 200)

import { readFileSync } from "node:fs";

const url = process.env.X_PUSH_URL;
if (!url) {
  console.error("X_PUSH_URL is required (e.g. https://<deployment>/api/x/posts)");
  process.exit(1);
}

const secret = process.env.INGEST_SECRET;
const source = process.argv[2];

if (!source) {
  console.error("Usage: node scripts/x-push.mjs <file.json|-> ");
  process.exit(1);
}

/** The server caps a batch at 200; stay at or under it. */
const BATCH = Math.min(Number(process.env.X_PUSH_BATCH) || 100, 200);

function read() {
  const text =
    source === "-"
      ? readFileSync(0, "utf8")
      : readFileSync(source, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`Could not parse ${source === "-" ? "stdin" : source}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Find the posts in whatever was handed to us.
 *
 * Deliberately shallow: the server does the real (recursive, shape-tolerant)
 * search. This only needs to get an array to chunk, and anything it cannot
 * recognise is posted whole and judged there - the server's answer is the one
 * that matters, and it reports exactly what it rejected.
 */
function toArray(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["posts", "data", "tweets", "results", "items"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [data];
}

const maxAgeDays = Number(process.env.X_PUSH_MAX_AGE_DAYS) || undefined;

async function post(batch) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-ingest-secret": secret } : {}),
    },
    body: JSON.stringify({ posts: batch, ...(maxAgeDays ? { maxAgeDays } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`${res.status} ${res.statusText}: ${body.error ?? "unknown error"}`);
  }
  return body;
}

const posts = toArray(read());
console.log(`Pushing ${posts.length} post(s) to ${new URL(url).host} in batches of ${BATCH}`);

let considered = 0;
let kept = 0;
let stored = 0;

for (let i = 0; i < posts.length; i += BATCH) {
  const batch = posts.slice(i, i + BATCH);
  try {
    const result = await post(batch);
    considered += result.considered ?? 0;
    kept += result.kept ?? 0;
    stored += result.stored ?? 0;
    console.log(
      `  batch ${Math.floor(i / BATCH) + 1}: received ${result.received}, kept ${result.kept}, stored ${result.stored}` +
        (result.rejected?.length ? `, rejected ${result.rejected.length}` : ""),
    );
    if (result.rejected?.length) {
      for (const reason of result.rejected.slice(0, 5)) console.log(`    - ${reason}`);
    }
  } catch (err) {
    // One bad batch should not throw away the ones that worked, and the exit
    // code below still reports that something went wrong.
    console.error(`  batch ${Math.floor(i / BATCH) + 1} failed: ${err.message}`);
    process.exitCode = 1;
  }
}

// "kept" minus "stored" is the posts the archive already had - the number that
// should dominate on a second run, and the quickest confirmation that
// deduplication is working end to end.
console.log(
  `Done: ${considered} considered, ${kept} passed the filters, ${stored} newly stored` +
    `, ${kept - stored} already in the archive`,
);
