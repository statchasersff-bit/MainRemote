/**
 * The smaller recap-page pieces around the main sections: the "On this page"
 * links, the "What it meant" cards, the highlights video, the betting result,
 * the sidebar's "Before and after", and "Keep exploring".
 *
 * Each is pure and hides itself when its data is missing. The season facts
 * (records, the game before and after) are read from each club's schedule in
 * playing order - regular season, then postseason - and never stored.
 */

import { playerPhoto, teamPosition } from "./player-cell";
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

  const dog = fav ? (fav === "home" ? "away" : "home") : null;
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const signed = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `${MINUS}${Math.abs(n).toFixed(1)}` : "0.0");

  // A. The result panel (mak, 2026-11-02, second pass): both clubs side by
  // side, away left and home right as the hero and the team stats read, one
  // label column between them. No final score: the header has it. Each club
  // gets its own side of the spread with its own verdict, its implied total,
  // what it scored and the difference, then the two bars on one scale. The
  // total, which both share, closes the grid.
  const sides: Array<"away" | "home"> = ["away", "home"];
  type Verdict = { mark: "yes" | "no" | "push"; text: string };
  const MARK = { yes: "✓", no: "✗", push: "–" } as const;
  const verdictHtml = (v: Verdict): string =>
    `<span class="sct-bet-verdict is-${v.mark}"><span aria-hidden="true">${MARK[v.mark]}</span> ${escapeHtml(v.text)}</span>`;

  const sideSpread: Record<"away" | "home", { line: string; verdict: Verdict }> = { away: { line: "", verdict: { mark: "push", text: "" } }, home: { line: "", verdict: { mark: "push", text: "" } } };
  if (fav && dog) {
    const cover = r1(result[fav] - result[dog] - odds.line);
    sideSpread[fav] = {
      line: `${MINUS}${trim(odds.line)}`,
      verdict: cover === 0 ? { mark: "push", text: "Push" } : cover > 0 ? { mark: "yes", text: `Covered by ${trim(cover)}` } : { mark: "no", text: `Failed by ${trim(-cover)}` },
    };
    sideSpread[dog] = {
      line: `+${trim(odds.line)}`,
      verdict: cover === 0 ? { mark: "push", text: "Push" } : cover < 0 ? { mark: "yes", text: `Covered by ${trim(-cover)}` } : { mark: "no", text: `Failed by ${trim(cover)}` },
    };
  } else {
    const margin = result.home - result.away;
    for (const k of sides) {
      const mine = k === "home" ? margin : -margin;
      sideSpread[k] = {
        line: "PK",
        verdict: mine === 0 ? { mark: "push", text: "Push" } : mine > 0 ? { mark: "yes", text: "Won outright" } : { mark: "no", text: "Lost outright" },
      };
    }
  }
  const points = result.away + result.home;
  const off = r1(Math.abs(points - odds.total));
  const totalVerdict: Verdict =
    points === odds.total
      ? { mark: "push", text: `Push (${points} pts)` }
      : { mark: "yes", text: `${points > odds.total ? "Over" : "Under"} by ${trim(off)} (${points} pts)` };

  // Implied team totals: the favorite (total + spread) / 2, the underdog the
  // rest. The difference is taken from the ROUNDED implied figure the reader
  // sees, so 35 against 24.8 prints +10.2, not the +10.3 the unrounded
  // 24.75 would give.
  const implied: Record<"away" | "home", number> = fav
    ? {
        [fav]: r1((odds.total + odds.line) / 2),
        [fav === "home" ? "away" : "home"]: r1((odds.total - odds.line) / 2),
      } as Record<"away" | "home", number>
    : { away: r1(odds.total / 2), home: r1(odds.total / 2) };
  const order: Array<"away" | "home"> = fav ? [fav, fav === "home" ? "away" : "home"] : ["away", "home"];
  const diffs = order.map((k) => r1(result[k] - implied[k]));
  const diffOf = (k: "away" | "home"): number => r1(result[k] - implied[k]);
  // One scale for both bars, so they compare across teams: the tick is the
  // implied total, the bar end the actual score.
  const scale = Math.max(...sides.flatMap((k) => [implied[k], result[k]])) * 1.08 || 1;
  const pct = (n: number): string => `${Math.max(0, Math.min(100, (n / scale) * 100)).toFixed(1)}%`;
  const diffHtml = (d: number): string =>
    `<b class="sct-fp-diff${d > 0 ? " is-pos" : d < 0 ? " is-neg" : ""}">${signed(d)}</b>`;

  const cell = (k: "away" | "home", inner: string): string =>
    `<span class="sct-bet-cell is-${k}" style="--rb-team:${colors[k].ink}">${inner}</span>`;
  const gridRow = (label: string, inner: (k: "away" | "home") => string, cls = ""): string =>
    `<div class="sct-bet-row${cls ? ` ${cls}` : ""}">` +
    cell("away", inner("away")) +
    `<span class="sct-bet-k">${escapeHtml(label)}</span>` +
    cell("home", inner("home")) +
    `</div>`;
  const strip =
    `<div class="sct-bet-sides">` +
    `<div class="sct-bet-row sct-bet-head">` +
    sides
      .map((k, i) =>
        (i ? `<span class="sct-bet-k" aria-hidden="true"></span>` : "") +
        `<span class="sct-bet-cell is-${k} sct-bet-team" style="--rb-team:${colors[k].ink}">${escapeHtml(game[k].abbr)}</span>`,
      )
      .join("") +
    `</div>` +
    gridRow("Spread", (k) => `<b class="sct-bet-line-v">${escapeHtml(sideSpread[k].line)}</b> ${verdictHtml(sideSpread[k].verdict)}`, "sct-bet-spread") +
    gridRow("Implied", (k) => `<span class="sct-bet-imp-implied">${implied[k].toFixed(1)}</span>`) +
    gridRow("Scored", (k) => `<span class="sct-bet-imp-actual">${result[k]}</span> ${diffHtml(diffOf(k))}`) +
    `<div class="sct-bet-row sct-bet-bars" aria-hidden="true">` +
    sides
      .map(
        (k, i) =>
          (i ? `<span class="sct-bet-k"></span>` : "") +
          `<span class="sct-bet-imp-track is-${k}" style="--rb-team:${colors[k].ink}">` +
          `<span class="sct-bet-imp-fill" style="width:${pct(result[k])}"></span>` +
          `<span class="sct-bet-imp-tick" style="${k === "away" ? "right" : "left"}:${pct(implied[k])}"></span>` +
          `</span>`,
      )
      .join("") +
    `</div>` +
    `<p class="sct-bet-total"><span class="sct-bet-k">Total</span> <b class="sct-bet-line-v">${escapeHtml(trim(odds.total))}</b> ${verdictHtml(totalVerdict)}</p>` +
    `</div>`;
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

  // C. Trends: one bold line with the story the records tell, then one table
  // with both clubs as columns (mak, 2026-11-02; two cards until then), and
  // the two context sentences as captions under it.
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
        `Last ${priced.length} meetings: ${game[lead].short} ${record3(ats[game[lead].abbr]!)} ATS, ${ouWord}${ou.push ? ` (${ou.push} push${ou.push === 1 ? "" : "es"})` : ""}.`;
    }

    const sides: Array<"away" | "home"> = ["away", "home"];
    const seasons = sides.map((k) => extras.seasons[game[k].abbr] ?? null);
    const any = seasons.some((b) => b !== null);
    let table = "";
    let story = "";
    if (any) {
      const n = (t: Tally3): number => t.a + t.b + t.push;
      const cell = (b: BettingSeason | null, pick: (b: BettingSeason) => Tally3 | null): string => {
        const t = b ? pick(b) : null;
        return `<td>${t && n(t) ? escapeHtml(record3(t)) : "–"}</td>`;
      };
      const row = (label: string, pick: (b: BettingSeason) => Tally3 | null): string => {
        // A row nobody has a figure for is left out, as the cards left it out.
        if (!seasons.some((b) => b && pick(b) && n(pick(b)!))) return "";
        return `<tr><th scope="row">${escapeHtml(label)}</th>${seasons.map((b) => cell(b, pick)).join("")}</tr>`;
      };
      const venueCell = (b: BettingSeason | null): string =>
        b && n(b.atsVenue) ? `<td>${escapeHtml(record3(b.atsVenue))} <small>${b.venue === "home" ? "home" : "road"}</small></td>` : `<td>–</td>`;
      table =
        `<div class="sct-fp-wrap"><table class="sct-fp-table sct-bet-trends">` +
        `<caption class="sct-rb-sr">${escapeHtml(`Each team's ${game.seasonLabel} season against the lines through this game`)}</caption>` +
        `<thead><tr><th scope="col"><span class="sct-rb-sr">Record</span></th>` +
        sides.map((k) => `<th scope="col" style="color:${colors[k].ink}">${escapeHtml(game[k].abbr)}</th>`).join("") +
        `</tr></thead><tbody>` +
        row("ATS", (b) => b.ats) +
        row("O/U (overs first)", (b) => b.ou) +
        row("ATS as favorite", (b) => b.atsFavorite) +
        row("ATS as underdog", (b) => b.atsUnderdog) +
        `<tr><th scope="row">ATS at this game's venue</th>${seasons.map(venueCell).join("")}</tr>` +
        `</tbody></table></div>`;

      // The story: the most lopsided record either club carries into the
      // numbers, three games or more. A clean sweep of the total or the
      // spread first; failing that, the widest margin. Both clubs' seasons
      // include this game, so the sentence reads "through this game".
      type Story = { score: number; text: string };
      const candidates: Story[] = [];
      sides.forEach((k, i) => {
        const b = seasons[i];
        if (!b) return;
        const name = game[k].short;
        const consider = (t: Tally3, sweepA: string, sweepB: string, lean: (t: Tally3) => string): void => {
          const games = n(t);
          if (games < 3) return;
          if (t.b === 0 && t.push === 0) candidates.push({ score: 100 + games, text: sweepA.replaceAll("%n", String(games)) });
          else if (t.a === 0 && t.push === 0) candidates.push({ score: 100 + games, text: sweepB.replaceAll("%n", String(games)) });
          else {
            const margin = Math.abs(t.a - t.b) / games;
            if (margin >= 0.5) candidates.push({ score: margin * 10 + games / 10, text: lean(t) });
          }
        };
        consider(
          b.ou,
          `Every ${name} game this season has gone over the total (%n games).`,
          `Every ${name} game this season has gone under the total (%n games).`,
          (t) => `${name} games are ${t.a}${DASH}${t.b} to the over this season.`,
        );
        consider(
          b.ats,
          `The ${name} have covered in all %n games this season.`,
          `The ${name} haven't covered in %n games this season.`,
          (t) => `The ${name} are ${record3(t)} against the spread this season.`,
        );
      });
      candidates.sort((x, y) => y.score - x.score);
      if (candidates[0]) story = `<p class="sct-bet-story"><b>${escapeHtml(candidates[0].text)}</b></p>`;
    }

    // The trends panel (mak, 2026-11-02): the story line is its header, the
    // table under it, the series line its footer. "Overs first" lives in the
    // row label, so the caption only says whose season it is.
    const captions =
      (seriesLine ? `<p class="sct-bet-cap sct-bet-series">${escapeHtml(seriesLine)}</p>` : "") +
      (table ? `<p class="sct-bet-cap">${escapeHtml(`Each team's ${game.seasonLabel} season through this game, including it.`)}</p>` : "");
    if (seriesLine || table) {
      trends =
        `<div class="sct-bet-panel sct-bet-trends-panel">` +
        `<p class="sct-bet-panel-k">Season trends</p>` +
        story +
        table +
        captions +
        `</div>`;
    }
  }

  // Two panels side by side from tablet width up (mak, 2026-11-02): the
  // result card and the trends table are about the same height and the table
  // is three columns wide, so stacking them left half the page empty.
  const resultPanel =
    `<div class="sct-bet-panel sct-bet-result">` +
    `<p class="sct-bet-panel-k">Result</p>` +
    strip +
    `<p class="sct-rb-note sct-bet-take">${takeaway}</p>` +
    `</div>`;

  return (
    `<section class="sct-rb-section sct-bet" aria-labelledby="betting">` +
    `<h2 class="sct-rb-h2" id="betting">${escapeHtml(`${game.away.short} vs ${game.home.short} odds and results`)}</h2>` +
    `<p class="sct-rb-sub">How this game finished against the betting lines.</p>` +
    `<div class="sct-bet-grid${trends ? " has-trends" : ""}">${resultPanel}${trends}</div>` +
    `<div class="sct-bet-fine">` +
    `<p>Lines: the consensus captured at kickoff. Individual sportsbooks varied.</p>` +
    `<p>21+. Gambling problem? Call 1-800-GAMBLER. Betting availability depends on your state.</p>` +
    `</div>` +
    `</section>`
  );
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
