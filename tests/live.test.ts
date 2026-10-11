import { expect, test } from "bun:test";
import { displayTitle, observedState, parseTtyFallback } from "../src/live.ts";

test("Terminal custom title wins; Codex status suffix is removed", () => {
  const name = "timofeyzinin — Свяжись с S0 через канал | Working | weekly 98% left — caffeinate ◂ codex";
  expect(displayTitle(name, "S9 связь — день 11.10")).toBe("S9 связь — день 11.10");
  expect(displayTitle(name, "Свяжись с S0 через канал | Working | weekly 98% left"))
    .toBe("Свяжись с S0 через канал");
});

test("board owner name wins over a Codex window title", () => {
  expect(displayTitle("Codex | Working", "Свяжись с S0", "S9")).toBe("S9");
});

test("Claude title, busy flag and a single spinner frame do not prove Working", () => {
  expect(observedState("claude", "◐ Служба ноль S0", false, true)).toBeNull();
  expect(observedState("claude", "◐ Служба ноль S0", true, true)).toBeNull();
  expect(observedState("codex", "Свяжись с S0 | Waiting", false, true)).toBe("Ready");
  expect(parseTtyFallback("12 ttys010 codex\n13 ttys010 caffeinate\n14 ttys011 /usr/local/bin/claude\n")
    .map(row => [row.id, row.harness, row.source])).toEqual([
      ["tty:ttys010", "codex", "ps-tty"], ["tty:ttys011", "claude", "ps-tty"],
    ]);
});
