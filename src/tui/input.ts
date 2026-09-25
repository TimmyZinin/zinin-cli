/** Keyboard input framing for the main screen. Stateful: escape sequences
 * split across chunks are held until complete. Mirrors the renderer spike's
 * input semantics without its synthetic dispatch.
 */
export type Key =
  | { kind: "char"; value: string }
  | { kind: "up" } | { kind: "down" }
  | { kind: "pgup" } | { kind: "pgdown" }
  | { kind: "enter" } | { kind: "escape" }
  | { kind: "ctrl+c" } | { kind: "ctrl+d" } | { kind: "backspace" };
export class KeyParser {
  private pending = "";
  push(chunk: string): Key[] {
    this.pending += chunk;
    const keys: Key[] = [];
    while (this.pending.length) {
      const p = this.pending;
      if (p.startsWith("\x1b[A")) { keys.push({ kind: "up" }); this.pending = p.slice(3); continue; }
      if (p.startsWith("\x1b[B")) { keys.push({ kind: "down" }); this.pending = p.slice(3); continue; }
      if (p.startsWith("\x1b[5~")) { keys.push({ kind: "pgup" }); this.pending = p.slice(4); continue; }
      if (p.startsWith("\x1b[6~")) { keys.push({ kind: "pgdown" }); this.pending = p.slice(4); continue; }
      if (p === "\x1b" || p.startsWith("\x1b[")) break; // wait for more bytes
      const c = Array.from(p)[0];
      this.pending = p.slice(c.length);
      if (c === "\r") keys.push({ kind: "enter" });
      else if (c === "\x1b") keys.push({ kind: "escape" });
      else if (c === "\x03") keys.push({ kind: "ctrl+c" });
      else if (c === "\x04") keys.push({ kind: "ctrl+d" });
      else if (c === "\x7f") keys.push({ kind: "backspace" });
      else if (c >= " ") keys.push({ kind: "char", value: c });
    }
    return keys;
  }
}
