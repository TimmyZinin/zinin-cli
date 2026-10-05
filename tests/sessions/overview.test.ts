import { test, expect } from "bun:test";
import { renderOverview } from "../../src/sessions/overview";
import { parseNewaDir } from "../../src/adapters/sessions/newa-workdir";
import { addStatusEstimates } from "../../src/sessions/estimates";
const NOW = Date.parse("2026-10-05T12:00:00Z");
const row = (state = "running", toS0Text: string | null = null, reportText: string | null = null, taskText: string | null = "Проверяет импорт") => {
  const statusText = JSON.stringify({ state, reason: "лимит времени хода" });
  return addStatusEstimates(parseNewaDir({ name: "sample", metaText: null, statusText, toS0Text, reportText, taskText, activityMs: NOW - 60_000, nowMs: NOW }), statusText, NOW, NOW, NOW);
};
test("four blocks show useful estimates while retaining exact uncertainty and a prior submission", () => {
  const working = row("running", "Вопрос: формат?", "СДАНО: отчёт");
  const waiting = { ...row("idle", "Вопрос: выбрать CSV?"), id: "choice" };
  const stopped = { ...row("timeout"), id: "stopped" };
  const out = renderOverview([working, waiting, stopped], [], NOW);
  for (const title of ["Работают сейчас", "Ждут решения владельца", "Сданы", "Не отвечают/неизвестно"]) expect(out).toContain(title);
  expect(out).toContain("newa  sample  Проверяет импорт");
  expect(out).toContain("newa  choice  Вопрос: выбрать CSV?");
  expect(out).toContain("newa  sample  СДАНО: отчёт");
  expect(out).toContain("ход остановлен: лимит времени хода");
  expect(out).toContain("оценка по времени файла");
  expect(out).toContain("без движения 1 мин");
  expect(out).toContain("вопрос: Вопрос: формат?");
  expect(working.decision?.freshness).toBe("unknown");
});
test("idle/missing description, stale running and unavailable source remain readable", () => {
  const idle = row("idle", null, null, null);
  const old = addStatusEstimates(row(), '{"state":"running"}', NOW - 21 * 60_000, null, NOW);
  const out = renderOverview([idle, old], [{ machine: "mac", memFreeMb: null, diskFreeMb: null, available: false }], NOW);
  expect(out).toContain("задача не указана"); expect(out).toContain("простаивает");
  expect(out).toContain("возможно зависла"); expect(out).toContain("Мак: источник недоступен");
});
test("task description uses meaningful TASK content then latest report СТАТУС", () => {
  expect(row("idle", null, "СТАТУС: Проверяет таблицу", "# Задание\n\nИсправляет импорт").task).toBe("Исправляет импорт");
  expect(row("idle", null, "СТАТУС: Предыдущая работа\n2026-10-05T11:59:00Z СТАТУС: Проверяет таблицу", null).task).toBe("Проверяет таблицу");
});
test("control sequences cannot escape into readable output and long descriptions are clipped", () => {
  const r = row(); r.task = "\x1b[31m" + "x".repeat(200); r.id = "a\n\x1b[2Jb";
  const out = renderOverview([r], [], NOW);
  expect(out).not.toContain("\x1b"); expect(out).not.toContain("x".repeat(73)); expect(out).toContain("…");
});
test("description fallbacks preserve priority, dated heading cleanup and source", () => {
  const parse = (reportText: string | null, readmeText: string | null = null, toS0Text: string | null = null) => parseNewaDir({name: "example", nowMs: NOW, statusText: null, metaText: null, taskText: null, reportText, readmeText, toS0Text});
  expect(parse("## 2026-10-05 — Исправление импорта\nПроверки прошли").task).toBe("Исправление импорта");
  expect(parse("## Заголовок\nСТАТУС: Проверяет экспорт").taskSource).toBe("REPORT-S0.md:status");
  expect(parse("## Заголовок\nХвост").taskSource).toBe("REPORT-S0.md:heading");
  expect(parse("Первая строка\nПоследняя работа").task).toBe("Последняя работа");
  expect(parse(null, "# Исполнитель newa\nТы выполняешь только поручение S0 в текущей рабочей папке.", "Проверяет архив").taskSource).toBe("TO-S0.md");
  expect(parse(null, "# Проект\nПроверяет архив").taskSource).toBe("README.md");
  expect(parse(null)).toMatchObject({task:null, taskSource:null});
});
