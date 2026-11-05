/**
 * The premium comparison version of Situational Usage (mak's brief,
 * 2026-11-05, built to attached_assets/situational reference.png): the navy
 * header, a three-back matrix with large shares over player-colored bars and
 * gold situation icons, and the three takeaways as analytical cards, the
 * lead back's workload featured in gold.
 *
 * Rendered DIRECTLY UNDER the current Situational Usage card, which is
 * untouched, so the two can be compared on one page. Every number is the
 * current card's own: the same backs (the first three with weighted
 * opportunities), situationShare() for each cell, rbSituationTotals for the
 * samples, backfieldTakeaways() for the cards; nothing is computed twice.
 * Styles are `.sct-us-sit-*` in team.css, on the `.sct-us-prm` tokens.
 */

import { escapeHtml as e } from "../render";
import type { UsagePlayer, UsageView } from "./usage";
import { surname } from "./usage";
import { backfieldTakeaways, situationShare, type Takeaway } from "./usage-copy";
import type { NflTeam } from "./teams";

type SituationKey = keyof UsagePlayer["situation"];

const SITUATIONS: Array<[SituationKey, string]> = [
  ["early", "Early downs"],
  ["third", "Third down"],
  ["rz", "Red zone"],
  ["in10", "Inside the 10"],
  ["twoMin", "Two-minute drill"],
  ["trailing", "Trailing by 7+"],
];

const stroke = (d: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

/** The situation glyphs: a drawing or, for the downs that are a number, the number itself. */
const SIT_ICON: Record<SituationKey, string> = {
  early: stroke(`<path d="M6 7l6 6 6-6"/><path d="M6 13l6 6 6-6"/>`),
  third: `<b>3</b>`,
  rz: stroke(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>`, 22) ,
  in10: stroke(`<path d="M12 21V9"/><path d="M6 4v5h12V4"/><path d="M6 9h12"/>`),
  twoMin: stroke(`<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/><path d="M9.5 3h5"/><path d="M12 3v2.5"/>`),
  trailing: `<b>7+</b>`,
};

const ICON_BARS = `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><rect x="3" y="12" width="4.5" height="9" rx="1.2" fill="currentColor"/><rect x="9.75" y="7" width="4.5" height="14" rx="1.2" fill="currentColor"/><rect x="16.5" y="3" width="4.5" height="18" rx="1.2" fill="currentColor"/></svg>`;
const ICON_TARGET = stroke(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`, 22);
const ICON_ZAP = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>`;
/** The faint football on the header's right (decorative). */
const BALL = `<svg class="sct-us-sit-ball" viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 62C26 24 70 6 108 18 94 56 50 74 12 62z"/><path d="M38 52l44-26"/><path d="M48 44l3 5M54 40l3 5M60 36l3 5M66 33l3 5M72 29l3 5"/></g></svg>`;

/** Prose with its **bold** marks set, and the counts and shares set in bold where the text left them plain. */
function prose(body: string): string {
  const html = e(body).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  if (/<strong>/.test(html)) return html;
  return html.replace(/\b(\d+(?:\.\d+)?%|\d+ (?:carries|targets)|[+−-]?\d+\.\d+ (?:from last season|per game))/g, "<strong>$1</strong>");
}

/** The card a takeaway becomes: its title from the lead, its glyph, and whether it is the featured one. */
function cardOf(t: Takeaway, i: number, view: UsageView): { title: string; icon: string; featured: boolean } {
  const [rb1] = view.rbs;
  const lead = t.lead.replace(/:$/, "");
  if (i === 0 && rb1) return { title: `${surname(rb1.name)}'s Workload`, icon: ICON_BARS, featured: true };
  if (/^If .+ misses time$/i.test(lead)) return { title: lead.replace(/misses time$/i, "Misses Time"), icon: ICON_ZAP, featured: false };
  if (/^Passing downs$/i.test(lead)) {
    // "Third-Down Specialist" only when the lead back owns third down outright on a real sample.
    const totals = view.team.rbSituationTotals;
    const share = rb1 ? situationShare(view, rb1, "third") : null;
    const leads = rb1 && view.rbs.every((p) => p === rb1 || p.situation.third < rb1.situation.third);
    const specialist = totals.third >= 8 && leads && share != null && share >= 60;
    return { title: specialist ? "Third-Down Specialist" : "Passing Downs", icon: ICON_TARGET, featured: false };
  }
  return { title: lead, icon: ICON_TARGET, featured: false };
}

export function premiumSituational(view: UsageView, team: NflTeam): string {
  const rbs = view.rbs.filter((p) => p.wopp > 0);
  if (rbs.length === 0) return "";
  const shown = rbs.slice(0, 3);
  const totals = view.team.rbSituationTotals;

  const headRow =
    `<div class="sct-us-sit-row is-head" role="row"><span class="sct-us-sit-th" role="columnheader">Situation</span>` +
    shown
      .map((p, i) => `<span class="sct-us-sit-th is-player" role="columnheader"><i class="sct-us-sit-sw is-p${i + 1}" aria-hidden="true"></i>${e(surname(p.name))}</span>`)
      .join("") +
    `</div>`;

  // A standout: one back with 70%+ of a sample of eight or more, and only the two strongest such rows
  // wear the gold edge, so a back who owns every situation does not turn the whole matrix gold.
  const leaders = SITUATIONS.map(([key]) => {
    const values = shown.map((p) => situationShare(view, p, key));
    const max = Math.max(...values.map((v) => v ?? -1));
    const sole = values.filter((v) => v === max).length === 1;
    return { key, max, ok: totals[key] >= 8 && max >= 70 && sole };
  });
  const standouts = new Set(
    leaders
      .filter((l) => l.ok)
      .sort((a, b) => b.max - a.max)
      .slice(0, 2)
      .map((l) => l.key),
  );
  const rows = SITUATIONS.map(([key, label]) => {
    const values = shown.map((p) => situationShare(view, p, key));
    const max = Math.max(...values.map((v) => v ?? -1));
    const n = totals[key];
    const standout = standouts.has(key);
    return (
      `<div class="sct-us-sit-row${standout ? " is-standout" : ""}" role="row">` +
      `<span class="sct-us-sit-sit" role="rowheader">` +
      `<span class="sct-us-sit-icon" aria-hidden="true">${SIT_ICON[key]}</span>` +
      `<span class="sct-us-sit-text"><span class="sct-us-sit-label">${e(label)}</span>` +
      `<span class="sct-us-sit-n">${e(`${n} ${n === 1 ? "opportunity" : "opportunities"}`)}</span></span></span>` +
      values
        .map((v, i) => {
          const p = shown[i]!;
          if (v == null) return `<span class="sct-us-sit-cell is-empty" role="cell"><span class="sct-us-sit-pct">–</span></span>`;
          const owner = v === max && v > 0;
          return (
            `<span class="sct-us-sit-cell${owner ? " is-owner" : ""}" role="cell" title="${e(`${p.name}: ${p.situation[key]} of ${n}`)}">` +
            `<span class="sct-us-sit-pct">${v}%</span>` +
            `<span class="sct-us-sit-track" role="img" aria-label="${e(`${p.name}, ${label.toLowerCase()} opportunity share, ${v} percent`)}"><span class="sct-us-sit-fill is-p${i + 1}" style="width:${Math.max(0, Math.min(100, v))}%"></span></span>` +
            `</span>`
          );
        })
        .join("") +
      `</div>`
    );
  }).join("");

  const matrix =
    `<div class="sct-us-sit-matrix" role="table" aria-label="Share of the running backs' carries plus targets, by situation" style="--sit-cols:${shown.length}">` +
    headRow +
    rows +
    `</div>`;

  const takeaways = backfieldTakeaways(view, team.nickname);
  const cards = takeaways
    .map((t, i) => {
      const c = cardOf(t, i, view);
      return (
        `<article class="sct-us-sit-card${c.featured ? " is-featured" : ""}">` +
        `<div class="sct-us-sit-card-head"><span class="sct-us-sit-card-icon" aria-hidden="true">${c.icon}</span>` +
        `<h4 class="sct-us-sit-card-title">${e(c.title)}</h4></div>` +
        `<p class="sct-us-sit-card-body">${prose(t.body)}</p>` +
        `</article>`
      );
    })
    .join("");

  return (
    `<section class="sct-us-prm sct-us-sit" data-sct-premium="situational" aria-labelledby="usage-prm-situational">` +
    `<p class="sct-cp-flag">New design · Comparison</p>` +
    `<header class="sct-us-prm-head is-sit">` +
    `<span class="sct-us-prm-icon" aria-hidden="true">${ICON_BARS}</span>` +
    `<span class="sct-us-sit-rule" aria-hidden="true"></span>` +
    `<div class="sct-us-sit-titles">` +
    `<h3 class="sct-us-prm-title" id="usage-prm-situational">Situational Usage</h3>` +
    `<p class="sct-us-sit-sub">${e("Each running back's share of the backfield's carries + targets in the situation, with the number of opportunities it is measured on.")}</p>` +
    `</div>` +
    BALL +
    `<span class="sct-us-prm-stripes" aria-hidden="true"></span>` +
    `</header>` +
    `<div class="sct-us-sit-body${cards ? "" : " is-solo"}">` +
    matrix +
    (cards ? `<div class="sct-us-sit-cards">${cards}</div>` : "") +
    `</div>` +
    `<p class="sct-us-sit-fine">${e("Opportunities, not snaps: who was on the field comes from participation data, which is published after the season.")}</p>` +
    `</section>`
  );
}
