/** Opt-in managed work. Routed before chat/auth/onboarding. */
import {mkdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import {WorkCommandService,type WorkPaths} from "./core/work-service";
import {KimiEngine,kimiTransport} from "./core/engines";
import type {CoreState} from "./core/journal";
export const defaultJournal=()=>join(homedir(),".zinin","work","journal");
export const workPaths=(path=defaultJournal()):WorkPaths=>({journal:resolve(path),leases:resolve(path)+".leases"});
export function parseWorkArgs(argv:string[]) {
 const options:Record<string,string>={};let command="";let json=false;
 const allowed=new Set(["journal","session","task","run","result","revision","digest","goal","criteria","engine","model","bin","cwd","command-id","id"]);
 for(let i=0;i<argv.length;i++){
  if(argv[i]==="--json"){json=true;continue;}
  if(argv[i]==="--help"||argv[i]==="-h"){command="help";continue;}
  if(argv[i].startsWith("--")){const key=argv[i].slice(2),value=argv[++i];if(!allowed.has(key)||!value||value.startsWith("--"))throw Error("Неверный параметр --"+key);options[key]=value;}
  else if(!command)command=argv[i];else throw Error("Лишний аргумент: "+argv[i]);
 }
 return {command,options,json};
}
const safe=(s:string)=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/[\x00-\x1f\x7f-\x9f]/g," ");
export function renderWorkStatus(state:CoreState):string {
 const labels:Record<string,string>={draft:"черновик",queued:"в очереди",active:"в работе",review_ready:"ждёт приёмки",finalizing:"сохраняется",done:"готово",blocked:"заблокирована",cancelled:"отменена",running:"работает",succeeded:"завершён",failed:"ошибка",stopped:"остановлен"};
 const out:string[]=[];
 for(const session of Object.values(state.sessions)){
  out.push(`Сессия ${safe(session.session_id)} (${session.status==="open"?"открыта":"закрыта"}): ${safe(session.goal)}`);
  for(const task of Object.values(state.tasks).filter(t=>t.session_id===session.session_id)){
   out.push(`  Задача ${safe(task.task_id)} — ${labels[task.status]}: ${safe(task.goal)}`);
   for(const run of Object.values(state.runs).filter(r=>r.task_id===task.task_id))out.push(`    Запуск ${safe(run.run_id)} — ${labels[run.status]}`);
   for(const result of Object.values(state.results).filter(r=>r.task_id===task.task_id))out.push(`    Результат ${safe(result.result_id)} — ${result.status==="recorded"?"ждёт приёмки":result.status==="accepted"?"принят":"отклонён"}; revision=${result.revision}; digest=${safe(result.digest)}; ${safe(result.evidence_ref)}`);
  }
 }
 return out.join("\n")||"Сессий пока нет. Создайте work session --goal …";
}
export async function executeWork(service:WorkCommandService,command:string,o:Record<string,string>,signal?:AbortSignal):Promise<any>{
 const need=(key:string)=>{if(!o[key]?.trim())throw Error("Нужен --"+key);return o[key];};
 const now=new Date().toISOString(),cmd=o["command-id"]??randomUUID();
 switch(command){
  case "session": {const id=o.id??`session-${randomUUID()}`;return {session_id:id,...service.session(cmd,id,need("goal"),now)};}
  case "task":{const id=o.id??`task-${randomUUID()}`;return {task_id:id,...service.task(cmd,need("session"),id,need("goal"),need("criteria"),now)};}
  case "run":{
   const engine=need("engine"),task=need("task");
   if(engine==="local-demo")return await service.run(task,now,{kind:"local-demo"},{signal});
   if(engine!=="kimi")throw Error("Доступны local-demo и kimi; автоматического переключения нет");
   const model=need("model"),cwd=need("cwd");
   return await service.run(task,now,{kind:"engine",name:`kimi:${model}`,adapter:new KimiEngine(kimiTransport(o.bin),model)},{cwd,signal});
  }
  case "accept":{const revision=Number(need("revision"));if(!Number.isSafeInteger(revision)||revision<1)throw Error("revision должна быть положительным целым");return service.accept(cmd,need("result"),revision,need("digest"),now);}
  case "stop":return service.stop(need("run"));
  case "status":return service.state();
  default:throw Error("Неизвестная команда work");
 }
}
export async function workMain(argv:string[]):Promise<void>{
 const {command,options:o,json}=parseWorkArgs(argv),paths=workPaths(o.journal);
 if(command==="help"){console.log("zinin work [init|session|task|run|accept|stop|status] [--journal FILE] [--json]\nБез подкоманды — TUI. init создаёт журнал. Адреса: --session/--task/--result/--run ID. run требует --engine local-demo|kimi (kimi: --model MODEL --cwd DIR [--bin FILE]).");return;}
 if(command==="init"){mkdirSync(dirname(paths.journal),{recursive:true});new WorkCommandService(paths,{create:true});console.log(json?JSON.stringify({journal:paths.journal,initialized:true}):"Журнал готов: "+paths.journal);return;}
 const service=new WorkCommandService(paths);
 if(!command){const {runWorkScreen}=await import("./tui/work-screen");await runWorkScreen(service);return;}
 const controller=new AbortController();const cancel=()=>{controller.abort();service.stopOwned();};
 process.on("SIGINT",cancel);process.on("SIGTERM",cancel);
 try {const result=await executeWork(service,command,o,controller.signal);console.log(json?JSON.stringify(result):command==="status"?renderWorkStatus(result):result?.message??JSON.stringify(result,null,2));if(result?.error)process.exitCode=1;}
 finally{process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);}
}
