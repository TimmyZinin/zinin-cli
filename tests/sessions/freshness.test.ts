import { test, expect } from "bun:test";
import { filterRecent, parseSince, DEFAULT_SINCE_MS } from "../../src/sessions/freshness";
import { parseNewaDir } from "../../src/adapters/sessions/newa-workdir";
import { collect } from "../../src/ps";
import { renderJson } from "../../src/sessions/render";
import { renderOverview } from "../../src/sessions/overview";
const now = 2 * DEFAULT_SINCE_MS;
const row = (age: number | null, state = "idle") => parseNewaDir({ name: String(age) + state, metaText:null, statusText:JSON.stringify({state}), reportText:null, toS0Text:null, taskText:null, nowMs:now, activityMs:age === null ? null : now-age });
test("default 24h includes boundary and every running session, hides old/unknown idle", () => {
  const rows = [row(DEFAULT_SINCE_MS), row(DEFAULT_SINCE_MS+1), row(null), row(DEFAULT_SINCE_MS+1,"running")];
  expect(filterRecent(rows,now).rows).toEqual([rows[0],rows[3]]);
  expect(filterRecent(rows,now).hidden_count).toBe(2);
  expect(filterRecent(rows,now,true)).toEqual({rows,hidden_count:0});
  expect(filterRecent(rows,now,false,parseSince("2d")).rows).toHaveLength(3);
});
test("duration arguments reject missing, zero, negative, unsupported and overflowing values", () => {
  expect(parseSince("24h")).toBe(DEFAULT_SINCE_MS); expect(parseSince("30m")).toBe(1800000);
  for(const value of [undefined,"0h","-1h","1y","1","999999999999999d"]) expect(() => parseSince(value)).toThrow();
});
test("collector applies the same filtering and hidden count to text/JSON and requests full remote snapshot", async () => {
  let args: string[] = [];
  const result = await collect({sources:"newa",json:true,watchSeconds:null,stuckMinutes:undefined}, {host:"mac",now:()=>now,remoteCommand:["fixture"], run:async cmd => { args=[...cmd]; return JSON.stringify({sessions:[row(1),row(DEFAULT_SINCE_MS+1)],machines:[{machine:"newa",memFreeMb:null,diskFreeMb:null}],hidden_count:0}); }});
  expect(args.at(-1)).toBe("--all"); expect(result.hidden_count).toBe(1);
  const json=JSON.parse(renderJson(result.rows,result.machines,now,undefined,result.hidden_count));
  expect(json.sessions).toHaveLength(1); expect(json.hidden_count).toBe(1);
  expect(renderOverview(result.rows,result.machines,now,result.hidden_count)).toContain("ещё 1 старых скрыто — zinin ps --all");
});
