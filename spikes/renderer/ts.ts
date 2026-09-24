// Synthetic-only renderer; optional finite terminal loop, no provider dispatch.
const osc = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function safe(s: string): string {
  return s.replace(osc, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}
const input = await Bun.file(process.argv[2]).json();
const width = Number(process.argv[3]), height = Number(process.argv[4]);
const count = Number(process.argv[5]), plain = process.argv[6] === 'plain';
const segments = new Intl.Segmenter("en", {granularity:"grapheme"});
function crop(s:string, width:number, offset=0) {
 let pos=0,out=""; for(const {segment} of segments.segment(s)) {const n=Bun.stringWidth(segment); if(pos>=offset && pos+n<=offset+width) out+=segment; else if(pos<offset && pos+n>offset) out+=" ".repeat(Math.min(pos+n-offset,width)); pos+=n; if(pos>=offset+width) break;} return out;
}
class Model {
  horizontal=0; notices:string[]=[];
  selected = 0; anchor = -1; unseen = 0; w = width; h = height;
  drafts = new Map<string,string>(); events = [...input.events];
  get run() { return input.runs[this.selected]; }
  get key() { return `${this.run.task}/${this.run.id}`; }
  update(a: any) {
    if(a.kind === 'horizontal') this.horizontal=Math.max(0,a.index);
    if(a.kind === 'select') this.selected = a.index;
    if(a.kind === 'draft') this.drafts.set(this.key,a.text);
    if(a.kind === 'scroll') this.anchor=a.anchor;
    if(a.kind === 'append') { this.events.push(a.event); if(this.anchor>=0) this.unseen++; }
    if(a.kind === 'resize') {this.w=a.width;this.h=a.height;}
    if(a.kind === 'live') {this.anchor=-1;this.unseen=0;}
  }
  view() {
    const r=this.run, draft=this.drafts.get(this.key)??'';
    const lines=[`${input.label} ZININ [o..] ${plain?'plain':this.w<80?'compact':'native'}`, 'TREE orchestrator waiting'];
    if(this.notices.length) lines.push('NOTICE '+this.notices.at(-1));
    for(const run of input.runs.slice(0,count)) lines.push(` ${run.id} ${run.owner} ${run.engine} ${run.state}`);
    lines.push(`A ${input.service}/${input.group}/${r.task} owner=${r.owner} result=res1`,
      `B executor/${r.engine}/${r.id}/${r.task} ${r.state} waiting=${input.runs.slice(0,count).filter((x:any)=>x.id!==r.id&&x.state==='waiting').length}`,
      `C history new=${this.unseen} anchor=${this.anchor<0?'live':this.anchor}`);
    const tail=[`D step=s1 owner=${r.owner} required working next=s2 done=0/2 /todo`,
      'Result res1 rev=1 digest=synthetic evidence=fixture',
      `Handoff ${r.id}->r2 phase=preview`,
      `E ${r.task}/${r.id} draft=${draft} queue=1 (steering unsupported)`,
      `F ${r.id} context=${r.context} status=${r.state}`,
      `quota=${r.quota} cost=${r.cost} fresh=${r.freshness}`];
    const ev=this.events.filter(e=>e.run===r.id).sort((a,b)=>a.seq-b.seq);
    const slots=Math.max(0,this.h-lines.length-tail.length);
    const start=plain?0:this.anchor<0?Math.max(0,ev.length-slots):Math.min(this.anchor,ev.length);
    for(const e of ev.slice(start,plain?undefined:start+slots)) lines.push(`${e.seq} ${e.id}>s1>${e.run}>${e.tool}>res1 ${e.text} ts=${e.timestamp}`);
    lines.push(...tail);
    return lines.map(l=>plain?safe(l):crop(safe(l),this.w,/^(A |[0-9])/.test(l)?this.horizontal:0)).join('\n')+'\n';
  }
}
const m=new Model();
if(process.argv[7]==='--tty') {
 let dirty=true, quit=false, pending='', paste=false, pasted='', frames=0;
 const decoder=new TextDecoder(); let cursor=0; let escapeTimer:any;
 const graphemes=(s:string)=>[...segments.segment(s)].map(x=>x.segment);
 function notice(s:string){m.notices.push(s);dirty=true;}
 function edit(text:string) {const a=graphemes(m.drafts.get(m.key)??'');a.splice(cursor,0,...graphemes(text));cursor+=graphemes(text).length;m.update({kind:'draft',text:a.join('')});dirty=true;}
 function enter() {
  const d=m.drafts.get(m.key)??'';
  if(d==='/quit') {quit=true;return;}
  if(/^\/agents [1-7]$/.test(d)) {m.drafts.set(m.key,'');m.update({kind:'select',index:Number(d.at(-1))-1});}
  else if(d==='/left'||d==='/right') {m.horizontal=Math.max(0,m.horizontal+(d==='/left'?-20:20));m.drafts.set(m.key,'');}
  else if(d==='/live') {m.anchor=-1;m.unseen=0;m.drafts.set(m.key,'');}
  else if(['/todo','/agents','/scope','/context','/handoff','/help'].includes(d)) {
   const routes:any={'/todo':'s1 required working owner='+m.run.owner+'; s2 required queued; done=0/2','/agents':input.runs.slice(0,count).map((r:any)=>r.id+':'+r.state).join(' '),'/scope':input.service+'/'+input.group+'/'+m.run.task,'/context':m.run.id+' context=unknown quota=unknown cost=unknown','/handoff':m.run.id+'->r2 preview synthetic only','/help':'/todo /agents /scope /context /handoff /quit; Ctrl+A/E edit; Esc back'};
   notice(d+' '+routes[d]);m.drafts.set(m.key,'');
  }
  else if(d.startsWith('/')) {m.drafts.set(m.key,'Unsupported in spike');}
  else m.drafts.set(m.key,'[synthetic queued] '+d);
  cursor=graphemes(m.drafts.get(m.key)??'').length;dirty=true;
 }
 function onInput(chunk:Buffer) {
  clearTimeout(escapeTimer);pending+=decoder.decode(chunk,{stream:true});
  while(pending.length) {
   if(paste) {const end=pending.indexOf('\x1b[201~');if(end<0){return;} pasted+=pending.slice(0,end);pending=pending.slice(end+6);edit(pasted.replace(/\r\n?/g,'\n'));pasted='';paste=false;continue;}
   if(pending.startsWith('\x1b[200~')) {paste=true;pending=pending.slice(6);continue;}
   if(pending==='\x1b') {escapeTimer=setTimeout(()=>{pending='';notice('back to composer');},40);return;}
   if(pending.startsWith('\x1b[')) {const seq=pending.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);if(!seq)return;
    pending=pending.slice(seq[0].length);if(seq[0]==='\x1b[D')cursor=Math.max(0,cursor-1);else if(seq[0]==='\x1b[C')cursor=Math.min(graphemes(m.drafts.get(m.key)??'').length,cursor+1);continue;}
   if('\x1b[200~'.startsWith(pending)) return;
   const c=Array.from(pending)[0];pending=pending.slice(c.length);
   if(c==='\r') enter();
   else if(c==='\x04' && !(m.drafts.get(m.key)??'')) quit=true;
   else if(c==='\x01') cursor=0;
   else if(c==='\x05') cursor=graphemes(m.drafts.get(m.key)??'').length;
   else if(c==='\x03') {if(m.drafts.get(m.key)){m.drafts.set(m.key,'');cursor=0;}
    else if(m.run.state==='working'){m.run.state='stopping';notice('interrupt requested '+m.run.id+' synthetic; repeat has no owned provider');}
    else if(m.run.state==='stopping')notice('no owned provider; escalation disabled');
    else notice('idle: /quit or Ctrl+D exits client');dirty=true;}

   else if(c==='\x7f') {const a=graphemes(m.drafts.get(m.key)??'');if(cursor>0)a.splice(--cursor,1);m.drafts.set(m.key,a.join(''));dirty=true;}
   else if(c>=' ') edit(c);
  }
 }
 process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onInput);
 process.stdout.write('\x1b[?2004h');
 const resize=()=>{m.w=process.stdout.columns||width;m.h=process.stdout.rows||height;dirty=true;};
 process.stdout.on('resize',resize);resize();
 const timeout=setTimeout(()=>{quit=true;},5000);
 await new Promise<void>(resolve=>{const timer=setInterval(()=>{if(dirty){process.stdout.write('\x1b[H\x1b[2J'+m.view());frames++;dirty=false;}if(quit){clearInterval(timer);resolve();}},34);});
 clearTimeout(timeout);clearTimeout(escapeTimer);process.stdin.off('data',onInput);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.off('resize',resize);process.stdout.write('\x1b[?2004l');
 console.error(JSON.stringify({selected:m.run.id,drafts:Object.fromEntries(m.drafts),frames,width:m.w,height:m.h,notices:m.notices,state:m.run.state}));
 process.exit(0);
}
const started=performance.now();
const initial=m.view();const trace=[];
for(const a of input.actions){m.update(a);trace.push({kind:a.kind,selected:m.run.id,draft:m.drafts.get(m.key)??'',anchor:m.anchor,unseen:m.unseen,frame:m.view()});}
console.log(JSON.stringify({initial,trace,elapsed_ms:performance.now()-started,scope:'batch Update/View only'}));
