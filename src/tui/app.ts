/** Live main screen: journal-backed selection, per-session drafts, local
 * commands (/task, /accept), in-place rendering. All decisions live here so
 * tests drive the app without a PTY; runScreen() is a thin stdin/stdout loop.
 */
import { CoreJournal } from "../core/journal";
import { HistoryCache } from "../core/history";
import { project } from "./projection";
import { layout, type Row } from "./layout";
import { planFrame, renderPlan, escapes } from "./render";
import { KeyParser, type Key } from "./input";

export class ScreenApp {
  journal: CoreJournal;
  selected: string | null = null;
  drafts = new Map<string, string>();
  queued = 0;
  width = 120;
  height = 36;
  private rows: Row[] | null = null;
  private counter = 0;
  constructor(path: string, private write: (chunk: string) => void, private exitProcess: () => void) {
    this.journal = new CoreJournal(path);
    this.selected = this.sessions()[0]?.session_id ?? null;
  }
  close() { this.journal.close(); }
  private sessions() {
    return Object.values(this.journal.state.sessions).filter(s => s.status === "open").sort((a, b) => a.session_id.localeCompare(b.session_id));
  }
  private keyOf() { return this.selected ?? "none"; }
  private move(delta: number) {
    const ids = this.sessions().map(s => s.session_id);
    if (!ids.length) return;
    const at = this.selected ? ids.indexOf(this.selected) : -1;
    this.selected = ids[(at + delta + ids.length) % ids.length];
    this.render();
  }
  key(k: Key): void {
    if (k.kind === "up") return void this.move(-1);
    if (k.kind === "down") return void this.move(1);
    if (k.kind === "ctrl+d") { this.exitProcess(); return; }
    if (k.kind === "ctrl+c") {
      if (this.drafts.get(this.keyOf())) { this.drafts.set(this.keyOf(), ""); this.render(); }
      else this.exitProcess();
      return;
    }
    const draft = this.drafts.get(this.keyOf()) ?? "";
    if (k.kind === "char") { this.drafts.set(this.keyOf(), draft + k.value); this.render(); }
    else if (k.kind === "backspace") { this.drafts.set(this.keyOf(), Array.from(draft).slice(0, -1).join("")); this.render(); }
    else if (k.kind === "enter") { this.submit(draft); this.render(); }
  }
  /** Local commands on the composer. Plain text is captured for the working
   * cycle module; no external action is taken from this screen. */
  private submit(draft: string) {
    if (!draft) return;
    if (draft.startsWith("/task ")) {
      const session = this.selected ? this.journal.state.sessions[this.selected] : undefined;
      if (!session) return;
      this.command("task_created", { task_id: `t-${++this.counter}-${Date.now() % 100000}`, session_id: session.session_id, goal: draft.slice(6), criteria: "human acceptance" });
      this.drafts.set(this.keyOf(), "");
    } else if (draft === "/accept") {
      this.acceptLatest();
      this.drafts.set(this.keyOf(), "");
    } else if (!draft.startsWith("/")) {
      this.queued++;
      this.drafts.set(this.keyOf(), "");
    }
  }
  /** Human acceptance (R06): decide the latest recorded result of the
   * selected session's task, move through finalizing, take a durable local
   * checkpoint (journal snapshot), then done. */
  private acceptLatest() {
    const state = this.journal.state;
    const session = this.selected ? state.sessions[this.selected] : undefined;
    if (!session) return;
    const task = Object.values(state.tasks).filter(t => t.session_id === session.session_id).at(-1);
    if (!task) return;
    const result = Object.values(state.results).filter(r => r.task_id === task.task_id && r.status === "recorded").at(-1);
    if (!result) return;
    const stamp = new Date().toISOString();
    this.command("result_decided", { result_id: result.result_id, decision: "accepted", decided_by: "user" });
    if (this.journal.state.tasks[task.task_id].status === "review_ready") {
      this.command("task_transitioned", { task_id: task.task_id, to: "finalizing" });
      this.journal.snapshot(stamp);
      this.command("task_transitioned", { task_id: task.task_id, to: "done" });
    }
  }
  private command(type: Parameters<CoreJournal["submit"]>[0]["type"], payload: Record<string, unknown>) {
    try {
      this.journal.submit({ command_id: `${type}-${++this.counter}-${Date.now() % 100000}`, type, payload: payload as never }, new Date().toISOString());
    } catch { /* stale or illegal command: screen shows facts, does not invent */ }
  }
  render(): void {
    const state = this.journal.state;
    let transcript: string[] = [];
    const session = this.selected ? state.sessions[this.selected] : null;
    if (session) {
      const task = Object.values(state.tasks).filter(t => t.session_id === session.session_id).at(-1);
      const run = task ? Object.values(state.runs).filter(r => r.task_id === task.task_id).at(-1) : undefined;
      if (run) transcript = new HistoryCache(state, run.run_id).tail(50).map(l => l.text);
    }
    const patch = {
      selected: this.selected, draft: this.drafts.get(this.keyOf()) ?? "",
      queued: this.queued, width: this.width, height: this.height, transcript,
    };
    const rows = layout(project(state, this.selected, patch));
    renderPlan(planFrame(this.rows, rows), this.write);
    this.rows = rows;
  }
}
/** Thin terminal loop; all testable behaviour lives in ScreenApp. */
export function runScreen(path: string): void {
  const app = new ScreenApp(path, c => process.stdout.write(c), () => { quit = true; });
  const parser = new KeyParser();
  let quit = false;
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdout.write(escapes.hideCursor);
  const resize = () => { app.width = process.stdout.columns || 120; app.height = process.stdout.rows || 36; app.render(); };
  process.stdout.on("resize", resize); resize();
  process.stdin.on("data", (chunk: Buffer) => { for (const k of parser.push(chunk.toString())) app.key(k); });
  const timer = setInterval(() => { if (quit) { clearInterval(timer); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write(escapes.showCursor); app.close(); process.exit(0); } app.render(); }, 200);
}
