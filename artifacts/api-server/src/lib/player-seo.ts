/**
 * Metadata for a player page.
 *
 * Same posture as the news tool (lib/seo.ts) and the team hubs (lib/team-seo.ts):
 * everything is in the initial HTML, nothing is amended by JavaScript, and the
 * canonical is a plain tag rather than something applied at runtime.
 *
 * These pages are not meant to rank on this origin. The public URL is
 * `https://statchasers.com/nfl/players/<slug>/`, and WordPress owns the title,
 * description, canonical and schema there. What this server serves is the
 * embedded tool, so it ships `noindex, indexifembedded` - out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 *
 * The canonical stays self-referencing and always points at the PPR URL. The
 * scoring format is the one piece of genuine state these pages carry in a query
 * string, and three formats of the same profile are three renderings of one
 * page, not three pages - so `?format=half` canonicalizes to the bare slug.
 */

import { escapeHtml } from "./render";
import { OUTLOOK_SEASON } from "./player/header";
import type { PlayerPageData } from "./player/player-data";
import { bioDescription, bioPersonNode } from "./player/bio-seo";
import { getTeamHubUrl } from "./team/links";
import { injuryAnswer } from "./player/injury-tab";
import { SCORING_SHORT } from "./player/scoring";
import {
  currentRank,
  gamePoints,
  inSeason,
  lastGame,
  nextGame,
  oneDecimal,
  oppPhrase,
  seasonPpg,
} from "./player/season-phase";
import { fitTitle } from "./title-fit";

export interface PlayerPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
  /** Absolute headshot URL for og:image, when there is one. */
  image: string | null;
}

const SITE_NAME = "StatChasers";

/** What a results page shows of a description before it cuts it. */
const DESCRIPTION_MAX = 155;

/** The month-and-day a title carries: "Oct 9". */
function monD(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}`;
}

/**
 * Title and description for a section-scoped page.
 *
 * A section URL exists to answer one kind of query, so it gets a title written
 * for that query rather than the profile's generic one. The injury entry is
 * deliberately built to carry both intents - the current status and the
 * history - because they are the same page and splitting them would put two
 * thin pages where one good one belongs.
 *
 * Returns null for a section with no written metadata; the caller falls back to
 * the profile's own.
 */
function sectionMeta(
  data: PlayerPageData,
  section: string,
): { title: string; description: string } | null {
  const { player, season } = data;
  const position = player.position ? `${player.position} ` : "";

  if (section === "stats") {
    return {
      // Every section title is a ladder for fitTitle(): the fullest wording
      // that fits sixty characters, and a shorter rung for the longest names
      // (mak approved the wording, 2026-10-08).
      title: fitTitle([
        `${player.name} Stats ${season}: Fantasy Points & Career Stats`,
        `${player.name} Stats ${season}: Fantasy Points & Rank`,
      ]),
      description:
        `${player.name} ${season} stats: ${position}season totals, fantasy ` +
        `points and positional rank, career stats by season from his rookie ` +
        `year, and career bests.`,
    };
  }

  if (section === "injury") {
    // Answer first (mak, 2026-10-09): the title carries the date of the
    // latest report or status change for him - not today's - and the
    // description opens on the same Yes/No the page does. The answer needs
    // the injury record; without one the section does not exist and the
    // plugin redirects it, so the wording below it is only ever a fallback.
    const ans = injuryAnswer(data);
    if (ans) {
      const when = monD(ans.updated);
      return {
        title: fitTitle([
          `${player.name} Injury Update & History (Updated ${when})`,
          `${player.name} Injury Update & History (${when})`,
          `${player.name} Injury Update (${when})`,
        ]),
        description: fitTitle(
          [
            `${ans.lead} ${player.name} injury history: every logged injury, games missed and recovery timelines.`,
            `${ans.lead} ${player.name} injury history: every logged injury and games missed.`,
            `${ans.lead} ${player.name} injury history and games missed.`,
          ],
          DESCRIPTION_MAX,
        ),
      };
    }
    return {
      title: fitTitle([
        `${player.name} Injury Update, Status & History ${season}`,
        `${player.name} Injury Update & History ${season}`,
      ]),
      description:
        `${player.name} injury update: current status and designation, ` +
        `${season} games missed, and every logged injury of his career with ` +
        `games missed by body part.`,
    };
  }

  if (section === "bio") {
    // Deliberately no fantasy words in either string. Bio is the one section
    // whose queries are biographical - age, height, college, draft, where he
    // is from - and a title promising fantasy analysis would be competing for
    // the wrong ones while the profile page competes for the right ones.
    // The Bio spec's title and description (2.11, approved by mak
    // 2026-09-30), from the sourced fact store when the player has a record.
    const profile = data.bioProfile;
    const born = profile.facts.find((fact) => fact.label === "Born")?.value;
    const college = profile.college;
    const title = `${player.name} Bio: Age, Height, College & Draft`;
    const specDescription = data.bioPage ? bioDescription(data, data.bioPage) : null;
    if (specDescription) return { title, description: specDescription };

    return {
      title,
      description:
        `${player.name} bio: age, height, weight` +
        `${born ? `, born ${born}` : ""}` +
        `${college ? `, ${college}` : ""}` +
        `, NFL draft position and full career team history.`,
    };
  }

  if (section === "outlook") {
    // OUTLOOK_SEASON, not the season the player last played: the tab is the
    // 2026 outlook for everybody, and a player with no 2026 snaps yet got a
    // "2025" title over a 2026 H1.
    //
    // In season the page is a rest-of-season read and says so (mak,
    // 2026-10-09); before Week 1 and after the last game the draft-day
    // wording stands. The spec gives no shorter rung for the in-season
    // title, so the long names fall back to "ROS Value", then to the bare
    // phrase.
    if (inSeason(data)) {
      return {
        title: fitTitle([
          `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: Rest-of-Season Value`,
          `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: ROS Value`,
          `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}`,
        ]),
        description:
          `${player.name} rest-of-season fantasy outlook: role, usage trend and ` +
          `trade and lineup value for the rest of ${OUTLOOK_SEASON}.`,
      };
    }
    return {
      title: fitTitle([
        `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: Role, Usage & Value`,
        `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: Role & Usage`,
      ]),
      description:
        `${player.name} ${OUTLOOK_SEASON} fantasy outlook: his ${position}role, the ` +
        `usage behind it and what it is worth on draft day.`,
    };
  }

  if (section === "news") {
    return {
      title: `${player.name} News & Fantasy Analysis`,
      description:
        `The latest ${player.name} news and updates, and what each item ` +
        `changes for fantasy.`,
    };
  }

  if (section === "game-log") {
    // The ACTIVE season, on every rendering of this page. `?log=2023` adds
    // 2023's table under the season selector and leaves the current season
    // where it was, so the page is still the current season's game log and a
    // title naming 2023 would describe the block at the bottom of it.
    const year = data.season;
    const title = fitTitle([
      `${player.name} Game Log ${year}: Fantasy Points by Week`,
      `${player.name} Game Log ${year}: Week by Week`,
    ]);
    // The description leads with his latest game (mak, 2026-10-09): "how many
    // fantasy points did X have" is the tab's top search.
    const last = lastGame(data);
    if (last) {
      const pts = `${oneDecimal(gamePoints(data, last))} ${SCORING_SHORT[data.format]} points`;
      return {
        title,
        description: fitTitle(
          [
            `${player.name} scored ${pts} in Week ${last.week} ${oppPhrase(last.opp)}. ` +
              `Full ${year} game log: fantasy points, stats and positional finish by week.`,
            `${player.name} scored ${pts} in Week ${last.week} ${oppPhrase(last.opp)}. ` +
              `Full ${year} game log: fantasy points and stats by week.`,
          ],
          DESCRIPTION_MAX,
        ),
      };
    }
    return {
      title,
      description:
        `${player.name} ${year} game log: fantasy points by week, ` +
        `${position}stats game by game, weekly positional finish and the ` +
        `last-five-games trend.`,
    };
  }

  return null;
}

/**
 * The profile's own title and description (mak, 2026-10-09).
 *
 * The title names the search the hub ranks for - "X fantasy" - and the year,
 * and gives way by rungs for the long names. The description is built from
 * live data in season: his rank, his points per game and the next game. The
 * Stats, Injury and Bio tabs own "stats", "injury" and "age", so neither
 * string reaches for those words beyond the title's one "Stats".
 *
 * MIRRORED in statchasers_player_page_meta() in the WordPress plugin, which
 * writes the stored copy; in season the plugin prefers this live one.
 */
export function profileMeta(data: PlayerPageData): { title: string; description: string } {
  const { player } = data;
  const year = data.leagueSeason;
  const pos = player.position ?? "";
  const team = data.team?.code ?? "";
  const who = pos && team ? `${player.name} (${pos}, ${team})` : pos ? `${player.name} (${pos})` : player.name;

  const title = fitTitle([
    `${player.name} Fantasy Football ${year}: Stats, Outlook & News`,
    `${player.name} Fantasy Football ${year}: Stats & Outlook`,
    `${player.name} Fantasy ${year}: Stats & Outlook`,
  ]);

  const rank = currentRank(data);
  const ppg = seasonPpg(data);
  const next = nextGame(data);
  // ppg > 0, not just played: a rank by total points with 0.0 beside it is
  // true of every healthy scratch and reads as a mistake.
  if (inSeason(data) && data.season === year && pos && rank !== null && ppg !== null && ppg > 0 && next) {
    const scoring = SCORING_SHORT[data.format];
    const game = `Week ${next.week} ${next.homeAway === "home" ? "vs" : "at"} ${next.opponentCode}`;
    return {
      title,
      description: fitTitle(
        [
          `${who} fantasy outlook: ${pos}${rank} with ${oneDecimal(ppg)} ${scoring} points per game in ${year}. ` +
            `${game}: start/sit call, injury status and trade value.`,
          `${who} fantasy outlook: ${pos}${rank}, ${oneDecimal(ppg)} ${scoring} points per game in ${year}. ` +
            `${game}: start/sit, injury status and trade value.`,
        ],
        DESCRIPTION_MAX,
      ),
    };
  }
  return {
    title,
    description:
      `${who} fantasy football profile: ${year} outlook, projections, stats, ` +
      `injury history and dynasty value.`,
  };
}

export function playerPageMeta(
  data: PlayerPageData,
  canonical: string,
  section?: string,
): PlayerPageMeta {
  const { player } = data;

  const scoped = section ? sectionMeta(data, section) : null;
  const own = scoped ?? profileMeta(data);

  return {
    title: own.title,
    description: own.description,
    canonical,
    siteName: SITE_NAME,
    image: player.headshotUrl ?? null,
  };
}

export function renderPlayerHeadTags(meta: PlayerPageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    // "profile" rather than "website": this page is about a person.
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
  }
  return tags.join("\n  ");
}

/**
 * The Person the hub's ProfilePage is about (the SEO brief of 2026-10-10):
 * the Bio tab's node - name, birth date, height, weight, position - with his
 * club as an affiliation that links the team hub. Built from the approved
 * fact store only, like the Bio's; null for a player with no bio record,
 * who gets no ProfilePage rather than a bare one. No sameAs: nothing on a
 * page names an outside source (house rule, 2026-10-09).
 */
export function hubPersonNode(data: PlayerPageData): Record<string, unknown> | null {
  if (!data.bioPage) return null;
  const node = bioPersonNode(data, data.bioPage);
  if (data.team) {
    const url = getTeamHubUrl(data.team);
    node["affiliation"] = { "@type": "SportsTeam", name: data.team.fullName, ...(url ? { url } : {}) };
  }
  return node;
}

/**
 * The day a page's data last moved, "2026-10-09" in the Eastern calendar:
 * the kickoff of his latest game played, the one fact every tab's numbers
 * trail. The ProfilePage's dateModified, and the WebPage's on the Stats,
 * Game Log and Outlook tabs (the SEO brief of 2026-10-10). Null before he
 * has played a game the schedule can date.
 */
export function dataModified(data: PlayerPageData): string | null {
  const last = lastGame(data);
  if (!last) return null;
  const game = data.schedule.find((g) => g.week === last.week && g.kickoffMs !== null);
  if (!game || game.kickoffMs === null) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(game.kickoffMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
