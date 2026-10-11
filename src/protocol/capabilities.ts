/** PRD §3 E1, R01/R07/R11; CONTRACTS §5/9; ORCHESTRATION §2/8.
 * Internal capability evidence only; this module never probes or starts a CLI.
 */
export type Engine = "codex" | "claude" | "kimi";
export const requiredAdapterMethods = [
  "probe", "openSession", "resumeSession", "startTurn", "sendInput",
  "interrupt", "resolveApproval", "observe", "closeOwnedSession",
] as const;
export const optionalAdapterMethods = [
  "compact", "readContext", "readQuota", "readCost", "recover",
] as const;
export type AdapterMethod = typeof requiredAdapterMethods[number] | typeof optionalAdapterMethods[number];
export interface CapabilityEntry {
  name: string;
  support: "supported" | "unsupported" | "unknown";
  mode: string;
  evidence_ref: string | null;
  verified_at: string | null;
  provider_version: string;
  adapter_version: string;
  auth_mode: string;
  limitations: readonly string[];
}
export interface CapabilityScope {
  mode: string;
  provider_version: string;
  adapter_version: string;
  auth_mode: string;
}
export function unknownCapability(name: string, scope: CapabilityScope): CapabilityEntry {
  return { name, ...scope, support: "unknown", evidence_ref: null, verified_at: null, limitations: [] };
}
export type CapabilityCheck =
  | { ok: true }
  | { ok: false; code: "unsupported" | "not_ready"; message: string };
/** Necessary evidence gate, not a substitute for auth, scope, budget or lease policy.
 * Caller supplies the required verification mode (e.g. live); help/replay evidence
 * cannot satisfy a live request merely because the capability name matches.
 */
export function checkCapability(
  name: string, entry: CapabilityEntry | undefined, required: CapabilityScope,
): CapabilityCheck {
  if (!entry || entry.name !== name) return { ok: false, code: "not_ready", message: "Capability evidence missing" };
  for (const field of ["mode", "provider_version", "adapter_version", "auth_mode"] as const) {
    if (!required[field].trim() || entry[field] !== required[field]) {
      return { ok: false, code: "not_ready", message: `Capability ${field} requires verification` };
    }
  }
  if (entry.support === "unsupported") return { ok: false, code: "unsupported", message: `${name} is unsupported; no substitute action permitted` };
  if (entry.support !== "supported" || !entry.evidence_ref?.trim() ||
      !entry.verified_at || !Number.isFinite(Date.parse(entry.verified_at))) {
    return { ok: false, code: "not_ready", message: "Capability is not verified" };
  }
  return { ok: true };
}
