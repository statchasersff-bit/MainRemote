/**
 * The team hub's News tab (mak's brief, 2026-11-05, attached_assets/
 * news2.png; approved and the old column, rail and cards removed the same
 * day): the "Latest {Nickname} News" heading (since 2026-11-05 evening the
 * shared premium tab header, the Coaching tab's design, across the block), one
 * wide featured story, a two-column grid of the rest, and on the right
 * Injury Watch, Next Game and Quick Links under navy heads.
 *
 * Presentation only. Every story is `data.news` in the feed's own order, the
 * first one featured as the original features it; the image is the same
 * derivative URL the original prints (headshotImg over the item's image key),
 * untouched; the stamp is the shared one, so the bundle's wireTimestamps
 * refines it into "3 hours ago" the same way. The injuries, the next game
 * and the four links are the original's data and helpers, exported from
 * team-render.ts.
 *
 * Labels are source-backed: the ribbon on a story's image says "Team
 * coverage" when the publisher is the club's own site and the publisher's
 * domain otherwise; the line under the headline names that publisher. The
 * category on the stamp is the feed's derived category (news-category.ts).
 *
 * Classes are `sct-nwp-*`, ids `sct-nwp-*`; the heading is the tab's H2
 * (.sct-h2 .sct-up-h2, the shared header's treatment).
 */

import { headshotImg } from "../headshot-html";
import { premiumTabHead } from "./premium-head";
import { CLUB_BAND_VARIANTS } from "../image-urls";
import { newsKicker, newsStamp, splitHeadline } from "../news-card";
import { TEAM_NEWS_VISIBLE } from "./team-data";
import type { NewsItem } from "../render";
import { escapeHtml, itemTimestamp, safeUrl } from "../render";
import {
  ARROW,
  gameDateLine,
  injurySeverity,
  matchupSide,
  nextGameLabel,
  playerName,
  resourceCards,
  siteLink,
} from "../team-render";
import { nextGame } from "./schedule";
import type { TeamPageData } from "./team-data";
import type { NflTeam } from "./teams";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

const ICON = {
  kit:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="3" y="7" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M12 11v5M9.5 13.5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  calendar:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<rect x="7" y="13" width="3" height="3" rx="0.6" fill="currentColor"/>` +
    `</svg>`,
  link:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  trophy:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`,
  bars:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor"/>` +
    `<rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor"/>` +
    `<rect x="16" y="3" width="4" height="17" rx="1" fill="currentColor"/>` +
    `</svg>`,
  layers:
    `<svg class="sct-nwp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M12 4 3 9l9 5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`,
  /** Ribbon marks by category. */
  injury:
    `<svg class="sct-nwp-ribbon-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` +
    `</svg>`,
  swap:
    `<svg class="sct-nwp-ribbon-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`,
  news:
    `<svg class="sct-nwp-ribbon-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M8 9h4M8 12h8M8 15h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
};

/* ----------------------------------------------------------------- pieces */

/**
 * The publisher as the data has it: the club's own site reads as the club,
 * any other domain reads as that domain, and an item with no source prints
 * the team as context (the original's byline), marked as such.
 */
function publisher(item: NewsItem, team: NflTeam): { label: string; official: boolean } {
  const source = (item.source ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!source) return { label: team.fullName, official: false };
  if (source === team.siteDomain.toLowerCase()) return { label: team.fullName, official: true };
  return { label: source, official: false };
}

/**
 * The ribbon over the photo's lower-left. Not on club editorial art: the
 * clubs' own graphics carry their banner (and sponsor) in that corner, and
 * a second one would cover it.
 */
function ribbon(item: NewsItem, team: NflTeam): string {
  const who = publisher(item, team);
  if (!item.source || item.sourceType === "club") return "";
  const text = who.official ? "Team coverage" : who.label;
  const cat = (item.category ?? "").toLowerCase();
  const icon = cat === "injury" ? ICON.injury : cat === "transaction" ? ICON.swap : ICON.news;
  return `<span class="sct-nwp-ribbon">${icon}<span class="sct-nwp-ribbon-text">${e(text)}</span></span>`;
}

/** The feed's stamp (category · date, refined client-side), under this prefix. */
function stamp(item: NewsItem): string {
  const ts = itemTimestamp(item);
  if (ts === null) return `<p class="sct-nwp-news-meta"><span class="sct-nwp-news-kicker">${e(newsKicker(item))}</span></p>`;
  // The shared stamp under this prefix: .sct-nwp-news-meta, -news-kicker,
  // -dot, -news-time, so the original's rules do not reach in.
  return newsStamp(item, ts, "sct-nwp");
}

function media(item: NewsItem, featured: boolean): string {
  const image = safeUrl(item.image);
  const name = (item.playerName ?? "").trim();
  const img = image
    ? headshotImg({
        src: image,
        className: "sct-nwp-photo",
        alt: name,
        variants: ["b350", ...CLUB_BAND_VARIANTS],
        sizes: featured ? "(max-width: 700px) 100vw, 420px" : "(max-width: 700px) 100vw, 380px",
        width: featured ? 640 : 480,
        height: featured ? 360 : 270,
        loading: "lazy",
      })
    : null;
  return img ?? `<span class="sct-nwp-photo-empty" aria-hidden="true"></span>`;
}

function card(item: NewsItem, team: NflTeam, featured: boolean): string {
  const link = safeUrl(item.link);
  const headline = e(splitHeadline(item));
  const name = (item.playerName ?? "").trim();
  const who = publisher(item, team);
  const heading = link
    ? `<h4 class="sct-nwp-title"><a class="sct-nwp-link" href="${e(link)}" target="_blank" rel="noopener noreferrer">${headline}</a></h4>`
    : `<h4 class="sct-nwp-title">${headline}</h4>`;
  const byline =
    `<p class="sct-nwp-byline">` +
    (name ? playerName(name, "sct-nwp-player") : "") +
    `<span class="sct-nwp-source">${e(who.label)}</span>` +
    `</p>`;
  const cta = link
    ? `<p class="sct-nwp-cta"><a class="sct-nwp-more" href="${e(link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">Read report ${ARROW}</a></p>`
    : "";
  return (
    `<article class="sct-nwp-card${featured ? " is-featured" : ""}">` +
    `<div class="sct-nwp-well">` +
    media(item, featured) +
    (featured ? "" : ribbon(item, team)) +
    `<span class="sct-nwp-corner" aria-hidden="true"></span>` +
    `</div>` +
    `<div class="sct-nwp-body">` +
    // The featured story's watermark: the club's own crest, a separate
    // decorative element behind the copy, never part of the photo.
    (featured && team.logo
      ? `<img class="sct-nwp-watermark" src="${e(team.logo)}" alt="" width="160" height="160" loading="lazy" decoding="async" aria-hidden="true">`
      : "") +
    stamp(item) +
    heading +
    byline +
    cta +
    `</div>` +
    `</article>`
  );
}

/* ---------------------------------------------------------------- rail */

function cardHead(icon: string, id: string, title: string, extra = ""): string {
  return (
    `<div class="sct-nwp-head">${icon}<h3 class="sct-nwp-h3" id="${id}">${e(title)}</h3>${extra}` +
    `<span class="sct-nwp-slash" aria-hidden="true"></span></div>`
  );
}

function injuryCard(data: TeamPageData): string {
  if (!data.roster) return "";
  const rows = data.injuries;
  const body = rows.length
    ? `<ul class="sct-nwp-injuries">` +
      rows
        .map((player) => {
          const detail = [player.injuryBodyPart, player.practice].filter(Boolean).map((p) => e(String(p))).join(" · ");
          return (
            `<li class="sct-nwp-injury">` +
            `<span class="sct-nwp-face" aria-hidden="true">` +
            (headshotImg({ src: player.headshot, className: "sct-nwp-face-img", alt: "", variants: ["160"], width: 30, height: 30, loading: "lazy" }) ?? "") +
            `</span>` +
            `<span class="sct-nwp-injury-who">` +
            playerName(player.name, "sct-nwp-injury-name") +
            (detail ? `<span class="sct-nwp-injury-detail">${detail}</span>` : "") +
            `</span>` +
            `<span class="sct-nwp-status" data-severity="${injurySeverity(player.injuryStatus)}">${e(player.injuryStatus ?? "")}</span>` +
            `</li>`
          );
        })
        .join("") +
      `</ul>`
    : `<p class="sct-nwp-empty">${e(`No ${data.team.nickname} skill-position players carry an injury designation right now.`)}</p>`;
  return (
    `<section class="sct-nwp-rail-card is-injuries" aria-labelledby="sct-nwp-inj-h">` +
    cardHead(ICON.kit, "sct-nwp-inj-h", "Injury Watch") +
    `<div class="sct-nwp-rail-body">${body}</div>` +
    `</section>`
  );
}

function nextGameCard(data: TeamPageData, now: number): string {
  const next = nextGame(data.schedule, now);
  if (!next) return "";
  const when = gameDateLine(next);
  const neutral = next.site === "neutral";
  const away = next.site === "away";
  const left = away || neutral ? data.team : next.opponent;
  const right = away || neutral ? next.opponent : data.team;
  const leftIsTeam = away || neutral;
  const defense = data.nextOpponentDefense;
  const context =
    defense && next.opponent && defense.abbreviation === next.opponent.abbreviation && defense.rankLabel
      ? `<p class="sct-nwp-note">` +
        `<span class="sct-nwp-note-team">${e(`${next.opponent.nickname} defense`)}</span>` +
        `<span class="sct-nwp-note-value"><b class="sct-nwp-num">${e(defense.rankLabel)}</b> · ${e(defense.value)} pts/g</span>` +
        `</p>`
      : "";
  const line = [when.date, when.time, next.network].filter(Boolean).map((part) => e(String(part)));
  return (
    `<section class="sct-nwp-rail-card is-next" aria-labelledby="sct-nwp-next-h">` +
    cardHead(ICON.calendar, "sct-nwp-next-h", nextGameLabel(next, now), `<span class="sct-nwp-week">${e(next.weekLabel)}</span>`) +
    `<div class="sct-nwp-rail-body">` +
    `<p class="sct-nwp-when">${ICON.calendar}<span>${line.join(`<span class="sct-nwp-when-dot" aria-hidden="true"> · </span>`)}</span></p>` +
    `<div class="sct-nwp-matchup" aria-hidden="true">` +
    matchupSide(left, leftIsTeam ? data.team.nickname : next.opponentName, leftIsTeam) +
    `<span class="sct-nwp-at">${neutral ? "vs" : "@"}</span>` +
    matchupSide(right, leftIsTeam ? next.opponentName : data.team.nickname, !leftIsTeam) +
    `</div>` +
    `<p class="sct-visually-hidden">${e(
      `${data.team.nickname} ${neutral ? "vs" : away ? "at" : "host"} ${next.opponent?.nickname ?? next.opponentName}${neutral ? " at a neutral site" : ""}`,
    )}</p>` +
    context +
    `</div>` +
    `</section>`
  );
}

function quickLinksCard(team: NflTeam): string {
  const cards = resourceCards(team);
  if (cards.length === 0) return "";
  const icons = [ICON.trophy, ICON.bars, ICON.calendar, ICON.layers];
  return (
    `<section class="sct-nwp-rail-card is-links" aria-labelledby="sct-nwp-links-h">` +
    cardHead(ICON.link, "sct-nwp-links-h", "Quick Links") +
    `<ul class="sct-nwp-tiles">` +
    cards
      .map(
        (c, i) =>
          `<li>` +
          siteLink(c.href, `${icons[i % icons.length]}<span class="sct-nwp-tile-text">${e(c.title)}</span><span class="sct-nwp-tile-arrow" aria-hidden="true">›</span>`, "sct-nwp-tile") +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- section */

/** The whole tab: the heading and the feed (or its empty state), with the rail beside it. */
export function renderNewsPremium(data: TeamPageData, now: number): string {
  const { team, news } = data;
  const rail = injuryCard(data) + nextGameCard(data, now) + quickLinksCard(team);
  // The original's fold: the first TEAM_NEWS_VISIBLE stories open, the rest
  // behind a disclosure (every story is in the response already).
  const [lead, ...rest] = news;
  const shown = rest.slice(0, TEAM_NEWS_VISIBLE - 1);
  const folded = rest.slice(TEAM_NEWS_VISIBLE - 1);
  const grid = (items: NewsItem[]): string =>
    items.length ? `<div class="sct-nwp-grid">${items.map((item) => card(item, team, false)).join("")}</div>` : "";
  const feed = lead
    ? card(lead, team, true) +
      grid(shown) +
      (folded.length
        ? `<details class="sct-nwp-more">` +
          `<summary class="sct-nwp-more-summary"><span>${e(`View ${folded.length} more ${team.nickname} ${folded.length === 1 ? "story" : "stories"}`)}</span></summary>` +
          grid(folded) +
          `</details>`
        : "")
    : `<div class="sct-nwp-none">` +
      `<p class="sct-nwp-none-title">${e(`No recent ${team.nickname} news is available.`)}</p>` +
      `<p class="sct-nwp-none-body">New reports appear here as they arrive.</p>` +
      `</div>`;
  const accent = team.secondaryColor && team.secondaryColor.toLowerCase() !== "#ffffff" ? team.secondaryColor : team.primaryColor;
  return (
    `<div class="sct-nwp" style="${e(`--nwp-team:${accent};--nwp-team-navy:${team.primaryColor}${team.logo ? `;--nwp-crest:url(${team.logo})` : ""}`)}">` +
    // The shared premium tab header (premium-head.ts), the Coaching tab's
    // design, since 2026-11-05 evening (mak: "match the design used by the
    // coaching tabs header"); full width above the feed and rail, as there.
    premiumTabHead({
      hook: "sct-nwp-hero",
      icon: "news",
      heading: `<h2 class="sct-h2 sct-up-h2 sct-nwp-h2">${e(`Latest ${team.nickname} News`)}</h2>`,
      dek: `The latest ${team.nickname} reports and updates, newest first.`,
    }) +
    `<div class="sct-nwp-layout${news.length < 3 ? " is-thin" : ""}">` +
    `<div class="sct-nwp-main">` +
    feed +
    `</div>` +
    (rail ? `<aside class="sct-nwp-rail" aria-label="${e(`${team.nickname} injury watch, next game and quick links`)}">${rail}</aside>` : "") +
    `</div>` +
    `</div>`
  );
}
