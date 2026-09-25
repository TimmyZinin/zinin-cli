import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeaseRegistry, LeaseError } from "../../src/core/leases";

// Synthetic IDs only (CONTRACTS §9). No real processes are signaled here.
const t0 = "2026-09-25T00:00:00Z";
const later = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-leases-")), "leases.sqlite");
  return { path, registry: new LeaseRegistry(path) };
}
function errorCode(action: () => unknown, code: string) {
  try { action(); throw new Error("Expected lease rejection"); }
  catch (error) { expect(error).toBeInstanceOf(LeaseError); expect((error as LeaseError).code).toBe(code); }
}
test("one active lease per run; epochs fence stale operations", () => {
  const { registry } = fixture();
  try {
    const first = registry.grant("r1", "s1", "executor-a", t0, 60_000);
    expect(first.epoch).toBe(1);
    errorCode(() => registry.grant("r1", "s1", "executor-b", t0, 60_000), "conflict");
    registry.release(first.lease_id, 1, later(1_000));
    const second = registry.grant("r1", "s1", "executor-b", later(2_000), 60_000);
    expect(second.epoch).toBe(2);
    errorCode(() => registry.release(first.lease_id, 1, later(3_000)), "conflict");
    registry.revoke(second.lease_id, 2, later(4_000));
    expect(registry.get(second.lease_id)?.state).toBe("revoked");
  } finally { registry.close(); }
});
test("leases expire deterministically at their TTL", () => {
  const { registry } = fixture();
  try {
    const lease = registry.grant("r1", "s1", "executor-a", t0, 1_000);
    expect(registry.sweep(later(999))).toBe(0);
    expect(registry.sweep(later(1_000))).toBe(1);
    expect(registry.get(lease.lease_id)?.state).toBe("expired");
    errorCode(() => registry.release(lease.lease_id, 1, later(1_001)), "conflict");
    const next = registry.grant("r1", "s1", "executor-a", later(1_002), 1_000);
    expect(next.epoch).toBe(2);
    errorCode(() => registry.release(next.lease_id, 2, later(3_000)), "expired");
  } finally { registry.close(); }
});
test("stop intent is durable and idempotent per pending reason", () => {
  const { path, registry } = fixture();
  try {
    const s1 = registry.requestStop("r1", "user asked", t0);
    expect(registry.requestStop("r1", "user asked", later(100))).toBe(s1);
    const s2 = registry.requestStop("r1", "budget cap", later(200));
    expect(s2).toBeGreaterThan(s1);
  } finally { registry.close(); }
  const reopened = new LeaseRegistry(path);
  try {
    const actions = reopened.reconcile([], later(300));
    expect(actions.filter(a => a.kind === "stop")).toHaveLength(2);
  } finally { reopened.close(); }
});
test("reconcile emits each stop once; orphan appears only while unowned-observed", () => {
  const { registry } = fixture();
  try {
    registry.grant("r1", "s1", "executor-a", t0, 60_000);
    registry.grant("r2", "s1", "executor-a", t0, 60_000);
    registry.requestStop("r1", "user asked", t0);
    const first = registry.reconcile(["r2"], later(500));
    expect(first).toContainEqual({ kind: "stop", run_id: "r1", reason: "user asked", request_seq: 1 });
    expect(first.some(a => a.kind === "orphan" && a.run_id === "r1")).toBe(false);
    expect(registry.reconcile(["r2"], later(600))).toEqual([]);
    const observed = registry.reconcile(["r1", "r2"], later(700));
    expect(observed).toEqual([]);
  } finally { registry.close(); }
});
test("crash of a worker surfaces as an orphan exactly until reaped", () => {
  const { registry } = fixture();
  try {
    const lease = registry.grant("r1", "s1", "executor-a", t0, 60_000);
    const orphan = registry.reconcile([], later(100)).find(a => a.kind === "orphan");
    expect(orphan).toMatchObject({ lease_id: lease.lease_id, run_id: "r1" });
    registry.revoke(lease.lease_id, 1, later(200));
    expect(registry.reconcile([], later(300))).toEqual([]);
  } finally { registry.close(); }
});
test("policy: internal actions allowed; external need a fresh one-shot user approval", () => {
  const { registry } = fixture();
  try {
    for (const allowed of ["user", "orchestrator", "executor"]) registry.checkInternal(allowed);
    errorCode(() => registry.checkInternal("stranger"), "malformed");
    errorCode(() => registry.checkExternal("publish", "executor-a", "executor"), "forbidden");
    errorCode(() => registry.approve("publish", "executor-a", "orchestrator", t0), "forbidden");
    registry.approve("publish", "executor-a", "user", t0);
    const approval = registry.checkExternal("publish", "executor-a", "executor");
    expect(approval).toContain("ap-publish-executor-a");
    errorCode(() => registry.checkExternal("publish", "executor-a", "executor"), "forbidden");
    errorCode(() => registry.checkExternal("send", "executor-a", "executor"), "forbidden");
  } finally { registry.close(); }
});
