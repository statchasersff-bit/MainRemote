/**
 * Play calling and possessions: how each side chose to move the ball, and how
 * every possession ended.
 *
 * The play-calling cards read the team box score (dropbacks are pass attempts
 * plus sacks); the possession table, the notes and the drive chart read ESPN's
 * drive chart. A defensive or return touchdown is not a possession for the side
 * that scored it - the drive it ended is counted as the other side's turnover -
 * and the table says so when one happened.
 *
 * Pure: the game, the figures, the drives and the player lines in, HTML out.
 */

import { escapeHtml } from "../render";
import type { BoxTeamStats, Drive, DriveResult } from "./boxscore";
import type { GamePlayers } from "./game-players";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

export interface PossessionsInput {
  game: ScoreboardGame;
  stats: { away: BoxTeamStats | null; home: BoxTeamStats | null };
  drives: Drive[];
  players: GamePlayers;
  /** "Arizona", "Los Angeles": the side's place, by abbr. */
  places: Record<string, string>;
}

type Side = "away" | "home";

const DASH = "–";

const RESULT_TEXT: Record<DriveResult, string> = {
  td: "Touchdown",
  fg: "Field goal",
  punt: "Punt",
  int: "Interception",
  fumble: "Fumble",
  downs: "Downs",
  missed_fg: "Missed FG",
  safety: "Safety",
  end_half: "End of half",
  end_game: "End of game",
  other: "Other",
};

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function word(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "two-thirds", "half", or a plain percentage when no fraction is close. */
export function shareWords(share: number): string {
  const pct = share * 100;
  const near: Array<[number, string]> = [
    [25, "a quarter"],
    [33.3, "a third"],
    [50, "half"],
    [66.7, "two-thirds"],
    [75, "three-quarters"],
  ];
  for (const [at, text] of near) if (Math.abs(pct - at) <= 2.5) return text;
  return `${Math.round(pct)}%`;
}

interface Calling {
  plays: number | null;
  dropbacks: number | null;
  carries: number | null;
  passRate: number | null;
  perDropback: number | null;
  perCarry: number | null;
  third: string | null;
}

export function playCalling(stats: BoxTeamStats | null): Calling | null {
  if (!stats) return null;
  const att = stats.passAttempts ?? null;
  const sacked = stats.sacked ?? null;
  const dropbacks = att === null ? null : att + (sacked ?? 0);
  const carries = stats.rushAttempts ?? null;
  const passRate =
    dropbacks !== null && carries !== null && dropbacks + carries > 0 ? dropbacks / (dropbacks + carries) : null;
  return {
    plays: stats.plays,
    dropbacks,
    carries,
    passRate,
    perDropback: dropbacks && stats.passYards !== null ? stats.passYards / dropbacks : null,
    perCarry: carries && stats.rushYards !== null ? stats.rushYards / carries : null,
    third: stats.thirdDown ? `${stats.thirdDown.made} of ${stats.thirdDown.attempts}` : null,
  };
}

/** The sentence under the heading, from the two pass rates and the halftime score. */
export function callingSubtitle(input: PossessionsInput): string {
  const { game } = input;
  const away = playCalling(input.stats.away);
  const home = playCalling(input.stats.home);
  if (away?.passRate == null || home?.passRate == null) return "";
  const result = scoreboardResult(game);
  const half = (side: Side): number => (game[side].quarters ?? []).slice(0, 2).reduce((s, n) => s + n, 0);
  const lead = result?.winner ?? null;
  if (lead) {
    const trail: Side = lead === "home" ? "away" : "home";
    const w = lead === "home" ? home : away;
    const l = lead === "home" ? away : home;
    const hw = half(lead);
    const hl = half(trail);
    const opener = hw > hl ? `With a ${hw}${DASH}${hl} halftime lead, the ` : "The ";
    const first =
      w.passRate! < 0.5
        ? `${opener}${game[lead].short} ran the ball on ${shareWords(1 - w.passRate!)} of their plays.`
        : `${opener}${game[lead].short} threw on ${shareWords(w.passRate!)} of their plays.`;
    const second =
      l.passRate! > 0.55
        ? `${input.places[game[trail].abbr] ?? game[trail].short} had to throw on ${shareWords(l.passRate!)} of its own.`
        : `${input.places[game[trail].abbr] ?? game[trail].short} threw on ${shareWords(l.passRate!)} of its own.`;
    return `${first} ${second}`;
  }
  return (
    `The ${game.away.short} threw on ${shareWords(away.passRate)} of their plays, ` +
    `the ${game.home.short} on ${shareWords(home.passRate)}.`
  );
}

function lastName(name: string): string {
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/** "Kupp 39%, Beckham 22%, Higbee 22%": each side's three most-targeted players. */
export function targetLeaders(players: GamePlayers, team: string): string {
  const mine = Object.values(players).filter((p) => p.team === team && (p.stats.recTgt ?? 0) > 0);
  const total = mine.reduce((s, p) => s + (p.stats.recTgt ?? 0), 0);
  if (total === 0) return "";
  return mine
    .sort((a, b) => (b.stats.recTgt ?? 0) - (a.stats.recTgt ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((p) => `${lastName(p.name)} ${Math.round(((p.stats.recTgt ?? 0) / total) * 100)}%`)
    .join(" · ");
}

/**
 * The two teams side by side, one row a measure (mak, 2026-09-30): the better
 * efficiency figure in its team's colour, volume and pass rate neutral.
 */
function comparison(input: PossessionsInput, colors: ReturnType<typeof pairColors>): string {
  const { game } = input;
  const a = playCalling(input.stats.away);
  const h = playCalling(input.stats.home);
  if (!a || !h) return "";
  const third = (st: BoxTeamStats | null): number | null => st?.thirdDown?.percent ?? null;
  type Row = { label: string; away: string | null; home: string | null; better?: "away" | "home" | null };
  const higher = (x: number | null, y: number | null): "away" | "home" | null =>
    x === null || y === null || Math.abs(x - y) < 1e-9 ? null : x > y ? "away" : "home";
  const rows: Row[] = [
    { label: "Plays", away: a.plays === null ? null : String(a.plays), home: h.plays === null ? null : String(h.plays) },
    {
      label: "Pass rate",
      away: a.passRate === null ? null : `${Math.round(a.passRate * 100)}%`,
      home: h.passRate === null ? null : `${Math.round(h.passRate * 100)}%`,
    },
    {
      label: "Yds / dropback",
      away: a.perDropback === null ? null : a.perDropback.toFixed(1),
      home: h.perDropback === null ? null : h.perDropback.toFixed(1),
      better: higher(a.perDropback, h.perDropback),
    },
    {
      label: "Yds / carry",
      away: a.perCarry === null ? null : a.perCarry.toFixed(1),
      home: h.perCarry === null ? null : h.perCarry.toFixed(1),
      better: higher(a.perCarry, h.perCarry),
    },
    {
      label: "Third downs",
      away: a.third === null ? null : a.third.replace(" of ", "/"),
      home: h.third === null ? null : h.third.replace(" of ", "/"),
      better: higher(third(input.stats.away), third(input.stats.home)),
    },
  ];
  const cell = (row: Row, side: Side): string =>
    `<td class="sct-pc-v is-${side}${row.better === side ? " is-better" : ""}">${row[side] === null ? "-" : escapeHtml(row[side]!)}</td>`;
  return (
    `<table class="sct-pc-compare" style="--pc-away:${colors.away.ink};--pc-home:${colors.home.ink}">` +
    `<caption class="sct-rb-sr">${escapeHtml(`Play calling, ${game.away.short} vs ${game.home.short}`)}</caption>` +
    `<thead><tr><th scope="col" class="is-away">${escapeHtml(game.away.name)}</th><th scope="col"><span class="sct-rb-sr">Measure</span></th>` +
    `<th scope="col" class="is-home">${escapeHtml(game.home.name)}</th></tr></thead><tbody>` +
    rows
      .map((row) => `<tr>${cell(row, "away")}<th scope="row">${escapeHtml(row.label)}</th>${cell(row, "home")}</tr>`)
      .join("") +
    `</tbody></table>`
  );
}

/**
 * The takeaway under the comparison: the winner's plays against its
 * efficiency. "Seattle ran 19 fewer plays but gained 2.5 more yards per dropback."
 */
export function callingTakeaway(input: PossessionsInput): string {
  const { game } = input;
  const result = scoreboardResult(game);
  if (!result?.winner) return "";
  const w = result.winner;
  const l: Side = w === "home" ? "away" : "home";
  const ws = playCalling(input.stats[w]);
  const ls = playCalling(input.stats[l]);
  if (!ws || !ls || ws.plays === null || ls.plays === null) return "";
  const who = input.places[game[w].abbr] ?? `The ${game[w].short}`;
  // From the figures as the table prints them, so the sentence and the table agree.
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const edge = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : Math.round((r1(x) - r1(y)) * 10) / 10;
  const ypd = edge(ws.perDropback, ls.perDropback);
  const ypc = edge(ws.perCarry, ls.perCarry);
  const eff =
    ypd !== null && ypd >= 0.5
      ? `gained ${ypd.toFixed(1)} more yards per dropback`
      : ypc !== null && ypc >= 0.5
        ? `gained ${ypc.toFixed(1)} more yards per carry`
        : null;
  const diff = ws.plays - ls.plays;
  if (!eff) {
    return diff === 0 ? "" : `${who} ran ${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} plays than ${input.places[game[l].abbr] ?? `the ${game[l].short}`}.`;
  }
  if (diff < 0) return `${who} ran ${-diff} fewer plays but ${eff}.`;
  if (diff > 0) return `${who} ran ${diff} more plays and ${eff}.`;
  return `${who} ran as many plays and ${eff}.`;
}

/** Which side won the turnover battle, and by how many; null when level. */
function turnoverEdge(input: PossessionsInput): { side: Side; by: number } | null {
  const counts = possessionCounts(input);
  const t = (side: Side): number => (counts[side].int ?? 0) + (counts[side].fumble ?? 0);
  const a = t("away");
  const h = t("home");
  if (a === h) return null;
  return a < h ? { side: "away", by: h - a } : { side: "home", by: a - h };
}

/* ------------------------------------------------------------ possessions */

function sideOf(game: ScoreboardGame, team: string): Side | null {
  return team === game.away.abbr ? "away" : team === game.home.abbr ? "home" : null;
}

export function possessionCounts(input: PossessionsInput): Record<Side, Partial<Record<DriveResult, number>>> {
  const counts: Record<Side, Partial<Record<DriveResult, number>>> = { away: {}, home: {} };
  for (const d of input.drives) {
    const side = sideOf(input.game, d.team);
    if (!side) continue;
    counts[side][d.result] = (counts[side][d.result] ?? 0) + 1;
  }
  return counts;
}

function isEmpty(d: Drive): "three-and-out" | "interception" | "fumble" | null {
  if (d.result === "int") return "interception";
  if (d.result === "fumble") return "fumble";
  if (d.result === "punt" && d.plays <= 3) return "three-and-out";
  return null;
}

/** Up to three observations from the drive chart, each checked against it. */
export function possessionNotes(input: PossessionsInput): string[] {
  const { game, drives } = input;
  const notes: string[] = [];
  const result = scoreboardResult(game);
  const bySide = (side: Side): Drive[] => drives.filter((d) => d.team === game[side].abbr);

  // Who scored first, and on which of their possessions.
  const firstScore = drives.find((d) => d.result === "td" || d.result === "fg");
  if (firstScore) {
    const side = sideOf(game, firstScore.team);
    if (side) {
      const index = bySide(side).indexOf(firstScore);
      notes.push(
        `The ${game[side].short} opened the scoring on their ${ORDINALS[index] ?? `${index + 1}th`} possession, ` +
          `a ${firstScore.plays}-play, ${firstScore.yards}-yard drive that ended in a ` +
          `${firstScore.result === "td" ? "touchdown" : "field goal"}.`,
      );
    }
  }

  // A run of empty possessions from the start.
  for (const side of ["away", "home"] as const) {
    const mine = bySide(side);
    let run = 0;
    const kinds = new Set<string>();
    for (const d of mine) {
      const kind = isEmpty(d);
      if (!kind) break;
      kinds.add(kind);
      run += 1;
    }
    if (run >= 4) {
      const order = ["three-and-out", "interception", "fumble"].filter((k) => kinds.has(k));
      const a = (k: string): string => `${k === "interception" ? "an" : "a"} ${k}`;
      const list =
        order.length === 1 ? a(order[0]!) : `${order.slice(0, -1).map(a).join(", ")} or ${a(order[order.length - 1]!)}`;
      const place = input.places[game[side].abbr] ?? game[side].short;
      notes.push(
        run === mine.length
          ? `Every ${place} possession ended in ${list}.`
          : `${place}'s first ${word(run)} possessions all ended in ${list}.`,
      );
    }
  }

  // How the winner built it and then kept it.
  if (result?.winner) {
    const w = result.winner;
    const mine = bySide(w);
    const early = mine.slice(0, 3).filter((d) => d.result === "td").length;
    const long = mine.filter((d) => d.quarter >= 3 && (d.durationSeconds ?? 0) >= 240);
    const parts: string[] = [];
    if (early >= 2 && mine.length >= 3) parts.push(`scored touchdowns on ${word(early)} of their first three drives`);
    if (long.length >= 2) {
      const mins = long.map((d) => d.durationSeconds! / 60);
      const lo = Math.floor(Math.min(...mins));
      const hi = Math.ceil(Math.max(...mins));
      parts.push(
        `${parts.length ? "then " : ""}drained the clock with ${word(long.length)} second-half drives of ` +
          `${lo === hi ? `about ${word(lo)}` : `${word(lo)} to ${word(hi)}`} minutes`,
      );
    }
    if (parts.length) notes.push(`The ${game[w].short} ${parts.join(", ")}.`);
  }
  return notes.slice(0, 3);
}

export function renderPossessions(input: PossessionsInput): string {
  const { game } = input;
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const compare = comparison(input, colors);
  if (!compare && input.drives.length === 0) return "";
  const take = callingTakeaway(input);
  const shareLines = (["away", "home"] as const)
    .map((side) => {
      const shares = targetLeaders(input.players, game[side].abbr);
      return shares ? `<li><span>${escapeHtml(game[side].abbr)}</span> ${escapeHtml(shares)}</li>` : "";
    })
    .join("");
  const edge = turnoverEdge(input);

  // Possession results as a compact comparison, turnovers marked (mak,
  // 2026-09-30): "Turnovers  NE 3  SEA 0". Interceptions and lost fumbles
  // count together; the rarer endings get a row only when one happened.
  const counts = possessionCounts(input);
  const n = (side: Side, ...results: DriveResult[]): number =>
    results.reduce((sum, r) => sum + (counts[side][r] ?? 0), 0);
  const resultRows: Array<{ label: string; results: DriveResult[]; key?: boolean; always?: boolean }> = [
    { label: "Touchdowns", results: ["td"], always: true },
    { label: "Field goals", results: ["fg"], always: true },
    { label: "Punts", results: ["punt"], always: true },
    { label: "Turnovers", results: ["int", "fumble"], key: true, always: true },
    { label: "Turnovers on downs", results: ["downs"] },
    { label: "Missed field goals", results: ["missed_fg"] },
    { label: "Safeties", results: ["safety"] },
  ];
  const defensive = input.drives.filter((d) => d.defensiveScore);
  const table =
    input.drives.length
      ? `<div class="sct-pc-card is-results">` +
        `<h3 class="sct-rb-h3">Possession results</h3>` +
        `<table class="sct-pc-results" style="--pc-away:${colors.away.ink};--pc-home:${colors.home.ink}">` +
        `<caption class="sct-rb-sr">${escapeHtml(`How each possession ended, ${game.away.short} vs ${game.home.short}`)}</caption>` +
        `<thead><tr><th scope="col"><span class="sct-rb-sr">Result</span></th><th scope="col" class="is-away">${escapeHtml(game.away.abbr)}</th>` +
        `<th scope="col" class="is-home">${escapeHtml(game.home.abbr)}</th></tr></thead><tbody>` +
        resultRows
          .filter((r) => r.always || n("away", ...r.results) + n("home", ...r.results) > 0)
          .map((r) => {
            const aw = n("away", ...r.results);
            const hm = n("home", ...r.results);
            const mark = r.key && aw !== hm ? " is-key" : "";
            return (
              `<tr class="${mark.trim()}"><th scope="row">${r.label}</th>` +
              `<td class="is-away">${aw}</td>` +
              `<td class="is-home">${hm}</td></tr>`
            );
          })
          .join("") +
        `</tbody></table>` +
        (edge
          ? `<p class="sct-pc-edge" style="color:${colors[edge.side].ink}">` +
            `${escapeHtml(`${game[edge.side].abbr} turnover edge: +${edge.by}`)}</p>`
          : "") +
        `</div>` +
        ""
      : input.drives.length === 0
        ? `<p class="sct-rb-note">Possession results appear when the drive chart is available for this game.</p>`
        : "";

  const notes = possessionNotes(input);
  const noteList = notes.length
    ? `<ul class="sct-pc-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";

  const chartRows = input.drives
    .map((d) => {
      const side = sideOf(game, d.team);
      const fill = side ? colors[side].fill : "#5B6778";
      return (
        `<tr>` +
        `<td><span class="sct-ss-chip" style="--ss-fill:${fill}">${escapeHtml(d.team)}</span></td>` +
        `<td>${escapeHtml(`${d.quarter <= 4 ? `Q${d.quarter}` : "OT"} ${d.startClock}`)}</td>` +
        `<td>${d.plays}</td><td>${d.yards}</td>` +
        `<td>${d.durationSeconds === null ? "-" : clock(d.durationSeconds)}</td>` +
        `<td>${escapeHtml(RESULT_TEXT[d.result])}</td>` +
        `</tr>`
      );
    })
    .join("");
  const driveChart = input.drives.length
    ? `<details class="sct-pc-drives"><summary>${escapeHtml(`All ${input.drives.length} possessions, drive by drive`)}</summary>` +
      `<div class="sct-ss-wrap"><table class="sct-rb-mini is-wide">` +
      `<caption class="sct-rb-sr">Drive chart</caption>` +
      `<thead><tr><th scope="col">Team</th><th scope="col">Start</th><th scope="col">Plays</th>` +
      `<th scope="col">Yards</th><th scope="col">Time</th><th scope="col">Result</th></tr></thead>` +
      `<tbody>${chartRows}</tbody></table></div></details>`
    : "";

  const resultNote = input.drives.length
    ? `<p class="sct-rb-note">${escapeHtml(
          (defensive.length
            ? defensive
                .map((d) => {
                  const other = d.team === game.away.abbr ? game.home.short : game.away.short;
                  const own = d.team === game.away.abbr ? game.away.short : game.home.short;
                  return `The ${other}' ${d.result === "int" ? "interception" : d.result === "fumble" ? "fumble" : "return"} touchdown is counted as a ${own} ${
                    d.result === "int" ? "interception" : d.result === "fumble" ? "lost fumble" : "possession"
                  }, not as a ${other} possession.`;
                })
                .join(" ") + " "
            : "") + "Possessions that ended with the clock running out at the half or the end of the game aren't counted.",
        )}</p>`
    : "";
  // Two modules side by side, about 70/30 (mak, 2026-09-30): the comparison
  // card with its takeaway and top targets, then the possession results.
  const callingCard = compare
    ? `<div class="sct-pc-card is-calling">` +
      compare +
      (take
        ? `<p class="sct-pc-take"><span class="sct-pc-take-h">Efficiency edge</span> ${escapeHtml(take)}</p>`
        : "") +
      (shareLines ? `<ul class="sct-pc-shares"><li class="sct-pc-shares-h">Top targets</li>${shareLines}</ul>` : "") +
      `</div>`
    : "";
  return (
    `<section class="sct-rb-section sct-pc" aria-labelledby="possessions">` +
    `<h2 class="sct-rb-h2" id="possessions">Play calling and possessions</h2>` +
    `<div class="sct-pc-row">${callingCard}${table}</div>` +
    noteList +
    driveChart +
    // The fine print, one click away.
    `<details class="sct-info"><summary>About these numbers</summary>` +
    resultNote +
    `<p class="sct-rb-note">Personnel groupings, average depth of target and pass rate over expected appear when the tracking feed is connected.</p>` +
    `</details>` +
    `</section>`
  );
}
