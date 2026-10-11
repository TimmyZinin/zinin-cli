/** In-place row writer for the main screen. R17: session rows update in place.
 * Computes the minimal rewrite plan (full redraw on resize/growth, otherwise
 * only changed rows) and applies it to any cell sink, so tests need no PTY.
 */
import type { Row } from "./layout";
export interface Update { index: number; text: string }
export interface FramePlan { full: boolean; height: number; updates: Update[] }
/** Plan a frame: rewrite only rows whose text changed; full redraw when the
 * previous frame is absent or has different height. */
export function planFrame(prev: Row[] | null, next: Row[]): FramePlan {
  if (!prev || prev.length !== next.length) {
    return { full: true, height: next.length, updates: next.map((row, index) => ({ index, text: row.text })) };
  }
  const updates: Update[] = [];
  next.forEach((row, index) => {
    if (prev[index].text !== row.text) updates.push({ index, text: row.text });
  });
  return { full: false, height: next.length, updates };
}
export const escapes = {
  home: "\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  down: (n: number) => `\x1b[${n}B`,
  clearLine: "\x1b[2K",
};
/** Render a plan into a terminal byte sink. */
export function renderPlan(plan: FramePlan, write: (chunk: string) => void): void {
  write(escapes.hideCursor);
  if (plan.full) {
    write(escapes.home);
    for (const u of plan.updates) {
      if (u.index > 0) write(escapes.down(1));
      write(escapes.clearLine + u.text);
    }
    return;
  }
  for (const u of plan.updates) {
    write(escapes.home + (u.index > 0 ? escapes.down(u.index) : "") + escapes.clearLine + u.text);
  }
}
