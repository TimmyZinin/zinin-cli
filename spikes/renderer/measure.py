"""Run both offline candidates; record evidence, not a renderer verdict."""
import hashlib,json,os,statistics,subprocess,time
from pathlib import Path
import sys
here=Path(__file__).resolve().parent
root=here.parents[1]
runtime=root.parent/'runtime'
out=here/'evidence'/(sys.argv[1] if len(sys.argv)>1 else 'batch-01')
out.mkdir(exist_ok=False)
fixture=here/'fixture.json'
commands={'ts':[str(runtime/'bun-1.3.0/bun'),str(here/'ts.ts')], 'go':[str(runtime/'renderer-go')]}
results=[]
for count in (3,7):
 for w,h in ((80,24),(100,30),(120,36),(79,24)):
  for mode in ('screen','plain'):
   pair={}
   for name,cmd in commands.items():
    args=[*cmd,str(fixture),str(w),str(h),str(count),mode]
    start=time.perf_counter()
    p=subprocess.run(args,check=True,capture_output=True,text=True,timeout=30,env={**os.environ,'NO_COLOR':'1'})
    wall=(time.perf_counter()-start)*1000
    d=json.loads(p.stdout);pair[name]=d
    tag=f'{name}-{count}-{w}x{h}-{mode}'
    (out/(tag+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    lines=d['initial'].splitlines();trace=d['trace'];frame=d['initial']
    checks={
     'TUI1_zone_order': [frame.index('\n'+z+' ') for z in 'ABCDEF']==sorted(frame.index('\n'+z+' ') for z in 'ABCDEF'),
     'TUI1_fields': all(x in frame for x in ('TREE orchestrator','owner=a1','result=res1','executor/synthetic/r1/t1','waiting=','next=s2','done=0/2','/todo','E t1/r1','queue=1','steering unsupported','F r1 context=unknown status=working','quota=unknown cost=unknown fresh=unknown','rev=1 digest=synthetic evidence=fixture','r1->r2 phase=preview')),
     'TUI1_bounds_codepoints_only': mode=='plain' or (len(lines)<=h and max(map(len,lines))<=w),
     'TUI2_draft_roundtrip': trace[1]['draft']=='' and trace[2]['draft']=='draft-two' and trace[3]['draft']=='draft-one',
     'TUI1_selection_coherence': all(f'E t{2 if t["selected"]=="r2" else 1}/{t["selected"]}' in t['frame'] and f'F {t["selected"]} context=' in t['frame'] for t in trace),
     'TUI3_anchor_resize':trace[4]['anchor']==trace[5]['anchor']==trace[6]['anchor']==10 and trace[5]['unseen']==trace[6]['unseen']==1,
     'TUI3_explicit_live':trace[7]['anchor']==-1 and trace[7]['unseen']==0,
     'TUI3_no_controls_in_frames':all(not any(ord(c)<32 and c!='\n' or 127<=ord(c)<=159 for c in f) for f in [frame]+[t['frame'] for t in trace]),
    }
    if mode=='plain':
     expected=[e for e in json.loads(fixture.read_text())['events'] if e['run']=='r1']
     checks['TUI3_full_selected_transcript']=all(f'{e["seq"]} {e["id"]}>' in frame for e in expected)
     checks['TUI3_OSC_payload_removed']='SGVsbG8=' not in frame and 'https://invalid.test' not in frame and 'safelink text' in frame
     seqs=[int(line.split()[0]) for line in lines if line and line[0].isdigit()]
     checks['TUI3_committed_order']=seqs==sorted(seqs)
    results.append(dict(candidate=name,count=count,width=w,height=h,mode=mode,command=args,wall_ms=wall,render_ms=d['elapsed_ms'],bytes=len(p.stdout.encode()),checks=checks,evidence=tag+'.json'))
   assert pair['ts']['initial']==pair['go']['initial'] and pair['ts']['trace']==pair['go']['trace'], (count,w,h,mode)
summary=dict(fixture_sha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),scope='batch Update/View, not terminal loop',cases=results,parity_cases=16,
 versions=dict(bun='1.3.0 (b0a6feca)',go='1.24.2 linux/amd64',bubbletea='1.3.4'),
 limits=['No terminal loop/FPS/input latency/PTY measurement','No slash routes or key handling','Codepoint clipping is not wcwidth/grapheme geometry','No horizontal navigation below 80','No canonical mascot/palette/IME/screen-reader proof','Fixture events in memory; archive/cache budgets not implemented','Timing is one sample/case with different startup overhead, not winner evidence'])
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for name in commands:
 cases=[r for r in results if r['candidate']==name]
 print(name,'cases',len(cases),'checks',sum(len(r['checks']) for r in cases),'failures',[(r['evidence'],k) for r in cases for k,v in r['checks'].items() if not v], 'render_ms median',statistics.median(r['render_ms'] for r in cases),'wall_ms median',statistics.median(r['wall_ms'] for r in cases))
assert all(all(r['checks'].values()) for r in results)
