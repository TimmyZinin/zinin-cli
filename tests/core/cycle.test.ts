import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal } from "../../src/core/journal";
import { LocalExecutor } from "../../src/core/executor";
import { ScreenApp } from "../../src/tui/app";

const t0 = "2026-09-25T00:00:00Z";
const later = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "zinin-e2-cycle-"));
  const journalPath = join(dir, "core.sqlite");
  const leasesPath = join(dir, "leases.sqlite");
  const journal = new CoreJournal(journalPath);
  const j = (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) =>
    journal.submit({ command_id, type, payload: payload as never }, t0);
  j("c1", "agent_registered", { agent_id: "a-orch", role: "orchestrator", engine: "kimi" });
  j("c2", "session_opened", { session_id: "S01", agent_id: "a-orch", service: "svc", group: "grp", goal: "demo" });
  journal.close();
  return { dir, journalPath, leasesPath };
}
test("first working cycle: human task -> executor -> verified result -> human accept -> durable save", async () => {
  const { journalPath, leasesPath } = workspace();
  // Human files a task from the screen.
  let out = "";
  const app = new ScreenApp(journalPath, c => { out += c; }, () => {});
  for (const ch of "/task ship the report") app.key({ kind: "char", value: ch });
  app.key({ kind: "enter" });
  app.close();
  // Executor advances the task end to end.
  const executor = new LocalExecutor(journalPath, leasesPath);
  const summary = await executor.runOnce(later(1_000));
  executor.close();
  expect(summary).not.toBeNull();
  expect(summary!.task_id.startsWith("t-1-")).toBe(true);
  expect(summary!.run_id.startsWith(`run-${summary!.task_id}-`)).toBe(true);
  expect(summary!.result_id).toBe(`res-${summary!.task_id}`);
  // Human accepts from the screen; snapshot checkpoint is taken.
  const acceptor = new ScreenApp(journalPath, () => {}, () => {});
  acceptor.key({ kind: "char", value: "/" });
  for (const ch of "accept") acceptor.key({ kind: "char", value: ch });
  acceptor.key({ kind: "enter" });
  acceptor.close();
  // Reopen: the accepted result and done task must survive recovery.
  const reopened = new CoreJournal(journalPath);
  try {
    const task = Object.values(reopened.state.tasks)[0];
    expect(task.status).toBe("done");
    expect(task.version).toBe(1);
    const result = Object.values(reopened.state.results)[0];
    expect(result.status).toBe("accepted");
    expect(result.evidence_ref).toContain("verify:local-sha256:");
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    const run = Object.values(reopened.state.runs)[0];
    expect(run.status).toBe("succeeded");
  } finally { reopened.close(); }
});
test("rerunning the executor is safe: nothing duplicates, nothing rewinds", async () => {
  const { journalPath, leasesPath } = workspace();
  const app = new ScreenApp(journalPath, () => {}, () => {});
  for (const ch of "/task rerun check") app.key({ kind: "char", value: ch });
  app.key({ kind: "enter" });
  app.close();
  const first = new LocalExecutor(journalPath, leasesPath);
  await first.runOnce(t0);
  first.close();
  const before = CoreJournal.fold(journalPath);
  const second = new LocalExecutor(journalPath, leasesPath);
  expect(await second.runOnce(later(500))).toBeNull();
  second.close();
  expect(CoreJournal.fold(journalPath)).toEqual(before);
  const reopened = new CoreJournal(journalPath);
  try {
    expect(reopened.state.tasks[Object.keys(reopened.state.tasks)[0]].status).toBe("review_ready");
  } finally { reopened.close(); }
});
