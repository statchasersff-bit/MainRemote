/**
 * "What does an injury-report tag cost that week?": every listed player-week
 * from the weekly injury-report database, measured against the same player's
 * healthy weeks that season. Ported from the app's InjuryTagImpact.tsx.
 */

import { escapeHtml } from "../render";
import { renderHBars } from "./charts";
import { pctOf, signedOf, tagBars, tagCell, tagStatus } from "./model";
import { note, smallSample } from "./render-shared";
import type { TagGroup, TagImpactData } from "./types";

function tagTable(rows: TagGroup[], first: string): string {
  return (
    `<div class="scin-scroll"><table class="scin-table is-framed is-nowrap"><thead class="is-navy"><tr>` +
    `<th scope="col" class="is-sticky">${escapeHtml(first)}</th><th scope="col" class="is-right" title="Listed regular-season player-weeks">Listed</th><th scope="col" class="is-right" title="Share of regular contributors who took a snap that week">Played</th><th scope="col" class="is-right" title="PPR when he played, vs his own healthy weeks that season (90% interval)">Pts when active</th><th scope="col" class="is-right" title="Played × points when active: what to expect when you see the tag">Expected</th><th scope="col" class="is-right" title="Median change in offensive snap share vs healthy weeks (percentage points)">Snap Δ</th><th scope="col" class="is-right" title="Played weeks under half his healthy PPG">Dud %</th>` +
    `</tr></thead><tbody>` +
    rows
      .map(
        (g) =>
          `<tr><td class="is-sticky scin-strong">${escapeHtml(g.label)}${g.small_sample ? smallSample("Fewer than 40 rated player-weeks. Interpret with caution") : ""}</td><td class="is-right scin-muted">${g.listed.toLocaleString("en-US")}</td><td class="is-right">${pctOf(g.played_pct)}</td>` +
          `<td class="is-right">${pctOf(g.fp_ratio)}${g.fp_ratio_lo != null ? ` <span class="scin-muted is-small">(${pctOf(g.fp_ratio_lo)}-${pctOf(g.fp_ratio_hi)})</span>` : ""}</td><td class="is-right scin-strong">${pctOf(g.expected_ratio)}</td><td class="is-right">${signedOf(g.snap_delta)}</td><td class="is-right">${pctOf(g.dud_pct)}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`
  );
}

export function renderTagImpact(data: TagImpactData | null, width: number): string {
  if (!data) return `<p class="scin-empty">The injury-report tag study is not available.</p>`;
  const q = tagStatus(data, "Questionable");
  const qDnp = tagCell(data, "Questionable|DNP");
  const qFull = tagCell(data, "Questionable|Full");
  const out = tagStatus(data, "Out");
  const doubtful = tagStatus(data, "Doubtful");
  const seasons = data.meta.seasons;
  const span = `${seasons[0]}-${seasons[seasons.length - 1]}`;
  const bars = tagBars(data);
  const answer = q
    ? `<div class="scin-verdict"><p class="scin-verdict-eyebrow">Answer</p><p class="scin-verdict-answer">A Questionable tag is worth about ${pctOf(q.expected_ratio)} of a player's normal week: he plays ${pctOf(q.played_pct)} of the time and scores ${pctOf(q.fp_ratio)} of his usual PPR when he does.</p>` +
      `<p class="scin-verdict-detail">Friday's practice report matters almost as much as the tag: Questionable after a DNP Friday plays ${pctOf(qDnp?.played_pct)} of the time (${pctOf(qDnp?.expected_ratio)} expected), against ${pctOf(qFull?.played_pct)} (${pctOf(qFull?.expected_ratio)}) after a full practice. Doubtful players suited up ${pctOf(doubtful?.played_pct)} of the time; Out, ${pctOf(out?.played_pct)}.</p></div>`
    : "";
  return (
    `<div class="scin-tag">` +
    answer +
    `<div class="scin-block"><p class="scin-body is-strong">Expected share of normal PPR, by game tag and final practice</p>${note("Regular contributors only · 100% = the player's own healthy-week average that season")}` +
    renderHBars({
      id: "tagBars",
      rows: bars.map((b) => ({
        name: b.name,
        value: b.value,
        text: b.text,
        tip: `<div class="scin-tip-title">${escapeHtml(b.g.label)}</div><div class="scin-tip-line">Played <strong>${pctOf(b.g.played_pct)}</strong> of the time</div><div class="scin-tip-line">Scored <strong>${pctOf(b.g.fp_ratio)}</strong> of normal when active</div><div class="scin-tip-line">Expected <strong>${pctOf(b.g.expected_ratio)}</strong> of normal PPR</div><div class="scin-tip-line scin-muted">${b.g.n.toLocaleString("en-US")} rated player-weeks</div>`,
      })),
      width,
      max: 100,
      ticks: [0, 25, 50, 75, 100],
      tickFormat: (v) => `${v}%`,
      refX: 100,
      color: "#0b1f3a",
      ariaLabel: "Expected share of normal PPR by game tag and final practice",
    }) +
    `</div>` +
    tagTable(data.matrix.filter((g) => g.n > 0 || g.key.startsWith("Questionable") || g.key.startsWith("None")), "Tag · final practice") +
    `<div class="scin-grid2"><div><p class="scin-body is-strong">By position: Questionable vs. listed with no designation</p>${tagTable(data.by_position, "Position · tag")}</div><div><p class="scin-body is-strong">Questionable, by body group</p>${tagTable(data.questionable_by_body, "Body group")}</div></div>` +
    note(
      `Source: ${data.meta.listed_player_weeks.toLocaleString("en-US")} regular-season injury-report player-weeks, ${span} (weekly injury-report database), each compared with the same player's games that season when he was <em>not</em> on the report (PPR points and snap share). Ratios use players with ${data.meta.min_base_games}+ healthy games and ${data.meta.min_base_ppg}+ healthy PPG; "Pts when active" is pooled, with a 90% bootstrap interval. Being listed at all costs a little: players with no designation still average ~${pctOf(tagStatus(data, "None")?.fp_ratio)} of normal, so read the Questionable rows against that row, not against 100%.`,
    ) +
    `</div>`
  );
}
