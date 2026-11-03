/**
 * Structured data for a team's Schedule page: one ItemList of SportsEvents.
 *
 * It replaces the SoftwareApplication node the hub used to carry. A schedule is
 * a list of games, not an application, and Search Console held the old node to
 * the software-app rich result's rules - an aggregateRating we do not have and
 * will not invent. This describes what the reader actually sees.
 *
 * The host page's SEO plugin already emits WebPage and BreadcrumbList, so this
 * adds only the list. The plugin grafts it into that graph; the standalone page
 * prints it on its own.
 *
 * A game makes the list only when it has a CONFIRMED kickoff and a venue.
 * Google reads a SportsEvent as an Event, and an Event without startDate or
 * location is an error in Search Console - the thing this node exists to stop
 * producing. The games that miss out are the ones the league has not
 * scheduled, which the table marks TBD: a placeholder date in structured data
 * is a fabricated date, and the one place a wrong kickoff would be repeated
 * by every search engine that read it.
 */

import type { NflTeam } from "./teams";
import type { ScheduleGame, TeamSchedule } from "./schedule";
import { getTeamHubUrl } from "./links";

type Node = Record<string, unknown>;

function teamNode(team: NflTeam | null, fallbackName: string): Node {
  const node: Node = { "@type": "SportsTeam", name: team?.fullName ?? fallbackName };
  const url = team ? getTeamHubUrl(team) : null;
  if (url) node["url"] = url;
  return node;
}

/**
 * Kickoff as schema.org wants it, and only when both halves are confirmed.
 * A date without a time is not claimed either: the only date the feeds hold
 * for an unscheduled game is the filing-convention Sunday, which the league
 * may move to Saturday.
 */
function startDate(game: ScheduleGame): string | null {
  if (game.kickoffMs === null || !game.timeConfirmed || !game.dateConfirmed) return null;
  return new Date(game.kickoffMs).toISOString();
}

const EVENT_STATUS: Record<string, string> = {
  scheduled: "https://schema.org/EventScheduled",
  live: "https://schema.org/EventScheduled",
  final: "https://schema.org/EventScheduled",
  postponed: "https://schema.org/EventPostponed",
  canceled: "https://schema.org/EventCancelled",
};

function gameNode(team: NflTeam, game: ScheduleGame): Node | null {
  const start = startDate(game);
  if (!start || !game.venue) return null;
  if (game.status === "canceled") return null;

  const us = teamNode(team, team.fullName);
  const them = teamNode(game.opponent, game.opponentName);
  const home = game.homeAway === "home" ? us : them;
  const away = game.homeAway === "home" ? them : us;
  const homeName = String(home["name"]);
  const awayName = String(away["name"]);

  const node: Node = {
    "@type": "SportsEvent",
    name: `${awayName} ${game.neutralSite ? "vs." : "at"} ${homeName}`,
    sport: "American football",
    startDate: start,
    eventStatus: EVENT_STATUS[game.status] ?? "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    homeTeam: home,
    awayTeam: away,
    location: {
      "@type": "Place",
      name: game.venue,
      ...(game.venueCity ? { address: game.venueCity } : {}),
    },
  };

  if (game.result) {
    const { outcome, teamScore, opponentScore } = game.result;
    const opp = `the ${them["name"]}`;
    node["description"] =
      `${game.weekLabel}: the ${team.fullName} ` +
      (outcome === "W"
        ? `beat ${opp} ${teamScore}-${opponentScore}.`
        : outcome === "L"
          ? `lost to ${opp} ${opponentScore}-${teamScore}.`
          : `tied ${opp} ${teamScore}-${opponentScore}.`);
  }

  return node;
}

/** The ItemList node, or null when no game qualifies. */
export function scheduleItemList(
  team: NflTeam,
  schedule: TeamSchedule,
): Node | null {
  const games = schedule.games
    .map((game) => gameNode(team, game))
    .filter((node): node is Node => node !== null);

  if (games.length === 0) return null;

  return {
    "@type": "ItemList",
    name: `${schedule.season} ${team.fullName} Schedule`,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: games.length,
    itemListElement: games.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item,
    })),
  };
}
