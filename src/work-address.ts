import {JournalError,type CoreState} from "./core/journal";
export class WorkUsageError extends Error {}
export type WorkKind="session"|"task"|"run"|"result";
const tables={session:"sessions",task:"tasks",run:"runs",result:"results"} as const;
const types={session:"session-",task:"task-",run:"run-",result:"res-"};
const aliases={session:"s",task:"t",run:"r",result:"v"};
export function orderedIds(state:CoreState,kind:WorkKind):string[]{
 return Object.entries(state[tables[kind]]).sort((a,b)=>((a[1] as {created_seq?:number}).created_seq??0)-((b[1] as {created_seq?:number}).created_seq??0)).map(([id])=>id);
}
export function shortWorkId(state:CoreState,kind:WorkKind,id:string):string{return aliases[kind]+(orderedIds(state,kind).indexOf(id)+1);}
export function resolveWorkId(state:CoreState,kind:WorkKind,query:string):string {
 const ids=orderedIds(state,kind),matches=new Set<string>();
 if(ids.includes(query))matches.add(query);
 const alias=new RegExp(`^${aliases[kind]}([1-9][0-9]*)$`).exec(query);
 if(alias&&ids[Number(alias[1])-1])matches.add(ids[Number(alias[1])-1]);
 if(!matches.size&&!alias){
  const prefix=query.startsWith(types[kind])?query.slice(types[kind].length):query;
  if(prefix.length<4)throw new WorkUsageError("Префикс должен содержать минимум 4 символа после типа; используйте номер из work status");
  for(const id of ids)if(id.startsWith(query)||(id.startsWith(types[kind])&&id.slice(types[kind].length).startsWith(prefix)))matches.add(id);
 }
 if(matches.size>1)throw new WorkUsageError(`Неоднозначный адрес ${query}: ${[...matches].join(", ")} — укажите полный ID`);
 if(!matches.size)throw new JournalError("not_found",`Адрес не найден: ${query}; перечитайте work status`);
 return [...matches][0];
}
export function resolveWorkOptions(state:CoreState,command:string,options:Record<string,string>):Record<string,string>{
 const key=({task:"session",run:"task",accept:"result",stop:"run",reconcile:"run",history:"task"} as const)[command as "task"|"run"|"accept"|"stop"|"reconcile"|"history"];
 if(!key||!options[key])return {...options};
 return {...options,[key]:resolveWorkId(state,key,options[key])};
}
export const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
