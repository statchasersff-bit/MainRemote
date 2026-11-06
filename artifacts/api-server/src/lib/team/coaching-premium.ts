/**
 * The premium comparison version of the Offensive Coaching & Scheme top
 * block (mak's instructions, 2026-11-05): the coordinator profile beside
 * four KPI cards, a Play Calling section with its comparison table and a
 * key-takeaway panel, a Formations & Tempo section with its table and a
 * formation visual, and a bottom insight banner.
 *
 * Since 2026-11-05 ("keep the new designs") this IS the page's top block:
 * the original header, profile, KPI tiles and tendency tables are unmounted
 * in coaching-render.ts. The heading carries .sct-h2 so a section address
 * promotes it to the H1 (team-render.ts promoteHeading). Every number here is the
 * same row view the original tables draw (rowViews / changeText /
 * groupSentence from coaching-render.ts), so the two cannot disagree; no
 * data is fetched or computed twice. Styles are isolated under `.sct-cp-*`
 * (team.css) and never touch the original's rules.
 */

import { escapeHtml } from "../render";
import { premiumTabHead } from "./premium-head";
import {
  GROUPS,
  IDENTITY_KEYS,
  KEEP_SUB,
  atEdge,
  changeText,
  cityOf,
  groupSentence,
  num,
  relNote,
  rowLabel,
  rowViews,
  schemeChip,
  seasonOf,
  splitTree,
  stintLine,
  type RowView,
} from "./coaching-render";
import { getCoachingStaff, reliabilityRating, RELIABILITY_PCT, type TeamCoaching, type TendencyRow } from "./coaching";
import type { NflTeam } from "./teams";
import type { UsageView } from "./usage";

const e = escapeHtml;

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/* ------------------------------------------------------------------ icons */

/** Inline icons drawn in currentColor; the mockup's set: play diagram, football, target, layers, gauge, clipboard, bars, info. */
const ICON: Record<string, string> = {
  diagram: `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path d="M5 9l6 6M11 9l-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="23" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 25c5-9 12-9 17-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M22 19l4 2-1 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pass: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 19c1-8 7-14 16-15 -1 9-7 15-16 15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 15l6-6M10 12l2 2M12 10l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>`,
  motion: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3l9 4.5-9 4.5-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 17l4-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="currentColor"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 3h6v3H9zM8 11l3 3M11 11l-3 3M13 15h3M13 18h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l9 4.5-9 4.5-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  bars: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="11" width="4" height="7" fill="currentColor"/><rect x="8" y="7" width="4" height="11" fill="currentColor"/><rect x="14" y="3" width="4" height="15" fill="currentColor"/></svg>`,
  trend: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 12l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 5h3v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  info: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 4.8v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  /** The decorative wave under a KPI (a divider, not data). */
  wave: `<svg viewBox="0 0 100 18" width="100%" height="18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12c12-8 22 2 34-2s22-10 34-4 20 6 32 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  /** The faint play diagram on the header's right. */
};

const KPI_ICON: Record<string, string> = { passRate: "pass", rzPassRate: "target", motionRate: "motion", pace: "clock" };
const KPI_LABEL: Record<string, string> = { passRate: "Pass Rate", rzPassRate: "Red-Zone Pass Rate", motionRate: "Pre-Snap Motion", pace: "Neutral Pace" };

/* --------------------------------------------------------------- overview */

function profileCard(c: TeamCoaching, team: NflTeam): string {
  const [title] = c.playCaller.kicker.split(" · ");
  const staff = getCoachingStaff(team.abbreviation, seasonOf(c));
  const isHC = /head coach/i.test(title ?? "");
  const role = isHC ? "Head Coach & Play-Caller" : `${title ?? "Offensive Coordinator"} & Play-Caller`.replace(/^offensive coordinator/i, "Offensive Coordinator");
  const under = !isHC && staff?.hc ? `Under head coach ${staff.hc}` : "";
  const tree = c.playCaller.tree ? splitTree(c.playCaller.tree) : null;
  const scheme = tree?.note ? schemeChip(tree.note) : null;
  const rating = reliabilityRating(c);
  const word = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" }[rating];
  const pct = RELIABILITY_PCT[rating];
  return (
    `<div class="sct-cp-profile">` +
    `<p class="sct-cp-kicker">${e(role)}</p>` +
    `<p class="sct-cp-name">${e(c.playCaller.name)}</p>` +
    `<p class="sct-cp-pills">` +
    `<span class="sct-cp-pill"${tree?.note ? ` title="${e(tree.note)}"` : ""}>${e(tree ? tree.tag : "No established tree")}</span>` +
    (scheme ? `<span class="sct-cp-pill" title="${e(tree?.note ?? "")}">${e(scheme)}</span>` : "") +
    `</p>` +
    `<p class="sct-cp-context">${e([under, stintLine(c, team)].filter(Boolean).join(" · "))}</p>` +
    `<div class="sct-cp-cont">` +
    `<p class="sct-cp-cont-row"><span class="sct-cp-cont-label">Coaching Continuity</span>` +
    `<span class="sct-cp-cont-status is-${rating.toLowerCase()}">${e(word)}</span></p>` +
    `<span class="sct-cp-cont-bar" role="img" aria-label="${e(`Coaching continuity: ${word}`)}"><span style="width:${pct}%"></span></span>` +
    `<p class="sct-cp-cont-note">${e(relNote(c, rating).replace(/\.$/, ""))}</p>` +
    `</div>` +
    `</div>`
  );
}

/** "▼ 2.5 pp vs 2025" / "▲ 1.4s faster than 2025": the change line, a triangle for direction. */
function tri(t: string): string {
  return t.replace(/^↑/, "▲").replace(/^↓/, "▼");
}

function kpiCards(c: TeamCoaching, view: UsageView | null): string {
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const views = rowViews(c, view);
  const cards = IDENTITY_KEYS.map((k) => views.find((x) => x.row.key === k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map(({ row, v }) => {
      let line = "";
      if (atEdge(v.rank)) line = `<span class="sct-cp-kpi-pill">${e(`${ordinal(v.rank as number)} in NFL`)}</span>`;
      else if (v.delta != null && v.change.dir !== "flat") {
        const t = tri(changeText(row, v));
        line = `<span class="sct-cp-kpi-move is-${v.delta > 0 ? "up" : "down"}">${e(row.key === "pace" ? `${t} than ${priorYear}` : `${t} vs ${priorYear}`)}</span>`;
      } else if (v.delta != null) line = `<span class="sct-cp-kpi-move is-flat">${e(`Level with ${priorYear}`)}</span>`;
      return (
        `<li class="sct-cp-kpi">` +
        `<span class="sct-cp-kpi-icon">${ICON[KPI_ICON[row.key as string] ?? "trend"]}</span>` +
        `<span class="sct-cp-kpi-label">${e(KPI_LABEL[row.key as string] ?? row.label)}</span>` +
        `<span class="sct-cp-kpi-value">${e(v.current)}</span>` +
        line +
        // No sparkline: there is no per-week series behind a tile, so the
        // accent is a plain rule (mak's refinement note, 2026-11-05).
        `<span class="sct-cp-kpi-rule" aria-hidden="true"></span>` +
        `</li>`
      );
    })
    .join("");
  return cards ? `<ul class="sct-cp-kpis">${cards}</ul>` : "";
}

/* ----------------------------------------------------------------- tables */

/** The dumbbell: hollow prior, filled current, a tick for the NFL average; the same scale rule as the original strip. */
function dumbbell(row: TendencyRow, v: RowView, priorYear: string, season: number): string {
  const prior = num(row.prior);
  const now = num(v.current);
  const avg = num(row.nflAvg);
  if (prior == null || now == null) return "";
  const pts = avg == null ? [prior, now] : [prior, now, avg];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const half = Math.max((max - min) / 2, row.invert ? 2.5 : 5) * 1.35;
  const mid = (min + max) / 2;
  const x = (val: number) => {
    const p = Math.max(3, Math.min(97, ((val - (mid - half)) / (2 * half)) * 100));
    return row.invert ? 100 - p : p;
  };
  const a = x(prior);
  const b = x(now);
  const label = `${priorYear} ${row.prior}, ${season} ${v.current}${avg == null ? "" : `, NFL avg ${row.nflAvg}`}`;
  return (
    `<span class="sct-cp-db" role="img" aria-label="${e(label)}" title="${e(label)}">` +
    `<span class="sct-cp-db-bar is-${v.change.dir}" style="left:${Math.min(a, b).toFixed(1)}%;width:${Math.abs(b - a).toFixed(1)}%"></span>` +
    (avg == null ? "" : `<span class="sct-cp-db-avg" style="left:${x(avg).toFixed(1)}%" title="${e(`NFL avg ${row.nflAvg}`)}"></span>`) +
    `<span class="sct-cp-db-prior" style="left:${a.toFixed(1)}%"></span>` +
    `<span class="sct-cp-db-now" style="left:${b.toFixed(1)}%"></span>` +
    `</span>`
  );
}

function table(
  group: Array<{ row: TendencyRow; v: RowView; i: number }>,
  c: TeamCoaching,
  team: NflTeam,
  priorYear: string,
  season: number,
  label: string,
): string {
  // The most notable meaningful change: the biggest move of 3+ points (a second of pace) gets the gold row.
  const notable = group
    .filter(({ row, v }) => v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3))
    .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))[0];
  const callerLast = c.tendencies.priorLabel.match(/\((.+)\)$/)?.[1] ?? "";
  const rows = group
    .map(({ row, v, i }) => {
      const sub = row.sub && row.key && KEEP_SUB.has(row.key) ? `<span class="sct-cp-sub">${e(row.sub)}</span>` : "";
      const rank = atEdge(v.rank) ? `<span class="sct-cp-rank">${e(ordinal(v.rank as number))}</span>` : "";
      const chg = tri(changeText(row, v));
      return (
        `<tr${row === notable?.row ? ` class="is-notable"` : ""}>` +
        `<th scope="row" class="sct-cp-td is-metric">${rowLabel(row, `sct-cp-def-${i}`)}${sub}</th>` +
        `<td class="sct-cp-td is-prior">${e(row.prior)}</td>` +
        `<td class="sct-cp-td is-now">${e(v.current)}</td>` +
        `<td class="sct-cp-td is-change"><span class="sct-cp-chg">${dumbbell(row, v, priorYear, season)}` +
        `<span class="sct-cp-change is-${v.change.dir}">${e(chg)}</span>${rank}</span></td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<div class="sct-cp-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} ${label.toLowerCase()}, premium comparison`)}">` +
    `<table class="sct-cp-table">` +
    `<thead><tr>` +
    `<th scope="col">Metric</th>` +
    `<th scope="col" class="is-prior">${e(priorYear)}<span class="sct-cp-th-sub">${e(callerLast || "Prior season")}</span></th>` +
    `<th scope="col" class="is-now">${season}<span class="sct-cp-th-sub">Current</span></th>` +
    `<th scope="col">Change<span class="sct-cp-th-sub">vs ${e(priorYear)} · Tick = NFL Avg</span></th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/* --------------------------------------------------------------- insights */

const HEADLINE: Record<string, [string, string]> = {
  passRate: ["Throwing more often.", "Leaning on the run."],
  proe: ["Passing above expectation.", "Running more than the situation calls for."],
  earlyDownPassRate: ["Passing on the downs that are a choice.", "Running on the downs that are a choice."],
  rzPassRate: ["More aggressive in the red zone.", "Running it in the red zone."],
  paRate: ["More play-action.", "Less play-action."],
};

const FORM_PHRASE: Record<string, [string, string]> = {
  motionRate: ["more motion", "less motion"],
  shotgunRate: ["more shotgun", "more under center"],
  noHuddleRate: ["more no-huddle", "less no-huddle"],
  pace: ["faster tempo", "slower tempo"],
};

function moves(group: Array<{ row: TendencyRow; v: RowView }>): Array<{ row: TendencyRow; v: RowView; d: number }> {
  return group
    .filter(({ row, v }) => v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3))
    .map(({ row, v }) => ({ row, v, d: v.delta as number }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}

function takeaway(group: Array<{ row: TendencyRow; v: RowView; i: number }>, team: NflTeam, priorYear: string, returning: boolean): string {
  const top = moves(group)[0];
  const headline = top && top.row.key && HEADLINE[top.row.key] ? HEADLINE[top.row.key]![top.d > 0 ? 0 : 1] : `Play calling holds steady.`;
  const body = groupSentence(group, team, priorYear, returning).split(" Against the league,")[0] ?? "";
  // The highlighted stat: a row at a league edge, else the biggest move.
  const edge = group.find(({ v }) => atEdge(v.rank));
  const stat = edge ?? top;
  const cell = (v: string, l: string) => `<span class="sct-cp-stat-cell"><span class="sct-cp-stat-v">${e(v)}</span><span class="sct-cp-stat-l">${e(l)}</span></span>`;
  const statHtml = stat
    ? `<p class="sct-cp-stat">` +
      cell(stat.v.current, stat.row.label.replace(/ \(all downs\)$/, "")) +
      (edge && atEdge(edge.v.rank)
        ? `<span class="sct-cp-stat-sep" aria-hidden="true"></span>${cell(ordinal(edge.v.rank as number), "in NFL")}`
        : top
          ? `<span class="sct-cp-stat-sep" aria-hidden="true"></span>${cell(tri(changeText(top.row, top.v)), `vs ${priorYear}`)}`
          : "") +
      `</p>`
    : "";
  return (
    `<aside class="sct-cp-take">` +
    `<p class="sct-cp-take-kicker"><span class="sct-cp-take-icon">${ICON["bars"]}</span>Key Takeaway</p>` +
    `<p class="sct-cp-take-h">${e(headline)}</p>` +
    `<p class="sct-cp-take-b">${e(body)}</p>` +
    statHtml +
    `</aside>`
  );
}

/** Shotgun against under center: exhaustive by the row's definition (a snap is logged shotgun or not), so a two-segment donut is honest. */
function formationVisual(group: Array<{ row: TendencyRow; v: RowView; i: number }>, season: number): string {
  const sg = group.find(({ row }) => row.key === "shotgunRate");
  const share = sg ? num(sg.v.current) : null;
  if (share == null) return "";
  const avg = sg ? num(sg.row.nflAvg) : null;
  const r = 34;
  const circ = 2 * Math.PI * r;
  const dash = (share / 100) * circ;
  const under = Math.round((100 - share) * 10) / 10;
  return (
    `<aside class="sct-cp-form">` +
    `<p class="sct-cp-form-title">${e(`Formation Profile (${season})`)}</p>` +
    `<div class="sct-cp-donut-wrap">` +
    `<svg class="sct-cp-donut" viewBox="0 0 90 90" width="120" height="120" role="img" aria-label="${e(`Shotgun ${share}% of snaps, under center ${under}%`)}">` +
    `<circle cx="45" cy="45" r="${r}" class="sct-cp-donut-under"/>` +
    `<circle cx="45" cy="45" r="${r}" class="sct-cp-donut-sg" stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" transform="rotate(-90 45 45)"/>` +
    `<text x="45" y="43" text-anchor="middle" class="sct-cp-donut-v">${e(`${share}%`)}</text>` +
    `<text x="45" y="56" text-anchor="middle" class="sct-cp-donut-l">Shotgun</text>` +
    `</svg>` +
    `<ul class="sct-cp-donut-key">` +
    `<li><i class="sct-cp-sw is-sg"></i><span>Shotgun</span><b>${e(`${share}%`)}</b></li>` +
    `<li><i class="sct-cp-sw is-under"></i><span>Under Center</span><b>${e(`${under}%`)}</b></li>` +
    (avg != null ? `<li class="is-avg"><i class="sct-cp-sw is-avg"></i><span>NFL avg shotgun</span><b>${e(`${avg}%`)}</b></li>` : "") +
    `</ul></div>` +
    `<p class="sct-cp-form-note">Shotgun or not, over every offensive snap; pistol counts as shotgun when the play-by-play logs it so.</p>` +
    `</aside>`
  );
}

function banner(group: Array<{ row: TendencyRow; v: RowView; i: number }>, team: NflTeam, priorYear: string, returning: boolean): string {
  const ms = moves(group).slice(0, 3);
  const words = ms.map(({ row, d }) => FORM_PHRASE[row.key as string]?.[d > 0 ? 0 : 1]).filter((w): w is string => !!w);
  const headline = words.length ? `${words.join(", ")}.`.replace(/^./, (ch) => ch.toUpperCase()) : "Formations and tempo hold steady.";
  return (
    `<div class="sct-cp-banner">` +
    `<span class="sct-cp-banner-icon">${ICON["target"]}</span>` +
    `<span class="sct-cp-banner-rule" aria-hidden="true"></span>` +
    `<div><p class="sct-cp-banner-h">${e(headline)}</p>` +
    `<p class="sct-cp-banner-b">${e(groupSentence(group, team, priorYear, returning))}</p></div>` +
    `</div>`
  );
}

/* ----------------------------------------------------------------- public */

export function renderCoachingPremium(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const returning = c.reliability.priorSeasonsAsCaller > 0;
  const views = rowViews(c, view);
  const groupOf = (keys: string[]) => keys.map((k) => views.find((x) => x.row.key === k)).filter((x): x is NonNullable<typeof x> => !!x);
  const calling = groupOf(GROUPS[0]!.keys);
  const form = groupOf(GROUPS[1]!.keys);
  const section = (title: string, icon: string, body: string) =>
    `<section class="sct-cp-section"><h3 class="sct-cp-h3"><span class="sct-cp-h3-icon">${icon}</span>${e(title)}</h3><div class="sct-cp-section-body">${body}</div></section>`;
  void cityOf;
  return (
    `<div class="sct-block sct-cp" id="coaching-premium" data-sct-premium="coaching">` +
    premiumTabHead({
      hook: "sct-cp-head",
      icon: "coaching",
      art: "coaching",
      heading: `<h2 class="sct-h2 sct-up-h2 sct-cp-h2">Offensive Coaching &amp; Scheme</h2>`,
      dek: "Play-calling tendencies, offensive philosophy, formations, and coaching history.",
    }) +
    `<div class="sct-cp-overview">${profileCard(c, team)}${kpiCards(c, view)}</div>` +
    (calling.length
      ? section("Play Calling", ICON["play"]!, `<div class="sct-cp-split">${table(calling, c, team, priorYear, season, "Play Calling")}${takeaway(calling, team, priorYear, returning)}</div>`)
      : "") +
    (form.length
      ? section("Formations & Tempo", ICON["grid"]!, `<div class="sct-cp-split">${table(form, c, team, priorYear, season, "Formations & Tempo")}${formationVisual(form, season)}</div>`) +
        banner(form, team, priorYear, returning)
      : "") +
    `<p class="sct-cp-foot"><span class="sct-cp-foot-icon">${ICON["info"]}</span>Select a metric for how it is counted. Hollow dot ${e(priorYear)}, filled dot ${season}, tick the NFL average. The gold row is the group's biggest change of 3+ pp or a second of pace.</p>` +
    `</div>`
  );
}
