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
 * The model is news-tab-data.ts. Absolute dates only: nothing here prints a
 * relative time or carries the data-ts the client would turn into one.
 *
 * Deferred by mak: per-item report pages and the SEO items (title month,
 * CollectionPage/ItemList, NewsArticle). Links go to each item's own article.
 */

import { escapeHtml } from "../render";
import { itemTimestamp, type NewsItem } from "../render";
import { easternParts } from "../news-card";
import { categoryLabel } from "../news-category";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { lastName, matchupBand, STARTSIT_BASE, teamInk } from "./header";
import { titleCase } from "./title-case";
import { outlookSnapshot } from "./outlook-tab";
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

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";
/** Week groups shown open; older ones fold into a <details> (spec 4.9). */
const OPEN_GROUPS = 6;
const TEAM_ITEMS = 8;

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

/** "25.6 FPTS · QB4", from the recap's points line. */
const fpts = (i: FeedItem): string => (i.pointsLine ?? "").replace(" fantasy points", " FPTS");

/** "↓ 9.0 below season average", "≈ season average". */
function avgLine(i: FeedItem): string {
  if (i.avgDelta === null) return "";
  const d = i.avgDelta;
  const text = Math.abs(d) < 0.5 ? "≈ season average" : `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(1)} ${d > 0 ? "above" : "below"} season average`;
  return `<span class="scp-nw-avg">${escapeHtml(text)}</span>`;
}

const arrowLink = (href: string, text: string, cta: string): string =>
  `<a class="scp-nw-readlink" href="${escapeHtml(href)}" data-cta="${cta}">${escapeHtml(text)} <span aria-hidden="true">→</span></a>`;

const impactPill = (impact: Impact, prefix = ""): string =>
  `<span class="scp-nw-impact is-${impact}">${escapeHtml(prefix + (prefix ? IMPACT_WORD[impact].toLowerCase() : IMPACT_WORD[impact]))}</span>`;

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

/** Hidden text for the colour cue on a feed item's left edge (spec 4.7). */
const impactSr = (impact: Impact): string => `<span class="scp-nw-sr">Fantasy impact: ${IMPACT_WORD[impact]}. </span>`;

function readLink(i: FeedItem, cta: boolean): string {
  if (!i.url) return "";
  const text = i.type === "game" && !i.external ? "Game log" : "Read full report";
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
  injuryHref: string,
): string {
  let body: string;
  if (lead) {
    // mak's News redesign (2026-10-05): eyebrow, headline, the fantasy result
    // as the hero with the impact read beside it, compact stat rows, one SC
    // Takeaway line, then the links. A recap drops its prose summary.
    const game = lead.type === "game";
    const hero = game && lead.pointsLine
      ? `<div class="scp-nw-hero"><p class="scp-nw-fpts">${escapeHtml(fpts(lead))}</p>${impactRead(lead)}</div>`
      : `<div class="scp-nw-hero">${tagFor(lead.outcome)}${impactRead(lead)}</div>`;
    const stats = lead.panel ? `<div class="scp-nw-lead-stats">${lead.panel.lines.map((l) => `<p class="scp-nw-statline">${escapeHtml(l)}</p>`).join("")}</div>` : "";
    const links = game
      ? (lead.boxHref ? arrowLink(lead.boxHref, "Box score", "news-boxscore") : "") + readLink(lead, true)
      : lead.type === "status"
        ? arrowLink(injuryHref, "Injury status and history", "news-injury")
        : readLink(lead, true);
    body =
      `<p class="scp-nw-label">Latest update</p>` +
      `<article class="scp-nw-lead is-${lead.impact}" data-type="${lead.type}">` +
      `<p class="scp-nw-meta">${stamp(lead.ms, lead.hasTime)}<span>${escapeHtml(TYPE_LABEL[lead.type])}</span>${game ? "" : `<span>${sourceBits(lead)}</span>`}</p>` +
      `<h3>${link(lead.url, lead.headline, "", lead.external)}</h3>` +
      hero +
      stats +
      (!game && lead.summary ? `<p class="scp-nw-lead-sum">${escapeHtml(lead.summary)}</p>` : "") +
      (lead.takeaway ? `<div class="scp-nw-takeaway"><p class="scp-nw-takeaway-h">SC Takeaway</p><p>${escapeHtml(lead.takeaway)}</p></div>` : "") +
      (links ? `<div class="scp-nw-foot">${links}</div>` : "") +
      `</article>`;
  } else if (fallback) {
    // No news this season (spec 4.9): the most recent item from any season.
    const ts = itemTimestamp(fallback);
    body =
      `<p class="scp-nw-label">Latest update</p>` +
      `<article class="scp-nw-lead is-old">` +
      `<h3>${link(fallback.link ?? null, fallback.title, "", true)}</h3>` +
      `<p class="scp-nw-meta"><span class="scp-nw-new">${escapeHtml(`From ${ts ? etDay(ts).slice(0, 4) : "an earlier season"}`)}</span>` +
      (ts ? stamp(ts, true) : "") +
      `<span>${link(fallback.link ?? null, (fallback.source ?? "").trim() || "Source", "", true)}</span></p>` +
      (fallback.summary ? `<p class="scp-nw-lead-sum">${escapeHtml(fallback.summary)}</p>` : "") +
      `</article>`;
  } else {
    return "";
  }
  // No "Latest story" heading or lede (mak, 2026-10-02): the panel heading
  // above already reads "Latest {name} News & Updates".
  return `<section class="scp-ox-sec scp-nw-latest">` + body + `</section>`;
}

/* -------------------------------------------------------- section 2: feed */

/**
 * A timeline entry (mak, 2026-09-30): the headline, one result or type line,
 * one summary, one link. The impact is the colour of the left edge, with the
 * word in hidden text; a recap's take is its result line.
 */
function renderItem(i: FeedItem): string {
  const group = MOVES.includes(i.type) ? ` data-group="moves"` : "";
  const game = i.type === "game" && i.pointsLine;
  // One anatomy per entry (mak, 2026-10-05): tag, headline, the result with
  // its distance from his average, compact stats, one line, one link.
  const body = game
    ? `<p class="scp-nw-result"><b>${escapeHtml(fpts(i))}</b>${avgLine(i)}</p>` +
      (i.panel ? `<p class="scp-nw-statline">${escapeHtml(timelineStats(i.panel.lines))}</p>` : "") +
      (i.takeaway ? `<p class="scp-nw-sum">${escapeHtml(i.takeaway)}</p>` : "")
    : `<p class="scp-nw-meta">${stamp(i.ms, i.hasTime)}<span>${sourceBits(i)}</span></p>` +
      (i.summary ? `<p class="scp-nw-sum">${escapeHtml(i.summary)}</p>` : "") +
      `<p class="scp-nw-take"><strong>SC Takeaway:</strong> ${escapeHtml(i.take)}</p>`;
  return (
    `<article class="scp-nw-item is-${i.impact}" data-type="${i.type}" data-impact="${i.impact}"${group}>` +
    impactSr(i.impact) +
    // The read beside the tag only when it says more ("SOLID Volume boost",
    // not "FLOOR Floor game").
    `<p class="scp-nw-tagrow">${tagFor(i.outcome)}${game && !i.outcome.label.toLowerCase().startsWith(i.outcome.tag.toLowerCase()) ? `<span class="scp-nw-tagword">${escapeHtml(i.outcome.label)}</span>` : ""}</p>` +
    `<h3>${link(i.url, i.headline, "", i.external)}</h3>` +
    body +
    readLink(i, true) +
    `</article>`
  );
}

/** One timeline stat row: the main line, plus the second when it scored or ran 20+ yards. */
function timelineStats(lines: string[]): string {
  const [main, extra] = lines;
  const counts = extra && (/ TD/.test(extra) || Number(/· (\d+) YDS/.exec(extra)?.[1] ?? 0) >= 20);
  return counts ? `${main} · ${extra}` : main ?? "";
}

function renderGroup(g: WeekGroup, items: FeedItem[], pending: boolean): string {
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
    items.map(renderItem).join("") +
    `</div></li>`
  );
}

function renderFeed(
  data: PlayerPageData,
  ctx: NewsContext,
  items: FeedItem[],
  pendingGroups: WeekGroup[],
  options: PlayerRenderOptions,
  injuryHref: string,
): string {
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
      `<ol class="scp-nw-feed">${shown.map((o) => renderGroup(o.g, o.items, o.pending)).join("")}</ol>` +
      (older.length
        ? `<details class="scp-nw-older"><summary>${escapeHtml(label)}</summary>` +
          `<ol class="scp-nw-feed">${older.map((o) => renderGroup(o.g, o.items, o.pending)).join("")}</ol></details>`
        : "") +
      `<p class="scp-nw-empty" id="scp-nw-empty" role="status" hidden>No updates of this type yet this season.</p>`;
  }

  /* ---- sidebar: one utility card (mak, 2026-09-30) ---- */
  const prefix = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}`;
  const q = options.linkQuery ?? "";
  const rc = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const status = ctx.designation ?? "Active";
  const statusKind = !ctx.designation ? "good" : /^(questionable)/i.test(status) ? "mid" : "bad";
  const next = (data.upcoming ?? [])[0];
  const lastGame = [...ctx.log].reverse().find((e) => (e.game_status ?? "active") === "active" && e.stats);
  const snap = outlookSnapshot(data);
  // The Overview snapshot's own trend read, so the two tabs agree.
  const form = data.outlook;
  // Values first, no underlined links (mak, 2026-10-05): a snapshot, with
  // the one small link under the week it is about.
  const row = (label: string, value: string, sub = "", kind = ""): string =>
    `<div><dt>${escapeHtml(label)}</dt><dd><b${kind ? ` class="is-${kind}"` : ""}>${escapeHtml(value)}</b>${sub}</dd></div>`;
  const small = (text: string): string => `<small>${escapeHtml(text)}</small>`;
  const go = (href: string, text: string, cta: string): string =>
    `<a class="scp-nw-qa-link" href="${escapeHtml(href)}" data-cta="${cta}">${escapeHtml(text)} <span aria-hidden="true">→</span></a>`;
  const rows: string[] = [row("Status", status, go(injuryHref, "Injury report", "news-sidebar-injury"), statusKind)];
  if (next) {
    const opp = next.opponentCode ? `${next.homeAway === "away" ? "@" : "vs"} ${next.opponentCode}` : "";
    const band = next.matchup ? { soft: "favorable", mid: "neutral", tough: "tough" }[matchupBand(next.matchup.rank)] : "";
    rows.push(
      row(`Week ${next.week}`, snap?.call ?? (opp || "Next game"),
        (opp && snap ? small(`${opp}${band ? ` · ${band} matchup` : ""}`) : "") +
          go(`${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(data.player.slug)}`, "View Start/Sit", "startsit-news-sidebar")),
    );
  }
  if (snap) {
    rows.push(row("Season role", snap.tier, small(`${snap.call === "Weekly starter" ? "Starter" : snap.call === "Streamer" ? "Streaming" : snap.call} tier`)));
  }
  if (lastGame) {
    rows.push(row("Last game", `${ctx.points(lastGame).toFixed(1)} FPTS${lastGame.pos_rank ? ` · ${ctx.pos}${lastGame.pos_rank}` : ""}`, small(`Week ${lastGame.week}`) + go(ctx.gameLogHref, "Game log", "news-sidebar-gamelog")));
  }
  if (form?.hasData) {
    const dir = form.formDirection;
    rows.push(row("Trend", `${dir === "up" ? "↑" : dir === "down" ? "↓" : "→"} ${form.formLabel}`, "", dir === "up" ? "good" : dir === "down" ? "bad" : ""));
  }
  const aside =
    `<aside class="scp-ox-aside" aria-label="Current outlook">` +
    `<div class="scp-ox-panel scp-nw-card"><h3>Current Outlook</h3>` +
    `<dl class="scp-nw-qa">${rows.join("")}</dl>` +
    `<a class="scp-ox-btn" href="${escapeHtml(rc)}" data-cta="redraft-command-news-sidebar">Open in Redraft Command <span aria-hidden="true">→</span></a>` +
    `</div></aside>`;

  return (
    `<section class="scp-ox-sec" aria-labelledby="scp-nw-feed-h"><div class="scp-ox-read"><div>` +
    // Same label language as "Latest update", no gold rule (mak, 2026-10-05).
    `<h2 class="scp-ox-h2 scp-nw-label" id="scp-nw-feed-h">${escapeHtml(titleCase("Season timeline"))}</h2>` +
    (ordered.length ? filters : "") +
    feed +
    `</div>${aside}</div></section>`
  );
}

/* --------------------------------------------------- section 3: teammates */

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
      ? `Updates on the players who catch ${ctx.last}'s passes.`
      : ctx.pos === "RB"
        ? `Updates on ${ctx.last}'s backfield partners and quarterback.`
        : `Updates on ${ctx.last}'s quarterback and target competition.`;
  const rows = items
    .map(({ item, mate }) => {
      const ts = itemTimestamp(item);
      const who = mate.slug ? `<a href="${escapeHtml(`${prefix}${mate.slug}/${q}`)}">${escapeHtml(mate.name)}</a>` : escapeHtml(mate.name);
      const via = (item.source ?? "").trim();
      return (
        `<li><span class="scp-nw-d">${ts ? stamp(ts, false) : ""}</span>` +
        `<div>${link(item.link ?? null, item.title, ` class="scp-nw-h"`, true)}` +
        `<span class="scp-nw-who">${who}${escapeHtml(`, ${mate.position}. ${mateContext(ctx.pos, mate)}${via ? `. Via ${via}` : ""}`)}</span></div>` +
        impactPill(mateImpact(ctx.pos, mate, item)) +
        `</li>`
      );
    })
    .join("");
  return open("scp-nw-mates-h", `${data.team.nickname} teammates news`, escapeHtml(lede)) + `<ul class="scp-nw-list">${rows}</ul></section>`;
}

/* -------------------------------------------------------- section 4: team */

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

function renderTeam(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = (data.teamNews ?? []).filter((i) => i.link).slice(0, TEAM_ITEMS);
  if (items.length === 0 || !data.team) return "";
  const proper = properNouns(loadPlayers(), data.team.code);
  const rows = items
    .map((item) => {
      const ts = itemTimestamp(item);
      const label = TEAM_LABEL[item.category ?? ""] ?? (item.category && item.category !== "other" ? categoryLabel(item.category) : "Team news");
      return (
        `<li><span class="scp-nw-d">${ts ? stamp(ts, false) : ""}</span>` +
        `<div>${link(item.link ?? null, sentenceCase(item.title, proper), ` class="scp-nw-h" data-cta="news-team-outbound"`, true)}` +
        `<span class="scp-nw-who">${escapeHtml(label)}</span></div><span></span></li>`
      );
    })
    .join("");
  const prefix = options.teamPathPrefix ?? "/team/";
  const more = `${prefix}${data.team.slug}/news/${options.linkQuery ?? ""}`;
  return (
    // No "Team reporting from …" lede (mak, 2026-10-02).
    open("scp-nw-team-h", `Around the ${data.team.nickname}`, "") +
    `<ul class="scp-nw-list">${rows}</ul>` +
    `<a class="scp-ox-more" href="${escapeHtml(more)}" target="_top">${escapeHtml(`All ${data.team.fullName} news`)}</a>` +
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
  const outlook = { href: `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/outlook/${options.linkQuery ?? ""}`, text: `See the updated fantasy outlook.` };
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
  if (depth) pool.push({ key: "role", q: `Has ${ctx.name}'s role changed?`, a: `The latest depth-chart news on ${ctx.last}: ${tell(depth)}` });
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
  const injuryHref = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/injury/${options.linkQuery ?? ""}`;

  const latest = renderLatest(data, ctx, lead, lead ? null : data.news?.[0] ?? null, injuryHref);
  const mates = renderMates(data, ctx, options);
  const team = renderTeam(data, options);
  if (!latest && !team && !mates) return null;

  // No sourcing/methodology footer (mak, 2026-10-02).
  const ink = teamInk(data.team);
  const faq = renderFaqSection("news", data, selectFaq(newsPool(data, ctx, items, lead, options)), options);
  const wrap = (html: string): string =>
    html ? `<div class="scp-ox scp-st scp-nw"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>` : "";
  return {
    // The panel heading's one-line dek (mak, 2026-10-05).
    body: wrap(`<p class="scp-nw-dek">Fantasy-relevant news, game recaps and role changes</p>` + latest + renderFeed(data, ctx, feedItems, pending, options, injuryHref) + mates + team),
    faq: wrap(faq),
  };
}

export function renderNewsTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const parts = renderNewsTabParts(data, options);
  return parts ? parts.body + parts.faq : "";
}
