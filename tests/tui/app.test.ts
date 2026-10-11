import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyParser } from "../../src/tui/input";
import { ScreenApp } from "../../src/tui/app";
import { CoreJournal } from "../../src/core/journal";

const t0 = "2026-09-25T00:00:00Z";
test("input: chunks split mid-escape are framed; control keys map", () => {
  const parser = new KeyParser();
  expect(parser.push("\x1b[")).toEqual([]);
  expect(parser.push("A")).toEqual([{ kind: "up" }]);
  const p2 = new KeyParser();
  expect(p2.push("a\x7f\r\x03\x04")).toEqual([
    { kind: "char", value: "a" }, { kind: "backspace" }, { kind: "enter" }, { kind: "ctrl+c" }, { kind: "ctrl+d" },
  ]);
});
function screenFixture(setup?: (submit: (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) => void) => void) {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-app-")), "core.sqlite");
  const journal = new CoreJournal(path);
  const j = (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) =>
    journal.submit({ command_id, type, payload: payload as never }, t0);
  j("c1", "agent_registered", { agent_id: "a-orch", role: "orchestrator", engine: "kimi" });
  j("c2", "session_opened", { session_id: "S01", agent_id: "a-orch", service: "svc", group: "g1", goal: "one" });
  j("c3", "session_opened", { session_id: "S02", agent_id: "a-orch", service: "svc", group: "g2", goal: "two" });
  setup?.(j);
  journal.close();
  let out = "";
  const app = new ScreenApp(path, c => { out += c; }, () => { app.close(); throw new ExitSignal(); });
  class ExitSignal extends Error {}
  return { path, app, out: () => out };
}
test("app: arrow keys move selection; drafts are remembered per session", () => {
  const { app } = screenFixture();
  try {
    app.render();
    app.key({ kind: "down" });
    expect(app.selected).toBe("S02");
    for (const ch of "hi") app.key({ kind: "char", value: ch });
    app.key({ kind: "up" });
    expect(app.drafts.get("S01") ?? "").toBe("");
    app.key({ kind: "down" });
    expect(app.drafts.get("S02")).toBe("hi");
  } finally { app.close(); }
});
test("app: /task creates a task in the selected session via the journal", () => {
  const { path, app } = screenFixture();
  try {
    for (const ch of "/task write docs") app.key({ kind: "char", value: ch });
    app.key({ kind: "enter" });
    const check = new CoreJournal(path);
    try {
      const tasks = Object.values(check.state.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ session_id: "S01", goal: "write docs", status: "draft" });
    } finally { check.close(); }
  } finally { app.close(); }
});
test("app: /accept decides the recorded result, checkpoints, and finishes the task (R06)", () => {
  const { path, app } = screenFixture((j) => {
    j("c4", "task_created", { task_id: "t1", session_id: "S01", goal: "g", criteria: "c" });
    j("c5", "task_transitioned", { task_id: "t1", to: "queued" });
    j("c6", "task_transitioned", { task_id: "t1", to: "active" });
    j("c7", "result_recorded", { result_id: "res1", task_id: "t1", revision: 1, digest: "d", evidence_ref: "e" });
    j("c8", "task_transitioned", { task_id: "t1", to: "review_ready" });
  });
  try {
    app.key({ kind: "char", value: "/" }); // keep selection on S01
    for (const ch of "accept") app.key({ kind: "char", value: ch });
    app.key({ kind: "enter" });
    const check = new CoreJournal(path);
    try {
      expect(check.state.tasks.t1.status).toBe("done");
      expect(check.state.tasks.t1.version).toBe(1);
      expect(check.state.results.res1.status).toBe("accepted");
    } finally { check.close(); }
  } finally { app.close(); }
});
test("app: unchanged frame writes almost nothing; input echoes into composer row", () => {
  const { app, out } = screenFixture();
  try {
    app.render();
    const baseline = out().length;
    app.render();
    expect(out().length - baseline).toBeLessThan(10);
    for (const ch of "ab") app.key({ kind: "char", value: ch });
    expect(out()).toContain("ab");
  } finally { app.close(); }
});
