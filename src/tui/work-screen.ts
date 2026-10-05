/** Foreground work TUI. Commands share the CLI service; Enter previews before execution. */
import type {WorkCommandService} from "../core/work-service";
import {executeWork,parseWorkArgs,renderWorkStatus,WorkUsageError} from "../work";
import {resolveWorkOptions} from "../work-address";
import {KeyParser,type Key} from "./input";
const plain=(s:string)=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g," ");
export function splitWorkCommand(text:string):string[]{
 const out:string[]=[];let token="",quote:string|null=null,active=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c===quote)quote=null;else if(c==="\\"&&quote==='"'&&i+1<text.length)token+=text[++i];else token+=c;active=true;}
 else if(c==='"'||c==="'"){quote=c;active=true;}else if(/\s/.test(c)){if(active){out.push(token);token="";active=false;}}else{token+=c;active=true;}}
 if(quote)throw Error("Закройте кавычки");if(active)out.push(token);return out;
}
export class WorkScreen {
 draft="";preview:string|null=null;message="";width=100;height=30;
 private addressed:Record<string,string>={};
 readonly pending=new Set<Promise<void>>();
 constructor(private service:WorkCommandService,private write:(s:string)=>void,private quit:()=>void){}
 key(key:Key){
  if(key.kind==="ctrl+c"||key.kind==="ctrl+d"){this.quit();return;}
  if(key.kind==="char"){this.draft+=key.value;this.preview=null;}
  else if(key.kind==="backspace"){this.draft=Array.from(this.draft).slice(0,-1).join("");this.preview=null;}
  else if(key.kind==="enter"&&this.draft.trim()){
   try{
    const {command,options}=parseWorkArgs(splitWorkCommand(this.draft.replace(/^\//,"")));
    if(!["session","task","run","accept","stop","status","reconcile","history"].includes(command)||options.journal||options.remote)throw Error("Используйте session/task/run/accept/stop/status в текущем журнале");
    if(this.preview!==this.draft){
     this.addressed=resolveWorkOptions(this.service.state(),command,options);
     if(command==="reconcile"){
      const preview=this.service.reconcilePreview(this.addressed.run);
      this.addressed["expected-seq"]=String(preview.expected_seq);this.addressed.confirm="true";
      this.message=`Сессия ${preview.session_id} · задача ${preview.task_id}: ${preview.goal} · последнее событие #${preview.last_event.seq} ${preview.last_event.type} · ${preview.warning}. Enter ещё раз — сверить.`;
     }
     this.preview=this.draft;
     if(command!=="reconcile")this.message=`Адресат: ${Object.entries(this.addressed).filter(([key])=>["session","task","result","run","id"].includes(key)).map(([key,value])=>`${key}=${value}`).join("; ")||"текущий журнал / новая сессия"}. Enter ещё раз — выполнить; изменение строки отменяет подтверждение.`;
    }else{
     this.draft="";this.preview=null;this.message="Команда выполняется";
     let pending:Promise<void>;
     pending=(async()=>{try{const result=await executeWork(this.service,command,this.addressed);this.message=result?.message??(command==="status"?"Состояние обновлено":JSON.stringify(result));}catch(error){this.message=`Ошибка: ${(error as Error).message}`;}})();
     this.pending.add(pending);void pending.finally(()=>this.pending.delete(pending));
    }
   }catch(error){this.preview=null;this.message=`Ошибка: ${(error as Error).message}`;}
  }
  this.render();
 }
 render(){
  const tree=renderWorkStatus(this.service.state(),this.service.journalPath,this.service.ownedRunIds()).split("\n");
  const rows=["ZININ work — явные адресные команды; Ctrl-C/Ctrl-D: выход",...tree.slice(0,Math.max(1,this.height-7)),"",plain(this.message),`> ${plain(this.draft)}`,"session / task / run / accept / stop / status; Enter: сначала адресат, затем выполнение"];
  this.write("\x1b[H\x1b[2J"+rows.map(line=>{let out="";for(const c of plain(line)){if(Bun.stringWidth(out+c)>this.width-1)break;out+=c;}return out;}).join("\r\n"));
 }
}
export async function runWorkScreen(service:WorkCommandService):Promise<void>{
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new WorkUsageError("TUI требует терминал; используйте work status");
 let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});let failure:unknown;let timer:ReturnType<typeof setInterval>|undefined;
 const app=new WorkScreen(service,s=>process.stdout.write(s),()=>finish());const parser=new KeyParser();
 const guard=(fn:()=>void)=>{try{fn();}catch(error){failure=error;finish();}};
 const data=(chunk:Buffer)=>guard(()=>{for(const key of parser.push(chunk.toString()))app.key(key);});
 const resize=()=>guard(()=>{app.width=process.stdout.columns||100;app.height=process.stdout.rows||30;app.render();});
 const signal=()=>finish();const wasRaw=process.stdin.isRaw;
 try{
  process.stdin.on("data",data);process.stdout.on("resize",resize);process.on("SIGINT",signal);process.on("SIGTERM",signal);
  process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write("\x1b[?25l");
  resize();timer=setInterval(()=>guard(()=>app.render()),250);await done;
 }finally{
  if(timer)clearInterval(timer);process.stdin.removeListener("data",data);process.stdout.removeListener("resize",resize);process.removeListener("SIGINT",signal);process.removeListener("SIGTERM",signal);
  service.stopOwned();try{process.stdin.setRawMode(!!wasRaw);}finally{process.stdin.pause();(process.stdin as typeof process.stdin & {unref?:()=>void}).unref?.();process.stdout.write("\x1b[?25h\r\n");}
  // An adapter may ignore abort or hold a pipe open. Restore the terminal
  // first, then bound cleanup; an unfinished durable run stays unknown.
  let shutdownTimer:ReturnType<typeof setTimeout>|undefined;
  try {
   await Promise.race([Promise.allSettled([...app.pending]),new Promise<void>(resolve=>{shutdownTimer=setTimeout(()=>{failure??=Error("Завершение запуска не подтверждено; перечитайте work status");resolve();},2000);})]);
  } finally {if(shutdownTimer)clearTimeout(shutdownTimer);}

 }
 if(failure)throw failure;
}
