/**
 * Markup for the NFL Team Hub.
 *
 * Server-only, unlike lib/render.ts — the team page ships complete HTML and the
 * client bundle only enhances what is already there (sticky-nav highlighting,
 * closing the team switcher, relabelling timestamps). Nothing on this page is
 * built in the browser, so nothing here has to be re-runnable there.
 *
 * Two rules run through every function below.
 *
 * 1. A field we do not have is not rendered. There is no "N/A", no "--", no
 *    zero standing in for a number nobody measured. Sections whose data failed
 *    to load are dropped entirely and the section navigation is built from what
 *    actually rendered, so the page is never a set of labelled holes.
 *
 * 2. The team is an accent, not a repaint. Every surface, border, heading and
 *    button is StatChasers navy/gold/white; the team's own colours appear as a
 *    faint aura behind the logo, a hairline above the hero, and the tint on a
 *    player card's photo well. A Patriots page has to read as StatChasers first.
 */

import {
  escapeHtml,
  itemTimestamp,
  safeUrl,
  searchKey,
  type NewsItem,
} from "./render";
import type { NflTeam } from "./team/teams";
import { TEAM_GROUPS } from "./team/teams";
import type { TeamPageData } from "./team/team-data";
import { TEAM_NEWS_VISIBLE } from "./team/team-data";
import { isOutDesignation, SKILL_POSITIONS, type DepthChartEntry } from "./team/roster";
import { upcomingGames, type ScheduleGame } from "./team/schedule";
import {
  getFPAUrl,
  getNewsUrl,
  getPlayerProfileUrl,
  getSOSUrl,
  getTeamDepthChartUrl,
  getTeamPlayersUrl,
  getTeamScheduleUrl,
} from "./team/links";

export interface TeamRenderOptions {
  /**
   * Embedded inside a statchasers.com page. Drops the standalone page's own
   * chrome and demotes the team name to an <h2>, because the host page supplies
   * the H1 — the same reasoning as `heading: false` on the news tool.
   */
  embed?: boolean;
  /** Where a team-switcher link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Carried onto switcher links so embed mode stays embed mode. */
  linkQuery?: string;
  /** Rendered for testability; the page cache keys on the data, not on this. */
  now?: number;
}

/* ------------------------------------------------------------------ atoms */

const ARROW = `<span class="sct-arrow" aria-hidden="true">&rarr;</span>`;

/** Attribute-safe style declaration list, or "". */
function styleAttr(parts: Array<string | null>): string {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

/**
 * A section heading with the compact gold rule beneath it.
 *
 * The rule is drawn by CSS on the element rather than being a separate node, so
 * it cannot be left behind by a heading that moves.
 */
function h2(text: string, extraClass = ""): string {
  return `<h2 class="sct-h2${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(text)}</h2>`;
}

/**
 * An external link into the main StatChasers site.
 *
 * `target="_top"` because these pages are read inside statchasers.com, and in
 * the legacy iframe mount a plain link would load the destination *inside the
 * frame* — a full site rendered in a 900px box. Breaking out is the correct
 * behaviour in the frame and a no-op when the markup is mounted directly.
 */
function siteLink(
  href: string | null,
  label: string,
  className: string,
  extra = "",
): string {
  if (!href) return "";
  return (
    `<a class="${className}" href="${escapeHtml(href)}" target="_top"${extra}>` +
    `${label}</a>`
  );
}

const MONTHS_UPPER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

interface DateParts {
  monthUpper: string;
  month: string;
  day: string;
  year: string;
  weekday: string;
  time: string;
}

/**
 * Date pieces in US Eastern — the league's own timezone, and the same one the
 * news cards already format in. Pinned rather than locale-derived so a cached
 * render is correct for every reader and identical on every request.
 */
function easternParts(ms: number): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const monthIndex = Number(get("month")) - 1;
  return {
    monthUpper: MONTHS_UPPER[monthIndex] ?? "",
    month: (MONTHS_UPPER[monthIndex] ?? "").charAt(0) + (MONTHS_UPPER[monthIndex] ?? "").slice(1).toLowerCase(),
    day: get("day"),
    year: get("year"),
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} ET`,
  };
}

/* ------------------------------------------------------------------- hero */

function heroFacts(data: TeamPageData): string {
  const facts: Array<{ label: string; value: string }> = [];

  facts.push({ label: "Division", value: data.team.division });

  // Withheld out of season — see team-data.ts. Present here only when it means
  // what the heading says it means.
  if (data.profile?.record) {
    facts.push({ label: "Record", value: data.profile.record });
  }
  if (data.profile?.standing) {
    facts.push({ label: "Standing", value: data.profile.standing });
  }
  if (data.profile?.headCoach) {
    facts.push({ label: "Head Coach", value: data.profile.headCoach });
  }
  if (data.schedule?.byeWeek) {
    facts.push({ label: "Bye", value: `Week ${data.schedule.byeWeek}` });
  }

  if (facts.length === 0) return "";

  return (
    `<ul class="sct-facts">` +
    facts
      .map(
        (fact) =>
          `<li class="sct-fact">` +
          `<span class="sct-fact-label">${escapeHtml(fact.label)}</span>` +
          `<span class="sct-fact-value">${escapeHtml(fact.value)}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function teamSwitcher(team: NflTeam, options: TeamRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  const groups = TEAM_GROUPS.map((conference) => {
    const divisions = conference.divisions
      .map((division) => {
        const links = division.teams
          .map((entry) => {
            const current = entry.abbreviation === team.abbreviation;
            return (
              `<li>` +
              `<a class="sct-switch-team${current ? " is-current" : ""}"` +
              ` href="${escapeHtml(`${prefix}${entry.slug}${query}`)}"` +
              (current ? ` aria-current="page"` : "") +
              `>` +
              // Decorative: the team's name is right beside it in text, so a
              // second announcement of "Bills logo, Bills" adds nothing.
              `<img class="sct-switch-logo" src="${escapeHtml(entry.logo)}" alt=""` +
              ` width="20" height="20" loading="lazy" decoding="async" />` +
              `<span>${escapeHtml(entry.nickname)}</span>` +
              `</a></li>`
            );
          })
          .join("");
        return (
          `<div class="sct-switch-div">` +
          `<p class="sct-switch-div-title">${escapeHtml(division.division)}</p>` +
          `<ul class="sct-switch-list">${links}</ul>` +
          `</div>`
        );
      })
      .join("");
    return (
      `<div class="sct-switch-conf">` +
      `<p class="sct-switch-conf-title">${escapeHtml(conference.conference)}</p>` +
      divisions +
      `</div>`
    );
  }).join("");

  // <details> rather than a scripted menu: it opens, closes, takes focus and
  // works on a phone with no JavaScript at all, and every destination is a real
  // <a href> — so the switcher is also 31 crawlable internal links rather than
  // a dead end. The client bundle only adds outside-click and Escape.
  return (
    `<details class="sct-switch" data-sct-switch>` +
    `<summary class="sct-switch-summary">` +
    // Lazy even though it is above the fold: a lazy image inside the viewport
    // is still fetched straight away, just at a lower priority than the hero
    // crest beside it. That ordering is the point — this is a 22px decoration
    // and the crest is the LCP candidate.
    `<img class="sct-switch-logo" src="${escapeHtml(team.logo)}" alt=""` +
    ` width="22" height="22" loading="lazy" decoding="async" />` +
    `<span class="sct-switch-name">${escapeHtml(team.fullName)}</span>` +
    `<span class="sct-switch-caret" aria-hidden="true"></span>` +
    `</summary>` +
    `<div class="sct-switch-panel">` +
    `<p class="sct-switch-heading">Change team</p>` +
    `<div class="sct-switch-grid">${groups}</div>` +
    `</div>` +
    `</details>`
  );
}

function renderHero(data: TeamPageData, options: TeamRenderOptions): string {
  const { team } = data;
  const headingTag = options.embed ? "h2" : "h1";

  const updated =
    data.newsUpdatedAtMs !== null
      ? (() => {
          const parts = easternParts(data.newsUpdatedAtMs);
          return (
            `<p class="sct-hero-updated">Latest report ` +
            `<time datetime="${escapeHtml(new Date(data.newsUpdatedAtMs).toISOString())}"` +
            ` data-ts="${data.newsUpdatedAtMs}">` +
            `${escapeHtml(`${parts.month} ${parts.day}, ${parts.time}`)}</time></p>`
          );
        })()
      : "";

  return (
    `<header class="sct-hero">` +
    // Two decorative layers: the team-coloured aura behind the crest and the
    // oversized crest itself at 4% opacity. Both aria-hidden, both painted from
    // custom properties set on the root element so there is one place a team's
    // colours enter the page.
    //
    // They are wrapped rather than being direct children of the hero because
    // the wrapper is what carries the clip. The hero itself used to, and an
    // `overflow: hidden` hero also clips the team switcher's dropdown — which
    // opens below its summary and was therefore being cut off. See
    // .sct-hero-decor in team.css.
    `<span class="sct-hero-decor" aria-hidden="true">` +
    `<span class="sct-hero-aura"></span>` +
    `<span class="sct-hero-watermark"></span>` +
    `</span>` +
    `<div class="sct-hero-inner">` +
    `<div class="sct-hero-crest">` +
    // The hero logo is the page's likeliest LCP element, so it loads eagerly and
    // at high priority. It is the only image on the page that does.
    `<img class="sct-hero-logo" src="${escapeHtml(team.logo)}"` +
    ` alt="${escapeHtml(`${team.fullName} logo`)}" width="88" height="88"` +
    ` fetchpriority="high" decoding="sync" />` +
    `</div>` +
    `<div class="sct-hero-text">` +
    `<p class="sct-eyebrow">${escapeHtml(`${team.division} · ${data.state.season} Season`)}</p>` +
    `<${headingTag} class="sct-title">${escapeHtml(team.fullName)}</${headingTag}>` +
    `<p class="sct-subtitle">${escapeHtml(`${team.fullName} fantasy football hub`)}</p>` +
    heroFacts(data) +
    updated +
    `</div>` +
    `<div class="sct-hero-actions">${teamSwitcher(team, options)}</div>` +
    `</div>` +
    `</header>`
  );
}

/* ------------------------------------------------------------- section nav */

interface Section {
  id: string;
  label: string;
  html: string;
}

function renderNav(sections: Section[]): string {
  if (sections.length < 2) return "";
  const items = sections
    .map(
      (section, i) =>
        `<li><a class="sct-nav-link${i === 0 ? " is-active" : ""}"` +
        ` href="#${escapeHtml(section.id)}">${escapeHtml(section.label)}</a></li>`,
    )
    .join("");
  return (
    `<nav class="sct-nav" aria-label="Team sections" data-sct-nav>` +
    `<ul class="sct-nav-list">${items}</ul>` +
    `</nav>`
  );
}

/* --------------------------------------------------------------- snapshot */

/**
 * Rank tiers. Deliberately three coarse buckets rather than a gradient: the
 * difference between 11th and 13th is noise, and shading it implies a precision
 * the number does not have.
 */
function rankTier(rank: number | null): "good" | "mid" | "poor" | "none" {
  if (rank === null) return "none";
  if (rank <= 8) return "good";
  if (rank >= 25) return "poor";
  return "mid";
}

const TIER_WORD: Record<string, string> = {
  good: "Top tier",
  mid: "Middle tier",
  poor: "Bottom tier",
};

function renderSnapshot(data: TeamPageData): string {
  const snapshot = data.snapshot;
  if (!snapshot || snapshot.metrics.length === 0) return "";

  const cards = snapshot.metrics
    .map((metric) => {
      const tier = rankTier(metric.rankValue);
      const rank = metric.rank
        ? // The tier is carried as a word as well as a colour — a reader who
          // cannot distinguish the tints still gets the judgement.
          `<p class="sct-metric-rank" data-tier="${tier}">` +
          `<span class="sct-metric-rank-value">${escapeHtml(metric.rank)}</span>` +
          `<span class="sct-metric-rank-label"> in NFL</span>` +
          (tier !== "none"
            ? `<span class="sct-visually-hidden"> — ${escapeHtml(TIER_WORD[tier] ?? "")}</span>`
            : "") +
          `</p>`
        : "";
      return (
        `<li class="sct-metric">` +
        `<p class="sct-metric-label">${escapeHtml(metric.label)}` +
        `<span class="sct-visually-hidden"> (${escapeHtml(metric.description)})</span></p>` +
        `<p class="sct-metric-value">${escapeHtml(metric.value)}</p>` +
        rank +
        `</li>`
      );
    })
    .join("");

  const seasonNote = data.state.statsSeasonIsPrior
    ? `<p class="sct-note">${escapeHtml(`${snapshot.season} regular season — the ${data.state.season} season has not kicked off yet.`)}</p>`
    : `<p class="sct-note">${escapeHtml(`${snapshot.season} regular season to date.`)}</p>`;

  return (
    `<div class="sct-block">` +
    h2("Team Snapshot") +
    seasonNote +
    `<ul class="sct-metrics">${cards}</ul>` +
    `</div>`
  );
}

/* ----------------------------------------------------- fantasy cornerstones */

function injuryBadge(player: DepthChartEntry): string {
  if (!player.injuryStatus) return "";
  const out = isOutDesignation(player.injuryStatus);
  const label = player.injuryBodyPart
    ? `${player.injuryStatus} · ${player.injuryBodyPart}`
    : player.injuryStatus;
  return (
    `<span class="sct-injury-badge" data-severity="${out ? "out" : "questionable"}">` +
    `${escapeHtml(label)}</span>`
  );
}

/**
 * A player name, linked to their StatChasers profile when one is configured.
 *
 * Unlinked by default and on purpose: this server cannot tell whether a profile
 * exists for a given player, and a page of names pointing at 404s is worse than
 * a page of names. Set SC_PLAYER_PROFILE_URL_TEMPLATE and every name here
 * becomes a link — see lib/team/links.ts.
 */
function playerName(name: string, className: string): string {
  const href = getPlayerProfileUrl(name);
  if (!href) return `<span class="${className}">${escapeHtml(name)}</span>`;
  return (
    `<a class="${className} sct-player-link" href="${escapeHtml(href)}" target="_top">` +
    `${escapeHtml(name)}</a>`
  );
}

function renderCornerstones(data: TeamPageData): string {
  if (data.cornerstones.length === 0) return "";

  const cards = data.cornerstones
    .map((player) => {
      const href = getPlayerProfileUrl(player.name);
      const cta = href
        ? `<span class="sct-player-cta">View player ${ARROW}</span>`
        : "";
      return (
        `<li class="sct-player">` +
        (href
          ? `<a class="sct-player-hit" href="${escapeHtml(href)}" target="_top"` +
            ` aria-label="${escapeHtml(`${player.name}, ${player.slot}`)}"></a>`
          : "") +
        `<div class="sct-player-well">` +
        `<img class="sct-player-photo" src="${escapeHtml(player.headshot)}"` +
        ` alt="${escapeHtml(player.name)}" width="150" height="150"` +
        ` loading="lazy" decoding="async" />` +
        `</div>` +
        `<div class="sct-player-body">` +
        `<span class="sct-slot">${escapeHtml(player.slot)}</span>` +
        `<p class="sct-player-name">${escapeHtml(player.name)}</p>` +
        injuryBadge(player) +
        cta +
        `</div>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<div class="sct-block">` +
    h2("Fantasy Cornerstones") +
    `<p class="sct-note">Depth-chart starters at the four fantasy positions.</p>` +
    `<ul class="sct-players">${cards}</ul>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------- news */

/**
 * The headline with the leading player name removed.
 *
 * The feed writes titles as "TreVeyon Henderson: Dealing with ankle injury",
 * and this card prints the player's name on its own line directly beneath. Left
 * alone the name would appear twice on every card. Only stripped when the title
 * really does start with the stored player name, so a title in any other shape
 * is passed through untouched.
 */
export function splitHeadline(item: NewsItem): string {
  const title = item.title.trim();
  const name = (item.playerName ?? "").trim();
  if (!name) return title;
  const separator = title.indexOf(":");
  if (separator <= 0) return title;
  if (searchKey(title.slice(0, separator)) !== searchKey(name)) return title;
  const rest = title.slice(separator + 1).trim();
  return rest || title;
}

function newsStamp(item: NewsItem): string {
  const ts = itemTimestamp(item);
  if (ts === null) return `<span class="sct-news-kicker">Player News</span>`;
  const parts = easternParts(ts);
  return (
    `<p class="sct-news-meta">` +
    `<span class="sct-news-kicker">Player News</span>` +
    `<span class="sct-dot" aria-hidden="true"></span>` +
    `<time datetime="${escapeHtml(new Date(ts).toISOString())}" data-ts="${ts}">` +
    `${escapeHtml(`${parts.monthUpper} ${parts.day}`)}` +
    `<span class="sct-news-time"> · ${escapeHtml(parts.time)}</span>` +
    `</time></p>`
  );
}

function renderNewsCard(
  item: NewsItem,
  team: NflTeam,
  featured: boolean,
): string {
  const link = safeUrl(item.link);
  const image = safeUrl(item.image);
  const name = (item.playerName ?? "").trim();
  const headline = escapeHtml(splitHeadline(item));

  const media = image
    ? `<img class="sct-news-photo" src="${escapeHtml(image)}" alt="${escapeHtml(name)}"` +
      ` width="${featured ? 128 : 84}" height="${featured ? 128 : 84}"` +
      ` loading="lazy" decoding="async" />`
    : // No headshot: the well keeps its team tint and shows nothing else. A
      // stand-in mark would be one more thing to load for no information.
      `<span class="sct-news-photo-empty" aria-hidden="true"></span>`;

  const byline =
    name || team.fullName
      ? `<p class="sct-news-byline">` +
        (name ? playerName(name, "sct-news-player") : "") +
        `<span class="sct-news-team">${escapeHtml(team.fullName)}</span>` +
        `</p>`
      : "";

  // Only rendered when the archive actually holds a synopsis for this row. The
  // column is empty for most items today, and writing analysis here to fill the
  // space would be inventing a StatChasers opinion nobody at StatChasers had.
  const impact = item.summary?.trim()
    ? `<div class="sct-impact">` +
      `<p class="sct-impact-label">Fantasy Impact</p>` +
      `<p class="sct-impact-text">${escapeHtml(item.summary.trim())}</p>` +
      `</div>`
    : "";

  const heading = link
    ? `<h3 class="sct-news-title"><a class="sct-news-link" href="${escapeHtml(link)}"` +
      ` target="_blank" rel="noopener noreferrer">${headline}</a></h3>`
    : `<h3 class="sct-news-title">${headline}</h3>`;

  return (
    `<article class="sct-news${featured ? " is-featured" : ""}">` +
    `<div class="sct-news-well">${media}</div>` +
    `<div class="sct-news-body">` +
    newsStamp(item) +
    heading +
    byline +
    impact +
    (link
      ? `<p class="sct-news-cta"><span class="sct-news-more">Read report ${ARROW}</span></p>`
      : "") +
    `</div>` +
    `</article>`
  );
}

function renderNewsList(
  items: NewsItem[],
  team: NflTeam,
  startIndex: number,
): string {
  if (items.length === 0) return "";
  return (
    `<ol class="sct-news-list" start="${startIndex + 1}">` +
    items
      .map(
        (item, i) =>
          `<li class="sct-news-item">` +
          renderNewsCard(item, team, startIndex === 0 && i === 0) +
          `</li>`,
      )
      .join("") +
    `</ol>`
  );
}

function renderNewsColumn(data: TeamPageData): string {
  const { team, news } = data;

  if (news.length === 0) {
    return (
      h2(`Latest ${team.nickname} News`) +
      `<div class="sct-empty">` +
      `<p class="sct-empty-title">${escapeHtml(`No recent ${team.nickname} updates.`)}</p>` +
      `<p class="sct-empty-body">We'll surface new reports here as they arrive.</p>` +
      `</div>`
    );
  }

  const visible = news.slice(0, TEAM_NEWS_VISIBLE);
  const rest = news.slice(TEAM_NEWS_VISIBLE);

  // The remainder is a <details>, not a fetch: every story is already in this
  // response, so "view more" is a disclosure rather than a request. It also
  // means a reader with no JavaScript can still open it.
  const more = rest.length
    ? `<details class="sct-more">` +
      `<summary class="sct-more-summary">` +
      `<span>${escapeHtml(`View ${rest.length} more ${team.nickname} ${rest.length === 1 ? "story" : "stories"}`)}</span>` +
      `</summary>` +
      renderNewsList(rest, team, TEAM_NEWS_VISIBLE) +
      `</details>`
    : "";

  const allNews = getNewsUrl();
  const footer = allNews
    ? `<p class="sct-block-footer">` +
      siteLink(allNews, `All NFL player news ${ARROW}`, "sct-textlink") +
      `</p>`
    : "";

  return (
    h2(`Latest ${team.nickname} News`) +
    renderNewsList(visible, team, 0) +
    more +
    footer
  );
}

/* ---------------------------------------------------------- injury watch */

function renderInjuryPanel(data: TeamPageData): string {
  const rows = data.injuries;
  const stamp = data.rosterFetchedAt
    ? (() => {
        const parts = easternParts(data.rosterFetchedAt);
        return (
          `<p class="sct-panel-stamp">Checked ` +
          `<time datetime="${escapeHtml(new Date(data.rosterFetchedAt).toISOString())}"` +
          ` data-ts="${data.rosterFetchedAt}">` +
          `${escapeHtml(`${parts.month} ${parts.day}, ${parts.time}`)}</time></p>`
        );
      })()
    : "";

  // No roster snapshot at all: say nothing rather than claim a clean bill of
  // health we have not checked.
  if (!data.roster) return "";

  const body = rows.length
    ? `<ul class="sct-injuries">` +
      rows
        .map(
          (player) =>
            `<li class="sct-injury">` +
            `<span class="sct-slot is-small">${escapeHtml(player.slot)}</span>` +
            `<span class="sct-injury-name">${escapeHtml(player.name)}</span>` +
            `<span class="sct-injury-status" data-severity="${isOutDesignation(player.injuryStatus) ? "out" : "questionable"}">` +
            `${escapeHtml(player.injuryStatus ?? "")}</span>` +
            (player.injuryBodyPart
              ? `<span class="sct-injury-part">${escapeHtml(player.injuryBodyPart)}</span>`
              : "") +
            (player.practice
              ? `<span class="sct-injury-practice">${escapeHtml(player.practice)}</span>`
              : "") +
            `</li>`,
        )
        .join("") +
      `</ul>`
    : `<p class="sct-panel-empty">${escapeHtml(`No ${data.team.nickname} skill-position players carry an injury designation right now.`)}</p>`;

  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Injury Watch</h2>` +
    body +
    stamp +
    `</section>`
  );
}

/* ------------------------------------------------------------- next game */

function gameDateLine(game: ScheduleGame): { date: string; time: string } {
  if (game.kickoffMs === null) return { date: "Date TBD", time: "" };
  const parts = easternParts(game.kickoffMs);
  return {
    date: `${parts.weekday}, ${parts.month} ${parts.day}`,
    time: game.timeConfirmed ? parts.time : "Time TBD",
  };
}

function renderNextGamePanel(data: TeamPageData, now: number): string {
  const next = upcomingGames(data.schedule, now, 1)[0];
  if (!next) return "";
  const when = gameDateLine(next);
  const opponentLogo = next.opponent
    ? `<img class="sct-nextgame-logo" src="${escapeHtml(next.opponent.logo)}" alt=""` +
      ` width="34" height="34" loading="lazy" decoding="async" />`
    : "";

  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Next Game</h2>` +
    `<p class="sct-nextgame-week">${escapeHtml(`Week ${next.week}`)}</p>` +
    `<p class="sct-nextgame-line">` +
    `<span class="sct-homeaway">${next.homeAway === "home" ? "vs" : "at"}</span>` +
    opponentLogo +
    `<span class="sct-nextgame-opp">${escapeHtml(next.opponent?.nickname ?? next.opponentName)}</span>` +
    `</p>` +
    `<p class="sct-nextgame-when">${escapeHtml(when.date)}` +
    (when.time ? `<span class="sct-nextgame-time"> · ${escapeHtml(when.time)}</span>` : "") +
    `</p>` +
    (next.venue ? `<p class="sct-nextgame-venue">${escapeHtml(next.venue)}</p>` : "") +
    `</section>`
  );
}

/* ------------------------------------------------------------ quick links */

interface ResourceCard {
  title: string;
  body: string;
  href: string;
}

function resourceCards(team: NflTeam): ResourceCard[] {
  const candidates: Array<[string | null, string, string]> = [
    [
      getTeamDepthChartUrl(team),
      `${team.nickname} Depth Chart`,
      "Starters, backups and the roster battles that decide touches.",
    ],
    [
      getTeamPlayersUrl(team),
      `${team.nickname} Player Profiles`,
      `Research every ${team.city} fantasy asset in one place.`,
    ],
    [
      getTeamScheduleUrl(team),
      `${team.nickname} Schedule`,
      "Every regular-season matchup, week by week.",
    ],
    [
      getSOSUrl(team),
      "Strength of Schedule",
      "Matchup difficulty by fantasy position, including the playoff weeks.",
    ],
    [
      getFPAUrl(team),
      "Fantasy Points Allowed",
      `How ${team.city}'s defense performs against QB, RB, WR and TE.`,
    ],
  ];
  return candidates
    .filter((entry): entry is [string, string, string] => !!entry[0])
    .map(([href, title, body]) => ({ href, title, body }));
}

function renderQuickLinksPanel(team: NflTeam): string {
  const cards = resourceCards(team).slice(0, 4);
  if (cards.length === 0) return "";
  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Quick Links</h2>` +
    `<ul class="sct-quicklinks">` +
    cards
      .map(
        (card) =>
          `<li>` +
          siteLink(card.href, `${escapeHtml(card.title)} ${ARROW}`, "sct-quicklink") +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ depth chart */

function renderDepthChart(data: TeamPageData): string {
  const { team, depthChart } = data;
  const groups = SKILL_POSITIONS.filter(
    (position) => depthChart[position].length > 0,
  );
  if (groups.length === 0) return "";

  const columns = groups
    .map((position) => {
      const rows = depthChart[position]
        .map(
          (player) =>
            `<li class="sct-depth-row">` +
            `<span class="sct-slot is-small">${escapeHtml(player.slot)}</span>` +
            playerName(player.name, "sct-depth-name") +
            injuryBadge(player) +
            `</li>`,
        )
        .join("");
      return (
        `<div class="sct-depth-col">` +
        `<h3 class="sct-depth-pos">${escapeHtml(position)}</h3>` +
        `<ol class="sct-depth-list">${rows}</ol>` +
        `</div>`
      );
    })
    .join("");

  const full = getTeamDepthChartUrl(team);

  return (
    h2(`${team.nickname} Fantasy Depth Chart`) +
    `<p class="sct-note">Offensive skill positions only. Order as listed on the team's depth chart.</p>` +
    `<div class="sct-depth">${columns}</div>` +
    (full
      ? `<p class="sct-block-footer">` +
        siteLink(full, `View the full ${escapeHtml(team.nickname)} depth chart ${ARROW}`, "sct-button") +
        `</p>`
      : "")
  );
}

/* --------------------------------------------------------------- schedule */

function gameBadges(game: ScheduleGame): string {
  const badges: string[] = [];
  badges.push(
    `<span class="sct-badge" data-kind="${game.homeAway}">` +
      `${game.homeAway === "home" ? "Home" : "Away"}</span>`,
  );
  if (game.divisional) {
    badges.push(`<span class="sct-badge" data-kind="division">Division</span>`);
  }
  if (game.international) {
    badges.push(`<span class="sct-badge" data-kind="intl">International</span>`);
  }
  if (game.neutralSite && !game.international) {
    badges.push(`<span class="sct-badge" data-kind="neutral">Neutral site</span>`);
  }
  return `<p class="sct-badges">${badges.join("")}</p>`;
}

function renderUpcomingCard(game: ScheduleGame): string {
  const when = gameDateLine(game);
  const logo = game.opponent
    ? `<img class="sct-game-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
      ` width="44" height="44" loading="lazy" decoding="async" />`
    : "";
  return (
    `<li class="sct-game">` +
    `<p class="sct-game-week">${escapeHtml(`Week ${game.week}`)}</p>` +
    `<div class="sct-game-matchup">` +
    `<span class="sct-homeaway">${game.homeAway === "home" ? "vs" : "at"}</span>` +
    logo +
    `<span class="sct-game-opp">${escapeHtml(game.opponent?.nickname ?? game.opponentName)}</span>` +
    `</div>` +
    `<p class="sct-game-when">${escapeHtml(when.date)}` +
    (when.time ? `<span class="sct-game-time"> · ${escapeHtml(when.time)}</span>` : "") +
    `</p>` +
    (game.venue ? `<p class="sct-game-venue">${escapeHtml(game.venue)}</p>` : "") +
    (game.network ? `<p class="sct-game-network">${escapeHtml(game.network)}</p>` : "") +
    gameBadges(game) +
    `</li>`
  );
}

/**
 * The full season as rows, with the bye slotted into its own week.
 *
 * Inserting the bye is what turns a list of 17 fixtures into a calendar a
 * fantasy manager can read — the week their roster loses a starter is the one
 * week that is not in the fixture list at all.
 */
function renderFullSchedule(data: TeamPageData): string {
  const schedule = data.schedule;
  if (!schedule) return "";

  interface Row {
    week: number;
    html: string;
  }
  const rows: Row[] = schedule.games.map((game) => {
    const when = gameDateLine(game);
    const result = game.result
      ? `<span class="sct-result" data-outcome="${game.result.outcome}">` +
        `${escapeHtml(`${game.result.outcome} ${game.result.teamScore}-${game.result.opponentScore}`)}</span>`
      : "";
    return {
      week: game.week,
      html:
        `<li class="sct-srow">` +
        `<span class="sct-srow-week">${escapeHtml(`WK ${game.week}`)}</span>` +
        `<span class="sct-srow-opp">` +
        `<span class="sct-homeaway">${game.homeAway === "home" ? "vs" : "at"}</span>` +
        (game.opponent
          ? `<img class="sct-srow-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
            ` width="22" height="22" loading="lazy" decoding="async" />`
          : "") +
        `<span>${escapeHtml(game.opponent?.nickname ?? game.opponentName)}</span>` +
        (game.divisional ? `<span class="sct-badge is-tiny" data-kind="division">DIV</span>` : "") +
        (game.international ? `<span class="sct-badge is-tiny" data-kind="intl">INTL</span>` : "") +
        `</span>` +
        `<span class="sct-srow-when">${escapeHtml(when.date)}${when.time ? ` · ${escapeHtml(when.time)}` : ""}</span>` +
        `<span class="sct-srow-venue">${escapeHtml(game.venue ?? "")}</span>` +
        result +
        `</li>`,
    };
  });

  if (schedule.byeWeek) {
    rows.push({
      week: schedule.byeWeek,
      html:
        `<li class="sct-srow is-bye">` +
        `<span class="sct-srow-week">${escapeHtml(`WK ${schedule.byeWeek}`)}</span>` +
        `<span class="sct-srow-opp"><span class="sct-srow-bye">Bye week</span></span>` +
        `<span class="sct-srow-when"></span><span class="sct-srow-venue"></span>` +
        `</li>`,
    });
  }

  rows.sort((a, b) => a.week - b.week);

  return (
    `<details class="sct-more">` +
    `<summary class="sct-more-summary">` +
    `<span>${escapeHtml(`View the full ${schedule.season} schedule`)}</span>` +
    `</summary>` +
    `<ol class="sct-slist">${rows.map((row) => row.html).join("")}</ol>` +
    `</details>`
  );
}

function renderSchedule(data: TeamPageData, now: number): string {
  const { team, schedule } = data;

  if (!schedule) {
    return (
      h2(`${data.state.season} ${team.nickname} Schedule`) +
      `<div class="sct-empty">` +
      `<p class="sct-empty-title">Schedule information is temporarily unavailable.</p>` +
      `<p class="sct-empty-body">It will reappear here as soon as the fixture data loads.</p>` +
      `</div>`
    );
  }

  const next = upcomingGames(schedule, now, 3);
  const full = getTeamScheduleUrl(team);

  return (
    h2(`${schedule.season} ${team.nickname} Schedule`) +
    (schedule.byeWeek
      ? `<p class="sct-note">${escapeHtml(`Bye in Week ${schedule.byeWeek}.`)}</p>`
      : "") +
    (next.length
      ? `<ul class="sct-games">${next.map(renderUpcomingCard).join("")}</ul>`
      : "") +
    renderFullSchedule(data) +
    (full
      ? `<p class="sct-block-footer">` +
        siteLink(full, `${escapeHtml(team.nickname)} schedule on StatChasers ${ARROW}`, "sct-textlink") +
        `</p>`
      : "")
  );
}

/* -------------------------------------------------- fantasy schedule outlook */

/**
 * Strength of Schedule.
 *
 * This app has no SOS dataset — that intelligence lives in the StatChasers tool
 * and there is no connection to it from here yet. Rather than print a table of
 * plausible-looking ranks, the section is an honest handoff to the tool that
 * actually knows. When the data can be reached, the table replaces this block
 * and the section keeps its heading, id and place in the navigation.
 */
function renderFantasyOutlook(team: NflTeam): string {
  const sos = getSOSUrl(team);
  const fpa = getFPAUrl(team);
  if (!sos && !fpa) return "";

  return (
    h2("Fantasy Schedule Outlook") +
    `<div class="sct-cta">` +
    `<div class="sct-cta-text">` +
    `<p class="sct-cta-title">${escapeHtml(`Analyze ${team.city}'s fantasy schedule`)}</p>` +
    `<p class="sct-cta-body">Position-by-position matchup difficulty, rest-of-season ` +
    `rankings and fantasy playoff schedules — QB, RB, WR and TE.</p>` +
    `</div>` +
    `<div class="sct-cta-actions">` +
    siteLink(sos, `Strength of Schedule ${ARROW}`, "sct-button") +
    siteLink(fpa, `Fantasy Points Allowed ${ARROW}`, "sct-button is-ghost") +
    `</div>` +
    `</div>`
  );
}

/* -------------------------------------------------------------- resources */

function renderResources(team: NflTeam): string {
  const cards = resourceCards(team);
  if (cards.length === 0) return "";
  return (
    `<section class="sct-section" id="resources">` +
    h2(`More ${team.nickname} Tools`) +
    `<ul class="sct-resources">` +
    cards
      .map(
        (card) =>
          `<li class="sct-resource">` +
          `<a class="sct-resource-link" href="${escapeHtml(card.href)}" target="_top">` +
          `<span class="sct-resource-title">${escapeHtml(card.title)}</span>` +
          `<span class="sct-resource-body">${escapeHtml(card.body)}</span>` +
          `<span class="sct-resource-cta">Open ${ARROW}</span>` +
          `</a></li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------- page */

/**
 * The complete team hub as one fragment.
 *
 * This is what both mounts receive: the standalone page drops it into its shell
 * and the WordPress mount prints it straight into the page body, exactly as the
 * news tool's fragment already works.
 */
export function renderTeamPage(
  data: TeamPageData,
  options: TeamRenderOptions = {},
): string {
  const { team } = data;
  const now = options.now ?? Date.now();

  const overview = renderSnapshot(data) + renderCornerstones(data);

  const sidebar =
    renderInjuryPanel(data) +
    renderNextGamePanel(data, now) +
    renderQuickLinksPanel(team);

  // A team with almost no archived news leaves a one-card column beside a
  // three-panel rail, which is several hundred pixels of dead space rather than
  // a layout. Below three stories the rail moves underneath and spreads out.
  // The archive is genuinely thin for some teams, so this is the normal case
  // for them, not an edge case.
  const stacked = data.news.length < 3;

  const newsSection =
    `<div class="sct-news-grid${stacked ? " is-stacked" : ""}">` +
    `<div class="sct-news-main">${renderNewsColumn(data)}</div>` +
    (sidebar ? `<aside class="sct-sidebar">${sidebar}</aside>` : "") +
    `</div>`;

  const depth = renderDepthChart(data);
  const schedule = renderSchedule(data, now);
  const fantasy = renderFantasyOutlook(team);

  // Built from what actually rendered: a section that produced no markup is not
  // in the page and must not be in the navigation pointing at nothing.
  const sections: Section[] = [
    { id: "overview", label: "Overview", html: overview },
    { id: "news", label: "News", html: newsSection },
    { id: "depth-chart", label: "Depth Chart", html: depth },
    { id: "schedule", label: "Schedule", html: schedule },
    { id: "fantasy", label: "Fantasy", html: fantasy },
  ].filter((section) => section.html !== "");

  const body = sections
    .map(
      (section) =>
        `<section class="sct-section" id="${escapeHtml(section.id)}"` +
        ` aria-label="${escapeHtml(section.label)}">${section.html}</section>`,
    )
    .join("");

  // One place a team's colours enter the page. Everything team-tinted below
  // reads these custom properties, so there is no per-team CSS and no component
  // that has to know which team it is drawing.
  const rootStyle = styleAttr([
    `--team-primary:${team.primaryColor}`,
    `--team-secondary:${team.secondaryColor}`,
    `--team-logo:url('${team.logo}')`,
  ]);

  return (
    `<div class="sct${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-team="${escapeHtml(team.abbreviation)}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"${rootStyle}>` +
    renderHero(data, options) +
    renderNav(sections) +
    body +
    renderResources(team) +
    `</div>`
  );
}

/* -------------------------------------------------------------- team index */

/**
 * A plain index of all 32 hubs at /team.
 *
 * Its job is navigation and verification, not presentation: it is how you check
 * that every team resolves, and it gives the 404 page somewhere useful to send
 * a reader. A full document rather than a fragment, because nothing embeds it.
 */
export function renderTeamIndex(
  teams: readonly NflTeam[],
  options: { linkQuery?: string; teamPathPrefix?: string } = {},
): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  const groups = TEAM_GROUPS.map((conference) => {
    const divisions = conference.divisions
      .map((division) => {
        const links = division.teams
          .filter((team) => teams.some((t) => t.abbreviation === team.abbreviation))
          .map(
            (team) =>
              `<li><a class="sct-switch-team" href="${escapeHtml(`${prefix}${team.slug}${query}`)}">` +
              `<img class="sct-switch-logo" src="${escapeHtml(team.logo)}" alt=""` +
              ` width="22" height="22" loading="lazy" decoding="async" />` +
              `<span>${escapeHtml(team.fullName)}</span></a></li>`,
          )
          .join("");
        return (
          `<div class="sct-switch-div">` +
          `<p class="sct-switch-div-title">${escapeHtml(division.division)}</p>` +
          `<ul class="sct-switch-list">${links}</ul>` +
          `</div>`
        );
      })
      .join("");
    return (
      `<section class="sct-switch-conf">` +
      `<h2 class="sct-switch-conf-title">${escapeHtml(conference.conference)}</h2>` +
      divisions +
      `</section>`
    );
  }).join("");

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>NFL Team Hubs | StatChasers</title>` +
    `<meta name="robots" content="noindex, indexifembedded" />` +
    `<link rel="stylesheet" href="/team.css" />` +
    `</head><body class="sct-page"><div class="sct">` +
    `<header class="sct-hero"><span class="sct-hero-decor" aria-hidden="true"></span>` +
    `<div class="sct-hero-inner"><div class="sct-hero-text">` +
    `<p class="sct-eyebrow">StatChasers</p>` +
    `<h1 class="sct-title">NFL Team Hubs</h1>` +
    `<p class="sct-subtitle">News, depth charts, schedules and fantasy outlook for all 32 teams.</p>` +
    `</div></div></header>` +
    `<div class="sct-section"><div class="sct-switch-grid is-index">${groups}</div></div>` +
    `</div></body></html>`
  );
}
