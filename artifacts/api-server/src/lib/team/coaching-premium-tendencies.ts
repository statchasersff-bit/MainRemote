/**
 * The premium comparison version of the Coaching page's three tendency
 * sections (mak's brief, 2026-11-05): Formations & Personnel, Situational
 * Play Calling, and Target & Backfield Tendencies, as one navy-and-gold
 * dashboard. Since 2026-11-05 ("keep the new designs") it IS sections 3-5
 * of the page: the originals are unmounted in coaching-render.ts.
 *
 * Every number is the model the original blocks draw (formationsModel,
 * scoreStateModel, rzFourthModel, distributionModel, backfieldModel in
 * coaching-render.ts), so the two versions cannot disagree and nothing is
 * fetched or computed twice. The block shares the `.sct-cp` container (its
 * tokens and the `premium` container name) and adds `.sct-cpt-*` rules in
 * team.css; nothing here touches the original's markup or styles.
 */

import { titleCase } from "../player/title-case";
import { escapeHtml } from "../render";
import {
  backfieldModel,
  distributionModel,
  formationsModel,
  rzFourthModel,
  scoreStateModel,
  signedPts,
  type FormationTile,
  type RzFourthModel,
  type ScoreStateRow,
} from "./coaching-render";
import type { TeamCoaching } from "./coaching";
import type { NflTeam } from "./teams";
import type { UsageView } from "./usage";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

const stroke = (d: string, size = 24, extra = "") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g>${extra}</svg>`;

/** Inline icons drawn in currentColor, one per section and metric; decorative. */
export const ICON: Record<string, string> = {
  layers: stroke(`<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>`, 30),
  bars: stroke(`<path d="M4 20h16"/><path d="M7 20v-7M12 20V5M17 20v-10"/>`, 26),
  target: stroke(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>`, 26, `<circle cx="12" cy="12" r="1.8" fill="currentColor"/>`),
  zap: stroke(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`),
  route: stroke(`<path d="M4 20V10a4 4 0 0 1 4-4h12"/><path d="M16 2l4 4-4 4"/><path d="M4 20h8a4 4 0 0 0 4-4v-2"/><path d="M13 11l3 3 3-3"/>`),
  users: stroke(`<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 22 19"/>`),
  crosshair: stroke(`<circle cx="12" cy="12" r="7.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`, 24, `<circle cx="12" cy="12" r="1.6" fill="currentColor"/>`),
  runner: stroke(`<circle cx="15" cy="4.5" r="2"/><path d="M9.5 21l2.5-6-3-2 2.5-5 4 1.5 3 3"/><path d="M11.5 8l-4 1.5-2 4"/><path d="M12 15l4 2 1 4"/>`),
  info: stroke(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.4"/>`, 16),
  /** The faint play diagram on the main header's right (X and O marks and route lines; decorative, not charted data). */
  art: `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-cpt-art"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 72c30-38 62-44 96-30"/><path d="M106 44l10-4-2 10"/><path d="M60 78c26-10 40-28 54-52"/><path d="M150 76c20-2 38-16 52-40"/><path d="M196 40l8-3-1 9"/><path d="M118 80c24 2 40-8 52-22"/></g><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M28 24l10 10M38 24l-10 10"/><path d="M62 16l10 10M72 16l-10 10"/><path d="M212 62l10 10M222 62l-10 10"/></g><g fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="140" cy="18" r="6"/><circle cx="174" cy="12" r="6"/><circle cx="238" cy="24" r="6"/><circle cx="92" cy="60" r="6"/></g></svg>`,
};

const TILE_ICON: Record<string, string> = { motionRate: "zap", paRate: "route", noHuddleRate: "users" };

/* -------------------------------------------------------------- primitives */

/** A navy section header; the main one carries a subtitle, a gold divider and the play-diagram art. */
function sectionHead(title: string, icon: string, sub?: string): string {
  return (
    `<header class="sct-cpt-head${sub ? " is-main" : ""}">` +
    `<span class="sct-cpt-head-icon">${ICON[icon]}</span>` +
    (sub ? `<span class="sct-cpt-head-rule"></span>` : "") +
    `<div class="sct-cpt-head-text"><h3 class="sct-cpt-h3">${e(title)}</h3>${sub ? `<p class="sct-cpt-dek">${e(sub)}</p>` : ""}</div>` +
    (sub ? ICON["art"] : "") +
    `</header>`
  );
}

function section(kind: string, head: string, body: string): string {
  return `<section class="sct-cpt-section is-${kind}">${head}<div class="sct-cpt-body">${body}</div></section>`;
}

/** An analytical card: gold icon in a pale-gold square, Title Case heading, subtitle, then its body. */
function card(kind: string, title: string, sub: string, icon: string, body: string): string {
  return (
    `<article class="sct-cpt-card is-${kind}">` +
    `<div class="sct-cpt-card-head"><span class="sct-cpt-card-icon">${ICON[icon]}</span>` +
    `<div class="sct-cpt-card-text"><h4 class="sct-cpt-h4">${e(titleCase(title))}</h4><p class="sct-cpt-card-sub">${e(sub)}</p></div></div>` +
    body +
    `</article>`
  );
}

/** The inset takeaway: gold icon, TAKEAWAY kicker, the bold read, a muted supporting line. */
function takeaway(line: string, context: string): string {
  return (
    `<div class="sct-cpt-take"><span class="sct-cpt-take-icon">${ICON["target"]}</span>` +
    `<div class="sct-cpt-take-text"><span class="sct-cpt-take-kicker">Takeaway</span>` +
    `<p class="sct-cpt-take-h">${e(line)}</p>` +
    (context ? `<p class="sct-cpt-take-b">${e(context)}</p>` : "") +
    `</div></div>`
  );
}

/** A compact methodology note with the info glyph. */
function note(text: string): string {
  return `<p class="sct-cpt-note"><span class="sct-cpt-note-icon">${ICON["info"]}</span><span>${e(text)}</span></p>`;
}

const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;

/* -------------------------------------------------------------- formations */

function formationTile(t: FormationTile): string {
  return (
    `<li class="sct-cpt-kpi">` +
    `<span class="sct-cpt-kpi-icon">${ICON[TILE_ICON[t.key] ?? "zap"]}</span>` +
    `<div class="sct-cpt-kpi-text">` +
    `<span class="sct-cpt-kpi-label">${e(t.label)}</span>` +
    `<span class="sct-cpt-kpi-value">${e(t.value)}</span>` +
    // A difference from the league, not a grade: neutral ink whichever way it points.
    (t.gap != null ? `<span class="sct-cpt-kpi-line">${e(`${signedPts(t.gap)} pp vs NFL avg ${t.avg}`)}</span>` : "") +
    `</div></li>`
  );
}

function formations(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const m = formationsModel(c, team, view);
  if (!m) return "";
  const sp = m.split;
  const split = sp
    ? `<div class="sct-cpt-split" role="img" aria-label="${e(`Shotgun ${sp.shotgun}% of snaps, under center ${sp.under}%${sp.avg != null ? `; NFL average shotgun ${sp.avg}%` : ""}`)}">` +
      `<div class="sct-cpt-split-stat is-sg"><b>${e(`${sp.shotgun}%`)}</b><span>Shotgun</span></div>` +
      `<span class="sct-cpt-split-sep"></span>` +
      `<div class="sct-cpt-split-stat is-under"><b>${e(`${sp.under}%`)}</b><span>Under Center</span></div>` +
      `<span class="sct-cpt-split-bar"><span class="sct-cpt-split-fill" style="width:${pct(sp.shotgun)}"></span>` +
      (sp.avg != null ? `<span class="sct-cpt-split-avg" style="left:${pct(sp.avg)}"></span>` : "") +
      `</span>` +
      (sp.avg != null ? `<div class="sct-cpt-split-key"><span class="sct-cpt-split-tick"></span><span>NFL Avg (Shotgun): <b>${e(`${sp.avg}%`)}</b></span></div>` : "") +
      `</div>`
    : "";
  return section(
    "formations",
    sectionHead("Formations & Personnel", "layers", m.sub),
    split + (m.tiles.length ? `<ul class="sct-cpt-kpis">${m.tiles.map(formationTile).join("")}</ul>` : "") + note(m.note),
  );
}

/* ------------------------------------------------------------- situational */

function scoreRow(r: ScoreStateRow): string {
  const share = r.row.share ?? 0;
  const badge = r.baseline ? "is-base" : r.flag ? "is-gold" : "is-zero";
  return (
    `<div class="sct-cpt-row${r.flag ? " is-flag" : ""}">` +
    `<span class="sct-cpt-row-label">${e(r.row.label)}</span>` +
    `<span class="sct-cpt-track" role="img" aria-label="${e(`${r.row.label}: ${r.row.result ?? `${share}% pass`}`)}"><span class="sct-cpt-fill${r.flag ? " is-gold" : ""}" style="width:${pct(share)}"></span></span>` +
    `<span class="sct-cpt-row-val"><b>${e(r.pass)}</b><span class="sct-cpt-badge ${badge}">${e(r.diff)}</span></span>` +
    `<span class="sct-cpt-row-n">${r.plays ? e(r.plays) : ""}</span>` +
    `</div>`
  );
}

function scoreStateCard(c: TeamCoaching): string {
  const m = scoreStateModel(c);
  if (!m.rows.length) return "";
  return card(
    "score",
    "Play-calling by score state",
    m.sub,
    "bars",
    `<div class="sct-cpt-rows">${m.rows.map(scoreRow).join("")}</div>` + (m.verdict ? takeaway(m.verdict, m.context) : ""),
  );
}

function metric(st: NonNullable<RzFourthModel["rz"]> | NonNullable<RzFourthModel["fourth"]>, kind: "rz" | "fourth", priorYear: string): string {
  let head = "";
  let lines: string[] = [];
  if (kind === "rz") {
    const rz = st as NonNullable<RzFourthModel["rz"]>;
    // The arrow is the stored direction against last season; the color stays neutral.
    head = rz.change ? `<span class="sct-cpt-metric-change is-${rz.dir}">${e(rz.change)}</span>` : "";
    lines = [
      `NFL average ${rz.nflAvg}` + (rz.rank != null ? ` · <span class="sct-cpt-rank">${e(`${ordinal(rz.rank)} in NFL`)}</span>` : ""),
      rz.plays != null ? e(`${rz.plays} red-zone plays this season${rz.priorPlays != null ? `; ${rz.priorPlays} in ${priorYear}` : ""}`) : "",
    ];
  } else {
    const f = st as NonNullable<RzFourthModel["fourth"]>;
    head = `<span class="sct-cpt-metric-change is-flat">${e(f.lines[0] ?? "")}</span>`;
    lines = [f.priorDetail ? e(f.priorDetail) : "", e(`NFL average ${f.nflAvg}`), f.small ? `<span class="sct-cpt-caution">${e(f.lines[3] ?? "")}</span>` : ""];
  }
  return (
    `<div class="sct-cpt-metric is-${kind}">` +
    `<span class="sct-cpt-metric-label">${e(st.label)}</span>` +
    `<span class="sct-cpt-metric-value">${e(st.value)}</span>` +
    head +
    `<ul class="sct-cpt-metric-lines">${lines.filter(Boolean).map((l) => `<li>${l}</li>`).join("")}</ul>` +
    `</div>`
  );
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

function redZoneCard(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const m = rzFourthModel(c, team, view);
  if (!m) return "";
  return card(
    "rz",
    "Red zone and fourth down",
    m.sub,
    "crosshair",
    `<div class="sct-cpt-metrics">${m.rz ? metric(m.rz, "rz", m.priorYear) : ""}${m.fourth ? metric(m.fourth, "fourth", m.priorYear) : ""}</div>` + note(m.context),
  );
}

/* ----------------------------------------------------------------- targets */

function distributionCard(c: TeamCoaching): string {
  const m = distributionModel(c);
  if (!m.rows.length) return "";
  const rows = m.rows
    .map(({ row, d, lean }) => {
      const share = row.pct ?? 0;
      return (
        `<div class="sct-cpt-row is-dist${lean ? " is-flag" : ""}">` +
        `<span class="sct-cpt-row-label">${e(row.label)}</span>` +
        `<span class="sct-cpt-track" role="img" aria-label="${e(`${row.label}: ${row.pct}% of targets, league average ${row.nfl}%`)}">` +
        `<span class="sct-cpt-fill${lean ? " is-gold" : ""}" style="width:${pct(share)}"></span>` +
        (row.nfl != null ? `<span class="sct-cpt-mark" style="left:${pct(row.nfl)}"></span>` : "") +
        `</span>` +
        `<span class="sct-cpt-row-val"><b>${e(`${row.pct}%`)}</b><span class="sct-cpt-row-avg">${e(`NFL ${row.nfl}%`)}</span></span>` +
        `<span class="sct-cpt-row-n"><span class="sct-cpt-badge ${lean ? "is-gold" : d === 0 ? "is-zero" : "is-base"}">${e(`${signedPts(d)} pp`)}</span></span>` +
        `</div>`
      );
    })
    .join("");
  return card("dist", m.title, m.sub, "target", `<div class="sct-cpt-rows">${rows}</div>` + takeaway(m.line, m.context));
}

function backfieldCard(c: TeamCoaching, view: UsageView | null): string {
  const m = backfieldModel(c, view);
  if (!m.bars.length) return "";
  // A true 0-100% scale: the plot is the whole track, so a 27% bar is a third of an 80% one.
  const cols = m.bars
    .map(
      (bar) =>
        `<div class="sct-cpt-col${bar.current ? " is-current" : ""}" title="${e(`${bar.label}: lead back ${bar.value}% of backfield weighted opportunities`)}">` +
        `<span class="sct-cpt-col-val" style="bottom:${pct(bar.value)}">${e(`${bar.value}%`)}</span>` +
        `<span class="sct-cpt-col-bar" style="height:${pct(bar.value)}"></span>` +
        `</div>`,
    )
    .join("");
  const labels = m.bars.map((bar) => `<span class="sct-cpt-col-label${bar.current ? " is-current" : ""}">${e(bar.label)}</span>`).join("");
  return card(
    "back",
    m.title,
    m.sub,
    "runner",
    `<div class="sct-cpt-chart" role="img" aria-label="${e(`Lead back share by season: ${m.caption}`)}">` +
      `<div class="sct-cpt-chart-plot">${cols}</div>` +
      `<div class="sct-cpt-chart-labels">${labels}</div>` +
      `</div>` +
      takeaway(m.line, m.context),
  );
}

/* ------------------------------------------------------------------ public */

export function renderCoachingPremiumTendencies(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const form = formations(c, team, view);
  const sit = scoreStateCard(c) + redZoneCard(c, team, view);
  const tgt = distributionCard(c) + backfieldCard(c, view);
  if (!form && !sit && !tgt) return "";
  return (
    `<div class="sct-block sct-cp sct-cpt" id="coaching-premium-tendencies" data-sct-premium="coaching-tendencies">` +
    form +
    (sit ? section("situational", sectionHead("Situational Play Calling", "bars"), `<div class="sct-cpt-grid">${sit}</div>`) : "") +
    (tgt ? section("targets", sectionHead("Target & Backfield Tendencies", "target"), `<div class="sct-cpt-grid">${tgt}</div>`) : "") +
    `</div>`
  );
}
