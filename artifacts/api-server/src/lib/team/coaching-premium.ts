/**
 * The premium comparison version of the Offensive Coaching & Scheme top
 * block (mak's instructions, 2026-11-05): the coordinator profile beside
 * four KPI cards, a Play Calling section with its comparison table and a
 * key-takeaway panel, a Formations & Tempo section with its table and a
 * formation visual, and a bottom insight banner.
 *
 * Rendered DIRECTLY UNDER the whole existing section, which is untouched,
 * so the two designs can be compared on one page. Every number here is the
 * same row view the original tables draw (rowViews / changeText /
 * groupSentence from coaching-render.ts), so the two cannot disagree; no
 * data is fetched or computed twice. Styles are isolated under `.sct-cp-*`
 * (team.css) and never touch the original's rules.
 */

import { escapeHtml } from "../render";
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

/** Small inline icons, 16px, drawn in currentColor. */
const ICON: Record<string, string> = {
  pass: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 12.5C4 6 10 2.5 14 2.5c0 4-3.5 10-10 11.5l-2-1.5z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 10l4-4" stroke="currentColor" stroke-width="1.5"/></svg>`,
  target: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`,
  motion: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 8h8M7 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 5v6" stroke="currentColor" stroke-width="1.5"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  play: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2.5l10 5.5-10 5.5z" fill="currentColor"/></svg>`,
  grid: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="5" height="5" fill="currentColor"/><rect x="9" y="2" width="5" height="5" fill="currentColor"/><rect x="2" y="9" width="5" height="5" fill="currentColor"/><rect x="9" y="9" width="5" height="5" fill="currentColor"/></svg>`,
  trend: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 12l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 5h3v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
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

function kpiCards(c: TeamCoaching, view: UsageView | null): string {
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const views = rowViews(c, view);
  const cards = IDENTITY_KEYS.map((k) => views.find((x) => x.row.key === k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map(({ row, v }) => {
      let line = "";
      if (atEdge(v.rank)) line = `${ordinal(v.rank as number)} in NFL`;
      else if (v.delta != null && v.change.dir !== "flat") {
        const t = changeText(row, v);
        line = row.key === "pace" ? `${t.replace(/^[↑↓] /, "")} than ${priorYear}` : `${t.replace(/^↑/, "Up").replace(/^↓/, "Down")} vs. ${priorYear}`;
      } else if (v.delta != null) line = `Level with ${priorYear}`;
      return (
        `<li class="sct-cp-kpi">` +
        `<span class="sct-cp-kpi-icon">${ICON[KPI_ICON[row.key as string] ?? "trend"]}</span>` +
        `<span class="sct-cp-kpi-label">${e(KPI_LABEL[row.key as string] ?? row.label)}</span>` +
        `<span class="sct-cp-kpi-value">${e(v.current)}</span>` +
        (line ? `<span class="sct-cp-kpi-line">${e(line)}</span>` : "") +
        `<span class="sct-cp-kpi-foot" aria-hidden="true"></span>` +
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
      return (
        `<tr${row === notable?.row ? ` class="is-notable"` : ""}>` +
        `<th scope="row" class="sct-cp-td is-metric">${rowLabel(row, `sct-cp-def-${i}`)}${sub}</th>` +
        `<td class="sct-cp-td is-prior">${e(row.prior)}</td>` +
        `<td class="sct-cp-td is-now">${e(v.current)}</td>` +
        `<td class="sct-cp-td is-change"><span class="sct-cp-chg">${dumbbell(row, v, priorYear, season)}` +
        `<span class="sct-cp-change is-${v.change.dir}">${e(changeText(row, v))}</span>${rank}</span></td>` +
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
    `<th scope="col">Change<span class="sct-cp-th-sub">vs ${e(priorYear)} · tick = NFL avg</span></th>` +
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
  const statHtml = stat
    ? `<p class="sct-cp-stat"><span class="sct-cp-stat-v">${e(stat.v.current)}</span><span class="sct-cp-stat-l">${e(stat.row.label.replace(/ \(all downs\)$/, ""))}</span>` +
      (edge && atEdge(edge.v.rank)
        ? `<span class="sct-cp-stat-sep" aria-hidden="true">|</span><span class="sct-cp-stat-v">${e(ordinal(edge.v.rank as number))}</span><span class="sct-cp-stat-l">in NFL</span>`
        : top
          ? `<span class="sct-cp-stat-sep" aria-hidden="true">|</span><span class="sct-cp-stat-v">${e(changeText(top.row, top.v))}</span><span class="sct-cp-stat-l">vs ${e(priorYear)}</span>`
          : "") +
      `</p>`
    : "";
  return (
    `<aside class="sct-cp-take">` +
    `<p class="sct-cp-take-kicker">${ICON["trend"]} Key Takeaway</p>` +
    `<p class="sct-cp-take-h">${e(headline)}</p>` +
    `<p class="sct-cp-take-b">${e(body)}</p>` +
    statHtml +
    `</aside>`
  );
}

/** Shotgun against under center: exhaustive by the row's definition (a snap is logged shotgun or not), so a two-segment donut is honest. */
function formationVisual(group: Array<{ row: TendencyRow; v: RowView; i: number }>): string {
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
    `<p class="sct-cp-take-kicker">${ICON["grid"]} Formation Profile</p>` +
    `<div class="sct-cp-donut-wrap">` +
    `<svg class="sct-cp-donut" viewBox="0 0 90 90" width="104" height="104" role="img" aria-label="${e(`Shotgun ${share}% of snaps, under center ${under}%`)}">` +
    `<circle cx="45" cy="45" r="${r}" class="sct-cp-donut-under"/>` +
    `<circle cx="45" cy="45" r="${r}" class="sct-cp-donut-sg" stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" transform="rotate(-90 45 45)"/>` +
    `<text x="45" y="43" text-anchor="middle" class="sct-cp-donut-v">${e(`${share}%`)}</text>` +
    `<text x="45" y="56" text-anchor="middle" class="sct-cp-donut-l">shotgun</text>` +
    `</svg>` +
    `<ul class="sct-cp-donut-key">` +
    `<li><i class="sct-cp-sw is-sg"></i>Shotgun <b>${e(`${share}%`)}</b></li>` +
    `<li><i class="sct-cp-sw is-under"></i>Under center <b>${e(`${under}%`)}</b></li>` +
    (avg != null ? `<li class="is-avg">NFL avg shotgun ${e(`${avg}%`)}</li>` : "") +
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
    `<section class="sct-cp-section"><h3 class="sct-cp-h3"><span class="sct-cp-h3-icon">${icon}</span>${e(title)}</h3>${body}</section>`;
  return (
    `<div class="sct-block sct-cp" id="coaching-premium" data-sct-premium="coaching">` +
    `<p class="sct-cp-flag">New design · Comparison</p>` +
    `<div class="sct-cp-head"><h2 class="sct-cp-h2">Offensive Coaching &amp; Scheme</h2>` +
    `<p class="sct-cp-dek">${e(`${cityOf(team)}: play-calling tendencies, formations and tempo, ${season} against ${priorYear} and the NFL average.`)}</p></div>` +
    `<div class="sct-cp-overview">${profileCard(c, team)}${kpiCards(c, view)}</div>` +
    (calling.length
      ? section("Play Calling", ICON["play"]!, `<div class="sct-cp-split">${table(calling, c, team, priorYear, season, "Play Calling")}${takeaway(calling, team, priorYear, returning)}</div>`)
      : "") +
    (form.length
      ? section("Formations & Tempo", ICON["grid"]!, `<div class="sct-cp-split">${table(form, c, team, priorYear, season, "Formations & Tempo")}${formationVisual(form)}</div>`) +
        banner(form, team, priorYear, returning)
      : "") +
    `<p class="sct-cp-foot">Select a metric for how it is counted. Hollow dot ${e(priorYear)}, filled dot ${season}, tick the NFL average. The gold row is the group's biggest change of 3+ pp or a second of pace.</p>` +
    `</div>`
  );
}
