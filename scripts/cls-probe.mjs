#!/usr/bin/env node
// Layout-shift probe: loads a URL in headless Chromium over the DevTools
// protocol, records every layout-shift entry with the elements that moved,
// and prints a JSON report. Written for the 2026-10-07 CLS investigation
// (docs/CLS-ANALYSIS.md); use it to re-check a page after a fix.
//
//   node scripts/cls-probe.mjs <url> [mode] [settleMs] [flags]
//
//   mode      mobile      412px phone, slow-4G network + 4x CPU throttle
//             mobile-fast 412px phone, no throttling
//             narrow      412px window WITHOUT mobile emulation. Chrome flags
//                         shifts in the first ~500ms of an emulated mobile
//                         document as "had recent input" (the viewport resize
//                         counts as input), which hides them from the CLS
//                         figure. This mode has no such resize, so use it to
//                         confirm an early shift really counts.
//             desktop     1366x768
//   settleMs  how long to wait after navigation before scrolling (default 9000)
//   --walk    scroll through the whole document in viewport steps, as a
//             reader would, so lazy-loaded content below the fold is exercised
//   --reload  load once, then measure a second load with the HTTP cache off
//   --click=<css>,<css>  click these after settling (tab links etc.)
//   --block=<pattern>,...  Network.setBlockedURLs patterns (e.g. *lazyload*)
//   --shot=<file.png>  save a screenshot at the end
//
// Reads CHROMIUM (path to the binary) from the environment; defaults to the
// Replit one. The CLS printed is the session-window figure Chrome reports
// (5s windows, 1s gaps); "excludedByInput" is the sum of shifts Chrome
// flagged as input-adjacent, which the field metric also ignores.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, mode = "mobile", settleArg = "9000", ...rest] = process.argv.slice(2);
if (!url) {
  console.error("usage: node scripts/cls-probe.mjs <url> [mobile|mobile-fast|narrow|desktop] [settleMs] [--walk] [--reload] [--click=sel,..] [--block=pat,..] [--shot=file.png]");
  process.exit(2);
}
const settleMs = Number(settleArg);
const opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const blocked = (opt("block") ?? "").split(",").filter(Boolean);
const clicks = (opt("click") ?? "").split(",").filter(Boolean);
const walk = rest.includes("--walk");
const shot = opt("shot");
const port = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(
  process.env["CHROMIUM"] || "/repl/tools/bin/chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `cls-probe-${port}`)}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d));
process.on("exit", () => chrome.kill("SIGKILL"));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      return j.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chromium did not start: " + stderr.slice(-500));
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res) => (ws.onopen = res));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
function send(method, params = {}, sessionId) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);

await s("Page.enable");
await s("Runtime.enable");
await s("Network.enable");
if (blocked.length) await s("Network.setBlockedURLs", { urls: blocked });
const isMobile = mode.startsWith("mobile");
const ua = isMobile
  ? "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
  : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
await s("Network.setUserAgentOverride", { userAgent: ua });
if (isMobile) {
  await s("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true });
  if (mode === "mobile") {
    await s("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await s("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
} else if (mode === "narrow") {
  await s("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: false });
} else {
  await s("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
}

await s("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  (() => {
    window.__cls = { entries: [], fonts: [], marks: [] };
    const sel = (n) => {
      if (!n) return "(removed)";
      if (n.nodeType === 3) n = n.parentElement;
      if (!n || !n.tagName) return "(?)";
      const parts = [];
      let e = n; let depth = 0;
      while (e && e.tagName && depth < 4) {
        let p = e.tagName.toLowerCase();
        if (e.id) { p += "#" + e.id; parts.unshift(p); break; }
        const cls = Array.from(e.classList || []).filter(c => !/^(et_pb_|et-)/.test(c) || depth === 0).slice(0,3).join(".");
        if (cls) p += "." + cls;
        parts.unshift(p); e = e.parentElement; depth++;
      }
      return parts.join(" > ");
    };
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__cls.entries.push({
          t: Math.round(e.startTime),
          value: +e.value.toFixed(4),
          input: !!e.hadRecentInput,
          scrollY: Math.round(window.scrollY),
          sources: (e.sources || []).map(src => ({
            node: sel(src.node),
            prev: src.previousRect ? [src.previousRect.x, src.previousRect.y, src.previousRect.width, src.previousRect.height].map(Math.round) : null,
            cur: src.currentRect ? [src.currentRect.x, src.currentRect.y, src.currentRect.width, src.currentRect.height].map(Math.round) : null,
          })),
        });
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", (ev) => {
      window.__cls.fonts.push({ t: Math.round(performance.now()), faces: Array.from(new Set((ev.fontfaces||[]).map(f => f.family))).slice(0,12) });
    });
    window.addEventListener("DOMContentLoaded", () => { window.__cls.dcl = Math.round(performance.now()); });
    window.addEventListener("load", () => { window.__cls.load = Math.round(performance.now()); });
    const pp = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls[e.name] = Math.round(e.startTime); });
    pp.observe({ type: "paint", buffered: true });
  })();
  `,
});

const ev = (expression) => s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
const mark = (label) => ev(`window.__cls.marks.push({t: Math.round(performance.now()), label: ${JSON.stringify(label)}})`);

if (rest.includes("--reload")) {
  await s("Page.navigate", { url });
  await sleep(Math.min(settleMs, 6000));
  await s("Network.setCacheDisabled", { cacheDisabled: true });
}
await s("Page.navigate", { url });
await sleep(settleMs);
await mark("settled");

if (walk) {
  const { result: h } = await ev("document.documentElement.scrollHeight");
  const { result: vh } = await ev("innerHeight");
  const step = Math.round(vh.value * 0.8);
  for (let y = step; y < h.value + step; y += step) {
    await ev(`window.scrollTo(0, ${y})`);
    await sleep(700);
  }
  await mark("walked");
  await ev("window.scrollTo(0, 0)");
  await sleep(1000);
}

for (const selector of clicks) {
  await mark(`click ${selector}`);
  await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "clicked"; })()`);
  await sleep(2500);
}

if (shot) {
  const { data } = await s("Page.captureScreenshot", { format: "png" });
  writeFileSync(shot, Buffer.from(data, "base64"));
}

const { result } = await ev(`(() => {
    const c = window.__cls;
    const counted = c.entries.filter(e => !e.input);
    let best = 0, cur = 0, winStart = -1, last = -1e9;
    for (const e of counted) {
      if (e.t - last > 1000 || e.t - winStart > 5000) { cur = 0; winStart = e.t; }
      cur += e.value; last = e.t; if (cur > best) best = cur;
    }
    c.cls = +best.toFixed(4);
    c.total = +counted.reduce((a, e) => a + e.value, 0).toFixed(4);
    c.excludedByInput = +c.entries.filter(e => e.input).reduce((a, e) => a + e.value, 0).toFixed(4);
    c.title = document.title;
    c.viewport = [innerWidth, innerHeight];
    c.docHeight = document.documentElement.scrollHeight;
    return JSON.stringify(c);
  })()`);
const data = JSON.parse(result.value);
data.url = url;
data.mode = mode;
console.log(JSON.stringify(data, null, 1));
try { await s("Page.close"); } catch {}
chrome.kill("SIGKILL");
process.exit(0);
