/**
 * The smaller recap-page pieces around the main sections: the "On this page"
 * links, the "What it meant" cards, the highlights video, the betting result,
 * the sidebar's "Before and after", and "Keep exploring".
 *
 * Each is pure and hides itself when its data is missing. The season facts
 * (records, the game before and after) are read from each club's schedule in
 * playing order - regular season, then postseason - and never stored.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import { headshotImg } from "../headshot-html";
import { YT_THUMB_VARIANTS } from "../image-urls";
import type { ScheduleGame } from "../team/schedule";
import type { GameOdds } from "./boxscore";
import { againstSpread, againstTotal, type BettingSeason, type SeasonGame, type Tally3 } from "./season-data";
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

/**
 * The highlights: a click-to-load box. The server sends the thumbnail and a
 * button, never an iframe; client/team.ts swaps the button for the
 * youtube-nocookie player when it is pressed, so nothing from YouTube loads
 * until then. Without scripting the <noscript> link goes to YouTube, and the
 * note under the box links there too, for a player an embed is refused in.
 */
export function renderHighlights(game: ScoreboardGame, video: GameVideo | null): string {
  if (!video || !/^[\w-]{6,20}$/.test(video.youtubeId)) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const id = encodeURIComponent(video.youtubeId);
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const embed = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  const frameTitle = `${video.title} (YouTube video player)`;
  return (
    `<section class="sct-rb-section sct-hl" aria-labelledby="highlights">` +
    // Short, beside the recap that already names the teams (mak, 2026-09-30).
    `<h2 class="sct-rb-h2" id="highlights">Game Highlights</h2>` +
    `<div class="sct-hl-box" style="--hl-a:${colors.away.fill};--hl-b:${colors.home.fill}">` +
    `<button type="button" class="sct-hl-play" data-hl-embed="${escapeHtml(embed)}" data-hl-title="${escapeHtml(frameTitle)}" ` +
    `aria-label="${escapeHtml(`Play video: ${video.title}`)}">` +
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
    `</button>` +
    `<noscript><a class="sct-hl-noscript" href="${escapeHtml(watch)}">${escapeHtml(`Watch on YouTube: ${video.title}`)}</a></noscript>` +
    `</div>` +
    `<p class="sct-rb-note sct-hl-note">${escapeHtml(`Official ${video.publisher} highlights · Opens from `)}` +
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

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** What the Betting tab reads beyond the game's own closing line. */
export interface BettingExtras {
  /** The pair's stored meetings with lines, newest first, this one included. */
  meetings: SeasonGame[];
  /** Each club's season against the lines through this game, by abbr. */
  seasons: Record<string, BettingSeason | null>;
}

function record3(t: Tally3): string {
  return `${t.a}${DASH}${t.b}${t.push ? `${DASH}${t.push}` : ""}`;
}

/** "SEA −3", or "Pick'em". */
export function spreadLabel(odds: GameOdds): string {
  return odds.favorite && odds.line > 0 ? `${odds.favorite} ${MINUS}${trim(odds.line)}` : "Pick'em";
}

/**
 * The Betting tab: how the game finished against the closing lines, the
 * implied team totals, the pair's and each club's record against the lines,
 * each club's next game, and the fine print. Results only - no picks, no
 * sportsbook links. Empty (and the tab left out) without a closing spread and
 * total, or with the site-wide switch off.
 */
export function renderBetting(game: ScoreboardGame, odds: GameOdds | null, extras?: BettingExtras | null): string {
  const result = scoreboardResult(game);
  if (!odds || !result || !bettingEnabled() || odds.total === null) return "";
  if (odds.favorite === null && odds.line !== 0) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const pickem = odds.favorite === null || odds.line === 0;
  const fav = pickem ? null : odds.favorite === game.home.abbr ? "home" : odds.favorite === game.away.abbr ? "away" : null;
  if (!pickem && !fav) return "";

  // A. Results against the lines.
  const tiles: Array<{ label: string; value: string; caption: string }> = [];
  if (fav) {
    const dog = fav === "home" ? "away" : "home";
    const cover = result[fav] - result[dog] - odds.line;
    tiles.push({
      label: "Spread",
      value: spreadLabel(odds),
      caption:
        cover === 0
          ? "Push"
          : cover > 0
            ? `${game[fav].short} covered by ${trim(cover)}`
            : `${game[fav].short} failed to cover by ${trim(-cover)}`,
    });
  } else {
    const margin = result.home - result.away;
    tiles.push({
      label: "Spread",
      value: "Pick'em",
      caption: margin === 0 ? "Push" : `${game[margin > 0 ? "home" : "away"].short} won outright`,
    });
  }
  const points = result.away + result.home;
  const off = Math.abs(points - odds.total);
  tiles.push({
    label: "Total",
    value: trim(odds.total),
    caption:
      points === odds.total
        ? `Push: ${points} points scored`
        : `${points > odds.total ? "Over" : "Under"}: ${points} points scored (by ${trim(off)})`,
  });

  const tileHtml =
    `<dl class="sct-rb-alltime sct-bet-tiles">` +
    tiles
      .map(
        (t) =>
          `<div class="sct-rb-at"><dt>${escapeHtml(t.label)}</dt>` +
          `<dd><b class="sct-rb-at-num">${escapeHtml(t.value)}</b>` +
          `<span class="sct-rb-at-cap">${escapeHtml(t.caption)}</span></dd></div>`,
      )
      .join("") +
    `</dl>`;

  // Implied team totals: the favourite (total + spread) / 2, the underdog the rest.
  const implied: Record<"away" | "home", number> = fav
    ? {
        [fav]: (odds.total + odds.line) / 2,
        [fav === "home" ? "away" : "home"]: (odds.total - odds.line) / 2,
      } as Record<"away" | "home", number>
    : { away: odds.total / 2, home: odds.total / 2 };
  const order: Array<"away" | "home"> = fav ? [fav, fav === "home" ? "away" : "home"] : ["away", "home"];
  const diffs = order.map((k) => result[k] - implied[k]);
  const signed = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `${MINUS}${Math.abs(n).toFixed(1)}` : "0.0");
  const impliedTable =
    `<h3 class="sct-rb-h3">Expected vs actual scoring</h3>` +
    `<div class="sct-fp-wrap"><table class="sct-fp-table sct-bet-implied">` +
    `<caption class="sct-rb-sr">Implied team totals against the actual score</caption>` +
    `<thead><tr><th scope="col">Team</th><th scope="col">Implied</th><th scope="col">Actual</th><th scope="col">Difference</th></tr></thead><tbody>` +
    order
      .map((k, i) => {
        const d = diffs[i]!;
        return (
          `<tr><th scope="row" class="sct-fp-player" style="color:${colors[k].ink}">${escapeHtml(game[k].short)}</th>` +
          `<td>${implied[k].toFixed(1)}</td><td>${result[k]}</td>` +
          `<td class="sct-fp-diff${d > 0 ? " is-pos" : d < 0 ? " is-neg" : ""}">${signed(d)}</td></tr>`
        );
      })
      .join("") +
    `</tbody></table></div>`;
  const under = diffs.filter((d) => d < 0).length;
  const over = diffs.filter((d) => d > 0).length;
  const fantasyLink = `<a href="#fantasy">Fantasy tab</a>`;
  const takeaway =
    under === 2
      ? `Both offenses finished under the market's expectation, which matches the low fantasy output in the ${fantasyLink}.`
      : over === 2
        ? `Both offenses beat the market's expectation, and the ${fantasyLink} shows who cashed in.`
        : (() => {
            const hi = order[diffs[0]! >= diffs[1]! ? 0 : 1]!;
            const lo = hi === order[0] ? order[1]! : order[0]!;
            return (
              `${escapeHtml(`The ${game[hi].short} beat their implied total and the ${game[lo].short} fell short of theirs;`)} ` +
              `the ${fantasyLink} has the player lines behind it.`
            );
          })();

  // C. Trends.
  let trends = "";
  if (extras) {
    const priced = extras.meetings.filter((g) => g.odds && g.odds.total !== null).slice(0, 6);
    let seriesLine = "";
    if (priced.length >= 2) {
      const ats: Record<string, Tally3> = { [game.away.abbr]: { a: 0, b: 0, push: 0 }, [game.home.abbr]: { a: 0, b: 0, push: 0 } };
      const ou: Tally3 = { a: 0, b: 0, push: 0 };
      for (const g of priced) {
        for (const club of [game.away.abbr, game.home.abbr]) {
          const c = againstSpread(g, club);
          if (c === "cover") ats[club]!.a += 1;
          else if (c === "fail") ats[club]!.b += 1;
          else if (c === "push") ats[club]!.push += 1;
        }
        const t = againstTotal(g);
        if (t === "over") ou.a += 1;
        else if (t === "under") ou.b += 1;
        else if (t === "push") ou.push += 1;
      }
      const lead = ats[game.home.abbr]!.a > ats[game.away.abbr]!.a ? "home" : "away";
      const ouWord = ou.a > ou.b ? `overs ${ou.a}${DASH}${ou.b}` : ou.b > ou.a ? `unders ${ou.b}${DASH}${ou.a}` : `overs and unders ${ou.a}${DASH}${ou.b}`;
      seriesLine =
        `<p>${escapeHtml(
          `Last ${priced.length} meetings: ${game[lead].short} ${record3(ats[game[lead].abbr]!)} ATS, ${ouWord}${ou.push ? ` (${ou.push} push${ou.push === 1 ? "" : "es"})` : ""}.`,
        )}</p>`;
    }
    const card = (k: "away" | "home"): string => {
      const b = extras.seasons[game[k].abbr];
      if (!b) return "";
      const rows: Array<[string, string]> = [
        ["Against the spread", record3(b.ats)],
        ["Over/under", `${record3(b.ou)}`],
      ];
      if (b.atsFavorite.a + b.atsFavorite.b + b.atsFavorite.push) rows.push(["ATS as favorite", record3(b.atsFavorite)]);
      if (b.atsUnderdog.a + b.atsUnderdog.b + b.atsUnderdog.push) rows.push(["ATS as underdog", record3(b.atsUnderdog)]);
      rows.push([`ATS ${b.venue === "home" ? "at home" : "on the road"}`, record3(b.atsVenue)]);
      return (
        `<div class="sct-bet-card" style="--rb-team:${colors[k].ink}">` +
        `<h4 class="sct-bet-card-name">${escapeHtml(game[k].name)}</h4>` +
        `<dl class="sct-rb-dl">${rows.map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd>`).join("")}</dl>` +
        `</div>`
      );
    };
    const cards = card("away") + card("home");
    if (seriesLine || cards) {
      trends =
        `<h3 class="sct-rb-h3">Betting trends</h3>` +
        seriesLine +
        (cards
          ? `<p class="sct-rb-sub">${escapeHtml(`Each team's ${game.seasonLabel} season through this game. Over/under is overs first.`)}</p>` +
            `<div class="sct-bet-cards">${cards}</div>`
          : "");
    }
  }

  return (
    `<section class="sct-rb-section sct-bet" aria-labelledby="betting">` +
    `<h2 class="sct-rb-h2" id="betting">${escapeHtml(`${game.away.short} vs ${game.home.short} odds and results`)}</h2>` +
    `<p class="sct-rb-sub">How this game finished against the betting lines.</p>` +
    tileHtml +
    impliedTable +
    `<p class="sct-rb-note sct-bet-take">${takeaway}</p>` +
    trends +
    `<div class="sct-bet-fine">` +
    `<p>Lines: ESPN's consensus, captured at kickoff. Individual sportsbooks varied.</p>` +
    `<p>21+. Gambling problem? Call 1-800-GAMBLER. Betting availability depends on your state.</p>` +
    `</div>` +
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

/**
 * One explore column as a sidebar card, in the Before and after card's frame:
 * the winner's next games, which sit under that card rather than in Keep
 * exploring.
 */
export function renderExploreCard(c: ExploreColumn | null): string {
  if (!c || c.games.length === 0) return "";
  return (
    `<section class="sct-rb-card sct-rb-info sct-ex-card" aria-labelledby="sct-rb-next">` +
    `<h3 class="sct-rb-h3" id="sct-rb-next">${escapeHtml(c.title)}</h3>` +
    `<ul class="sct-ex-list">${c.games.map(exploreGame).join("")}</ul>` +
    (c.footer ? `<p class="sct-ex-footer"><a href="${escapeHtml(c.footer.url)}">${escapeHtml(c.footer.text)}</a></p>` : "") +
    `</section>`
  );
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
        (c.note ? `<p class="sct-rb-note sct-ex-note">${escapeHtml(c.note)}</p>` : "") +
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
            `<span class="sct-ex-log-meta">${escapeHtml(`${p.team} · ${p.pos ?? "-"}`)}</span></a></li>`,
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
