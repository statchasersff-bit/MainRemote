/**
 * The News tab: mak's News spec of 2026-09-30, which replaced the old
 * "News & Analysis" lists.
 *
 *   1. Latest {name} news  - the lead item, large, with its result panel
 *   2. All updates this season - the feed grouped by week, filters, sidebar
 *   3. {Nickname} teammates news - the players most tied to his value
 *   4. Around the {Nickname} - the club's own reporting
 *   5. footer - sources, scoring, last update
 *
 * Desktop composition (mak, 2026-10-21): the lead across the top, then a
 * row of two: the season timeline beside a compact "Around the {Nickname}"
 * feed, so the club's reporting balances the timeline instead of sitting
 * under it. Teammates news keeps the full width below. One column under
 * 960px, in that DOM order. The Current Outlook card that used to sit
 * beside the lead was removed at mak's request on 2026-10-22.
 *
 * The model is news-tab-data.ts. Absolute dates only: nothing here prints a
 * relative time or carries the data-ts the client would turn into one.
 *
 * Deferred by mak: per-item report pages and the SEO items (title month,
 * CollectionPage/ItemList, NewsArticle). Links go to each item's own article.
 */

import { escapeHtml } from "../render";
import { headshotImg } from "../headshot-html";
import { CLUB_BAND_VARIANTS } from "../image-urls";
import { getTeamByAbbreviation } from "../team/teams";
import { possessive } from "./title-case";
import { itemTimestamp, type NewsItem } from "../render";
import { easternParts } from "../news-card";
import { categoryLabel } from "../news-category";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { lastName, teamInk } from "./header";
import { titleCase } from "./title-case";
import { sectionHref } from "./sections";
import { canonicalizeMatchupPair, gameSegment } from "../matchup/pair";
import type { ScheduleGame } from "../team/schedule";
import { loadPlayers } from "./data";
import { renderFaqSection, selectFaq, type FaqCandidate } from "./faq-engine";
import {
  buildFeed,
  etDay,
  MOVES,
  pickLead,
  properNouns,
  sentenceCase,
  shortDay,
  TYPE_LABEL,
  type FeedItem,
  type Impact,
  type Outcome,
  type NewsContext,
  type NewsMate,
  type WeekGroup,
} from "./news-tab-data";

/** Week groups shown open; older ones fold into a <details> (spec 4.9). */
const OPEN_GROUPS = 6;
/** Around-the-team: four compact cards, then "View all team news" (mak, 2026-10-23). */
const TEAM_ITEMS = 4;

const IMPACT_WORD: Record<Impact, string> = { up: "Positive", flat: "Neutral", down: "Negative" };
const OPENS_NEW = `<span class="scp-nw-sr"> (opens in new tab)</span>`;


/** A link, external ones to a new tab with the spec's hidden notice. */
function link(href: string | null, text: string, attrs = "", external = false): string {
  if (!href) return escapeHtml(text);
  return external
    ? `<a href="${escapeHtml(href)}" rel="noopener" target="_blank"${attrs}>${escapeHtml(text)}${OPENS_NEW}</a>`
    : `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/** "Sep 28, 9:15 AM ET", or "Sep 28" when only the day is known. */
function stamp(ms: number, hasTime: boolean): string {
  const iso = hasTime ? new Date(ms).toISOString() : etDay(ms);
  const day = shortDay(etDay(ms));
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(hasTime ? `${day}, ${easternParts(ms).time}` : day)}</time>`;
}

const ARROW: Record<Impact, string> = { up: "↑", flat: "≈", down: "↓" };


/** "↑ Ceiling game": the controlled-vocabulary impact read. */
const impactRead = (i: FeedItem): string =>
  `<span class="scp-nw-read is-${i.impact}"><span class="scp-nw-sr">Fantasy impact: </span><span aria-hidden="true">${ARROW[i.impact]}</span>${escapeHtml(i.outcome.label)}</span>`;

/** A recap's points and finish, split: ["25.6 FPTS", "QB4"]. */
function pointsParts(i: FeedItem): { fpts: string; fin: string | null } {
  const [pts, fin] = (i.pointsLine ?? "").split(" · ");
  return { fpts: (pts ?? "").replace(" fantasy points", " FPTS"), fin: fin ?? null };
}

/** The finish pill: "QB6", colored by its band (QB/TE 12/24, RB/WR 24/36). */
function finishPill(pos: string, fin: string | null): string {
  if (!fin) return "";
  const rank = Number(fin.replace(/^[A-Z]+/, ""));
  const [good, mid] = pos === "RB" || pos === "WR" ? [24, 36] : [12, 24];
  const band = !rank ? "mid" : rank <= good ? "good" : rank <= mid ? "mid" : "bad";
  return `<span class="scp-nw-fin is-${band}"><span class="scp-nw-sr">Finish: </span>${escapeHtml(fin)}</span>`;
}



/* ------------------------------------------------- categories and markers */

/**
 * The category badge (mak, 2026-10-23): GAME RECAP, INJURY, STATUS,
 * PRACTICE, ROLE CHANGE, TRANSACTION, CONTRACT, NEWS. A status item whose
 * outcome is injury-driven is INJURY; the rest follow the type.
 */
function category(i: FeedItem): { key: string; label: string } {
  if (i.type === "game") return { key: "game", label: "Game recap" };
  if (i.type === "status") return i.outcome.tag === "Injury" ? { key: "injury", label: "Injury" } : { key: "status", label: "Status" };
  if (i.type === "prac") return { key: "prac", label: "Practice" };
  if (i.type === "depth") return { key: "role", label: "Role change" };
  if (i.type === "transaction") return { key: "move", label: "Transaction" };
  if (i.type === "contract") return { key: "deal", label: "Contract" };
  return { key: "news", label: "News" };
}

const catBadge = (i: FeedItem): string => {
  const c = category(i);
  return `<span class="scp-nw-cat is-${c.key}">${escapeHtml(c.label)}</span>`;
};



/** The 40px headshot, or null when the player has none. */
function smallHeadshot(src: string | null | undefined, id: string | null | undefined, className: string): string | null {
  return headshotImg({
    src,
    id,
    className,
    alt: "",
    variants: ["160"],
    width: 40,
    height: 40,
    loading: "lazy",
    extra: ` aria-hidden="true"`,
  });
}

/** A club crest, 32px, decorative. */
const crest = (logo: string | null | undefined, className: string): string =>
  logo ? `<img class="${className}" src="${escapeHtml(logo)}" alt="" aria-hidden="true" width="32" height="32" loading="lazy" decoding="async" />` : "";


/** One stat row: the main line, plus the second when it scored or ran 20+ yards. */
function timelineStats(lines: string[]): string {
  const [main, extra] = lines;
  const counts = extra && (/ TD/.test(extra) || Number(/· (\d+) YDS/.exec(extra)?.[1] ?? 0) >= 20);
  return counts ? `${main} · ${extra}` : main ?? "";
}

/** The source, linked, and any other outlet that carried the same story. */
function sourceBits(i: FeedItem): string {
  const also = i.also.length ? ` (also ${i.also.map((x) => link(x.url, x.name, "", true)).join(", ")})` : "";
  return `${link(i.source.url, i.source.name, "", i.external)}${also}`;
}

/** The first sentence of a summary, for the one-line row. */
function firstSentence(text: string): { first: string; rest: string } {
  const t = text.trim();
  const m = /^(.*?[.!?])(?:\s+|$)([\s\S]*)$/.exec(t);
  if (!m) return { first: t, rest: "" };
  return { first: m[1]!, rest: (m[2] ?? "").trim() };
}

/* --------------------------------------------------------------- context */

function context(data: PlayerPageData, options: PlayerRenderOptions): NewsContext | null {
  const pos = data.player.position ?? "";
  if (!pos) return null;
  const prefix = options.playerPathPrefix ?? "/player/";
  const q = options.linkQuery ?? "";
  const season = data.leagueSeason ?? data.season;
  return {
    name: data.player.name,
    last: lastName(data.player.name),
    pos,
    season,
    scoring: SCORING_SHORT[data.format] ?? "PPR",
    games: data.schedule ?? [],
    log: data.season === season ? data.gameLog ?? [] : [],
    points: (e) => getEntryPoints(e.stats, data.format),
    topTargets: data.weekTopTargets ?? {},
    designation: (data.designation?.injuryStatus ?? "").trim() || null,
    practice: (data.designation?.practice ?? "").trim() || null,
    gameLogHref: `${prefix}${data.player.slug}/game-log/${q}`,
    boxHref: (g: ScheduleGame) => {
      const pair = canonicalizeMatchupPair(data.team?.code ?? null, g.opponent?.code ?? null);
      if (!pair) return null;
      // The schedule numbers the postseason 19-22; the address uses ESPN's round.
      const post = g.week > 18 || g.seasonType === "post";
      const week = post && g.week > 18 ? ({ 19: 1, 20: 2, 21: 3, 22: 5 } as Record<number, number>)[g.week] ?? g.week - 18 : g.week;
      return `${(options.matchupPathPrefix ?? "/nfl/").trim()}${pair.slug}/${gameSegment({ season, week, seasonType: post ? "post" : "regular" })}/${q}`;
    },
    now: options.now ?? Date.now(),
  };
}

/* --------------------------------------------------- section 3: teammates */

const TEAM_LABEL: Record<string, string> = {
  practice: "Practice",
  "depth-chart": "Depth chart",
  recap: "Game recap",
  preview: "Preview",
  analysis: "Analysis",
  injury: "Injury",
  status: "Status",
  transaction: "Transaction",
};


const HURT = /\b(out|ir|injur|questionable|doubtful|dnp|did not practice|sprain|strain|fracture|concussion|surgery)/i;

/**
 * A teammate item's impact on THIS player (spec 4.3), by rule: a receiver's
 * injury is bad for his quarterback, a quarterback's for everyone catching
 * his passes, a same-position competitor's good for the player.
 */
function mateImpact(pos: string, mate: NewsMate, item: NewsItem): Impact {
  const hurt = (item.category === "injury" || item.category === "status") && HURT.test(`${item.title} ${item.summary ?? ""}`);
  if (!hurt) return "flat";
  if (pos === "QB") return "down";
  if (mate.position === "QB") return "down";
  if (mate.position === pos || (pos !== "RB" && ["WR", "TE"].includes(mate.position))) return "up";
  return "flat";
}

function mateContext(pos: string, mate: NewsMate): string {
  if (mate.position === "QB") return `${mate.attempts} pass attempts this season`;
  if (pos === "RB" && mate.position === "RB") return `${mate.carries} carries this season`;
  return `${mate.targets} targets this season`;
}

/* -------------------------------------------------------- section 4: team */


/* --------------------------------------------------------------- the FAQ */

/**
 * The News FAQ (faq-engine.ts): only what the current news cycle supports
 * (mak, 2026-09-30). A trade, signing, contract or role question appears only
 * when this season has an item about it; practice and status belong to the
 * Injury tab, single games to the Game Log.
 */
function newsPool(data: PlayerPageData, ctx: NewsContext, items: FeedItem[], lead: FeedItem | null, options: PlayerRenderOptions): FaqCandidate[] {
  const pool: FaqCandidate[] = [];
  const outlookHref = sectionHref(data, options, "outlook");
  const outlook = outlookHref ? { href: outlookHref, text: `See the updated fantasy outlook.` } : null;
  const day = (i: FeedItem): string => {
    const d = etDay(i.ms);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${months[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  };
  const tell = (i: FeedItem): string => `${i.headline.replace(/[.!?]$/, "")} (${day(i)}).${i.summary ? ` ${i.summary}` : ""}`;
  if (lead) {
    pool.push({
      key: "latest",
      q: `What is the latest news on ${ctx.name}?`,
      a: `The latest ${ctx.last} update, from ${day(lead)}: ${lead.headline.replace(/[.!?]$/, "")}.${lead.summary ? ` ${lead.summary}` : ""}`,
    });
    pool.push({
      key: "impact",
      q: `How does the latest ${ctx.name} news affect his fantasy value?`,
      a: `${lead.impact === "up" ? "Positively" : lead.impact === "down" ? "Negatively" : "Not much"}: ` +
        (lead.type === "game" && lead.pointsLine
          ? `he scored ${lead.pointsLine.replace(" · ", ", a ")}${/ · /.test(lead.pointsLine) ? " finish" : ""}${lead.avgNote ? `, ${lead.avgNote}` : ""}.`
          : lead.take),
      link: outlook,
    });
  }
  const newest = (pred: (i: FeedItem) => boolean): FeedItem | null => items.filter(pred).sort((a, b) => b.ms - a.ms)[0] ?? null;
  const depth = newest((i) => i.type === "depth");
  if (depth) pool.push({ key: "role", q: `Has ${possessive(ctx.name)} role changed?`, a: `The latest depth-chart news on ${ctx.last}: ${tell(depth)}` });
  const trade = newest((i) => i.type === "transaction" && /\btrade/i.test(i.headline + " " + i.summary));
  if (trade) pool.push({ key: "trade", q: `Was ${ctx.name} traded?`, a: `The latest trade news on ${ctx.last}: ${tell(trade)}` });
  const signed = newest((i) => i.type === "transaction" && /\bsign/i.test(i.headline + " " + i.summary));
  if (signed) pool.push({ key: "signed", q: `Did ${ctx.name} sign with a new team?`, a: `The latest signing news on ${ctx.last}: ${tell(signed)}` });
  const deal = newest((i) => i.type === "contract");
  if (deal) pool.push({ key: "contract", q: `Did ${ctx.name} sign a new contract?`, a: `The latest contract news on ${ctx.last}: ${tell(deal)}` });
  return pool;
}

/* ------------------------------------------- the team pages' News design */

/*
 * The tab wears the team pages' News design (mak, 2026-11-06; team/
 * news-premium.ts, .sct-nwp): one wide featured story, a two-column grid of
 * story cards (photo well with a source ribbon and the corner mark, category
 * and date, headline, byline, "Read report"), and a rail of navy-headed
 * cards beside them. The stories are the same feed the timeline printed
 * (buildFeed), newest first; recaps keep their result (finish pill, points,
 * impact read, stat line) and their Box score link. The week groups, the
 * pending and bye rows and the per-row "More" fold are gone with the
 * timeline; the type filter stays above the grid. Around the {Nickname} and
 * the teammates news moved into the rail.
 *
 * Images are the same derivatives the site prints elsewhere: a wire story's
 * own image when it has one, his headshot otherwise (band crops), the club's
 * crest faint in an empty well.
 */

/** The featured story plus this many cards open; the rest fold. */
const NWP_VISIBLE = 8;

const NWP_ICON: Record<string, string> = {
  injury: `<path d="M12 5v14M5 12h14" stroke-width="3"/>`,
  swap: `<path d="M4 8h13l-3-3M20 16H7l3 3" stroke-width="2.2"/>`,
  news: `<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h4M8 12h8M8 15h8"/>`,
  game: `<ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)"/><path d="M9.5 14.5l5-5M11 11.5l1.5 1.5M12.5 10l1.5 1.5"/>`,
  people: `<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>`,
};

const nwpSvg = (key: string, className: string): string =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${NWP_ICON[key] ?? NWP_ICON.news}</svg>`;

/** The photo well's image: the band crop (16:9), or the empty well. */
function nwpPhoto(src: string | null | undefined, id: string | null | undefined, featured: boolean): string {
  const img = headshotImg({
    src,
    id,
    className: "scp-nwp-photo",
    alt: "",
    variants: ["b350", ...CLUB_BAND_VARIANTS],
    sizes: featured ? "(max-width: 700px) 100vw, 420px" : "(max-width: 700px) 100vw, 380px",
    width: featured ? 640 : 480,
    height: featured ? 360 : 270,
    loading: "lazy",
    extra: ` aria-hidden="true"`,
  });
  return img ?? `<span class="scp-nwp-photo-empty" aria-hidden="true"></span>`;
}

/** "GAME RECAP | NOV 1 · 9:15 AM ET": the category and the absolute date. */
function nwpStamp(label: string, ms: number, hasTime: boolean): string {
  const iso = hasTime ? new Date(ms).toISOString() : etDay(ms);
  return (
    `<p class="scp-nwp-news-meta"><span class="scp-nwp-news-kicker">${escapeHtml(label)}</span>` +
    `<span class="scp-nwp-dot" aria-hidden="true"></span>` +
    `<time datetime="${escapeHtml(iso)}">${escapeHtml(shortDay(etDay(ms)))}` +
    (hasTime ? `<span class="scp-nwp-news-time"> · ${escapeHtml(easternParts(ms).time)}</span>` : "") +
    `</time></p>`
  );
}

/** The headline, the whole card its target; external stories open a new tab. */
function nwpTitle(url: string | null, text: string, external: boolean): string {
  if (!url) return `<h3 class="scp-nwp-title">${escapeHtml(text)}</h3>`;
  return (
    `<h3 class="scp-nwp-title"><a class="scp-nwp-link" href="${escapeHtml(url)}"` +
    (external ? ` rel="noopener" target="_blank"` : "") +
    `>${escapeHtml(text)}${external ? OPENS_NEW : ""}</a></h3>`
  );
}

/** The ribbon over the photo: a recap's score, a report's source. */
function nwpRibbon(i: FeedItem): string {
  const game = i.type === "game";
  const text = game ? i.group.result ?? "" : i.external ? i.source.name : "";
  if (!text || text === "Source") return "";
  const key = game ? "game" : category(i).key === "injury" ? "injury" : MOVES.includes(i.type) ? "swap" : "news";
  return `<span class="scp-nwp-ribbon">${nwpSvg(key, "scp-nwp-ribbon-icon")}<span class="scp-nwp-ribbon-text">${escapeHtml(text)}</span></span>`;
}

function nwpCard(data: PlayerPageData, ctx: NewsContext, i: FeedItem, image: NewsItem | undefined, featured: boolean): string {
  const game = i.type === "game";
  const { fpts, fin } = pointsParts(i);
  // A wire story's own image when it carries one, his headshot otherwise.
  const photo = image?.image ? nwpPhoto(image.image, null, featured) : nwpPhoto(data.player.headshotUrl, data.player.id, featured);
  const result =
    game && i.pointsLine
      ? `<div class="scp-nwp-badges">${finishPill(ctx.pos, fin)}<b class="scp-nwp-fpts">${escapeHtml(fpts)}</b>${impactRead(i)}</div>` +
        (i.panel ? `<p class="scp-nwp-stats">${escapeHtml(timelineStats(i.panel.lines))}</p>` : "")
      : i.impact !== "flat"
        ? `<div class="scp-nwp-badges">${impactRead(i)}</div>`
        : "";
  const byline = game ? "" : `<p class="scp-nwp-byline"><span class="scp-nwp-source">${sourceBits(i)}</span></p>`;
  const sentence = game ? i.takeaway ?? "" : firstSentence(i.summary).first || i.take;
  // The headline's own destination again, for sighted readers only; a
  // recap's Box score is a second destination and a real link.
  const box = game && i.boxHref ? `<a class="scp-nwp-more is-box" href="${escapeHtml(i.boxHref)}" data-cta="news-boxscore">Box score <span class="scp-nwp-arrow" aria-hidden="true">→</span></a>` : "";
  const read = i.url
    ? `<a class="scp-nwp-more" href="${escapeHtml(i.url)}" tabindex="-1" aria-hidden="true" data-cta="news-readmore-${i.type}"${i.external ? ` rel="noopener" target="_blank"` : ""}>` +
      `${game && !i.external ? "View game recap" : "Read report"} <span class="scp-nwp-arrow">→</span></a>`
    : "";
  return (
    `<article class="scp-nwp-card${featured ? " is-featured" : ""} is-${i.impact}" data-type="${i.type}" data-impact="${i.impact}"` +
    (MOVES.includes(i.type) ? ` data-group="moves"` : "") +
    (featured ? "" : ` data-scp-news-item`) +
    `>` +
    `<div class="scp-nwp-well">${photo}${nwpRibbon(i)}<span class="scp-nwp-corner" aria-hidden="true"></span></div>` +
    `<div class="scp-nwp-body">` +
    (featured && data.team?.logo
      ? `<img class="scp-nwp-watermark" src="${escapeHtml(data.team.logo)}" alt="" width="160" height="160" loading="lazy" decoding="async" aria-hidden="true">`
      : "") +
    nwpStamp(category(i).label, i.ms, i.hasTime) +
    nwpTitle(i.url, i.headline, i.external) +
    result +
    byline +
    (sentence ? `<p class="scp-nwp-sum">${escapeHtml(sentence)}</p>` : "") +
    (box || read ? `<p class="scp-nwp-cta">${box}${read}</p>` : "") +
    `</div>` +
    `</article>`
  );
}

/** No story this season: the most recent one from any season, featured. */
function nwpFallback(data: PlayerPageData, item: NewsItem): string {
  const ts = itemTimestamp(item);
  const url = item.link ?? null;
  return (
    `<article class="scp-nwp-card is-featured is-old">` +
    `<div class="scp-nwp-well">${item.image ? nwpPhoto(item.image, null, true) : nwpPhoto(data.player.headshotUrl, data.player.id, true)}<span class="scp-nwp-corner" aria-hidden="true"></span></div>` +
    `<div class="scp-nwp-body">` +
    nwpStamp(`From ${ts ? etDay(ts).slice(0, 4) : "an earlier season"}`, ts ?? Date.now(), ts !== null) +
    nwpTitle(url, item.title, true) +
    `<p class="scp-nwp-byline"><span class="scp-nwp-source">${link(url, (item.source ?? "").trim() || "Source", "", true)}</span></p>` +
    (item.summary ? `<p class="scp-nwp-sum">${escapeHtml(firstSentence(item.summary).first)}</p>` : "") +
    `</div></article>`
  );
}

function nwpFilters(items: FeedItem[]): string {
  const types = new Set(items.map((i) => i.type));
  const buttons: Array<[string, string, boolean]> = [
    ["all", "All", true],
    ["game", "Games", types.has("game")],
    ["status", "Status", types.has("status")],
    ["prac", "Practice", types.has("prac")],
    ["moves", "Moves", MOVES.some((t) => types.has(t))],
  ];
  const shown = buttons.filter(([, , on]) => on);
  // Nothing to choose between: one kind of story, or a handful.
  if (shown.length < 3 || items.length < 4) return "";
  return (
    `<div class="scp-nwp-filters" role="group" aria-label="Filter updates" data-scp-news-filter>` +
    shown.map(([f, text], n) => `<button type="button" aria-pressed="${n === 0}" data-f="${f}" data-cta="news-filter-${f}">${text}</button>`).join("") +
    `</div>`
  );
}

function nwpRailHead(icon: string, id: string, title: string): string {
  return (
    `<div class="scp-nwp-head">${nwpSvg(icon, "scp-nwp-icon")}<h3 class="scp-nwp-h3" id="${id}">${escapeHtml(title)}</h3>` +
    `<span class="scp-nwp-slash" aria-hidden="true"></span></div>`
  );
}

/** Around the {Nickname}: the club's reporting, four rows and the team page link. */
function nwpTeamCard(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = (data.teamNews ?? []).filter((i) => i.link).slice(0, TEAM_ITEMS);
  if (items.length === 0 || !data.team) return "";
  const proper = properNouns(loadPlayers(), data.team.code);
  const rows = items
    .map((item) => {
      const ts = itemTimestamp(item);
      const label = TEAM_LABEL[item.category ?? ""] ?? (item.category && item.category !== "other" ? categoryLabel(item.category) : "Team news");
      return (
        `<li class="scp-nwp-row">` +
        `<span class="scp-nwp-face is-crest" aria-hidden="true">${crest(data.team?.logo, "scp-nwp-face-img")}</span>` +
        `<span class="scp-nwp-row-body">` +
        `<span class="scp-nwp-row-meta">${escapeHtml(label)}${ts ? ` · ${escapeHtml(shortDay(etDay(ts)))}` : ""}</span>` +
        link(item.link ?? null, sentenceCase(item.title, proper), ` class="scp-nwp-row-h" data-cta="news-team-outbound"`, true) +
        `</span></li>`
      );
    })
    .join("");
  const prefix = options.teamPathPrefix ?? "/team/";
  const more = `${prefix}${data.team.slug}/news/${options.linkQuery ?? ""}`;
  return (
    `<section class="scp-nwp-rail-card is-team" aria-labelledby="scp-nw-team-h">` +
    nwpRailHead("news", "scp-nw-team-h", `Around the ${data.team.nickname}`) +
    `<div class="scp-nwp-rail-body"><ul class="scp-nwp-rows">${rows}</ul>` +
    `<a class="scp-nwp-rail-more" href="${escapeHtml(more)}" target="_top">View all team news <span class="scp-nwp-arrow" aria-hidden="true">→</span></a></div>` +
    `</section>`
  );
}

/** The teammates most tied to his value, with what each story means for him. */
function nwpMatesCard(data: PlayerPageData, ctx: NewsContext, options: PlayerRenderOptions): string {
  const items = data.mateNews ?? [];
  if (items.length === 0 || !data.team) return "";
  const prefix = options.playerPathPrefix ?? "/player/";
  const q = options.linkQuery ?? "";
  const rows = items
    .map(({ item, mate }) => {
      const ts = itemTimestamp(item);
      const who = mate.slug ? `<a class="scp-nwp-row-who" href="${escapeHtml(`${prefix}${mate.slug}/${q}`)}">${escapeHtml(mate.name)}</a>` : `<span class="scp-nwp-row-who">${escapeHtml(mate.name)}</span>`;
      const face = smallHeadshot(mate.headshot, mate.id, "scp-nwp-face-img");
      const impact = mateImpact(ctx.pos, mate, item);
      return (
        `<li class="scp-nwp-row">` +
        `<span class="scp-nwp-face" aria-hidden="true">${face ?? ""}</span>` +
        `<span class="scp-nwp-row-body">` +
        `<span class="scp-nwp-row-meta">${who}${escapeHtml(` · ${mate.position}${ts ? ` · ${shortDay(etDay(ts))}` : ""}`)}</span>` +
        link(item.link ?? null, item.title, ` class="scp-nwp-row-h"`, true) +
        `<span class="scp-nwp-row-note">${escapeHtml(`${mateContext(ctx.pos, mate)}${(item.source ?? "").trim() ? `. Via ${(item.source ?? "").trim()}` : ""}`)}</span>` +
        `</span>` +
        `<span class="scp-nwp-impact is-${impact}"><span class="scp-nw-sr">${escapeHtml(`For ${ctx.last}: `)}</span>${escapeHtml(IMPACT_WORD[impact])}</span>` +
        `</li>`
      );
    })
    .join("");
  return (
    `<section class="scp-nwp-rail-card is-mates" aria-labelledby="scp-nw-mates-h">` +
    nwpRailHead("people", "scp-nw-mates-h", `${data.team.nickname} Teammates`) +
    `<div class="scp-nwp-rail-body"><ul class="scp-nwp-rows">${rows}</ul></div>` +
    `</section>`
  );
}

function renderNewsPremium(data: PlayerPageData, ctx: NewsContext, items: FeedItem[], lead: FeedItem | null, options: PlayerRenderOptions): string {
  const byId = new Map((data.news ?? []).map((n) => [n.id, n] as const));
  const rest = items.filter((i) => i !== lead).sort((a, b) => b.ms - a.ms);
  const fallback = lead ? null : data.news?.[0] ?? null;
  const featured = lead ? nwpCard(data, ctx, lead, byId.get(lead.id), true) : fallback ? nwpFallback(data, fallback) : "";
  const grid = (list: FeedItem[]): string =>
    list.length ? `<div class="scp-nwp-grid">${list.map((i) => nwpCard(data, ctx, i, byId.get(i.id), false)).join("")}</div>` : "";
  const shown = rest.slice(0, NWP_VISIBLE);
  const folded = rest.slice(NWP_VISIBLE);
  const feed = rest.length
    ? `<section class="scp-nwp-feed" aria-label="${escapeHtml(`More ${ctx.last} updates this season`)}">` +
      nwpFilters(rest) +
      grid(shown) +
      (folded.length
        ? `<details class="scp-nwp-fold"><summary class="scp-nwp-more-summary"><span>${escapeHtml(`View ${folded.length} more ${ctx.last} ${folded.length === 1 ? "update" : "updates"}`)}</span></summary>${grid(folded)}</details>`
        : "") +
      `<p class="scp-nwp-empty" id="scp-nw-empty" role="status" hidden>No updates of this type yet this season.</p>` +
      `</section>`
    : "";
  const none = featured
    ? ""
    : `<div class="scp-nwp-none"><p class="scp-nwp-none-title">${escapeHtml(`No ${ctx.last} news yet this season.`)}</p>` +
      `<p class="scp-nwp-none-body">New reports, practice notes and game recaps appear here as they arrive.</p></div>`;
  const rail = nwpTeamCard(data, options) + nwpMatesCard(data, ctx, options);
  if (!featured && !rest.length && !rail) return "";
  return (
    `<div class="scp-nwp-layout${rail ? "" : " is-solo"}">` +
    `<div class="scp-nwp-main">${featured}${none}${feed}</div>` +
    (rail ? `<aside class="scp-nwp-rail" aria-label="${escapeHtml(`${data.team?.nickname ?? "Team"} news and teammates`)}">${rail}</aside>` : "") +
    `</div>`
  );
}

/* ---------------------------------------------------------------- the tab */

/**
 * The tab split at its FAQ, which the page stands under the peers rail
 * (mak, 2026-10-02) - same shape as outlookTabParts.
 */
export function renderNewsTabParts(data: PlayerPageData, options: PlayerRenderOptions = {}): { body: string; faq: string } | null {
  const ctx = context(data, options);
  if (!ctx) return null;
  const { items } = buildFeed(ctx, data.news ?? []);
  const lead = pickLead(items);

  const body = renderNewsPremium(data, ctx, items, lead, options);
  if (!body) return null;

  // No sourcing/methodology footer (mak, 2026-10-02).
  const ink = teamInk(data.team);
  const faq = renderFaqSection("news", data, selectFaq(newsPool(data, ctx, items, lead, options)), options);
  const wrap = (html: string): string =>
    html ? `<div class="scp-ox scp-st scp-nw"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>` : "";
  const team = data.team ? getTeamByAbbreviation(data.team.code) : null;
  const accent = team ? (team.secondaryColor && team.secondaryColor.toLowerCase() !== "#ffffff" ? team.secondaryColor : team.primaryColor) : null;
  const style = [accent ? `--nwp-team:${accent}` : "", data.team?.logo ? `--nwp-crest:url(${data.team.logo})` : ""].filter(Boolean).join(";");
  return {
    body: `<div class="scp-nwp"${style ? ` style="${escapeHtml(style)}"` : ""}>${body}</div>`,
    faq: wrap(faq),
  };
}

/**
 * The Overview's news brief (mak's Overview redesign, 2026-11-05): up to
 * three recent items from the same feed the News tab is built from, keeping
 * only what the weekly chart does not already say. The feed's own types
 * decide it, not keywords:
 *
 *   - game recaps (type "game") are left out: the chart and the Game Log
 *     carry the week;
 *   - an uncategorized wire note ("analysis") published from kickoff to 48
 *     hours after a final game he played is the postgame write-up of that
 *     game, and is left out for the same reason;
 *   - injury and status, practice, depth-chart, transaction and contract
 *     items always qualify, as does any other note outside that window;
 *   - nothing older than 30 days.
 *
 * Nothing is removed from the feed: the News tab still prints all of it.
 * Empty when nothing qualifies, and the Overview then drops the section.
 */
const BRIEF_WINDOW_MS = 30 * 86_400_000;
const POSTGAME_MS = 48 * 3_600_000;

export function newsBriefItems(data: PlayerPageData, options: PlayerRenderOptions = {}, limit = 3): FeedItem[] {
  const ctx = context(data, options);
  if (!ctx) return [];
  const { items } = buildFeed(ctx, data.news ?? []);
  const playedWeeks = new Set(ctx.log.filter((e) => (e.game_status ?? "active") === "active").map((e) => e.week));
  const kickoffs = ctx.games
    .filter((g) => g.status === "final" && g.kickoffMs !== null && playedWeeks.has(g.week))
    .map((g) => g.kickoffMs!);
  const postgame = (ms: number): boolean => kickoffs.some((k) => ms >= k && ms <= k + POSTGAME_MS);
  return items
    .filter((i) => i.type !== "game")
    .filter((i) => !(i.type === "analysis" && postgame(i.ms)))
    .filter((i) => ctx.now - i.ms <= BRIEF_WINDOW_MS)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

export function renderNewsBrief(data: PlayerPageData, options: PlayerRenderOptions = {}, limit = 3): string {
  const shown = newsBriefItems(data, options, limit);
  if (shown.length === 0) return "";
  const prefix = options.playerPathPrefix ?? "/player/";
  const q = options.linkQuery ?? "";
  const href = `${prefix}${data.player.slug}/news/${q}`;
  const rows = shown
    .map((i) => {
      const sentence = firstSentence(i.summary).first;
      // The summary only when it says more than the headline does.
      const extra = sentence && !sentence.toLowerCase().includes(i.headline.toLowerCase().slice(0, 40)) ? sentence : "";
      return (
        `<li class="scp-nw-dg-item is-${i.impact}" data-type="${i.type}">` +
        `<p class="scp-nw-meta">${catBadge(i)}${stamp(i.ms, i.hasTime)}</p>` +
        `<h3 class="scp-nw-dg-h">${link(i.url, i.headline, "", i.external)}</h3>` +
        (extra ? `<p class="scp-nw-dg-sum">${escapeHtml(extra)}</p>` : "") +
        `</li>`
      );
    })
    .join("");
  return (
    `<div class="scp-nw scp-nw-dg"><ol class="scp-nw-digest">${rows}</ol></div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`All ${data.player.name} news and updates`)}</a>`
  );
}

export function renderNewsTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const parts = renderNewsTabParts(data, options);
  return parts ? parts.body + parts.faq : "";
}
