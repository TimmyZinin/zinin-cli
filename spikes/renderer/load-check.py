"""Finite synthetic PTY workload; no provider, daemon, listener or new session."""
import os, pty, fcntl, termios, struct, subprocess, select, time, json, sys, hashlib
from pathlib import Path
here = Path(__file__).resolve().parent
runtime = here.parents[2] / 'runtime'
out = here / 'evidence' / sys.argv[1]
out.mkdir(exist_ok=False)
summary = []
for count in (3, 7):
 for name, cmd in [('ts', [str(runtime/'bun-1.3.0/bun'), str(here/'ts.ts')]), ('go', [str(runtime/'renderer-go')])]:
  master, slave = pty.openpty()
  fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',24,80,0,0))
  p = subprocess.Popen([*cmd,str(here/'fixture.json'),'80','24',str(count),'screen','--tty','--load'],stdin=slave,stdout=slave,stderr=subprocess.PIPE,env={**os.environ,'TERM':'xterm-256color','NO_COLOR':'1'})
  start=time.monotonic(); raw=bytearray(); chunks=[]; sent=[]; seen={}
  try:
   while p.poll() is None and time.monotonic()-start<6.5:
    elapsed=time.monotonic()-start
    if len(sent)<3 and elapsed>=(.8,1.4,2.0)[len(sent)]:
     token=f'P{len(sent)}'
     data=(('\x03' if sent else '')+token).encode()
     os.write(master,data);sent.append({'token':token,'t':time.monotonic()-start,'hex':data.hex()})
    ready,_,_=select.select([master],[],[],.005)
    if ready:
     b=os.read(master,65536);raw.extend(b);now=time.monotonic()-start
     chunks.append({'t':now,'bytes':len(b)})
     for item in sent:
      if item['token'] not in seen and ('draft='+item['token']).encode() in raw:
       seen[item['token']]=now
   if p.poll() is None:p.kill()
   rc=p.wait(timeout=1)
   # Drain the remaining PTY output while the slave is still open.
   while select.select([master],[],[],0)[0]:raw.extend(os.read(master,65536))
   stderr=p.stderr.read().decode();state=json.loads(stderr.strip().splitlines()[-1])
   times=state['frameTimes'] or []
   peak=max((sum(t<=x<t+1000 for x in times) for t in times),default=0)
   latency=[{'token':s['token'],'sent_ms':s['t']*1000,'visible_ms':seen.get(s['token'],0)*1000,'latency_ms':(seen[s['token']]-s['t'])*1000 if s['token'] in seen else None} for s in sent]
   checks={'exit_clean':rc==0,'no_stderr_errors':len(stderr.strip().splitlines())==1,'load_complete':state['loaded']==512 and state['loadBytes']==8388608,'input_preserved':state['drafts'].get('t1/r1')=='P2','all_probes_visible':len(seen)==3,'probes_visible_before_end':len(seen)==3 and max(seen.values())<5,'redraw_observed':len(times)>30,'redraw_at_most_30_per_sliding_second':len(times)>0 and peak<=30}
   row={'candidate':name,'streams':count,'checks':checks,'peak_redraws_per_second':peak,'latencies':latency,'output_bytes':len(raw),'final':state}
   summary.append(row)
   prefix=f'{name}-{count}'
   (out/(prefix+'.ansi')).write_bytes(raw)
   (out/(prefix+'-events.json')).write_text(json.dumps({'sent':sent,'chunks':chunks,'stderr':stderr,'returncode':rc},indent=2)+'\n')
   print(json.dumps({k:v for k,v in row.items() if k!='final'}),flush=True)
  finally:
   if p.poll() is None:p.kill();p.wait()
   os.close(master);os.close(slave)
(out/'summary.json').write_text(json.dumps({'workload':{'chunks':512,'bytes_per_chunk':16384,'target_interval_ms':5,'fixture_sha256':hashlib.sha256((here/'fixture.json').read_bytes()).hexdigest()},'results':summary},indent=2)+'\n')
assert all(all(r['checks'].values()) for r in summary)
