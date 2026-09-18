// Register (or just print) the provider-side filter rules that feed
// POST /api/x/webhook.
//
// Real-time delivery has two halves. This app owns the receiving half; the
// provider owns the watching half, and it has to be told what to watch. That
// instruction is a "filter rule": a search expression plus a delivery interval.
//
// Registering a rule COSTS MONEY for as long as it exists — providers of this
// kind bill per matched tweet — and a duplicate rule bills twice for the same
// post. So this script prints by default and only writes when told to, and it
// prints the rule ids it creates so they can be found again.
//
// Usage:
//   # See what would be registered, from the app's own enabled accounts:
//   X_RULES_URL=https://<deployment>/api/x/webhook/rules node scripts/x-webhook-rules.mjs
//
//   # Actually register them with the provider:
//   X_RULES_URL=... X_API_KEY=... X_WEBHOOK_URL=https://<deployment>/api/x/webhook \
//     node scripts/x-webhook-rules.mjs --register
//
// Optional:
//   --exclude-retweets   append -filter:retweets to every rule. Worth it when
//                        no account has reposts switched on: a tweet excluded
//                        at the provider is never matched, never delivered and
//                        never billed, whereas one dropped by our own filter
//                        has already been paid for.
//   --interval <seconds> how often the provider batches and delivers (default
//                        60). Lower is fresher and costs the same.
//   X_RULE_API_URL       the provider's add-rule endpoint, if not twitterapi.io.

const rulesUrl = process.env.X_RULES_URL;
if (!rulesUrl) {
  console.error("X_RULES_URL is required (e.g. https://<deployment>/api/x/webhook/rules)");
  process.exit(1);
}

const args = process.argv.slice(2);
const register = args.includes("--register");
const excludeRetweets = args.includes("--exclude-retweets");
const interval = Number(args[args.indexOf("--interval") + 1]) || 60;

const addRuleUrl =
  process.env.X_RULE_API_URL ?? "https://api.twitterapi.io/oapi/tweet_filter/add_rule";
const apiKey = process.env.X_API_KEY;
const webhookUrl = process.env.X_WEBHOOK_URL;

if (register && !apiKey) {
  console.error("--register needs X_API_KEY (the provider's key, not the app's)");
  process.exit(1);
}

// Ask the app what it wants watched, rather than keeping a second copy of the
// watchlist here. Adding a reporter in /admin/x therefore changes what this
// registers, with nothing to keep in sync by hand.
const url = new URL(rulesUrl);
if (excludeRetweets) url.searchParams.set("suffix", "-filter:retweets");

const res = await fetch(url, { headers: { Accept: "application/json" } });
if (!res.ok) {
  console.error(`${rulesUrl} responded ${res.status} ${res.statusText}`);
  process.exit(1);
}
const { accounts, rules, webhookConfigured } = await res.json();

console.log(`${accounts} enabled account(s) -> ${rules.length} rule(s)\n`);
for (const rule of rules) {
  console.log(`  ${rule.tag}  (${rule.length}/255 chars)`);
  console.log(`    ${rule.value}\n`);
}

if (!webhookConfigured) {
  console.warn(
    "WARNING: the app has no X_WEBHOOK_SECRET (or X_API_KEY) set, so it will\n" +
      "         refuse deliveries. Set it before registering anything.\n",
  );
}

if (!register) {
  console.log("Nothing registered (dry run). Re-run with --register to create these.");
  if (webhookUrl) console.log(`They will deliver to: ${webhookUrl}`);
  process.exit(0);
}

console.log(`Registering ${rules.length} rule(s) at ${new URL(addRuleUrl).host}...`);

for (const rule of rules) {
  try {
    const response = await fetch(addRuleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        tag: rule.tag,
        value: rule.value,
        interval_seconds: interval,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status === "error") {
      // Keep going: one rejected rule should not strand the ones that worked,
      // and the exit code still reports that something went wrong.
      console.error(`  ${rule.tag}: FAILED — ${body.msg ?? `${response.status} ${response.statusText}`}`);
      process.exitCode = 1;
      continue;
    }

    // The id is the only handle on a rule that is now costing money. Printed
    // because it is the one thing that cannot be recomputed from the watchlist.
    console.log(`  ${rule.tag}: rule_id=${body.rule_id ?? "(none returned)"}`);
  } catch (err) {
    console.error(`  ${rule.tag}: FAILED — ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(
  "\nDone. Set the webhook URL in the provider's dashboard to:\n" +
    `  ${webhookUrl ?? "https://<deployment>/api/x/webhook"}\n` +
    "Keep the rule ids above — they are what you will need to delete or update\n" +
    "these rules later, and every rule bills for as long as it matches.",
);
