"""Paired before/after trials in configurable round ranges, retaining failed runs.

Usage: repeat-latency-e2.py SERIES-LABEL [--rounds START:END]
Each invocation runs latency-check.py per round with alternating candidate
order and writes an aggregate over its own rounds only. No report appends.
"""
from pathlib import Path
import subprocess,sys,json,hashlib,platform,statistics,os,time,datetime
here=Path(__file__).resolve().parent;root=here.parents[2];runtime=root/'runtime'
label=sys.argv[1]
start,end=1,10
if '--rounds' in sys.argv:
    a=sys.argv.index('--rounds');start,end=(int(x) for x in sys.argv[a+1].split(':'))
out=here/'evidence'/label
out.mkdir(exist_ok='--rounds' in sys.argv)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
manifest={'series':label,'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'platform':platform.platform(),'machine':platform.machine(),'cpu_count':os.cpu_count(),
 'clock':str(time.get_clock_info('monotonic')),
 'method':'paired sequential rounds, alternating candidate order; no concurrent benchmark children; 30 acknowledged probes/case; 3 and 7 streams; Go FPS29, TS 34ms; 80x24 xterm-256color NO_COLOR=1',
 'rounds':[start,end],
 'hashes':{str(p.relative_to(root)):digest(p) for p in [runtime/'bun-1.3.0/bun',runtime/'renderer-go',here/'ts.ts',here/'go/main.go',here/'fixture.json',here/'latency-check.py']},
 'trials':[]}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
rows=[]
for i in range(start,end+1):
 name=f'{label}-round-{i:02d}'
 cmd=[sys.executable,str(here/'latency-check.py'),name,'--fps=29']+(['--reverse'] if i%2==0 else [])
 with (out/f'round-{i:02d}.log').open('w') as log:p=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=40)
 manifest['trials'].append({'round':i,'directory':name,'command':cmd,'returncode':p.returncode})
 data=json.loads((here/'evidence'/name/'summary.json').read_text())
 for r in data['results']:rows.append(dict(round=i,evidence=f'../{name}/summary.json',**r))
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('round',i,'exit',p.returncode,flush=True)
groups=[]
for name in ['ts','go']:
 for count in [3,7]:
  group=[r for r in rows if r['candidate']==name and r['streams']==count]
  complete=[r for r in group if r['sample_count']==30]
  values=[r['p95_input_visibility_ms'] for r in complete]
  quartiles=statistics.quantiles(values,n=4,method='inclusive') if len(values)>1 else [None]*3
  groups.append(dict(candidate=name,streams=count,trials=len(group),complete_trials=len(complete),
   p95_by_round_ms=[r['p95_input_visibility_ms'] if r['sample_count']==30 else None for r in group],
   min_ms=min(values) if values else None,median_ms=statistics.median(values) if values else None,
   max_ms=max(values) if values else None,stdev_ms=statistics.stdev(values) if len(values)>1 else None,
   q1_ms=quartiles[0],q3_ms=quartiles[2],trials_below_50ms=sum(v<50 for v in values),
   max_sample_ms=max((max(x['latency_ms'] for x in r['latencies']) for r in complete),default=None),
   failed_checks=[{'round':r['round'],'checks':[k for k,v in r['checks'].items() if not v]} for r in group if not all(r['checks'].values())]))
(out/f'aggregate-rounds-{start:02d}-{end:02d}.json').write_text(json.dumps({'groups':groups,'rows':rows},indent=2)+'\n')
print(json.dumps(groups),flush=True)
