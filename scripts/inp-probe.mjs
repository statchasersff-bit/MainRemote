#!/usr/bin/env node
// Interaction (INP) probe: loads a URL in headless Chromium over the DevTools
// protocol, performs real taps/clicks on the selectors you name, and prints
// each interaction's Event Timing split into the three INP phases (input
// delay, processing, presentation) together with the Long Animation Frame
// scripts that ran inside it. Written for the 2026-11-15 INP audit
// (docs/INP-AUDIT.md); use it to re-check a template after a change.
//
//   node scripts/inp-probe.mjs <url> [mobile|desktop] --click="<css>|<css>|..."
//
//   mobile    412x915 phone emulation, touch input, 4x CPU throttle
//   desktop   1366x768, mouse input, no throttle
//   --click   "|"-separated selectors, clicked in order (first VISIBLE match;
//             append " @N" to pick the Nth visible match). "BODY" taps a
//             paragraph of plain text: an interaction no handler of ours
//             owns, so it shows the page's baseline cost per tap.
//   --settle=ms   wait after load before the first click (default 6000)
//   --early       first click 1500ms after DOMContentLoaded instead
//   --cpu=N       override the CPU throttle rate
//   --block=pat,..  Network.setBlockedURLs patterns (A/B a script's cost)
//   --css=<file>  inject this CSS after load (A/B a stylesheet rule)
//   --json        print the raw JSON report only
//
// Reads CHROMIUM from the environment; defaults to the Replit binary. Run with
// the Bash sandbox OFF (Chromium's children die inside it). Lab numbers on
// this box are slower than a real phone's in absolute terms; compare runs.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, mode = "mobile", ...rest] = process.argv.slice(2);
if (!url) {
  console.error('usage: node scripts/inp-probe.mjs <url> [mobile|desktop] --click="sel|sel"');
  process.exit(2);
}
const opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const clicks = (opt("click") ?? "BODY").split("|").map((s) => s.trim()).filter(Boolean);
const settle = Number(opt("settle") ?? 6000);
const early = rest.includes("--early");
const mobile = mode === "mobile";
const cpu = Number(opt("cpu") ?? (mobile ? 4 : 1));
const blocked = (opt("block") ?? "").split(",").filter(Boolean);
const cssFile = opt("css");
const jsonOnly = rest.includes("--json");

const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(
  process.env["CHROMIUM"] || "/repl/tools/bin/chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `inp-probe-${port}`)}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d));
process.on("exit", () => chrome.kill("SIGKILL"));

async function pageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chromium did not start: " + stderr.slice(-500));
}

const ws = new WebSocket(await pageWs());
await new Promise((res) => (ws.onopen = res));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? rej(new Error(method + ": " + msg.error.message)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

// Observers go in before any page script runs, so load-time long frames and
// the very first interaction are both on the record.
const OBSERVE = `(() => {
  const d = (el) => {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = (el.getAttribute && el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    return s;
  };
  window.__inp = { ev: [], loaf: [], lt: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__inp.ev.push({
      name: e.name, id: e.interactionId, start: e.startTime, dur: e.duration,
      delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart,
      pres: e.startTime + e.duration - e.processingEnd, target: d(e.target) }); })
      .observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__inp.loaf.push({
      start: e.startTime, dur: e.duration, block: e.blockingDuration,
      render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
      style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
      scripts: e.scripts.map((s) => ({ src: (s.sourceURL || '').replace(/\\?.*$/, ''), fn: s.sourceFunctionName,
        inv: s.invoker, type: s.invokerType, dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration) })) }); })
      .observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
})();`;

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: false });
if (blocked.length) await send("Network.setBlockedURLs", { urls: blocked });
await send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
await send("Emulation.setDeviceMetricsOverride", mobile
  ? { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }
  : { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", {
  userAgent: mobile
    ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});
if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu });

const t0 = Date.now();
await send("Page.navigate", { url });
const waitFor = async (method, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (events.some((e) => e.method === method)) return true;
    await sleep(100);
  }
  return false;
};
await waitFor("Page.domContentEventFired", 30000);
const dcl = Date.now() - t0;
if (early) await sleep(1500);
else {
  await waitFor("Page.loadEventFired", 30000);
  await sleep(settle);
}
if (cssFile) {
  const css = readFileSync(cssFile, "utf8");
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
  await sleep(500);
}
const domSize = await evaluate("document.getElementsByTagName('*').length");
const sheetRules = await evaluate(`(() => { let n = 0; for (const s of document.styleSheets) { try { n += s.cssRules.length; } catch (e) {} } return n; })()`);

const tap = async (x, y) => {
  if (mobile) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(60);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
};

const done = [];
for (const raw of clicks) {
  const m = raw.match(/^(.*?)\s+@(\d+)$/);
  const sel = m ? m[1] : raw;
  const nth = m ? Number(m[2]) : 0;
  const box = await evaluate(`(() => {
    let els = ${sel === "BODY" ? `Array.from(document.querySelectorAll('p')).filter(p => p.textContent.trim().length > 60 && !p.closest('a,button,summary,label'))` : `Array.from(document.querySelectorAll(${JSON.stringify(sel)}))`};
    els = els.filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; });
    const el = els[${nth}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  if (!box) { done.push({ sel: raw, missing: true }); continue; }
  await sleep(700);
  const pt = await evaluate(`(() => {
    let els = ${sel === "BODY" ? `Array.from(document.querySelectorAll('p')).filter(p => p.textContent.trim().length > 60 && !p.closest('a,button,summary,label'))` : `Array.from(document.querySelectorAll(${JSON.stringify(sel)}))`};
    els = els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const r = els[${nth}].getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + r.height / 2) };
  })()`);
  const before = await evaluate("performance.now()");
  await tap(pt.x, pt.y);
  await sleep(1500);
  done.push({ sel: raw, at: before });
}
await sleep(1000);
const data = await evaluate("JSON.stringify(window.__inp)");
const rep = JSON.parse(data || '{"ev":[],"loaf":[]}');

// Group event entries into interactions (INP = the worst one's duration).
const byId = new Map();
for (const e of rep.ev) {
  const cur = byId.get(e.id);
  if (!cur || e.dur > cur.dur) byId.set(e.id, e);
}
const interactions = [...byId.values()].sort((a, b) => a.start - b.start).map((e) => {
  const end = e.start + e.dur;
  const frames = rep.loaf.filter((f) => f.start < end && f.start + f.dur > e.start - 50);
  const scripts = frames.flatMap((f) => f.scripts).filter((s) => s.dur >= 5).sort((a, b) => b.dur - a.dur).slice(0, 6);
  const click = [...done].reverse().find((c) => c.at && c.at <= e.start + 5);
  return {
    click: click?.sel ?? "(load)",
    target: e.target,
    event: e.name,
    inp: Math.round(e.dur),
    inputDelay: Math.round(e.delay),
    processing: Math.round(e.proc),
    presentation: Math.round(e.pres),
    frameStyleLayout: Math.round(Math.max(0, ...frames.map((f) => f.style))),
    scripts,
  };
});
const loadFrames = rep.loaf.filter((f) => f.block > 0);
const loadBlocking = Math.round(loadFrames.reduce((a, f) => a + f.block, 0));
const topLoad = Object.entries(
  rep.loaf.flatMap((f) => f.scripts).reduce((acc, s) => {
    const k = (s.src || s.inv || "?").replace(/^https?:\/\//, "").slice(0, 90);
    acc[k] = (acc[k] || 0) + s.dur;
    return acc;
  }, {}),
).sort((a, b) => b[1] - a[1]).slice(0, 10);
const report = {
  url, mode, cpu, dcl, domSize, sheetRules,
  missing: done.filter((d) => d.missing).map((d) => d.sel),
  inp: Math.max(0, ...interactions.map((i) => i.inp)),
  interactions,
  longFrames: rep.loaf.length, totalBlocking: loadBlocking, scriptTimeBySource: topLoad,
};
if (jsonOnly) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`${url} [${mode} cpu x${cpu}] DOM ${domSize} nodes, ${sheetRules} CSS rules, DCL ${dcl}ms`);
  console.log(`  long frames ${report.longFrames}, blocking ${loadBlocking}ms; worst interaction ${report.inp}ms`);
  if (report.missing.length) console.log("  not found:", report.missing.join(" | "));
  for (const i of interactions)
    console.log(`  ${String(i.inp).padStart(4)}ms  delay ${String(i.inputDelay).padStart(3)} proc ${String(i.processing).padStart(3)} pres ${String(i.presentation).padStart(3)} (style/layout ${i.frameStyleLayout})  ${i.event} ${i.target}  <- ${i.click}` +
      (i.scripts.length ? "\n        " + i.scripts.map((s) => `${s.dur}ms ${s.type}:${(s.inv || "").slice(0, 50)} ${s.src.split("/").pop()}${s.forced ? ` forced=${s.forced}` : ""}`).join("\n        ") : ""));
  console.log("  script time by source:", topLoad.map(([k, v]) => `${k.split("/").pop() || k} ${v}ms`).join(", "));
}
ws.close();
process.exit(0);
