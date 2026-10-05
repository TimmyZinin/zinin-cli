import { test, expect } from "bun:test";
import { renderOverview, humanIdle } from "../../src/sessions/overview";
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
  for (const title of ["Работают сейчас", "Ждут решения владельца", "Сданы", "Простаивают"]) expect(out).toContain(title);
  expect(out).toMatch(/newa\s+sample\s+Проверяет импорт/);
  expect(out).toMatch(/newa\s+choice\s+Вопрос: выбрать CSV\?/);
  expect(out).toContain("сдано раньше: СДАНО: отчёт");
  expect(out).toContain("ход остановлен:");
  expect(out).toContain("Оценка по времени файла");
  expect(out).toMatch(/1 мин(?:\n|$)/);
  expect(out).toContain("вопрос: Вопрос: формат?");
  expect(working.decision?.freshness).toBe("unknown");
});
test("idle/missing description, stale running and unavailable source remain readable", () => {
  const idle = row("idle", null, null, null);
  const old = addStatusEstimates(row(), '{"state":"running"}', NOW - 21 * 60_000, null, NOW);
  const out = renderOverview([idle, old], [{ machine: "mac", memFreeMb: null, diskFreeMb: null, available: false }], NOW);
  expect(out).toContain("sample (по имени папки)"); expect(out).toContain("простаивает");
  expect(out).toContain("возможно зависла"); expect(out).toContain("Недоступно: Мак");
});
test("task description uses meaningful TASK content then latest report СТАТУС", () => {
  expect(row("idle", null, "СТАТУС: Проверяет таблицу", "# Задание\n\nИсправляет импорт").task).toBe("Исправляет импорт");
  expect(row("idle", null, "СТАТУС: Предыдущая работа\n2026-10-05T11:59:00Z СТАТУС: Проверяет таблицу", null).task).toBe("Проверяет таблицу");
});
test("control sequences cannot escape into readable output and long descriptions are clipped", () => {
  const r = row(); r.task = "\x1b[31m" + "x".repeat(200); r.id = "a\n\x1b[2Jb";
  const out = renderOverview([r], [], NOW);
  expect(out).not.toContain("\x1b"); expect(out).not.toContain("x".repeat(100)); expect(out).toContain("…");
});
test("description fallbacks preserve priority, dated heading cleanup and source", () => {
  const parse = (reportText: string | null, readmeText: string | null = null, toS0Text: string | null = null) => parseNewaDir({name: "example", nowMs: NOW, statusText: null, metaText: null, taskText: null, reportText, readmeText, toS0Text});
  expect(parse("## 2026-10-05 — Исправление импорта\nПроверки прошли").task).toBe("Исправление импорта");
  expect(parse("## Заголовок\nСТАТУС: Проверяет экспорт").taskSource).toBe("REPORT-S0.md:status");
  expect(parse("## Проверяет документы\nХвост").taskSource).toBe("REPORT-S0.md:heading");
  expect(parse("Первая строка\nПоследняя работа").task).toBe("Последняя работа");
  expect(parse(null, "# Исполнитель newa\nТы выполняешь только поручение S0 в текущей рабочей папке.", "Проверяет архив").taskSource).toBe("TO-S0.md");
  expect(parse(null, "# Проект example\nПроверяет архив").taskSource).toBe("README.md");
  expect(parse(null)).toMatchObject({task:"example (по имени папки)", taskSource:"directory-name"});
});

test("human idle duration uses minutes, hours and days at exact boundaries", () => {
  for (const [minutes, label] of [[7,"7 мин"],[59,"59 мин"],[60,"1 ч"],[240,"4 ч"],[1439,"23 ч"],[1440,"1 дн"],[4320,"3 дн"]] as const) expect(humanIdle(NOW - minutes * 60_000,NOW)).toBe(label);
  expect(humanIdle(null,NOW)).toBe("неизвестно"); expect(humanIdle(NOW+1,NOW)).toBe("0 мин");
});

test("decisions lead the overview and every block sorts newest movement first", () => {
  const rows = ["running","idle"].flatMap(state => [
    {...row(state, "Вопрос: формат?", "СДАНО: отчёт"), id: state+"-old", lastActivityMs: NOW-120_000},
    {...row(state, "Вопрос: формат?", "СДАНО: отчёт"), id: state+"-new", lastActivityMs: NOW-60_000},
  ]);
  const out=renderOverview(rows,[],NOW);
  expect(out.startsWith("Ждут решения владельца\n")).toBe(true);
  expect(out.indexOf("Работают сейчас")).toBeLessThan(out.indexOf("Сданы"));
  for (const block of out.split(/\n\n/)) for (const state of ["running","idle"]) {
    if(block.includes(state+"-old")) expect(block.indexOf(state+"-new")).toBeLessThan(block.indexOf(state+"-old"));
  }
  expect(rows[0].id).toBe("running-old");
});

test("summary counts sessions once and counts only dated submissions in the last day", () => {
  const working=row("running",null,"2026-10-05T11:00:00Z СДАНО: отчёт");
  const waiting={...row("idle","Вопрос: формат?","СДАНО: без даты"),id:"waiting"};
  const old={...row("idle",null,"2026-10-03T11:00:00Z СДАНО: старое"),id:"old"};
  const mac={...row(),id:"mac",machine:"mac" as const,source:"terminal-mac"};
  expect(renderOverview([working,waiting,old,mac],[],NOW).split("\n").at(-1)).toBe("Мак: 1 живых · newa: 1 работают, 1 ждут решения, 0 сдано за сутки");
});

test("each session occupies one block and previous submissions stay on that same line", () => {
  const inputs=[{...row("running",null,"СДАНО: раньше"),id:"work-one"},
    {...row("idle","Вопрос: выбор?","СДАНО: раньше"),id:"wait-one"},
    {...row("timeout",null,"СДАНО: результат"),id:"done-one"}];
  const out=renderOverview(inputs,[],NOW);
  for(const r of inputs) expect(out.split("\n").filter(line=>line.includes(r.id))).toHaveLength(1);
  expect(out.split("\n").find(line=>line.includes("work-one"))).toContain("сдано раньше:");
  const submitted=out.split("Сданы\n")[1].split("\n\n")[0];
  expect(submitted).toContain("done-one"); expect(submitted).not.toContain("work-one");
});

test("running wins over old submission groups; empty blocks and footer agree with rows", () => {
  const working={...row("running",null,"2026-10-05T11:00:00Z СДАНО: старый результат"),id:"live-worker"};
  working.overviewGroup={value:"submitted",source:"status-mtime",confidence:"estimate",atMs:NOW};
  const done={...row("idle",null,"2026-10-05T11:30:00Z СДАНО: результат"),id:"done-worker"};
  const waiting={...row("idle","Вопрос: формат?"),id:"wait-worker"};
  const out=renderOverview([working,done,waiting],[],NOW);
  const block=(title:string)=>out.split(title+"\n")[1].split("\n\n")[0];
  expect(block("Работают сейчас")).toContain("live-worker");
  expect(block("Сданы")).not.toContain("live-worker");
  for(const title of ["Работают сейчас","Ждут решения владельца","Сданы"]) expect(block(title).split("\n")).toHaveLength(1);
  expect(out.split("\n").at(-1)).toBe("Мак: 0 живых · newa: 1 работают, 1 ждут решения, 1 сдано за сутки");
  const empty=renderOverview([],[],NOW);
  for(const title of ["Работают сейчас","Ждут решения владельца","Сданы","Простаивают"]) expect(empty).toContain(title+"\nнет");
});

test("generic README and placeholder lines cannot masquerade as a task", () => {
  const parse=(reportText:string|null,readmeText:string|null=null)=>parseNewaDir({name:"sample-worker",nowMs:NOW,metaText:null,statusText:null,taskText:null,toS0Text:null,reportText,readmeText});
  expect(parse(null,"`start NAME - < TASK.md` и `say NAME` передают многострочный текст").taskSource).toBe("directory-name");
  expect(parse("Итог:\n- 2026-10-05: …\n## Кратко").task).toBe("sample-worker (по имени папки)");
  expect(parse("- 2026-10-05: Проверяет выгрузку данных").task).toBe("Проверяет выгрузку данных");
  expect(parse(null,"# sample-worker\nПроверяет выгрузку данных").taskSource).toBe("README.md");
});

test("uncertainty appears once in footnotes and missing stop reasons add no noise", () => {
  const inputs=[row("running","Вопрос: какой формат?"),{...row("idle","Вопрос: какой формат?"),id:"waiting"},
    {...row("timeout"),id:"no-reason",stoppedReason:{value:null,source:"status-mtime" as const,confidence:"estimate" as const,atMs:NOW}}];
  const out=renderOverview(inputs,[],NOW);
  expect(out.match(/Оценка по времени файла/g)).toHaveLength(1);
  expect(out.match(/Точная свежесть вопроса неизвестна/g)).toHaveLength(1);
  expect(out).not.toContain("причина не указана");
  expect(out.split("\n").find(line=>line.includes("no-reason"))).not.toContain("ход остановлен");
  for(const line of out.split("\n").filter(line=>line.startsWith("newa"))) {
    expect(line).not.toContain("по времени файла"); expect(line).not.toContain("свежесть вопроса неизвестна");
  }
});

test("idle block is named plainly and unavailable machines have a separate diagnostic", () => {
  const out=renderOverview([row("idle")],[{machine:"mac",memFreeMb:null,diskFreeMb:null,available:false}],NOW);
  expect(out).toContain("Простаивают\n"); expect(out).toContain("Недоступно: Мак");
  expect(out).not.toContain("Не отвечают/неизвестно");
  expect(out.split("\n").filter(line=>line.startsWith("Недоступно:"))).toHaveLength(1);
});

test("columns align in terminal cells and descriptions fit narrow and default widths", () => {
  const inputs=[{...row("running"),id:"короткая",task:"Проверяет данные "+"д".repeat(150)},
    {...row("running"),id:"⚡-широкая-сессия",machine:"mac" as const,task:"Проверяет таблицы"}];
  for(const width of [60,100,140]) {
    const lines=renderOverview(inputs,[],NOW,0,width).split("\n").filter(line=>/^(?:newa|Мак)\s/.test(line));
    expect(lines).toHaveLength(2);
    for(const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
    const offsets=lines.map(line=>Bun.stringWidth(line.slice(0,line.indexOf("Проверяет"))));
    expect(offsets[0]).toBe(offsets[1]);
    expect(lines.map(line=>Bun.stringWidth(line.slice(0,line.lastIndexOf("1 мин"))))[0]).toBe(Bun.stringWidth(lines[1].slice(0,lines[1].lastIndexOf("1 мин"))));
  }
  expect(renderOverview(inputs,[],NOW)).toBe(renderOverview(inputs,[],NOW,0,process.stdout.columns || 100));
});

test("controller stopped-turn notices are neither task descriptions nor owner questions", () => {
  const r=parseNewaDir({name:"notice-worker",nowMs:NOW,metaText:null,statusText:'{"state":"failed"}',taskText:null,reportText:null,
    toS0Text:"Turn 000001 stopped: exit=1, reason=Вопрос: проверить?; inspect tail. No automatic restart."});
  expect(r.taskSource).toBe("directory-name"); expect(r.decision).toBeNull();
});
