/**
 * The player index's two controls.
 *
 * The page is complete before this file runs, exactly like the profile bundle:
 * every club, every player, every portrait and every standing is in the markup
 * the server sent, grouped by club and ordered within it. Nothing here fetches
 * and nothing here renders a row.
 *
 * It adds two things:
 *
 *   1. the position chips, which the server ships hidden for the reason
 *      renderPlayerSearch() ships its box hidden — a control with no script
 *      behind it is a promise the page cannot keep. Revealed here, and from
 *      here on they filter what is already in the document: no request, no
 *      re-render, no URL change.
 *   2. portraits that take themselves out of a row rather than leaving a
 *      broken one, which is cdnImage()'s job in the search panel. Here the
 *      images arrive in the HTML instead of being built, so the same rule is
 *      applied to them after the fact — including to the ones that had already
 *      failed before this file ran.
 *
 * The search box above the chips is not this file's: it is the same widget the
 * profile carries, wired by client/player-search.ts, so a reader who types a
 * name gets the same eight results with the same portraits on the index as on
 * a player's own page.
 */

/** A club card, with its own counts to keep in step with what it is showing. */
interface Club {
  root: HTMLElement;
  list: HTMLElement | null;
  items: HTMLElement[];
  /** The ink half of the header pair: players with production behind them. */
  scoring: HTMLElement | null;
  /** The muted half: how many are listed at all. */
  count: HTMLElement | null;
}

/**
 * Drop an image the CDN has no file for.
 *
 * Neither CDN is this app's: Sleeper has no portrait for every player on the
 * list and a club's logo file can move. A 404 with an empty alt is an empty
 * box of the right size in some engines and a broken-image glyph in others,
 * and the second is worse than the plain well underneath.
 */
function dropBrokenImages(root: HTMLElement): void {
  // `error` does not bubble, so this listens in the capture phase — one
  // listener for six hundred portraits rather than six hundred listeners.
  root.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement && target.matches(".scp-dir-shot, .scp-dir-club-logo")) {
        target.remove();
      }
    },
    true,
  );

  // The ones that failed before this file ran. A complete image with no
  // intrinsic width is one the browser gave up on.
  for (const img of Array.from(
    root.querySelectorAll<HTMLImageElement>(".scp-dir-shot, .scp-dir-club-logo"),
  )) {
    if (img.complete && img.naturalWidth === 0) img.remove();
  }
}

export function wirePlayerDirectory(root: HTMLElement): void {
  dropBrokenImages(root);

  const grid = root.querySelector<HTMLElement>("[data-scp-dir]");
  if (!grid) return;

  const filters = root.querySelector<HTMLElement>("[data-scp-dir-filters]");
  const chips = filters
    ? Array.from(filters.querySelectorAll<HTMLButtonElement>("[data-scp-pos]"))
    : [];
  if (!filters || chips.length === 0) return;

  const clubs: Club[] = Array.from(
    grid.querySelectorAll<HTMLElement>("[data-scp-club]"),
  ).map((club) => ({
    root: club,
    list: club.querySelector<HTMLElement>("[data-scp-dir-list]"),
    items: Array.from(club.querySelectorAll<HTMLElement>(".scp-dir-item")),
    scoring: club.querySelector<HTMLElement>("[data-scp-club-scoring]"),
    count: club.querySelector<HTMLElement>("[data-scp-club-count]"),
  }));

  const total = root.querySelector<HTMLElement>("[data-scp-dir-count]");
  const empty = root.querySelector<HTMLElement>("[data-scp-dir-empty]");

  const apply = (position: string): void => {
    const all = position === "all";
    let shown = 0;

    for (const club of clubs) {
      let visible = 0;
      let scoring = 0;
      for (const item of club.items) {
        const match = all || item.dataset["pos"] === position;
        // `hidden` rather than a class: the row is a link, and a link that is
        // merely invisible is still in the tab order and still read aloud.
        item.hidden = !match;
        if (!match) continue;
        visible += 1;
        // The same rule the server counted by — directoryBand()'s one band for
        // "nothing to show", read off the row rather than recomputed here.
        if (item.dataset["band"] !== "idle") scoring += 1;
      }
      // A club with nobody left is not an empty card, it is not on the page —
      // thirty-two headings over nothing is worse than the filter itself.
      club.root.hidden = visible === 0;
      if (club.scoring) club.scoring.textContent = String(scoring);
      if (club.count) club.count.textContent = String(visible);
      // The position rules divide runs of positions. Filtered to one position
      // there are no runs, so the first rule would be a line under the header
      // dividing nothing.
      if (club.list) {
        if (all) club.list.setAttribute("data-grouped", "");
        else club.list.removeAttribute("data-grouped");
      }
      shown += visible;
    }

    if (total) total.textContent = String(shown);
    if (empty) empty.hidden = shown > 0;

    for (const chip of chips) {
      const active = (chip.dataset["scpPos"] ?? "") === position;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      apply(chip.dataset["scpPos"] ?? "all");
    });
  }

  // Last, so a reader never sees a control that is not wired yet.
  filters.hidden = false;
}
