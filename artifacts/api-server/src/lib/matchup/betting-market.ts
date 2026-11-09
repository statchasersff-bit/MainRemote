/**
 * The completed game's betting market, frozen to that game (mak, 2026-11-08).
 * Printed on the Betting tab UNDER the existing result panel and trends,
 * which are unchanged:
 *
 *   01 Betting Results        spread, total and (with a stored close) moneyline
 *   02 Actual vs Implied      each team's points against what the closing
 *                             spread and total implied (a market estimate)
 *   03 Opening vs Closing     one sportsbook's open and close, with the move
 *   04 Betting Trends         ATS and O/U through THIS game only: season,
 *                             the last five (or fewer), chips, game list
 *
 * Player prop results (the brief's 05) are not built: no stored prop lines.
 *
 * Grading uses the closing spread and total in the stored box score - the same
 * line the rest of the tab and every trend grade against - and the final score
 * with overtime. Opening lines and moneylines come from data/matchup/odds/
 * <season>.json (scripts/matchup/buildGameOdds.mjs, one book), and are shown
 * only when that file's close agrees with the box score's. A market neither
 * source has is left out. No sportsbook name is printed.
 */

import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import { readDataJson } from "../team/read-json";
import type { GameOdds } from "./boxscore";
import { againstSpread, againstTotal, seasonGames, upTo, type SeasonGame } from "./season-data";
import { scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

const e = escapeHtml;
const MINUS = "−";
const DASH = "–";

/* ------------------------------------------------------------------ store */

export interface StoredMarket {
  /** Home-signed: -3 = home favored by 3. */
  spread: number | null;
  total: number | null;
  moneyline: { away: number | null; home: number | null };
}

export interface StoredOdds {
  provider: string | null;
  open: StoredMarket;
  close: StoredMarket;
}

/** One game's stored open and close, or null when the season or game is not stored. */
export function loadGameOdds(season: number, eventId: string | null | undefined): StoredOdds | null {
  if (!eventId) return null;
  const doc = readDataJson<{ games?: Record<string, StoredOdds> }>(dataPath("matchup", "odds", `${season}.json`));
  return doc?.games?.[eventId] ?? null;
}

/* ------------------------------------------------------------------ input */

type Side = "away" | "home";
const SIDES: readonly Side[] = ["away", "home"];

export interface BettingMarketInput {
  game: ScoreboardGame;
  /** The box score's closing line: what everything is graded against. */
  odds: GameOdds;
  stored: StoredOdds | null;
  season: number;
  through: { seasonType: "regular" | "post"; week: number };
  inks: Record<Side, string>;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function american(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : "EVEN";
}

function signedPts(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${trim(r)}` : r < 0 ? `${MINUS}${trim(Math.abs(r))}` : "0";
}

function section(id: string, title: string, body: string, sub = ""): string {
  return (
    `<section class="sct-rb-section sct-bm" aria-labelledby="${id}">` +
    `<h2 class="sct-rb-h2" id="${id}">${e(title)}</h2>` +
    (sub ? `<p class="sct-rb-sub sct-bm-sub">${e(sub)}</p>` : "") +
    body +
    `</section>`
  );
}

/** "SEA −3" for a home-signed spread, "Pick'em" at zero. */
function spreadText(game: ScoreboardGame, homeSigned: number): string {
  if (homeSigned === 0) return "Pick'em";
  const fav = homeSigned < 0 ? game.home.abbr : game.away.abbr;
  return `${fav} ${MINUS}${trim(Math.abs(homeSigned))}`;
}

/** The box score's close as a home-signed spread, or null when its favorite is not one of the two clubs. */
function closeSpread(input: BettingMarketInput): number | null {
  const { odds, game } = input;
  if (odds.favorite === null || odds.line === 0) return 0;
  if (odds.favorite === game.home.abbr) return -odds.line;
  if (odds.favorite === game.away.abbr) return odds.line;
  return null;
}

/** The stored file, only when its close is the line this page grades against. */
function trustedStore(input: BettingMarketInput, spread: number): StoredOdds | null {
  const s = input.stored;
  if (!s) return null;
  return s.close.spread === spread && s.close.total === input.odds.total ? s : null;
}

/* ------------------------------------------------------- 01 results */

function card(kind: string, eyebrow: string, big: string, sub: string, text: string): string {
  return (
    `<div class="sct-bm-card is-${kind}">` +
    `<p class="sct-bm-eyebrow">${e(eyebrow)}</p>` +
    `<p class="sct-bm-big">${big}</p>` +
    (sub ? `<p class="sct-bm-line">${sub}</p>` : "") +
    `<p class="sct-bm-text">${e(text)}</p>` +
    `</div>`
  );
}

function renderResults(input: BettingMarketInput, spread: number, store: StoredOdds | null): string {
  const { game } = input;
  const result = scoreboardResult(game)!;
  const total = input.odds.total!;
  const margin = result.home - result.away;
  const line = Math.abs(spread);
  const favSide: Side | null = spread < 0 ? "home" : spread > 0 ? "away" : null;
  const dogSide: Side | null = favSide ? (favSide === "home" ? "away" : "home") : null;

  // Spread: the favorite's margin against the number.
  let big: string;
  let text: string;
  let kind: string;
  const sub = favSide && dogSide
    ? `${e(game[favSide].abbr)} ${MINUS}${e(trim(line))} · ${e(game[dogSide].abbr)} +${e(trim(line))}`
    : "Pick'em";
  if (favSide && dogSide) {
    const favMargin = result[favSide] - result[dogSide];
    const cover = favMargin - line;
    if (cover === 0) {
      big = "Push";
      kind = "push";
      text = `The ${game[favSide].short} won by exactly ${trim(line)} points. Neither side covered.`;
    } else if (cover > 0) {
      big = `${e(game[favSide].abbr)} covered`;
      kind = "cover";
      text = `The ${game[favSide].short} won by ${favMargin}, covering the ${trim(line)}-point spread by ${trim(cover)}.`;
    } else {
      big = `${e(game[dogSide].abbr)} covered`;
      kind = "cover";
      text =
        favMargin < 0
          ? `The ${game[dogSide].short} won outright as ${trim(line)}-point underdogs.`
          : favMargin === 0
            ? `The game ended tied, so the ${trim(line)}-point underdog ${game[dogSide].short} covered.`
            : `The ${game[favSide].short} won by ${favMargin}, inside the ${trim(line)}-point spread.`;
    }
  } else if (margin === 0) {
    big = "Push";
    kind = "push";
    text = "A pick'em that ended tied. Neither side covered.";
  } else {
    const w: Side = margin > 0 ? "home" : "away";
    big = `${e(game[w].abbr)} covered`;
    kind = "cover";
    text = `A pick'em: the ${game[w].short} won by ${Math.abs(margin)} and covered.`;
  }
  const cards = [card(kind, "Spread result", big, sub, text)];

  const points = result.away + result.home;
  const off = Math.abs(points - total);
  const ou = points > total ? "Over" : points < total ? "Under" : "Push";
  cards.push(
    card(
      ou.toLowerCase(),
      "Game total",
      e(ou),
      `<b>${points}</b> scored <span>/ ${e(trim(total))} line</span>`,
      ou === "Push" ? "Landed exactly on the closing total." : `Finished ${trim(off)} points ${ou === "Over" ? "above" : "below"} the closing total.`,
    ),
  );

  // Moneyline: only with the stored close, and not for a tie.
  const ml = store?.close.moneyline;
  if (ml && ml.away !== null && ml.home !== null && result.winner) {
    const w = result.winner;
    const l: Side = w === "home" ? "away" : "home";
    const price = ml[w]!;
    const favorite = ml[w]! < ml[l]!;
    cards.push(
      card(
        "ml",
        "Moneyline",
        `${e(game[w].short)} won`,
        `${e(game[w].abbr)} ${e(american(ml[w]!))} · ${e(game[l].abbr)} ${e(american(ml[l]!))}`,
        favorite ? `The favorite won at ${american(price)}.` : `The underdog won outright at ${american(price)}.`,
      ),
    );
  }
  return section(
    "bm-results",
    "Betting Results",
    `<div class="sct-bm-cards">${cards.join("")}</div>` +
      `<p class="sct-rb-note sct-bm-note">Closing lines from one sportsbook, graded on the final score, overtime included.</p>`,
  );
}

/* --------------------------------------------- 02 actual vs implied */

function renderImplied(input: BettingMarketInput, spread: number): string {
  const { game } = input;
  const result = scoreboardResult(game)!;
  const total = input.odds.total!;
  const implied: Record<Side, number> = { home: (total - spread) / 2, away: (total + spread) / 2 };
  const scale = Math.max(1, ...SIDES.flatMap((k) => [implied[k], result[k]]));
  const w = (v: number): string => `${Math.max(0, Math.min(100, Math.round((v / scale) * 1000) / 10))}%`;
  const rows = SIDES.map((k) => {
    const diff = result[k] - implied[k];
    return (
      `<li class="sct-bm-imp" style="--bm-team:${input.inks[k]}">` +
      `<div class="sct-bm-imp-head"><span class="sct-bm-imp-name">${e(game[k].name)}</span>` +
      `<span class="sct-bm-imp-diff is-${diff > 0 ? "pos" : diff < 0 ? "neg" : "even"}">${e(signedPts(diff))} pts</span></div>` +
      `<div class="sct-bm-bars">` +
      `<span class="sct-bm-bar is-actual"><span class="sct-bm-bar-label">Actual</span><span class="sct-bm-track"><span class="sct-bm-fill" style="width:${w(result[k])}"></span></span><b>${result[k]}</b></span>` +
      `<span class="sct-bm-bar is-implied"><span class="sct-bm-bar-label">Market implied</span><span class="sct-bm-track"><span class="sct-bm-fill" style="width:${w(implied[k])}"></span></span><b>${e(trim(implied[k]))}</b></span>` +
      `</div></li>`
    );
  }).join("");
  const diffs = SIDES.map((k) => result[k] - implied[k]);
  const lead =
    diffs.every((d) => d < 0)
      ? "Both offenses finished below market expectations."
      : diffs.every((d) => d > 0)
        ? "Both offenses finished above market expectations."
        : (() => {
            const hi: Side = diffs[0]! >= diffs[1]! ? "away" : "home";
            const lo: Side = hi === "away" ? "home" : "away";
            return `The ${game[hi].short} beat their implied total; the ${game[lo].short} fell short of theirs.`;
          })();
  const points = result.away + result.home;
  return section(
    "bm-implied",
    "Actual vs Market-Implied Scoring",
    `<ul class="sct-bm-implist">${rows}</ul>` +
      `<p class="sct-bm-summary"><b>${e(lead)}</b> ${e(`The teams scored ${points} combined points against a closing total of ${trim(total)}.`)}</p>`,
    "Market implied = what the closing spread and total imply for each team. A market estimate, not a StatChasers projection.",
  );
}

/* ------------------------------------------- 03 opening vs closing */

function renderMovement(input: BettingMarketInput, store: StoredOdds): string {
  const { game } = input;
  const { open, close } = store;
  const rows: string[] = [];
  const moves: string[] = [];
  if (open.spread !== null && close.spread !== null) {
    rows.push(`<tr><th scope="row">Spread</th><td>${e(spreadText(game, open.spread))}</td><td>${e(spreadText(game, close.spread))}</td></tr>`);
    const delta = close.spread - open.spread;
    // Home-signed: a rising number moved toward the away side.
    moves.push(
      delta === 0
        ? "Spread: no change"
        : `Spread: ${trim(Math.abs(delta))} pts toward ${delta > 0 ? game.away.abbr : game.home.abbr}`,
    );
  }
  if (open.total !== null && close.total !== null) {
    rows.push(`<tr><th scope="row">Total</th><td>${e(trim(open.total))}</td><td>${e(trim(close.total))}</td></tr>`);
    const delta = close.total - open.total;
    moves.push(delta === 0 ? "Total: no change" : `Total: ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} pts`);
  }
  const ml = (m: StoredMarket): string | null =>
    m.moneyline.away !== null && m.moneyline.home !== null
      ? `${game.away.abbr} ${american(m.moneyline.away)} · ${game.home.abbr} ${american(m.moneyline.home)}`
      : null;
  if (ml(open) && ml(close)) {
    rows.push(`<tr><th scope="row">Moneyline</th><td>${e(ml(open)!)}</td><td>${e(ml(close)!)}</td></tr>`);
  }
  if (rows.length === 0) return "";
  return section(
    "bm-movement",
    "Opening vs Closing Lines",
    `<div class="sct-bm-wrap"><table class="sct-bm-table">` +
      `<caption class="sct-rb-sr">Opening and closing lines at one sportsbook</caption>` +
      `<thead><tr><th scope="col">Market</th><th scope="col">Open</th><th scope="col">Close</th></tr></thead>` +
      `<tbody>${rows.join("")}</tbody></table></div>` +
      (moves.length ? `<ul class="sct-bm-moves">${moves.map((m) => `<li>${e(m)}</li>`).join("")}</ul>` : ""),
    "How the market changed before kickoff, at one sportsbook.",
  );
}

/* --------------------------------------------------- 04 trends */

interface Graded {
  g: SeasonGame;
  ats: "W" | "L" | "P";
  ou: "O" | "U" | "P" | null;
}

function graded(input: BettingMarketInput, club: string): Graded[] {
  const { seasonType, week } = input.through;
  return seasonGames(input.season)
    .filter((g) => (g.away === club || g.home === club) && upTo(g, seasonType, week))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((g) => {
      const c = againstSpread(g, club);
      const t = againstTotal(g);
      return c
        ? { g, ats: c === "cover" ? "W" : c === "fail" ? "L" : "P", ou: t ? (t === "over" ? "O" : t === "under" ? "U" : "P") : null }
        : null;
    })
    .filter((x): x is Graded => x !== null);
}

function record(letters: string[], a: string, b: string): string {
  const n = (l: string): number => letters.filter((x) => x === l).length;
  const p = n("P");
  return `${n(a)}${DASH}${n(b)}${p ? `${DASH}${p}` : ""}`;
}

function chips(letters: string[], label: string): string {
  return (
    `<div class="sct-bm-chiprow"><span class="sct-bm-chiplabel">${e(label)}</span>` +
    `<span class="sct-bm-chips">${letters.map((l) => `<span class="sct-bm-chip is-${l.toLowerCase()}">${l}</span>`).join("")}</span></div>`
  );
}

function renderTrends(input: BettingMarketInput): string {
  const { game } = input;
  const through =
    input.through.seasonType === "post" ? "through this playoff game" : `through Week ${input.through.week}`;
  const cards = SIDES.map((k) => {
    const club = game[k].abbr;
    const list = graded(input, club);
    if (list.length === 0) return "";
    const ats = list.map((x) => x.ats);
    const ou = list.map((x) => x.ou).filter((x): x is "O" | "U" | "P" => x !== null);
    const last = list.slice(-5);
    const n = last.length;
    const lastAts = last.map((x) => x.ats);
    const lastOu = last.map((x) => x.ou).filter((x): x is "O" | "U" | "P" => x !== null);
    const tiles =
      `<div class="sct-bm-tiles">` +
      `<div><span>Season ATS</span><b>${e(record(ats, "W", "L"))}</b></div>` +
      `<div><span>Season O/U</span><b>${e(record(ou, "O", "U"))}</b></div>` +
      (list.length > 1
        ? `<div><span>Last ${n} ATS</span><b>${e(record(lastAts, "W", "L"))}</b></div>` +
          `<div><span>Last ${n} O/U</span><b>${e(record(lastOu, "O", "U"))}</b></div>`
        : "") +
      `</div>`;
    const games = list
      .map((x) => {
        const g = x.g;
        const home = g.home === club;
        const opp = home ? g.away : g.home;
        const us = home ? g.homeScore : g.awayScore;
        const them = home ? g.awayScore : g.homeScore;
        const o = g.odds!;
        const lineNum = o.favorite === null || o.line === 0 ? "PK" : o.favorite === club ? `${MINUS}${trim(o.line)}` : `+${trim(o.line)}`;
        const wk = g.seasonType === "post" ? "Playoffs" : `Wk ${g.week}`;
        return (
          `<tr><td>${e(wk)}</td><td>${home ? "vs" : "@"} ${e(opp)}</td>` +
          `<td>${us > them ? "W" : us < them ? "L" : "T"} ${us}${DASH}${them}</td>` +
          `<td>${e(lineNum)}</td><td><span class="sct-bm-chip is-${x.ats.toLowerCase()}">${x.ats}</span></td>` +
          `<td>${o.total !== null ? e(trim(o.total)) : "-"}</td>` +
          `<td>${x.ou ? `<span class="sct-bm-chip is-${x.ou.toLowerCase()}">${x.ou}</span>` : "-"}</td></tr>`
        );
      })
      .join("");
    return (
      `<div class="sct-bm-team" style="--bm-team:${input.inks[k]}">` +
      `<h3 class="sct-bm-team-name">${e(game[k].name)}</h3>` +
      tiles +
      chips(lastAts, n === list.length && n < 5 ? "ATS form" : `ATS form, last ${n}`) +
      chips(lastOu, n === list.length && n < 5 ? "O/U form" : `O/U form, last ${n}`) +
      `<details class="sct-bm-games"><summary>Game-by-game results</summary>` +
      `<div class="sct-bm-wrap"><table class="sct-bm-table is-games">` +
      `<caption class="sct-rb-sr">${e(`${game[k].name} results against the closing lines ${through}`)}</caption>` +
      `<thead><tr><th scope="col">Week</th><th scope="col">Opp</th><th scope="col">Final</th><th scope="col">Line</th><th scope="col">ATS</th><th scope="col">Total</th><th scope="col">O/U</th></tr></thead>` +
      `<tbody>${games}</tbody></table></div></details>` +
      `</div>`
    );
  }).join("");
  if (!cards) return "";
  return section(
    "bm-trends",
    "Betting Trends",
    `<div class="sct-bm-pair">${cards}</div>` +
      `<p class="sct-rb-note sct-bm-note">Against each game's closing line, oldest to newest, this game last. Pushes are counted separately.</p>`,
    `${input.game.seasonLabel} season ${through}, this game included. Nothing after it counts.`,
  );
}

/* ------------------------------------------------------------------ all */

/** The four sections, or "" without a final score and a closing spread and total. */
export function renderBettingMarket(input: BettingMarketInput): string {
  if (!scoreboardResult(input.game) || input.odds.total === null) return "";
  const spread = closeSpread(input);
  if (spread === null) return "";
  const store = trustedStore(input, spread);
  return (
    `<div class="sct-bm-block" data-bm-root>` +
    renderResults(input, spread, store) +
    renderImplied(input, spread) +
    (store ? renderMovement(input, store) : "") +
    renderTrends(input) +
    `</div>`
  );
}
