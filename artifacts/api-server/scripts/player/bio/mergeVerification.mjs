/**
 * Folds the fact-check (mak, 2026-09-30) into the review list:
 *
 *   - bio_verification.json      part 1, the clubs' official logs, in code
 *   - bio_verify_search/*.json   part 2, contracts and trades, searched
 *
 * Each Wikipedia-read fact gets `verification` (verdict, confidence, sources,
 * notes; the search pass wins over the log pass where both ran) and
 * `proposed`: the version that publishes if mak approves it. An EDIT or DATE
 * UNCERTAIN proposes the verified date, type, club and wording; a REJECT
 * proposes nothing.
 *
 * Missing moves become facts of their own:
 *   - from an official log (method "official-log"): the log sentence is the
 *     quote, and it must still be in team_transactions.json for that club and
 *     date, word for word;
 *   - from the search pass (method "search"): its headline, with its sources.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.mjs";

const LOG_VERIFY = path.join(DATA_DIR, "bio_verification.json");
const SEARCH_DIR = path.join(DATA_DIR, "bio_verify_search");
const LOGS_FILE = path.join(DATA_DIR, "team_transactions.json");
const SOURCES_FILE = path.join(DATA_DIR, "bio_sources.json");
const RULINGS_FILE = path.join(DATA_DIR, "bio_rulings.json");
const DAY = 86400000;

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const KIND_TYPE = {
  sign: "Signed", "re-sign": "Re-signed", waive: "Waived", release: "Released", claim: "Claimed",
  "place-ir": "Placed on IR", activate: "Activated", trade: "Traded", promote: "Signed", tag: "Tag",
  "place-susp": "Suspended", "place-retired": "Retired",
};

/** A log move's type and a plain headline, in the log's own terms. */
function fromLog(m) {
  const t = m.text;
  let type = KIND_TYPE[m.kind];
  let headline = null;
  if (m.kind === "sign" && /extension/i.test(t)) type = "Contract";
  if (m.kind === "sign" && /\bagree/i.test(t)) headline = /extension/i.test(t) ? "Agreed to terms on a contract extension" : "Agreed to terms";
  if (m.kind === "promote") headline = "Signed to the active roster from the practice squad";
  if (m.kind === "tag") {
    headline = /fifth[- ]year option/i.test(t)
      ? "Fifth-year option exercised"
      : /franchise/i.test(t)
        ? /transition/i.test(t) ? "Designated the transition player" : "Designated the franchise player"
        : /tender/i.test(t)
          ? "Tendered as a restricted or exclusive-rights free agent"
          : null;
    if (!headline) return null;
  }
  if (m.kind === "sign" && /franchise/i.test(t)) headline = "Signed the franchise tender";
  return type ? { type, headline } : null;
}

const id = (...parts) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);

/**
 * The move's distinct dated events (mak, 2026-10-01): agreement, signing and
 * the log's processed date are different things, so when the search pass
 * separated them they are kept side by side instead of one date winning.
 * Null unless there are at least two distinct dates to keep.
 */
export function eventsFrom(dates) {
  if (!dates) return null;
  const out = [];
  if (dates.agreed) out.push({ date: dates.agreed, status: "agreed" });
  if (dates.signed) out.push({ date: dates.signed, status: "signed" });
  if (dates.officialLog && dates.officialLog !== dates.signed) out.push({ date: dates.officialLog, status: "processed" });
  return new Set(out.map((e) => e.date)).size >= 2 ? out : null;
}

export function mergeVerification(players, decided) {
  const logv = read(LOG_VERIFY, null);
  const logs = read(LOGS_FILE, { teams: {} });
  const search = {};
  const searchMissing = {};
  if (fs.existsSync(SEARCH_DIR)) {
    for (const f of fs.readdirSync(SEARCH_DIR).filter((x) => x.endsWith(".json")).sort()) {
      const doc = read(path.join(SEARCH_DIR, f), { players: [] });
      for (const p of doc.players ?? []) {
        for (const r of p.facts ?? []) search[r.id] = { ...r, pass: "search" };
        if (p.missing?.length) (searchMissing[p.slug] ??= []).push(...p.missing);
      }
    }
  }
  if (!logv && !Object.keys(search).length) return { added: 0 };

  for (const [slug, p] of Object.entries(players)) {
    for (const f of p.facts) {
      if (f.method !== "extracted") continue;
      const v = search[f.id] ?? logv?.facts?.[f.id];
      if (!v) continue;
      const verified = v.verified ?? {};
      f.verification = {
        pass: v.pass ?? "official-log",
        verdict: v.verdict,
        confidence: v.confidence,
        notes: v.notes ?? null,
        official: v.official ? { date: v.official.date, team: v.official.team, text: v.official.text, url: v.official.url } : null,
        sources: v.sources ?? (v.official ? [{ publisher: `${v.official.team} official transaction log`, url: v.official.url, date: v.official.date }] : []),
        verified: v.verified ?? null,
        dates: v.dates ?? null,
      };
      f.proposed =
        v.verdict === "REJECT"
          ? null
          : {
              ...f.value,
              ...(verified.date ? { date: verified.date, precision: verified.date.length === 10 ? "day" : "month" } : {}),
              ...(verified.type ? { type: verified.type } : {}),
              ...(verified.team ? { team: verified.team } : {}),
              ...(verified.headline ? { headline: verified.headline } : {}),
              ...(verified.terms ? { terms: { years: verified.terms.newYears ?? f.value.terms?.years, totalM: verified.terms.totalM ?? f.value.terms?.totalM } } : {}),
              ...(verified.events ?? eventsFrom(v.dates) ? { events: verified.events ?? eventsFrom(v.dates) } : {}),
            };
      // A decision freezes what publishes: once mak approved a fact, a changed
      // verifier cannot silently rewrite its published version. Changes to an
      // approved fact go through bio_rulings.json (applied below), never here.
      const before = decided.get(f.id);
      if (f.status === "approved" && before?.proposed) f.proposed = before.proposed;
    }
  }

  // Missing moves.
  let added = 0;
  const addFact = (slug, fact) => {
    const entry = (players[slug] ??= { title: null, revid: null, url: null, chunk: fact.method, facts: [] });
    if (entry.facts.some((x) => x.id === fact.id)) return;
    const before = decided.get(fact.id);
    entry.facts.push({
      ...fact,
      status: fact.reason ? "rejected" : before?.status === "approved" ? "approved" : before?.decision === "rejected" ? "rejected" : "candidate",
      ...(before?.decision ? { decision: before.decision, decidedAt: before.decidedAt } : {}),
    });
    added += 1;
  };
  // Trades the page already prints from nflverse (bio_sources.json) are not "missing".
  const nflTrades = {};
  for (const [slug, e] of Object.entries(read(SOURCES_FILE, { players: {} }).players)) {
    const t = e.facts.find((f) => f.field === "trades" && f.status === "approved");
    if (t) nflTrades[slug] = t.value;
  }
  for (const [slug, moves] of Object.entries(logv?.missing ?? {})) {
    for (const m of moves) {
      const t = fromLog(m);
      if (!t) continue;
      if (t.type === "Traded") {
        const near = (d) => Math.abs(Date.parse(d) - Date.parse(m.date)) <= 30 * DAY;
        if ((nflTrades[slug] ?? []).some((x) => near(x.date))) continue;
        if ((players[slug]?.facts ?? []).some((x) => x.value.type === "Traded" && near(x.value.date.length === 7 ? `${x.value.date}-15` : x.value.date))) continue;
        // A log row names the club that logged it; only "acquired" makes it the club he joined.
        if (!/\bacquire/i.test(m.text)) continue;
      }
      const row = (logs.teams[m.team]?.[m.date.slice(0, 4)] ?? []).find((r) => r.date === m.date && r.text === m.text);
      const value = { type: t.type, date: m.date, precision: "day", team: m.team, ...(t.headline ? { headline: t.headline } : {}) };
      addFact(slug, {
        id: id(slug, "log", t.type, m.date, m.team),
        field: "transaction",
        value,
        proposed: value,
        quote: m.text,
        method: "official-log",
        confidence: 0.95,
        missing: true,
        ...(row ? {} : { reason: "no longer in the stored official log" }),
        verification: { pass: "official-log", verdict: "MISSING", confidence: "HIGH", notes: "In the club's official transaction log; not in the Wikipedia reading.", official: { date: m.date, team: m.team, text: m.text, url: m.url }, sources: [{ publisher: `${m.team} official transaction log`, url: m.url, date: m.date }] },
      });
    }
  }
  for (const [slug, moves] of Object.entries(searchMissing)) {
    for (const m of moves) {
      if (!m.date || !m.type || !m.team || !m.sources?.length) continue;
      // The same move already on the list (same club, within 3 days): an
      // official-log row takes the search pass's fuller wording, keeping its
      // official quote; anything else is a duplicate.
      const dateOf = (d) => Date.parse(d.length === 7 ? `${d}-15` : d);
      // A code-rejected fact never publishes, so it does not block a properly
      // sourced search fact for the same move (mak batch 18: Mariota's 2015
      // rookie signing, whose extracted twin failed the code check).
      // A manual entry may declare itself `distinct: true` to opt out of the
      // window entirely: cutdown week stacks real back-to-back moves on one
      // club (mak batch 25: Tonyan released 8/26, PS 8/27, active 8/28 - all KC).
      const same = m.distinct ? null : (players[slug]?.facts ?? []).find((x) => x.status !== "rejected" && x.value.team === m.team && Math.abs(dateOf(x.value.date) - dateOf(m.date)) <= 3 * DAY);
      if (same) {
        if (same.method === "official-log" && m.headline) {
          same.value = { ...same.value, type: m.type, headline: m.headline };
          same.proposed = same.value;
          same.verification = { ...same.verification, notes: `${same.verification.notes} Terms: ${m.description ?? m.headline}`, sources: [...same.verification.sources, ...m.sources] };
        }
        continue;
      }
      const value = { type: m.type, date: m.date, precision: m.date.length === 10 ? "day" : "month", team: m.team, ...(m.headline ? { headline: m.headline } : {}) };
      addFact(slug, {
        id: id(slug, "search", m.type, m.date, m.team),
        field: "transaction",
        value,
        proposed: value,
        quote: m.description ?? m.headline ?? "",
        method: "search",
        confidence: 0.8,
        missing: true,
        verification: { pass: "search", verdict: "MISSING", confidence: m.confidence ?? "MEDIUM", notes: m.description ?? null, sources: m.sources },
      });
    }
  }

  // mak's per-fact rulings (bio_rulings.json) overrule both passes: the verdict
  // and confidence they pin, and the exact `proposed` that publishes. Applied
  // last so a re-run of either pass cannot silently undo a settled call.
  const rulings = read(RULINGS_FILE, { rulings: {} }).rulings ?? {};
  for (const p of Object.values(players)) {
    for (const f of p.facts) {
      const r = rulings[f.id];
      if (!r) continue;
      f.verification = {
        ...(f.verification ?? { pass: "ruling", sources: [] }),
        ...(r.verdict ? { verdict: r.verdict } : {}),
        ...(r.confidence ? { confidence: r.confidence } : {}),
        notes: [f.verification?.notes, r.note].filter(Boolean).join(" "),
        ruling: true,
      };
      if ("proposed" in r) f.proposed = r.proposed;
      if (r.events && f.proposed) f.proposed = { ...f.proposed, events: r.events };
    }
  }
  return { added };
}
