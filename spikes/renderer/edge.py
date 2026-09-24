"""Reproducible negative width probe, not a full wcwidth oracle."""
import json,subprocess,unicodedata
from pathlib import Path
import sys
here=Path(__file__).resolve().parent
runtime=here.parents[1].parent/'runtime'
out=here/'evidence'/(sys.argv[1] if len(sys.argv)>1 else 'edge-01');out.mkdir(exist_ok=False)
f=json.loads((here/'fixture.json').read_text());f['service']='界'*80
p=out/'wide-fixture.json';p.write_text(json.dumps(f,ensure_ascii=False)+'\n')
results=[]
for name,cmd in [('ts',[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')]),('go',[str(runtime/'renderer-go')])]:
 command=[*cmd,str(p),'80','24','7','screen']
 d=json.loads(subprocess.check_output(command,text=True,timeout=30))
 line=next(l for l in d['initial'].splitlines() if l.startswith('A '))
 cells=sum(2 if unicodedata.east_asian_width(c) in ('W','F') else 1 for c in line)
 results.append(dict(candidate=name,criterion='TUI §5 wcwidth; §1 geometry',cells=cells,columns=80,status='FAIL' if cells>80 else 'PASS',line=line,command=command))
 (out/(name+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
(out/'summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False))
