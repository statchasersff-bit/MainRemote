/**
 * The upcoming matchup page's decision layer, drawn from preview.ts.
 *
 * Section order is the spec's (mak, 2026-10-03): hero with the betting strip,
 * The Call, Start/Sit, Matchup Leverage, Snapshot, Injury Watch, Head-to-Head,
 * the Redraft Command CTA, FAQ, footer. The page's older upcoming sections
 * render unchanged under all of this so the two can be compared.
 *
 * Every chip carries its word as text; tables are real tables; the script
 * meter's lean is also written out. Colors come from the team tokens on the
 * root (--pv-away / --pv-home), never from here.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import type { NflTeam } from "../team/teams";
import type { StatRow, TeamStats } from "../team/stats";
import { getPlayerProfileUrl } from "../team/links";
import {
  allowPhrase,
  rankWord,
  signedLine,
  type BoardRow,
  type LeverageRow,
  type Pos,
  type Preview,
  type PreviewSide,
  type SideKey,
  type Verdict,
} from "./preview";
import type { Meeting } from "./matchup-data";
import {
  DYNASTY_COMMAND_URL,
  LINEUP_OPTIMIZER_URL,
  ROS_RANKINGS_URL,
  START_SIT_URL,
  TRADE_CALCULATOR_URL,
  WAIVER_WIRE_URL,
} from "./recap";

export interface PreviewRenderContext {
  headingTag: "h1" | "h2";
  headingId: string;
  /** The page's existing H1 text, kept as is. */
  heading: string;
  date: string;
  time: string;
  network: string | null;
  /** Team fills, resolved by matchupColors() so near-identical navies split. */
  colors: { away: string; home: string };
  hub(team: NflTeam): string;
  usage(team: NflTeam): string;
  coaching(team: NflTeam): string;
  matchups(team: NflTeam): string | null;
  game(meeting: Meeting): string;
  fpaUrl: string | null;
  redraftUrl: string;
  breadcrumbRoot: string;
}

const e = escapeHtml;
const one = (n: number): string => n.toFixed(1);
const exact = (n: number): string => String(Math.round(n * 100) / 100);
const code = (t: NflTeam): string => t.code.toUpperCase();

function h2(id: string, text: string): string {
  return `<h2 class="sct-h2 sct-pv-h2" id="${e(id)}">${e(text)}</h2>`;
}

/**
 * A compact contextual CTA after a section: one line of why, one link to the
 * tool that fits the section's intent. Nothing when the tool has no address.
 */
function nextStep(id: string, title: string, body: string, href: string | null, label: string): string {
  if (!href) return "";
  return (
    `<aside class="sct-pv-next" aria-label="${e(title)}">` +
    `<p><b>${e(title)}</b>${body ? ` ${e(body)}` : ""}</p>` +
    `<a href="${e(href)}" data-cta="${e(id)}">${e(label)} →</a>` +
    `</aside>`
  );
}

/** The one-line subtitle under a section title. */
function subline(text: string): string {
  return `<p class="sct-pv-sub">${e(text)}</p>`;
}

function playerLink(name: string): string {
  const url = getPlayerProfileUrl(name);
  return url ? `<a href="${e(url)}">${e(name)}</a>` : e(name);
}

export function ml(n: number | null): string {
  if (n === null) return "-";
  return n > 0 ? `+${n}` : String(n);
}

/** "BUF -7" from a home-signed spread. */
export function favLine(spread: number, away: NflTeam, home: NflTeam): string {
  if (spread === 0) return "PK";
  return spread < 0 ? `${code(home)} ${signedLine(spread)}` : `${code(away)} ${signedLine(-spread)}`;
}

export function implyRank(rank: number | null, count: number, week: number): string {
  if (!rank || !count) return "";
  return rank <= Math.ceil(count / 2)
    ? `${rankWord(rank, "highest")} of Week ${week}`
    : `${rankWord(count - rank + 1, "lowest")} of Week ${week}`;
}

/* ---------------------------------------------------------------- 1. hero */

/** "60°F · Wind 10 mph", "Dome", or null. */
export function weatherText(p: Preview): string | null {
  const line = p.line;
  if (line?.indoor) return "Dome";
  const f = p.forecast;
  if (f && (f.tempF !== null || f.windMph !== null)) {
    return [f.tempF !== null ? `${f.tempF}°F` : null, f.windMph !== null ? `Wind ${f.windMph} mph` : null]
      .filter(Boolean)
      .join(" · ");
  }
  const w = line?.weather;
  if (w && (w.tempF !== null || w.condition)) {
    return [w.tempF !== null ? `${w.tempF}°F` : null, w.condition].filter(Boolean).join(" · ");
  }
  return null;
}

const pairOf = (p: Preview): string => `${p.away.team.nickname} vs ${p.home.team.nickname}`;

/* -------------------------------------------- 1b. fantasy outlook */

/** "NE -3.5 · O/U 42.5" with the implied totals, or the conditions without a line. */
function environment(p: Preview): { value: string; note: string | null } {
  const { line, away, home } = p;
  const weather = weatherText(p);
  if (line && line.spread !== null && line.total !== null) {
    return {
      value: `${favLine(line.spread, away.team, home.team)} · O/U ${exact(line.total)}`,
      note:
        [
          away.implied !== null && home.implied !== null
            ? `Implied: ${code(away.team)} ${exact(away.implied)}, ${code(home.team)} ${exact(home.implied)}`
            : null,
          weather,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    };
  }
  return { value: weather ?? "Conditions TBD", note: "No betting line posted yet" };
}

// The "Fantasy Outlook" section (best start / flex / fade, game environment,
// the matchup read) that opened the body from 2026-10-05 was removed at mak's
// request on 2026-10-22; its picks still feed the FAQ through outlookPicks().

/* ----------------------------------------------------- 6b. players to watch */

interface WatchItem {
  name: string;
  team: string;
  pos: string;
  tag: string;
  why: string;
}

/** The next action a watch card points at, by why the player is on the list. */
function watchAction(tag: string): { href: string | null; label: string } {
  if (tag === "Injury beneficiary") return { href: WAIVER_WIRE_URL, label: "Check waivers" };
  if (tag === "Tough matchup") return { href: TRADE_CALCULATOR_URL, label: "Weigh a trade" };
  return { href: START_SIT_URL, label: "Compare in Start/Sit" };
}

/**
 * Three to five players where usage or injury context makes the matchup worth
 * a second look, picked from what the page already says: the injury
 * beneficiary, the leverage edge, the role/matchup conflict, the questionable
 * starter, then the toughest matchup.
 */
function watchList(p: Preview): WatchItem[] {
  const rows = [...p.board.away, ...p.board.home];
  const rowOf = (name: string) => rows.find((r) => r.name === name) ?? null;
  const teamOf = (r: LeverageRow) => code((r.side === "away" ? p.away : p.home).team);
  const role = (r: LeverageRow) => r.roleStats.map((x) => `${x.v} ${x.k}`).join(", ");
  const items: WatchItem[] = [];
  const add = (x: WatchItem) => {
    if (!items.some((i) => i.name === x.name)) items.push(x);
  };
  const b = p.injuryImpact?.beneficiary;
  if (b) {
    const metric = rowOf(b.name)?.metric;
    add({ name: b.name, team: b.team, pos: b.pos, tag: "Injury beneficiary", why: `Steps into the work with ${b.because}${metric ? `, from a ${metric}` : ""}.` });
  }
  const read = p.leverageRead;
  if (read?.edge) {
    const r = read.edge;
    add({ name: r.name, team: teamOf(r), pos: r.pos, tag: "Matchup edge", why: `${r.defense}, and he brings ${role(r)}.` });
  }
  if (read?.conflict) {
    const r = read.conflict.row;
    add({ name: r.name, team: teamOf(r), pos: r.pos, tag: read.conflict.text, why: `${r.defense}, against ${role(r)}.` });
  }
  const q = rows
    .filter((r) => r.injury?.status === "Questionable" && r.ppg !== null)
    .sort((x, y) => (y.ppg ?? 0) - (x.ppg ?? 0))[0];
  if (q) {
    add({
      name: q.name,
      team: q.team,
      pos: q.pos,
      tag: "Questionable",
      why: `Listed Questionable${q.injury?.part ? ` (${q.injury.part.toLowerCase()})` : ""}; ${one(q.ppg!)} PPG${q.metric ? ` on a ${q.metric}` : ""} if he plays. Inactives post 90 minutes before kickoff.`,
    });
  }
  if (read?.fade) {
    const r = read.fade;
    add({ name: r.name, team: teamOf(r), pos: r.pos, tag: "Tough matchup", why: `${r.defense}.` });
  }
  return items.slice(0, 5);
}

function renderWatchList(p: Preview): string {
  const items = watchList(p);
  if (items.length < 3) return "";
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-watch">` +
    h2("pv-watch", "Players to Watch") +
    `<ul class="sct-pv-watch">` +
    items
      .map(
        (i) =>
          `<li><p class="sct-pv-watch-top">${whoTag(i.name, i.team, i.pos)}<span class="sct-pv-watch-tag">${e(i.tag)}</span></p>` +
          `<p class="sct-pv-watch-why">${e(i.why)}</p>` +
          (() => {
            const a = watchAction(i.tag);
            return a.href ? `<a class="sct-pv-watch-act" href="${e(a.href)}" data-cta="preview-watch">${e(a.label)} →</a>` : "";
          })() +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    rosterMoves() +
    `</section>`
  );
}

/** "Turn the matchup into a roster move": three compact links, no cards. */
function rosterMoves(): string {
  const links = [
    [WAIVER_WIRE_URL, "Waiver Wire"],
    [TRADE_CALCULATOR_URL, "Trade Calculator"],
    [LINEUP_OPTIMIZER_URL, "Lineup Optimizer"],
  ].filter((x): x is [string, string] => !!x[0]);
  // The line names all three tools, so it waits until all three have addresses.
  if (links.length < 3) return "";
  return (
    `<aside class="sct-pv-next is-links" aria-label="Roster moves">` +
    `<p><b>Turn the matchup into a roster move.</b> Check waivers, compare a trade, or optimize your lineup in Redraft Command.</p>` +
    `<ul>${links.map(([href, label]) => `<li><a href="${e(href)}" data-cta="preview-moves">${e(label)}</a></li>`).join("")}</ul>` +
    `</aside>`
  );
}

/** The one Dynasty Command bridge, near the bottom. */
function renderDynasty(p: Preview): string {
  if (!DYNASTY_COMMAND_URL) return "";
  return nextStep(
    "preview-dynasty",
    `Thinking beyond ${p.meeting.weekLabel}?`,
    "See how these players are valued long term in Dynasty Command, including dynasty rankings, trade values and roster analysis.",
    DYNASTY_COMMAND_URL,
    "Open Dynasty Command",
  );
}

/* ------------------------------------------------------------- 2. the call */

/* --------------------------------------------------------- 3. start / sit */

const VERDICT_CLASS: Record<Verdict, string> = {
  "MUST START": "must",
  START: "start",
  FLEX: "flex",
  SIT: "sit",
};

function verdictChip(v: Verdict): string {
  return `<span class="sct-pv-verdict is-${VERDICT_CLASS[v]}">${e(v)}</span>`;
}

/** "OUT" for the unavailable; Doubtful says so. */
function outLabel(status: string): string {
  return status === "Doubtful" ? "DOUBTFUL" : "OUT";
}

/** The line under an unavailable player's name. */
function outLine(injury: BoardRow["injury"]): string {
  const status = injury?.status ?? "Out";
  const word =
    status === "Out"
      ? "Inactive"
      : status === "IR"
        ? "On IR"
        : status === "PUP"
          ? "On PUP"
          : status === "Sus" || status === "Suspended"
            ? "Suspended"
            : status === "NFI"
              ? "Non-football injury list"
              : status;
  return [word, injury?.part ?? null].filter(Boolean).join(" · ");
}

function boardCard(r: BoardRow): string {
  const state = r.out ? "out" : VERDICT_CLASS[r.verdict];
  const pill = r.out
    ? `<span class="sct-pv-verdict is-out">${e(outLabel(r.injury?.status ?? "Out"))}</span>`
    : verdictChip(r.verdict);
  const pos = r.pos === "DST" ? "D/ST" : r.pos;
  const name = r.pos === "DST" ? e(r.name) : playerLink(r.name);
  const head =
    `<div class="sct-pv-card-top">${pill}` +
    `<p class="sct-pv-row-name">${name} <span class="sct-pv-pos">${e(r.team)} · ${e(pos)}</span></p>` +
    (r.proj !== null ? `<span class="sct-pv-proj"><b>${one(r.proj)}</b> PROJ</span>` : "") +
    `</div>`;

  if (r.out) {
    return (
      `<li class="sct-pv-row" data-state="out">${head}` +
      `<p class="sct-pv-line">${e(outLine(r.injury))}` +
      (r.ppg !== null ? ` · <b>${one(r.ppg)}</b> PPG` : "") +
      `</p>` +
      `<p class="sct-pv-more-link"><a href="#pv-inj">See Injury Watch →</a></p>` +
      `</li>`
    );
  }

  // Rows with no usage to structure (no 2026 snaps yet) keep their sentence.
  const stat =
    r.ppg !== null
      ? `<p class="sct-pv-line"><b>${one(r.ppg)}</b> PPG${r.metric ? ` · ${e(r.metric)}` : ""}</p>`
      : r.metric
        ? `<p class="sct-pv-line">${e(r.metric)}</p>`
        : `<p class="sct-pv-line">${e(r.reason)}</p>`;
  const matchup =
    r.matchupTeam && r.matchupLine
      ? `<p class="sct-pv-mu"><span class="sct-pv-mu-k">${e(r.matchupTeam)} matchup</span> ${e(r.matchupLine)}</p>`
      : "";
  const warn =
    r.injury?.status === "Questionable"
      ? `<p class="sct-pv-warn"><span class="sct-pv-verdict is-q">Questionable</span> Confirm active status 90 min before kickoff</p>`
      : "";
  const why = r.why.length
    ? `<details class="sct-pv-why"><summary>Why this call</summary><ul>${r.why.map((w) => `<li>${e(w)}</li>`).join("")}</ul></details>`
    : "";
  return `<li class="sct-pv-row" data-state="${state}">${head}${stat}${matchup}${warn}${why}</li>`;
}

/**
 * The outlook's picks: the best start, the best flex and the one to fade,
 * taken from the board's own calls so they can never disagree with them.
 */
function outlookPicks(p: Preview): { start: BoardRow | null; flex: BoardRow | null; fade: BoardRow | null } {
  const all = [...p.board.away, ...p.board.home].filter((r) => !r.out && r.pos !== "DST");
  const top = (rows: BoardRow[], by: (r: BoardRow) => number) => [...rows].sort((x, y) => by(y) - by(x))[0] ?? null;
  return {
    start: top(all.filter((r) => r.verdict === "MUST START" || r.verdict === "START"), (r) => r.proj ?? 0),
    flex: top(all.filter((r) => r.verdict === "FLEX"), (r) => r.proj ?? 0),
    // The sit most likely to tempt a manager: the biggest scorer on the bench list.
    fade: top(all.filter((r) => r.verdict === "SIT" && r.ppg !== null), (r) => r.ppg ?? 0),
  };
}

function whoTag(name: string, team: string, pos: string): string {
  return `${playerLink(name)} <span class="sct-pv-pos">${e(team)} · ${e(pos)}</span>`;
}

// Unmounted 2026-10-22 (mak): kept so the board can come back as it was.
export function renderBoard(p: Preview): string {
  if (!p.board.away.length && !p.board.home.length) return "";
  const column = (s: PreviewSide, rows: BoardRow[]) =>
    `<div class="sct-pv-col">` +
    `<h3 class="sct-pv-teambar" style="--pv-team:${e(s.team.primaryColor)}">` +
    (s.team.logo ? `<img class="sct-pv-teambar-logo" src="${e(s.team.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async">` : "") +
    `<span class="sct-pv-teambar-text"><span class="sct-pv-teambar-name">${e(s.team.fullName)}</span>` +
    `<span class="sct-pv-teambar-sub">Start/Sit Outlook</span></span></h3>` +
    (rows.length
      ? `<ul class="sct-pv-rows">${rows.map(boardCard).join("")}</ul>`
      : `<p class="sct-pv-empty">No player on this side is rostered in 5% of leagues.</p>`) +
    `</div>`;
  // The "Who should you start" subline, the "12-team PPR · 5%+ rostered"
  // lede and the recommendation key came off 2026-10-22 (mak).
  return (
    `<section class="sct-pv-sec" id="start-sit" aria-labelledby="pv-board">` +
    h2("pv-board", "Start/Sit Board") +
    `<div class="sct-pv-cols">` +
    column(p.away, p.board.away) +
    column(p.home, p.board.home) +
    `</div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- 4. leverage */

/** Starters per position in a 12-team league: the role bar's yardstick. */
export const STARTERS: Record<Pos, number> = { QB: 12, RB: 24, WR: 36, TE: 12 };
const ROLE_WORD = { strong: "Strong", solid: "Solid", light: "Light" } as const;

export function roleTierOf(posRank: number | null, pos: Pos): keyof typeof ROLE_WORD {
  if (posRank === null) return "light";
  if (posRank <= STARTERS[pos] / 2) return "strong";
  if (posRank <= STARTERS[pos]) return "solid";
  return "light";
}

/* ----------------------------------------------------------- 5. snapshot */

export function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((c) => c.key === key);
    if (row) return row;
  }
  return null;
}

/* ------------------------------------------------------------- 6. injuries */


/* --------------------------------------------------------------- 7. h2h */

/* ------------------------------------------------------------------ 8. CTA */

/* ------------------------------------------------------------------ 9. FAQ */

export interface PreviewFaq {
  question: string;
  answer: string;
  /** Visible answer, may carry a link. Escaped already. */
  html: string;
}

/**
 * The upcoming FAQ: mak's 15-question template (2026-10-05), in his order,
 * every answer filled from the page's own numbers. A question whose inputs are
 * missing is left out rather than answered around.
 *
 * Trimmed 2026-11-06 (mak: "avoid a FAQ that merely repeats the odds,
 * injuries and key matchups already explained above"): the best-matchup,
 * injury, beneficiary, points-allowed-by-position and injury-impact questions
 * are gone, and the outlook answer no longer restates the line. What is left
 * answers fantasy start/sit searches and the kickoff/channel search, which no
 * section above answers.
 */
export function previewFaq(p: Preview, ctx: PreviewRenderContext): PreviewFaq[] {
  const { away, home, meeting } = p;
  const items: PreviewFaq[] = [];
  const pair = pairOf(p);
  const week = meeting.weekLabel;
  const plain = (question: string, answer: string, extraHtml = "") =>
    items.push({ question, answer, html: e(answer) + extraHtml });
  const all = [...p.board.away, ...p.board.home];
  const sideOf = (r: BoardRow) => (r.side === "away" ? away : home);
  const oppOf = (r: BoardRow) => (r.side === "away" ? home : away);
  const tag = (r: BoardRow) => `${r.name} (${r.team} ${r.pos === "DST" ? "D/ST" : r.pos})`;
  const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const allows = (r: BoardRow) =>
    r.matchupLine ? `the ${oppOf(r).team.nickname} allow the ${r.matchupLine.replace(/ allowed$/, "")}` : null;

  // 1. Fantasy outlook.
  const picks = outlookPicks(p);
  const pickLine = [
    picks.start ? `the best start is ${tag(picks.start)}` : null,
    picks.flex ? `the best flex is ${tag(picks.flex)}` : null,
    picks.fade ? `the biggest fade is ${tag(picks.fade)}` : null,
  ].filter(Boolean);
  if (pickLine.length) {
    // No odds here: the hero and The Call carry them (mak, 2026-11-06).
    plain(
      `What is the fantasy football outlook for ${pair} in ${week}?`,
      `In PPR 12-team leagues, ${pickLine.join(", ")}.` + (p.snapshotNote ? ` ${p.snapshotNote}` : ""),
    );
  }

  // 2. Who to start: every call on the board.
  const names = (v: Verdict) => all.filter((r) => r.verdict === v && !r.out).map((r) => r.name);
  if (all.length) {
    const parts = [
      ["Must start", names("MUST START")],
      ["Start", names("START")],
      ["Flex", names("FLEX")],
      ["Sit", names("SIT")],
      ["Out", all.filter((r) => r.out).map((r) => r.name)],
    ]
      .filter(([, l]) => (l as string[]).length)
      .map(([label, l]) => `${label}: ${(l as string[]).join(", ")}.`);
    plain(
      `Who should I start in ${pair} in ${week}?`,
      `In PPR 12-team leagues for ${away.team.nickname} at ${home.team.nickname}, ${week} ${meeting.season}: ${parts.join(" ")}` +
        ` The calls weigh each player's PPR scoring against what this defense allows at his position and his team's implied total.`,
    );
  }

  const healthy = all.filter((r) => !r.out && r.pos !== "DST" && r.ppg !== null);

  // 3. Best starts: the starts, topped up with the best flex plays.
  const starts = healthy
    .filter((r) => r.verdict === "MUST START" || r.verdict === "START")
    .sort((x, y) => (y.proj ?? 0) - (x.proj ?? 0));
  const flexes = healthy.filter((r) => r.verdict === "FLEX").sort((x, y) => (y.proj ?? 0) - (x.proj ?? 0));
  if (starts.length || flexes.length) {
    const fmt = (r: BoardRow) =>
      `${r.name} (${r.team} ${r.pos}, ${one(r.ppg!)} PPR points a game${r.proj !== null ? `, ${one(r.proj)} projected` : ""})`;
    const head = starts.length ? `The best starts are ${list(starts.slice(0, 3).map(fmt))}.` : "";
    const flexLine = flexes.length
      ? ` ${starts.length ? "The best flex plays are" : "There is no clear start here; the best flex plays are"} ${list(flexes.slice(0, 3).map(fmt))}.`
      : "";
    plain(`Who are the best fantasy football starts in ${pair}?`, `${head}${flexLine}`.trim());
  }

  // 4. Biggest fades: the biggest scorers on the sit list, then tough matchups.
  const fades = healthy.filter((r) => r.verdict === "SIT").sort((x, y) => (y.ppg ?? 0) - (x.ppg ?? 0)).slice(0, 3);
  if (fades.length) {
    const downs = p.leverage.filter((r) => r.chip === "down" && !fades.some((f) => f.name === r.name));
    plain(
      `Who are the biggest fantasy football fades in ${pair}?`,
      `In 12-team PPR leagues, sit ${list(
        fades.map((r) => `${r.name} (${r.team} ${r.pos}, ${one(r.ppg!)} PPR points a game${allows(r) ? `; ${allows(r)}` : ""})`),
      )}.` + (downs.length ? ` Tough matchups to downgrade: ${list(downs.map((r) => `${r.name} (${r.defense})`))}.` : ""),
    );
  }

  // 6-10. Should I start X: the five most-rostered healthy players.
  const callWord: Record<Verdict, string> = {
    "MUST START": "Yes, he is a must start",
    START: "Yes, start him",
    FLEX: "He is a flex play",
    SIT: "No, sit him",
  };
  // The three most-rostered non-QBs, then each side's quarterback: the names a
  // reader searches by, matching mak's template for this game.
  const byRostered = [...healthy].sort((x, y) => y.rostered - x.rostered);
  const qbs = (["away", "home"] as SideKey[])
    .map((k) => byRostered.find((r) => r.side === k && r.pos === "QB"))
    .filter((r): r is BoardRow => !!r)
    .sort((x, y) => y.rostered - x.rostered);
  const asks = [...byRostered.filter((r) => r.pos !== "QB").slice(0, 5 - qbs.length), ...qbs];
  for (const r of asks) {
    const note = r.why.find((w) => !/^(Usage|Production|Matchup|Adjustment|Injury):/.test(w)) ?? null;
    const q =
      r.injury?.status === "Questionable"
        ? ` He is listed Questionable${r.injury.part ? ` (${r.injury.part.toLowerCase()})` : ""}: confirm he is active 90 minutes before kickoff.`
        : "";
    plain(
      `Should I start ${r.name} against the ${oppOf(r).team.nickname}?`,
      `${callWord[r.verdict]} in 12-team PPR leagues. He averages ${one(r.ppg!)} PPR points a game` +
        `${r.metric ? (r.pos === "QB" ? ` with ${r.metric}` : ` on a ${r.metric}`) : ""}` +
        `${allows(r) ? `, and ${allows(r)}` : ""}.` +
        (r.proj !== null ? ` That projects to ${one(r.proj)} points in ${week}.` : "") +
        (note ? ` ${note}` : "") +
        q,
    );
  }

  // 15. Time and channel.
  const where = meeting.venue ? ` at ${meeting.venue}${meeting.venueCity ? ` in ${meeting.venueCity}` : ""}` : "";
  plain(
    `What time and channel is ${pair} in ${week}?`,
    `The ${away.team.fullName} play the ${home.team.fullName} on ${ctx.date}${ctx.time ? ` at ${ctx.time}` : ""}` +
      `${ctx.network ? ` on ${ctx.network}` : ""}${where}.`,
  );

  return items;
}

function renderFaq(items: PreviewFaq[], p: Preview): string {
  if (!items.length) return "";
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-faq">` +
    h2("pv-faq", `${pairOf(p)} Fantasy Football FAQ`) +
    `<div class="sct-pv-faq">` +
    items.map((i) => `<details class="sct-pv-qa"><summary>${e(i.question)}</summary><p>${i.html}</p></details>`).join("") +
    `</div></section>`
  );
}

export function previewFaqSchema(items: PreviewFaq[], embed: boolean): string {
  if (!items.length) return "";
  const node = {
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
  return embed
    ? `<script type="application/json" class="sct-matchup-faq-data">${escapeJsonLd(JSON.stringify(node))}</script>`
    : `<script type="application/ld+json">${escapeJsonLd(JSON.stringify({ "@context": "https://schema.org", ...node }))}</script>`;
}

/* --------------------------------------------------------------- 10. footer */

function renderFooter(p: Preview, ctx: PreviewRenderContext): string {
  // "Next steps", grouped by what the reader wants to do (mak, 2026-10-05),
  // then the two teams' pages. A tool without a confirmed address is left out.
  const group = (title: string, links: Array<[string | null, string]>) => {
    const live = links.filter((x): x is [string, string] => !!x[0]);
    return live.length
      ? `<div class="sct-pv-foot-group"><p class="sct-pv-foot-h">${e(title)}</p>` +
          `<ul class="sct-pv-foot-links">${live.map(([href, label]) => `<li><a href="${e(href)}">${e(label)}</a></li>`).join("")}</ul></div>`
      : "";
  };
  const teamLinks: Array<[string | null, string]> = [];
  for (const s of [p.away, p.home]) {
    teamLinks.push([ctx.hub(s.team), `${s.team.fullName} hub`]);
    teamLinks.push([ctx.matchups(s.team), `All ${s.team.nickname} matchups`]);
  }
  teamLinks.push([ctx.fpaUrl, "Fantasy Points Allowed"]);
  return (
    `<footer class="sct-pv-foot">` +
    `<p class="sct-pv-foot-title">Next steps</p>` +
    `<div class="sct-pv-foot-groups">` +
    group("For this week", [
      [START_SIT_URL, "Fantasy Football Start/Sit Tool"],
      [LINEUP_OPTIMIZER_URL, "Lineup Optimizer"],
      [WAIVER_WIRE_URL, "Waiver Wire Scanner"],
    ]) +
    group("For roster moves", [
      [TRADE_CALCULATOR_URL, "Fantasy Football Trade Calculator"],
      [ROS_RANKINGS_URL, "Rest of Season Rankings"],
    ]) +
    group("For long-term value", [[DYNASTY_COMMAND_URL, "Dynasty Command"]]) +
    group("Team pages", teamLinks) +
    `</div>` +
    `<p class="sct-pv-legal">Betting lines are market numbers shown for reference and context, not betting advice. ` +
    `Stats are through Week ${p.usageThrough ?? p.meeting.week - 1} of the ${p.meeting.season} season. ` +
    `StatChasers is not affiliated with the NFL, its teams or any sportsbook.</p>` +
    `</footer>`
  );
}

/* ------------------------------------------------------------------- page */

/**
 * What follows the premium page (preview-premium.ts, the upcoming page since
 * mak approved it 2026-11-06 and had the old layer removed): the FAQ, the
 * Dynasty Command line and the Next steps footer, unchanged.
 */
export function renderPreviewTail(p: Preview, ctx: PreviewRenderContext, faq: PreviewFaq[]): string {
  return `<div class="sct-pv">` + renderFaq(faq, p) + renderDynasty(p) + renderFooter(p, ctx) + `</div>`;
}

/** Inline style tokens for the root: the two team fills. */
export function previewStyle(ctx: PreviewRenderContext): string[] {
  return [`--pv-away:${ctx.colors.away}`, `--pv-home:${ctx.colors.home}`];
}

