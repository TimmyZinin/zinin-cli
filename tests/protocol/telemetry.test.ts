import { test, expect } from "bun:test";
import { remainingContext, contextFreshness, type ContextSample } from "../../src/protocol/telemetry";
const sample: ContextSample = { used_tokens: 25, max_tokens: 100, sample_kind: "live_context", quality: "reported", source: "synthetic", session_id: "s1", compaction_epoch: 2, observed_at: "2026-09-24T00:00:00Z" };
const identity = { session_id: "s1", compaction_epoch: 2 };
test("context percent requires both numbers and matching session/compaction epoch", () => {
  expect(remainingContext(sample, identity)).toEqual({ status: "known", remaining_pct: 75 });
  for (const patch of [{ used_tokens: undefined }, { max_tokens: undefined }, { session_id: "s2" }, { compaction_epoch: 3 }, { compaction_epoch: undefined }, { quality: "unknown" as const }]) {
    expect(remainingContext({ ...sample, ...patch }, identity)).toEqual({ status: "unknown", remaining_pct: null });
  }
});
test("impossible samples are diagnosed, not clamped", () => {
  for (const patch of [{ used_tokens: -1 }, { used_tokens: 101 }, { used_tokens: NaN }, { max_tokens: 0 }, { max_tokens: -2 }, { max_tokens: Infinity }]) {
    expect(remainingContext({ ...sample, ...patch }, identity)).toMatchObject({ status: "invalid", remaining_pct: null });
  }
  expect(remainingContext({ ...sample, used_tokens: 0 }, identity)).toEqual({ status: "known", remaining_pct: 100 });
});
test("freshness is separate from reported quality and changes at 60 seconds", () => {
  const observed = Date.parse(sample.observed_at!);
  expect(contextFreshness(sample, observed + 59_999)).toBe("fresh");
  expect(contextFreshness(sample, observed + 60_000)).toBe("stale");
  expect(contextFreshness(sample, observed - 1)).toBe("unknown");
  expect(contextFreshness({ ...sample, observed_at: undefined }, observed)).toBe("unknown");
  expect(contextFreshness({ ...sample, observed_at: "invalid" }, observed)).toBe("unknown");
  expect(sample.quality).toBe("reported");
});
test("billing totals do not become context measurements", () => {
  const billingOnly = { ...sample, used_tokens: undefined, max_tokens: undefined, total_billed_tokens: 500 };
  expect(remainingContext(billingOnly, identity).remaining_pct).toBeNull();
});
