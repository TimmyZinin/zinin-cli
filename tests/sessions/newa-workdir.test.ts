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
test("P1-10: live=false means the worker is gone — idle unless a done marker says otherwise", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"failed","completed":22,"live":false,"exit_code":1}' }));
  expect(row.state).toBe("idle");
  const done = parseNewaDir(base({ statusText: '{"state":"stopped","live":false}', toS0Text: "ИТОГ: готово\n" }));
  expect(done.state).toBe("done");
});
test("P1-10: long-stopped worker is not closing", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"stopped","exit_code":0}' }));
  expect(row.state).toBe("idle");
});
test("closing is reserved for a requested stop on a live worker", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"running","stop_requested":true}' }));
  expect(row.state).toBe("closing");
  const gone = parseNewaDir(base({ statusText: '{"state":"running","stop_requested":true,"live":false}' }));
  expect(gone.state).toBe("idle");
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
test("without TASK file the task column stays empty instead of borrowing a TO-S0 heading", () => {
  const row = parseNewaDir(base({ taskText: null, toS0Text: "# S0 → newa\n\nвсё в порядке\n" }));
  expect(row.task).toBeNull();
  expect(row.needs).toBeNull();
});
test("long lines are clipped to 120 chars", () => {
  const long = "Вопрос S0: " + "x".repeat(200);
  const row = parseNewaDir(base({ toS0Text: long + "\n" }));
  expect(row.needs!.length).toBeLessThanOrEqual(121);
  expect(row.needs!.endsWith("…")).toBe(true);
});
test("N-7: «готовых порций» deep in a line is not done; whole-word markers are", () => {
  const diet = parseNewaDir(base({ reportText: "…состава готовых порций и ккал по дням…\n" }));
  expect(diet.state).toBe("working");
  const timed = parseNewaDir(base({ toS0Text: "[07:20] E3-fix ГОТОВ | тестов 125/125\n" }));
  expect(timed.state).toBe("done");
  const heading = parseNewaDir(base({ reportText: "ИТОГ: патчи готовы\n" }));
  expect(heading.state).toBe("done");
});
test("K3-4: «пока не готов, жду Тима» is not done", () => {
  const row = parseNewaDir(base({ toS0Text: "1. Пока не готов, жду Тима.\n" }));
  expect(row.state).toBe("working");
});
test("K3-4: ГОТОВО above a signature line still marks done", () => {
  const row = parseNewaDir(base({ toS0Text: "[08:30] E3-fix2 ГОТОВ | патчей 15\n\n— newa (E3)\n" }));
  expect(row.state).toBe("done");
  const report = parseNewaDir(base({ reportText: "ГОТОВО | серия собрана\n— newa (E3)\n" }));
  expect(report.state).toBe("done");
});
test("K3-4: a signature line alone carries no marker", () => {
  const row = parseNewaDir(base({ toS0Text: "всё в порядке\n— newa (E3)\n" }));
  expect(row.state).toBe("working");
  expect(row.needs).toBeNull();
});
