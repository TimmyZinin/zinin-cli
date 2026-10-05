import {test,expect} from "bun:test";import {readFileSync,statSync} from "node:fs";import {join,dirname} from "node:path";import {fixture,now} from "./reconcile.test";import {executeWork,renderWorkHistory} from "../../src/work";
test("history and JSONL export preserve all attempts decisions and source bytes in order",async()=>{
 const {paths,service}=fixture(),p=service.reconcilePreview("run-task-one-1");service.reconcile("reconcile",p.run_id,"lost","owner reason",p.expected_seq,now);
 const run=await service.run("task-one",now,{kind:"local-demo"},{attempt:2}),result=service.state().results[run!.result_id!];service.accept("accept",result.result_id,result.revision,result.digest,now);
 const bytes=readFileSync(paths.journal),mtime=statSync(paths.journal).mtimeMs,events=await executeWork(service,"history",{task:"t1"});
 expect(events.filter((e:any)=>e.type==="run_started")).toHaveLength(2);expect(events.some((e:any)=>e.type==="run_reconciled")).toBe(true);expect(events.some((e:any)=>e.type==="result_decided")).toBe(true);expect(renderWorkHistory(events)).toContain("Сверка владельца");
 expect(events.map((e:any)=>e.seq)).toEqual(events.map((e:any)=>e.seq).sort((a:number,b:number)=>a-b));
 const out=join(dirname(paths.journal),"history.jsonl");service.export(out);expect(readFileSync(out,"utf8").trim().split("\n").map(JSON.parse)).toEqual(service.events());
 expect(()=>service.export(out)).toThrow("укажите новый --out");expect(readFileSync(paths.journal)).toEqual(bytes);expect(statSync(paths.journal).mtimeMs).toBe(mtime);
});
