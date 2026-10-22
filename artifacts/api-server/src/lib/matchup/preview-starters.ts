/**
 * The "Starters vs the defense" block under the pair page's "Last meeting"
 * cards (mak, 2026-10-22, from a screenshot of another tool): two defense
 * cards, one per side, with fantasy points allowed per game to each position
 * and the rank of that figure; then two starter cards, one per offense, with
 * each starter's season line and a chip for the opposing defense's rank
 * against his position.
 *
 * Starters are Sleeper's depth order on the roster the preview already holds
 * (QB1, RB1-2, WR1-3, TE1); a player designated Out, IR or the like is
 * replaced by the next man up, and a Questionable or Doubtful starter keeps
 * his slot with a badge. Season lines are the player game-log store summed
 * over the season in hand, so they agree with the player pages; a starter
 * with no log this season shows a zero line rather than a blank. Passer
 * rating is the league formula from the Stats tab.
 *
 * Rank 1 = the most fantasy points allowed = the softest matchup, as every
 * other points-allowed figure on the page reads it. Green at 1-5, red at
 * 28-32, like the snapshot's pills.
 */

import { escapeHtml } from "../render";
import { getPlayerProfileUrl } from "../team/links";
import { isOutDesignation, type RosterPlayer } from "../team/roster";
import { ordinal } from "../team/stats";
import { loadGameLogs } from "../player/data";
import { passerRating } from "../player/stats-profile";
import type { ProductionTotals } from "../player/player-data";
import type { GameLogEntry } from "../player/types";
import type { Pos, Preview, PreviewSide } from "./preview";

const e = escapeHtml;
const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE"];
/** Slots per position, in the order the card lists them. */
const SLOTS: Array<{ pos: Pos; n: number }> = [
  { pos: "QB", n: 1 },
  { pos: "RB", n: 2 },
  { pos: "WR", n: 3 },
  { pos: "TE", n: 1 },
];

function tier(rank: number): string {
  return rank <= 5 ? "good" : rank >= 28 ? "poor" : "mid";
}

/** The season summed from the game-log store; zeros when there is none. */
function seasonTotals(logs: GameLogEntry[] | undefined): ProductionTotals & { games: number } {
  const t = { games: 0, passCmp: 0, passAtt: 0, passYd: 0, passTd: 0, passInt: 0, rushAtt: 0, rushYd: 0, rushTd: 0, tgt: 0, rec: 0, recYd: 0, recTd: 0 };
  for (const g of logs ?? []) {
    if (g.game_status && g.game_status !== "active") continue;
    const s = g.stats;
    const played =
      (s.pass_att ?? 0) + (s.rush_att ?? 0) + (s.rec_tgt ?? 0) + (s.off_snp ?? 0) > 0;
    if (!played) continue;
    t.games += 1;
    t.passCmp += s.pass_cmp ?? 0;
    t.passAtt += s.pass_att ?? 0;
    t.passYd += s.pass_yd ?? 0;
    t.passTd += s.pass_td ?? 0;
    t.passInt += s.pass_int ?? 0;
    t.rushAtt += s.rush_att ?? 0;
    t.rushYd += s.rush_yd ?? 0;
    t.rushTd += s.rush_td ?? 0;
    t.tgt += s.rec_tgt ?? 0;
    t.rec += s.rec ?? 0;
    t.recYd += s.rec_yd ?? 0;
    t.recTd += s.rec_td ?? 0;
  }
  return t;
}

const perGame = (total: number, games: number): string => (games > 0 ? (total / games).toFixed(1) : "-");
const ratio = (a: number, b: number): string => (b > 0 ? (a / b).toFixed(2) : "-");

/** The five figures a slot shows, by position: label and value pairs. */
function statCells(pos: Pos, t: ReturnType<typeof seasonTotals>): Array<[string, string]> {
  const g: [string, string] = ["G", String(t.games)];
  if (pos === "QB") {
    const rating = passerRating(t);
    return [g, ["ATT", String(t.passAtt)], ["YPG", perGame(t.passYd, t.games)], ["TD", String(t.passTd)], ["RATING", rating === null ? "-" : rating.toFixed(1)]];
  }
  if (pos === "RB") {
    return [g, ["ATT", String(t.rushAtt)], ["YPG", perGame(t.rushYd, t.games)], ["TD", String(t.rushTd + t.recTd)], ["YPC", ratio(t.rushYd, t.rushAtt)]];
  }
  return [g, ["TGT", String(t.tgt)], ["YPG", perGame(t.recYd, t.games)], ["TD", String(t.recTd + t.rushTd)], ["Y/TGT", ratio(t.recYd, t.tgt)]];
}

/**
 * The starters at a position: Sleeper's depth order with the unavailable
 * skipped, so an Out RB1 hands his slot to the RB2 and the card never lists
 * a player who will not play. Unlisted players (no depth order) come last.
 */
function starters(roster: RosterPlayer[], pos: Pos, n: number): RosterPlayer[] {
  return roster
    .filter((r) => r.position === pos && !isOutDesignation(r.injuryStatus))
    .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99) || (a.searchRank ?? 9999) - (b.searchRank ?? 9999))
    .slice(0, n);
}

/** "Q" for Questionable, "D" for Doubtful, nothing otherwise. */
function badge(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "questionable") return `<span class="sct-mu-st-badge is-q" title="Questionable">Q</span>`;
  if (s === "doubtful") return `<span class="sct-mu-st-badge is-d" title="Doubtful">D</span>`;
  return "";
}

function defenseCard(side: PreviewSide, maxByPos: Record<Pos, number>, season: number): string {
  const fpa = side.fpa!;
  const rows = POSITIONS.map((pos) => {
    const { fpa: pts, rank } = fpa.byPos[pos];
    const width = maxByPos[pos] > 0 ? Math.round((pts / maxByPos[pos]) * 100) : 0;
    return (
      `<tr><th scope="row">${pos}</th>` +
      `<td><span class="sct-pv-rank" data-tier="${tier(rank)}">${e(ordinal(rank))}</span></td>` +
      `<td class="sct-mu-st-bar"><span class="sct-pv-cbar" aria-hidden="true"><i data-tier="${tier(rank)}" style="width:${width}%"></i></span></td>` +
      `<td class="sct-mu-st-num">${pts.toFixed(1)}</td></tr>`
    );
  }).join("");
  const abbr = side.team.code.toUpperCase();
  const opp = side.opponent.code.toUpperCase();
  return (
    `<div class="sct-pv-card sct-mu-st-card">` +
    `<h3 class="sct-pv-colhead"><span>${e(abbr)} Defense</span>` +
    `<span class="sct-mu-st-sub">FP/G allowed · ${season} · facing ${e(opp)}</span></h3>` +
    `<table class="sct-mu-st-def"><caption class="sct-visually-hidden">Fantasy points per game the ${e(side.team.fullName)} defense allows, by position</caption>` +
    `<thead class="sct-visually-hidden"><tr><th scope="col">Position</th><th scope="col">Rank</th><th scope="col"></th><th scope="col">Points per game</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `</div>`
  );
}

function offenseCard(side: PreviewSide, season: number): string {
  const logs = loadGameLogs(season);
  const defense = side.opponent.code.toUpperCase();
  const rows = SLOTS.flatMap(({ pos, n }) =>
    starters(side.roster, pos, n).map((r, i) => {
      const slot = n === 1 ? pos : `${pos}${i + 1}`;
      const url = getPlayerProfileUrl(r.name);
      const who = url ? `<a href="${e(url)}">${e(r.name)}</a>` : e(r.name);
      const cells = statCells(pos, seasonTotals(logs[r.id]));
      return (
        `<tr><th scope="row" class="sct-mu-st-slot">${e(slot)}</th>` +
        `<td class="sct-mu-st-who">${who}${badge(r.injuryStatus)}<span class="sct-mu-st-vs" data-pos="${pos}"></span></td>` +
        cells.map(([k, v]) => `<td class="sct-mu-st-stat"><span class="sct-mu-st-k">${e(k)}</span> <b>${e(v)}</b></td>`).join("") +
        `</tr>`
      );
    }),
  );
  return (
    `<div class="sct-pv-card sct-mu-st-card">` +
    `<h3 class="sct-pv-colhead"><span>${e(side.team.code.toUpperCase())} starters</span>` +
    `<span class="sct-mu-st-sub">${season} season · vs ${e(defense)}</span></h3>` +
    `<table class="sct-mu-st-off"><caption class="sct-visually-hidden">${e(side.team.fullName)} starters and their ${season} season lines</caption>` +
    `<tbody>${rows.join("")}</tbody></table>` +
    `</div>`
  );
}

/**
 * The block, or nothing when either side is missing its points-allowed row
 * or its roster (a bye week's opponent, a preseason pair).
 */
export function renderPreviewStarters(p: Preview): string {
  const { away, home, meeting } = p;
  if (!away.fpa || !home.fpa || !away.roster.length || !home.roster.length) return "";
  const season = meeting.season;
  const maxByPos = Object.fromEntries(
    POSITIONS.map((pos) => [pos, Math.max(away.fpa!.byPos[pos].fpa, home.fpa!.byPos[pos].fpa)]),
  ) as Record<Pos, number>;

  // The chip beside each starter names the opposing defense's rank against
  // his position; filled here, where both sides' rows are in hand.
  const withChips = (html: string, opp: PreviewSide): string =>
    html.replace(/<span class="sct-mu-st-vs" data-pos="(QB|RB|WR|TE)"><\/span>/g, (_m, pos: Pos) => {
      const { rank } = opp.fpa!.byPos[pos];
      return `<span class="sct-mu-st-vs" data-tier="${tier(rank)}">vs ${e(ordinal(rank))} ${pos} D</span>`;
    });

  const awayCode = away.team.code.toUpperCase();
  const homeCode = home.team.code.toUpperCase();
  return (
    `<section class="sct-pv-sec sct-mu-starters" aria-labelledby="sct-mu-st-h">` +
    `<h2 class="sct-h2 sct-pv-h2" id="sct-mu-st-h">${e(`${away.team.nickname} vs ${home.team.nickname} Starters vs the Defense`)}</h2>` +
    `<div class="sct-pv-cards">${defenseCard(away, maxByPos, season)}${defenseCard(home, maxByPos, season)}</div>` +
    `<p class="sct-mu-st-note">1st = the most fantasy points allowed = the softest matchup for the offense facing it. Full ${season} season per-game averages.</p>` +
    `<div class="sct-pv-cards">${withChips(offenseCard(away, season), home)}${withChips(offenseCard(home, season), away)}</div>` +
    `<p class="sct-mu-st-note">Starters by depth chart order with their ${season} season stats; a new starter or rookie can show a zero line. ` +
    `The chip is the opposing defense's rank against that position, green for a soft matchup and red for a tough one. ` +
    `Q and D badges come from this week's injury report; players designated Out are replaced by the next man up. ` +
    `${e(awayCode)} faces the ${e(homeCode)} defense and ${e(homeCode)} faces the ${e(awayCode)} defense.</p>` +
    `</section>`
  );
}
