/**
 * The premium comparison version of the Coaching page's three tendency
 * sections (mak's brief, 2026-11-05): Formations & Personnel, Situational
 * Play Calling, and Target & Backfield Tendencies, as one navy-and-gold
 * dashboard. Since 2026-11-05 ("keep the new designs") it IS sections 3-5
 * of the page: the originals were deleted on 2026-11-10.
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
  finishRows,
  finishStop,
  formationsModel,
  rzFourthModel,
  scoreStateModel,
  seasonOf,
  signedPts,
  ptsLabel,
  surnameOf,
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

/**
 * The Situational Usage title bar (mak, 2026-11-08: Formations & Personnel,
 * Coaching Career and Season by Season "match that of Situational Usage"):
 * gold-ringed icon tile, title beside its explainer, stripes on the right.
 * Same markup as usage-situational-premium.ts, styled by `.sct-us-prm-head*`.
 */
export function usageStyleHead(title: string, icon: string, sub?: string, id?: string): string {
  return (
    `<header class="sct-us-prm-head">` +
    `<span class="sct-us-prm-icon" aria-hidden="true">${icon}</span>` +
    `<div class="sct-us-prm-titles">` +
    `<h3 class="sct-us-prm-title"${id ? ` id="${id}"` : ""}>${e(title)}</h3>` +
    // No explainer under the title at any width since 2026-11-21 (mak: the
    // phone version everywhere); `sub` is kept in the signature, unused.
    (void sub, "") +
    `</div>` +
    `<span class="sct-us-prm-stripes" aria-hidden="true"></span>` +
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
    `<div class="sct-cpt-card-text"><h4 class="sct-cpt-h4">${e(titleCase(title))}</h4></div></div>` +
    // No card explainer since 2026-11-21 (mak: the phone version everywhere).
    (void sub, "") +
    body +
    `</article>`
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
    (t.gap != null ? `<span class="sct-cpt-kpi-line">${e(`${ptsLabel(t.gap)} vs NFL avg ${t.avg}`)}</span>` : "") +
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
    usageStyleHead("Formations & Personnel", ICON["layers"]!, m.sub),
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
    `${m.sub} Differences are percentage points against leading by 7+.`,
    "bars",
    // No takeaway since the review of 2026-11-15: the rows show the trailing gap themselves.
    `<div class="sct-cpt-rows">${m.rows.map(scoreRow).join("")}</div>`,
  );
}

function metric(st: NonNullable<RzFourthModel["rz"]> | NonNullable<RzFourthModel["fourth"]>, kind: "rz" | "fourth", priorYear: string, season?: number): string {
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
    // The small-sample caution moved under the section (mak, 2026-11-08).
    lines = [f.priorDetail ? e(f.priorDetail) : "", e(`NFL average ${f.nflAvg}`)];
  }
  return (
    `<div class="sct-cpt-metric is-${kind}">` +
    `<span class="sct-cpt-metric-label">${e(st.label)}</span>` +
    `<span class="sct-cpt-metric-value">${e(st.value)}</span>` +
    head +
    `<ul class="sct-cpt-metric-lines">${lines.filter(Boolean).map((l) => `<li>${l}</li>`).join("")}</ul>` +
    (kind === "fourth" && season ? "" : "") +
    `</div>`
  );
}

/**
 * Phones' fourth-down layout (mak, 2026-11-15): three tiles, this season's
 * go rate leading with its sample ("3 of 3"), then last season's and the
 * NFL average, over one short definition line whose full wording stays for
 * screen readers and on hover. team.css shows it at 560px and under, in
 * place of the stacked metric above; same model, no new figures.
 */
function fourthTiles(f: NonNullable<RzFourthModel["fourth"]>, priorYear: string, season: number): string {
  const priorN = f.priorDetail?.match(/: (\d+ of \d+)/)?.[1] ?? "";
  const nowN = f.count != null && f.count > 0 && f.went != null ? `${f.went} of ${f.count}` : "No snaps yet";
  const tile = (cls: string, k: string, v: string, n: string) =>
    `<li class="sct-cpt-4d-tile${cls}"><span class="sct-cpt-4d-k">${e(k)}</span><b class="sct-cpt-4d-v">${e(v)}</b>${n ? `<span class="sct-cpt-4d-n">${e(n)}</span>` : ""}</li>`;
  const full = "Go rate on fourth-and-2 or less in opponent territory.";
  return (
    `<div class="sct-cpt-4d">` +
    `<ul class="sct-cpt-4d-tiles">` +
    tile(" is-now", `${season} go rate`, f.rate, nowN) +
    (f.prior && f.prior !== "-" ? tile("", `${priorYear} go rate`, f.prior, priorN) : "") +
    (f.nflAvg ? tile("", "NFL average", f.nflAvg, "") : "") +
    `</ul>` +
    `<p class="sct-cpt-4d-def" title="${e(full)}"><span aria-hidden="true">4th-and-2 or less · Opponent territory</span><span class="sct-visually-hidden">${e(full)}</span></p>` +
    `</div>`
  );
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/**
 * Fourth-down decisions only (mak's review, 2026-11-08): the red-zone pass
 * rate, its change and its rank were already in the Play Calling table, so
 * the card keeps the go rate; the red-zone play count moved into that
 * table's row. The card keeps its `is-rz` hook for the grid's styles.
 */
function fourthDownCard(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const m = rzFourthModel(c, team, view);
  if (!m?.fourth) return "";
  return card(
    "rz",
    "Fourth-down decisions",
    `Short fourth downs in opponent territory, ${seasonOf(c)} to date, with the snaps the rate is measured on.`,
    "crosshair",
    // One rendering at every width (Team Pages Phase 2, 2026-11-19): the
    // tiles carry this season's rate and sample, last season's and the NFL
    // average, which the stacked desktop metric printed a second time.
    fourthTiles(m.fourth, m.priorYear, seasonOf(c)),
  );
}

/** The fourth-down sample note: unmounted 2026-11-21 (mak: the phone version everywhere). */
export function situationalNote(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const m = rzFourthModel(c, team, view);
  const f = m?.fourth ?? null;
  if (!f) return "";
  const who = m!.context.split(";")[0] ?? "";
  const small = f.small && f.count != null ? ` The fourth-down rate rests on ${f.count} snap${f.count === 1 ? "" : "s"}: a tendency to watch, not a settled one.` : "";
  return note(`${who}.${small} Score-state rates count plays, and the play counts beside each bar are their samples.`);
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
        `<span class="sct-cpt-row-n"><span class="sct-cpt-badge ${lean ? "is-gold" : d === 0 ? "is-zero" : "is-base"}">${e(ptsLabel(d))}</span></span>` +
        `</div>`
      );
    })
    .join("");
  // No takeaway since the review of 2026-11-15: it repeated the gold row. The
  // title carries the window, since the split is an average of every season
  // he called from 2016 on (the builder's distSeasons: the finishes history
  // plus this season) while the season table under Coaching Career prints
  // one season per row; phones hide the subtitle that says so.
  const years = [...finishRows(c).map((r) => Number(finishStop(r).year)).filter((y) => y > 0), seasonOf(c)];
  const first = Math.min(...years);
  const title = /seasons since/.test(m.sub) && first < seasonOf(c) ? `${m.title}, ${first}-${seasonOf(c)}` : m.title;
  // Each season counts once in the average, the current one included while
  // it is still being played (the builder's unweighted mean of season
  // shares); the league line is averaged over the same seasons.
  const weighting = years.length > 1 ? ` Each season counts equally, ${seasonOf(c)} included${c.tendencies.samples?.throughWeek ? ` through Week ${c.tendencies.samples.throughWeek}` : ""}; differences are percentage points.` : " Differences are percentage points.";
  return card("dist", title, m.sub + weighting, "target", `<div class="sct-cpt-rows">${rows}</div>`);
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
  // No takeaway and no read (mak, 2026-11-15: the "No stable concentration
  // pattern" line is gone at every width); the subtitle is the builder's
  // definition of the bars again.
  return card(
    "back",
    m.title,
    m.sub,
    "runner",
    `<div class="sct-cpt-chart" role="img" aria-label="${e(`Lead back share by season: ${m.caption}`)}">` +
      `<div class="sct-cpt-chart-plot">${cols}</div>` +
      `<div class="sct-cpt-chart-labels">${labels}</div>` +
      `</div>`,
  );
}

/* ------------------------------------------------------------------ public */

export function renderCoachingPremiumTendencies(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  // Formations & Personnel is no longer mounted (mak, 2026-11-08): it
  // repeated Formations & Tempo; its data note is the coaching footnote now.
  const form = "";
  void formations;
  void sectionHead;
  const sit = scoreStateCard(c) + fourthDownCard(c, team, view);
  const tgt = distributionCard(c) + backfieldCard(c, view);
  if (!form && !sit && !tgt) return "";
  return (
    `<div class="sct-block sct-cp sct-cpt" id="coaching-premium-tendencies" data-sct-premium="coaching-tendencies">` +
    form +
    // The two group title bars ("Situational Play Calling", "Target &
    // Backfield Tendencies") and the fourth-down sample note came off
    // 2026-11-21 (mak): each card's own head is the section head, as on phones.
    (sit ? section("situational", "", `<div class="sct-cpt-grid">${sit}</div>`) : "") +
    (tgt ? section("targets", "", `<div class="sct-cpt-grid">${tgt}</div>`) : "") +
    `</div>`
  );
}
