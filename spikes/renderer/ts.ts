// Offline candidate only. No terminal loop, provider, or command dispatch.
const osc = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function safe(s: string): string {
  return s.replace(osc, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}
const input = await Bun.file(process.argv[2]).json();
const width = Number(process.argv[3]), height = Number(process.argv[4]);
const count = Number(process.argv[5]), plain = process.argv[6] === 'plain';
class Model {
  selected = 0; anchor = -1; unseen = 0; w = width; h = height;
  drafts = new Map<string,string>(); events = [...input.events];
  get run() { return input.runs[this.selected]; }
  get key() { return `${this.run.task}/${this.run.id}`; }
  update(a: any) {
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
    // Deliberately ASCII/codepoint baseline: wide/grapheme geometry is not claimed.
    return lines.map(l=>plain?safe(l):Array.from(safe(l)).slice(0,this.w).join('')).join('\n')+'\n';
  }
}
const m=new Model();const started=performance.now();
const initial=m.view();const trace=[];
for(const a of input.actions){m.update(a);trace.push({kind:a.kind,selected:m.run.id,draft:m.drafts.get(m.key)??'',anchor:m.anchor,unseen:m.unseen,frame:m.view()});}
console.log(JSON.stringify({initial,trace,elapsed_ms:performance.now()-started,scope:'batch Update/View only'}));
