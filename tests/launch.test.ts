import { expect, test } from "bun:test";
import { parseLaunchAnnouncement, parseWindowTtys, shellQuote, taskRef } from "../src/launch.ts";

test("launch uses a safe ref and quotes absolute command paths", () => {
  expect(taskRef("/tmp/task-plan2-people-1011.md")).toBe("plan2-people-1011");
  expect(shellQuote("/tmp/a'b.command")).toBe("'/tmp/a'\\''b.command'");
});

test("only the matching first bus announcement supplies a thread", () => {
  const thread = "01a1297b-784b-7121-97dc-631505b49d10";
  const event = { ts: "2026-10-11T10:02:00+04:00", from: "ZININ", type: "start",
    ref: "launch/demo", text: `thread ${thread}; launch=abc123` };
  expect(parseLaunchAnnouncement(JSON.stringify(event), "demo", "abc123", Date.parse("2026-10-11T06:01:00Z"))).toBe(thread);
  expect(parseLaunchAnnouncement(JSON.stringify(event), "other", "abc123", 0)).toBeNull();
  expect(parseLaunchAnnouncement(JSON.stringify(event), "demo", "wrong", 0)).toBeNull();
  expect(parseLaunchAnnouncement(JSON.stringify(event), "demo", "abc123", Date.parse("2026-10-11T06:03:00Z"))).toBeNull();
});

test("window reconciliation records Terminal ghosts without a tty", () => {
  const rows = parseWindowTtys(`3282\t\u001e3296\t/dev/ttys010\u001e`);
  expect([...rows]).toEqual([[3282, ""], [3296, "/dev/ttys010"]]);
});
