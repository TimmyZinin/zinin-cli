import { test, expect } from "bun:test";
import { requiredTodoCount } from "../../src/protocol/states";
test("skipped required steps remain in denominator; optional done never inflates progress", () => {
  expect(requiredTodoCount([
    { required: true, state: "done" }, { required: true, state: "skipped" },
    { required: true, state: "waiting_user" }, { required: false, state: "done" },
  ])).toEqual({ done: 1, total: 3 });
});
test("empty plan has no invented denominator", () => {
  expect(requiredTodoCount([])).toEqual({ done: 0, total: 0 });
});
