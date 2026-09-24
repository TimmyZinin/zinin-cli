import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfflineBroker, BrokerError, type BrokerEnvelope, type SenderBinding } from "../../src/core/broker";

// Synthetic records only (CONTRACTS §9). No provider calls or real task data.
const binding: SenderBinding = { workspace_id: "w1", from_agent_id: "a1", from_work_session_id: "s1", sender_epoch: 2 };
const now = Date.parse("2026-09-24T00:00:00Z");
function message(patch: Partial<BrokerEnvelope> = {}): BrokerEnvelope {
  return { ...binding, message_id: "m1", to_work_session_id: "s2", task_id: "t1", kind: "clarification_request", correlation_id: "c1", created_at: "2026-09-24T00:00:00Z", expires_at: "2026-09-24T00:01:00Z", content_ref: "synthetic:question", artifact_refs: [], delivery_policy: { fixture: true, opaque: null }, ...patch };
}
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e1-broker-")), "spike.sqlite");
  return { path, broker: new OfflineBroker(path) };
}
function errorCode(action: () => unknown, code: string) {
  try { action(); throw new Error("Expected broker rejection"); }
  catch (error) { expect(error).toBeInstanceOf(BrokerError); expect((error as BrokerError).code).toBe(code); }
}
test("§4 durable queued -> delivered -> acknowledged -> answered; refs remain distinct", () => {
  const { path, broker } = fixture();
  broker.enqueue(message(), binding, now);
  broker.recordDelivery("w1", "m1", "synthetic:transport", now);
  expect(broker.get("w1", "m1")?.state).toBe("adapter_delivered");
  broker.acknowledge("w1", "m1", "synthetic:turn-message-link");
  broker.answer("w1", "m1", "synthetic:reply-message-link");
  broker.close();
  const reopened = new OfflineBroker(path);
  try {
    expect(reopened.get("w1", "m1")?.state).toBe("answered");
    expect(reopened.receipts("w1", "m1").map(r => r.state)).toEqual(["queued", "adapter_delivered", "acknowledged", "answered"]);
    expect(reopened.get("w1", "m1")?.envelope.correlation_id).toBe("c1");
    expect(reopened.enqueue(message(), binding, now + 120_000)).toEqual({ duplicate: true, state: "answered" });
    reopened.recordDelivery("w1", "m1", "synthetic:transport", now);
    reopened.acknowledge("w1", "m1", "synthetic:turn-message-link");
    expect(reopened.get("w1", "m1")?.state).toBe("answered");
    expect(reopened.receipts("w1", "m1")).toHaveLength(4);
  } finally { reopened.close(); }
});
test("§4 canonical envelope dedup rejects changed content, task, receiver or policy", () => {
  const { broker } = fixture();
  try {
    broker.enqueue(message(), binding, now);
    const reordered = Object.fromEntries(Object.entries(message()).reverse()) as unknown as BrokerEnvelope;
    reordered.delivery_policy = { opaque: null, fixture: true };
    expect(broker.enqueue(reordered, binding, now).duplicate).toBe(true);
    for (const patch of [{ content_ref: "different" }, { task_id: "different" }, { to_work_session_id: "different" }, { delivery_policy: {} }]) {
      errorCode(() => broker.enqueue(message(patch), binding, now), "conflict");
    }
    expect(broker.receipts("w1", "m1")).toHaveLength(1);
  } finally { broker.close(); }
});
test("§2/4 stale epoch rejects new message; exact replay returns original receipt", () => {
  const { broker } = fixture();
  try {
    errorCode(() => broker.enqueue(message({ sender_epoch: 1 }), binding, now), "forbidden");
    expect(broker.get("w1", "m1")).toBeNull();
    broker.enqueue(message(), binding, now);
    expect(broker.enqueue(message(), { ...binding, sender_epoch: 3 }, now).duplicate).toBe(true);
    errorCode(() => broker.enqueue(message({ message_id: "m2" }), { ...binding, sender_epoch: 3 }, now), "forbidden");
    errorCode(() => broker.enqueue(message(), { ...binding, from_agent_id: "a2" }, now), "forbidden");
  } finally { broker.close(); }
});
test("§4 uncertain send persists reconciliation and prevents blind resend after reopen", () => {
  const { broker, path } = fixture();
  broker.enqueue(message(), binding, now);
  broker.uncertainSend("w1", "m1", "synthetic:timeout");
  broker.close();
  const reopened = new OfflineBroker(path);
  try {
    expect(reopened.enqueue(message(), binding, now).state).toBe("needs_reconciliation");
    errorCode(() => reopened.recordDelivery("w1", "m1", "synthetic:retry", now), "conflict");
    errorCode(() => reopened.acknowledge("w1", "m1", "synthetic:late-ack"), "conflict");
    expect(reopened.receipts("w1", "m1")).toHaveLength(2);
  } finally { reopened.close(); }
});
test("§4 queued TTL retains envelope/history; no expiry inferred when absent", () => {
  const { broker } = fixture();
  try {
    broker.enqueue(message(), binding, now);
    errorCode(() => broker.expireQueued("w1", "m1", now), "not_ready");
    errorCode(() => broker.recordDelivery("w1", "m1", "synthetic:too-late", now + 60_000), "expired");
    broker.expireQueued("w1", "m1", now + 60_000);
    broker.expireQueued("w1", "m1", now + 60_000);
    expect(broker.get("w1", "m1")?.envelope.content_ref).toBe("synthetic:question");
    expect(broker.receipts("w1", "m1").map(r => r.state)).toEqual(["queued", "expired"]);
    const noTTL = message({ message_id: "m2" }); delete noTTL.expires_at;
    broker.enqueue(noTTL, binding, now);
    errorCode(() => broker.expireQueued("w1", "m2", now + 999_999), "not_ready");
    errorCode(() => broker.enqueue(message({ message_id: "m3" }), binding, now + 60_000), "expired");
    expect(broker.get("w1", "m3")).toBeNull();
  } finally { broker.close(); }
});
test("§4 out-of-order receipts and evidence-free transitions cannot imply completion", () => {
  const { broker } = fixture();
  try {
    broker.enqueue(message(), binding, now);
    errorCode(() => broker.answer("w1", "m1", "synthetic:answer"), "conflict");
    errorCode(() => broker.acknowledge("w1", "m1", "synthetic:ack"), "conflict");
    errorCode(() => broker.recordDelivery("w1", "m1", "", now), "not_ready");
    broker.recordDelivery("w1", "m1", "synthetic:delivered", now);
    broker.recordDelivery("w1", "m1", "synthetic:delivered", now);
    expect(broker.receipts("w1", "m1")).toHaveLength(2);
    errorCode(() => broker.recordDelivery("w1", "m1", "synthetic:different", now), "conflict");
    expect(broker.get("w1", "m1")?.state).toBe("adapter_delivered");
  } finally { broker.close(); }
});
test("CONTRACTS §8/9 message and receipt rollback atomically on storage failure", () => {
  const { broker, path } = fixture();
  const fault = new Database(path);
  try {
    fault.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON spike_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END");
    expect(() => broker.enqueue(message(), binding, now)).toThrow("injected receipt failure");
    expect(broker.get("w1", "m1")).toBeNull();
    expect(broker.receipts("w1", "m1")).toHaveLength(0);
    fault.exec("DROP TRIGGER reject_receipt");
    broker.enqueue(message(), binding, now);
    fault.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON spike_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END");
    expect(() => broker.recordDelivery("w1", "m1", "synthetic:transport", now)).toThrow("injected receipt failure");
    expect(broker.get("w1", "m1")?.state).toBe("queued");
    expect(broker.receipts("w1", "m1")).toHaveLength(1);
  } finally { fault.close(); broker.close(); }
});
test("§4 message IDs are workspace scoped; two connections see durable dedup", () => {
  const { broker, path } = fixture();
  const second = new OfflineBroker(path);
  try {
    broker.enqueue(message(), binding, now);
    expect(second.enqueue(message(), binding, now).duplicate).toBe(true);
    second.enqueue(message({ workspace_id: "w2" }), { ...binding, workspace_id: "w2" }, now);
    expect(broker.receipts("w2", "m1")).toHaveLength(1);
    expect(broker.receipts("w1", "m1")).toHaveLength(1);
  } finally { second.close(); broker.close(); }
});
test("CONTRACTS §9 malformed envelopes do not create inbox records", () => {
  const { broker } = fixture();
  try {
    for (const patch of [{ sender_epoch: NaN }, { message_id: "" }, { created_at: "invalid" }, { expires_at: "invalid" }, { artifact_refs: [""] }, { kind: "shell" }, { delivery_policy: { value: undefined } }]) {
      expect(() => broker.enqueue(message(patch as Partial<BrokerEnvelope>), binding, now)).toThrow();
      expect(broker.receipts("w1", "m1")).toHaveLength(0);
    }
  } finally { broker.close(); }
});
