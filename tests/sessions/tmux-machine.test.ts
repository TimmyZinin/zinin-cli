import { test, expect } from "bun:test";
import { parseTmuxSessions } from "../../src/adapters/sessions/tmux";
import { parseMeminfo, parseDf, parseVmStat, parseMemoryPressure } from "../../src/adapters/sessions/machine";

const NOW = Date.parse("2026-09-26T06:00:00Z");

test("af- prefix is stripped from tmux session names", () => {
  const [row] = parseTmuxSessions("af-zinin-harness-e3: 1 windows (created Sat Sep 26 05:53:53 2026)", NOW);
  expect(row.id).toBe("zinin-harness-e3");
  expect(row.machine).toBe("newa");
  expect(row.state).toBe("idle");
});
test("attached session reads as working", () => {
  const [row] = parseTmuxSessions("af-task: 1 windows (created Sat Sep 26 04:00:00 2026) (attached)", NOW);
  expect(row.state).toBe("working");
});
test("freshly created session reads as starting", () => {
  const created = new Date(NOW - 30_000).toString(); // "Sat Sep 26 2026 05:59:30 GMT+0000"
  const [row] = parseTmuxSessions(`af-new: 1 windows (created ${created})`, NOW);
  expect(row.state).toBe("starting");
});
test("non-af sessions keep their name", () => {
  const [row] = parseTmuxSessions("dev: 2 windows (created Fri Sep 25 10:00:00 2026)", NOW);
  expect(row.id).toBe("dev");
});
test("garbage lines are skipped without throwing", () => {
  expect(parseTmuxSessions("no socket\n", NOW)).toEqual([]);
});
test("meminfo MemAvailable becomes free MiB", () => {
  const text = "MemTotal:       2097152 kB\nMemAvailable:    524288 kB\nBuffers:          100 kB\n";
  expect(parseMeminfo(text)).toBe(512);
});
test("df avail column becomes free MiB", () => {
  const text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 20510332 10255166 9245674  53% /\n";
  expect(parseDf(text)).toBe(Math.round(9245674 / 1024));
});
test("unparseable inputs yield null, not exceptions", () => {
  expect(parseMeminfo("nothing")).toBeNull();
  expect(parseDf("")).toBeNull();
});
test("N-6: usable free memory sums free+inactive+purgeable+speculative", () => {
  const text = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                                4000.",
    "Pages active:                            100000.",
    "Pages inactive:                           30000.",
    "Pages speculative:                         5000.",
    "Pages purgeable:                           2000.",
    "Pages wired down:                        200000.",
  ].join("\n");
  expect(parseVmStat(text)).toBe(Math.round((41000 * 16384) / 1024 / 1024));
  expect(parseVmStat("nothing")).toBeNull();
});
test("N-6: memory_pressure percentage parses for the footer", () => {
  const text = [
    "The system has 2147483648 (524288 pages with a page size of 4096).",
    "Stats:",
    "Pages free: 1000.",
    "System-wide memory free percentage: 52%",
  ].join("\n");
  expect(parseMemoryPressure(text)).toBe(52);
  expect(parseMemoryPressure("no stats here")).toBeNull();
});
