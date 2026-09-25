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
  interruptLoaded=-1; horizontal=0; notices:string[]=[]; focus=''; tool=''; navigation:any[]=[];
  selected = 0; anchor = -1; unseen = 0; w = width; h = height;
  drafts = new Map<string,string>(); events: any[] = []; byRun = new Map<string,any[]>();
  constructor(){ for(const e of input.events) this.addEvent(e); }
  addEvent(e:any) {
    e.safeText = safe(e.text);
    e.line = `${e.seq} ${e.id}>s1>${e.run}>${e.tool}>res1 ${e.safeText} ts=${e.timestamp}`;
    this.events.push(e);
    const arr = this.byRun.get(e.run);
    if(!arr){ this.byRun.set(e.run,[e]); return; }
    const last = arr[arr.length-1];
    if(last.seq<=e.seq){ arr.push(e); return; }
    let lo=0, hi=arr.length;
    while(lo<hi){ const mid=(lo+hi)>>1; if(arr[mid].seq<e.seq) lo=mid+1; else hi=mid; }
    arr.splice(lo,0,e);
  }
  get run() { return input.runs[this.selected]; }
  get key() { return `${this.run.task}/${this.run.id}`; }
  update(a: any) {
    if(a.kind === 'horizontal') this.horizontal=Math.max(0,a.index);
    if(a.kind === 'select') this.selected = a.index;
    if(a.kind === 'draft') this.drafts.set(this.key,a.text);
    if(a.kind === 'scroll') this.anchor=a.anchor;
    if(a.kind === 'append') { this.addEvent(a.event); if(this.anchor>=0 && a.event.run===this.run.id) this.unseen++; }
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
      `C history new=${this.unseen} anchor=${this.anchor<0?'live':this.anchor}${this.focus?' focus='+this.focus:''}`);
    if(this.tool){const e=(this.byRun.get(r.id)??[]).find(e=>e.id===this.tool);if(e)lines.push(`TOOL ${e.id} ${e.tool} ${e.safeText}`);}
    const tail=[`D step=s1 owner=${r.owner} required working next=s2 done=0/2 /todo`,
      'Result res1 rev=1 digest=synthetic evidence=fixture',
      `Handoff ${r.id}->r2 phase=preview`,
      `E ${r.task}/${r.id} draft=${draft} queue=1 (steering unsupported)`,
      `F ${r.id} context=${r.context} status=${r.state}`,
      `quota=${r.quota} cost=${r.cost} fresh=${r.freshness}`];
    const ev=this.byRun.get(r.id)??[];
    const slots=Math.max(0,this.h-lines.length-tail.length);
    const start=plain?0:this.anchor<0?Math.max(0,ev.length-slots):Math.min(this.anchor,ev.length);
    for(const e of ev.slice(start,plain?undefined:start+slots)) lines.push(e.line);
    lines.push(...tail);
    return lines.map(l=>plain?safe(l):crop(safe(l),this.w,/^(A |[0-9])/.test(l)?this.horizontal:0)).join('\n')+'\n';
  }
}
const m=new Model();
if(process.argv[7]==='--tty') {
 m.focus='composer';
 let dirty=true, quit=false, pending='', paste=false, pasted='', frames=0;
 const decoder=new TextDecoder(); let cursor=0; let escapeTimer:any;
 const graphemes=(s:string)=>[...segments.segment(s)].map(x=>x.segment);
 function notice(s:string){m.notices.push(s);dirty=true;}
 function edit(text:string) {const a=graphemes(m.drafts.get(m.key)??'');a.splice(cursor,0,...graphemes(text));cursor+=graphemes(text).length;m.update({kind:'draft',text:a.join('')});dirty=true;}
 function navigate(key:string):boolean {
  if(key==='esc'){if(m.focus==='tool'){m.focus='history';m.tool='';}else m.focus='composer';notice('back to '+m.focus);}
  else if(key==='tab'){m.focus=m.focus==='composer'?'agents':m.focus==='agents'?'history':'composer';m.tool='';}
  else if(m.focus==='composer')return false;
  else if(key==='ctrl+a')m.focus='agents';
  else if(m.focus==='agents' && /^[1-7]$/.test(key)){const n=Number(key)-1;if(n<count){m.selected=n;cursor=graphemes(m.drafts.get(m.key)??'').length;m.anchor=-1;m.unseen=0;}}
  else if(m.focus==='history'){
   const ev=m.byRun.get(m.run.id)??[];
   const page=Math.max(1,m.h-count-11-(m.notices.length?1:0)),last=Math.max(0,ev.length-page);
   if(key==='up')m.anchor=Math.max(0,(m.anchor<0?last:m.anchor)-1);
   else if(key==='down')m.anchor=Math.min(Math.max(0,ev.length-1),(m.anchor<0?last:m.anchor)+1);
   else if(key==='home')m.anchor=0;
   else if(key==='end'){m.anchor=-1;m.unseen=0;}
   else if(key==='pgup')m.anchor=Math.max(0,(m.anchor<0?last:m.anchor)-page);
   else if(key==='pgdown')m.anchor=Math.min(last,(m.anchor<0?last:m.anchor)+page);
   else if(key==='enter' && ev.length){m.tool=ev[m.anchor<0?last:Math.min(m.anchor,ev.length-1)].id;m.focus='tool';}
  }
  if(m.navigation.length<64)m.navigation.push({key,focus:m.focus,selected:m.run.id,anchor:m.anchor,tool:m.tool,draft:m.drafts.get(m.key)??'',loaded,unseen:m.unseen,width:m.w,height:m.h});dirty=true;return true;
 }
 function enter() {
  const d=m.drafts.get(m.key)??'';
  if(d==='/quit') {quit=true;return;}
  if(/^\/agents [1-7]$/.test(d)) {m.drafts.set(m.key,'');m.update({kind:'select',index:Number(d.at(-1))-1});}
  else if(d==='/left'||d==='/right') {m.horizontal=Math.max(0,m.horizontal+(d==='/left'?-20:20));m.drafts.set(m.key,'');}
  else if(d==='/live') {m.anchor=-1;m.unseen=0;m.drafts.set(m.key,'');}
  else if(['/todo','/agents','/scope','/context','/handoff','/help'].includes(d)) {
   const routes:any={'/todo':'s1 required working owner='+m.run.owner+'; s2 required queued; done=0/2','/agents':input.runs.slice(0,count).map((r:any)=>r.id+':'+r.state).join(' '),'/scope':input.service+'/'+input.group+'/'+m.run.task,'/context':m.run.id+' context=unknown quota=unknown cost=unknown','/handoff':m.run.id+'->r2 preview synthetic only','/help':'/todo /agents /scope /context /handoff /quit; Tab focus; agents:1-7; history:PgUp/PgDn Home/End Enter; Ctrl+A/E edit; Esc back'};
   notice(d+' '+routes[d]);m.drafts.set(m.key,'');
  }
  else if(d.startsWith('/')) {m.drafts.set(m.key,'Unsupported in spike');}
  else m.drafts.set(m.key,'[synthetic queued] '+d);
  cursor=graphemes(m.drafts.get(m.key)??'').length;dirty=true;
 }
 function onInput(chunk:Buffer) {
  if(load && inputProgress.length<32)inputProgress.push({ms:performance.now()-started,loaded});
  clearTimeout(escapeTimer);pending+=decoder.decode(chunk,{stream:true});
  while(pending.length) {
   if(paste) {const end=pending.indexOf('\x1b[201~');if(end<0){return;} pasted+=pending.slice(0,end);pending=pending.slice(end+6);if(m.focus==='composer')edit(pasted.replace(/\r\n?/g,'\n'));pasted='';paste=false;continue;}
   if(pending.startsWith('\x1b[200~')) {paste=true;pending=pending.slice(6);continue;}
   if(pending==='\x1b') {escapeTimer=setTimeout(()=>{pending='';navigate('esc');},40);return;}
   if(pending.startsWith('\x1b[')) {const seq=pending.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);if(!seq)return;
    pending=pending.slice(seq[0].length);const nav:any={'\x1b[A':'up','\x1b[B':'down','\x1b[5~':'pgup','\x1b[6~':'pgdown','\x1b[H':'home','\x1b[F':'end'};if(nav[seq[0]]){navigate(nav[seq[0]]);continue;}if(m.focus!=='composer'){navigate(seq[0]);continue;}if(seq[0]==='\x1b[D')cursor=Math.max(0,cursor-1);else if(seq[0]==='\x1b[C')cursor=Math.min(graphemes(m.drafts.get(m.key)??'').length,cursor+1);continue;}
   if('\x1b[200~'.startsWith(pending)) return;
   const c=Array.from(pending)[0];pending=pending.slice(c.length);
   if(navigate(c==='\t'?'tab':c==='\r'?'enter':c==='\x01'?'ctrl+a':c))continue;
   if(c==='\r') enter();
   else if(c==='\x04' && !(m.drafts.get(m.key)??'')) quit=true;
   else if(c==='\x01') cursor=0;
   else if(c==='\x05') cursor=graphemes(m.drafts.get(m.key)??'').length;
   else if(c==='\x03') {if(m.drafts.get(m.key)){m.drafts.set(m.key,'');cursor=0;}
    else if(m.run.state==='working'){m.run.state='stopping';m.interruptLoaded=loaded;notice('interrupt requested '+m.run.id+' synthetic; repeat has no owned provider');}
    else if(m.run.state==='stopping')notice('no owned provider; escalation disabled');
    else notice('idle: /quit or Ctrl+D exits client');dirty=true;}

   else if(c==='\x7f') {const a=graphemes(m.drafts.get(m.key)??'');if(cursor>0)a.splice(--cursor,1);m.drafts.set(m.key,a.join(''));dirty=true;}
   else if(c>=' ') edit(c);
  }
 }
 process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onInput);
 process.stdout.write('\x1b[?2004h');
 const resize=()=>{m.w=process.stdout.columns||width;m.h=process.stdout.rows||height;if(m.focus==='tool' && m.navigation.length<64)m.navigation.push({key:'resize',focus:m.focus,selected:m.run.id,anchor:m.anchor,tool:m.tool,loaded,unseen:m.unseen,width:m.w,height:m.h});dirty=true;};
 process.stdout.on('resize',resize);resize();
 const load=process.argv.includes('--load'); let loaded=0, completedMs=0; const inputProgress:{ms:number,loaded:number}[]=[]; const frameTimes:number[]=[]; const started=performance.now();
 const loadTimer=load?setInterval(()=>{if(loaded>=512)return;loaded++;
  m.update({kind:'append',event:{seq:3000+loaded,id:`load-${loaded}`,run:`r${1+(loaded-1)%count}`,tool:'synthetic',text:'L'.repeat(16384),timestamp:loaded}});if(loaded===512)completedMs=performance.now()-started;dirty=true;
 },5):undefined;
 const timeout=setTimeout(()=>{quit=true;},5000);
 let writable=true,writes=0,framesSkipped=0,buildMsMax=0,buildMsTotal=0,writeMsMax=0,writeMsTotal=0;
 const lag={max:0,over50:0,over100:0,over250:0,total:0,count:0};
 const onDrain=()=>{writable=true;};
 process.stdout.on('drain',onDrain);
 await new Promise<void>(resolve=>{
  const TICK=34;let expected=performance.now()+TICK;let timer:any;
  const tick=()=>{
   const now=performance.now();
   let delay=now-expected;
   if(delay>TICK*2)expected=now+TICK;else expected+=TICK;
   if(delay<0)delay=0;
   lag.count++;lag.total+=delay;if(delay>lag.max)lag.max=delay;if(delay>50)lag.over50++;if(delay>100)lag.over100++;if(delay>250)lag.over250++;
   if(dirty&&writable){
    const b0=performance.now();const frame=m.view();const b1=performance.now();
    writable=process.stdout.write('\x1b[H\x1b[2J'+frame);const b2=performance.now();
    frames++;writes++;buildMsTotal+=b1-b0;if(b1-b0>buildMsMax)buildMsMax=b1-b0;writeMsTotal+=b2-b1;if(b2-b1>writeMsMax)writeMsMax=b2-b1;
    if(load)frameTimes.push(performance.now()-started);dirty=false;
   } else if(dirty&&!writable) framesSkipped++;
   if(quit){clearTimeout(timer);resolve();return;}
   timer=setTimeout(tick,Math.max(0,expected-performance.now()));
  };
  timer=setTimeout(tick,TICK);
 });
 clearInterval(loadTimer);clearTimeout(timeout);clearTimeout(escapeTimer);process.stdin.off('data',onInput);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.off('resize',resize);process.stdout.off('drain',onDrain);process.stdout.write('\x1b[?2004l');
 console.error(JSON.stringify({selected:m.run.id,drafts:Object.fromEntries(m.drafts),frames,width:m.w,height:m.h,notices:m.notices,state:m.run.state,focus:m.focus,tool:m.tool,anchor:m.anchor,unseen:m.unseen,interruptLoaded:m.interruptLoaded,navigation:m.navigation,
  writes,framesSkipped,frameBuildMsMax:buildMsMax,frameBuildMsAvg:writes?buildMsTotal/writes:0,writeMsMax,writeMsAvg:writes?writeMsTotal/writes:0,
  loopLagMs:{max:lag.max,avg:lag.count?lag.total/lag.count:0,over50:lag.over50,over100:lag.over100,over250:lag.over250,ticks:lag.count},
  ...(load?{loaded,loadBytes:loaded*16384,frameTimes,completedMs,inputProgress}: {})}));
 process.exit(0);
}
const started=performance.now();
const initial=m.view();const trace=[];
for(const a of input.actions){m.update(a);trace.push({kind:a.kind,selected:m.run.id,draft:m.drafts.get(m.key)??'',anchor:m.anchor,unseen:m.unseen,frame:m.view()});}
console.log(JSON.stringify({initial,trace,elapsed_ms:performance.now()-started,scope:'batch Update/View only'}));
