/**
 * The completed-game (recap) page's top in the upcoming page's premium design
 * (mak, 2026-11-07: "redesign matchup recap pages ... so it has a more similar
 * design/style as upcoming matchups"). The scoreboard hero (.sct-sbh) gives
 * way to the same navy-to-royal hero the upcoming page wears
 * (preview-premium.ts, .sct-mpp-hero): slanted team-color crest panels, white
 * crest circles, gold dividers, and a facts row (the five KPI cards were removed 2026-11-07 at mak's request). The final
 * score sits under each team's name; the quarter table sits on the seam
 * where the upcoming page has its "@" badge.
 *
 * The page's H1 follows the hero, visually hidden since 2026-11-09 (mak had
 * the title banner and its game-context dek removed); same text, id and
 * data-sct-hero-heading as before.
 *
 * The recap's sections below keep their markup; their premium dress (navy-bar
 * cards, rail cards, tabs) is CSS on `.sct-mu.is-pm` at the end of team.css.
 */

import { escapeHtml } from "../render";
import {
  contrastRatio,
  heroPairColors,
  teamColors,
  tooClose,
  heroPairFills,
  scoreboardBadge,
  scoreboardKickoff,
  scoreboardResult,
  scoreboardTotal,
  type ScoreboardGame,
  type ScoreboardTeam,
} from "./scoreboard-hero";

const e = escapeHtml;

const svg = (d: string, size = 22): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

const ICON = {
  final: svg(`<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8 20h8"/><path d="M9.5 17h5"/>`, 30),
  clock: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  tv: svg(`<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8"/><path d="M9 2l3 4 3-4"/>`),
  venue: svg(`<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>`),
  crowd: svg(`<circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3 19c0-3 2.2-5 5-5s5 2 5 5"/><path d="M11 19c0-3 2.2-5 5-5s5 2 5 5"/>`),
};

export interface RecapTopInput {
  game: ScoreboardGame;
  /** "p" when the other design carries the page's H1 (the comparison). */
  headingTag: "h1" | "h2" | "p";
  headingId: string;
  heading: string;
  /** "Week 1 · September 9, 2026 · Seahawks 13, Patriots 10"; empty prints no dek. */
  context: string;
  /** Each club's hub link, as the page's other team links are written. */
  hub: { away: string | null; home: string | null };
  tv: string | null;
  attendance: number | null;
  breadcrumbRoot: string;
}

type Side = "away" | "home";

/* ------------------------------------------------------------- pieces */

function panel(team: ScoreboardTeam, side: Side): string {
  return (
    `<div class="sct-mpp-panel is-${side}" aria-hidden="true"><span class="sct-mpp-panel-fill"></span>` +
    (team.logoUrl
      ? `<span class="sct-mpp-crest"><img src="${e(team.logoUrl)}" alt="" width="84" height="84" loading="lazy" decoding="async"></span>`
      : "") +
    `</div>`
  );
}

function resultWord(game: ScoreboardGame): string {
  if (game.gameType === "regular") return "Won";
  return /super bowl/i.test(game.roundLabel) ? "Won Super Bowl" : "Won, advanced";
}

function ident(input: RecapTopInput, side: Side): string {
  const { game } = input;
  const team = game[side];
  const result = scoreboardResult(game);
  const total = scoreboardTotal(team);
  const won = result?.winner === side;
  const lost = result !== null && result.winner !== null && !won;
  const label = game.venue?.neutral ? "" : side === "home" ? "Home" : "Away";
  const hub = input.hub[side];
  return (
    `<div class="sct-mpp-ident is-${side}${won ? " is-winner" : ""}${lost ? " is-loser" : ""}">` +
    `<p class="sct-mpp-name">${e(team.name)}</p>` +
    (label || won
      ? `<p class="sct-mpp-rec">${label ? `<span>${label}</span>` : ""}` +
        (won ? `<span class="sct-mpp-won">${e(resultWord(game))}</span>` : "") +
        `</p>`
      : "") +
    (total === null
      ? ""
      : `<p class="sct-mpp-score" aria-label="${e(`${team.short} ${total}`)}">${total}</p>`) +
    (hub ? `<a class="sct-mpp-hub" href="${e(hub)}">Team hub<span aria-hidden="true"> →</span></a>` : "") +
    `</div>`
  );
}

/** Scoring by quarter, the scoreboard's table in a white card on the seam. */
function linescore(game: ScoreboardGame): string {
  if (!game.away.quarters || !game.home.quarters) return "";
  const result = scoreboardResult(game);
  const ot = game.away.ot !== null || game.home.ot !== null;
  const columns = ["Q1", "Q2", "Q3", "Q4", ...(ot ? ["OT"] : [])];
  const cell = (team: ScoreboardTeam, i: number) => {
    const v = team.quarters?.[i];
    return v === undefined ? "–" : String(v);
  };
  const row = (team: ScoreboardTeam, side: Side) => {
    const total = scoreboardTotal(team);
    return (
      `<tr class="is-${side}${result?.winner === side ? " is-winner" : ""}">` +
      `<th scope="row" class="sct-mu-ls-team">${e(team.abbr)}</th>` +
      [0, 1, 2, 3].map((i) => `<td>${cell(team, i)}</td>`).join("") +
      (ot ? `<td>${team.ot === null ? "–" : String(team.ot)}</td>` : "") +
      `<td class="sct-mu-ls-total">${total === null ? "–" : String(total)}</td>` +
      `</tr>`
    );
  };
  return (
    `<div class="sct-mpp-ls">` +
    `<table class="sct-mu-linescore">` +
    `<caption>Scoring by quarter</caption>` +
    `<thead><tr><th scope="col">Team</th>` +
    columns.map((c) => `<th scope="col">${c}</th>`).join("") +
    `<th scope="col" class="sct-mu-ls-total">Final</th></tr></thead>` +
    `<tbody>${row(game.away, "away")}${row(game.home, "home")}</tbody>` +
    `</table>` +
    `</div>`
  );
}

function facts(input: RecapTopInput): string {
  const { game } = input;
  const when = scoreboardKickoff(game);
  const fact = (icon: string, text: string | null) =>
    text ? `<li class="sct-mpp-fact"><span class="sct-mpp-fact-icon">${icon}</span>${e(text)}</li>` : "";
  const venue = game.venue
    ? [game.venue.name, game.venue.city].filter(Boolean).join(", ")
    : null;
  const html =
    fact(ICON.clock, when ? `${when.date} · ${when.time}` : null) +
    fact(ICON.tv, input.tv) +
    fact(ICON.venue, venue) +
    fact(ICON.crowd, input.attendance ? `${input.attendance.toLocaleString("en-US")} attendance` : null);
  return html ? `<ul class="sct-mpp-facts">${html}</ul>` : "";
}

/* --------------------------------------------------------------- page */

/**
 * The breadcrumb, the hero and the banner (with the H1): the recap's top,
 * printed above the tab bar on every tab.
 */
export function renderRecapPremiumTop(input: RecapTopInput): string {
  const { game } = input;
  const result = scoreboardResult(game);
  const tie = result !== null && result.winner === null;
  const eyebrow = `${game.seasonLabel} · ${game.roundLabel}`;
  const joiner = game.venue?.neutral ? "vs" : "at";
  const fills = heroPairFills(game.away.abbr, game.home.abbr);
  return (
    `<div class="sct-mpp is-top is-final">` +
    `<nav class="sct-mpp-crumbs" aria-label="Breadcrumb"><ol>` +
    `<li><a href="${e(input.breadcrumbRoot)}">StatChasers</a></li>` +
    `<li>NFL Matchups</li>` +
    `<li aria-current="page">${e(`${game.away.short} ${joiner} ${game.home.short}, ${game.roundLabel}`)}</li>` +
    `</ol></nav>` +
    // The two clubs' own colors, as the previous scoreboard laid them (mak,
    // 2026-11-07: the forced blue was "overkill"): heroPairFills() picks
    // them, clash handling included.
    `<header class="sct-mpp-hero is-final${tie ? " is-tie" : ""}" data-status="${game.status}" aria-label="${e(`${game.away.name} ${joiner} ${game.home.name}, final`)}"` +
    ` style="${e(`--rh-away:${fills.away};--rh-home:${fills.home}`)}">` +
    `<div class="sct-mpp-decor" aria-hidden="true"><span class="sct-mpp-bands"></span><span class="sct-mpp-topline"></span></div>` +
    `<div class="sct-mpp-match is-final">` +
    panel(game.away, "away") +
    `<p class="sct-mpp-eyebrow"><span class="sct-mpp-badge">${e(scoreboardBadge(game))}</span>${e(eyebrow)}</p>` +
    ident(input, "away") +
    `<span class="sct-mpp-at" aria-hidden="true">${joiner === "at" ? "@" : "vs"}</span>` +
    linescore(game) +
    ident(input, "home") +
    panel(game.home, "home") +
    `</div>` +
    facts(input) +
    `</header>` +
    // The banner under the hero (title + game-context dek) was removed at
    // mak's request, 2026-11-09. The H1 stays in the source for search
    // ([[seo-changes-need-approval]]), visually hidden.
    (input.headingTag === "p"
      ? ""
      : `<${input.headingTag} class="sct-visually-hidden sct-mpp-title" id="${e(input.headingId)}" data-sct-hero-heading>${e(input.heading)}</${input.headingTag}>`) +
    `</div>`
  );
}

/* ------------------------------------------------------ section bars */

function mix(hex: string, to: string, amount: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.replace("#", "").slice(i - 1, i + 1), 16));
  const a = p(hex);
  const b = p(to);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The new design's section bars (mak, 2026-11-07: "use one of the teams
 * colors for the background and the other for the icons/lines", as the title
 * banner pairs navy with gold). The background is the winner's scoreboard
 * color (the home side's on a tie), which already passes AA under white
 * text; the accent is the other club's primary or secondary, lightened in
 * steps until it reads at 3:1 against that background and is not the same
 * hue, else gold.
 */
export function recapBarColors(game: ScoreboardGame): { bg: string; accent: string } {
  const result = scoreboardResult(game);
  const lead: Side = result?.winner ?? "home";
  const other: Side = lead === "home" ? "away" : "home";
  const bg = heroPairColors(game.away.abbr, game.home.abbr)[lead];
  const palette = teamColors[game[other].abbr.toUpperCase()];
  const candidates = palette ? [palette.primary, palette.secondary] : [];
  // The least-lightened color wins: the secondary as it is beats the
  // primary washed out (Commanders gold over burgundy-pink).
  const usable = candidates.filter((c) => /^#[0-9a-f]{6}$/i.test(c) && !tooClose(c, bg));
  for (let step = 0; step <= 6; step += 1) {
    for (const base of usable) {
      const c = mix(base, "#ffffff", step * 0.1);
      if (contrastRatio(c, bg) >= 3) return { bg, accent: c };
    }
  }
  return { bg, accent: "#f0c13b" };
}

/* -------------------------------------------------- section bar icons */

const barSvg = (d: string): string =>
  `<span class="sct-pm-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg></span>`;

/** One icon per section the new design draws as a bar, as the team pages' Coaching bars carry one. */
export const BAR_ICON: Record<string, string> = {
  stats: barSvg(`<path d="M5 19V9"/><path d="M10 19V5"/><path d="M15 19v-7"/><path d="M20 19V8"/>`),
  scoring: barSvg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><path d="M6.5 10h2.5M15 10h2.5M6.5 14h2.5M15 14h2.5"/>`),
  players: barSvg(`<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3"/><path d="M18 14.4c1.9.8 3 2.7 3 5.6"/>`),
  usage: barSvg(`<path d="M12 3v9l7 4"/><circle cx="12" cy="12" r="9"/>`),
  target: barSvg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>`),
  play: barSvg(`<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM8 11l3 3M11 11l-3 3M13 15h3M13 18h3"/>`),
  h2h: barSvg(`<path d="M4 20l7-7"/><path d="M4 13l7 7"/><path d="M20 20l-7-7"/><path d="M20 13l-7 7"/><path d="M8 4h8"/><path d="M12 4v5"/>`),
  calendar: barSvg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  money: barSvg(`<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>`),
  star: barSvg(`<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.2l5.9-.9z"/>`),
  link: barSvg(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  faq: barSvg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>`),
  recap: barSvg(`<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>`),
  why: barSvg(`<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8 20h8"/>`),
  swing: barSvg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  leaders: barSvg(`<circle cx="12" cy="8" r="4"/><path d="M8.5 11.5L7 21l5-3 5 3-1.5-9.5"/>`),
  video: barSvg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>`),
};

const ID_ICON: Record<string, string> = {
  why: "stats",
  "team-stats": "stats",
  "bx-passing": "target",
  "bx-rushing": "play",
  "bx-receiving": "players",
  "bx-defense": "h2h",
  "bx-special-teams": "scoring",
  "bx-advanced": "swing",
  "pbp-scoring": "scoring",
  "pbp-drives": "play",
  "pbp-full": "calendar",
  "sct-rb-scoring": "scoring",
  usage: "target",
  possessions: "play",
  h2h: "h2h",
  "season-to-date": "calendar",
  betting: "money",
  "fantasy-outlook": "star",
  "fantasy-standouts": "star",
  "fantasy-box-score": "stats",
  "fantasy-usage": "usage",
  "fantasy-xfp": "swing",
  "bm-results": "money",
  "bm-implied": "stats",
  "bm-movement": "swing",
  "bm-trends": "calendar",
  faq: "faq",
};

/**
 * The new design's section bars carry an icon box, as the Coaching page's
 * bars do (mak, 2026-11-07). The recap's section markup is shared with the
 * previous design, so the icons go in here, on the rendered HTML, inside each
 * bar heading - an aria-hidden SVG, so the heading's text is unchanged.
 */
export function addBarIcons(html: string): string {
  return html
    .replace(/(<h2 class="sct-rb-h2" id="([^"]+)">)/g, (m, open: string, id: string) =>
      ID_ICON[id] ? open + BAR_ICON[ID_ICON[id]!]! : m,
    )
    .replace(/(<h3 class="sct-rb-h3" id="season-to-date">)/, (open: string) => open + BAR_ICON["calendar"]!)
    .replace(/(<section class="sct-rb-section sct-ex"[^>]*><h3 class="sct-rb-h3">)/, (open: string) => open + BAR_ICON["link"]!)
    .replace(/(<div class="sct-mu-ps-head"><h2 class="sct-h2">)/, (open: string) => open + BAR_ICON["players"]!)
    .replace(/(<section class="sct-block sct-mu-usage"><h2 class="sct-h2">)/, (open: string) => open + BAR_ICON["usage"]!);
}
