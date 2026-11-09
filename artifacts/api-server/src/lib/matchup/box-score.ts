/**
 * The completed game's Box Score tab (mak, 2026-11-08): "NFL stats first. No
 * fantasy points in the primary tables." Seven sections, stacked, in mak's
 * order, all tables and text:
 *
 *   Team Stats                 side by side (away | stat | home): first downs,
 *                              yards, plays, yards/play, passing and rushing,
 *                              turnovers, third/fourth downs, red zone,
 *                              penalties, time of possession
 *   Passing                    every QB with an attempt
 *   Rushing                    every ball carrier, quarterbacks included
 *   Receiving                  every player with a target or a catch
 *   Defense                    tackles, sacks, TFL, PD, INT, FF, FR
 *   Special Teams              kicking, punting, kick returns, punt returns
 *   Advanced Team Efficiency   EPA, success rate, explosive plays, QB hit
 *                              rate, dropback and rushing efficiency
 *
 * Player sections are one table per team. Nothing here repeats another tab:
 * no fantasy points, shares, odds, scoring plays, recap or leader cards.
 *
 * Every figure is the box score's own (ESPN's sheet, as stored) or counted
 * from stored nflverse play-by-play (the game story store): the advanced
 * rows and forced fumbles, which the box score does not carry. A row neither
 * side has is left out; so is a section with nothing in it.
 */

import { escapeHtml } from "../render";
import type { SheetRow } from "./boxscore";
import type { ScoreboardGame } from "./scoreboard-hero";

type Side = "away" | "home";
const SIDES: readonly Side[] = ["away", "home"];

/** One club's advanced offense, as buildGameStory.mjs stores it (sums and counts). */
export interface StoryAdvanced {
  plays: number;
  epa: number;
  success: number;
  explosive: number;
  dropbacks: number;
  dbEpa: number;
  rushes: number;
  rushEpa: number;
  early: number;
  earlyPass: number;
  airYards: number;
  neutral: number;
  neutralPass: number;
  /** Dropbacks on which this club's passer was sacked or hit. Absent in an older store. */
  hit?: number;
}

/** A forced fumble from play-by-play: the defender's club and name as nflverse spells it ("A.Wingard"). */
export interface ForcedFumble {
  team: string;
  player: string;
}

export interface BoxScoreInput {
  game: ScoreboardGame;
  /** ESPN's team sheet for each side ("thirdDownEff" -> "5-16"); null when there is none. */
  teamSheet: Record<Side, Record<string, string> | null>;
  /** ESPN's player box score for each side, by category. */
  playerSheet: Record<Side, Record<string, SheetRow[]> | null>;
  /** Per-side advanced offense from the game story, or null. */
  advanced: Record<Side, StoryAdvanced | null> | null;
  /** Forced fumbles from the game story, or null when the store has none for the game. */
  forcedFumbles: ForcedFumble[] | null;
  playerUrl: (name: string) => string | null;
  /** CSS colors for each side's ink. */
  inks: Record<Side, string>;
}

/* ------------------------------------------------------------- helpers */

const e = escapeHtml;

function toNum(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** "5-16" or "23/33" as [made, attempts]. */
function pair(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(/[-/]/);
  if (parts.length !== 2) return null;
  const a = toNum(parts[0]);
  const b = toNum(parts[1]);
  return a === null || b === null ? null : [a, b];
}

function clockSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const [m, s] = raw.split(":");
  const mm = toNum(m);
  const ss = toNum(s);
  return mm === null || ss === null ? null : mm * 60 + ss;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const pct = (made: number, att: number): string => (att > 0 ? ` (${Math.round((made / att) * 100)}%)` : "");
const signed = (n: number, places = 2): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(places)}`;

/** A section: the H2 as a direct child, so the new design's bar and icon apply. */
function section(id: string, title: string, body: string, input: BoxScoreInput): string {
  return (
    `<section class="sct-rb-section sct-bx-sec" aria-labelledby="${e(id)}" ` +
    `style="${e(`--bx-away:${input.inks.away};--bx-home:${input.inks.home}`)}">` +
    `<h2 class="sct-rb-h2" id="${e(id)}">${e(title)}</h2>` +
    body +
    `</section>`
  );
}

/* ------------------------------------------------- side-by-side tables */

type Better = "higher" | "lower" | "neither";

interface CompareRow {
  label: string;
  text: Record<Side, string | null>;
  /** The figure the better side is read from. */
  value: Record<Side, number | null>;
  better: Better;
  /** An indented breakdown row under the one before it. */
  sub?: boolean;
}

type Cell = { text: string; value: number | null } | null;

function row(label: string, get: (side: Side) => Cell, better: Better, sub = false): CompareRow | null {
  const a = get("away");
  const h = get("home");
  if (!a && !h) return null;
  return {
    label,
    text: { away: a?.text ?? null, home: h?.text ?? null },
    value: { away: a?.value ?? null, home: h?.value ?? null },
    better,
    sub,
  };
}

function betterSide(r: CompareRow): Side | null {
  const { away, home } = r.value;
  if (r.better === "neither" || away === null || home === null || Math.abs(away - home) < 1e-9) return null;
  return (away > home) === (r.better === "higher") ? "away" : "home";
}

/** NE | STAT | SEA, the better figure bold in its team's ink. */
function compareTable(input: BoxScoreInput, rows: CompareRow[], caption: string): string {
  const { game } = input;
  const cell = (r: CompareRow, side: Side, best: Side | null) =>
    `<td class="is-${side}${best === side ? " is-better" : ""}">${r.text[side] === null ? "-" : e(r.text[side]!)}</td>`;
  return (
    `<table class="sct-bx-team">` +
    `<caption class="sct-rb-sr">${e(caption)}</caption>` +
    `<thead><tr><th scope="col" class="is-away">${e(game.away.abbr)}</th>` +
    `<th scope="col" class="sct-bx-stat">Stat</th>` +
    `<th scope="col" class="is-home">${e(game.home.abbr)}</th></tr></thead>` +
    `<tbody>` +
    rows
      .map((r) => {
        const best = betterSide(r);
        return (
          `<tr${r.sub ? ` class="is-sub"` : ""}>${cell(r, "away", best)}` +
          `<th scope="row" class="sct-bx-stat">${e(r.label)}</th>${cell(r, "home", best)}</tr>`
        );
      })
      .join("") +
    `</tbody></table>`
  );
}

/* --------------------------------------------------------- 1. team stats */

function teamRows(input: BoxScoreInput): CompareRow[] {
  const sheet = (side: Side) => input.teamSheet[side];
  const whole = (key: string) => (side: Side): Cell => {
    const v = toNum(sheet(side)?.[key]);
    return v === null ? null : { text: String(v), value: v };
  };
  const dec = (key: string) => (side: Side): Cell => {
    const v = toNum(sheet(side)?.[key]);
    return v === null ? null : { text: v.toFixed(1), value: v };
  };
  const made = (key: string) => (side: Side): Cell => {
    const p = pair(sheet(side)?.[key]);
    return p ? { text: `${p[0]}-${p[1]}${pct(p[0], p[1])}`, value: p[1] > 0 ? p[0] / p[1] : null } : null;
  };
  const plain = (key: string, value: (p: [number, number]) => number | null) => (side: Side): Cell => {
    const p = pair(sheet(side)?.[key]);
    return p ? { text: `${p[0]}-${p[1]}`, value: value(p) } : null;
  };
  const rows: Array<CompareRow | null> = [
    row("Total yards", whole("totalYards"), "higher"),
    row("Yards / play", dec("yardsPerPlay"), "higher"),
    row("Turnovers", whole("turnovers"), "lower"),
    row("Interceptions thrown", whole("interceptions"), "lower", true),
    row("Fumbles lost", whole("fumblesLost"), "lower", true),
    row("Possession", (side) => {
      const s = clockSeconds(sheet(side)?.["possessionTime"]);
      return s === null ? null : { text: clock(s), value: s };
    }, "higher"),
    row("First downs", whole("firstDowns"), "higher"),
    row("Passing", whole("firstDownsPassing"), "higher", true),
    row("Rushing", whole("firstDownsRushing"), "higher", true),
    row("Penalty", whole("firstDownsPenalty"), "neither", true),
    row("Total plays", whole("totalOffensivePlays"), "neither"),
    row("Passing yards", whole("netPassingYards"), "higher"),
    row("Comp-att", (side) => {
      const p = pair(sheet(side)?.["completionAttempts"]);
      return p ? { text: `${p[0]}-${p[1]}`, value: null } : null;
    }, "neither", true),
    row("Yards / pass", dec("yardsPerPass"), "higher", true),
    row("Sacks-yards lost", plain("sacksYardsLost", (p) => p[0]), "lower", true),
    row("Rushing yards", whole("rushingYards"), "higher"),
    row("Rushing attempts", whole("rushingAttempts"), "neither", true),
    row("Yards / rush", dec("yardsPerRushAttempt"), "higher", true),
    row("Third downs", made("thirdDownEff"), "higher"),
    row("Fourth downs", made("fourthDownEff"), "higher"),
    row("Red zone (TD-att)", made("redZoneAttempts"), "higher"),
    row("Penalties-yards", plain("totalPenaltiesYards", (p) => p[1]), "lower"),
  ];
  return rows.filter((r): r is CompareRow => r !== null);
}

/* ------------------------------------------------- 7. advanced efficiency */

function advancedRows(input: BoxScoreInput): CompareRow[] {
  const adv = (side: Side) => input.advanced?.[side] ?? null;
  const other = (side: Side): Side => (side === "away" ? "home" : "away");
  const rate = (num: (a: StoryAdvanced) => number, den: (a: StoryAdvanced) => number, fmt: (v: number) => string) =>
    (side: Side): Cell => {
      const a = adv(side);
      if (!a || den(a) === 0) return null;
      const v = num(a) / den(a);
      return { text: fmt(v), value: v };
    };
  const share = (v: number) => `${Math.round(v * 100)}%`;
  const sheetRate = (yards: string, att: (s: Record<string, string>) => number | null) => (side: Side): Cell => {
    const s = input.teamSheet[side];
    if (!s) return null;
    const y = toNum(s[yards]);
    const n = att(s);
    return y === null || !n ? null : { text: (y / n).toFixed(1), value: y / n };
  };
  const rows: Array<CompareRow | null> = [
    row("EPA / play", rate((a) => a.epa, (a) => a.plays, (v) => signed(v)), "higher"),
    row("Success rate", rate((a) => a.success, (a) => a.plays, share), "higher"),
    row("Explosive plays", (side) => {
      const a = adv(side);
      return a ? { text: `${a.explosive}${a.plays ? ` (${Math.round((a.explosive / a.plays) * 100)}%)` : ""}`, value: a.explosive } : null;
    }, "higher"),
    // The pass rush a side generated: the other club's dropbacks that ended
    // in a sack or a hit. "Pressure" proper is a charting stat no stored feed has.
    row("QB hit rate (pass rush)", (side) => {
      const opp = adv(other(side));
      if (!opp || opp.hit === undefined || opp.dropbacks === 0) return null;
      const v = opp.hit / opp.dropbacks;
      return { text: `${opp.hit} (${share(v)})`, value: v };
    }, "higher"),
    row("EPA / dropback", rate((a) => a.dbEpa, (a) => a.dropbacks, (v) => signed(v)), "higher"),
    // Net passing yards over attempts plus sacks: the sheet's own figures.
    row("Yards / dropback", sheetRate("netPassingYards", (s) => {
      const att = pair(s["completionAttempts"])?.[1];
      const sacks = pair(s["sacksYardsLost"])?.[0] ?? 0;
      return att === undefined ? null : att + sacks;
    }), "higher", true),
    row("EPA / rush", rate((a) => a.rushEpa, (a) => a.rushes, (v) => signed(v)), "higher"),
    row("Yards / carry", sheetRate("rushingYards", (s) => toNum(s["rushingAttempts"])), "higher", true),
  ];
  return rows.filter((r): r is CompareRow => r !== null);
}

/* --------------------------------------------------------- player tables */

interface Column {
  label: string;
  title: string;
  get: (v: Record<string, string>) => string | null;
}

const raw = (key: string) => (v: Record<string, string>) => v[key] ?? null;
const zero = (key: string) => (v: Record<string, string>) => v[key] ?? "0";

/** "A.Wingard" against "Antonio Wingard": first initial and last name, suffixes and punctuation off. */
function sameDefender(nflverse: string, full: string): boolean {
  const clean = (s: string) =>
    s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "").replace(/[^a-z. ]/g, "").trim();
  const [initial, ...rest] = clean(nflverse).split(".");
  const last = rest.join("").replace(/\s+/g, "");
  const parts = clean(full).replace(/\./g, "").split(/\s+/);
  const fullLast = parts.slice(1).join("");
  return Boolean(initial && last) && parts[0]!.startsWith(initial!) && fullLast === last;
}

/** Defense: the tackle sheet with interceptions, fumble recoveries and forced fumbles merged in. */
function defenseRows(sheets: Record<string, SheetRow[]>, ff: ForcedFumble[]): SheetRow[] {
  const byId = new Map<string, SheetRow>();
  for (const r of sheets["defensive"] ?? []) byId.set(r.espnId, { ...r, values: { ...r.values } });
  for (const r of sheets["interceptions"] ?? []) {
    const hit = byId.get(r.espnId);
    const ints = { defInt: r.values["interceptions"] ?? "0" };
    if (hit) Object.assign(hit.values, ints);
    else byId.set(r.espnId, { ...r, values: { ...ints } });
  }
  for (const r of sheets["fumbles"] ?? []) {
    const rec = toNum(r.values["fumblesRecovered"]);
    const hit = byId.get(r.espnId);
    if (hit && rec) hit.values["fumRec"] = String(rec);
  }
  const rows = [...byId.values()];
  for (const f of ff) {
    const hit = rows.find((r) => sameDefender(f.player, r.name));
    if (hit) hit.values["ff"] = String((toNum(hit.values["ff"]) ?? 0) + 1);
  }
  const n = (r: SheetRow, k: string) => toNum(r.values[k]) ?? 0;
  return rows
    .filter((r) => n(r, "totalTackles") + n(r, "sacks") + n(r, "defInt") + n(r, "passesDefended") + n(r, "ff") + n(r, "fumRec") > 0)
    .sort((a, b) => n(b, "totalTackles") - n(a, "totalTackles") || n(b, "sacks") - n(a, "sacks") || a.name.localeCompare(b.name));
}

const PASSING: Column[] = [
  { label: "CMP/ATT", title: "Completions / attempts", get: raw("completions/passingAttempts") },
  {
    label: "CMP%",
    title: "Completion percentage",
    get: (v) => {
      const p = pair(v["completions/passingAttempts"]);
      return p && p[1] > 0 ? (Math.round((p[0] / p[1]) * 1000) / 10).toFixed(1) : null;
    },
  },
  { label: "YDS", title: "Passing yards", get: raw("passingYards") },
  { label: "TD", title: "Passing touchdowns", get: raw("passingTouchdowns") },
  { label: "INT", title: "Interceptions", get: raw("interceptions") },
  { label: "Y/A", title: "Yards per attempt", get: raw("yardsPerPassAttempt") },
  { label: "RTG", title: "Passer rating", get: raw("QBRating") },
];

const RUSHING: Column[] = [
  { label: "ATT", title: "Rushing attempts", get: raw("rushingAttempts") },
  { label: "YDS", title: "Rushing yards", get: raw("rushingYards") },
  { label: "AVG", title: "Yards per carry", get: raw("yardsPerRushAttempt") },
  { label: "TD", title: "Rushing touchdowns", get: raw("rushingTouchdowns") },
  { label: "LONG", title: "Longest rush", get: raw("longRushing") },
];

const RECEIVING: Column[] = [
  { label: "TGT", title: "Targets", get: raw("receivingTargets") },
  { label: "REC", title: "Receptions", get: raw("receptions") },
  { label: "YDS", title: "Receiving yards", get: raw("receivingYards") },
  { label: "AVG", title: "Yards per reception", get: raw("yardsPerReception") },
  { label: "TD", title: "Receiving touchdowns", get: raw("receivingTouchdowns") },
  { label: "LONG", title: "Longest reception", get: raw("longReception") },
];

const DEFENSE: Column[] = [
  { label: "TKL", title: "Total tackles", get: zero("totalTackles") },
  { label: "SACKS", title: "Sacks", get: zero("sacks") },
  { label: "TFL", title: "Tackles for loss", get: zero("tacklesForLoss") },
  { label: "PD", title: "Passes defended", get: zero("passesDefended") },
  { label: "INT", title: "Interceptions", get: zero("defInt") },
  { label: "FF", title: "Forced fumbles", get: zero("ff") },
  { label: "FR", title: "Fumbles recovered", get: zero("fumRec") },
];

const KICKING: Column[] = [
  { label: "FG", title: "Field goals made / attempted", get: raw("fieldGoalsMade/fieldGoalAttempts") },
  { label: "PCT", title: "Field goal percentage", get: (v) => (v["fieldGoalPct"] ? String(Math.round(Number(v["fieldGoalPct"]))) : null) },
  { label: "LONG", title: "Longest field goal", get: raw("longFieldGoalMade") },
  { label: "XP", title: "Extra points made / attempted", get: raw("extraPointsMade/extraPointAttempts") },
  { label: "PTS", title: "Kicking points", get: raw("totalKickingPoints") },
];

const PUNTING: Column[] = [
  { label: "NO", title: "Punts", get: raw("punts") },
  { label: "YDS", title: "Punt yards", get: raw("puntYards") },
  { label: "AVG", title: "Gross average", get: raw("grossAvgPuntYards") },
  { label: "TB", title: "Touchbacks", get: raw("touchbacks") },
  { label: "IN 20", title: "Punts inside the 20", get: raw("puntsInside20") },
  { label: "LONG", title: "Longest punt", get: raw("longPunt") },
];

const returns = (kind: "kick" | "punt"): Column[] => [
  { label: "NO", title: "Returns", get: raw(`${kind}Returns`) },
  { label: "YDS", title: "Return yards", get: raw(`${kind}ReturnYards`) },
  { label: "AVG", title: "Yards per return", get: raw(`yardsPer${kind === "kick" ? "Kick" : "Punt"}Return`) },
  { label: "LONG", title: "Longest return", get: raw(`long${kind === "kick" ? "Kick" : "Punt"}Return`) },
  { label: "TD", title: "Return touchdowns", get: raw(`${kind}ReturnTouchdowns`) },
];

function playerTable(input: BoxScoreInput, side: Side, title: string, columns: Column[], rows: SheetRow[]): string {
  if (!rows.length) return "";
  const team = input.game[side];
  const name = (r: SheetRow) => {
    const url = input.playerUrl(r.name);
    const text = e(r.name);
    return (
      `<th scope="row" class="sct-bx-name">${url ? `<a href="${e(url)}">${text}</a>` : text}` +
      (r.pos ? ` <span class="sct-bx-pos">${e(r.pos)}</span>` : "") +
      `</th>`
    );
  };
  return (
    `<div class="sct-bx-wrap is-${side}">` +
    `<table class="sct-bx-players">` +
    `<caption class="sct-bx-cap"><span class="sct-bx-chip is-${side}">${e(team.abbr)}</span> ${e(`${team.name} ${title.toLowerCase()}`)}</caption>` +
    `<thead><tr><th scope="col" class="sct-bx-name">Player</th>` +
    columns.map((c) => `<th scope="col"><abbr title="${e(c.title)}">${e(c.label)}</abbr></th>`).join("") +
    `</tr></thead><tbody>` +
    rows.map((r) => `<tr>${name(r)}${columns.map((c) => `<td>${e(c.get(r.values) ?? "-")}</td>`).join("")}</tr>`).join("") +
    `</tbody></table></div>`
  );
}

/** Both teams' tables for one category, side by side where there is room; "" when neither has rows. */
function pairOf(input: BoxScoreInput, title: string, columns: Column[], rows: (side: Side) => SheetRow[]): string {
  const html = SIDES.map((side) => playerTable(input, side, title, columns, rows(side))).join("");
  return html ? `<div class="sct-bx-pair">${html}</div>` : "";
}

/* ----------------------------------------------------------------- page */

/** The Box Score tab's body, or "" when the game has no box score. */
export function renderBoxScore(input: BoxScoreInput): string {
  const { game } = input;
  const pairName = `${game.away.short} vs ${game.home.short}`;
  const sheets = (side: Side) => input.playerSheet[side] ?? {};
  const cat = (name: string) => (side: Side) => sheets(side)[name] ?? [];
  const ff = (side: Side) => (input.forcedFumbles ?? []).filter((f) => f.team === game[side].abbr);
  const parts: string[] = [];

  // Team Stats on the left and Passing, Rushing and Receiving stacked on the
  // right, one row (mak, 2026-11-08); the CSS stacks the two below 1000px.
  const team = teamRows(input);
  const adv = advancedRows(input);
  // Advanced Team Efficiency sits under Team Stats in the left column (mak,
  // 2026-11-08), so the two NE | STAT | MIA tables read together.
  const teamSection =
    (team.length
      ? section("team-stats", `${pairName} team stats`, compareTable(input, team, `Team stats, ${pairName}`), input)
      : "") +
    (adv.length
      ? section(
          "bx-advanced",
          "Advanced team efficiency",
          compareTable(input, adv, `Advanced team efficiency, ${pairName}`) +
            `<details class="sct-info"><summary>About these numbers</summary>` +
            `<p class="sct-rb-note">EPA (expected points added) and success rate count pass and run plays, two-point tries left out; a successful play is one that adds expected points. ` +
            `Explosive plays gain 15+ yards on a dropback or 10+ on a run. QB hit rate is the share of the opponent's dropbacks that ended in a sack or a hit on the quarterback.</p>` +
            `</details>`,
          input,
        )
      : "");

  const passing = pairOf(input, "Passing", PASSING, cat("passing"));
  const rushing = pairOf(input, "Rushing", RUSHING, cat("rushing"));
  const receiving = pairOf(input, "Receiving", RECEIVING, cat("receiving"));
  const offense =
    (passing ? section("bx-passing", "Passing", passing, input) : "") +
    (rushing ? section("bx-rushing", "Rushing", rushing, input) : "") +
    (receiving ? section("bx-receiving", "Receiving", receiving, input) : "");
  if (teamSection && offense) {
    parts.push(`<div class="sct-bx-row"><div class="sct-bx-col is-team">${teamSection}</div><div class="sct-bx-col">${offense}</div></div>`);
  } else if (teamSection || offense) {
    parts.push(teamSection + offense);
  }
  const defense = pairOf(input, "Defense", DEFENSE, (side) => defenseRows(sheets(side), ff(side)));
  if (defense) {
    parts.push(
      section(
        "bx-defense",
        "Defense",
        defense +
          (input.forcedFumbles === null
            ? ""
            : `<p class="sct-rb-note">Forced fumbles are counted from the play-by-play.</p>`),
        input,
      ),
    );
  }

  const special = (
    [
      ["Kicking", KICKING, cat("kicking")],
      ["Punting", PUNTING, cat("punting")],
      ["Kick returns", returns("kick"), cat("kickReturns")],
      ["Punt returns", returns("punt"), cat("puntReturns")],
    ] as const
  )
    .map(([title, columns, rows]) => {
      const html = pairOf(input, title, [...columns], rows);
      return html ? `<h3 class="sct-bx-h3">${e(title)}</h3>${html}` : "";
    })
    .join("");
  if (special) parts.push(section("bx-special-teams", "Special teams", special, input));

  return parts.length ? `<div class="sct-bx">${parts.join("")}</div>` : "";
}
