import fs from "node:fs";
import type { Express, Response } from "express";
import { logger } from "./logger";

const CLIENT_SNIPPET = `<script>
(function () {
  var source = new EventSource("/__livereload");
  source.onmessage = function (event) {
    if (event.data === "reload") window.location.reload();
  };
})();
</script>`;

export interface LiveReload {
  enabled: boolean;
  injectIntoHtml(html: string): string;
}

const NOOP: LiveReload = { enabled: false, injectIntoHtml: (html) => html };

let current: LiveReload = NOOP;

/**
 * The live-reload instance for this process.
 *
 * app.ts is the only caller of setupLiveReload() — it is the one that has the
 * Express instance and the directory to watch — but the team pages are rendered
 * by a router mounted from there, and importing app.ts back would be a cycle.
 * So the instance is published here instead of threaded through every route.
 *
 * Returns the no-op outside development, which is what makes it safe to call
 * unconditionally from a request path.
 */
export function liveReload(): LiveReload {
  return current;
}

/**
 * Wires up a development-only live-reload: an SSE endpoint the browser
 * subscribes to, plus a watcher on the served frontend directory that pushes a
 * "reload" event whenever a file changes. Returns a no-op outside development.
 */
export function setupLiveReload(app: Express, watchDir: string): LiveReload {
  if (process.env.NODE_ENV !== "development") {
    return NOOP;
  }

  const clients = new Set<Response>();

  app.get("/__livereload", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  let debounce: NodeJS.Timeout | undefined;
  fs.watch(watchDir, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      for (const client of clients) client.write("data: reload\n\n");
    }, 100);
  });

  logger.info(`Live reload watching ${watchDir}`);

  current = {
    enabled: true,
    injectIntoHtml: (html) =>
      html.includes("</body>")
        ? html.replace("</body>", `${CLIENT_SNIPPET}</body>`)
        : html + CLIENT_SNIPPET,
  };

  return current;
}
