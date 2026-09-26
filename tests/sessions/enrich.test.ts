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
