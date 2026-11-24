#!/usr/bin/env node
/**
 * The written Game Recap (mak, 2026-11-17: "build it"): Claude writes each
 * completed game's recap from the engine's facts packet, a second pass checks
 * it against the same packet, and only a recap that passes is stored, in
 * data/matchup/recap_prose_<season>.json. Nothing runs at page load; the page
 * reads the stored text and shows it only while the evidence it was written
 * from is unchanged (factsHash), else the engine's own text.
 *
 * Paid: every game is one writing call and one checking call (two more if the
 * first draft fails and is revised). Hand-run, like the other matchup
 * builders; mak approved the spend on 2026-11-17 ([[no-paid-model-calls]]).
 *
 *   node scripts/matchup/writeRecaps.mjs [season] [--games ID,ID] [--limit N]
 *        [--force] [--dry-run] [--base http://localhost:8080]
 *
 * Needs the preview server running (it renders each page to build the
 * packet), INGEST_SECRET (the packet route is guarded) and ANTHROPIC_API_KEY.
 * --dry-run prints the packet for the first game and calls nothing paid.
 * --check-drafts runs the house checks on every engine draft, also unpaid.
 *
 * Without an API key (2026-11-17), the writing can be done by Claude Code
 * agents in a session, with the same guide and the same checks:
 *   --export DIR   writes DIR/<id>.json (the packet + its hash) for every
 *                  game that needs a recap, plus DIR/WRITER.md and DIR/CHECKER.md
 *   --import FILE  reads {"<id>": {"headline", "paragraphs"}, ...} written
 *                  from those packets, runs the house checks against the
 *                  CURRENT packet and stores each one that passes. The
 *                  fact-check pass is the session's checker agents, run first.
 * A game whose stored recap still matches its packet is skipped unless --force.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const MODEL = "claude-opus-5-5";
const PRICE = { input: 4, output: 20 }; // $ per million tokens, Claude Opus 5.5

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? new Date().getUTCFullYear());
const only = opt("--games")?.split(",").filter(Boolean) ?? null;
const limit = Number(opt("--limit") ?? Infinity);
const base = opt("--base") ?? "http://localhost:8080";
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
// Runs the house checks on the engine's own drafts: no paid calls. Every
// draft is true by construction, so anything flagged is a checker false positive.
const checkDrafts = args.includes("--check-drafts");
const exportDir = opt("--export");
const importFile = opt("--import");
// With --import: run the house checks only, store nothing (for the writers to self-check).
const checkOnly = args.includes("--check-only");
const offline = dryRun || checkDrafts || Boolean(exportDir) || Boolean(importFile);

const OUT = path.join(ROOT, "data", "matchup", `recap_prose_${season}.json`);
const story = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "matchup", `game_story_${season}.json`), "utf8"));
const teamsSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "team", "teams.ts"), "utf8");
const slug = {};
for (const m of teamsSrc.matchAll(/abbreviation: "(\w+)", slug: "([\w-]+)"/g)) slug[m[1].toUpperCase()] = m[2];
const CODE = { LA: "LAR" };

const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { season, games: {} };
const save = () => {
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1) + "\n");
};

/* ------------------------------------------------------------ prompts */

const WRITER = `You are an experienced NFL beat writer filing the game recap for a football website. You write from a packet of verified facts about one game, and the packet is the ONLY source you may use.

What a good recap does:
- It tells the story of THIS game. From the ranked storylines, choose the two to four that mattered most (you may re-rank with judgment) and leave the rest out, however true. Do not force every fact in.
- Opening paragraph: the winner, the score, the standout storyline and what the result means (use the records and streaks in the packet only if they are given).
- Then how the game unfolded: the scoring runs, the drives and plays that turned it, in game order.
- Then the decisive performances and the figures that settled it, with cause and effect drawn ONLY from the packet (for example: the quarterback was lost on the opening drive, and the backup's line and the team's yards per play show the offense could not sustain drives).
- Close with the losing team's side and how the game ended.
- Let the shape follow the game: a comeback reads differently from a rout, a defensive struggle differently from a shootout.

Make it an article, not a play-by-play (mak's review, 2026-11-17):
- Do not open by repeating the headline. If the headline carries the star's numbers and the score, the first sentence leads with something else: the most dramatic development and the winner's response (a quarterback lost on the opening drive and how the other side took over), with the score worked in naturally.
- Explain how the winner took control instead of cataloging scores. Name at most two or three individual scores, the ones that turned the game; summarize the rest ("28 unanswered points", "touchdowns on three of four possessions").
- Put cause and effect where it explains the game, not at the end. If the loser's offense struggled, connect it early to its cause in the packet (the quarterback change, the pass rush and sacks) rather than leaving the yards-per-play line for the last paragraph.
- When something unusual happened, say why it mattered, not just that it happened. Three interceptions in under six minutes that produced no points matter because the lead stayed intact; say so, and be exact about whose they were.
- End with a conclusion, not with the last score. The final paragraph says how the winner kept control (including what it overcame, such as its own turnovers) and what the result means for each team: records and streaks from the packet. A late score by the loser can appear, but not as the last word.
- When the packet's venue is neutral (an international or neutral-site game), name the city in the opening paragraph.
- "Star", "standout" and similar labels are opinion; let the numbers say it.

How it reads:
- Complete, natural paragraphs (3 to 5), varied sentence construction, connected events. No lists, no stat dumps, no mechanical transitions.
- Aim for 180 to 260 words when the packet has enough meaningful material; write shorter (not under about 120) when it does not. Quality over length. Never pad.
- Name a player in full the first time, by last name after.
- Plain wire-service English. No clichés: never "never looked back", "statement win", "dominant", "dominates", "cruise", "overwhelm", "stole the show", "when it mattered most", "took over the game", "sealed the deal", "in a big way", "little consolation".
- AP style: spell out one through nine for counts, figures for 10 and up and for all yards, scores and times. Scores and records use digits: "35–10" with an en dash for scores, "7-2" with a hyphen for records.
- Never use an em dash (—). Use commas, periods or semicolons.
- Times: turn the packet's quarter and clock into plain phrases that stay accurate ("early in the fourth quarter" for 10:00 or more left, "midway through" 5:00-10:00, "late in" under 5:00, "in the final two minutes", "with 56 seconds left").

What you must never do:
- Never state anything the packet does not contain or directly imply: no quotes, no coaches, no crowd, no weather, no venue color, no history, no milestones, no season or career highs, no streaks or records beyond the packet's recordAfter and streakAfter, no injury details beyond the packet (only say two injuries came on one play when the packet says so).
- Never do arithmetic the packet does not already show, except the score margin and combined points given in the packet.
- Betting: mention the closing line only if the packet includes closingLine, and only to show the result was unexpected. No betting jargon beyond that.
- No fantasy football language.
- A field goal try listed under blockedKicks was blocked: say blocked, never "missed" (a drive result of blocked_fg is the same kick).
- A score marked "the final play of the game" won it on the last snap: call it the game-winning score; never say it gave a lead that held or was kept ("for good", "never gave up", "the rest of the way"). Use go-ahead wording only when the other side had the ball again.
- A turnover on downs is a failed fourth down: say so, and do not describe it as a gain.

Headline: one line, under 80 characters, present tense, the lead storyline plus the result, with the score (en dash). Example of the form: "Gibbs piles up 252 yards as Lions rout Patriots 35–10".

The packet also holds a "draft" written by a rules engine. Every fact in it is verified, but the writing is mechanical. You may use its facts; do not copy its phrasing.

Return JSON only: {"headline": string, "paragraphs": [string, ...]}.`;

const CHECKER = `You are a meticulous sports-desk fact checker. You get a packet of verified facts about one NFL game and a recap written from it. Your only job is to find claims in the recap that the packet does not support.

Flag:
- any number, count (including spelled-out counts and words like "twice"), score, yardage, record, time or quarter that does not match the packet;
- any player, team, play or event attributed wrongly (who threw, caught, ran, intercepted, kicked, was injured; which team);
- any timing phrase that contradicts the packet's quarter and clock ("late in the third quarter" for a play at 12:00 of the third is wrong);
- any claim from outside the packet: quotes, coaches, crowd, weather, history, milestones, streaks or records beyond recordAfter/streakAfter, injury severity or diagnosis, motives;
- any causal claim stated as fact that goes beyond what the packet's numbers show;
- any statement that two injuries happened on one play unless the packet says so.

Do NOT flag: reasonable characterizations directly supported by the numbers (a 35–10 game is lopsided; 2.7 yards per play is a struggling offense), the margin or combined points, ordinary narrative transitions, or style.

Return JSON only: {"issues": [{"quote": string, "problem": string}]}. An empty list means the recap is fully supported.`;

const RECAP_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "paragraphs"],
  additionalProperties: false,
};
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: { quote: { type: "string" }, problem: { type: "string" } },
        required: ["quote", "problem"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
};

/* ---------------------------------------------------------- the model */

const client = offline ? null : new Anthropic();
const imported = importFile ? JSON.parse(fs.readFileSync(importFile, "utf8")) : null;
if (exportDir) {
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(path.join(exportDir, "WRITER.md"), WRITER + "\n");
  fs.writeFileSync(path.join(exportDir, "CHECKER.md"), CHECKER + "\n");
}
const spend = { input: 0, output: 0, calls: 0 };

async function ask(system, user, schema, effort) {
  // Claude Opus 5.5: adaptive thinking is on by default; effort sets its depth.
  // Server-side fallbacks re-run a refused request on a fallback model.
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  });
  spend.calls += 1;
  spend.input += (res.usage?.input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0);
  spend.output += res.usage?.output_tokens ?? 0;
  if (res.stop_reason === "refusal") throw new Error("refused");
  if (res.stop_reason === "max_tokens") throw new Error("ran out of tokens");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { json: JSON.parse(text), model: res.model };
}

/* ------------------------------------------------- the house checks */

const BANNED = [
  /—/, // em dash, house rule
  /never looked back/i, /statement win/i, /\bdominan(t|ce|ted)\b/i, /stole the show/i, /when it mattered most/i,
  /took over the game/i, /sealed the deal/i, /in a big way/i, /\bcruis(e|ed|es|ing)\b/i, /\boverwhelm/i, /little consolation/i, /career[- ]high/i, /season[- ]high/i,
  /franchise record/i, /first time since/i, /\bcoach/i, /\bcrowd\b/i, /\bfans\b/i, /\bweather\b/i, /["“”]/,
  /fantasy/i,
];
const ALLOWED_CAPS = new Set(["NFL", "AFC", "NFC", "OT", "TD", "TDs", "I"]);

/** Deterministic checks: house style, length, and every figure and proper name traceable to the packet. */
function houseCheck(recap, facts) {
  const issues = [];
  const all = [recap.headline, ...recap.paragraphs].join("\n");
  const source = JSON.stringify(facts);
  for (const re of BANNED) if (re.test(all)) issues.push({ quote: all.match(re)[0], problem: "house style forbids this" });
  if (recap.headline.length > 90) issues.push({ quote: recap.headline, problem: "headline over 90 characters" });
  if (recap.paragraphs.length < 2 || recap.paragraphs.length > 5) issues.push({ quote: "", problem: `${recap.paragraphs.length} paragraphs; write 3 to 5` });
  const words = recap.paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  if (words > 265) issues.push({ quote: "", problem: `${words} words; stay at 260 or under` });
  if (words < 90) issues.push({ quote: "", problem: `${words} words; too thin` });
  // Every figure must be in the packet.
  for (const m of all.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!source.includes(m[0])) issues.push({ quote: m[0], problem: "this figure is not in the packet" });
  }
  // Every proper name (a capitalized word not opening a sentence) must be in the packet.
  for (const para of [recap.headline, ...recap.paragraphs]) {
    const sentences = para.split(/(?<=[.;!?])\s+/);
    for (const s of sentences) {
      const tokens = s.split(/\s+/).slice(1);
      for (const raw of tokens) {
        const t = raw.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, "").replace(/'s?$/, "").replace(/\.$/, "");
        if (!/^[A-Z]/.test(t) || ALLOWED_CAPS.has(t)) continue;
        if (!source.includes(t)) issues.push({ quote: t, problem: "this name is not in the packet" });
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------- a game */

async function packetFor(id) {
  const [, wk, away, home] = id.split("_");
  const url = `${base}/nfl/${slug[CODE[away] ?? away]}-vs-${slug[CODE[home] ?? home]}/${season}-week-${Number(wk)}/`;
  const page = await fetch(url, { redirect: "follow" });
  if (!page.ok) throw new Error(`page ${page.status}: ${url}`);
  await page.text();
  const res = await fetch(`${base}/api/recap-facts/${id}`, { headers: { "x-ingest-secret": process.env.INGEST_SECRET ?? "" } });
  if (!res.ok) throw new Error(`packet ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function writeOne(id) {
  const { facts, hash } = await packetFor(id);
  const have = store.games[id];
  if (have && have.hash === hash && !force && !checkDrafts) return { id, status: "current" };
  if (dryRun) {
    console.log(JSON.stringify(facts, null, 1));
    return { id, status: "dry-run" };
  }
  if (exportDir) {
    fs.writeFileSync(path.join(exportDir, `${id}.json`), JSON.stringify({ hash, facts }, null, 1) + "\n");
    return { id, status: "exported" };
  }
  if (imported) {
    const recap = imported[id];
    if (!recap) return { id, status: "not in import" };
    const issues = houseCheck(recap, facts);
    if (issues.length) return { id, status: "rejected", issues };
    const words = recap.paragraphs.join(" ").split(/\s+/).length;
    if (checkOnly) return { id, status: "passes", words, attempts: 1 };
    // The sitemap's lastmod reads writtenAt (game-index.ts): an import that
    // brings back the same text is not a change to the page.
    const same = have && have.headline === recap.headline && JSON.stringify(have.paragraphs) === JSON.stringify(recap.paragraphs);
    store.games[id] = { headline: recap.headline, paragraphs: recap.paragraphs, hash, model: "claude-code-session", writtenAt: same && have.writtenAt ? have.writtenAt : new Date().toISOString(), words, checked: "house checks + checker agent" };
    save();
    return { id, status: "written", words, attempts: 1 };
  }
  if (checkDrafts) {
    const issues = houseCheck(facts.draft, { ...facts, draft: undefined }).filter((x) => !/words|paragraphs/.test(x.problem));
    return issues.length ? { id, status: "rejected", issues } : { id, status: "clean" };
  }
  const packet = JSON.stringify(facts, null, 1);
  let draft = (await ask(WRITER, `Facts packet:\n${packet}`, RECAP_SCHEMA, "high")).json;
  let model = MODEL;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const local = houseCheck(draft, facts);
    const checked = local.length ? { json: { issues: [] } } : await ask(CHECKER, `Facts packet:\n${packet}\n\nRecap:\n${JSON.stringify(draft, null, 1)}`, CHECK_SCHEMA, "high");
    model = checked.model ?? model;
    const issues = [...local, ...checked.json.issues];
    if (!issues.length) {
      const words = draft.paragraphs.join(" ").split(/\s+/).length;
      store.games[id] = { headline: draft.headline, paragraphs: draft.paragraphs, hash, model: MODEL, writtenAt: new Date().toISOString(), words, attempts: attempt };
      save();
      return { id, status: "written", words, attempts: attempt };
    }
    if (attempt === 2) return { id, status: "rejected", issues };
    const fix = `Facts packet:\n${packet}\n\nYour recap:\n${JSON.stringify(draft, null, 1)}\n\nA check found these problems. Rewrite the recap so every one is fixed, changing nothing that was right, and still follow every rule:\n${issues.map((x) => `- "${x.quote}": ${x.problem}`).join("\n")}`;
    draft = (await ask(WRITER, fix, RECAP_SCHEMA, "high")).json;
  }
  return { id, status: "rejected" };
}

/* -------------------------------------------------------------- main */

const ids = Object.entries(story.games)
  .filter(([, g]) => g.homeFinal !== g.awayFinal)
  .map(([id]) => id)
  .filter((id) => !only || only.includes(id))
  .filter((id) => !imported || id in imported)
  .sort()
  .slice(0, dryRun ? 1 : limit);

const results = [];
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    try {
      const r = await writeOne(id);
      results.push(r);
      console.log(`${id}: ${r.status}${r.words ? ` (${r.words} words, attempt ${r.attempts})` : ""}${r.issues ? `\n  ${r.issues.map((x) => `"${x.quote}": ${x.problem}`).join("\n  ")}` : ""}`);
    } catch (err) {
      results.push({ id, status: "error" });
      console.log(`${id}: error ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: dryRun ? 1 : 3 }, worker));

const count = (s) => results.filter((r) => r.status === s).length;
const cost = (spend.input * PRICE.input + spend.output * PRICE.output) / 1e6;
console.log(`\n${ids.length} games: ${count("written")} written, ${count("current")} current, ${count("rejected")} rejected, ${count("error")} errors`);
if (!dryRun && !checkDrafts) console.log(`${spend.calls} calls, ${spend.input} input + ${spend.output} output tokens, about $${cost.toFixed(2)}`);
