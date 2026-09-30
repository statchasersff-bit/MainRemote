// Refresh the DEPLOYED app's Fantasy Points Allowed table, on a schedule
// (e.g. a Replit Scheduled Deployment). Weekly in season, after Monday night,
// once nflverse has published the week.
//
// The distinction that matters, and the one that cost two days of stale
// figures: `ingest-fpa.mjs` runs the ingest HERE and writes to whatever
// DATABASE_URL this process has. Run from a development shell it refreshes
// development, while the deployment goes on serving whatever seeded it. This
// script writes nothing — it POSTs the deployment's own endpoint, so the ingest
// runs inside the deployment, against the database the deployment reads.
//
// Required env:  FPA_INGEST_URL  e.g. https://<deployment>/api/fpa/ingest
//                INGEST_SECRET   the server refuses every ingest without it
// Optional:      FPA_SEASON      current season override, for a rollover week
//                FPA_BASELINE    baseline season override, likewise
//                FPA_INGEST_TIMEOUT_MS  default 300000
//
// The server answers when the ingest has finished — two ~7MB CSVs and a
// transaction, a couple of seconds when nflverse is quick — so the exit code is
// the real verdict and a scheduled run that reports success actually wrote
// something. The timeout is generous because the download is someone else's.

const url = process.env.FPA_INGEST_URL;
if (!url) {
  console.error(
    "FPA_INGEST_URL is required (e.g. https://<deployment>/api/fpa/ingest)",
  );
  process.exit(1);
}

const secret = process.env.INGEST_SECRET;
const timeoutMs = Number(process.env.FPA_INGEST_TIMEOUT_MS ?? 300_000);

const target = new URL(url);
// Passed through rather than validated here: the server checks them, and a
// second opinion in a shell script is how the two come to disagree.
if (process.env.FPA_SEASON) target.searchParams.set("current", process.env.FPA_SEASON);
if (process.env.FPA_BASELINE) {
  target.searchParams.set("baseline", process.env.FPA_BASELINE);
}

try {
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-ingest-secret": secret } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`FPA refresh failed: ${res.status} ${text}`);
    process.exit(1);
  }

  // Printed as the summary a scheduler's log should carry: which week the
  // deployment is now serving, and when it was written. "ok: true" on its own
  // would not have caught the table standing still.
  let summary = text;
  try {
    const body = JSON.parse(text);
    summary =
      `mode ${body.dataMode}, ${body.snapshotRows} snapshot rows, ` +
      `${body.gameRows} game rows, written ${body.snapshotWrittenAt}` +
      (body.joined ? " (joined a run already in flight)" : "");
  } catch {
    // Not JSON. Print what came back rather than hiding it behind a parse
    // error — an HTML error page from a proxy is the answer, not a crash.
  }
  console.log(`FPA refresh OK: ${summary}`);
} catch (err) {
  console.error(
    "FPA refresh error:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
