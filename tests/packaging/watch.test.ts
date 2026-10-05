import {test,expect} from "bun:test";import {join} from "node:path";
test("PTY watch replaces frames and restores the terminal after SIGINT while newa stays unavailable",async()=>{
 const script=String.raw`
import os,pty,subprocess,select,signal,sys,time,termios
bun,entry=sys.argv[1:]
master,slave=pty.openpty();before=termios.tcgetattr(slave)
code='import {psMain} from '+repr(entry)+'; await psMain(["--sources","newa","--watch","1"],{host:"newa",workJournalPath:null,newa:async()=>{throw Error("fixture unavailable")}});'
p=subprocess.Popen([bun,'-e',code],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TERM':'xterm-256color'})
out=b''
def drain():
 global out
 if select.select([master],[],[],.05)[0]: out+=os.read(master,65536)
try:
 deadline=time.monotonic()+10
 while time.monotonic()<deadline and out.count(b'\x1b[J')<2: drain()
 assert out.count(b'\x1b[J')>=2,out
 assert b'\x1b[?1049h' in out and b'\x1b[?25l' in out,out
 frames=out.split(b'\x1b[H')[1:]
 for frame in frames[:2]:
  assert frame.count('Недоступно: newa'.encode())==1,frame
  assert b'Error:' not in frame and b' at ' not in frame,frame
  assert b'\x1b[J' in frame,frame
 p.send_signal(signal.SIGINT)
 deadline=time.monotonic()+10
 while p.poll() is None and time.monotonic()<deadline: drain()
 assert p.poll()==0,(p.poll(),out)
 while select.select([master],[],[],.05)[0]: out+=os.read(master,65536)
 assert b'\x1b[?25h\x1b[?1049l' in out,out
 after=termios.tcgetattr(slave)
 assert before[3] & (termios.ICANON|termios.ECHO) == after[3] & (termios.ICANON|termios.ECHO)
finally:
 if p.poll() is None: p.kill();p.wait()
 os.close(master);os.close(slave)
`;
 const p=Bun.spawn(["python3","-c",script,process.execPath,join(import.meta.dir,"../../src/ps.ts")],{stdin:"ignore",stdout:"pipe",stderr:"pipe"});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(code).toBe(0);expect(err).toBe("");expect(out).toBe("");
},30_000);
