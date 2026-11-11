/**
 * Markup for the team pages' Offensive Coaching & Scheme section.
 *
 * Server-rendered in full like the usage page beside it: everything is in
 * the HTML the server sends, and nothing here needs the client bundle.
 * Rebuilt 2026-11-05 on mak's coaching brief, an NFL report first: (1) the
 * coordinator & scheme overview - the coach card with its Coaching
 * Continuity meter beside the season's offensive identity (four KPIs and a
 * generated paragraph); (2) the offensive tendencies in two groups, Play
 * Calling and Formations & Tempo, each with a sentence written from its
 * meaningful changes; (3) Formations & Personnel; (4) Situational Play
 * Calling - score state, red zone and fourth down with their samples; (5)
 * Target & Backfield Tendencies; (6) Coaching Career & Historical
 * Performance - the timeline, the scoring chart and a season-by-season NFL
 * table; (7) Fantasy Impact, one collapsed section holding the finishes,
 * the signal readings and the bottom line.
 *
 * The section is mostly the evergreen layer read from
 * data/team/coaching_<season>.json. The weekly surface our own feed carries -
 * the four env-backed tendency rows and the current backfield bar - is read
 * live from the usage view handed in, so those cells move with the daily
 * chain while everything editorial stays put (see coaching.ts).
 */

import { escapeHtml, TEAM_ACCENTS, TEAM_COLORS } from "../render";
import { getTeamByAbbreviation, type NflTeam } from "./teams";
import {
  getCoachingStaff,
  reliabilityRating,
  type BarRow,
  type Reliability,
  type TeamCoaching,
  type TendencyRow,
} from "./coaching";
import type { UsageView } from "./usage";
import { signed } from "./usage-copy";
import { coachingFaq } from "./coaching-faq";
import { renderCoachingPremium } from "./coaching-premium";
import { renderCoachingPremiumTendencies } from "./coaching-premium-tendencies";
import { renderCoachingCareerPremium } from "./coaching-career-premium";
import { renderSeasonHistoryTable } from "./coaching-seasons-premium";
import { renderCoachingFantasyPremium } from "./coaching-fantasy-premium";
import { faqEntries, renderFaqBlock } from "./faq-block";

const e = escapeHtml;

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix =
    rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
/** "third", or "15th" past ten. */
const ordinalWord = (n: number): string => ORDINAL_WORDS[n] ?? ordinal(n);

/** "a, b and c" - the house list, no serial comma. */
function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------ header/intro */

export const seasonOf = (c: TeamCoaching): number => parseInt(c.tendencies.currentLabel, 10);

/** "New England", or "the Giants" where two clubs share a city. */
export function cityOf(team: NflTeam): string {
  return /^(New York|Los Angeles)$/.test(team.city) ? `the ${team.nickname}` : team.city;
}

/* -------------------------------------------------------------- coach card */

/**
 * The scheme note split into a scan tag and its qualifier, at the first
 * clause break: "Belichick / Patriots lineage" + "Historically Erhardt-
 * Perkins-based terminology...". The stored sentence is verified copy, so it
 * is split, never rewritten.
 */
export function splitTree(tree: string): { tag: string; note: string } {
  const m = tree.match(/^(.+?)(?:;\s+|\s+-\s+|,\s+|\s+\((.+)\)$|(?:\s+blended)?\s+(?=with\s))(.*)$/);
  if (!m) return { tag: tree, note: "" };
  const rest = (m[2] ?? m[3] ?? "").trim();
  return { tag: m[1], note: rest ? rest[0].toUpperCase() + rest.slice(1) : "" };
}

/** Club nicknames to the code a timeline row wears, by the season it began. */
const STEP_CLUBS: Array<[RegExp, (year: number) => string]> = [
  [/\bCardinals\b/, () => "ARI"], [/\bFalcons\b/, () => "ATL"], [/\bRavens\b/, () => "BAL"],
  [/\bBills\b/, () => "BUF"], [/\bPanthers\b/, () => "CAR"], [/\bBears\b/, () => "CHI"],
  [/\bBengals\b/, () => "CIN"], [/\bBrowns\b/, () => "CLE"], [/\bCowboys\b/, () => "DAL"],
  [/\bBroncos\b/, () => "DEN"], [/\bLions\b/, () => "DET"], [/\bPackers\b/, () => "GB"],
  [/\bTexans\b/, () => "HOU"], [/\bColts\b/, () => "IND"], [/\bJaguars\b/, () => "JAX"],
  [/\bChiefs\b/, () => "KC"], [/\bChargers\b/, (y) => (y < 2017 ? "SD" : "LAC")],
  [/\bRams\b/, (y) => (y < 2016 ? "STL" : "LAR")], [/\bRaiders\b/, (y) => (y < 2020 ? "OAK" : "LV")],
  [/\bDolphins\b/, () => "MIA"], [/\bVikings\b/, () => "MIN"], [/\bPatriots\b/, () => "NE"],
  [/\bSaints\b/, () => "NO"], [/\bGiants\b/, () => "NYG"], [/\bJets\b/, () => "NYJ"],
  [/\bEagles\b/, () => "PHI"], [/\bSteelers\b/, () => "PIT"], [/\bSeahawks\b/, () => "SEA"],
  [/\b49ers\b/, () => "SF"], [/\bBuccaneers\b/, () => "TB"], [/\bTitans\b/, () => "TEN"],
  [/\b(?:Commanders|Redskins|Washington)\b/, () => "WAS"],
];

/**
 * One career step as a timeline row: the clubs it names as codes, and the
 * role with its parentheticals moved to the row's title so it scans. A
 * single-club role loses its leading nickname, which the code now carries.
 */
/** Role-only timeline entries (mak, 2026-11-02): titles abbreviated, flourishes dropped. */
const ROLE_SHORT: Array<[RegExp, string]> = [
  [/\bpassing[- ]game coordinator\b/gi, "pass-game coord."],
  [/\brun(?:ning)?[- ]game coordinator\b/gi, "run-game coord."],
  [/\bassistant head coach\b/gi, "asst. HC"],
  [/\boffensive coordinator\b/gi, "OC"],
  [/\bdefensive coordinator\b/gi, "DC"],
  [/\bhead coach\b/gi, "HC"],
  [/\bquarterbacks? coach\b/gi, "QB coach"],
  [/\bwide receivers? coach\b/gi, "WR coach"],
  [/\brunning backs? coach\b/gi, "RB coach"],
  [/\btight ends? coach\b/gi, "TE coach"],
  [/\boffensive line coach\b/gi, "OL coach"],
  [/\bplay-caller\b/gi, "caller"],
  [/\brecord-setting\s+/gi, ""],
  [/\s+-\s+/g, " · "],
  [/\s{2,}/g, " "],
];

function shortRole(role: string): string {
  return ROLE_SHORT.reduce((text, [re, to]) => text.replace(re, to), role).trim();
}

/** Codes the timeline prints for clubs that have since moved, mapped to today's crest. */
const MOVED_CODES: Record<string, string> = { STL: "LAR", SD: "LAC", OAK: "LV" };

/** Today's crest for a timeline code (STL wears the Rams' crest), or null when the club has none. */
export function stepLogo(code: string): string | null {
  return getTeamByAbbreviation(MOVED_CODES[code] ?? code)?.logo ?? null;
}

/** One career step read for a timeline row: its clubs as codes, the short role, and its span. */
export interface TimelineStep {
  years: string;
  codes: string[];
  role: string;
  /** The stored role when the row's reads differently, for a title. */
  full: string | null;
  start: number;
  /** Inclusive; the start year when the step names one season. */
  end: number;
}

export function timelineStepModel(step: { role: string; years: string }): TimelineStep {
  const year = parseInt(step.years, 10);
  const hits = STEP_CLUBS.map(([re, code]) => ({ at: step.role.search(re), re, code: code(year) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  let role = step.role.replace(/\s*\([^)]*\)/g, "").trim();
  const codes = [...new Set(hits.map((h) => h.code))];
  // One club named, however many of its words match: drop it from the role,
  // along with the city in front of it ("Carolina Panthers OC" -> "OC").
  if (hits.length && codes.length === 1) {
    role = role.replace(new RegExp(`^(?:[A-Z][A-Za-z.]+\\s+){0,2}${hits[0].re.source}\\s+`), "");
  }
  role = shortRole(role);
  role = role[0].toUpperCase() + role.slice(1);
  const m = step.years.match(/^(\d{4})(?:-(\d{2}|\d{4}))?/);
  const start = m ? Number(m[1]) : year;
  let end = start;
  if (m?.[2]) end = m[2].length === 4 ? Number(m[2]) : Number(m[1].slice(0, 2) + m[2]);
  if (end < start) end += 100;
  return { years: step.years, codes, role, full: role !== step.role ? step.role : null, start, end };
}

/**
 * The builder's continuity sentence, cut to two short lines. Returning
 * callers get the rule-based pair (a broken tenure like NE's drops
 * "straight", and the kicker already carries the count); new-caller
 * explanations pass through, since who called last year is the point.
 */
/** The continuity line, one clause each side of a dot (mak's critique, 2026-11-05). */
export function relNote(c: TeamCoaching, rating: Reliability): string {
  const season = seasonOf(c);
  const prior = season - 1;
  if (rating === "HIGH") return `Same caller as ${prior} · strong baseline.`;
  if (rating === "MEDIUM" && c.reliability.priorSeasonsAsCaller === 1) return `Second season as caller · ${prior} is a usable baseline.`;
  if (rating === "MEDIUM") return `New caller, same scheme family · ${prior} is context, not baseline.`;
  return `New caller in ${season} · ${prior} is context, not baseline.`;
}

/**
 * "Third stint with New England" / "Fourth season calling plays for the
 * Bills": the caller's history with this club, from the research file's
 * calling stops (runs of consecutive seasons here).
 */
export function stintLine(c: TeamCoaching, team: NflTeam): string {
  const staff = getCoachingStaff(team.abbreviation, seasonOf(c));
  const season = seasonOf(c);
  const abbr = team.abbreviation.toUpperCase();
  const here = [...new Set((staff?.callingStops ?? []).filter((st) => st.team === abbr).flatMap((st) => st.seasons))].sort((a, b) => a - b);
  if (!here.length || c.reliability.priorSeasonsAsCaller === 0) return `First season calling plays for the ${team.nickname}`;
  const runs = here.filter((y, i) => i === 0 || y !== here[i - 1]! + 1).length;
  if (runs > 1) {
    const word = ordinalWord(runs);
    return `${word[0]!.toUpperCase()}${word.slice(1)} stint with ${cityOf(team)}`;
  }
  // The count the research file keeps (full seasons; a partial first season
  // is a note there, not a season), so the card and the FAQ agree.
  void season;
  const word = ordinalWord(c.reliability.priorSeasonsAsCaller + 1);
  return `${word[0]!.toUpperCase()}${word.slice(1)} season calling plays for the ${team.nickname}`;
}

/** Scheme families a lineage note names, as a chip ("Erhardt-Perkins tree"); the sentence itself rides in the title. */
const SCHEME_FAMILIES: Array<[RegExp, string]> = [
  [/Erhardt[- ]Perkins/i, "Erhardt-Perkins tree"],
  [/West Coast/i, "West Coast tree"],
  [/Air Coryell|Coryell/i, "Air Coryell tree"],
  [/Air Raid/i, "Air Raid tree"],
  [/run[- ]and[- ]shoot/i, "Run-and-shoot tree"],
  [/wide[- ]zone|outside zone/i, "Wide-zone scheme"],
  [/spread/i, "Spread scheme"],
  [/Shanahan|Kubiak/i, "Shanahan/Kubiak tree"],
  [/McVay/i, "McVay tree"],
  [/Reid/i, "Reid tree"],
  [/play[- ]action/i, "Play-action scheme"],
];

export function schemeChip(note: string): string | null {
  const hit = SCHEME_FAMILIES.find(([re]) => re.test(note));
  return hit ? hit[1] : null;
}

/* -------------------------------------------------------------- tendencies */

export interface RowView {
  current: string;
  change: { dir: "up" | "down" | "flat"; text: string };
  /** The move in the row's unit: points, or seconds for pace (+ = faster). */
  delta: number | null;
  rank: number | null;
}

/**
 * A row's current cell, change and league rank. Feed-backed rows read the
 * usage env block live; the rest keep the stored values, with the rank
 * recovered from the stored "- 2nd in NFL" tail.
 *
 * Changes are points or seconds, never a bare number, and the pace row
 * inverts: fewer seconds is "up" and reads "1.1s faster".
 */
export function rowView(row: TendencyRow, view: UsageView | null): RowView {
  const env = row.feed && view ? view.team.env[row.feed] : undefined;
  const value = env?.value;
  if (row.feed && row.priorNum != null && value != null) {
    const delta = value - row.priorNum;
    if (row.invert) {
      const dir = Math.abs(delta) < 0.3 ? "flat" : delta < 0 ? "up" : "down";
      const text = dir === "flat" ? "steady" : `${Math.abs(delta).toFixed(1)}s ${dir === "up" ? "faster" : "slower"}`;
      return { current: `${value.toFixed(1)}s`, change: { dir, text }, delta: -delta, rank: env?.rank ?? null };
    }
    const dir = Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
    const rounded = Math.round(value * 10) / 10;
    return {
      current: row.feed === "proe" ? `${signed(rounded)}%` : `${rounded}%`,
      change: { dir, text: dir === "flat" ? "steady" : `${signed(delta)} pts` },
      delta,
      rank: env?.rank ?? null,
    };
  }
  const m = row.change.text.match(/^([+−-]?\d+(?:\.\d+)?)(?:\s+-\s+(\d+)(?:st|nd|rd|th) in NFL)?$/);
  if (!m) return { current: row.current, change: row.change, delta: null, rank: null };
  const delta = Number(m[1].replace("−", "-"));
  return {
    current: row.current,
    change: { dir: row.change.dir, text: `${signed(delta)} pts` },
    delta,
    rank: m[2] ? Number(m[2]) : null,
  };
}

/** A league standing, only at the edges: top ten, or bottom five. */
export const atEdge = (rank: number | null): rank is number => rank != null && (rank <= 10 || rank >= 28);

/** Short names for the identity chips, by the builder's metric key. */
const CHIP_NAMES: Record<string, string> = {
  passRate: "Passing",
  proe: "Pass lean",
  earlyDownPassRate: "Early-down passing",
  noHuddleRate: "No-huddle",
  paRate: "Play action",
  motionRate: "Motion",
  shotgunRate: "Shotgun",
  rzPassRate: "RZ passing",
  fourthGoRate: "4th-down aggression",
};

/**
 * How a row is counted, opened from the row's label itself (dotted
 * underline) rather than an "i" on every row. A native popover, as on the RB
 * handcuffs notes: the top layer lifts it out of the table's scroll box and
 * any host stacking context, and the browser handles Escape and click-away.
 * These rates are denominator-sensitive, and this is where a reader finds out
 * why ours differs from another site's.
 */
export function rowLabel(row: TendencyRow, id: string): string {
  if (!row.def) return `<span class="sct-co-tlabel">${e(row.label)}</span>`;
  return (
    `<button type="button" class="sct-co-tlabel is-def" popovertarget="${e(id)}"` +
    ` title="How this is counted">${e(row.label)}</button>` +
    `<div class="sct-co-def" id="${e(id)}" popover>` +
    `<p class="sct-co-def-head">${e(row.label)}` +
    `<button type="button" class="sct-co-def-close" popovertarget="${e(id)}"` +
    ` popovertargetaction="hide" aria-label="Close">&times;</button></p>` +
    `<p class="sct-co-def-body">${e(row.def)}</p>` +
    `</div>`
  );
}

/** The sub-captions worth keeping under a label: denominators a reader cannot guess. */
export const KEEP_SUB = new Set(["proe", "fourthGoRate"]);

export function num(text: string): number | null {
  const m = text.replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * The change as the table prints it: an arrow for direction (neutral ink,
 * never red/green: a lower pass rate is not "bad"), the size in percentage
 * points, pace in seconds. The strip beside it carries the same move.
 */
export function changeText(row: TendencyRow, v: RowView): string {
  if (v.change.dir === "flat") return "steady";
  if (v.delta == null) return v.change.text;
  // A rate's change is in percentage points (60.5% to 58% is -2.5 pp, not
  // -2.5%), and pace is written out with no arrow beside the seconds (mak's
  // review, 2026-11-08: an up arrow next to "faster" read as ambiguous).
  const size = Math.abs(v.delta).toFixed(1);
  if (row.key === "pace" || row.invert) return `${size} ${size === "1.0" ? "second" : "seconds"} ${v.delta > 0 ? "faster" : "slower"}`;
  return `${v.delta > 0 ? "+" : "−"}${size} pp`;
}

/** The brief's two groups (2026-11-05); fourth down moves to Situational Play Calling. */
export const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Play Calling", keys: ["passRate", "proe", "earlyDownPassRate", "rzPassRate", "paRate"] },
  { title: "Formations & Tempo", keys: ["motionRate", "shotgunRate", "noHuddleRate", "pace"] },
];

/** Keys the tendencies table and its chips do not headline: shown with their sample in Situational Play Calling. */
export const SITUATIONAL_KEYS = new Set(["fourthGoRate"]);

/** How each tendency reads as a change, in NFL terms, for the generated group sentences. */
export const MOVE_PHRASE: Record<string, (up: boolean, pts: string) => string> = {
  passRate: (up, pts) => `passing ${up ? "more" : "less"} often (${pts})`,
  proe: (up, pts) => `${up ? "more" : "less"} pass-heavy than its situations predict (${pts})`,
  earlyDownPassRate: (up, pts) => `${up ? "passing" : "running"} more on early downs (${pts})`,
  rzPassRate: (up, pts) => `throwing ${up ? "more" : "less"} in the red zone (${pts})`,
  paRate: (up, pts) => `using ${up ? "more" : "less"} play-action (${pts})`,
  motionRate: (up, pts) => `using ${up ? "more" : "less"} pre-snap motion (${pts})`,
  shotgunRate: (up, pts) => `lining up in shotgun ${up ? "more" : "less"} often (${pts})`,
  noHuddleRate: (up, pts) => `going no-huddle ${up ? "more" : "less"} (${pts})`,
  pace: (up, pts) => `playing ${up ? "faster" : "slower"} (${pts})`,
};

/** Lower-case names for the league comparison. */
export const LEAGUE_NAME: Record<string, string> = {
  passRate: "pass rate",
  proe: "pass rate over expected",
  earlyDownPassRate: "early-down pass rate",
  rzPassRate: "red-zone pass rate",
  paRate: "play-action rate",
  motionRate: "motion rate",
  shotgunRate: "shotgun rate",
  noHuddleRate: "no-huddle rate",
  pace: "neutral pace",
};

/**
 * One sentence per group, written from the meaningful changes (3+ points,
 * or a second of pace) against the prior season, then the one tendency
 * furthest from the NFL average when it is 3+ points off. Team subject,
 * never the coach: a pass rate is the offense's, not one man's.
 */
export function groupSentence(
  group: Array<{ row: TendencyRow; v: RowView }>,
  team: NflTeam,
  priorYear: string,
  returning: boolean,
  // false: the readings without their figures in brackets, for a takeaway
  // that sits beside the table carrying them (mak's review, 2026-11-08).
  numbers = true,
): string {
  const city = cityOf(team);
  const moves = group
    .filter(({ row, v }) => v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3) && row.key && MOVE_PHRASE[row.key])
    .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))
    .map(({ row, v }) => {
      const d = v.delta as number;
      const pts = row.key === "pace" ? `${Math.abs(d).toFixed(1)}s per play` : `${signed(d)} pp`;
      const phrase = MOVE_PHRASE[row.key as string]!(d > 0, pts);
      return numbers ? phrase : phrase.replace(/ \([^)]*\)$/, "");
    });
  const vs = group
    .map(({ row, v }) => {
      const now = num(v.current);
      const avg = num(row.nflAvg);
      if (now == null || avg == null || !row.key) return null;
      const gap = row.invert ? avg - now : now - avg;
      return { row, v, gap, now, avg };
    })
    .filter((x): x is NonNullable<typeof x> => x != null && Math.abs(x.gap) >= (x.row.key === "pace" ? 1 : 3))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  const first = moves.length
    ? `Compared with ${returning ? priorYear : `the ${priorYear} staff`}, ${city} is ${list(moves)}.`
    : `No tendency in this group has moved 3% (or a second of pace) from ${priorYear}.`;
  const second = vs
    ? ` Against the league, its ${LEAGUE_NAME[vs.row.key as string]} (${vs.v.current}) is ${
        vs.row.key === "pace" ? (vs.gap > 0 ? "faster" : "slower") : vs.gap > 0 ? "above" : "below"
      } the NFL average of ${vs.row.nflAvg}${vs.v.rank != null && atEdge(vs.v.rank) ? ` (${ordinal(vs.v.rank)} in the NFL)` : ""}.`
    : "";
  return first + second;
}

/** Every row read once: the views the tendencies, the overview and the sentences share. */
export function rowViews(c: TeamCoaching, view: UsageView | null): Array<{ row: TendencyRow; v: RowView; i: number }> {
  return c.tendencies.rows.map((row, i) => ({ row, v: rowView(row, view), i }));
}

/* ---------------------------------------------------------------- overview */

/**
 * The overview paragraph: the two or three biggest moves against the prior
 * season across both groups, in one sentence (play calling first, then
 * "while" the formations and tempo), and the one tendency furthest from the
 * NFL average. The group notes under the tables carry the full lists.
 */
function identityParagraph(
  views: Array<{ row: TendencyRow; v: RowView }>,
  team: NflTeam,
  priorYear: string,
  returning: boolean,
): string {
  const city = cityOf(team);
  const usable = views.filter(({ row }) => row.key && !SITUATIONAL_KEYS.has(row.key) && MOVE_PHRASE[row.key]);
  const pick = (keys: string[], n: number) =>
    usable
      .filter(({ row, v }) => keys.includes(row.key as string) && v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3))
      .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))
      .slice(0, n)
      .map(({ row, v }) => {
        const d = v.delta as number;
        const pts = row.key === "pace" ? `${Math.abs(d).toFixed(1)}s per play` : `${signed(d)} pp`;
        return MOVE_PHRASE[row.key as string]!(d > 0, pts);
      });
  const calling = pick(GROUPS[0]!.keys, 2);
  const form = pick(GROUPS[1]!.keys, 2);
  const against = returning ? priorYear : `the ${priorYear} staff`;
  let first: string;
  if (calling.length && form.length) first = `Compared with ${against}, ${city} is ${list(calling)}, while ${list(form)}.`;
  else if (calling.length || form.length) first = `Compared with ${against}, ${city} is ${list([...calling, ...form])}.`;
  else first = `${city} is running the offense much as it did in ${priorYear}: no tendency has moved 3 points, or a second of pace.`;
  const vs = usable
    .map(({ row, v }) => {
      const now = num(v.current);
      const avg = num(row.nflAvg);
      if (now == null || avg == null) return null;
      const gap = row.invert ? avg - now : now - avg;
      return { row, v, gap };
    })
    .filter((x): x is NonNullable<typeof x> => x != null && Math.abs(x.gap) >= (x.row.key === "pace" ? 1 : 3))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  const second = vs
    ? ` Its ${LEAGUE_NAME[vs.row.key as string]} (${vs.v.current}) is ${
        vs.row.key === "pace" ? (vs.gap > 0 ? "faster" : "slower") : vs.gap > 0 ? "above" : "below"
      } the NFL average of ${vs.row.nflAvg}${vs.v.rank != null && atEdge(vs.v.rank) ? `, ${ordinal(vs.v.rank)} in the league` : ""}.`
    : "";
  return first + second;
}

void identityParagraph;

/* ------------------------------------------------------------- formations */

/**
 * Formations & Personnel (mak's brief, section 3): how the offense lines up
 * from the rows the play-by-play and charting support - shotgun against
 * under center, motion, play-action, no-huddle - and a plain statement of
 * what is not charted in season (personnel groupings, pistol, motion at
 * the snap versus before it), rather than an estimate.
 */
/** What is not charted in season; printed under the formation tiles rather than estimated. */
export const FORMATIONS_NOTE =
  "Not charted in season, so not estimated here: personnel groupings (11, 12, 21 personnel), pistol as distinct from shotgun, motion at the snap as distinct from motion before it, and zone versus gap run concepts. The league publishes participation data after the season.";

/** One formation tile: the row's current rate and its gap to the NFL average in points. */
export interface FormationTile {
  key: string;
  label: string;
  value: string;
  gap: number | null;
  avg: string;
  /** Up or down only past 3 points off the league; flat inside that band. */
  tone: "up" | "down" | "flat";
}

/**
 * The Formations & Personnel model. The original block and the premium
 * comparison both draw it, so the two cannot disagree. Shotgun and under
 * center are exhaustive for the charted dropbacks (under = 100 - shotgun);
 * there is no third category in the row.
 */
export interface FormationsModel {
  sub: string;
  split: { shotgun: number; under: number; avg: number | null } | null;
  tiles: FormationTile[];
  note: string;
}

const FORMATION_TILES: Array<[string, string]> = [
  ["motionRate", "Pre-snap motion"],
  ["paRate", "Play-action rate"],
  ["noHuddleRate", "No-huddle rate"],
];

export function formationsModel(c: TeamCoaching, team: NflTeam, view: UsageView | null): FormationsModel | null {
  const views = rowViews(c, view);
  const find = (k: string) => views.find((x) => x.row.key === k);
  const shotgun = find("shotgunRate");
  if (!shotgun && !find("motionRate") && !find("paRate")) return null;
  const sg = shotgun ? num(shotgun.v.current) : null;
  const sgAvg = shotgun ? num(shotgun.row.nflAvg) : null;
  const tiles = FORMATION_TILES.flatMap(([key, label]): FormationTile[] => {
    const x = find(key);
    if (!x) return [];
    const now = num(x.v.current);
    const avg = num(x.row.nflAvg);
    const gap = now != null && avg != null ? Math.round((now - avg) * 10) / 10 : null;
    const tone: FormationTile["tone"] = gap != null && Math.abs(gap) >= 3 ? (gap > 0 ? "up" : "down") : "flat";
    return [{ key, label, value: x.v.current, gap, avg: x.row.nflAvg, tone }];
  });
  return {
    sub: `How the ${team.nickname} line up, from the play-by-play and charting that are published in season.`,
    split: sg != null ? { shotgun: sg, under: Math.round((100 - sg) * 10) / 10, avg: sgAvg } : null,
    tiles,
    note: FORMATIONS_NOTE,
  };
}

/* ------------------------------------------------------------ situational */

/**
 * Red zone and fourth down with their samples (mak's brief, 2026-11-05):
 * the fourth-down go rate reads "3 of 3 opportunities", never a headline
 * rank, and the head coach's part in those decisions is said.
 */
/** One situational stat: its headline value and the lines under it, in print order. */
export interface SitStat {
  label: string;
  value: string;
  /** Empty strings are lines the data cannot fill; renderers skip them. */
  lines: string[];
}

/**
 * The Red Zone and Fourth Down model, drawn by the original panel and the
 * premium comparison alike. Beside the printed lines it carries the parts
 * the premium lays out as separate cells (the change, the rank, the plays).
 */
export interface RzFourthModel {
  sub: string;
  priorYear: string;
  rz:
    | (SitStat & {
        change: string;
        dir: "up" | "down" | "flat";
        prior: string;
        nflAvg: string;
        rank: number | null;
        plays: number | null;
        priorPlays: number | null;
      })
    | null;
  fourth:
    | (SitStat & {
        rate: string;
        count: number | null;
        went: number | null;
        prior: string;
        priorDetail: string;
        nflAvg: string;
        small: boolean;
      })
    | null;
  context: string;
}

export function rzFourthModel(c: TeamCoaching, team: NflTeam, view: UsageView | null): RzFourthModel | null {
  const views = rowViews(c, view);
  const rz = views.find((x) => x.row.key === "rzPassRate");
  const fourth = views.find((x) => x.row.key === "fourthGoRate");
  if (!rz && !fourth) return null;
  const s = c.tendencies.samples;
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const staff = getCoachingStaff(team.abbreviation, seasonOf(c));
  const hc = staff?.hc ?? null;
  const callerIsHC = /head coach/i.test(c.playCaller.kicker);
  let rzModel: RzFourthModel["rz"] = null;
  if (rz) {
    const change =
      rz.v.delta != null && rz.v.change.dir !== "flat" ? `${changeText(rz.row, rz.v)} vs ${priorYear} (${rz.row.prior})` : rz.v.delta != null ? `Level with ${priorYear} (${rz.row.prior})` : "";
    const lines = [
      change,
      `NFL average ${rz.row.nflAvg}${atEdge(rz.v.rank) ? ` · ${ordinal(rz.v.rank as number)} in NFL` : ""}`,
      s ? `${s.rzPlays} red-zone plays this season${s.priorRzPlays != null ? `; ${s.priorRzPlays} in ${priorYear}` : ""}` : "",
    ];
    rzModel = {
      label: "Red-zone pass rate",
      value: rz.v.current,
      lines,
      change,
      dir: rz.v.delta != null ? rz.v.change.dir : "flat",
      prior: rz.row.prior,
      nflAvg: rz.row.nflAvg,
      rank: atEdge(rz.v.rank) ? rz.v.rank : null,
      plays: s ? s.rzPlays : null,
      priorPlays: s?.priorRzPlays ?? null,
    };
  }
  let fourthModel: RzFourthModel["fourth"] = null;
  if (fourth) {
    const n = s?.fourthShortAll ?? null;
    const go = s?.fourthShortGo ?? null;
    const noteSnaps = c.shifts.find((x) => x.key === "fourthGoRate")?.note?.match(/(\d+) such snaps/);
    const count = n ?? (noteSnaps ? Number(noteSnaps[1]) : null);
    const went = go ?? (count != null && fourth.v.current !== "-" ? Math.round((Number(num(fourth.v.current)) / 100) * count) : null);
    const value = count != null && went != null && count > 0 ? `${went} of ${count}` : fourth.v.current;
    const priorDetail =
      fourth.row.prior !== "-"
        ? `${priorYear}: ${s?.priorFourthShortGo != null && s.priorFourthShortAll ? `${s.priorFourthShortGo} of ${s.priorFourthShortAll} (${fourth.row.prior})` : fourth.row.prior}`
        : "";
    const small = count != null && count < 15;
    const lines = [
      count != null && count > 0 ? `${fourth.v.current} go rate on 4th-and-2 or less in opponent territory` : "Fewer than three such snaps so far",
      priorDetail,
      `NFL average ${fourth.row.nflAvg}`,
      small ? `A small sample: a tendency to watch, not a settled one.` : "",
    ];
    fourthModel = { label: "Fourth-down go rate", value, lines, rate: fourth.v.current, count, went, prior: fourth.row.prior, priorDetail, nflAvg: fourth.row.nflAvg, small };
  }
  return {
    sub: `Play selection inside the 20 and on short fourth downs, ${seasonOf(c)} to date, with the plays each rate is measured on.`,
    priorYear,
    rz: rzModel,
    fourth: fourthModel,
    context: `Fourth-down decisions are game management${hc && !callerIsHC ? `, shared with head coach ${hc}` : ""}; red-zone play selection counts plays, not trips, so a few long drives move it early in a season.`,
  };
}

/* ----------------------------------------------------------------- dossier
 *
 * Two exhibits since 2026-11-02 (mak's design note): a career scoring chart
 * - one flat segment per stop at its PPG, club-colored, head-coach years
 * dashed, the NFL average as a dim line, the peak and the current stop
 * flagged - and a fingerprint table for the seasons target tracking covers.
 * The year-by-year rows and the identity tiles are gone: the chart answers
 * "has he produced", the table answers "what will he feed". The card's
 * timeline up top stays the one list of his stops; the chart's axis is the
 * only year labelling here.
 */

type DossierRow = TeamCoaching["dossier"][number];

interface Fingerprint {
  year: string;
  lean: { pos: string; share: number; league: number } | null;
  typical: boolean;
  leadBack: number | null;
}

/** The builder's templated fingerprint sentence, read back into numbers. */
function readFingerprint(text: string): Fingerprint | "pre" | null {
  if (/^scoring data only for this stop/.test(text)) return "pre";
  const lean = text.match(/^(WR|TE|RB)s took (\d+(?:\.\d+)?)% of targets \(league (\d+(?:\.\d+)?)%\) in (\d{4}(?: \(Wks [^)]+\))?)/);
  const typical = text.match(/^a league-typical WR\/TE\/RB target split in (\d{4}(?: \(Wks [^)]+\))?)/);
  if (!lean && !typical) return null;
  const lb = text.match(/the lead back handled (\d+(?:\.\d+)?)% of backfield weighted opportunities/);
  return {
    year: (lean?.[4] ?? typical?.[1]) as string,
    lean: lean ? { pos: lean[1], share: Number(lean[2]), league: Number(lean[3]) } : null,
    typical: Boolean(typical),
    leadBack: lb ? Number(lb[1]) : null,
  };
}

const ROLE_NAMES: Record<string, string> = { HC: "Head coach", OC: "Offensive coordinator" };

/** "Patriots · QB coach" + "2010 (play-caller Wks 1-13)" -> code, role, years, window. */
function stopParts(row: DossierRow): { code: string; role: string; years: string; window: string } {
  const [club, ...roleBits] = row.stop.split(" · ");
  const ym = row.years.match(/^(\S+)\s*\((.+)\)$/);
  const years = ym ? ym[1] : row.years;
  const year = parseInt(years, 10);
  const hit = STEP_CLUBS.find(([re]) => re.test(club));
  const role = roleBits.join(" · ");
  return {
    code: hit ? hit[1](year) : club,
    role: ROLE_NAMES[role] ?? role,
    years,
    window: ym ? ym[2][0].toUpperCase() + ym[2].slice(1) : "",
  };
}

/** "23.7 ppg" + "best finish 10th in NFL" -> "23.7 PPG", "10th" (no "in NFL": mak, 2026-11-02). */
function scoreParts(row: DossierRow, multi: boolean): { ppg: string; rank: string } {
  const ppg = row.scoring.replace(/ ppg$/, " PPG");
  const ctx = row.scoringContext;
  let m = ctx.match(/^best finish (\d+)(?:st|nd|rd|th) in NFL$/);
  if (m) return { ppg, rank: `${multi ? "Best: " : ""}${ordinal(Number(m[1]))}` };
  m = ctx.match(/^(\d+)(?:st|nd|rd|th) in NFL over Wks/);
  if (m) return { ppg, rank: `${ordinal(Number(m[1]))} in window` };
  m = ctx.match(/^(?:(\d{4}) )?through Week (\d+)(?:, (\d+)(?:st|nd|rd|th) in NFL)?$/);
  if (m) return { ppg, rank: `${m[3] ? `${ordinal(Number(m[3]))} · ` : ""}${m[1] ? `${m[1]} ` : ""}thru Wk ${m[2]}` };
  return { ppg, rank: ctx };
}

export type Pos = "WR" | "RB" | "TE";
export const POS: Pos[] = ["WR", "RB", "TE"];

/** One tracked season's usage numbers (the builder's `prints`, or read back from its prose). */
export interface Print {
  year: number;
  label: string;
  shares: Record<Pos, number | null>;
  league: Record<Pos, number | null>;
  leadBack: number | null;
}

/** The position whose share sits 3+ points off the league: the season's distinctive trait, or none. */
export function leanOf(p: Print): Pos | null {
  const best = POS.map((pos) => ({ pos, d: p.shares[pos] != null && p.league[pos] != null ? (p.shares[pos] as number) - (p.league[pos] as number) : 0 }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  return best && Math.abs(best.d) >= 3 ? best.pos : null;
}

/** A pre-2026-11-02 entry carries only its prose: the lean's share and the league's, nothing for the other two. */
function printFromProse(fp: Fingerprint): Print {
  const shares: Record<Pos, number | null> = { WR: null, RB: null, TE: null };
  const league: Record<Pos, number | null> = { WR: null, RB: null, TE: null };
  if (fp.lean) {
    shares[fp.lean.pos as Pos] = fp.lean.share;
    league[fp.lean.pos as Pos] = fp.lean.league;
  }
  return { year: Number(fp.year.slice(0, 4)), label: fp.year, shares, league, leadBack: fp.leadBack };
}

/** A dossier row read for the chart: its span, its score, whether he called plays there. */
export interface Stop {
  code: string;
  role: string;
  years: string;
  window: string;
  start: number;
  /** Inclusive. */
  end: number;
  ppg: number;
  rank: string;
  hc: boolean;
  /** He called the plays at this stop; a position-coach year without a window did not. */
  caller: boolean;
  current: boolean;
  /** One per tracked season of the stop, oldest first; empty before 2016. */
  prints: Print[];
  /** The chart's points: each season's own PPG and rank text, oldest first. */
  points: Array<{ year: number; ppg: number; rank: string }>;
}

export function readStops(c: TeamCoaching): Stop[] {
  return c.dossier
    .map((row): Stop => {
      const p = stopParts(row);
      const m = p.years.match(/^(\d{4})(?:-(\d{2}|\d{4}))?$/);
      const start = m ? Number(m[1]) : NaN;
      let end = start;
      if (m?.[2]) end = m[2].length === 4 ? Number(m[2]) : Number(m[1].slice(0, 2) + m[2]);
      if (end < start) end += 100;
      const hc = /^head coach$/i.test(p.role);
      const prints: Print[] =
        row.prints ??
        (row.fingerprints ?? [row.fingerprint])
          .map(readFingerprint)
          .filter((fp): fp is Fingerprint => fp !== null && fp !== "pre")
          .map(printFromProse);
      const rank = scoreParts(row, end > start).rank;
      // A season's rank text: the window's for a windowed stop, the stop's
      // own "16th · 2026 thru Wk 8" for the live season, else the plain ordinal.
      const points = (row.seasons ?? []).map((pt) => ({
        year: pt.year,
        ppg: pt.ppg,
        rank: p.window
          ? rank
          : row.current && pt.year === end
            ? rank
            : pt.rank != null
              ? ordinal(pt.rank)
              : "",
      }));
      // An entry without per-season points (older data) keeps the flat stint.
      if (!points.length) for (let yr = start; yr <= end; yr++) points.push({ year: yr, ppg: parseFloat(row.scoring), rank });
      return {
        ...p,
        start,
        end,
        ppg: parseFloat(row.scoring),
        rank,
        hc,
        points,
        // Team scoring from a year he coached a position (NE 2005, "QB
        // coach") is not his to claim: a hollow dot, off the line.
        caller: hc || Boolean(p.window) || !/\bcoach$/i.test(p.role),
        current: Boolean(row.current),
        prints,
      };
    })
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.ppg));
}

/* Two clubs side by side on the line wear their primaries unless those are
   too close to tell apart (NE navy beside LV black), when the later club
   takes its secondary, darkened until it holds 3:1 on the surface. The
   matchup hero has the same rule for a same-hue pair. OKLab distance x100,
   the chart palette validator's measure. */
function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
}

function contrastOnWhite(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

function darken(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - t)).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Mix toward white: a tint that keeps the hue, lighter by `t`. */
function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const chroma = (hex: string) => {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b);
};

/**
 * One color per club. The page's own club (the current stop) keeps its
 * primary; every other club gets its primary unless that sits too close to
 * a neighbor on the line, when it takes its secondary (if that has real
 * color), else a tint of its primary, else stays put and the code labels
 * carry it. A club seen twice wears one color throughout.
 */
export function stopColors(stops: Stop[]): Map<string, string> {
  const colors = new Map<string, string>();
  const primary = (code: string) => TEAM_COLORS[(MOVED_CODES[code] ?? code).toLowerCase()] ?? "#0b1634";
  const host = stops.find((s) => s.current)?.code;
  if (host) colors.set(host, primary(host));
  // Apart from its neighbors on the line, and from every club already
  // colored: two black-and-silver clubs (NO, LV) never share a swatch.
  const okAgainst = (color: string, neighbors: string[]) =>
    contrastOnWhite(color) >= 3 &&
    neighbors.every((n) => deltaE(color, n) >= 15) &&
    [...colors.values()].every((n) => deltaE(color, n) >= 8);
  stops.forEach((s) => {
    if (colors.has(s.code)) return;
    const key = (MOVED_CODES[s.code] ?? s.code).toLowerCase();
    // Every club that sits beside any of this club's stops on the line.
    const neighbors = stops
      .flatMap((t, j) => (t.code === s.code ? [stops[j - 1], stops[j + 1]] : []))
      .map((n) => n && n.code !== s.code ? colors.get(n.code) : undefined)
      .filter((c): c is string => Boolean(c));
    const base = primary(s.code);
    const candidates = [base];
    const accent = TEAM_ACCENTS[key];
    if (accent && chroma(accent) >= 0.04) {
      let alt = accent;
      for (let k = 0; k < 6 && contrastOnWhite(alt) < 3; k++) alt = darken(alt, 0.15);
      candidates.push(alt);
    }
    candidates.push(tint(base, 0.45), tint(base, 0.6));
    colors.set(s.code, candidates.find((c) => okAgainst(c, neighbors)) ?? base);
  });
  return colors;
}

/**
 * The tracked seasons as dense rows (mak's design note, 2026-11-02): one
 * column per position's target share so each scans vertically, the gap to
 * league as a colored delta beside it and the season's distinctive share
 * in bold; the lead back's definition in its header; stints grouped under
 * one label with a club-colored band and a labeled row for any year he
 * did not call; finishes as pills, partial seasons marked. The two career
 * stats the chart cannot show sit under the title.
 */
/**
 * Season by season under the caller (mak's brief, 2026-11-05): the NFL view
 * first - points per game and league rank for every season he called,
 * with the target shares and lead-back share where tracking covers them
 * (2016 on) - stints grouped under one band, a labeled row for any year he
 * did not call. The fantasy finishes left this table for the Fantasy Impact
 * section. The two career stats the chart cannot show sit under the title.
 */
/** One season on a stop, as the table prints it; the group fields are set on a stint's first row. */
export interface HistoryRow {
  s: Stop;
  pt: Stop["points"][number];
  p: Print | null;
  /** "2024" or "2019-21": the years he was not calling before this row, printed as a gap band. */
  gapBefore: string | null;
  groupStart: boolean;
  /** Rows in the stint (same club and role), on its first row; 0 otherwise. */
  groupLen: number;
  /** "2006-08", on the stint's first row. */
  groupYears: string;
  /** "Wks 1-13" for a windowed stop, else "". */
  win: string;
  live: boolean;
  lean: Pos | null;
  /** The rank as printed: "3rd", "19th in window", or "" when he did not call. */
  rankText: string;
}

export interface HistoryModel {
  last: string;
  span: string;
  season: number;
  stats: Array<{ value: string; label: string }>;
  rows: HistoryRow[];
  /** The first tracked season, or null when no season carries shares. */
  trackedFrom: number | null;
  note: string;
}

/**
 * The season-by-season model: one row per season he was on a stop, in
 * order, each joined to its print (shares) by year and, for a windowed stop,
 * by its label; the two career stats; the stint groups; the note. The
 * original table and the premium comparison both draw it.
 */
export function historyModel(c: TeamCoaching, stops: Stop[]): HistoryModel | null {
  const rows = stops.flatMap((s) =>
    s.points.map((pt) => ({ s, pt, p: s.prints.find((p) => p.year === pt.year && (!s.window || /\(Wks/.test(p.label))) ?? s.prints.find((p) => p.year === pt.year) ?? null })),
  );
  if (!rows.length) return null;
  const first = rows[0]!.pt.year;
  const lastYr = rows[rows.length - 1]!.pt.year;
  const span = first === lastYr ? String(first) : `${first}-${String(lastYr).slice(2)}`;
  const season = seasonOf(c);

  const stats: Array<{ value: string; label: string }> = [];
  const prints = rows.filter((r) => r.p).map((r) => ({ s: r.s, p: r.p as Print }));
  const withLb = prints.filter((r) => r.p.leadBack != null);
  if (withLb.length >= 2) {
    const top = withLb.reduce((a, b) => ((b.p.leadBack as number) > (a.p.leadBack as number) ? b : a));
    stats.push({ value: `${top.p.leadBack}%`, label: `Peak lead-back share · ${top.p.year} ${top.s.code}` });
  }
  if (prints.length >= 2) {
    let best: { pos: Pos; side: "below" | "above"; n: number; of: number } | null = null;
    for (const pos of POS) {
      const known = prints.filter((r) => r.p.shares[pos] != null && r.p.league[pos] != null);
      const below = known.filter((r) => (r.p.shares[pos] as number) <= (r.p.league[pos] as number) - 3).length;
      const above = known.filter((r) => (r.p.shares[pos] as number) >= (r.p.league[pos] as number) + 3).length;
      for (const [side, n] of [["below", below], ["above", above]] as const) {
        if (n && (!best || n > best.n)) best = { pos, side, n, of: known.length };
      }
    }
    if (best) stats.push({ value: `${best.n} / ${best.of}`, label: `tracked seasons with ${best.pos} share 3%+ ${best.side} league` });
  }

  const covered = new Set(stops.flatMap((s) => Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start + i)));
  const same = (a: Stop, b: Stop) => a.code === b.code && a.role === b.role;
  const out: HistoryRow[] = rows.map(({ s, pt, p }, i) => {
    const prev = rows[i - 1];
    let gapBefore: string | null = null;
    if (prev) {
      const missing: number[] = [];
      for (let yr = prev.pt.year + 1; yr < pt.year; yr++) if (!covered.has(yr)) missing.push(yr);
      if (missing.length) gapBefore = missing.length === 1 ? String(missing[0]) : `${missing[0]}-${String(missing[missing.length - 1]).slice(2)}`;
    }
    const groupStart = !prev || !same(prev.s, s);
    const found = groupStart ? rows.slice(i).findIndex((r) => !same(r.s, s)) : 0;
    const groupLen = groupStart ? (found === -1 ? rows.length - i : found) : 0;
    const groupRows = groupStart ? rows.slice(i, i + groupLen) : [];
    const groupYears = groupStart
      ? (() => {
          const a = Math.min(...groupRows.map((r) => r.s.start));
          const b = Math.max(...groupRows.map((r) => r.s.end));
          return a === b ? String(a) : `${a}-${String(b).slice(2)}`;
        })()
      : "";
    return {
      s,
      pt,
      p,
      gapBefore,
      groupStart,
      groupLen,
      groupYears,
      win: s.window ? s.window.replace(/^play-caller /i, "") : "",
      live: s.current && pt.year === season,
      lean: p ? leanOf(p) : null,
      rankText: s.caller ? pt.rank.replace(/ · \d{4} thru Wk \d+$/, "") : "",
    };
  });

  const last = surnameOf(c);
  const trackedFrom = prints.length ? prints[0]!.p.year : null;
  const tracked = trackedFrom != null ? ` Target shares and the lead back's share are tracked from ${trackedFrom} on.` : "";
  return {
    last,
    span,
    season,
    stats,
    rows: out,
    trackedFrom,
    note: `Team offenses by season, scoring and rank from the league's game results. Bold share: the season's distinctive position, 3+ points off the league. Bold lead back: 65%+ of the backfield's carries + 2 × targets.${tracked} A windowed season covers the weeks he called only.`,
  };
}

/* ---------------------------------------------------------------- finishes */

export type FinishRow = TeamCoaching["finishes"]["rows"][number];

/** "QB18 · Jones" -> position, rank, player. */
export function readFinish(text: string): { pos: string; rank: number; player: string } | null {
  const m = text.match(/^([A-Z]{2})(\d+) · (.+)$/);
  return m ? { pos: m[1], rank: Number(m[2]), player: m[3] } : null;
}

/**
 * A finish's tier, by rank alone: top 5, 6-12, 13-24, 25+. A tint on the
 * rank pill, never on the player's name - the table grades outcomes in
 * steps, not in a binary good/bad.
 */
const FINISH_TIERS: Array<[number, string, string]> = [
  [5, "elite", "Top 5"],
  [12, "strong", "Top 12"],
  [24, "mid", "13-24"],
  [Infinity, "low", "25+"],
];
export const finishTier = (rank: number) => FINISH_TIERS.find(([max]) => rank <= max) as [number, string, string];

/** "Patriots 2021" / "Patriots · 2026" -> club, season. */
export function finishStop(row: FinishRow): { club: string; year: string } {
  const m = row.stop.match(/^(.*?)\s*(?:·\s*)?(\d{4})$/);
  return m ? { club: m[1], year: m[2] } : { club: row.stop, year: "" };
}

/** Best completed finish per position, read off the table's settled rows. */
/**
 * Fantasy finishes by coaching stop: the rank leads as a tiered pill, the
 * player sits under it, and the in-season row is marked provisional so a
 * three-week QB34 never reads like a season-end one. The stored methodology
 * note sits one click down.
 */
/** Every tracked season (the builder's history) plus the in-season row, oldest first. */
export function finishRows(c: TeamCoaching): FinishRow[] {
  return c.finishes.history
    ? [...c.finishes.history.map((r) => ({ ...r, current: false })), ...c.finishes.rows.filter((r) => r.current)]
    : c.finishes.rows;
}

/* -------------------------------------------------------------- note + bars */

export const signedPts = (d: number) => (d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`);

/** The position furthest from league, if it is 3+ points off (the builder's bar). */
function distLean(c: TeamCoaching): BarRow | null {
  const rows = c.distribution.rows.filter((r) => r.pct != null && r.nfl != null);
  const top = [...rows].sort((a, b) => Math.abs((b.pct as number) - (b.nfl as number)) - Math.abs((a.pct as number) - (a.nfl as number)))[0];
  return top && Math.abs((top.pct as number) - (top.nfl as number)) >= 3 ? top : null;
}

export const surnameOf = (c: TeamCoaching): string => c.playCaller.name.split(" ").pop() ?? c.playCaller.name;

/** The target-distribution model: each position against the league, the one lean, and the panel's read. */
export interface DistributionModel {
  title: string;
  sub: string;
  rows: Array<{ row: BarRow; d: number; lean: boolean }>;
  line: string;
  context: string;
}

export function distributionModel(c: TeamCoaching): DistributionModel {
  const lean = distLean(c);
  const many = /^Across his/.test(c.distribution.note);
  return {
    title: `Target distribution under ${surnameOf(c)}`,
    sub: c.distribution.sub,
    // Gold marks the one position that materially deviates, not a position.
    rows: c.distribution.rows.map((row) => ({ row, d: (row.pct ?? 0) - (row.nfl ?? 0), lean: row === lean })),
    line: lean
      ? `${lean.label} have drawn ${lean.pct}% of targets vs ${lean.nfl}% league average.`
      : "Every position sits within a few points of league average: the target tree follows the talent.",
    context: many ? "Across the offenses he has called: a historical tendency, read alongside the current roster." : "One season of data, read alongside the current roster.",
  };
}

/** The backfield-share model: the bars (the live season from the usage feed), their caption and the panel's read. */
export interface BackfieldModel {
  title: string;
  sub: string;
  bars: TeamCoaching["backfield"]["bars"];
  caption: string;
  line: string;
  context: string;
}

export function backfieldModel(c: TeamCoaching, view: UsageView | null): BackfieldModel {
  const bars = c.backfield.bars.map((bar) => {
    if (!bar.feed || !view) return bar;
    // The current season's bar is the lead back's live share of the room's
    // weighted opportunities, from the same numbers the usage tab draws.
    const lead = Math.max(0, ...view.rbs.map((p) => p.woppShare ?? 0));
    return lead > 0 ? { ...bar, value: Math.round(lead) } : bar;
  });
  const caption = bars.map((b) => `${b.label} ${b.value}%`).join(", ");
  // The builder classifies the trend in its note; the takeaway restates that
  // call in one line rather than re-deciding it.
  const note = c.backfield.note;
  const line = /The trend is concentration/.test(note)
    ? "Concentrating: the lead back's share has held or grown season over season."
    : /The trend is a spread/.test(note)
      ? "Spreading: the lead back's share has drifted down, so committee risk is real."
      : "No stable concentration pattern across his seasons.";
  return {
    title: `Backfield share under ${surnameOf(c)}`,
    sub: c.backfield.sub,
    bars,
    caption,
    line,
    context: /^Starred seasons/.test(note) ? "Starred seasons were a previous staff's: context, not his record." : "Lead back's share of the backfield's carries + 2 × targets, by season.",
  };
}

/** One score-state row read against leading by 7+: its pass rate, sample and gap in points. */
export interface ScoreStateRow {
  row: BarRow;
  /** "57% pass", or the stored result when it does not parse. */
  pass: string;
  /** "152 plays", when the stored result carries it. */
  plays: string | null;
  d: number;
  /** "Baseline" on the first row, else "+9 pp" / "0 pp". */
  diff: string;
  baseline: boolean;
  /** A real gap (3+ points) from the baseline: the row that gets gold. */
  flag: boolean;
}

export interface ScoreStateModel {
  sub: string;
  rows: ScoreStateRow[];
  verdict: string;
  context: string;
}

export function scoreStateModel(c: TeamCoaching): ScoreStateModel {
  const rows = c.scoreState.rows;
  const base = rows[0]?.share ?? null;
  const swing = base != null && rows[2]?.share != null ? rows[2].share - base : null;
  const small = /small early-season sample/.test(c.scoreState.note);
  const t = rows[2]?.share;
  const verdict =
    swing == null
      ? ""
      : Math.abs(swing) < 3
        ? `Script-neutral: ${t}% pass when trailing by 7+, ${base}% when leading by 7+.`
        : `${Math.abs(swing) < 10 ? "Small" : "Clear"} trailing ${swing > 0 ? "bump" : "dip"}: ${t}% pass when trailing by 7+, vs ${base}% when leading by 7+.`;
  return {
    sub: c.scoreState.sub,
    rows: rows.map((row, i) => {
      const m = (row.result ?? "").match(/^(\S+ pass) · (\d+ plays)$/);
      const d = base != null ? (row.share ?? 0) - base : 0;
      // Each row is read against leading by 7+; only a real gap gets gold.
      const flag = i > 0 && Math.abs(d) >= 3;
      return { row, pass: m ? m[1]! : (row.result ?? `${row.share}%`), plays: m ? m[2]! : null, d, diff: i === 0 ? "Baseline" : `${signedPts(d)}%`, baseline: i === 0, flag };
    }),
    verdict,
    context: small ? "Early-season samples remain small." : "Play counts show each bucket's sample.",
  };
}

/**
 * The StatChasers bottom line as a recognizable component: last season's
 * carryover, this season's signals, the caller's historical leans and the
 * sample, each one line. Every item is read off the module above; the
 * builder's full paragraph stays one click down.
 */
export interface BottomLineModel {
  season: number;
  /** "Strong" / "Partial" / "Limited": last season's carryover, from the reliability rating. */
  carry: string;
  /** "↑ Shotgun", "↓ Pace": this season's directional signals. */
  signals: string[];
  /** "↑ TE targets": the caller's historical target leans against the league. */
  leans: string[];
  /** Games in the ledger sample, when the entry has one. */
  games: number | null;
  /** The builder's full paragraph. */
  summary: string;
}

/** The bottom line's items, shared with the premium block (coaching-fantasy-premium.ts). */
export function bottomLineModel(c: TeamCoaching, view: UsageView | null): BottomLineModel {
  const season = seasonOf(c);
  const rating = reliabilityRating(c);
  const carry = { HIGH: "Strong", MEDIUM: "Partial", LOW: "Limited" }[rating];
  const small = (c.tendencies.samples?.fourthShortAll ?? 15) < 15;
  const signals = c.shifts
    .filter((s) => !(s.key && SITUATIONAL_KEYS.has(s.key) && small))
    .map((s) => {
      const row = s.key ? c.tendencies.rows.find((r) => r.key === s.key) : undefined;
      const v = row ? rowView(row, view) : null;
      if (!row?.key || !v || v.delta == null || v.change.dir === "flat") return "";
      const name = row.key === "pace" ? "Pace" : CHIP_NAMES[row.key];
      return name ? `${v.delta > 0 ? "↑" : "↓"} ${name}` : "";
    })
    .filter(Boolean);
  const SHORT: Record<string, string> = { "Wide receivers": "WR", "Tight ends": "TE", "Running backs": "RB" };
  const leans = c.distribution.rows
    .filter((r) => r.pct != null && r.nfl != null && Math.abs((r.pct as number) - (r.nfl as number)) >= 3)
    .sort((a, b) => Math.abs((b.pct as number) - (b.nfl as number)) - Math.abs((a.pct as number) - (a.nfl as number)))
    .map((r) => `${(r.pct as number) > (r.nfl as number) ? "↑" : "↓"} ${SHORT[r.label] ?? r.label} targets`);
  const games = c.reliability.ledgerStats?.games ?? null;
  return { season, carry, signals, leans, games, summary: c.bottomLine };
}

/* ------------------------------------------------------------------ caveat */

/**
 * The LOW-reliability caveat the rest of the page carries.
 *
 * Rendered beside anything that projects from last season's data when the
 * team's play-caller is new. Empty for HIGH and MEDIUM - the caveat is the
 * exception, not a banner on all 32 pages.
 */
export function coachingCaveat(c: TeamCoaching | null): string {
  if (!c || reliabilityRating(c) !== "LOW") return "";
  const name = c.playCaller.name;
  return (
    `<p class="sct-co-caveat">${e(
      `New play-caller: ${name} is calling plays for the first season here, so last year's tendencies are an unreliable guide - see the Coaching tab before trusting season-over-season projections.`,
    )}</p>`
  );
}

/* ------------------------------------------------------------------ public */

export interface CoachingSection {
  html: string;
  faqHtml: string;
  faq: Array<{ question: string; answer: string }>;
}

/**
 * Fantasy Impact (mak's brief, section 7): one collapsed section - the
 * signal readings in fantasy terms, the positional finishes by season, the
 * rookie note where an entry has one, and the StatChasers bottom line.
 */
export interface FantasyRead {
  /** "More shotgun." */
  heading: string;
  /** The reading in a sentence. */
  body: string;
  /** "↑" / "↓" / "" (flat or unmeasured). */
  dir: string;
  /** Prior season's figure and this season's, as the table prints them ("67.6%"); null without a row. */
  prior: string | null;
  current: string | null;
  /** This season minus last, in the row's own unit; null without a measure. */
  delta: number | null;
  /** True when the row is a percentage, so a change is in percentage points. */
  pct: boolean;
}

export interface FantasyReadsModel {
  season: number;
  priorYear: string;
  reads: FantasyRead[];
}

/** The signal readings in fantasy terms, shared with the premium block (coaching-fantasy-premium.ts). */
export function fantasyReadsModel(c: TeamCoaching, view: UsageView | null): FantasyReadsModel {
  const season = seasonOf(c);
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const reads = c.shifts
    .filter((s) => s.key && !SITUATIONAL_KEYS.has(s.key))
    .map((s) => {
      const row = c.tendencies.rows.find((r) => r.key === s.key);
      const v = row ? rowView(row, view) : null;
      const dir = v?.delta == null || v.delta === 0 ? "" : v.delta > 0 ? "↑" : "↓";
      return {
        heading: s.heading,
        body: s.body,
        dir,
        prior: row ? row.prior : null,
        current: v ? v.current : null,
        delta: v?.delta ?? null,
        pct: /%$/.test(row?.prior ?? ""),
      };
    });
  return { season, priorYear, reads };
}

export function renderCoachingSection(
  coaching: TeamCoaching | null,
  team: NflTeam,
  view: UsageView | null,
): CoachingSection {
  if (!coaching) return { html: "", faqHtml: "", faq: [] };
  const html =
    // mak kept the premium designs (2026-11-05, "keep the new designs"): the
    // top block (header, coordinator profile, four KPIs, the Play Calling and
    // Formations & Tempo tables) and the tendencies dashboard (Formations &
    // Personnel, Situational Play Calling, Target & Backfield Tendencies) ARE
    // the page now; the original renderers were deleted on 2026-11-10.
    renderCoachingPremium(coaching, team, view) +
    renderCoachingPremiumTendencies(coaching, team, view) +
    `<div class="sct-block sct-co">` +
    // 6. Coaching Career & Historical Performance: the premium design
    // (kept by mak, 2026-11-05) with the season-by-season table under it.
    // One historical table since mak's review (2026-11-08): the season
    // table prints inside the career section under the chart, in place of
    // the chart's hidden table and the separate Season by Season section.
    renderCoachingCareerPremium(coaching, renderSeasonHistoryTable(coaching)) +
    // 7. Fantasy Impact IS the premium design (mak, 2026-11-06, "remove the
    // old fantasy impact section design"). No coaching entry carries a
    // rookie note today, so the premium block not printing one loses nothing.
    renderCoachingFantasyPremium(coaching, team, view) +
    `</div>`;

  // mak's question list (2026-11-03) replaces the builder's single question:
  // written by rule from the same data as the page, in the page's FAQPage too.
  const items = coachingFaq(coaching, team, view, getCoachingStaff(team.abbreviation, seasonOf(coaching)));
  const faqHtml = renderFaqBlock("Common Questions", items, "sct-co-faq");
  return { html, faqHtml, faq: faqEntries(items) };
}
