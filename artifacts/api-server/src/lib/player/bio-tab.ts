/**
 * The Bio tab (mak's "Build Instructions: StatChasers Bio Tab for Every
 * Player", 2026-09-30; redesigned to mak's "Exact Premium NFL Player Bio Tab
 * Redesign" brief on 2026-11-05 and approved the same day):
 *
 *   1. the premium Bio and Career block (bio-premium.ts): banner, identity
 *      strip, Career Overview, Career Timeline, the stop-by-stop timeline
 *      with the Quick Facts, Redraft Command and "More on" cards
 *   2. Trades / Trades and Team Changes / Transactions
 *                               each row dated to its source's precision (2.7)
 *
 * The spec's own lead, journey rail, stop list and sidebar (2.2-2.6) were
 * removed on 2026-11-05 when mak approved the premium block in their place;
 * moreOnRows(), collegeCrest() and redraftCommandHref() below are what the
 * block kept of them. The byline, the transactions lede and source line, and
 * the footer (spec 2.9) were all removed at mak's request, 2026-10-01.
 *
 * Fantasy wording (mak, option A): the bio text and stop sentences are
 * purely biographical. Fantasy appears only in the Redraft Command card and
 * the "best season" line (.is-rc, .scp-bo-best); tests/player.test.mjs holds
 * that line.
 *
 * Page facts come from bio-tab-data.ts. Not built, pending mak: the SEO items
 * (2.11: title, description, Person/ProfilePage JSON-LD, the index rule), the
 * spec's FAQ (the tab's existing FAQ already answers its questions), and the
 * model stages (prose from a language model, review queue).
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { teamInk } from "./header";
import { titleCase } from "./title-case";
import { outlookShort } from "./outlook-tab";
import { sectionHref } from "./sections";
import type { BioPageFacts, BioTransaction } from "./bio-tab-data";
import { headshotImg } from "../headshot-html";
import { COLLEGE_LOGO_VARIANTS } from "../image-urls";
import { collegeLogoFor } from "../team/draft";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";


/* ------------------------------------------------------------ shared bits */

/** One "More on {last}" row: the label, where it goes, and the link text. */
export interface MoreOnRow {
  label: string;
  href: string;
  text: string;
}

/**
 * The "More on {last}" rows, shared with the premium comparison block
 * (bio-premium.ts) so both designs link the same places. Each row only when
 * the player has the tab it points at: a link to a section URL with no
 * section behind it just 302s back here.
 */
export function moreOnRows(data: PlayerPageData, page: BioPageFacts, options: PlayerRenderOptions): MoreOnRow[] {
  const prefix = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}`;
  const q = options.linkQuery ?? "";
  const rows: MoreOnRow[] = [];
  if (page.seasonsPlayed > 0) {
    rows.push({
      label: "Career stats",
      href: `${prefix}/stats/${q}`,
      text: page.seasonsPlayed === 1 ? "1 season" : page.coversCareer ? `All ${page.seasonsPlayed} seasons` : `${page.seasonsPlayed} seasons since ${page.axis[0]}`,
    });
    rows.push({ label: "Game log", href: `${prefix}/game-log/${q}`, text: "Every game" });
  }
  const injuryHref = sectionHref(data, options, "injury");
  if (injuryHref) rows.push({ label: "Injury history", href: injuryHref, text: "Injury tab" });
  // The link, not the Outlook tab's fantasy label ("QB2, streamer"): the bio
  // carries no fantasy wording outside its three marked places.
  const outlookHref = sectionHref(data, options, "outlook");
  if (page.status === "active" && outlookShort(data) && outlookHref) {
    rows.push({ label: `${data.leagueSeason ?? data.season} outlook`, href: outlookHref, text: "Outlook tab" });
  }
  if (data.team && page.status === "active") {
    rows.push({ label: "Team", href: `${options.teamPathPrefix ?? "/team/"}${data.team.slug}/${q}`, text: data.team.nickname });
  }
  return rows;
}

/**
 * The college crest: the first school the crest register knows
 * (data/team/college_logos.json), through the image route the team Draft tab
 * uses. Decorative, so no alt text. Empty when no school is known.
 */
export function collegeCrest(page: BioPageFacts, className: string): string {
  if (!page.college) return "";
  const logo = page.college.names.map((n) => collegeLogoFor(n)).find((l) => l !== null) ?? null;
  return logo
    ? headshotImg({
        src: null,
        id: `ncaa:${logo.id}`,
        className,
        alt: "",
        variants: COLLEGE_LOGO_VARIANTS,
        sizes: "40px",
        width: 40,
        height: 40,
        loading: "lazy",
      }) ?? ""
    : "";
}

/** The Redraft Command deep link for this player, shared with the premium block. */
export function redraftCommandHref(data: PlayerPageData): string {
  return `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
}

/* ----------------------------------------------------- 4. transactions */

/**
 * The transactions log, in the premium bio block's dress (mak, 2026-11-05:
 * "similar design to the rest of the tabs"): the navy section bar, a row of
 * counts by kind of move, then the moves newest first on a vertical rail,
 * grouped under their year. Each kind keeps one tone across the chip, the
 * rail node and the count, so a reader can scan for trades or IR stints.
 * Same rows, same wording, same heading rule as before; nothing new is said.
 */
type TxTone = "trade" | "draft" | "sign" | "deal" | "out" | "inj" | "back" | "join";

const TX_TONE: Record<BioTransaction["type"], TxTone> = {
  Traded: "trade",
  Drafted: "draft",
  Signed: "sign",
  "Re-signed": "sign",
  Claimed: "sign",
  Joined: "join",
  Contract: "deal",
  Tender: "deal",
  Tag: "deal",
  Released: "out",
  Waived: "out",
  Retired: "out",
  "Waived/Injured": "inj",
  "Placed on IR": "inj",
  Suspended: "inj",
  "Commissioner's Exempt List": "inj",
  "Injury settlement": "inj",
  Activated: "back",
  Reinstated: "back",
};

/** The summary's labels, in the order a career reads. */
const TONE_LABEL: [TxTone, string, string][] = [
  ["draft", "Draft", "Drafts"],
  ["trade", "Trade", "Trades"],
  ["sign", "Signing", "Signings"],
  ["deal", "Contract", "Contracts"],
  ["join", "Team change", "Team changes"],
  ["out", "Release", "Releases"],
  ["inj", "IR / list move", "IR / list moves"],
  ["back", "Activation", "Activations"],
];

const TX_ICON =
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M7 4h10M7 4l-3 3 3 3M17 20H7m10 0 3-3-3-3"/><path d="M4 7h13M20 17H7"/></svg>`;

function renderTransactions(page: BioPageFacts): string {
  if (page.transactions.length === 0) return "";
  // Not "Transactions" until signings, releases and contracts are covered:
  // the list must not look like a complete history. No lede or source line
  // (mak, 2026-10-01).
  const heading = page.hasDatedMoves ? "Transactions" : page.tradesOnly ? "Trades" : "Trades and team changes";

  const counts = new Map<TxTone, number>();
  for (const t of page.transactions) {
    const tone = TX_TONE[t.type] ?? "join";
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  const years = page.transactions.map((t) => Number(t.date.slice(0, 4))).filter((y) => Number.isFinite(y));
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} - ${Math.max(...years)}`) : "";
  const total = page.transactions.length;
  const chips = TONE_LABEL.filter(([tone]) => counts.has(tone))
    .map(([tone, one, many]) => {
      const n = counts.get(tone)!;
      return `<li class="is-${tone}"><b>${n}</b> ${escapeHtml(n === 1 ? one : many)}</li>`;
    })
    .join("");
  const summary =
    `<div class="scp-bo-txsum">` +
    `<p class="scp-bo-txsum-total"><b>${total}</b> ${total === 1 ? "move" : "moves"}` +
    (span ? `<span>${escapeHtml(span)}</span>` : "") +
    `</p>` +
    `<ul class="scp-bo-txsum-kinds" aria-label="Moves by kind">${chips}</ul>` +
    `</div>`;

  let lastYear = "";
  const rows = page.transactions
    .map((t) => {
      const year = t.date.slice(0, 4);
      const tone = TX_TONE[t.type] ?? "join";
      const marker =
        year && year !== lastYear
          ? `<li class="scp-bo-txyr" aria-hidden="true"><span>${escapeHtml(year)}</span></li>`
          : "";
      lastYear = year || lastYear;
      return (
        marker +
        `<li class="scp-bo-txrow is-${tone}">` +
        `<span class="scp-bo-txnode" aria-hidden="true"></span>` +
        `<div class="scp-bo-txcard">` +
        `<time datetime="${escapeHtml(t.date)}">${escapeHtml(t.when)}</time>` +
        `<span class="scp-bo-tx is-${tone}">${escapeHtml(t.type)}</span>` +
        `<span class="scp-bo-txtext">${escapeHtml(t.text)}</span>` +
        `</div></li>`
      );
    })
    .join("");

  return (
    `<section class="scp-bop scp-bo-txsec" aria-labelledby="scp-bo-tx-h">` +
    `<div class="scp-bop-sec is-stops is-tx">` +
    `<header class="scp-bop-bar">` +
    `<span class="scp-bop-bar-icon">${TX_ICON}</span>` +
    `<h2 class="scp-bop-bar-title" id="scp-bo-tx-h">${escapeHtml(titleCase(heading))}</h2>` +
    `<span class="scp-bop-stripes" aria-hidden="true"></span>` +
    `</header>` +
    summary +
    `<ol class="scp-bo-txlog">${rows}</ol>` +
    `</div></section>`
  );
}

/* --------------------------------------------------------------- the tab */

/**
 * The tab: the premium Bio and Career block (bio-premium.ts, handed in by
 * player-render.ts so this module stays free of it), then the transactions
 * log. No footer (mak, 2026-10-01): the sources paragraph and "Last updated"
 * line went with the byline.
 */
export function renderBioTab(data: PlayerPageData, options: PlayerRenderOptions = {}, premium = ""): string {
  const page = data.bioPage;
  if (!page) return "";
  const body = premium + renderTransactions(page);
  if (!body) return "";
  const ink = teamInk(data.team);
  return `<div class="scp-ox scp-st scp-bo"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${body}</div>`;
}
