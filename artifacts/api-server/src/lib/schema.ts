/**
 * Structured data for the page the tool is mounted on.
 *
 * Scope is deliberately narrow: one WebPage node, and
 * nothing else. In particular this does NOT emit Article, NewsArticle,
 * ItemList, Dataset, FAQPage, SoftwareApplication or BreadcrumbList. The host page's SEO
 * plugin (Rank Math) already produces WebPage and BreadcrumbList, and adding
 * types that don't accurately describe the page - or duplicating ones that
 * already exist - is worse than adding nothing.
 *
 * The node is designed to be merged INTO an existing schema graph rather than
 * published as a second standalone graph; see the WordPress plugin, which
 * hooks `rank_math/json_ld`. `/embed/schema.json` exposes the same node so a
 * non-WordPress host can merge it into whatever graph it already emits.
 */

export interface AppSchemaOptions {
  /** Canonical URL of the page the tool is mounted on. */
  pageUrl: string;
  name: string;
  description: string;
  /** @id of the host page's WebPage node, when there is one to attach to. */
  webPageId?: string;
}

/**
 * A WebPage node for the page the tool is mounted on.
 *
 * It used to be a SoftwareApplication / WebApplication. Search Console holds
 * that type to the software-app rich result's rules - offers.price plus an
 * aggregateRating or review - and flagged every page carrying it, team
 * schedules included. We have no genuine rating and will not invent one, and a
 * news feed or a team hub is a page people read, not an application they run.
 * WebPage is what it is.
 *
 * With `webPageId` the node takes the host page's @id, so a JSON-LD consumer
 * merges it into the WebPage node the host already emits rather than reading a
 * second page. Without one it stands alone at `<pageUrl>#webpage`.
 */
export function appSchema(
  options: AppSchemaOptions,
): Record<string, unknown> {
  const { pageUrl, name, description, webPageId } = options;

  return {
    "@type": "WebPage",
    "@id": webPageId || `${pageUrl}#webpage`,
    name,
    description,
    url: pageUrl,
    isAccessibleForFree: true,
    inLanguage: "en-US",
  };
}
