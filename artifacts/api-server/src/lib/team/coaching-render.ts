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

import { escapeHtml } from "../render";
import type { NflTeam } from "./teams";
import {
  RELIABILITY_PCT,
  reliabilityRating,
  type BarRow,
  type Reliability,
  type TeamCoaching,
  type TendencyRow,
} from "./coaching";
import type { UsageView } from "./usage";
import { signed } from "./usage-copy";

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
function timelineStep(step: { role: string; years: string }): string {
  const year = parseInt(step.years, 10);
  const hits = STEP_CLUBS.map(([re, code]) => ({ at: step.role.search(re), re, code: code(year) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  let role = step.role.replace(/\s*\([^)]*\)/g, "").trim();
  if (hits.length === 1) role = role.replace(new RegExp(`^${hits[0].re.source}\\s+`), "");
  role = role.replace(/^HC\b/, "Head coach");
  role = role[0].toUpperCase() + role.slice(1);
  const codes = [...new Set(hits.map((h) => h.code))].join(" / ");
  return (
    `<li class="sct-co-step"${role !== step.role ? ` title="${e(step.role)}"` : ""}>` +
    `<span class="sct-co-step-years">${e(step.years)}</span>` +
    `<span class="sct-co-step-body">` +
    (codes ? `<span class="sct-co-step-team">${e(codes)}</span>` : "") +
    `<span class="sct-co-step-role">${e(role)}</span></span></li>`
  );
}

function ledgerChips(c: TeamCoaching, team: NflTeam): string {
  const stats = c.reliability.ledgerStats;
  if (!stats) {
    return (
      `<p class="sct-co-ledger"><span class="sct-co-label">Play-caller ledger</span>` +
      `<span class="sct-co-ledger-val">${e(c.reliability.ledger)}</span></p>`
    );
  }
  const chip = (value: string, label: string) =>
    `<li class="sct-co-chip"><span class="sct-co-chip-val">${e(value)}</span>` +
    `<span class="sct-co-chip-label">${e(label)}</span></li>`;
  const chips = [
    chip(`${stats.called} / ${stats.games}`, `${seasonOf(c)} games`),
    stats.priorSeasons > 0
      ? chip(`${stats.priorSeasons}${/\bpartial\b/.test(stats.note ?? "") ? "+" : ""}`, stats.priorSeasons === 1 ? "Prior season" : "Prior seasons")
      : chip("1st", `Season calling for the ${team.nickname}`),
    stats.priorSeasons > 0 ? chip(String(stats.firstSeason), `First ${team.nickname} calls`) : "",
  ].join("");
  return (
    `<div class="sct-co-ledger"><p class="sct-co-label">Play-caller ledger</p>` +
    `<ul class="sct-co-chips">${chips}</ul>` +
    (stats.note ? `<p class="sct-co-ledger-note">${e(stats.note)}</p>` : "") +
    `</div>`
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
    ledgerChips(c, team) +
    `</div>`
  );
}

/**
 * The caller note's first sentence - "he remains the caller" - stays on the
 * card; the sourcing and history behind it fold under "More". The stored
 * note is verified copy, so it is split at a sentence break, never edited.
 */
function cardSub(note: string): string {
  const at = note.search(/(?<=[a-z0-9)%'"])\.\s+(?=[A-Z])/);
  if (at < 0) return `<p class="sct-co-card-sub">${e(note)}</p>`;
  return (
    `<p class="sct-co-card-sub">${e(note.slice(0, at + 1))}</p>` +
    `<details class="sct-co-more"><summary class="sct-co-more-q">More</summary>` +
    `<p class="sct-co-more-a">${e(note.slice(at + 1).trim())}</p></details>`
  );
}

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
    `<p class="sct-co-kicker">${e(title)}</p>` +
    `<h3 class="sct-co-name">${e(c.playCaller.name)}</h3>` +
    `<p class="sct-co-roleline">${e([...tenure, "Primary play-caller"].join(" · "))}</p>` +
    (tree
      ? `<div class="sct-co-scheme"><p class="sct-co-tree">${e(tree.tag)}</p>` +
        (tree.note ? `<p class="sct-co-scheme-note">${e(tree.note)}</p>` : "") +
        `</div>`
      : `<div class="sct-co-scheme"><p class="sct-co-tree">No established tree</p></div>`) +
    cardSub(c.playCaller.subline) +
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

/** The table's compact badge, "#2 NFL", with the long form as its title. */
function rankBadge(row: TendencyRow, rank: number | null): string {
  if (!atEdge(rank)) return "";
  return `<span class="sct-co-badge" title="${e(rankText(row, rank))}">#${rank} NFL</span>`;
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
    `<div class="sct-co-identity"><p class="sct-co-label">${season} offensive identity</p>` +
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

function tendencies(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const newCaller = reliabilityRating(c) === "LOW" || c.reliability.priorSeasonsAsCaller === 0;
  const views = c.tendencies.rows.map((row) => ({ row, v: rowView(row, view) }));

  // The one move worth flagging when no league rank already flags it.
  const biggest = views
    .filter(({ row, v }) => v.delta != null && row.key !== "pace")
    .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))[0];
  const flagBiggest =
    biggest && Math.abs(biggest.v.delta as number) >= 5 && !rankBadge(biggest.row, biggest.v.rank);

  // The gold row accent is for the outliers only: at most two rows, the most
  // extreme league standings first, the biggest move filling a spare slot.
  const edge = (r: number) => Math.min(r, 33 - r);
  const flagged = new Set(
    views
      .filter(({ v }) => atEdge(v.rank))
      .sort((a, b) => edge(a.v.rank as number) - edge(b.v.rank as number))
      .slice(0, 2)
      .map(({ row }) => row),
  );
  if (flagBiggest && flagged.size < 2) flagged.add(biggest.row);

  const rows = views
    .map(({ row, v }, i) => {
      const badge = rankBadge(row, v.rank) || (flagBiggest && row === biggest.row ? `<span class="sct-co-badge">Biggest YoY move</span>` : "");
      return (
        `<tr${flagged.has(row) ? ` class="is-flagged"` : ""}>` +
        `<th scope="row" class="sct-co-td is-tendency">${rowLabel(row, `sct-co-def-${i}`)}` +
        (row.sub ? `<span class="sct-co-cell-sub">${e(row.sub)}</span>` : "") +
        `</th>` +
        `<td class="sct-co-td is-prior">${e(row.prior)}</td>` +
        `<td class="sct-co-td is-now">${e(v.current)}</td>` +
        `<td class="sct-co-td is-change"><span class="sct-co-change is-${v.change.dir}">${e(v.change.text)}</span>${badge}</td>` +
        `<td class="sct-co-td is-avg">${e(row.nflAvg)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<div class="sct-co-tend">` +
    `<div class="sct-co-tend-head"><h3 class="sct-co-tend-title">Offensive tendencies</h3>` +
    `<p class="sct-co-tend-sub">${e(
      newCaller
        ? `How ${possessive} ${season} offense compares with the ${season - 1} staff's`
        : `How ${placeOf(team)} ${season} offense is changing under ${c.playCaller.name}`,
    )}</p></div>` +
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
    `</table></div></div>`
  );
}

/* --------------------------------------------------------- offensive signals */

const SIGNAL_LABELS: Record<string, string> = {
  passRate: "Pass rate",
  proe: "Pass rate vs expected",
  pace: "Neutral pace",
  earlyDownPassRate: "Early-down passing",
  noHuddleRate: "No-huddle rate",
  paRate: "Play-action rate",
  motionRate: "Pre-snap motion",
  shotgunRate: "Shotgun rate",
  rzPassRate: "Red-zone passing",
  fourthGoRate: "4th-down go rate",
};

/**
 * The three biggest moves, the section's hero cards: the metric, its
 * standing as a pill (the league rank when it sits at an edge, else the
 * year-over-year move), the bold takeaway, the "54% -> 80% YoY" line, one
 * short implication, and the sample as a quiet footer. Value and standing
 * read the same live row as the table.
 */
function signals(c: TeamCoaching, view: UsageView | null): string {
  const cards = c.shifts.map((s) => {
    const row = s.key ? c.tendencies.rows.find((r) => r.key === s.key) : undefined;
    const v = row ? rowView(row, view) : null;
    const value = v?.current ?? `${s.stat}${s.unit.includes("%") ? "%" : ""}`;
    const pills: Array<{ text: string; title?: string; neutral?: boolean }> = [];
    let fromTo = "";
    if (row && v) {
      if (row.key === "proe" && v.change.dir !== "flat") pills.push({ text: v.current.startsWith("−") ? "Run-leaning" : "Pass-leaning", neutral: true });
      pills.push(
        atEdge(v.rank)
          ? { text: `#${v.rank} NFL`, title: rankText(row, v.rank) }
          : { text: v.change.dir === "flat" ? "Steady YoY" : `${v.change.text} YoY` },
      );
      if (row.prior && row.prior !== "-" && v.current !== "-") fromTo = `${row.prior} → ${v.current} YoY`;
    }
    return (
      `<li class="sct-co-shift">` +
      `<p class="sct-co-sig-label">${e((s.key && SIGNAL_LABELS[s.key]) || s.unit)}</p>` +
      `<div class="sct-co-sig-top"><p class="sct-co-sig-value">${e(value)}</p>` +
      pills.map((p) => `<span class="sct-co-sig-pill${p.neutral ? " is-neutral" : ""}"${p.title ? ` title="${e(p.title)}"` : ""}>${e(p.text)}</span>`).join("") +
      `</div>` +
      `<h4 class="sct-co-sig-head">${e(s.heading)}</h4>` +
      (fromTo ? `<p class="sct-co-sig-line">${e(fromTo)}</p>` : "") +
      `<p class="sct-co-sig-body">${e(s.body)}</p>` +
      (s.note ? `<p class="sct-co-sig-note">${e(s.note)}</p>` : "") +
      `</li>`
    );
  });
  return (
    `<div class="sct-co-block">` +
    `<p class="sct-co-eyebrow">Offensive signals</p>` +
    `<ul class="sct-co-shifts">${cards.join("")}</ul></div>`
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

function staff(c: TeamCoaching): string {
  const { oc, dc, continuity } = c.staff;
  // "Delegation watch" is for a coordinator who is NOT calling plays but has
  // before; the caller himself is profiled in the card above.
  const watch = !oc.isCaller && oc.hasCalledPlays;
  const ocLead = oc.isCaller ? "Primary play-caller" : oc.hasCalledPlays ? "Has called plays before" : "Not the play-caller";
  const dcNote = leadClause(dc.sub);
  const def = defenseRead(dc.body);
  // The builder's own tiers: top ten / bottom ten, the rest middle.
  const defLine = def
    ? (def.rank == null ? "" : def.rank <= 10 ? "Early results are strong" : def.rank >= 23 ? "Early results are weak" : "Middle of the pack so far") +
      (def.week <= 6 ? `${def.rank == null ? "The" : ", but the"} ${def.week}-week sample is still small.` : ".")
    : "";
  const dcMore = [def ? def.rest : "", dcNote.rest].filter(Boolean).join(" ");
  const contNote = leadClause(continuity.sub).lead;
  const rating = reliabilityRating(c);
  const tone: Record<Reliability, string> = { HIGH: "high", MEDIUM: "medium", LOW: "low" };
  const contLead =
    c.reliability.priorSeasonsAsCaller === 0 ? "New offensive caller" : "Same offensive caller";
  return (
    `<div class="sct-co-block">` +
    `<p class="sct-co-eyebrow">Staff profile</p>` +
    `<div class="sct-co-staff">` +
    `<article class="sct-co-staffcard is-oc${watch ? " is-watch" : ""}">` +
    `<p class="sct-co-role">Offensive coordinator${watch ? `<span class="sct-co-watch">Delegation watch</span>` : ""}</p>` +
    `<h4 class="sct-co-h4">${e(oc.name)}</h4>` +
    `<p class="sct-co-staff-sub${oc.isCaller ? " is-accent" : ""}">${e(ocLead)}</p>` +
    `<p class="sct-co-body">${e(oc.body)}</p>` +
    (oc.isCaller ? "" : moreNotes("Background", oc.sub)) +
    `</article>` +
    `<article class="sct-co-staffcard is-dc">` +
    `<p class="sct-co-role">Defensive coordinator</p>` +
    `<h4 class="sct-co-h4">${e(dc.name)}</h4>` +
    `<p class="sct-co-staff-sub is-tag">${e(dcNote.lead)}</p>` +
    (def
      ? `<p class="sct-co-defmetric"><span class="sct-co-defval">${e(def.epa)}</span> <span class="sct-co-defunit">EPA/play allowed</span>` +
        (def.rank != null ? `<span class="sct-co-sig-pill">#${def.rank} NFL</span>` : "") +
        `</p>` +
        (defLine ? `<p class="sct-co-body">${e(defLine)}</p>` : "")
      : `<p class="sct-co-body">${e(dc.body)}</p>`) +
    moreNotes("More", dcMore) +
    `</article>` +
    `<article class="sct-co-staffcard is-kpi">` +
    `<p class="sct-co-role">Continuity</p>` +
    `<h4 class="sct-co-h4">${e(continuity.stat)}</h4>` +
    `<p class="sct-co-kpi-rating"><span class="sct-co-rating is-${tone[rating]}">${rating}</span> ${e(contLead)}</p>` +
    `<p class="sct-co-body">${e(`${contNote}.`)}</p>` +
    `</article>` +
    `</div></div>`
  );
}

/* ----------------------------------------------------------------- dossier */

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

/** "23.7 ppg" + "best finish 10th in NFL" -> "23.7 PPG", "#10 NFL". */
function scoreParts(row: DossierRow, multi: boolean): { ppg: string; rank: string } {
  const ppg = row.scoring.replace(/ ppg$/, " PPG");
  const ctx = row.scoringContext;
  let m = ctx.match(/^best finish (\d+)(?:st|nd|rd|th) in NFL$/);
  if (m) return { ppg, rank: `${multi ? "Best " : ""}#${m[1]} NFL` };
  m = ctx.match(/^(\d+)(?:st|nd|rd|th) in NFL over Wks/);
  if (m) return { ppg, rank: `#${m[1]} NFL in window` };
  m = ctx.match(/^(?:(\d{4}) )?through Week (\d+)(?:, (\d+)(?:st|nd|rd|th) in NFL)?$/);
  if (m) return { ppg, rank: `${m[3] ? `#${m[3]} NFL · ` : ""}${m[1] ? `${m[1]} ` : ""}thru Wk ${m[2]}` };
  return { ppg, rank: ctx };
}

/** "↓ 3 pts vs league": the gap the stop is distinctive for. */
function vsLeague(share: number, league: number): string {
  const gap = Math.round((share - league) * 10) / 10;
  if (gap === 0) return "at league";
  return `${gap > 0 ? "↑" : "↓"} ${Math.abs(gap)} pts vs league`;
}

/** The same season's fantasy finishes, as pills: tendency, then outcome. */
function outcomeLine(c: TeamCoaching, fpYear: string): string {
  const row = finishFor(c, fpYear);
  const pills = row?.cells
    .map((cell) => readFinish(cell.text))
    .filter((f): f is NonNullable<ReturnType<typeof readFinish>> => f !== null)
    .map((f) => finishPill(f.pos, f.rank, row.current));
  if (!pills?.length) return "";
  return (
    `<li class="sct-co-fp-row is-outcome"><span class="sct-co-fp-g">Finishes</span>` +
    `<span class="sct-co-fp-pills">${pills.join("")}</span></li>`
  );
}

/**
 * A stop's fingerprint as two labelled groups - target share, then backfield
 * - since a WR share and a lead back's weighted opportunities are different
 * measures. A stop before target tracking says so in a few muted words; the
 * section note above explains why.
 */
function fingerprintBlock(row: DossierRow, c: TeamCoaching): string {
  const fp = readFingerprint(row.fingerprint);
  if (fp === "pre") return `<p class="sct-co-fp-none">No target data</p>`;
  if (!fp) return `<p class="sct-co-fp-text">${e(row.fingerprint)}</p>`;
  const line = (group: string, k: string, v: string, ctx: string) =>
    `<li class="sct-co-fp-row"><span class="sct-co-fp-g">${e(group)}</span><span class="sct-co-fp-k">${e(k)}</span>` +
    `<span class="sct-co-fp-v">${e(v)}</span><span class="sct-co-fp-ctx">${e(ctx)}</span></li>`;
  return (
    `<p class="sct-co-fp-label">${e(`Fingerprint · ${fp.year}`)}</p>` +
    `<ul class="sct-co-fp">` +
    (fp.lean ? line("Target share", fp.lean.pos, `${fp.lean.share}%`, vsLeague(fp.lean.share, fp.lean.league)) : "") +
    (fp.typical ? line("Target share", "Split", "Typical", "WR/TE/RB near league") : "") +
    (fp.leadBack != null ? line("Backfield", "Lead back", `${fp.leadBack}%`, "weighted opps") : "") +
    outcomeLine(c, fp.year) +
    `</ul>`
  );
}

/**
 * The career's story before the rows: scoring peak, the most concentrated
 * backfield, the recurring target lean, and where the current stop sits.
 * Every tile is read off the rows below - nothing here is new data.
 */
function careerIdentity(c: TeamCoaching): string {
  const rows = c.dossier;
  if (rows.length < 2) return "";
  // One headline metric and one context line per tile.
  const tile = (label: string, value: string, sub: string) =>
    `<li class="sct-co-idtile"><p class="sct-co-label">${e(label)}</p>` +
    `<p class="sct-co-idtile-v">${e(value)}</p><p class="sct-co-idtile-sub">${e(sub)}</p></li>`;
  const where = (r: DossierRow) => {
    const p = stopParts(r);
    return `${p.years} ${p.code}`;
  };
  const tiles: string[] = [];
  const past = rows.filter((r) => !r.current && parseFloat(r.scoring) > 0);
  if (past.length) {
    const peak = past.reduce((a, b) => (parseFloat(b.scoring) > parseFloat(a.scoring) ? b : a));
    const rank = scoreParts(peak, false).rank;
    tiles.push(tile("Scoring peak", peak.scoring.replace(/ ppg$/, " PPG"), /^#\d+ NFL$/.test(rank) ? `${rank} · ${where(peak)}` : where(peak)));
  }
  const prints = rows
    .map((r) => ({ r, fp: readFingerprint(r.fingerprint) }))
    .filter((x): x is { r: DossierRow; fp: Fingerprint } => x.fp !== null && x.fp !== "pre");
  const withLb = prints.filter((x) => x.fp.leadBack != null);
  if (withLb.length) {
    const top = withLb.reduce((a, b) => ((b.fp.leadBack as number) > (a.fp.leadBack as number) ? b : a));
    tiles.push(tile("Peak backfield concentration", `${top.fp.leadBack}%`, `Lead-back share · ${where(top.r)}`));
  }
  const leans = new Map<string, number>();
  for (const { fp } of prints) {
    if (!fp.lean) continue;
    const k = `${fp.lean.pos} ${fp.lean.share < fp.lean.league ? "below" : "above"} league`;
    leans.set(k, (leans.get(k) ?? 0) + 1);
  }
  const lean = [...leans].sort((a, b) => b[1] - a[1])[0];
  if (lean && prints.length >= 2) {
    const [pos, side] = lean[0].split(" ");
    tiles.push(tile(`${pos} target share`, `${lean[1]} / ${prints.length}`, `tracked stops ${side} league`));
  }
  const cur = rows.find((r) => r.current);
  if (cur) {
    const fp = readFingerprint(cur.fingerprint);
    const bits =
      fp && fp !== "pre"
        ? [
            fp.lean ? `${fp.lean.pos} ${fp.lean.share}% vs ${fp.lean.league}%` : fp.typical ? "typical target split" : "",
            fp.leadBack != null ? `lead back ${fp.leadBack}%` : "",
          ].filter(Boolean)
        : [];
    tiles.push(tile(`Current ${seasonOf(c)}`, cur.scoring.replace(/ ppg$/, " PPG"), bits.join(" · ") || scoreParts(cur, false).rank));
  }
  return `<ul class="sct-co-idtiles">${tiles.join("")}</ul>`;
}

function dossier(c: TeamCoaching): string {
  const last = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const anyPre = c.dossier.some((r) => readFingerprint(r.fingerprint) === "pre");
  const items = c.dossier
    .map((row) => {
      const p = stopParts(row);
      const s = scoreParts(row, /\d{4}-\d{2}/.test(p.years));
      return (
        `<li class="sct-co-dstop${row.current ? " is-current" : ""}">` +
        `<div class="sct-co-dhead">` +
        `<p class="sct-co-dyears">${e(p.years)}${row.current ? `<span class="sct-co-dcur">Current</span>` : ""}</p>` +
        `<p class="sct-co-drole">${e(`${p.code} · ${p.role}`)}</p>` +
        (p.window ? `<p class="sct-co-dwin">${e(p.window)}</p>` : "") +
        `</div>` +
        `<div class="sct-co-dscore"><p class="sct-co-dppg">${e(s.ppg)}</p><p class="sct-co-drank">${e(s.rank)}</p></div>` +
        `<div class="sct-co-dprint">${fingerprintBlock(row, c)}</div>` +
        `</li>`
      );
    })
    .join("");
  return (
    `<div class="sct-co-block">` +
    `<p class="sct-co-eyebrow">Career dossier</p>` +
    `<p class="sct-co-dsub">${e(`How ${possessive} offenses have changed across stops`)}</p>` +
    (anyPre
      ? `<p class="sct-co-dnote">${e("Target fingerprints available from 2016 onward. Earlier stops show scoring output only.")}</p>`
      : "") +
    careerIdentity(c) +
    `<ol class="sct-co-dossier">${items}</ol>` +
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

function finishPill(pos: string, rank: number, provisional = false): string {
  const [, key, label] = finishTier(rank);
  return (
    `<span class="sct-co-fpill is-${provisional ? "provisional" : key}"` +
    ` title="${e(provisional ? "In-season pace, not a final finish" : `${label} ${pos} finish`)}">${e(`${pos}${rank}`)}</span>`
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
  const rows = c.finishes.rows.filter((r) => finishStop(r).year === year);
  if (rows.length <= 1) return rows[0];
  return win ? rows.find((r) => r.context.includes(win)) : undefined;
}

/** Best completed finish per position, read off the table's settled rows. */
function bestFinishes(c: TeamCoaching): string {
  const best = new Map<string, { rank: number; player: string; year: string }>();
  for (const row of c.finishes.rows) {
    if (row.current) continue;
    for (const cell of row.cells) {
      const f = readFinish(cell.text);
      if (!f) continue;
      const have = best.get(f.pos);
      if (!have || f.rank < have.rank) best.set(f.pos, { rank: f.rank, player: f.player, year: finishStop(row).year });
    }
  }
  if (best.size === 0) return "";
  const order = ["QB", "RB", "WR", "TE"].filter((p) => best.has(p));
  return (
    `<div class="sct-co-fbest"><p class="sct-co-label">Best finishes</p><ul class="sct-co-fbest-list">` +
    order
      .map((pos) => {
        const b = best.get(pos) as { rank: number; player: string; year: string };
        return `<li>${finishPill(pos, b.rank)}<span class="sct-co-fbest-who">${e(`${b.player} · ${b.year}`)}</span></li>`;
      })
      .join("") +
    `</ul></div>`
  );
}

/**
 * Fantasy finishes by coaching stop: the rank leads as a tiered pill, the
 * player sits under it, and the in-season row is marked provisional so a
 * three-week QB34 never reads like a season-end one. The stored methodology
 * note sits one click down.
 */
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
              ? `<td class="sct-co-td">${finishPill(f.pos, f.rank, row.current)}<span class="sct-co-fwho">${e(f.player)}</span></td>`
              : `<td class="sct-co-td">${e(cell.text)}</td>`;
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
    bestFinishes(c) +
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`Positional fantasy finishes under the ${team.nickname} play-caller`)}">` +
    `<table class="sct-co-finishes">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Stop</th>` +
    `<th scope="col" class="sct-co-th">QB</th>` +
    `<th scope="col" class="sct-co-th">RB1</th>` +
    `<th scope="col" class="sct-co-th">WR1</th>` +
    `<th scope="col" class="sct-co-th">TE1</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="sct-co-fnote">${e(`PPR positional finishes from nflverse. Partial-season rows rank only the games ${last} called. Historical outcomes, not projections.`)}</p>` +
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
 * One labelled bar: fill = the share, an optional thin marker = the league
 * average. The number always rides beside the bar - never colour-only.
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
  const name = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  const lean = distLean(c);
  const many = /^Across his/.test(c.distribution.note);
  return (
    `<div class="sct-co-panel">` +
    h3("How he distributes the ball") +
    `<p class="sct-co-panel-sub">${e(c.distribution.sub)}</p>` +
    `<p class="sct-co-key">${e(`Filled bar = ${name} offenses · thin marker = league average`)}</p>` +
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
  const own = bars.filter((b) => !b.label.endsWith("*"));
  const cur = bars.find((b) => b.current);
  const range =
    own.length >= 2
      ? `<p class="sct-co-range"><span class="sct-co-label">Tracked range</span>` +
        `<span class="sct-co-range-v">${e(`${Math.min(...own.map((b) => b.value))}% → ${Math.max(...own.map((b) => b.value))}%`)}</span>` +
        (cur ? `<span class="sct-co-label">${e(`${seasonOf(c)}`)}</span><span class="sct-co-range-v">${e(`${cur.value}%`)}</span>` : "") +
        `</p>`
      : "";
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
          (bar.current ? `<span class="sct-co-colnow">Current</span>` : "") +
          `</div>`,
      )
      .join("") +
    `</div>` +
    range +
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
 * The StatChasers bottom line as a recognisable component: last season's
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
    signals(coaching, view) +
    staff(coaching) +
    dossier(coaching) +
    finishes(coaching, team) +
    rookieNote(coaching) +
    `<div class="sct-co-panels">` +
    distribution(coaching) +
    backfield(coaching, view) +
    `</div>` +
    `<div class="sct-co-panels">` +
    personnel(coaching) +
    scoreState(coaching) +
    `</div>` +
    bottomLine(coaching, view) +
    `</div>`;

  // Same contract as the usage FAQ: the link sits outside .sct-faq-a so the
  // schema's answer and the visible answer are the same text.
  const faq = coaching.faq;
  const faqHtml =
    `<div class="sct-block">` +
    `<h2 class="sct-h2">Common questions</h2>` +
    `<div class="sct-faq"><details class="sct-faq-item">` +
    `<summary class="sct-faq-q-row"><h3 class="sct-faq-q">${e(faq.question)}</h3></summary>` +
    `<p class="sct-faq-a">${e(faq.answer)}</p>` +
    `<p class="sct-faq-more"><a class="sct-textlink" href="#coaching">See the full coaching profile</a></p>` +
    `</details></div></div>`;
  return { html, faqHtml, faq: [faq] };
}
