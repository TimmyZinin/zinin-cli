import { expect, test } from "bun:test";
import { displayTitle, observedState } from "../src/live.ts";

test("Terminal custom title wins; Codex status suffix is removed", () => {
  const name = "timofeyzinin — Свяжись с S0 через канал | Working | weekly 98% left — caffeinate ◂ codex";
  expect(displayTitle(name, "S9 связь — день 11.10")).toBe("S9 связь — день 11.10");
  expect(displayTitle(name, "Свяжись с S0 через канал | Working | weekly 98% left"))
    .toBe("Свяжись с S0 через канал");
});

test("Claude title, busy flag and a single spinner frame do not prove Working", () => {
  expect(observedState("claude", "◐ Служба ноль S0", false, true)).toBeNull();
  expect(observedState("claude", "◐ Служба ноль S0", true, true)).toBeNull();
  expect(observedState("codex", "Свяжись с S0 | Waiting", false, true)).toBe("Ready");
});
