/**
 * The normalized NFL season slate - one payload every schedule view derives
 * from.
 *
 * This is the port of the standalone StatChasers NFL Schedule tool's
 * `routes/nfl.ts`. There, the browser fetched this JSON and React drew the
 * board from it; here it is a server module and the board arrives as markup.
 * The normalization boundary is unchanged, and deliberately so: nflverse
 * publishes a compact machine feed with legacy team codes and partial future
 * weeks, and normalizing once here is what keeps the weekly board, the team
 * lens and the season matrix from each growing their own special cases.
 *
 * ## Two upstreams, two clocks
 *
 * - **nflverse** (`nfldata/games.csv`) is authoritative for the slate: who
 *   plays whom, in which week, at what venue, with the market's spread and
 *   total. It barely moves, so it is cached for six hours.
 * - **ESPN's public scoreboard** supplies the live layer: which network is
 *   carrying the game, and the score while it is being played. It moves
 *   constantly, so it is cached apart on its own short clock.
 *
 * ESPN is best-effort in the strong sense: a game whose broadcast we cannot
 * learn ships with `network: null` and renders as "TBD", and a scoreboard that
 * refuses us entirely leaves the slate intact. That is not hypothetical on this
 * host - ESPN's *team schedule* endpoint already 403s us (see
 * lib/team/schedule.ts, which sends a named user-agent for exactly that
 * reason), so the layer that can disappear is kept strictly additive.
 *
 * ## What this module will not do
 *
 * It does not invent a kickoff. A flexible future week has an empty `gameday`
 * and `gametime` in the feed, and those stay null all the way to the renderer,
 * which prints "TBD". Filling them with a plausible Sunday afternoon would make
 * the page confidently wrong about the one thing a schedule is for.
 */

import fs from "node:fs";
import { createKeyedCache } from "../team/cache";
import { seasonYear } from "../seo";
import { parseCsv } from "../fpa/nflverse";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { logger } from "../logger";
import { ESPN_SITE } from "../team/upstream";
import { dataPath } from "../data-dir";

/**
 * Where the slate comes from. One file, the whole of NFL history.
 *
 * `SC_SCHEDULE_CSV_URL` redirects it. That exists for the test suite, which
 * serves a fixture over loopback so the route tests assert on a slate they
 * control rather than on whatever nflverse published this morning - the
 * alternative is a suite that fails when a Thursday game is flexed.
 */
const GAMES_CSV_URL =
  (process.env["SC_SCHEDULE_CSV_URL"] ?? "").trim() ||
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

/**
 * The stored copy of the same file, and the tests' way of pinning it.
 *
 * `SC_SCHEDULE_CSV_FILE` reads the slate from disk and never fetches. Unset,
 * nflverse is fetched as before, and `data/schedule/games.csv` - a snapshot
 * scripts/schedule/snapshot-games.mjs refreshes - is what answers when the
 * fetch fails. The slate is data this site already has (mak, 2026-10-20),
 * and a host that cannot reach GitHub for an hour should not lose 32 team
 * pages' schedules over it.
 */
const GAMES_CSV_FILE = (process.env["SC_SCHEDULE_CSV_FILE"] ?? "").trim();
const GAMES_CSV_SNAPSHOT = dataPath("schedule", "games.csv");

/** A regular season is 18 weeks. Used for the matrix and the bye derivation. */
export const TOTAL_WEEKS = 18;

/** Kickoffs in the feed are US Eastern, always, whatever the venue. */
const FEED_TIME_ZONE = "America/New_York";

/**
 * The identity we send upstream.
 *
 * Separate from TEAM_USER_AGENT only because it names a different tool; the
 * bare-hostname form is copied deliberately, because the parenthesized URL form
 * is what ESPN's edge rejects with a 403. See lib/team/cache.ts.
 */
const SCHEDULE_USER_AGENT = "StatChasersSchedule/1.0 (+statchasers.com)";

export type GameStatus = "scheduled" | "live" | "final";

export interface ScheduleGame {
  /** nflverse's own game id, e.g. "2026_03_ATL_GB". Stable across refreshes. */
  id: string;
  /**
   * ESPN's id for the same game, as nflverse records it. The box score is
   * keyed by it (lib/matchup/boxscore.ts); null when the feed has none yet.
   */
  espnId: string | null;
  week: number;
  /** ISO date, or null when the week is still flexible. */
  date: string | null;
  /** The feed's own weekday name, which survives a missing date. */
  weekday: string | null;
  /** Kickoff as "HH:MM" in US Eastern, or null. */
  time: string | null;
  /** Kickoff in epoch ms, or null when either half of it is missing. */
  kickoffMs: number | null;
  awayCode: string;
  homeCode: string;
  /** Resolved through the canonical team table; null if the feed names a team we don't know. */
  away: NflTeam | null;
  home: NflTeam | null;
  awayScore: number | null;
  homeScore: number | null;
  status: GameStatus;
  /** ESPN's display-ready detail ("Q3 5:23", "Final/OT"), when we have one. */
  statusDetail: string | null;
  network: string | null;
  stadium: string | null;
  /** City, for the international games the feed only marks "Neutral". */
  location: string | null;
  international: boolean;
  neutralSite: boolean;
  divisional: boolean;
  /** "THANKSGIVING", "CHRISTMAS", "CHRISTMAS EVE", or null. */
  holiday: string | null;
  spreadLine: number | null;
  totalLine: number | null;
}

export interface ScheduleSeason {
  season: number;
  games: ScheduleGame[];
  /** True while any game is in progress - the renderer says so, the cache shortens. */
  liveNow: boolean;
  /** When the slate half was last fetched. */
  fetchedAt: number;
  /** Fingerprint of everything above; the response ETag is built from it. */
  version: string;
}

/* ------------------------------------------------------------------ time */

/**
 * The offset `timeZone` was at, at a given instant, in milliseconds.
 *
 * Formatting the instant in the zone and reading the wall clock back as if it
 * were UTC gives exactly the offset, without a tz database dependency.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // Intl renders midnight as hour 24 under hour12:false; Date.UTC handles the
  // rollover correctly, so it needs no special case.
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - utcMs;
}

/**
 * "2026-09-24" + "20:15", read as Eastern, as epoch ms.
 *
 * Two passes, because the offset depends on the instant we are trying to find:
 * the first pass uses the offset at the naive instant, which is only wrong
 * inside the hour either side of a DST transition, and the second pass
 * corrects it. No NFL kickoff has ever fallen in that hour, but a function that
 * is right by accident is a function that breaks when the calendar moves.
 */
export function easternToUtcMs(date: string, time: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const clock = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match || !clock) return null;

  const naive = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  if (!Number.isFinite(naive)) return null;

  const first = naive - zoneOffsetMs(naive, FEED_TIME_ZONE);
  return naive - zoneOffsetMs(first, FEED_TIME_ZONE);
}

/** Today's date in US Eastern, as "YYYY-MM-DD". The league's own calendar day. */
export function easternDate(nowMs: number = Date.now()): string {
  return new Date(nowMs).toLocaleDateString("en-CA", {
    timeZone: FEED_TIME_ZONE,
  });
}

/* --------------------------------------------------------------- holidays */

/** Thanksgiving is the fourth Thursday in November, so it moves 22nd–28th. */
function thanksgivingDay(year: number): number {
  const firstOfNovember = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return 22 + ((4 - firstOfNovember + 7) % 7);
}

/**
 * The holiday a date falls on, if any.
 *
 * The day itself, not the holiday week: a Sunday slate three days before
 * Thanksgiving is an ordinary Sunday slate, and badging it otherwise would put
 * a turkey on sixteen games.
 */
export function classifyHoliday(date: string | null): string | null {
  if (!date) return null;
  const parts = date.split("-").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  if (month === 11 && day === thanksgivingDay(year)) return "THANKSGIVING";
  if (month === 12 && day === 25) return "CHRISTMAS";
  if (month === 12 && day === 24) return "CHRISTMAS EVE";
  return null;
}

/* ----------------------------------------------------------------- venues */

/**
 * Where an international game is actually played.
 *
 * nflverse marks these games "Home" or "Neutral" and names the stadium, so the
 * city has to come from the venue. A hand-kept table is the wrong shape for
 * most things and the right shape for this one: it is eight venues, it changes
 * once a year, and the alternative is geocoding a stadium name.
 */
const VENUE_CITIES: Record<string, string> = {
  "Melbourne Cricket Ground": "Melbourne, Australia",
  "Maracana Stadium": "Rio de Janeiro, Brazil",
  Bernabeu: "Madrid, Spain",
  "Stade de France": "Paris, France",
  "FC Bayern Munich Stadium": "Munich, Germany",
  "Tottenham Hotspur Stadium": "London, UK",
  "Tottenham Hotspur": "London, UK",
  "Wembley Stadium": "London, UK",
  "Estadio Banorte": "Mexico City, Mexico",
};

/** The flag that goes with the city, for the travel card. */
const VENUE_FLAGS: Record<string, string> = {
  "Melbourne, Australia": "\u{1F1E6}\u{1F1FA}",
  "Rio de Janeiro, Brazil": "\u{1F1E7}\u{1F1F7}",
  "Madrid, Spain": "\u{1F1EA}\u{1F1F8}",
  "Paris, France": "\u{1F1EB}\u{1F1F7}",
  "Munich, Germany": "\u{1F1E9}\u{1F1EA}",
  "London, UK": "\u{1F1EC}\u{1F1E7}",
  "Mexico City, Mexico": "\u{1F1F2}\u{1F1FD}",
};

export function venueFlag(city: string | null): string {
  return (city && VENUE_FLAGS[city]) ?? "\u{1F30D}";
}

const INTERNATIONAL_HINT =
  /london|munich|berlin|madrid|dublin|s[ãa]o paulo|melbourne|mexico|rio de janeiro|tottenham|wembley|bernabeu|maracana/i;

/* ------------------------------------------------------------- ESPN layer */

interface EspnGame {
  network: string | null;
  state: "pre" | "in" | "post";
  completed: boolean;
  detail: string | null;
  awayScore: number | null;
  homeScore: number | null;
}

interface EspnEvent {
  id?: string;
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      shortDetail?: string;
      detail?: string;
    };
  };
  competitions?: Array<{
    broadcasts?: Array<{ names?: string[]; media?: { shortName?: string } }>;
    competitors?: Array<{ homeAway?: string; score?: string }>;
  }>;
}

function readEspnEvent(event: EspnEvent): EspnGame | null {
  if (!event.id) return null;
  const competition = event.competitions?.[0];

  const names = (competition?.broadcasts ?? []).flatMap((broadcast) =>
    broadcast.names?.length
      ? broadcast.names
      : broadcast.media?.shortName
        ? [broadcast.media.shortName]
        : [],
  );

  const score = (side: string): number | null => {
    const raw = competition?.competitors?.find(
      (competitor) => competitor.homeAway === side,
    )?.score;
    if (raw === undefined || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const state = event.status?.type?.state;
  return {
    // A simulcast ("NBC / Peacock") is two names and the renderer draws both.
    network: names.length ? [...new Set(names)].join(" / ") : null,
    state: state === "in" || state === "post" ? state : "pre",
    completed: event.status?.type?.completed === true,
    detail:
      event.status?.type?.shortDetail ?? event.status?.type?.detail ?? null,
    awayScore: score("away"),
    homeScore: score("home"),
  };
}

const ESPN_FULL_TTL_MS = 6 * 60 * 60 * 1000;
/** While a game is in progress the score is the point of the page. */
const ESPN_LIVE_TTL_MS = 30 * 1000;
const ESPN_IDLE_TTL_MS = 15 * 60 * 1000;
/**
 * After a sweep that reached nothing. ESPN refuses this host for hours at a
 * time, and on the idle clock every expiry repeated the whole 18-week sweep -
 * about 1,700 doomed requests a day, which is also how a refusal becomes a ban.
 */
const ESPN_FAILURE_BACKOFF_MS = 60 * 60 * 1000;
/**
 * A season that is over. Its scores and networks cannot change, so one full
 * sweep a week is plenty - anyone can ask for ?season=2019, and each season
 * asked for used to cost 18 ESPN calls every six hours.
 */
const ESPN_PAST_SEASON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ESPN_TIMEOUT_MS = 6_000;

interface EspnEntry {
  games: Map<string, EspnGame>;
  expiresAt: number;
  fullRefreshAt: number;
  /** Set on total failure so the slate does not re-attempt on every request. */
  failedAt: number;
}

const espnCache = new Map<number, EspnEntry>();

/**
 * The refresh running for each season. Requests that arrive while it is out
 * share it: without this, every request between the cache expiring and the
 * sweep landing started its own 18 calls - and during a live game the cache
 * expires every 30 seconds.
 */
const espnInFlight = new Map<number, Promise<Map<string, EspnGame>>>();

/**
 * Is the live layer switched on?
 *
 * `SC_SCHEDULE_ESPN=0` turns it off. Two callers want this. The test suite
 * wants it so a run never waits on a third party, and a deployment whose host
 * ESPN refuses wants it because eighteen doomed requests per cold season are
 * eighteen six-second timeouts spent learning what the operator already knows -
 * and this host is one of those (see lib/team/schedule.ts). Off, the board
 * still renders: TV shows as TBD and scores come from nflverse, which is hours
 * behind but never wrong.
 */
function espnEnabled(): boolean {
  const raw = (process.env["SC_SCHEDULE_ESPN"] ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

async function fetchEspnWeek(
  season: number,
  week: number,
  into: Map<string, EspnGame>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${ESPN_SITE}/apis/site/v2/sports/football/nfl/scoreboard` +
        `?dates=${season}&seasontype=2&week=${week}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": SCHEDULE_USER_AGENT,
        },
        signal: AbortSignal.timeout(ESPN_TIMEOUT_MS),
      },
    );
    if (!response.ok) return false;
    const payload = (await response.json()) as { events?: EspnEvent[] };
    for (const event of payload.events ?? []) {
      const parsed = readEspnEvent(event);
      if (parsed && event.id) into.set(event.id, parsed);
    }
    return true;
  } catch {
    // Best-effort by contract: the caller keeps whatever it already had.
    return false;
  }
}

/**
 * Weeks with a game nflverse has not scored yet. A week whose every game has
 * a final in the feed is finished: its scores will not change and its TV
 * assignments are history, so the live layer never asks ESPN about it again
 * (mak, 2026-10-20: "this is all info we already have and isn't going to
 * change"). Before this the full refresh re-read all eighteen weeks every six
 * hours, most of them for games played in September.
 */
function openWeeks(rows: RawGame[]): number[] {
  const open = new Set<number>();
  for (const row of rows) {
    if (row.awayScore === null || row.homeScore === null) open.add(row.week);
  }
  return [...open].sort((a, b) => a - b);
}

/** Weeks holding a game today or yesterday - the only scores that can change. */
function activeWeeks(rows: RawGame[], nowMs: number): number[] {
  const today = easternDate(nowMs);
  const yesterday = easternDate(nowMs - 24 * 60 * 60 * 1000);
  const weeks = new Set<number>();
  for (const row of rows) {
    if (row.date === today || row.date === yesterday) weeks.add(row.week);
  }
  return [...weeks];
}

/**
 * The live layer for a season, refreshed on its own clock.
 *
 * All 18 weeks on the first load and every few hours - flexed kickoffs and late
 * TV assignments land across the whole season, not just the current week - and
 * in between only the weeks that can actually be in progress.
 */
async function loadEspn(
  season: number,
  rows: RawGame[],
  nowMs: number,
): Promise<Map<string, EspnGame>> {
  if (!espnEnabled()) return new Map<string, EspnGame>();

  const cached = espnCache.get(season);
  if (cached && cached.expiresAt > nowMs) return cached.games;

  const running = espnInFlight.get(season);
  if (running) return running;

  const refresh = refreshEspn(season, rows, nowMs, cached).finally(() => {
    espnInFlight.delete(season);
  });
  espnInFlight.set(season, refresh);
  return refresh;
}

async function refreshEspn(
  season: number,
  rows: RawGame[],
  nowMs: number,
  cached: EspnEntry | undefined,
): Promise<Map<string, EspnGame>> {
  const games = cached?.games ?? loadLayerSeed(season);
  const fullRefresh = !cached || nowMs - cached.fullRefreshAt > ESPN_FULL_TTL_MS;
  // A full refresh covers the weeks still open in the feed - flexed kickoffs
  // and late TV assignments land across the season ahead - and never a week
  // nflverse has already closed with final scores.
  const weeks = fullRefresh
    ? [...new Set([...openWeeks(rows), ...activeWeeks(rows, nowMs)])].sort((a, b) => a - b)
    : activeWeeks(rows, nowMs);

  let reached = weeks.length === 0;
  if (weeks.length) {
    const results = await Promise.all(
      weeks.map((week) => fetchEspnWeek(season, week, games)),
    );
    reached = results.some(Boolean);
    if (!reached) {
      logger.warn(
        { season, weeks: weeks.length },
        "ESPN scoreboard unreachable - schedule ships without TV or live scores",
      );
    }
  }

  // Only the season in play is worth remembering: a past season's layer is
  // never asked for again, and the test suite's 2024 fixture must not leave
  // a file behind in the repo's data directory.
  if (reached && weeks.length && season === scheduleSeason()) saveLayer(season, games);

  const live = [...games.values()].some((game) => game.state === "in");
  const past = season < scheduleSeason();
  espnCache.set(season, {
    games,
    expiresAt:
      nowMs +
      (!reached
        ? ESPN_FAILURE_BACKOFF_MS
        : live
          ? ESPN_LIVE_TTL_MS
          : past
            ? ESPN_PAST_SEASON_TTL_MS
            : ESPN_IDLE_TTL_MS),
    fullRefreshAt: fullRefresh && reached ? nowMs : (cached?.fullRefreshAt ?? 0),
    failedAt: reached ? 0 : nowMs,
  });

  return games;
}

/**
 * What the live layer learned, kept on disk between processes.
 *
 * A network assignment or a final score for a game that has been played is a
 * fact this site has; losing it on every restart and asking ESPN for it again
 * was the pattern mak asked to end. Best-effort both ways: a missing or
 * unwritable file is an empty seed and a skipped save, never an error.
 */
function layerPath(season: number): string {
  return dataPath("schedule", `espn-layer-${season}.json`);
}

function loadLayerSeed(season: number): Map<string, EspnGame> {
  const seed = new Map<string, EspnGame>();
  if (!espnEnabled() || season !== scheduleSeason()) return seed;
  try {
    const parsed = JSON.parse(fs.readFileSync(layerPath(season), "utf8")) as Record<
      string,
      EspnGame
    >;
    for (const [id, game] of Object.entries(parsed)) {
      // Only what is settled: a live state or a kickoff-less entry would be
      // stale the moment it was read back.
      if (game && game.state !== "in") seed.set(id, game);
    }
  } catch {
    // No seed. The refresh fills it.
  }
  return seed;
}

function saveLayer(season: number, games: Map<string, EspnGame>): void {
  try {
    const file = layerPath(season);
    fs.mkdirSync(dataPath("schedule"), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(games)));
  } catch (err) {
    logger.debug({ err, season }, "could not store the schedule's ESPN layer");
  }
}

/** Test seam: drops the live layer so a suite never depends on ESPN. */
export function invalidateScheduleCaches(): void {
  espnCache.clear();
  espnInFlight.clear();
  sharedCsv = null;
  // The slate too: a test that swaps the CSV under the module (the sweep
  // tests serve a season with open weeks) must not get the rows the last
  // test parsed.
  slateCache.clear();
  postseasonCache.clear();
}

/* ------------------------------------------------------------- the slate */

/** One nflverse row, reduced to the columns this tool reads. */
interface RawGame {
  id: string;
  espnId: string;
  /** "REG", or a postseason round: "WC", "DIV", "CON", "SB". */
  gameType: string;
  week: number;
  date: string | null;
  weekday: string | null;
  time: string | null;
  awayCode: string;
  homeCode: string;
  awayScore: number | null;
  homeScore: number | null;
  location: string | null;
  stadium: string | null;
  divisional: boolean;
  spreadLine: number | null;
  totalLine: number | null;
}

function cell(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "NA" ? "" : trimmed;
}

function numberOrNull(value: string | undefined): number | null {
  const raw = cell(value);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * nflverse rows for one regular season.
 *
 * The header is read by name rather than by position: the file has forty-five
 * columns and gains one every couple of seasons, and an index would be silently
 * wrong the first time that happened.
 */
/** The postseason rounds nflverse names, in order. The Pro Bowl is not a row. */
export const POSTSEASON_ROUNDS = ["WC", "DIV", "CON", "SB"] as const;
export type PostseasonRound = (typeof POSTSEASON_ROUNDS)[number];

function parseSlate(
  csv: string,
  season: number,
  keep: (gameType: string) => boolean = (type) => type === "REG",
): RawGame[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) throw new Error("games.csv had no header row");

  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const get = (row: string[], name: string): string | undefined => {
    const at = index.get(name);
    return at === undefined ? undefined : row[at];
  };

  const seasonText = String(season);
  const games: RawGame[] = [];

  for (const row of rows) {
    if (cell(get(row, "season")) !== seasonText) continue;
    const gameType = cell(get(row, "game_type"));
    if (!keep(gameType)) continue;

    const week = Number(cell(get(row, "week")));
    if (!Number.isFinite(week) || week < 1) continue;

    const awayCode = cell(get(row, "away_team"));
    const homeCode = cell(get(row, "home_team"));
    if (!awayCode || !homeCode) continue;

    const divGame = cell(get(row, "div_game"));

    games.push({
      id: cell(get(row, "game_id")) || `${season}-${week}-${awayCode}-${homeCode}`,
      espnId: cell(get(row, "espn")),
      gameType,
      week,
      date: cell(get(row, "gameday")) || null,
      weekday: cell(get(row, "weekday")) || null,
      time: cell(get(row, "gametime")) || null,
      awayCode,
      homeCode,
      awayScore: numberOrNull(get(row, "away_score")),
      homeScore: numberOrNull(get(row, "home_score")),
      location: cell(get(row, "location")) || null,
      stadium: cell(get(row, "stadium")) || null,
      // The column has been spelled both ways across releases.
      divisional: divGame === "1" || divGame.toUpperCase() === "TRUE",
      spreadLine: numberOrNull(get(row, "spread_line")),
      totalLine: numberOrNull(get(row, "total_line")),
    });
  }

  return games;
}

/**
 * games.csv, shared between seasons for a few minutes.
 *
 * The file holds every season since 1999, and each season is its own cache
 * key, so a crawler walking ?season= used to download the whole file once per
 * season. One download now serves every season asked for inside the window.
 * Kept short on purpose: the slate cache above it is what holds a season for
 * hours, and a long window here would stack on top of that TTL.
 */
const CSV_SHARE_MS = 10 * 60 * 1000;
let sharedCsv: { at: number; text: Promise<string> } | null = null;

function gamesCsv(): Promise<string> {
  const now = Date.now();
  if (sharedCsv && now - sharedCsv.at < CSV_SHARE_MS) return sharedCsv.text;
  // Its own timeout, not a caller's signal: one caller giving up must not
  // abort the download every other season is waiting on.
  const text = GAMES_CSV_FILE
    ? fs.promises.readFile(GAMES_CSV_FILE, "utf8")
    : fetch(GAMES_CSV_URL, {
        headers: { Accept: "text/csv", "User-Agent": SCHEDULE_USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`nflverse responded ${response.status}`);
          return response.text();
        })
        .catch(async (err: unknown) => {
          // The stored snapshot answers for a fetch that failed. It is the same
          // file a few days older: every past result in it is final, and the
          // slate ahead rarely moves.
          try {
            const stored = await fs.promises.readFile(GAMES_CSV_SNAPSHOT, "utf8");
            logger.warn({ err }, "nflverse games.csv unreachable - serving the stored snapshot");
            return stored;
          } catch {
            throw err;
          }
        });
  const entry = { at: now, text };
  sharedCsv = entry;
  // A failure is not shared: the next season to ask tries again.
  text.catch(() => {
    if (sharedCsv === entry) sharedCsv = null;
  });
  return text;
}

const slateCache = createKeyedCache<RawGame[]>({
  name: "nflverse-schedule",
  // The slate is stable for hours; every visitor after the first is served from
  // memory, and a flex change still lands well before kickoff.
  ttlMs: 6 * 60 * 60 * 1000,
  timeoutMs: 20_000,
  // Longer than the shared default of a minute. The failure that lasts is a
  // season nflverse has not published yet - every March to mid-May - and at a
  // minute each request re-downloaded the whole games.csv to learn that again.
  errorBackoffMs: 30 * 60 * 1000,
  load: async (key) => {
    const season = Number(key);
    const games = parseSlate(await gamesCsv(), season);
    if (games.length === 0) {
      // A 200 with no rows for this season is a failure, not an empty season -
      // the same rule the team pages apply to an empty ESPN response. Throwing
      // keeps the last good slate rather than replacing it with nothing.
      throw new Error(`nflverse published no ${season} regular-season games`);
    }
    return games;
  },
});

/* --------------------------------------------------------- normalization */

function normalize(
  row: RawGame,
  season: number,
  espn: Map<string, EspnGame>,
): ScheduleGame {
  const away = getTeamByAbbreviation(row.awayCode);
  const home = getTeamByAbbreviation(row.homeCode);

  const neutralSite = row.location?.toLowerCase() === "neutral";
  const international =
    neutralSite ||
    INTERNATIONAL_HINT.test(`${row.location ?? ""} ${row.stadium ?? ""}`);

  const stadium =
    row.stadium === "Tottenham Hotspur Stadium" ? "Tottenham Hotspur" : row.stadium;

  const venueCity = row.stadium ? (VENUE_CITIES[row.stadium] ?? null) : null;
  const location = international
    ? (row.location && row.location !== "Neutral" && row.location !== "Home"
        ? row.location
        : (venueCity ?? home?.city ?? away?.city ?? null))
    : row.location === "Home"
      ? (home?.city ?? null)
      : row.location;

  // ESPN is the live authority; nflverse only publishes a final score hours
  // after the whistle, so a Sunday-afternoon reader would otherwise see a game
  // that finished an hour ago still listed as upcoming.
  const live = row.espnId ? espn.get(row.espnId) : undefined;
  const finalFromFeed = row.awayScore !== null && row.homeScore !== null;
  const isFinal = live
    ? live.completed || (live.state === "post" && live.awayScore !== null)
    : finalFromFeed;
  const status: GameStatus =
    live?.state === "in" ? "live" : isFinal ? "final" : "scheduled";
  const useLiveScore = live !== undefined && status !== "scheduled";

  return {
    id: row.id,
    espnId: row.espnId || null,
    week: row.week,
    date: row.date,
    weekday: row.weekday,
    time: row.time,
    kickoffMs:
      row.date && row.time ? easternToUtcMs(row.date, row.time) : null,
    awayCode: away?.code ?? row.awayCode,
    homeCode: home?.code ?? row.homeCode,
    away,
    home,
    awayScore: useLiveScore ? (live.awayScore ?? row.awayScore) : row.awayScore,
    homeScore: useLiveScore ? (live.homeScore ?? row.homeScore) : row.homeScore,
    status,
    statusDetail: status === "scheduled" ? null : (live?.detail ?? null),
    network: live?.network ?? null,
    stadium,
    location,
    international,
    neutralSite,
    // Derived from the canonical team table where both teams resolve, and only
    // falling back to the feed's own flag where one does not - one source of
    // truth for which division a club is in.
    divisional:
      away && home ? away.division === home.division : row.divisional,
    holiday: classifyHoliday(row.date),
    spreadLine: row.spreadLine,
    totalLine: row.totalLine,
  };
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Everything a reader would see, as one string.
 *
 * The ETag is built from this rather than from the fetch time, so a refresh
 * that changed nothing revalidates to a 304 instead of re-sending 80KB. The
 * fields listed are exactly the ones that render; adding a rendered field means
 * adding it here.
 */
function fingerprint(season: number, games: ScheduleGame[]): string {
  const parts = games.map((game) =>
    [
      game.id,
      game.date ?? "",
      game.time ?? "",
      game.status,
      game.awayScore ?? "",
      game.homeScore ?? "",
      game.network ?? "",
      game.statusDetail ?? "",
      game.spreadLine ?? "",
      game.totalLine ?? "",
    ].join("\u0001"),
  );
  return `${season}-${games.length}-${hash(parts.join("\u0002"))}`;
}

/**
 * The normalized season.
 *
 * Assembled per request rather than cached whole, because the two halves expire
 * on very different clocks - and assembling is a map over 272 rows, which is
 * cheaper than keeping a third cache correct.
 *
 * Returns null when the slate itself is unavailable and nothing is cached. The
 * caller decides what to say about that; this module does not invent a season.
 */
export async function getSchedule(
  season: number,
  nowMs: number = Date.now(),
): Promise<ScheduleSeason | null> {
  const rows = await slateCache.ensure(String(season));
  if (!rows || rows.length === 0) {
    // The league year turns over on March 1 (seasonYear), and the new season's
    // schedule is not released until about mid-May. Asked for the season the
    // calendar is on and nflverse has nothing yet, show the one just played
    // rather than an empty board - its data says which season it is, so every
    // label follows. Not for a pinned season or an explicit older one.
    if (season === scheduleSeason() && !scheduleSeasonPinned()) {
      return getScheduleExact(season - 1, nowMs);
    }
    return null;
  }
  return build(season, rows, nowMs);
}

async function getScheduleExact(
  season: number,
  nowMs: number,
): Promise<ScheduleSeason | null> {
  const rows = await slateCache.ensure(String(season));
  if (!rows || rows.length === 0) return null;
  return build(season, rows, nowMs);
}

/**
 * The regular season asked for and no other - the team hubs' reader.
 *
 * getSchedule() falls back to the season just played when the calendar's
 * season is unpublished, which is right for the schedule tool's board and
 * wrong for a hub that labels its table with the year it asked for.
 */
export function getSeasonSlate(
  season: number,
  nowMs: number = Date.now(),
): Promise<ScheduleSeason | null> {
  return getScheduleExact(season, nowMs);
}

/** One postseason game: the slate's shape plus which round it was. */
export interface PostseasonGame extends ScheduleGame {
  round: PostseasonRound;
}

const postseasonCache = createKeyedCache<RawGame[]>({
  name: "nflverse-postseason",
  ttlMs: 6 * 60 * 60 * 1000,
  timeoutMs: 20_000,
  errorBackoffMs: 30 * 60 * 1000,
  load: async (key) => {
    const season = Number(key);
    // An empty list is the correct answer for most of the year, not a failure.
    return parseSlate(await gamesCsv(), season, (type) =>
      (POSTSEASON_ROUNDS as readonly string[]).includes(type),
    );
  },
});

/**
 * A season's postseason, from the same file as the slate.
 *
 * No live layer: by the time a round is in the feed it has been played, and
 * the one week a year it is live is not worth a second ESPN clock. Scores are
 * nflverse's, posted hours after the whistle.
 */
export async function getPostseason(season: number): Promise<PostseasonGame[]> {
  const rows = (await postseasonCache.ensure(String(season))) ?? [];
  const none = new Map<string, EspnGame>();
  return rows
    .map((row) => ({
      ...normalize(row, season, none),
      round: row.gameType as PostseasonRound,
    }))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
}

async function build(
  season: number,
  rows: RawGame[],
  nowMs: number,
): Promise<ScheduleSeason> {

  const espn = await loadEspn(season, rows, nowMs);
  const games = rows
    .map((row) => normalize(row, season, espn))
    .sort(
      (a, b) =>
        a.week - b.week ||
        (a.date ?? "￿").localeCompare(b.date ?? "￿") ||
        (a.time ?? "￿").localeCompare(b.time ?? "￿") ||
        a.id.localeCompare(b.id),
    );

  return {
    season,
    games,
    liveNow: games.some((game) => game.status === "live"),
    fetchedAt: slateCache.peek(String(season)).fetchedAt,
    version: fingerprint(season, games),
  };
}

/**
 * Which season the tool shows.
 *
 * `SC_SCHEDULE_SEASON` pins it - useful in the weeks either side of a new
 * league year, when nflverse has published next season's slate and the site
 * still wants to show the one being played. Otherwise it is derived from the
 * date the same way every other tool here derives it (lib/seo.ts).
 *
 * It lives here rather than in the route because the preview harness resolves
 * the same season, and two copies of this rule would drift the first time the
 * pin was needed.
 */
/** Whether SC_SCHEDULE_SEASON pins the season (see scheduleSeason). */
export function scheduleSeasonPinned(): boolean {
  const pinned = Number.parseInt((process.env["SC_SCHEDULE_SEASON"] ?? "").trim(), 10);
  return Number.isFinite(pinned) && pinned >= 1999 && pinned <= 2100;
}

export function scheduleSeason(): number {
  const pinned = Number.parseInt(
    (process.env["SC_SCHEDULE_SEASON"] ?? "").trim(),
    10,
  );
  if (Number.isFinite(pinned) && pinned >= 1999 && pinned <= 2100) return pinned;
  return seasonYear();
}

/* ------------------------------------------------------------ the views */

export const SCHEDULE_VIEWS = ["week", "matrix"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

export const GAME_FILTERS = ["all", "division", "international"] as const;
export type GameFilter = (typeof GAME_FILTERS)[number];

/**
 * The view a request asks for, defaulting to the season matrix.
 *
 * The matrix is what the bare path shows: it is the whole season, it is the
 * same board in December as in July, and it is the view that answers "when do
 * they play" for any team without first asking which week. The weekly board is
 * a week - one slate of games - and a week has an address of its own
 * (`/schedule/week-7`), so nothing needs `?view=week` to reach it.
 */
export function parseScheduleView(value: string | undefined): ScheduleView {
  const raw = (value ?? "").trim().toLowerCase();
  return (SCHEDULE_VIEWS as readonly string[]).includes(raw)
    ? (raw as ScheduleView)
    : "matrix";
}

export function parseGameFilter(value: string | undefined): GameFilter {
  const raw = (value ?? "").trim().toLowerCase();
  return (GAME_FILTERS as readonly string[]).includes(raw)
    ? (raw as GameFilter)
    : "all";
}

/** A week number, clamped to the season. Anything unusable falls through to null. */
export function parseWeek(value: string | undefined): number | null {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1 || parsed > TOTAL_WEEKS) return null;
  return parsed;
}

export interface ScheduleQuery {
  season?: number;
  view?: ScheduleView;
  week?: number | null;
  /** Canonical team abbreviation ("ne"), already resolved by the caller. */
  team?: string | null;
  filter?: GameFilter;
}

/**
 * Which week the page opens on when nobody has asked for one.
 *
 * The week containing today, else the next week with a game still to come,
 * else the last week of the season. Derived from the slate rather than from a
 * calendar guess or a second upstream, so a season that starts late or a week
 * that has not been dated yet cannot put the reader somewhere empty.
 */
export function currentWeek(
  schedule: ScheduleSeason,
  nowMs: number = Date.now(),
): number {
  const today = easternDate(nowMs);

  let earliestUpcoming: ScheduleGame | null = null;
  for (const game of schedule.games) {
    if (!game.date) continue;
    if (game.date === today) return game.week;
    if (game.date > today) {
      if (!earliestUpcoming || game.date < earliestUpcoming.date!) {
        earliestUpcoming = game;
      }
    }
  }
  if (earliestUpcoming) return earliestUpcoming.week;

  const last = schedule.games[schedule.games.length - 1];
  return last?.week ?? 1;
}

export function weekGames(
  schedule: ScheduleSeason,
  week: number,
  filter: GameFilter = "all",
): ScheduleGame[] {
  return schedule.games.filter((game) => {
    if (game.week !== week) return false;
    if (filter === "division") return game.divisional;
    if (filter === "international") return game.international;
    return true;
  });
}

export function teamGames(
  schedule: ScheduleSeason,
  abbreviation: string,
): ScheduleGame[] {
  const code = abbreviation.toLowerCase();
  return schedule.games.filter(
    (game) =>
      game.away?.abbreviation === code || game.home?.abbreviation === code,
  );
}

/** The teams with no game in a given week. */
export function byeTeams(
  schedule: ScheduleSeason,
  week: number,
  teams: readonly NflTeam[],
): NflTeam[] {
  const playing = new Set<string>();
  for (const game of schedule.games) {
    if (game.week !== week) continue;
    if (game.away) playing.add(game.away.abbreviation);
    if (game.home) playing.add(game.home.abbreviation);
  }
  return teams.filter((team) => !playing.has(team.abbreviation));
}

/** The opponent a given team faces in a game, or null. */
export function opponentOf(
  game: ScheduleGame,
  team: NflTeam,
): NflTeam | null {
  if (game.home?.abbreviation === team.abbreviation) return game.away;
  if (game.away?.abbreviation === team.abbreviation) return game.home;
  return null;
}
