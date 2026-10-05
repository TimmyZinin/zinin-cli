import {test,expect} from "bun:test";
import {mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {WorkCommandService} from "../../src/core/work-service";
import {CoreJournal} from "../../src/core/journal";
import {renderWorkStatus} from "../../src/work";
const at="2026-10-05T21:00:00Z";
function fixture(){const dir=mkdtempSync(join(tmpdir(),"zinin-result-preview-")),paths={journal:join(dir,"journal"),leases:join(dir,"leases")},service=new WorkCommandService(paths,{create:true});service.session("s","session-preview","goal",at);service.task("t","session-preview","task-preview","goal","criteria",at);return {service,paths};}
test("durable result text matches accepted digest, status shows five lines and coherent totals",async()=>{
 const {service,paths}=fixture(),text="Первая строка\n\nВторая строка\nТретья строка\nЧетвёртая строка\nПятая строка\nШестая строка";
 await service.run("task-preview",at,{kind:"engine",name:"fake",adapter:{run:async()=>({text,provider_session:null})}});
 const reopened=new WorkCommandService(paths),state=reopened.state(),result=Object.values(state.results)[0];
 expect(result.text).toBe(text);expect(result.digest).toBe(createHash("sha256").update(text).digest("hex"));expect(CoreJournal.fold(paths.journal)).toEqual(state);
 const output=renderWorkStatus(state);expect(output).toContain("│ Первая строка");expect(output).toContain("│ Пятая строка");expect(output).not.toContain("Шестая строка");expect(output).toContain("ждут приёмки: 1 · выполняются: 0 · готово: 0");
 reopened.accept("accept",result.result_id,result.revision,result.digest,at);expect(renderWorkStatus(reopened.state())).toContain("ждут приёмки: 0 · выполняются: 0 · готово: 1");
});
test("legacy text stays explicitly absent, stale results do not offer accept and mismatched text is rejected",async()=>{
 const {service,paths}=fixture();await service.run("task-preview",at,{kind:"local-demo"});
 const journal=new CoreJournal(paths.journal);
 expect(()=>journal.submit({command_id:"bad-text",type:"result_recorded",payload:{result_id:"bad",task_id:"task-preview",revision:2,digest:"wrong",text:"other",evidence_ref:"fixture"}},at)).toThrow("match its digest");
 journal.submit({command_id:"legacy",type:"result_recorded",payload:{result_id:"legacy",task_id:"task-preview",revision:2,digest:"legacy-digest",evidence_ref:"fixture"}},at);journal.close();
 const output=renderWorkStatus(service.state());expect(output).toContain("Текст результата не сохранён (историческая запись)");expect(output.match(/zinin work accept/g)).toHaveLength(1);expect(output).toContain("--result 'legacy'");expect(output).toContain("ждут приёмки: 1 · выполняются: 0 · готово: 0");
});
