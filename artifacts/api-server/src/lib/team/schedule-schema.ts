/**
 * Structured data for a team's Schedule page: one ItemList of SportsEvents.
 *
 * It replaces the SoftwareApplication node the hub used to carry. A schedule is
 * a list of games, not an application, and Search Console held the old node to
 * the software-app rich result's rules — an aggregateRating we do not have and
 * will not invent. This describes what the reader actually sees.
 *
 * The host page's SEO plugin already emits WebPage and BreadcrumbList, so this
 * adds only the list. The plugin grafts it into that graph; the standalone page
 * prints it on its own.
 *
 * A game makes the list only when it has a kickoff and a venue. Google reads a
 * SportsEvent as an Event, and an Event without startDate or location is an
 * error in Search Console — the thing this node exists to stop producing. The
 * games that miss out are the unscheduled ones, which the table marks TBD.
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
 * Kickoff as schema.org wants it. A time ESPN has not confirmed is a
 * placeholder, so only its date is claimed — in Eastern time, the zone the NFL
 * schedules in, so a late kickoff does not roll over to the next UTC day.
 */
function startDate(game: ScheduleGame): string | null {
  if (game.kickoffMs === null) return null;
  const at = new Date(game.kickoffMs);
  if (game.timeConfirmed) return at.toISOString();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function gameNode(team: NflTeam, game: ScheduleGame): Node | null {
  const start = startDate(game);
  if (!start || !game.venue) return null;

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
    eventStatus: "https://schema.org/EventScheduled",
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
