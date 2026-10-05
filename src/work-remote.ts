/** Read-only work status over the existing ps SSH transport. Never dispatch control. */
import {resolveNewaCmd} from "./ps";
import {runCommand,MAX_COMMAND_BYTES,type CommandRunner} from "./sessions/command";
import {JournalError,type CoreState} from "./core/journal";
import {shellQuote} from "./work-address";
const object=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==="string"&&v.length<=262144;
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
export function parseRemoteWorkState(raw:string):CoreState {
 if(Buffer.byteLength(raw)>MAX_COMMAND_BYTES)throw Error("remote work too large");
 const value:unknown=JSON.parse(raw);if(!object(value)||!integer(value.seq))throw Error("invalid state");
 const specs={agents:["agent_id","role","engine","status"],sessions:["session_id","agent_id","service","group","goal","status"],tasks:["task_id","session_id","goal","criteria","status"],steps:["step_id","task_id","owner","status"],runs:["run_id","task_id","session_id","status"],results:["result_id","task_id","digest","evidence_ref","status"]};
 const states:Record<string,string[]>={agents:["active","retired"],sessions:["open","closed"],tasks:["draft","queued","active","review_ready","finalizing","done","blocked","cancelled"],steps:["pending","working","done","failed"],runs:["running","succeeded","failed","stopped","interrupted"],results:["recorded","accepted","rejected"]};
 const clean:any={seq:value.seq};
 for(const [table,fields] of Object.entries(specs)){
  const rows=value[table];if(!object(rows)||Object.keys(rows).length>10000)throw Error("invalid table");clean[table]=Object.create(null);
  for(const [id,row] of Object.entries(rows)){
   if(!id||id.length>512||["__proto__","prototype","constructor"].includes(id)||!object(row)||row[fields[0]]!==id||!fields.every(key=>text(row[key]))||!states[table].includes(row.status))throw Error("invalid row");
   const copy:any=Object.fromEntries(fields.map(key=>[key,row[key]]));
   for(const key of ["created_seq","last_event_seq","attempt","version","revision"]){if(row[key]!==undefined){if(!integer(row[key]))throw Error("invalid number");copy[key]=row[key];}}
   if(table==="tasks"&&!integer(row.version)||table==="results"&&!integer(row.revision))throw Error("missing number");
   if(table==="steps"){if(typeof row.required!=="boolean")throw Error("invalid step");copy.required=row.required;}
   if(table==="runs"){if(row.provider_session!==null&&!text(row.provider_session))throw Error("invalid provider");copy.provider_session=row.provider_session;}
   for(const key of ["text","run_id"]){if(row[key]!==undefined&&!fields.includes(key)){if(!text(row[key]))throw Error("invalid text");copy[key]=row[key];}}
   if(row.launch_mode!==undefined){if(row.launch_mode!=="new")throw Error("invalid launch mode");copy.launch_mode="new";}
   if(row.reconciliation!==undefined){const r=row.reconciliation;if(!object(r)||!["lost","finished-unknown"].includes(r.as)||!text(r.reason)||!integer(r.seq))throw Error("invalid reconciliation");copy.reconciliation={as:r.as,reason:r.reason,seq:r.seq};}
   clean[table][id]=copy;
  }
 }
 for(const row of Object.values(clean.sessions) as any[])if(!clean.agents[row.agent_id])throw Error("missing agent");
 for(const row of Object.values(clean.tasks) as any[])if(!clean.sessions[row.session_id])throw Error("missing session");
 for(const table of ["steps","runs","results"])for(const row of Object.values(clean[table]) as any[])if(!clean.tasks[row.task_id]||(table==="runs"&&row.session_id!==clean.tasks[row.task_id].session_id))throw Error("bad task reference");
 return clean;
}
export async function remoteWorkStatus(journal?:string,deps:{command?:string[];run?:CommandRunner}={}):Promise<CoreState>{
 try{
  const command=deps.command??resolveNewaCmd(),index=command.lastIndexOf("ps");
  if(command[0]!=="ssh"||index<2)throw Error("SSH ps command required");
  const args=[...command.slice(0,index),"work","status","--json",...(journal===undefined?[]:["--journal",shellQuote(journal)])];
  return parseRemoteWorkState(await (deps.run??runCommand)(args,{timeoutMs:6000,maxBytes:MAX_COMMAND_BYTES}));
 }catch{throw new JournalError("not_found","Удалённый журнал newa недоступен или ответ некорректен; управление по SSH не выполнялось");}
}
