import { test, expect } from "bun:test";
import { checkCapability, unknownCapability, type CapabilityEntry } from "../../src/protocol/capabilities";
const scope = { mode: "live", provider_version: "fixture-v1", adapter_version: "e1", auth_mode: "fixture-auth" };
const verified: CapabilityEntry = { ...unknownCapability("resumeSession", scope), support: "supported", evidence_ref: "synthetic:receipt-1", verified_at: "2026-09-24T00:00:00Z" };
test("unknown or absent evidence never authorizes a start/resume", () => {
  expect(checkCapability("resumeSession", undefined, scope).ok).toBe(false);
  expect(checkCapability("resumeSession", unknownCapability("resumeSession", scope), scope).ok).toBe(false);
  expect(checkCapability("startTurn", verified, scope).ok).toBe(false);
});
test("unsupported resume returns a typed error, never a replacement session", () => {
  expect(checkCapability("resumeSession", { ...verified, support: "unsupported" }, scope)).toMatchObject({ ok: false, code: "unsupported" });
});
test("verification is bound to protocol mode, provider/adapter version and auth mode", () => {
  expect(checkCapability("resumeSession", verified, scope)).toEqual({ ok: true });
  for (const field of ["mode", "provider_version", "adapter_version", "auth_mode"] as const) {
    expect(checkCapability("resumeSession", { ...verified, [field]: "changed" }, scope).ok).toBe(false);
    expect(checkCapability("resumeSession", verified, { ...scope, [field]: "" }).ok).toBe(false);
  }
});
test("help/replay and missing or malformed receipts cannot satisfy live verification", () => {
  for (const patch of [{ mode: "help" }, { mode: "replay" }, { evidence_ref: null }, { evidence_ref: " " }, { verified_at: null }, { verified_at: "invalid" }]) {
    expect(checkCapability("resumeSession", { ...verified, ...patch }, scope).ok).toBe(false);
  }
});
