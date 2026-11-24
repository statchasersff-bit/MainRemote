/**
 * The premium comparison version of Situational Usage (mak's brief,
 * 2026-11-05, built to attached_assets/situational reference.png): the navy
 * header, a three-back matrix with large shares over player-colored bars and
 * gold situation icons, and the three takeaways as analytical cards, the
 * lead back's workload featured in gold.
 *
 * Since 2026-11-05 ("remove the older version") this IS the Situational
 * Usage section: the original card (backfield() in usage-render.ts) was
 * deleted. Every number is that card's own: the same backs (the first three with weighted
 * opportunities), situationShare() for each cell, rbSituationTotals for the
 * samples, backfieldTakeaways() for the cards; nothing is computed twice.
 * Styles are `.sct-us-sit-*` in team.css, on the `.sct-us-prm` tokens.
 */

import { linkFirstMentions, usageProsePlayers } from "./prose-links";
import { escapeHtml as e } from "../render";
import type { UsagePlayer, UsageView } from "./usage";
import { surname } from "./usage";
import { backfieldTakeaways, handcuffProjection, signed, situationShare, type Takeaway } from "./usage-copy";
import { rbRankFor } from "./usage";
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

/** Phone labels where the full one wraps the narrow situation column. */
const SHORT_LABEL: Partial<Record<SituationKey, string>> = { twoMin: "2-min drill" };

/** The full words, plus a short form team.css paints on phones in their place. */
function phoneShort(full: string, short: string | undefined): string {
  if (!short || short === full) return e(full);
  return `<span class="sct-us-sit-full">${e(full)}</span><span class="sct-us-sit-short" aria-hidden="true">${e(short)}</span>`;
}

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

/** Prose as plain text: no bold anywhere in the card bodies (mak, 2026-11-06), so the **marks** are dropped. */
function prose(body: string): string {
  return e(body.replace(/\*\*(.+?)\*\*/g, "$1"));
}

/* ------------------------------------------------- phone analysis (11-15) */

/**
 * The three takeaways as a phone dashboard (mak, 2026-11-15: "make it
 * substantially more visual, compact, and premium on mobile"). Built from
 * the same numbers backfieldTakeaways() writes its paragraphs from, never
 * from the paragraphs: the workload as five figures and one reading; the
 * passing-down role as three thin bars (the matrix's player colors) over
 * the opportunity count, with one interpretation; the injury scenario as a
 * <details> whose summary is one line and whose body sets the next back's
 * observed workload beside the modeled one, then the full paragraph.
 * team.css shows this on phones in place of the paragraph cards, which
 * desktop keeps; the titles are the cards' own (cardOf).
 */
function phoneAnalysis(view: UsageView, takeaways: Takeaway[], nick: string): string {
  const [rb1, rb2] = view.rbs;
  if (!rb1 || !takeaways.length) return "";
  const totals = view.team.rbSituationTotals;
  const S1 = surname(rb1.name);
  const parts: string[] = [];

  takeaways.forEach((t, i) => {
    const title = cardOf(t, i, view).title;
    const lead = t.lead.replace(/:$/, "");

    // 1. The lead back's workload.
    if (i === 0 && rb1.woppPerGame != null) {
      const d = rb1.lastSeasonWoppPerGame == null ? null : rb1.woppPerGame - rb1.lastSeasonWoppPerGame;
      // Five figures on one row under short labels; the meta line and each
      // label's title keep every denominator ("Touches" = his share of the
      // backs' touches, "Snaps" = of the offensive snaps).
      const tiles: Array<[string, string, string]> = [
        [String(rb1.carries), "Carries", "Carries"],
        [String(rb1.targets), "Targets", "Targets"],
      ];
      if (rb1.touchShare != null) tiles.push([`${rb1.touchShare}%`, "Touches", "Share of the backs' touches"]);
      if (rb1.snapShare != null) tiles.push([`${rb1.snapShare}%`, "Snaps", "Share of the offensive snaps"]);
      if (d != null) tiles.push([signed(d), "Vs last yr", "Per-game carries + 2 × targets, against last season"]);
      const share = rb1.touchShare ?? null;
      const role = share == null ? "" : share >= 60 ? "Lead-back volume" : share >= 45 ? "The lead role" : "A committee backfield";
      const trend = d == null || !role ? "" : d >= 1.5 ? ", and growing since last season" : d <= -1.5 ? ", but shrinking since last season" : ", level with last season";
      parts.push(
        `<div class="sct-us-pa-block is-workload">` +
          `<h4 class="sct-us-pa-title">${e(title)}</h4>` +
          `<p class="sct-us-pa-meta">${e(`${rb1.games} game${rb1.games === 1 ? "" : "s"} · touch and snap shares · per-game load vs last season`)}</p>` +
          `<dl class="sct-us-pa-tiles">` +
          tiles
            .map(([v, l, full]) => `<div class="sct-us-pa-tile"><dt class="sct-us-pa-lab" title="${e(full)}">${e(l)}</dt><dd class="sct-us-pa-val">${e(v)}</dd></div>`)
            .join("") +
          `</dl>` +
          (role ? `<p class="sct-us-pa-take">${e(`${role}${trend}.`)}</p>` : "") +
          `</div>`,
      );
      return;
    }

    // 2. Who handles passing downs.
    if (/^Passing downs$/i.test(lead)) {
      const shown = view.rbs.slice(0, 3);
      const thirdSample = totals.third >= 8;
      const roomTargets = view.rbs.reduce((n, p) => n + p.targets, 0);
      const shareOf = (p: UsagePlayer): number | null =>
        thirdSample ? situationShare(view, p, "third") : roomTargets ? Math.round((100 * p.targets) / roomTargets) : null;
      const values = shown.map(shareOf);
      const top = Math.max(...values.map((v) => v ?? -1));
      const owner = (thirdSample ? [...view.rbs].sort((a, b) => b.situation.third - a.situation.third) : [...view.rbs].sort((a, b) => b.targets - a.targets))[0]!;
      const ownerShare = shareOf(owner) ?? 0;
      let read: string;
      if (owner !== rb1 && ownerShare >= 40) {
        read = `${surname(owner.name)} owns passing downs; ${S1}'s catches come on other downs.`;
      } else {
        const they = nick ? `the ${nick} trail` : "the team trails";
        const trailing = totals.trailing >= 6 ? situationShare(view, rb1, "trailing") : null;
        const roomWork = view.rbs.reduce((n, p) => n + p.carries + p.targets, 0);
        const overall = roomWork ? Math.round((100 * (rb1.carries + rb1.targets)) / roomWork) : null;
        const tLeader = [...view.rbs].sort((a, b) => b.situation.trailing - a.situation.trailing)[0]!;
        const leads = tLeader === rb1 && view.rbs.filter((p) => p.situation.trailing === rb1.situation.trailing).length === 1;
        void they;
        read =
          trailing == null
            ? `${S1} handles passing downs as well as early downs.`
            : leads && (overall == null || trailing >= overall * 0.75)
              ? `Passing downs are his too, even trailing by 7+.`
              : leads
                ? `He leads passing downs; his share dips trailing by 7+.`
                : tLeader !== rb1
                  ? `${S1} leads third down; ${surname(tLeader.name)} takes over trailing by 7+.`
                  : `${S1} splits passing downs when trailing by 7+.`;
      }
      const what = thirdSample
        ? `Third-down carries + targets, backs only · ${totals.third} opp.`
        : `Share of the backfield's ${roomTargets} targets`;
      parts.push(
        `<div class="sct-us-pa-block is-role">` +
          `<h4 class="sct-us-pa-title">${e(title)}</h4>` +
          `<p class="sct-us-pa-meta">${e(what)}</p>` +
          `<ul class="sct-us-pa-bars">` +
          shown
            .map((p, k) => {
              const v = values[k];
              const lead = v != null && v === top && v > 0;
              return (
                `<li class="sct-us-pa-bar${lead ? " is-lead" : ""}"><span class="sct-us-pa-name">${e(surname(p.name))}</span>` +
                `<span class="sct-us-pa-track" aria-hidden="true"><span class="sct-us-sit-fill is-p${k + 1}" style="width:${Math.max(0, Math.min(100, v ?? 0))}%"></span></span>` +
                `<span class="sct-us-pa-pct">${v == null ? "–" : `${v}%`}</span></li>`
              );
            })
            .join("") +
          `</ul>` +
          `<p class="sct-us-pa-take">${e(read)}</p>` +
          `</div>`,
      );
      return;
    }

    // 3. The injury scenario: one line by default, the model on demand.
    const cuff = handcuffProjection(view);
    if (/misses time$/i.test(lead) && rb2 && cuff) {
      const rank = rbRankFor(view.doc.rbWoppPool, cuff.projected);
      const level = rank <= 12 ? "a lead back's workload" : rank <= 24 ? "a starter's workload" : "a committee workload";
      const S2 = surname(rb2.name);
      const rows: Array<[string, string, string]> = [
        ["Now", `${rb2.woppPerGame != null ? rb2.woppPerGame.toFixed(1) : "–"} per game${rb2.woppShare != null ? ` · ${rb2.woppShare}%` : ""}`, "observed"],
        [`If ${S1} is out`, `${cuff.projected.toFixed(1)} per game${cuff.projShare != null ? ` · ~${cuff.projShare}%` : ""}`, "modeled"],
      ];
      parts.push(
        `<details class="sct-us-pa-block is-scenario">` +
          `<summary class="sct-us-pa-sum"><span class="sct-us-pa-sum-text"><span class="sct-us-pa-title">${e(title)}</span>` +
          `<span class="sct-us-pa-sum-line">${e(`${S2} next · ~${cuff.projected.toFixed(1)} load per game (modeled)`)}</span></span>` +
          `<span class="sct-us-pa-caret" aria-hidden="true"></span></summary>` +
          `<dl class="sct-us-pa-proj">` +
          rows.map(([k, v, tag]) => `<div class="sct-us-pa-proj-row"><dt>${e(k === "Now" ? `${S2} now` : `${S2}, if ${S1} is out`)}</dt><dd>${e(v)}<span class="sct-us-pa-tag is-${tag}">${e(tag)}</span></dd></div>`).join("") +
          `</dl>` +
          `<p class="sct-us-pa-full">${e(`That would be ${level} by this season's NFL rates.`)} ${prose(t.body)}</p>` +
          `<p class="sct-us-pa-note">${e(`A model, not a forecast: ${S1}'s work shared out in proportion to who takes the early-down and red-zone carries + targets behind him. Workload = carries + 2 × targets.`)}</p>` +
          `</details>`,
      );
      return;
    }

    // Anything else (no next back): the paragraph, plain.
    parts.push(`<div class="sct-us-pa-block"><h4 class="sct-us-pa-title">${e(title)}</h4><p class="sct-us-pa-take">${prose(t.body)}</p></div>`);
  });

  return `<div class="sct-us-pa">${parts.join("")}</div>`;
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
      .map((p, i) => `<span class="sct-us-sit-th is-player" role="columnheader" title="${e(p.name)}" aria-label="${e(p.name)}"><i class="sct-us-sit-sw is-p${i + 1}" aria-hidden="true"></i>${e(surname(p.name))}</span>`)
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
      // Phones paint the short forms (mak, 2026-11-15): "2-min drill" and
      // "221 opp." on one compact line; the full words stay for screen readers.
      `<span class="sct-us-sit-text"><span class="sct-us-sit-label">${phoneShort(label, SHORT_LABEL[key])}</span>` +
      `<span class="sct-us-sit-n">${e(`${n} `)}${phoneShort(n === 1 ? "opportunity" : "opportunities", "opp.")}</span></span></span>` +
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
  // Each card links its first mention of a player (WEB-044).
  const people = usageProsePlayers(view);
  const cards = takeaways
    .map((t, i) => {
      const c = cardOf(t, i, view);
      return (
        `<article class="sct-us-sit-card${c.featured ? " is-featured" : ""}">` +
        `<div class="sct-us-sit-card-head"><span class="sct-us-sit-card-icon" aria-hidden="true">${c.icon}</span>` +
        `<h4 class="sct-us-sit-card-title">${e(c.title)}</h4></div>` +
        `<p class="sct-us-sit-card-body">${linkFirstMentions(prose(t.body), people)}</p>` +
        `</article>`
      );
    })
    .join("");

  return (
    // id="situational": the section's anchor, carried over from the retired card.
    `<section class="sct-us-prm sct-us-sit" id="situational" data-sct-premium="situational" aria-labelledby="usage-prm-situational">` +
    // The Rushing Direction title bar (mak, 2026-11-07: "match that of the
    // Rushing Direction header"): icon, title beside its explainer, stripes.
    `<header class="sct-us-prm-head">` +
    `<span class="sct-us-prm-icon" aria-hidden="true">${ICON_BARS}</span>` +
    `<div class="sct-us-prm-titles">` +
    `<h3 class="sct-us-prm-title" id="usage-prm-situational">Situational Usage</h3>` +
    `<p class="sct-us-prm-sub">${e("Each running back's share of the backfield's carries + targets in the situation, with the number of opportunities it is measured on.")}</p>` +
    `</div>` +
    `<span class="sct-us-prm-stripes" aria-hidden="true"></span>` +
    `</header>` +
    `<div class="sct-us-sit-body${cards ? "" : " is-solo"}">` +
    matrix +
    (cards ? `<div class="sct-us-sit-cards">${cards}</div>` + phoneAnalysis(view, takeaways, team.nickname) : "") +
    `</div>` +
    `<p class="sct-us-sit-fine">${e("Opportunities, not snaps: who was on the field comes from participation data, which is published after the season.")}</p>` +
    `</section>`
  );
}
