/**
 * The game leaders strip: four cards, full width, straight under the hero.
 *
 * Who is on it follows fixed rules, so the same code picks a fair four for
 * every game. Kickers are never picked, nobody is picked twice, and every
 * fantasy comparison is in PPR, computed by fantasyPoints() from the line
 * printed on the card — never read from a stored total.
 *
 *   1. Passing leader — most passing yards.
 *   2. Top fantasy scorer — most PPR points among non-quarterbacks.
 *   3. {Loser} leader — most PPR points on the losing side (the away side on a
 *      tie), the next one down when that player is already on the strip.
 *   4. Defensive playmaker — a defensive touchdown, then interceptions, then
 *      sacks, then tackles.
 *
 * Pure: the game, its players and a link resolver in, HTML out.
 */

import { escapeHtml } from "../render";
import { fantasyPoints } from "./fantasy-points";
import { isKicker, type GamePlayer, type GamePlayers } from "./game-players";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

export interface LeadersStripInput {
  game: ScoreboardGame;
  players: GamePlayers;
  /** A player's page, or null when the site has none. The same resolver every section uses. */
  playerUrl: (name: string) => string | null;
}

export type LeaderRole = "passing" | "fantasy" | "loser" | "defense";

export interface LeaderPick {
  role: LeaderRole;
  label: string;
  id: string;
  player: GamePlayer;
}

const DEFENSIVE_POSITIONS = new Set([
  "CB", "S", "FS", "SS", "DB", "LB", "ILB", "OLB", "MLB", "DE", "DT", "NT", "DL", "EDGE",
]);

type Kind = "QB" | "RB" | "REC" | "DEF";

/** How the stat line is written: by position when known, by the line when not. */
function kindOf(p: GamePlayer): Kind {
  const pos = p.pos ?? "";
  if (pos === "QB") return "QB";
  if (pos === "RB" || pos === "FB") return "RB";
  if (pos === "WR" || pos === "TE") return "REC";
  if (DEFENSIVE_POSITIONS.has(pos)) return "DEF";
  const s = p.stats;
  if ((s.passAtt ?? 0) >= 5) return "QB";
  const touches = (s.rushAtt ?? 0) + (s.rec ?? 0) + (s.recTgt ?? 0) + (s.passAtt ?? 0);
  if (touches === 0) return "DEF";
  return (s.rushAtt ?? 0) > (s.rec ?? 0) ? "RB" : "REC";
}

export function ppr(p: GamePlayer): number {
  return fantasyPoints(p.stats, "ppr");
}

function tackles(p: GamePlayer): number {
  return (p.stats.soloTkl ?? 0) + (p.stats.astTkl ?? 0);
}

function best(
  entries: Array<[string, GamePlayer]>,
  compare: (a: GamePlayer, b: GamePlayer) => number,
): [string, GamePlayer] | null {
  // Name as the last tie-break, so two equal lines pick the same card on every render.
  const sorted = [...entries].sort(
    (a, b) => compare(a[1], b[1]) || a[1].name.localeCompare(b[1].name),
  );
  return sorted[0] ?? null;
}

export function pickLeaders(input: Pick<LeadersStripInput, "game" | "players">): LeaderPick[] {
  const { game } = input;
  const picked = new Set<string>();
  const picks: LeaderPick[] = [];
  const pool = (): Array<[string, GamePlayer]> =>
    Object.entries(input.players).filter(([id, p]) => !picked.has(id) && !isKicker(p));
  const take = (role: LeaderRole, label: string, hit: [string, GamePlayer] | null): void => {
    if (!hit) return;
    picked.add(hit[0]);
    picks.push({ role, label, id: hit[0], player: hit[1] });
  };

  take(
    "passing",
    "Passing leader",
    best(
      pool().filter(([, p]) => (p.stats.passYds ?? 0) > 0),
      (a, b) => (b.stats.passYds ?? 0) - (a.stats.passYds ?? 0) || ppr(b) - ppr(a),
    ),
  );

  take(
    "fantasy",
    "Top fantasy scorer",
    best(
      pool().filter(([, p]) => kindOf(p) !== "QB" && ppr(p) > 0),
      (a, b) => ppr(b) - ppr(a),
    ),
  );

  const result = scoreboardResult(game);
  const side = result?.winner === "home" ? "away" : result?.winner === "away" ? "home" : "away";
  const loser = game[side];
  take(
    "loser",
    `${loser.short} leader`,
    best(
      pool().filter(([, p]) => p.team === loser.abbr && ppr(p) > 0),
      (a, b) => ppr(b) - ppr(a),
    ),
  );

  take(
    "defense",
    "Defensive playmaker",
    best(
      pool().filter(
        ([, p]) =>
          (p.stats.defTd ?? 0) + (p.stats.defInt ?? 0) + (p.stats.sacks ?? 0) + tackles(p) > 0,
      ),
      (a, b) =>
        (b.stats.defTd ?? 0) - (a.stats.defTd ?? 0) ||
        (b.stats.defInt ?? 0) - (a.stats.defInt ?? 0) ||
        (b.stats.sacks ?? 0) - (a.stats.sacks ?? 0) ||
        tackles(b) - tackles(a),
    ),
  );

  return picks;
}

/** "13/17, 202 YDS, 2 TD, 1 RUSH TD": zeros left out, yards always kept. */
export function statLine(p: GamePlayer, role?: LeaderRole): string {
  const s = p.stats;
  const parts: string[] = [];
  const add = (n: number | undefined, unit: string): void => {
    if ((n ?? 0) > 0) parts.push(`${n} ${unit}`);
  };
  const kind = role === "defense" ? "DEF" : kindOf(p);
  if (kind === "QB") {
    parts.push(`${s.passCmp ?? 0}/${s.passAtt ?? 0}`, `${s.passYds ?? 0} YDS`);
    add(s.passTd, "TD");
    add(s.passInt, "INT");
    add(s.rushTd, "RUSH TD");
  } else if (kind === "RB") {
    add(s.rushAtt, "ATT");
    parts.push(`${s.rushYds ?? 0} YDS`);
    add(s.rushTd, "TD");
    if ((s.rec ?? 0) > 0) {
      parts.push(`${s.rec} REC`, `${s.recYds ?? 0} REC YDS`);
      add(s.recTd, "REC TD");
    }
  } else if (kind === "REC") {
    add(s.rec, "REC");
    parts.push(`${s.recYds ?? 0} YDS`);
    add(s.recTd, "TD");
    add(s.rushTd, "RUSH TD");
  } else {
    add(s.defInt, "INT");
    add(s.defTd, "TD");
    add(s.sacks, "SACK");
    add(tackles(p) || undefined, "TKL");
  }
  return parts.join(", ");
}

function card(input: LeadersStripInput, pick: LeaderPick): string {
  const p = pick.player;
  const colors = pairColors(input.game.away.abbr, input.game.home.abbr);
  const ink = p.team === input.game.home.abbr ? colors.home.ink : colors.away.ink;
  const href = input.playerUrl(p.name);
  const name = href
    ? `<a class="sct-ls-link sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(p.name)}</a>`
    : escapeHtml(p.name);
  const meta = [p.team, p.pos].filter(Boolean).join(" · ");
  const points =
    pick.role === "defense"
      ? ""
      : `<p class="sct-ls-pts">` +
        `<span class="sct-ls-num" data-ppr="${ppr(p).toFixed(1)}"` +
        ` data-half="${fantasyPoints(p.stats, "half").toFixed(1)}"` +
        ` data-std="${fantasyPoints(p.stats, "standard").toFixed(1)}">${ppr(p).toFixed(1)}</span>` +
        `<span class="sct-ls-unit">PPR pts</span>` +
        `</p>`;
  return (
    `<li class="sct-ls-card" data-role="${pick.role}" style="${escapeHtml(`--ls-team:${ink}`)}">` +
    `<p class="sct-ls-label">${escapeHtml(pick.label)}</p>` +
    `<p class="sct-ls-name">${name}</p>` +
    `<p class="sct-ls-meta">${escapeHtml(meta)}</p>` +
    points +
    `<p class="sct-ls-line">${escapeHtml(statLine(p, pick.role))}</p>` +
    `</li>`
  );
}

export function renderLeadersStrip(input: LeadersStripInput): string {
  const picks = pickLeaders(input);
  if (picks.length === 0) return "";
  return (
    `<section class="sct-ls" aria-label="Game leaders">` +
    `<ul class="sct-ls-row">${picks.map((p) => card(input, p)).join("")}</ul>` +
    `</section>`
  );
}
