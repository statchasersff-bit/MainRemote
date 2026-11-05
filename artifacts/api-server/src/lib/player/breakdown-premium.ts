/**
 * The premium Game-by-Game Breakdown + Upcoming Matchups (mak's brief,
 * 2026-11-05; the tab's own sections since the same day, when mak approved
 * the redesign and the old cards and fixtures table were removed).
 *
 * Nothing here is a new number or a new sentence. The breakdown rows read
 * buildBreakdownCards() - the same headline, note, tier and season-high
 * the tab's cards print - and the matchup table reads data.upcoming with
 * the tab's own helpers handed in through `deps` (the matchup page link,
 * the kickoff line, the ordinal, the band's word, the FPA link, the
 * Outlook link), so the two versions cannot disagree.
 *
 * Three classifications stay separate, as the brief insists: the row's
 * left accent and the finish pill follow the FANTASY tier (a WR1 week in a
 * loss is still gold); the result badge follows the GAME (a win is green
 * even in a bust week); the matchup rows follow the OPPONENT's
 * points-allowed band.
 *
 * Markup is `scp-bkp-` prefixed throughout and every rule in player.css
 * starts `.scp .scp-bkp`, so nothing here reaches the sections above it.
 */

import { escapeHtml } from "../render";
import { matchupBand, type MatchupBand } from "./header";
import {
  buildBreakdownCards,
  buildGamelogStory,
  statLineFor,
  type BreakdownCard,
} from "./gamelog-sections";
import { SCORING_LABELS } from "./scoring";
import type { PlayerPageData } from "./player-data";
import type { UpcomingGame } from "./upcoming";

/** What the tab hands this block, so the two versions share one computation. */
export interface BreakdownPremiumDeps {
  /** The matchup page for this fixture, as the tab's "View matchup" links it; null when the pair is unknown. */
  matchupHref: (game: UpcomingGame) => string | null;
  /** "Sun · Nov 8 · 1:00 PM ET", degrading to "Time TBD" / "Date TBD" as the tab does. */
  kickoff: (game: UpcomingGame) => string;
  /** "31st" */
  ordinal: (n: number) => string;
  /** "Tough matchup" - the tab's own words per band. */
  bandRead: Record<MatchupBand, string>;
  /** The "fantasy points allowed" link, already rendered as the tab renders it. */
  allowedLink: string;
  /** The Outlook tab, or null when the page has none. */
  outlookHref: string | null;
  /** "New York Jets", for the matchup link's accessible name. */
  teamName: string;
}

const DASH = "–";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number): string => WORDS[n] ?? String(n);

/* ------------------------------------------------------------------- icons */

const svg = (body: string): string =>
  `<svg class="scp-bkp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  clipboard: svg(
    `<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>`,
  ),
  calendar: svg(
    `<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 18h3"/>`,
  ),
  calendarSm: svg(`<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  trophy: svg(
    `<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8.5 21h7M9.5 18h5"/>`,
  ),
  target: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`),
  chart: svg(`<path d="M3 20h18"/><path d="M6 17V11M11 17V6M16 17v-8M21 17V3"/>`),
  steady: svg(`<path d="M3 12h4l3-7 4 14 3-7h4"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
};

/** The gold diagonal stripes at a navy bar's right edge. */
const STRIPES = `<span class="scp-bkp-stripes" aria-hidden="true"></span>`;

function hero(icon: string, title: string, sub: string, id: string): string {
  return (
    `<header class="scp-bkp-hero">` +
    `<span class="scp-bkp-ico">${icon}</span>` +
    `<span class="scp-bkp-rule" aria-hidden="true"></span>` +
    `<div class="scp-bkp-hero-t">` +
    `<h2 class="scp-bkp-title" id="${id}">${escapeHtml(title)}</h2>` +
    `<p class="scp-bkp-sub">${escapeHtml(sub)}</p>` +
    `</div>` +
    STRIPES +
    `</header>`
  );
}

/* --------------------------------------------------------------- breakdown */

/**
 * The performance icon: the season high wears the chart, a top-tier week
 * the trophy, a bust the target, a middle week the line. Same rule as the
 * card's tier and seasonHigh - nothing is read from the game's result.
 */
function perfKind(c: BreakdownCard): "high" | "top" | "low" | "mid" {
  if (c.seasonHigh) return "high";
  if (c.tier === "t12") return "top";
  if (c.tier === "low") return "low";
  return "mid";
}
const PERF_ICON = { high: ICON.chart, top: ICON.trophy, low: ICON.target, mid: ICON.steady };

function renderRow(c: BreakdownCard, pos: string): string {
  const { game } = c;
  const at = game.homeAway === "away" ? "@" : "vs";
  const kind = perfKind(c);
  const result = `${game.result.wlt} ${game.result.teamScore}${DASH}${game.result.oppScore}`;
  return (
    `<article class="scp-bkp-row" data-tier="${c.tier}"${c.seasonHigh ? ` data-high="1"` : ""}>` +
    `<div class="scp-bkp-week"><b>${escapeHtml(`Week ${game.week}`)}</b><small>${escapeHtml(c.date)}</small></div>` +
    `<div class="scp-bkp-opp">` +
    `<span class="scp-bkp-ha">${at}</span>` +
    `<b>${escapeHtml(game.opp.abbr)}</b>` +
    (game.opp.logo
      ? `<img class="scp-bkp-logo" src="${escapeHtml(game.opp.logo)}" alt="" aria-hidden="true" width="30" height="30" loading="lazy" decoding="async" />`
      : "") +
    `<span class="scp-sr">${escapeHtml(` ${game.homeAway === "away" ? "at" : "vs"} ${game.opp.nickname}`)}</span>` +
    `</div>` +
    `<div class="scp-bkp-res" data-wlt="${game.result.wlt}"><b>${escapeHtml(result)}</b></div>` +
    `<div class="scp-bkp-perf">` +
    `<span class="scp-bkp-perf-ico" data-kind="${kind}">${PERF_ICON[kind]}</span>` +
    `<div class="scp-bkp-perf-t">` +
    `<h3 class="scp-bkp-head">${escapeHtml(c.headline)}</h3>` +
    `<p class="scp-bkp-line">${escapeHtml(statLineFor(game, pos))}` +
    (c.note ? ` <span class="scp-bkp-rnote">${escapeHtml(c.note)}</span>` : "") +
    `</p>` +
    `</div></div>` +
    `<div class="scp-bkp-fp">` +
    `<span class="scp-bkp-fp-v"><b>${escapeHtml(game.pts.toFixed(1))}</b><small>FPTS</small></span>` +
    `<i class="scp-bkp-fp-sep" aria-hidden="true"></i>` +
    `<span class="scp-bkp-fbadge" data-tier="${c.tier}">${escapeHtml(`${pos}${game.rank}`)}</span>` +
    `</div>` +
    `</article>`
  );
}

function renderBreakdown(data: PlayerPageData, archive: boolean): string {
  const built = buildGamelogStory(data, { archive });
  if (!built) return "";
  const cards = buildBreakdownCards(built.games, built.story);
  if (!cards) return "";
  const pos = built.story.pos;
  const list = cards.cards;
  const id = `bkp-breakdown-${data.logSeason}`;
  const lead = list.filter((c) => c.lead);
  const row = (c: BreakdownCard): string => renderRow(c, pos);

  // A finished season keeps the tab's fold: the notable games, then the
  // rest behind one control.
  const rows = lead.length
    ? `<div class="scp-bkp-rows">${lead.map(row).join("")}</div>` +
      `<details class="scp-bkp-more"><summary>${escapeHtml(`Show all ${list.length} games`)}</summary>` +
      `<div class="scp-bkp-rows">${list.filter((c) => !c.lead).map(row).join("")}</div></details>`
    : `<div class="scp-bkp-rows">${list.map(row).join("")}</div>`;

  return (
    `<section class="scp-bkp-sec scp-bkp-games" aria-labelledby="${id}">` +
    hero(ICON.clipboard, "Game-by-Game Breakdown", "Weekly performance, key takeaways, and fantasy production.", id) +
    `<div class="scp-bkp-body">${rows}</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- upcoming */

function renderUpcoming(data: PlayerPageData, deps: BreakdownPremiumDeps): string {
  const games = data.upcoming;
  if (games.length === 0) return "";
  const pos = data.player.position;
  const id = `bkp-upcoming-${data.logSeason}`;

  const rows = games
    .map((game, index) => {
      const away = game.homeAway === "away";
      const band = game.matchup ? matchupBand(game.matchup.rank) : null;
      const href = deps.matchupHref(game);
      return (
        `<tr class="scp-bkp-nx" data-homeaway="${game.homeAway}"${band ? ` data-band="${band}"` : ""}${index === 0 ? ` data-next="1"` : ""}>` +
        `<th scope="row"><span class="scp-bkp-nx-week">${escapeHtml(`Week ${game.week}`)}</span>` +
        (index === 0 ? `<span class="scp-bkp-next">Next</span>` : "") +
        `</th>` +
        `<td class="scp-bkp-nx-team">` +
        `<span class="scp-bkp-ha" aria-hidden="true">${away ? "@" : "vs"}</span>` +
        `<b class="scp-bkp-nx-code">${escapeHtml(game.opponentCode)}</b>` +
        (game.opponent
          ? `<img class="scp-bkp-logo" src="${escapeHtml(game.opponent.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`
          : "") +
        `<span class="scp-bkp-nx-name"><span class="scp-sr">${away ? "Away at " : "Home vs "}</span>${escapeHtml(game.opponentName)}</span>` +
        `</td>` +
        `<td class="scp-bkp-nx-when"><span class="scp-bkp-nx-cal">${ICON.calendarSm}</span>${escapeHtml(deps.kickoff(game))}</td>` +
        (game.matchup && band
          ? `<td class="scp-bkp-nx-rank"><b data-band="${band}">${escapeHtml(deps.ordinal(game.matchup.rank))}</b>` +
            `<span>${escapeHtml(` vs ${game.matchup.position}`)}</span></td>` +
            `<td class="scp-bkp-nx-read"><span class="scp-bkp-pill" data-band="${band}">${escapeHtml(deps.bandRead[band])}</span>`
          : `<td class="scp-bkp-nx-rank is-none"><span>No matchup rank</span></td><td class="scp-bkp-nx-read">`) +
        (href
          ? `<a class="scp-bkp-cta" href="${escapeHtml(href)}"><span>View matchup</span>` +
            `<span class="scp-sr">${escapeHtml(` - ${deps.teamName} vs ${game.opponentName}`)}</span>${ICON.arrow}</a>`
          : "") +
        `</td>` +
        `</tr>`
      );
    })
    .join("");

  const note =
    `Matchup rank is ${deps.allowedLink} to ` +
    (pos ? escapeHtml(`${pos}s`) : "the position") +
    `, in ${escapeHtml(SCORING_LABELS[data.format])}: 1st allows the most, 32nd the fewest.` +
    (data.upcomingMatchupMode ? escapeHtml(` Measured through ${data.upcomingMatchupMode}.`) : "") +
    (deps.outlookHref
      ? ` For his starting status, playing time and projections, see <a href="${escapeHtml(deps.outlookHref)}">his Outlook tab</a>.`
      : "");

  const sub =
    `Next ${word(games.length)} game${games.length === 1 ? "" : "s"}, matchup difficulty, and ` +
    `${pos ?? "positional"} defensive rankings.`;

  return (
    `<section class="scp-bkp-sec scp-bkp-up" aria-labelledby="${id}">` +
    hero(ICON.calendar, "Upcoming Matchups", sub, id) +
    `<div class="scp-bkp-body">` +
    `<div class="scp-bkp-panel"><div class="scp-bkp-scroll">` +
    `<table class="scp-bkp-table">` +
    `<thead><tr><th scope="col">Wk</th><th scope="col">Opponent</th><th scope="col">Kickoff</th>` +
    `<th scope="col">${escapeHtml(pos ? `vs ${pos}` : "Rank")}</th><th scope="col">Matchup</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `</div></div>` +
    `<p class="scp-bkp-note">${ICON.info}<span>${note}</span></p>` +
    `</div></section>`
  );
}

/* ------------------------------------------------------------------- block */

/**
 * The whole block: the breakdown rows, then the matchup table.
 * An archive season has no fixtures, so it prints the breakdown alone.
 */
export function renderBreakdownPremium(data: PlayerPageData, deps: BreakdownPremiumDeps): string {
  const archive = data.logSeason !== data.season;
  const breakdown = renderBreakdown(data, archive);
  const upcoming = archive ? "" : renderUpcoming(data, deps);
  if (!breakdown && !upcoming) return "";
  return (
    `<div class="scp-bkp-wrap">` +
    breakdown +
    upcoming +
    `</div>`
  );
}
