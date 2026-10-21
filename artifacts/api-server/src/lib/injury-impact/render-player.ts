/**
 * One player's injury panel: the risk profile with its body map, the weekly
 * report table, the play-by-play log and the affected regions (the career
 * timeline is unmounted, see renderTimeline). Drawn inline on the database
 * page and in a dialog on the dashboard, from the same slice.
 * Ported from the app's InjuryRiskProfile.tsx, SeasonTimeline.tsx and
 * PlayerInjuryDialog.tsx.
 */

import { escapeHtml } from "../render";
import {
  NEUTRAL_COLOR,
  REGIONS,
  countStatus,
  formatInjury,
  formatUpdated,
  gameContext,
  injuryLabel,
  quarterLabel,
  regionChips,
  riskModel,
  severityColor,
  statusTone,
  timelineModel,
  type RegionStat,
} from "./player";
import { avatar, h3, n0 } from "./render-shared";
import type { InjuryAssets, PlayerSlice, SeasonInjury } from "./types";

export interface PlayerPanelState {
  showWeekly: boolean;
  showPlays: boolean;
}

export const DEFAULT_PANEL_STATE: PlayerPanelState = { showWeekly: false, showPlays: false };

function statusChip(status: string | null): string {
  if (!status) return `<span class="scin-muted is-small">-</span>`;
  return `<span class="scin-status is-${statusTone(status)}">${escapeHtml(status)}</span>`;
}

/** The region's tooltip: notable injuries first, then the most frequent report phrases. */
function regionTip(label: string, stat: RegionStat | undefined): string {
  let html = `<div class="scin-tip-title">${escapeHtml(label)}${stat ? ` <span class="scin-tip-side${stat.gamesMissed > 0 || stat.severe ? " scin-red" : ""}">${stat.gamesMissed} missed · ${stat.count} report${stat.count === 1 ? "" : "s"}</span>` : ""}</div>`;
  if (!stat) return `${html}<div class="scin-tip-line scin-muted">No injuries recorded here.</div>`;
  if (stat.notable.length) {
    html += `<ul class="scin-tip-list is-rule">${stat.notable
      .slice(0, 4)
      .map((n) => `<li><strong>${escapeHtml(n.injury.toLowerCase())}</strong> <span class="scin-muted">${n.season}</span> <span class="${n.seasonEnding ? "scin-red" : "scin-muted"}">${n.seasonEnding ? "season-ending" : `${n.gamesMissed} game${n.gamesMissed === 1 ? "" : "s"} missed`}</span></li>`)
      .join("")}</ul>`;
  }
  html += `<ul class="scin-tip-list">${Array.from(stat.labels.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([label2, info]) => `<li><span>${escapeHtml(label2.toLowerCase())}</span><span class="scin-muted">${info.season != null ? info.season : ""}${info.week != null ? ` · Wk ${info.week}` : ""}</span></li>`)
    .join("")}</ul>`;
  return html;
}

export function renderRiskProfile(slice: PlayerSlice): string {
  const m = riskModel(slice.rows, slice.impacts);
  const chips = regionChips(m);
  const when = (i: { season: number | null; week: number | null } | null) => (i && i.season != null ? `${i.season}${i.week != null ? ` · Wk ${i.week}` : ""}` : "-");
  const notable: SeasonInjury[] = [...slice.impacts].sort((a, b) => b.season - a.season || Number(b.season_ending) - Number(a.season_ending) || b.games_missed - a.games_missed);

  const stats: { label: string; value: string; sub?: string; cls?: string }[] = [];
  if (m.gamesMissed != null) stats.push({ label: "Games Missed", value: String(m.gamesMissed), sub: "known injury seasons", cls: m.gamesMissed > 0 ? "scin-red" : "" });
  else stats.push({ label: "Weeks Out", value: String(m.weeksOut), sub: "listed Out on report", cls: m.weeksOut > 0 ? "scin-red" : "" });
  if (m.seasonEnding != null) stats.push({ label: "Season-Ending", value: String(m.seasonEnding), sub: "injuries", cls: m.seasonEnding > 0 ? "scin-orange" : "" });
  stats.push({ label: "Regions Affected", value: String(m.regionsAffected), sub: "body areas" });
  stats.push({ label: "Seasons Affected", value: String(m.seasonsAffected), sub: "with reports" });

  const body = REGIONS.map((region) => {
    const stat = m.perRegion.get(region.key);
    const c = !stat ? NEUTRAL_COLOR : severityColor(stat.gamesMissed, stat.severe);
    const stroke = stat?.severe ? "#b91c1c" : c.stroke;
    const sw = stat?.severe ? 2 : 1;
    const shapes = region.shapes
      .map((sh) => (sh.t === "ellipse" ? `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" fill="${c.fill}" stroke="${stroke}" stroke-width="${sw}" />` : `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.rx}" fill="${c.fill}" stroke="${stroke}" stroke-width="${sw}" />`))
      .join("");
    return `<g class="scin-hit scin-region" data-region="${region.key}" data-tip="${escapeHtml(regionTip(region.label, stat))}">${shapes}</g>`;
  }).join("");
  const legend = [0, 1, 4, 8].map((gm) => `<span class="scin-legend-sw" style="background:${severityColor(gm, false).fill};border-color:${severityColor(gm, false).stroke}"></span>`).join("");

  return (
    `<section class="scin-pp"><div>${h3("Injury Risk Profile")}<p class="scin-body is-muted">Durability snapshot and the body regions this player has been hurt in.</p></div>` +
    `<div class="scin-pp-grid"><div class="scin-pp-left">` +
    `<div class="scin-pp-stats">${stats.map((s) => `<div class="scin-pp-stat"><div class="scin-pp-num ${s.cls ?? ""}">${escapeHtml(s.value)}</div><div class="scin-pp-k">${escapeHtml(s.label)}</div>${s.sub ? `<div class="scin-pp-sub">${escapeHtml(s.sub)}</div>` : ""}</div>`).join("")}</div>` +
    `<div class="scin-pp-stat is-wide"><div class="scin-pp-k">Last Injury</div>${
      m.lastInjury
        ? `<div class="scin-pp-last"><span class="scin-strong">${escapeHtml(m.lastInjury.label)}</span><span class="scin-muted is-small">${escapeHtml(when(m.lastInjury))}</span>${m.lastInjury.seasonEnding ? `<span class="scin-badge is-red">Season-ending</span>` : ""}</div>`
        : `<div class="scin-body is-muted">No localized injury on record.</div>`
    }</div>` +
    (notable.length
      ? `<div><div class="scin-pp-k">Notable Injuries</div><ul class="scin-pp-notable">${notable
          .map(
            (im) =>
              `<li><span><span class="scin-muted is-small scin-pp-year">${im.season}</span><span class="scin-strong is-cap">${escapeHtml(im.injury.replace(/_/g, " ").toLowerCase())}</span></span>${im.season_ending ? `<span class="scin-badge is-red">Season-ending</span>` : `<span class="scin-muted is-small">${im.games_missed} game${im.games_missed === 1 ? "" : "s"} missed${im.ongoing ? " so far" : ""}</span>`}</li>`,
          )
          .join("")}</ul></div>`
      : "") +
    `</div>` +
    `<div class="scin-pp-map"><svg viewBox="0 0 200 430" width="200" height="430" role="img" aria-label="Body map of affected regions">${body}</svg>` +
    `<div class="scin-pp-legend"><span>No games missed</span>${legend}<span class="scin-legend-sw" style="background:${severityColor(0, true).fill};border-color:${severityColor(0, true).stroke}"></span><span>Season-ending</span></div></div>` +
    `</div></section>`
  );
}

/**
 * The body regions the weekly reports name, as chips with the games missed.
 * Its own section (mak, 2026-10-21): it sits under the durability profile's
 * availability grid when the player has one (the bundle moves it there once
 * the profile loads), else at the foot of the reports.
 */
export function renderAffectedRegions(slice: PlayerSlice): string {
  const m = riskModel(slice.rows, slice.impacts);
  const chips = regionChips(m);
  return (
    `<section class="scin-pp" data-pp-regions>${h3("Affected Regions")}${
      chips.length
        ? `<div class="scin-chips">${chips
            .map(({ region, stat }) => {
              const c = severityColor(stat.gamesMissed, stat.severe);
              return `<span class="scin-chip scin-hit${stat.severe ? " is-severe" : ""}" style="border-color:${c.stroke};background:${c.fill}55" data-tip="${escapeHtml(regionTip(region.label, stat))}"><span class="scin-dot" style="background:${c.fill};border-color:${c.stroke}"></span>${escapeHtml(region.label)}${stat.severe ? `<span class="scin-badge is-red is-tiny">SE</span>` : stat.gamesMissed > 0 ? `<span class="scin-muted">${stat.gamesMissed} missed</span>` : ""}</span>`;
            })
            .join("")}</div>`
        : `<p class="scin-body is-muted">No localized injuries recorded from the weekly reports.</p>`
    }${m.unlocalized > 0 ? `<p class="scin-fine">${m.unlocalized} report mention${m.unlocalized === 1 ? "" : "s"} not tied to a specific body region (e.g. illness / rest).</p>` : ""}</section>`
  );
}

/**
 * The week-by-week career grid. UNMOUNTED since 2026-10-21 at mak's request
 * ("remove Career Timeline"): the durability profile's availability grid
 * shows the same seasons one box per game. Kept, like the model behind it,
 * in case it is wanted back.
 */
export function renderTimeline(slice: PlayerSlice): string {
  const seasons = timelineModel(slice.rows, slice.impacts, slice.schedule, slice.audited ?? null);
  if (!seasons.length) return "";
  return (
    `<section class="scin-pp"><div>${h3("Career Timeline")}<p class="scin-body is-muted">Every week the player's team played, by season. A <span class="scin-red is-strong">red dot</span> marks the week an injury occurred; <span class="scin-red is-strong">red</span> weeks are games missed. Dashed = bye.</p></div>` +
    `<div class="scin-tl">` +
    seasons
      .map(
        (s) =>
          `<div class="scin-tl-row"><div class="scin-tl-season"><div class="scin-strong">${s.season}</div><div class="scin-muted is-small">${escapeHtml(s.team)}${s.gamesMissed > 0 ? `<span class="scin-red"> · ${s.gamesMissed} missed</span>` : ""}</div></div><div class="scin-tl-cells">` +
          s.cells
            .map((c) => {
              const cls = c.bye ? "is-bye" : c.missed ? "is-missed" : c.playoff ? "is-playoff" : "";
              const title = `${s.season} · ${c.playoff ? c.label : `Week ${c.week}`}`;
              const game = c.game ? ` <span class="scin-muted">${c.game.h ? "vs" : "@"} ${escapeHtml(c.game.o)}</span>` : "";
              let line: string;
              if (c.bye) line = `<div class="scin-tip-line scin-muted">Bye week: no game.</div>`;
              else {
                line = c.onsetInjury ? `<div class="scin-tip-line scin-red">Injured: ${escapeHtml(c.onsetInjury)}</div>` : "";
                line += c.missed ? `<div class="scin-tip-line">Missed${c.injury ? `: ${escapeHtml(c.injury)}` : ""}</div>` : c.status ? `<div class="scin-tip-line scin-muted">Played · listed ${escapeHtml(c.status)}${c.injury ? ` (${escapeHtml(c.injury)})` : ""}</div>` : `<div class="scin-tip-line scin-muted">Played</div>`;
              }
              return `<span class="scin-tl-cell scin-hit ${cls}" data-tip="${escapeHtml(`<div class="scin-tip-title">${escapeHtml(title)}${game}</div>${line}`)}">${escapeHtml(c.label)}${c.onset ? `<span class="scin-tl-onset"></span>` : ""}</span>`;
            })
            .join("") +
          `</div></div>`,
      )
      .join("") +
    `</div>` +
    `<div class="scin-tl-legend"><span><span class="scin-tl-cell is-missed is-key"></span> Games missed</span><span><span class="scin-tl-cell is-key"><span class="scin-tl-onset"></span></span> Injury occurred</span><span><span class="scin-tl-cell is-bye is-key"></span> Bye</span><span><span class="scin-tl-cell is-playoff is-key"></span> Playoffs</span></div>` +
    `</section>`
  );
}

export function renderWeeklyReports(slice: PlayerSlice, open: boolean): string {
  const rows = slice.rows;
  const seasons = new Set(rows.map((r) => r.season).filter((s) => s != null));
  const durability = [
    { label: "Weeks Out", value: countStatus(rows, "out"), cls: "scin-red" },
    { label: "Doubtful", value: countStatus(rows, "doubtful"), cls: "scin-orange" },
    { label: "Questionable", value: countStatus(rows, "questionable"), cls: "scin-amber" },
  ];
  return (
    `<section class="scin-pp"><button type="button" class="scin-pp-toggle" data-pp-toggle="weekly" aria-expanded="${open}"><svg class="scin-chev${open ? " is-open" : ""}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${h3("Weekly Injury Reports")}<p class="scin-body is-muted">Practice &amp; game-status designations by week.</p></span></button>` +
    `<div data-pp-body="weekly"${open ? "" : " hidden"}>` +
    `<div class="scin-pp-dur">${durability.map((d) => `<div><span class="scin-pp-num ${d.cls}">${d.value}</span><span class="scin-pp-sub">${d.label}</span></div>`).join("")}<div><span class="scin-pp-num">${rows.length}</span><span class="scin-pp-sub">Reports · ${seasons.size} season${seasons.size === 1 ? "" : "s"}</span></div></div>` +
    `<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col">Season</th><th scope="col">Wk</th><th scope="col">Injury</th><th scope="col">Game Status</th><th scope="col">Practice</th><th scope="col" class="is-right">Updated</th></tr></thead><tbody>` +
    rows
      .slice()
      .reverse()
      .map((e) => `<tr><td class="scin-strong">${e.season ?? "-"}</td><td class="scin-muted">${e.week ?? "-"}</td><td>${escapeHtml(injuryLabel(e) || "-")}</td><td>${statusChip(e.reportStatus)}</td><td class="scin-muted">${escapeHtml(e.practiceStatus ?? "-")}</td><td class="is-right scin-muted is-small">${escapeHtml(formatUpdated(e.dateModified) ?? "-")}</td></tr>`)
      .join("") +
    `</tbody></table></div></div></section>`
  );
}

export function renderPlayLog(slice: PlayerSlice, open: boolean): string {
  if (!slice.inGame.length) return "";
  return (
    `<section class="scin-pp"><button type="button" class="scin-pp-toggle" data-pp-toggle="plays" aria-expanded="${open}"><svg class="scin-chev${open ? " is-open" : ""}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${h3("Play-By-Play Log")}<p class="scin-body is-muted">When the injury occurred, from play-by-play.</p></span></button>` +
    `<div class="scin-plays" data-pp-body="plays"${open ? "" : " hidden"}>` +
    slice.inGame
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="scin-play"><div class="scin-play-head"><span><span class="scin-strong">${escapeHtml(gameContext(e))}</span> <span class="scin-muted">${escapeHtml(e.team)} vs ${escapeHtml(e.opponent)}</span></span><span>${e.qtr != null || e.clock ? `<span class="scin-strong is-small">${escapeHtml([quarterLabel(e.qtr), e.clock].filter(Boolean).join(" · "))}</span>` : ""}${e.status ? statusChip(e.status) : ""}</span></div><p class="scin-fine">${escapeHtml(e.desc)}</p></div>`,
      )
      .join("") +
    `</div></section>`
  );
}

/** The player header: avatar, name, the one-line explainer. */
export function renderPlayerHeader(slice: PlayerSlice, assets: InjuryAssets, size = 44): string {
  return `<div class="scin-pp-head">${avatar(slice.gsisId, slice.name, assets, size)}<div><h2 class="scin-pp-name">${escapeHtml(slice.name)}</h2><p class="scin-body is-muted">In-game injuries and weekly NFL injury-report designations.</p></div></div>`;
}

/** Everything under the header, for a player with a slice. */
export function renderPlayerReports(slice: PlayerSlice, state: PlayerPanelState = DEFAULT_PANEL_STATE): string {
  if (!slice.rows.length) return `<p class="scin-empty">No injury reports on file for ${escapeHtml(slice.name)}.</p>`;
  return renderRiskProfile(slice) + renderWeeklyReports(slice, state.showWeekly) + renderPlayLog(slice, state.showPlays) + renderAffectedRegions(slice);
}

export { n0 };
