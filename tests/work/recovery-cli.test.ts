import {test,expect} from "bun:test";import {join,dirname} from "node:path";import {readFileSync,existsSync} from "node:fs";import {fixture} from "./reconcile.test";import {WorkScreen} from "../../src/tui/work-screen";
const entry=join(import.meta.dir,"../../src/repl.ts");
async function cli(journal:string,...args:string[]){const p=Bun.spawn([process.execPath,entry,"work",...args,"--journal",journal],{stdin:"ignore",stdout:"pipe",stderr:"pipe"});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,err,code};}
test("child CLI previews reconciles starts a numbered attempt and reads history/export",async()=>{
 const {paths,service}=fixture(),before=service.state();const preview=await cli(paths.journal,"reconcile","--run","r1","--as","lost","--reason","owner checked","--json");expect(preview.code).toBe(0);expect(JSON.parse(preview.out).confirmation_required).toBe(true);expect(service.state()).toEqual(before);
 const confirmed=await cli(paths.journal,"reconcile","--run","r1","--as","lost","--reason","owner checked","--confirm","--json");expect(confirmed.code).toBe(0);expect(confirmed.err).toContain("последнее событие");expect(confirmed.err).toContain("процесс мог остаться жив");
 expect((await cli(paths.journal,"run","--task","t1","--engine","local-demo")).code).toBe(1);
 const started=await cli(paths.journal,"run","--task","t1","--engine","local-demo","--attempt","2","--json");expect(started.code).toBe(0);
 const status=await cli(paths.journal,"status");expect(status.out).toContain("новый запуск, не продолжение");expect(status.out).toContain("revision=2");
 const history=await cli(paths.journal,"history","--task","t1","--json");expect(history.code).toBe(0);expect(JSON.parse(history.out).some((e:any)=>e.type==="run_reconciled")).toBe(true);
 const out=join(dirname(paths.journal),"cli.jsonl");expect((await cli(paths.journal,"export","--out",out)).code).toBe(0);expect(readFileSync(out,"utf8")).toContain('"run_reconciled"');
 const absent=join(dirname(paths.journal),"absent");expect((await cli(absent,"init","--remote","newa")).code).toBe(2);expect(existsSync(absent)).toBe(false);
});
test("TUI reconciliation exposes task session and last event before second Enter",async()=>{
 const {service}=fixture();let output="";const app=new WorkScreen(service,s=>output+=s,()=>{});
 app.key({kind:"char",value:'reconcile --run r1 --as lost --reason "owner checked"'});app.key({kind:"enter"});expect(service.state().runs["run-task-one-1"].status).toBe("running");expect(app.message).toContain("последнее событие");expect(app.message).toContain("session-one");expect(app.message).toContain("task-one");
 app.key({kind:"enter"});await Promise.all([...app.pending]);expect(service.state().runs["run-task-one-1"].status).toBe("interrupted");
});
