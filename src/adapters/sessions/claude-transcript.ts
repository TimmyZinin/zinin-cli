/** E3 adapter: tail of a Claude transcript (~/.claude/projects/<proj>/<id>.jsonl).
 * Pure text-in; the live wrapper reads the last chunk of the file. We surface
 * what the window status line cannot: hard errors, interrupts, limit hits.
 */
export interface TranscriptFacts {
  stuckOn: string | null;
  contextPct: number | null;
  weeklyLimitPct: number | null;
}
function clip(value: string, max = 120): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}
/** Prefer a human-readable fragment if the line is JSON. */
function readable(line: string): string {
  try {
    const msg = JSON.parse(line) as { message?: { content?: unknown }; error?: unknown; type?: string };
    const content = msg.message?.content;
    if (typeof content === "string") return clip(content);
    if (Array.isArray(content)) {
      const text = content.map(part => (part as { text?: string }).text ?? "").filter(Boolean).join(" ");
      if (text.trim()) return clip(text.trim());
    }
    if (typeof msg.error === "string") return clip(msg.error);
  } catch { /* not JSON — use raw */ }
  return clip(line.trim());
}
export function parseTranscriptTail(text: string): TranscriptFacts {
  let stuckOn: string | null = null;
  let contextPct: number | null = null;
  let weeklyLimitPct: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const weekly = /You've used\s+(\d+)%\s+of your weekly limit/i.exec(line);
    if (weekly) weeklyLimitPct = Number(weekly[1]);
    const ctx = /(?:context|compaction)[^0-9%]{0,24}(\d{1,3})%/i.exec(line);
    if (ctx) contextPct = Number(ctx[1]);
    if (/Interrupted|\bERROR\b|\berror\b|"error"|403|rate_limit|rate limit|limit reached|timed out/i.test(line)) {
      stuckOn = readable(line);
    }
  }
  return { stuckOn, contextPct, weeklyLimitPct };
}
