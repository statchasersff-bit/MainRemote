/**
 * lib/mem.ts: the memory a process can still grow into, read from the host
 * (/proc/meminfo) and from its cgroup, whichever is tighter. The cgroup half is
 * the one that matters on a Replit VM, where meminfo describes the host.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const mem = await importModule("lib/mem");

const roots = [];
after(async () => {
  await cleanupBundles();
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sc-mem-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  }
  return {
    meminfo: path.join(root, "meminfo"),
    cgroupV2: path.join(root, "cg2"),
    cgroupV1: path.join(root, "cg1"),
  };
}

const MEMINFO = "MemTotal:        8156240 kB\nMemFree:         4611000 kB\nMemAvailable:    4417692 kB\n";
const MB = 1024 * 1024;

describe("availableMemMb", () => {
  test("a cgroup v2 limit beats a roomy host", async () => {
    const paths = await fixture({
      meminfo: MEMINFO,
      "cg2/memory.max": `${2048 * MB}\n`,
      "cg2/memory.current": `${1500 * MB}\n`,
      "cg2/memory.stat": `anon ${1300 * MB}\nfile ${200 * MB}\ninactive_file ${100 * MB}\n`,
    });
    assert.equal(mem.hostAvailableMb(paths), 4314);
    assert.equal(mem.cgroupAvailableMb(paths), 648);
    assert.equal(mem.availableMemMb(paths), 648);
  });

  test("a cgroup v2 'max' limit means the host number stands", async () => {
    const paths = await fixture({
      meminfo: MEMINFO,
      "cg2/memory.max": "max\n",
      "cg2/memory.current": `${1500 * MB}\n`,
      "cg2/memory.stat": "inactive_file 0\n",
    });
    assert.equal(mem.cgroupAvailableMb(paths), -1);
    assert.equal(mem.availableMemMb(paths), 4314);
  });

  test("falls back to cgroup v1 files", async () => {
    const paths = await fixture({
      meminfo: MEMINFO,
      "cg1/memory.limit_in_bytes": `${2048 * MB}\n`,
      "cg1/memory.usage_in_bytes": `${1900 * MB}\n`,
      "cg1/memory.stat": `cache 1000\ntotal_inactive_file ${50 * MB}\n`,
    });
    assert.equal(mem.cgroupAvailableMb(paths), 198);
    assert.equal(mem.availableMemMb(paths), 198);
  });

  test("a v1 sentinel limit is no limit", async () => {
    const paths = await fixture({
      meminfo: MEMINFO,
      "cg1/memory.limit_in_bytes": "9223372036854771712\n",
      "cg1/memory.usage_in_bytes": `${100 * MB}\n`,
    });
    assert.equal(mem.cgroupAvailableMb(paths), -1);
    assert.equal(mem.availableMemMb(paths), 4314);
  });

  test("nothing readable is -1, never a crash", async () => {
    const paths = await fixture({});
    assert.equal(mem.hostAvailableMb(paths), -1);
    assert.equal(mem.cgroupAvailableMb(paths), -1);
    assert.equal(mem.availableMemMb(paths), -1);
  });

  test("the real machine reads as a non-negative number", () => {
    assert.ok(mem.availableMemMb() >= -1);
  });
});
