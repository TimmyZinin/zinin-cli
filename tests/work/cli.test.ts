import {test,expect} from "bun:test";
import {mkdtempSync,existsSync,writeFileSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CoreJournal} from "../../src/core/journal";
import {WorkCommandService} from "../../src/core/work-service";
import {KimiEngine,kimiTransport} from "../../src/core/engines";
const entry=join(import.meta.dir,"../../src/repl.ts");
const root=()=>mkdtempSync(join(tmpdir(),"zinin-work-cli-"));
async function cli(journal:string,...args:string[]){const p=Bun.spawn([process.execPath,entry,"work",...args,"--journal",journal],{stdin:"ignore",stdout:"pipe",stderr:"pipe"});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,err,code};}
test("child CLI init/session/task/run/status/accept survives reopening without onboarding",async()=>{
 const journal=join(root(),"nested","journal");
 expect((await cli(journal,"status")).code).not.toBe(0);expect(existsSync(journal)).toBe(false);
 expect((await cli(journal,"init","--json")).code).toBe(0);
 expect((await cli(journal,"session","--id","s1","--goal","Проверка","--json")).code).toBe(0);
 expect((await cli(journal,"task","--id","t1","--session","s1","--goal","Проверить импорт","--criteria","Все строки проверены","--json")).code).toBe(0);
 const run=await cli(journal,"run","--task","t1","--engine","local-demo","--json");expect(run.code).toBe(0);expect(run.err).toBe("");
 const text=await cli(journal,"status");expect(text.out).toContain("ждёт приёмки");expect(text.out).not.toContain("onboarding");
 const before=JSON.parse((await cli(journal,"status","--json")).out);const result=before.results[JSON.parse(run.out).result_id];
 expect((await cli(journal,"accept","--result",result.result_id,"--revision",String(result.revision),"--digest",result.digest,"--json")).code).toBe(0);
 const after=JSON.parse((await cli(journal,"status","--json")).out);expect(after.tasks.t1.status).toBe("done");expect(CoreJournal.fold(journal)).toEqual(after);
});
test("a new CLI cannot stop a recorded foreign run or guess its PID",async()=>{
 const journal=join(root(),"journal"),service=new WorkCommandService({journal,leases:journal+".leases"},{create:true});const at=new Date().toISOString();
 service.session("s","s","goal",at);service.task("t","s","t","goal","criteria",at);
 const j=new CoreJournal(journal);for(const [id,type,payload] of [["q","task_transitioned",{task_id:"t",to:"queued"}],["a","task_transitioned",{task_id:"t",to:"active"}],["r","run_started",{run_id:"foreign",task_id:"t",session_id:"s"}]] as const)j.submit({command_id:id,type,payload},at);j.close();
 const stop=await cli(journal,"stop","--run","foreign","--json");expect(stop.code).toBe(0);expect(JSON.parse(stop.out)).toMatchObject({stop_requested:false,message:"Владение неизвестно, процесс не остановлен"});expect(service.state().runs.foreign.status).toBe("running");
});
test("stop cancels only an owned foreground child and records stopped rather than success",async()=>{
 const dir=root(),journal=join(dir,"journal"),bin=join(dir,"fake-kimi");writeFileSync(bin,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`);chmodSync(bin,0o755);
 const service=new WorkCommandService({journal,leases:journal+".leases"},{create:true}),now=new Date().toISOString();service.session("s","s","goal",now);service.task("t","s","t","goal","criteria",now);
 const pending=service.run("t",now,{kind:"engine",name:"fake",adapter:new KimiEngine(kimiTransport(bin),"fake")},{cwd:dir});
 const run=Object.values(service.state().runs)[0];expect(service.stop(run.run_id).stop_requested).toBe(true);
 const result=await pending;expect(result?.error).toContain("cancelled");expect(service.state().runs[run.run_id].status).toBe("stopped");expect(Object.keys(service.state().results)).toHaveLength(0);
});
