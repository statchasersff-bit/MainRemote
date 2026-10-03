/**
 * The week's betting lines and forecasts, for the upcoming matchup page.
 *
 * One ESPN scoreboard document carries every game of a week: the book's
 * current spread and total with the numbers they opened at, both moneylines,
 * the forecast and whether the venue has a roof. The whole week is read at
 * once because the page needs it all - an implied total is only worth printing
 * next to where it ranks on the slate.
 *
 * Every game seen is written to data/matchup/lines/<season>.json, keyed by
 * ESPN event id. ESPN drops the odds from a game once it kicks off, so without
 * the file Thursday's game would fall out of Sunday's slate ranks; the stored
 * copy is its last pre-kickoff line. The file is also what the page reads when
 * ESPN refuses this host (see the ESPN memory note on intermittent 403s).
 *
 * Wind is not in ESPN's forecast. It comes from Open-Meteo (free, no key),
 * for outdoor venues only, at the kickoff hour, located by the venue's city.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "../team/cache";
import { getTeamByAbbreviation } from "../team/teams";
import { logger } from "../logger";

export interface GameLine {
  eventId: string;
  week: number;
  seasonType: "regular" | "post";
  /** Lowercase canonical codes. */
  away: string;
  home: string;
  /** Who the book names, e.g. "DraftKings". */
  provider: string | null;
  /** From the home team's side: -7 = home favored by 7. Null without a line. */
  spread: number | null;
  spreadOpen: number | null;
  total: number | null;
  totalOpen: number | null;
  moneyline: { away: number | null; home: number | null };
  indoor: boolean | null;
  weather: { tempF: number | null; condition: string | null; precipPct: number | null } | null;
  /** Epoch ms ESPN last showed this line. */
  seenAt: number;
}

export interface WeekLines {
  season: number;
  week: number;
  seasonType: "regular" | "post";
  games: GameLine[];
  fetchedAt: number;
}

/** (total - spread) / 2 for the home side, where spread is home-signed. */
export function impliedTotals(line: Pick<GameLine, "spread" | "total">): { away: number; home: number } | null {
  if (line.spread === null || line.total === null) return null;
  return {
    home: (line.total - line.spread) / 2,
    away: (line.total + line.spread) / 2,
  };
}

/* ------------------------------------------------------------- ESPN shape */

interface EspnOddsSide {
  moneyLine?: number;
  open?: { pointSpread?: { american?: string } };
}
interface EspnOdds {
  provider?: { name?: string };
  spread?: number;
  overUnder?: number;
  homeTeamOdds?: EspnOddsSide;
  awayTeamOdds?: EspnOddsSide;
  pointSpread?: { home?: { open?: { line?: string } } };
  total?: { over?: { open?: { line?: string } } };
  moneyline?: { home?: { close?: { odds?: string } }; away?: { close?: { odds?: string } } };
}
interface EspnScoreboard {
  events?: Array<{
    id: string;
    week?: { number?: number };
    season?: { type?: number };
    weather?: { temperature?: number; displayValue?: string };
    competitions?: Array<{
      venue?: { indoor?: boolean };
      competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }>;
      odds?: EspnOdds[];
    }>;
  }>;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^[ou]/i, "");
  if (/^even$/i.test(cleaned) || cleaned === "PK" || /^pk$/i.test(cleaned)) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseEvent(event: NonNullable<EspnScoreboard["events"]>[number], now: number): GameLine | null {
  const competition = event.competitions?.[0];
  const side = (homeAway: string) =>
    getTeamByAbbreviation(
      competition?.competitors?.find((c) => c.homeAway === homeAway)?.team?.abbreviation ?? "",
    );
  const home = side("home");
  const away = side("away");
  if (!competition || !home || !away) return null;
  const odds = competition.odds?.[0];
  return {
    eventId: event.id,
    week: event.week?.number ?? 0,
    seasonType: event.season?.type === 3 ? "post" : "regular",
    away: away.abbreviation,
    home: home.abbreviation,
    provider: odds?.provider?.name ?? null,
    spread: num(odds?.spread),
    spreadOpen: num(odds?.pointSpread?.home?.open?.line),
    total: num(odds?.overUnder),
    totalOpen: num(odds?.total?.over?.open?.line),
    moneyline: {
      home: num(odds?.homeTeamOdds?.moneyLine ?? odds?.moneyline?.home?.close?.odds),
      away: num(odds?.awayTeamOdds?.moneyLine ?? odds?.moneyline?.away?.close?.odds),
    },
    indoor: typeof competition.venue?.indoor === "boolean" ? competition.venue.indoor : null,
    weather: event.weather
      ? {
          tempF: num(event.weather.temperature),
          condition: event.weather.displayValue ?? null,
          precipPct: null,
        }
      : null,
    seenAt: now,
  };
}

/* ---------------------------------------------------------------- storage */

type Stored = { season: number; updatedAt: string; games: Record<string, GameLine> };

function storeFile(season: number): string {
  return dataPath("matchup", "lines", `${season}.json`);
}

function readStore(season: number): Stored {
  try {
    return JSON.parse(fs.readFileSync(storeFile(season), "utf8")) as Stored;
  } catch {
    return { season, updatedAt: "", games: {} };
  }
}

/**
 * Merge what ESPN shows now into the stored copy. A game ESPN no longer prices
 * (it kicked off) keeps its stored line; one it still prices is replaced.
 */
function remember(season: number, fresh: GameLine[]): Stored {
  const store = readStore(season);
  let changed = false;
  for (const game of fresh) {
    const old = store.games[game.eventId];
    const priced = game.spread !== null || game.total !== null;
    if (!priced && old) continue;
    store.games[game.eventId] = {
      ...game,
      // ESPN stops sending the opener on some games late in the week; keep
      // the one already seen rather than lose the movement line.
      spreadOpen: game.spreadOpen ?? old?.spreadOpen ?? null,
      totalOpen: game.totalOpen ?? old?.totalOpen ?? null,
      weather: game.weather ?? old?.weather ?? null,
    };
    changed = true;
  }
  if (changed) {
    store.updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(path.dirname(storeFile(season)), { recursive: true });
      fs.writeFileSync(storeFile(season), JSON.stringify(store, null, 1) + "\n");
    } catch (err) {
      logger.warn({ err }, "Could not store game lines");
    }
  }
  return store;
}

/* ---------------------------------------------------------------- loading */

const lineCache = createKeyedCache<WeekLines>({
  name: "espn-week-lines",
  // Lines move through the week; the page promises "check your book", not a
  // live ticker. Thirty minutes keeps it current without hammering ESPN.
  ttlMs: 30 * 60 * 1000,
  timeoutMs: 8_000,
  async load(key, signal) {
    const [season, type, week] = key.split("|").map(Number) as [number, number, number];
    const now = Date.now();
    let fresh: GameLine[] = [];
    try {
      const doc = await fetchJson<EspnScoreboard>(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=${type}&week=${week}`,
        signal,
        TEAM_USER_AGENT,
      );
      fresh = (doc.events ?? []).flatMap((event) => parseEvent(event, now) ?? []);
    } catch (err) {
      logger.warn({ err, season, week }, "ESPN week lines failed; using the stored copy");
    }
    const store = fresh.length ? remember(season, fresh) : readStore(season);
    const seasonType = type === 3 ? "post" : "regular";
    const games = Object.values(store.games).filter(
      (g) => g.week === week && g.seasonType === seasonType,
    );
    if (!games.length) throw new Error(`No lines for ${season} week ${week}`);
    return {
      season,
      week,
      seasonType,
      games,
      fetchedAt: fresh.length ? now : Math.max(...games.map((g) => g.seenAt)),
    };
  },
});

export function getWeekLines(
  season: number,
  week: number,
  seasonType: "regular" | "post" = "regular",
): Promise<WeekLines | null> {
  return lineCache.ensure(`${season}|${seasonType === "post" ? 3 : 2}|${week}`);
}

/* ------------------------------------------------------------------- wind */

const US_STATES: Record<string, string> = {
  AL: "Alabama", AZ: "Arizona", CA: "California", CO: "Colorado", FL: "Florida", GA: "Georgia",
  IL: "Illinois", IN: "Indiana", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", MI: "Michigan",
  MN: "Minnesota", MO: "Missouri", NC: "North Carolina", NJ: "New Jersey", NV: "Nevada", NY: "New York",
  OH: "Ohio", PA: "Pennsylvania", TN: "Tennessee", TX: "Texas", WA: "Washington", WI: "Wisconsin",
  DC: "District of Columbia",
};

export interface Forecast {
  windMph: number | null;
  tempF: number | null;
  precipPct: number | null;
}

interface GeoResult { results?: Array<{ latitude: number; longitude: number; admin1?: string }> }
interface MeteoResult {
  hourly?: { time: string[]; wind_speed_10m: number[]; temperature_2m: number[]; precipitation_probability: number[] };
}

const forecastCache = createKeyedCache<Forecast>({
  name: "open-meteo",
  ttlMs: 3 * 60 * 60 * 1000,
  timeoutMs: 6_000,
  async load(key, signal) {
    const [city, state, kickoffIso] = key.split("|") as [string, string, string];
    const geo = await fetchJson<GeoResult>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&countryCode=US`,
      signal,
      TEAM_USER_AGENT,
    );
    const wanted = US_STATES[state.toUpperCase()] ?? state;
    const place = geo.results?.find((r) => r.admin1 === wanted);
    if (!place) throw new Error(`No coordinates for ${city}, ${state}`);
    const meteo = await fetchJson<MeteoResult>(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&hourly=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit` +
        `&wind_speed_unit=mph&timezone=UTC&forecast_days=16`,
      signal,
      TEAM_USER_AGENT,
    );
    const hour = kickoffIso.slice(0, 13) + ":00";
    const i = meteo.hourly?.time.indexOf(hour) ?? -1;
    if (!meteo.hourly || i < 0) throw new Error(`Kickoff ${hour} is outside the forecast`);
    const at = (list: number[]): number | null =>
      typeof list[i] === "number" ? Math.round(list[i]!) : null;
    return {
      windMph: at(meteo.hourly.wind_speed_10m),
      tempF: at(meteo.hourly.temperature_2m),
      precipPct: at(meteo.hourly.precipitation_probability),
    };
  },
});

/** The kickoff-hour forecast for an outdoor US venue, or null. */
export async function getKickoffForecast(
  city: string | null,
  state: string | null,
  kickoffMs: number | null,
): Promise<Forecast | null> {
  if (!city || !state || kickoffMs === null) return null;
  // Open-Meteo forecasts 16 days out; anything further is not a forecast.
  if (kickoffMs - Date.now() > 15 * 24 * 60 * 60 * 1000) return null;
  return forecastCache.ensure(`${city}|${state}|${new Date(kickoffMs).toISOString()}`);
}
