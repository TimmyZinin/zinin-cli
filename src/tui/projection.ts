/** Main screen projection from core journal state (PRD §6: TUI reads
 * projections, the daemon owns the journal). Deterministic: sessions sorted
 * by S-ID, statuses derived from tasks/runs/steps, no wall clock.
 */
import type { CoreState } from "../core/journal";
import type { ScreenProjection, SessionRow, TodoItem } from "./layout";

export function project(state: CoreState, selected: string | null, patch: Partial<ScreenProjection> = {}): ScreenProjection {
  const orch = Object.values(state.agents).find(a => a.role === "orchestrator") ?? null;
  const sessions: SessionRow[] = Object.values(state.sessions)
    .filter(s => s.status === "open")
    .sort((a, b) => a.session_id.localeCompare(b.session_id))
    .map(s => {
      const agent = state.agents[s.agent_id];
      const tasks = Object.values(state.tasks).filter(t => t.session_id === s.session_id);
      const taskIds = new Set(tasks.map(t => t.task_id));
      const runs = Object.values(state.runs).filter(r => taskIds.has(r.task_id));
      const working = runs.some(r => r.status === "running");
      const reviewing = !working && tasks.some(t => t.status === "review_ready" || t.status === "finalizing");
      const steps = Object.values(state.steps).filter(st => taskIds.has(st.task_id));
      const current = steps.find(st => st.status === "working");
      const lastRun = runs.at(-1);
      return {
        id: s.session_id, service: s.service, group: s.group,
        agent: agent?.role ?? s.agent_id, engine: agent?.engine ?? "unknown",
        status: working ? "working" : reviewing ? "review" : "waiting",
        process: current ? `step ${current.step_id}` : lastRun ? `run ${lastRun.run_id} ${lastRun.status}` : "idle",
      };
    });
  const chosen = selected && state.sessions[selected] ? selected : (sessions[0]?.id ?? null);
  const session = chosen ? state.sessions[chosen] : null;
  const task = session
    ? Object.values(state.tasks).filter(t => t.session_id === session.session_id).at(-1) ?? null
    : null;
  const todo: TodoItem[] = task
    ? Object.values(state.steps).filter(st => st.task_id === task.task_id).map(st => ({ id: st.step_id, text: st.owner, status: st.status }))
    : [];
  const run = task ? Object.values(state.runs).filter(r => r.task_id === task.task_id).at(-1) : undefined;
  const required = todo.filter(t => t.status !== "failed").length;
  return {
    orchestrator: orch ? { agent: orch.role, engine: orch.engine } : null,
    sessions, selected: chosen,
    scope: session && task ? `${session.service}/${session.group}/${task.goal}` : session ? `${session.service}/${session.group}` : null,
    run: run && task ? `${run.run_id} ${run.status} task=${task.task_id} steps=${todo.filter(t => t.status === "done").length}/${required}` : null,
    transcript: [],
    todo,
    draft: "", queued: 0,
    context: null, quota: null, cost: null,
    width: 120, height: 36,
    ...patch,
  };
}
