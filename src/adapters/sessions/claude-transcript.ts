/** E3 adapter: tail of a Claude transcript (~/.claude/projects/<proj>/<id>.jsonl).
 * Pure text-in; the live wrapper reads the last 64 KiB. Structural parsing
 * (round 3, N-1): transcripts are JSONL, so we read fields, never grep raw
 * text — "interrupted":false, "is_error":false and a stray "403" inside an
 * assistant sentence must not light up STUCK-ON or the limit state.
 */
export interface TranscriptFacts {
  stuckOn: string | null;
  contextPct: number | null;
  weeklyLimitPct: number | null;
}
function clip(value: string, max = 120): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}
/** A tool result or content item that failed (Bash non-zero exit etc.). */
function hasFailedTool(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.is_error === true) return true;
  if (Array.isArray(record.content)) {
    return record.content.some(part =>
      typeof part === "object" && part !== null && (part as Record<string, unknown>).is_error === true);
  }
  return false;
}
/** Structural API error: {"type":"error",...} or a string error field. */
function apiErrorText(value: Record<string, unknown>): string | null {
  if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  if (value.type === "error" && typeof value.error === "object" && value.error !== null) {
    const err = value.error as Record<string, unknown>;
    if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
  }
  return null;
}
export function parseTranscriptTail(text: string): TranscriptFacts {
  let stuckOn: string | null = null;
  let contextPct: number | null = null;
  let weeklyLimitPct: number | null = null;
  let failedToolSeen = false;   // an is_error:true not yet answered by the assistant
  let apiErrorSeen: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; } // transcript lines are JSON; raw prose is ignored
    if (hasFailedTool(msg)) failedToolSeen = true;
    if (msg.role === "assistant") {
      const content = msg.content;
      const textPart = Array.isArray(content)
        ? content.filter(part => (part as Record<string, unknown>).type === "text")
            .map(part => String((part as Record<string, unknown>).text ?? "")).join(" ")
        : typeof content === "string" ? content : "";
      const weekly = /You've used\s+(\d+)%\s+of your weekly limit/i.exec(textPart);
      if (weekly) weeklyLimitPct = Number(weekly[1]);
      const ctx = /(?:context|compaction)[^0-9%]{0,24}(\d{1,3})%/i.exec(textPart);
      if (ctx) contextPct = Number(ctx[1]);
      // A real assistant reply after a failed tool means the session moved on.
      if (textPart.trim() || (Array.isArray(content) && content.some(part =>
        (part as Record<string, unknown>).type === "tool_use"))) {
        if (failedToolSeen) failedToolSeen = false;
      }
    }
    const apiError = apiErrorText(msg);
    if (apiError) {
      apiErrorSeen = apiError;
      const weekly = /You've used\s+(\d+)%\s+of your weekly limit/i.exec(apiError);
      if (weekly) weeklyLimitPct = Number(weekly[1]);
    }
  }
  if (apiErrorSeen) stuckOn = clip(apiErrorSeen);
  else if (failedToolSeen) stuckOn = "tool error (is_error) with no assistant reply after";
  return { stuckOn, contextPct, weeklyLimitPct };
}
