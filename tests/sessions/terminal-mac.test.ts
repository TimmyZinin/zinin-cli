import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTerminalWindows, parseWindowTitle, parseStatusLine, pickStatusLine,
  detectEngine, detectEngineFromTitle, modelFromTitle, RECORD_SEP,
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
test("idle zsh window: no engine, idle state, user prefix stripped from task", () => {
  const shell = byId(rows(), "mac-win-99");
  expect(shell.engine).toBeNull();
  expect(shell.state).toBe("idle");
  expect(shell.task).toBe("idle");
  expect(shell.model).toBeNull();
});
test("P2-13: a busy shell window is working and shows the command, not the user", () => {
  const record = ["940", "timofeyzinin — ⚡ timofeyzinin | cd ~/zinin-cli && clear && bun src/repl.ts ps --watch 20 — bun src/repl.ts ps --watch 20 — 215×30", "фрейм вывода…", "true"].join("\t");
  const [row] = parseTerminalWindows(record);
  expect(row.state).toBe("working");
  expect(row.engine).toBeNull();
  expect(row.task).toBe("cd ~/zinin-cli && clear && bun src/repl.ts ps --watch 20");
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
test("N-2: status line outside a git repo still yields model/CTX/WEEK", () => {
  const screen = ["⏺ Читаю файлы…", "", "/Users/timofeyzinin | fable 5.1 35% ▓▓▓░░░░░░░ 347k/1M | 5h:49% (29m) | 7d:28% (3h19m)"].join("\n");
  const picked = pickStatusLine(screen);
  expect(picked.statusline).toContain("fable 5.1");
  const facts = parseStatusLine(picked.statusline);
  expect(facts.model).toBe("fable 5.1");
  expect(facts.contextPct).toBe(35);
  expect(facts.weeklyLimitPct).toBe(28);
});
test("N-2: narrow clipped bar without cwd or git still parses", () => {
  const picked = pickStatusLine("⏺ …\n  | sonnet 5 11% ▓░░░░░░░░░ 111k/1M |…");
  expect(picked.statusline).toContain("sonnet 5");
});
test("N-8: --model in the process chain fills a hidden status line", () => {
  const title = "timofeyzinin — ◐ Дейтинг-5 — caffeinate ◂ claude --dangerously-skip-permissions --model opus S0: доведи до готового — 80×24";
  expect(modelFromTitle(title)).toBe("opus");
  const [row] = parseTerminalWindows(["910", title, "⏺ …\nработают субагенты"].join("\t"));
  expect(row.model).toBe("opus");
  expect(row.engine).toBe("claude");
});
