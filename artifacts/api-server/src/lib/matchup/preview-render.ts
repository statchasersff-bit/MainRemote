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
import { playerProfileUrl, type PlayerLinkRef } from "../team/links";
import {
  rankWord,
  signedLine,
  type BoardRow,
  type Preview,
  type PreviewSide,
  type SideKey,
  type Verdict,
} from "./preview";
import type { Meeting } from "./matchup-data";

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
const code = (t: NflTeam): string => t.code.toUpperCase();

function h2(id: string, text: string): string {
  return `<h2 class="sct-h2 sct-pv-h2" id="${e(id)}">${e(text)}</h2>`;
}

function playerLink(name: string, ref: PlayerLinkRef): string {
  const url = playerProfileUrl(name, ref);
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

// The "Fantasy Outlook" section (best start / flex / fade, game environment,
// the matchup read) that opened the body from 2026-10-05 was removed at mak's
// request on 2026-10-22; its picks still feed the FAQ through outlookPicks().

/* ----------------------------------------------------- 6b. players to watch */

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
  const name = r.pos === "DST" ? e(r.name) : playerLink(r.name, r.sleeperId ? { sleeperId: r.sleeperId } : { team: r.team, pos: r.pos });
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

/**
 * The FAQ's H2 with the premium cards' bar pieces (mak, 2026-11-11: the
 * FAQ "need[s] to have a similar design/style as the other sections", then
 * at every width, "the same design as the rest of the page"). The icon and
 * the slanted lines are aria-hidden and show at every width; the short
 * "Fantasy Football FAQ" label shows only at 560px and under, where the
 * full text is visually hidden but stays the heading's text
 * ([[seo-changes-need-approval]]).
 */
function faqH2(text: string): string {
  return (
    `<h2 class="sct-h2 sct-pv-h2" id="pv-faq">` +
    `<span class="sct-pv-faq-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17.2v.01"/></g></svg></span>` +
    `<span class="sct-pv-faq-full">${e(text)}</span>` +
    `<span class="sct-pv-faq-short" data-short="Fantasy Football FAQ" aria-hidden="true"></span>` +
    `<span class="sct-pv-faq-slash" aria-hidden="true"></span>` +
    `</h2>`
  );
}

function renderFaq(items: PreviewFaq[], p: Preview): string {
  if (!items.length) return "";
  return (
    `<section class="sct-pv-sec is-faq" aria-labelledby="pv-faq">` +
    faqH2(`${pairOf(p)} Fantasy Football FAQ`) +
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

function renderFooter(p: Preview): string {
  // The Dynasty Command line and the "Next steps" links (tools by intent,
  // then the two teams' pages) were removed at mak's request on 2026-11-11,
  // at every width; only the legal line stays.
  return (
    `<footer class="sct-pv-foot">` +
    `<p class="sct-pv-legal">Betting lines are market numbers shown for reference and context, not betting advice. ` +
    `Stats are through Week ${p.usageThrough ?? p.meeting.week - 1} of the ${p.meeting.season} season. ` +
    `StatChasers is not affiliated with the NFL, its teams or any sportsbook.</p>` +
    `</footer>`
  );
}

/* ------------------------------------------------------------------- page */

/**
 * What follows the premium page (preview-premium.ts, the upcoming page since
 * mak approved it 2026-11-06 and had the old layer removed): the FAQ and the
 * legal line (the Dynasty Command line and Next steps removed 2026-11-11).
 */
export function renderPreviewTail(p: Preview, _ctx: PreviewRenderContext, faq: PreviewFaq[]): string {
  return `<div class="sct-pv">` + renderFaq(faq, p) + renderFooter(p) + `</div>`;
}

/** Inline style tokens for the root: the two team fills. */
export function previewStyle(ctx: PreviewRenderContext): string[] {
  return [`--pv-away:${ctx.colors.away}`, `--pv-home:${ctx.colors.home}`];
}

