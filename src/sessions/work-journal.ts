/** Optional, strictly read-only local managed-task source. */
import {lstatSync} from "node:fs";
import {CoreJournal} from "../core/journal";
import type {SessionRow} from "./types";
export function collectWorkJournal(path:string,machine:"mac"|"newa"): {rows:SessionRow[];warnings:string[]} {
 const rows:SessionRow[]=[];
 let stat:ReturnType<typeof lstatSync>;
 try {stat=lstatSync(path);}catch(error){return {rows,warnings:(error as NodeJS.ErrnoException).code==="ENOENT"?[]:["Локальный журнал недоступен"]};}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024)return {rows,warnings:["Локальный журнал отклонён: тип файла или размер"]};
 try {
  const state=CoreJournal.readOnly(path),after=lstatSync(path);
  if(after.dev!==stat.dev||after.ino!==stat.ino||after.isSymbolicLink())throw Error("journal replaced");
  let activity=stat.mtimeMs;
  try {const wal=lstatSync(path+"-wal");if(wal.isFile()&&!wal.isSymbolicLink()&&wal.nlink===1)activity=Math.max(activity,wal.mtimeMs);}catch{}
  for(const task of Object.values(state.tasks)){
   const runs=Object.values(state.runs).filter(run=>run.task_id===task.task_id),run=runs.at(-1);
   const result=Object.values(state.results).filter(result=>result.task_id===task.task_id&&result.status==="recorded").sort((a,b)=>b.revision-a.revision)[0];
   const waiting=task.status==="review_ready"&&!!result;
   const working=runs.some(run=>run.status==="running");
   const provider=run?.provider_session??null;
   rows.push({id:`work:${task.session_id}:${task.task_id}`,machine,engine:provider?.split(":")[0]??null,model:provider?.includes(":")?provider.slice(provider.indexOf(":")+1):null,
    task:task.goal,taskSource:"local-journal",state:working?"working":waiting?"waiting-tim":task.status==="done"?"done":"idle",lastActivityMs:activity,
    stuckOn:run?.status==="failed"?"Ошибка управляемого запуска":null,needs:waiting?`ждёт приёмки: ${result.result_id}, revision ${result.revision}`:null,
    contextPct:null,weeklyLimitPct:null,source:"work-journal",liveness:"unknown"});
  }
  return {rows,warnings:[]};
 }catch{return {rows:[],warnings:["Локальный журнал недоступен или повреждён"]};}
}
