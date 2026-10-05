import {test,expect} from "bun:test";
import {mkdtempSync,existsSync,readFileSync,statSync,symlinkSync,readdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {WorkCommandService} from "../../src/core/work-service";
import {collectWorkJournal} from "../../src/sessions/work-journal";
import {collect} from "../../src/ps";
import {renderOverview} from "../../src/sessions/overview";
const opts={sources:"all" as const,json:true,watchSeconds:null,stuckMinutes:undefined,all:true};
test("optional local journal contributes waiting and running rows without changing the journal",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"zinin-work-overview-")),journal=join(dir,"journal"),service=new WorkCommandService({journal,leases:join(dir,"leases")},{create:true}),now=new Date().toISOString();
 service.session("s","s","Managed",now);service.task("a","s","a","Review task","criteria",now);service.task("b","s","b","Running task","criteria",now);
 await service.run("a",now,{kind:"local-demo"});let finish!:(v:{text:string;provider_session:null})=>void;
 const pending=service.run("b",now,{kind:"engine",name:"fake",adapter:{run:async()=>new Promise(resolve=>finish=resolve)}});
 const before=readFileSync(journal),mtime=statSync(journal).mtimeMs,files=readdirSync(dir).sort();
 const snapshot=await collect(opts,{host:"newa",workJournalPath:journal,newa:async()=>({rows:[],machine:{machine:"newa",memFreeMb:null,diskFreeMb:null,available:true}})});
 expect(snapshot.rows).toHaveLength(2);expect(snapshot.rows.find(row=>row.id.endsWith(":a"))?.state).toBe("waiting-tim");expect(snapshot.rows.find(row=>row.id.endsWith(":b"))?.state).toBe("working");
 const out=renderOverview(snapshot.rows,snapshot.machines,Date.now());expect(out.split("Ждут решения владельца\n")[1].split("\n\n")[0]).toContain("ждёт приёмки");
 expect(readFileSync(journal)).toEqual(before);expect(statSync(journal).mtimeMs).toBe(mtime);expect(readdirSync(dir).sort()).toEqual(files);
 finish({text:"result",provider_session:null});await pending;
});
test("no journal preserves the old overview and never creates a file; linked journals are rejected",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"zinin-work-absent-")),journal=join(dir,"absent");
 expect(collectWorkJournal(journal,"mac")).toEqual({rows:[],warnings:[]});expect(existsSync(journal)).toBe(false);
 const real=join(dir,"real");new WorkCommandService({journal:real,leases:real+".leases"},{create:true});symlinkSync(real,journal);
 expect(collectWorkJournal(journal,"newa").warnings).toHaveLength(1);
 const snapshot=await collect(opts,{host:"newa",workJournalPath:join(dir,"missing"),newa:async()=>({rows:[],machine:{machine:"newa",memFreeMb:null,diskFreeMb:null,available:true}})});
 expect(snapshot.rows).toEqual([]);expect(snapshot.machines[0].warnings).toBeUndefined();
});
test("a closed journal overview creates no SQLite sidecars and damaged journals only warn",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"zinin-work-closed-")),journal=join(dir,"journal"),service=new WorkCommandService({journal,leases:join(dir,"leases")},{create:true}),now=new Date().toISOString();
 service.session("s","s","Managed",now);service.task("a","s","a","Review task","criteria",now);await service.run("a",now,{kind:"local-demo"});
 const files=readdirSync(dir).sort(),before=readFileSync(journal);
 expect(collectWorkJournal(journal,"mac").rows[0].state).toBe("waiting-tim");
 expect(readdirSync(dir).sort()).toEqual(files);expect(readFileSync(journal)).toEqual(before);
 const broken=join(dir,"broken");writeFileSync(broken,"not a database");expect(collectWorkJournal(broken,"newa")).toEqual({rows:[],warnings:["Локальный журнал недоступен или повреждён"]});
});
