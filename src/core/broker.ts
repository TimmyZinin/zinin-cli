/** Offline E1 spike, NOT a production coordinator or transport.
 * PRD R08/R19; CONTRACTS §8/9; ORCHESTRATION §3/4.
 * SQLite is the approved E1-002 durability candidate (ARCHITECTURE §3).
 */
import { Database } from "bun:sqlite";
import type { DeliveryState } from "../protocol/states";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const messageKinds = ["assignment", "clarification_request", "clarification_response", "progress_summary", "result_offer", "review_request", "review_result", "handoff_offer", "handoff_ack", "control_notice"] as const;
/** ORCHESTRATION §4 normative envelope. Opaque policy is stored, never executed.
 * OPEN: kind-specific payload/origin schemas and delivery_policy schema.
 * content_ref/artifact_refs are references only; no files are read by this module.
 */
export interface BrokerEnvelope {
  message_id: string;
  workspace_id: string;
  from_agent_id: string;
  from_work_session_id: string;
  to_work_session_id: string;
  task_id: string;
  kind: typeof messageKinds[number];
  in_reply_to?: string;
  correlation_id: string;
  created_at: string;
  expires_at?: string;
  sender_epoch: number;
  content_ref: string;
  artifact_refs: string[];
  delivery_policy: Json;
}
/** Trusted caller binding, not an actor claim accepted from a message.
 * ORCHESTRATION §2/3; CONTRACTS §8: sender epoch != writer lease.
 * OPEN: production identity, recipient/kind/scope authorization and epoch store.
 */
export interface SenderBinding {
  workspace_id: string;
  from_agent_id: string;
  from_work_session_id: string;
  sender_epoch: number;
}
export class BrokerError extends Error {
  constructor(public readonly code: "conflict" | "expired" | "forbidden" | "not_ready", message: string) {
    super(message);
  }
}
/** Canonical JSON for ID/payload equality (CONTRACTS §8; ORCHESTRATION §4).
 * Reject values that JSON would silently discard/coerce. Not a wire schema.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + Array.from(value, canonical).join(",") + "]";
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  throw new BrokerError("not_ready", "Envelope must contain only JSON values");
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
function validate(envelope: BrokerEnvelope) {
  for (const field of ["message_id", "workspace_id", "from_agent_id", "from_work_session_id", "to_work_session_id", "task_id", "correlation_id", "content_ref"] as const) {
    if (typeof envelope[field] !== "string" || !envelope[field].trim()) throw new BrokerError("not_ready", `Missing ${field}`);
  }
  if (!messageKinds.includes(envelope.kind) || !Number.isSafeInteger(envelope.sender_epoch) || envelope.sender_epoch < 0 ||
      !validTime(envelope.created_at) || (envelope.expires_at !== undefined && !validTime(envelope.expires_at)) ||
      (envelope.in_reply_to !== undefined && (typeof envelope.in_reply_to !== "string" || !envelope.in_reply_to.trim())) ||
      !Array.isArray(envelope.artifact_refs) || envelope.artifact_refs.some(ref => typeof ref !== "string" || !ref.trim())) {
    throw new BrokerError("not_ready", "Malformed envelope");
  }
  canonical(envelope.delivery_policy);
}
interface MessageRow { envelope: string; state: DeliveryState }
export interface Receipt { seq: number; state: DeliveryState; evidence_ref: string | null }

/** State meanings, all ORCHESTRATION §4 / CONTRACTS §8:
 * queued: durable inbox; adapter_delivered: transport accepted only;
 * acknowledged: provider turn/answer linked to message; answered: separate reply;
 * expired: TTL reached, history retained; rejected: named by spec (OPEN edges);
 * needs_reconciliation: uncertain send, no blind resend.
 * Implemented edges ONLY:
 * absent -> queued; queued -> adapter_delivered -> acknowledged -> answered (§4).
 * queued -> expired: TTL before delivery (§4).
 * queued -> needs_reconciliation: send attempted, receipt uncertain (§4).
 * OPEN: rejected edges, post-delivery TTL, recovery from reconciliation, late replies.
 */
export class OfflineBroker {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS spike_messages (
        workspace_id TEXT NOT NULL, message_id TEXT NOT NULL,
        envelope TEXT NOT NULL, state TEXT NOT NULL,
        PRIMARY KEY(workspace_id, message_id));
      CREATE TABLE IF NOT EXISTS spike_receipts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL, message_id TEXT NOT NULL,
        state TEXT NOT NULL, evidence_ref TEXT,
        FOREIGN KEY(workspace_id, message_id) REFERENCES spike_messages(workspace_id, message_id));`);
  }
  close() { this.db.close(); }
  get(workspace: string, id: string): { envelope: BrokerEnvelope; state: DeliveryState } | null {
    const row = this.db.query("SELECT envelope, state FROM spike_messages WHERE workspace_id=? AND message_id=?").get(workspace, id) as MessageRow | null;
    return row ? { envelope: JSON.parse(row.envelope), state: row.state } : null;
  }
  receipts(workspace: string, id: string): Receipt[] {
    return this.db.query("SELECT seq, state, evidence_ref FROM spike_receipts WHERE workspace_id=? AND message_id=? ORDER BY seq").all(workspace, id) as Receipt[];
  }
  enqueue(envelope: BrokerEnvelope, binding: SenderBinding, now: number): { duplicate: boolean; state: DeliveryState } {
    validate(envelope);
    if (!Number.isFinite(now)) throw new BrokerError("not_ready", "Invalid host time");
    for (const key of ["workspace_id", "from_agent_id", "from_work_session_id"] as const) {
      if (envelope[key] !== binding[key]) throw new BrokerError("forbidden", "Sender binding mismatch");
    }
    const encoded = canonical(envelope);
    return this.db.transaction(() => {
      const old = this.db.query("SELECT envelope, state FROM spike_messages WHERE workspace_id=? AND message_id=?").get(envelope.workspace_id, envelope.message_id) as MessageRow | null;
      // CONTRACTS §8 and ORCHESTRATION §4: replay returns original outcome; no new run.
      if (old) {
        if (old.envelope !== encoded) throw new BrokerError("conflict", "Message ID has different envelope");
        return { duplicate: true, state: old.state };
      }
      // ORCHESTRATION §2/4: stale sender cannot issue a NEW message.
      if (envelope.sender_epoch !== binding.sender_epoch) throw new BrokerError("forbidden", "Stale sender epoch");
      if (envelope.expires_at && Date.parse(envelope.expires_at) <= now) throw new BrokerError("expired", "Message expired before enqueue");
      this.db.query("INSERT INTO spike_messages VALUES (?, ?, ?, 'queued')").run(envelope.workspace_id, envelope.message_id, encoded);
      this.record(envelope.workspace_id, envelope.message_id, "queued", null);
      return { duplicate: false, state: "queued" as const };
    }).immediate();
  }
  /** ORCHESTRATION §4: evidence references are supplied by trusted offline caller.
   * This spike preserves refs; it cannot verify provider receipts without an adapter.
   */
  recordDelivery(workspace: string, id: string, evidence: string, now: number) {
    this.transition(workspace, id, "queued", "adapter_delivered", evidence, now);
  }
  acknowledge(workspace: string, id: string, evidence: string) {
    this.transition(workspace, id, "adapter_delivered", "acknowledged", evidence);
  }
  answer(workspace: string, id: string, evidence: string) {
    this.transition(workspace, id, "acknowledged", "answered", evidence);
  }
  uncertainSend(workspace: string, id: string, evidence: string) {
    this.transition(workspace, id, "queued", "needs_reconciliation", evidence);
  }
  expireQueued(workspace: string, id: string, now: number) {
    this.db.transaction(() => {
      const row = this.get(workspace, id);
      if (!Number.isFinite(now) || !row?.envelope.expires_at || Date.parse(row.envelope.expires_at) > now) throw new BrokerError("not_ready", "TTL has not elapsed");
      this.transition(workspace, id, "queued", "expired", null);
    }).immediate();
  }
  private record(workspace: string, id: string, state: DeliveryState, evidence: string | null) {
    this.db.query("INSERT INTO spike_receipts(workspace_id,message_id,state,evidence_ref) VALUES(?,?,?,?)").run(workspace, id, state, evidence);
  }
  private transition(workspace: string, id: string, from: DeliveryState, to: DeliveryState, evidence: string | null, now?: number) {
    if (to !== "expired" && (typeof evidence !== "string" || !evidence.trim())) throw new BrokerError("not_ready", "Receipt evidence required");
    this.db.transaction(() => {
      const row = this.get(workspace, id);
      if (!row) throw new BrokerError("not_ready", "Message missing");
      // ORCHESTRATION §4: replay of an earlier receipt cannot rewind or append.
      const previous = this.receipts(workspace, id).find(receipt => receipt.state === to);
      if (previous?.evidence_ref === evidence) return;
      if (row.state !== from) throw new BrokerError("conflict", "Unsupported delivery transition");
      if (to === "adapter_delivered" && (!Number.isFinite(now) || (row.envelope.expires_at && Date.parse(row.envelope.expires_at) <= now!))) {
        throw new BrokerError("expired", "Delivery requires unexpired host time");
      }
      this.db.query("UPDATE spike_messages SET state=? WHERE workspace_id=? AND message_id=?").run(to, workspace, id);
      this.record(workspace, id, to, evidence);
    }).immediate();
  }
}
