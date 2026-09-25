import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal } from "../../src/core/journal";
import { project } from "../../src/tui/projection";
import { layout } from "../../src/tui/layout";

const t0 = "2026-09-25T00:00:00Z";
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-proj-")), "core.sqlite");
  const journal = new CoreJournal(path);
  const j = (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) =>
    journal.submit({ command_id, type, payload: payload as never }, t0);
  j("c1", "agent_registered", { agent_id: "a-orch", role: "orchestrator", engine: "kimi" });
  j("c2", "agent_registered", { agent_id: "a-exec", role: "executor", engine: "codex" });
  j("c3", "session_opened", { session_id: "S01", agent_id: "a-orch", service: "svc", group: "grp", goal: "goal-1" });
  j("c4", "session_opened", { session_id: "S02", agent_id: "a-exec", service: "svc", group: "grp2", goal: "goal-2" });
  j("c5", "task_created", { task_id: "t1", session_id: "S01", goal: "build", criteria: "tests" });
  j("c6", "step_defined", { step_id: "s1", task_id: "t1", owner: "a-exec", required: true });
  j("c7", "task_transitioned", { task_id: "t1", to: "queued" });
  j("c8", "task_transitioned", { task_id: "t1", to: "active" });
  j("c9", "run_started", { run_id: "r1", task_id: "t1", session_id: "S01" });
  j("c10", "step_transitioned", { step_id: "s1", to: "working" });
  return { journal, path };
}
test("tree derives from journal: open sessions only, status and process from runs/steps", () => {
  const { journal } = fixture();
  try {
    const p = project(journal.state, null);
    expect(p.orchestrator).toEqual({ agent: "orchestrator", engine: "kimi" });
    expect(p.sessions.map(s => s.id)).toEqual(["S01", "S02"]);
    const s1 = p.sessions[0];
    expect(s1).toMatchObject({ service: "svc", group: "grp", agent: "orchestrator", engine: "kimi", status: "working", process: "step s1" });
    expect(p.sessions[1].status).toBe("waiting");
    expect(p.sessions[1].process).toBe("idle");
    expect(p.selected).toBe("S01");
    expect(p.scope).toBe("svc/grp/build");
    expect(p.run).toBe("r1 running task=t1 steps=0/1");
    expect(p.todo).toEqual([{ id: "s1", text: "a-exec", status: "working" }]);
  } finally { journal.close(); }
});
test("closed session disappears from the tree; selection follows facts", () => {
  const { journal } = fixture();
  try {
    journal.submit({ command_id: "c11", type: "session_closed", payload: { session_id: "S01" } }, t0);
    journal.submit({ command_id: "c12", type: "run_finished", payload: { run_id: "r1", outcome: "stopped" } }, t0);
    const p = project(journal.state, null);
    expect(p.sessions.map(s => s.id)).toEqual(["S02"]);
    expect(p.selected).toBe("S02");
    expect(p.scope).toBe("svc/grp2");
    const rows = layout(p);
    expect(rows.filter(r => r.id.startsWith("tree-"))[0].text).toContain("S02");
  } finally { journal.close(); }
});
