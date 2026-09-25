import { test, expect } from "bun:test";
import { KimiEngine, EngineError, type EngineTransport } from "../../src/core/engines";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal } from "../../src/core/journal";
import { LocalExecutor } from "../../src/core/executor";

const canned: EngineTransport = async () => ({
  lines: [
    JSON.stringify({ role: "meta", type: "system.version", version: "2.0.2" }),
    JSON.stringify({ role: "assistant", content: "итог шага" }),
    JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: "sess-1", command: "kimi -r sess-1" }),
  ],
  code: 0, stderr: "",
});
test("engine: parses stream-json, joins assistant text, captures provider session", async () => {
  const engine = new KimiEngine(canned);
  const result = await engine.run("prompt", { timeoutMs: 1000 });
  expect(result.text).toBe("итог шага");
  expect(result.provider_session).toBe("sess-1");
});
test("engine: no answer is malformed on success exit, failed on non-zero exit", async () => {
  const empty: EngineTransport = async () => ({ lines: [JSON.stringify({ role: "meta", type: "system.version" })], code: 0, stderr: "" });
  await expect(new KimiEngine(empty).run("x", { timeoutMs: 1000 })).rejects.toMatchObject({ code: "malformed" });
  const boom: EngineTransport = async () => ({ lines: [], code: 2, stderr: "auth broke" });
  await expect(new KimiEngine(boom).run("x", { timeoutMs: 1000 })).rejects.toMatchObject({ code: "failed" });
  const bad: EngineTransport = async () => ({ lines: ["not json"], code: 0, stderr: "" });
  await expect(new KimiEngine(bad).run("x", { timeoutMs: 1000 })).rejects.toMatchObject({ code: "malformed" });
});
const t0 = "2026-09-25T00:00:00Z";
test("executor with an engine records provider output and session in the evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zinin-e2-eng-"));
  const journalPath = join(dir, "core.sqlite");
  const journal = new CoreJournal(journalPath);
  const j = (command_id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: unknown) =>
    journal.submit({ command_id, type, payload: payload as never }, t0);
  j("c1", "agent_registered", { agent_id: "a", role: "orchestrator", engine: "kimi" });
  j("c2", "session_opened", { session_id: "S01", agent_id: "a", service: "s", group: "g", goal: "demo" });
  j("c3", "task_created", { task_id: "t1", session_id: "S01", goal: "g", criteria: "c" });
  journal.close();
  const executor = new LocalExecutor(journalPath, join(dir, "leases.sqlite"), new KimiEngine(canned));
  const summary = await executor.runOnce(t0);
  executor.close();
  expect(summary?.result_id).toBe("res-t1");
  expect(summary?.provider_session).toBe("sess-1");
  const check = new CoreJournal(journalPath);
  try {
    const result = check.state.results["res-t1"];
    expect(result.evidence_ref).toContain("verify:local-sha256:");
    expect(result.evidence_ref).toContain("engine-session:sess-1");
    expect(check.state.runs[summary!.run_id].provider_session).toBe("kimi-cli");
    expect(check.state.tasks.t1.status).toBe("review_ready");
  } finally { check.close(); }
});
