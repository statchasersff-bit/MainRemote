/**
 * mak's approval step for the Wikipedia transaction candidates
 * (scripts/player/bio/candidates.mjs). Nothing reaches a page until a fact is
 * approved here; then buildBioSources.mjs carries it into bio_sources.json.
 *
 *   node scripts/player/approveBioCandidates.mjs --list [slug]
 *   node scripts/player/approveBioCandidates.mjs --approve <id|slug|all> [...]
 *   node scripts/player/approveBioCandidates.mjs --reject  <id|slug> [...]
 *   node scripts/player/approveBioCandidates.mjs --from-review <dir>
 *
 * --from-review applies the decisions mak made on the review page (the
 * "Bio Transaction Review" artifact): its `decisions` collection saved as one
 * JSON file per fact id ({decision: "approved"|"rejected"}) under <dir>.
 *
 * A fact the code check rejected (no verbatim quote, no date, ...) cannot be
 * approved. Decisions survive re-verification.
 */

import fs from "node:fs";
import path from "node:path";
import { CANDIDATES_FILE, readCandidates } from "./bio/candidates.mjs";

const [flag, ...targets] = process.argv.slice(2);
const doc = readCandidates();
const now = new Date().toISOString();
const matches = (slug, f) => targets.includes("all") || targets.includes(slug) || targets.includes(f.id);

if (flag === "--list") {
  for (const [slug, p] of Object.entries(doc.players)) {
    if (targets.length && !targets.includes(slug)) continue;
    for (const f of p.facts) console.log(`${f.status.padEnd(9)} ${f.id} ${slug} ${f.value.date} ${f.value.type} ${f.value.team}${f.reason ? `  (${f.reason})` : ""}\n          "${f.quote}"`);
  }
} else if (flag === "--approve" || flag === "--reject") {
  let n = 0;
  for (const [slug, p] of Object.entries(doc.players)) {
    for (const f of p.facts) {
      if (!matches(slug, f) || (f.reason && flag === "--approve")) continue;
      f.status = flag === "--approve" ? "approved" : "rejected";
      f.decision = f.status;
      f.decidedAt = now;
      n += 1;
    }
  }
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify(doc, null, 1));
  console.log(`[bio-candidates] ${flag.slice(2)}d ${n} facts; run buildBioSources.mjs to publish approved ones`);
} else if (flag === "--from-review") {
  const files = fs.readdirSync(targets[0], { recursive: true }).filter((f) => String(f).endsWith(".json"));
  const decided = new Map(files.map((f) => [path.basename(String(f), ".json"), JSON.parse(fs.readFileSync(path.join(targets[0], String(f)), "utf8"))]));
  const tally = { approved: 0, rejected: 0, skipped: 0 };
  for (const p of Object.values(doc.players)) {
    for (const f of p.facts) {
      const d = decided.get(f.id);
      const decision = d?.decision ?? d?.data?.decision;
      if (decision !== "approved" && decision !== "rejected") continue;
      if (f.reason) {
        tally.skipped += 1;
        continue;
      }
      f.status = decision;
      f.decision = decision;
      f.decidedAt = d.at ?? d?.data?.at ?? now;
      tally[decision] += 1;
    }
  }
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify(doc, null, 1));
  console.log(`[bio-candidates] from review: ${JSON.stringify(tally)}; run buildBioSources.mjs to publish approved ones`);
} else {
  console.log("usage: --list [slug] | --approve <id|slug|all> | --reject <id|slug>");
  process.exit(1);
}
