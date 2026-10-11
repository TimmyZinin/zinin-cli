import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWordTarget } from "../src/word.ts";

test("word resolves owner before session cwd and rejects ambiguous fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "zinin-word-"));
  const state = join(root, "state");
  const sessions = join(root, "sessions");
  const day = new Date("2026-10-11T06:00:00Z");
  const today = join(sessions, "2026/10/11");
  mkdirSync(state); mkdirSync(today, { recursive: true });
  const ownerId = "01a1298f-101a-7b91-905e-1024129d149d";
  const otherId = "01a1297b-784b-7121-97dc-631505b49d10";
  writeFileSync(join(state, "demo.json"), JSON.stringify({ direction: "demo", owner: { session: "DEMO", thread: ownerId } }));
  writeFileSync(join(today, "one.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/work", id: ownerId } }) + "\n");
  writeFileSync(join(today, "two.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/work", id: otherId } }) + "\n");
  expect(resolveWordTarget("DEMO", state, sessions, day)).toBe(ownerId);
  expect(() => resolveWordTarget("work", state, sessions, day)).toThrow(/2 потоков/);
  expect(resolveWordTarget(otherId, state, sessions, day)).toBe(otherId);
});
