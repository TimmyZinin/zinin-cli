import { test, expect } from "bun:test";
import { mergeRows } from "../../src/sessions/merge";
import { renderTable, renderJson } from "../../src/sessions/render";
import type { SessionRow, MachineInfo } from "../../src/sessions/types";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "s", machine: "newa", engine: null, model: null, task: null,
  state: "idle", lastActivityMs: null, stuckOn: null, needs: null,
  contextPct: null, weeklyLimitPct: null, source: "tmux", ...over,
});

test("af- tmux row and workdir row merge into one", () => {
  const merged = mergeRows([
    row({ id: "task-1", source: "tmux", state: "idle", lastActivityMs: NOW }),
    row({ id: "task-1", source: "newa-workdir", engine: "kimi", model: "K3", state: "working", lastActivityMs: NOW - 60_000, task: "Прочитай README" }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ id: "task-1", engine: "kimi", state: "working", task: "Прочитай README" });
  expect(merged[0].source).toBe("newa-workdir+tmux");
});
test("workdir mtime wins over tmux synthetic now", () => {
  const [merged] = mergeRows([
    row({ id: "a", source: "tmux", state: "idle", lastActivityMs: NOW }),
    row({ id: "a", source: "newa-workdir", state: "working", lastActivityMs: NOW - 5 * 60_000 }),
  ]);
  expect(merged.lastActivityMs).toBe(NOW - 5 * 60_000);
});
test("workdir without mtime falls back to tmux liveness", () => {
  const [merged] = mergeRows([
    row({ id: "a", source: "tmux", state: "idle", lastActivityMs: NOW }),
    row({ id: "a", source: "newa-workdir", state: "working", lastActivityMs: null }),
  ]);
  expect(merged.lastActivityMs).toBe(NOW);
});
test("terminal facts fill a tmux shell row", () => {
  const [merged] = mergeRows([
    row({ id: "win", machine: "mac", source: "tmux", state: "idle" }),
    row({ id: "win", machine: "mac", source: "terminal-mac", engine: "claude", model: "opus 5.5", contextPct: 28, state: "working" }),
  ]);
  expect(merged.engine).toBe("claude");
  expect(merged.contextPct).toBe(28);
});
test("starting loses to any real state from another source", () => {
  const [merged] = mergeRows([
    row({ id: "a", source: "newa-workdir", state: "starting", lastActivityMs: NOW - 10_000 }),
    row({ id: "a", source: "tmux", state: "working", lastActivityMs: NOW }),
  ]);
  expect(merged.state).toBe("working");
});
test("all-starting stays starting", () => {
  const [merged] = mergeRows([
    row({ id: "a", source: "newa-workdir", state: "starting" }),
    row({ id: "a", source: "tmux", state: "starting", lastActivityMs: NOW }),
  ]);
  expect(merged.state).toBe("starting");
});
test("table renders headers, separator, row and machine footer", () => {
  const out = renderTable(
    [row({ id: "task-1", engine: "kimi", state: "working", lastActivityMs: NOW - 3 * 60_000, task: "Длинное название задачи, которое обрежется таблицей до тридцати двух", contextPct: 14 })],
    [{ machine: "newa", memFreeMb: 512, diskFreeMb: 9032 }] as MachineInfo[],
    NOW,
  );
  const lines = out.split("\n");
  expect(lines[0]).toContain("ID");
  expect(lines[0]).toContain("STUCK-ON");
  expect(lines[1].trim().startsWith("-")).toBe(true);
  expect(lines[2]).toContain("task-1");
  expect(lines[2]).toContain("3");          // idle minutes
  expect(lines[2].length).toBeLessThanOrEqual(lines[0].length + 2);
  expect(lines.at(-1)).toContain("newa: mem 512M free · disk 9032M free");
});
test("json output carries sessions, machines and timestamp", () => {
  const parsed = JSON.parse(renderJson([row({ id: "a" })], [{ machine: "newa", memFreeMb: 1, diskFreeMb: 2 }], NOW));
  expect(parsed.generatedAt).toBe(new Date(NOW).toISOString());
  expect(parsed.sessions).toHaveLength(1);
  expect(parsed.machines[0].diskFreeMb).toBe(2);
});
