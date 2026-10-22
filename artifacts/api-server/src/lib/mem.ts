import fs from "node:fs";

/**
 * Where the kernel reports memory. Overridable for tests only.
 */
export interface MemPaths {
  meminfo: string;
  /** cgroup v2: the unified hierarchy root this process is in. */
  cgroupV2: string;
  /** cgroup v1: the memory controller's directory. */
  cgroupV1: string;
}

export const DEFAULT_MEM_PATHS: MemPaths = {
  meminfo: "/proc/meminfo",
  cgroupV2: "/sys/fs/cgroup",
  cgroupV1: "/sys/fs/cgroup/memory",
};

function readNumber(file: string, pattern?: RegExp): number {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (!pattern) {
      const trimmed = text.trim();
      if (trimmed === "max") return Number.POSITIVE_INFINITY;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : -1;
    }
    const match = pattern.exec(text);
    return match ? Number(match[1]) : -1;
  } catch {
    return -1;
  }
}

/** /proc/meminfo's MemAvailable in MB, or -1. This is the HOST's view. */
export function hostAvailableMb(paths: MemPaths = DEFAULT_MEM_PATHS): number {
  const kb = readNumber(paths.meminfo, /MemAvailable:\s+(\d+) kB/);
  return kb >= 0 ? Math.round(kb / 1024) : -1;
}

/**
 * What the process's cgroup still allows, in MB: limit - usage + the
 * inactive file cache the kernel would reclaim first. -1 when there is no
 * cgroup limit to speak of (no controller, or a limit of "max").
 *
 * This is the number that matters in a container. A Replit deployment runs
 * in a 2 GB cgroup on a much larger host, and /proc/meminfo describes the
 * host: it kept reporting gigabytes available while the OOM killer took the
 * VM on 2026-10-21 (twice), so a floor read from meminfo alone never fires.
 */
export function cgroupAvailableMb(paths: MemPaths = DEFAULT_MEM_PATHS): number {
  // v2 first: memory.max / memory.current / memory.stat "inactive_file N".
  let limit = readNumber(`${paths.cgroupV2}/memory.max`);
  let usage = readNumber(`${paths.cgroupV2}/memory.current`);
  let reclaimable = readNumber(`${paths.cgroupV2}/memory.stat`, /^inactive_file (\d+)$/m);
  if (!(limit > 0 && usage >= 0)) {
    // v1: memory.limit_in_bytes / memory.usage_in_bytes / "total_inactive_file N".
    limit = readNumber(`${paths.cgroupV1}/memory.limit_in_bytes`);
    usage = readNumber(`${paths.cgroupV1}/memory.usage_in_bytes`);
    reclaimable = readNumber(`${paths.cgroupV1}/memory.stat`, /^total_inactive_file (\d+)$/m);
    // v1 prints a huge sentinel (PAGE_COUNTER_MAX) when unlimited.
    if (limit >= 2 ** 60) limit = Number.POSITIVE_INFINITY;
  }
  if (!(limit > 0 && usage >= 0) || !Number.isFinite(limit)) return -1;
  const free = limit - usage + Math.max(0, reclaimable);
  return Math.max(0, Math.round(free / (1024 * 1024)));
}

/**
 * The memory this process can still grow into, in MB: the smaller of what the
 * host has available (/proc/meminfo MemAvailable, which counts reclaimable
 * cache the way os.freemem() does not) and what its cgroup still allows. -1
 * when neither can be read (not Linux, /proc unreadable).
 */
export function availableMemMb(paths: MemPaths = DEFAULT_MEM_PATHS): number {
  const host = hostAvailableMb(paths);
  const group = cgroupAvailableMb(paths);
  if (host < 0) return group;
  if (group < 0) return host;
  return Math.min(host, group);
}
