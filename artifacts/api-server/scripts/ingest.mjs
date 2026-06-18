// Triggers a news ingest by POSTing to the deployed app. Intended to run on a
// schedule (e.g. a Replit Scheduled Deployment) so data stays fresh even when
// the autoscale web instance is asleep and its in-process 10-minute timer
// isn't firing.
//
// Required env:  INGEST_URL    e.g. https://<your-deployment>/api/ingest
// Optional env:  INGEST_SECRET must match the server's INGEST_SECRET if set
const url = process.env.INGEST_URL;
if (!url) {
  console.error("INGEST_URL is required (e.g. https://<deployment>/api/ingest)");
  process.exit(1);
}

const secret = process.env.INGEST_SECRET;

try {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-ingest-secret": secret } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Ingest failed: ${res.status} ${body}`);
    process.exit(1);
  }
  console.log(`Ingest OK: ${body}`);
} catch (err) {
  console.error("Ingest request error:", err);
  process.exit(1);
}
