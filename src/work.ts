/** Opt-in managed work. Routed before chat/auth/onboarding. */
import {mkdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import {WorkCommandService,type WorkPaths} from "./core/work-service";
import {KimiEngine,kimiTransport} from "./core/engines";
import {JournalError,type CoreState} from "./core/journal";
import {WorkUsageError,resolveWorkOptions,shortWorkId,shellQuote} from "./work-address";
export {WorkUsageError} from "./work-address";
export function workError(error:unknown):{code:number;message:string} {
 if(error instanceof WorkUsageError)return {code:2,message:safe(error.message)};
 if(error instanceof JournalError){
  if(error.details){const d=error.details;return {code:1,message:`Результат изменился: показана ревизия ${d.expectedRevision}, сейчас ${d.actualRevision}${d.digestChanged?"; контрольная сумма не совпадает":""} — перечитайте work status`};}
  const known:Record<string,string>={"Journal missing; explicit init required":"Журнал не найден; выполните work init","Task already has an active run":"У задачи уже есть незавершённый запуск; перечитайте work status","Task is not ready for acceptance":"Задача не готова к приёмке; перечитайте work status","Session is closed":"Сессия закрыта","Command ID has different payload":"Команда с этим ID уже записана с другими параметрами"};
  return {code:1,message:known[error.message]??(/[А-Яа-я]/.test(error.message)?safe(error.message):"Журнал отказал в команде; перечитайте work status")};
 }
 return {code:1,message:"Команда не выполнена; проверьте журнал и параметры (подробности: ZININ_DEBUG=1)"};
}
function printWorkError(error:unknown):number {const info=workError(error);console.error(info.message);if(process.env.ZININ_DEBUG==="1")console.error(error);return info.code;}
export const defaultJournal=()=>join(homedir(),".zinin","work","journal");
export const workPaths=(path=defaultJournal()):WorkPaths=>({journal:resolve(path),leases:resolve(path)+".leases"});
export function parseWorkArgs(argv:string[]) {
 const options:Record<string,string>={};let command="";let json=false;
 const allowed=new Set(["journal","session","task","run","result","revision","digest","goal","criteria","engine","model","bin","cwd","command-id","id"]);
 for(let i=0;i<argv.length;i++){
  if(argv[i]==="--json"){json=true;continue;}
  if(argv[i]==="--help"||argv[i]==="-h"){command="help";continue;}
  if(argv[i].startsWith("--")){const key=argv[i].slice(2),value=argv[++i];if(!allowed.has(key)||!value||value.startsWith("--"))throw new WorkUsageError("Неверный параметр --"+key);options[key]=value;}
  else if(!command)command=argv[i];else throw new WorkUsageError("Лишний аргумент: "+argv[i]);
 }
 return {command,options,json};
}
const safe=(s:string)=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/[\x00-\x1f\x7f-\x9f]/g," ");
export function renderWorkStatus(state:CoreState,journalPath?:string):string {
 const labels:Record<string,string>={draft:"черновик",queued:"в очереди",active:"в работе",review_ready:"ждёт приёмки",finalizing:"сохраняется",done:"готово",blocked:"заблокирована",cancelled:"отменена",running:"работает",succeeded:"завершён",failed:"ошибка",stopped:"остановлен"};
 const out:string[]=[];
 for(const session of Object.values(state.sessions)){
  out.push(`Сессия ${shortWorkId(state,"session",session.session_id)} · ${safe(session.session_id)} (${session.status==="open"?"открыта":"закрыта"}): ${safe(session.goal)}`);
  for(const task of Object.values(state.tasks).filter(t=>t.session_id===session.session_id)){
   out.push(`  Задача ${shortWorkId(state,"task",task.task_id)} · ${safe(task.task_id)} — ${labels[task.status]}: ${safe(task.goal)}`);
   for(const run of Object.values(state.runs).filter(r=>r.task_id===task.task_id))out.push(`    Запуск ${shortWorkId(state,"run",run.run_id)} · ${safe(run.run_id)} — ${labels[run.status]}`);
   for(const result of Object.values(state.results).filter(r=>r.task_id===task.task_id)){out.push(`    Результат ${shortWorkId(state,"result",result.result_id)} · ${safe(result.result_id)} — ${result.status==="recorded"?"ждёт приёмки":result.status==="accepted"?"принят":"отклонён"}; revision=${result.revision}; digest=${safe(result.digest)}; ${safe(result.evidence_ref)}`);
    if(result.status==="recorded"&&task.status==="review_ready")out.push(`      zinin work accept${journalPath?" --journal "+shellQuote(journalPath):""} --result ${shellQuote(safe(result.result_id))} --revision ${result.revision} --digest ${shellQuote(safe(result.digest))}`);
   }
  }
 }
 return out.join("\n")||"Сессий пока нет. Создайте work session --goal …";
}
export async function executeWork(service:WorkCommandService,command:string,o:Record<string,string>,signal?:AbortSignal):Promise<any>{
 o=resolveWorkOptions(service.state(),command,o);
 const need=(key:string)=>{if(!o[key]?.trim())throw new WorkUsageError("Нужен --"+key);return o[key];};
 const now=new Date().toISOString(),cmd=o["command-id"]??randomUUID();
 switch(command){
  case "session": {const id=o.id??`session-${randomUUID()}`;return {session_id:id,...service.session(cmd,id,need("goal"),now)};}
  case "task":{const id=o.id??`task-${randomUUID()}`;return {task_id:id,...service.task(cmd,need("session"),id,need("goal"),need("criteria"),now)};}
  case "run":{
   const engine=need("engine"),task=need("task");
   if(engine==="local-demo")return await service.run(task,now,{kind:"local-demo"},{signal});
   if(engine!=="kimi")throw new WorkUsageError("Доступны local-demo и kimi; автоматического переключения нет");
   const model=need("model"),cwd=need("cwd");
   return await service.run(task,now,{kind:"engine",name:`kimi:${model}`,adapter:new KimiEngine(kimiTransport(o.bin),model)},{cwd,signal});
  }
  case "accept":{const revision=Number(need("revision"));if(!Number.isSafeInteger(revision)||revision<1)throw new WorkUsageError("revision должна быть положительным целым");return service.accept(cmd,need("result"),revision,need("digest"),now);}
  case "stop":return service.stop(need("run"));
  case "status":return service.state();
  default:throw new WorkUsageError("Неизвестная команда work");
 }
}
async function workMainUnchecked(argv:string[],onTui:()=>void):Promise<void>{
 const {command,options:o,json}=parseWorkArgs(argv),paths=workPaths(o.journal);
 if(command==="help"){console.log("zinin work [init|session|task|run|accept|stop|status] [--journal FILE] [--json]\nБез подкоманды — TUI. init создаёт журнал. Адреса: --session/--task/--result/--run ID. run требует --engine local-demo|kimi (kimi: --model MODEL --cwd DIR [--bin FILE]).");return;}
 if(command==="init"){mkdirSync(dirname(paths.journal),{recursive:true});new WorkCommandService(paths,{create:true});console.log(json?JSON.stringify({journal:paths.journal,initialized:true}):"Журнал готов: "+paths.journal);return;}
 if(!command&&(!process.stdin.isTTY||!process.stdout.isTTY))throw new WorkUsageError("TUI требует терминал; используйте work status");
 const service=new WorkCommandService(paths);
 if(!command){const {runWorkScreen}=await import("./tui/work-screen");onTui();await runWorkScreen(service);return;}
 const controller=new AbortController();const cancel=()=>{controller.abort();service.stopOwned();};
 process.on("SIGINT",cancel);process.on("SIGTERM",cancel);
 try {const result=await executeWork(service,command,o,controller.signal);if(result?.error)throw new Error(result.error);console.log(json?JSON.stringify(result):command==="status"?renderWorkStatus(result,service.journalPath):result?.message??JSON.stringify(result,null,2));if(result?.error)process.exitCode=1;}
 finally{process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);}
}

export async function workMain(argv:string[]):Promise<void>{
 let tui=false;
 try {await workMainUnchecked(argv,()=>{tui=true;});}
 catch(error){process.exitCode=printWorkError(error);}
 finally {if(tui)process.exit(Number(process.exitCode)||0);}
}
