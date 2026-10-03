/**
 * What an ingest hands to the store, before it is a row.
 *
 * In lib rather than beside storeItems() because it is no longer one feed's
 * shape: the Dynasty Command wire and the 32 club feeds (lib/club-news.ts) both
 * produce it, from completely different documents, and a provider that had to
 * import it from a route in order to be stored would have the dependency
 * pointing the wrong way.
 *
 * Every field is optional except by convention, because half of them come from
 * a JSON feed this app does not control. The index signature is deliberate: an
 * upstream that starts sending a new field must not become a type error in a
 * server whose job is to store what it is given and ignore the rest.
 */
export interface RawNewsItem {
  id?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  playerName?: string;
  image?: string;
  /**
   * Who reported the story - "ESPN.com", "Boston Globe" - as distinct from who
   * relayed it to us, which is the provider label passed to storeItems().
   *
   * Optional because the Dynasty Command feed does not carry it. Every link in
   * the archive points at rotowire.com, which is the aggregator rather than the
   * outlet, so there is nothing to derive it from either: an item without this
   * field falls back to the provider and says so honestly rather than guessing
   * an outlet from a URL that cannot know one.
   */
  source?: string;
  /**
   * The club this story belongs to, as our lowercase code. Set only by a
   * provider that knows it - see the schema's team_abbr, and lib/club-news.ts.
   */
  teamAbbr?: string;
  /**
   * A summary that came WITH the item, rather than one generated for it.
   *
   * The club feeds carry a standfirst written by the club; the wire carries
   * nothing, and its rows are filled in later by backfillSummaries(). Applied
   * on insert only - see storeItems, which must not let an ingest overwrite a
   * generated summary on every pass.
   */
  summary?: string;
  /**
   * A fingerprint the provider supplies itself, instead of the title-derived
   * one below.
   *
   * For a provider whose upstream has a stable, unique external id, that id IS
   * the identity and a title fingerprint is strictly worse: two X posts can
   * legitimately carry the same words (a reporter posting the same sentence
   * about two players, a correction reposted verbatim), and collapsing them
   * into one row would lose a story. Only set by such a provider; the wire and
   * the club feeds have no such id and keep the content fingerprint that was
   * built for them.
   */
  dedupeKey?: string;
  /**
   * The handle behind the item, when its author is a person rather than an
   * outlet. Lowercase, without the @. See news_items.author_handle.
   */
  authorHandle?: string;
  [key: string]: unknown;
}

/**
 * A stable content fingerprint for an item. We dedupe on this rather than the
 * upstream id: the feed has historically changed both its id scheme and its
 * pubDate formatting, and the old fallback id (a hash of title|link|pubDate)
 * produced a fresh row for the same article every time that string changed -
 * which is how the backlog ended up with each story stored twice.
 */
export function newsDedupeKey(item: {
  title?: string | null;
  id?: string | null;
  /**
   * Namespace the fingerprint belongs to, when a title is only unique inside
   * one. The club feeds need it and the player wire does not: 32 clubs publish
   * to the same archive and a generic headline - "Week 1 Inactives", "Practice
   * Report" - is not one story that four teams filed, it is four stories that
   * happen to share a name, and an unscoped fingerprint would keep whichever
   * arrived last and silently drop the rest from three team pages.
   *
   * Omitted for the wire, which is one publisher and whose existing rows must
   * keep the keys they were stored under. Adding a scope to those would make
   * every archived story look new.
   */
  scope?: string | null;
}): string {
  const title = (item.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const key = title || `id:${(item.id ?? "").trim()}`;
  const scope = (item.scope ?? "").trim().toLowerCase();
  return scope ? `${scope}:${key}` : key;
}
