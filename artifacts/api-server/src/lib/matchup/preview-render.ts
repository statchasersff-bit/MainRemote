/**
 * The upcoming matchup page's decision layer, drawn from preview.ts.
 *
 * Section order is the spec's (mak, 2026-10-03): hero with the betting strip,
 * The Call, Start/Sit, Matchup Leverage, Snapshot, Injury Watch, Head-to-Head,
 * the Redraft Command CTA, FAQ, footer. The page's older upcoming sections
 * render unchanged under all of this so the two can be compared.
 *
 * Every chip carries its word as text; tables are real tables; the script
 * meter's lean is also written out. Colours come from the team tokens on the
 * root (--pv-away / --pv-home), never from here.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import type { NflTeam } from "../team/teams";
import type { StatRow, TeamStats } from "../team/stats";
import { getPlayerProfileUrl } from "../team/links";
import {
  ordinal,
  rankWord,
  signedLine,
  type BoardRow,
  type Leverage,
  type Pos,
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
const exact = (n: number): string => String(Math.round(n * 100) / 100);
const code = (t: NflTeam): string => t.code.toUpperCase();

function h2(id: string, text: string): string {
  return `<h2 class="sct-pv-h2" id="${e(id)}">${e(text)}</h2>`;
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

function renderHero(p: Preview, ctx: PreviewRenderContext): string {
  const { away, home, meeting, line } = p;
  const division =
    away.team.conference === home.team.conference && away.team.divisionName === home.team.divisionName
      ? `${away.team.conference} ${away.team.divisionName.toUpperCase()} · DIVISION GAME`
      : null;
  const kicker = [String(meeting.season), meeting.weekLabel.toUpperCase(), division].filter(Boolean).join(" · ");

  const sideBlock = (s: PreviewSide, align: "left" | "right") =>
    `<div class="sct-pv-side is-${align}">` +
    `<span class="sct-pv-name">${e(s.team.fullName)}</span>` +
    `<span class="sct-pv-meta">${e([s.record, s.key === "home" ? "Home" : "Away"].filter(Boolean).join(" · "))}` +
    ` · <a href="${e(ctx.hub(s.team))}">Team hub</a></span>` +
    `</div>`;

  const weather = (() => {
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
  })();
  const chips = [
    [ctx.date, ctx.time].filter(Boolean).join(" · "),
    ctx.network,
    meeting.venue ? [meeting.venue, meeting.venueCity].filter(Boolean).join(", ") : null,
    weather,
  ]
    .filter((x): x is string => !!x)
    .map((x) => `<li class="sct-pv-chip">${e(x)}</li>`)
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
      `</div>`;
  }

  const updated = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(p.updatedMs || Date.now());

  return (
    `<header class="sct-pv-hero" aria-labelledby="${e(ctx.headingId)}">` +
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
    (chips ? `<ul class="sct-pv-chips">${chips}</ul>` : "") +
    strip +
    `<p class="sct-pv-byline">By the StatChasers NFL staff · Updated ${e(updated)}` +
    (line ? ` · Lines${line.provider ? ` are ${e(line.provider)} numbers via ESPN and` : ""} move - check your book.` : "") +
    `</p>` +
    `</header>`
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

function renderBoard(p: Preview): string {
  if (!p.board.away.length && !p.board.home.length) return "";
  const column = (s: PreviewSide, rows: BoardRow[]) =>
    `<div class="sct-pv-col">` +
    `<h3 class="sct-pv-colhead"><span class="sct-pv-swatch is-${s.key}" aria-hidden="true"></span>${e(s.team.fullName)}</h3>` +
    (rows.length
      ? `<ul class="sct-pv-rows">` +
        rows
          .map(
            (r) =>
              `<li class="sct-pv-row">${verdictChip(r.verdict)}` +
              `<div class="sct-pv-row-body"><p class="sct-pv-row-name">${r.pos === "DST" ? e(r.name) : playerLink(r.name)}` +
              ` <span class="sct-pv-pos">${e(r.pos === "DST" ? "D/ST" : r.pos)}</span></p>` +
              `<p class="sct-pv-row-why">${e(r.reason)}</p></div></li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="sct-pv-empty">No player on this side is rostered in 5% of leagues.</p>`) +
    `</div>`;
  return (
    `<section class="sct-pv-sec" id="start-sit" aria-labelledby="pv-board">` +
    h2("pv-board", "Start/Sit Board") +
    `<p class="sct-pv-lede">Called for half-PPR 12-team leagues. Every player rostered in 5% or more of Sleeper leagues is here, ` +
    `ranked by his half-PPR scoring adjusted for this defense and his team's implied total. ` +
    `<span class="sct-pv-key">${verdictChip("MUST START")} ${verdictChip("START")} ${verdictChip("FLEX")} ${verdictChip("SIT")}</span></p>` +
    `<div class="sct-pv-cols">` +
    column(p.away, p.board.away) +
    column(p.home, p.board.home) +
    `</div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- 4. leverage */

const LEVERAGE_LABEL: Record<Leverage, string> = {
  up: "▲ UPGRADE",
  neutral: "- NEUTRAL",
  down: "▼ DOWNGRADE",
  proof: "- MATCHUP-PROOF",
};

function renderLeverage(p: Preview, ctx: PreviewRenderContext): string {
  if (!p.leverage.length) return "";
  const team = (k: SideKey) => (k === "away" ? p.away : p.home).team;
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-lev">` +
    h2("pv-lev", "Matchup Leverage") +
    `<p class="sct-pv-lede">A points-allowed table says how soft a defense is to a position; this one asks what each player's role meets. ` +
    `A defense that smothers outside receivers can still leak to the slot, so the role column comes first. Roles are the ` +
    `<a href="${e(ctx.usage(p.away.team))}">${e(p.away.team.nickname)}</a> and ` +
    `<a href="${e(ctx.usage(p.home.team))}">${e(p.home.team.nickname)}</a> Usage Reports' numbers` +
    `${p.usageThrough ? ` through Week ${p.usageThrough}` : ""}; points allowed are half-PPR.</p>` +
    `<div class="sct-pv-scroll"><table class="sct-pv-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col">His role says</th><th scope="col">This defense says</th><th scope="col">Leverage</th></tr></thead>` +
    `<tbody>` +
    p.leverage
      .map(
        (r) =>
          `<tr><th scope="row">${playerLink(r.name)} <span class="sct-pv-pos">${e(`${code(team(r.side))} ${r.pos}`)}</span></th>` +
          `<td>${e(r.role)}</td><td>${e(r.defense)}</td>` +
          `<td><span class="sct-pv-lev is-${r.chip}">${e(LEVERAGE_LABEL[r.chip])}</span></td></tr>`,
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

function tier(rank: number | null): string {
  if (rank === null) return "none";
  if (rank <= 10) return "good";
  if (rank >= 23) return "poor";
  return "mid";
}

function rankChip(rank: number | null, label: string | null, tierOverride?: string): string {
  if (rank === null) return "";
  return `<span class="sct-pv-rank" data-tier="${tierOverride ?? tier(rank)}">${e(label ?? ordinal(rank))}</span>`;
}

function compareRow(
  label: string,
  left: { value: string; rank: number | null; rankLabel?: string | null; tier?: string; best: boolean },
  right: { value: string; rank: number | null; rankLabel?: string | null; tier?: string; best: boolean },
): string {
  const side = (s: typeof left, chipFirst: boolean) => {
    const value = `<span class="sct-pv-cv${s.best ? " is-best" : ""}">${e(s.value)}</span>`;
    const chip = rankChip(s.rank, s.rankLabel ?? null, s.tier);
    return chipFirst ? chip + value : value + chip;
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

  // Fantasy points allowed: green = soft (good for the opposing offense).
  const fpaTier = (rank: number) => (rank <= 10 ? "good" : rank >= 23 ? "poor" : "mid");
  const fpaRows =
    away.fpa && home.fpa
      ? (["QB", "RB", "WR", "TE"] as Pos[])
          .map((pos) => {
            const a = away.fpa!.byPos[pos];
            const h = home.fpa!.byPos[pos];
            const softer = a.fpa === h.fpa ? null : a.fpa > h.fpa ? "a" : "h";
            return compareRow(
              `${pos} pts allowed`,
              { value: one(a.fpa), rank: a.rank, tier: fpaTier(a.rank), best: softer === "a" },
              { value: one(h.fpa), rank: h.rank, tier: fpaTier(h.rank), best: softer === "h" },
            );
          })
          .join("")
      : "";

  if (!teamRows && !fpaRows) return "";
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-snap">` +
    h2("pv-snap", "Matchup Snapshot") +
    `<div class="sct-pv-cards">` +
    (teamRows
      ? `<div class="sct-pv-card"><h3 class="sct-pv-h3">Team profile</h3>` +
        `<table class="sct-pv-compare">${head}<tbody>${teamRows}</tbody></table>` +
        (p.snapshotNote ? `<p class="sct-pv-note">${e(p.snapshotNote)}</p>` : "") +
        `</div>`
      : "") +
    (fpaRows
      ? `<div class="sct-pv-card"><h3 class="sct-pv-h3">Fantasy points allowed by position</h3>` +
        `<table class="sct-pv-compare">${head}<tbody>${fpaRows}</tbody></table>` +
        (p.fpaNote
          ? `<p class="sct-pv-note">${e(p.fpaNote)}` +
            (ctx.fpaUrl ? ` <a href="${e(ctx.fpaUrl)}">Full Fantasy Points Allowed table</a>.` : "") +
            `</p>`
          : "") +
        `</div>`
      : "") +
    `</div>` +
    `</section>`
  );
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
    h2("pv-inj", "Injury Watch: the fantasy fallout") +
    `<p class="sct-pv-lede">Designations and practice notes from the official report via Sleeper; each line says what the injury changes for lineups.</p>` +
    `<div class="sct-pv-cards">${card(p.away)}${card(p.home)}</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- 7. h2h */

function renderH2h(p: Preview, ctx: PreviewRenderContext): string {
  const h = p.h2h;
  if (!h) return "";
  const stat = (value: string, label: string) =>
    `<div class="sct-pv-stat"><span class="sct-pv-stat-v">${e(value)}</span><span class="sct-pv-stat-k">${e(label)}</span></div>`;
  const cards = h.games
    .slice(0, 10)
    .map((m) => {
      const s = m.score!;
      const homeWon = s.home > s.away;
      const awayWon = s.away > s.home;
      return (
        `<li><a class="sct-pv-game" href="${e(ctx.game(m))}">` +
        `<span class="sct-pv-game-when">${e(`${m.season} · ${m.weekLabel}`)}</span>` +
        `<span class="sct-pv-game-line${awayWon ? " is-win" : ""}">${e(code(m.away))} <b>${s.away}</b></span>` +
        `<span class="sct-pv-game-line${homeWon ? " is-win" : ""}">@${e(code(m.home))} <b>${s.home}</b></span>` +
        `</a></li>`
      );
    })
    .join("");
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-h2h">` +
    h2("pv-h2h", "Head-to-Head") +
    `<div class="sct-pv-stats">` +
    stat(h.record, `Series since ${h.since}`) +
    (h.avgPoints !== null ? stat(one(h.avgPoints), h.avgVsTotal ? `Avg combined points. ${h.avgVsTotal}` : "Avg combined points") : "") +
    (h.third ? stat(h.third.value, h.third.label) : "") +
    `</div>` +
    `<p class="sct-pv-lede">${e(h.lede)}</p>` +
    `<ol class="sct-pv-games" aria-label="Recent meetings">${cards}</ol>` +
    `<p class="sct-pv-more"><a href="#series-history">Full series history →</a></p>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ 8. CTA */

function renderCta(ctx: PreviewRenderContext): string {
  return (
    `<section class="sct-pv-cta" aria-label="Redraft Command">` +
    `<div><p class="sct-pv-cta-h">Lineup still not set?</p>` +
    `<p>The board above makes the call for a typical league. Redraft Command weighs these same players against your actual roster and bench, the roster-specific calls this page can't answer for you.</p></div>` +
    `<a class="sct-pv-cta-btn" href="${e(ctx.redraftUrl)}" data-cta="preview-redraft">Open Redraft Command</a>` +
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

export function previewFaq(p: Preview, ctx: PreviewRenderContext): PreviewFaq[] {
  const { away, home, meeting, line } = p;
  const items: PreviewFaq[] = [];
  const pair = `${away.team.nickname} vs ${home.team.nickname}`;
  const plain = (question: string, answer: string, extraHtml = "") =>
    items.push({ question, answer, html: e(answer) + extraHtml });

  // 1. Time and channel.
  const where = meeting.venue ? ` at ${meeting.venue}${meeting.venueCity ? ` in ${meeting.venueCity}` : ""}` : "";
  plain(
    `What time and channel is ${pair} in ${meeting.weekLabel}?`,
    `The ${away.team.fullName} play the ${home.team.fullName} on ${ctx.date}${ctx.time ? ` at ${ctx.time}` : ""}` +
      `${ctx.network ? ` on ${ctx.network}` : ""}${where}.`,
  );

  // 2. Who to start.
  const names = (rows: BoardRow[], v: Verdict) =>
    rows.filter((r) => r.verdict === v).map((r) => r.name);
  const all = [...p.board.away, ...p.board.home];
  if (all.length) {
    const parts = [
      ["Must start", names(all, "MUST START")],
      ["Start", names(all, "START")],
      ["Flex", names(all, "FLEX")],
      ["Sit", names(all, "SIT")],
    ]
      .filter(([, list]) => (list as string[]).length)
      .map(([label, list]) => `${label}: ${(list as string[]).join(", ")}.`);
    const answer =
      `In half-PPR 12-team leagues for ${away.team.nickname} at ${home.team.nickname}, ${meeting.weekLabel} ${meeting.season}: ${parts.join(" ")}` +
      ` The calls weigh each player's half-PPR scoring against what this defense allows at his position and his team's implied total.`;
    plain(`Who should I start in ${pair}?`, answer, ` <a href="#start-sit">See the full Start/Sit board</a>.`);
  }

  // 3. Spread and total.
  if (line && line.spread !== null && line.total !== null && away.implied !== null && home.implied !== null) {
    const fav = line.spread < 0 ? home : line.spread > 0 ? away : null;
    const size = Math.abs(line.spread);
    const open =
      line.spreadOpen !== null ? ` (opened ${favLine(line.spreadOpen, away.team, home.team)})` : "";
    plain(
      `What is the spread and over/under for ${pair}?`,
      (fav
        ? `The ${fav.team.nickname} are ${exact(size)}-point favorites${open}`
        : `The game is a pick'em${open}`) +
        ` with a total of ${exact(line.total)}${line.totalOpen !== null ? ` (opened ${exact(line.totalOpen)})` : ""}` +
        `${line.provider ? ` at ${line.provider}` : ""}. That implies ${exact(home.implied)} points for the ${home.team.nickname}` +
        `${home.impliedRank ? ` (${implyRank(home.impliedRank, p.slateCount, meeting.week)})` : ""} and ${exact(away.implied)} for the ${away.team.nickname}` +
        `${away.impliedRank ? ` (${implyRank(away.impliedRank, p.slateCount, meeting.week)})` : ""}. Lines move; check your book.`,
    );
  }

  // 4. The game's top injury question.
  const injured = [...p.injuries.away.map((r) => ({ r, s: away })), ...p.injuries.home.map((r) => ({ r, s: home }))].filter(
    (x) => x.r.chip !== "OK" && x.r.status !== "IR",
  ).sort((x, y) => y.r.rostered - x.r.rostered);
  const top = injured[0];
  if (top) {
    plain(
      `Is ${top.r.name} playing in ${meeting.weekLabel} against the ${top.s.opponent.nickname}?`,
      `${top.r.name} is listed ${top.r.status} for the ${top.s.team.nickname}. ${top.r.fallout}`,
    );
  } else {
    plain(
      `Are there any key injuries for ${pair}?`,
      `No player rostered in 5% or more of fantasy leagues on either team carries a game designation, so every ${away.team.nickname} and ${home.team.nickname} role is available.`,
    );
  }
  return items;
}

function renderFaq(items: PreviewFaq[], p: Preview): string {
  if (!items.length) return "";
  return (
    `<section class="sct-pv-sec" aria-labelledby="pv-faq">` +
    h2("pv-faq", `${p.away.team.nickname} vs ${p.home.team.nickname} FAQ`) +
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
  const links: Array<[string, string]> = [];
  for (const s of [p.away, p.home]) {
    links.push([ctx.hub(s.team), `${s.team.fullName} hub`]);
    const m = ctx.matchups(s.team);
    if (m) links.push([m, `All ${s.team.nickname} matchups`]);
  }
  if (ctx.fpaUrl) links.push([ctx.fpaUrl, "Fantasy Points Allowed"]);
  links.push([ctx.redraftUrl, "Redraft Command"]);
  return (
    `<footer class="sct-pv-foot">` +
    `<ul class="sct-pv-foot-links">${links.map(([href, label]) => `<li><a href="${e(href)}">${e(label)}</a></li>`).join("")}</ul>` +
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

export function renderPreviewBody(p: Preview, ctx: PreviewRenderContext, faq: PreviewFaq[]): string {
  return (
    `<div class="sct-pv">` +
    renderCall(p, ctx) +
    renderBoard(p) +
    renderLeverage(p, ctx) +
    renderSnapshot(p, ctx) +
    renderInjuries(p) +
    renderH2h(p, ctx) +
    renderCta(ctx) +
    renderFaq(faq, p) +
    renderFooter(p, ctx) +
    `</div>`
  );
}

/** Inline style tokens for the root: the two team fills. */
export function previewStyle(ctx: PreviewRenderContext): string[] {
  return [`--pv-away:${ctx.colors.away}`, `--pv-home:${ctx.colors.home}`];
}

