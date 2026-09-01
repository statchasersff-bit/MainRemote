import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(process.argv[2], "utf8");
const bundle = readFileSync("public/dist/statchasers-team.js", "utf8");

function boot(hash = "") {
  const dom = new JSDOM(html, {
    url: `http://localhost:5199/team/new-england-patriots${hash}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.eval(bundle);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom;
}

const dom = boot();
const doc = dom.window.document;
const root = doc.querySelector("[data-sct-root]");

// 1. JS took over and settled state.
assert.equal(root.dataset.sctTabs, "js", "root should be marked js-driven");

const panels = [...doc.querySelectorAll("[data-sct-panel]")];
const links = [...doc.querySelectorAll(".sct-nav-link")];
assert.equal(panels.length, 6);
assert.equal(links.length, 6);

// Order matters: Stats sits directly right of Overview.
assert.deepEqual(
  panels.map((p) => p.id),
  ["overview", "stats", "news", "depth-chart", "schedule", "fantasy"],
);

// 2. Exactly one panel active, and it is the first.
const active = panels.filter((p) => p.classList.contains("is-active"));
assert.equal(active.length, 1, "exactly one panel active");
assert.equal(active[0].id, "overview");

// 3. ARIA wiring.
assert.equal(doc.querySelector(".sct-nav-list").getAttribute("role"), "tablist");
assert.equal(links[0].getAttribute("role"), "tab");
assert.equal(links[0].getAttribute("aria-selected"), "true");
const depthPanel = doc.getElementById("depth-chart");
const depthTab = doc.getElementById("depth-chart-tab");
assert.equal(depthTab.getAttribute("aria-selected"), "false");
assert.equal(links[0].tabIndex, 0);
assert.equal(depthTab.tabIndex, -1, "roving tabindex on inactive tabs");
assert.equal(depthPanel.getAttribute("role"), "tabpanel");
assert.equal(depthPanel.getAttribute("aria-labelledby"), "depth-chart-tab");

// 4. Clicking Depth Chart switches without navigating.
const depthLink = doc.querySelector('[href="#depth-chart"]');
const evt = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
depthLink.dispatchEvent(evt);
assert.equal(evt.defaultPrevented, true, "click should not navigate");
assert.equal(doc.getElementById("depth-chart").classList.contains("is-active"), true);
assert.equal(doc.getElementById("overview").classList.contains("is-active"), false);
assert.equal(depthLink.getAttribute("aria-selected"), "true");
assert.equal(links[0].getAttribute("aria-selected"), "false");
assert.equal(dom.window.location.hash, "#depth-chart", "URL reflects the tab");
assert.equal(
  panels.filter((p) => p.classList.contains("is-active")).length, 1,
  "still exactly one active panel",
);

// 5. The depth chart content is really in that panel.
const depthText = doc.getElementById("depth-chart").textContent.replace(/\s+/g, " ");
for (const bit of ["Patriots Fantasy Depth Chart", "Drake Maye", "TreVeyon Henderson",
                   "A.J. Brown", "Hunter Henry", "View the full Patriots depth chart"]) {
  assert.ok(depthText.includes(bit), `depth panel should contain ${bit}`);
}

// 6. Arrow keys move tabs.
depthLink.focus();
const key = new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
doc.querySelector(".sct-nav-list").dispatchEvent(key);
assert.equal(doc.getElementById("schedule").classList.contains("is-active"), true,
  "ArrowRight moves to the next tab");

// 7. Deep link opens on that tab with no flash of the default.
const deep = boot("#depth-chart");
const deepActive = [...deep.window.document.querySelectorAll("[data-sct-panel].is-active")];
assert.equal(deepActive.length, 1);
assert.equal(deepActive[0].id, "depth-chart", "deep link opens its own tab");

// 7b. The Stats tab is populated and carries its ranks.
const statsText = doc.getElementById("stats").textContent.replace(/\s+/g, " ");
for (const bit of ["Offense & Defense", "Points/G", "Yds/Play",
                   "Situational & Ball Security", "Volume & Play Mix", "Pass "]) {
  assert.ok(statsText.includes(bit), `stats panel should contain ${bit}`);
}
assert.ok(
  doc.querySelectorAll("#stats .sct-stat-rank").length >= 14,
  "both ladders should render ranked rows",
);
assert.ok(
  doc.querySelectorAll("#stats .sct-hist tbody tr").length >= 2,
  "season history should render more than one season",
);
assert.ok(
  doc.querySelectorAll("#stats .sct-stat-move").length > 0,
  "ladders should show year-on-year rank movement",
);

// 8. Resources block is never a panel, so it is never hidden.
const res = doc.getElementById("resources");
assert.ok(res, "resources block present");
assert.equal(res.hasAttribute("data-sct-panel"), false, "resources is not a tab panel");

console.log("all tab assertions passed");
