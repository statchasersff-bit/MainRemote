/**
 * The premium comparison version of the player profile header (mak's brief,
 * 2026-11-05, against attached_assets/player header reference.png): a
 * team-colored portrait panel cut on a gold diagonal, the identity in a navy
 * hero (position, club, status, the name large, number and position, one
 * bio line), the fantasy trio in a gold-edged panel, four season stat cards,
 * a gold Redraft Command button with the start/sit question beside it, the
 * next matchup as a compact strip, and a visual preview of the tab bar.
 *
 * Rendered directly UNDER the existing header while HEADER_PREMIUM_COMPARE
 * is on, behind a "New design - comparison" label, so both are on the page.
 * Nothing here is a new number: every value is read through the same helpers
 * header.ts prints from (headerBoard for the trio, season-line.ts for the
 * stat cards, headerFixture for the strip), so the two headers cannot
 * disagree. The name is an <h2> styled as the hero's heading, never a second
 * H1; the tab preview is decorative (no links, no ids), so the page keeps one
 * navigation. Like header.ts it stays off player-render's import graph so
 * tests/player-header.test.mjs can render it against hand-built states.
 */

import { escapeHtml } from "../render";
import { headshotImg } from "../headshot-html";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { heroCells, playedEntries, seasonTotals } from "./season-line";
import { sectionHref } from "./sections";
import { possessive } from "./title-case";
import {
  CHIP_WORD,
  designationSeverity,
  formatHeight,
  headerBoard,
  headerFixture,
  headerKickoff,
  lastName,
  matchupBand,
  ordinal,
  OUTLOOK_SEASON,
  REDRAFT_COMMAND_URL,
  seasonNotStarted,
  STARTSIT_BASE,
  teamInk,
} from "./header";

/** Flip off to drop the comparison block without touching the current header. */
export const HEADER_PREMIUM_COMPARE = true;

/** One tab of the page's navigation, for the preview strip. */
export interface PremiumHeroNav {
  id: string;
  label: string;
}

export interface PremiumHeroDeps {
  nav: PremiumHeroNav[];
  /** The matchup page for the next fixture, when the pair has one. */
  matchupHref: string | null;
}

const DASH = "-";

/* ------------------------------------------------------------------ icons */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  columns: svg(`<path d="M5 20v-7M12 20V5M19 20v-10"/>`),
  football: svg(`<path d="M5.2 18.8c-2.3-2.3-1.4-8.1 2.6-12.1s9.8-4.9 12.1-2.6 1.4 8.1-2.6 12.1-9.8 4.9-12.1 2.6z"/><path d="M9 15l6-6"/><path d="M10.2 11.3l1.2 1.2M12.4 9.1l1.2 1.2M11.3 13.5l1.2 1.2"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  intercept: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>`),
  trend: svg(`<path d="M3 17l5-6 4 4 5-7 4 3"/><path d="M17 8h4v4"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  question: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>`),
  compass: svg(`<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
};

/** The jersey number as the panel's watermark, or nothing: never a stale one. */
function watermark(number: number | string | null | undefined): string {
  if (number === null || number === undefined || number === "") return "";
  return `<span class="scp-pp-num" aria-hidden="true">${escapeHtml(String(number))}</span>`;
}

const SILHOUETTE =
  `<svg class="scp-pp-sil" viewBox="0 0 200 145" aria-hidden="true" focusable="false">` +
  `<circle cx="100" cy="52" r="34" />` +
  `<path d="M22 145c4-40 38-58 78-58s74 18 78 58z" />` +
  `</svg>`;

/** The full word for the position tag's abbreviation. */
const POSITION_WORD: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
  DEF: "Defense",
};

/* ------------------------------------------------------------ the status */

/**
 * The status pill: the injury designation when there is one (its existing
 * semantics and the Injury tab link), else the page's own roster status -
 * "Active" only when the bio pipeline classed him active, "Free Agent" when
 * it classed him so; a former player gets "Former"; no classification, no
 * pill. Never "Active" by default.
 */
function statusPill(data: PlayerPageData, options: PlayerRenderOptions): string {
  const status = data.designation?.injuryStatus ?? data.player.injury_status ?? "";
  if (status.trim()) {
    const severity = designationSeverity(status);
    const key = status.trim().toLowerCase();
    const label = /^ir\b/.test(key) || key.includes("injured reserve") ? "IR" : status.trim();
    const tone = severity === "out" || severity === "doubtful" ? "is-bad" : severity === "probable" ? "is-good" : "is-mid";
    const href = sectionHref(data, options, "injury");
    return href
      ? `<a class="scp-pp-status ${tone}" href="${escapeHtml(href)}" target="_top">${escapeHtml(label)}</a>`
      : `<span class="scp-pp-status ${tone}">${escapeHtml(label)}</span>`;
  }
  const page = (data as { bioPage?: { status?: string } | null }).bioPage;
  if (page?.status === "active") return `<span class="scp-pp-status is-good">Active</span>`;
  if (page?.status === "free-agent") return `<span class="scp-pp-status is-none">Free Agent</span>`;
  if (page?.status === "former") return `<span class="scp-pp-status is-none">Former</span>`;
  return "";
}

/* --------------------------------------------------------- the stat cards */

/** The card's label and icon for one of season-line's cells, by position. */
function cardFace(pos: string, label: string): { label: string; icon: string } {
  const k = label.toLowerCase();
  if (pos === "QB") {
    if (k === "cmp") return { label: "CMP / ATT", icon: ICON.target };
    if (k === "yds") return { label: "PASS YDS", icon: ICON.columns };
    if (k === "td") return { label: "PASS TD", icon: ICON.trophy };
    if (k === "int") return { label: "INT", icon: ICON.intercept };
  }
  if (pos === "RB") {
    if (k === "car") return { label: "CARRIES", icon: ICON.football };
    if (k === "yds") return { label: "RUSH YDS", icon: ICON.columns };
    if (k === "td") return { label: "TOTAL TD", icon: ICON.trophy };
    if (k === "rec") return { label: "REC", icon: ICON.target };
  }
  if (k === "rec") return { label: "REC", icon: ICON.football };
  if (k === "yds") return { label: "REC YDS", icon: ICON.columns };
  if (k === "td") return { label: "REC TD", icon: ICON.trophy };
  if (k === "y/r") return { label: "YPR", icon: ICON.target };
  return { label: label.toUpperCase(), icon: ICON.columns };
}

/** Yards first, as the reference orders them; the rest keep season-line's order. */
function orderCells<T extends { label: string }>(cells: T[]): T[] {
  const yards = cells.filter((c) => c.label === "yds");
  return [...yards, ...cells.filter((c) => c.label !== "yds")];
}

function statCards(data: PlayerPageData): string {
  const pos = data.player.position ?? "";
  const played = playedEntries(data.gameLog ?? []);
  const totals = seasonTotals(played, (e) => getEntryPoints(e.stats, data.format));
  const cells = orderCells(heroCells(pos, totals)).slice(0, 4);
  if (cells.length === 0) return "";
  return (
    `<ul class="scp-pp-cards">` +
    cells
      .map((c) => {
        const face = cardFace(pos, c.label);
        return (
          `<li class="scp-pp-card" title="${escapeHtml(c.title)}">` +
          `<span class="scp-pp-card-icon" aria-hidden="true">${face.icon}</span>` +
          // A two-figure value ("135/205") at a size that holds the card.
          `<b class="scp-pp-card-v${c.value.length > 5 ? " is-long" : ""}">${escapeHtml(c.value)}</b>` +
          `<span class="scp-pp-card-l">${escapeHtml(face.label)}</span>` +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

/* ------------------------------------------------------------- the block */

export function renderPremiumHero(
  data: PlayerPageData,
  options: PlayerRenderOptions,
  tab = "overview",
  deps: PremiumHeroDeps = { nav: [], matchupHref: null },
): string {
  const { player, team } = data;
  const prefix = options.playerPathPrefix ?? "/player/";
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const cta = tab.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const last = lastName(player.name);
  const pos = player.position ?? "";

  /* ---- the portrait panel ---- */

  const img =
    headshotImg({
      src: player.headshotUrl,
      id: player.id,
      className: "scp-pp-img",
      alt: `${player.name} headshot`,
      variants: ["f350", "f200"],
      sizes: "(max-width: 650px) 120px, 300px",
      width: 350,
      height: 254,
      loading: "eager",
      extra: ' data-no-lazy="1"',
    }) ?? "";
  const well =
    `<div class="scp-pp-well${img ? "" : " is-missing"}">` +
    `<div class="scp-pp-well-paint" aria-hidden="true"></div>` +
    watermark(player.number) +
    SILHOUETTE +
    img +
    `</div>`;

  /* ---- the identity ---- */

  const tags =
    (pos ? `<span class="scp-pp-pos">${escapeHtml(pos)}</span>` : "") +
    (team
      ? `<a class="scp-pp-team" href="${escapeHtml(`${teamPrefix}${team.slug}/${query}`)}" target="_top">${escapeHtml(team.fullName)}</a>`
      : `<span class="scp-pp-team">Free agent</span>`) +
    (() => {
      const pill = statusPill(data, options);
      return pill ? ` <span class="scp-pp-sep" aria-hidden="true"></span> ${pill}` : "";
    })();

  const under: string[] = [];
  if (player.number) under.push(`#${escapeHtml(String(player.number))}`);
  if (pos) under.push(escapeHtml(POSITION_WORD[pos] ?? pos));

  const bio: Array<[string, string]> = [];
  if (player.age) bio.push([`${player.age} yrs`, "Age"]);
  const height = formatHeight(player.height);
  const build = [height, player.weight ? `${player.weight} lbs` : ""].filter(Boolean).join(", ");
  if (build) bio.push([build, "Height, weight"]);
  const college = data.bioProfile?.college ?? null;
  if (college) bio.push([college, "College"]);
  if (player.years_exp !== null && player.years_exp !== undefined) {
    bio.push([player.years_exp === 0 ? "Rookie" : `${ordinal(player.years_exp + 1)} Season`, "Experience"]);
  }
  const draft = data.bioProfile?.draft;
  if (draft && draft.year && draft.round && draft.pick) {
    bio.push([`${draft.year} R${draft.round}, P${draft.pick}`, `Drafted ${draft.year}, round ${draft.round}, pick ${draft.pick}`]);
  }

  const identity =
    `<div class="scp-pp-id">` +
    `<div class="scp-pp-tags">${tags}</div>` +
    // An <h2> styled as the hero's heading: the existing header above it
    // owns the page's H1 while the two are compared.
    `<h2 class="scp-pp-name">${escapeHtml(player.name)}</h2>` +
    (under.length ? `<p class="scp-pp-under">${under.map((u) => `<span>${u}</span>`).join(` <span class="scp-pp-sep" aria-hidden="true"></span> `)}</p>` : "") +
    (bio.length
      ? `<p class="scp-pp-bio">` +
        bio.map(([v, t]) => `<span class="scp-pp-bio-i" title="${escapeHtml(t)}">${escapeHtml(v)}</span>`).join(` <span class="scp-pp-sep" aria-hidden="true"></span> `) +
        `</p>`
      : "") +
    `</div>`;

  /* ---- the fantasy panel ---- */

  const trio = headerBoard(data);
  const LABEL = ["FPPG", "POS RANK", "ROSTERED"];
  const fantasy =
    `<div class="scp-pp-fan-wrap">` +
    `<p class="scp-pp-fan-cap">${escapeHtml(`${data.season} Fantasy Season`)}</p>` +
    `<dl class="scp-pp-fan">` +
    trio
      .map(
        (c, i) =>
          `<div class="scp-pp-fan-cell${c.lead ? " is-lead" : ""}" title="${escapeHtml(c.title)}">` +
          `<dd class="scp-pp-fan-v">${escapeHtml(c.value)}</dd>` +
          `<dt class="scp-pp-fan-l">${escapeHtml(i === 0 ? `${LABEL[0]} · ${SCORING_SHORT[data.format]}` : LABEL[i] ?? c.unit)}</dt>` +
          `</div>`,
      )
      .join("") +
    `</dl>` +
    `</div>`;

  /* ---- the actions ---- */

  const next = headerFixture(data);
  const outlookHref = sectionHref(data, options, "outlook");
  const primary =
    `<a class="scp-pp-btn is-primary" href="${escapeHtml(`${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(player.slug)}`)}"` +
    ` data-cta="redraft-command-header-premium-${cta}">` +
    `<span class="scp-pp-btn-icon" aria-hidden="true">${ICON.trend}</span>View in Redraft Command<span class="scp-pp-btn-arrow" aria-hidden="true">${ICON.arrow}</span></a>`;
  let secondary = "";
  if (team && next && !seasonNotStarted(data)) {
    const href = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(player.slug)}`;
    secondary =
      `<a class="scp-pp-btn is-secondary" href="${escapeHtml(href)}" data-cta="startsit-header-premium-${cta}">` +
      `<span class="scp-pp-btn-icon" aria-hidden="true">${ICON.question}</span>${escapeHtml(`Should I start ${last}?`)}</a>`;
  } else if (outlookHref) {
    secondary =
      `<a class="scp-pp-btn is-secondary" href="${escapeHtml(outlookHref)}" target="_top" data-cta="outlook-header-premium-${cta}">` +
      `<span class="scp-pp-btn-icon" aria-hidden="true">${ICON.compass}</span>${escapeHtml(`${possessive(last)} ${OUTLOOK_SEASON} outlook`)}</a>`;
  }
  const actions = `<div class="scp-pp-actions">${primary}${secondary}</div>`;

  /* ---- the next matchup strip ---- */

  let strip = "";
  if (team && next) {
    const { game, bye } = next;
    const opp = game.opponent?.fullName ?? game.opponentName;
    const fixture = `Week ${game.week} ${game.homeAway === "away" ? "at" : "vs"} ${opp}`;
    const when = headerKickoff(game);
    const band = game.matchup ? CHIP_WORD[matchupBand(game.matchup.rank)] : null;
    const logo = game.opponent
      ? `<img class="scp-pp-mu-logo" src="${escapeHtml(game.opponent.logo)}" alt="" width="24" height="24" loading="lazy" decoding="async" />`
      : "";
    strip =
      `<div class="scp-pp-strip">` +
      `<span class="scp-pp-strip-cap">Next matchup</span>` +
      `<span class="scp-pp-mu">${logo}<strong>${escapeHtml(bye !== null ? `Week ${bye}: bye. Then ${fixture}` : fixture)}</strong></span>` +
      (when ? `<span class="scp-pp-mu-when">${escapeHtml(when)}</span>` : "") +
      (band && game.matchup
        ? `<span class="scp-pp-chip ${band.cls}">${escapeHtml(`${ordinal(game.matchup.rank)} vs ${game.matchup.position}s · ${band.word}`)}</span>`
        : "") +
      (deps.matchupHref
        ? `<a class="scp-pp-mu-link" href="${escapeHtml(deps.matchupHref)}" target="_top">View matchup<span aria-hidden="true">${ICON.arrow}</span></a>`
        : "") +
      `</div>`;
  }

  /* ---- the tab bar preview ---- */

  const nav = deps.nav.length
    ? `<div class="scp-pp-nav" aria-hidden="true">` +
      deps.nav
        .map((n) => `<span class="scp-pp-nav-i${n.id === tab ? " is-active" : ""}">${escapeHtml(n.label)}</span>`)
        .join("") +
      `</div>`
    : "";

  const ink = teamInk(team);
  const style =
    ` style="${escapeHtml(
      [ink ? `--scp-pp-team:${ink}` : "", team ? `--scp-pp-team-2:${team.secondaryColor}` : ""].filter(Boolean).join(";"),
    )}"`;

  return (
    `<p class="scp-pp-label" aria-hidden="true">New design - comparison</p>` +
    `<div class="scp-pp" data-scp-premium="header"${ink || team ? style : ""}>` +
    `<section class="scp-pp-hero" aria-label="${escapeHtml(`${player.name} summary (comparison)`)}">` +
    well +
    identity +
    fantasy +
    statCards(data) +
    actions +
    `<span class="scp-pp-stripes" aria-hidden="true"></span>` +
    `</section>` +
    strip +
    nav +
    `</div>`
  );
}
