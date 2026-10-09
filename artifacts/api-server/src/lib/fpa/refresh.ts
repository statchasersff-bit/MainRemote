/**
 * Running the Fantasy Points Allowed ingest, from wherever asks for it.
 *
 * `fpa/ingest.ts` does the work. This owns the two questions around it - when a
 * run is allowed to start, and what the last one did - because there is now
 * more than one caller:
 *
 *   - **POST /api/fpa/ingest**, the scheduled refresh. The only path that
 *     reaches a deployment's own database from outside it, which is the whole
 *     reason it exists: `scripts/ingest-fpa.mjs` runs in whatever process
 *     starts it and writes to whatever `DATABASE_URL` that process has, so run
 *     from a development shell it refreshes development and leaves production
 *     serving whatever seeded it. That is how production came to serve a table
 *     written on 20 September for two days afterwards.
 *   - **the cold-database fallback** in fpa-ssr.ts, which fires once when the
 *     table is empty and never again - see the note there. It is a safety net
 *     under a first deploy, not a refresh.
 *
 * Two properties, and the endpoint would be unsafe without either:
 *
 *   - **One at a time.** A run downloads two ~7MB CSVs and replaces every row
 *     for the season in one transaction. Two racing is two downloads for one
 *     result, and a scheduler that retries a slow request would arrange exactly
 *     that. A caller arriving while a run is in flight joins it instead of
 *     starting a second, and is told it joined.
 *   - **The outcome is remembered.** A failing weekly refresh is otherwise a
 *     log line nobody reads, which leaves "upstream is quiet" and "this has not
 *     worked since the day it was deployed" looking identical from outside.
 *     `/api/status` reports this state beside the news ingest's.
 *
 * The state here is process memory and resets on every deploy, so it says what
 * this process has done, never how old the served numbers are. That second
 * question is answered from the database by `fpaSnapshotState()`, and it is the
 * one that catches a stale table.
 */

import { logger } from "../logger";
import { ingestFpa, type IngestOptions, type IngestResult } from "./ingest";

export interface FpaRefreshResult {
  /** What the ingest returned, whether this caller ran it or joined one. */
  result: IngestResult;
  /** True when a run was already in flight and this caller waited on it. */
  joined: boolean;
}

/** Outcome of the most recent run in THIS process - see the header. */
export interface FpaRefreshState {
  lastAttemptMs: number | null;
  lastSuccessMs: number | null;
  lastResult: {
    snapshotRows: number;
    gameRows: number;
    weekNumber: number | null;
    dataMode: string;
  } | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const state: FpaRefreshState = {
  lastAttemptMs: null,
  lastSuccessMs: null,
  lastResult: null,
  lastError: null,
  consecutiveFailures: 0,
};

let inFlight: Promise<IngestResult> | null = null;

export function fpaRefreshStatus(): FpaRefreshState & { running: boolean } {
  return { ...state, running: inFlight !== null };
}

/**
 * Everything an ingest can have changed.
 *
 * Dynamic imports, as the code this replaces used for two of them: fpa-ssr.ts
 * reaches back into this module, and taking the render layer as a static import
 * would put the whole SSR graph behind anything that merely wants to start an
 * ingest. The list is longer than the rendered FPA table because the numbers
 * are read in three more places - the matchup pages' before/after ranks, and
 * the player pages' upcoming-games block, both of which hold them for longer
 * than one request.
 *
 * A failure here is logged and swallowed. The ingest has already committed; a
 * cache that could not be dropped means a page is briefly stale, and throwing
 * would report a successful write as a failed one.
 */
async function dropCaches(): Promise<void> {
  try {
    // The table itself first: every cache below re-reads it.
    const { invalidateFpaTableCache } = await import("./fpa-data");
    invalidateFpaTableCache();

    const { invalidateFpaRenderCache } = await import("../fpa-ssr");
    invalidateFpaRenderCache();

    const { invalidateMatchupRenderCache } = await import("../matchup/matchup-ssr");
    invalidateMatchupRenderCache();

    // The memoized table behind the player pages' fixtures, and the rendered
    // player fragments built from it. The memo alone is not enough: it has a
    // ten-minute window, but a player fragment is held until its own version
    // moves, and the FPA figures are not part of that version.
    const { resetMatchupTableCache } = await import("../player/upcoming");
    resetMatchupTableCache();

    const { invalidatePlayerRenderCache } = await import("../player-ssr");
    invalidatePlayerRenderCache();
  } catch (err) {
    logger.error({ err }, "FPA ingest committed but a cache could not be dropped");
  }
}

/**
 * Run the ingest, or join the one already running.
 *
 * Rejects when the ingest rejects, including for a caller that joined - the
 * failure belongs to everyone waiting on that run.
 */
export async function refreshFpa(
  opts: IngestOptions = {},
): Promise<FpaRefreshResult> {
  if (inFlight) {
    const running = inFlight;
    logger.info("FPA refresh already in flight - joining it");
    return running.then((result) => ({ result, joined: true }));
  }

  state.lastAttemptMs = Date.now();

  const run = ingestFpa(opts)
    .then((result) => {
      state.lastSuccessMs = Date.now();
      state.lastResult = {
        snapshotRows: result.snapshotRows,
        gameRows: result.gameRows,
        weekNumber: result.weekNumber,
        dataMode: result.dataMode,
      };
      state.lastError = null;
      state.consecutiveFailures = 0;
      return dropCaches().then(() => result);
    })
    .catch((err: unknown) => {
      state.lastError = err instanceof Error ? err.message : String(err);
      state.consecutiveFailures += 1;
      logger.error({ err }, "FPA refresh failed");
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = run;
  return run.then((result) => ({ result, joined: false }));
}
