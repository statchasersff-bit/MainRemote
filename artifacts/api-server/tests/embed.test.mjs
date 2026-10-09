/**
 * The legacy iframe embed's parent-side resize listener (`/embed.js`).
 *
 * Every failure mode here is SILENT - a dropped height message leaves the frame
 * at its placeholder height and the only symptom on the live page is a tool
 * that scrolls inside its own box. Nothing throws, nothing logs. So the
 * listener gets its own suite: the script is fetched from the running server,
 * exactly as WordPress would load it, and run against a real frame element.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

const HOST_PAGE = "https://statchasers.com/nfl/player-news/";
/** Where the pasted snippet points the frame - the tool's public origin. */
const FRAME_ORIGIN = "https://news.statchasers.com";
/** The snippet ships a fixed height; a rejected message must leave it alone. */
const PLACEHOLDER = "728px";

let server;
const windows = [];

before(async () => {
  server = await startServer();
});

after(async () => {
  for (const window of windows) {
    try {
      window.close();
    } catch {
      /* already closed */
    }
  }
  await server?.stop();
});

/**
 * Fetch `/embed.js` and run it on a host page carrying the iframe snippet.
 *
 * `servedFrom` is the origin the server believes it is reachable at, which is
 * what gets baked into the script. Passing one that differs from the frame's
 * `src` reproduces a stale snippet or a scheme/host mismatch.
 */
async function loadListener({ servedFrom = FRAME_ORIGIN } = {}) {
  const res = await fetch(`${server.origin}/embed.js`, {
    headers: {
      "x-forwarded-proto": new URL(servedFrom).protocol.replace(":", ""),
      "x-forwarded-host": new URL(servedFrom).host,
    },
  });
  const script = await res.text();

  const dom = new JSDOM(
    `<!doctype html><html lang="en"><body>` +
      `<iframe id="statchasers-news" src="${FRAME_ORIGIN}/" style="height:${PLACEHOLDER};"></iframe>` +
      `</body></html>`,
    { runScripts: "outside-only", url: HOST_PAGE, pretendToBeVisual: true },
  );
  const { window } = dom;
  windows.push(window);
  window.eval(script);

  const frame = window.document.getElementById("statchasers-news");
  return {
    window,
    frame,
    /** Deliver a height message the way the framed tool would. */
    send: ({ height, origin = FRAME_ORIGIN, source = frame.contentWindow }) =>
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { type: "statchasers:height", height },
          origin,
          source,
        }),
      ),
  };
}

describe("iframe auto-resize listener", () => {
  test("applies the frame's reported height", async () => {
    const { frame, send } = await loadListener();
    send({ height: 1461 });

    assert.equal(frame.style.height, "1461px");
    assert.equal(
      frame.style.getPropertyPriority("height"),
      "important",
      "must outrank a leftover host stylesheet rule",
    );
    assert.equal(
      frame.style.minHeight,
      "0px",
      "a host min-height rule would otherwise re-introduce the scrollbar",
    );
  });

  test("still resizes when the baked origin disagrees with the frame's src", async () => {
    // The snippet on the page predates a domain/scheme change, so the origin
    // compiled into embed.js is not the one the frame actually posts from.
    // Rejecting on that mismatch is what leaves the tool scrollable.
    const { frame, send } = await loadListener({
      servedFrom: "https://statchasers-news.replit.app",
    });
    send({ height: 1200 });

    assert.equal(frame.style.height, "1200px");
  });

  test("acknowledges the height so the frame can stop scrolling", async () => {
    // The frame only disables its own scrollbar once told its height is being
    // honored. Without this message it must keep scrolling, or a frame stuck at
    // the placeholder height would hide everything below the fold.
    const { frame, send } = await loadListener();

    const seen = [];
    frame.contentWindow.addEventListener("message", (e) => seen.push(e.data));

    send({ height: 900 });
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(
      seen.some((d) => d && d.type === "statchasers:height-applied"),
      `expected a height-applied ack, got ${JSON.stringify(seen)}`,
    );
  });

  test("does not acknowledge a height it refused to apply", async () => {
    const { frame, send } = await loadListener();
    const seen = [];
    frame.contentWindow.addEventListener("message", (e) => seen.push(e.data));

    send({ height: 0 });
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(
      seen.some((d) => d && d.type === "statchasers:height-applied"),
      false,
      "an unusable height must not tell the frame to lock scrolling",
    );
  });

  test("ignores messages from anything that is not the frame", async () => {
    const { window, frame, send } = await loadListener();
    const impostor = new JSDOM("", { url: "https://evil.example/" }).window;
    windows.push(impostor);

    send({ height: 99999, source: impostor });
    assert.equal(
      frame.style.height,
      PLACEHOLDER,
      "another frame must not resize ours",
    );

    // Nor may a message with no source window at all, whatever origin it claims.
    send({ height: 99999, origin: "https://evil.example", source: null });
    assert.equal(frame.style.height, PLACEHOLDER);

    window.close();
  });

  test("ignores heights that are not usable numbers", async () => {
    const { frame, send } = await loadListener();
    for (const height of [0, -10, "tall", null, undefined]) {
      send({ height });
      assert.equal(
        frame.style.height,
        PLACEHOLDER,
        `applied a height of ${height}`,
      );
    }
  });

  test("asks the frame for its height instead of only waiting", async () => {
    // The script is frequently loaded after the frame has finished loading and
    // broadcast, so a purely passive listener never hears anything. Retries are
    // scheduled on timers; assert they are queued rather than sleeping for the
    // full five seconds.
    const timeouts = [];
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><body>` +
        `<iframe id="statchasers-news" src="${FRAME_ORIGIN}/"></iframe>` +
        `</body></html>`,
      { runScripts: "outside-only", url: HOST_PAGE, pretendToBeVisual: true },
    );
    windows.push(dom.window);
    const realSetTimeout = dom.window.setTimeout;
    dom.window.setTimeout = (fn, ms) => {
      timeouts.push(ms);
      return realSetTimeout(() => {}, 0);
    };

    const script = await (await fetch(`${server.origin}/embed.js`)).text();
    dom.window.eval(script);

    assert.ok(
      timeouts.length >= 3,
      `expected retry timers, got ${JSON.stringify(timeouts)}`,
    );
  });
});
