/** Shared addressed commands for the opt-in CLI and TUI. No automatic run/accept. */
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {CoreJournal, JournalError, type CoreState} from "./journal";
import {LocalExecutor, type EngineLike} from "./executor";
export interface WorkPaths {journal: string; leases: string}
export type EngineSelection = {kind:"local-demo"} | {kind:"engine"; name:string; adapter:EngineLike};
function commandKey(id:string, phase="request"):string {
  if(typeof id!=="string" || !id.trim()) throw new JournalError("malformed","command_id required");
  return `work:${createHash("sha256").update(id).digest("hex")}:${phase}`;
}
export class WorkCommandService {
  constructor(private paths: WorkPaths, options: {create?:boolean} = {}) {
    if (!existsSync(paths.journal) && !options.create) throw new JournalError("not_found", "Journal missing; explicit init required");
    if(options.create) this.withJournal(journal => journal.state);
  }
  private withJournal<T>(operation:(journal:CoreJournal)=>T):T {
    const journal=new CoreJournal(this.paths.journal);
    try {return operation(journal);} finally {journal.close();}
  }
  state():CoreState {return this.withJournal(journal=>structuredClone(journal.state));}
  session(commandId:string, sessionId:string, goal:string, now:string) {
    const key=commandKey(commandId);
    return this.withJournal(journal=>{
      journal.submit({command_id:"work:local-agent",type:"agent_registered",payload:{agent_id:"work-local",role:"executor",engine:"explicit-selection"}},now);
      return journal.submit({command_id:key,type:"session_opened",payload:{session_id:sessionId,agent_id:"work-local",service:"work",group:"local",goal}},now);
    });
  }
  task(commandId:string, sessionId:string, taskId:string, goal:string, criteria:string, now:string) {
    return this.withJournal(journal=>journal.submit({command_id:commandKey(commandId),type:"task_created",payload:{session_id:sessionId,task_id:taskId,goal,criteria}},now));
  }
  async run(taskId:string, now:string, selection:EngineSelection) {
    if(!selection || !["local-demo","engine"].includes(selection.kind)) throw new JournalError("malformed","Explicit engine selection required");
    if(selection.kind==="engine" && (!selection.name.trim() || !selection.adapter)) throw new JournalError("malformed","Engine name and adapter required");
    // No provider selection, fallback, discovery or network operation here.
    const executor=new LocalExecutor(this.paths.journal,this.paths.leases,selection.kind==="engine" ? selection.adapter : undefined,selection.kind==="engine" ? selection.name : "local-demo");
    try {return await executor.runTask(taskId,now);} finally {executor.close();}
  }
  accept(commandId:string, resultId:string, revision:number, digest:string, now:string) {
    return this.withJournal(journal=>{
      const receipt=journal.submit({command_id:commandKey(commandId),type:"result_decided",payload:{result_id:resultId,decision:"accepted",decided_by:"user",expected_revision:revision,expected_digest:digest}},now);
      const taskId=journal.state.results[resultId].task_id;
      // Append-only finalization; retry after an interruption resumes these
      // durable transitions. No history/snapshot deletion is needed.
      if(journal.state.tasks[taskId].status==="review_ready") journal.submit({command_id:commandKey(commandId,"finalizing"),type:"task_transitioned",payload:{task_id:taskId,to:"finalizing"}},now);
      if(journal.state.tasks[taskId].status==="finalizing") journal.submit({command_id:commandKey(commandId,"done"),type:"task_transitioned",payload:{task_id:taskId,to:"done"}},now);
      return {...receipt,task_id:taskId,result_id:resultId,revision,digest};
    });
  }
  closeSession(commandId:string,sessionId:string,now:string) {
    return this.withJournal(journal=>journal.submit({command_id:commandKey(commandId),type:"session_closed",payload:{session_id:sessionId,require_idle:true}},now));
  }
}
