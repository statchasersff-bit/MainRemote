/**
 * Markup for the NFL Team Hub.
 *
 * Server-only, unlike lib/render.ts - the team page ships complete HTML and the
 * client bundle only enhances what is already there (sticky-nav highlighting,
 * closing the team switcher, relabeling timestamps). Nothing on this page is
 * built in the browser, so nothing here has to be re-runnable there.
 *
 * Two rules run through every function below.
 *
 * 1. A field we do not have is not rendered. There is no "N/A", no "--", no
 *    zero standing in for a number nobody measured. Sections whose data failed
 *    to load are dropped entirely and the section navigation is built from what
 *    actually rendered, so the page is never a set of labeled holes.
 *
 * 2. The team is an accent, not a repaint. Every surface, border, heading and
 *    button is StatChasers navy/gold/white; the team's own colors appear as a
 *    faint aura behind the logo, a hairline above the hero, and the tint on a
 *    player card's photo well. A Patriots page has to read as StatChasers first.
 */

import {
  escapeHtml,
  escapeJsonLd,
  itemTimestamp,
  safeUrl,
  searchKey,
  type NewsItem,
} from "./render";
import {
  easternParts,
  newsStamp as sharedNewsStamp,
  splitHeadline,
} from "./news-card";
import type { NflTeam } from "./team/teams";
import { TEAM_GROUPS } from "./team/teams";
import {
  leagueHasPlayed,
  type LeagueStandings,
  type StandingsLine,
} from "./team/profile";
import { markFrame, networkMarkFor } from "./team/network-marks";
import {
  getTeamOutlook,
  type OutlookFact,
  type OutlookGroup,
  type OutlookPlayer,
} from "./team/outlook";
import { outlookFaq, type OutlookFaq } from "./team/outlook-faq";
import { getTeamCoaching } from "./team/coaching";
import { coachingCaveat, renderCoachingSection } from "./team/coaching-render";
import { getDraftView } from "./team/draft";
import { renderDraftSection } from "./team/draft-render";
import { getContractsView } from "./team/contracts";
import { renderContractsSection } from "./team/contracts-render";
import { contractsFaq } from "./team/contracts-faq";
import { draftFaq } from "./team/draft-faq";
import { faqEntries, renderFaqBlock } from "./team/faq-block";
import { buildUsageView, getUsageDoc, pprPositionRanks, type PprRanks } from "./team/usage";
import { efficiencyRows, getEfficiencyDoc, passRushRows, type EfficiencyMetric } from "./team/efficiency";
import { renderUsageSection } from "./team/usage-render";
import { renderTeamHeader } from "./team/team-header";
import { renderPremiumTeamHeader } from "./team/team-header-premium";
import { statsFaq } from "./team/stats-faq";
import { depthFaq, type FaqEntry, type FaqSlot } from "./team/depth-faq";
import {
  nameKey,
  type DepthColumn,
  type DepthRow,
  type DepthView,
  type FootballSide,
  type FootballSlot,
  type TeamDepthCharts,
} from "./team/depth-charts";
import { scheduleFaq } from "./team/schedule-faq";
import { seasonShape } from "./team/season-shape";
// The tab strip's headings and standfirsts come from the same two functions the
// WordPress side mirrors, so the heading a click swaps in and the heading that
// URL loads with are generated from one place. team-seo.ts imports nothing from
// here, so this does not close a cycle.
import { teamPageMeta } from "./team-seo";
import type { TeamPageData } from "./team/team-data";
import type {
  HistorySeason,
  PlayBalance,
  StatRow,
  TeamStats,
} from "./team/stats";
import { ordinal } from "./team/stats";
import { TEAM_NEWS_VISIBLE } from "./team/team-data";
import { headshotImg } from "./headshot-html";
import { CLUB_BAND_VARIANTS } from "./image-urls";
import {
  isOutDesignation,
  nameKeysForTeam,
  playerForSearchKey,
  SKILL_POSITIONS,
  type DepthChartEntry,
  type SkillPosition,
  type RosterPlayer,
} from "./team/roster";
import {
  isOnDate,
  lastResult,
  nextGame,
  recordThrough,
  siteCounts,
  splitSchedule,
  upcomingGames,
  type ScheduleGame,
  type TeamSchedule,
} from "./team/schedule";
import { easternDate } from "./schedule/schedule-data";
import { scheduleItemList } from "./team/schedule-schema";
import {
  canonicalizeMatchupPair,
  gameSegment,
  isUpcomingFixture,
  meetingHasOwnAddress,
} from "./matchup/pair";
import {
  DYNASTY_COMMAND_URL,
  RB_HANDCUFF_RANKINGS_URL,
  REDRAFT_COMMAND_URL,
  ROS_RANKINGS_URL,
  START_SIT_URL,
  TRADE_CALCULATOR_URL,
} from "./matchup/recap";
import {
  getFPAUrl,
  getPlayerProfileUrl,
  getSOSUrl,
  getPlayerStatsUrl,
  getTeamScheduleUrl,
  getToolsUrl,
} from "./team/links";

export interface TeamRenderOptions {
  /**
   * Embedded inside a statchasers.com page. Drops the standalone page's own
   * chrome and demotes the team name to an <h2>, because the host page supplies
   * the H1 - the same reasoning as `heading: false` on the news tool.
   */
  embed?: boolean;
  /** Where a team-switcher link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Carried onto switcher links so embed mode stays embed mode. */
  linkQuery?: string;
  /** Rendered for testability; the page cache keys on the data, not on this. */
  now?: number;
  /**
   * Render ONE section as the whole page, for a section-scoped URL.
   *
   * `/nfl/teams/<slug>/schedule/` has to be a different page from the team's
   * hub or it is duplicate content wearing a second address: five tabs of
   * identical markup at every URL, competing with each other. So a section page
   * is the hero, that section, and a way back to the rest - and its heading is
   * the phrase the page is actually about.
   *
   * Ignored when the id does not match a section that rendered, which keeps a
   * stale link serving the hub rather than a 404. Same contract as
   * PlayerRenderOptions.section; the two pages are addressed the same way.
   */
  section?: string;
  /**
   * The host has stood down: this fragment supplies the page's <h1>.
   *
   * Set by the WordPress plugin's "the tool supplies the heading" mode. See
   * promoteHeading(), and the twin option in player-render.ts.
   */
  ownHeading?: boolean;
  /** Where matchup pages live. Defaults to this app's own /nfl/. */
  matchupPathPrefix?: string;
}

/**
 * The sections with a public URL of their own, in the order they are linked.
 *
 * `news` is deliberately absent: a team whose archive is two stories is a thin
 * page, so it stays a tab on the hub until the data can carry an address. The
 * WordPress rewrite mirrors this list as STATCHASERS_TEAM_SECTIONS.
 */
export const PUBLIC_SECTIONS = [
  "outlook",
  "usage",
  "coaching",
  "stats",
  "schedule",
  "depth-chart",
  "matchups",
  "news",
] as const;

/**
 * The section the hub itself is.
 *
 * The hub opens on the Outlook, so `/<slug>/` and `/<slug>/outlook/` were one
 * page answering at two self-canonical addresses. The hub keeps it:
 * `/outlook/` is a 301 to the hub, and the Outlook tab links there. It stays in
 * PUBLIC_SECTIONS so the old address redirects instead of 404ing - it is
 * indexed. The twin of PROFILE_SECTION in routes/player.ts.
 */
export const HUB_SECTION = "outlook";

/**
 * The pretty address of one section: `<prefix><slug>/<section>/`, or the hub's
 * own `<prefix><slug>/` for the Outlook. See HUB_SECTION.
 */
export function sectionPath(
  prefix: string,
  slug: string,
  section: string,
): string {
  if (section === HUB_SECTION) return `${prefix}${slug}/`;
  return `${prefix}${slug}/${section}/`;
}

/**
 * How a section-scoped page names itself.
 *
 * The heading is the page's H1 (its H2 in embed mode, where WordPress supplies
 * the H1) and is written as the phrase people search rather than as a tab
 * label: "Fantasy Football Outlook", not "Outlook". Sections not listed here
 * can still be addressed; they just fall back to the team's own name.
 *
 * News was the one section held back from this list's public counterpart, on
 * the grounds that a team whose archive is two stories is a thin page. It is
 * open now and addressed like the other five: the archive fills through the
 * season, and a section that is thin in September is the same section that is
 * the most-read one in November.
 */
const SECTION_HEADINGS: Record<string, string> = {
  outlook: "Fantasy Football Outlook",
  usage: "Snap Counts & Player Usage",
  coaching: "Offensive Coordinator & Scheme",
  stats: "Stats",
  schedule: "Schedule",
  "depth-chart": "Depth Chart",
  matchups: "Matchups",
  news: "News",
};

/**
 * The public heading for a section page, e.g. "New England Patriots Schedule
 * 2026".
 *
 * The season trails the phrase for every team section, unlike the player pages
 * where only Stats and the Game Log take a year: a team's schedule, depth chart
 * and outlook are all read as belonging to one season, and the year is part of
 * the phrase people type for each of them.
 */
/**
 * The heading of the hub itself: "Buffalo Bills Fantasy Football Outlook &
 * Stats 2026".
 *
 * The hub's address is the Outlook's - `/outlook/` 301s here - so this is also
 * the Outlook tab's heading. It replaced the panel's "2026 Fantasy Outlook",
 * which names no team, read the same on all 32 hubs, and was word for word the
 * H1 of `/outlook/` besides. Mirrored by statchasers_team_heading() in PHP.
 */
export function teamHubHeading(teamName: string, season: number): string {
  return `${teamName} Fantasy Football Outlook & Stats ${season}`;
}

/**
 * Sections whose heading carries no season. The depth chart is the roster as
 * it stands today, and the page's stamp line says which season and when it
 * was refreshed; "Buffalo Bills Depth Chart" is also the phrase searched
 * (mak's depth-chart brief, 2026-11-03). The schedule likewise (mak's
 * schedule brief, same day): "Indianapolis Colts Schedule" is the H1, and
 * the season, record and bye sit on the context line directly under it.
 * Mirrored in PHP.
 */
const UNDATED_SECTION_HEADINGS = new Set(["depth-chart", "schedule"]);

/**
 * Sections whose heading carries the season in parentheses: "New England
 * Patriots Snap Counts & Player Usage (2026)", the H1 mak's NFL-first usage
 * brief spelled out (2026-11-05). Mirrored in PHP.
 */
const PAREN_SEASON_HEADINGS = new Set(["usage", "coaching"]);

export function teamSectionHeading(
  teamName: string,
  section: string,
  season: number,
): string | null {
  const phrase = SECTION_HEADINGS[section];
  if (phrase && UNDATED_SECTION_HEADINGS.has(section)) return `${teamName} ${phrase}`;
  if (phrase && PAREN_SEASON_HEADINGS.has(section)) return `${teamName} ${phrase} (${season})`;
  return phrase ? `${teamName} ${phrase} ${season}` : null;
}

/* ------------------------------------------------------------------ atoms */

export const ARROW = `<span class="sct-arrow" aria-hidden="true">&rarr;</span>`;

/** Attribute-safe style declaration list, or "". */
export function styleAttr(parts: Array<string | null>): string {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

/**
 * A section heading with the compact gold rule beneath it.
 *
 * The rule is drawn by CSS on the element rather than being a separate node, so
 * it cannot be left behind by a heading that moves.
 */
export function h2(text: string, extraClass = ""): string {
  return `<h2 class="sct-h2${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(text)}</h2>`;
}

/**
 * Promote a panel's own heading to the page's <h1>.
 *
 * The twin of promoteHeading() in player-render.ts, and the same problem: a
 * section address prints its phrase twice, once as the theme's page title and
 * once here as the panel's own heading with the gold rule under it.
 *
 * The FIRST match only. A hub panel carries several `h2()`s - the Stats tab
 * alone has three - and it is the one the panel opens with that names the page;
 * the rest are blocks within it and stay where they are.
 *
 * `extraClass` is preserved, because some headings carry one and the styling
 * hangs off `.sct-h2` either way: this changes the document outline and nothing
 * a reader can see.
 *
 * `text` replaces the heading's words as well, so the H1 is in the address's
 * words rather than the panel's: the hub's is teamHubHeading() and a section's
 * is teamSectionHeading(), the same strings the strip hands the host's H1.
 */
function promoteHeading(html: string, text?: string): string {
  return html.replace(
    /<h2 class="(sct-h2[^"]*)">([\s\S]*?)<\/h2>/,
    (_, className: string, inner: string) =>
      `<h1 class="${className}">${text === undefined ? inner : escapeHtml(text)}</h1>`,
  );
}

/**
 * An external link into the main StatChasers site.
 *
 * `target="_top"` because these pages are read inside statchasers.com, and in
 * the legacy iframe mount a plain link would load the destination *inside the
 * frame* - a full site rendered in a 900px box. Breaking out is the correct
 * behavior in the frame and a no-op when the markup is mounted directly.
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

/* ------------------------------------------------------------------- hero */

/** A header fact: the label the KPI card prints over the value. */
export interface HeroFact {
  label: string;
  value: string;
}

/** The hero's facts in order: record, standing, head coach, bye; each only when the data has it. */
export function heroFactList(data: TeamPageData): HeroFact[] {
  const facts: HeroFact[] = [];

  // The "Division · AFC East" chip went 2026-11-03 (mak: "remove this
  // pill"); the division still reads in the switcher and the standings.

  // Withheld out of season - see team-data.ts. Present here only when it means
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

  return facts;
}

/** `premium`: the class a comparison copy carries instead of data-sct-switch, so the bundle wires only the header's. */
export function teamSwitcher(team: NflTeam, options: TeamRenderOptions, premium: false | string = false): string {
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
              ` href="${escapeHtml(`${prefix}${entry.slug}/${query}`)}"` +
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
  // <a href> - so the switcher is also 31 crawlable internal links rather than
  // a dead end. The client bundle only adds outside-click and Escape.
  return (
    `<details class="sct-switch${premium ? ` ${premium}` : ""}"${premium ? "" : " data-sct-switch"}>` +
    `<summary class="sct-switch-summary">` +
    // Lazy even though it is above the fold: a lazy image inside the viewport
    // is still fetched straight away, just at a lower priority than the hero
    // crest beside it. That ordering is the point - this is a 22px decoration
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

/**
 * The page header: the hero (crest, division and season, the club's name, the
 * switcher, the KPI cards, the freshness line) and the section strip under
 * it, both drawn by team/team-header.ts (mak's pick, 2026-11-05: "Design B",
 * the bright blue hero with the light strip; the original header and the dark
 * "Design A" were removed the same day).
 *
 * Standalone, the club's name is the page's <h1>. Embedded, WordPress supplies
 * the H1 and the name is an <h2>. On a page whose own heading WordPress
 * promotes (`ownHeading`), it is a plain block with the heading's look: the
 * page-specific heading is the one that names the page (2026-11-03).
 *
 * The name is the club's on every one of the hub's addresses. A section URL
 * used to put the page's subject here instead, which meant the header rewrote
 * itself every time a reader clicked a tab. Each section prints its own
 * heading again, so the phrase is still on the page exactly once; the document
 * title, the description and the strip are what say which address this is.
 */
function teamHeader(data: TeamPageData, options: TeamRenderOptions, tabs: Section[], activeId?: string): string {
  const facts = heroFactList(data);
  const items = navItems(tabs, data.team, data.state.season, options, activeId);
  return (
    renderTeamHeader({
      team: data.team,
      season: data.state.season,
      headingTag: options.ownHeading ? "p" : options.embed ? "h2" : "h1",
      facts,
      updatedMs: data.newsUpdatedAtMs,
      switcher: teamSwitcher(data.team, options),
      tabs: items,
    }) +
    // "Premium Design A · Dark Navy", brought back at mak's request (2026-11-05)
    // as a labeled comparison UNDER the header, on the same facts, switcher
    // links and tab addresses; its switcher copy is not wired and its tabs
    // carry none of the bundle's hooks. Not the default.
    renderPremiumTeamHeader({
      team: data.team,
      season: data.state.season,
      facts,
      updatedMs: data.newsUpdatedAtMs,
      switcher: teamSwitcher(data.team, options, "sct-tp-switch"),
      tabs: items,
    })
  );
}

/* ------------------------------------------------------------- section nav */

interface Section {
  id: string;
  label: string;
  html: string;
  /** The questions this section drew, for the FAQPage the document emits. */
  faq?: FaqSink;
  /**
   * Whether the hub carries this section as a tab.
   *
   * False for a section that keeps its own public URL but has come off the tab
   * strip - Matchups, whose every row the Schedule tab now carries a "View
   * matchup" link in, so the two tabs were the same list twice. The page at
   * /<slug>/matchups/ still renders; the hub just stops offering a second way
   * into it.
   *
   * A tab is not a panel. A section with a public address of its own (see
   * ownsAddress) is a tab on the hub and a link to that address, and its
   * markup is printed ONLY there - see renderTeamPage.
   */
  hubTab?: boolean;
  /**
   * Markup that belongs to this section but renders after the "Explore
   * StatChasers" block rather than inside the panel - today, the section's FAQ.
   *
   * It has to leave the panel to get below a block that is a sibling of every
   * panel, so it is emitted as a sibling too and shown only while its own tab
   * is open. team.css keys that off the same :target / .is-active pair the
   * panels use.
   */
  tail?: string;
  /**
   * A hub-only panel: its tab links to the hub's address plus `#id` rather
   * than to a section page of its own. The client bundle already supports the
   * pattern (it is how the Usage tab worked before it earned its URL), and
   * with scripting off the hash drives the same :target switch as ever.
   * Coaching wears it while its public URL waits on approval.
   */
  hash?: boolean;
  /**
   * The hub carries a compact PREVIEW of this section, and the full section
   * lives only at its own address. On the hub the tab is a hash tab (the
   * preview switches in place, and its "View full ..." link is the way to
   * the page); on a section page the strip links to the real address.
   * The Schedule wears it (mak, 2026-11-03): the hub used to carry the whole
   * schedule and all its questions, which made the hub and /schedule/ the
   * same page twice.
   */
  previewOnHub?: boolean;
}

/**
 * Where a section puts the markup it wants rendered after the tools block.
 *
 * Threaded in as a sink for the same reason `faq` is: these renderers return
 * one string of markup, and this is a second, separate piece of it that the
 * page assembles somewhere else entirely.
 */
interface TailSink {
  html: string;
}

/**
 * The section bar.
 *
 * Plain anchors to REAL ADDRESSES, which is what changed and why.
 *
 * They used to be `#stats` and friends: the panels are all in the document and
 * CSS `:target` swapped between them, so the strip worked with scripting off
 * and cost nothing to use. What it also did was leave the six section URLs of
 * every team - which exist, carry their own title, description and canonical,
 * and sit in the sitemap - with nothing on the site linking to them. Six
 * indexable addresses per team, advertised and orphaned, is the shape of page
 * that does not rank however good it is.
 *
 * So each tab is a link to its own section page. With scripting off that is
 * exactly what it does: a page load, a different URL, a different H1. With
 * scripting on, client/team.ts intercepts the click, switches the panel in
 * place and pushes the same URL into the address bar - no reload, and the
 * address still names what the reader is looking at.
 *
 * The data attributes are that contract. `data-sct-panel-id` is which panel to
 * show, since the href no longer says. `data-sct-heading` and `data-sct-lead`
 * are what the page's H1 and standfirst should read once it has - those live
 * OUTSIDE the fragment, in the host page's own markup, so the bundle cannot
 * derive them and the server has to hand them over.
 *
 * The heading strings are generated here from the same functions the WordPress
 * side mirrors, so a swapped heading and a loaded one cannot say different
 * things about the same address.
 *
 * ARIA is still added by client/team.ts rather than here: `role="tab"` promises
 * arrow keys and a roving tabindex, and promising that in static HTML when the
 * bundle may not load is worse for a screen-reader user than the plain list of
 * links the server sends, which behaves exactly as announced.
 */
/** One tab of the strip: its address, words and whether it is the open one. */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  active: boolean;
  heading: string;
  lead: string;
  title: string;
}

export function navItems(
  sections: Section[],
  team: NflTeam,
  season: number,
  options: TeamRenderOptions,
  activeId?: string,
): NavItem[] {
  if (sections.length < 2) return [];
  const prefix = options.teamPathPrefix ?? "/team/";
  const active = activeId ?? sections[0]?.id;
  return sections.map((section) => {
      // The Outlook is the hub: its address is the hub's (sectionPath) and its
      // heading is the hub's. `/outlook/` only 301s back here. A hash tab is a
      // hub-only panel, so its address, heading and title are the hub's too -
      // the page never leaves the hub's URL bar one hash.
      const isHub = section.id === HUB_SECTION;
      // `activeId` is set only on a section page; on the hub a preview
      // section's tab is a hash tab, so the panel switches in place.
      const hashTab =
        section.hash === true || (section.previewOnHub === true && activeId === undefined);
      const hubLike = isHub || hashTab;
      const heading = hubLike
        ? teamHubHeading(team.fullName, season)
        : (teamSectionHeading(team.fullName, section.id, season) ?? team.fullName);
      const lead = teamPageMeta(team, season, "", hubLike ? undefined : section.id)
        .description;
      // The title the tab's address carries on WordPress, for the bundle to set
      // before it pushes that address. The hub's stored title is the Outlook's.
      const title = teamPageMeta(team, season, "", hubLike ? "outlook" : section.id).title;
      const href = hashTab
        ? `${sectionPath(prefix, team.slug, HUB_SECTION)}#${section.id}`
        : sectionPath(prefix, team.slug, section.id);
      return { id: section.id, label: section.label, href, active: section.id === active, heading, lead, title };
    });
}

/* --------------------------------------------------------------- snapshot */

/**
 * Rank tiers. Deliberately three coarse buckets rather than a gradient: the
 * difference between 11th and 13th is noise, and shading it implies a precision
 * the number does not have.
 */
export function rankTier(
  rank: number | null,
): "good" | "mid" | "poor" | "none" {
  if (rank === null) return "none";
  if (rank <= 8) return "good";
  if (rank >= 25) return "poor";
  return "mid";
}

export const TIER_WORD: Record<string, string> = {
  good: "Top tier",
  mid: "Middle tier",
  poor: "Bottom tier",
};

/**
 * The accent a card paints a rank with - the tier, plus a top-five band.
 *
 * A shade finer than the tier itself, and only ever a color. The tier is the
 * page's verdict and stays three buckets wide everywhere it is spoken aloud,
 * because the difference between 11th and 13th is noise. This exists because a
 * row of cards has to be sortable at a glance, and 2nd earns the right to
 * separate itself from 8th when the two are sitting side by side. Gold rather
 * than a deeper green: the top of the league is the one result on this page
 * worth spending the brand color on.
 */
function rankAccent(tier: string, rank: number | null): string {
  if (tier === "good" && rank !== null && rank <= 5) return "elite";
  return tier;
}

/**
 * The Stats tab's opening heading, and nothing else. The four per-game cards
 * (Points/G, Pass Yds/G, Rush Yds/G, Total Yds/G) that used to sit under it
 * were removed at mak's request (2026-10-22); the ladders below carry the same
 * figures. The snapshot is still fetched because the heading keys its season
 * on what ESPN actually returned.
 */
function renderSnapshot(data: TeamPageData): string {
  const snapshot = data.snapshot;
  if (!snapshot) return "";

  // Keyed on the season that came back, not the one the page asked for.
  // getTeamSnapshot() falls back a year when ESPN has nothing for the current
  // season yet, and `state.statsSeasonIsPrior` describes the request - it would
  // caption a block of 2025 numbers as 2026 for the whole of Week 1. The Stats
  // tab labels itself the same way, from the same evidence.
  // In season the line under the heading is gone (mak, 2026-10-20): the
  // heading already carries the year. The fallback sentence stays for the
  // one case where it is a warning rather than a caption.
  const seasonNote =
    snapshot.season < data.state.season
      ? `<p class="sct-note">${escapeHtml(`${snapshot.season} regular season - the ${data.state.season} season has no completed team stats yet.`)}</p>`
      : "";

  return (
    `<div class="sct-block">` +
    // The team and the year, like every other tab's opening heading - this one
    // said "Team Snapshot", which named neither, and it is the heading the
    // Stats section address promotes to its <h1>. Thirty-two pages shared one
    // generic phrase while the page title beside it read "Buffalo Bills Stats
    // 2026: Offense, Defense & NFL Rankings".
    //
    // `snapshot.season`, NOT `data.state.season`, for the reason the note
    // directly above is keyed the same way: through Week 1 the numbers are last
    // season's, and a heading that says 2026 over a block of 2025 figures is
    // the one thing worse than a heading that says nothing.
    h2(`${data.team.nickname} Team Stats ${snapshot.season}`) +
    seasonNote +
    `</div>`
  );
}

/* --------------------------------------------------------- advanced stats */

/**
 * The rank bar's fill.
 *
 * Rank, not value: the point of the bar is where this team sits among 32, and a
 * bar drawn from the raw number would make 4.2 and 4.4 yards a carry look
 * identical when they are 13th and 3rd. 1st fills the track, 32nd leaves a
 * stub - never nothing, because an empty track reads as missing data rather
 * than as last place.
 */
function rankFill(rank: number): string {
  const share = (33 - Math.min(Math.max(rank, 1), 32)) / 32;
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * A metric's tier, or "none" for the ones that do not have a better end.
 *
 * `volume` rows - plays per game, pass rate - are ranked but never tinted. A
 * green bar on "66 plays a game" would be the page asserting that pace is good,
 * which it is not; it is just pace, and the reader is the one who knows whether
 * they want it.
 */
function statTier(row: StatRow): "good" | "mid" | "poor" | "none" {
  if (row.direction === "volume") return "none";
  return rankTier(row.rank);
}

/**
 * One row of a ladder: label, rank bar, value, rank.
 *
 * The bar carries `aria-hidden` because it says nothing the rank chip beside it
 * does not already say in words - the same reasoning as the tier color on the
 * snapshot cards, which is doubled by TIER_WORD rather than left to color.
 */
function statRow(row: StatRow, summary = false): string {
  const tier = statTier(row);
  const bar =
    row.rank !== null
      ? `<span class="sct-stat-bar" data-tier="${tier}" aria-hidden="true">` +
        `<span class="sct-stat-fill" style="${escapeHtml(`width:${rankFill(row.rank)}`)}"></span>` +
        `</span>`
      : // No rank, no track. An empty bar next to a real number would imply a
        // league position we did not establish.
        `<span class="sct-stat-bar is-empty" aria-hidden="true"></span>`;

  const rank = row.rankLabel
    ? `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(row.rankLabel)}` +
      (tier !== "none"
        ? `<span class="sct-visually-hidden"> of 32 - ${escapeHtml(TIER_WORD[tier] ?? "")}</span>`
        : `<span class="sct-visually-hidden"> of 32</span>`) +
      `</span>`
    : "";

  return (
    `<li class="sct-stat${summary ? " is-summary" : ""}">` +
    `<span class="sct-stat-label">${escapeHtml(row.label)}` +
    `<span class="sct-visually-hidden"> - ${escapeHtml(row.description)}</span></span>` +
    bar +
    `<span class="sct-stat-value">${escapeHtml(row.value)}</span>` +
    rank +
    `</li>`
  );
}

/**
 * One unit's ladder.
 *
 * `data-unit` is what the stylesheet uses to put the gold rule beside Offense
 * and the navy one beside Defense; nothing here decides color. `kind` marks
 * the Efficiency ladders so the phone layout can slot each one under its own
 * unit instead of after both.
 */
function statLadder(
  unit: "offense" | "defense" | "team",
  title: string,
  caption: string,
  rows: StatRow[],
  kind = "",
  options: {
    /** Spans both columns of the ladder grid: the team-level buckets. */
    wide?: boolean;
    /** The row drawn as the bucket's summary - turnover margin. */
    summaryKey?: string;
  } = {},
): string {
  if (rows.length === 0) return "";
  return (
    `<section class="sct-ladder${options.wide ? " is-wide" : ""}" data-unit="${unit}"${kind ? ` data-kind="${kind}"` : ""}>` +
    `<h3 class="sct-ladder-title">${escapeHtml(title)}</h3>` +
    `<p class="sct-ladder-caption">${escapeHtml(caption)}</p>` +
    `<ul class="sct-ladder-list">${rows
      .map((row) => statRow(row, row.key === options.summaryKey))
      .join("")}</ul>` +
    `</section>`
  );
}

/**
 * The week the stats provider's numbers have reached: the week of the team's
 * Nth regular-season game, N being the games the provider says it has played.
 * Read off the schedule rather than the calendar because the document is
 * cumulative and moves the moment a game ends, bye weeks included. Null when
 * there is no schedule or no games yet, and the caption says nothing.
 */
function statsThroughWeek(data: TeamPageData): number | null {
  const played = data.stats?.gamesPlayed ?? 0;
  // A prior season's numbers (the Week 1 fallback) under this season's
  // schedule would name the wrong week: say nothing instead.
  if (played < 1 || !data.schedule || data.schedule.season !== data.stats?.season) return null;
  const games = (data.schedule?.games ?? [])
    .filter((game) => game.seasonType === "regular")
    .sort((a, b) => a.week - b.week);
  return games[played - 1]?.week ?? null;
}

/** The rows whose keys are listed, in the listed order; absent keys skipped. */
function pickRows(rows: StatRow[], keys: readonly string[]): StatRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return keys.map((key) => byKey.get(key)).filter((row): row is StatRow => !!row);
}

/**
 * The Stats tab's buckets (mak, 2026-10-20), by row key. The data module keeps
 * the ladder pair's ten metrics and the situational and volume lists exactly
 * as before - the history table and the FAQ read them by key - and this is
 * where each row is dealt to the bucket its meaning belongs to. Before this
 * Yds/Play, Yds/Pass Att, Yds/Carry and Passer Rtg sat in Offense/Defense
 * beside the EPA ladders that say the same thing per play, and Sacks lived
 * under Situational two blocks away from the pass rush.
 */
const PRODUCTION_KEYS = [
  "points",
  "total-yards",
  "pass-yards",
  "rush-yards",
  "first-downs",
  "third-down",
] as const;
const RATE_KEYS = [
  "yards-per-play",
  "yards-per-attempt",
  "yards-per-carry",
  "passer-rating",
] as const;
const POSSESSION_KEYS = [
  "turnover-margin",
  "takeaways",
  "giveaways",
  "fourth-down",
  "penalty-yards",
] as const;
const PACE_KEYS = [
  "plays",
  "plays-faced",
  "pass-attempts",
  "rush-attempts",
  "pass-td",
  "rush-td",
] as const;

const prefixed = (prefix: string, keys: readonly string[]): string[] =>
  keys.map((key) => `${prefix}-${key}`);

/** A tile footer's accent, from the row's tier. */
function tileAccent(row: StatRow): string {
  return rankAccent(statTier(row), row.rank);
}

/** A compact card for the metrics that are a number rather than a comparison. */
function statTile(row: StatRow): string {
  const tier = statTier(row);
  const accent = tileAccent(row);

  // The percentile groove along the bottom edge. Same rank-not-value fill as a
  // ladder bar, drawn at 3px because it is a texture for scanning eight cards
  // at once rather than a figure to be read off - the ordinal above it is the
  // figure. No rank, no groove, for the reason the ladder gives.
  const track =
    row.rank !== null
      ? `<span class="sct-tile-track" data-tier="${accent}" aria-hidden="true">` +
        `<span class="sct-tile-fill" style="${escapeHtml(`width:${rankFill(row.rank)}`)}"></span>` +
        `</span>`
      : "";

  // The rank alone on one ruled line. The year-on-year movement arrow that
  // used to sit beside it was removed at mak's request (2026-10-20).
  const foot = row.rankLabel
    ? `<p class="sct-tile-foot">` +
      // The tier is carried as a word as well as a color and a dot - a reader
      // who cannot distinguish the tints still gets the judgment.
      `<span class="sct-tile-rank" data-tier="${tier}" data-accent="${accent}">` +
      `<span class="sct-tile-dot" aria-hidden="true"></span>` +
      `<span class="sct-tile-rank-value">${escapeHtml(row.rankLabel)}</span>` +
      // No "NFL rank" caption beside the ordinal (mak, 2026-10-20), matching
      // the snapshot cards and the ladders. A screen reader is still told the
      // denominator and the tier outright.
      `<span class="sct-visually-hidden"> of 32` +
      (tier !== "none" ? ` - ${escapeHtml(TIER_WORD[tier] ?? "")}` : "") +
      `</span>` +
      `</span>` +
      `</p>`
    : "";

  return (
    `<li class="sct-tile">` +
    `<p class="sct-tile-label">${escapeHtml(row.label)}` +
    `<span class="sct-visually-hidden"> (${escapeHtml(row.description)})</span></p>` +
    `<p class="sct-tile-value">${escapeHtml(row.value)}</p>` +
    foot +
    track +
    `</li>`
  );
}

/* ---------------------------------------------------------- season history */

/**
 * Five seasons as a table.
 *
 * A real `<table>`, unlike everything else on this page. The rest of the hub is
 * lists of things that happen to be laid out in columns - a schedule, a depth
 * chart - and those are marked up as lists because that is what they are. This
 * is genuinely a matrix: every cell is the intersection of a season and a
 * metric, and a reader on a screen reader needs to be told which row and which
 * column they are in. `<th scope>` is the only thing that does that.
 *
 * It is the one block on the tab that scrolls sideways on a phone. Six metric
 * columns cannot be stacked without becoming five separate cards - at which
 * point the comparison between seasons, the entire reason the block exists, is
 * gone. The stylesheet fades the right edge so the scroll is visible.
 */
/**
 * Rank tiers for the history table, finer than the page-wide three.
 *
 * The coarse buckets exist because the difference between 11th and 13th is
 * noise, and that reasoning still holds - none of these tiers is spoken aloud
 * as a verdict, and 11th through 22nd is one flat slate band for exactly that
 * reason. What is different here is the job: thirty numbers in a grid have to
 * be sortable by eye in a single pass, and a table where two thirds of the
 * cells are the same green cannot be. So the top half splits at 5, which is the
 * band a reader is actually looking for, and the bottom stays one bucket
 * because 23rd and 31st are the same news.
 */
function historyTier(row: StatRow): "elite" | "good" | "mid" | "poor" | "none" {
  if (row.direction === "volume" || row.rank === null) return "none";
  if (row.rank <= 5) return "elite";
  if (row.rank <= 10) return "good";
  if (row.rank <= 22) return "mid";
  return "poor";
}

/**
 * Which of the three groups a history column belongs to.
 *
 * Read off the key prefix the metric definitions already use rather than a
 * second list kept in step by hand: a column added to HISTORY_KEYS lands in the
 * right group without this being touched, and one that is neither side of the
 * ball - turnover margin is the only one today - falls into its own group at
 * the end, which is where the table wants it anyway.
 */
/**
 * The heat-map tint behind a history cell, from its rank.
 *
 * A diverging scale: 1st is the deepest green, 32nd the deepest red, and the
 * middle of the league fades to nothing so the eye lands on the extremes. The
 * tints are alpha washes over the row rather than solid fills, so the navy
 * figure and the tier-colored ordinal keep their contrast on every cell.
 * Volume rows and unranked cells get no wash (mak, 2026-10-22: the table is a
 * heat map).
 */
function historyHeat(row: StatRow): string {
  if (row.direction === "volume" || row.rank === null) return "";
  const t = Math.min(1, Math.max(0, (row.rank - 1) / 31));
  const strength = Math.abs(t - 0.5) * 2; // 0 at 16th/17th, 1 at the ends
  const alpha = (0.06 + strength * 0.3).toFixed(3);
  return t <= 0.5
    ? `rgba(20,107,82,${alpha})`
    : `rgba(148,54,58,${alpha})`;
}

function historyGroup(key: string): string {
  if (key.startsWith("off-")) return "offense";
  if (key.startsWith("def-")) return "defense";
  return "other";
}

/**
 * The number behind a preformatted cell value: "28.8", "+3", "42.9%".
 *
 * Null when there is nothing to read, so a caller comparing seasons skips the
 * cell rather than treating it as a zero.
 */
function historyNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The best figure this team has posted in each column, across the seasons shown.
 *
 * The table already says where a season stood in its own league year. This is
 * the other axis, and the one a rank cannot give: whether 28.8 is a good number
 * FOR THIS TEAM, which is most of what five seasons side by side are for.
 *
 * "Best" is the metric's own good end - highest points scored, lowest points
 * allowed - so a volume metric has none and is skipped rather than being handed
 * one arbitrarily. Ties are kept: two seasons at +7 are two best seasons and
 * both get marked.
 *
 * A season still in progress is excluded from the cumulative columns, where a
 * running total is not yet the same kind of number as a finished season's.
 */
function historyBests(history: readonly HistorySeason[]): Map<string, number> {
  const mostGames = Math.max(
    0,
    ...history.map((season) => season.gamesPlayed ?? 0),
  );
  const bests = new Map<string, number>();
  for (const season of history) {
    const partial = (season.gamesPlayed ?? 0) < mostGames;
    for (const cell of season.cells) {
      if (cell.direction === "volume") continue;
      if (partial && cell.cumulative) continue;
      const value = historyNumber(cell.value);
      if (value === null) continue;
      const current = bests.get(cell.key);
      if (
        current === undefined ||
        (cell.direction === "low" ? value < current : value > current)
      ) {
        bests.set(cell.key, value);
      }
    }
  }
  return bests;
}

function renderHistory(stats: TeamStats): string {
  if (stats.history.length < 2) return "";

  // Column heads come from the first row, so a metric ESPN dropped for one old
  // season cannot silently shift the columns underneath it - a row that is
  // missing a cell is padded below rather than closing up.
  const columns = stats.history[0]?.cells.map((cell) => cell.key) ?? [];
  if (columns.length === 0) return "";

  // Where one group of metrics ends and the next begins, so the stylesheet can
  // put a gap and a header divider there. Computed once from the column order
  // rather than asked per cell, because every row needs the same answer and the
  // first column of the table is never a boundary - there is nothing to its
  // left to be separated from.
  const groups = columns.map(historyGroup);
  const startsGroup = groups.map(
    (group, i) => i > 0 && group !== groups[i - 1],
  );
  const attrs = (i: number) =>
    ` data-group="${escapeHtml(groups[i] ?? "")}"` +
    (startsGroup[i] ? ` class="is-group-start"` : "");

  const head =
    `<tr><th scope="col" class="sct-hist-season">Season</th>` +
    (stats.history[0]?.cells ?? [])
      .map(
        (cell, i) =>
          `<th scope="col"${attrs(i)}>${escapeHtml(cell.label)}` +
          `<span class="sct-visually-hidden"> - ${escapeHtml(cell.description)}</span></th>`,
      )
      .join("") +
    `</tr>`;

  const bests = historyBests(stats.history);
  const seasonCount = stats.history.length;

  const body = stats.history
    .map((season, i) => {
      const cells = new Map(season.cells.map((cell) => [cell.key, cell]));
      const row = columns
        .map((key, col) => {
          const cell = cells.get(key);
          // An absent cell is an empty cell. It is not a zero and it is not a
          // dash pretending to be a measurement.
          if (!cell)
            return `<td class="sct-hist-cell is-empty"${attrs(col)}></td>`;
          const tier = historyTier(cell);
          const best =
            bests.has(key) && historyNumber(cell.value) === bests.get(key);
          // The gold mark is a color, so it says nothing on its own. The note
          // is what actually carries it to a reader who is not looking at the
          // table, and it is per-cell rather than a legend because a legend
          // several rows away is not an explanation of this number.
          const bestNote = best
            ? `<span class="sct-visually-hidden"> - best of the last ` +
              `${escapeHtml(String(seasonCount))} seasons</span>`
            : "";
          const cls =
            "sct-hist-cell" + (startsGroup[col] ? " is-group-start" : "");
          const heat = historyHeat(cell);
          return (
            `<td class="${cls}" data-group="${escapeHtml(groups[col] ?? "")}"` +
            ` data-tier="${tier}"` +
            (heat ? ` style="${escapeHtml(`--sct-heat:${heat}`)}"` : "") +
            `>` +
            `<span class="sct-hist-value${best ? " is-best" : ""}">` +
            `${escapeHtml(cell.value)}${bestNote}</span>` +
            (cell.rankLabel
              ? `<span class="sct-hist-rank" data-tier="${tier}">` +
                `${escapeHtml(cell.rankLabel)}` +
                `<span class="sct-visually-hidden"> of 32</span></span>`
              : "") +
            `</td>`
          );
        })
        .join("");
      // "17 games" rather than "17 G". The abbreviation saved a character in a
      // cell that had the room for the word, and read as a stat line of its own
      // sitting directly under a four-digit year.
      const games = season.gamesPlayed
        ? `<span class="sct-hist-games">${escapeHtml(
            `${season.gamesPlayed} ${season.gamesPlayed === 1 ? "game" : "games"}`,
          )}</span>`
        : "";
      // The top row already carries a gold hairline down its left edge. The
      // chip says the same thing in words, which the hairline cannot, and marks
      // the row whose numbers are the ones every other page on this hub is
      // quoting.
      const current = i === 0 ? `<span class="sct-hist-now">Current</span>` : "";
      return (
        `<tr${i === 0 ? ` class="is-current"` : ""}>` +
        `<th scope="row" class="sct-hist-season">` +
        `<span class="sct-hist-year">${escapeHtml(String(season.season))}` +
        current +
        `</span>` +
        games +
        `</th>` +
        row +
        `</tr>`
      );
    })
    .join("");

  const span = stats.history[stats.history.length - 1]?.season;
  return (
    `<div class="sct-block">` +
    h2("Season History", "is-sub") +
    `<p class="sct-note">${escapeHtml(
      span
        ? `Every season back to ${span}, each number ranked against the 32 teams of that year. Greener cells rank nearer the top of the league, redder cells nearer the bottom.`
        : "Each number ranked against the 32 teams of its own season. Greener cells rank nearer the top of the league, redder cells nearer the bottom.",
    )}</p>` +
    `<div class="sct-hist-scroll">` +
    `<table class="sct-hist">` +
    `<caption class="sct-visually-hidden">` +
    `Team production by season, with each figure's NFL rank for that season.` +
    `</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

/**
 * A tile grid.
 *
 * `cols` is the intended full-width row length for this block - four for the
 * eight situational metrics, three for the six volume ones - so each block
 * fills complete rows rather than leaving a stray pair hanging off the end of
 * one shared four-column grid. The stylesheet overrides it below 900px, where
 * neither number fits.
 */
function statTiles(rows: StatRow[], cols: 3 | 4): string {
  if (rows.length === 0) return "";
  return (
    `<ul class="sct-tiles" data-cols="${cols}">` +
    rows.map(statTile).join("") +
    `</ul>`
  );
}

/**
 * The pass/run split as one bar.
 *
 * Two numbers that sum to 100 are a proportion, and a proportion is the one
 * thing a bar shows better than a pair of figures does. Both halves are still
 * printed underneath - the bar is the shape, the legend is the fact.
 */
function playMix(label: string, caption: string, balance: PlayBalance): string {
  return (
    `<div class="sct-mix">` +
    `<p class="sct-mix-label">${escapeHtml(label)}</p>` +
    `<span class="sct-mix-bar" aria-hidden="true">` +
    `<span class="sct-mix-seg" data-kind="pass" style="${escapeHtml(`width:${balance.passPct.toFixed(1)}%`)}"></span>` +
    `<span class="sct-mix-seg" data-kind="rush" style="${escapeHtml(`width:${balance.rushPct.toFixed(1)}%`)}"></span>` +
    `</span>` +
    `<p class="sct-mix-legend">` +
    `<span class="sct-mix-key" data-kind="pass">Pass ${escapeHtml(balance.passPct.toFixed(1))}%</span>` +
    `<span class="sct-mix-key" data-kind="rush">Run ${escapeHtml(balance.rushPct.toFixed(1))}%</span>` +
    `</p>` +
    `<p class="sct-mix-caption">${escapeHtml(caption)}</p>` +
    `</div>`
  );
}

/**
 * The Stats tab.
 *
 * Three blocks, in the order a reader actually asks the questions: how good is
 * each unit, how does it behave in the situations that decide drives, and how
 * much work is there to go round - which is the only one of the three a fantasy
 * manager is really here for.
 *
 * The two ladders are the same nine metrics in the same order, so the columns
 * line up row for row and "28.8 scored / 18.8 allowed" can be read across
 * without hunting. That symmetry is enforced in lib/team/stats.ts, not here.
 */
function renderTeamStats(
  data: TeamPageData,
  faq: FaqSink,
  tail: TailSink,
): string {
  const stats = data.stats;
  if (!stats) return "";

  // Two sources feed this tab, on two clocks, and no ladder may mix them
  // (mak, 2026-10-26: the Bears' Defense Efficiency printed Week 6 EPA rows
  // over Week 7 yardage rows under one "through Week 6" caption).
  //
  //   - The stats provider's document is live and cumulative: the moment a
  //     game ends its numbers include it. Production, Turnovers and Snaps
  //     read it.
  //   - data/team/efficiency_<season>.json is built from play-by-play by
  //     scripts/team/buildEfficiency.mjs and moves when the builder runs.
  //     Efficiency, Pass Protection and Pass Rush read it, and ONLY it: the
  //     yardage rows and sack counts that used to come from the provider now
  //     come from the same file, so those four ladders are one week each.
  //
  // Each ladder's caption names the week its own source has reached, so the
  // two clocks are visible when they differ, and checkTeamPages.mjs fails the
  // daily check when the file trails the games a club has played. The
  // provider's rows stand in on the play-by-play ladders only when there is
  // no file for the season at all (an all-provider ladder is one source too).
  const effDoc = getEfficiencyDoc(stats.season);
  const eff = effDoc?.teams[data.team.abbreviation] ?? null;
  // This club's own last counted week, not the file's: on a bye, or with its
  // Monday game still to come, the club is a week behind the league.
  const effWeek = eff?.weeks?.length ? Math.max(...eff.weeks) : (effDoc?.throughWeek ?? 0);
  const effThrough = effWeek ? ` · through Week ${effWeek}` : "";
  // Since the same day the whole tab reads that one file when the season has
  // it (stats.source === "file"), so every ladder carries the same week by
  // construction; the schedule-derived week is for a season the provider is
  // still serving.
  const liveWeek = stats.source === "file" && effWeek ? effWeek : statsThroughWeek(data);
  const liveThrough = liveWeek ? ` · through Week ${liveWeek}` : "";
  // Production: the volume ladder pair, same six rows each side.
  const ladders =
    statLadder(
      "offense",
      "Offense",
      `What they did${liveThrough}`,
      pickRows(stats.offense, prefixed("off", PRODUCTION_KEYS)),
    ) +
    statLadder(
      "defense",
      "Defense",
      `What they allowed${liveThrough}`,
      pickRows(stats.defense, prefixed("def", PRODUCTION_KEYS)),
    );

  // Efficiency: the EPA rows, then the same idea in yards, all from the one
  // play-by-play file.
  const efficiency =
    statLadder(
      "offense",
      "Offense Efficiency",
      `Per play, what they did${eff ? effThrough : liveThrough}`,
      eff ? efficiencyRows(eff, "offense") : pickRows(stats.offense, prefixed("off", RATE_KEYS)),
      "efficiency",
    ) +
    statLadder(
      "defense",
      "Defense Efficiency",
      `Per play, what they allowed${eff ? effThrough : liveThrough}`,
      eff ? efficiencyRows(eff, "defense") : pickRows(stats.defense, prefixed("def", RATE_KEYS)),
      "efficiency",
    );

  // Pass Protection / Pass Rush: blitzes faced and sent, with the EPA cost,
  // time to throw from the passers' side (the defense's is the passers it
  // faced), and the sacks at each end. Blitz rate and time to throw have no
  // better end, so those rows rank most to least and come through untinted.
  const passRush =
    statLadder(
      "offense",
      "Pass Protection",
      `Under the rush, what they faced${eff ? effThrough : liveThrough}`,
      eff ? passRushRows(eff, "offense") : pickRows(stats.situational, ["sacks-allowed"]),
      "passrush",
    ) +
    statLadder(
      "defense",
      "Pass Rush",
      `The rush they sent, and what it allowed${eff ? effThrough : liveThrough}`,
      eff ? passRushRows(eff, "defense") : pickRows(stats.situational, ["sacks-made"]),
      "passrush",
    );

  // Possession & Discipline: one wide ladder, turnover margin as its summary
  // row - takeaways and giveaways are its two halves and sit under it.
  const possession = statLadder(
    "team",
    "Turnovers, Downs & Penalties",
    `Turnover margin first; takeaways and giveaways are its two halves${liveThrough}`,
    pickRows(stats.situational, POSSESSION_KEYS),
    "possession",
    { wide: true, summaryKey: "turnover-margin" },
  );

  // Pace & Play Style: the volume rows, ranked most to least, no better end.
  const pace = statLadder(
    "team",
    "Snaps, Attempts & Scores",
    `Ranked most to least, with no better end${liveThrough}`,
    pickRows(stats.volume, PACE_KEYS),
    "pace",
    { wide: true },
  );

  const mix =
    (stats.balance
      ? playMix(
          "Own play mix",
          "How this offense splits its snaps.",
          stats.balance,
        )
      : "") +
    (stats.balanceFaced
      ? playMix(
          "Play mix faced",
          "How opponents attack this defense.",
          stats.balanceFaced,
        )
      : "");

  const history = renderHistory(stats);

  if (!ladders && !efficiency && !passRush && !possession && !pace && !mix && !history) {
    return "";
  }

  const games =
    stats.gamesPlayed && stats.gamesPlayed > 0
      ? ` · ${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"}`
      : "";
  // Keyed on the season that came back, not on the one the page asked for.
  // getTeamStats() falls back a year when the current season has no completed
  // football in it yet, and the sentence has to describe what is on the screen
  // - `state.statsSeasonIsPrior` describes the request and would say "2026" over
  // a block of 2025 numbers through the whole of Week 1.
  // Only the fallback warning survives. In season the "regular season to date
  // · N games" line under Common Questions is gone (mak, 2026-10-22).
  const seasonNote =
    stats.season < data.state.season
      ? `${stats.season} regular season${games} - the ${data.state.season} season has no completed team stats yet.`
      : "";
  const blocks: string[] = [];

  // No heading or note over the first ladder group: the "Offense & Defense"
  // sub-heading went 2026-10-22 and the season/games line went 2026-10-20,
  // both at mak's request. The tab's opening heading directly above is the
  // only title these ladders need; each row's hidden text still says "of 32"
  // and its tier for a screen reader.
  if (ladders) {
    blocks.push(
      `<div class="sct-block">` +
        `<div class="sct-ladders">${ladders}</div>` +
        `</div>`,
    );
  }

  if (efficiency) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Efficiency", "is-sub") +
        `<p class="sct-note">Per play, how well each side performs - expected ` +
        `points, success and explosive rates, and yards per play, attempt and ` +
        `carry. Ranked among all 32 teams; 1st = best on either side.</p>` +
        `<div class="sct-ladders">${efficiency}</div>` +
        `</div>`,
    );
  }

  if (passRush) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Pass Protection & Pass Rush", "is-sub") +
        `<p class="sct-note">Blitzes faced and sent, what each cost, how long ` +
        `passers held the ball, and the sacks at both ends. Blitz rate and time ` +
        `to throw rank most to least, with no better end.</p>` +
        `<div class="sct-ladders">${passRush}</div>` +
        `</div>`,
    );
  }

  if (possession) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Possession & Discipline", "is-sub") +
        `<p class="sct-note">What each side does with the football. Turnover ` +
        `margin is the summary; takeaways and giveaways are its two halves.</p>` +
        `<div class="sct-ladders">${possession}</div>` +
        `</div>`,
    );
  }

  if (pace || mix) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Pace & Play Style", "is-sub") +
        `<p class="sct-note">Opportunity, not quality: how many snaps there are ` +
        `to go round and how they are divided. Ranks here are most to least, ` +
        `with no better end.</p>` +
        (pace ? `<div class="sct-ladders">${pace}</div>` : "") +
        (mix ? `<div class="sct-mixes">${mix}</div>` : "") +
        `</div>`,
    );
  }

  // Last, deliberately. The three blocks above answer "what is this team now",
  // which is the question almost everyone arrives with; the history answers
  // "and is that new", which only makes sense once the first is answered.
  if (history) blocks.push(history);

  // Below the tools block, for the same reason the outlook's questions are:
  // they are this tab re-cut into the forms people search for, which reads as
  // an appendix to it rather than as its last block. One of them is the history
  // comparison, so they could never have preceded the history above either way.
  const questions = faqList(
    statsFaq({ team: data.team, stats, currentSeason: data.state.season, efficiency: eff }),
    faq,
    "h3",
  );
  // Open, for the reason faqList() gives - the questions are the index, so they
  // stay on the page and only the answers fold.
  tail.html = faqBlock(questions, seasonNote);

  return blocks.join("");
}

/* ----------------------------------------------------- fantasy cornerstones */

/**
 * The depth-chart slot chip: "WR2", "QB1".
 *
 * `data-pos` carries the bare position so the stylesheet can color it - QB
 * red, RB green, WR blue, TE gold - while the text keeps the depth number,
 * which is the part that says whether this is the starter. Derived here rather
 * than passed in because the slot string is already the only thing the three
 * call sites have, and an unrecognized position simply falls back to the
 * stylesheet's neutral gold.
 */
export function slotChip(slot: string, small = false): string {
  const position = (/^[a-z]+/i.exec(slot)?.[0] ?? "").toUpperCase();
  return (
    `<span class="sct-slot${small ? " is-small" : ""}"` +
    ` data-pos="${escapeHtml(position)}">${escapeHtml(slot)}</span>`
  );
}

/**
 * The long designations, shortened for the inline chip.
 *
 * Only the ones that are actually long: "Out", "IR", "PUP" and "Sus" are
 * already as short as they can be, and an entry that is not here falls through
 * unchanged rather than being truncated to something unreadable.
 */
/**
 * Four bands rather than the two this page used to draw.
 *
 * "Out" and "questionable" collapsed a real distinction: doubtful is a player
 * who is probably not playing and questionable is a coin toss, and a manager
 * setting a lineup is doing nothing else but telling those two apart. The
 * colors run the way the risk does - red for gone, red-orange for doubtful,
 * gold for the coin toss, green for a designation that is close to good news.
 *
 * Anything unrecognized lands on "questionable", the neutral middle: an
 * unfamiliar designation is a reason to look, not a reason to assume the worst
 * or the best.
 */
export function injurySeverity(
  status: string | null | undefined,
): "out" | "doubtful" | "questionable" | "probable" {
  const key = (status ?? "").trim().toLowerCase();
  if (isOutDesignation(key)) return "out";
  if (key === "doubtful") return "doubtful";
  if (key === "probable" || key === "active" || key === "full") return "probable";
  return "questionable";
}

const SHORT_INJURY_STATUS: Record<string, string> = {
  questionable: "Q",
  doubtful: "D",
  probable: "P",
};

/**
 * The status chip that sits next to a name on a card or a depth-chart row.
 *
 * One letter where there is one - Q, D, P. Spelled out and trailing a body
 * part this ran to "Questionable · Knee - ACL", wider than the name it was
 * annotating on a card four to a row; "Ques" was shorter but is not a word, and
 * it still took enough width in a depth-chart row to push itself onto a second
 * line. "Out", "IR", "PUP" and "Sus" are already as short as they can be and
 * pass through unchanged.
 *
 * The letter is for the eye only. A screen reader is given the designation and
 * the body part in full instead - `title` is not reliably announced, and "Q"
 * read aloud is nothing at all. The Injury Report panel below still carries
 * status, body part and practice status in full, so this is a second way to the
 * same fact rather than the only one.
 */
/**
 * Anything carrying a designation. Widened from DepthChartEntry because the
 * outlook cards need this badge too and an outlook names a player, not a
 * depth-chart slot - these two functions only ever read the two fields.
 */
type Designated = Pick<RosterPlayer, "injuryStatus" | "injuryBodyPart">;

function injuryBadge(player: Designated, extraClass = ""): string {
  if (!player.injuryStatus) return "";
  const short =
    SHORT_INJURY_STATUS[player.injuryStatus.toLowerCase()] ?? player.injuryStatus;
  const detail = injuryDetail(player);
  return (
    `<span class="sct-injury-badge${extraClass ? ` ${extraClass}` : ""}"` +
    ` data-severity="${injurySeverity(player.injuryStatus)}"` +
    ` title="${escapeHtml(detail)}">` +
    `<span aria-hidden="true">${escapeHtml(short)}</span>` +
    `<span class="sct-visually-hidden">${escapeHtml(detail)}</span>` +
    `</span>`
  );
}

/** Status and body part spelled out: "Questionable · Knee - ACL". */
function injuryDetail(player: Designated): string {
  if (!player.injuryStatus) return "";
  return player.injuryBodyPart
    ? `${player.injuryStatus} · ${player.injuryBodyPart}`
    : player.injuryStatus;
}

/**
 * A player name, linked to their StatChasers profile when one is configured.
 *
 * Unlinked by default and on purpose: this server cannot tell whether a profile
 * exists for a given player, and a page of names pointing at 404s is worse than
 * a page of names. Set SC_PLAYER_PROFILE_URL_TEMPLATE and every name here
 * becomes a link - see lib/team/links.ts.
 */
export function playerName(name: string, className: string, label?: string): string {
  // `label` is already-escaped markup, for the one caller that needs the name
  // rendered as two alternative spellings rather than as one string - see
  // briefName(). It never carries anything a caller did not build here.
  const inner = label ?? escapeHtml(name);
  const href = getPlayerProfileUrl(name);
  if (!href) return `<span class="${className}">${inner}</span>`;
  return (
    `<a class="${className} sct-player-link" href="${escapeHtml(href)}" target="_top">` +
    `${inner}</a>`
  );
}

/**
 * "Rhamondre Stevenson" as "R. Stevenson", or null if it already fits.
 *
 * A depth-chart row is one line by construction - the name cell clips rather
 * than wraps, because a name on two lines makes that row taller than the eleven
 * around it and the column stops being a chart. Clipping alone would end a
 * quarter of the league in an ellipsis, so the long ones are shortened to
 * something that is still a name.
 *
 * The budget is in characters rather than pixels because this is rendered once
 * and cached for every viewport; the server cannot measure a column it will
 * never see. One budget, not two: the name now has the whole width beside the
 * photo to itself - the slot and the status moved to their own line under it -
 * so it no longer matters whether the player is carrying a designation. Twenty
 * characters is what the cell holds four across, between the shell's full width
 * and the 1080px where the grid drops to two columns.
 *
 * Six names in the league's 810 cross it. That is the point: this is for the
 * Croskey-Merritts, not a house style that renames everybody.
 *
 * Returns null rather than a shortened form when there is nothing to shorten -
 * a single-word name, or an abbreviation that would not actually be shorter.
 * The cell still clips those; there is simply no better spelling to offer.
 */
function briefName(name: string): string | null {
  const full = name.trim();
  if (full.length <= 20) return null;

  const gap = full.indexOf(" ");
  if (gap <= 0) return null;
  const rest = full.slice(gap + 1).trim();
  if (!rest) return null;

  // The first letter, not the first token: "A.J. Brown" becomes "A. Brown"
  // rather than "A.J.. Brown", and a suffix rides along on the rest so
  // "Michael Pittman Jr." keeps its "Jr.".
  const brief = `${full.charAt(0).toUpperCase()}. ${rest}`;
  return brief.length < full.length ? brief : null;
}

/* ---------------------------------------------------------------- outlook */

/**
 * One "what changed" fact: an offseason arrival, the play caller, last season's
 * scoring rate.
 *
 * A <div> pair inside a <dl> rather than a card, because these are the page's
 * cheapest facts and dressing them as tiles would put them at the same weight
 * as the snapshot's ranks directly above. They are context for the take below,
 * not findings of their own.
 *
 * The rank rides on the value rather than getting a line of its own. It is the
 * same relationship the snapshot card draws between a figure and its ordinal -
 * the reading, then what the reading is worth - and giving it a third line here
 * would make a six-item strip twice as tall for a two-character word.
 */
function outlookFact(fact: OutlookFact): string {
  const rank = fact.rank
    ? ` <span class="sct-outlook-fact-rank">${escapeHtml(fact.rank)}` +
      `<span class="sct-visually-hidden"> in the NFL</span></span>`
    : "";
  return (
    `<div class="sct-outlook-fact">` +
    `<dt class="sct-outlook-fact-label">${escapeHtml(fact.label)}</dt>` +
    `<dd class="sct-outlook-fact-value">${escapeHtml(fact.value)}${rank}</dd>` +
    `</div>`
  );
}

/**
 * The compact evidence row under a player's thesis.
 *
 * A list, not a sentence: three facts separated by dots are read by jumping
 * between them, and that is the whole job of this row - it is what a reader
 * checks the claim above against before deciding whether the paragraph below
 * is worth their time.
 *
 * Renders nothing on an empty array rather than an empty rule, because a
 * player who arrived this offseason genuinely has no line to quote here and a
 * bar of dots with nothing between them would be worse than the gap.
 */
function outlookStats(stats: string[]): string {
  if (stats.length === 0) return "";
  return (
    `<ul class="sct-outlook-stats">` +
    stats
      .map((stat) => `<li class="sct-outlook-stat">${escapeHtml(stat)}</li>`)
      .join("") +
    `</ul>`
  );
}

/**
 * One player's card: a face, the call, the evidence, the case.
 *
 * The same card every other player on this page gets - the .sct-player shell,
 * the depth chart's round team-tinted headshot well, and the position chip both
 * of them already use. The take is what is different about this block; the card
 * it arrives in should not be.
 *
 * The card reads top to bottom in decreasing commitment, which is what lets a
 * reader stop at any point and still have taken something away: the tier is the
 * answer, the thesis is the answer in a sentence, the stat row is what the
 * sentence rests on, and the paragraph is for the reader who has decided this
 * player matters to them. It used to be a name and then four sentences, which
 * asked for all of that attention or none of it.
 *
 * `data-pos` is on the card as well as the chip so the stylesheet can put the
 * position's color on the card's edge - see the inset accent in team.css.
 *
 * `live` is whatever the roster could match by name, and null is an ordinary
 * outcome: an outlook can name a rookie Sleeper has not indexed yet. The well is
 * drawn either way and simply stays a tinted disc, which is the same degradation
 * the depth chart takes when the CDN has no thumbnail; an unmatched name simply
 * carries no designation, exactly as it did before there was one to carry.
 */
function outlookPlayerCard(
  player: OutlookPlayer,
  live: RosterPlayer | null,
): string {
  const position = player.position.toUpperCase();
  const headshot = live?.headshot ?? null;

  // Decorative, so the alt is empty: the name is on the same row, and
  // announcing the face as well would read the player out twice.
  // The 160px square derivative covers the 64px well at 2x (headshot-html.ts).
  const photo =
    headshotImg({
      src: headshot,
      className: "sct-outlook-photo",
      alt: "",
      variants: ["160"],
      width: 64,
      height: 64,
      loading: "lazy",
    }) ?? "";

  // The name carries the link and a stretched ::after makes the whole card
  // clickable - the news card's device rather than the cornerstone's bare
  // overlay, because that one lays a box over the card's whole text and these
  // cards carry a paragraph a reader may well want to select.
  const href = getPlayerProfileUrl(player.name);
  const name = href
    ? `<a class="sct-outlook-link" href="${escapeHtml(href)}" target="_top">` +
      `${escapeHtml(player.name)}</a>`
    : escapeHtml(player.name);

  // Text beside the chip rather than a pill of its own. A second lozenge on
  // this line is what the market-rank and verdict chips were, and the reason
  // they went; the classification is a continuation of "QB", not a badge
  // competing with it.
  const tier = player.tier
    ? `<span class="sct-dot" aria-hidden="true"></span>` +
      `<span class="sct-outlook-tier">${escapeHtml(player.tier)}</span>`
    : "";

  // After the tier, not before it: the chip and the classification are what the
  // card is about, and the designation is the thing that has happened to it.
  const designation = live ? injuryBadge(live) : "";

  return (
    `<li class="sct-outlook-player" data-pos="${escapeHtml(position)}">` +
    `<div class="sct-outlook-head">` +
    `<span class="sct-outlook-well">${photo}</span>` +
    `<div class="sct-outlook-who">` +
    `<h4 class="sct-outlook-name">${name}</h4>` +
    `<p class="sct-outlook-meta">` +
    slotChip(position, true) +
    tier +
    designation +
    `</p>` +
    `</div>` +
    `</div>` +
    (player.thesis
      ? `<p class="sct-outlook-thesis">${escapeHtml(player.thesis)}</p>`
      : "") +
    outlookStats(player.stats) +
    `<p class="sct-outlook-note">${escapeHtml(player.note)}</p>` +
    `</li>`
  );
}

/**
 * One band of players under its own heading.
 *
 * The heading is the take: "Core fantasy pieces" is an assertion about which
 * four of the seven decide a draft, and it is the reason this section is a
 * curated list rather than a roster dump. It is an <h3> under the section's
 * <h2>, which is what puts the player names at <h4> - the outline follows the
 * page rather than the other way round.
 *
 * Every card in every band carries the team crest as a watermark - the page's
 * existing device (.sct-news-body::before), not a new one. It briefly ran on
 * the core band alone as that band's emphasis; with it on all of them the
 * heading is what tells the bands apart.
 */
function outlookGroup(
  group: OutlookGroup,
  live: Map<string, RosterPlayer>,
): string {
  if (group.players.length === 0) return "";
  const cards = group.players
    .map((player) =>
      outlookPlayerCard(player, live.get(searchKey(player.name)) ?? null),
    )
    .join("");
  return (
    `<div class="sct-band">` +
    `<h3 class="sct-band-label">${escapeHtml(group.label)}</h3>` +
    `<ul class="sct-outlook-players">${cards}</ul>` +
    `</div>`
  );
}

/**
 * The live roster entry for a name the outlook mentions.
 *
 * Matched on searchKey rather than the raw string, the same normalization the
 * news pipeline attributes stories with - the outlook is written by hand and
 * "A.J. Brown" should find "AJ Brown" whichever way Sleeper spells it.
 *
 * It used to return the headshot alone. The whole entry, because the outlook is
 * a written opinion with no idea what has happened since: a paragraph about the
 * alpha this offense just traded for reads very differently beside an IR badge,
 * and the badge is the only part of that card the page can keep current.
 */
function outlookRoster(data: TeamPageData): Map<string, RosterPlayer> {
  const byName = new Map<string, RosterPlayer>();
  for (const player of data.roster?.players ?? []) {
    const key = searchKey(player.name);
    if (key && !byName.has(key)) byName.set(key, player);
  }
  return byName;
}

/**
 * Every question the page has rendered, in render order.
 *
 * Collected rather than recomputed. Four tabs carry an FAQ and each decides for
 * itself whether it renders at all - the outlook drops out once its season has
 * passed, the stats block drops out when ESPN gave us nothing, the schedule's
 * questions go with its fixtures - so the only way to be certain the structured
 * data describes what is actually on the page is for the sections to hand over
 * the questions as they draw them. Recomputing the same lists a second time for
 * the schema would work right up until one of those guards changed on one side
 * only.
 */
type FaqSink = OutlookFaq[];

/**
 * The question list, and its entry in the page's FAQ.
 *
 * Shared by every tab that carries questions - the outlook, the stat lines, the
 * depth chart and the schedule, built in team/outlook-faq.ts, team/stats-faq.ts,
 * team/depth-faq.ts and team/schedule-faq.ts respectively. That is where the
 * answers come from and where the rule that they may only restate what is
 * already rendered is enforced.
 *
 * Markup only: the schema for both is emitted once, at the page level. A
 * document is allowed one FAQPage, and two nodes - one per tab - is the failure
 * mode that gets structured data ignored outright rather than the second one
 * merged into the first.
 *
 * Each question is its own <details>, shut by default: the questions all show,
 * and the answer opens under the one that was actually asked. A single fold
 * around the whole block hid the questions too, which is the opposite of what
 * an index is for. The questions stay in the DOM either way - a crawler reads
 * the DOM, not the open state, and the FAQPage node is built from the same
 * list.
 *
 * The heading and the wrapper belong to the caller, because the two FAQs sit at
 * different depths and a question has to be one level under whatever introduces
 * it. On Outlook the FAQ is a band of the outlook section, so it closes an
 * <h2> that is already on the screen and its questions are <h4> beside the
 * player names. On Stats the tab is a run of <h2> blocks with nothing to belong
 * to, so it takes an <h2> of its own and its questions are <h3>. Hard-coding
 * one of those put eight questions in the page outline underneath "Season
 * History", which is not where they are and not what they are about.
 */
function faqList(items: OutlookFaq[], sink: FaqSink, tag: "h3" | "h4"): string {
  if (items.length === 0) return "";
  sink.push(...items);

  const body = items
    .map(
      (entry) =>
        `<details class="sct-faq-item">` +
        `<summary class="sct-faq-q-row">` +
        `<${tag} class="sct-faq-q">${escapeHtml(entry.question)}</${tag}>` +
        `</summary>` +
        `<p class="sct-faq-a">${escapeHtml(entry.answer)}</p>` +
        `</details>`,
    )
    .join("");

  return `<div class="sct-faq">${body}</div>`;
}

/**
 * An FAQ as a page-level block - the shape every tab's questions take.
 *
 * The block itself does not fold: the questions ARE the index, and a reader
 * scanning for the one they arrived with has to be able to see them without
 * opening anything. The folding happens one level down, per question - see
 * faqList().
 *
 * An <h2>, because of where this lands. The block renders after the "More
 * <team> Tools" block rather than inside its panel (see `Section.tail`), and
 * that block is an <h2> - so a band heading here would file the questions in
 * the outline under the tool list, which is neither where they are nor what
 * they are about. At <h2> they are a section of the page, which is what they
 * now are, and their questions sit at <h3> under it.
 *
 * `note` qualifies every question below it, so it sits above them: the Stats
 * questions are all scoped to a window its season note states.
 */
function faqBlock(list: string, note = ""): string {
  if (!list) return "";
  return (
    `<div class="sct-block">` +
    h2("Common Questions") +
    (note ? `<p class="sct-note">${escapeHtml(note)}</p>` : "") +
    list +
    `</div>`
  );
}

/**
 * The Schedule page's games as an ItemList - see team/schedule-schema.ts.
 *
 * Carried the way faqSchema() carries the questions: an inert island in an
 * embed, for the plugin to graft into Rank Math's graph, and JSON-LD of its own
 * on the standalone page. Only the Schedule section page emits it; the hub
 * describes a team, and a list of games there would describe one tab of it.
 */
function scheduleSchema(data: TeamPageData, options: TeamRenderOptions): string {
  const node = data.schedule ? scheduleItemList(data.team, data.schedule) : null;
  if (!node) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="sct-schedule-data">` +
      escapeJsonLd(JSON.stringify(node)) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(JSON.stringify({ "@context": "https://schema.org", ...node })) +
    `</script>`
  );
}

/**
 * The page's FAQPage node, or the inert island the plugin builds it from.
 *
 * Standalone, this is the node itself. Embedded, it is the same questions as
 * DATA: WordPress owns the document and Rank Math owns its schema graph, so a
 * second `<script type="application/ld+json">` injected into the host page from
 * inside a mounted fragment competes with the graph rather than joining it -
 * the same reasoning as the embed mount adding no canonical and no H1.
 *
 * Emitting nothing was the previous answer, and it was the wrong one. The
 * indexed URL is the WordPress one, so suppressing the node there meant the
 * questions were rendered for readers and invisible to crawlers - which is
 * most of the reason an FAQ is on the page at all. The island closes that:
 * statchasers-team.php lifts it into Rank Math's graph and strips it from the
 * markup before printing, so the questions arrive inside the one <script> the
 * page already emits.
 *
 * Data rather than the plugin re-reading the rendered HTML, for the reason
 * given on player-render.ts's renderFaq(): by then the answers have been
 * escaped for display, and putting them back together means un-escaping prose
 * in PHP to feed a crawler. This is the array the answers were built from.
 */
function faqSchema(items: FaqSink, options: TeamRenderOptions): string {
  if (items.length === 0) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="sct-faq-data">` +
      escapeJsonLd(
        JSON.stringify(
          items.map((entry) => ({ q: entry.question, a: entry.answer })),
        ),
      ) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
      }),
    ) +
    `</script>`
  );
}

/**
 * The team's draft-season take, on the Outlook tab.
 *
 * Nothing here is fetched, and the meta line says so. Every other block on this
 * page carries a timestamp because it was pulled from a provider minutes ago;
 * this one is a written opinion that will not change until somebody changes it.
 * The line carries the month it was last written for the same reason a byline
 * carries a date - it is the only thing that lets a reader judge how much of it
 * the season has already overtaken - and it keeps "not live data" beside that
 * date so the date cannot be mistaken for a refresh.
 */
function renderOutlook(
  data: TeamPageData,
  faq: FaqSink,
  tail: TailSink,
): string {
  const outlook = getTeamOutlook(data.team.abbreviation);
  if (!outlook) return "";

  const live = outlookRoster(data);
  const groups = outlook.groups.map((group) => outlookGroup(group, live)).join("");
  if (!groups) return "";

  // An outlook written for a season the calendar has passed is dropped rather
  // than dated. "A.J. Brown arrives" is true for one offseason and misleading
  // forever after, and a heading reading 2026 on a 2027 page does not rescue
  // the sentence under it - the reader has already taken the advice. Nothing
  // rewrites these but a person, so the page removes them instead of aging
  // them.
  if (outlook.season < data.state.season) return "";

  const facts = outlook.facts.length
    ? `<dl class="sct-outlook-facts">${outlook.facts.map(outlookFact).join("")}</dl>`
    : "";

  const meta = [
    // "Preseason outlook" stops being true the moment Week 1 kicks off, and
    // these takes are not rewritten in-season - so once the season is under way
    // the label says when the take was written rather than implying it is
    // current. Same honesty rule as the record in the hero: see team/nfl-state.
    data.state.regularSeasonUnderway
      ? "Written before Week 1"
      : "Preseason outlook",
    ...(outlook.updated ? [`Updated ${outlook.updated}`] : []),
  ]
    .map(
      (part) =>
        `<span class="sct-outlook-meta-item">${escapeHtml(part)}</span>`,
    )
    .join(`<span class="sct-dot" aria-hidden="true"></span>`);

  const bottomLine = outlook.bottomLine
    ? `<p class="sct-outlook-bottom">` +
      `<span class="sct-outlook-bottom-label">Bottom line</span>` +
      escapeHtml(outlook.bottomLine) +
      `</p>`
    : "";

  // Below the tools block rather than under the bottom line. The closing take
  // is the end of the argument this section makes, and the FAQ is that argument
  // re-cut into the forms people search for - it reads as an appendix either
  // way, so it sits past the furniture instead of between the cards and their
  // conclusion. Assigned here, after the early returns: a tab that renders no
  // outlook must not leave questions about one on the page.
  tail.html = faqBlock(faqList(outlookFaq(data.team, outlook), faq, "h3"));

  return (
    `<div class="sct-block">` +
    // Printed on a section page too - the hero is the club's name alone and
    // this is what names the panel. See teamHeader().
    h2(`${outlook.season} Fantasy Outlook`) +
    `<p class="sct-outlook-stamp">${meta}</p>` +
    `<p class="sct-outlook-lede">${escapeHtml(outlook.summary)}</p>` +
    facts +
    groups +
    bottomLine +
    `</div>`
  );
}

/**
 * The four depth-chart starters, as photo cards.
 *
 * NOT CURRENTLY MOUNTED. This sat under the outlook on the Outlook tab and was
 * taken off it; nothing calls this today. It is kept rather than deleted
 * because the block is complete and correct and the page has already moved one
 * section between tabs this week - the cost of keeping it is a function nobody
 * calls, and the cost of deleting it is writing it again. If it is still
 * unmounted when the hub next settles, delete it along with the .sct-player
 * rules in team.css (all but .sct-player-link, which the news byline uses).
 */
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
            ` aria-label="${escapeHtml(
              [player.name, player.slot, injuryDetail(player)]
                .filter(Boolean)
                .join(", "),
            )}"></a>`
          : "") +
        `<div class="sct-player-well">` +
        // The well is a square of up to 200px: the three square derivatives
        // cover it from 1x to 2x. A player with no photo keeps the bare well.
        (headshotImg({
          src: player.headshot,
          className: "sct-player-photo",
          alt: player.name,
          variants: ["160", "256", "320"],
          sizes: "200px",
          width: 150,
          height: 150,
          loading: "lazy",
        }) ?? "") +
        // Pinned to the top-right corner of the photo rather than sitting in
        // the body under the name: the status belongs to the face, and down
        // there it pushed the name, slot and CTA around by a row height on
        // exactly the cards that were already the busiest.
        injuryBadge(player, "is-pinned") +
        `</div>` +
        `<div class="sct-player-body">` +
        // Name first, position beneath it. The slot used to lead, which read as
        // a label the card was filed under rather than as a fact about the
        // player; with the photo above, the name is what the eye is looking
        // for. Matches the hit link's aria-label, which already says
        // "<name>, <slot>".
        `<p class="sct-player-name">${escapeHtml(player.name)}</p>` +
        slotChip(player.slot) +
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

/** The card's stamp line - the shared one, under this page's class prefix. */
function newsStamp(item: NewsItem): string {
  return sharedNewsStamp(item, itemTimestamp(item), "sct");
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

  // 16:9 on the attributes, matching the band the CSS cuts. These are the
  // browser's before-load aspect hint, not a size - the well's own
  // aspect-ratio governs once the stylesheet is in - and the square they used
  // to declare was a headshot's shape, from before the clubs' landscape art
  // was the common case.
  // A Sleeper headshot comes as its one 16:9 band derivative; a club's
  // landscape art as the bands at the widths the wells are drawn, with the
  // browser choosing by the well's width (headshot-html.ts drops the
  // variants a source does not produce, so one list serves both).
  const media =
    (image
      ? headshotImg({
          src: image,
          className: "sct-news-photo",
          alt: name,
          variants: ["b350", ...CLUB_BAND_VARIANTS],
          sizes: featured ? "(max-width: 700px) 100vw, 640px" : "(max-width: 700px) 100vw, 480px",
          width: featured ? 640 : 480,
          height: featured ? 360 : 270,
          loading: "lazy",
        })
      : null) ??
    // No image: the well keeps its team tint and shows nothing else. A
    // stand-in mark would be one more thing to load for no information.
    `<span class="sct-news-photo-empty" aria-hidden="true"></span>`;

  const byline =
    name || team.fullName
      ? `<p class="sct-news-byline">` +
        (name ? playerName(name, "sct-news-player") : "") +
        `<span class="sct-news-team">${escapeHtml(team.fullName)}</span>` +
        `</p>`
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

  return (
    h2(`Latest ${team.nickname} News`) +
    renderNewsList(visible, team, 0) +
    more
  );
}

/* ---------------------------------------------------------- injury watch */

function renderInjuryPanel(data: TeamPageData): string {
  const rows = data.injuries;

  // No roster snapshot at all: say nothing rather than claim a clean bill of
  // health we have not checked.
  if (!data.roster) return "";

  const body = rows.length
    ? `<ul class="sct-injuries">` +
      rows
        .map(
          (player) =>
            `<li class="sct-injury">` +
            // A face instead of the slot chip (mak, 2026-10-22). Decorative:
            // the name is on the same row. The 160px square derivative covers
            // the 36px well at 2x and then some; no photo keeps the bare well
            // so the columns stay aligned.
            `<span class="sct-injury-well" aria-hidden="true">` +
            (headshotImg({
              src: player.headshot,
              className: "sct-injury-photo",
              alt: "",
              variants: ["160"],
              width: 36,
              height: 36,
              loading: "lazy",
            }) ?? "") +
            `</span>` +
            playerName(player.name, "sct-injury-name") +
            `<span class="sct-injury-status"` +
            ` data-severity="${injurySeverity(player.injuryStatus)}">` +
            `${escapeHtml(player.injuryStatus ?? "")}</span>` +
            // Body part and practice status share the line under the name. Two
            // stacked lines of gray footnote made a two-player card as tall as
            // the news column beside it, and the pair reads as one qualifier.
            ((player.injuryBodyPart ? 1 : 0) + (player.practice ? 1 : 0)
              ? `<span class="sct-injury-detail">` +
                [player.injuryBodyPart, player.practice]
                  .filter(Boolean)
                  .map((part) => escapeHtml(String(part)))
                  .join(` <span class="sct-injury-dot">·</span> `) +
                `</span>`
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
    `</section>`
  );
}

/* ------------------------------------------------------------- next game */

/**
 * The two halves of "when", as the cards print them.
 *
 * Three states, and the model decides which: a confirmed kickoff prints its
 * day and its time; a confirmed date with no time prints the day and "Time
 * TBD"; a game the league has not scheduled prints "Date/Time TBD" and
 * nothing else. The feeds' placeholder Sunday never reaches this function -
 * lib/schedule/schedule-data.ts clears it before the game is built.
 */
export function gameDateLine(game: ScheduleGame): {
  date: string;
  time: string;
} {
  if (game.kickoffMs === null || !game.dateConfirmed) {
    return { date: "Date/Time TBD", time: "" };
  }
  const parts = easternParts(game.kickoffMs);
  return {
    date: `${parts.weekday}, ${parts.month} ${parts.day}`,
    time: game.timeConfirmed ? parts.time : "Time TBD",
  };
}

/**
 * "Sep 13" - the date as a table column rather than as a line of prose, and
 * "TBD" for a game the league has not dated.
 *
 * The same month/day pair lib/schedule/format.ts's formatShortDate() sets for
 * the standalone tool, from this file's own Eastern parse so the row's date and
 * its kickoff cannot disagree about which day a late game falls on.
 */
export function gameShortDate(game: ScheduleGame): string {
  if (game.kickoffMs === null || !game.dateConfirmed) return "TBD";
  const parts = easternParts(game.kickoffMs);
  return `${parts.month} ${parts.day}`;
}

/** "Sun, Nov 8" - the short date with its weekday, for the boards. */
function gameShortDay(game: ScheduleGame): string {
  if (game.kickoffMs === null || !game.dateConfirmed) return "TBD";
  const parts = easternParts(game.kickoffMs);
  return `${parts.weekday}, ${parts.month} ${parts.day}`;
}

/**
 * One side of the matchup: crest, code, name.
 *
 * `isTeam` marks the side this page is about, which is the whole reason the
 * card can afford to draw both of them - on a hub for one team, an undifferentiated
 * pair reads as a fixture list rather than as "your next game".
 */
export function matchupSide(
  team: NflTeam | null,
  fallbackName: string,
  isTeam: boolean,
): string {
  const logo = team
    ? `<img class="sct-matchup-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="40" height="40" loading="lazy" decoding="async" />`
    : "";
  // The abbreviation is the headline and the nickname the gloss, which is the
  // way a scoreboard reads. With no canonical team behind the name - ESPN
  // naming an opponent the table does not know - there is no code to print, so
  // the name takes the headline and nothing is faked in its place.
  const code = team
    ? `<span class="sct-matchup-code">${escapeHtml(team.abbreviation.toUpperCase())}</span>`
    : "";
  const name = team?.nickname ?? fallbackName;
  return (
    `<div class="sct-matchup-side${isTeam ? " is-team" : ""}">` +
    logo +
    code +
    `<span class="sct-matchup-name${code ? "" : " is-lead"}">${escapeHtml(name)}</span>` +
    `</div>`
  );
}

/**
 * "Next Game", "Today's Game" or "Live Now" - what the next fixture is called
 * at this moment. "Today" is only ever said on the day; it is computed per
 * render and gone the next morning.
 */
function nextGameLabel(game: ScheduleGame, now: number): string {
  if (game.status === "live") return "Live Now";
  if (game.status === "postponed") return "Postponed";
  if (isOnDate(game, easternDate(now))) return "Today's Game";
  return "Next Game";
}

function renderNextGamePanel(data: TeamPageData, now: number): string {
  const next = nextGame(data.schedule, now);
  if (!next) return "";
  const when = gameDateLine(next);
  const neutral = next.site === "neutral";
  const away = next.site === "away";

  // Away side first, home side second - the order every scoreboard uses, so the
  // card says who is traveling without a word for it. A neutral-site game has
  // no host to put second, so it reads "vs" and keeps this team on the left.
  const left = away || neutral ? data.team : next.opponent;
  const right = away || neutral ? next.opponent : data.team;
  const leftIsTeam = away || neutral;

  const matchup =
    // Hidden wholesale from assistive tech, with the sentence below carrying
    // the fact instead. Read out, the three crests and two codes are "NE
    // Patriots at SEA Seahawks" - every name twice and two airport codes.
    `<div class="sct-matchup" aria-hidden="true">` +
    matchupSide(
      left,
      leftIsTeam ? data.team.nickname : next.opponentName,
      leftIsTeam,
    ) +
    `<span class="sct-matchup-at" aria-hidden="true">` +
    `${neutral ? "vs" : "@"}</span>` +
    matchupSide(
      right,
      leftIsTeam ? next.opponentName : data.team.nickname,
      !leftIsTeam,
    ) +
    `</div>` +
    // The visual matchup is three logos and two codes, which a screen reader
    // would read as an alphabet. This is the same fact as a sentence.
    `<p class="sct-visually-hidden">${escapeHtml(
      `${data.team.nickname} ${neutral ? "vs" : away ? "at" : "host"} ` +
        `${next.opponent?.nickname ?? next.opponentName}${neutral ? " at a neutral site" : ""}`,
    )}</p>`;

  // One line of context, and only when it is about the fixture actually shown -
  // see TeamPageData.nextOpponentDefense on why the two can disagree. Points
  // allowed per game with its rank, because it is the one defensive number that
  // needs no explanation and it is the number a manager is asking about.
  const defense = data.nextOpponentDefense;
  const context =
    defense &&
    next.opponent &&
    defense.abbreviation === next.opponent.abbreviation &&
    defense.rankLabel
      ? `<p class="sct-matchup-note">` +
        `<span class="sct-matchup-note-team">${escapeHtml(next.opponent.nickname)} defense</span>` +
        `<span class="sct-matchup-note-value">${escapeHtml(defense.rankLabel)}` +
        `<span class="sct-matchup-note-unit"> · ${escapeHtml(defense.value)} pts/g</span>` +
        `</span></p>`
      : "";

  return (
    `<section class="sct-panel">` +
    // Rearranged at mak's request (2026-10-22): the week sits on the title's
    // row, hard right; the date and time take the line the week used to hold,
    // above the matchup; the venue line is gone.
    `<h2 class="sct-panel-title">${escapeHtml(nextGameLabel(next, now))}` +
    `<span class="sct-nextgame-week">${escapeHtml(next.weekLabel)}</span>` +
    `</h2>` +
    `<p class="sct-nextgame-when">${escapeHtml(when.date)}` +
    (when.time ? `<span class="sct-nextgame-time"> · ${escapeHtml(when.time)}</span>` : "") +
    (next.network ? `<span class="sct-nextgame-time"> · ${escapeHtml(next.network)}</span>` : "") +
    `</p>` +
    matchup +
    context +
    `</section>`
  );
}

/* --------------------------------------------------------------- matchups */

/**
 * The pair page for this team against that opponent, or null.
 *
 * Plain anchors, no `target="_top"`. That attribute belongs to siteLink(),
 * which leaves this tool for the main site; a matchup page is one of the tool's
 * own pages, so these are switcher links and are written like them. Given the
 * target, a sandboxed preview frame blocks the navigation outright and the link
 * does nothing at all.
 */
function matchupHref(
  team: NflTeam,
  opponent: NflTeam | null,
  options: TeamRenderOptions,
): string | null {
  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const query = options.linkQuery ?? "";
  const pair = canonicalizeMatchupPair(team, opponent);
  return pair ? `${prefix}${pair.slug}/${query}` : null;
}

/**
 * The page for one meeting on this team's schedule, or null.
 *
 * matchupHref() names the pair; this names the game. A finished meeting the
 * pair's page has stopped owning - an earlier meeting this season, or the
 * latest once the rematch is within six days - has a dated address of its
 * own, and a row for that week has to point there or it opens the other
 * meeting's preview. The rule is meetingHasOwnAddress(), asked the same way
 * schedule-render.ts asks it, so neither side keeps its own copy of it. The
 * hub's schedule is the season in progress, so its season is the current one.
 */
function gameMatchupHref(
  team: NflTeam,
  game: ScheduleGame,
  schedule: TeamSchedule,
  options: TeamRenderOptions,
  now: number,
): string | null {
  const base = matchupHref(team, game.opponent, options);
  if (!base || !game.opponent) return base;
  const meetings = schedule.games
    .filter((other) => other.opponent?.abbreviation === game.opponent?.abbreviation)
    .map((other) => ({ kickoffMs: other.kickoffMs, isFinal: other.status === "final" && !!other.result }));
  const own = meetingHasOwnAddress(
    { kickoffMs: game.kickoffMs, isFinal: game.status === "final" && !!game.result, season: schedule.season },
    meetings,
    schedule.season,
    now,
  );
  if (!own) {
    return base;
  }
  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const query = options.linkQuery ?? "";
  const pair = canonicalizeMatchupPair(team, game.opponent);
  return pair
    ? `${prefix}${pair.slug}/${gameSegment({ season: schedule.season, week: game.week, seasonType: game.seasonType })}/${query}`
    : base;
}

/**
 * Every pair page this team is one half of, grouped by the opponent's division.
 *
 * The schedule rows link the 17 or so opponents on this season's slate, and a
 * finished meeting's row moves on to the game's own dated page once the pair's
 * page lets go of it (gameMatchupHref). Between the two, most of the 496 pair
 * pages ended up with no inbound link at all: a Rank Math crawl on 2026-10-08
 * found 294 of them orphaned. This block is the fix at the source. All 31
 * opponents, every season, on both clubs' hubs, so every pair page is reached
 * from two hubs whether or not the teams meet this year.
 *
 * The visible text is the opponent alone - the heading above already names
 * this team - but the anchor reads "Patriots vs Bills" in full, so a crawler
 * and a screen reader both get the pair the link opens.
 */
function renderSeriesIndex(team: NflTeam, options: TeamRenderOptions): string {
  const groups = TEAM_GROUPS.flatMap((conference) => conference.divisions)
    .map((division) => {
      const links = division.teams
        .filter((opponent) => opponent.abbreviation !== team.abbreviation)
        .map((opponent) => {
          const href = matchupHref(team, opponent, options);
          if (!href) return "";
          return (
            `<li><a class="sct-series-link" href="${escapeHtml(href)}">` +
            `<img class="sct-series-logo" src="${escapeHtml(opponent.logo)}" alt=""` +
            ` width="18" height="18" loading="lazy" decoding="async" />` +
            `<span class="sct-visually-hidden">${escapeHtml(`${team.nickname} vs `)}</span>` +
            `${escapeHtml(opponent.nickname)}</a></li>`
          );
        })
        .join("");
      if (!links) return "";
      return (
        `<div class="sct-series-group">` +
        `<span class="sct-series-div">${escapeHtml(division.division)}</span>` +
        `<ul class="sct-series-list">${links}</ul>` +
        `</div>`
      );
    })
    .join("");
  if (!groups) return "";
  return (
    `<nav class="sct-series" aria-label="${escapeHtml(`${team.nickname} head-to-head pages`)}">` +
    `<h3 class="sct-mu-h3">${escapeHtml(`${team.nickname} vs Every Team`)}</h3>` +
    `<div class="sct-series-groups">${groups}</div>` +
    `</nav>`
  );
}

/**
 * The Matchups hub: how this team compares with each opponent.
 *
 * Not the schedule again. Schedule answers "when do they play"; this answers
 * "who are they playing and how do the two compare" - every row is a door into
 * the pair's own page. Two meetings with a divisional opponent are two rows,
 * each with its own week, both opening the same evergreen page: the pair is
 * canonicalized once, in matchup/pair.ts, and nothing here can produce a
 * second address for it.
 */
function renderMatchups(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const hrefFor = (opponent: NflTeam | null): string | null =>
    matchupHref(team, opponent, options);

  const next = nextGame(schedule, now);
  const nextHref = next ? hrefFor(next.opponent) : null;
  const when = next ? gameDateLine(next) : null;
  // Away side first, as the Next Game card does; a neutral site keeps this
  // team on the left and reads "vs".
  const teamLeft = !!next && next.site !== "home";
  const upNext =
    next && nextHref && when
      ? `<div class="sct-mu-upnext">` +
        `<p class="sct-game-next">Up next</p>` +
        `<div class="sct-matchup" aria-hidden="true">` +
        matchupSide(
          teamLeft ? team : next.opponent,
          teamLeft ? team.nickname : next.opponentName,
          teamLeft,
        ) +
        `<span class="sct-matchup-at">${next.neutralSite ? "vs" : "@"}</span>` +
        matchupSide(
          teamLeft ? next.opponent : team,
          teamLeft ? next.opponentName : team.nickname,
          !teamLeft,
        ) +
        `</div>` +
        `<p class="sct-visually-hidden">${escapeHtml(`${team.nickname} ${next.site === "neutral" ? "vs" : next.site === "away" ? "at" : "host"} ${next.opponent?.nickname ?? next.opponentName}`)}</p>` +
        `<p class="sct-nextgame-when">${escapeHtml(`Week ${next.week} · ${when.date}`)}${when.time ? `<span class="sct-nextgame-time"> · ${escapeHtml(when.time)}</span>` : ""}</p>` +
        `<p class="sct-block-footer"><a class="sct-textlink" href="${escapeHtml(nextHref)}">View matchup ${ARROW}</a></p>` +
        `</div>`
      : "";

  const rows = schedule.games
    .map((game) => {
      const href = gameMatchupHref(team, game, schedule, options, now);
      const line = gameDateLine(game);
      const status = game.result
        ? `<span class="sct-mu-result">${escapeHtml(`${game.result.outcome} ${game.result.teamScore}–${game.result.opponentScore}`)}</span>`
        : `<span class="sct-mu-result is-pending">${game.status === "live" ? "Live" : game.status === "postponed" ? "Postponed" : game.status === "canceled" ? "Canceled" : "Upcoming"}</span>`;
      const opponentName = game.opponent?.nickname ?? game.opponentName;
      return (
        `<li class="sct-srow sct-mu-row">` +
        `<span class="sct-srow-week">${escapeHtml(`WK ${game.week}`)}</span>` +
        `<span class="sct-srow-opp">` +
        (game.opponent
          ? `<img class="sct-srow-logo" src="${escapeHtml(game.opponent.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async" />`
          : "") +
        `<span class="sct-srow-name">${escapeHtml(
          game.site === "away" ? `${opponentName} vs ${team.nickname}` : `${team.nickname} vs ${opponentName}`,
        )}</span></span>` +
        `<span class="sct-srow-when">${escapeHtml(line.date)}</span>` +
        status +
        (href
          ? `<a class="sct-textlink sct-mu-view" href="${escapeHtml(href)}">${game.status === "final" ? "View Recap" : "View matchup"} ${ARROW}</a>`
          : `<span class="sct-mu-view"></span>`) +
        `</li>`
      );
    })
    .join("");

  return (
    h2(`${team.nickname} Matchups`) +
    upNext +
    `<h3 class="sct-mu-h3">${escapeHtml(`${schedule.season} Matchups`)}</h3>` +
    `<ol class="sct-slist sct-mu-list">${rows}</ol>` +
    renderSeriesIndex(team, options)
  );
}

/* ------------------------------------------------------------ quick links */

interface ResourceCard {
  /**
   * One spelling, used by both the cards and the Quick Links rail.
   *
   * There were two - a "Patriots Player Profiles" for the cards and a "Player
   * Profiles" for the rail - because the cards could be lifted onto any page
   * and had to say which team they were for, while the rail sits on a page
   * whose hero, nav and every heading already say Patriots. Nothing here is
   * scoped to a team any more, so there is no team name to take off.
   */
  title: string;
  body: string;
  href: string;
}

function resourceCards(team: NflTeam): ResourceCard[] {
  const candidates: Array<[string | null, string, string]> = [
    // First: it is the way out of the hub and into the rest of the site, which
    // is what the block is for.
    [
      getToolsUrl(),
      "Fantasy Football Tools",
      "The #1 ranked fantasy football toolset.",
    ],
    [
      getPlayerStatsUrl(),
      "Advanced Player Stats",
      "Deeper numbers on every player in the league.",
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
  // The whole set, not a truncation. Since the page's bottom block became
  // "Use this research" (products and next pages, mak 2026-10-05), this News
  // rail is the hub's only route to these tools, so dropping a row here would
  // leave that tool unreachable.
  const cards = resourceCards(team);
  if (cards.length === 0) return "";
  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Quick Links</h2>` +
    `<ul class="sct-quicklinks">` +
    cards
      .map(
        (card) =>
          `<li class="sct-quicklink-item">` +
          siteLink(
            card.href,
            `<span class="sct-quicklink-text">${escapeHtml(card.title)}</span>${ARROW}`,
            "sct-quicklink",
          ) +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ depth chart */

/**
 * The name cell: one spelling, or two for the names that need shortening.
 *
 * Both are emitted when a short form exists, and CSS picks - the brief one
 * while the chart is four across, the full one from the breakpoint where it
 * drops to two columns and the room is there. Doing it this way rather than
 * choosing on the server is what keeps the abbreviation tied to the width that
 * caused it: one cached fragment serves every viewport, and a phone showing
 * "R. Stevenson" down a full-width column would be shortening a name to fit a
 * column it is not in.
 *
 * The full name is the one in the accessibility tree either way - the brief
 * span is aria-hidden, and the long one is only ever hidden visually - so a
 * screen reader reads "Rhamondre Stevenson" at every width, once.
 */
function depthName(player: { name: string }): string {
  const brief = briefName(player.name);
  if (!brief) return playerName(player.name, "sct-depth-name");
  return playerName(
    player.name,
    "sct-depth-name",
    `<span class="sct-depth-name-long">${escapeHtml(player.name)}</span>` +
      `<span class="sct-depth-name-brief" aria-hidden="true">${escapeHtml(brief)}</span>`,
  );
}

/**
 * The strings the chart prints across; anyone deeper goes to the "Also
 * listed" strip. "Starter", not "First": the football chart's first column is
 * the player who starts at that slot, and the word keeps it apart from the
 * fantasy chart's WR1 / WR2, which is a ranking (mak's brief, 2026-11-03).
 */
const DEPTH_COLUMNS = ["Starter", "Second", "Third", "Fourth"] as const;

/**
 * The tool's movement mark against the last refresh: an arrow beside the name
 * for a player who moved, a NEW chip for one who was not listed before.
 */
function depthMovement(row: DepthRow): string {
  if (row.movement === "up") {
    return `<span class="sct-dc-move is-up" title="Moved up"><span aria-hidden="true">▲</span><span class="sct-visually-hidden">Moved up</span></span>`;
  }
  if (row.movement === "down") {
    return `<span class="sct-dc-move is-down" title="Moved down"><span aria-hidden="true">▼</span><span class="sct-visually-hidden">Moved down</span></span>`;
  }
  return "";
}

/**
 * Sleeper's `search_full_name` for a name the depth tool spells its own way:
 * lowercase, letters and digits only. "Lloyd Cushenberry III" is indexed as
 * "lloydcushenberry", so the suffix-stripped key is tried after the full one.
 */
function sleeperSearchKeys(name: string): string[] {
  const full = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const brief = nameKey(name).replace(/[^a-z0-9]/g, "");
  return brief && brief !== full ? [full, brief] : [full];
}

/**
 * Seasons of experience for a charted player, from the Sleeper dictionary.
 *
 * Null when he is not indexed, when the name is on two teams (the index drops
 * those rather than guess), or when the cache predates the field. The team is
 * checked so a Josh Allen on the Bills' chart never reads another Josh Allen's
 * service time.
 */
function depthExperience(team: NflTeam, name: string): number | null {
  const keys = sleeperSearchKeys(name);
  for (const key of keys) {
    const hit = playerForSearchKey(key);
    if (!hit) continue;
    if (hit.team !== team.abbreviation) return null;
    return typeof hit.yearsExp === "number" ? hit.yearsExp : null;
  }
  // The other way round: the tool prints "James Cook" for the man Sleeper
  // indexes as "James Cook III". One teammate whose key starts with this
  // name is him; two is a guess this does not make.
  const prefix = keys[0] ?? "";
  const onTeam = prefix ? nameKeysForTeam(team.abbreviation).filter((k) => k.startsWith(prefix)) : [];
  if (onTeam.length !== 1) return null;
  const hit = playerForSearchKey(onTeam[0]!);
  return typeof hit?.yearsExp === "number" ? hit.yearsExp : null;
}

/**
 * One boxed player: the headshot in the team-tinted well with any designation
 * tagged on its corner, the name to its right, and the years of service
 * beneath. `slot`
 * is printed ahead of the service only in the overflow strip, where no row
 * label says which position he is listed at.
 */
function depthCard(
  team: NflTeam,
  row: DepthRow,
  slot: string | null,
  ppr: { pos: string; ranks: PprRanks } | null,
): string {
  const sidelined = isOutDesignation(row.injuryStatus);
  const exp = depthExperience(team, row.name);
  // The Fantasy view's "WR7": his league-wide PPR rank this season, by the
  // Sleeper id the Fantasy columns carry, else by club and name.
  const posRank = ppr
    ? ppr.ranks.rankOf(/^\d+$/.test(row.id ?? "") ? row.id : null, team.abbreviation, row.name)
    : null;
  // "PPR WR7": the league-wide rank by PPR points per game, keyed so it never
  // reads as the WR1 / WR2 rank label beside it on the fantasy chart.
  const rankChip =
    posRank === null
      ? ""
      : `<span class="sct-dcx-rank" title="League rank by PPR points per game this season">` +
        `<span class="sct-dcx-rank-key">PPR</span>${escapeHtml(`${ppr!.pos}${posRank}`)}</span>`;
  const service =
    exp === null
      ? ""
      : exp === 0
        ? `<span class="sct-dcx-rookie">Rookie</span>`
        : `<span class="sct-dcx-exp">Exp ${exp}</span>`;
  const sub =
    (slot ? `<span class="sct-dcx-subpos">${escapeHtml(slot)}</span>` : "") + rankChip + service;
  return (
    `<li class="sct-dcx-card${sidelined ? " is-sidelined" : ""}" data-rank="${row.rank}">` +
    // Decorative, so the alt is empty: the name is on the same card. A player
    // the tool has no headshot for sits in the bare team-tinted well.
    // The designation rides the photo's corner (IR, Out, Q...), outside the
    // well because the well clips to its circle.
    `<span class="sct-dcx-avatar">` +
    `<span class="sct-dcx-well">` +
    (headshotImg({
      src: row.headshot,
      className: "sct-dcx-photo",
      alt: "",
      variants: ["160"],
      width: 40,
      height: 40,
      loading: "lazy",
    }) ?? "") +
    `</span>` +
    injuryBadge(row, "sct-dcx-tag") +
    `</span>` +
    `<span class="sct-dcx-body">` +
    `<span class="sct-dcx-top">` +
    depthName(row) +
    (row.movement === "new" ? `<span class="sct-dc-new">New</span>` : "") +
    depthMovement(row) +
    `</span>` +
    (sub ? `<span class="sct-dcx-sub">${sub}</span>` : "") +
    `</span>` +
    `</li>`
  );
}

/** The ranker for a column that has one: the four skill positions, not K. */
function pprFor(pos: string, ranks: PprRanks | null): { pos: string; ranks: PprRanks } | null {
  return ranks && (SKILL_POSITIONS as readonly string[]).includes(pos) ? { pos, ranks } : null;
}

/**
 * One slot's row on the football chart: the club's own slot in the first
 * column (WR, LDE, NB, K - spelled out for the screen reader), then the first
 * four strings as boxed cards, the empty strings left as empty cells so the
 * grid keeps its columns. A base offense therefore prints three WR rows, one
 * per starting slot, exactly as the team's chart does.
 */
function depthSlotRow(team: NflTeam, slot: FootballSlot): string {
  const shown = slot.rows.slice(0, DEPTH_COLUMNS.length);
  const cells = shown.map((row) => depthCard(team, row, null, null)).join("");
  const blanks = DEPTH_COLUMNS.length - shown.length;
  return (
    `<div class="sct-dcx-row" data-pos="${escapeHtml(slot.pos)}" data-slot="${escapeHtml(slot.key)}">` +
    `<h4 class="sct-dcx-pos"><span class="sct-dcx-pos-name">${escapeHtml(slot.pos)}</span>` +
    `<span class="sct-visually-hidden"> - ${escapeHtml(slot.label)}</span></h4>` +
    `<ol class="sct-dcx-cells">${cells}` +
    (blanks > 0 ? `<li class="sct-dcx-blank" aria-hidden="true"></li>`.repeat(blanks) : "") +
    `</ol>` +
    `</div>`
  );
}

/**
 * A letter for a league percentile, on the ladder the efficiency tab's
 * percentile track draws: the top sixth of the league is an A of some kind,
 * the bottom sixth a D or an F.
 */
function letterGrade(pct: number): string {
  const ladder: Array<[number, string]> = [
    [94, "A+"],
    [84, "A"],
    [77, "A-"],
    [68, "B+"],
    [58, "B"],
    [48, "B-"],
    [39, "C+"],
    [29, "C"],
    [19, "C-"],
    [13, "D+"],
    [6, "D"],
  ];
  for (const [floor, grade] of ladder) if (pct >= floor) return grade;
  return "F";
}

/**
 * The unit grades in a view's header: passing and rushing for the offense,
 * pass and run defense for the defense, each a letter for this team's league
 * rank on the efficiency doc the Stats tab draws its ladders from. Nothing is
 * graded by hand: the tooltip names the rank the letter stands for. Empty for
 * the Fantasy and Special Teams views, which the doc has no rates for.
 */
function depthGrades(data: TeamPageData, view: DepthView["key"]): string {
  const doc = getEfficiencyDoc(data.state.statsSeason);
  const eff = doc?.teams[data.team.abbreviation];
  if (!doc || !eff) return "";
  const side = view === "offense" ? eff.offense : view === "defense" ? eff.defense : null;
  if (!side) return "";
  const units: Array<[string, string, EfficiencyMetric | null | undefined]> = [
    [view === "offense" ? "Passing game" : "Pass defense", "EPA per dropback", side.epaDropback],
    [view === "offense" ? "Rushing attack" : "Run defense", "EPA per rush", side.epaRush],
  ];
  const through = doc.throughWeek ? ` through Week ${doc.throughWeek}` : "";
  const pills = units
    .filter((unit): unit is [string, string, EfficiencyMetric] => !!unit[2])
    .map(([label, metric, m]) => {
      const grade = letterGrade(m.pct);
      const tone = m.pct >= 68 ? "good" : m.pct < 29 ? "poor" : "mid";
      const detail = `${metric}: ${m.tied ? "T-" : ""}${ordinal(m.rank)} in the NFL${through}`;
      return (
        `<span class="sct-dcx-grade" data-tone="${tone}" title="${escapeHtml(detail)}">` +
        `<span class="sct-dcx-grade-label">${escapeHtml(label)}</span>` +
        `<span class="sct-dcx-grade-mark">${escapeHtml(grade)}</span>` +
        `<span class="sct-visually-hidden">, ${escapeHtml(detail)}</span>` +
        `</span>`
      );
    });
  return pills.length ? `<div class="sct-dcx-grades">${pills.join("")}</div>` : "";
}

/** "A", "A and B", "A, B and C". */
function depthList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The two charts as the FAQ reads them: the football chart's offensive slots
 * in the club's order (every row, a listed starter on IR included - the
 * answer says both), and the Fantasy view's available rows per position with
 * the slot the chart prints ("WR3" for the third row), its out rows apart.
 */
function depthFaqInput(charts: TeamDepthCharts): {
  offense: FaqSlot[];
  folded: boolean;
  fantasy: Record<SkillPosition, FaqEntry[]>;
  fantasyInjuries: FaqEntry[];
} {
  const offenseSide = charts.football.find((side) => side.key === "offense");
  const offense: FaqSlot[] = (offenseSide?.slots ?? []).map((slot) => ({
    pos: slot.pos,
    rows: slot.rows.map((row) => ({
      name: row.name,
      slot: slot.pos,
      position: slot.pos,
      injuryStatus: row.injuryStatus,
    })),
  }));
  const fantasyRows = { QB: [], RB: [], WR: [], TE: [] } as Record<SkillPosition, FaqEntry[]>;
  const fantasyInjuries: FaqEntry[] = [];
  const fantasy = charts.views.find((view) => view.key === "fantasy");
  for (const position of SKILL_POSITIONS) {
    const column = fantasy?.columns.find((c) => c.pos === position);
    for (const row of column?.rows ?? []) {
      const entry: FaqEntry = {
        name: row.name,
        slot: `${position}${row.rank}`,
        position,
        injuryStatus: row.injuryStatus,
      };
      (isOutDesignation(row.injuryStatus) ? fantasyInjuries : fantasyRows[position]).push(entry);
    }
  }
  return { offense, folded: offenseSide?.folded ?? true, fantasy: fantasyRows, fantasyInjuries };
}


/**
 * One compact paragraph naming the listed starters at the three fantasy
 * positions plus every starting WR slot, from the football chart alone. A
 * slot the chart does not list is left out of the sentence rather than
 * guessed; with none of them the paragraph is the second sentence alone.
 */
function depthSummary(team: NflTeam, football: FootballSide[]): string {
  const offense = football.find((side) => side.key === "offense");
  const starter = (pos: string): string | null =>
    offense?.slots.find((slot) => slot.pos === pos)?.rows[0]?.name ?? null;
  const qb = starter("QB");
  const rb = starter("RB");
  const te = starter("TE");
  // Only a slotted chart knows how many receivers start; a folded one has one
  // WR row holding the whole room.
  const receivers =
    offense && !offense.folded
      ? offense.slots
          .filter((slot) => slot.pos === "WR")
          .map((slot) => slot.rows[0]?.name)
          .filter((name): name is string => !!name)
      : [];
  const clauses: string[] = [];
  if (qb) clauses.push(`${qb} starting at quarterback`);
  if (rb) clauses.push(`${rb} at running back`);
  if (te) clauses.push(`${te} at tight end`);
  const lead = clauses.length
    ? `The ${team.fullName} depth chart has ${depthList(clauses)}` +
      (receivers.length ? `, with ${depthList(receivers)} at wide receiver.` : ".")
    : "";
  const tail =
    `View ${team.city}'s current offense, defense and special teams depth chart ` +
    `plus StatChasers' fantasy skill-position hierarchy.`;
  return `<p class="sct-dc-summary">${escapeHtml(lead ? `${lead} ${tail}` : tail)}</p>`;
}

/**
 * The formation a side's chart is listed in, as a short chip: ESPN names them
 * "3WR 1TE" and "Base 3-4 D". Only what the source says; nothing is inferred
 * from the roster.
 */
function depthFormation(side: FootballSide): string {
  if (!side.formation || side.key === "special") return "";
  let text: string;
  if (side.key === "offense") {
    const groups = [...side.formation.matchAll(/(\d)\s*(WR|TE|RB|FB)/gi)].map((m) => `${m[1]} ${m[2]!.toUpperCase()}`);
    text = groups.length ? `Base offense: ${groups.join(", ")}` : `Base offense: ${side.formation}`;
  } else {
    const front = side.formation.match(/\d-\d(?:-\d)?/);
    text = front ? `Base defense: ${front[0]}` : `Base defense: ${side.formation}`;
  }
  return `<span class="sct-dcx-formation">${escapeHtml(text)}</span>`;
}

/**
 * One side of the football chart as a card: "{Team} Offense Depth Chart" as
 * the title with the formation chip and unit grades beside it, a POS /
 * STARTER / SECOND / THIRD / FOURTH grid of boxed players beneath, one row per
 * slot in the club's order, and a strip for anyone listed deeper than fourth
 * string. No fantasy rank anywhere on it: the order is the source's.
 */
function depthFootballCard(data: TeamPageData, side: FootballSide): string {
  const { team } = data;
  const overflow = side.slots.flatMap((slot) =>
    slot.rows
      .slice(DEPTH_COLUMNS.length)
      .map((row) => depthCard(team, row, `${slot.pos}${row.rank}`, null)),
  );
  const aside = depthFormation(side) + depthGrades(data, side.key);
  return (
    // No card title: the page heading and the pressed view button already
    // name the side, so the card opens on the formation chip and grades.
    `<section class="sct-dcx" data-sct-dc-panel="${side.key}" aria-label="${escapeHtml(`${team.fullName} ${side.label} Depth Chart`)}">` +
    (aside ? `<div class="sct-dcx-head"><div class="sct-dcx-aside">${aside}</div></div>` : "") +
    // An older document has no slots: the rows are the folded position
    // groups, and the card says so rather than letting one WR row read as
    // one starting receiver.
    (side.folded
      ? `<p class="sct-note sct-dcx-folded">Listed by position group; the club's individual slots were not in this refresh.</p>`
      : "") +
    `<div class="sct-dcx-grid">` +
    `<div class="sct-dcx-labels" aria-hidden="true"><span>Pos</span>` +
    DEPTH_COLUMNS.map((label) => `<span>${label}</span>`).join("") +
    `</div>` +
    side.slots.map((slot) => depthSlotRow(team, slot)).join("") +
    `</div>` +
    (overflow.length
      ? `<div class="sct-dcx-more">` +
        `<h4 class="sct-dcx-more-title">Also listed<span class="sct-dcx-more-count"> · ${overflow.length}</span></h4>` +
        `<ol class="sct-dcx-cells is-loose">${overflow.join("")}</ol>` +
        `</div>`
      : "") +
    `</section>`
  );
}

/** The long-tail phrase each fantasy group is headed with. */
const FANTASY_POSITION_NAMES: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
};

/**
 * The fantasy chart as a card: StatChasers' hierarchy, one group per
 * position under its own heading ("{Team} Wide Receiver Depth Chart"), every
 * box labelled with its rank in the hierarchy (WR1, WR2...) and, for the
 * four skill positions, the player's league-wide PPR rank this season. The
 * one place on the page a fantasy order appears.
 */
function depthFantasyCard(data: TeamPageData, view: DepthView): string {
  const { team } = data;
  const usage = getUsageDoc(data.state.statsSeason);
  const ranks = usage ? pprPositionRanks(usage) : null;
  const groups = view.columns
    .filter((column) => column.rows.length)
    .map((column) => {
      const cells = column.rows
        .map((row) => depthCard(team, row, `${column.pos}${row.rank}`, pprFor(column.pos, ranks)))
        .join("");
      const name = FANTASY_POSITION_NAMES[column.pos] ?? column.label;
      return (
        `<div class="sct-dcx-fan" data-pos="${escapeHtml(column.pos)}">` +
        `<h4 class="sct-dcx-fan-title">${escapeHtml(`${team.fullName} ${name} Depth Chart`)}</h4>` +
        `<ol class="sct-dcx-cells is-fan">${cells}</ol>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<section class="sct-dcx" data-sct-dc-panel="fantasy" aria-label="${escapeHtml(`${team.fullName} Fantasy Depth Chart`)}">` +
    `<p class="sct-note sct-dcx-fan-note">StatChasers' fantasy hierarchy at each skill position. ` +
    `WR1, WR2 and WR3 rank players by fantasy value, so the order can differ from the starting slots on the team depth chart.</p>` +
    groups +
    `</section>`
  );
}

/**
 * The page's two link clusters, below the questions: this club's other
 * pages first (the team entity), then the fantasy tools. Only addresses that
 * exist: the section pages are the hub's public sections, and a tool with no
 * address yet is left out rather than pointed somewhere wrong.
 */
function depthLinks(team: NflTeam, options: TeamRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const more: Array<[string | null, string]> = [
    [sectionPath(prefix, team.slug, HUB_SECTION), "Team Overview"],
    [sectionPath(prefix, team.slug, "schedule"), "Schedule"],
    [sectionPath(prefix, team.slug, "stats"), "Stats"],
    [sectionPath(prefix, team.slug, "usage"), "Snap Counts & Usage"],
    [sectionPath(prefix, team.slug, "coaching"), "Coaching & Scheme"],
    [sectionPath(prefix, team.slug, "matchups"), "Matchups"],
    [sectionPath(prefix, team.slug, "news"), "News"],
  ];
  const tools: Array<[string | null, string]> = [
    [ROS_RANKINGS_URL, "Rest-of-Season Rankings"],
    [START_SIT_URL, "Start/Sit Tool"],
    [getSOSUrl(team), "Strength of Schedule"],
    [TRADE_CALCULATOR_URL, "Trade Calculator"],
    [getFPAUrl(team), "Fantasy Points Allowed"],
    [RB_HANDCUFF_RANKINGS_URL, "RB Handcuff Rankings"],
    [getToolsUrl(), "All Fantasy Football Tools"],
  ];
  const list = (items: Array<[string | null, string]>): string =>
    `<ul class="sct-dc-linklist">` +
    items
      .filter((item): item is [string, string] => !!item[0])
      .map(
        ([href, label]) =>
          `<li><a class="sct-dc-link" href="${escapeHtml(href)}"${/^https?:/.test(href) ? ` target="_top"` : ""}>` +
          `${escapeHtml(label)}${ARROW}</a></li>`,
      )
      .join("") +
    `</ul>`;
  return (
    `<div class="sct-block sct-dc-links">${h2(`More ${team.fullName}`)}${list(more)}</div>` +
    `<div class="sct-block sct-dc-links">${h2("Fantasy Football Tools")}${list(tools)}</div>`
  );
}

/**
 * The team's depth chart, football first (mak's brief, 2026-11-03).
 *
 * The heading is "{Team} Depth Chart" - the section page's H1 - over a stamp
 * line (season, last refresh) and a one-paragraph summary of the listed
 * starters. Then four cards behind a row of filter buttons, Offense pressed:
 * Offense, Defense and Special Teams as the club lists them, slot by slot,
 * and the Fantasy chart last as StatChasers' own hierarchy. All four cards
 * are in the HTML; the buttons only hide three (client/team.ts,
 * wireDepthViews), so a crawler and a reader without scripting see the
 * whole chart stacked.
 *
 * The data is the depth-charts tool's own document, pushed by the WordPress
 * plugin after each refresh (lib/team/depth-charts.ts); the football rows
 * are its slots, never re-sorted here. The questions and the two link
 * clusters render below the panel as its tail.
 */
function renderDepthChart(
  data: TeamPageData,
  options: TeamRenderOptions,
  faq: FaqSink,
  tail: TailSink,
): string {
  const { team, depthCharts } = data;
  if (!depthCharts) return "";
  const football = depthCharts.football.filter((side) => side.slots.length);
  const fantasy =
    depthCharts.views.find((view) => view.key === "fantasy" && view.columns.some((c) => c.rows.length)) ?? null;
  if (football.length === 0 && !fantasy) return "";

  // Below the panel, like the other tabs' questions - and assigned after the
  // early returns above, so a team whose chart did not render carries no
  // questions about one.
  tail.html =
    faqBlock(faqList(depthFaq({ team, ...depthFaqInput(depthCharts) }), faq, "h3")) +
    depthLinks(team, options);

  const panels: Array<{ key: string; label: string; html: string }> = [
    ...football.map((side) => ({ key: side.key, label: side.label, html: depthFootballCard(data, side) })),
    ...(fantasy ? [{ key: "fantasy", label: "Fantasy", html: depthFantasyCard(data, fantasy) }] : []),
  ];

  const switcher =
    `<div class="sct-dc-views" role="group" aria-label="Depth chart view">` +
    panels
      .map(
        (panel, i) =>
          `<button type="button" class="sct-dc-view" data-sct-dc-view="${panel.key}"` +
          ` aria-pressed="${i === 0 ? "true" : "false"}">${escapeHtml(panel.label)}</button>`,
      )
      .join("") +
    `</div>`;

  return (
    h2(`${team.fullName} Depth Chart`) +
    depthSummary(team, football) +
    `<div class="sct-dc" data-sct-dc>${switcher}${panels.map((panel) => panel.html).join("")}</div>`
  );
}

/* --------------------------------------------------------------- schedule */

/**
 * "Texans" for a full name too long for the schedule table's opponent column,
 * or null for one that fits.
 *
 * The same trade briefName() makes for a player: the column is fluid and the
 * name is what ellipses when it narrows, so a spelling that fits beats the
 * first seven letters of one that does not.
 *
 * The fallback is one step in rather than two. The column prints the full name
 * now - "Houston Texans", as the standalone tool's lens does - so the shorter
 * spelling is the nickname, which is what this table printed until it took the
 * lens's dress. The abbreviation is only reached for a name whose nickname is
 * no shorter than the name itself, which is the unresolved-opponent case.
 *
 * Null when the opponent is not a known team: both the nickname and the code
 * come from the team record, and a fixture against a name we cannot resolve has
 * neither to use.
 */
function briefTeamName(opponent: NflTeam | null, shown: string): string | null {
  if (!opponent) return null;
  const nickname = opponent.nickname.trim();
  if (nickname && nickname.length < shown.length) return nickname;
  const code = opponent.code.trim();
  return code && code.length < shown.length ? code : null;
}

/**
 * The broadcaster's name, at the width a badge in a table column has.
 *
 * This is the fallback's fallback now: every network the NFL schedule names has
 * a logo, so the only strings that reach here are the local call signs ESPN
 * sends in place of one ("WBZ", "KHOU"), which are already short. The table
 * stays because those are not the only strings it can ever send - a future
 * "Prime Video" arriving where no logo matched is better as "Prime" than as
 * "Prime Vid…" in a 66px cell. Anything not listed passes through untouched
 * rather than being truncated to something unreadable, which is the same rule
 * the injury designations follow.
 *
 * The full name stays on the element as a title, so shortening never loses it.
 */
const SHORT_NETWORK: Record<string, string> = {
  "prime video": "Prime",
  "amazon prime video": "Prime",
  "nfl network": "NFLN",
  "nfl net": "NFLN",
};

function shortNetwork(network: string): string {
  return SHORT_NETWORK[network.trim().toLowerCase()] ?? network.trim();
}

/**
 * A broadcaster as its own logo, or as the short text when it has none.
 *
 * The <use> points at a symbol defined once per page by networkDefs() - a
 * season carries the same four or five networks across seventeen rows, and
 * repeating the path data on each of them is the same picture seventeen times.
 *
 * The <svg> carries the crop twice over, and both copies earn their place.
 * `viewBox` with `meet` is what guarantees the artwork can never be stretched:
 * whatever box the stylesheet gives it, the logo scales to fit inside and
 * centers, so a box that is a rounding off the ratio costs a stray pixel of air
 * rather than a squashed wordmark. `--sct-net-aspect` is the same crop as a
 * number, which is what lets the stylesheet size the box to the shape instead
 * of leaving that air - see .sct-net-mark. The label is the broadcaster's full
 * name, because "CBS" is what the text version says and a logo should not read
 * as less.
 *
 * The text branch is still reachable: ESPN names a local call sign ("WBZ",
 * "KHOU") for some games, and a station we cannot identify keeps its own name.
 */
export function networkHtml(network: string, className: string): string {
  const mark = networkMarkFor(network);
  if (!mark) {
    return (
      `<span class="${className}"><span class="sct-net-text" title="${escapeHtml(network)}">` +
      `${escapeHtml(shortNetwork(network))}</span></span>`
    );
  }
  return (
    `<span class="${className}" title="${escapeHtml(network)}">` +
    `<svg class="sct-net-mark" viewBox="${markFrame(mark)}" preserveAspectRatio="xMidYMid meet"` +
    ` style="--sct-net-aspect:${mark.aspect}"` +
    ` role="img" aria-label="${escapeHtml(mark.title)}">` +
    `<use href="#sct-net-${mark.key}" />` +
    `</svg></span>`
  );
}

/**
 * The symbols the marks on this page point at, defined once.
 *
 * Only the networks this team actually plays on: a schedule that never touches
 * Netflix has no reason to carry its path. The block is inert - no size, hidden
 * from assistive tech - and lives inside the schedule section so it travels
 * with the only thing that references it.
 *
 * Each part carries its own fill, because these are the broadcasters' real
 * marks and their colors are the point. Paint order is the table's order: the
 * NFL shield's white stars are shapes laid over its navy field, not holes in
 * it, and drawing them first would lose them under it.
 */
export function networkDefs(networks: Array<string | null>): string {
  const marks = new Map<string, ReturnType<typeof networkMarkFor>>();
  for (const network of networks) {
    if (!network) continue;
    const mark = networkMarkFor(network);
    if (mark) marks.set(mark.key, mark);
  }
  if (marks.size === 0) return "";
  return (
    `<svg class="sct-net-defs" aria-hidden="true" focusable="false"><defs>` +
    [...marks.values()]
      .map(
        (mark) =>
          `<symbol id="sct-net-${mark!.key}" viewBox="${mark!.viewBox}">` +
          mark!.paths
            .map(
              (part) =>
                `<path fill="${part.fill}"` +
                (part.evenOdd ? ` fill-rule="evenodd"` : "") +
                ` d="${part.d}" />`,
            )
            .join("") +
          `</symbol>`,
      )
      .join("") +
    `</defs></svg>`
  );
}

/**
 * Where the game stands: the result once there is one, otherwise the kickoff.
 *
 * The column exists before the season does. A schedule that grows a result
 * column in Week 1 is a table that changes shape under the reader; one that
 * says something in August and "W 27-20" in September is the same table twice.
 * That is why the cell is never empty.
 *
 * What it says before kickoff is the time, not the word "Upcoming" - the
 * window is the thing a reader came to the column for. "TBD" is what it says
 * for a game the league has not given a window: the model has already refused
 * the feeds' placeholder, so there is no time here to print by mistake.
 */
export function gameStatusCell(game: ScheduleGame): string {
  if (game.result) {
    const { outcome, teamScore, opponentScore } = game.result;
    // An en dash between the scores, as a score line is set - the hyphen read
    // as a subtraction next to a W.
    return (
      `<span class="sct-result" data-outcome="${outcome}">` +
      `<span aria-hidden="true">${escapeHtml(`${outcome} ${teamScore}–${opponentScore}`)}</span>` +
      `<span class="sct-visually-hidden">` +
      `${outcome === "W" ? "Won" : outcome === "L" ? "Lost" : "Tied"} ${teamScore} to ${opponentScore}` +
      `</span></span>`
    );
  }
  if (game.status === "live") {
    return `<span class="sct-sstatus" data-state="live">Live</span>`;
  }
  if (game.status === "postponed") {
    return `<span class="sct-sstatus" data-state="postponed">Postponed</span>`;
  }
  if (game.status === "canceled") {
    return `<span class="sct-sstatus" data-state="canceled">Canceled</span>`;
  }
  const kickoff =
    game.kickoffMs !== null && game.timeConfirmed ? easternParts(game.kickoffMs).time : "TBD";
  return (
    `<span class="sct-sstatus" data-state="upcoming">${escapeHtml(kickoff)}</span>`
  );
}

/** "vs" for a home or neutral game, "at" for a road game. */
function sideWord(game: ScheduleGame): "vs" | "at" {
  return game.site === "away" ? "at" : "vs";
}

/**
 * The opponent's hub, or null for an opponent the table does not know.
 *
 * The same prefix the switcher and the tab strip use, so on a WordPress mount
 * the row links to statchasers.com's team page rather than this origin's.
 */
function teamHubHref(opponent: NflTeam | null, options: TeamRenderOptions): string | null {
  if (!opponent) return null;
  const prefix = options.teamPathPrefix ?? "/team/";
  return sectionPath(prefix, opponent.slug, HUB_SECTION) + (options.linkQuery ?? "");
}

/**
 * One upcoming fixture, as the hub's preview cards draw it.
 *
 * The card is read top to bottom as: which week and where it is played, who it
 * is against, then when and on what. `index === 0` is the next game. It gets a
 * gold rule across its top and a label, so a row of three is a hierarchy
 * rather than three equal boxes. A game with no window prints "Date/Time
 * TBD" where the date goes - the one thing the card must never do is print
 * the feeds' placeholder.
 */
export function renderUpcomingCard(
  game: ScheduleGame,
  index: number,
  matchupUrl: string | null = null,
  label = "Next game",
): string {
  const when = gameDateLine(game);
  const opponent = game.opponent;
  const nickname = opponent?.nickname ?? game.opponentName;

  // Venue, site and network on one line. Any can be missing - a game the
  // league has not scheduled has no network - and a lone separator is worse
  // than a shorter line. The network is markup rather than text because it
  // may be a mark; the rest is escaped here so the parts can be joined.
  const where = [
    game.venue ? escapeHtml(game.venue) : "",
    game.site === "neutral"
      ? escapeHtml(game.venueCity ? `${game.venueCity} · Neutral site` : "Neutral site")
      : "",
    game.network ? networkHtml(game.network, "sct-game-tv") : "",
  ].filter(Boolean);

  return (
    `<li class="sct-game"${index === 0 ? ` data-next="1"` : ""}>` +
    (opponent
      ? `<img class="sct-game-mark" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` aria-hidden="true" width="120" height="120" loading="lazy" decoding="async" />`
      : "") +
    `<div class="sct-game-head">` +
    `<span class="sct-game-label">` +
    (index === 0 ? `<span class="sct-game-next">${escapeHtml(label)}</span>` : "") +
    `<span class="sct-game-week">${escapeHtml(game.weekLabel)}</span>` +
    `</span>` +
    `<span class="sct-game-when">${escapeHtml(when.date)}` +
    (when.time
      ? ` · <span class="sct-game-time">${escapeHtml(when.time)}</span>`
      : "") +
    `</span>` +
    `</div>` +
    `<div class="sct-game-matchup">` +
    (opponent
      ? `<img class="sct-game-logo" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` width="46" height="46" loading="lazy" decoding="async" />`
      : "") +
    `<span class="sct-game-teams">` +
    `<span class="sct-game-opp">` +
    `<span class="sct-homeaway">${sideWord(game)}</span> ` +
    `${escapeHtml(nickname)}</span>` +
    (opponent
      ? `<span class="sct-game-line"><span class="sct-game-full">${escapeHtml(opponent.fullName)}</span></span>`
      : "") +
    `</span>` +
    `</div>` +
    (where.length
      ? `<p class="sct-game-where">${where.join(" · ")}</p>`
      : "") +
    (matchupUrl
      ? `<p class="sct-game-cta">` +
        `<a class="sct-textlink" href="${escapeHtml(matchupUrl)}">View matchup ${ARROW}</a>` +
        `</p>`
      : "") +
    `</li>`
  );
}

/**
 * The last completed game, as a card beside the upcoming ones on the hub.
 *
 * The same shell as renderUpcomingCard() so the four read as one strip; what
 * differs is the content - the result where the kickoff would be, and the
 * recap link in place of the matchup preview.
 */
function renderLastGameCard(
  team: NflTeam,
  game: ScheduleGame,
  record: string,
  recapUrl: string | null,
): string {
  const opponent = game.opponent;
  const nickname = opponent?.nickname ?? game.opponentName;
  const where = [
    gameShortDay(game) !== "TBD" ? escapeHtml(gameShortDay(game)) : "",
    game.venue ? escapeHtml(game.venue) : "",
    game.site === "neutral" ? "Neutral site" : "",
  ].filter(Boolean);
  return (
    `<li class="sct-game" data-last="1">` +
    (opponent
      ? `<img class="sct-game-mark" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` aria-hidden="true" width="120" height="120" loading="lazy" decoding="async" />`
      : "") +
    `<div class="sct-game-head">` +
    `<span class="sct-game-label">` +
    `<span class="sct-game-next">Last game</span>` +
    `<span class="sct-game-week">${escapeHtml(game.weekLabel)}</span>` +
    `</span>` +
    `<span class="sct-game-when">${gameStatusCell(game)}` +
    `<span class="sct-game-time"> · ${escapeHtml(record)}</span></span>` +
    `</div>` +
    `<div class="sct-game-matchup">` +
    (opponent
      ? `<img class="sct-game-logo" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` width="46" height="46" loading="lazy" decoding="async" />`
      : "") +
    `<span class="sct-game-teams">` +
    `<span class="sct-game-opp"><span class="sct-homeaway">${sideWord(game)}</span> ${escapeHtml(nickname)}</span>` +
    (opponent
      ? `<span class="sct-game-line"><span class="sct-game-full">${escapeHtml(opponent.fullName)}</span></span>`
      : "") +
    `</span>` +
    `</div>` +
    (where.length ? `<p class="sct-game-where">${where.join(" · ")}</p>` : "") +
    (recapUrl
      ? `<p class="sct-game-cta"><a class="sct-textlink" href="${escapeHtml(recapUrl)}">View recap ${ARROW}</a></p>`
      : "") +
    `<span class="sct-visually-hidden">${escapeHtml(`${team.nickname} record after the game: ${record}`)}</span>` +
    `</li>`
  );
}

/* ---------------------------------------------------------------- boards */

type BoardKind = "results" | "remaining";

/**
 * The cells of one game, in the column order of its board.
 *
 * Results: Wk · Opponent · Date · Result · Record · recap link.
 * Remaining: Wk · Opponent · Date · Time · TV · Venue · matchup link.
 *
 * Both boards start the same way - the week and the opponent are what a row
 * is found by - and part where the facts part: a played game has a score and
 * a record after it, a game to come has a window, a network and a venue. The
 * week cell carries the round's name for a postseason game ("Wild Card")
 * because a week number means nothing there.
 */
function scheduleRow(
  kind: BoardKind,
  team: NflTeam,
  game: ScheduleGame,
  schedule: TeamSchedule,
  options: TeamRenderOptions,
  now: number,
  record: string | null,
): string {
  const shown = game.opponent?.fullName ?? game.opponentName;
  const brief = briefTeamName(game.opponent, shown);
  // Three spellings, narrowest last: "Seattle Seahawks", "Seahawks", "SEA".
  // The code is the third tier (mak, 2026-10-20): it is what keeps the row
  // on one line down to 400px of board instead of stacking at 900px of
  // window with most of the table still empty.
  const code = brief && game.opponent ? game.opponent.code.trim() : "";
  const nameInner = brief
    ? `<span class="sct-srow-name-long">${escapeHtml(shown)}</span>` +
      `<span class="sct-srow-name-brief" aria-hidden="true">${escapeHtml(brief)}</span>` +
      (code && code !== brief
        ? `<span class="sct-srow-name-code" aria-hidden="true">${escapeHtml(code)}</span>`
        : "")
    : escapeHtml(shown);
  // The opponent's name is a link to its hub (mak's brief, 2026-11-03): a
  // schedule is a list of 17 other clubs, and every one of them has a page.
  const hub = teamHubHref(game.opponent, options);
  const nameCell = hub
    ? `<a class="sct-srow-name sct-srow-team" href="${escapeHtml(hub)}">${nameInner}</a>`
    : `<span class="sct-srow-name">${nameInner}</span>`;

  const weekCell =
    game.seasonType === "post"
      ? `<span class="sct-srow-week is-round">${escapeHtml(game.weekLabel)}</span>`
      : `<span class="sct-srow-week">${escapeHtml(`W${game.week}`)}</span>`;

  // "vs" and "at" set in the muted weight the name is not, so the eye lands
  // on the opponent and the preposition is read second. A neutral site keeps
  // "vs" and carries its own mark: it is not a home game and the counts in
  // the rail do not call it one.
  const side =
    `<span class="sct-srow-ha" data-kind="${game.site}"` +
    (game.site === "neutral" ? ` title="Neutral site"` : "") +
    `>${sideWord(game)}</span>`;

  const opponentCell =
    `<span class="sct-srow-opp">` +
    side +
    (game.opponent
      ? `<img class="sct-srow-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
        ` width="22" height="22" loading="lazy" decoding="async" />`
      : "") +
    nameCell +
    // After the name, so a screen reader hears "vs Washington Commanders,
    // neutral site" rather than the site before the opponent.
    (game.site === "neutral" ? `<span class="sct-visually-hidden">, neutral site</span>` : "") +
    `</span>`;

  const dateCell =
    `<span class="sct-srow-when"${game.dateConfirmed ? "" : ` title="Date and time to be announced by the NFL"`}>` +
    `${escapeHtml(gameShortDate(game))}</span>`;

  const href = gameMatchupHref(team, game, schedule, options, now);
  const linkCell = href
    ? `<a class="sct-textlink sct-srow-view" href="${escapeHtml(href)}">` +
      `<span class="sct-srow-view-label">${game.status === "final" ? "View recap" : "View matchup"}</span> ${ARROW}</a>`
    : `<span class="sct-srow-view"></span>`;

  if (kind === "results") {
    return (
      `<li class="sct-srow" data-site="${game.site}">` +
      weekCell +
      opponentCell +
      dateCell +
      gameStatusCell(game) +
      `<span class="sct-srow-record">${escapeHtml(record ?? "")}</span>` +
      linkCell +
      `</li>`
    );
  }

  const venue = [
    game.venue ?? "",
    game.site === "neutral" ? (game.venueCity ?? "Neutral site") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    `<li class="sct-srow" data-site="${game.site}">` +
    weekCell +
    opponentCell +
    dateCell +
    gameStatusCell(game) +
    (game.network
      ? networkHtml(game.network, "sct-srow-tv")
      : // Kept, and empty: the league has not assigned a network to a game it
        // has not put in a window, and dropping the cell would shift every
        // column to its right on exactly those rows.
        `<span class="sct-srow-tv"><span class="sct-srow-tbd">TBD</span></span>`) +
    `<span class="sct-srow-venue">${escapeHtml(venue)}</span>` +
    linkCell +
    `</li>`
  );
}

function byeRow(week: number): string {
  return (
    `<li class="sct-srow is-bye">` +
    `<span class="sct-srow-week">${escapeHtml(`W${week}`)}</span>` +
    // One cell across the rest of the row. The bye is the only row with
    // nothing to say in the other columns, and filling them with empty spans
    // drew column rules through the one row that is not a fixture.
    `<span class="sct-srow-bye">Bye week</span>` +
    `</li>`
  );
}

/**
 * One board: a head row and its games, in one grid so a column label sits
 * over the column it names at every width. `data-board` is what team.css
 * picks the column template by.
 */
function renderBoard(kind: BoardKind, rows: string[]): string {
  const head =
    kind === "results"
      ? `<span>Wk</span><span>Opponent</span><span>Date</span><span>Result</span><span>Record</span><span></span>`
      : `<span>Wk</span><span>Opponent</span><span>Date</span><span>Time</span><span>TV</span><span>Venue</span><span></span>`;
  return (
    `<div class="sct-sboard" data-board="${kind}">` +
    `<div class="sct-slist-head" aria-hidden="true">${head}</div>` +
    `<ol class="sct-slist">${rows.join("")}</ol>` +
    `</div>`
  );
}

/**
 * The two boards the season splits into, with the bye slotted into whichever
 * half its week falls in.
 *
 * One list, one pass (splitSchedule), two groups: a game is in exactly one of
 * them, and the record column is the record AFTER each result, counted in
 * schedule order so a reader can run a finger down it.
 */
function renderSeasonBoards(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const { results, remaining } = splitSchedule(schedule);
  const bye = schedule.byeWeek;
  const lastPlayedWeek = results.length ? (results[results.length - 1] as ScheduleGame).week : 0;

  const resultRows = results.map((game) =>
    scheduleRow("results", team, game, schedule, options, now, recordThrough(schedule.games, game).text),
  );
  const remainingRows = remaining.map((game) =>
    scheduleRow("remaining", team, game, schedule, options, now, null),
  );

  // The bye goes where its week falls: among the results once the team has
  // played past it, otherwise ahead with the games still to come.
  if (bye) {
    const row = byeRow(bye);
    if (bye < lastPlayedWeek) {
      const at = results.findIndex((game) => game.week > bye);
      resultRows.splice(at === -1 ? resultRows.length : at, 0, row);
    } else {
      const at = remaining.findIndex((game) => game.week > bye);
      remainingRows.splice(at === -1 ? remainingRows.length : at, 0, row);
    }
  }

  const resultsRange = results.length
    ? results.length === 1
      ? `Week ${(results[0] as ScheduleGame).week}`
      : `Weeks ${(results[0] as ScheduleGame).week}–${(results[results.length - 1] as ScheduleGame).week}`
    : "";
  const remainingRange = remaining.length
    ? remaining.length === 1
      ? `Week ${(remaining[0] as ScheduleGame).week}`
      : `Weeks ${(remaining[0] as ScheduleGame).week}–${(remaining[remaining.length - 1] as ScheduleGame).week}`
    : "";

  const resultsBlock =
    `<div class="sct-sched-block" id="results">` +
    `<h2 class="sct-h2 is-sub">${escapeHtml(`${team.fullName} Results`)}` +
    (resultsRange ? `<span class="sct-sched-range">${escapeHtml(resultsRange)}</span>` : "") +
    `</h2>` +
    (resultRows.length
      ? renderBoard("results", resultRows)
      : `<p class="sct-note">No ${schedule.season} games have been played yet.</p>`) +
    `</div>`;

  const remainingBlock =
    `<div class="sct-sched-block" id="remaining-schedule">` +
    `<h2 class="sct-h2 is-sub">${escapeHtml(`${team.fullName} Remaining Schedule`)}` +
    (remainingRange ? `<span class="sct-sched-range">${escapeHtml(remainingRange)}</span>` : "") +
    `</h2>` +
    (remainingRows.length
      ? renderBoard("remaining", remainingRows)
      : `<p class="sct-note">The ${schedule.season} regular season is complete.</p>`) +
    `</div>`;

  // Results first while the season is on; once it is over there is nothing
  // remaining and the results are the whole page. Before it starts the
  // remaining board is the schedule and the empty results block waits below.
  return results.length ? resultsBlock + remainingBlock : remainingBlock + resultsBlock;
}

/**
 * The postseason, only for a club that has one.
 *
 * The same rows as the season boards - a played round carries its result and
 * a round to come its window - under the round's name in the week column. An
 * empty postseason renders nothing: no club gets a playoff heading it has
 * not earned.
 */
function renderPostseasonBoard(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, postseason } = data;
  if (!postseason || postseason.games.length === 0) return "";
  const { results, remaining } = splitSchedule(postseason);
  const blocks: string[] = [];
  if (results.length) {
    blocks.push(
      renderBoard(
        "results",
        results.map((game) =>
          scheduleRow("results", team, game, postseason, options, now, recordThrough(postseason.games, game).text),
        ),
      ),
    );
  }
  if (remaining.length) {
    blocks.push(
      renderBoard(
        "remaining",
        remaining.map((game) => scheduleRow("remaining", team, game, postseason, options, now, null)),
      ),
    );
  }
  return (
    `<div class="sct-sched-block" id="postseason-schedule">` +
    `<h2 class="sct-h2 is-sub">${escapeHtml(`${team.fullName} Postseason Schedule`)}</h2>` +
    blocks.join("") +
    `</div>`
  );
}

/* --------------------------------------------------------- next and last */

/**
 * "Updated Nov 3" - the schedule's own refresh time, never the request's.
 *
 * The stamp is the later of the slate fetch and the live layer's last
 * successful sweep (TeamSchedule.updatedAtMs). A page served from cache
 * carries the stamp of the data it was rendered from, which is the honest
 * answer to "how fresh is this".
 */
function updatedStamp(ms: number): string {
  if (!ms) return "";
  const parts = easternParts(ms);
  return (
    `<span class="sct-sched-updated">Updated ` +
    `<time datetime="${escapeHtml(new Date(ms).toISOString())}">${escapeHtml(`${parts.month} ${parts.day}`)}</time>` +
    `</span>`
  );
}

/**
 * The line under the H1: season, record, division, bye, freshness.
 *
 * Every figure is read from the schedule rows below it - the record is the
 * finals added up, not ESPN's standings line - so the line cannot say 3-5
 * over a board that shows four wins.
 */
function scheduleContext(data: TeamPageData): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const record = recordThrough(schedule.games);
  const parts = [
    `${schedule.season} NFL season`,
    record.played ? record.text : "",
    team.division,
    schedule.byeWeek ? `Bye Week ${schedule.byeWeek}` : "",
  ]
    .filter(Boolean)
    .map((part) => `<span>${escapeHtml(part)}</span>`);
  const stamp = updatedStamp(schedule.updatedAtMs);
  if (stamp) parts.push(stamp);
  return `<p class="sct-sched-context">${parts.join(`<span class="sct-sched-dot" aria-hidden="true">·</span>`)}</p>`;
}

/**
 * The next game and the last result, as one compact module above the boards.
 *
 * Opponent, site, date, kickoff, network, venue and the matchup link - the
 * seven things a "next game" search is for - and beside them the last
 * result with the record after it and the recap link. NFL.com's own team
 * page makes exactly this pair, and it is the right size: one block, two
 * cells, nothing that the boards below do not also hold.
 *
 * The label moves with the game: Upcoming -> Today's Game -> Live Now ->
 * (final lands, the game moves to the Last cell) -> the next one. "Today"
 * is said only on the day.
 */
function renderNextGameModule(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const next = nextGame(schedule, now);
  const last = lastResult(schedule);
  if (!next && !last) return "";

  const fixtureSide = (club: NflTeam | null, name: string, isTeam: boolean): string =>
    (club
      ? `<img class="sct-ng-logo" src="${escapeHtml(club.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`
      : "") +
    (club && !isTeam
      ? (() => {
          const href = teamHubHref(club, options);
          return href
            ? `<a class="sct-ng-team" href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
            : `<span class="sct-ng-team">${escapeHtml(name)}</span>`;
        })()
      : `<span class="sct-ng-team is-team">${escapeHtml(name)}</span>`);

  let nextCell = "";
  if (next) {
    const when = gameDateLine(next);
    const opponentName = next.opponent?.fullName ?? next.opponentName;
    // Away at home, as a scoreboard reads; a neutral site puts this team
    // first and says "vs".
    const fixture =
      next.site === "home"
        ? fixtureSide(next.opponent, opponentName, false) +
          `<span class="sct-ng-at">at</span>` +
          fixtureSide(team, team.fullName, true)
        : next.site === "away"
          ? fixtureSide(team, team.fullName, true) +
            `<span class="sct-ng-at">at</span>` +
            fixtureSide(next.opponent, opponentName, false)
          : fixtureSide(team, team.fullName, true) +
            `<span class="sct-ng-at">vs</span>` +
            fixtureSide(next.opponent, opponentName, false);
    const detail =
      next.status === "live" && next.statusDetail
        ? `<span class="sct-ng-live">${escapeHtml(next.statusDetail)}</span>`
        : "";
    const whenParts = [
      escapeHtml(when.date),
      when.time ? escapeHtml(when.time) : "",
      next.network ? networkHtml(next.network, "sct-ng-tv") : next.status === "scheduled" ? `<span class="sct-ng-tbd">TV TBD</span>` : "",
    ].filter(Boolean);
    const venueParts = [
      next.venue ? escapeHtml(next.venue) : "",
      next.site === "neutral"
        ? escapeHtml(next.venueCity ? `${next.venueCity} · Neutral site` : "Neutral site")
        : next.international && next.venueCity
          ? escapeHtml(next.venueCity)
          : "",
    ].filter(Boolean);
    const href = gameMatchupHref(team, next, schedule, options, now);
    nextCell =
      `<div class="sct-ng-cell" data-kind="next">` +
      `<p class="sct-ng-label">${escapeHtml(nextGameLabel(next, now))}` +
      `<span class="sct-ng-week">${escapeHtml(next.weekLabel)}</span>${detail}</p>` +
      `<p class="sct-ng-fixture">${fixture}</p>` +
      `<p class="sct-ng-when">${whenParts.join(`<span class="sct-sched-dot" aria-hidden="true">·</span>`)}</p>` +
      (venueParts.length ? `<p class="sct-ng-venue">${venueParts.join(" · ")}</p>` : "") +
      (href
        ? `<p class="sct-ng-cta"><a class="sct-textlink" href="${escapeHtml(href)}">View matchup ${ARROW}</a></p>`
        : "") +
      `</div>`;
  }

  let lastCell = "";
  if (last?.result) {
    const record = recordThrough(schedule.games, last).text;
    const opponentName = last.opponent?.nickname ?? last.opponentName;
    const href = gameMatchupHref(team, last, schedule, options, now);
    lastCell =
      `<div class="sct-ng-cell" data-kind="last">` +
      `<p class="sct-ng-label">Last Game<span class="sct-ng-week">${escapeHtml(last.weekLabel)}</span></p>` +
      `<p class="sct-ng-score">${gameStatusCell(last)}` +
      `<span class="sct-ng-opp">${sideWord(last)} ` +
      (last.opponent
        ? `<img class="sct-ng-logo is-small" src="${escapeHtml(last.opponent.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
        : "") +
      `${escapeHtml(opponentName)}</span></p>` +
      `<p class="sct-ng-when">${escapeHtml(gameShortDay(last))}` +
      `<span class="sct-sched-dot" aria-hidden="true">·</span>` +
      `<span>${escapeHtml(`Record ${record}`)}</span></p>` +
      (href
        ? `<p class="sct-ng-cta"><a class="sct-textlink" href="${escapeHtml(href)}">View recap ${ARROW}</a></p>`
        : "") +
      `</div>`;
  }

  return (
    `<section class="sct-nextgame-module${nextCell && lastCell ? "" : " is-single"}" aria-label="${escapeHtml(
      `${team.nickname} next game and last result`,
    )}">` +
    nextCell +
    lastCell +
    `</section>`
  );
}

/* ----------------------------------------------------------- season shape */

/**
 * What the eighteen weeks beside this add up to.
 *
 * The four cards the standalone NFL schedule tool puts in its team lens
 * sidebar, brought onto the hub's Schedule tab in the same rail: the season in
 * figures with the home/road/neutral split, the path through it, the division
 * slate, and where the rest of the opponents come from. Everything is
 * arithmetic on the rows to the left - team/season-shape.ts does the counting
 * and states what it refuses to infer.
 *
 * House components, not the source's: `.sct-mix` is the card, `.sct-mix-label`
 * the eyebrow, `.sct-mix-caption` the fine print, and the bars are the
 * ladder's geometry.
 */
function renderSeasonShape(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const shape = seasonShape(schedule, team);
  if (!shape) return "";

  const figures: Array<[string, string]> = [
    ["Games", String(shape.total)],
    ["Home", String(shape.home)],
    ["Away", String(shape.away)],
    // Only when there is one: a "Neutral 0" cell on thirty clubs' pages is a
    // figure about nothing. When there is one it is the figure that stops
    // the home and away counts adding up to a lie.
    ...(shape.neutral ? ([["Neutral", String(shape.neutral)]] as Array<[string, string]>) : []),
    ["Division", String(shape.division)],
    ["Remaining", String(shape.remaining)],
    // "TBD", not a guess: schedule.ts returns null for a bye it cannot
    // establish, and a wrong bye is the one number on this card a fantasy
    // manager would act on.
    ["Bye week", shape.bye ? `W${shape.bye}` : "TBD"],
  ];

  // Home against road (against neutral), on the ladder's track.
  const kinds = (["home", "away", ...(shape.neutral ? ["neutral"] : [])] as const);
  const splitMax = Math.max(shape.home, shape.away, shape.neutral, 1);
  const split = kinds
    .map((kind) => {
      const value = kind === "home" ? shape.home : kind === "away" ? shape.away : shape.neutral;
      const label = kind === "home" ? "Home" : kind === "away" ? "Away" : "Neutral";
      return (
        `<div class="sct-shape-bar" data-kind="${kind}">` +
        `<dt class="sct-shape-bar-label">${label}</dt>` +
        `<dd class="sct-shape-bar-body">` +
        `<span class="sct-shape-bar-track" aria-hidden="true">` +
        `<span class="sct-shape-bar-fill" style="${escapeHtml(
          `width:${Math.round((value / splitMax) * 100)}%`,
        )}"></span>` +
        `</span>` +
        `<span class="sct-shape-bar-value">${value}</span>` +
        `</dd>` +
        `</div>`
      );
    })
    .join("");

  const snapshotCard =
    `<div class="sct-mix" data-kind="snapshot">` +
    `<p class="sct-mix-label">${escapeHtml(`${shape.season} season snapshot`)}</p>` +
    `<dl class="sct-snap">` +
    figures
      .map(
        ([label, value]) =>
          `<div class="sct-snap-cell">` +
          `<dt class="sct-snap-label">${escapeHtml(label)}</dt>` +
          `<dd class="sct-snap-value">${escapeHtml(value)}</dd>` +
          `</div>`,
      )
      .join("") +
    `</dl>` +
    `<dl class="sct-shape-bars sct-snap-bars">${split}</dl>` +
    `</div>`;

  // Eighteen weeks as eighteen blocks: filled for home, hollow for away,
  // half-filled for a neutral site, dashed for the bye. Never color alone -
  // every block carries its week and its opponent in a title and in a hidden
  // label.
  const strip =
    `<ol class="sct-path">` +
    shape.marks
      .map(
        (mark) =>
          `<li class="sct-path-week" data-kind="${mark.kind}"` +
          ` title="${escapeHtml(`Week ${mark.week} · ${mark.label}`)}">` +
          `<span class="sct-visually-hidden">${escapeHtml(
            `Week ${mark.week}: ${mark.label}`,
          )}</span>` +
          `</li>`,
      )
      .join("") +
    `</ol>`;

  const segments =
    `<div class="sct-segs">` +
    shape.segments
      .map(
        (segment) =>
          `<div class="sct-seg">` +
          `<span class="sct-seg-label">${escapeHtml(
            `Weeks ${segment.from}–${segment.to}`,
          )}</span>` +
          `<span class="sct-seg-detail">${escapeHtml(segment.detail)}</span>` +
          `</div>`,
      )
      .join("") +
    `</div>`;

  const pathCard =
    `<div class="sct-mix" data-kind="path">` +
    `<p class="sct-mix-label">Season path</p>` +
    strip +
    `<p class="sct-mix-legend" aria-hidden="true">` +
    `<span class="sct-mix-key" data-kind="home">Home</span>` +
    `<span class="sct-mix-key" data-kind="away">Away</span>` +
    (shape.neutral ? `<span class="sct-mix-key" data-kind="neutral">Neutral</span>` : "") +
    `<span class="sct-mix-key" data-kind="bye">Bye</span>` +
    `</p>` +
    segments +
    `</div>`;

  // The division slate, each meeting with its result or its date (mak's
  // brief, 2026-11-03), read from the same row the board prints.
  const slateRows = shape.slate
    .map((game) => {
      const fixture = schedule.games.find(
        (g) => g.seasonType === "regular" && g.week === game.week && g.opponent === game.opponent,
      );
      const href = fixture
        ? gameMatchupHref(team, fixture, schedule, options, now)
        : matchupHref(team, game.opponent, options);
      const name = href
        ? `<a class="sct-slate-link" href="${escapeHtml(href)}">${escapeHtml(game.name)}</a>`
        : escapeHtml(game.name);
      const status = fixture
        ? fixture.result
          ? gameStatusCell(fixture)
          : `<span class="sct-slate-when">${escapeHtml(gameShortDate(fixture))}</span>`
        : "";
      return (
        `<li class="sct-slate-row">` +
        `<span class="sct-slate-week">${escapeHtml(`W${game.week}`)}</span>` +
        (game.opponent
          ? `<img class="sct-slate-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
            ` width="20" height="20" loading="lazy" decoding="async" />`
          : `<span class="sct-slate-logo"></span>`) +
        `<span class="sct-slate-name">${game.site === "away" ? "at " : "vs "}${name}</span>` +
        `<span class="sct-slate-status">${status}</span>` +
        `</li>`
      );
    })
    .join("");

  const slateCard =
    `<div class="sct-mix" data-kind="slate">` +
    `<p class="sct-mix-label">${escapeHtml(`${team.division} schedule`)}</p>` +
    (shape.slate.length
      ? `<ul class="sct-slate">${slateRows}</ul>` +
        `<p class="sct-mix-caption">${escapeHtml(
          `${shape.slateHome} home · ${shape.slateAway} away` +
            (shape.slate.length - shape.slateHome - shape.slateAway
              ? ` · ${shape.slate.length - shape.slateHome - shape.slateAway} neutral`
              : ""),
        )}</p>`
      : `<p class="sct-mix-caption">No division games scheduled.</p>`) +
    `</div>`;

  const max = shape.divisions[0]?.count ?? 1;
  const bars = shape.divisions
    .map(
      (entry) =>
        `<div class="sct-shape-bar">` +
        `<dt class="sct-shape-bar-label">${escapeHtml(entry.division)}</dt>` +
        `<dd class="sct-shape-bar-body">` +
        `<span class="sct-shape-bar-track" aria-hidden="true">` +
        `<span class="sct-shape-bar-fill" style="${escapeHtml(
          `width:${Math.round((entry.count / max) * 100)}%`,
        )}"></span>` +
        `</span>` +
        `<span class="sct-shape-bar-value">${entry.count}</span>` +
        `</dd>` +
        `</div>`,
    )
    .join("");

  const opponentCard =
    `<div class="sct-mix" data-kind="opponents">` +
    `<p class="sct-mix-label">${escapeHtml(`Who ${team.city} plays`)}</p>` +
    (shape.divisions.length
      ? `<dl class="sct-shape-bars">${bars}</dl>` +
        `<dl class="sct-shape-conf">` +
        shape.conferences
          .map(
            ([conference, count]) =>
              `<div class="sct-shape-conf-cell">` +
              `<dt>${escapeHtml(conference)}</dt><dd>${count}</dd>` +
              `</div>`,
          )
          .join("") +
        `</dl>`
      : `<p class="sct-mix-caption">No opponents scheduled.</p>`) +
    `</div>`;

  return (
    `<aside class="sct-shape" aria-label="${escapeHtml(
      `${shape.season} ${team.nickname} season shape`,
    )}">` +
    snapshotCard +
    pathCard +
    slateCard +
    opponentCard +
    `</aside>`
  );
}

/**
 * "More <team>": the club's other pages, as plain links under the schedule.
 *
 * The tab strip already links them; this is the same set in the body, where
 * a reader at the bottom of a long page is, and where a crawler finds them
 * without reading a nav.
 */
function renderMoreLinks(team: NflTeam, options: TeamRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const links: Array<[string, string]> = [
    [sectionPath(prefix, team.slug, HUB_SECTION) + query, `${team.fullName} team page`],
    [sectionPath(prefix, team.slug, "depth-chart") + query, "Depth chart"],
    [sectionPath(prefix, team.slug, "stats") + query, "Team stats"],
    [sectionPath(prefix, team.slug, "usage") + query, "Snap counts and usage"],
    [sectionPath(prefix, team.slug, "news") + query, "News and injuries"],
  ];
  const full = getTeamScheduleUrl(team);
  return (
    `<nav class="sct-sched-more" aria-label="${escapeHtml(`More ${team.nickname}`)}">` +
    h2(`More ${team.nickname}`, "is-sub") +
    `<ul class="sct-sched-more-list">` +
    links
      .map(
        ([href, label]) =>
          `<li><a class="sct-textlink" href="${escapeHtml(href)}">${escapeHtml(label)} ${ARROW}</a></li>`,
      )
      .join("") +
    (full ? `<li>${siteLink(full, `Full NFL schedule ${ARROW}`, "sct-textlink")}</li>` : "") +
    `</ul>` +
    `</nav>`
  );
}

/**
 * The hub's compact schedule: last game, next game, the two after, and the
 * way to the whole thing.
 *
 * This is all the schedule the hub carries (mak, 2026-11-03). The full
 * boards, the rail, the pair index and the questions live at /schedule/,
 * which is the page that owns schedule searches; the hub owning a second
 * copy made the two compete.
 */
function renderSchedulePreview(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const last = lastResult(schedule);
  const upcoming = schedule.games.filter((game) => !(game.status === "final" && game.result)).slice(0, 3);
  const prefix = options.teamPathPrefix ?? "/team/";
  const fullHref = sectionPath(prefix, team.slug, "schedule") + (options.linkQuery ?? "");

  const cards: string[] = [];
  if (last) {
    cards.push(
      renderLastGameCard(
        team,
        last,
        recordThrough(schedule.games, last).text,
        gameMatchupHref(team, last, schedule, options, now),
      ),
    );
  }
  upcoming.forEach((game, i) => {
    cards.push(
      renderUpcomingCard(
        game,
        i,
        gameMatchupHref(team, game, schedule, options, now),
        nextGameLabel(game, now).replace(/ Game$/, " game").replace(/^Live Now$/, "Live now"),
      ),
    );
  });

  return (
    h2(`${team.nickname} Schedule`) +
    scheduleContext(data) +
    networkDefs(upcoming.map((game) => game.network)) +
    (cards.length
      ? `<ul class="sct-games is-preview">${cards.join("")}</ul>`
      : `<p class="sct-note">No ${schedule.season} games are on the slate yet.</p>`) +
    `<p class="sct-block-footer">` +
    `<a class="sct-textlink" href="${escapeHtml(fullHref)}">${escapeHtml(`View full ${team.fullName} schedule`)} ${ARROW}</a>` +
    `</p>`
  );
}

/**
 * The Schedule page, or the hub's preview of it.
 *
 * "full" is the page at /<slug>/schedule/, in the order a schedule search
 * wants it: the heading and its context line, the next game, the results
 * board, the remaining board, the postseason if there is one, then the rail
 * of season figures, the pair index and the club's other pages. The questions
 * render as the section's tail. "preview" is what the hub carries instead.
 */
function renderSchedule(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
  faq: FaqSink,
  tail: TailSink,
  mode: "full" | "preview",
): string {
  const { team, schedule } = data;

  if (!schedule) {
    return (
      h2(`${team.fullName} Schedule`) +
      `<div class="sct-empty">` +
      `<p class="sct-empty-title">Schedule information is temporarily unavailable.</p>` +
      `<p class="sct-empty-body">It will reappear here as soon as the fixture data loads.</p>` +
      `</div>`
    );
  }

  if (mode === "preview") return renderSchedulePreview(data, options, now);

  // The boards and the four summary cards side by side, as the standalone
  // tool's team lens lays them out: the fixtures in the fluid column, a 300px
  // rail of cards. The cards fall under the boards as a band once the rail
  // stops paying for itself - see team.css.
  const shape = renderSeasonShape(data, options, now);
  const boards = renderSeasonBoards(data, options, now) + renderPostseasonBoard(data, options, now);
  const board = shape
    ? `<div class="sct-sched-grid">` +
      `<div class="sct-sched-main">${boards}</div>` +
      shape +
      `</div>`
    : boards;

  // Below the tools block with the other tabs' questions, and assigned after
  // the early return above: a team whose fixtures did not load carries no
  // questions about them.
  tail.html = faqBlock(
    faqList(scheduleFaq({ team, schedule, now }), faq, "h3"),
  );

  const networks = [
    ...schedule.games.map((game) => game.network),
    ...(data.postseason?.games.map((game) => game.network) ?? []),
  ];

  return (
    h2(`${team.fullName} Schedule`) +
    scheduleContext(data) +
    networkDefs(networks) +
    renderNextGameModule(data, options, now) +
    board +
    // Every opponent, not just this season's: see renderSeriesIndex().
    renderSeriesIndex(team, options) +
    renderMoreLinks(team, options)
  );
}

/* -------------------------------------------------------------- resources */

/**
 * A section's tail, as a sibling of the panels and of the tools block.
 *
 * `data-sct-faq-for` names the panel it belongs to; team.css shows the one
 * whose tab is open and hides the rest, using the same :target / .is-active
 * pair the panels themselves switch on.
 */
/**
 * Whether a section's content belongs to an address other than the hub's.
 *
 * True for the sections in PUBLIC_SECTIONS that are neither the hub itself nor
 * carried on it as a hash tab or a preview: Usage, Stats, News, the Depth
 * Chart and Matchups. Each of those is a page of its own, with its own title,
 * description, canonical and sitemap entry - so the hub does not print it.
 *
 * It used to. Every section rendered into the hub's HTML and CSS hid all but
 * one, which made `/<slug>/` a document that contained, in full, the semantic
 * content of four other indexable URLs: the Stats tables, the Usage report,
 * the news archive and the depth chart, each duplicated under the hub's
 * address and each describing itself in the hub's FAQPage. The hub now ships
 * what is its own - the Outlook, the hub-only panels and the schedule preview
 * - plus the shared shell: the hero and the section strip, whose links still
 * name every address. A reader clicking Stats loads the Stats page, which is
 * what the link always said it did; client/team.ts prefetches it on intent so
 * that load is warm.
 */
function ownsAddress(section: Section): boolean {
  return (
    section.id !== HUB_SECTION &&
    section.hash !== true &&
    section.previewOnHub !== true &&
    (PUBLIC_SECTIONS as readonly string[]).includes(section.id)
  );
}

function renderTails(sections: Section[]): string {
  return sections
    .filter((section) => section.tail)
    .map(
      (section) =>
        `<div class="sct-faq-tail" data-sct-faq-for="${escapeHtml(section.id)}">` +
        section.tail +
        `</div>`,
    )
    .join("");
}


/**
 * "Use this research": the page's conversion block (mak, 2026-10-05). The two
 * products first, then the two team pages a reader acts on next - this club's
 * usage report and its next matchup's preview. The tool directory it replaced
 * still lives in the Quick Links rail (resourceCards).
 *
 * NOT MOUNTED since 2026-10-09: mak asked for the block to come off the team
 * pages. Kept, like renderCornerstones, so putting it back is one line at
 * each of the two mount points in renderTeamPage (after the panels, before
 * renderTails). The Usage tab's own close ("Put this usage data to work")
 * still renders.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderResources(
  data: TeamPageData,
  options: TeamRenderOptions,
  now: number,
  scopedId?: string,
): string {
  const { team } = data;
  const prefix = options.teamPathPrefix ?? "/team/";
  const next = nextGame(data.schedule, now);
  const preview = next ? matchupHref(team, next.opponent, options) : null;
  // The Usage tab closes on its own conversion block ("Put this usage data
  // to work"), so the shared one is hidden there by team.css and left out of
  // the scoped /usage/ page.
  if (scopedId === "usage") return "";
  const cards: Array<{ href: string | null; title: string; body: string }> = [
    { href: REDRAFT_COMMAND_URL, title: "Redraft Command", body: "Lineups, trades, waivers and projections for your league." },
    { href: DYNASTY_COMMAND_URL, title: "Dynasty Command", body: "Dynasty values, trades and league analysis." },
    { href: sectionPath(prefix, team.slug, "usage"), title: `${team.nickname} Snap Counts & Usage`, body: "Who is on the field and who gets the ball." },
    { href: preview, title: `${team.nickname} Matchup Preview`, body: "This week's fantasy outlook." },
  ];
  return (
    `<section class="sct-section" id="resources">` +
    h2("Use this research") +
    `<ul class="sct-resources">` +
    cards
      .filter((card) => card.href)
      .map(
        (card) =>
          `<li class="sct-resource">` +
          // Absolute tool URLs break out of a legacy frame; the hub's own
          // root-relative pages stay plain anchors, like the tab nav and
          // matchup links (a sandboxed preview frame blocks _top outright).
          `<a class="sct-resource-link" href="${escapeHtml(card.href as string)}"${/^https?:/.test(card.href as string) ? ` target="_top"` : ""}>` +
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

  // The Outlook tab is the outlook alone. Fantasy Cornerstones used to follow
  // it; renderCornerstones() is still here and still correct, just not mounted
  // - see the note above it.
  //
  // A sink PER SECTION rather than one for the page, because a section-scoped
  // URL emits one panel and its schema must describe that panel alone. The
  // sections still all render - the tab strip is built from what produced
  // markup - so a single sink would put the Stats questions in the Schedule
  // page's FAQPage, which is markup saying something the page does not. The
  // hub's FAQPage is the same rule from the other side: only the questions of
  // the panels the hub actually prints (see ownsAddress).
  // Concatenated in section order below, which is the render order the
  // page-level FAQPage already had.
  const outlookFaq: FaqSink = [];
  const statsFaq: FaqSink = [];
  // The questions each tab drew, as markup. They render below the tools block
  // rather than inside their panel - see `Section.tail`.
  const outlookTail: TailSink = { html: "" };
  const statsTail: TailSink = { html: "" };
  const depthChartFaq: FaqSink = [];
  const depthTail: TailSink = { html: "" };
  const scheduleFaqItems: FaqSink = [];
  const scheduleTail: TailSink = { html: "" };
  const outlook = renderOutlook(data, outlookFaq, outlookTail);
  const usageView = buildUsageView(
    team.abbreviation,
    data.state.season,
    data.roster?.players ?? null,
  );
  // The report's matchup handoffs point at the next game's page.
  const upNext = nextGame(data.schedule, now);
  const nextHref = upNext ? matchupHref(team, upNext.opponent, options) : null;
  const usage = renderUsageSection(usageView, team, {
    matchup: nextHref && upNext?.opponent ? { href: nextHref, opponent: upNext.opponent.nickname } : null,
  });
  const teamCoaching = getTeamCoaching(team.abbreviation, data.state.season);
  const coaching = renderCoachingSection(teamCoaching, team, usageView);
  // A new play-caller makes last season's data an unreliable guide, and the
  // Outlook is where this page projects from it - the LOW rating surfaces
  // there, per the coaching spec. Empty for HIGH and MEDIUM.
  const caveat = coachingCaveat(teamCoaching);

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

  // The snapshot heading leads the Stats tab. Concatenated rather than folded
  // into renderTeamStats() so the tab still appears carrying the heading alone
  // when ESPN's season statistics fail but its team summary does not - the two
  // come from different endpoints and fail independently.
  const stats =
    renderSnapshot(data) + renderTeamStats(data, statsFaq, statsTail);
  const depth = renderDepthChart(data, options, depthChartFaq, depthTail);
  // Next draft's picks by round and the last five draft classes, from two
  // committed files (team/draft.ts). "" when neither has this club.
  const draftView = getDraftView(team.abbreviation, data.state.season);
  const draft = renderDraftSection(team, draftView, data.state.season);
  // This season's contracts from the committed register file (team/contracts.ts).
  const contractsView = getContractsView(team.abbreviation, data.state.season);
  const contracts = renderContractsSection(team, contractsView);
  // Both tabs' club-specific FAQs (mak, 2026-11-02) are tails like the
  // other tabs' questions, and in the hub's FAQPage (approved the same day).
  const draftFaqItems = draft ? draftFaq(team, draftView) : [];
  const contractsFaqItems = contracts && contractsView ? contractsFaq(team, contractsView) : [];
  const draftTail = renderFaqBlock(`${team.fullName} Draft Picks & History FAQ`, draftFaqItems, "sct-dr-faq");
  const contractsTail = renderFaqBlock(`${team.fullName} Contracts & Salary Cap FAQ`, contractsFaqItems, "sct-ct-faq");
  // The whole schedule only on its own address; the hub gets the preview
  // (last game, next game, the two after) and a link to the page.
  const schedule = renderSchedule(
    data,
    options,
    now,
    scheduleFaqItems,
    scheduleTail,
    options.section === "schedule" ? "full" : "preview",
  );
  const matchups = renderMatchups(data, options, now);

  // Built from what actually rendered: a section that produced no markup is not
  // in the page and must not be in the navigation pointing at nothing.
  const sections: Section[] = [
    {
      id: "outlook",
      label: "Outlook",
      html: outlook === "" ? "" : caveat + outlook,
      faq: outlookFaq,
      tail: outlookTail.html,
    },
    // Between Outlook and Stats, per the spec.
    {
      id: "usage",
      label: "Usage",
      html: usage.html,
      faq: usage.faq,
      tail: usage.faqHtml,
    },
    // Between Usage and Stats, per the coaching spec. Its own address since
    // mak's coaching brief (2026-11-05): /coaching/ carries the Offensive
    // Coordinator & Scheme page, and the hub links it like Usage.
    {
      id: "coaching",
      label: "Coaching",
      html: coaching.html,
      faq: coaching.faq,
      tail: coaching.faqHtml,
    },
    // Directly right of Outlook rather than behind the news archive: it now
    // opens with the Team Snapshot and expands it, so it is the whole team at a
    // glance and then the same reading one level deeper.
    {
      id: "stats",
      label: "Stats",
      html: stats,
      faq: statsFaq,
      tail: statsTail.html,
    },
    // Right of Stats (mak, 2026-10-23). A hub-only panel like Coaching: its
    // tab is the hub's address plus #draft until a public URL is approved.
    { id: "draft", label: "Draft", html: draft, hash: true, faq: faqEntries(draftFaqItems), tail: draftTail },
    // Right of Draft (mak, 2026-10-23), hub-only for the same reason.
    { id: "contracts", label: "Contracts", html: contracts, hash: true, faq: faqEntries(contractsFaqItems), tail: contractsTail },
    { id: "news", label: "News", html: newsSection },
    {
      id: "depth-chart",
      label: "Depth Chart",
      html: depth,
      faq: depthChartFaq,
      tail: depthTail.html,
    },
    {
      id: "schedule",
      label: "Schedule",
      html: schedule,
      faq: scheduleFaqItems,
      tail: scheduleTail.html,
      previewOnHub: true,
    },
    { id: "matchups", label: "Matchups", html: matchups, hubTab: false },
  ].filter((section) => section.html !== "");

  // One place a team's colors enter the page. Everything team-tinted below
  // reads these custom properties, so there is no per-team CSS and no component
  // that has to know which team it is drawing.
  const rootStyle = styleAttr([
    `--team-primary:${team.primaryColor}`,
    `--team-secondary:${team.secondaryColor}`,
    `--team-logo:url('${team.logo}')`,
  ]);

  const rootAttrs =
    `class="sct${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-team="${escapeHtml(team.abbreviation)}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"`;

  /**
   * One section as the whole page.
   *
   * The tab strip is replaced by a link back to the hub, because a strip of
   * five tabs that all leave this URL is navigation pretending to be tabs.
   * Everything else - the hero, the resources block, the markup of the section
   * itself - is unchanged, so the two addresses render the same component and
   * cannot drift.
   *
   * An unknown id finds nothing here and falls through to the hub below, which
   * is why a stale section link degrades to the full page rather than 404ing.
   */
  const scopedSection = String(options.section ?? "");
  // The Outlook is not a section page: it is the hub, which opens on it.
  // `/outlook/` 301s to the hub, and anything that still asks for it scoped
  // gets the hub rather than a second copy at a second address.
  const scoped = scopedSection && scopedSection !== HUB_SECTION
    ? sections.find((entry) => entry.id === scopedSection)
    : undefined;

  // Hoisted above the scoped branch, because a section page now carries the
  // strip as well. It used to render without one on the grounds that five tabs
  // all leaving the URL is navigation pretending to be tabs - true when they
  // were `#hash` links, and the opposite of true now that they are addresses.
  // A reader who arrives on the Schedule page with no way to reach the Depth
  // Chart is the cost of leaving it off, and it is paid by every visitor from
  // search, who is the reason these pages exist.
  const tabs = sections.filter((section) => section.hubTab !== false);

  if (scoped) {
    return (
      `<div ${rootAttrs} data-section="${escapeHtml(scoped.id)}"${rootStyle}>` +
      teamHeader(data, options, tabs, scoped.id) +
      `<section class="sct-section is-default is-active" data-sct-panel` +
      ` id="${escapeHtml(scoped.id)}">` +
      (options.ownHeading
        ? promoteHeading(
            scoped.html,
            teamSectionHeading(team.fullName, scoped.id, data.state.season) ?? undefined,
          )
        : scoped.html) +
      `</section>` +
      renderTails([scoped]) +
      // Scoped to this section: a Schedule page carrying the Stats questions
      // would be structured data describing a page the reader is not on.
      faqSchema(scoped.faq ?? [], options) +
      (scoped.id === "schedule" ? scheduleSchema(data, options) : "") +
      `</div>`
    );
  }

  // The panels the hub prints: its own section, the hub-only hash tabs and
  // the schedule preview. A section that owns an address is a tab here and a
  // panel only at that address (ownsAddress) - the strip above still links to
  // it, so the hub's navigation is whole while its content is its own.
  const panels = tabs.filter((section) => !ownsAddress(section));

  // `is-default` marks the panel that shows when the URL names no section. It
  // is a class rather than :first-of-type because the CSS must not depend on
  // this element being the first <section> among its siblings - the hero and
  // the resources block are sections too, and a reorder here would silently
  // blank the page rather than fail visibly.
  // The hub's FAQPage: every printed panel's questions, in the order the
  // panels appear, which is the order their questions appear in the document.
  const faq: FaqSink = panels.flatMap((section) => section.faq ?? []);

  const body = panels
    .map(
      (section, i) =>
        `<section class="sct-section${i === 0 ? " is-default is-active" : ""}"` +
        ` data-sct-panel id="${escapeHtml(section.id)}"` +
        ` aria-labelledby="${escapeHtml(section.id)}-tab">` +
        // Only the panel the page opens on, so the document has one H1
        // whichever tab a reader switches to. It reads as the hub rather than
        // as the panel: this address is the hub.
        (options.ownHeading && i === 0
          ? promoteHeading(section.html, teamHubHeading(team.fullName, data.state.season))
          : section.html) +
        `</section>`,
    )
    .join("");

  return (
    `<div ${rootAttrs}${rootStyle}>` +
    teamHeader(data, options, tabs) +
    body +
    renderTails(panels) +
    // After the sections, because it describes them: `faq` is only complete
    // once every block above has had its chance to render.
    faqSchema(faq, options) +
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

/** What the index renderers take besides the teams. */
export interface TeamIndexOptions {
  linkQuery?: string;
  teamPathPrefix?: string;
  /**
   * The league table, keyed by ESPN team id. Null or absent when ESPN could
   * not supply it, and the cards fall back to the plain list - the index's
   * job is 32 links, and a standings outage must not cost it that.
   */
  standings?: LeagueStandings | null;
}

/** ".833" - the win percentage the way a standings table prints it. */
function winPct(value: number): string {
  const fixed = Math.min(1, Math.max(0, value)).toFixed(3);
  return fixed.startsWith("0") ? fixed.slice(1) : fixed;
}

/**
 * The 32 hubs, grouped by conference and division.
 *
 * Shared by the standalone /team page and by the fragment the WordPress
 * container page at /nfl/teams/ mounts, for the reason every other pair of
 * addresses here shares a renderer: two copies of a list of 32 teams is two
 * lists that drift, and the one nobody looks at is the one that goes stale.
 *
 * Each division is a standings card: the four clubs in the order the
 * tiebreakers put them, with W, L, T and PCT beside each name and a bar for
 * the percentage, the leader's row tinted. A reader looking for a hub finds
 * the crest exactly as before; a reader looking at the league finds the table
 * - which is the page the 32-team index was always being asked to be, where
 * eight bare lists of names were a sitemap.
 *
 * The cards sit two across under each conference's ruled heading, so the
 * eight tables read as two short bands rather than a column of sixteen rows.
 *
 * Without a table (ESPN down, or the one it serves before Week 1, which is
 * 32 lines of 0-0-0) the cards keep their shape and drop the numbers: no
 * place, no columns, the division's canonical order. The rows keep the
 * switcher's classes, because the row is genuinely the same thing in both
 * places; only the arrangement around them is the index's own (see
 * .sct-index-* in team.css).
 */
function renderTeamIndexGrid(
  teams: readonly NflTeam[],
  options: TeamIndexOptions = {},
): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const standings =
    options.standings && leagueHasPlayed(options.standings)
      ? options.standings
      : null;

  const groups = TEAM_GROUPS.map((conference) => {
    const divisions = conference.divisions
      .map((division) => {
        const members = division.teams.filter((team) =>
          teams.some((t) => t.abbreviation === team.abbreviation),
        );
        // Only a complete table orders the card: a division with one club
        // missing from the table is a division whose places cannot be trusted.
        const lines = standings
          ? members.map((team) => standings.get(team.espnId) ?? null)
          : [];
        const tabled =
          standings !== null && lines.every((line) => line !== null);
        const ordered = tabled
          ? members
              .map((team, i) => ({ team, line: lines[i] as StandingsLine }))
              .sort((a, b) => a.line.place - b.line.place)
          : members.map((team) => ({ team, line: null }));

        const rows = ordered
          .map(({ team, line }) => {
            const record = line
              ? `<span class="sct-index-rec" aria-label="${escapeHtml(
                  `${line.wins}-${line.losses}-${line.ties}, ${winPct(line.winPercent)}`,
                )}">` +
                `<span class="sct-index-num" aria-hidden="true">${line.wins}</span>` +
                `<span class="sct-index-num" aria-hidden="true">${line.losses}</span>` +
                `<span class="sct-index-num" aria-hidden="true">${line.ties}</span>` +
                `<span class="sct-index-num is-pct" aria-hidden="true">${winPct(line.winPercent)}</span>` +
                `<span class="sct-index-bar" aria-hidden="true">` +
                `<span class="sct-index-bar-fill" style="width:${Math.round(
                  Math.min(1, Math.max(0, line.winPercent)) * 100,
                )}%"></span></span>` +
                `</span>`
              : // The row has no underline and no link color of its own, so
                // the arrow is what says it is one. It is drawn on hover and
                // rests visible on a touch screen; see .sct-index-div
                // .sct-arrow. With a record the numbers fill that edge.
                ARROW;
            return (
              `<li${line?.place === 1 ? ` class="is-leader"` : ""}>` +
              `<a class="sct-switch-team" href="${escapeHtml(`${prefix}${team.slug}/${query}`)}"` +
              ` title="${escapeHtml(team.fullName)}">` +
              (line
                ? `<span class="sct-index-place" aria-hidden="true">${line.place}</span>`
                : "") +
              `<img class="sct-switch-logo" src="${escapeHtml(team.logo)}" alt=""` +
              ` width="24" height="24" loading="lazy" decoding="async" />` +
              `<span class="sct-index-name">${escapeHtml(team.nickname)}</span>` +
              record +
              `</a></li>`
            );
          })
          .join("");

        const columns = tabled
          ? `<span class="sct-index-cols" aria-hidden="true">` +
            `<span>W</span><span>L</span><span>T</span><span>PCT</span>` +
            `</span>`
          : "";
        return (
          `<div class="sct-switch-div sct-index-div${tabled ? " has-standings" : ""}">` +
          `<div class="sct-index-head">` +
          `<p class="sct-switch-div-title">${escapeHtml(division.division)}</p>` +
          columns +
          `</div>` +
          `<ul class="sct-switch-list">${rows}</ul>` +
          `</div>`
        );
      })
      .join("");
    return (
      `<section class="sct-switch-conf">` +
      `<h2 class="sct-switch-conf-title">${escapeHtml(conference.conference)}</h2>` +
      `<div class="sct-index-divs">${divisions}</div>` +
      `</section>`
    );
  }).join("");

  return `<div class="sct-switch-grid is-index"${standings ? ` data-standings="1"` : ""}>${groups}</div>`;
}

/**
 * The index as a bare fragment, for the WordPress container page to print.
 *
 * No hero and no H1: the page at /nfl/teams/ supplies both, the same division
 * of labor every other mount here follows. Without this the container page is
 * whatever WordPress content happens to sit in it - which is what it was, a
 * stub list of 32 links in the theme's own styling, looking nothing like the
 * hubs it points at.
 */
export function renderTeamIndexFragment(
  teams: readonly NflTeam[],
  options: TeamIndexOptions = {},
): string {
  return (
    `<div class="sct is-embed" data-sct-index="1">` +
    `<div class="sct-section">${renderTeamIndexGrid(teams, options)}</div>` +
    `</div>`
  );
}

/** The index as its own page on this origin: /team. */
export function renderTeamIndex(
  teams: readonly NflTeam[],
  options: TeamIndexOptions = {},
): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>NFL Team Hubs | StatChasers</title>` +
    `<meta name="robots" content="noindex, indexifembedded" />` +
    `<link rel="stylesheet" href="/team.css" />` +
    `</head><body class="sct-page"><div class="sct">` +
    `<div class="sct-section">${renderTeamIndexGrid(teams, options)}</div>` +
    `</div></body></html>`
  );
}
