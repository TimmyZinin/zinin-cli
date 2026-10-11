import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal } from "../../src/core/journal";
import { HistoryCache, projectHistory, historyPolicy } from "../../src/core/history";

const t0 = "2026-09-25T00:00:00Z";
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-hist-")), "core.sqlite");
  const journal = new CoreJournal(path);
  const j = (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) =>
    journal.submit({ command_id, type, payload: payload as never }, t0);
  j("c1", "agent_registered", { agent_id: "a", role: "orchestrator", engine: "kimi" });
  j("c2", "session_opened", { session_id: "S01", agent_id: "a", service: "s", group: "g", goal: "demo" });
  j("c3", "task_created", { task_id: "t1", session_id: "S01", goal: "g", criteria: "c" });
  j("c4", "step_defined", { step_id: "s1", task_id: "t1", owner: "a", required: true });
  j("c5", "task_transitioned", { task_id: "t1", to: "queued" });
  j("c6", "task_transitioned", { task_id: "t1", to: "active" });
  j("c7", "run_started", { run_id: "r1", task_id: "t1", session_id: "S01" });
  j("c8", "result_recorded", { result_id: "res1", task_id: "t1", revision: 1, digest: "d", evidence_ref: "e" });
  return { path, journal };
}
test("history projects the run from the journal with clipped lines", () => {
  const { journal } = fixture();
  try {
    const lines = projectHistory(journal.state, "r1");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0].text).toContain("task t1 created");
    expect(lines.some(l => l.text.includes("step s1"))).toBe(true);
    expect(lines.at(-1)!.text).toContain("result res1");
    expect(projectHistory(journal.state, "missing")).toEqual([]);
  } finally { journal.close(); }
});
test("cache window is bounded by lines and bytes; older pages still readable", () => {
  const steps = Object.fromEntries(new Array(5000).fill(0).map((_, i) => {
    const id = `pad-${String(i).padStart(4, "0")}`;
    return [id, { step_id: id, task_id: "t1", owner: "a", required: false, status: "done" as const }];
  }));
  const huge = "x".repeat(historyPolicy.maxBytesPerRun);
  steps["pad-huge"] = { step_id: "pad-huge", task_id: "t1", owner: "a", required: false, status: "done" };
  const state = {
    seq: 1,
    agents: {}, sessions: {},
    tasks: { t1: { task_id: "t1", session_id: "S01", goal: "g", criteria: "c", status: "active" as const, version: 1 } },
    steps,
    runs: { r1: { run_id: "r1", task_id: "t1", session_id: "S01", provider_session: null, status: "running" as const } },
    results: { big1: { result_id: "big1", task_id: "t1", revision: 2, digest: "d", evidence_ref: huge, status: "recorded" as const } },
  };
  const cache = new HistoryCache(state as never, "r1");
  expect(cache.size).toBeLessThanOrEqual(historyPolicy.maxLinesPerRun);
  expect(cache.page(0, 5).lines[0].text).toContain("task t1 created");
  expect(cache.page(0, 5).total).toBeGreaterThan(cache.size); // full history stays reachable
});
test("journal-backed cache rebuilds its window after reopen (no history loss)", () => {
  const { path, journal } = fixture();
  try {
    for (let i = 0; i < 40; i++) {
      journal.submit({ command_id: `f${i}`, type: "step_defined", payload: { step_id: `pad-${i}`, task_id: "t1", owner: "a", required: false } }, t0);
    }
    const cache = new HistoryCache(journal.state, "r1");
    expect(cache.size).toBeGreaterThan(40);
    expect(cache.page(0, 3).total).toBe(cache.size);
  } finally { journal.close(); }
  const reopened = new CoreJournal(path);
  try {
    const cache = new HistoryCache(reopened.state, "r1");
    expect(cache.size).toBeGreaterThan(40);
    expect(cache.tail(10).at(-1)!.text).toContain("result res1");
  } finally { reopened.close(); }
});
test("lines longer than the policy are clipped at projection", () => {
  const { journal } = fixture();
  try {
    journal.submit({ command_id: "big", type: "result_recorded", payload: { result_id: "big1", task_id: "t1", revision: 9, digest: "d", evidence_ref: "e".repeat(20_000) } }, t0);
    const lines = projectHistory(journal.state, "r1");
    const long = lines.find(l => l.text.includes("big1"))!;
    expect(long.text.length).toBeLessThanOrEqual(historyPolicy.maxCharsPerLine);
  } finally { journal.close(); }
});
