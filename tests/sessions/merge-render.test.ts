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
test("unavailable machine renders an honest line, not a borrowed disk", () => {
  const out = renderTable([], [{ machine: "newa", memFreeMb: null, diskFreeMb: null }], NOW);
  expect(out.split("\n").at(-1)).toBe("newa: недоступна");
});
test("N-9: emoji in TASK do not shift columns", () => {
  const out = renderTable(
    [row({ id: "w1", task: "⚡ zinin-cli | export ZININ_PS_N…", state: "working" }), row({ id: "w2", task: "plain", state: "working" })],
    [], NOW,
  );
  const [header, , r1, r2] = out.split("\n");
  const displayWidth = (value: string) => {
    let width = 0;
    for (const ch of value) {
      const cp = ch.codePointAt(0) ?? 0;
      width += cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF) || cp === 0x2B50 ? 2 : 1;
    }
    return width;
  };
  const colStart = (line: string, needle: string) => displayWidth(line.slice(0, line.indexOf(needle)));
  expect(colStart(r1, "working")).toBe(colStart(r2, "working"));
  expect(colStart(header, "STATE")).toBe(colStart(r1, "working"));
  expect(displayWidth(r1)).toBe(displayWidth(r2));
});
test("K3-3: renderJson carries the code version when given", () => {
  const withVersion = JSON.parse(renderJson([row({ id: "a" })], [], NOW, "git-abc1234"));
  expect(withVersion.version).toBe("git-abc1234");
  const without = JSON.parse(renderJson([row({ id: "a" })], [], NOW));
  expect("version" in without).toBe(false);
});
