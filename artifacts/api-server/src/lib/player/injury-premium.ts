/**
 * The Injury tab (mak's brief "Exact Premium NFL Player Injury Status &
 * History Redesign", 2026-11-05, built to attached_assets/injury1.png with
 * the heading the brief corrected to "{Name} Injury Status and History";
 * the tab's own design since the same day, when mak said "remove the older
 * version"): a navy title banner with the club's crest, the status row
 * (designation card + three facts), the practice strip, Durability Profile
 * (availability grid, four tiles, region pills, the open record, the body
 * figure with its markers and the HP bar), the injury history as a timeline
 * (its Fantasy Impact + Redraft Command sidebar removed 2026-11-05 at mak's
 * request), and "If He Misses Time" with its two cards and the gold strip.
 * The FAQ follows it (injury-tab.ts).
 *
 * Every word and number is injuryPremiumModel() in injury-tab.ts and
 * durabilityParts() in injury-durability.ts, the code paths the old
 * sections printed from; the figure, pills, records and grid ARE the
 * Durability card's markup, so client/player.ts wires the region selection
 * unchanged. The banner title is the tab's lead h2 (the page H1 stays the
 * hero's "{Name} Injury Status", the 11-03 entity brief); the section bars
 * are h2s, the cards h3s. Markup is `scp-inp-` prefixed; every rule in
 * player.css starts `.scp .scp-inp`.
 */

import { escapeHtml } from "../render";
import { phoneHeading } from "./phone-heading";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { eventWords, injuryPremiumModel, type InjuryPremiumModel } from "./injury-tab";
import { durabilityParts } from "./injury-durability";
import { getTeamByAbbreviation } from "../team/teams";
import type { InjuryEvent } from "./injury-tab-data";
import { headArt, headIcon } from "./tab-head";

const e = escapeHtml;

const svg = (body: string): string =>
  `<svg class="scp-inp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  steth: svg(`<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>`),
  clipboard: svg(`<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>`),
  shield: svg(`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>`),
  medkit: svg(`<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M12 11v5M9.5 13.5h5"/>`),
  swap: svg(`<path d="M4 8h13M14 5l3 3-3 3"/><path d="M20 16H7M10 13l-3 3 3 3"/>`),
  people: svg(`<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M15 19a4.5 4.5 0 0 1 6 0"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  plus: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`),
  heart: svg(`<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>`),
  gauge: svg(`<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/>`),
  column: svg(`<path d="M5 20v-5M10 20v-9M15 20v-7M20 20V8"/>`),
};

/** The section bar: gold icon, the h3, an optional right-aligned note, the gold diagonals. */
function bar(icon: string, title: string, note = "", id = "", name = ""): string {
  return (
    `<header class="scp-inp-bar">` +
    `<span class="scp-inp-bar-icon">${icon}</span>` +
    `<h2 class="scp-inp-bar-title"${id ? ` id="${id}"` : ""}>${phoneHeading(title, name)}</h2>` +
    (note ? `<p class="scp-inp-bar-note">${e(note)}</p>` : "") +
    `<span class="scp-inp-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* ------------------------------------------------------------------ status */

function renderStatus(m: InjuryPremiumModel): string {
  const s = m.status;
  const checked = s.checked
    ? `<small class="scp-inp-checked">Checked <time datetime="${e(s.checked.iso)}">${e(s.checked.text)}</time>${s.stale ? " · latest report pending" : ""}</small>`
    : "";
  const icon: Record<string, string> = { missed: ICON.calendar, latest: ICON.steth, next: ICON.calendar };
  const kpis = m.cells
    .map(
      (c) =>
        `<div class="scp-inp-kpi is-${c.key}"><span class="scp-inp-kpi-icon">${icon[c.key]}</span>` +
        `<div><span class="scp-inp-kpi-l">${e(c.label)}</span><b class="scp-inp-kpi-v">${e(c.value)}</b>` +
        (c.sub ? `<span class="scp-inp-kpi-s">${e(c.sub)}</span>` : "") +
        `</div></div>`,
    )
    .join("");
  return (
    `<div class="scp-inp-status">` +
    `<div class="scp-inp-now is-${s.kind}">` +
    `<p class="scp-inp-now-word"><span class="scp-inp-dot" aria-hidden="true"></span>${e(s.word)}</p>` +
    // The designation's body part, phones only (the sentence below names it
    // on desktop and is hidden on phones; mak, 2026-11-06).
    (s.part ? `<p class="scp-inp-now-part">${e(s.part)}</p>` : "") +
    `<p class="scp-inp-now-text">${e(s.answer)}</p>` +
    checked +
    `</div>` +
    (kpis ? `<div class="scp-inp-kpis">${kpis}</div>` : "") +
    `</div>`
  );
}

/* ---------------------------------------------------------------- practice */

function practiceWeek(w: InjuryPremiumModel["practice"]["weeks"][number]): string {
  const days = w.days
    .map((d) => `<span class="scp-inp-pd is-${d.kind}"><b>${e(d.day)}</b> ${e(d.text)}</span>`)
    .join(`<span class="scp-inp-psep" aria-hidden="true">|</span>`);
  const game = w.game.text ? `<span class="scp-inp-pg is-${w.game.kind}">${e(w.game.text)}</span>` : "";
  return (
    `<div class="scp-inp-pw${w.current ? " is-cur" : ""}">` +
    `<span class="scp-inp-pwk"><b>${e(`Week ${w.week}`)}</b>${w.where ? ` <small>${e(w.where)}</small>` : ""}</span>` +
    (w.injury ? `<span class="scp-inp-pinj">${e(w.injury)}</span>` : "") +
    `<span class="scp-inp-pdays">${days}</span>${game}</div>`
  );
}

function renderPractice(m: InjuryPremiumModel): string {
  const p = m.practice;
  if (!p.weeks.length && !p.empty) return "";
  const current = p.weeks.find((w) => w.current) ?? p.weeks[0] ?? null;
  const earlier = p.weeks.filter((w) => w !== current);
  const body = p.empty
    ? `<p class="scp-inp-ptext">${e(p.empty)}</p>`
    : (current ? practiceWeek(current) : "") +
      (earlier.length
        ? `<details class="scp-inp-pmore"><summary>${e(`Earlier week${earlier.length === 1 ? "" : "s"}`)}</summary>${earlier.map(practiceWeek).join("")}</details>`
        : "");
  return (
    `<div class="scp-inp-practice">` +
    `<div class="scp-inp-phead"><span class="scp-inp-picon">${ICON.clipboard}</span><h3 class="scp-inp-ptitle">Practice participation</h3></div>` +
    `<div class="scp-inp-pbody">${body}${p.note ? `<p class="scp-inp-pnote">${e(p.note)}</p>` : ""}</div>` +
    (p.head ? `<span class="scp-inp-pctx">${e(p.head)}</span>` : "") +
    `</div>`
  );
}

/* -------------------------------------------------------------- durability */

function renderDurability(data: PlayerPageData, m: InjuryPremiumModel): string {
  const d = durabilityParts(data);
  if (!d) return "";
  const tileIcon = [ICON.plus, ICON.heart, ICON.calendar, ICON.column];
  const tiles = d.tiles
    .map(
      (t, i) =>
        `<div class="scp-inp-dt"${t.title ? ` title="${e(t.title)}"` : ""}><span class="scp-inp-dt-icon">${tileIcon[i]}</span>` +
        `<div><b class="scp-inp-dt-v">${e(t.value)}</b><span class="scp-inp-dt-k">${e(t.label)}${t.title ? ` <small>(${e(t.title.toLowerCase())})</small>` : ""}</span></div></div>`,
    )
    .join("");
  const pct = Math.max(0, Math.min(100, d.score));
  const regionsText = d.regions.length
    ? `Injury regions on record: ${d.regions.map((r) => `${r.label} (${r.episodes} occurrence${r.episodes === 1 ? "" : "s"}, ${r.gamesMissed} game${r.gamesMissed === 1 ? "" : "s"} missed)`).join("; ")}.`
    : "No localized injuries recorded from the weekly reports.";
  const hp =
    `<div class="scp-inp-hp" role="img" aria-label="${e(`Durability score ${d.score.toFixed(1)} of 100, ${d.tier.name}`)}" style="--hp:${e(d.tier.color)}">` +
    `<div class="scp-inp-hp-head"><span class="scp-inp-hp-k" title="Redraft Command's durability score (HP): higher is more durable">Health profile</span><span class="scp-inp-hp-v"><b>${e(d.score.toFixed(1))}</b><small> / 100</small></span></div>` +
    `<div class="scp-inp-hp-bar"><span class="scp-inp-hp-fill" style="width:${pct.toFixed(1)}%"></span><span class="scp-inp-hp-notches" aria-hidden="true"></span></div>` +
    `</div>`;
  // The tier pill and the availability line share one row under the bar
  // (mak, 2026-11-06). The pill sits outside the role="img" block so the
  // line stays readable text; the block's label already names the tier.
  const hpFoot =
    `<div class="scp-inp-hp-foot">` +
    `<p class="scp-inp-hp-tier is-${e(d.tier.key)}" aria-hidden="true">${e(d.tier.name)}</p>` +
    `<p class="scp-inp-dur-status"><b class="is-${e(m.status.kind)}">${e(m.status.word)}</b><i aria-hidden="true"> • </i><b>${e(d.availPct.toFixed(1))}%</b> career availability</p>` +
    `</div>`;
  // One box per region, the selected one shown (client/player.ts swaps them
  // with the markers, the pills and the record): the map's only external
  // label now that the callouts show for the selected region alone.
  const selected = d.regions
    .filter((r) => r.episodes > 0)
    .map(
      (r) =>
        `<div class="scp-inp-sel" data-region-panel="${e(r.key)}"${r.key === d.worst ? "" : " hidden"} style="--sel:${e(r.color.stroke)}">` +
        // No "Selected location" label; the region and its counts share the
        // top row, the note sits centered under them (mak, 2026-11-06).
        `<div class="scp-inp-sel-top">` +
        `<b class="scp-inp-sel-v">${e(r.label)}</b>` +
        `<span class="scp-inp-sel-s">${e(`${r.episodes} occurrence${r.episodes === 1 ? "" : "s"} · ${r.gamesMissed} game${r.gamesMissed === 1 ? "" : "s"} missed`)}</span>` +
        `</div>` +
        `<span class="scp-inp-sel-s is-note">${e(r.severe ? "Season-ending injury on record" : r.gamesMissed > 0 ? `Latest ${r.latest}` : `Played through${r.latest ? ` · latest ${r.latest}` : ""}`)}</span>` +
        `</div>`,
    )
    .join("");
  const seasonsWord = `${d.seasons} season${d.seasons === 1 ? "" : "s"}`;
  // The reviewer's layout (2026-11-05): the four tiles in one row, then the
  // availability matrix (with the region pills and the open record under
  // it, 2026-11-06) beside the map panel.
  return (
    `<section class="scp-inp-sec is-dur" aria-labelledby="scp-inp-dur-h" data-scp-durability>` +
    bar(ICON.shield, "Durability Profile", "", "scp-inp-dur-h") +
    `<div class="scp-inp-dur">` +
    `<div class="scp-inp-tiles">${tiles}</div>` +
    `<div class="scp-inp-dur-grid">` +
    `<div class="scp-inp-dur-l">` +
    // Its own card, framed like the map panel (mak, 2026-11-06).
    `<div class="scp-inp-avbox">` +
    `<h3 class="scp-inp-dur-h">Season-by-Season Availability<small>${e(seasonsWord)}</small></h3>` +
    d.grid +
    `</div>` +
    // Injury Regions directly under the availability matrix (mak,
    // 2026-11-06), in the left column beside the map panel; its own card
    // (.scp-inp-regions is framed in player.css).
    `<div class="scp-inp-regions">` +
    `<h3 class="scp-inp-dur-h">Injury Regions<small>Select a region for its history</small></h3>` +
    d.pills +
    d.details +
    `</div>` +
    `</div>` +
    `<div class="scp-inp-dur-r">` +
    `<h3 class="scp-inp-dur-h">Injury Location Map<small>Interactive</small></h3>` +
    d.figure +
    selected +
    hp +
    hpFoot +
    `</div>` +
    `</div>` +
    `<p class="scp-in-sr">${e(regionsText)}</p>` +
    `</div></section>`
  );
}

/* ----------------------------------------------------------------- history */

function eventCard(ev: InjuryEvent): string {
  const w = eventWords(ev);
  const play = ev.play && ev.play.desc ? ev.play : null;
  const when = play ? [play.qtr ? `Q${play.qtr}` : "", play.clock ?? ""].filter(Boolean).join(" ") : "";
  return (
    `<li class="scp-inp-tl-item${ev.games > 0 ? "" : " is-thru"}">` +
    `<span class="scp-inp-yr">${ev.season}</span><span class="scp-inp-node" aria-hidden="true"></span>` +
    `<article class="scp-inp-ev">` +
    `<div class="scp-inp-ev-head"><h3 class="scp-inp-ev-title">${e(w.title)}${w.side ? ` <small>· ${e(w.side)}</small>` : ""}</h3>` +
    `<span class="scp-inp-badge is-${w.chip.kind}">${e(w.chip.text)}</span></div>` +
    `<p class="scp-inp-ev-meta">${e(w.meta)}</p>` +
    (ev.note ? `<p class="scp-inp-ev-note">${e(ev.note)}</p>` : "") +
    (play
      ? `<p class="scp-inp-play"><b>The play</b><span>${e(`${when ? `${when} ` : ""}vs ${play.opponent}`)}</span><span class="scp-inp-play-d">${e(play.desc)}</span></p>`
      : "") +
    // No weekly report pills under the card (mak, 2026-11-06): the note
    // above already says which weeks he was listed and missed.
    `</article></li>`
  );
}

function renderHistory(m: InjuryPremiumModel): string {
  const items: string[] = [];
  if (m.healthy) {
    items.push(
      `<li class="scp-inp-tl-item is-now"><span class="scp-inp-yr">${m.season}</span><span class="scp-inp-node" aria-hidden="true"></span>` +
        `<article class="scp-inp-ev is-now"><div class="scp-inp-ev-head"><span class="scp-inp-badge is-good">Healthy</span><span class="scp-inp-badge is-good">0 games missed</span></div>` +
        `<p class="scp-inp-ev-note">${e(m.healthy)}</p></article></li>`,
    );
  }
  const evs = m.events.map(eventCard);
  const FOLD = 15;
  const list =
    m.events.length >= FOLD
      ? `<ol class="scp-inp-tl">${items.join("")}${evs.slice(0, 10).join("")}</ol>` +
        `<details class="scp-inp-more"><summary>${e(`Show all ${m.events.length} injuries`)}</summary><ol class="scp-inp-tl">${evs.slice(10).join("")}</ol></details>`
      : `<ol class="scp-inp-tl">${items.join("")}${evs.join("")}</ol>`;
  return (
    `<section class="scp-inp-sec is-hist" aria-labelledby="scp-inp-hist-h">` +
    bar(ICON.medkit, `${m.name} Injury History`, "Every logged injury, most recent first. Games missed are regular-season games.", "scp-inp-hist-h", m.name) +
    `<div class="scp-inp-hist"><div class="scp-inp-tlwrap">${list || `<p class="scp-inp-none">No logged injuries.</p>`}</div></div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- misses time */

function renderPlan(m: InjuryPremiumModel): string {
  const c = m.contingency;
  if (!c) return "";
  const icon: Record<string, string> = { next: ICON.swap, others: ICON.people };
  const cards = c.cards
    .map((card) => `<div class="scp-inp-plan-card is-${card.key}"><h3 class="scp-inp-card-h"><span class="scp-inp-card-icon">${icon[card.key]}</span>${e(card.title)}</h3><p>${card.html}</p></div>`)
    .join("");
  return (
    `<section class="scp-inp-sec is-plan${m.out ? " is-urgent" : ""}" aria-labelledby="scp-inp-plan-h">` +
    bar(ICON.people, c.heading.replace(/\bmisses time$/i, "Misses Time"), "", "scp-inp-plan-h") +
    `<div class="scp-inp-plan"><div class="scp-inp-plan-cards">${cards}</div>` +
    `<div class="scp-inp-cta"><span class="scp-inp-cta-icon">${ICON.info}</span><span class="scp-inp-cta-text">${e(c.cta.text)}</span>` +
    `<a class="scp-inp-cta-link" href="${e(c.cta.href)}" data-cta="redraft-command-injury-backup">${e(c.cta.label)}<span class="scp-inp-cta-arrow">${ICON.arrow}</span></a></div>` +
    `</div></section>`
  );
}

/* ------------------------------------------------------------------ public */

export function renderInjuryPremium(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const m = injuryPremiumModel(data, options);
  if (!m) return "";
  const club = m.nickname ?? (data.team ? getTeamByAbbreviation(data.team.code)?.nickname : null) ?? null;
  const crest = m.logo ? `<img class="scp-inp-crest" src="${e(m.logo)}" alt="${e(club ? `${club} logo` : "Team logo")}" width="60" height="60" loading="lazy" decoding="async">` : "";
  const sub = `Current injury status, game availability, practice reports, and complete injury history for ${club ? `${club} ` : ""}${m.posWord} ${m.name}.`;
  const hero =
    `<header class="scp-inp-hero scp-up-head">` +
    headIcon("injury") +
    crest +
    `<span class="scp-inp-hero-rule" aria-hidden="true"></span>` +
    `<div class="scp-inp-hero-t"><h2 class="scp-inp-title scp-up-h2" id="scp-inp-title">${phoneHeading(`${m.name} Injury Status and History`, m.name)}</h2><p class="scp-inp-sub scp-up-dek">${e(sub)}</p></div>` +
    headArt("injury") +
    `<span class="scp-inp-hero-geo" aria-hidden="true"></span>` +
    `<span class="scp-inp-stripes" aria-hidden="true"></span>` +
    `</header>`;
  return (
    `<div class="scp-inp" aria-labelledby="scp-inp-title">` +
    // The banner, status row and practice strip share one card, the way the
    // Outlook tab's Rest-of-Season Projection holds its navy bar and body
    // (mak, 2026-11-06).
    `<section class="scp-inp-intro" aria-labelledby="scp-inp-title">` +
    hero +
    `<div class="scp-inp-intro-body">` +
    renderStatus(m) +
    renderPractice(m) +
    `</div></section>` +
    renderDurability(data, m) +
    renderHistory(m) +
    renderPlan(m) +
    `</div>`
  );
}
