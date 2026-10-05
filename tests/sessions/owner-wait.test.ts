import {test,expect} from "bun:test";
import {parseNewaDir} from "../../src/adapters/sessions/newa-workdir";
import {addStatusEstimates} from "../../src/sessions/estimates";
import {renderOverview} from "../../src/sessions/overview";
const now=Date.parse("2026-10-05T20:00:00Z");
const packet='## 2026-10-05T10:00:00Z Запрос\n```json\n{"packet_id":"ZININ-E5-001","requested_receipt":"S0 прогоняет gate"}\n```';
const row=(to:string|null,report:string|null,state="idle")=>{
 const status=JSON.stringify({state});
 return addStatusEstimates(parseNewaDir({name:"example",metaText:null,statusText:status,toS0Text:to,reportText:report,taskText:null,nowMs:now}),status,now,now-9*3600000,now);
};
test("unanswered packet remains waiting beyond the mtime window and keeps prior submission",()=>{
 const r=row(packet,"## 2026-10-05T11:00:00Z\nСДАНО: рабочий обзор");
 expect(r.waitingKind).toBe("receipt");expect(r.overviewGroup?.value).toBe("waiting");
 expect(r.decision?.text).toBe("ждёт квитанцию ZININ-E5-001");expect(r.lastSubmission).not.toBeNull();
 expect(renderOverview([r],[],now,0,160)).toContain("сдано раньше:");
});
test("later timestamped receipt resolves a packet; older or undated acknowledgements do not",()=>{
 expect(row(packet,"## 2026-10-05T12:00:00Z\nКвитанция получена: PASS_SIGNAL").waitingKind).toBeUndefined();
 expect(row(packet,"## 2026-10-05T09:00:00Z\nКвитанция получена").waitingKind).toBe("receipt");
 expect(row(packet,"Квитанция получена").waitingKind).toBe("receipt");
 expect(row(packet+"\n## 2026-10-05T12:00:00Z\nКвитанция получена",null).waitingKind).toBeUndefined();
});
test("handoff waits only while idle and sorts after actual questions",()=>{
 const handoff={...row(null,"## 2026-10-05T19:00:00Z\nСДАНО: обзор\nЖду слова S0"),id:"handoff",lastActivityMs:now};
 const question={...row("## 2026-10-05T10:00:00Z\nВопрос: выбрать формат?",null),id:"question",lastActivityMs:now-60000};
 expect(handoff.overviewGroup?.value).toBe("waiting");expect(handoff.decision?.text).toBe("сдано, ждёт слова");
 expect(row(null,"Ожидаю слово S0","running").overviewGroup?.value).toBe("working");
 const out=renderOverview([handoff,question],[],now);
 expect(out.indexOf("question")).toBeLessThan(out.indexOf("handoff"));
});
test("only the last substantive TO entry is an unanswered request; controller notices are ignored",()=>{
 expect(row(packet+"\nTurn 000001 stopped: exit=1; inspect tail",null).waitingKind).toBe("receipt");
 expect(row(packet+"\n## 2026-10-05T12:00:00Z\nНовая справочная запись",null).waitingKind).toBeUndefined();
});
