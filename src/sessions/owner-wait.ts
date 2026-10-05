import { CONTROLLER_NOTICE, cleanDescription } from "./description";
import type { DecisionEvidence } from "./types";
export type WaitingKind = "receipt" | "question" | "handoff";
interface Entry { atMs: number | null; lines: string[]; packet: string | null }
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/;
const REPLY = /квитанци[яи]\s+(?:\S+\s+)?получен[аы]|получена\s+через\s+say|(?:^|[\s:])принято(?=[\s.,:;]|$)/i;
const REQUEST = /(?:^|[\s:])(?:Вопрос|Блокер)(?=[\s:,.!?]|$)|требуется\s+квитанция|жду\s+(?:решения|слова)|ожидаю\s+слово|WAITING_S0_RECEIPT/i;
function entries(text: string | null, nowMs: number): Entry[] {
  const result: Entry[] = []; let current: Entry = {atMs:null,lines:[],packet:null};
  let fence: string | null = null, code: string[] = [];
  const flush=()=>{ if(current.lines.length || current.packet) result.push(current); };
  for(const raw of (text??"").split("\n")) {
    const line=raw.trim(); const delimiter=/^(`{3,}|~{3,})/.exec(line)?.[1];
    if(delimiter) {
      if(!fence) {fence=delimiter;code=[];}
      else if(delimiter[0]===fence[0] && delimiter.length>=fence.length) {
        try {const p=JSON.parse(code.join("\n"));if(p && typeof p.packet_id==="string" && typeof p.requested_receipt==="string" && p.requested_receipt.trim()) current.packet=p.packet_id.slice(0,128);} catch {}
        fence=null;
      }
      continue;
    }
    if(fence) {code.push(raw);continue;}
    if(!line || line.startsWith(">") || CONTROLLER_NOTICE.test(cleanDescription(line)) || /^[—–-]\s+\S.{0,40}\([^)]*\)\s*$/.test(line)) continue;
    const stamp=ISO.exec(line)?.[0];
    if(/^#{1,3}\s/.test(line) || (stamp && /^\[?\d{4}-/.test(line))) {
      flush(); const parsed=stamp ? Date.parse(stamp) : NaN;
      current={atMs:Number.isFinite(parsed)&&parsed<=nowMs ? parsed:null,lines:[],packet:null};
    }
    current.lines.push(line.replace(/^#+\s*/,""));
  }
  flush();return result;
}
export function ownerWait(to: string | null, report: string | null, nowMs: number): {pending: (DecisionEvidence & {kind:WaitingKind}) | null; answered:boolean} {
  const toEntries=entries(to,nowMs), reports=entries(report,nowMs), latest=toEntries.at(-1);
  const question=latest?.lines.find(line=>REQUEST.test(line));
  const request=latest && (latest.packet || question) ? latest : null;
  const answered=!!request && request.atMs!==null && [...toEntries,...reports].some(entry=>entry.atMs!==null && entry.atMs>request.atMs! && entry.lines.some(line=>REPLY.test(line)));
  if(request && !answered) return {answered:false,pending:{kind:request.packet ? "receipt":"question",text:request.packet ? `ждёт квитанцию ${request.packet}` : cleanDescription(question!),source:"TO-S0.md",atMs:request.atMs,freshness:"unknown"}};
  // Readiness/status lines may follow the handoff sentence. Ignore quoted and
  // fenced examples (entries already filters them), and bound stale history.
  const tail = reports.flatMap(entry => entry.lines.map(line => ({line, atMs:entry.atMs}))).slice(-5);
  const handoff = [...tail].reverse().find(({line}) => /(?:ожидаю|жду)\s+(?:следующ(?:его|ее)\s+)?(?:квитанцию\s*\/\s*)?слов[ао]\s+S0/i.test(line));
  if (handoff) {
    const readiness = [...tail].reverse().map(({line}) => cleanDescription(line))
      .find(line => /^ЭТАП\s+\d+\s+ГОТОВ(?=\s|$)/i.test(line));
    const title = readiness?.split(/\s+[—–-]\s+(?:HEAD|тесты)(?=\s|$)/i)[0].replace(/[.。]+$/, "");
    return {answered,pending:{kind:"handoff",text:title ? `сдано: ${title} · ждёт слова` : "сдано, ждёт слова",source:"REPORT-S0.md",atMs:handoff.atMs,freshness:"unknown"}};
  }
  return {pending:null,answered};
}
