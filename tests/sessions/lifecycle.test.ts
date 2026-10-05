import { expect, test } from "bun:test";
import { parseNewaDir, type NewaDirInput } from "../../src/adapters/sessions/newa-workdir";
import { applyDerivedStates } from "../../src/sessions/state";
import { mergeRows } from "../../src/sessions/merge";
import { renderJson } from "../../src/sessions/render";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const fixture = (over: Partial<NewaDirInput> = {}): NewaDirInput => ({
  name: "worker-sample", metaText: '{"engine":"codex"}',
  statusText: '{"state":"running","live":true}',
  taskText: "Проверяет импорт таблиц", toS0Text: null,
  reportText: "## 2026-09-26T05:40:00Z — ГОТОВО\nСдан отчёт\n",
  activityMs: NOW - 60_000, lastSayMs: NOW - 120_000, nowMs: NOW, ...over,
});
const observed = (over: Partial<NewaDirInput> = {}) =>
  applyDerivedStates(mergeRows([parseNewaDir(fixture(over))]), NOW)[0];

test("old ГОТОВО cannot hide a current question, alive worker or prior submission in JSON", () => {
  const row = observed({ toS0Text: "2026-09-26T05:59:00Z Вопрос: выбрать CSV или JSON?\n— newa (sample)\n" });
  const out = JSON.parse(renderJson([row], [], NOW)).sessions[0];
  expect(out).toMatchObject({ liveness: "alive", activity: "working", state: "waiting-tim" });
  expect(out.needs).toBe("Вопрос: выбрать CSV или JSON?");
  expect(out.decision).toEqual({ text: out.needs, source: "TO-S0.md", atMs: NOW - 60_000, freshness: "current" });
  expect(out.lastSubmission).toEqual({ text: "ГОТОВО", source: "REPORT-S0.md", atMs: NOW - 20 * 60_000 });
});

test("a new running turn retains the old result without becoming done", () => {
  const row = observed();
  expect(row.state).toBe("working");
  expect(row.lastSubmission?.text).toBe("ГОТОВО");
  expect(row.decision).toBeNull();
});

test("say at or after a question makes it historical, not waiting", () => {
  for (const lastSayMs of [NOW - 60_000, NOW]) {
    const row = observed({ lastSayMs, toS0Text: "2026-09-26T05:59:00Z Блокер: нужен выбор формата" });
    expect(row.decision?.freshness).toBe("stale");
    expect(row.needs).toBeNull();
    expect(row.state).toBe("working");
  }
});

test("missing entry time or say boundary remains explicitly unknown", () => {
  for (const over of [
    { toS0Text: "Вопрос: выбрать формат?" },
    { toS0Text: "2026-09-26T05:59:00Z Вопрос: выбрать формат?", lastSayMs: null },
    { toS0Text: "2026-09-27T05:59:00Z Вопрос: выбрать формат?" },
  ]) {
    const row = observed(over);
    expect(row.decision?.freshness).toBe("unknown");
    expect(row.needs).toBeNull();
    expect(row.state).toBe("working");
  }
});

test("dated heading supplies question time; later metadata does not erase it", () => {
  const row = observed({ toS0Text: "## 2026-09-26T05:59:00Z — Ход\nВопрос: какой формат?\nАртефакт: report.txt\n— newa (sample)" });
  expect(row.state).toBe("waiting-tim");
  expect(row.decision?.atMs).toBe(NOW - 60_000);
});

test("appending an unrelated dated entry does not freshen an old question", () => {
  const row = observed({ toS0Text: "2026-09-26T05:00:00Z Вопрос: какой формат?\n2026-09-26T05:59:00Z Сохранён промежуточный отчёт" });
  expect(row.decision?.freshness).toBe("stale");
  expect(row.state).toBe("working");
});

test("waiting for a receipt is a decision signal and explicit resolution clears it", () => {
  for (const signal of ["Ожидается квитанция S0", "Жду решения владельца", "СТАТУС: WAITING_S0_RECEIPT"]) {
    const text = `2026-09-26T05:59:00Z ${signal}`;
    expect(observed({ toS0Text: text }).state).toBe("waiting-tim");
    expect(observed({ toS0Text: text + "\n2026-09-26T06:00:00Z Квитанция получена" }).decision).toBeNull();
  }
});

test("fenced examples and quotes do not manufacture questions or submissions", () => {
  const text = "```text\n2026-09-26T05:59:00Z Вопрос: пример?\nГОТОВО\n```\n> ГОТОВО\n";
  const row = observed({ toS0Text: text, reportText: text });
  expect(row.decision).toBeNull();
  expect(row.lastSubmission).toBeNull();
});

test("stopped worker retains its result and current decision without appearing alive", () => {
  const row = observed({ statusText: '{"state":"running","live":false}', toS0Text: "2026-09-26T05:59:00Z Вопрос: принять отчёт?" });
  expect(row).toMatchObject({ liveness: "stopped", activity: "idle", state: "waiting-tim" });
  expect(row.lastSubmission).not.toBeNull();
});

test("missing or malformed live proof is unknown, even if status reports running", () => {
  for (const statusText of ['{"state":"running"}', '{"state":"running","live":"false"}', '{oops', '[]']) {
    expect(observed({ statusText }).liveness).toBe("unknown");
  }
  expect(observed({ statusText: '{oops' }).activity).toBe("unknown");
});

test("negative markers and noun итог do not become submission evidence", () => {
  for (const reportText of ["Пока не ГОТОВО", "## Итог обсуждения: выбираем формат", "ГОТОВО?", "ИТОГ: пока не готово"]) {
    expect(observed({ reportText }).lastSubmission).toBeNull();
  }
});

test("new report heading does not erase a prior submission; latest timestamp wins across files", () => {
  const row = observed({
    reportText: "## 2026-09-26T05:40:00Z — ГОТОВО\nОтчёт\n## 2026-09-26T05:59:00Z — Новая работа\nПроверяю следующий файл",
    toS0Text: "2026-09-26T05:30:00Z СДАНО: предыдущий результат",
  });
  expect(row.lastSubmission).toMatchObject({ source: "REPORT-S0.md", atMs: NOW - 20 * 60_000 });
  expect(row.state).toBe("working");
});

test("merge cannot resurrect an answered question or replace unknown activity time with tmux now", () => {
  const primary = parseNewaDir(fixture({ activityMs: null, toS0Text: "2026-09-26T05:00:00Z Вопрос: старый?" }));
  const fallback = { ...primary, source: "tmux", needs: "Вопрос: старый?", state: "waiting-tim" as const, lastActivityMs: NOW };
  const [merged] = applyDerivedStates(mergeRows([fallback, primary]), NOW);
  expect(merged.state).toBe("working");
  expect(merged.needs).toBeNull();
  expect(merged.lastActivityMs).toBeNull();
});

test("same name on different machines does not share decision or liveness", () => {
  const primary = parseNewaDir(fixture());
  const other = { ...primary, machine: "mac" as const, source: "terminal-mac", liveness: "stopped" as const };
  const merged = mergeRows([primary, other]);
  expect(merged).toHaveLength(2);
  expect(merged.find(r => r.machine === "newa")?.liveness).toBe("alive");
  expect(merged.find(r => r.machine === "mac")?.liveness).toBe("stopped");
});
