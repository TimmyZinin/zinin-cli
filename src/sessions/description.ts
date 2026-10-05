/** Remove list/date scaffolding without interpreting or rewriting the task. */
export function cleanDescription(line: string): string {
  return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\[?\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}| UTC)?)?\]?\s*[—–:|\-]?\s*/, "")
    .replace(/^[*_`]+|[*_`]+$/g, "").replace(/\s+/g, " ").trim();
}
export function meaningfulDescription(line: string): string | null {
  const text = cleanDescription(line);
  if (text.endsWith(":")) return null;
  if ((text.match(/[\p{L}\p{N}]/gu) ?? []).length < 12) return null;
  return text;
}
