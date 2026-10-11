import { test, expect } from "bun:test";
import { deriveState, applyDerivedStates, stuckThresholdMs, STUCK_MINUTES_BY_ENGINE } from "../../src/sessions/state";
import type { SessionRow } from "../../src/sessions/types";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "s", machine: "newa", engine: "kimi", model: null, task: null,
  state: "working", lastActivityMs: NOW - 60_000, stuckOn: null, needs: null,
  contextPct: null, weeklyLimitPct: null, source: "test", ...over,
});

test("done and closing pass through untouched", () => {
  expect(deriveState(row({ state: "done" }), NOW)).toBe("done");
  expect(deriveState(row({ state: "closing" }), NOW)).toBe("closing");
});
test("weekly limit >= 95% is limit even while working", () => {
  expect(deriveState(row({ weeklyLimitPct: 95 }), NOW)).toBe("limit");
  expect(deriveState(row({ weeklyLimitPct: 94 }), NOW)).toBe("working");
});
test("N-1: stuckOn text alone never becomes limit; weekly percent drives it", () => {
  expect(deriveState(row({ stuckOn: "API Error: 403 rate_limit" }), NOW)).toBe("working");
  expect(deriveState(row({ stuckOn: "API Error: 403 rate_limit", weeklyLimitPct: 95 }), NOW)).toBe("limit");
  expect(deriveState(row({ stuckOn: "generic ERROR: build failed" }), NOW)).toBe("working");
});
test("needs implies waiting-tim", () => {
  expect(deriveState(row({ state: "idle", needs: "Вопрос S0: куда?" }), NOW)).toBe("waiting-tim");
});
test("starting survives until turns land", () => {
  expect(deriveState(row({ state: "starting" }), NOW)).toBe("starting");
});
test("stuck: working past the engine threshold", () => {
  expect(deriveState(row({ engine: "claude", lastActivityMs: NOW - 21 * 60_000 }), NOW)).toBe("stuck");
  expect(deriveState(row({ engine: "claude", lastActivityMs: NOW - 19 * 60_000 }), NOW)).toBe("working");
  expect(deriveState(row({ engine: "kimi", lastActivityMs: NOW - 31 * 60_000 }), NOW)).toBe("stuck");
  expect(deriveState(row({ engine: "kimi", lastActivityMs: NOW - 29 * 60_000 }), NOW)).toBe("working");
});
test("stuck never applies to idle silence", () => {
  expect(deriveState(row({ state: "idle", lastActivityMs: NOW - 10 * 60 * 60_000 }), NOW)).toBe("idle");
});
test("no activity baseline means not stuck", () => {
  expect(deriveState(row({ lastActivityMs: null }), NOW)).toBe("working");
});
test("override flattens thresholds across engines", () => {
  expect(stuckThresholdMs("claude")).toBe(STUCK_MINUTES_BY_ENGINE.claude * 60_000);
  expect(stuckThresholdMs("claude", 5)).toBe(5 * 60_000);
  expect(deriveState(row({ engine: "kimi", lastActivityMs: NOW - 6 * 60_000 }), NOW, 5)).toBe("stuck");
});
test("limit beats waiting-tim; waiting-tim beats stuck", () => {
  expect(deriveState(row({ weeklyLimitPct: 96, needs: "Вопрос" }), NOW)).toBe("limit");
  expect(deriveState(row({ needs: "БЛОКЕР: нет ключа", lastActivityMs: NOW - 2 * 60 * 60_000 }), NOW)).toBe("waiting-tim");
});
test("applyDerivedStates maps the whole list", () => {
  const out = applyDerivedStates([row({ id: "a" }), row({ id: "b", state: "done" })], NOW);
  expect(out.map(r => r.state)).toEqual(["working", "done"]);
});
