/**
 * The premium comparison version of the Snap Counts & Player Usage top
 * block (mak's instructions, 2026-11-05): a navy dashboard header, then a
 * two-column dashboard - Snap Counts & Playing Time on the left with its
 * Season / Last 3 / Week switch and position filter, Target Distribution
 * and Rushing Distribution stacked on the right.
 *
 * Rendered DIRECTLY UNDER the whole existing section, which is untouched,
 * so the two designs can be compared on one page. Every number is the
 * same arithmetic the original draws (snapWindows / boardLines from
 * usage-render.ts), nothing is fetched or computed twice, and the snap
 * switch is the original's client wiring (client/team.ts wireSnapTables),
 * which keys on `[data-sct-snaps]` blocks independently: the two tables'
 * filters never share state. Styles live under `.sct-up-*` in team.css; the
 * handful of hook classes the bundle rewrites keep their names and are
 * restyled under `.sct-up` only.
 */

import { escapeHtml } from "../render";
import { slotChip } from "../team-render";
import {
  BADGE_FROM,
  BOARD_ROWS,
  boardLines,
  faceWell,
  packSnapView,
  playerLink,
  rushYardsOnCarries,
  snapCaption,
  snapWindows,
  type BoardLine,
} from "./usage-render";
import { signed } from "./usage-copy";
import type { NflTeam } from "./teams";
import type { UsagePlayer, UsageView } from "./usage";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

const ICON: Record<string, string> = {
  layers: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 3l8 4-8 4-8-4 8-4z" fill="currentColor"/><path d="M2 11l8 4 8-4M2 15l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  field: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v10M4.5 6.5v3M11.5 6.5v3" stroke="currentColor" stroke-width="1.5"/></svg>`,
  target: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`,
  run: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="11" cy="3" r="1.6" fill="currentColor"/><path d="M4 14l3-4 2 1 1-3-3-1-2 2M7 7l3-1 2 2 2 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  info: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 4.8v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

function panelHead(title: string, icon: string): string {
  return `<div class="sct-up-ph"><span class="sct-up-ph-icon">${ICON[icon]}</span><h3 class="sct-up-ph-title">${e(title)}</h3></div>`;
}

/** A row's player cell: headshot well, bold name link, position under it. */
function who(p: UsagePlayer): string {
  return (
    `<span class="sct-up-who">${faceWell(p)}` +
    `<span class="sct-up-who-text">${playerLink(p, "sct-up-name")}<span class="sct-up-pos">${slotChip(p.pos, true)}</span></span></span>`
  );
}

/** The usage bar: a muted-blue fill on a light track, the number beside it. */
function bar(share: number | null, cls = ""): string {
  const fill = Math.max(0, Math.min(100, share ?? 0));
  return (
    `<span class="sct-up-bar${cls ? ` ${cls}` : ""}">` +
    `<span class="sct-up-track sct-us-gbar" aria-hidden="true"><span style="width:${fill}%"></span></span>` +
    `<span class="sct-up-bar-val sct-us-share-val">${share == null ? "–" : `${share}%`}</span>` +
    `</span>`
  );
}

/* ------------------------------------------------------------- snap panel */

function snapPanel(view: UsageView, team: NflTeam): string {
  const win = snapWindows(view);
  if (!win) return "";
  const { games, players, viewsOf } = win;
  const rowsData = players
    .map((p) => ({ p, v: viewsOf(p) }))
    .sort((a, b) => (b.v["season"]!.share ?? 0) - (a.v["season"]!.share ?? 0) || b.v["season"]!.snaps - a.v["season"]!.snaps);
  const changeHtml = (c: number | null) =>
    c == null
      ? `<span class="sct-us-delta is-none">–</span>`
      : c === 0
        ? `<span class="sct-us-delta is-flat">0 pp</span>`
        : `<span class="sct-us-delta is-${c > 0 ? "up" : "down"}">${e(`${signed(c, 0)} pp`)}</span>`;
  const rows = rowsData
    .map(({ p, v }) => {
      const s = v["season"]!;
      const attrs = Object.entries(v)
        .map(([k, val]) => ` data-v-${k}="${packSnapView(val)}"`)
        .join("");
      const big = s.change != null && Math.abs(s.change) >= 10;
      return (
        `<tr class="sct-up-row${big ? " is-big" : ""}" data-pos="${e(p.pos)}"${attrs}>` +
        `<th scope="row" class="sct-up-td is-player">${who(p)}</th>` +
        `<td class="sct-up-td is-num sct-us-snap-n">${e(String(s.snaps))}</td>` +
        `<td class="sct-up-td is-bar">${bar(s.share)}</td>` +
        `<td class="sct-up-td is-chg sct-us-snap-chg">${changeHtml(s.change)}</td>` +
        `</tr>`
      );
    })
    .join("");
  const weekOptions = games.map((w) => `<option value="w${w}">Week ${w}</option>`).join("");
  const caption = snapCaption(win, team);
  return (
    `<section class="sct-up-panel sct-up-snaps" data-sct-snaps aria-labelledby="sct-up-snaps-title">` +
    `<div class="sct-up-ph"><span class="sct-up-ph-icon">${ICON["field"]}</span><h3 class="sct-up-ph-title" id="sct-up-snaps-title">Snap Counts &amp; Playing Time</h3></div>` +
    `<div class="sct-up-body">` +
    `<div class="sct-up-controls sct-us-snap-controls" hidden>` +
    `<div class="sct-up-seg" role="group" aria-label="Window">` +
    `<button type="button" class="sct-up-seg-btn is-on" data-snap-view="season" aria-pressed="true">Season</button>` +
    `<button type="button" class="sct-up-seg-btn" data-snap-view="last3" aria-pressed="false">Last 3</button>` +
    `<label class="sct-up-seg-select sct-us-switch-select"><span class="sct-us-sr">Week</span><select data-snap-week><option value="">Week…</option>${weekOptions}</select></label>` +
    `</div>` +
    `<label class="sct-up-select"><span class="sct-us-sr">Position</span><select data-snap-pos>` +
    `<option value="">All positions</option><option value="QB">QB</option><option value="RB">RB</option><option value="WR">WR</option><option value="TE">TE</option>` +
    `</select></label>` +
    `</div>` +
    `<div class="sct-up-scroll"><table class="sct-up-table sct-up-snap-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col" class="is-num">Snaps</th>` +
    `<th scope="col" class="is-bar"><abbr title="Offensive snaps over the team's offensive snaps in the window">Snap %</abbr></th>` +
    `<th scope="col" class="is-chg"><abbr title="${e(caption)}">Change</abbr></th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<p class="sct-up-note" data-snap-caption><span class="sct-up-note-icon">${ICON["info"]}</span><span>${e(caption)}</span></p>` +
    `</div></section>`
  );
}

/* ------------------------------------------------------------- the boards */

function boardPanel(kind: "targets" | "carries", view: UsageView): string {
  const isT = kind === "targets";
  const { lines } = boardLines(kind, view);
  if (!lines.length) return "";
  const conventional = isT ? view.all.some((p) => p.recYards != null) : view.all.some((p) => p.rushYards != null);
  const count = (p: UsagePlayer) => (isT ? p.targets : p.carries);
  const named: BoardLine[] = lines.filter((l) => l.season > 0).slice(0, BOARD_ROWS);
  const others = lines.filter((l) => !named.includes(l));
  const unit = isT ? "target" : "carry";
  const cols = 4 + (conventional ? 2 : 0) + (isT ? 1 : 0);
  const move = (delta: number | null) =>
    delta == null || Math.abs(delta) < BADGE_FROM
      ? ""
      : `<span class="sct-up-move is-${delta > 0 ? "up" : "down"}" title="${e(`Last 3 weeks ${delta > 0 ? "+" : "−"}${Math.abs(delta)} pp vs season share`)}">` +
        `<span aria-hidden="true">${delta > 0 ? "▲" : "▼"}</span><span class="sct-us-sr">${delta > 0 ? "up" : "down"}</span> ${Math.abs(delta)} pp</span>`;
  const rows = named
    .map(({ p, season, recent, delta }) => {
      const yds = isT ? p.recYards : rushYardsOnCarries(p);
      const air = p.airYardsShare == null ? "–" : `${Math.round(Math.max(0, p.airYardsShare))}%`;
      const extra = !conventional
        ? ""
        : isT
          ? `<td class="sct-up-td is-num">${e(String(p.receptions))}</td><td class="sct-up-td is-num">${e(yds == null ? "–" : String(yds))}</td>`
          : `<td class="sct-up-td is-num">${e(yds == null ? "–" : String(yds))}</td><td class="sct-up-td is-num">${e(yds == null || !p.carries ? "–" : (yds / p.carries).toFixed(1))}</td>`;
      return (
        `<tr class="sct-up-row">` +
        `<th scope="row" class="sct-up-td is-player">${who(p)}</th>` +
        `<td class="sct-up-td is-num is-lead">${e(String(count(p)))}</td>` +
        extra +
        `<td class="sct-up-td is-bar">${bar(season, "is-share")}</td>` +
        `<td class="sct-up-td is-recent">${recent == null ? "–" : `<span class="sct-up-recent">${recent}%</span>${move(delta)}`}</td>` +
        (isT ? `<td class="sct-up-td is-num is-air">${e(air)}</td>` : "") +
        `</tr>`
      );
    })
    .join("");
  const othersCount = others.reduce((s, l) => s + count(l.p), 0);
  const othersRow = others.length
    ? `<tr class="sct-up-more"><td colspan="${cols}">${e(`+${others.length} ${others.length === 1 ? "other" : "others"} · ${othersCount} ${othersCount === 1 ? unit : isT ? "targets" : "carries"}`)}</td></tr>`
    : "";
  const seasonTitle = isT
    ? `Share of the team's targets through Week ${view.throughWeek}`
    : `Share of the team's carries (scrambles included, kneel-downs not) through Week ${view.throughWeek}`;
  const recentTitle = `Share over the player's last three games; the badge is its gap to the season share, from ${BADGE_FROM} points`;
  return (
    `<section class="sct-up-panel sct-up-board" aria-label="${e(isT ? "Target Distribution" : "Rushing Distribution")}">` +
    panelHead(isT ? "Target Distribution" : "Rushing Distribution", isT ? "target" : "run") +
    `<div class="sct-up-body">` +
    `<div class="sct-up-scroll"><table class="sct-up-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col" class="is-num">${isT ? "Tgt" : "Car"}</th>` +
    (conventional
      ? isT
        ? `<th scope="col" class="is-num">Rec</th><th scope="col" class="is-num"><abbr title="Receiving yards">Yds</abbr></th>`
        : `<th scope="col" class="is-num"><abbr title="Rushing yards on these carries">Yds</abbr></th><th scope="col" class="is-num"><abbr title="Yards per carry">YPC</abbr></th>`
      : "") +
    `<th scope="col" class="is-bar"><abbr title="${e(seasonTitle)}">Season share</abbr></th><th scope="col" class="is-recent"><abbr title="${e(recentTitle)}">Last 3 wk</abbr></th>` +
    (isT ? `<th scope="col" class="is-num is-air"><abbr title="Share of the team's air yards">Air yds</abbr></th>` : "") +
    `</tr></thead><tbody>${rows}${othersRow}</tbody></table></div>` +
    `</div></section>`
  );
}

/* ----------------------------------------------------------------- public */

export function renderUsagePremium(view: UsageView, team: NflTeam): string {
  const snaps = snapPanel(view, team);
  const targets = boardPanel("targets", view);
  const rushing = boardPanel("carries", view);
  if (!snaps && !targets && !rushing) return "";
  const logo = team.logo ? `<img class="sct-up-emblem" src="${e(team.logo)}" alt="" width="120" height="120" loading="lazy" decoding="async">` : "";
  return (
    `<div class="sct-block sct-up" id="usage-premium" data-sct-premium="usage">` +
    `<p class="sct-up-flag">New design · Comparison</p>` +
    `<header class="sct-up-head">` +
    `<span class="sct-up-head-icon">${ICON["layers"]}</span>` +
    `<span class="sct-up-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-up-head-text">` +
    `<h2 class="sct-up-h2">Snap Counts &amp; Player Usage</h2>` +
    `<p class="sct-up-dek">${e(
      `Explore how the ${team.nickname} distribute offensive snaps, targets, rushing attempts, and red-zone opportunities. ` +
        `Track which players are seeing the field, where the ball is going, and how their roles change throughout the season.`,
    )}</p>` +
    `</div>` +
    logo +
    `</header>` +
    `<div class="sct-up-dash">` +
    `<div class="sct-up-col is-left">${snaps}</div>` +
    `<div class="sct-up-col is-right">${targets}${rushing}</div>` +
    `</div>` +
    `</div>`
  );
}
