/**
 * Markup for the team hub's Coaching Profile & Tendencies section.
 *
 * Server-rendered in full like the usage tab beside it: everything is in the
 * HTML the server sends, and nothing here needs the client bundle. The ten
 * components render in the build spec's order - header + intro, the coach
 * card beside the tendencies table, three shift cards, the staff strip, the
 * career dossier, the positional finishes, the rookie note, the two
 * fingerprint panels, the two situational panels, and the gold bottom line.
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
  getLeaguePpg,
  RELIABILITY_PCT,
  reliabilityRating,
  type BarRow,
  type Reliability,
  type TeamCoaching,
  type TendencyRow,
} from "./coaching";
import type { UsageView } from "./usage";
import { signed } from "./usage-copy";
import { coachingFaq } from "./coaching-faq";
import { faqEntries, renderFaqBlock } from "./faq-block";

const e = escapeHtml;

function h3(text: string): string {
  return `<h3 class="sct-co-h3">${e(text)}</h3>`;
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix =
    rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/* ------------------------------------------------------------ header/intro */

function header(): string {
  return (
    `<div class="sct-co-head"><h2 class="sct-h2">Coaching Profile &amp; Tendencies</h2>` +
    `<p class="sct-co-dek">How stable is the play-calling environment, and what changed?</p></div>`
  );
}

const seasonOf = (c: TeamCoaching): number => parseInt(c.tendencies.currentLabel, 10);

/** "Buffalo's", or "the Giants'" where two clubs share a city. */
function placeOf(team: NflTeam): string {
  return /^(New York|Los Angeles)$/.test(team.city) ? `the ${team.nickname}'` : `${team.city}'s`;
}

/** "third" from the kicker's "Third season as caller here", else counted. */
function nthSeason(c: TeamCoaching): string {
  const m = c.playCaller.kicker.match(/(?:^| · )(\S+) season as caller here/i);
  return m ? m[1].toLowerCase() : ordinal(c.reliability.priorSeasonsAsCaller + 1);
}

/**
 * One visible sentence: this club's answer, by rule from the reliability
 * rating. The continuity principle and the longer original reasoning open
 * from an inline "Why this matters" link (a native popover, like the table's
 * row definitions), so the analytics start sooner and nothing citable is
 * dropped from the page.
 */
function intro(c: TeamCoaching, team: NflTeam): string {
  const season = seasonOf(c);
  const prior = season - 1;
  const name = c.playCaller.name;
  const rating = reliabilityRating(c);
  const answer =
    rating === "HIGH"
      ? `${name} returns as ${placeOf(team)} primary play-caller for a ${nthSeason(c)} season, making ${prior} a meaningful baseline for evaluating how the ${season} offense is changing.`
      : rating === "MEDIUM" && c.reliability.priorSeasonsAsCaller === 1
        ? `${name} returns as ${placeOf(team)} primary play-caller for a second season, making ${prior} a usable baseline built on one season.`
        : rating === "MEDIUM"
          ? `${name} is new to the ${team.nickname} call sheet but comes from the same scheme family, so treat ${prior} as context, not baseline.`
          : `${name} is calling the ${team.nickname} offense for the first time, so the ${season} sample is the signal, not last year's.`;
  return (
    `<p class="sct-co-intro">${e(answer)} ` +
    `<button type="button" class="sct-co-why-q" popovertarget="sct-co-why">Why this matters</button></p>` +
    `<div class="sct-co-def sct-co-why" id="sct-co-why" popover>` +
    `<p class="sct-co-def-head">Why this matters` +
    `<button type="button" class="sct-co-def-close" popovertarget="sct-co-why"` +
    ` popovertargetaction="hide" aria-label="Close">&times;</button></p>` +
    `<p class="sct-co-def-body sct-co-why-a">${e(
      "Play-calling tendencies are most useful when the same caller remains in place. They carry over from season to season when the play-caller stays the same - and become unreliable the moment he changes. " +
        `That's the whole reason this module exists: before you trust any ${team.nickname} projection, you need to know whose fingerprints are on the offense and how stable they are. ` +
        c.introAnswer,
    )}</p></div>`
  );
}

/* -------------------------------------------------------------- coach card */

/**
 * The scheme note split into a scan tag and its qualifier, at the first
 * clause break: "Belichick / Patriots lineage" + "Historically Erhardt-
 * Perkins-based terminology...". The stored sentence is verified copy, so it
 * is split, never rewritten.
 */
function splitTree(tree: string): { tag: string; note: string } {
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

/** The club's crest beside its code on a timeline step (mak, 2026-11-02: "add team images"). */
function stepCrest(code: string): string {
  const club = getTeamByAbbreviation(MOVED_CODES[code] ?? code);
  if (!club?.logo) return "";
  return `<img class="sct-co-step-crest" src="${e(club.logo)}" alt="" width="18" height="18" loading="lazy" decoding="async">`;
}

function timelineStep(step: { role: string; years: string }): string {
  const year = parseInt(step.years, 10);
  const hits = STEP_CLUBS.map(([re, code]) => ({ at: step.role.search(re), re, code: code(year) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  let role = step.role.replace(/\s*\([^)]*\)/g, "").trim();
  const codes = [...new Set(hits.map((h) => h.code))].join(" / ");
  // One club named, however many of its words match: drop it from the role,
  // along with the city in front of it ("Carolina Panthers OC" -> "OC").
  if (hits.length && !codes.includes(" / ")) {
    role = role.replace(new RegExp(`^(?:[A-Z][A-Za-z.]+\\s+){0,2}${hits[0].re.source}\\s+`), "");
  }
  role = shortRole(role);
  role = role[0].toUpperCase() + role.slice(1);
  return (
    `<li class="sct-co-step"${role !== step.role ? ` title="${e(step.role)}"` : ""}>` +
    `<span class="sct-co-step-years">${e(step.years)}</span>` +
    `<span class="sct-co-step-body">` +
    (codes
      ? `<span class="sct-co-step-team">${codes
          .split(" / ")
          .map((code) => `<span class="sct-co-step-club">${stepCrest(code)}${e(code)}</span>`)
          .join(`<span class="sct-co-step-sep" aria-hidden="true">/</span>`)}</span>`
      : "") +
    `<span class="sct-co-step-role">${e(role)}</span></span></li>`
  );
}

/**
 * The builder's continuity sentence, cut to two short lines. Returning
 * callers get the rule-based pair (a broken tenure like NE's drops
 * "straight", and the kicker already carries the count); new-caller
 * explanations pass through, since who called last year is the point.
 */
function relNote(c: TeamCoaching, rating: Reliability): string {
  const text = c.reliability.explanation;
  if (!/^Same play-caller as last season\b/.test(text)) return text;
  const m = text.match(/^Same play-caller as last season - his (\S+) season calling this offense\./);
  const season = seasonOf(c);
  const lead = m ? `Same caller for a ${m[1]} straight season.` : "Same caller as last season.";
  return `${lead} ${season - 1} is a ${rating === "HIGH" ? "strong" : "usable"} baseline for ${season} tendencies.`;
}

function reliabilityBox(c: TeamCoaching, team: NflTeam): string {
  const rating = reliabilityRating(c);
  const pct = RELIABILITY_PCT[rating];
  const tone: Record<Reliability, string> = { HIGH: "high", MEDIUM: "medium", LOW: "low" };
  return (
    `<div class="sct-co-rel">` +
    `<p class="sct-co-rel-row"><span class="sct-co-label">Tendency reliability</span>` +
    `<span class="sct-co-rating is-${tone[rating]}">${rating}</span></p>` +
    `<span class="sct-co-relbar" role="img" aria-label="${e(`Tendency reliability: ${rating}`)}">` +
    `<span style="width:${pct}%"></span></span>` +
    `<p class="sct-co-rel-note">${e(relNote(c, rating))}</p>` +
    // The play-caller ledger (chips + note) went 2026-11-02 (mak).
    `</div>`
  );
}

/**
 * The caller note's first sentence - "he remains the caller" - stays on the
 * card; the sourcing and history behind it fold under "More". The stored
 * note is verified copy, so it is split at a sentence break, never edited.
 */
function coachCard(c: TeamCoaching, team: NflTeam): string {
  // The kicker's first part is the title and wears the accent; tenure and
  // role sit under the name in one muted line, so the name dominates.
  const [title, ...rest] = c.playCaller.kicker.split(" · ");
  const tenure = rest
    .filter((part) => !/^primary play-caller$/i.test(part))
    .map((part) => part.replace(/ as caller here$/i, " as caller"));
  const tree = c.playCaller.tree ? splitTree(c.playCaller.tree) : null;
  return (
    `<div class="sct-co-card">` +
    // The lineage chip shares the header row with the title and name
    // (mak, 2026-11-02); its note, when there is one, stays under the row.
    `<div class="sct-co-cardhead">` +
    `<div class="sct-co-cardhead-main">` +
    `<p class="sct-co-kicker">${e(title)}</p>` +
    `<h3 class="sct-co-name">${e(c.playCaller.name)}</h3>` +
    `</div>` +
    `<p class="sct-co-tree">${e(tree ? tree.tag : "No established tree")}</p>` +
    `</div>` +
    // The role line sits under the header row so it runs the card's full
    // width like the scheme note, instead of wrapping beside the chip.
    `<p class="sct-co-roleline">${e([...tenure, "Primary play-caller"].join(" · "))}</p>` +
    (tree?.note ? `<p class="sct-co-scheme-note">${e(tree.note)}</p>` : "") +
    // The caller note under the lineage chip went 2026-11-02 (mak).
    `<ol class="sct-co-path">${c.playCaller.careerPath.map(timelineStep).join("")}</ol>` +
    reliabilityBox(c, team) +
    `</div>`
  );
}

/* -------------------------------------------------------------- tendencies */

interface RowView {
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
function rowView(row: TendencyRow, view: UsageView | null): RowView {
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
const atEdge = (rank: number | null): rank is number => rank != null && (rank <= 10 || rank >= 28);

/** The signals' wording: "4th-fastest in NFL". */
function rankText(row: TendencyRow, rank: number | null): string {
  if (!atEdge(rank)) return "";
  const [hi, lo] = row.invert ? ["fastest", "slowest"] : ["highest", "lowest"];
  const text =
    rank === 1 ? `${hi} in NFL` : rank <= 10 ? `${ordinal(rank)}-${hi} in NFL`
      : rank === 32 ? `${lo} in NFL` : `${ordinal(33 - rank)}-${lo} in NFL`;
  return text[0].toUpperCase() + text.slice(1);
}

/** The table's compact badge, "2nd", with the long form as its title. */
function rankBadge(row: TendencyRow, rank: number | null): string {
  if (!atEdge(rank)) return "";
  return `<span class="sct-co-badge" title="${e(rankText(row, rank))}">${ordinal(rank)}</span>`;
}

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
 * The season's story in four chips, derived from the table: the biggest moves
 * of 3+ points (or a second of pace), largest first. Structured, not prose -
 * the table under it is the evidence.
 */
function identityStrip(
  c: TeamCoaching,
  rows: Array<{ row: TendencyRow; v: RowView }>,
): string {
  const season = seasonOf(c);
  const moves = rows
    .filter(({ row, v }) => v.delta != null && (row.key === "pace" || (row.key && CHIP_NAMES[row.key])))
    .map(({ row, v }) => ({ row, d: v.delta as number, weight: row.key === "pace" ? Math.abs(v.delta as number) * 3 : Math.abs(v.delta as number) }))
    .filter(({ row, d }) => Math.abs(d) >= (row.key === "pace" ? 1 : 3))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  const chips = moves
    .map(({ row, d }) => {
      const name = row.key === "pace" ? "Pace" : CHIP_NAMES[row.key as string];
      const label = row.key === "pace" ? (d > 0 ? "faster" : "slower") : d > 0 ? "up" : "down";
      return (
        `<li class="sct-co-idchip is-${d > 0 ? "up" : "down"}" aria-label="${e(`${name} ${label}`)}">` +
        `${e(name)}<span class="sct-co-idarrow" aria-hidden="true">${d > 0 ? "↑" : "↓"}</span></li>`
      );
    })
    .join("");
  return (
    // No label and no panel (mak, 2026-11-02): the chips stand alone.
    `<div class="sct-co-identity">` +
    (chips
      ? `<ul class="sct-co-idchips">${chips}</ul>`
      : `<p class="sct-co-idnone">${e(`No tendency has moved 3+ points from ${season - 1}`)}</p>`) +
    `</div>`
  );
}

/**
 * How a row is counted, opened from the row's label itself (dotted
 * underline) rather than an "i" on every row. A native popover, as on the RB
 * handcuffs notes: the top layer lifts it out of the table's scroll box and
 * any host stacking context, and the browser handles Escape and click-away.
 * These rates are denominator-sensitive, and this is where a reader finds out
 * why ours differs from another site's.
 */
function rowLabel(row: TendencyRow, id: string): string {
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

/** "2025 (McDaniels)" -> the year over a muted line: the caller, or `sub`. */
function seasonHead(label: string, sub?: string): string {
  const m = label.match(/^(\d{4})\s*\((.+)\)$/);
  const line = sub ?? (m ? m[2].replace(/^prev\. staff$/i, "Prev. staff") : "");
  return `${e(m ? m[1] : label)}` + (line ? `<span class="sct-co-th-sub">${e(line)}</span>` : "");
}

/** The sub-captions worth keeping under a label: denominators a reader cannot guess. */
const KEEP_SUB = new Set(["proe", "fourthGoRate"]);

function num(text: string): number | null {
  const m = text.replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * The Change cell's strip (mak, 2026-11-02): the prior and current values as
 * two dots joined by a bar colored by direction and sized by the move, with
 * the NFL average as a tick on the same track, so the column scans as a
 * shape. Each row has its own scale, centered on its values with a floor so
 * a one-point move does not fill the track. Pace flips so faster sits right.
 */
function changeStrip(row: TendencyRow, v: RowView, priorYear: string, season: number): string {
  const prior = num(row.prior);
  const now = num(v.current);
  const avg = num(row.nflAvg);
  if (prior == null || now == null) return "";
  const pts = avg == null ? [prior, now] : [prior, now, avg];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const half = Math.max((max - min) / 2, row.invert ? 2.5 : 5) * 1.35;
  const mid = (min + max) / 2;
  const x = (val: number) => {
    const p = Math.max(2, Math.min(98, ((val - (mid - half)) / (2 * half)) * 100));
    return row.invert ? 100 - p : p;
  };
  const a = x(prior);
  const b = x(now);
  const label = `${priorYear} ${row.prior}, ${season} ${v.current}${avg == null ? "" : `, NFL avg ${row.nflAvg}`}`;
  return (
    `<span class="sct-co-strip" role="img" aria-label="${e(label)}" title="${e(label)}">` +
    `<span class="sct-co-strip-bar is-${v.change.dir}" style="left:${Math.min(a, b).toFixed(1)}%;width:${Math.abs(b - a).toFixed(1)}%"></span>` +
    (avg == null ? "" : `<span class="sct-co-strip-avg" style="left:${x(avg).toFixed(1)}%"></span>`) +
    `<span class="sct-co-strip-prior" style="left:${a.toFixed(1)}%"></span>` +
    `<span class="sct-co-strip-now" style="left:${b.toFixed(1)}%"></span>` +
    `</span>`
  );
}

function tendencies(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const views = c.tendencies.rows.map((row) => ({ row, v: rowView(row, view) }));

  // The one move worth flagging when no league rank already flags it.
  const biggest = views
    .filter(({ row, v }) => v.delta != null && row.key !== "pace")
    .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))[0];
  const flagBiggest =
    biggest && Math.abs(biggest.v.delta as number) >= 5 && !rankBadge(biggest.row, biggest.v.rank);

  // The headline rows (mak, 2026-11-02): the builder's signals, folded into
  // the table as tinted rows with the one-sentence verdict under the label.
  // The separate "Offensive signals" rail is gone; its implication line is
  // the verdict's title, its sample caveat sits muted after the verdict.
  const signalByKey = new Map(c.shifts.filter((s) => s.key).map((s) => [s.key as string, s]));

  const rows = views
    .map(({ row, v }, i) => {
      const signal = row.key ? signalByKey.get(row.key) : undefined;
      const badge = rankBadge(row, v.rank) || (flagBiggest && row === biggest.row ? `<span class="sct-co-badge">Biggest YoY move</span>` : "");
      const sub = row.sub && row.key && KEEP_SUB.has(row.key) ? `<span class="sct-co-cell-sub">${e(row.sub)}</span>` : "";
      // The verdict line under a tinted row ("Less play-action.", "3 such
      // snaps") went 2026-11-02 (mak); the tint alone marks a headline move.
      const verdict = "";
      return (
        `<tr${signal ? ` class="is-signal"` : ""}>` +
        `<th scope="row" class="sct-co-td is-tendency">${rowLabel(row, `sct-co-def-${i}`)}${sub}${verdict}</th>` +
        `<td class="sct-co-td is-prior">${e(row.prior)}</td>` +
        `<td class="sct-co-td is-now">${e(v.current)}</td>` +
        `<td class="sct-co-td is-change">${changeStrip(row, v, priorYear, season)}` +
        `<span class="sct-co-chg-line"><span class="sct-co-change is-${v.change.dir}">${e(v.change.text)}</span>${badge}</span></td>` +
        `<td class="sct-co-td is-avg">${e(row.nflAvg)}</td>` +
        `</tr>`
      );
    })
    .join("");
  // No subtitle under the heading (mak, 2026-11-02): the identity chips are
  // the section's one summary; the intro and header already frame "what changed".
  return (
    `<div class="sct-co-tend">` +
    `<div class="sct-co-tend-head"><h3 class="sct-co-tend-title">Offensive tendencies</h3></div>` +
    identityStrip(c, views) +
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} play-calling tendencies`)}">` +
    `<table class="sct-co-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Tendency</th>` +
    `<th scope="col" class="sct-co-th is-prior">${seasonHead(c.tendencies.priorLabel)}</th>` +
    `<th scope="col" class="sct-co-th is-now">${seasonHead(c.tendencies.currentLabel, "Current")}</th>` +
    `<th scope="col" class="sct-co-th">Change</th>` +
    `<th scope="col" class="sct-co-th is-avg">NFL avg</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>` +
    `<p class="sct-co-legend">${e(
      `Select a tendency for how it is counted. Strip: hollow dot ${priorYear}, filled dot ${season}, grey tick NFL average; tinted rows are the season's headline moves.`,
    )}</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------------ staff profile */

/** A stored scheme note's first clause as a one-line read, and the rest. */
function leadClause(text: string): { lead: string; rest: string } {
  const m = text.match(/^(.+?)(?:;\s+|\.\s+)(.+)$/);
  return m ? { lead: m[1].replace(/\.$/, ""), rest: m[2] } : { lead: text.replace(/\.$/, ""), rest: "" };
}

function moreNotes(label: string, text: string): string {
  if (!text) return "";
  return (
    `<details class="sct-co-more"><summary class="sct-co-more-q">${e(label)}</summary>` +
    `<p class="sct-co-more-a">${e(text[0].toUpperCase() + text.slice(1))}</p></details>`
  );
}

/**
 * Offense, defense, continuity in one shared surface, weighted by importance:
 * the OC widest, the DC next, continuity a compact KPI. Every card runs
 * eyebrow, name or metric, a one-line read, then the supporting detail; the
 * long verified scheme and background notes sit one click down.
 */
/**
 * The DC card's numbers, read back from the builder's templated body ("Through
 * Week 3 the defense allows -0.04 EPA per play (11th of 32, ...). ...") so the
 * metric can lead and the game-script read can fold away.
 */
function defenseRead(body: string): { week: number; epa: string; rank: number | null; rest: string } | null {
  const m = body.match(/^Through Week (\d+) the defense allows (-?\d+(?:\.\d+)?) EPA per play(?: \((\d+)(?:st|nd|rd|th) of 32[^)]*\))?\.\s*(.*)$/);
  if (!m) return null;
  return { week: Number(m[1]), epa: m[2].replace(/^-/, "−"), rank: m[3] ? Number(m[3]) : null, rest: m[4] };
}

/**
 * The DC's scheme as chips (mak, 2026-11-02): up to three words pulled from
 * the verified scheme note's own vocabulary, one per family (front, pressure,
 * coverage), each family's earliest mention winning. The full note sits under
 * "More", so a reader who wants the sentence still has it.
 */
type SchemeFamily = "front" | "pressure" | "coverage";
const SCHEME_TAGS: Array<{ cat: SchemeFamily; re: RegExp; tag: string }> = [
  { cat: "front", re: /\b4-2-5\b/, tag: "4-2-5" },
  { cat: "front", re: /\b3-4\b/, tag: "3-4" },
  { cat: "front", re: /\b4-3\b/, tag: "4-3" },
  { cat: "front", re: /\bfour-down\b/i, tag: "four-down front" },
  { cat: "front", re: /\bmultiple\b/i, tag: "multiple fronts" },
  { cat: "front", re: /\bnickel\b/i, tag: "nickel base" },
  { cat: "pressure", re: /\bsim(?:ulated)?(?:\/\w+)? pressures?\b/i, tag: "sim pressures" },
  { cat: "pressure", re: /\b(?:four|4)-man rush\b/i, tag: "four-man rush" },
  { cat: "pressure", re: /\b(?:pressure|blitz|attacking|aggressive)/i, tag: "pressure-heavy" },
  { cat: "coverage", re: /\bdisguise/i, tag: "disguise" },
  { cat: "coverage", re: /\bman-heavy|man coverage|man-oriented|man\/match/i, tag: "man-heavy" },
  { cat: "coverage", re: /\b(?:two-high|split-safety|quarters)\b/i, tag: "two-high shells" },
  { cat: "coverage", re: /\b(?:zone-match|match-zone|match coverage)\b/i, tag: "match zone" },
  { cat: "coverage", re: /\bcover 3\b/i, tag: "Cover 3" },
];

function schemeTags(note: string): string[] {
  const picked: Partial<Record<SchemeFamily, { at: number; tag: string }>> = {};
  for (const t of SCHEME_TAGS) {
    const at = note.search(t.re);
    if (at < 0) continue;
    const cur = picked[t.cat];
    if (!cur || at < cur.at) picked[t.cat] = { at, tag: t.tag };
  }
  return (["front", "pressure", "coverage"] as const)
    .map((k) => picked[k]?.tag)
    .filter((t): t is string => Boolean(t));
}

/**
 * Two tight cards (mak, 2026-11-02): the OC as name, the delegation-watch
 * chip when it applies, and one line, with the verified background one click
 * down; the DC as name, scheme chips and the EPA number. The Continuity card
 * is gone: the reliability meter in the coach card already says it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function staff(c: TeamCoaching): string {
  const { oc, dc } = c.staff;
  // "Delegation watch" is for a coordinator who is NOT calling plays but has
  // before; the caller himself is profiled in the card above.
  const watch = !oc.isCaller && oc.hasCalledPlays;
  const ocLead = oc.isCaller ? "Primary play-caller" : oc.hasCalledPlays ? "Has called plays before" : "Not the play-caller";
  const ocLine = watch ? "A mid-season handoff would reset this page's baseline." : "";
  const ocMore = [oc.isCaller ? "" : oc.sub, oc.body.replace(/^;\s*/, "")]
    .filter(Boolean)
    .map((part) => part.replace(/\.$/, ""))
    .join(". ")
    .replace(/([^.])$/, "$1.");
  const tags = schemeTags(dc.sub);
  const dcNote = leadClause(dc.sub);
  const def = defenseRead(dc.body);
  // The builder's own tiers: top ten / bottom ten, the rest middle.
  const defLine = def
    ? (def.rank == null ? "" : def.rank <= 10 ? "Early results are strong" : def.rank >= 23 ? "Early results are weak" : "Middle of the pack so far") +
      (def.week <= 6 ? `${def.rank == null ? "The" : ", but the"} ${def.week}-week sample is still small.` : ".")
    : "";
  const dcMore = [def ? def.rest : "", tags.length ? `${dc.sub.replace(/\.$/, "")}.` : dcNote.rest].filter(Boolean).join(" ");
  return (
    `<div class="sct-co-block">` +
    `<p class="sct-co-eyebrow">Staff profile</p>` +
    `<div class="sct-co-staff">` +
    `<article class="sct-co-staffcard is-oc${watch ? " is-watch" : ""}">` +
    `<p class="sct-co-role">Offensive coordinator${watch ? `<span class="sct-co-watch">Delegation watch</span>` : ""}</p>` +
    `<h4 class="sct-co-h4">${e(oc.name)}</h4>` +
    `<p class="sct-co-staff-sub${oc.isCaller ? " is-accent" : ""}">${e(ocLead)}</p>` +
    (ocLine ? `<p class="sct-co-body">${e(ocLine)}</p>` : "") +
    // Always open (mak, 2026-11-02): the background reads as plain body text.
    (ocMore ? `<p class="sct-co-body sct-co-bg">${e(ocMore[0].toUpperCase() + ocMore.slice(1))}</p>` : "") +
    `</article>` +
    `<article class="sct-co-staffcard is-dc">` +
    `<p class="sct-co-role">Defensive coordinator</p>` +
    `<h4 class="sct-co-h4">${e(dc.name)}</h4>` +
    (tags.length
      ? `<ul class="sct-co-tags" aria-label="Scheme">${tags.map((t) => `<li class="sct-co-tag">${e(t)}</li>`).join("")}</ul>`
      : `<p class="sct-co-staff-sub is-tag">${e(dcNote.lead)}</p>`) +
    (def
      ? `<p class="sct-co-defmetric"><span class="sct-co-defval">${e(def.epa)}</span> <span class="sct-co-defunit">EPA/play allowed</span>` +
        (def.rank != null ? `<span class="sct-co-sig-pill is-rank" title="${e(`${ordinal(def.rank)} in NFL`)}">${ordinal(def.rank)}</span>` : "") +
        `</p>` +
        (defLine ? `<p class="sct-co-body">${e(defLine)}</p>` : "")
      : `<p class="sct-co-body">${e(dc.body)}</p>`) +
    moreNotes("More", dcMore) +
    `</article>` +
    `</div></div>`
  );
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

/** "↓ 3 pts vs league": the gap the stop is distinctive for. */
function vsLeague(share: number, league: number): string {
  const gap = Math.round((share - league) * 10) / 10;
  if (gap === 0) return "at league";
  return `${gap > 0 ? "↑" : "↓"} ${Math.abs(gap)} pts vs league`;
}

type Pos = "WR" | "RB" | "TE";
const POS: Pos[] = ["WR", "RB", "TE"];

/** One tracked season's usage numbers (the builder's `prints`, or read back from its prose). */
interface Print {
  year: number;
  label: string;
  shares: Record<Pos, number | null>;
  league: Record<Pos, number | null>;
  leadBack: number | null;
}

/** The position whose share sits 3+ points off the league: the season's distinctive trait, or none. */
function leanOf(p: Print): Pos | null {
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
interface Stop {
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

function readStops(c: TeamCoaching): Stop[] {
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
function stopColors(stops: Stop[]): Map<string, string> {
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

const f1 = (n: number) => String(Math.round(n * 10) / 10);

/**
 * The scoring line at one width. Two are rendered (720 and 360 wide) and
 * the container query shows one, so the type stays legible on a phone
 * instead of scaling down with the viewBox.
 */
function careerChartSvg(
  stops: Stop[],
  colors: Map<string, string>,
  league: Record<string, number>,
  W: number,
  H: number,
  narrow: boolean,
): string {
  const padL = 30;
  const padR = narrow ? 46 : 60;
  const padT = 28;
  const padB = 22;
  const x0 = Math.min(...stops.map((s) => s.start));
  const x1 = Math.max(...stops.map((s) => s.end)) + 1;
  const leagueIn = Object.entries(league)
    .filter(([y]) => Number(y) >= x0 && Number(y) < x1)
    .map(([, v]) => v);
  const vals = [...stops.flatMap((s) => s.points.map((p) => p.ppg)), ...leagueIn];
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5);
  const hi = Math.ceil((Math.max(...vals) + 2) / 5) * 5;
  const x = (yr: number) => padL + ((yr - x0) / (x1 - x0)) * (W - padL - padR);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const step = hi - lo > 20 ? 10 : 5;

  let grid = "";
  for (let v = lo; v <= hi; v += step) {
    grid +=
      `<line class="sct-co-ch-grid${v === lo ? " is-base" : ""}" x1="${padL}" x2="${W - padR}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>` +
      `<text class="sct-co-ch-tick" x="${padL - 6}" y="${f1(y(v))}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }

  // Year labels along the base: each stop's first season and the last
  // season on the line, the longer stints claiming their slot first so a
  // one-year stop never crowds out the start of a ten-year one.
  const yearLabel = (yr: number) => (narrow ? `'${String(yr).slice(2)}` : String(yr));
  const minGap = narrow ? 26 : 32;
  const wanted = stops.map((s) => ({ yr: s.start, span: s.end - s.start + 1 }));
  if (!stops.some((s) => s.start === x1 - 1)) wanted.push({ yr: x1 - 1, span: 0.5 });
  const placed: Array<{ yr: number; xx: number }> = [];
  for (const w of [...wanted].sort((a, b) => b.span - a.span)) {
    const xx = x(w.yr) + (w.yr === x1 - 1 ? (x(w.yr + 1) - x(w.yr)) / 2 : 0);
    if (placed.some((p) => Math.abs(p.xx - xx) < minGap)) continue;
    placed.push({ yr: w.yr, xx });
  }
  const years = placed
    .sort((a, b) => a.xx - b.xx)
    .map((p) => `<text class="sct-co-ch-year" x="${f1(p.xx)}" y="${H - 6}" text-anchor="middle">${yearLabel(p.yr)}</text>`)
    .join("");

  // The league average, one point per season at the season's midpoint.
  const pts: string[] = [];
  let avgEnd: { x: number; y: number } | null = null;
  for (let yr = x0; yr < x1; yr++) {
    const v = league[String(yr)];
    if (v == null) continue;
    avgEnd = { x: x(yr + 0.5), y: y(v) };
    pts.push(`${f1(avgEnd.x)},${f1(avgEnd.y)}`);
  }
  const avg =
    pts.length >= 2 && avgEnd
      ? `<polyline class="sct-co-ch-avg" points="${pts.join(" ")}"/>` +
        `<text class="sct-co-ch-avglabel" x="${W - padR + 6}" y="${f1(avgEnd.y)}" dominant-baseline="middle">NFL avg</text>`
      : "";

  // A stint spans its years; its line runs through each season's own point
  // at that season's midpoint, with a half-year lead-in at either end so
  // the stint has width even when it is one season.
  const segs = stops.map((s) => {
    const xa = x(s.start) + 2;
    const xb = x(s.end + 1) - 2;
    const dots = s.points.map((p) => ({ ...p, px: x(p.year + 0.5), py: y(p.ppg) }));
    return { s, xa, xb, dots, yFirst: dots[0].py, yLast: dots[dots.length - 1].py, color: colors.get(s.code) as string };
  });

  // The step between stops he called: a thin neutral riser, never the
  // club color, so it reads as a join and not as a stint.
  let links = "";
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1];
    const b = segs[i];
    if (!a.s.caller || !b.s.caller) continue;
    links += `<line class="sct-co-ch-link" x1="${f1(a.xb)}" y1="${f1(a.yLast)}" x2="${f1(b.xa)}" y2="${f1(b.yFirst)}"/>`;
  }

  // The peak is the best single season he called; the current flag is this season's point.
  type Dot = (typeof segs)[number]["dots"][number];
  let peak: { g: (typeof segs)[number]; d: Dot } | null = null;
  let current: { g: (typeof segs)[number]; d: Dot } | null = null;
  for (const g of segs) {
    for (const d of g.dots) {
      if (g.s.caller && (!peak || d.ppg > peak.d.ppg)) peak = { g, d };
      if (g.s.current && d.year === g.s.end) current = { g, d };
    }
  }
  const flagOf = (d: Dot) =>
    d === peak?.d && d === current?.d ? "peak · current" : d === peak?.d ? "peak" : d === current?.d ? "current" : "";

  let marks = "";
  let lastCodeX = -Infinity;
  segs.forEach((g, i) => {
    const { s, xa, xb, dots, color } = g;
    let inner = "";
    if (s.caller) {
      const line = [`${f1(xa)},${f1(g.yFirst)}`, ...dots.map((d) => `${f1(d.px)},${f1(d.py)}`), `${f1(xb)},${f1(g.yLast)}`];
      inner += `<polyline class="sct-co-ch-seg${s.hc ? " is-hc" : ""}" points="${line.join(" ")}" style="--seg:${color}"/>`;
    }
    const flagged = dots.filter((d) => flagOf(d));
    // A flag sits above its point unless a neighboring point (any stop)
    // sits higher within the label's reach, when the line into the point
    // would cross the label; it drops below instead. An edge flag is
    // end-anchored and reaches further left.
    const allDots = segs.flatMap((o) => o.dots);
    const crowdedAbove = (d: Dot) =>
      allDots.some((o) => o !== d && Math.abs(o.px - d.px) < (d.px > W - padR - 40 ? 80 : 44) && o.py < d.py - 2 && o.py > d.py - 60);
    let flagBelow = false;
    for (const d of dots) {
      const title =
        `${d.year}${s.window ? ` (${s.window})` : ""} · ${s.code} · ${s.role} · ${d.ppg} PPG` + (d.rank ? ` · ${d.rank}` : "");
      const half = (x(d.year + 1) - x(d.year)) / 2;
      let pt = `<title>${e(title)}</title><rect x="${f1(d.px - half)}" y="${padT}" width="${f1(half * 2)}" height="${H - padT - padB}"/>`;
      const live = s.current && d.year === s.end;
      if (live) pt += `<circle class="sct-co-ch-halo" cx="${f1(d.px)}" cy="${f1(d.py)}" r="9"/>`;
      pt += s.caller
        ? `<circle class="sct-co-ch-dot${live ? " is-current" : ""}" cx="${f1(d.px)}" cy="${f1(d.py)}" r="${dots.length > 1 ? 3.5 : 4.5}" style="--seg:${color}"/>`
        : `<circle class="sct-co-ch-dot is-hollow" cx="${f1(d.px)}" cy="${f1(d.py)}" r="4" style="--seg:${color}"/>`;
      const flag = flagOf(d);
      if (flag) {
        const atEdge = d.px > W - padR - 40;
        const below = crowdedAbove(d);
        if (below) flagBelow = true;
        pt +=
          `<text class="sct-co-ch-flag" x="${f1(atEdge ? xb + 2 : d.px)}" y="${f1(below ? d.py + 21 : d.py - 11)}" text-anchor="${atEdge ? "end" : "middle"}">` +
          `<tspan class="v">${d.ppg.toFixed(1)}</tspan><tspan class="k"> ${e(flag)}</tspan></text>`;
      }
      inner += `<g class="sct-co-ch-pt${live ? " is-current" : ""}">${pt}</g>`;
    }
    // The club's code once per run of its stops, over the stint's middle
    // season and clear of its highest point, or under its lowest where a
    // flag takes the space above; skipped when it would collide.
    const runStart = i === 0 || segs[i - 1].s.code !== s.code;
    const mid = dots[Math.floor((dots.length - 1) / 2)];
    if (runStart && mid.px - lastCodeX >= minGap) {
      // Opposite side from the stint's flag, so the two never share a band.
      const below = flagged.length > 0 && !flagBelow;
      const ly = below ? Math.max(...dots.map((d) => d.py)) + 16 : Math.min(...dots.map((d) => d.py)) - 10;
      if (ly < H - padB - 2 && ly > padT - 8) {
        inner += `<text class="sct-co-ch-code" x="${f1(mid.px)}" y="${f1(ly)}" text-anchor="middle">${e(s.code)}</text>`;
        lastCodeX = mid.px;
      }
    }
    marks += `<g class="sct-co-ch-stop${s.current ? " is-current" : ""}">${inner}</g>`;
  });

  return (
    `<svg class="sct-co-ch ${narrow ? "is-narrow" : "is-wide"}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">` +
    grid +
    years +
    avg +
    links +
    marks +
    `</svg>`
  );
}

/**
 * The chart with its key, caption and a visually-hidden table of the same
 * stops, so the numbers reach a screen reader and anyone copying them.
 */
function careerChart(c: TeamCoaching, stops: Stop[]): string {
  const colors = stopColors(stops);
  const league = getLeaguePpg();
  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const x0 = Math.min(...stops.map((s) => s.start));
  const x1 = Math.max(...stops.map((s) => s.end));
  // The key in order of appearance on the line, whatever order the colors were decided in.
  const clubs = [...new Set(stops.map((s) => s.code))].map((code) => [code, colors.get(code) as string] as const);
  const hasHc = stops.some((s) => s.hc && s.caller);
  const hasOther = stops.some((s) => !s.hc && s.caller);
  const hasHollow = stops.some((s) => !s.caller);
  const key =
    `<ul class="sct-co-ch-key">` +
    clubs.map(([code, color]) => `<li><i class="sct-co-ch-sw" style="--seg:${color}"></i>${e(code)}</li>`).join("") +
    (hasHc && hasOther ? `<li><i class="sct-co-ch-sw is-hc"></i>Head coach</li>` : "") +
    (hasHollow ? `<li><i class="sct-co-ch-sw is-hollow"></i>Not the caller</li>` : "") +
    (Object.keys(league).length ? `<li><i class="sct-co-ch-sw is-avg"></i>NFL avg</li>` : "") +
    `</ul>`;
  const rows = stops
    .flatMap((s) =>
      s.points.map(
        (p) =>
          `<tr><td>${p.year}${s.window ? ` (${e(s.window)})` : ""}</td><td>${e(s.code)}</td><td>${e(s.role)}</td>` +
          `<td>${p.ppg.toFixed(1)}</td><td>${e(p.rank)}</td><td>${s.caller ? "Yes" : "No"}</td></tr>`,
      ),
    )
    .join("");
  return (
    `<figure class="sct-co-chart" aria-label="${e(`${possessive} offenses by stop: points per game, ${x0}-${x1}`)}">` +
    careerChartSvg(stops, colors, league, 720, 200, false) +
    careerChartSvg(stops, colors, league, 360, 190, true) +
    key +
    `<figcaption class="sct-co-ch-cap">Points per game by season, ${x0}-${x1}, one line per stop. The step between stops is the move.</figcaption>` +
    `<table class="sct-visually-hidden"><caption>Career scoring by stop</caption>` +
    `<thead><tr><th scope="col">Season</th><th scope="col">Club</th><th scope="col">Role</th><th scope="col">PPG</th><th scope="col">Rank</th><th scope="col">Called plays</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `</figure>`
  );
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
function fingerprintTable(c: TeamCoaching, stops: Stop[], colors: Map<string, string>): string {
  const rows = stops.flatMap((s) => s.prints.map((p) => ({ s, p })));
  if (!rows.length) return "";
  const first = rows[0].p.year;
  const lastYr = rows[rows.length - 1].p.year;
  const span = first === lastYr ? String(first) : `${first}-${String(lastYr).slice(2)}`;
  const season = seasonOf(c);

  // Career stats: the most concentrated backfield, and the position whose
  // share sat 3+ points off the league most often (either direction).
  const stat = (value: string, label: string) =>
    `<li class="sct-co-fpstat"><span class="sct-co-fpstat-v">${e(value)}</span><span class="sct-co-fpstat-l">${e(label)}</span></li>`;
  const stats: string[] = [];
  const withLb = rows.filter((r) => r.p.leadBack != null);
  if (withLb.length >= 2) {
    const top = withLb.reduce((a, b) => ((b.p.leadBack as number) > (a.p.leadBack as number) ? b : a));
    stats.push(stat(`${top.p.leadBack}%`, `Peak lead-back share · ${top.p.year} ${top.s.code}`));
  }
  if (rows.length >= 2) {
    let best: { pos: Pos; side: "below" | "above"; n: number; of: number } | null = null;
    for (const pos of POS) {
      const known = rows.filter((r) => r.p.shares[pos] != null && r.p.league[pos] != null);
      const below = known.filter((r) => (r.p.shares[pos] as number) <= (r.p.league[pos] as number) - 3).length;
      const above = known.filter((r) => (r.p.shares[pos] as number) >= (r.p.league[pos] as number) + 3).length;
      for (const [side, n] of [["below", below], ["above", above]] as const) {
        if (n && (!best || n > best.n)) best = { pos, side, n, of: known.length };
      }
    }
    if (best) stats.push(stat(`${best.n} / ${best.of}`, `seasons with ${best.pos} share 3+ pts ${best.side} league`));
  }

  const sub = (text: string) => `<span class="sct-co-cell-sub">${e(text)}</span>`;
  const shareCell = (p: Print, pos: Pos, lean: Pos | null) => {
    const v = p.shares[pos];
    const lg = p.league[pos];
    if (v == null) return `<td class="sct-co-td is-share"><span class="sct-co-fpv is-none">-</span></td>`;
    const d = lg != null ? Math.round(v - lg) : null;
    const dir = d == null ? "" : d >= 3 ? "is-up" : d <= -3 ? "is-down" : "is-flat";
    const delta =
      d == null
        ? ""
        : `<span class="sct-co-fpd ${dir}">${Math.abs(d) >= 3 ? `${d > 0 ? "↑" : "↓"} ${Math.abs(d)}` : d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "0"}</span>`;
    return `<td class="sct-co-td is-share"><span class="sct-co-fpv${lean === pos ? " is-lean" : ""}">${v}%</span>${delta}</td>`;
  };

  // Rows in order, grouped by stint; a stint's first row carries its label
  // for the whole group, and a year between stints with no stop at all
  // gets a labeled break instead of a silent jump.
  const covered = new Set(stops.flatMap((s) => Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start + i)));
  let body = "";
  for (let i = 0; i < rows.length; i++) {
    const { s, p } = rows[i];
    const prev = rows[i - 1];
    if (prev) {
      const missing: number[] = [];
      for (let yr = prev.p.year + 1; yr < p.year; yr++) if (!covered.has(yr)) missing.push(yr);
      if (missing.length) {
        const label = missing.length === 1 ? String(missing[0]) : `${missing[0]}-${String(missing[missing.length - 1]).slice(2)}`;
        body += `<tr class="sct-co-fpgap"><td colspan="7">${e(`${label} · not calling plays`)}</td></tr>`;
      }
    }
    // A group is a run of the same club and role: Vegas 2022 and the
    // windowed 2023 stint are two dossier stops but one band here.
    const same = (a: Stop, b: Stop) => a.code === b.code && a.role === b.role;
    const groupStart = !prev || !same(prev.s, s);
    const groupLen = groupStart ? rows.slice(i).findIndex((r) => !same(r.s, s)) : 0;
    const groupRows = groupStart ? rows.slice(i, groupLen === -1 ? rows.length : i + groupLen) : [];
    const groupYears = groupStart
      ? (() => {
          const a = Math.min(...groupRows.map((r) => r.s.start));
          const b = Math.max(...groupRows.map((r) => r.s.end));
          return a === b ? String(a) : `${a}-${String(b).slice(2)}`;
        })()
      : "";
    const win = p.label.match(/\((Wks [^)]+)\)/)?.[1];
    const live = s.current && p.year === season;
    const lean = leanOf(p);
    const fin = finishFor(c, p.label);
    const pills = (fin?.cells ?? [])
      .map((cell) => readFinish(cell.text))
      .filter((f): f is NonNullable<ReturnType<typeof readFinish>> => f !== null)
      .map((f) => finishPill(f.pos, f.rank, fin?.current, Boolean(win)))
      .join("");
    const stint =
      groupStart
        ? `<th scope="rowgroup" rowspan="${groupLen === -1 ? rows.length - i : groupLen}" class="sct-co-td is-stint">` +
          `<span class="sct-co-fpv sct-co-fpclub">${stepCrest(s.code)}${e(s.code)}</span>${sub(s.role)}${sub(groupYears)}</th>`
        : "";
    body +=
      `<tr class="${live ? "is-current" : ""}${groupStart ? " is-stint-start" : ""}" style="--seg:${colors.get(s.code) ?? "#0b1634"}">` +
      `<th scope="row" class="sct-co-td is-season"><span class="sct-co-fpyear">${p.year}</span>` +
      (win ? sub(win) : "") +
      (live ? `<span class="sct-co-fnow">In-season</span>` : "") +
      `</th>` +
      stint +
      POS.map((pos) => shareCell(p, pos, lean)).join("") +
      `<td class="sct-co-td is-lb">` +
      (p.leadBack != null ? `<span class="sct-co-fpv${p.leadBack >= 65 ? " is-workhorse" : ""}">${p.leadBack}%</span>` : `<span class="sct-co-fpv is-none">-</span>`) +
      `</td>` +
      `<td class="sct-co-td is-fins">${pills ? `<span class="sct-co-fp-pills">${pills}</span>` : "-"}</td>` +
      `</tr>`;
  }

  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const partial = rows.some((r) => /\(Wks/.test(r.p.label));
  return (
    `<div class="sct-co-fpblock">` +
    `<div class="sct-co-fphead"><p class="sct-co-fptitle">${e(`Scheme fingerprint, ${span}`)}</p>` +
    (stats.length ? `<ul class="sct-co-fpstats">${stats.join("")}</ul>` : "") +
    `</div>` +
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`Scheme fingerprint by season, ${span}`)}">` +
    `<table class="sct-co-fptable">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Season</th>` +
    `<th scope="col" class="sct-co-th">Stop</th>` +
    `<th scope="col" class="sct-co-th is-share">WR share<span class="sct-co-th-sub">of targets · vs league</span></th>` +
    `<th scope="col" class="sct-co-th is-share">RB share</th>` +
    `<th scope="col" class="sct-co-th is-share">TE share</th>` +
    `<th scope="col" class="sct-co-th is-lb">Lead back<span class="sct-co-th-sub">% of weighted opps</span></th>` +
    `<th scope="col" class="sct-co-th is-fins">Finishes<span class="sct-co-th-sub">PPR, QB · RB1 · WR1 · TE1</span></th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>` +
    `<p class="sct-co-fnote">${e(
      `Bold share: the season's distinctive position, 3+ points off the league. Bold lead back: 65%+ of the backfield's weighted opportunities. ` +
        `Finishes are season-long PPR ranks under ${last}` +
        (partial ? "; ° marks a partial season, ranked over the weeks he called only" : "") +
        `. Dashed chips are this season's pace, not a finish.`,
    )}</p>` +
    `</div>`
  );
}

function dossier(c: TeamCoaching): string {
  const stops = readStops(c);
  // One stop makes a flat line; the table alone carries a single-stop career.
  const chart = stops.length >= 2 ? careerChart(c, stops) : "";
  const prints = fingerprintTable(c, stops, stopColors(stops));
  if (!chart && !prints) return "";
  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  return (
    `<div class="sct-co-block sct-co-dossier">` +
    `<p class="sct-co-eyebrow">Career dossier</p>` +
    `<p class="sct-co-dsub">${e(`How ${possessive} offenses have changed across stops`)}</p>` +
    chart +
    prints +
    `</div>`
  );
}

/* ---------------------------------------------------------------- finishes */

type FinishRow = TeamCoaching["finishes"]["rows"][number];

/** "QB18 · Jones" -> position, rank, player. */
function readFinish(text: string): { pos: string; rank: number; player: string } | null {
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
const finishTier = (rank: number) => FINISH_TIERS.find(([max]) => rank <= max) as [number, string, string];

function finishPill(pos: string, rank: number, provisional = false, partial = false): string {
  const [, key, label] = finishTier(rank);
  const title = provisional
    ? "In-season pace, not a final finish"
    : `${label} ${pos} finish${partial ? ", over the weeks he called only" : ""}`;
  return (
    `<span class="sct-co-fpill is-${provisional ? "provisional" : key}"` +
    ` title="${e(title)}">${e(`${pos}${rank}`)}${partial ? `<sup class="sct-co-fpill-part">°</sup>` : ""}</span>`
  );
}

/** "Patriots 2021" / "Patriots · 2026" -> club, season. */
function finishStop(row: FinishRow): { club: string; year: string } {
  const m = row.stop.match(/^(.*?)\s*(?:·\s*)?(\d{4})$/);
  return m ? { club: m[1], year: m[2] } : { club: row.stop, year: "" };
}

/**
 * The finishes row a dossier fingerprint describes: same season and, where a
 * caller has two windows in one season, the same week range.
 */
function finishFor(c: TeamCoaching, fpYear: string): FinishRow | undefined {
  const year = fpYear.slice(0, 4);
  const win = fpYear.match(/\((Wks [^)]+)\)/)?.[1];
  // The current pace row lives only in `rows`; every past season is in `history`.
  const rows = [...(c.finishes.history ?? []), ...c.finishes.rows.filter((r) => r.current || !c.finishes.history)].filter(
    (r) => finishStop(r).year === year,
  );
  if (rows.length <= 1) return rows[0];
  return win ? rows.find((r) => r.context.includes(win)) : undefined;
}

/** Best completed finish per position, read off the table's settled rows. */
/**
 * Fantasy finishes by coaching stop: the rank leads as a tiered pill, the
 * player sits under it, and the in-season row is marked provisional so a
 * three-week QB34 never reads like a season-end one. The stored methodology
 * note sits one click down.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function finishes(c: TeamCoaching, team: NflTeam): string {
  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const rows = c.finishes.rows
    .map((row) => {
      const { club, year } = finishStop(row);
      const pace = row.context.match(/^pace through (Week \d+)$/i);
      return (
        `<tr class="${row.current ? "is-current" : ""}">` +
        `<th scope="row" class="sct-co-td is-stop"><span class="sct-co-fstop">${e(year ? `${club} · ${year}` : club)}</span>` +
        `<span class="sct-co-cell-sub">${e(pace ? `Through ${pace[1]}` : row.context)}</span>` +
        (row.current ? `<span class="sct-co-fnow">In-season</span>` : "") +
        `</th>` +
        row.cells
          .map((cell) => {
            const f = readFinish(cell.text);
            return f
              ? `<td class="sct-co-td is-fin">${finishPill(f.pos, f.rank, row.current)}<span class="sct-co-fwho">${e(f.player)}</span></td>`
              : `<td class="sct-co-td is-fin">${e(cell.text)}</td>`;
          })
          .join("") +
        `</tr>`
      );
    })
    .join("");
  return (
    `<div class="sct-co-block">` +
    `<p class="sct-co-eyebrow">Fantasy finishes by coaching stop</p>` +
    `<p class="sct-co-dsub">${e(`Where ${possessive} QB1, RB1, WR1 and TE1 finished in PPR fantasy scoring`)}</p>` +
    // The "Best finishes" strip went 2026-11-02 (mak).
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`Positional fantasy finishes under the ${team.nickname} play-caller`)}">` +
    `<table class="sct-co-finishes">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Stop</th>` +
    // Position columns centered (mak, 2026-11-02).
    `<th scope="col" class="sct-co-th is-fin">QB</th>` +
    `<th scope="col" class="sct-co-th is-fin">RB1</th>` +
    `<th scope="col" class="sct-co-th is-fin">WR1</th>` +
    `<th scope="col" class="sct-co-th is-fin">TE1</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="sct-co-fnote">${e(`PPR positional finishes. Partial-season rows rank only the games ${last} called. Historical outcomes, not projections.`)}</p>` +
    `<details class="sct-co-more"><summary class="sct-co-more-q">How finishes are calculated</summary>` +
    `<p class="sct-co-more-a">${e(c.finishes.note)}</p></details>` +
    `</div>`
  );
}

/* -------------------------------------------------------------- note + bars */

function rookieNote(c: TeamCoaching): string {
  if (!c.rookieNote) return "";
  return (
    `<div class="sct-co-rookie">` +
    `<p class="sct-co-role is-blue">${e(c.rookieNote.label)}</p>` +
    `<p class="sct-co-body">${e(c.rookieNote.body)}</p>` +
    `</div>`
  );
}

/**
 * One labeled bar: fill = the share, an optional thin marker = the league
 * average. The number always rides beside the bar - never color-only.
 */
function barRow(row: BarRow, label: string, value: string, extra = ""): string {
  const width = row.pct ?? row.share ?? 0;
  return (
    `<div class="sct-co-brow">` +
    `<span class="sct-co-blabel">${e(row.label)}</span>` +
    `<span class="sct-co-btrack" role="img" aria-label="${e(label)}">` +
    `<span class="sct-co-bfill${row.gold ? " is-gold" : ""}" style="width:${width}%"></span>` +
    (row.nfl != null ? `<span class="sct-co-bmark" style="left:${row.nfl}%"></span>` : "") +
    `</span>` +
    `<span class="sct-co-bval">${e(value)}${extra ? `<span class="sct-co-bextra">${extra}</span>` : ""}</span>` +
    `</div>`
  );
}

/**
 * A panel's read under its visual: one takeaway line, then a small context
 * line (scope or sample). Replaces the paragraph each panel used to close on.
 */
function takeaway(line: string, context: string): string {
  return (
    `<div class="sct-co-take"><p class="sct-co-label">Takeaway</p>` +
    `<p class="sct-co-take-line">${e(line)}</p>` +
    (context ? `<p class="sct-co-take-ctx">${e(context)}</p>` : "") +
    `</div>`
  );
}

const signedPts = (d: number) => (d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`);

/** The position furthest from league, if it is 3+ points off (the builder's bar). */
function distLean(c: TeamCoaching): BarRow | null {
  const rows = c.distribution.rows.filter((r) => r.pct != null && r.nfl != null);
  const top = [...rows].sort((a, b) => Math.abs((b.pct as number) - (b.nfl as number)) - Math.abs((a.pct as number) - (a.nfl as number)))[0];
  return top && Math.abs((top.pct as number) - (top.nfl as number)) >= 3 ? top : null;
}

function distribution(c: TeamCoaching): string {
  const lean = distLean(c);
  const many = /^Across his/.test(c.distribution.note);
  return (
    `<div class="sct-co-panel">` +
    h3("How he distributes the ball") +
    `<p class="sct-co-panel-sub">${e(c.distribution.sub)}</p>` +
    // The "Filled bar = X offenses · thin marker = league average" key went
    // 2026-11-03 (mak); the "+5 vs NFL" pills carry the comparison.
    c.distribution.rows
      .map((row) => {
        const d = (row.pct ?? 0) - (row.nfl ?? 0);
        // Gold marks the one position that materially deviates, not a position.
        return barRow(
          { ...row, gold: row === lean },
          `${row.label}: ${row.pct}% of targets, league average ${row.nfl}%`,
          `${row.pct}% · NFL ${row.nfl}%`,
          `<span class="sct-co-diff${row === lean ? " is-lean" : ""}">${e(`${signedPts(d)} vs NFL`)}</span>`,
        );
      })
      .join("") +
    takeaway(
      lean
        ? `${lean.label} have drawn ${lean.pct}% of targets vs ${lean.nfl}% league average.`
        : "Every position sits within a few points of league average: the target tree follows the talent.",
      many ? "Historical tendency only; current roster usage matters more." : "One season of data; current roster usage matters more.",
    ) +
    `</div>`
  );
}

function backfield(c: TeamCoaching, view: UsageView | null): string {
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
  // The "Tracked range 27% -> 80% · 2026 55%" line went 2026-11-02 (mak).
  return (
    `<div class="sct-co-panel">` +
    h3("How he manages a backfield") +
    `<p class="sct-co-panel-sub">${e(c.backfield.sub)}</p>` +
    `<div class="sct-co-cols" role="img" aria-label="${e(`Lead back share by season: ${caption}`)}">` +
    bars
      .map(
        (bar) =>
          `<div class="sct-co-col${bar.current ? " is-current" : ""}">` +
          `<span class="sct-co-colval">${e(`${bar.value}%`)}</span>` +
          // 0.72: the track also holds the value and season labels, so a 100%
          // bar must leave them ~34px. Linear, so the bars stay proportional.
          `<span class="sct-co-colbar" style="height:${Math.round(bar.value * 0.72)}%"></span>` +
          `<span class="sct-co-collabel">${e(bar.label)}</span>` +
          // The "Current" pill under the live bar went 2026-11-03 (mak); the
          // is-current tint on the column still marks it.
          `</div>`,
      )
      .join("") +
    `</div>` +
    takeaway(line, /^Starred seasons/.test(note) ? "Starred seasons were a previous staff's: context, not his record." : "Weighted opportunities = carries + 2×targets.") +
    `</div>`
  );
}

function personnel(c: TeamCoaching): string {
  if (!c.personnel) return "";
  return (
    `<div class="sct-co-panel">` +
    h3("Personnel groupings - usage & result") +
    `<p class="sct-co-panel-sub">${e(c.personnel.sub)}</p>` +
    c.personnel.rows
      .map((row) =>
        barRow(
          row,
          `${row.label}: ${row.share}% of snaps, ${row.result}`,
          `${row.share}% · ${row.result}`,
        ),
      )
      .join("") +
    `<p class="sct-co-note">${e(c.personnel.note)}</p>` +
    `</div>`
  );
}

function scoreState(c: TeamCoaching): string {
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
  // Solo when the entry has no personnel panel: spans both grid columns.
  return (
    `<div class="sct-co-panel${c.personnel ? "" : " is-solo"}">` +
    h3("Play-calling by score state") +
    `<p class="sct-co-panel-sub">${e(c.scoreState.sub)}</p>` +
    rows
      .map((row, i) => {
        const m = (row.result ?? "").match(/^(\S+ pass) · (\d+ plays)$/);
        const d = base != null ? (row.share ?? 0) - base : 0;
        // Each row is read against leading by 7+; only a real gap gets gold.
        const flag = i > 0 && Math.abs(d) >= 3;
        const diff =
          i === 0
            ? `<span class="sct-co-diff">Baseline</span>`
            : `<span class="sct-co-diff${flag ? " is-lean" : ""}">${e(`${signedPts(d)} pts`)}</span>`;
        return barRow(
          { ...row, gold: flag },
          `${row.label}: ${row.result}`,
          m ? m[1] : (row.result ?? `${row.share}%`),
          diff + (m ? `<span class="sct-co-plays">${e(m[2])}</span>` : ""),
        );
      })
      .join("") +
    (verdict ? takeaway(verdict, small ? "Early-season samples remain small." : "Play counts show each bucket's sample.") : "") +
    `</div>`
  );
}

/**
 * The StatChasers bottom line as a recognizable component: last season's
 * carryover, this season's signals, the caller's historical leans and the
 * sample, each one line. Every item is read off the module above; the
 * builder's full paragraph stays one click down.
 */
function bottomLine(c: TeamCoaching, view: UsageView | null): string {
  const season = seasonOf(c);
  const rating = reliabilityRating(c);
  const carry = { HIGH: "Strong", MEDIUM: "Partial", LOW: "Limited" }[rating];
  const signals = c.shifts
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
  const games = c.reliability.ledgerStats?.games;
  const item = (k: string, v: string) => `<li><span class="sct-co-bl-k">${e(k)}</span><span class="sct-co-bl-v">${e(v)}</span></li>`;
  return (
    `<div class="sct-co-bottom">` +
    `<p class="sct-co-bl-title"><span class="sct-co-bl-mark">SC</span> Fantasy bottom line</p>` +
    `<ul class="sct-co-bl">` +
    item(`${season - 1} carryover`, carry) +
    (signals.length ? item(`${season} signals`, signals.join(" · ")) : "") +
    item("Historical leans", leans.length ? leans.join(" · ") : "Target split near league") +
    (games ? item("Sample", `${games} game${games === 1 ? "" : "s"} · current personnel usage still matters most`) : "") +
    `</ul>` +
    `<details class="sct-co-more"><summary class="sct-co-more-q">Full summary</summary>` +
    `<p class="sct-co-more-a">${e(c.bottomLine)}</p></details>` +
    `</div>`
  );
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

export function renderCoachingSection(
  coaching: TeamCoaching | null,
  team: NflTeam,
  view: UsageView | null,
): CoachingSection {
  if (!coaching) return { html: "", faqHtml: "", faq: [] };
  const html =
    `<div class="sct-block sct-co">` +
    header() +
    intro(coaching, team) +
    `<div class="sct-co-grid">` +
    coachCard(coaching, team) +
    tendencies(coaching, team, view) +
    `</div>` +
    // The Staff profile strip is unmounted (mak, 2026-11-02: "remove");
    // staff() stays for the helpers that read its copy.
    // The four panels sit above the Career dossier (mak, 2026-11-02); the
    // finishes table is unmounted (same day), its pills live in the
    // fingerprint table.
    `<div class="sct-co-panels">` +
    distribution(coaching) +
    backfield(coaching, view) +
    `</div>` +
    `<div class="sct-co-panels">` +
    personnel(coaching) +
    scoreState(coaching) +
    `</div>` +
    dossier(coaching) +
    rookieNote(coaching) +
    bottomLine(coaching, view) +
    `</div>`;

  // mak's question list (2026-11-03) replaces the builder's single question:
  // written by rule from the same data as the tab, in the page's FAQPage too
  // (the coaching FAQ has been in the schema since the spec). The stored
  // `coaching.faq` stays in the data but is no longer rendered.
  const items = coachingFaq(coaching, team, view, getCoachingStaff(team.abbreviation, seasonOf(coaching)));
  const faqHtml = renderFaqBlock("Common questions", items, "sct-co-faq");
  return { html, faqHtml, faq: faqEntries(items) };
}
