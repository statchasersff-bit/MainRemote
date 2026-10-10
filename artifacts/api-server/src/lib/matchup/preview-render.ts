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
  ordinal,
  rankWord,
  signedLine,
  type BoardRow,
  type FpaHeadline,
  type Leverage,
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
    `<p><b>${e(title)}</b> ${e(body)}</p>` +
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

function ml(n: number | null): string {
  if (n === null) return "-";
  return n > 0 ? `+${n}` : String(n);
}

/** "BUF -7" from a home-signed spread. */
function favLine(spread: number, away: NflTeam, home: NflTeam): string {
  if (spread === 0) return "PK";
  return spread < 0 ? `${code(home)} ${signedLine(spread)}` : `${code(away)} ${signedLine(-spread)}`;
}

function implyRank(rank: number | null, count: number, week: number): string {
  if (!rank || !count) return "";
  return rank <= Math.ceil(count / 2)
    ? `${rankWord(rank, "highest")} of Week ${week}`
    : `${rankWord(count - rank + 1, "lowest")} of Week ${week}`;
}

/* ---------------------------------------------------------------- 1. hero */

/** "60°F · Wind 10 mph", "Dome", or null. */
function weatherText(p: Preview): string | null {
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

function renderHero(p: Preview, ctx: PreviewRenderContext): string {
  const { away, home, meeting, line } = p;
  const isDivision =
    away.team.conference === home.team.conference && away.team.divisionName === home.team.divisionName;
  // The eyebrow names the week; "Division game" moved to the context strip
  // under the teams (mak, 2026-10-05).
  const kicker = [
    String(meeting.season),
    meeting.weekLabel.toUpperCase(),
    isDivision ? `${away.team.conference} ${away.team.divisionName.toUpperCase()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Each team in an equal half, laid out the same way on both sides: logo,
  // name, record and side, then the hub link as its own small action.
  const sideBlock = (s: PreviewSide, align: "left" | "right") =>
    `<div class="sct-pv-side is-${align}">` +
    (s.team.logo
      ? `<img class="sct-pv-logo" src="${e(s.team.logo)}" alt="" width="56" height="56" loading="eager" decoding="async">`
      : "") +
    `<span class="sct-pv-name">${e(s.team.fullName)}</span>` +
    `<span class="sct-pv-meta">${e([s.record, s.key === "home" ? "HOME" : "AWAY"].filter(Boolean).join(" · "))}</span>` +
    `<a class="sct-pv-hub" href="${e(ctx.hub(s.team))}">Team hub<span aria-hidden="true"> →</span></a>` +
    `</div>`;

  const weather = weatherText(p);
  // The year is in the eyebrow, so the kickoff chip drops it; the city is in
  // the context strip, so the venue chip is the stadium alone.
  const chips = [
    [ctx.date.replace(/, \d{4}$/, ""), ctx.time].filter(Boolean).join(" · "),
    ctx.network,
    meeting.venue ?? null,
    weather,
  ]
    .filter((x): x is string => !!x)
    .map((x) => `<li class="sct-pv-chip">${e(x)}</li>`)
    .join("");

  // One quick-glance line under the teams: the game type, then the market
  // when there is one, else the week and the city.
  const gameType = isDivision
    ? "Division game"
    : away.team.conference === home.team.conference
      ? "Conference game"
      : `${away.team.conference} vs ${home.team.conference}`;
  const hasLine = !!line && line.spread !== null && line.total !== null;
  const context = [
    gameType,
    ...(hasLine
      ? [favLine(line!.spread!, away.team, home.team), `O/U ${exact(line!.total!)}`]
      : [meeting.weekLabel, meeting.venueCity ?? null]),
  ]
    .filter((x): x is string => !!x)
    .map((x) => `<li>${e(x)}</li>`)
    .join("");

  let strip = "";
  if (line && line.spread !== null && line.total !== null && away.implied !== null && home.implied !== null) {
    const cell = (label: string, value: string, sub: string) =>
      `<div class="sct-pv-bet"><span class="sct-pv-bet-k">${e(label)}</span>` +
      `<span class="sct-pv-bet-v">${e(value)}</span>` +
      (sub ? `<span class="sct-pv-bet-s">${e(sub)}</span>` : "") +
      `</div>`;
    strip =
      `<div class="sct-pv-bets" role="group" aria-label="Betting lines">` +
      cell("Spread", favLine(line.spread, away.team, home.team), line.spreadOpen !== null ? `Opened ${favLine(line.spreadOpen, away.team, home.team)}` : "") +
      cell("Total", exact(line.total), line.totalOpen !== null ? `Opened ${exact(line.totalOpen)}` : "") +
      cell(`${code(home.team)} implied`, exact(home.implied), implyRank(home.impliedRank, p.slateCount, meeting.week)) +
      cell(`${code(away.team)} implied`, exact(away.implied), implyRank(away.impliedRank, p.slateCount, meeting.week)) +
      cell("Moneyline", `${code(home.team)} ${ml(line.moneyline.home)}`, `${code(away.team)} ${ml(line.moneyline.away)}`) +
      `</div>` +
      // The book note sits with the lines it is about, not in the byline.
      `<p class="sct-pv-bets-note">Lines move - check your book.</p>`;
  }

  const updated = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(p.updatedMs || Date.now());

  // Each side's wash is the club's own primary color, darkened in the CSS -
  // not the pair-contrast color, which gave the Jets their white (gray here).
  const heroStyle = `--pv-hero-away:${away.team.primaryColor};--pv-hero-home:${home.team.primaryColor}`;

  return (
    `<header class="sct-pv-hero" style="${e(heroStyle)}" aria-labelledby="${e(ctx.headingId)}">` +
    `<nav class="sct-pv-crumbs" aria-label="Breadcrumb"><ol>` +
    `<li><a href="${e(ctx.breadcrumbRoot)}">StatChasers</a></li>` +
    `<li>NFL Matchups</li>` +
    `<li aria-current="page">${e(`${away.team.nickname} at ${home.team.nickname}, ${meeting.weekLabel}`)}</li>` +
    `</ol></nav>` +
    `<p class="sct-pv-kicker">${e(kicker)}</p>` +
    `<${ctx.headingTag} class="sct-pv-title" id="${e(ctx.headingId)}" data-sct-hero-heading>${e(ctx.heading)}</${ctx.headingTag}>` +
    `<div class="sct-pv-match">` +
    sideBlock(away, "left") +
    `<span class="sct-pv-at" aria-hidden="true">AT</span>` +
    sideBlock(home, "right") +
    `</div>` +
    (context ? `<ul class="sct-pv-context">${context}</ul>` : "") +
    (chips ? `<ul class="sct-pv-chips">${chips}</ul>` : "") +
    strip +
    `<p class="sct-pv-byline">Updated ${e(updated)} · StatChasers NFL</p>` +
    `</header>`
  );
}

/* -------------------------------------------- 1b. intro and fantasy outlook */

function renderIntro(p: Preview): string {
  return (
    `<section class="sct-pv-sec sct-pv-intro">` +
    `<p class="sct-pv-eyebrow">Fantasy matchup preview</p>` +
    `<p class="sct-pv-intro-lede">Preview ${e(pairOf(p))} for ${e(p.meeting.weekLabel)} with fantasy projections, start/sit recommendations, ` +
    `matchup leverage, injuries, usage, points allowed by position and team trends.</p>` +
    `</section>`
  );
}

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

function renderOutlook(p: Preview): string {
  const picks = outlookPicks(p);
  const env = environment(p);
  const cell = (k: string, v: string, note?: string | null) =>
    `<div class="sct-pv-read-cell"><dt>${e(k)}</dt><dd>${v}${note ? `<small class="sct-pv-read-why">${e(note)}</small>` : ""}</dd></div>`;
  const cells =
    (picks.start ? cell("Best start", whoTag(picks.start.name, picks.start.team, picks.start.pos)) : "") +
    (picks.flex ? cell("Best flex", whoTag(picks.flex.name, picks.flex.team, picks.flex.pos)) : "") +
    (picks.fade ? cell("Biggest fade", whoTag(picks.fade.name, picks.fade.team, picks.fade.pos)) : "") +
    cell("Game environment", e(env.value), env.note);
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-outlook">` +
    h2("pv-outlook", `Fantasy Outlook: ${pairOf(p)}`) +
    `<div class="sct-pv-read sct-pv-read-4"><dl>${cells}</dl></div>` +
    (p.snapshotNote
      ? `<div class="sct-pv-take"><p class="sct-pv-take-h">StatChasers matchup read</p><p>${e(p.snapshotNote)}</p></div>`
      : "") +
    `</section>`
  );
}

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
    subline("Where usage or injury context makes the matchup interesting") +
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

function renderCall(p: Preview, ctx: PreviewRenderContext): string {
  if (!p.call) return "";
  const { away, home } = p;
  const pos = 50 + p.call.lean * 45;
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-call">` +
    h2("pv-call", "The Call") +
    `<div class="sct-pv-call">` +
    `<h3 class="sct-pv-thesis">${e(p.call.thesis)}.</h3>` +
    `<p>${e(p.call.paragraph)}</p>` +
    `<div class="sct-pv-meter">` +
    `<div class="sct-pv-track" aria-hidden="true"><span class="sct-pv-dot" style="left:${pos.toFixed(1)}%"></span></div>` +
    `<div class="sct-pv-meter-labels" aria-hidden="true"><span>${e(code(away.team))} controls</span><span>Competitive</span><span>${e(code(home.team))} controls</span></div>` +
    `<p class="sct-pv-lean">${e(p.call.leanText)}</p>` +
    `</div>` +
    `</div>` +
    `<p class="sct-pv-lede">The script logic leans on each staff's pass rate by score state, from the ` +
    `<a href="${e(ctx.coaching(away.team))}">${e(away.team.nickname)}</a> and ` +
    `<a href="${e(ctx.coaching(home.team))}">${e(home.team.nickname)}</a> coaching profiles.</p>` +
    `</section>`
  );
}

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

function renderBoard(p: Preview): string {
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
  const key =
    `<div class="sct-pv-key"><span class="sct-pv-key-h">Recommendation key</span>` +
    verdictChip("MUST START") +
    verdictChip("START") +
    verdictChip("FLEX") +
    verdictChip("SIT") +
    `<span class="sct-pv-verdict is-out">Out</span>` +
    `<span class="sct-pv-verdict is-q">Questionable</span>` +
    `</div>`;
  return (
    `<section class="sct-pv-sec" id="start-sit" aria-labelledby="pv-board">` +
    h2("pv-board", "Start/Sit Board") +
    subline(`Who should you start in ${pairOf(p)}?`) +
    `<p class="sct-pv-lede"><b>12-team PPR · 5%+ rostered players.</b> ` +
    `Rankings adjust for player production, matchup and team implied scoring.</p>` +
    key +
    `<div class="sct-pv-cols">` +
    column(p.away, p.board.away) +
    column(p.home, p.board.home) +
    `</div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- 4. leverage */

/** The decision, then what it means: the leverage pill's two lines. */
const LEVERAGE_LABEL: Record<Leverage, [string, string]> = {
  up: ["↑ Upgrade", "Matchup edge"],
  neutral: ["- Neutral", "No clear edge"],
  down: ["↓ Downgrade", "Tough matchup"],
  proof: ["Matchup-proof", "Role wins"],
};

function levPill(chip: Leverage): string {
  const [label, sub] = LEVERAGE_LABEL[chip];
  return `<span class="sct-pv-lev is-${chip}"><b>${e(label)}</b><small>${e(sub)}</small></span>`;
}

function renderLeverage(p: Preview, ctx: PreviewRenderContext): string {
  if (!p.leverage.length) return "";
  const team = (k: SideKey) => (k === "away" ? p.away : p.home).team;
  const who = (r: LeverageRow) =>
    `${playerLink(r.name)} <span class="sct-pv-pos">${e(`${code(team(r.side))} · ${r.pos}`)}</span>`;

  const read = p.leverageRead;
  const readCells = read
    ? [
        read.edge ? ["Best edge", who(read.edge)] : null,
        read.fade ? ["Toughest matchup", who(read.fade)] : null,
        read.conflict ? [read.conflict.text, who(read.conflict.row)] : null,
      ]
        .filter((x): x is string[] => !!x)
        .map(([k, v]) => `<div class="sct-pv-read-cell"><dt>${e(k)}</dt><dd>${v}</dd></div>`)
        .join("")
    : "";
  const counts = read
    ? `<p class="sct-pv-counts">` +
      `<span class="is-up"><b>${read.up}</b> ${read.up === 1 ? "upgrade" : "upgrades"}</span>` +
      `<span class="is-down"><b>${read.down}</b> ${read.down === 1 ? "downgrade" : "downgrades"}</span>` +
      `<span><b>${read.neutral}</b> neutral</span></p>`
    : "";

  const roleCell = (r: LeverageRow) =>
    r.roleStats.length
      ? `<span class="sct-pv-sig">` +
        r.roleStats.map((x) => `<span class="sct-pv-sig-i"><b>${e(x.v)}</b> ${e(x.k)}</span>`).join("") +
        `</span>`
      : e(r.role);
  const defCell = (r: LeverageRow) =>
    r.defFpa !== null && r.defRank !== null
      ? `<span class="sct-pv-def"><b>${one(r.defFpa)}</b><span class="sct-pv-def-k">${e(r.pos)} PPG allowed</span>` +
        `<span class="sct-pv-def-r">${e(allowPhrase(r.defRank))} vs ${e(r.pos)}</span></span>`
      : e(r.defense);

  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-lev">` +
    h2("pv-lev", `${pairOf(p)} Matchup Leverage`) +
    subline("Where role and opponent create an edge") +
    `<p class="sct-pv-lede">Points allowed tells you where a defense is vulnerable. Matchup Leverage adds the missing piece: whether each player has the role to exploit it.</p>` +
    `<p class="sct-pv-meta-line">` +
    `${p.usageThrough ? `Usage through Week ${p.usageThrough}` : "Usage to date"} · PPR scoring · Usage Reports: ` +
    `<a href="${e(ctx.usage(p.away.team))}">${e(p.away.team.nickname)}</a>, ` +
    `<a href="${e(ctx.usage(p.home.team))}">${e(p.home.team.nickname)}</a></p>` +
    (readCells || counts
      ? `<div class="sct-pv-read"><p class="sct-pv-read-h">Leverage read</p>${counts}${readCells ? `<dl>${readCells}</dl>` : ""}</div>`
      : "") +
    `<div class="sct-pv-scroll"><table class="sct-pv-table sct-pv-levtable">` +
    `<thead><tr><th scope="col">Player</th><th scope="col">Role signal</th><th scope="col">Matchup signal</th><th scope="col">Leverage</th></tr></thead>` +
    `<tbody>` +
    p.leverage
      .map(
        (r) =>
          `<tr data-lev="${r.chip}"><th scope="row">${who(r)}</th>` +
          `<td>${roleCell(r)}</td><td>${defCell(r)}</td>` +
          `<td>${levPill(r.chip)}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- 5. snapshot */

function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((c) => c.key === key);
    if (row) return row;
  }
  return null;
}

/** Color only the outliers (top or bottom 5); every other rank stays slate. */
function tier(rank: number | null): string {
  if (rank === null) return "none";
  if (rank <= 5) return "good";
  if (rank >= 28) return "poor";
  return "mid";
}

function rankChip(rank: number | null, label: string | null, tierOverride?: string): string {
  if (rank === null) return "";
  return `<span class="sct-pv-rank" data-tier="${tierOverride ?? tier(rank)}">${e(label ?? ordinal(rank))}</span>`;
}

function compareRow(
  label: string,
  left: { value: string; rank: number | null; rankLabel?: string | null; tier?: string; best: boolean; bar?: number },
  right: { value: string; rank: number | null; rankLabel?: string | null; tier?: string; best: boolean; bar?: number },
): string {
  const side = (s: typeof left, chipFirst: boolean) => {
    const value = `<span class="sct-pv-cv${s.best ? " is-best" : ""}">${e(s.value)}</span>`;
    const chip = rankChip(s.rank, s.rankLabel ?? null, s.tier);
    // A restrained bar under the figure: longer is softer (more allowed).
    const bar =
      s.bar !== undefined
        ? `<span class="sct-pv-cbar" aria-hidden="true"><i style="width:${Math.round(s.bar * 100)}%"></i></span>`
        : "";
    return (chipFirst ? chip + value : value + chip) + bar;
  };
  return (
    `<tr><td class="sct-pv-cl">${side(left, false)}</td>` +
    `<th scope="row" class="sct-pv-cm">${e(label)}</th>` +
    `<td class="sct-pv-cr">${side(right, true)}</td></tr>`
  );
}

const SNAP_ROWS: Array<{ key: string; label: string }> = [
  { key: "off-points", label: "Pts/G" },
  { key: "off-total-yards", label: "Yds/G" },
  { key: "off-yards-per-play", label: "Yds/Play" },
  { key: "def-points", label: "Pts/G allowed" },
  { key: "def-total-yards", label: "Yds/G allowed" },
];

function renderSnapshot(p: Preview, ctx: PreviewRenderContext): string {
  const { away, home } = p;
  const head =
    `<thead><tr><th scope="col" class="sct-pv-cl">${e(code(away.team))}</th><th scope="col" class="sct-pv-cm"><span class="sct-visually-hidden">Metric</span></th>` +
    `<th scope="col" class="sct-pv-cr">${e(code(home.team))}</th></tr></thead>`;

  const teamRows = [
    away.record || home.record
      ? compareRow(
          "Record",
          { value: away.record ?? "-", rank: null, best: false },
          { value: home.record ?? "-", rank: null, best: false },
        )
      : "",
    ...SNAP_ROWS.map(({ key, label }) => {
      const a = findRow(away.stats, key);
      const h = findRow(home.stats, key);
      if (!a && !h) return "";
      const better = a?.rank != null && h?.rank != null && a.rank !== h.rank ? (a.rank < h.rank ? "a" : "h") : null;
      return compareRow(
        label,
        { value: a?.value ?? "-", rank: a?.rank ?? null, rankLabel: a?.rankLabel, best: better === "a" },
        { value: h?.value ?? "-", rank: h?.rank ?? null, rankLabel: h?.rankLabel, best: better === "h" },
      );
    }),
  ].join("");

  // Fantasy points allowed: green = soft (good for the opposing offense),
  // colored only at the extremes.
  const fpaTier = (rank: number) => (rank <= 5 ? "good" : rank >= 28 ? "poor" : "mid");
  const barOf = (rank: number) => (33 - rank) / 32;
  const fpaRows =
    away.fpa && home.fpa
      ? (["QB", "RB", "WR", "TE"] as Pos[])
          .map((pos) => {
            const a = away.fpa!.byPos[pos];
            const h = home.fpa!.byPos[pos];
            const softer = a.fpa === h.fpa ? null : a.fpa > h.fpa ? "a" : "h";
            return compareRow(
              `${pos} pts allowed`,
              { value: one(a.fpa), rank: a.rank, tier: fpaTier(a.rank), best: softer === "a", bar: barOf(a.rank) },
              { value: one(h.fpa), rank: h.rank, tier: fpaTier(h.rank), best: softer === "h", bar: barOf(h.rank) },
            );
          })
          .join("")
      : "";

  if (!teamRows && !fpaRows) return "";
  const pair = pairOf(p);
  // Two sections, side by side on a wide screen: a comparison table at full
  // width puts the two teams' numbers a page apart.
  return (
    `<div class="sct-pv-pair">` +
    (teamRows
      ? `<section class="sct-pv-sec" aria-labelledby="pv-snap">` +
        h2("pv-snap", `${pair} Team Matchup`) +
        subline("How the offenses and defenses compare") +
        `<div class="sct-pv-card"><table class="sct-pv-compare">${head}<tbody>${teamRows}</tbody></table></div>` +
        `</section>`
      : "") +
    (fpaRows
      ? `<section class="sct-pv-sec" aria-labelledby="pv-fpa">` +
        h2("pv-fpa", "Fantasy Points Allowed by Position") +
        subline("QB, RB, WR and TE matchup strength") +
        `<div class="sct-pv-card">` +
        (p.fpaHeadlines ? fpaHeadlineCells(p.fpaHeadlines) : "") +
        `<table class="sct-pv-compare is-fpa">${head}<tbody>${fpaRows}</tbody></table>` +
        (p.fpaNote
          ? `<p class="sct-pv-note">${e(p.fpaNote)}` +
            (ctx.fpaUrl ? ` <a href="${e(ctx.fpaUrl)}">Full Fantasy Points Allowed table</a>.` : "") +
            `</p>`
          : "") +
        `</div></section>`
      : "") +
    `</div>`
  );
}

/** Softest and toughest matchup, ahead of the table. */
function fpaHeadlineCells(h: { soft: FpaHeadline; tough: FpaHeadline }): string {
  const cell = (k: string, x: FpaHeadline, cls: string) =>
    `<div class="sct-pv-hl ${cls}"><span class="sct-pv-hl-k">${e(k)}</span>` +
    `<span class="sct-pv-hl-v">${e(x.def)} vs ${e(x.pos)}</span>` +
    `<span class="sct-pv-hl-s">${one(x.fpa)} PPG allowed · ${e(allowPhrase(x.rank))}` +
    (x.who ? ` · sets up ${playerLink(x.who)}` : "") +
    `</span></div>`;
  return `<div class="sct-pv-hls">${cell("Softest matchup", h.soft, "is-soft")}${cell("Toughest matchup", h.tough, "is-tough")}</div>`;
}

/* ------------------------------------------------------------- 6. injuries */

function renderInjuries(p: Preview): string {
  const card = (s: PreviewSide) =>
    `<div class="sct-pv-card"><h3 class="sct-pv-colhead"><span class="sct-pv-swatch is-${s.key}" aria-hidden="true"></span>${e(s.team.fullName)}</h3>` +
    `<ul class="sct-pv-rows">` +
    p.injuries[s.key]
      .map(
        (r) =>
          `<li class="sct-pv-row"><span class="sct-pv-inj" data-status="${e(r.chip)}" title="${e(r.status)}">${e(r.chip === "OK" ? "CLEAN" : r.chip)}<span class="sct-visually-hidden"> ${e(r.status)}</span></span>` +
          `<div class="sct-pv-row-body"><p class="sct-pv-row-name">${r.chip === "OK" ? e(r.name) : playerLink(r.name)}` +
          (r.pos ? ` <span class="sct-pv-pos">${e(r.pos)}</span>` : "") +
          `</p><p class="sct-pv-row-why">${e(r.fallout)}</p></div></li>`,
      )
      .join("") +
    `</ul></div>`;
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-inj">` +
    h2("pv-inj", `${pairOf(p)} Injury Report & Fantasy Impact`) +
    `<p class="sct-pv-lede">Designations and practice notes from the official report; each line says what the injury changes for lineups.</p>` +
    injuryImpactStrip(p) +
    `<div class="sct-pv-cards">${card(p.away)}${card(p.home)}</div>` +
    `</section>`
  );
}

/** The Injury Impact strip over the cards. */
function injuryImpactStrip(p: Preview): string {
  const i = p.injuryImpact;
  if (!i) return "";
  const names = (list: Array<{ name: string; team: string }>) => {
    const shown = list
      .slice(0, 3)
      .map((x) => `<span class="sct-pv-nowrap">${playerLink(x.name)} <span class="sct-pv-pos">${e(x.team)}</span></span>`);
    return shown.join(", ") + (list.length > 3 ? ` <span class="sct-pv-pos">+${list.length - 3} more</span>` : "");
  };
  const cells = [
    i.beneficiary
      ? `<div class="sct-pv-read-cell"><dt>Biggest beneficiary</dt><dd>${playerLink(i.beneficiary.name)} ` +
        `<span class="sct-pv-pos">${e(i.beneficiary.team)} · ${e(i.beneficiary.pos)}</span>` +
        `<small class="sct-pv-read-why">with ${e(i.beneficiary.because)}</small></dd></div>`
      : "",
    i.watch.length ? `<div class="sct-pv-read-cell"><dt>Watch closely</dt><dd>${names(i.watch)}</dd></div>` : "",
    i.none.length ? `<div class="sct-pv-read-cell"><dt>No fantasy impact</dt><dd>${names(i.none)}</dd></div>` : "",
  ].join("");
  return cells ? `<div class="sct-pv-read"><p class="sct-pv-read-h">Injury impact</p><dl>${cells}</dl></div>` : "";
}

/* --------------------------------------------------------------- 7. h2h */

function renderH2h(p: Preview, ctx: PreviewRenderContext): string {
  const h = p.h2h;
  if (!h) return "";
  // Every tile: the figure, its label in caps, then an optional note.
  const stat = (value: string, label: string, note?: string | null) =>
    `<div class="sct-pv-stat"><span class="sct-pv-stat-v">${e(value)}</span><span class="sct-pv-stat-k">${e(label)}</span>` +
    (note ? `<span class="sct-pv-stat-n">${e(note)}</span>` : "") +
    `</div>`;
  const cards = h.games
    .slice(0, 10)
    .map((m) => {
      const s = m.score!;
      const homeWon = s.home > s.away;
      const awayWon = s.away > s.home;
      return (
        `<li><a class="sct-pv-game" href="${e(ctx.game(m))}">` +
        `<span class="sct-pv-game-when">${e(`${m.season} · ${m.weekLabel}`)}</span>` +
        `<span class="sct-pv-game-line${awayWon ? " is-win" : homeWon ? " is-loss" : ""}">${e(code(m.away))} <b>${s.away}</b></span>` +
        `<span class="sct-pv-game-line${homeWon ? " is-win" : awayWon ? " is-loss" : ""}">@${e(code(m.home))} <b>${s.home}</b></span>` +
        `</a></li>`
      );
    })
    .join("");
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-h2h">` +
    h2("pv-h2h", `${pairOf(p)} Head-to-Head`) +
    `<div class="sct-pv-stats">` +
    stat(h.record, `Series record · since ${h.since}`) +
    (h.avgPoints !== null ? stat(one(h.avgPoints), "Avg total points", h.avgVsTotal) : "") +
    (h.third ? stat(h.third.value, h.third.label) : "") +
    `</div>` +
    (h.trend
      ? `<div class="sct-pv-take"><p class="sct-pv-take-h">Series trend</p><p>${e(h.trend.text)} ${e(h.trend.margin)}</p></div>`
      : "") +
    `<p class="sct-pv-lede">${e(h.lede)}</p>` +
    `<ol class="sct-pv-games" aria-label="Recent meetings">${cards}</ol>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ 8. CTA */

function renderCta(ctx: PreviewRenderContext): string {
  return (
    `<section class="sct-pv-cta" aria-label="Redraft Command">` +
    `<div><p class="sct-pv-cta-h">Need the call for your actual team?</p>` +
    `<p>This matchup preview uses a 12-team PPR baseline. Connect your league in Redraft Command to compare these players against your real starters, bench and scoring settings.</p></div>` +
    `<a class="sct-pv-cta-btn" href="${e(ctx.redraftUrl)}" data-cta="preview-redraft">Set My Lineup in Redraft Command</a>` +
    `</section>`
  );
}

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
    const env = environment(p);
    plain(
      `What is the fantasy football outlook for ${pair} in ${week}?`,
      `In PPR 12-team leagues, ${pickLine.join(", ")}. Game environment: ${env.value}${env.note ? ` (${env.note})` : ""}.` +
        (p.snapshotNote ? ` ${p.snapshotNote}` : ""),
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
      ` <a href="#start-sit">See the full Start/Sit board</a>.`,
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

  // 5. Best fantasy matchup.
  if (p.fpaHeadlines) {
    const { soft, tough } = p.fpaHeadlines;
    const edge = p.leverageRead?.edge ?? null;
    plain(
      `What is the best fantasy matchup in ${pair}?`,
      `${soft.def} allows ${one(soft.fpa)} PPR points a game to ${soft.pos}s, the ${allowPhrase(soft.rank)} in the league` +
        `${soft.who ? `, which sets up ${soft.who}` : ""}. The toughest spot is ${tough.def} against ${tough.pos}s ` +
        `(${one(tough.fpa)} a game, the ${allowPhrase(tough.rank)}).` +
        (edge && edge.name !== soft.who ? ` On role and matchup together, ${edge.name} has the clearest edge.` : ""),
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

  // 11. The game's top injury question.
  const injured = [...p.injuries.away.map((r) => ({ r, s: away })), ...p.injuries.home.map((r) => ({ r, s: home }))]
    .filter((x) => x.r.chip !== "OK" && x.r.status !== "IR")
    .sort((x, y) => y.r.rostered - x.r.rostered);
  const top = injured[0];
  if (top) {
    plain(
      `Is ${top.r.name} playing in ${week} against the ${top.s.opponent.nickname}?`,
      `${top.r.name} is listed ${top.r.status} for the ${top.s.team.nickname}. ${top.r.fallout}`,
    );
  } else {
    plain(
      `Are there any key injuries for ${pair}?`,
      `No player rostered in 5% or more of fantasy leagues on either team carries a game designation, so every ${away.team.nickname} and ${home.team.nickname} role is available.`,
    );
  }

  // 12. Who benefits most from the costliest absence.
  const gain = p.injuryImpact?.beneficiary;
  if (gain) {
    const absent = gain.because.replace(/ (out|on IR)$/, "");
    const metric = all.find((r) => r.name === gain.name)?.metric;
    plain(
      `Who benefits most if ${absent} is out?`,
      `${gain.name} (${gain.team} ${gain.pos}) gains the most: he steps into the work with ${gain.because}` +
        `${metric ? `, coming off a ${metric} so far` : ""}.`,
    );
  }

  // 13. Which defense gives up more, position by position.
  if (away.fpa && home.fpa) {
    const parts = (["QB", "RB", "WR", "TE"] as Pos[]).map((pos) => {
      const a = away.fpa!.byPos[pos];
      const h = home.fpa!.byPos[pos];
      if (a.fpa === h.fpa) return `${pos}s, both allow ${one(a.fpa)} a game`;
      const [more, m, less, l] = a.fpa > h.fpa ? [away, a, home, h] : [home, h, away, a];
      return `${pos}s, the ${more.team.nickname} allow more (${one(m.fpa)} a game, ${allowPhrase(m.rank)}) than the ${less.team.nickname} (${one(l.fpa)}, ${allowPhrase(l.rank)})`;
    });
    plain(
      `Which team gives up more fantasy points by position, the ${away.team.nickname} or ${home.team.nickname}?`,
      `In PPR points allowed per game: against ${parts.join("; against ")}.`,
    );
  }

  // 14. What the injuries do to lineups, in one answer.
  const impact = p.injuryImpact;
  if (impact) {
    const outs = (["away", "home"] as SideKey[]).flatMap((k) =>
      p.injuries[k].filter((r) => r.impact === "out").map((r) => `${r.name} (${code((k === "away" ? away : home).team)} ${r.pos})`),
    );
    const bits = [
      outs.length ? `Out: ${list(outs)}.` : null,
      impact.beneficiary ? `Biggest beneficiary: ${impact.beneficiary.name}, with ${impact.beneficiary.because}.` : null,
      impact.watch.length ? `Watch closely: ${list(impact.watch.map((x) => x.name))}; inactives post 90 minutes before kickoff.` : null,
      impact.none.length ? `No fantasy impact: ${list(impact.none.map((x) => x.name))}.` : null,
    ].filter(Boolean);
    if (bits.length) {
      plain(`How do the ${away.team.nickname} and ${home.team.nickname} injuries affect fantasy football lineups?`, bits.join(" "));
    }
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

export function renderPreviewTop(p: Preview, ctx: PreviewRenderContext): string {
  return renderHero(p, ctx);
}

/** `lead` is markup placed above the intro: the pair page's "Last meeting" block. */
export function renderPreviewBody(p: Preview, ctx: PreviewRenderContext, faq: PreviewFaq[], lead = ""): string {
  return (
    `<div class="sct-pv">` +
    lead +
    renderIntro(p) +
    renderOutlook(p) +
    renderCall(p, ctx) +
    renderBoard(p) +
    nextStep(
      "preview-startsit",
      "Have two players you're deciding between?",
      "Compare them head-to-head in the Fantasy Football Start/Sit Tool.",
      START_SIT_URL,
      "Open the Start/Sit Tool",
    ) +
    renderLeverage(p, ctx) +
    nextStep(
      "preview-optimizer",
      "Apply these matchup edges to your lineup.",
      "The Lineup Optimizer checks every starting slot using your actual roster and league settings.",
      LINEUP_OPTIMIZER_URL,
      "Open the Lineup Optimizer",
    ) +
    renderSnapshot(p, ctx) +
    renderInjuries(p) +
    nextStep(
      "preview-waivers",
      "Need a replacement?",
      "Scan available players across your leagues with the Fantasy Football Waiver Wire Scanner.",
      WAIVER_WIRE_URL,
      "Open the Waiver Wire Scanner",
    ) +
    renderWatchList(p) +
    renderH2h(p, ctx) +
    renderCta(ctx) +
    renderFaq(faq, p) +
    renderDynasty(p) +
    renderFooter(p, ctx) +
    `</div>`
  );
}

/** Inline style tokens for the root: the two team fills. */
export function previewStyle(ctx: PreviewRenderContext): string[] {
  return [`--pv-away:${ctx.colors.away}`, `--pv-home:${ctx.colors.home}`];
}

