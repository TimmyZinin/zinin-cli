import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal } from "../../src/core/journal";
import { HistoryCache } from "../../src/core/history";
import { ScreenApp } from "../../src/tui/app";

const t0 = "2026-09-25T00:00:00Z";
const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-pg-")), "core.sqlite");
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
  journal.close();
  return { path };
}
test("history search finds matches case-insensitively with paging", () => {
  const { path } = fixture();
  const journal = new CoreJournal(path);
  try {
    const cache = new HistoryCache(journal.state, "r1");
    const found = cache.search("RES1");
    expect(found.total).toBe(1);
    expect(found.lines[0].text).toContain("result res1");
    expect(cache.search("zzz").total).toBe(0);
    expect(cache.page(1, 2).offset).toBe(1);
  } finally { journal.close(); }
});
test("snapshot eviction keeps the newest N and recovery still works", () => {
  const { path } = fixture();
  const journal = new CoreJournal(path, 2);
  try {
    for (let i = 0; i < 5; i++) {
      journal.submit({ command_id: `x${i}`, type: "step_defined", payload: { step_id: `x${i}`, task_id: "t1", owner: "a", required: false } }, at(i));
      journal.snapshot(at(i));
    }
    const count = (journal as unknown as { db: { query: (s: string) => { all: () => unknown[] } } }).db.query("SELECT seq FROM journal_snapshots").all();
    expect(count).toHaveLength(2);
  } finally { journal.close(); }
  const reopened = new CoreJournal(path);
  try {
    expect(reopened.state.tasks.t1.status).toBe("active");
    expect(reopened.state).toEqual(CoreJournal.fold(path));
  } finally { reopened.close(); }
});
test("screen: /find filters the transcript; PgDn/PgUp move the history offset", () => {
  const { path } = fixture();
  let out = "";
  const app = new ScreenApp(path, c => { out += c; }, () => {});
  try {
    app.render();
    const mark = out.length;
    for (const ch of "/find result") app.key({ kind: "char", value: ch });
    app.key({ kind: "enter" });
    const frame = out.slice(mark);
    expect(frame).toContain("result res1");
    expect(frame).not.toContain("step s1 pending");
    for (const ch of "/find") app.key({ kind: "char", value: ch });
    app.key({ kind: "enter" });
    app.key({ kind: "pgdown" });
    expect((app as unknown as { historyOffset: number }).historyOffset).toBe(10);
    app.key({ kind: "pgup" });
    expect((app as unknown as { historyOffset: number }).historyOffset).toBe(0);
  } finally { app.close(); }
});
