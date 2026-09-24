import json
from pathlib import Path
runs=[]
for i in range(1,8):
    runs.append(dict(id=f'r{i}',task=f't{i}',owner=f'a{i}',engine='synthetic',state='working' if i<=3 else 'waiting',context='unknown',quota='unknown',cost='unknown',freshness='unknown'))
events=[dict(seq=i,run=f'r{(i-1)%7+1}',id=f'e{i}',tool='tool1',text=f'line-{i} synthetic',timestamp=3000-i) for i in range(1,2002)]
events[0]['text']='safe\x1b]52;c;SGVsbG8=\x07\x1b]8;;https://invalid.test\x1b\\link\x1b]8;;\x1b\\\x1b[31m text\x1b[0m'
events[1]['text']='Cyrillic: Привет; wide: 界; grapheme: 👩‍💻'
fixture=dict(label='SYNTHETIC',service='svc',group='grp',runs=runs,events=events,
 actions=[dict(kind='draft',text='draft-one'),dict(kind='select',index=1),dict(kind='draft',text='draft-two'),dict(kind='select',index=0),dict(kind='scroll',anchor=10),dict(kind='append',event=dict(seq=2002,run='r1',id='e2002',tool='tool1',text='late synthetic',timestamp=1)),dict(kind='resize',width=80,height=24),dict(kind='live')])
Path(__file__).with_name('fixture.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')
