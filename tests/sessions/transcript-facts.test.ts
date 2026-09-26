import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectTranscriptFacts } from "../../src/ps";
import { deriveState } from "../../src/sessions/state";
import type { SessionRow } from "../../src/sessions/types";

const NOW = Date.parse("2026-09-26T10:00:00Z");
const root = () => mkdtempSync(join(tmpdir(), "e3-transcripts-"));

function project(rootDir: string, slug: string, files: { name: string; body: string; ageMinutes: number }[]) {
  const dir = join(rootDir, slug);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const path = join(dir, file.name);
    writeFileSync(path, file.body);
    const at = new Date(NOW - file.ageMinutes * 60_000);
    utimesSync(path, at, at);
  }
}
const CLEAN_TAIL = [
  JSON.stringify({ role: "assistant", content: [{ type: "text", text: "Шаг 3 выполнен." }] }),
  JSON.stringify({ type: "tool_result", content: "ok", interrupted: false }),
].join("\n");

test("K3-1: clean tail still yields lastActivityMs from the freshest file", () => {
  const dir = root();
  project(dir, "-Users-t-apparatus", [
    { name: "a.jsonl", body: CLEAN_TAIL, ageMinutes: 68 },
    { name: "b.jsonl", body: CLEAN_TAIL, ageMinutes: 0 },
  ]);
  const facts = collectTranscriptFacts(dir, NOW);
  const fact = facts.get("-Users-t-apparatus");
  expect(fact).toBeDefined();
  expect(fact!.lastActivityMs).toBe(NOW);
  expect(fact!.stuckOn).toBeNull();
});
test("K3-1: files outside the 24h window do not count", () => {
  const dir = root();
  project(dir, "-Users-t-seo", [{ name: "old.jsonl", body: CLEAN_TAIL, ageMinutes: 25 * 60 }]);
  expect(collectTranscriptFacts(dir, NOW).has("-Users-t-seo")).toBe(false);
});
test("K3-1: stuck is reachable for a quiet window with --stuck-minutes 1", () => {
  const dir = root();
  project(dir, "-Users-t-apparatus", [{ name: "a.jsonl", body: CLEAN_TAIL, ageMinutes: 5 }]);
  const fact = collectTranscriptFacts(dir, NOW).get("-Users-t-apparatus")!;
  const row: SessionRow = {
    id: "mac-win-1", machine: "mac", engine: "claude", model: null, task: null,
    state: "working", lastActivityMs: fact.lastActivityMs, stuckOn: fact.stuckOn,
    needs: null, contextPct: null, weeklyLimitPct: null, source: "terminal-mac",
  };
  expect(deriveState(row, NOW, 1)).toBe("stuck");
  expect(deriveState(row, NOW)).toBe("working"); // claude default threshold is 20 min
});
test("K3-1: an error tail still surfaces stuckOn from the freshest file", () => {
  const dir = root();
  const errorTail = JSON.stringify({ type: "result", error: "API Error: 403" });
  project(dir, "-Users-t-apparatus", [
    { name: "fresh.jsonl", body: CLEAN_TAIL, ageMinutes: 1 },
    { name: "err.jsonl", body: errorTail, ageMinutes: 30 },
  ]);
  const fact = collectTranscriptFacts(dir, NOW).get("-Users-t-apparatus")!;
  expect(fact.lastActivityMs).toBe(NOW - 60_000);
  expect(fact.stuckOn).toBeNull(); // freshest file is quiet — the fact follows it
});
