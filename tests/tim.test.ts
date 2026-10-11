import { expect, test } from "bun:test";
import { planTable } from "../src/tim.ts";

test("tim reads only the requested plan section table", () => {
  const plan = "## 2. Долги\n\n| Кому | Что |\n|---|---|\n| Анне | Отчёт |\n\n## 3. Дела\n| X | Y |\n";
  expect(planTable(plan, 2)).toEqual([["Кому", "Что"], ["Анне", "Отчёт"]]);
});
