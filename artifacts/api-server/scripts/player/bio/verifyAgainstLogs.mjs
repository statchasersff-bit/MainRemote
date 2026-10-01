/**
 * Verification, part 1 (mak's fact-check brief, 2026-09-30): every roster move
 * on the review list is checked against the club's official transaction log
 * (data/player/team_transactions.json), in code.
 *
 * A log sentence names several moves: "The Detroit Lions waive CB Chase Lucas
 * and LB Trevor Nowaske and activate FB Jason Cabinda from Reserve/Injured."
 * Each player named takes the nearest verb before his name, and the words after
 * it up to the next name ("from Reserve/Injured", "to the practice squad").
 *
 * Per fact:
 *   same club, same date, same kind of move      -> APPROVE, HIGH
 *   same club and kind within 10 days            -> DATE CONFLICT: the stored
 *     date stays the user-facing event, the archive date is recorded as the
 *     processing date (events), and the row waits for review. The archive is
 *     never automatically preferred over a contemporaneous announcement (mak,
 *     2026-10-01).
 *   same club and date, another kind of move     -> EDIT to the official kind
 *   the log has the club's year but not the move -> UNABLE TO VERIFY, LOW
 *   no official log (Dallas, before 2017)        -> UNABLE TO VERIFY
 * Contracts, trades and tender terms are only date-checked here; their terms
 * are for the search pass (part 2).
 *
 * Also: every log move naming one of these players with no fact to match is
 * a MISSING transaction, added to the review list as a candidate whose source
 * is the official log.
 *
 * -> data/player/bio_verification.json { facts: {id: verdict}, missing: {slug: [...]} }
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.mjs";

const LOGS_FILE = path.join(DATA_DIR, "team_transactions.json");
const CANDIDATES_FILE = path.join(DATA_DIR, "bio_candidates.json");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const SOURCES_FILE = path.join(DATA_DIR, "bio_sources.json");
export const VERIFY_FILE = path.join(DATA_DIR, "bio_verification.json");
const WINDOW_DAYS = 10;

/** Log verbs to move kinds, written against normalised text ("re-sign" -> "re sign"). */
const VERBS = [
  ["re sign|re signs|re signed|re signing", "re-sign"],
  ["sign|signs|signed|signing|agree to terms|agreed to terms|agree|agrees", "sign"],
  ["waive|waives|waived", "waive"],
  ["release|releases|released|terminate|terminates|terminated", "release"],
  ["claim|claims|claimed|award|awarded", "claim"],
  ["place|places|placed|move|moves|moved|designate|designates|designated", "place"],
  ["activate|activates|activated|reinstate|reinstates|reinstated|restore|restores|restored|recall|recalls", "activate"],
  ["trade|trades|traded|acquire|acquires|acquired", "trade"],
  ["promote|promotes|promoted|elevate|elevates|elevated|protect|protects", "promote"],
  ["exercise|exercises|exercised|tender|tenders|tendered|franchise", "tag"],
].map(([words, kind]) => [new RegExp(`\\b(${words})\\b`, "g"), kind]);

/** Our types to the log kinds that confirm them. */
const CONFIRMS = {
  Signed: ["sign", "re-sign", "promote"],
  "Re-signed": ["re-sign", "sign"],
  Contract: ["sign", "re-sign"],
  Tender: ["sign", "re-sign", "tag"],
  Released: ["release"],
  Waived: ["waive"],
  Claimed: ["claim"],
  "Placed on IR": ["place-ir"],
  Activated: ["activate"],
  Traded: ["trade"],
  Suspended: ["place-susp"],
  Retired: ["place-retired"],
};

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * The moves in one log sentence for the given player names:
 * [{ slug, kind, detail }]. `names` is [[slug, normalisedName]].
 */
export function movesIn(text, names) {
  const out = [];
  // Name abbreviations are not sentence ends: "St. Brown" / "A.J. Brown" must
  // not split the clause mid-name (norm() drops the periods either way).
  const guarded = String(text)
    .replace(/\b([A-Z])\.\s?([A-Z])\.(?=\s)/g, "$1$2")
    .replace(/\b(St|Ste|Jr|Sr)\.(?=\s)/g, "$1");
  // Clauses: sentences and ";"-separated parts. "Signed RB X. Re-signed LB Y; RB Z placed on injured reserve"
  for (const clause of guarded.split(/;|\.(?=\s|$)/)) {
    const t = ` ${norm(clause)} `;
    const hits = [];
    for (const [slug, name] of names) {
      const at = t.indexOf(` ${name} `);
      if (at >= 0) hits.push({ slug, at: at + 1, end: at + 1 + name.length });
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.at - b.at);
    const verbs = [];
    for (const [re, kind] of VERBS) for (const m of t.matchAll(re)) verbs.push({ at: m.index, end: m.index + m[0].length, kind });
    // "no recall" (waived/no recall) is not a recall; "re sign" also matches "sign".
    const clean = verbs
      .filter((v) => !(v.kind === "activate" && /\bno $/.test(t.slice(0, v.at))))
      .filter((v) => !(v.kind === "sign" && verbs.some((w) => w.kind === "re-sign" && v.at === w.at + 3)))
      .sort((a, b) => a.at - b.at);
    for (const h of hits) {
      // The verb before the name ("The Lions waive CB X"), else the first after it ("RB X placed on IR").
      const before = clean.filter((v) => v.end <= h.at).pop();
      const verb = before ?? clean.find((v) => v.at >= h.end);
      const scopeEnd = before ? (clean.find((v) => v.at >= h.end)?.at ?? t.length) : (clean.filter((v) => v.at > (verb?.at ?? t.length))[0]?.at ?? t.length);
      const around = t.slice(Math.min(verb?.at ?? h.at, h.at), scopeEnd);
      let kind = verb?.kind ?? null;
      // "Moved QB X from Reserve/Injured to the active roster" is an activation.
      if (kind === "place" && /from reserve[a-z ]* to the active roster|to the active roster from reserve/.test(around)) kind = "activate";
      if (kind === "place") {
        kind = /reserve (injured|non football injury|physically unable)|injured reserve|reserve pup|reserve nfi|\bir\b/.test(around)
          ? "place-ir"
          : /suspended/.test(around)
            ? "place-susp"
            : /retired/.test(around)
              ? "place-retired"
              : "place";
      }
      if ((kind === "sign" || kind === "promote") && /active roster/.test(around) && /practice squad/.test(around)) kind = "promote";
      out.push({ slug: h.slug, kind, detail: around.trim(), practiceSquad: /practice squad/.test(around) });
    }
  }
  return out;
}

function main() {
  const logs = JSON.parse(fs.readFileSync(LOGS_FILE, "utf8"));
  const cand = JSON.parse(fs.readFileSync(CANDIDATES_FILE, "utf8"));
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));
  const nameOf = new Map(players.map((p) => [p.slug, p.name]));
  const slugs = Object.keys(cand.players);
  const names = slugs.map((s) => [s, norm(nameOf.get(s) ?? s.replace(/-/g, " "))]).filter(([, n]) => n.split(" ").length >= 2);

  // Every log move of these players, by slug.
  const byPlayer = new Map();
  for (const [team, years] of Object.entries(logs.teams)) {
    for (const [year, rows] of Object.entries(years)) {
      for (const row of rows) {
        if (/test transaction/i.test(row.text)) continue;
        const t = norm(row.text);
        const here = names.filter(([, n]) => t.includes(n));
        if (!here.length) continue;
        for (const m of movesIn(row.text, here)) {
          const list = byPlayer.get(m.slug) ?? [];
          list.push({ team, date: row.date, text: row.text, kind: m.kind, practiceSquad: m.practiceSquad, covid: /covid/i.test(m.detail) || /covid/i.test(row.text) && m.kind === "activate", url: `https://www.${siteOf(team)}/team/transactions/${year}` });
          byPlayer.set(m.slug, list);
        }
      }
    }
  }

  const facts = {};
  const used = new Set();
  const tally = {};
  for (const [slug, p] of Object.entries(cand.players)) {
    const moves = byPlayer.get(slug) ?? [];
    for (const f of p.facts) {
      // Only what was read from Wikipedia is on trial; moves added from the logs are the logs.
      if ((f.status === "rejected" && f.reason) || f.method !== "extracted") continue;
      const v = f.value;
      const year = Number(v.date.slice(0, 4));
      const want = CONFIRMS[v.type] ?? [];
      const hasLog = v.team !== "DAL" && (logs.teams[v.team]?.[year]?.length ?? 0) > 0;
      const sameTeam = moves.filter((m) => m.team === v.team);
      const exact = sameTeam.find((m) => want.includes(m.kind) && m.date === v.date);
      const near = sameTeam
        .filter((m) => want.includes(m.kind) && v.date.length === 10 && Math.abs(days(m.date, v.date)) <= WINDOW_DAYS)
        .sort((a, b) => Math.abs(days(a.date, v.date)) - Math.abs(days(b.date, v.date)))[0];
      // A different move the same day is a type error only when the two conflict
      // (waived vs released, placed on IR vs activated); otherwise both can be true.
      const RIVAL = { Released: ["waive"], Waived: ["release"], "Placed on IR": ["activate"], Activated: ["place-ir"], Signed: ["claim"], Claimed: ["sign"] };
      const sameDay = sameTeam.find((m) => m.date === v.date && (RIVAL[v.type] ?? []).includes(m.kind));
      let out;
      if (exact) {
        out = { verdict: "APPROVE", confidence: "HIGH", official: exact, notes: "The club's official transaction log lists this move on this date." };
      } else if (near) {
        // The historical archive is not automatically the event date (mak,
        // 2026-10-01): it can carry the processing date and sometimes differs
        // from the club's own announcement by a day. The stored date stays the
        // user-facing event; the archive date is kept beside it as a
        // processing-date record, and the conflict is flagged for review, not
        // silently resolved.
        out = {
          verdict: "DATE CONFLICT",
          confidence: "MEDIUM",
          official: near,
          verified: { events: [{ date: near.date, status: "processed" }] },
          notes: `The archived log dates this move ${near.date}, ${Math.abs(days(near.date, v.date))} day(s) ${days(near.date, v.date) > 0 ? "after" : "before"} the stored date (${v.date}). The stored date is kept as the event; the archive date is recorded as the processing date. If a contemporaneous club announcement pins the event day, prefer it (rule in data/player/bio_rulings.json).`,
        };
      } else if (sameDay) {
        out = {
          verdict: "EDIT",
          confidence: "HIGH",
          official: sameDay,
          verified: { type: { waive: "Waived", release: "Released", activate: "Activated", "place-ir": "Placed on IR", claim: "Claimed", sign: "Signed" }[sameDay.kind] },
          notes: `The official log records a different move that day: "${sameDay.text}"`,
        };
      } else if (hasLog) {
        out = { verdict: "UNABLE TO VERIFY", confidence: "LOW", notes: `Not found in the ${v.team} official transaction log for ${year}.` };
      } else {
        out = { verdict: "UNABLE TO VERIFY", confidence: "LOW", notes: v.team === "DAL" ? "The Cowboys publish no transaction log." : `No official transaction log before 2017.` };
      }
      // Terms are not in the logs: a confirmed date on a contract still needs the search pass.
      if ((v.terms || v.type === "Contract" || v.type === "Traded") && out.verdict === "APPROVE") {
        out = { ...out, verdict: "DATE CONFIRMED", notes: `${out.notes} Contract terms and trade details are checked separately.` };
      }
      if (out.official) used.add(`${slug}|${out.official.team}|${out.official.date}|${out.official.text}`);
      facts[f.id] = { slug, pass: "official-log", ...out };
      tally[out.verdict] = (tally[out.verdict] ?? 0) + 1;
    }
  }

  // The page's trade rows come from nflverse (bio_sources.json), not from the
  // candidates: check their dates against the logs of the club he left.
  const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8")).players;
  const trades = {};
  const tradeTally = {};
  for (const slug of new Set([...byPlayer.keys(), ...Object.keys(cand.players)])) {
    const rec = sources[slug]?.facts.find((f) => f.field === "trades" && f.status === "approved");
    for (const t of rec?.value ?? []) {
      const moves = (byPlayer.get(slug) ?? []).filter((m) => m.kind === "trade" && (m.team === t.from || m.team === t.to));
      const best = moves.sort((a, b) => Math.abs(days(a.date, t.date)) - Math.abs(days(b.date, t.date)))[0];
      const gap = best ? Math.abs(days(best.date, t.date)) : null;
      const year = Number(t.date.slice(0, 4));
      const out =
        best && gap === 0
          ? { verdict: "APPROVE", confidence: "HIGH", official: best }
          : best && gap <= 30
            ? { verdict: "DATE UNCERTAIN", confidence: "MEDIUM", official: best, verified: { date: best.date }, notes: `nflverse dates this trade ${t.date}; the ${best.team} official log lists it ${best.date}. The log is the official transaction date; nflverse may carry the agreement date.` }
            : year >= 2017 && (logs.teams[t.from]?.[year]?.length || logs.teams[t.to]?.[year]?.length)
              ? { verdict: "UNABLE TO VERIFY", confidence: "LOW", notes: "Not found in either club's official log." }
              : { verdict: "UNABLE TO VERIFY", confidence: "LOW", notes: "No official log for this club and year." };
      if (out.official) used.add(`${slug}|${out.official.team}|${out.official.date}|${out.official.text}`);
      (trades[slug] ??= []).push({ date: t.date, from: t.from, to: t.to, ...out });
      tradeTally[out.verdict] = (tradeTally[out.verdict] ?? 0) + 1;
    }
  }

  // Log moves with no fact: missing transactions. Practice-squad churn and
  // COVID-list moves are left out (mak: significant moves, not procedural noise).
  const missing = {};
  let nMissing = 0;
  for (const [slug, moves] of byPlayer) {
    for (const m of moves) {
      if (!m.kind || m.kind === "place" || m.practiceSquad || m.covid || used.has(`${slug}|${m.team}|${m.date}|${m.text}`)) continue;
      // Both clubs log a trade: keep one row.
      if (m.kind === "trade" && (missing[slug] ?? []).some((x) => x.kind === "trade" && Math.abs(days(x.date, m.date)) <= 3)) continue;
      (missing[slug] ??= []).push(m);
      nMissing += 1;
    }
  }

  const doc = { version: 1, checkedAt: new Date().toISOString(), logsRetrievedAt: logs.retrievedAt, facts, trades, missing };
  fs.writeFileSync(VERIFY_FILE, JSON.stringify(doc, null, 1));
  console.log(`[verify-logs] nflverse trades: ${JSON.stringify(tradeTally)}`);
  console.log(`[verify-logs] ${JSON.stringify(tally)}; missing moves from official logs: ${nMissing} for ${Object.keys(missing).length} players`);
}

const SITES = {
  ARI: "azcardinals.com", ATL: "atlantafalcons.com", BAL: "baltimoreravens.com", BUF: "buffalobills.com",
  CAR: "panthers.com", CHI: "chicagobears.com", CIN: "bengals.com", CLE: "clevelandbrowns.com",
  DEN: "denverbroncos.com", DET: "detroitlions.com", GB: "packers.com", HOU: "houstontexans.com",
  IND: "colts.com", JAX: "jaguars.com", KC: "chiefs.com", LAC: "chargers.com", LAR: "therams.com",
  LV: "raiders.com", MIA: "miamidolphins.com", MIN: "vikings.com", NE: "patriots.com",
  NO: "neworleanssaints.com", NYG: "giants.com", NYJ: "newyorkjets.com", PHI: "philadelphiaeagles.com",
  PIT: "steelers.com", SEA: "seahawks.com", SF: "49ers.com", TB: "buccaneers.com",
  TEN: "tennesseetitans.com", WAS: "commanders.com",
};
const siteOf = (team) => SITES[team] ?? "";

if (import.meta.url === `file://${process.argv[1]}`) main();
