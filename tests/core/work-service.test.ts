import {test,expect} from "bun:test";
import {mkdtempSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {CoreJournal} from "../../src/core/journal";
import {WorkCommandService} from "../../src/core/work-service";
import {LocalExecutor} from "../../src/core/executor";
const NOW="2026-10-05T20:00:00Z";
function setup(){
 const root=mkdtempSync(join(tmpdir(),"zinin-work-service-"));
 const paths={journal:join(root,"journal.sqlite"),leases:join(root,"leases.sqlite")};
 const service=new WorkCommandService(paths,{create:true});
 service.session("open-a","session-a","Первая работа",NOW);service.session("open-b","session-b","Вторая работа",NOW);
 service.task("task-a","session-a","a-first","Первая задача","Проверка A",NOW);
 service.task("task-b","session-b","z-selected","Выбранная задача","Проверка B",NOW);
 return {paths,service};
}
test("explicit init required; task creation never runs an engine or opens leases",()=>{
 const root=mkdtempSync(join(tmpdir(),"zinin-work-init-"));const paths={journal:join(root,"j.sqlite"),leases:join(root,"l.sqlite")};
 expect(()=>new WorkCommandService(paths)).toThrow("init required");expect(existsSync(paths.journal)).toBe(false);
 const {service,paths:p}=setup();expect(Object.keys(service.state().runs)).toHaveLength(0);expect(existsSync(p.leases)).toBe(false);
});
test("addressed run executes the selected task only and leaves result for explicit acceptance",async()=>{
 const {service,paths}=setup();const calls:string[]=[];
 const summary=await service.run("z-selected",NOW,{kind:"engine",name:"fake-test",adapter:{run:async prompt=>{calls.push(prompt);return {text:"Проверенный результат",provider_session:"fake-session"}}}});
 expect(calls).toHaveLength(1);expect(calls[0]).toContain("Выбранная задача");expect(calls[0]).not.toContain("Первая задача");
 const state=service.state();expect(state.tasks["a-first"].status).toBe("draft");expect(state.tasks["z-selected"].status).toBe("review_ready");
 const result=state.results[summary!.result_id!];expect(result.status).toBe("recorded");expect(state.runs[summary!.run_id].session_id).toBe("session-b");
 expect(await service.run("z-selected",NOW,{kind:"local-demo"})).toBeNull();
 const accepted=service.accept("accept-b",result.result_id,result.revision,result.digest,NOW);
 expect(accepted.duplicate).toBe(false);expect(service.state().tasks["z-selected"].status).toBe("done");
 const reopened=new WorkCommandService(paths);expect(reopened.state()).toEqual(CoreJournal.fold(paths.journal));
 const before=reopened.state();expect(reopened.accept("accept-b",result.result_id,result.revision,result.digest,NOW).duplicate).toBe(true);expect(reopened.state()).toEqual(before);
});
test("wrong revision/digest and stale displayed revision cannot mutate acceptance or another task",async()=>{
 const {service,paths}=setup();await service.run("z-selected",NOW,{kind:"local-demo"});const result=Object.values(service.state().results)[0];
 const before=service.state();
 expect(()=>service.accept("bad-revision",result.result_id,2,result.digest,NOW)).toThrow("revision/digest");
 expect(()=>service.accept("bad-digest",result.result_id,1,"different",NOW)).toThrow("revision/digest");
 expect(service.state()).toEqual(before);
 const j=new CoreJournal(paths.journal);j.submit({command_id:"new-result",type:"result_recorded",payload:{result_id:"new-revision",task_id:result.task_id,revision:2,digest:"new-digest",evidence_ref:"new-evidence"}},NOW);j.close();
 expect(()=>service.accept("stale-result",result.result_id,1,result.digest,NOW)).toThrow("newer result");
 expect(service.state().results[result.result_id].status).toBe("recorded");
 service.accept("accept-new","new-revision",2,"new-digest",NOW);expect(service.state().tasks["z-selected"].version).toBe(2);expect(service.state().tasks["a-first"].status).toBe("draft");
});
test("same command_id replays identically and rejects changed payload or action",()=>{
 const {service}=setup();const before=service.state();
 expect(service.task("task-b","session-b","z-selected","Выбранная задача","Проверка B",NOW).duplicate).toBe(true);
 expect(service.state()).toEqual(before);
 expect(()=>service.task("task-b","session-a","different","Иная задача","criteria",NOW)).toThrow("different payload");
 expect(()=>service.closeSession("task-b","session-b",NOW)).toThrow("different payload");expect(service.state()).toEqual(before);
});
test("two open journals validate bindings against the latest committed state",async()=>{
 const {service,paths}=setup();await service.run("z-selected",NOW,{kind:"local-demo"});
 const stale=new CoreJournal(paths.journal),latest=new CoreJournal(paths.journal);const result=Object.values(stale.state.results)[0];
 latest.submit({command_id:"r2",type:"result_recorded",payload:{result_id:"revision-2",task_id:result.task_id,revision:2,digest:"digest-2",evidence_ref:"e2"}},NOW);
 expect(()=>stale.submit({command_id:"accept-stale",type:"result_decided",payload:{result_id:result.result_id,decision:"accepted",decided_by:"user",expected_revision:result.revision,expected_digest:result.digest}},NOW)).toThrow("newer result");
 stale.close();latest.close();expect(service.state().results["revision-2"]).toBeDefined();
});
test("in-flight run prevents duplicate execution and closing its session without touching another",async()=>{
 const {service}=setup();let finish!:(value:{text:string;provider_session:null})=>void;let calls=0;
 const pending=service.run("z-selected",NOW,{kind:"engine",name:"fake",adapter:{run:async()=>{calls++;return new Promise(resolve=>{finish=resolve})}}});
 await expect(service.run("z-selected",NOW,{kind:"local-demo"})).rejects.toThrow("active run");
 expect(()=>service.closeSession("close-b","session-b",NOW)).toThrow("active run");
 service.closeSession("close-a","session-a",NOW);
 finish({text:"готово",provider_session:null});await pending;
 expect(calls).toBe(1);expect(service.state().sessions["session-b"].status).toBe("open");
});
test("missing or closed target never falls back to the first runnable task",async()=>{
 const {service,paths}=setup();const executor=new LocalExecutor(paths.journal,paths.leases);
 await expect(executor.runTask("missing",NOW)).rejects.toThrow("missing");executor.close();
 service.closeSession("close-b","session-b",NOW);
 await expect(service.run("z-selected",NOW,{kind:"local-demo"})).rejects.toThrow("closed");
 await expect(service.run("a-first",NOW,undefined as any)).rejects.toThrow("Explicit engine");
 expect(Object.values(service.state().runs)).toHaveLength(0);expect(service.state().tasks["a-first"].status).toBe("draft");
});
test("failed adapter is recorded once without automatic retry or acceptance",async()=>{
 const {service}=setup();let calls=0;
 const result=await service.run("z-selected",NOW,{kind:"engine",name:"fake",adapter:{run:async()=>{calls++;throw Error("fixture failure")}}});
 expect(calls).toBe(1);expect(result?.error).toBe("fixture failure");expect(result?.result_id).toBeNull();expect(result?.steps_done).toEqual([]);
 expect(Object.values(service.state().results)).toHaveLength(0);expect(Object.values(service.state().runs)[0].status).toBe("failed");
});
test("explicit demo output is labelled in durable evidence",async()=>{
 const {service}=setup();await service.run("z-selected",NOW,{kind:"local-demo"});
 expect(Object.values(service.state().results)[0].evidence_ref).toContain("mode:local-demo");
 expect(Object.values(service.state().runs)[0].provider_session).toBe("local-demo");
});
