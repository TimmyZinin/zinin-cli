import { test, expect } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor, SupervisorError } from "../../src/core/supervisor";
import { LeaseRegistry } from "../../src/core/leases";

const t0 = "2026-09-25T00:00:00Z";
const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function fixture(graceMs = 60_000) {
  const dir = mkdtempSync(join(tmpdir(), "zinin-e2-sup-"));
  const leasesPath = join(dir, "leases.sqlite");
  const sup = new Supervisor(leasesPath, join(dir, "sup.sqlite"), graceMs);
  return { dir, leasesPath, sup };
}
function intent(leasesPath: string, run_id: string) {
  const leases = new LeaseRegistry(leasesPath);
  leases.requestStop(run_id, "user asked", t0);
  leases.close();
}
test("supervisor owns a child; observed facts come from real liveness", async () => {
  const { sup } = fixture();
  try {
    const pid = sup.start("r1", ["sleep", "30"], t0);
    expect(pid).toBeGreaterThan(0);
    expect(sup.liveRunIds()).toEqual(["r1"]);
    process.kill(pid, "SIGKILL"); // external crash, no stop intent
    await sleep(60);
    expect(sup.liveRunIds()).toEqual([]);
  } finally { sup.close(); }
});
test("stop intent becomes SIGTERM exactly once; repeat calls deliver nothing new", async () => {
  const { leasesPath, sup } = fixture();
  try {
    const pid = sup.start("r1", ["sleep", "30"], t0);
    intent(leasesPath, "r1");
    const first = sup.applyStops(at(100));
    expect(first.terminated).toEqual(["r1"]);
    expect(first.escalated).toEqual([]);
    expect(sup.applyStops(at(200)).terminated).toEqual([]);
    await sleep(120);
    expect(pidAlive(pid)).toBe(false);
    expect(sup.liveRunIds()).toEqual([]);
    expect(sup.applyStops(at(300)).escalated).toEqual([]);
  } finally { sup.close(); }
});
test("a child that ignores SIGTERM is escalated to SIGKILL after grace", async () => {
  const { dir, leasesPath, sup } = fixture(40);
  try {
    // Wait for the trap to be installed before the stop intent: a SIGTERM
    // landing before `trap "" TERM` executes kills the child by default action.
    const ready = join(dir, "trap-ready");
    const pid = sup.start("r1", ["sh", "-c", `trap "" TERM; touch '${ready}'; sleep 30; true`], t0);
    for (let i = 0; i < 200 && !existsSync(ready); i++) await sleep(10);
    expect(existsSync(ready)).toBe(true);
    intent(leasesPath, "r1");
    expect(sup.applyStops(at(100)).terminated).toEqual(["r1"]);
    await sleep(120); // SIGTERM ignored by the trap
    const second = sup.applyStops(at(300)); // 200ms > 40ms grace
    expect(second.escalated).toEqual(["r1"]);
    await sleep(60);
    expect(pidAlive(pid)).toBe(false);
    expect(sup.liveRunIds()).toEqual([]);
  } finally { sup.close(); }
});
test("duplicate start and malformed time are rejected", () => {
  const { sup } = fixture();
  try {
    sup.start("r1", ["sleep", "30"], t0);
    expect(() => sup.start("r1", ["sleep", "30"], t0)).toThrow(SupervisorError);
    expect(() => sup.applyStops("not-a-time")).toThrow(SupervisorError);
  } finally { sup.close(); }
});
