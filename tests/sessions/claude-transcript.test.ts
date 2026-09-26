import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscriptTail } from "../../src/adapters/sessions/claude-transcript";

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
test("non-JSON error lines pass through raw", () => {
  const facts = parseTranscriptTail("plain stderr: Interrupted by user");
  expect(facts.stuckOn).toBe("plain stderr: Interrupted by user");
});
test("JSON tool error becomes a readable fragment", () => {
  const facts = parseTranscriptTail('{"type":"result","error":"API Error: 403"}');
  expect(facts.stuckOn).toBe("API Error: 403");
});
