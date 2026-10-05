import {test,expect} from "bun:test";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {CoreJournal} from "../../src/core/journal";
import {WorkCommandService} from "../../src/core/work-service";
import {renderWorkStatus} from "../../src/work";
const entry=join(import.meta.dir,"../../src/repl.ts"),module=join(import.meta.dir,"../../src/core/work-service.ts");
const now="2026-10-05T21:00:00Z";
function fixture(){const dir=mkdtempSync(join(tmpdir(),"zinin-recovery-")),paths={journal:join(dir,"journal"),leases:join(dir,"leases")},service=new WorkCommandService(paths,{create:true});service.session("s","session-one","goal",now);service.task("t","session-one","task-one","goal","criteria",now);return {dir,paths,service};}
async function cli(journal:string,...args:string[]){const child=Bun.spawn([process.execPath,entry,"work",...args,"--journal",journal],{stdin:"ignore",stdout:"pipe",stderr:"pipe"});const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,err,code};}
test("kill after run_started: reopen is read-only, unknown ownership cannot stop or restart the run",async()=>{
 const {dir,paths,service}=fixture(),marker=join(dir,"calls");
 const code=`import {WorkCommandService} from ${JSON.stringify(module)};import {appendFileSync} from 'node:fs';const service=new WorkCommandService(${JSON.stringify(paths)});await service.run('task-one',${JSON.stringify(now)},{kind:'engine',name:'fake',adapter:{run:async()=>{appendFileSync(${JSON.stringify(marker)},'called\\n');process.stdout.write('started\\n');return await new Promise(()=>setInterval(()=>{},1000));}}});`;
 const child=Bun.spawn([process.execPath,"-e",code],{stdin:"ignore",stdout:"pipe",stderr:"pipe"});const reader=child.stdout.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const ready=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("fixture child startup timeout")),10000);})]);
  expect(new TextDecoder().decode(ready.value)).toContain("started");
  expect(Object.values(service.state().runs)[0].status).toBe("running");
 }finally {if(timer)clearTimeout(timer);child.kill("SIGKILL");await child.exited;await reader.cancel();}
 const before=service.state();expect(Object.keys(before.results)).toHaveLength(0);
 const status=await cli(paths.journal,"status");expect(status.code).toBe(0);expect(status.out).toContain("владение неизвестно");expect(status.out).toContain("выполняются: 1");
 const rerun=await cli(paths.journal,"run","--task","t1","--engine","local-demo");expect(rerun.code).toBe(1);expect(rerun.err).toContain("незавершённый запуск");
 const stop=await cli(paths.journal,"stop","--run","r1");expect(stop.code).toBe(0);expect(stop.out).toContain("Владение неизвестно, процесс не остановлен");
 expect(readFileSync(marker,"utf8")).toBe("called\n");expect(service.state()).toEqual(before);expect(CoreJournal.fold(paths.journal)).toEqual(before);
},30_000);
test("explicit accept retry after a durable decision completes finalization once without running an engine",async()=>{
 const {paths,service}=fixture();await service.run("task-one",now,{kind:"local-demo"});const result=Object.values(service.state().results)[0],command="accept-after-interruption";
 const journal=new CoreJournal(paths.journal);journal.submit({command_id:`work:${createHash("sha256").update(command).digest("hex")}:request`,type:"result_decided",payload:{result_id:result.result_id,decision:"accepted",decided_by:"user",expected_revision:result.revision,expected_digest:result.digest}},now);journal.close();
 const reopened=new WorkCommandService(paths);expect(reopened.state().tasks["task-one"].status).toBe("review_ready");expect(Object.keys(reopened.state().runs)).toHaveLength(1);
 reopened.accept(command,result.result_id,result.revision,result.digest,now);const done=reopened.state();expect(done.tasks["task-one"].status).toBe("done");
 reopened.accept(command,result.result_id,result.revision,result.digest,now);expect(reopened.state()).toEqual(done);expect(Object.keys(done.runs)).toHaveLength(1);expect(done.results[result.result_id].text).toBe(result.text);
});
test("owned foreground run is distinguished from a read-only reopened view",async()=>{
 const {paths,service}=fixture();let finish!:(value:{text:string;provider_session:null})=>void;
 const pending=service.run("task-one",now,{kind:"engine",name:"fake",adapter:{run:async()=>await new Promise(resolve=>finish=resolve)}});
 expect(renderWorkStatus(service.state(),paths.journal,service.ownedRunIds())).toContain("свой процесс");
 expect(renderWorkStatus(new WorkCommandService(paths).state())).toContain("владение неизвестно");
 finish({text:"done",provider_session:null});await pending;expect(service.ownedRunIds().size).toBe(0);
});
