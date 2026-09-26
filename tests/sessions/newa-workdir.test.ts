import { test, expect } from "bun:test";
import { parseNewaDir, type NewaDirInput } from "../../src/adapters/sessions/newa-workdir";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const base = (over: Partial<NewaDirInput> = {}): NewaDirInput => ({
  name: "zinin-harness-e3",
  metaText: '{"name":"zinin-harness-e3","engine":"kimi","model":"kimi-code/kimi-for-coding"}',
  statusText: '{"state": "running", "completed": 0, "thread_id": null, "sequence": 1}',
  toS0Text: "# Вопросы\n\n1. Что дальше?\n",
  reportText: "# Report\n\nвсё ок\n",
  taskText: "Прочитай README и ответь OK",
  turnMtimesMs: [NOW - 60_000],
  nowMs: NOW,
  ...over,
});

test("running worker with fresh turns becomes working kimi row", () => {
  const row = parseNewaDir(base());
  expect(row).toMatchObject({
    id: "zinin-harness-e3", machine: "newa", engine: "kimi",
    model: "kimi-code/kimi-for-coding", state: "working", source: "newa-workdir",
  });
  expect(row.lastActivityMs).toBe(NOW - 60_000);
  expect(row.task).toBe("Прочитай README и ответь OK");
});
test("question in TO-S0 becomes needs", () => {
  const row = parseNewaDir(base({ toS0Text: "## Ход 3\n\n1. Вопрос S0: куда пушить?\n" }));
  expect(row.needs).toContain("Вопрос S0");
});
test("ГОТОВО line in TO-S0 marks done even when status says running", () => {
  const row = parseNewaDir(base({ toS0Text: "Работа закончена.\n[06:01] E3 ГОТОВ | тестов 84/84\n" }));
  expect(row.state).toBe("done");
});
test("ИТОГ in REPORT also marks done", () => {
  const row = parseNewaDir(base({ reportText: "ИТОГ: патчи готовы\n" }));
  expect(row.state).toBe("done");
});
test("live=false closes the session", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"failed","completed":22,"live":false}' }));
  expect(row.state).toBe("closing");
});
test("stop_requested closes the session", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"running","stop_requested":true}' }));
  expect(row.state).toBe("closing");
});
test("idle status without turns keeps idle and null activity", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"idle"}', turnMtimesMs: [] }));
  expect(row.state).toBe("idle");
  expect(row.lastActivityMs).toBeNull();
});
test("broken json files degrade to idle unknown, never throw", () => {
  const row = parseNewaDir(base({ metaText: "{oops", statusText: "not json" }));
  expect(row.engine).toBeNull();
  expect(row.state).toBe("idle");
});
test("missing task file falls back to TO-S0 heading", () => {
  const row = parseNewaDir(base({ taskText: null, toS0Text: "# S0 → newa\n\nвсё в порядке\n" }));
  expect(row.task).toBe("S0 → newa");
  expect(row.needs).toBeNull();
});
test("long lines are clipped to 120 chars", () => {
  const long = "Вопрос S0: " + "x".repeat(200);
  const row = parseNewaDir(base({ toS0Text: long + "\n" }));
  expect(row.needs!.length).toBeLessThanOrEqual(121);
  expect(row.needs!.endsWith("…")).toBe(true);
});
