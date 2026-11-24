/**
 * An open matchup tab follows its game (WEB-040, 2026-11-24).
 *
 * The server prints the game-state strip ([data-sc-game-state], see
 * lib/matchup/game-state-render.ts) with the record it rendered from. While
 * the game can change - half an hour before kickoff, during play, and a final
 * still waiting for its box score - this asks /api/game-state/<id> for the
 * same record and redraws the strip from it with the same wording functions
 * the server used. Nothing else on the page is rebuilt: WordPress is never
 * asked to re-render for a score.
 *
 * - Pregame far from kickoff: one timer, woken half an hour before.
 * - Live: every 30 s while the tab is visible; paused while hidden.
 * - Errors: the last verified score and its time stay on screen, marked as
 *   such, and the interval backs off to five minutes.
 * - Final: the strip shows the final, the clock is gone, and polling stops
 *   once the box score is in (with a link to the game's page, or a reload
 *   button on the game's page itself).
 * - A response older than what is on screen never replaces it: a final is
 *   never followed by a live reading.
 */

import { phaseBadge, pollPlan, stripParts, type GameStateRecord } from "../lib/matchup/game-state";

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const FINAL_RANK = 9;

function rank(phase: string): number {
  return phase === "final" ? FINAL_RANK : phase === "scheduled" ? 0 : 1;
}

function easternClock(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms))} ET`;
}

function text(tag: string, cls: string, value: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = value;
  return el;
}

/** Redraw the strip from a record, the server's markup rebuilt in place. */
export function drawStrip(strip: HTMLElement, record: GameStateRecord): void {
  const parts = stripParts(record);
  const line = strip.querySelector<HTMLElement>(".sct-gs-line");
  const note = strip.querySelector<HTMLElement>(".sct-gs-note");
  if (line) {
    line.replaceChildren();
    const badge = text("span", "sct-gs-badge", phaseBadge(record));
    badge.dataset["phase"] = record.phase;
    line.append(badge);
    if (parts.score) line.append(text("span", "sct-gs-score", parts.score));
    if (parts.status && record.phase !== "final") line.append(text("span", "sct-gs-status", parts.status));
  }
  if (note) {
    note.replaceChildren();
    if (parts.note) note.append(document.createTextNode(parts.note));
    if (record.phase === "final" && record.detailsReady !== false) {
      if (strip.dataset["onGamePage"] === "1") {
        const button = text("button", "sct-gs-action", "Load the box score");
        button.setAttribute("type", "button");
        button.addEventListener("click", () => window.location.reload());
        note.append(button);
      } else if (strip.dataset["gameHref"]) {
        const link = text("a", "sct-gs-action", "Box score and recap") as HTMLAnchorElement;
        link.href = strip.dataset["gameHref"];
        note.append(link);
      }
    }
  }
  strip.dataset["phase"] = record.phase;
  strip.dataset["version"] = record.version;
  if (record.phase !== "scheduled") strip.hidden = false;
}

function follow(strip: HTMLElement): void {
  const endpoint = strip.dataset["endpoint"];
  if (!endpoint) return;
  let current: GameStateRecord | null = null;
  let failures = 0;
  let timer: number | undefined;
  let lastGoodMs: number | null = null;

  const phase = (): string => current?.phase ?? strip.dataset["phase"] ?? "scheduled";
  const kickoff = Number(strip.dataset["kickoff"] ?? "");

  // The plan the server would give for what is on screen.
  const plan = (now: number): { active: boolean; everyMs: number; wakeInMs: number | null } => {
    if (current) {
      const p = pollPlan(current, now);
      if (p.active) return { ...p, wakeInMs: null };
    } else {
      const ph = phase();
      if (ph !== "scheduled" && ph !== "final") return { active: true, everyMs: 30_000, wakeInMs: null };
      if (ph === "final") return { active: true, everyMs: 120_000, wakeInMs: null };
    }
    if (phase() === "scheduled" && Number.isFinite(kickoff) && kickoff > 0) {
      const lead = kickoff - 30 * 60 * 1000 - now;
      if (lead > 0) return { active: false, everyMs: 0, wakeInMs: Math.min(lead, 60 * 60 * 1000) };
      return { active: true, everyMs: 30_000, wakeInMs: null };
    }
    return { active: false, everyMs: 0, wakeInMs: null };
  };

  const schedule = (): void => {
    window.clearTimeout(timer);
    if (document.hidden) return;
    const p = plan(Date.now());
    if (p.wakeInMs !== null) {
      timer = window.setTimeout(schedule, p.wakeInMs);
      return;
    }
    if (!p.active) return;
    const wait = failures ? Math.min(MAX_BACKOFF_MS, p.everyMs * 2 ** failures) : p.everyMs;
    timer = window.setTimeout(tick, wait);
  };

  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(endpoint, { cache: "no-store", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { ok?: boolean; game?: GameStateRecord };
      if (!body.ok || !body.game) throw new Error("no game");
      failures = 0;
      lastGoodMs = Date.now();
      const next = body.game;
      // Never step back: a final stays a final whatever an older copy says.
      if (rank(next.phase) < rank(phase()) && phase() === "final") {
        schedule();
        return;
      }
      if (!current || current.version !== next.version || strip.dataset["version"] !== next.version) {
        current = next;
        drawStrip(strip, next);
      } else {
        current = next;
      }
    } catch {
      failures += 1;
      const note = strip.querySelector<HTMLElement>(".sct-gs-note");
      if (note && !strip.hidden) {
        const since = lastGoodMs ?? current?.scoreReadAtMs ?? null;
        note.textContent = since
          ? `Live updates are paused. Showing the last verified score, as of ${easternClock(since)}.`
          : "Live updates are paused. Showing the last verified score.";
      }
    }
    schedule();
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      // Back in view: catch up at once if the game can be changing.
      const p = plan(Date.now());
      window.clearTimeout(timer);
      if (p.active) void tick();
      else schedule();
    } else {
      window.clearTimeout(timer);
    }
  });
  schedule();
}

/** Every strip on the page, each following its own game. */
export function wireGameState(root: ParentNode = document): void {
  for (const strip of Array.from(root.querySelectorAll<HTMLElement>("[data-sc-game-state]"))) {
    if (strip.dataset["scGameStateWired"]) continue;
    strip.dataset["scGameStateWired"] = "1";
    follow(strip);
  }
}
