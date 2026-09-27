import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscriptTail, cwdToProjectSlug } from "../../src/adapters/sessions/claude-transcript";

const FIX = join(import.meta.dir, "fixtures");

test("error tail surfaces the rate limit as stuckOn with weekly percent", () => {
  const facts = parseTranscriptTail(readFileSync(join(FIX, "claude-transcript-error.jsonl"), "utf8"));
  expect(facts.stuckOn).toContain("rate_limit");
  expect(facts.weeklyLimitPct).toBe(94);
});
test("clean tail has no stuck marker and no limits", () => {
  const facts = parseTranscriptTail(readFileSync(join(FIX, "claude-transcript-clean.jsonl"), "utf8"));
  expect(facts).toEqual({ stuckOn: null, contextPct: null, weeklyLimitPct: null });
});
test("N-1: raw prose lines are ignored, not surfaced", () => {
  const facts = parseTranscriptTail("plain stderr: Interrupted by user\nnot json at all");
  expect(facts.stuckOn).toBeNull();
});
test("N-1: JSON tool error becomes a readable fragment", () => {
  const facts = parseTranscriptTail('{"type":"result","error":"API Error: 403"}');
  expect(facts.stuckOn).toBe("API Error: 403");
});
test("N-1: \"interrupted\":false never lights up STUCK-ON", () => {
  const line = JSON.stringify({ type: "tool_result", tool_use_id: "x", content: "ok", interrupted: false });
  expect(parseTranscriptTail(line).stuckOn).toBeNull();
});
test("N-1: failed tool answered by the assistant is not stuck", () => {
  const failed = JSON.stringify({ type: "tool_result", is_error: true, content: "exit 1" });
  const reply = JSON.stringify({ role: "assistant", content: [{ type: "text", text: "Повторяю иначе." }] });
  expect(parseTranscriptTail(`${failed}\n${reply}`).stuckOn).toBeNull();
});
test("N-1: failed tool with no assistant reply after is stuck", () => {
  const failed = JSON.stringify({ type: "tool_result", is_error: true, content: "exit 1" });
  expect(parseTranscriptTail(failed).stuckOn).toContain("is_error");
});
test("N-1: a 403 inside an assistant sentence is neither stuck nor limit", () => {
  const reply = JSON.stringify({ role: "assistant", content: [{ type: "text", text: "Спросил у Матвея (403) про лимиты." }] });
  const facts = parseTranscriptTail(reply);
  expect(facts.stuckOn).toBeNull();
  expect(facts.weeklyLimitPct).toBeNull();
});
test("N-1: rate_limit_error structure carries the weekly percent", () => {
  const line = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "You've used 97% of your weekly limit" } });
  const facts = parseTranscriptTail(line);
  expect(facts.weeklyLimitPct).toBe(97);
  expect(facts.stuckOn).toContain("weekly limit");
});
test("N-3: cwd maps to the full project slug, dash-safe", () => {
  expect(cwdToProjectSlug("Users/user/proj-a-service"))
    .toBe("-Users-user-proj-a-service");
  expect(cwdToProjectSlug("Users/user/proj-b")).toBe("-Users-user-proj-b");
});
test("K3-2: plus and dot in cwd become dashes like Claude Code does", () => {
  expect(cwdToProjectSlug("Users/user/20260101T1200+0400"))
    .toBe("-Users-user-20260101T1200-0400");
  expect(cwdToProjectSlug("Users/user/example.com"))
    .toBe("-Users-user-example-com");
  expect(cwdToProjectSlug("Users/user/proj-a-service"))
    .toBe("-Users-user-proj-a-service");
});
