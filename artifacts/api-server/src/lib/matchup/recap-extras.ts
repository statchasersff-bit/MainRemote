/**
 * The smaller recap-page pieces around the main sections: the "On this page"
 * links, the "What it meant" cards, the highlights video, the betting result,
 * the sidebar's "Before and after", and "Keep exploring".
 *
 * Each is pure and hides itself when its data is missing. The season facts
 * (records, the game before and after) are read from each club's schedule in
 * playing order - regular season, then postseason - and never stored.
 */

import { playerPhoto } from "./player-cell";
import { escapeHtml, escapeJsonLd } from "../render";
import { railHead } from "./rail-head";
import { headshotImg } from "../headshot-html";
import { YT_THUMB_VARIANTS } from "../image-urls";
import type { ScheduleGame } from "../team/schedule";
import { type SeasonGame } from "./season-data";
import type { GameVideo } from "./game-notes";
import { superBowlNumeral } from "./recap";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

const DASH = "–";

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

/**
 * "Week 18: L 24–27 vs 49ers": the club's own score first, the opponent by
 * nickname, as the build spec writes it (7.3).
 */
export function gameLabel(g: ScheduleGame): string {
  const where = g.neutralSite ? "vs" : g.homeAway === "home" ? "vs" : "at";
  const opp = g.opponent?.nickname ?? g.opponentName;
  if (g.result) {
    return `${g.weekLabel}: ${g.result.outcome} ${g.result.teamScore}${DASH}${g.result.opponentScore} ${where} ${opp}`;
  }
  return `${g.weekLabel}: ${where} ${opp}`;
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

export function renderBeforeAfter(game: ScoreboardGame, sides: BeforeAfterSide[], premium = false): string {
  if (sides.length === 0) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const link = (ref: GameRef): string =>
    ref.url ? `<a href="${escapeHtml(ref.url)}">${escapeHtml(ref.label)}</a>` : escapeHtml(ref.label);
  return (
    `<section class="sct-rb-card sct-rb-info sct-ba" aria-labelledby="sct-rb-ba">` +
    railHead("beforeAfter", "sct-rb-ba", "Before and after", premium) +
    sides
      .map((s) => {
        const key = s.abbr === game.home.abbr ? "home" : "away";
        // The new design puts the club's crest before its name, as the
        // next-games tiles do.
        const logo = premium ? game[key].logoUrl : null;
        const crest = logo
          ? `<img class="sct-ba-crest" src="${escapeHtml(logo)}" alt="" width="24" height="24" loading="lazy" decoding="async" />`
          : "";
        return (
          `<div class="sct-ba-team" style="--rb-team:${colors[key].ink}">` +
          `<h4 class="sct-ba-name">${crest}${escapeHtml(s.name)}</h4>` +
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

/**
 * The highlights: a thumbnail box that is one link to the video on YouTube,
 * opened in a new tab. Nothing plays on this page and nothing from YouTube
 * loads here (mak, 2026-11-02; a click-to-load youtube-nocookie player from
 * 2026-09-30 until then). The note under the box links there too.
 */
export function renderHighlights(game: ScoreboardGame, video: GameVideo | null): string {
  if (!video || !/^[\w-]{6,20}$/.test(video.youtubeId)) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const id = encodeURIComponent(video.youtubeId);
  const watch = `https://www.youtube.com/watch?v=${id}`;
  return (
    // No heading: the recap above already names the game (mak, 2026-10-22).
    // The id stays on the section so the jump nav's "Highlights" link lands.
    `<section class="sct-rb-section sct-hl" id="highlights" aria-label="Game highlights">` +
    `<div class="sct-hl-box" style="--hl-a:${colors.away.fill};--hl-b:${colors.home.fill}">` +
    `<a class="sct-hl-play" href="${escapeHtml(watch)}" target="_blank" rel="noopener" ` +
    `aria-label="${escapeHtml(`Watch on YouTube: ${video.title}`)}">` +
    // The thumbnail as this server's 4:3 WebP derivatives of YouTube's
    // hqdefault (lib/image-urls.ts, `yt` source), 320 and 480 wide for the
    // box's widths. A video YouTube has no thumbnail for prints nothing, as
    // the onerror used to arrange after a failed load.
    (headshotImg({
      src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      className: "sct-hl-thumb",
      alt: "",
      variants: YT_THUMB_VARIANTS,
      sizes: "(max-width: 520px) 100vw, 480px",
      width: 480,
      height: 360,
      loading: "lazy",
      extra: ` data-hl-thumb onerror="this.remove()"`,
    }) ?? "") +
    `<span class="sct-hl-icon" aria-hidden="true"></span>` +
    `<span class="sct-hl-caption">${escapeHtml(video.title)}</span>` +
    `</a>` +
    `</div>` +
    `<p class="sct-rb-note sct-hl-note">${escapeHtml(`Official ${video.publisher} highlights · Opens on `)}` +
    `<a href="${escapeHtml(watch)}" target="_blank" rel="noopener">YouTube</a></p>` +
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

/** What the Betting tab reads beyond the game's own closing line. */
export interface BettingExtras {
  /** The pair's stored meetings with lines, newest first, this one included. */
  meetings: SeasonGame[];
}

/* ----------------------------------------------------------- keep exploring */

export interface ExploreGame {
  /** "Rams 30 at Buccaneers 27": built by the caller from the game's own fields. */
  away: { short: string; score: number | null; logo?: string | null };
  home: { short: string; score: number | null; logo?: string | null };
  neutral: boolean;
  meta: string;
  url: string | null;
}

export interface ExploreColumn {
  title: string;
  /** A slate line under the title: how "Similar games" were chosen. */
  note?: string;
  games: ExploreGame[];
  footer?: { text: string; url: string } | null;
}

export interface GameLogLink {
  name: string;
  team: string;
  pos: string | null;
  url: string;
  ink: string;
  /** The image key for his face, or null for the name alone. */
  sleeperId?: string | null;
}

function exploreGame(g: ExploreGame): string {
  const final = g.away.score !== null && g.home.score !== null;
  const win = final ? (g.away.score! > g.home.score! ? "away" : g.home.score! > g.away.score! ? "home" : null) : null;
  const side = (key: "away" | "home"): string => {
    const t = g[key];
    const cls = !final ? "" : win === key ? "is-win" : "is-other";
    // The crest before the name (mak, 2026-11-02), when the caller has one.
    const crest = t.logo
      ? `<img class="sct-ex-crest" src="${escapeHtml(t.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
      : "";
    return `<span class="sct-ex-side ${cls}">${crest}${escapeHtml(t.short)}${t.score === null ? "" : ` ${t.score}`}</span>`;
  };
  const line = `${side("away")} <span class="sct-ex-at">${g.neutral ? "vs" : "at"}</span> ${side("home")}`;
  const body =
    `<span class="sct-ex-line">${line}</span>` + `<span class="sct-ex-meta">${escapeHtml(g.meta)}</span>`;
  return `<li>${g.url ? `<a class="sct-ex-game" href="${escapeHtml(g.url)}">${body}</a>` : `<span class="sct-ex-game">${body}</span>`}</li>`;
}

/**
 * One explore column as a sidebar card, in the Before and after card's frame:
 * the winner's next games, which sit under that card rather than in Keep
 * exploring.
 */
export function renderExploreCard(c: ExploreColumn | null, premium = false): string {
  if (!c || c.games.length === 0) return "";
  return (
    `<section class="sct-rb-card sct-rb-info sct-ex-card" aria-labelledby="sct-rb-next">` +
    railHead("calendar", "sct-rb-next", c.title, premium) +
    `<ul class="sct-ex-list">${c.games.map(exploreGame).join("")}</ul>` +
    (c.footer ? `<p class="sct-ex-footer"><a href="${escapeHtml(c.footer.url)}">${escapeHtml(c.footer.text)}</a></p>` : "") +
    `</section>`
  );
}

/** One club's column in "More on this game". */
export interface ExploreTeam {
  abbr: string;
  name: string;
  short: string;
  ink: string;
  logo?: string | null;
  hub: string | null;
  matchups: string | null;
  /** Where "All {short} players" goes: the Fantasy tab's table, or null. */
  allPlayers?: string | null;
}

/**
 * "More on this game" (mak, 2026-11-02): one section with the club as the
 * axis. Two mirrored columns, each the crest and name, the two hub links as
 * one line of text, then that club's players as chips to their game logs.
 * Eight loose cards and four loose buttons until then.
 */
export function renderExplore(
  columns: ExploreColumn[],
  logs: { season: string; players: GameLogLink[] },
  teams: ExploreTeam[],
  related: string,
): string {
  const cols = columns
    .filter((c) => c.games.length)
    .map(
      (c) =>
        `<div class="sct-ex-col">` +
        `<h3 class="sct-rb-h3">${escapeHtml(c.title)}</h3>` +
        (c.note ? `<p class="sct-rb-note sct-ex-note">${escapeHtml(c.note)}</p>` : "") +
        `<ul class="sct-ex-list">${c.games.map(exploreGame).join("")}</ul>` +
        (c.footer ? `<p class="sct-ex-footer"><a href="${escapeHtml(c.footer.url)}">${escapeHtml(c.footer.text)}</a></p>` : "") +
        `</div>`,
    )
    .join("");

  const chip = (p: GameLogLink): string =>
    `<li><a class="sct-ex-chip" href="${escapeHtml(p.url)}" title="${escapeHtml(`${p.name}, ${logs.season} game log`)}">` +
    (p.sleeperId ? playerPhoto(p.sleeperId, "sct-ex-chip-face", 24) : "") +
    `<span class="sct-ex-chip-name">${escapeHtml(p.name)}</span>` +
    (p.pos ? `<span class="sct-pos" data-pos="${escapeHtml(p.pos.toUpperCase())}">${escapeHtml(p.pos)}</span>` : "") +
    `</a></li>`;
  const teamCols = teams
    .map((t) => {
      const players = logs.players.filter((p) => p.team.toUpperCase() === t.abbr.toUpperCase());
      const links = [
        t.hub ? `<a href="${escapeHtml(t.hub)}">Team hub</a>` : "",
        t.matchups ? `<a href="${escapeHtml(t.matchups)}">All matchups</a>` : "",
      ].filter(Boolean);
      const crest = t.logo
        ? `<img class="sct-ex-team-crest" src="${escapeHtml(t.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`
        : "";
      return (
        `<div class="sct-ex-team" style="--rb-team:${t.ink}">` +
        `<h4 class="sct-ex-team-name">${crest}${escapeHtml(t.name)}</h4>` +
        (links.length ? `<nav class="sct-ex-hubs" aria-label="${escapeHtml(`${t.short} pages`)}">${links.join(`<span class="sct-ex-dot" aria-hidden="true"> · </span>`)}</nav>` : "") +
        (players.length
          ? `<ul class="sct-ex-chips" aria-label="${escapeHtml(`${t.short} ${logs.season} game logs`)}">${players.map(chip).join("")}</ul>` +
            (t.allPlayers ? `<p class="sct-ex-all"><a href="${escapeHtml(t.allPlayers)}">${escapeHtml(`All ${t.short} players in this game`)}</a></p>` : "")
          : "")
      ) + `</div>`;
    })
    .join("");
  const teamGrid = teamCols
    ? `<h3 class="sct-rb-h3">More on this game</h3><div class="sct-ex-teams">${teamCols}</div>`
    : "";

  if (!cols && !teamGrid && !related) return "";
  return (
    `<section class="sct-rb-section sct-ex" id="explore" aria-label="More on this game">` +
    (cols ? `<div class="sct-ex-cols">${cols}</div>` : "") +
    teamGrid +
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
