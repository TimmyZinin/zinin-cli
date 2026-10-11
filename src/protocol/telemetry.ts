/** PRD §4 context/limits, R04; CONTRACTS §6; ORCHESTRATION §5/6.
 * Context, account quota and cost are different measurements. No billing->context mapping.
 */
export type Quality = "reported" | "estimated" | "unknown";
export interface ContextSample {
  used_tokens?: number;
  max_tokens?: number;
  sample_kind: "live_context" | "estimate";
  quality: Quality;
  source: string;
  observed_at?: string;
  session_id: string;
  model_id?: string;
  compaction_epoch?: number;
}
export interface QuotaWindow {
  account_ref: string;
  provider: string;
  model_scope?: string;
  window: string;
  used_pct?: number;
  reset_at?: string;
  quality: Quality;
  source: string;
  observed_at?: string;
}
export interface CostSample {
  amount?: number;
  currency: string;
  basis: "metered" | "estimated" | "subscription_unknown";
  source: string;
  observed_at?: string;
}
export type ContextResult =
  | { status: "known"; remaining_pct: number }
  | { status: "unknown"; remaining_pct: null }
  | { status: "invalid"; remaining_pct: null; diagnostic: string };
/** Both numbers must come from one sample, for the requested session/epoch. */
export function remainingContext(sample: ContextSample, expected: { session_id: string; compaction_epoch?: number }): ContextResult {
  const { used_tokens: used, max_tokens: max } = sample;
  if ((used !== undefined && (!Number.isFinite(used) || used < 0)) ||
      (max !== undefined && (!Number.isFinite(max) || max <= 0)) ||
      (used !== undefined && max !== undefined && used > max)) {
    return { status: "invalid", remaining_pct: null, diagnostic: "Invalid context token sample" };
  }
  if (sample.quality === "unknown" || sample.session_id !== expected.session_id ||
      sample.compaction_epoch !== expected.compaction_epoch || used === undefined || max === undefined) {
    return { status: "unknown", remaining_pct: null };
  }
  return { status: "known", remaining_pct: (max - used) / max * 100 };
}
export function contextFreshness(sample: ContextSample, now: number, staleAfterMs = 60_000): "fresh" | "stale" | "unknown" {
  const observed = sample.observed_at === undefined ? NaN : Date.parse(sample.observed_at);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now ||
      !Number.isFinite(staleAfterMs) || staleAfterMs < 0) return "unknown";
  return now - observed >= staleAfterMs ? "stale" : "fresh";
}
