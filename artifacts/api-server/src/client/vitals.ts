/**
 * Real-user Core Web Vitals reporting.
 *
 * Lab tools measure a single synthetic load; they can't see what real visitors
 * experience across devices and networks, and - critically for an interactive
 * tool - INP only exists once someone actually clicks something.
 *
 * This module is built as its OWN bundle (public/dist/statchasers-vitals.js),
 * not folded into the main one. Sites that haven't configured an endpoint never
 * request it, so monitoring costs nothing by default and never delays the tool.
 *
 * It reports its frame context: CLS and INP occurring inside an iframe count
 * toward the user's Core Web Vitals for the page, but the parent page's own RUM
 * script cannot observe them. When this runs framed it says so, so framed
 * measurements are attributable rather than silently missing.
 */

import { onLCP, onINP, onCLS, onTTFB, onFCP } from "web-vitals";

const TOOL_ID = "statchasers-news";

interface VitalPayload {
  metric: string;
  value: number;
  rating: string;
  /** Which tool produced this, so metrics aren't averaged across the site. */
  tool: string;
  /** The page the tool is embedded in - the URL that actually gets ranked. */
  page: string;
  /** True when measured inside an iframe; see note above. */
  framed: boolean;
  navigationType: string;
}

function send(endpoint: string, payload: VitalPayload): void {
  const body = JSON.stringify(payload);
  // sendBeacon survives the page being unloaded, which is exactly when the
  // final CLS and INP values are known.
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      endpoint,
      new Blob([body], { type: "application/json" }),
    );
    return;
  }
  void fetch(endpoint, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {
    /* Reporting must never break the page. */
  });
}

/** Begin reporting for a tool root that has an endpoint configured. */
export function startVitals(root: HTMLElement): void {
  const endpoint = (root.dataset["scVitalsEndpoint"] ?? "").trim();
  if (!endpoint) return;

  const framed = window.parent !== window;
  // Inside a frame, location.href is the tool's own URL, not the page being
  // ranked. The host passes its URL down so metrics attach to the right page;
  // referrer is the best available fallback.
  const page =
    (root.dataset["scPageUrl"] ?? "").trim() ||
    (framed ? document.referrer : window.location.href) ||
    window.location.href;

  const report = (metric: {
    name: string;
    value: number;
    rating: string;
    navigationType: string;
  }): void => {
    send(endpoint, {
      metric: metric.name,
      value: Math.round(metric.value * 1000) / 1000,
      rating: metric.rating,
      tool: TOOL_ID,
      page,
      framed,
      navigationType: metric.navigationType,
    });
  };

  // The three Core Web Vitals, plus two diagnostics that explain them: TTFB
  // feeds LCP, and FCP separates "slow server" from "slow render".
  onLCP(report);
  onINP(report);
  onCLS(report);
  onTTFB(report);
  onFCP(report);
}
