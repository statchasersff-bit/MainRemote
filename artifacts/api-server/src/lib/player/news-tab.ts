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

function open(id: string, heading: string, lede: string): string {
  return (
    `<section class="scp-ox-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${lede}</p>` : "")
  );
}

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

/** The week-state tag: "CEILING", "FLOOR", "PENDING" (mak, 2026-10-05). */
const tag = (kind: string, text: string): string => `<span class="scp-nw-tag is-${kind}">${escapeHtml(text)}</span>`;
const tagFor = (o: Outcome): string => tag(o.tag.toLowerCase().replace(/\s+/g, "-"), o.tag);

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

const arrowLink = (href: string, text: string, cta: string): string =>
  `<a class="scp-nw-readlink" href="${escapeHtml(href)}" data-cta="${cta}">${escapeHtml(text)} <span aria-hidden="true">→</span></a>`;

const impactPill = (impact: Impact, prefix = ""): string =>
  `<span class="scp-nw-impact is-${impact}">${escapeHtml(prefix + (prefix ? IMPACT_WORD[impact].toLowerCase() : IMPACT_WORD[impact]))}</span>`;

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

/** A category badge for a club item, from the archive's category word. */
function teamCatBadge(cat: string | null | undefined, label: string): string {
  const key =
    cat === "recap" ? "game"
    : cat === "injury" ? "injury"
    : cat === "status" ? "status"
    : cat === "practice" ? "prac"
    : cat === "depth-chart" ? "role"
    : cat === "transaction" ? "move"
    : "news";
  return `<span class="scp-nw-cat is-${key}">${escapeHtml(label)}</span>`;
}

/** Line icons for the non-game markers: one path each, 16px, stroke only. */
const ICON: Record<string, string> = {
  injury: `<path d="M12 5v14M5 12h14"/>`,
  status: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`,
  prac: `<path d="M4 17l6-6 4 4 6-6"/><path d="M14 9h6v6"/>`,
  role: `<path d="M4 7h16M4 12h10M4 17h6"/>`,
  move: `<path d="M4 9h12l-3-3M20 15H8l3 3"/>`,
  deal: `<path d="M6 4h9l4 4v12H6z"/><path d="M9 13h6M9 17h6"/>`,
  news: `<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/>`,
};

const iconTile = (key: string): string =>
  `<span class="scp-nw-marker is-${key}" aria-hidden="true">` +
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[key] ?? ICON.news}</svg>` +
  `</span>`;

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

/** The marker in the row's left column: his headshot for a recap, the type's icon otherwise. */
function marker(data: PlayerPageData, i: FeedItem): string {
  if (i.type === "game") {
    const img = smallHeadshot(data.player.headshotUrl, data.player.id, "scp-nw-face");
    if (img) return `<span class="scp-nw-marker is-face">${img}</span>`;
    return iconTile("game");
  }
  return iconTile(category(i).key);
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

/* ------------------------------------------------------ section 1: latest */

/*
 * One feature card (mak, 2026-09-30, after the first build): headline, then
 * the date, type and source on one line, the stat line and result, the
 * summary, and a small impact badge with the report link. The navy result
 * panel is gone; it outweighed the headline.
 */

/** Hidden text for the color cue on a feed item's left edge (spec 4.7). */
const impactSr = (impact: Impact): string => `<span class="scp-nw-sr">Fantasy impact: ${IMPACT_WORD[impact]}. </span>`;

function readLink(i: FeedItem, cta: boolean, text = i.type === "game" && !i.external ? "Game log" : "Read full report"): string {
  if (!i.url) return "";
  return (
    `<a class="scp-nw-readlink" href="${escapeHtml(i.url)}"${cta ? ` data-cta="news-readmore-${i.type}"` : ""}` +
    `${i.external ? ` rel="noopener" target="_blank"` : ""}>${text} <span aria-hidden="true">→</span>${i.external ? OPENS_NEW : ""}</a>`
  );
}

function sourceBits(i: FeedItem): string {
  const also = i.also.length ? ` (also ${i.also.map((x) => link(x.url, x.name, "", true)).join(", ")})` : "";
  return `${link(i.source.url, i.source.name, "", i.external)}${also}`;
}

function renderLatest(
  data: PlayerPageData,
  ctx: NewsContext,
  lead: FeedItem | null,
  fallback: NewsItem | null,
  injuryHref: string | null,
): string {
  let body: string;
  // The feature card (mak, 2026-10-23): his photo on the left, the category
  // and date over the headline, the result as the big badge row, one stat
  // line, one sentence, the links.
  const photo = headshotImg({
    src: data.player.headshotUrl,
    id: data.player.id,
    className: "scp-nw-lead-img",
    alt: "",
    variants: ["160", "256"],
    sizes: "96px",
    width: 96,
    height: 96,
    loading: "lazy",
    extra: ` aria-hidden="true"`,
  });
  const opp = (i: FeedItem) => (i.group.week !== null ? ctx.games.find((g) => g.week === i.group.week) : undefined);
  if (lead) {
    const game = lead.type === "game";
    const { fpts, fin } = pointsParts(lead);
    const g = game ? opp(lead) : undefined;
    const media =
      `<div class="scp-nw-lead-media">` +
      (photo ?? iconTile(category(lead).key)) +
      (g?.opponent?.logo ? `<img class="scp-nw-lead-opp" src="${escapeHtml(g.opponent.logo)}" alt="" aria-hidden="true" width="32" height="32" loading="lazy" decoding="async" />` : "") +
      `</div>`;
    const hero = game && lead.pointsLine
      ? `<div class="scp-nw-hero">${finishPill(ctx.pos, fin)}<p class="scp-nw-fpts">${escapeHtml(fpts)}</p>` +
        (lead.group.result ? `<span class="scp-nw-score">${escapeHtml(lead.group.result)}</span>` : "") +
        impactRead(lead) + `</div>`
      : `<div class="scp-nw-hero">${tagFor(lead.outcome)}${impactRead(lead)}</div>`;
    const stats = game && lead.panel ? `<p class="scp-nw-statline">${escapeHtml(timelineStats(lead.panel.lines))}</p>` : "";
    // One sentence: a recap's takeaway, a report's first sentence.
    const line = game ? lead.takeaway ?? "" : firstSentence(lead.summary).first || lead.take;
    const links = game
      ? (lead.boxHref ? arrowLink(lead.boxHref, "Box score", "news-boxscore") : "") + readLink(lead, true)
      : lead.type === "status"
        ? (injuryHref ? arrowLink(injuryHref, "Injury status and history", "news-injury") : "") + readLink(lead, true)
        : readLink(lead, true);
    body =
      `<p class="scp-nw-label">Latest update</p>` +
      `<article class="scp-nw-lead is-${lead.impact}" data-type="${lead.type}">` +
      media +
      `<div class="scp-nw-lead-body">` +
      `<p class="scp-nw-meta">${catBadge(lead)}${stamp(lead.ms, lead.hasTime)}${game ? "" : `<span>${sourceBits(lead)}</span>`}</p>` +
      `<h3>${link(lead.url, lead.headline, "", lead.external)}</h3>` +
      hero +
      stats +
      (line ? `<p class="scp-nw-lead-sum">${escapeHtml(line)}</p>` : "") +
      (links ? `<div class="scp-nw-foot">${links}</div>` : "") +
      `</div>` +
      `</article>`;
  } else if (fallback) {
    // No news this season (spec 4.9): the most recent item from any season.
    const ts = itemTimestamp(fallback);
    body =
      `<p class="scp-nw-label">Latest update</p>` +
      `<article class="scp-nw-lead is-old">` +
      `<div class="scp-nw-lead-media">${photo ?? iconTile("news")}</div>` +
      `<div class="scp-nw-lead-body">` +
      `<p class="scp-nw-meta"><span class="scp-nw-new">${escapeHtml(`From ${ts ? etDay(ts).slice(0, 4) : "an earlier season"}`)}</span>` +
      (ts ? stamp(ts, true) : "") +
      `<span>${link(fallback.link ?? null, (fallback.source ?? "").trim() || "Source", "", true)}</span></p>` +
      `<h3>${link(fallback.link ?? null, fallback.title, "", true)}</h3>` +
      (fallback.summary ? `<p class="scp-nw-lead-sum">${escapeHtml(firstSentence(fallback.summary).first)}</p>` : "") +
      `</div></article>`;
  } else {
    return "";
  }
  // No "Latest story" heading or lede (mak, 2026-10-02): the panel heading
  // above already reads "Latest {name} News & Updates".
  return `<section class="scp-ox-sec scp-nw-latest">` + body + `</section>`;
}

/* -------------------------------------------------------- section 2: feed */

/**
 * A feed row (mak, 2026-10-23): the marker on the left (his headshot for a
 * recap, the type's icon otherwise), then the category badge and date over
 * the headline, one stat or metadata line, one sentence; the fantasy result
 * as badges on the right. Anything past the first sentence folds into "More".
 */
function renderItem(data: PlayerPageData, ctx: NewsContext, i: FeedItem): string {
  const group = MOVES.includes(i.type) ? ` data-group="moves"` : "";
  const game = i.type === "game" && i.pointsLine;
  const { fpts, fin } = pointsParts(i);
  let line: string;
  let one: string;
  let more = "";
  if (game) {
    line = `<p class="scp-nw-statline">${escapeHtml([fpts, i.panel ? timelineStats(i.panel.lines) : ""].filter(Boolean).join(" · "))}</p>`;
    // No "More" on a recap: the stat line and the takeaway are the story,
    // and the Game log link goes deeper.
    one = i.takeaway ?? "";
  } else {
    line = "";
    const { first, rest } = firstSentence(i.summary);
    one = first || i.take;
    const extra = [rest, first ? i.take : ""].filter(Boolean).join(" ");
    if (extra) more = `<details class="scp-nw-more"><summary>More</summary><p>${escapeHtml(extra)}</p></details>`;
  }
  // The badges top right, the link bottom right (mak, 2026-10-23): a recap's
  // reads "View Game Recap".
  const more_link = readLink(i, true, game ? "View Game Recap" : undefined);
  const badges = game ? finishPill(ctx.pos, fin) + tagFor(i.outcome) : i.impact !== "flat" ? impactRead(i) : "";
  const side = badges || more_link
    ? `<div class="scp-nw-side">${badges ? `<div class="scp-nw-badges">${badges}</div>` : ""}${more_link}</div>`
    : "";
  return (
    `<article class="scp-nw-item is-${i.impact}" data-type="${i.type}" data-impact="${i.impact}"${group}>` +
    impactSr(i.impact) +
    marker(data, i) +
    `<div class="scp-nw-body">` +
    `<p class="scp-nw-meta">${catBadge(i)}${stamp(i.ms, i.hasTime)}${game ? "" : `<span>${sourceBits(i)}</span>`}</p>` +
    `<h3>${link(i.url, i.headline, "", i.external)}</h3>` +
    line +
    (one ? `<p class="scp-nw-sum">${escapeHtml(one)}</p>` : "") +
    more +
    `</div>` +
    side +
    `</article>`
  );
}

/** One timeline stat row: the main line, plus the second when it scored or ran 20+ yards. */
function timelineStats(lines: string[]): string {
  const [main, extra] = lines;
  const counts = extra && (/ TD/.test(extra) || Number(/· (\d+) YDS/.exec(extra)?.[1] ?? 0) >= 20);
  return counts ? `${main} · ${extra}` : main ?? "";
}

function renderGroup(data: PlayerPageData, ctx: NewsContext, g: WeekGroup, items: FeedItem[], pending: boolean): string {
  return (
    `<li class="scp-nw-wk">` +
    `<p class="scp-nw-wklabel"><b>${escapeHtml(g.label)}</b>` +
    (g.date ? `<span>${escapeHtml(g.date)}</span>` : "") +
    (g.result ? `<span class="scp-nw-res">${escapeHtml(g.result)}</span>` : "") +
    `</p>` +
    (g.bye && items.length === 0 ? `<p class="scp-nw-pending">${tag("bye", "Bye")}<span>No game this week</span></p>` : "") +
    `<div class="scp-nw-items">` +
    // A deliberate state, not a gap (mak, 2026-10-05).
    (pending ? `<p class="scp-nw-pending">${tag("pending", "Pending")}<span>Recap pending · analysis updating</span></p>` : "") +
    items.map((i) => renderItem(data, ctx, i)).join("") +
    `</div></li>`
  );
}

function renderFeed(data: PlayerPageData, ctx: NewsContext, items: FeedItem[], pendingGroups: WeekGroup[]): string {
  const groups = new Map<string, { g: WeekGroup; items: FeedItem[]; pending: boolean }>();
  for (const i of items) {
    const hit = groups.get(i.group.key) ?? { g: i.group, items: [], pending: false };
    hit.items.push(i);
    groups.set(i.group.key, hit);
  }
  for (const g of pendingGroups) {
    const hit = groups.get(g.key) ?? { g, items: [], pending: false };
    hit.pending = true;
    groups.set(g.key, hit);
  }
  const ordered = [...groups.values()].sort((a, b) => b.g.order - a.g.order);

  const types = new Set(items.map((i) => i.type));
  const filters =
    `<div class="scp-nw-filters" role="group" aria-label="Filter updates" data-scp-news-filter>` +
    `<button type="button" aria-pressed="true" data-f="all" data-cta="news-filter-all">All</button>` +
    `<button type="button" aria-pressed="false" data-f="game" data-cta="news-filter-game">Games</button>` +
    `<button type="button" aria-pressed="false" data-f="status" data-cta="news-filter-status">Status</button>` +
    `<button type="button" aria-pressed="false" data-f="prac" data-cta="news-filter-prac">Practice</button>` +
    (MOVES.some((t) => types.has(t)) ? `<button type="button" aria-pressed="false" data-f="moves" data-cta="news-filter-moves">Moves</button>` : "") +
    `</div>`;

  let feed: string;
  if (ordered.length === 0) {
    feed = `<p class="scp-nw-none">No updates yet this season.</p>`;
  } else {
    const shown = ordered.slice(0, OPEN_GROUPS);
    const older = ordered.slice(OPEN_GROUPS);
    const weeks = older.map((o) => o.g.week).filter((w): w is number => w !== null);
    const label =
      weeks.length === older.length && weeks.length
        ? `Show Weeks ${Math.min(...weeks)}–${Math.max(...weeks)}`
        : "Show earlier updates";
    feed =
      `<ol class="scp-nw-feed">${shown.map((o) => renderGroup(data, ctx, o.g, o.items, o.pending)).join("")}</ol>` +
      (older.length
        ? `<details class="scp-nw-older"><summary>${escapeHtml(label)}</summary>` +
          `<ol class="scp-nw-feed">${older.map((o) => renderGroup(data, ctx, o.g, o.items, o.pending)).join("")}</ol></details>`
        : "") +
      `<p class="scp-nw-empty" id="scp-nw-empty" role="status" hidden>No updates of this type yet this season.</p>`;
  }

  return (
    `<section class="scp-ox-sec" aria-labelledby="scp-nw-feed-h">` +
    // Same label language as "Latest update", no gold rule (mak, 2026-10-05).
    `<h2 class="scp-ox-h2 scp-nw-label" id="scp-nw-feed-h">${escapeHtml(titleCase("Season timeline"))}</h2>` +
    (ordered.length ? filters : "") +
    feed +
    `</section>`
  );
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

function renderMates(data: PlayerPageData, ctx: NewsContext, options: PlayerRenderOptions): string {
  const items = data.mateNews ?? [];
  if (items.length === 0 || !data.team) return "";
  const prefix = options.playerPathPrefix ?? "/player/";
  const q = options.linkQuery ?? "";
  const lede =
    ctx.pos === "QB"
      ? `Updates on the players who catch ${possessive(ctx.last)} passes.`
      : ctx.pos === "RB"
        ? `Updates on ${possessive(ctx.last)} backfield partners and quarterback.`
        : `Updates on ${possessive(ctx.last)} quarterback and target competition.`;
  const rows = items
    .map(({ item, mate }) => {
      const ts = itemTimestamp(item);
      const who = mate.slug ? `<a href="${escapeHtml(`${prefix}${mate.slug}/${q}`)}">${escapeHtml(mate.name)}</a>` : escapeHtml(mate.name);
      const via = (item.source ?? "").trim();
      const face = smallHeadshot(mate.headshot, mate.id, "scp-nw-face");
      return (
        `<li><span class="scp-nw-marker is-face${face ? "" : " is-empty"}">${face ?? ""}</span>` +
        `<div><p class="scp-nw-meta">${teamCatBadge(item.category, TEAM_LABEL[item.category ?? ""] ?? "News")}${ts ? stamp(ts, false) : ""}</p>` +
        `${link(item.link ?? null, item.title, ` class="scp-nw-h"`, true)}` +
        `<span class="scp-nw-who">${who}${escapeHtml(`, ${mate.position}. ${mateContext(ctx.pos, mate)}${via ? `. Via ${via}` : ""}`)}</span></div>` +
        impactPill(mateImpact(ctx.pos, mate, item)) +
        `</li>`
      );
    })
    .join("");
  return open("scp-nw-mates-h", `${data.team.nickname} teammates news`, escapeHtml(lede)) + `<ul class="scp-nw-list">${rows}</ul></section>`;
}

/* -------------------------------------------------------- section 4: team */


function renderTeam(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = (data.teamNews ?? []).filter((i) => i.link).slice(0, TEAM_ITEMS);
  if (items.length === 0 || !data.team) return "";
  const proper = properNouns(loadPlayers(), data.team.code);
  const rows = items
    .map((item) => {
      const ts = itemTimestamp(item);
      const label = TEAM_LABEL[item.category ?? ""] ?? (item.category && item.category !== "other" ? categoryLabel(item.category) : "Team news");
      // A condensed feed row (mak, 2026-10-21): date and type on one small
      // line, the headline under it. It lives in the rail beside the timeline.
      // A compact headline card (mak, 2026-10-23): the crest, the category
      // badge and date, the headline. Four of them, then "View all team news".
      return (
        `<li class="scp-nw-card">` +
        `<span class="scp-nw-marker is-crest">${crest(data.team?.logo, "scp-nw-crest")}</span>` +
        `<div><p class="scp-nw-meta">${teamCatBadge(item.category, label)}${ts ? stamp(ts, false) : ""}</p>` +
        link(item.link ?? null, sentenceCase(item.title, proper), ` class="scp-nw-h" data-cta="news-team-outbound"`, true) +
        `</div></li>`
      );
    })
    .join("");
  const prefix = options.teamPathPrefix ?? "/team/";
  const more = `${prefix}${data.team.slug}/news/${options.linkQuery ?? ""}`;
  return (
    // No "Team reporting from …" lede (mak, 2026-10-02); the same small label
    // as "Season timeline" since the two share a row.
    `<section class="scp-ox-sec scp-nw-team" aria-labelledby="scp-nw-team-h">` +
    `<h2 class="scp-ox-h2 scp-nw-label" id="scp-nw-team-h">${escapeHtml(titleCase(`Around the ${data.team.nickname}`))}</h2>` +
    `<ul class="scp-nw-cards">${rows}</ul>` +
    `<a class="scp-ox-more" href="${escapeHtml(more)}" target="_top">View all team news</a>` +
    `</section>`
  );
}

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

/* ---------------------------------------------------------------- the tab */

/**
 * The tab split at its FAQ, which the page stands under the peers rail
 * (mak, 2026-10-02) - same shape as outlookTabParts.
 */
export function renderNewsTabParts(data: PlayerPageData, options: PlayerRenderOptions = {}): { body: string; faq: string } | null {
  const ctx = context(data, options);
  if (!ctx) return null;
  const { items, pending } = buildFeed(ctx, data.news ?? []);
  const lead = pickLead(items);
  const feedItems = items.filter((i) => i !== lead);
  // Null when the player has no Injury page; every link to it is then left out.
  const injuryHref = sectionHref(data, options, "injury");

  const latest = renderLatest(data, ctx, lead, lead ? null : data.news?.[0] ?? null, injuryHref);
  const mates = renderMates(data, ctx, options);
  const team = renderTeam(data, options);
  if (!latest && !team && !mates) return null;

  // No sourcing/methodology footer (mak, 2026-10-02).
  const ink = teamInk(data.team);
  const faq = renderFaqSection("news", data, selectFaq(newsPool(data, ctx, items, lead, options)), options);
  const wrap = (html: string): string =>
    html ? `<div class="scp-ox scp-st scp-nw"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>` : "";
  // The lead across the top, then the timeline beside the club's reporting.
  const top = latest ? `<div class="scp-nw-top">${latest}</div>` : "";
  const rail = `<div class="scp-nw-rail">${team}</div>`;
  const main = `<div class="scp-nw-row">${renderFeed(data, ctx, feedItems, pending)}${rail}</div>`;
  return {
    // The panel heading's one-line dek (mak, 2026-10-05).
    // The panel heading's dek was removed 2026-10-23 (mak).
    body: wrap(top + main + mates),
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
