/**
 * Transaction facts read from Wikipedia articles in session (mak, 2026-09-30:
 * "a one-time in-session extraction pass ... as candidate ... Nothing
 * publishes until I approve"). No API key: the reading was done in a Claude
 * Code session, and this file is the code check that stands behind it.
 *
 * Input: chunk files, data/player/bio_candidates/chunk-NN.json, each
 *   [{ slug, facts: [{ type, date, team, quote, terms? }] }]
 * where `date` is "YYYY-MM-DD" (day) or "YYYY-MM" (month), `team` a StatChasers
 * code and `quote` the sentence(s) copied verbatim from the article text saved
 * in data/player/bio_wikipedia_text/{slug}.json.
 *
 * Every fact is checked in code before it is kept (spec Stage 2):
 *   - the quote is in the saved text, exactly, after whitespace is normalised
 *   - the date is a real date and is written in the quote: "March 11, 2025",
 *     "11 March 2025", or "March 11" with the quote's nearest year before it
 *     (or, failing one, after it in the same sentence) being 2025 ("On March 3, 2025, ... On
 *     March 11, he signed ...")
 *   - the club is named in the quote, by full name, city or nickname
 *   - the quote uses the verb of the move type ("waived" for Waived, ...)
 *   - contract terms, when given, are the quote's own: same years, same total
 *   - `yearFrom: "heading"` (mak, 2026-09-30): the quote writes "August 4" with
 *     no year at all, and the article's nearest heading above the quote is a
 *     season ("2026 season"); March-December take that year. January-
 *     February are refused: they can close that season or open the next.
 *     Such facts are flagged on the review page.
 * Two facts for the same move (type, date, club) keep the first one read.
 * A fact that fails is stored as rejected, with the reason, and never shown.
 *
 * Output: data/player/bio_candidates.json. Each fact's status is "candidate"
 * until approveBioCandidates.mjs marks it "approved"; buildBioSources.mjs
 * reads only approved ones.
 *
 *   node scripts/player/bio/candidates.mjs      # re-verify every chunk
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.mjs";
import { TEAM_NAMES } from "./wikitext.mjs";
import { mergeVerification } from "./mergeVerification.mjs";

export const CHUNK_DIR = path.join(DATA_DIR, "bio_candidates");
export const CANDIDATES_FILE = path.join(DATA_DIR, "bio_candidates.json");
const TEXT_DIR = path.join(DATA_DIR, "bio_wikipedia_text");

export const TYPES = {
  Signed: /\bsign(ed|s|ing)?\b/i,
  "Re-signed": /\bre-?sign(ed)?\b|\bextension\b/i,
  Released: /\breleas(ed|e)\b|\bcut\b/i,
  Waived: /\bwaive(d|rs)?\b/i,
  Claimed: /\bclaim(ed)?\b/i,
  Traded: /\btrad(ed|e)\b/i,
  "Placed on IR": /\binjured reserve\b/i,
  Activated: /\b(re)?activat(ed|e)\b|\breinstated\b/i,
  Contract: /\bcontract\b|\bextension\b|\brestructur|\bdeal\b/i,
  Suspended: /\bsuspen(ded|sion)\b/i,
  Retired: /\bretire(d|ment)?\b/i,
  // A restricted or exclusive-rights free agent signing his club's tender.
  // "signed the tender", "signed a tendered contract"; a club only placing
  // or assigning a tender is not his move.
  Tender: /^(?=[\s\S]*\btender(ed)?\b)(?=[\s\S]*\bsign)/i,
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const norm = (s) =>
  String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Every way the article can name a club: full name, city, nickname. */
function clubWords(code) {
  const words = new Set();
  for (const [name, c] of Object.entries(TEAM_NAMES)) {
    if (c !== code) continue;
    words.add(name);
    const parts = name.split(" ");
    words.add(parts[parts.length - 1]);
    words.add(parts.slice(0, -1).join(" "));
  }
  return [...words].filter((w) => w.length > 2);
}

/** Why the fact fails, or null when it passes. */
export function checkFact(fact, text) {
  if (!TYPES[fact.type]) return `unknown type "${fact.type}"`;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(fact.date ?? "");
  if (!m) return `date "${fact.date}" is not YYYY-MM-DD or YYYY-MM`;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  const when = new Date(Date.UTC(y, mo - 1, d ?? 1));
  if (when.getUTCMonth() !== mo - 1 || (d && when.getUTCDate() !== d)) return `date "${fact.date}" does not exist`;
  const quote = norm(fact.quote);
  if (quote.length < 20) return "quote too short";
  if (!norm(text).includes(quote)) return "quote not found verbatim in the article text";
  if (fact.yearFrom === "heading") {
    const why = headingYear(quote, text, y, mo, d);
    if (why) return why;
  } else if (!statesDate(quote, y, mo, d)) return `the quote does not state the date (${d ? `${MONTHS[mo - 1]} ${d}, ${y}` : `${MONTHS[mo - 1]} ${y}`})`;
  if (!TEAM_NAMES || !Object.values(TEAM_NAMES).includes(fact.team)) return `unknown team "${fact.team}"`;
  if (!clubWords(fact.team).some((w) => quote.includes(w))) return `the quote does not name the club (${fact.team})`;
  if (!TYPES[fact.type].test(quote)) return `the quote does not say "${fact.type}"`;
  if (fact.terms && !statesTerms(quote, fact.terms)) return "the quote does not state those contract terms";
  return null;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Terms stand only when the quote gives the same length and total: "two-year, $12.5 million". */
export function statesTerms(quote, { years, totalM }) {
  if (years) {
    const w = NUMBER_WORDS[years];
    if (!new RegExp(`\\b(${years}|${w})[- ]year`, "i").test(quote)) return false;
  }
  if (totalM) {
    const totals = [...quote.matchAll(/\$\s?([\d,.]+)\s*(million|billion)?/gi)].map((m) => {
      const n = Number(m[1].replace(/,/g, ""));
      return /billion/i.test(m[2] ?? "") ? n * 1000 : m[2] ? n : n / 1e6;
    });
    if (!totals.some((t) => Math.abs(t - totalM) < 0.005)) return false;
  }
  return true;
}

/** Why a heading-dated fact fails, or null. See the header. */
export function headingYear(quote, text, y, mo, d) {
  if (!d) return "a heading-dated fact needs a day";
  if (/\b(19|20)\d{2}\b/.test(quote)) return "the quote has a year of its own; date it from the quote";
  const month = MONTHS[mo - 1];
  if (!new RegExp(`\\b${month} ${d}(st|nd|rd|th)?\\b|\\b${d} ${month}\\b`).test(quote)) return `the quote does not state ${month} ${d}`;
  const t = norm(text);
  const at = t.indexOf(quote);
  if (at < 0) return "quote not found verbatim in the article text";
  const heads = [...t.slice(0, at).matchAll(/(={2,}) ([^=]+?) \1/g)];
  const head = heads[heads.length - 1]?.[2]?.trim() ?? "";
  // "2025 season", "2025", or a season with a subtitle: "2024 season: Pro Bowler".
  const season = /^(\d{4})(?: season)?(?:\s*[:–—-]\s.*)?$/i.exec(head)?.[1];
  if (!season) return `the nearest heading ("${head}") is not a season`;
  // March-December sit in the heading's year (its offseason, camp and
  // regular season). January-February could close that season or open the
  // next one (futures contracts), so they are not dated from a heading.
  if (mo <= 2) return `a ${month} date under a season heading could fall in either year`;
  const expect = Number(season);
  return expect === y ? null : `the "${head}" heading puts ${month} ${d} in ${expect}, not ${y}`;
}

/** Does the quote write this date? See the header for the accepted forms. */
export function statesDate(quote, y, mo, d) {
  const month = MONTHS[mo - 1];
  if (!d) return new RegExp(`\\b${month}(?: \\d{1,2},)? ${y}\\b`).test(quote);
  if (new RegExp(`\\b${month} ${d}(st|nd|rd|th)?, ${y}\\b|\\b${d} ${month},? ${y}\\b`).test(quote)) return true;
  // "March 11" / "11 March" without a year: the year the quote puts nearest before it.
  const m = new RegExp(`\\b${month} ${d}(st|nd|rd|th)?\\b(?!, \\d)|\\b${d} ${month}\\b(?! \\d{4})`).exec(quote);
  if (!m) return false;
  const years = [...quote.matchAll(/\b(19|20)\d{2}\b/g)].map((x) => ({ at: x.index, year: Number(x[0]) }));
  const before = years.filter((x) => x.at < m.index).pop();
  // A year after the date counts only inside the same sentence ("March 12,
  // the start of the 2025 NFL year"), never from the next one.
  const end = quote.slice(m.index).search(/[.!?](\s|$)/);
  const after = years.find((x) => x.at > m.index && (end < 0 || x.at < m.index + end));
  return (before ?? after)?.year === y;
}

const idOf = (slug, f) => crypto.createHash("sha1").update(`${slug}|${f.type}|${f.date}|${f.team}|${norm(f.quote)}`).digest("hex").slice(0, 12);

export function readCandidates() {
  try {
    return JSON.parse(fs.readFileSync(CANDIDATES_FILE, "utf8"));
  } catch {
    return { version: 1, players: {} };
  }
}

/** Re-verifies every chunk file into bio_candidates.json, keeping decisions already made. */
export function verifyAll() {
  const prev = readCandidates();
  const decided = new Map();
  for (const p of Object.values(prev.players)) for (const f of p.facts) if (f.status === "approved" || f.decision) decided.set(f.id, f);

  const players = {};
  const tally = { candidate: 0, rejected: 0, approved: 0 };
  const chunks = fs.existsSync(CHUNK_DIR) ? fs.readdirSync(CHUNK_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of chunks) {
    for (const row of JSON.parse(fs.readFileSync(path.join(CHUNK_DIR, file), "utf8"))) {
      let article;
      try {
        article = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, `${row.slug}.json`), "utf8"));
      } catch {
        continue;
      }
      const entry = (players[row.slug] ??= { title: article.title, revid: article.revid, url: article.url, chunk: file, facts: [] });
      for (const f of row.facts ?? []) {
        const id = idOf(row.slug, f);
        const move = (x) => `${x.value.type}|${x.value.date}|${x.value.team}`;
        if (entry.facts.some((x) => x.id === id || (x.status !== "rejected" && move(x) === `${f.type}|${f.date}|${f.team}`))) continue;
        const why = checkFact(f, article.text);
        const before = decided.get(id);
        const status = why ? "rejected" : before?.status === "approved" ? "approved" : before?.decision === "rejected" ? "rejected" : "candidate";
        entry.facts.push({
          id,
          field: "transaction",
          value: { type: f.type, date: f.date, precision: f.date.length === 10 ? "day" : "month", team: f.team, ...(f.terms ? { terms: f.terms } : {}), ...(f.yearFrom === "heading" ? { yearFrom: "heading" } : {}) },
          quote: f.quote,
          status,
          ...(why ? { reason: why } : {}),
          ...(before?.decision ? { decision: before.decision, decidedAt: before.decidedAt } : {}),
          method: "extracted",
          confidence: 0.7,
        });
        tally[status] += 1;
      }
    }
  }
  // The fact-check (official logs, search), and the missing moves it found.
  const merged = mergeVerification(players, decided);
  for (const p of Object.values(players)) for (const f of p.facts) if (f.missing) tally[f.status] += 1;
  tally.missingAdded = merged.added;
  const doc = { version: 1, verifiedAt: new Date().toISOString(), players };
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify(doc, null, 1));
  return tally;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[bio-candidates]", JSON.stringify(verifyAll()));
}
