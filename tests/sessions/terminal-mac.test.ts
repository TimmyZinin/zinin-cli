import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTerminalWindows, parseWindowTitle, parseStatusLine, pickStatusLine,
  detectEngine, detectEngineFromTitle, RECORD_SEP,
} from "../../src/adapters/sessions/terminal-mac";
import type { SessionRow } from "../../src/sessions/types";

const FIX = join(import.meta.dir, "fixtures");
const screens = () => readFileSync(join(FIX, "mac-screens.txt"), "utf8");
const rows = () => parseTerminalWindows(screens());
const byId = (list: SessionRow[], id: string) => list.find(r => r.id === id)!;

test("P0-1/P0-2: real screen records split on RS, one row per window, no screen garbage", () => {
  const list = rows();
  expect(list).toHaveLength(5); // phantom window 876 skipped (empty title)
  expect(list.every(r => /^mac-win-\d+$/.test(r.id))).toBe(true);
});
test("P1-7: ✳ in the title is idle, even with a model on screen", () => {
  const wide = byId(rows(), "mac-win-63");
  expect(wide.state).toBe("idle");
  expect(wide.model).toBe("fable 5.1");
  expect(wide.contextPct).toBe(37);
});
test("P1-5: open-ended model regex catches fable and sonnet 5", () => {
  expect(parseStatusLine("| fable 5.1 37% ▓▓▓░░░░░░░ 369k/1M |").model).toBe("fable 5.1");
  expect(parseStatusLine("| sonnet 5 11% ▓░░░░░░░░░ 111k/1M |").model).toBe("sonnet 5");
  expect(parseStatusLine("Users/t | git:main ✓ | opus 5 28% ▓▓░░").model).toBe("opus 5");
});
test("P1-6: 7d limit from wide windows, honest null in narrow ones", () => {
  expect(byId(rows(), "mac-win-63").weeklyLimitPct).toBe(14);
  expect(byId(rows(), "mac-win-874").weeklyLimitPct).toBeNull();
  expect(byId(rows(), "mac-win-831").weeklyLimitPct).toBe(9);
});
test("P1-7: spinner line on screen means working even when glyph is idle", () => {
  const digest = byId(rows(), "mac-win-874");
  expect(digest.state).toBe("working");
  expect(digest.model).toBe("sonnet 5");
  expect(digest.contextPct).toBe(11);
});
test("P1-8: engine comes from the process chain, never from prompt text", () => {
  const digest = byId(rows(), "mac-win-874");
  expect(digest.engine).toBe("claude");
  expect(digest.task).toBe("Partner comms weekly digest");
  expect(detectEngineFromTitle(
    "timofeyzinin — ◑ X — caffeinate ◂ claude --dangerously-skip-permissions S0: используй Kimi/newa — 80×24",
  )).toBe("claude");
});
test("Interrupted tail makes the row waiting-tim with the line as stuckOn", () => {
  const handback = byId(rows(), "mac-win-818");
  expect(handback.state).toBe("waiting-tim");
  expect(handback.stuckOn).toContain("Interrupted");
  expect(handback.model).toBe("fable 5.1");
});
test("subagent activity keeps a busy-glyph window working", () => {
  expect(byId(rows(), "mac-win-831").state).toBe("working");
});
test("idle zsh window: no engine, idle state, task keeps the window label", () => {
  const shell = byId(rows(), "mac-win-99");
  expect(shell.engine).toBeNull();
  expect(shell.state).toBe("idle");
  expect(shell.model).toBeNull();
});
test("onScreen callback reports picked status line and cwd for enrichment", () => {
  const seen = new Map<string, { statusline: string; cwd: string | null }>();
  parseTerminalWindows(screens(), (id, statusline, cwd) => seen.set(id, { statusline, cwd }));
  expect(seen.get("mac-win-63")!.cwd).toBe("Users/timofeyzinin/zinin-cli");
  expect(seen.get("mac-win-63")!.statusline).toContain("fable 5.1");
  expect(seen.get("mac-win-99")!.statusline).toBe("");
});
test("pickStatusLine finds the status line by shape, not by position", () => {
  const screen = ["⏺ doing", "", "prompt line", "", "Users/t/app | git:main ✓ | fable 5.1 37% ▓▓ | 7d:14%"].join("\n");
  const picked = pickStatusLine(screen);
  expect(picked.statusline).toContain("fable 5.1");
  expect(picked.spinning).toBe(false);
});
test("title parser strips user prefix, dims and process chain", () => {
  const parsed = parseWindowTitle("timofeyzinin — ◑ Audit kernel — caffeinate ◂ claude --dangerously-skip-permissions — 80×24");
  expect(parsed.task).toBe("Audit kernel");
  expect(parsed.glyphState).toBe("working");
});
test("detectEngine order unchanged for plain process text", () => {
  expect(detectEngine("kimi-code")).toBe("kimi");
  expect(detectEngine("claude --x")).toBe("claude");
  expect(detectEngine("-zsh")).toBeNull();
});
