"""Finite history/resize/interrupt PTY probe on the existing 8MiB load."""
import os, pty, fcntl, termios, struct, subprocess, select, time, signal, json, sys, re
from pathlib import Path
here=Path(__file__).resolve().parent; runtime=here.parents[2]/'runtime'
out=here/'evidence'/sys.argv[1];out.mkdir(exist_ok=False)
results=[]
for count in (3,7):
 for name,cmd in [('ts',[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')]),('go',[str(runtime/'renderer-go')])]:
  master,slave=pty.openpty()
  def resize(w,h):fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',h,w,0,0))
  resize(80,24);prefix=f'{name}-{count}'
  # File stderr avoids pipe backpressure from combined navigation/load diagnostics.
  with (out/(prefix+'-stderr.json')).open('w+') as diagnostic:
   p=subprocess.Popen([*cmd,str(here/'fixture.json'),'80','24',str(count),'screen','--tty','--load'],stdin=slave,stdout=slave,stderr=diagnostic,env={**os.environ,'TERM':'xterm-256color','NO_COLOR':'1'})
   start=time.monotonic();raw=bytearray();sent=[];chunks=[];visible=None;ready_at=None
   actions=[(.3,b'\t\t\x1b[H\r'),(.8,(100,30)),(1.,(79,24)),(1.2,b'\x1b'),(1.35,b'\x1b'),(1.5,b'\x03'),(1.7,b'\x03'),(2.,b'\t\t\x1b[F'),(2.3,(80,24))]
   try:
    while p.poll() is None and time.monotonic()-start<6.5:
     now=time.monotonic()-start
     if len(sent)<len(actions) and ready_at is not None and now>=ready_at+actions[len(sent)][0]:
      _,action=actions[len(sent)]
      if isinstance(action,tuple):resize(*action);p.send_signal(signal.SIGWINCH);sent.append({'t':time.monotonic()-start,'resize':action})
      else:os.write(master,action);sent.append({'t':time.monotonic()-start,'hex':action.hex()})
     if select.select([master],[],[],.005)[0]:
      b=os.read(master,65536);raw.extend(b);now=time.monotonic()-start;chunks.append({'t':now,'bytes':len(b)})
      if ready_at is None and b'C history' in raw:ready_at=now
      if visible is None and b'interrupt requested r1' in raw:visible=now
    if p.poll() is None:p.kill()
    rc=p.wait(timeout=1)
    while select.select([master],[],[],0)[0]:raw.extend(os.read(master,65536))
    diagnostic.seek(0);stderr=diagnostic.read();state=json.loads(stderr.strip().splitlines()[-1])
    nav=state.get('navigation') or [];home=next((x for x in nav if x['key']=='home'),None)
    held=[x for x in nav if x['key']=='resize' and x['focus']=='tool']
    checkpoints=[x for x in nav if x['key']=='esc' and x['focus']=='history']+held
    def expected(x):return (x['loaded']+count-1)//count-(home['loaded']+count-1)//count
    checks=dict(exit_clean=rc==0,no_stderr_errors=len(stderr.strip().splitlines())==1,load_complete=state['loaded']==512,scroll_before_complete=home is not None and 0<home['loaded']<512,tool_anchor_held=len(held)==2 and all(x['anchor']==0 and x['tool']=='e1' for x in held),resize_observed=[(x['width'],x['height']) for x in held]==[(100,30),(79,24)],selected_new_count=bool(home and checkpoints) and all(x['unseen']==expected(x) and expected(x)>0 for x in checkpoints),new_count_visible=any(int(n)>0 for n in re.findall(rb'C history new=(\d+)',raw)),tool_visible=b'TOOL e1 tool1 safelink text' in raw,interrupt_during_load=0<state.get('interruptLoaded',0)<512,stopping=state['state']=='stopping',interrupt_visible=visible is not None,escalation_guard=any('escalation disabled' in n for n in state['notices']),jump_live=state['anchor']==-1 and state['unseen']==0 and state['focus']=='history',final_geometry=state['width']==80 and state['height']==24)
    request=next((x['t'] for x in sent if x.get('hex')=='03'),None)
    row={'candidate':name,'streams':count,'checks':checks,'interrupt_latency_ms':(visible-request)*1000 if visible is not None and request is not None else None,'checkpoints':[dict(x,expected_selected_new=expected(x)) for x in checkpoints] if home else [],'final':state}
    results.append(row);(out/(prefix+'.ansi')).write_bytes(raw)
    (out/(prefix+'-events.json')).write_text(json.dumps({'sent':sent,'chunks':chunks,'returncode':rc,'ready_at':ready_at},indent=2)+'\n')
    print(json.dumps({k:v for k,v in row.items() if k not in ('final','checkpoints')}),flush=True)
   finally:
    if p.poll() is None:p.kill();p.wait()
    os.close(master);os.close(slave)
(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(all(r['checks'].values()) for r in results)
