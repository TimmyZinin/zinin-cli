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
  const row = parseNewaDir(base({ lastSayMs: NOW - 120_000, toS0Text: "## 2026-09-26T05:59:00Z — Ход 3\n\n1. Вопрос S0: куда пушить?\n" }));
  expect(row.needs).toContain("Вопрос S0");
});
test("ГОТОВО in TO-S0 records a submission independently of running activity", () => {
  const row = parseNewaDir(base({ toS0Text: "Работа закончена.\n[06:01] E3 ГОТОВ | тестов 84/84\n" }));
  expect(row.lastSubmission).not.toBeNull();
  expect(row.activity).toBe("working");
  expect(row.state).toBe("working");
});
test("ИТОГ in REPORT also records a submission", () => {
  const row = parseNewaDir(base({ reportText: "ИТОГ: патчи готовы\n" }));
  expect(row.lastSubmission).not.toBeNull();
});
test("E4: live=false stays stopped and idle even with a submission", () => {
  const row = parseNewaDir(base({ statusText: '{"state":"failed","completed":22,"live":false,"exit_code":1}' }));
  expect(row.state).toBe("idle");
  const done = parseNewaDir(base({ statusText: '{"state":"stopped","live":false}', toS0Text: "ИТОГ: готово\n" }));
  expect(done.lastSubmission).not.toBeNull();
  expect(done.state).toBe("idle");
  expect(done.liveness).toBe("stopped");
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
  const row = parseNewaDir(base({ lastSayMs: NOW - 120_000, toS0Text: "2026-09-26T05:59:00Z " + long + "\n" }));
  expect(row.needs!.length).toBeLessThanOrEqual(121);
  expect(row.needs!.endsWith("…")).toBe(true);
});
test("N-7: «готовых порций» deep in a line is not done; whole-word markers are", () => {
  const diet = parseNewaDir(base({ reportText: "…состава готовых порций и ккал по дням…\n" }));
  expect(diet.lastSubmission).toBeNull();
  const timed = parseNewaDir(base({ toS0Text: "[07:20] E3-fix ГОТОВ | тестов 125/125\n" }));
  expect(timed.lastSubmission).not.toBeNull();
  const heading = parseNewaDir(base({ reportText: "ИТОГ: патчи готовы\n" }));
  expect(heading.lastSubmission).not.toBeNull();
});
test("K3-4: «пока не готов, жду Тима» is not done", () => {
  const row = parseNewaDir(base({ toS0Text: "1. Пока не готов, жду Тима.\n" }));
  expect(row.lastSubmission).toBeNull();
});
test("K3-4: ГОТОВО above a signature line still records a submission", () => {
  const row = parseNewaDir(base({ toS0Text: "[08:30] E3-fix2 ГОТОВ | патчей 15\n\n— newa (E3)\n" }));
  expect(row.lastSubmission).not.toBeNull();
  const report = parseNewaDir(base({ reportText: "ГОТОВО | серия собрана\n— newa (E3)\n" }));
  expect(report.lastSubmission).not.toBeNull();
});
test("K3-4: a signature line alone carries no marker", () => {
  const row = parseNewaDir(base({ toS0Text: "всё в порядке\n— newa (E3)\n" }));
  expect(row.lastSubmission).toBeNull();
  expect(row.needs).toBeNull();
});
test("К4-4: marker within the last 3 substantive lines counts (bundle case)", () => {
  const row = parseNewaDir(base({ reportText: "ГОТОВО — bundle готов\nBundle: patches-e3-fix2.tar.gz\nСостав: 5 патчей\n" }));
  expect(row.lastSubmission).not.toBeNull();
});
test("К4-4: heading «## Ход … ГОТОВО» counts via word-anywhere", () => {
  const row = parseNewaDir(base({ toS0Text: "## Ход 21 — E3 круг 4 ГОТОВО\n\nподробности ниже\nещё строка\n" }));
  expect(row.lastSubmission).not.toBeNull();
});
test("К4-4: extended words СДАНО/DONE/FINISHED at line head count", () => {
  expect(parseNewaDir(base({ toS0Text: "СДАНО: отчёт\n" })).lastSubmission).not.toBeNull();
  expect(parseNewaDir(base({ toS0Text: "DONE: all green\n" })).lastSubmission).not.toBeNull();
  expect(parseNewaDir(base({ toS0Text: "FINISHED | tests 150/150\n" })).lastSubmission).not.toBeNull();
});
test("К4-4: «ещё не готово» and «пока не готов» stay working", () => {
  expect(parseNewaDir(base({ toS0Text: "1. Пока не готов, жду Тима.\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ reportText: "ещё не готово к выбору\n" })).lastSubmission).toBeNull();
});
test("К5-2: last-turn heading counts however deep it sits; backtick submission line counts", () => {
  const turn26 = [
    "## Ход 26 (26.09, ~12:40 UTC) — E3 круг 5 ГОТОВ",
    "",
    "`E3 круг 5 ГОТОВ | коммиты a, b | тестов 166/166 | sha256 x`",
    "",
    "Закрыто: К4-1, К4-2, К4-3, К4-4. Патчи: patches-e3-fix4/ (0021–0025,",
    "от eb10a3c = HEAD после круга 4). Проверка: 25 патчей на чистый клон",
    "от e2-core-session-tree → 166/166. Приёмка на Маке: IDLE у окна с cd,",
    "версия newa в --json, повтор владения фактами.",
    "",
    "— newa (E3)",
  ].join("\n");
  expect(parseNewaDir(base({ toS0Text: turn26 })).lastSubmission).not.toBeNull();
});
test("К5-2: deep heading without marker stays idle; heading below the window edge counts", () => {
  const deepNoMarker = ["## Ход 8 — разбираю замечания", "", "строка 1", "строка 2", "строка 3", "строка 4", "", "— newa (E3)"].join("\n");
  expect(parseNewaDir(base({ toS0Text: deepNoMarker })).lastSubmission).toBeNull();
});
test("К5-2: cyrillic tag and ГОТОВА recognized; СДАЧА recognized", () => {
  expect(parseNewaDir(base({ reportText: "[05:59] ИНФОГРАФИКА ГОТОВА | out/…\n" })).lastSubmission).not.toBeNull();
  expect(parseNewaDir(base({ toS0Text: "[09:55] СДАЧА | поручение выполнено\n" })).lastSubmission).not.toBeNull();
});
test("К5-3: negated markers stay idle in headings and plain lines", () => {
  expect(parseNewaDir(base({ toS0Text: "## Ход 6 — пока не готов\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "## Ход 6 — не ГОТОВО, жду Тима\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "## Ход 6 — ещё не готово к выбору\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "## [10:00] Что готово, а что нет\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "не ГОТОВО, жду\n" })).lastSubmission).toBeNull();
});
test("К5-2/К5-3 regressions: previous accept/reject cases unchanged", () => {
  expect(parseNewaDir(base({ toS0Text: "1. Пока не готов, жду Тима.\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ reportText: "…состава готовых порций и ккал по дням…\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ reportText: "ещё не готово к выбору\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "[07:20] E3-fix ГОТОВ | тестов 125/125\n" })).lastSubmission).not.toBeNull();
  expect(parseNewaDir(base({ reportText: "ИТОГ: патчи готовы\n" })).lastSubmission).not.toBeNull();
});
test("К5-5: ГОТОГО is not a marker, ИТОГО is not (summary), ИТОГ stays one", () => {
  expect(parseNewaDir(base({ toS0Text: "ГОТОГО: 5\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "ИТОГО: 5 патчей, 166 тестов\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "ИТОГ: 5 патчей\n" })).lastSubmission).not.toBeNull();
});
test("К6-2: negation after the marker, noun итог in headings, question mark", () => {
  expect(parseNewaDir(base({ toS0Text: "## Ход 4 — итог: пока не готово\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "## Итог обсуждения: выбираем вариант Б\n" })).lastSubmission).toBeNull();
  expect(parseNewaDir(base({ toS0Text: "## Ход 9 — ГОТОВО?\n" })).lastSubmission).toBeNull();
  // анонс с двоеточием и отрицаний нет — по-прежнему свидетельство сдачи
  expect(parseNewaDir(base({ toS0Text: "## ИТОГ: 5 патчей\n" })).lastSubmission).not.toBeNull();
  expect(parseNewaDir(base({ reportText: "ИТОГ: 5 патчей, тесты не запускались\n" })).lastSubmission).not.toBeNull();
});
