import { test, expect } from "bun:test";
import { layout, maxTreeSessions, type ScreenProjection } from "../../src/tui/layout";
import { planFrame, renderPlan } from "../../src/tui/render";

function projection(patch: Partial<ScreenProjection> = {}): ScreenProjection {
  return {
    orchestrator: { agent: "orch", engine: "kimi" },
    sessions: [], selected: null, scope: null, run: null, transcript: [],
    todo: [], draft: "", queued: 0, context: null, quota: null, cost: null,
    width: 120, height: 36, ...patch,
  };
}
function session(n: number) {
  return { id: `S0${n}`, service: "svc", group: "grp", agent: `agent-${n}`, engine: "kimi", status: "working", process: `step-${n}` };
}
test("R17: header names the orchestrator; up to seven sessions render in stable slots", () => {
  const rows = layout(projection({ sessions: Array.from({ length: 10 }, (_, i) => session(i + 1)), selected: "S03" }));
  const tree = rows.filter(r => r.id.startsWith("tree-"));
  expect(tree).toHaveLength(maxTreeSessions);
  expect(rows[0].text).toContain("Orchestrator: orch · kimi");
  expect(tree[2].text).toContain("▶");
  expect(tree[2].text).toContain("S03 svc/grp agent-3 kimi working step-3");
  expect(tree[3].text.trim().startsWith("S04")).toBe(true);
});
test("PRD §5: details keep order A scope, B run, C transcript, D todo, E composer, F telemetry", () => {
  const rows = layout(projection({
    scope: "svc/grp/t1", run: "r1/s1", transcript: ["line1", "line2"],
    todo: [{ id: "s1", text: "do", status: "working" }],
    draft: "hello", queued: 2, context: "21k", quota: "80%", cost: "unknown",
    height: 24,
  }));
  const ids = rows.map(r => r.id.split("-")[0]);
  const order = ["header", "tree", "A", "B", "C", "D", "E", "F"].filter(k => ids.includes(k) || rows.some(r => r.id.startsWith(k)));
  const positions = order.map(k => rows.findIndex(r => r.id.startsWith(k)));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(rows[rows.findIndex(r => r.id === "A")].text).toContain("svc/grp/t1");
  expect(rows[rows.findIndex(r => r.id === "E")].text).toContain("hello");
  expect(rows[rows.findIndex(r => r.id === "E")].text).toContain("queued 2");
  expect(rows[rows.findIndex(r => r.id === "F")].text).toContain("context=21k");
});
test("transcript fills remaining height and small screens still keep A..F", () => {
  const rows = layout(projection({ transcript: Array.from({ length: 100 }, (_, i) => `l${i}`), height: 20 }));
  const c = rows.filter(r => r.id.startsWith("C-"));
  expect(c.length).toBeGreaterThan(0);
  expect(c.length).toBeLessThan(100);
  expect(rows.at(-1)?.id).toBe("F");
  expect(rows.at(-2)?.id).toBe("E");
});
test("narrow width switches to compact rows without control characters", () => {
  const rows = layout(projection({ sessions: [session(1)], width: 60 }));
  expect(rows.some(r => r.text.includes("ZININ Orchestrator"))).toBe(true);
  for (const r of rows) expect([...r.text].every(ch => ch >= " " || ch === "›")).toBe(true);
});
test("in-place plan: unchanged frame rewrites nothing; one changed session row rewrites exactly it", () => {
  const a = layout(projection({ sessions: [session(1), session(2)], selected: "S01" }));
  expect(planFrame(a, a).updates).toHaveLength(0);
  const changed = a.map(r => r.id === "tree-S02" ? { ...r, text: r.text.replace("working", "waiting") } : r);
  const plan = planFrame(a, changed);
  expect(plan.full).toBe(false);
  expect(plan.updates).toHaveLength(1);
  expect(plan.updates[0].index).toBe(a.findIndex(r => r.id === "tree-S02"));
  expect(plan.updates[0].text).toContain("waiting");
});
test("resize or first frame plans a full redraw; render emits terminal bytes", () => {
  const a = layout(projection({ height: 20 }));
  const first = planFrame(null, a);
  expect(first.full).toBe(true);
  const b = layout(projection({ height: 24 }));
  expect(planFrame(a, b).full).toBe(true);
  let out = "";
  renderPlan(planFrame(a, a.map(r => ({ ...r }))), (c) => { out += c; });
  expect(out).not.toContain("undefined");
  expect(out.startsWith("\x1b[?25l")).toBe(true);
});
