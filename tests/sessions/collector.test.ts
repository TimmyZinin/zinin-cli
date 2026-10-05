import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectNewaSnapshot } from "../../src/sessions/newa-collector";
import { addStatusEstimates } from "../../src/sessions/estimates";
import { parseNewaDir } from "../../src/adapters/sessions/newa-workdir";
import { runCommand } from "../../src/sessions/command";
import { parseRemoteSnapshot } from "../../src/sessions/remote";
import { collect, psMain, type PsOptions } from "../../src/ps";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (minutes: number) => NOW - minutes * 60_000;
const root = () => mkdtempSync(join(tmpdir(), "zinin-e4-collector-"));
const row = (toS0Text: string | null = null, reportText: string | null = null) => parseNewaDir({
  name: "sample", statusText: '{"state":"idle"}', metaText: null,
  taskText: "Проверяет таблицу", toS0Text, reportText, activityMs: NOW - 60_000, nowMs: NOW,
});
const opts: PsOptions = { sources: "all", json: true, watchSeconds: null, stuckMinutes: undefined };
function write(dir: string, name: string, text: string, minutes = 1) {
  const path = join(dir, name); writeFileSync(path, text);
  utimesSync(path, new Date(ago(minutes)), new Date(ago(minutes)));
}
function worker(parent: string, name: string, status = '{"state":"idle"}') {
  const dir = join(parent, name); mkdirSync(dir); write(dir, "status.json", status);
  write(dir, "meta.json", '{"engine":"codex"}'); return dir;
}
const machine = { machine: "newa", memFreeMb: null, diskFreeMb: null, available: true };
const payload = () => ({ sessions: [row()], machines: [{ ...machine }], version: "git-example" });

// Rules agreed by S0: estimates do not rewrite exact evidence.
test("idle question inside the inclusive 20 minute window gets only an estimated waiting group", () => {
  const question = row("2026-10-05T11:40:00Z Вопрос: какой формат?");
  const observed = addStatusEstimates(question, '{"state":"idle"}', NOW, ago(1), NOW);
  expect(observed.overviewGroup).toEqual({ value: "waiting", source: "status-mtime", confidence: "estimate", atMs: NOW });
  expect(observed.decision?.freshness).toBe("unknown");
  expect(observed.needs).toBeNull();
  expect(observed.liveness).toBe("unknown");
});
test("dated old question cannot be freshened by touching TO-S0; text remains", () => {
  const observed = addStatusEstimates(row("2026-10-05T11:39:59Z Вопрос: старый?"), '{"state":"idle"}', NOW, NOW, NOW);
  expect(observed.overviewGroup?.value).toBe("idle");
  expect(observed.decision?.text).toBe("Вопрос: старый?");
});
test("undated question uses file mtime as an estimate with configurable window", () => {
  const question = row("Блокер: нужен выбор формата");
  expect(addStatusEstimates(question, '{"state":"idle"}', NOW, ago(19), NOW).overviewGroup?.value).toBe("waiting");
  expect(addStatusEstimates(question, '{"state":"idle"}', NOW, ago(19), NOW, { questionMinutes: 10 }).overviewGroup?.value).toBe("idle");
  expect(addStatusEstimates(question, '{"state":"idle"}', NOW, null, NOW).decision?.text).toContain("Блокер");
});
test("idle submission and idle without submission have distinct estimated groups", () => {
  expect(addStatusEstimates(row(null, "СДАНО: отчёт"), '{"state":"idle"}', NOW, null, NOW).overviewGroup?.value).toBe("submitted");
  expect(addStatusEstimates(row(), '{"state":"idle"}', NOW, null, NOW).overviewGroup?.value).toBe("idle");
});
test("running keeps working; possibly stuck starts strictly after the configurable threshold", () => {
  const question = row("Вопрос: формат?", "ГОТОВО");
  const recent = addStatusEstimates(question, '{"state":"running"}', ago(20), NOW, NOW);
  expect(recent.overviewGroup?.value).toBe("working");
  expect(recent.possiblyStuck?.value).toBe(false);
  const old = addStatusEstimates(question, '{"state":"running"}', ago(20) - 1, NOW, NOW);
  expect(old.possiblyStuck).toMatchObject({ value: true, confidence: "estimate", source: "status-mtime" });
  expect(old.decision?.text).toBe("Вопрос: формат?");
  expect(addStatusEstimates(question, '{"state":"running"}', ago(11), NOW, NOW, { runningMinutes: 10 }).possiblyStuck?.value).toBe(true);
  expect(addStatusEstimates(question, '{"state":"running"}', null, NOW, NOW).possiblyStuck?.value).toBeNull();
});
test("failed/timeout are stopped turns with reason, not a crash classification", () => {
  for (const state of ["failed", "timeout"]) {
    const observed = addStatusEstimates(row(), JSON.stringify({ state, reason: "лимит времени хода" }), NOW, null, NOW);
    expect(observed.overviewGroup?.value).toBe("stopped");
    expect(observed.stoppedReason).toMatchObject({ value: "лимит времени хода", confidence: "estimate", source: "status-mtime" });
  }
});

test("collector includes real-shaped top-level worker metadata, excludes symlinks and nested content", () => {
  const parent = root(); const work = join(parent, "work"); mkdirSync(work);
  const a = worker(work, "worker-a", '{"state":"running","sequence":2,"completed":1,"reason":null}');
  write(a, "TASK-1.md", "Проверяет импорт"); write(a, "TO-S0.md", "Вопрос: какой формат?");
  mkdirSync(join(a, "turns")); write(join(a, "turns"), "status.json", '{"state":"failed"}');
  mkdirSync(join(a, "inbox")); write(join(a, "inbox"), "TASK.md", "NESTED SENTINEL");
  write(a, "auth.json", "FORBIDDEN SENTINEL");
  const secret = join(parent, "private.txt"); writeFileSync(secret, "FORBIDDEN SENTINEL");
  symlinkSync(secret, join(a, "REPORT-S0.md"));
  symlinkSync(a, join(work, "worker-alias"));
  const result = collectNewaSnapshot({ root: work, nowMs: NOW });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ id: "worker-a", task: "Проверяет импорт", activity: "working", liveness: "unknown", lastSayMs: null });
  expect(result.rows[0].overviewGroup?.value).toBe("working");
  expect(JSON.stringify(result)).not.toContain("SENTINEL");
  expect(result.rows[0].decision?.text).toBe("Вопрос: какой формат?");
  expect(result.machine.available).toBe(true);
});
test("root symlink is rejected; hardlinked inputs cannot expose data", () => {
  const parent = root(); const work = join(parent, "work"); mkdirSync(work);
  const a = worker(work, "a"); const outside = join(parent, "outside"); writeFileSync(outside, "ГОТОВО: forbidden");
  linkSync(outside, join(a, "REPORT-S0.md")); symlinkSync(work, join(parent, "alias"));
  expect(collectNewaSnapshot({ root: join(parent, "alias") }).machine.available).toBe(false);
  const collected = collectNewaSnapshot({ root: work, nowMs: NOW });
  expect(collected.rows[0].lastSubmission).toBeNull();
  expect(collected.machine.warnings?.join(" ")).toContain("single regular file");
});
test("oversized/malformed input is isolated; no input gets silently truncated into evidence", () => {
  const work = root(); const a = worker(work, "a", "not json"); const b = worker(work, "b");
  write(a, "REPORT-S0.md", "ГОТОВО " + "x".repeat(1000)); write(b, "REPORT-S0.md", "ГОТОВО: отчёт");
  const result = collectNewaSnapshot({ root: work, nowMs: NOW, maxBytes: 128 });
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].lastSubmission).toBeNull();
  expect(result.rows[0].overviewGroup?.value).toBe("unknown");
  expect(result.rows[1].lastSubmission?.text).toContain("отчёт");
  expect(result.machine.warnings?.join(" ")).toContain("input limit");
});
test("worker limit and cancellation report partial collection; missing root is unavailable", () => {
  const work = root(); worker(work, "a"); worker(work, "b");
  const partial = collectNewaSnapshot({ root: work, maxWorkers: 1 });
  expect(partial.rows).toHaveLength(1); expect(partial.machine.warnings?.join(" ")).toContain("partial");
  const abort = new AbortController(); abort.abort();
  expect(collectNewaSnapshot({ root: work, signal: abort.signal }).rows).toHaveLength(0);
  expect(collectNewaSnapshot({ root: join(work, "absent") }).machine.available).toBe(false);
});

test("bounded command rejects nonzero exit without echoing stderr", async () => {
  await expect(runCommand([process.execPath, "-e", 'process.stderr.write("sensitive-example"); process.exit(7)'])).rejects.toThrow("command exited with code 7");
});
test("bounded command enforces combined output size and timeout", async () => {
  await expect(runCommand([process.execPath, "-e", 'process.stderr.write("x".repeat(5000))'], { maxBytes: 128 })).rejects.toThrow("output limit");
  const start = Date.now();
  await expect(runCommand([process.execPath, "-e", 'setInterval(() => {}, 1000)'], { timeoutMs: 80 })).rejects.toThrow("timed out");
  expect(Date.now() - start).toBeLessThan(2000);
});
test("bounded command can be cancelled and drains both pipes", async () => {
  expect(await runCommand([process.execPath, "-e", 'process.stderr.write("e".repeat(100000)); process.stdout.write("ok")'])).toBe("ok");
  const abort = new AbortController(); const pending = runCommand([process.execPath, "-e", 'setInterval(() => {}, 1000)'], { signal: abort.signal });
  abort.abort(); await expect(pending).rejects.toThrow("cancelled");
});

test("remote decoder accepts E3 version fallback and preserves E4 estimates/questions", () => {
  const p = payload(); p.sessions[0] = addStatusEstimates(row("Вопрос: формат?"), '{"state":"idle"}', NOW, NOW, NOW);
  const decoded = parseRemoteSnapshot(JSON.stringify(p));
  expect(decoded.machine.version).toBe("git-example");
  expect(decoded.rows[0].overviewGroup?.confidence).toBe("estimate");
  expect(decoded.rows[0].decision?.text).toBe("Вопрос: формат?");
});
test("remote decoder rejects malformed envelopes, spoofed machines, types and estimates atomically", () => {
  for (const mutate of [
    (p: any) => p.sessions.push({ ...row(), machine: "mac" }),
    (p: any) => p.sessions.push(row()),
    (p: any) => p.sessions[0].needs = {},
    (p: any) => p.sessions[0].state = "arbitrary",
    (p: any) => p.sessions[0].weeklyLimitPct = 200,
    (p: any) => p.sessions[0].overviewGroup = { value: "waiting", source: "truth", confidence: "exact", atMs: NOW },
    (p: any) => p.machines[0].available = "yes",
    (p: any) => p.machines = [],
  ]) { const p = payload(); mutate(p); expect(() => parseRemoteSnapshot(JSON.stringify(p))).toThrow(); }
  expect(() => parseRemoteSnapshot("{oops")).toThrow();
  expect(() => parseRemoteSnapshot('{}')).toThrow();
});
test("remote failure and timeout preserve Mac rows and abort the failed source", async () => {
  let aborted = false;
  const good = { rows: [{ ...row(), machine: "mac" as const }], machine: { ...machine, machine: "mac" } };
  const result = await collect(opts, { host: "mac", now: () => NOW, timeoutMs: 20, mac: async () => good,
    remote: async (_now, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("stopped")); })) });
  expect(aborted).toBe(true);
  expect(result.rows).toHaveLength(1); expect(result.rows[0].machine).toBe("mac");
  expect(result.machines.find(m => m.machine === "newa")?.available).toBe(false);
  const malformed = await collect(opts, { host: "mac", now: () => NOW, mac: async () => good, run: async () => '{}', remoteCommand: ["fixture"] });
  expect(malformed.rows).toHaveLength(1);
  expect(malformed.machines.find(m => m.machine === "newa")?.available).toBe(false);
});
test("Mac failure preserves newa rows; injected work root avoids any default live scan", async () => {
  const work = root(); worker(work, "sample-worker");
  const local = await collect(opts, { host: "newa", now: () => NOW, newaOptions: { root: work } });
  expect(local.rows.map(r => r.id)).toEqual(["sample-worker"]);
  const remote = await collect(opts, { host: "mac", now: () => NOW, mac: async () => { throw new Error("unavailable"); }, remote: async () => ({ rows: [row()], machine }) });
  expect(remote.rows[0].machine).toBe("newa"); expect(remote.machines[0].available).toBe(false);
});
test("watch performs sequential collections and removes its signal handlers on stop", async () => {
  let active = 0, maximum = 0, calls = 0;
  const before = process.listenerCount("SIGINT");
  await psMain(["--sources", "newa", "--watch", "1", "--json"], { host: "newa", newa: async () => {
    maximum = Math.max(maximum, ++active); calls++;
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    if (calls === 2) process.emit("SIGINT");
    return { rows: [], machine };
  } });
  expect(maximum).toBe(1); expect(calls).toBe(2); expect(active).toBe(0);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

test("remote decoder drops unknown nested evidence fields", () => {
  const p = payload();
  p.sessions[0] = row("Вопрос: формат?");
  (p.sessions[0].decision as any).untrusted = { text: "untrusted-extra" };
  expect(JSON.stringify(parseRemoteSnapshot(JSON.stringify(p)))).not.toContain("untrusted-extra");
});
test("collector skips empty TASK bodies and reports the exact selected file or bounded README fallback", () => {
  const work = root(); const a=worker(work,"described"), b=worker(work,"readme"), c=worker(work,"linked-readme");
  write(a,"TASK-a.md","# Задание\n```text\nПример\n```\n");
  write(a,"TASK-b.md","# Задание\nПроверяет второе задание");
  write(a,"REPORT-S0.md","СТАТУС: Запасное описание");
  write(b,"README.md","# Проект readme\nПроверяет доставку");
  symlinkSync(join(b,"README.md"),join(c,"README.md"));
  const result=collectNewaSnapshot({root:work,nowMs:NOW});
  expect(result.rows.find(r=>r.id==="described")).toMatchObject({task:"Проверяет второе задание",taskSource:"TASK-b.md"});
  expect(result.rows.find(r=>r.id==="readme")).toMatchObject({task:"Проверяет доставку",taskSource:"README.md"});
  expect(result.rows.find(r=>r.id==="linked-readme")?.taskSource).toBe("directory-name");
});
test("remote preserves description provenance and rejects invalid provenance or filtered snapshots", () => {
  const p=payload(); p.sessions[0].taskSource="TASK-example.md";
  expect(parseRemoteSnapshot(JSON.stringify(p)).rows[0].taskSource).toBe("TASK-example.md");
  expect(()=>parseRemoteSnapshot(JSON.stringify({...p,hidden_count:1}))).toThrow();
  (p.sessions[0] as any).taskSource={unexpected:true};
  expect(()=>parseRemoteSnapshot(JSON.stringify(p))).toThrow();
});
test("portable collector reads through normal paths while rejecting linked roots, workers and files", () => {
  const work=root(); const a=worker(work,"real");
  write(a,"REPORT-S0.md","СДАНО: переносимый сбор проверен");
  symlinkSync(a,join(work,"linked-worker"));
  const b=worker(work,"linked-files");
  symlinkSync(join(a,"REPORT-S0.md"),join(b,"REPORT-S0.md"));
  linkSync(join(a,"meta.json"),join(b,"TASK-hardlink.md"));
  const result=collectNewaSnapshot({root:work,nowMs:NOW,pathMode:"portable"});
  expect(result.rows.map(r=>r.id)).toEqual(["linked-files","real"]);
  expect(result.rows.find(r=>r.id==="real")?.lastSubmission?.text).toContain("переносимый");
  expect(result.rows.find(r=>r.id==="linked-files")?.lastSubmission).toBeNull();
  expect(result.machine.warnings?.join(" ")).toContain("single regular file");
  const parent=root(); symlinkSync(work,join(parent,"root-link"));
  expect(collectNewaSnapshot({root:join(parent,"root-link"),pathMode:"portable"}).machine.available).toBe(false);
  // Same shape as macOS /var/folders -> /private/var/folders: only an
  // ancestor is a symlink, the requested root itself is a real directory.
  const grand=root(); const actual=join(grand,"actual"); mkdirSync(actual); const nested=join(actual,"work"); mkdirSync(nested); worker(nested,"sample");
  symlinkSync(actual,join(grand,"ancestor"));
  expect(collectNewaSnapshot({root:join(grand,"ancestor","work"),nowMs:NOW,pathMode:"portable"}).rows.map(r=>r.id)).toEqual(["sample"]);
});
