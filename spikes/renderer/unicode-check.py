import json,subprocess,sys
from pathlib import Path
here=Path(__file__).resolve().parent;runtime=here.parents[1].parent/'runtime'
out=here/'evidence'/(sys.argv[1] if len(sys.argv)>1 else 'unicode-01');out.mkdir(exist_ok=False)
base=json.loads((here/'fixture.json').read_text());base['events']=[];base['actions']=[]
summary=[]
for label,service,prefix in [('zwj','a'*77+'👩‍💻END','A '+'a'*77),('combining','a'*77+'éEND','A '+'a'*77+'é'),('cjk','a'*77+'界END','A '+'a'*77),('horizontal','a'*100+'END','A '+'a'*78)]:
 f={**base,'service':service,'actions':[{'kind':'horizontal','index':95}] if label=='horizontal' else []}
 p=out/(label+'.json');p.write_text(json.dumps(f,ensure_ascii=False)+'\n')
 for name,cmd in [('ts',[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')]),('go',[str(runtime/'renderer-go')])]:
  d=json.loads(subprocess.check_output([*cmd,str(p),'80','24','7','screen'],text=True,timeout=10))
  line=next(l for l in d['initial'].splitlines() if l.startswith('A '))
  checks={'cluster_boundary':line==prefix}
  if label=='horizontal':checks.update(detail_reachable='END/svc' in d['trace'][0]['frame'] or 'END/grp/t1' in d['trace'][0]['frame'],footer_preserved='F r1 context=unknown status=working' in d['trace'][0]['frame'])
  (out/(name+'-'+label+'-output.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
  summary.append(dict(candidate=name,case=label,checks=checks))
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary));assert all(all(x['checks'].values()) for x in summary)
