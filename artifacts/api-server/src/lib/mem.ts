import fs from "node:fs";

/**
 * The machine's available memory in MB: /proc/meminfo's MemAvailable, which
 * counts the reclaimable cache the OOM killer would free first. os.freemem()
 * does not, and reads low on a box that is merely caching files. -1 when it
 * cannot be read (not Linux, /proc unreadable).
 */
export function availableMemMb(): number {
  try {
    const match = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (match) return Math.round(Number(match[1]) / 1024);
  } catch {
    // Fall through.
  }
  return -1;
}
