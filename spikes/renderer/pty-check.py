"""Finite PTY smoke check. No setsid, daemon or human-terminal claims."""
import os,pty,fcntl,termios,struct,subprocess,select,time,signal,json,sys
from pathlib import Path
here=Path(__file__).resolve().parent;runtime=here.parents[1].parent/'runtime'
out=here/'evidence'/(sys.argv[1] if len(sys.argv)>1 else 'pty-01');out.mkdir(exist_ok=False)
summary=[]
for name,cmd in [('ts',[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')]),('go',[str(runtime/'renderer-go')])]:
 master,slave=pty.openpty()
 def size(w,h):fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',h,w,0,0))
 size(80,24)
 p=subprocess.Popen([*cmd,str(here/'fixture.json'),'80','24','7','screen','--tty'],stdin=slave,stdout=slave,stderr=subprocess.PIPE,env={**os.environ,'TERM':'xterm-256color','NO_COLOR':'1'})
 chunks=[];start=time.monotonic();sent=[]
 def drain(seconds):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   r,_,_=select.select([master],[],[],min(.03,max(0,end-time.monotonic())))
   if r:
    try:b=os.read(master,65536)
    except OSError:return
    if b:chunks.append((round(time.monotonic()-start,4),b))
 def send(b):os.write(master,b);sent.append(dict(t=round(time.monotonic()-start,4),hex=b.hex()))
 try:
  drain(.25);send(b'/agents 2\r');drain(.15)
  # Bracketed paste split both escape marker and UTF-8 at byte boundaries.
  data='\x1b[200~Привет 👩‍💻\nsecond\x1b[201~'.encode()
  if '--whole' in sys.argv:send(data)
  else:
   for b in data:send(bytes([b]));drain(.002)
  drain(.2)
  for w,h in [(100,30),(120,36),(79,24),(80,24)]:
   size(w,h);p.send_signal(signal.SIGWINCH);sent.append(dict(resize=[w,h]));drain(.12)
  while p.poll() is None and time.monotonic()-start<6:drain(.05)
  if p.poll() is None:p.kill()
  rc=p.wait(timeout=1);stderr=p.stderr.read().decode();raw=b''.join(b for _,b in chunks)
  (out/(name+'.ansi')).write_bytes(raw)
  (out/(name+'-events.json')).write_text(json.dumps(dict(chunks=[dict(t=t,bytes=len(b)) for t,b in chunks],sent=sent,stderr=stderr,returncode=rc),ensure_ascii=False,indent=2)+'\n')
  state=json.loads(stderr.strip().splitlines()[-1]);draft=state['drafts'].get('t2/r2','')
  checks=dict(exit_clean=rc==0,selected=state['selected']=='r2',paste_preserved=draft=='Привет 👩‍💻\nsecond',resize=state['width']==80 and state['height']==24,output_present=len(raw)>100)
  summary.append(dict(candidate=name,checks=checks,final=state,bytes=len(raw),duration=time.monotonic()-start))
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master);os.close(slave)
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
assert all(all(r['checks'].values()) for r in summary)
