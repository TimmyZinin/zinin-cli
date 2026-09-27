import { test, expect } from "bun:test";
import { enrichRowsWithTranscripts, type SlugFacts, type WindowScreen } from "../../src/sessions/enrich";
import type { SessionRow } from "../../src/sessions/types";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const FACT: SlugFacts = { lastActivityMs: NOW - 5 * 60_000, stuckOn: "API Error: 403" };
const slugOf = (cwd: string) => "-" + cwd.split("/").filter(Boolean).join("-");
const row = (id: string, state: SessionRow["state"]): SessionRow => ({
  id, machine: "mac", engine: "claude", model: null, task: null, state,
  lastActivityMs: null, stuckOn: null, needs: null, contextPct: null,
  weeklyLimitPct: null, source: "terminal-mac",
});
const screen = (cwd: string, over: Partial<WindowScreen> = {}): WindowScreen =>
  ({ statusline: "", cwd, spinning: false, busy: false, ...over });

test("N-4: two windows of one project — only the live one is enriched", () => {
  const rows = [row("mac-win-1", "working"), row("mac-win-2", "idle")];
  const screens = new Map<string, WindowScreen>([
    ["mac-win-1", screen("Users/user/proj-c", { spinning: true })],
    ["mac-win-2", screen("Users/user/proj-c")],
  ]);
  const facts = new Map<string, SlugFacts>([[slugOf("Users/user/proj-c"), FACT]]);
  enrichRowsWithTranscripts(rows, screens, facts, slugOf);
  expect(rows[0].lastActivityMs).toBe(FACT.lastActivityMs);
  expect(rows[0].stuckOn).toBe("API Error: 403");
  expect(rows[1].lastActivityMs).toBeNull(); // parked window keeps an honest "—"
  expect(rows[1].stuckOn).toBeNull();
});
test("N-4: an idle glyph window with a spinner on screen still wins over a parked one", () => {
  const rows = [row("mac-win-9", "idle"), row("mac-win-3", "working")];
  const screens = new Map<string, WindowScreen>([
    ["mac-win-9", screen("Users/user/proj-c", { spinning: true })],
    ["mac-win-3", screen("Users/user/proj-c")],
  ]);
  enrichRowsWithTranscripts(rows, screens, new Map([[slugOf("Users/user/proj-c"), FACT]]), slugOf);
  expect(rows[0].lastActivityMs).toBe(FACT.lastActivityMs);
  expect(rows[1].lastActivityMs).toBeNull();
});
test("N-4: tie resolves deterministically to the lowest window id", () => {
  const rows = [row("mac-win-7", "working"), row("mac-win-5", "working")];
  const screens = new Map<string, WindowScreen>([
    ["mac-win-7", screen("Users/user/proj-c")],
    ["mac-win-5", screen("Users/user/proj-c")],
  ]);
  enrichRowsWithTranscripts(rows, screens, new Map([[slugOf("Users/user/proj-c"), FACT]]), slugOf);
  expect(rows[1].lastActivityMs).toBe(FACT.lastActivityMs);
  expect(rows[0].lastActivityMs).toBeNull();
});
test("a single window of a project is enriched as before", () => {
  const rows = [row("mac-win-1", "working")];
  const screens = new Map<string, WindowScreen>([["mac-win-1", screen("Users/user/proj-b")]]);
  enrichRowsWithTranscripts(rows, screens, new Map([[slugOf("Users/user/proj-b"), FACT]]), slugOf);
  expect(rows[0].lastActivityMs).toBe(FACT.lastActivityMs);
});
test("window whose row already has activity is never re-enriched", () => {
  const rows = [{ ...row("mac-win-1", "working"), lastActivityMs: NOW - 60_000 }];
  const screens = new Map<string, WindowScreen>([["mac-win-1", screen("Users/user/proj-b")]]);
  enrichRowsWithTranscripts(rows, screens, new Map([[slugOf("Users/user/proj-b"), FACT]]), slugOf);
  expect(rows[0].lastActivityMs).toBe(NOW - 60_000);
});
test("К4-2: launch-dir key wins over the status-line cwd (cd after launch)", async () => {
  const { windowProjectKey } = await import("../../src/sessions/enrich");
  const slugOf = (cwd: string) => "-" + cwd.replace(/[^A-Za-z0-9-]/g, "-");
  const launchDirs = new Map([["ttys001", "/Users/user/proj-a"]]);
  const key = windowProjectKey({ cwd: "Users/user/proj-b", tty: "ttys001" }, launchDirs, slugOf);
  expect(key).toBe(slugOf("Users/user/proj-a"));
  // fallback: no tty / no launch dir → status-line cwd
  expect(windowProjectKey({ cwd: "Users/user/proj-b", tty: "ttys002" }, launchDirs, slugOf))
    .toBe(slugOf("Users/user/proj-b"));
  expect(windowProjectKey({ cwd: null, tty: null }, launchDirs, slugOf)).toBeNull();
});
test("К4-2: a window keyed by launch dir gets that project's facts", () => {
  const rows = [row("mac-win-1", "working")];
  const screens = new Map<string, WindowScreen>([
    ["mac-win-1", { ...screen("Users/user/proj-b", { spinning: true }), key: slugOf("Users/user/proj-a"), tty: "ttys001" }],
  ]);
  const facts = new Map<string, SlugFacts>([[slugOf("Users/user/proj-a"), FACT]]);
  enrichRowsWithTranscripts(rows, screens, facts, slugOf);
  expect(rows[0].lastActivityMs).toBe(FACT.lastActivityMs);
});
test("К4-3: equal signals resolve by numeric window id, not string order", async () => {
  const { windowIdCompare } = await import("../../src/sessions/enrich");
  expect(windowIdCompare("mac-win-9", "mac-win-10")).toBeLessThan(0);
  expect(windowIdCompare("mac-win-63", "mac-win-1054")).toBeLessThan(0);
  const rows = [row("mac-win-10", "working"), row("mac-win-9", "working")];
  const screens = new Map<string, WindowScreen>([
    ["mac-win-10", screen("Users/user/proj-a")],
    ["mac-win-9", screen("Users/user/proj-a")],
  ]);
  enrichRowsWithTranscripts(rows, screens, new Map([[slugOf("Users/user/proj-a"), FACT]]), slugOf);
  expect(rows[1].lastActivityMs).toBe(FACT.lastActivityMs); // mac-win-9 owns
  expect(rows[0].lastActivityMs).toBeNull();
});
