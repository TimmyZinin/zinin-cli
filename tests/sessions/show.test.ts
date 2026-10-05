import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,utimesSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {collect,showSession,psMain,type PsOptions} from "../../src/ps";
import {collectNewaSnapshot} from "../../src/sessions/newa-collector";
import {parseNewaDir} from "../../src/adapters/sessions/newa-workdir";
import {parseTerminalWindows} from "../../src/adapters/sessions/terminal-mac";
import {parseRemoteSnapshot} from "../../src/sessions/remote";
import {matchSessions,renderSessionDetails} from "../../src/sessions/details";
const NOW=Date.parse("2026-10-05T20:00:00Z");
const opts:PsOptions={sources:"newa",json:true,watchSeconds:null,stuckMinutes:undefined};
const root=()=>mkdtempSync(join(tmpdir(),"zinin-show-"));
function worker(parent:string,name:string) {const dir=join(parent,name);mkdirSync(dir);writeFileSync(join(dir,"status.json"),JSON.stringify({state:"timeout",reason:"timeout"}));writeFileSync(join(dir,"meta.json"),JSON.stringify({engine:"codex",model:"example-model"}));return dir;}
const machine={machine:"newa",memFreeMb:null,diskFreeMb:null,available:true};
const long="Подробное описание "+"д".repeat(300);
const parsed=(name="worker")=>parseNewaDir({name,metaText:null,statusText:'{"state":"idle"}',taskText:long+"\nВторая строка задачи",toS0Text:"2026-10-05T19:00:00Z Вопрос: "+long,reportText:"2026-10-05T19:30:00Z СДАНО: "+long,includeDetails:true,nowMs:NOW});
test("show preserves full task question submission and last 15 substantive report lines",async()=>{
 const work=root(),dir=worker(work,"example-worker");
 writeFileSync(join(dir,"TASK.md"),long+"\nВторая строка задачи");
 writeFileSync(join(dir,"TO-S0.md"),"2026-10-05T19:00:00Z Вопрос: "+long);
 writeFileSync(join(dir,"REPORT-S0.md"),Array.from({length:20},(_,i)=>"Содержательная строка "+i).join("\n")+"\n2026-10-05T19:30:00Z СДАНО: "+long+"\n\n— newa (E4)\n");
 const result=await showSession("example-worker",opts,{host:"newa",now:()=>NOW,newaOptions:{root:work}});
 expect(result.status).toBe("found"); const row=result.sessions[0],d=row.details!;
 expect(row.task!.length).toBeLessThanOrEqual(120); expect(d.task.text).toBe(long+"\nВторая строка задачи");expect(d.task.source).toBe("TASK.md");
 expect(d.question?.text).toBe("Вопрос: "+long);expect(d.submission?.text).toBe("СДАНО: "+long);expect(d.submission?.atMs).toBe(Date.parse("2026-10-05T19:30:00Z"));
 expect(d.reportLines).toHaveLength(15);expect(d.reportLines[0]).toBe("Содержательная строка 6");
 expect(row.engine).toBe("codex");expect(row.model).toBe("example-model");expect(d.reason).toBe("timeout");
 const out=renderSessionDetails(result);expect(out).toContain(long);expect(out).toContain("Вторая строка задачи");expect(out).toContain("2026-10-05T19:30:00.000Z");
});
test("exact detail lookup does not read other workers and keeps symlink/size limits",()=>{
 const work=root(),dir=worker(work,"selected"),other=worker(work,"other");
 writeFileSync(join(other,"TASK.md"),"x".repeat(140000));
 const secret=join(work,"fixture-secret");writeFileSync(secret,"FORBIDDEN SENTINEL");symlinkSync(secret,join(dir,"TASK.md"));
 writeFileSync(join(dir,"REPORT-S0.md"),"x".repeat(140000));
 const result=collectNewaSnapshot({root:work,nowMs:NOW,detailId:"selected",pathMode:"portable"});
 expect(result.rows.map(r=>r.id)).toEqual(["selected"]);expect(result.rows[0].details?.reportLines).toEqual([]);
 expect(JSON.stringify(result)).not.toContain("SENTINEL");expect(result.machine.warnings?.join(" ")).not.toContain("other:");
 expect(collectNewaSnapshot({root:work,detailId:"../fixture-secret"}).rows).toEqual([]);
});
test("show searches old sessions and reports ambiguity without choosing an arbitrary worker",async()=>{
 const work=root();for(const name of ["sample-one","sample-two"]) {const dir=worker(work,name);utimesSync(join(dir,"status.json"),new Date(0),new Date(0));}
 const deps={host:"newa" as const,now:()=>NOW,newaOptions:{root:work}};
 expect((await collect(opts,deps)).rows).toHaveLength(0);
 const ambiguous=await showSession("sample",opts,deps);expect(ambiguous.status).toBe("ambiguous");expect(ambiguous.sessions).toHaveLength(2);
 expect(renderSessionDetails(ambiguous)).toContain("newa:sample-one");
 expect((await showSession("newa:sample-one",opts,deps)).status).toBe("found");
 expect((await showSession("absent",opts,deps)).status).toBe("not-found");
});
test("Mac details contain raw title tty screen tail and readable names remain ambiguous",()=>{
 const raw=readFileSync(join(import.meta.dir,"fixtures/mac-tabs-raw.txt"),"utf8");
 const rows=parseTerminalWindows(raw,undefined,{tabs:true,details:true});
 expect(rows[0].details?.terminal?.tty).toBe("/dev/ttys071");expect(rows[0].details?.terminal?.title).toContain("Проверяет таблицу");
 const screen=Array.from({length:20},(_,i)=>"screen "+i).join("\n");
 const [r]=parseTerminalWindows(["9-1","synthetic — Задача — claude — 80×24",screen,"true","/dev/ttys080"].join("\t"),undefined,{tabs:true,details:true});
 expect(r.details?.terminal?.screenLines).toHaveLength(15);expect(r.details?.terminal?.screenLines[0]).toBe("screen 5");
 expect(matchSessions([{...r,id:"a"},{...r,id:"b"}],"claude")).toHaveLength(2);
 expect(matchSessions([{...r,id:"a"},{...r,id:"b"}],"mac:a")).toHaveLength(1);
});
test("SSH detail request encodes exact identity and validates long nested evidence",async()=>{
 const row=parsed("worker; $(unsafe)");const commands:string[][]=[];
 const result=await showSession(row.id,opts,{host:"mac",now:()=>NOW,remoteCommand:["fixture"],run:async cmd=>{
  commands.push([...cmd]); const detailed=cmd.includes("--detail-id");
  return JSON.stringify({sessions:[detailed ? row : {...row,details:undefined}],machines:[machine],hidden_count:0});
 }});
 expect(result.status).toBe("found");expect(result.sessions[0].details?.question?.text).toContain(long);
 expect(commands).toHaveLength(2);const encoded=commands[1].at(-1)!;
 expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);expect(Buffer.from(encoded,"base64url").toString()).toBe(row.id);
 expect(commands[1]).not.toContain(row.id);
});
test("remote detail decoder rejects malformed fields and strips unknown nested data",()=>{
 const payload=()=>({sessions:[parsed()],machines:[machine],hidden_count:0});
 const good=payload();(good.sessions[0].details!.task as any).extra="UNTRUSTED";
 expect(JSON.stringify(parseRemoteSnapshot(JSON.stringify(good)))).not.toContain("UNTRUSTED");
 for(const mutate of [(d:any)=>d.reportLines=Array(16).fill("line"),(d:any)=>d.question.text={},(d:any)=>d.task.text="x".repeat(140000),(d:any)=>d.terminal={title:"spoofed"},(d:any)=>d.submission.atMs=-1]) {
  const p=payload();mutate(p.sessions[0].details);expect(()=>parseRemoteSnapshot(JSON.stringify(p))).toThrow();
 }
});
test("missing remote details and failed sources are reported unavailable",async()=>{
 const row=parsed();const deps={host:"mac" as const,now:()=>NOW,remote:async()=>({rows:[{...row,details:undefined}],machine})};
 expect((await showSession(row.id,opts,deps)).status).toBe("unavailable");
 const result=await showSession("worker",opts,{host:"mac",remote:async()=>{throw Error("offline")}});
 expect(result.status).toBe("unavailable");expect(renderSessionDetails(result)).toContain("Недоступно: newa");
});
test("detail rendering strips terminal escapes while preserving full multiline text",()=>{
 const row=parsed();row.details!.task.text="\x1b[2JПервая строка\nВторая строка";
 const out=renderSessionDetails({query:row.id,status:"found",sessions:[row],machines:[],generatedAt:new Date(NOW).toISOString()});
 expect(out).not.toContain("\x1b");expect(out).toContain("Первая строка\nВторая строка");
});
test("CLI show validates selectors and conflicts without a live scan",async()=>{
 await expect(psMain(["show"])).rejects.toThrow("show expects");
 await expect(psMain(["show","worker","--watch"])).rejects.toThrow("does not support");
 await expect(psMain(["--detail-id",";bad"])).rejects.toThrow("invalid detail id");
 await expect(showSession("\n",opts)).rejects.toThrow("show expects");
});
