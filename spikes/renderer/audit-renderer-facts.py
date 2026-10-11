"""Recompute ADR latency/spread from raw PTY chunks and verify parity counts."""
from pathlib import Path
import json,math,statistics,hashlib,sys
here=Path(__file__).resolve().parent;repo=here.parents[1];base=here/'evidence/latency-v2-ten'
adr=(repo/'docs/e1/renderer-adr-v2-proposed.md').read_text()
a=json.loads((base/'aggregate.json').read_text());m=json.loads((base/'manifest.json').read_text());verified=0
for trial in m['trials']:
 d=here/'evidence'/trial['directory'];s=json.loads((d/'summary.json').read_text())
 for r in s['results']:
  prefix=f"{r['candidate']}-{r['streams']}"
  e=json.loads((d/(prefix+'-events.json')).read_text());raw=(d/(prefix+'.ansi')).read_bytes()
  seen={};offset=0
  for chunk in e['chunks']:
   offset+=chunk['bytes']
   for send in e['sent']:
    if send['token'] not in seen and chunk['t']>=send['t'] and ('draft='+send['token']).encode() in raw[:offset]:seen[send['token']]=chunk['t']
  vals=[]
  for send in e['sent']:
   v=(seen[send['token']]-send['t'])*1000;vals.append(v)
   recorded=next(x for x in r['latencies'] if x['token']==send['token'])
   assert abs(v-recorded['latency_ms'])<1e-8
  assert len(vals)==30
  p95=sorted(vals)[math.ceil(.95*len(vals))-1]
  assert p95==r['p95_input_visibility_ms']
  aggregate=next(x for x in a['rows'] if x['round']==trial['round'] and x['candidate']==r['candidate'] and x['streams']==r['streams'])
  assert all(aggregate[k]==v for k,v in r.items())
  verified+=len(vals)
for g in a['groups']:
 vals=[x['p95_input_visibility_ms'] for x in a['rows'] if x['candidate']==g['candidate'] and x['streams']==g['streams']]
 assert len(vals)==10
 quartiles=statistics.quantiles(vals,n=4,method='inclusive')
 expected=[min(vals),statistics.median(vals),max(vals),statistics.stdev(vals),quartiles[0],quartiles[2]]
 assert expected==[g[k] for k in ['min_ms','median_ms','max_ms','stdev_ms','q1_ms','q3_ms']]
 row=f"| {g['candidate']} / {g['streams']} | 10/10 | {expected[0]:.2f} / {expected[1]:.2f} / {expected[2]:.2f} | {expected[3]:.2f} | {expected[4]:.2f}–{expected[5]:.2f} | {sum(v<50 for v in vals)}/10 |"
 assert row in adr,row
for i in range(1,11):
 vals=[next(x['p95_input_visibility_ms'] for x in a['rows'] if x['round']==i and x['candidate']==n and x['streams']==c) for n,c in [('ts',3),('go',3),('ts',7),('go',7)]]
 assert '| '+str(i)+' | '+' | '.join(f'{v:.2f}' for v in vals)+' |' in adr
parity=0
for suite in ['batch-06-history','unicode-01','pty-17-paste-regression','pty-15-semantics','pty-18-history-regression','history-load-03-verified']:
 data=json.loads((here/'evidence'/suite/'summary.json').read_text());rows=data['cases'] if isinstance(data,dict) else data
 for key in sorted({k for r in rows for k in r['checks']}):
  cells=[]
  for name in ['ts','go']:
   vals=[r['checks'][key] for r in rows if r['candidate']==name and key in r['checks']]
   assert all(vals);cells.append(f'{sum(vals)}/{len(vals)} PASS')
  assert f"| {suite} / {key} | {cells[0]} | {cells[1]} |" in adr
  parity+=1
out=Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True)
with out.open('x') as f:json.dump({'status':'PASS','method':'Raw ANSI prefixes + timed chunks + sent bytes -> all sample latencies -> nearest-rank p95 -> spread and ADR rounded tables; parity predicate counts vs suite logs','samples_verified':verified,'cases_verified':len(a['rows']),'parity_rows_verified':parity,'aggregate_sha256':hashlib.sha256((base/'aggregate.json').read_bytes()).hexdigest()},f,indent=2);f.write('\n')
print('PASS',verified,'samples;',parity,'parity rows')
