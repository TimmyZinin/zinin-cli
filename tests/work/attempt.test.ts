import {test,expect} from "bun:test";import {fixture,now} from "./reconcile.test";import {CoreJournal} from "../../src/core/journal";import {renderWorkStatus} from "../../src/work";
test("explicit next attempt after reconciliation preserves prior result and binds acceptance to new revision",async()=>{
 const {paths,service}=fixture(),preview=service.reconcilePreview("run-task-one-1");
 const j=new CoreJournal(paths.journal);j.submit({command_id:"old-result",type:"result_recorded",payload:{result_id:"old-result",task_id:"task-one",revision:1,digest:"old",evidence_ref:"fixture"}},now);j.close();
 service.reconcile("reconcile",preview.run_id,"lost","manual",preview.expected_seq,now);
 expect(renderWorkStatus(service.state())).toContain("--attempt 2");
 const before=service.state();await expect(service.run("task-one",now,{kind:"local-demo"})).rejects.toThrow("--attempt 2");await expect(service.run("task-one",now,{kind:"local-demo"},{attempt:3})).rejects.toThrow("--attempt 2");expect(service.state()).toEqual(before);
 const result=await service.run("task-one",now,{kind:"local-demo"},{attempt:2});const state=service.state();expect(state.results["old-result"].digest).toBe("old");expect(state.results[result!.result_id!].revision).toBe(2);expect(state.results[result!.result_id!].text).toContain("local deterministic output");
 expect(()=>service.accept("stale","old-result",1,"old",now)).toThrow("newer result");const r=state.results[result!.result_id!];service.accept("new",r.result_id,r.revision,r.digest,now);expect(service.state().tasks["task-one"].status).toBe("done");expect(CoreJournal.fold(paths.journal)).toEqual(service.state());
});
test("late completion of a reconciled owner cannot publish over a fresh attempt",async()=>{
 const {service}=fixture(),p=service.reconcilePreview("run-task-one-1");service.reconcile("r1",p.run_id,"lost","manual",p.expected_seq,now);
 let finish!:(v:{text:string;provider_session:null})=>void;const pending=service.run("task-one",now,{kind:"engine",name:"fake",adapter:{run:async()=>await new Promise(resolve=>finish=resolve)}},{attempt:2});
 const preview=service.reconcilePreview("run-task-one-2");service.reconcile("r2",preview.run_id,"lost","manual",preview.expected_seq,now);
 finish({text:"late",provider_session:null});await expect(pending).rejects.toThrow("поздний ответ");expect(Object.keys(service.state().results)).toHaveLength(0);
 const fresh=await service.run("task-one",now,{kind:"local-demo"},{attempt:3});expect(service.state().results[fresh!.result_id!].revision).toBe(3);
});
test("fault after durable run finish and result but before review preserves old evidence on a new attempt",async()=>{
 const {paths,service}=fixture();const journal=new CoreJournal(paths.journal);
 journal.submit({command_id:"finish-before-crash",type:"run_finished",payload:{run_id:"run-task-one-1",outcome:"succeeded"}},now);
 journal.submit({command_id:"result-before-crash",type:"result_recorded",payload:{result_id:"result-before-crash",task_id:"task-one",run_id:"run-task-one-1",revision:1,digest:"legacy-digest",evidence_ref:"fixture"}},now);journal.snapshot(now);journal.close();
 const p=service.reconcilePreview("run-task-one-1");service.reconcile("recover",p.run_id,"finished-unknown","crash before review",p.expected_seq,now);
 expect(service.stop(p.run_id).message).toContain("процесс мог остаться жив");
 const result=await service.run("task-one",now,{kind:"local-demo"},{attempt:2});expect(service.state().results["result-before-crash"].digest).toBe("legacy-digest");expect(service.state().results[result!.result_id!].revision).toBe(2);expect(CoreJournal.fold(paths.journal)).toEqual(service.state());
});
test("an explicit attempt never silently succeeds on a reviewed or accepted task",async()=>{
 const {service}=fixture(),p=service.reconcilePreview("run-task-one-1");service.reconcile("reconcile",p.run_id,"lost","manual",p.expected_seq,now);
 const run=await service.run("task-one",now,{kind:"local-demo"},{attempt:2}),result=service.state().results[run!.result_id!],review=service.state();
 await expect(service.run("task-one",now,{kind:"local-demo"},{attempt:99})).rejects.toThrow("новая попытка");expect(service.state()).toEqual(review);
 service.accept("accept",result.result_id,result.revision,result.digest,now);const done=service.state();
 await expect(service.run("task-one",now,{kind:"local-demo"},{attempt:3})).rejects.toThrow("новая попытка");expect(service.state()).toEqual(done);
});
