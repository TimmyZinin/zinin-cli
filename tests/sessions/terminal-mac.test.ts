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
  expect(digest.task).toBe("Weekly digest");
  expect(detectEngineFromTitle(
    "user — ◑ X — caffeinate ◂ claude --dangerously-skip-permissions Note: use Kimi/remote — 80×24",
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
  const record = ["940", "user — ⚡ user | cd ~/zinin-cli && clear && bun src/repl.ts ps --watch 20 — bun src/repl.ts ps --watch 20 — 215×30", "фрейм вывода…", "true"].join("\t");
  const [row] = parseTerminalWindows(record);
  expect(row.state).toBe("working");
  expect(row.engine).toBeNull();
  expect(row.task).toBe("cd ~/zinin-cli && clear && bun src/repl.ts ps --watch 20");
});
test("onScreen callback reports picked status line and cwd for enrichment", () => {
  const seen = new Map<string, { statusline: string; cwd: string | null; spinning: boolean; busy: boolean }>();
  parseTerminalWindows(screens(), (id, screen) => seen.set(id, screen));
  expect(seen.get("mac-win-63")!.cwd).toBe("Users/user/zinin-cli");
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
  const parsed = parseWindowTitle("user — ◑ Code audit — caffeinate ◂ claude --dangerously-skip-permissions — 80×24");
  expect(parsed.task).toBe("Code audit");
  expect(parsed.glyphState).toBe("working");
});
test("detectEngine order unchanged for plain process text", () => {
  expect(detectEngine("kimi-code")).toBe("kimi");
  expect(detectEngine("claude --x")).toBe("claude");
  expect(detectEngine("-zsh")).toBeNull();
});
test("N-2: status line outside a git repo still yields model/CTX/WEEK", () => {
  const screen = ["⏺ Читаю файлы…", "", "/Users/user | fable 5.1 35% ▓▓▓░░░░░░░ 347k/1M | 5h:49% (29m) | 7d:28% (3h19m)"].join("\n");
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
  const title = "user — ◐ Batch-5 — caffeinate ◂ claude --dangerously-skip-permissions --model opus Note: finish the batch — 80×24";
  expect(modelFromTitle(title)).toBe("opus");
  const [row] = parseTerminalWindows(["910", title, "⏺ …\nработают субагенты"].join("\t"));
  expect(row.model).toBe("opus");
  expect(row.engine).toBe("claude");
});
test("К4-2: parseLaunchDirs maps tty to engine launch cwd from mocked ps+lsof", async () => {
  const { parseLaunchDirs } = await import("../../src/adapters/sessions/terminal-mac");
  const ps = [
    "  101 ttys001 /opt/bin/claude --dangerously-skip-permissions",
    "  102 ttys002 -zsh",
    "  103 ttys003 /usr/local/bin/kimi -p hello",
    "  104 ??      /opt/bin/claude --headless",
  ].join("\n");
  const lsof = ["p101", "n/Users/user/proj-a", "p102", "n/Users/user", "p103", "n/Users/user/proj-b"].join("\n");
  const dirs = parseLaunchDirs(ps, lsof);
  expect(dirs.get("ttys001")).toBe("/Users/user/proj-a");
  expect(dirs.get("ttys003")).toBe("/Users/user/proj-b");
  expect(dirs.has("ttys002")).toBe(false); // shell, not an engine
  expect(dirs.has("??")).toBe(false);
});
test("К4-2: tty field from the live format reaches onScreen", () => {
  const record = ["1050", "user — ◑ Weekly digest — caffeinate ◂ claude --dangerously-skip-permissions — 80×24", "⏺ …\n✻ Working… (1m 0s)", "true", "/dev/ttys007"].join("\t");
  const seen = new Map<string, { tty: string | null; busy: boolean }>();
  parseTerminalWindows(record, (id, screen) => seen.set(id, { tty: screen.tty, busy: screen.busy }));
  expect(seen.get("mac-win-1050")).toEqual({ tty: "ttys007", busy: true });
});
test("К5-1: osascript returns tty as /dev/ttysNNN — tty and busy both survive", () => {
  const record = ["1051", "user — ○ scratchpad | idle — sleep 600 — 80×24", "$ sleep 600\n", "true", "/dev/ttys009"].join("\t");
  const seen = new Map<string, { tty: string | null; busy: boolean }>();
  const rows = parseTerminalWindows(record, (id, screen) => seen.set(id, { tty: screen.tty, busy: screen.busy }));
  expect(seen.get("mac-win-1051")).toEqual({ tty: "ttys009", busy: true });
  expect(rows[0].state).toBe("working"); // busy shell stays working (P2-13)
});
test("К5-1: launch-dir keying works with the /dev/ tty form", async () => {
  const { windowProjectKey } = await import("../../src/sessions/enrich");
  const slugOf = (cwd: string) => "-" + cwd.replace(/[^A-Za-z0-9-]/g, "-");
  const launchDirs = new Map([["ttys009", "/Users/user/proj-a"]]);
  expect(windowProjectKey({ cwd: "Users/user/proj-b", tty: "ttys009" }, launchDirs, slugOf))
    .toBe(slugOf("Users/user/proj-a"));
});
test("К5-4: engine processes wrapped in an interpreter are found", async () => {
  const { parseLaunchDirs } = await import("../../src/adapters/sessions/terminal-mac");
  const ps = [
    "  201 ttys011 node /opt/dist/codex.js --foo",
    "  202 ttys012 python3 /opt/bin/kimi_cli.py chat",
    "  203 ttys013 /usr/local/bin/claude --dangerously-skip-permissions",
    "  204 ttys014 -zsh",
  ].join("\n");
  const lsof = ["p201", "n/Users/user/proj-c", "p202", "n/Users/user/proj-d", "p203", "n/Users/user/proj-a"].join("\n");
  const dirs = parseLaunchDirs(ps, lsof);
  expect(dirs.get("ttys011")).toBe("/Users/user/proj-c");
  expect(dirs.get("ttys012")).toBe("/Users/user/proj-d");
  expect(dirs.get("ttys013")).toBe("/Users/user/proj-a");
  expect(dirs.has("ttys014")).toBe(false);
});
