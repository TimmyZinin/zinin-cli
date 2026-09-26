import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTerminalWindows, parseWindowTitle, parseStatusLine, detectEngine } from "../../src/adapters/sessions/terminal-mac";

const FIX = join(import.meta.dir, "fixtures");
const windows = () => parseTerminalWindows(readFileSync(join(FIX, "mac-windows.tsv"), "utf8"));

test("busy glyph and opus context come from the title and status line", () => {
  const [row] = windows();
  expect(row.state).toBe("working");
  expect(row.engine).toBe("claude");
  expect(row.model).toBe("opus 5.5");
  expect(row.contextPct).toBe(28);
  expect(row.task).toBe("Nightly audit run");
  expect(row.weeklyLimitPct).toBeNull();
  expect(row.machine).toBe("mac");
  expect(row.source).toBe("terminal-mac");
});
test("weekly limit line feeds weeklyLimitPct without becoming stuckOn", () => {
  const [, row] = windows();
  expect(row.weeklyLimitPct).toBe(94);
  expect(row.stuckOn).toBeNull();
  expect(row.state).toBe("working");
});
test("kimi status line yields model K3 and 14% context", () => {
  const [, , row] = windows();
  expect(row.engine).toBe("kimi");
  expect(row.model).toBe("K3");
  expect(row.contextPct).toBe(14);
  expect(row.task).toBe("Note: run the task file");
});
test("plain zsh idle window stays idle with no engine", () => {
  const [, , , row] = windows();
  expect(row.state).toBe("idle");
  expect(row.engine).toBeNull();
  expect(row.task).toBe("user | idle");
});
test("Interrupted prompt is waiting-tim with the raw line as stuckOn", () => {
  const [, , , , row] = windows();
  expect(row.state).toBe("waiting-tim");
  expect(row.stuckOn).toContain("Interrupted");
  expect(row.engine).toBe("claude");
});
test("title parser strips user prefix, dims and process chain", () => {
  const parsed = parseWindowTitle("user — ◑ Code audit — caffeinate ◂ claude --dangerously-skip-permissions — 80×24");
  expect(parsed.task).toBe("Code audit");
  expect(parsed.glyphState).toBe("working");
});
test("title parser marks | idle titles", () => {
  expect(parseWindowTitle("user — ○ user | idle — -zsh — 80×24").idleTitle).toBe(true);
});
test("status line: clean churn line has no facts", () => {
  const facts = parseStatusLine("✻ Churned for 15m 46s · done 8:06 PM");
  expect(facts).toEqual({ model: null, contextPct: null, weeklyLimitPct: null, stuckOn: null, waiting: false });
});
test("status line: subagent idle line has no facts and is not stuck", () => {
  const facts = parseStatusLine("◯ tm10-klook-readme  Задача: … idle");
  expect(facts.stuckOn).toBeNull();
});
test("status line: 403 marks stuck without weekly limit", () => {
  const facts = parseStatusLine("⎿ Error: 403 from api.anthropic.com");
  expect(facts.stuckOn).toContain("403");
});
test("engine detection order: kimi before claude when both absent", () => {
  expect(detectEngine("kimi-code NVM_INC=... ▸ Python")).toBe("kimi");
  expect(detectEngine("claude --dangerously-skip-permissions")).toBe("claude");
  expect(detectEngine("codex resume")).toBe("codex");
  expect(detectEngine("-zsh")).toBeNull();
});
