/**
 * Structured data for the tool itself.
 *
 * Scope is deliberately narrow: one node describing the application, and
 * nothing else. In particular this does NOT emit Article, NewsArticle,
 * ItemList, Dataset, FAQPage, WebPage or BreadcrumbList. The host page's SEO
 * plugin (Rank Math) already produces WebPage and BreadcrumbList, and adding
 * types that don't accurately describe the page — or duplicating ones that
 * already exist — is worse than adding nothing.
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
 * A SoftwareApplication / WebApplication node.
 *
 * NOTE on rich results: Google's SoftwareApplication rich result requires a
 * genuine aggregateRating or review. We do not have one for this tool, and
 * inventing ratings or reviews would be both a policy violation and a lie, so
 * the node ships without them. It remains valid, accurate structured data that
 * describes the page — it simply won't produce that particular rich result
 * unless and until real review data exists to put here.
 */
export function appSchema(
  options: AppSchemaOptions,
): Record<string, unknown> {
  const { pageUrl, name, description, webPageId } = options;

  const node: Record<string, unknown> = {
    "@type": ["SoftwareApplication", "WebApplication"],
    "@id": `${pageUrl}#tool`,
    name,
    description,
    url: pageUrl,
    // SportsApplication is one of Google's documented application categories.
    applicationCategory: "SportsApplication",
    // It runs in the browser: no install, no particular OS.
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript for pagination; content renders without it.",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  // Attach to the host page's node instead of floating free, so the graph reads
  // as one description of one page.
  if (webPageId) {
    node["isPartOf"] = { "@id": webPageId };
    node["mainEntityOfPage"] = { "@id": webPageId };
  }

  return node;
}
