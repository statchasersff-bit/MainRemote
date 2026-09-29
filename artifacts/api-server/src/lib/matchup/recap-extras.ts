/**
 * The smaller recap-page pieces around the main sections: the "On this page"
 * links, the "What it meant" cards, the highlights video, the betting result,
 * the sidebar's "Before and after", and "Keep exploring".
 *
 * Each is pure and hides itself when its data is missing. The season facts
 * (records, the game before and after) are read from each club's schedule in
 * playing order — regular season, then postseason — and never stored.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import type { ScheduleGame } from "../team/schedule";
import type { GameOdds } from "./boxscore";
import type { GameVideo } from "./game-notes";
import { superBowlNumeral } from "./recap";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

const DASH = "–";
const MINUS = "−";

/* ------------------------------------------------------------ on this page */

/** Each section the page can carry, in page order, by the id of its heading. */
const JUMPS: Array<[string, string]> = [
  ["sct-mu-story-title", "Recap"],
  ["meant", "What it meant"],
  ["highlights", "Highlights"],
  ["sct-rb-why", "Why they won"],
  ["sct-rb-scoring", "Scoring"],
  ["wp", "Win probability"],
  ["possessions", "Possessions"],
  ["fpts", "Fantasy points"],
  ["verdicts", "Fantasy verdicts"],
  ["stock", "Stock up, stock down"],
  ["h2h", "Head-to-head"],
  ["betting", "Betting"],
  ["sct-rb-outlook", "Fantasy outlook"],
  ["sct-rb-faq", "FAQ"],
  ["explore", "Keep exploring"],
];

/** Links to every section that rendered, found in the page's own markup. */
export function renderJumpNav(html: string, whyLabel = "Why they won"): string {
  const links = JUMPS.filter(([id]) => html.includes(`id="${id}"`)).map(
    ([id, label]) =>
      `<li><a class="sct-jump-link" href="#${id}">${escapeHtml(id === "sct-rb-why" ? whyLabel : label)}</a></li>`,
  );
  if (links.length < 2) return "";
  return (
    `<nav class="sct-jump" aria-label="On this page">` +
    `<span class="sct-jump-label">On this page</span>` +
    `<ul class="sct-jump-list">${links.join("")}</ul>` +
    `</nav>`
  );
}

/* ------------------------------------------------------------ season facts */

function inOrder(games: ScheduleGame[]): ScheduleGame[] {
  return [...games].sort((a, b) =>
    a.seasonType !== b.seasonType ? (a.seasonType === "regular" ? -1 : 1) : a.week - b.week,
  );
}

function record(games: ScheduleGame[]): string {
  let w = 0;
  let l = 0;
  let t = 0;
  for (const g of games) {
    if (!g.result) continue;
    if (g.result.outcome === "W") w += 1;
    else if (g.result.outcome === "L") l += 1;
    else t += 1;
  }
  return `${w}-${l}${t ? `-${t}` : ""}`;
}

/** Wins before the first loss or tie: the 7 in "a 7–0 start". */
function openingStreak(games: ScheduleGame[]): number {
  let n = 0;
  for (const g of games) {
    if (g.seasonType !== "regular" || !g.result) break;
    if (g.result.outcome !== "W") break;
    n += 1;
  }
  return n;
}

function opponentName(g: ScheduleGame): string {
  return g.opponent?.nickname ?? g.opponentName;
}

/** "Week 18: L 24–27 vs 49ers": the club's own score first. */
export function gameLabel(g: ScheduleGame): string {
  const where = g.neutralSite ? "vs" : g.homeAway === "home" ? "vs" : "at";
  if (g.result) {
    return `${g.weekLabel}: ${g.result.outcome} ${g.result.teamScore}${DASH}${g.result.opponentScore} ${where} ${opponentName(g)}`;
  }
  return `${g.weekLabel}: ${where} ${opponentName(g)}`;
}

export interface SeasonSide {
  abbr: string;
  name: string;
  short: string;
  /** The club's whole season: regular season and postseason, any order. */
  games: ScheduleGame[];
}

function position(side: SeasonSide, game: ScoreboardGame): { list: ScheduleGame[]; index: number } {
  const list = inOrder(side.games);
  const kickoff = game.kickoff ? Date.parse(game.kickoff) : null;
  const other = side.abbr === game.home.abbr ? game.away.abbr : game.home.abbr;
  const index = list.findIndex(
    (g) =>
      g.opponent?.code.toUpperCase() === other &&
      (kickoff === null || g.kickoffMs === null || Math.abs(g.kickoffMs - kickoff) < 36 * 3600 * 1000),
  );
  return { list, index };
}

/** The "What it meant" sentence for one club, or null when its season cannot be placed. */
export function meantSentence(side: SeasonSide, game: ScoreboardGame): string | null {
  const result = scoreboardResult(game);
  if (!result) return null;
  const { list, index } = position(side, game);
  if (index < 0) return null;
  const me = side.abbr === game.home.abbr ? "home" : "away";
  const won = result.winner === me;
  const regular = list.filter((g) => g.seasonType === "regular");
  const upTo = list.slice(0, index + 1);

  if (game.gameType === "playoff") {
    if (won) {
      const next = list[index + 1] ?? null;
      const last = list[list.length - 1]!;
      let text = `The ${side.short} (${record(regular)}) advanced`;
      if (next) {
        const where = next.neutralSite ? "against" : next.homeAway === "home" ? "at home against" : "at";
        text += ` to the ${next.weekLabel} ${where} the ${opponentName(next)}`;
        if (next.result) {
          const verb = next.result.outcome === "W" ? "won" : next.result.outcome === "L" ? "lost" : "tied";
          text += `, and ${verb} ${next.result.teamScore}${DASH}${next.result.opponentScore}`;
        }
      }
      text += ".";
      if (last.result && /super bowl/i.test(last.weekLabel)) {
        const season = Number.parseInt(game.seasonLabel, 10);
        text +=
          last.result.outcome === "W"
            ? ` They went on to win Super Bowl ${superBowlNumeral(season)}.`
            : ` They reached Super Bowl ${superBowlNumeral(season)} and lost.`;
      } else if (last !== next && last.result && last.result.outcome === "L" && list.indexOf(last) > index) {
        text += ` Their run ended in the ${last.weekLabel}.`;
      }
      return text;
    }
    const streak = openingStreak(list);
    return (
      `The ${side.short}' season ended at ${record(upTo)}` +
      (streak >= 5 ? ` after a ${streak}${DASH}0 start` : "") +
      `.`
    );
  }

  const next = list[index + 1] ?? null;
  return (
    `Now ${record(upTo)}` +
    (next
      ? `, with the ${opponentName(next)} next in ${next.weekLabel}.`
      : `, and that was the ${side.short}' last game of the regular season.`)
  );
}

export function renderMeantCards(game: ScoreboardGame, sides: SeasonSide[]): string {
  const result = scoreboardResult(game);
  if (!result) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const order = result.winner === "home" ? ["home", "away"] : ["away", "home"];
  const cards = (order as Array<"away" | "home">)
    .map((key) => {
      const side = sides.find((s) => s.abbr === game[key].abbr);
      const text = side ? meantSentence(side, game) : null;
      if (!text) return "";
      return (
        `<div class="sct-meant-card" style="--rb-team:${colors[key].ink}">` +
        `<h3 class="sct-rb-h3">${escapeHtml(`What it meant for the ${game[key].short}`)}</h3>` +
        `<p>${escapeHtml(text)}</p>` +
        `</div>`
      );
    })
    .filter(Boolean);
  return cards.length ? `<div class="sct-meant">${cards.join("")}</div>` : "";
}

/* -------------------------------------------------------- before and after */

export interface GameRef {
  label: string;
  url: string | null;
}

export interface BeforeAfterSide {
  abbr: string;
  name: string;
  prev: GameRef | null;
  next: GameRef | null;
}

/** Each club's game before this one and after it, from its schedule. */
export function beforeAfter(
  side: SeasonSide,
  game: ScoreboardGame,
  url: (g: ScheduleGame) => string | null,
): BeforeAfterSide | null {
  const { list, index } = position(side, game);
  if (index < 0) return null;
  const ref = (g: ScheduleGame | undefined): GameRef | null => (g ? { label: gameLabel(g), url: url(g) } : null);
  return { abbr: side.abbr, name: side.name, prev: ref(list[index - 1]), next: ref(list[index + 1]) };
}

export function renderBeforeAfter(game: ScoreboardGame, sides: BeforeAfterSide[]): string {
  if (sides.length === 0) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const link = (ref: GameRef): string =>
    ref.url ? `<a href="${escapeHtml(ref.url)}">${escapeHtml(ref.label)}</a>` : escapeHtml(ref.label);
  return (
    `<section class="sct-rb-card sct-rb-info sct-ba" aria-labelledby="sct-rb-ba">` +
    `<h3 class="sct-rb-h3" id="sct-rb-ba">Before and after</h3>` +
    sides
      .map((s) => {
        const key = s.abbr === game.home.abbr ? "home" : "away";
        return (
          `<div class="sct-ba-team" style="--rb-team:${colors[key].ink}">` +
          `<h4 class="sct-ba-name">${escapeHtml(s.name)}</h4>` +
          `<dl class="sct-rb-dl">` +
          `<dt>Previous</dt><dd>${s.prev ? link(s.prev) : `<span class="sct-ba-none">Season opener</span>`}</dd>` +
          `<dt>Next</dt><dd>${s.next ? link(s.next) : `<span class="sct-ba-none">Season over</span>`}</dd>` +
          `</dl></div>`
        );
      })
      .join("") +
    `</section>`
  );
}

/* --------------------------------------------------------------- highlights */

export function renderHighlights(game: ScoreboardGame, video: GameVideo | null): string {
  if (!video || !/^[\w-]{6,20}$/.test(video.youtubeId)) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const round = game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
  const id = encodeURIComponent(video.youtubeId);
  const watch = `https://www.youtube.com/watch?v=${id}`;
  return (
    `<section class="sct-rb-section sct-hl" aria-labelledby="highlights">` +
    `<h2 class="sct-rb-h2" id="highlights">${escapeHtml(`${game.away.short} vs ${game.home.short} highlights`)}</h2>` +
    `<p class="sct-rb-sub">${escapeHtml(`Official ${video.publisher} highlights from the ${game.seasonLabel} ${round} game.`)}</p>` +
    `<div class="sct-hl-box" style="--hl-a:${colors.away.fill};--hl-b:${colors.home.fill}">` +
    `<button type="button" class="sct-hl-play" data-yt="${escapeHtml(video.youtubeId)}" ` +
    `data-yt-title="${escapeHtml(video.title)}" aria-label="${escapeHtml(`Play video: ${video.title}`)}">` +
    `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" decoding="async" width="480" height="360" ` +
    `data-hl-thumb>` +
    `<span class="sct-hl-icon" aria-hidden="true"></span>` +
    `<span class="sct-hl-caption">${escapeHtml(video.title)}</span>` +
    `</button>` +
    `<noscript><a class="sct-hl-fallback" href="${escapeHtml(watch)}">${escapeHtml(`Watch "${video.title}" on YouTube`)}</a></noscript>` +
    `</div>` +
    `<p class="sct-rb-note">${escapeHtml(`Video from the ${video.publisher}'s official YouTube channel. It loads only when you press play.`)}</p>` +
    `</section>`
  );
}

/** The VideoObject for the same upload, for the page's JSON-LD graph. */
export function videoSchema(game: ScoreboardGame, video: GameVideo | null): Record<string, unknown> | null {
  if (!video) return null;
  const id = encodeURIComponent(video.youtubeId);
  const round = game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
  return {
    "@type": "VideoObject",
    name: video.title,
    description: `Official highlights of the ${game.seasonLabel} ${round} game between the ${game.away.name} and the ${game.home.name}.`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    uploadDate: video.uploadDate,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    contentUrl: `https://www.youtube.com/watch?v=${id}`,
    publisher: { "@type": "Organization", name: video.publisher },
  };
}

/* ------------------------------------------------------------------ betting */

/** Whether the betting module is on, site-wide. Off with SC_BETTING_RESULTS=off. */
export function bettingEnabled(): boolean {
  return (process.env["SC_BETTING_RESULTS"] ?? "").trim().toLowerCase() !== "off";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function renderBetting(game: ScoreboardGame, odds: GameOdds | null): string {
  const result = scoreboardResult(game);
  if (!odds || !result || !bettingEnabled()) return "";
  const tiles: Array<{ label: string; value: string; caption: string }> = [];
  if (odds.favorite && odds.line > 0) {
    const fav = odds.favorite === game.home.abbr ? "home" : odds.favorite === game.away.abbr ? "away" : null;
    if (fav) {
      const dog = fav === "home" ? "away" : "home";
      const margin = result[fav] - result[dog];
      const cover = margin - odds.line;
      tiles.push({
        label: "Closing spread",
        value: `${game[fav].abbr} ${MINUS}${trim(odds.line)}`,
        caption:
          cover === 0
            ? "Push"
            : cover > 0
              ? `${game[fav].short} covered by ${trim(cover)}`
              : `${game[dog].short} covered by ${trim(-cover)}`,
      });
    }
  } else if (odds.favorite === null && odds.line === 0 && odds.total === null) {
    return "";
  }
  if (odds.total !== null) {
    const points = result.away + result.home;
    tiles.push({
      label: "Closing total",
      value: trim(odds.total),
      caption:
        points === odds.total
          ? `Push: ${points} points scored`
          : `${points > odds.total ? "Over" : "Under"}: ${points} points scored`,
    });
  }
  if (tiles.length === 0) return "";
  return (
    `<section class="sct-rb-section sct-bet" aria-labelledby="betting">` +
    `<h2 class="sct-rb-h2" id="betting">${escapeHtml(`${game.away.short} vs ${game.home.short} betting results`)}</h2>` +
    `<p class="sct-rb-sub">How this game finished against the closing line.</p>` +
    `<dl class="sct-rb-alltime sct-bet-tiles">` +
    tiles
      .map(
        (t) =>
          `<div class="sct-rb-at"><dt>${escapeHtml(t.label)}</dt>` +
          `<dd><b class="sct-rb-at-num">${escapeHtml(t.value)}</b>` +
          `<span class="sct-rb-at-cap">${escapeHtml(t.caption)}</span></dd></div>`,
      )
      .join("") +
    `</dl>` +
    `<p class="sct-rb-note">Consensus closing lines; individual sportsbooks varied. 21+. Gambling problem? Call 1-800-GAMBLER.</p>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- keep exploring */

export interface ExploreGame {
  /** "Rams 30 at Buccaneers 27": built by the caller from the game's own fields. */
  away: { short: string; score: number | null };
  home: { short: string; score: number | null };
  neutral: boolean;
  meta: string;
  url: string | null;
}

export interface ExploreColumn {
  title: string;
  games: ExploreGame[];
  footer?: { text: string; url: string } | null;
}

export interface GameLogLink {
  name: string;
  team: string;
  pos: string | null;
  url: string;
  ink: string;
}

function exploreGame(g: ExploreGame): string {
  const final = g.away.score !== null && g.home.score !== null;
  const win = final ? (g.away.score! > g.home.score! ? "away" : g.home.score! > g.away.score! ? "home" : null) : null;
  const side = (key: "away" | "home"): string => {
    const t = g[key];
    const cls = !final ? "" : win === key ? "is-win" : "is-other";
    return `<span class="sct-ex-side ${cls}">${escapeHtml(t.short)}${t.score === null ? "" : ` ${t.score}`}</span>`;
  };
  const line = `${side("away")} <span class="sct-ex-at">${g.neutral ? "vs" : "at"}</span> ${side("home")}`;
  const body =
    `<span class="sct-ex-line">${line}</span>` + `<span class="sct-ex-meta">${escapeHtml(g.meta)}</span>`;
  return `<li>${g.url ? `<a class="sct-ex-game" href="${escapeHtml(g.url)}">${body}</a>` : `<span class="sct-ex-game">${body}</span>`}</li>`;
}

export function renderExplore(
  columns: ExploreColumn[],
  logs: { season: string; players: GameLogLink[] },
  related: string,
): string {
  const cols = columns
    .filter((c) => c.games.length)
    .map(
      (c) =>
        `<div class="sct-ex-col">` +
        `<h3 class="sct-rb-h3">${escapeHtml(c.title)}</h3>` +
        `<ul class="sct-ex-list">${c.games.map(exploreGame).join("")}</ul>` +
        (c.footer ? `<p class="sct-ex-footer"><a href="${escapeHtml(c.footer.url)}">${escapeHtml(c.footer.text)}</a></p>` : "") +
        `</div>`,
    )
    .join("");
  const logGrid = logs.players.length
    ? `<h3 class="sct-rb-h3">${escapeHtml(`${logs.season} game logs for players in this game`)}</h3>` +
      `<ul class="sct-ex-logs">` +
      logs.players
        .map(
          (p) =>
            `<li><a class="sct-ex-log" href="${escapeHtml(p.url)}" style="--rb-team:${p.ink}">` +
            `<span class="sct-ex-log-name">${escapeHtml(p.name)}</span>` +
            `<span class="sct-ex-log-meta">${escapeHtml(`${p.team} · ${p.pos ?? "—"}`)}</span></a></li>`,
        )
        .join("") +
      `</ul>`
    : "";
  if (!cols && !logGrid && !related) return "";
  return (
    `<section class="sct-rb-section sct-ex" aria-labelledby="explore">` +
    `<h2 class="sct-rb-h2" id="explore">Keep exploring</h2>` +
    (cols ? `<div class="sct-ex-cols">${cols}</div>` : "") +
    logGrid +
    related +
    `</section>`
  );
}

/* -------------------------------------------------------------- breadcrumbs */

export function breadcrumbSchema(
  items: Array<{ name: string; url: string | null }>,
): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

export function jsonLdScript(nodes: Array<Record<string, unknown> | null>): string {
  const graph = nodes.filter((n): n is Record<string, unknown> => n !== null);
  if (graph.length === 0) return "";
  return `<script type="application/ld+json">${escapeJsonLd(
    JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
  )}</script>`;
}
