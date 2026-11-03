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
import { playerShareImage, type PlayerShareImage } from "./player/share-image";
import { getTeamHubUrl } from "./team/links";
import { injuryAnswer } from "./player/injury-tab";
import { SCORING_SHORT } from "./player/scoring";
import {
  gamePoints,
  inSeason,
  lastGame,
  oneDecimal,
  oppPhrase,
} from "./player/season-phase";
import { fitTitle, TITLE_MAX } from "./title-fit";

export interface PlayerPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
  /** His headshot for og:image and twitter:image, when Sleeper has one. */
  image: PlayerShareImage | null;
}

const SITE_NAME = "StatChasers";

/** What a results page shows of a description before it cuts it. */
const DESCRIPTION_MAX = 155;

/**
 * How long a title may run when it ends in " | StatChasers".
 *
 * mak's player-entity brief (2026-11-03) puts the brand on every player
 * title: "{Name} Stats, News, Bio & Fantasy Outlook | StatChasers". The
 * sixty-character rule of 2026-10-08 still governs the words before the
 * brand; the brand itself is the one thing a results page may cut without
 * losing meaning, so a branded title is allowed ten more characters and the
 * brand is the first rung to go for a long name. The plugin's stored copy
 * (statchasers_player_title_ladder) is built the same way.
 */
const BRANDED_MAX = TITLE_MAX + 10;

/**
 * The first wording that fits, branded where the brand still fits.
 *
 * `cores` is a ladder of wordings, fullest first, without the brand. Each
 * rung is tried with " | StatChasers" (within BRANDED_MAX), then bare (within
 * TITLE_MAX), before the next rung is tried at all - so a name that forces
 * the brand off keeps the fuller wording, and only the longest names lose
 * both. The last rung is returned bare whatever its length.
 *
 * MIRRORED in statchasers_branded_title() in the WordPress plugin.
 */
export function brandedTitle(cores: string[]): string {
  for (const core of cores) {
    const branded = `${core} | ${SITE_NAME}`;
    if (branded.length <= BRANDED_MAX) return branded;
    if (core.length <= TITLE_MAX) return core;
  }
  return cores[cores.length - 1] ?? "";
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
      // Every section title is a ladder: the fullest wording that fits, and
      // a shorter rung for the longest names. The wording is mak's
      // player-entity brief of 2026-11-03 - the page owns "stats" and
      // "career statistics", and the year lives in the H2s, not the title,
      // so the address stays evergreen.
      title: brandedTitle([
        `${player.name} Stats & Career Statistics`,
        `${player.name} Stats & Career Stats`,
        `${player.name} Stats`,
      ]),
      description: fitTitle(
        [
          `${player.name} ${season} stats and career statistics: ${position}season totals, ` +
            `advanced metrics, fantasy points and positional rank, and points per game every season.`,
          `${player.name} ${season} stats and career statistics: ${position}season totals, ` +
            `advanced metrics, fantasy points, positional rank and points per game.`,
          `${player.name} ${season} stats and career statistics: season totals, advanced metrics and fantasy points.`,
        ],
        DESCRIPTION_MAX,
      ),
    };
  }

  if (section === "injury") {
    // Answer first (mak, 2026-10-09): the title carries the date of the
    // latest report or status change for him - not today's - and the
    // description opens on the same Yes/No the page does. The answer needs
    // the injury record; without one the section does not exist and the
    // plugin redirects it, so the wording below it is only ever a fallback.
    // The title is mak's brief of 2026-11-03: "{Name} Injury Status &
    // History", evergreen. The date of the latest report moved from the
    // title into the description's "(checked Mon D)" and the page's
    // dateModified, where it still says how fresh the answer is.
    const title = brandedTitle([
      `${player.name} Injury Status & History`,
      `${player.name} Injury Status`,
    ]);
    const ans = injuryAnswer(data);
    if (ans) {
      return {
        title,
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
      title,
      description:
        `${player.name} injury status: current designation, ` +
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
    const title = brandedTitle([
      `${player.name} Bio: Age, Height, College & Draft`,
      `${player.name} Bio: Age, Height & College`,
      `${player.name} Bio`,
    ]);
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
    // The title is mak's brief of 2026-11-03, evergreen; the season phase
    // still decides the description, which is where the year belongs.
    const title = brandedTitle([
      `${player.name} Fantasy Outlook, Rankings & Projections`,
      `${player.name} Fantasy Outlook & Projections`,
      `${player.name} Fantasy Outlook`,
    ]);
    if (inSeason(data)) {
      return {
        title,
        description:
          `${player.name} rest-of-season fantasy outlook: role, usage trend and ` +
          `trade and lineup value for the rest of ${OUTLOOK_SEASON}.`,
      };
    }
    return {
      title,
      description:
        `${player.name} ${OUTLOOK_SEASON} fantasy outlook: his ${position}role, the ` +
        `usage behind it and what it is worth on draft day.`,
    };
  }

  if (section === "news") {
    return {
      title: brandedTitle([
        `${player.name} News & Latest Updates`,
        `${player.name} News`,
      ]),
      description:
        `The latest ${player.name} news and updates: injury reports, practice ` +
        `notes, game recaps and transactions, and what each one changes for fantasy.`,
    };
  }

  if (section === "game-log") {
    // The ACTIVE season, on every rendering of this page. `?log=2023` adds
    // 2023's table under the season selector and leaves the current season
    // where it was, so the page is still the current season's game log and a
    // title naming 2023 would describe the block at the bottom of it.
    const year = data.season;
    const title = brandedTitle([
      `${player.name} Game Log & Weekly Stats`,
      `${player.name} Game Log`,
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
 * The profile's own title and description.
 *
 * mak's player-entity brief (2026-11-03): the hub is the player's page, not
 * a fantasy page, so the title is the evergreen "{Name} Stats, News, Bio &
 * Fantasy Outlook | StatChasers" with no year - the URL does not change
 * with the season and the title should not either. The year lives in the
 * section headings ("{Name} 2026 Stats"), which roll with the league season.
 * The brand gives way first for a long name, then the wording shortens.
 *
 * The description names what the page holds and, where it reads naturally,
 * the club and position - "George Pickens, Dallas Cowboys WR: ..." - so the
 * snippet answers "what team is he on" before the page is opened. The
 * "updated throughout the NFL season" close is true of every profile: the
 * season's data lands on the same page every week.
 *
 * MIRRORED in statchasers_player_page_meta() in the WordPress plugin, which
 * writes the stored copy; the plugin prefers this live one when it has it.
 */
export function profileMeta(data: PlayerPageData): { title: string; description: string } {
  const { player } = data;
  const pos = player.position ?? "";
  const team = data.team;

  const title = brandedTitle([
    `${player.name} Stats, News, Bio & Fantasy Outlook`,
    `${player.name} Stats, News & Fantasy Outlook`,
    `${player.name} Stats, News & Outlook`,
    `${player.name} Stats & News`,
  ]);

  const tail =
    "stats, game logs, news, injury updates, bio, career numbers and fantasy " +
    "football outlook. Updated throughout the NFL season.";
  const who = (club: string | null): string =>
    club && pos ? `${player.name}, ${club} ${pos}:` : pos ? `${player.name}, ${pos}:` : player.name;
  return {
    title,
    description: fitTitle(
      [
        `${who(team?.fullName ?? null)} ${tail}`,
        `${who(team?.nickname ?? null)} ${tail}`,
        `${who(team?.code ?? null)} ${tail}`,
        `${who(null)} ${tail}`,
        `${player.name} stats, game logs, news, injury updates, bio and fantasy outlook.`,
      ],
      DESCRIPTION_MAX,
    ),
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
    image: playerShareImage(data),
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
    const img = escapeHtml(meta.image.url);
    const alt = escapeHtml(meta.image.alt);
    tags.push(
      `<meta property="og:image" content="${img}" />`,
      `<meta property="og:image:width" content="${meta.image.width}" />`,
      `<meta property="og:image:height" content="${meta.image.height}" />`,
      `<meta property="og:image:alt" content="${alt}" />`,
      `<meta name="twitter:image" content="${img}" />`,
      `<meta name="twitter:image:alt" content="${alt}" />`,
    );
  }
  return tags.join("\n  ");
}

/**
 * The Person the hub's ProfilePage is about (the SEO brief of 2026-10-10):
 * the Bio tab's node - name, birth date, height, weight, position - with his
 * club as an affiliation that links the team hub. Built from the approved
 * fact store where the player has a record. A player without one (mak's
 * entity brief, 2026-11-03) gets the minimal node the page itself supports:
 * his name, his position as jobTitle, his club and his headshot - every one
 * of them printed in the hero - and nothing the page does not state. No
 * sameAs: nothing on a page names an outside source (house rule, 2026-10-09).
 */
export function hubPersonNode(data: PlayerPageData): Record<string, unknown> | null {
  const node: Record<string, unknown> = data.bioPage
    ? bioPersonNode(data, data.bioPage)
    : { "@type": "Person", name: data.player.name };
  if (!data.bioPage) {
    const image = playerShareImage(data);
    if (image) node["image"] = image.url;
    const pos = POSITION_TITLES[data.player.position ?? ""];
    if (pos) node["jobTitle"] = pos;
  }
  if (data.team) {
    const url = getTeamHubUrl(data.team);
    node["affiliation"] = { "@type": "SportsTeam", name: data.team.fullName, ...(url ? { url } : {}) };
  }
  return node;
}

/** jobTitle for the hub's fallback Person: the same words the Bio node uses. */
const POSITION_TITLES: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
  FB: "Fullback",
};

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
