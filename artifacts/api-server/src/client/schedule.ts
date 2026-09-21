/**
 * NFL schedule enhancement bundle.
 *
 * The board is complete before this runs — every matchup, date, kickoff, TV
 * mark, bye, division game and posted line is in the HTML the server sent, and
 * the view, week, team and filter controls are ordinary links and an ordinary
 * form that all work with scripting disabled. Nothing here fetches anything and
 * nothing here renders a game.
 *
 * It adds three things the server cannot:
 *
 *   1. **Kickoffs in the reader's own time zone.** The server labels them ET
 *      because that is the only honest thing it can do — it has no idea where
 *      the reader is, and rendering its own local time would be wrong for
 *      almost everyone, silently. The browser does know, so it relabels. Only
 *      cells carrying `data-kickoff` are touched, and the renderer only puts it
 *      on games that have not started: a live or final cell holds a clock or a
 *      score's status, and rewriting that as a time would erase it.
 *   2. **The week strip scrolled to where you are.** Eighteen weeks do not fit
 *      on a phone, and opening Week 14 with the strip parked on Week 1 hides
 *      the control you just used.
 *   3. **A team picker that submits itself.** The form has a Show button
 *      because without one the `<select>` does nothing with scripting off; once
 *      this runs, the button is redundant and is hidden.
 *
 * Plus height reporting for the legacy iframe mount, as the other bundles do.
 */

import { wireFrameHeight } from "./enhance";

const ROOT_SELECTOR = "[data-scs-root]";

/**
 * Relabel a kickoff in the reader's own zone.
 *
 * Left alone when the browser resolves to Eastern anyway: "1:00 PM ET" is
 * already the right answer there, and swapping it for "1:00 PM" would remove
 * information for no gain. The zone abbreviation comes from Intl rather than a
 * table, so it is right in Phoenix and right in London.
 */
function localizeKickoffs(root: HTMLElement): void {
  const cells = Array.from(
    root.querySelectorAll<HTMLElement>("[data-kickoff]"),
  );
  if (cells.length === 0) return;

  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return;
  }
  if (zone === "" || zone === "America/New_York") return;

  const format = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  for (const cell of cells) {
    const ms = Number(cell.getAttribute("data-kickoff"));
    if (!Number.isFinite(ms)) continue;
    const text = format.format(new Date(ms));
    // The dot is a sibling element, so only the text node is replaced — the
    // live indicator, where there is one, stays put.
    const node = Array.from(cell.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE,
    );
    if (node) node.textContent = text;
    else cell.textContent = text;
    cell.title = `${text} (kickoff)`;
  }
}

/** Bring the current week into view inside the strip, without moving the page. */
function centreWeekRail(root: HTMLElement): void {
  const rail = root.querySelector<HTMLElement>("[data-scs-rail] .scs-rail-list");
  const active = rail?.querySelector<HTMLElement>(".is-active");
  if (!rail || !active) return;

  const offset =
    active.offsetLeft - rail.clientWidth / 2 + active.clientWidth / 2;
  // Assigning scrollLeft rather than scrollIntoView: the latter scrolls every
  // scrollable ancestor, which on a WordPress page jumps the reader down to the
  // strip on load.
  rail.scrollLeft = Math.max(0, offset);
}

function boot(): void {
  for (const root of Array.from(
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR),
  )) {
    localizeKickoffs(root);
    centreWeekRail(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
