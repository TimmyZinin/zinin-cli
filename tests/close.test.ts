import { expect, test } from "bun:test";
import { isTerminalClosed, parseTtyProcesses } from "../src/close.ts";

test("close selects only Codex and caffeinate on the chosen tty", () => {
  const rows = `77922 ttys010 login\n77926 ttys010 -zsh\n78270 ttys010 codex\n78292 ttys010 caffeinate\n12345 ttys011 codex\n`;
  expect(parseTtyProcesses(rows, "ttys010")).toEqual([
    { pid: 78270, tty: "ttys010", name: "codex" },
    { pid: 78292, tty: "ttys010", name: "caffeinate" },
  ]);
});

test("a retained Terminal id with no tabs is a closed session", () => {
  expect(isTerminalClosed("true", "0")).toBe(true);
  expect(isTerminalClosed("true", "1")).toBe(false);
});
