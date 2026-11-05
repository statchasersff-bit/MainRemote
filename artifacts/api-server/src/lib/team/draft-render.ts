/**
 * The team hub's Draft tab: the entry point and the text helpers.
 *
 * Server-rendered in full like the tabs beside it. The markup is the premium
 * design in team/draft-premium.ts (mak, 2026-11-05); this file holds what the
 * block and the Draft FAQ share - the kicker sentences, the name link, the
 * depth slot, the school names - and the section entry point.
 *
 * No FAQ and no address of its own: a hub-only panel, like Coaching, until
 * a public URL is approved.
 */

import { escapeHtml } from "../render";
import { rosterPlayer } from "./contracts-render";
import { getPlayerProfileUrl } from "./links";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";
import type { DraftCapitalView, DraftHistoryView, DraftPick, DraftStatusDoc, DraftView } from "./draft";
import { depthSlotFor } from "./depth-charts";
import { renderDraftPremium } from "./draft-premium";

const e = escapeHtml;

/** "Texans", or the code when a club is unknown to the site. */
export function nick(abbr: string): string {
  return getTeamByAbbreviation(abbr)?.nickname ?? abbr.toUpperCase();
}

/* ------------------------------------------------------------- next draft */

type Round = DraftCapitalView["rounds"][number];

/** "Round 5", "Rounds 5-7", "Rounds 2 and 5", "Rounds 2, 5 and 7". */
function roundList(rounds: number[]): string {
  if (rounds.length === 0) return "";
  if (rounds.length === 1) return `Round ${rounds[0]}`;
  const first = rounds[0] ?? 0;
  const last = rounds[rounds.length - 1] ?? 0;
  const contiguous = last - first === rounds.length - 1;
  if (contiguous && rounds.length > 2) return `Rounds ${first}-${last}`;
  return `Rounds ${rounds.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * One line that says what the numbers do not: where the capital is stacked
 * or bare, and whether Day 2 (Rounds 2-3) gained anything. Rule-based, so
 * every club gets a true sentence from the same file.
 */
export function capitalKicker(c: DraftCapitalView): string {
  const multi = c.rounds.filter((r) => r.holds.length > 1).map((r) => r.round);
  const empty = c.rounds.filter((r) => r.holds.length === 0).map((r) => r.round);
  const fromRounds = c.rounds.filter((r) => r.holds.some((h) => h.from !== null)).map((r) => r.round);
  const day2Added = fromRounds.some((r) => r === 2 || r === 3);

  let lead: string;
  if (multi.length) lead = `Extra capital in ${roundList(multi)}`;
  else if (fromRounds.length) lead = `Acquired picks sit in ${roundList(fromRounds)}`;
  else if (empty.length === 0 && c.sent.length === 0) lead = "One own pick in every round, none added";
  else lead = "Own picks only";

  let tail: string | null;
  if (empty.length) tail = `no pick in ${roundList(empty)}`;
  else if (c.acquired && !day2Added) tail = "nothing added on Day 2";
  else if (c.acquired) tail = "Day 2 capital added";
  else if (c.sent.length) tail = `${countWord(c.sent.length).toLowerCase()} own ${c.sent.length === 1 ? "pick" : "picks"} traded away`;
  else tail = null;
  return tail ? `${lead}; ${tail}.` : `${lead}.`;
}





/** "Two" for a sentence that opens on a count; digits past nine. */
function countWord(n: number): string {
  const words = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[n] ?? String(n);
}


/* ----------------------------------------------------------- history */



/**
 * The one line the bars hide: where the club's draft capital goes. The
 * larger of the two blocs (OL, DL and DB against QB, RB, WR and TE) and
 * its share, so "58% of picks spent on OL, DL and DB" says the thing the
 * nine rows only imply.
 */
export function historyKicker(h: DraftHistoryView): string {
  if (h.total === 0) return "";
  const sum = (cats: string[]): number =>
    h.allPicks.filter((r) => cats.includes(r.category)).reduce((n, r) => n + r.count, 0);
  const lines = sum(["OL", "DL", "DB"]);
  const skill = sum(["QB", "RB", "WR", "TE"]);
  const [count, label] = lines >= skill ? [lines, "OL, DL and DB"] : [skill, "QB, RB, WR and TE"];
  const pct = Math.round((count / h.total) * 100);
  return `${pct}% of picks spent on ${label}.`;
}

export function playerCell(pick: DraftPick): string {
  const href = getPlayerProfileUrl(pick.name);
  return href
    ? `<a class="sct-dr-name sct-player-link" href="${e(href)}" target="_top">${e(pick.name)}</a>`
    : `<span class="sct-dr-name">${e(pick.name)}</span>`;
}

/**
 * The pick's headshot through the image route (2026-10-29, mak: "add player
 * images"): by the Sleeper id the register run paired, or, for a pick the
 * crosswalk has not met, by name on this club's roster. A player with no
 * pairing, or whom Sleeper has no photo of, keeps a bare well so the names
 * stay aligned and nobody wears another player's face.
 */
/** The id the headshot route knows the pick by, or null when no pairing is known. */
export function faceIdFor(team: NflTeam, pick: DraftPick): string | null {
  return pick.sleeperId ?? rosterPlayer(team, pick.name)?.id ?? null;
}




/**
 * One scheme for the register's school names: the abbreviations it carries
 * ("Ohio St.", "Boston Col.") written out, so a column does not mix
 * "Connecticut" with "Penn St.".
 */
const COLLEGE_WORDS: Array<[RegExp, string]> = [
  [/\bSt\.$/, "State"],
  [/\bCol\.$/, "College"],
  [/\bTenn\. /, "Tennessee "],
  [/^NW /, "Northwest "],
  [/^SE /, "Southeast "],
  [/^S\.F\. Austin$/, "Stephen F. Austin"],
];

export function collegeName(college: string): string {
  let name = college.trim();
  if (!name) return "-";
  for (const [pattern, word] of COLLEGE_WORDS) name = name.replace(pattern, word);
  return name;
}

/**
 * The pick's depth chart slot under their position: "LT2", "EDGE4", "CB2",
 * in the chart's own slot names (mak, 2026-10-29: "add their depth chart
 * position"). Read off the chart of the club the player is with now, so a
 * traded or waived player shows where they sit on the new club's chart and
 * the Status column says which club that is. Empty when no chart lists them.
 */
export function depthSlotCell(pick: DraftPick, club: string, statusDoc: DraftStatusDoc | null): string {
  const entry = pick.gsisId ? statusDoc?.players[pick.gsisId] : undefined;
  const now = entry?.now;
  if (now && (now.kind === "none" || now.kind === "retired")) return "";
  const where = (now?.club ?? club).toUpperCase();
  const slot = depthSlotFor(pick.name, where);
  if (!slot) return "";
  const text = `${slot.slot}${slot.rank}`;
  return `<span class="sct-dr-slot" title="${e(`${text} on the ${where} depth chart`)}">${e(text)}</span>`;
}




/* ---------------------------------------------------------------- section */

/**
 * The whole tab, or "" when neither file has this club, which drops the tab
 * from the strip rather than mounting an empty panel.
 *
 * The premium design since 2026-11-05 (mak's brief, approved the same day
 * and the old rail-and-tables layout removed): the banner carrying the
 * heading, the class tables on the left, the next draft's ledger, the Last
 * 5 Drafts mix and the Round 1 list on the right (team/draft-premium.ts).
 * This file keeps the sentences and cells the premium block and the FAQ
 * share, so the two can never disagree.
 */
export function renderDraftSection(team: NflTeam, view: DraftView, season: number): string {
  if (!view.capital && !view.history) return "";
  return renderDraftPremium(team, view, season);
  // The club-specific FAQ (draft-faq.ts, mak 2026-11-02) is the section's
  // tail, placed by team-render.ts like every other tab's questions.
}
