/**
 * Title case for section headings: "Jacoby Brissett's 2026 Season, Week by Week".
 *
 * mak (2026-09-30): every section title is capitalized. Short articles,
 * conjunctions and prepositions stay lowercase unless they open or close the
 * heading; a word that is already capitalized ("FAQ", "Week 3") is left as is.
 * Hyphenated parts follow the same rule: "Rest-of-Season".
 */
const MINOR = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
  "of", "on", "or", "per", "the", "to", "vs", "vs.", "via", "with",
]);

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

export function titleCase(text: string): string {
  const words = text.split(" ");
  const last = words.length - 1;
  return words
    .map((word, i) =>
      word
        .split("-")
        .map((part, j, parts) => {
          const edge = (i === 0 && j === 0) || (i === last && j === parts.length - 1);
          const bare = part.replace(/[^a-z.]/gi, "").toLowerCase();
          return !edge && MINOR.has(bare) ? part : cap(part);
        })
        .join("-"),
    )
    .join(" ");
}
