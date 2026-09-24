"""Budget-sized fixture probe; logical payload is not measured resident memory."""
from pathlib import Path
import json, hashlib, subprocess, sys
here=Path(__file__).resolve().parent;runtime=here.parents[2]/'runtime'
out=here/'evidence'/sys.argv[1];out.mkdir(exist_ok=False)
f=json.loads((here/'fixture.json').read_text());f['actions']=[]
f['events']=[dict(seq=i,run='r1',id=f'budget-{i}',tool='budget-tool',text=('x'*1024 if i<2101 else 'z'*32768),timestamp=i) for i in range(1,2102)]
fixture=runtime/(sys.argv[1]+'-fixture.json')
with fixture.open('x') as file:json.dump(f,file)
rows=[]
for name,cmd in [('ts',[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')]),('go',[str(runtime/'renderer-go')])]:
 for mode in ['screen','plain']:
  p=subprocess.run([*cmd,str(fixture),'80','24','7',mode],capture_output=True,timeout=20)
  d=json.loads(p.stdout);frame=d['initial'];lines=frame.splitlines()
  rows.append(dict(candidate=name,mode=mode,returncode=p.returncode,stderr=p.stderr.decode(),output_sha256=hashlib.sha256(p.stdout).hexdigest(),output_bytes=len(p.stdout),frame_lines=len(lines),history_rows=sum(line[:1].isdigit() for line in lines),all_event_ids_visible=all(f'{i} budget-{i}>' in frame for i in range(1,2102)),middle_visible='1051 budget-1051>' in frame,full_large_event_visible='z'*32768 in frame,preview=lines[:3]+lines[-6:]))
summary=dict(fixture_sha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),fixture_generator='budget-check.py',logical_input=dict(selected_events=2101,selected_text_bytes=sum(len(e['text'].encode()) for e in f['events']),largest_event_text_bytes=32768),limits='Input accounting only, not runtime RSS/cache instrumentation. Arrays retain input events per source audit; no archive or budget enforcement exists.',results=rows)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
assert all(r['returncode']==0 and not r['stderr'] and (r['all_event_ids_visible'] if r['mode']=='plain' else r['frame_lines']<=24) for r in rows)
