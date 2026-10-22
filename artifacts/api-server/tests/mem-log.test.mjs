/**
 * The memory breadcrumb (src/lib/mem-log.ts): the line the Logs pane shows,
 * and when it shouts.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const { memLine, sampleMemory } = await importModule("lib/mem-log");
after(cleanupBundles);

test("a healthy sample prints the sizes without a warning", () => {
  const line = memLine(
    { rssMb: 600, heapUsedMb: 300, heapTotalMb: 320, heapLimitMb: 1024, externalMb: 5, availableMb: 900 },
    new Date("2026-10-22T12:00:00Z"),
  );
  assert.equal(line, "[mem] 2026-10-22T12:00:00.000Z rss=600MB heap=300/320MB (limit 1024MB) external=5MB avail=900MB");
});

test("heap near V8's limit and a VM nearly out of memory both warn", () => {
  const line = memLine(
    { rssMb: 1500, heapUsedMb: 900, heapTotalMb: 950, heapLimitMb: 1024, externalMb: 5, availableMb: 120 },
    new Date("2026-10-22T12:00:00Z"),
  );
  assert.match(line, /^\[mem\] 2026-10-22T12:00:00.000Z WARN heap within 15% of V8's limit; VM has under 250MB left: rss=1500MB/);
});

test("the live sample reports this process", () => {
  const s = sampleMemory();
  assert.ok(s.rssMb > 0 && s.heapUsedMb > 0 && s.heapLimitMb > s.heapUsedMb);
});
