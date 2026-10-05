import {test,expect} from "bun:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {WorkCommandService} from "../../src/core/work-service";
import {WorkScreen,splitWorkCommand} from "../../src/tui/work-screen";
function fixture(){const dir=mkdtempSync(join(tmpdir(),"zinin-work-tui-"));const paths={journal:join(dir,"journal"),leases:join(dir,"leases")};const service=new WorkCommandService(paths,{create:true});service.session("open","s1","Задача",new Date().toISOString());return {service,paths};}
test("TUI exposes exact address before mutating through the shared service",async()=>{
 const {service}=fixture();let output="";const app=new WorkScreen(service,text=>output+=text,()=>{});
 const command='task --session s1 --id t1 --goal "Проверка импорта" --criteria "Все строки"';
 app.key({kind:"char",value:command});app.key({kind:"enter"});expect(Object.keys(service.state().tasks)).toHaveLength(0);expect(output).toContain("Адресат: session=s1");
 app.key({kind:"enter"});await Promise.all([...app.pending]);expect(service.state().tasks.t1.session_id).toBe("s1");
 expect(splitWorkCommand('accept --result "result 1" --revision 2')).toEqual(["accept","--result","result 1","--revision","2"]);
});
test("PTY restores canonical input echo and cursor on SIGINT SIGTERM and exception",async()=>{
 const {paths}=fixture();const script=String.raw`
import os,pty,subprocess,select,signal,sys,time,termios
bun,entry,journal,mode=sys.argv[1:]
master,slave=pty.openpty();before=termios.tcgetattr(slave)
if mode=='pending':
 service_module=os.path.normpath(os.path.join(os.path.dirname(entry),'../core/work-service.ts'))
 code='import {runWorkScreen} from '+repr(entry)+'; import {WorkCommandService} from '+repr(service_module)+'; const s=new WorkCommandService({journal:'+repr(journal)+',leases:'+repr(journal+'.leases')+'}); s.task("pending-task","s1","task-pending","goal","criteria",new Date().toISOString()); s.run=async()=>{process.stdout.write("fixture-pending"); await new Promise(()=>setInterval(()=>{},1000));}; try {await runWorkScreen(s);} catch {} finally {process.exit(1);}'
 args=[bun,'-e',code]
elif mode=='exception':
 code='import {runWorkScreen} from '+repr(entry)+'; try {await runWorkScreen({state(){throw Error("fixture")},stopOwned(){},ownedRunIds(){return new Set()}});} catch {} finally {process.exit(1);}'
 args=[bun,'-e',code]
else: args=[bun,entry,'work','--journal',journal]
p=subprocess.Popen(args,stdin=slave,stdout=slave,stderr=slave)
out=b'';deadline=time.monotonic()+10
while time.monotonic()<deadline and b'\x1b[?25l' not in out:
 if select.select([master],[],[],.1)[0]: out+=os.read(master,65536)
assert b'\x1b[?25l' in out,out
if mode=='pending':
 os.write(master,b'run --task t1 --engine local-demo\r\r')
 deadline=time.monotonic()+10
 while time.monotonic()<deadline and b'fixture-pending' not in out:
  if select.select([master],[],[],.1)[0]: out+=os.read(master,65536)
 assert b'fixture-pending' in out,out
 p.send_signal(signal.SIGTERM)
elif mode!='exception': p.send_signal(getattr(signal,mode))
try: p.wait(timeout=10)
except subprocess.TimeoutExpired: p.kill();p.wait();raise
assert p.returncode == (1 if mode in ('exception','pending') else 0),p.returncode
while select.select([master],[],[],.05)[0]: out+=os.read(master,65536)
after=termios.tcgetattr(slave)
assert before[3] & (termios.ICANON|termios.ECHO) == after[3] & (termios.ICANON|termios.ECHO)
assert b'\x1b[?25h' in out,out
os.close(master);os.close(slave)
`;
 for(const mode of ["SIGINT","SIGTERM","exception","pending"]){
  const entry=join(import.meta.dir,["exception","pending"].includes(mode)?"../../src/tui/work-screen.ts":"../../src/repl.ts");
  const p=Bun.spawn(["python3","-c",script,process.execPath,entry,paths.journal,mode],{stdout:"pipe",stderr:"pipe"});
  const [err,code]=await Promise.all([new Response(p.stderr).text(),p.exited]);expect(err).toBe("");expect(code).toBe(0);
 }
}, 40_000);
