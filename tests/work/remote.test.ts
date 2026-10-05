import {test,expect} from "bun:test";import {fixture} from "./reconcile.test";import {remoteWorkStatus,parseRemoteWorkState} from "../../src/work-remote";import {renderWorkStatus} from "../../src/work";
test("remote status reuses SSH prefix, quotes journal, bounds command and never offers local accept",async()=>{
 const {service}=fixture();let argv:string[]=[],options:any;
 const state=await remoteWorkStatus("/tmp/it's $(touch no)",{command:["ssh","-o","BatchMode=yes","newa","/bun","/entry.ts","ps","--sources","newa","--json"],run:async(a,o)=>{argv=a;options=o;return JSON.stringify(service.state());}});
 expect(argv.slice(0,9)).toEqual(["ssh","-o","BatchMode=yes","newa","/bun","/entry.ts","work","status","--json"]);expect(argv.at(-1)).toBe("'/tmp/it'\\''s $(touch no)'");expect(options.timeoutMs).toBe(6000);expect(options.maxBytes).toBeGreaterThan(0);expect(state).toEqual(service.state());expect(renderWorkStatus(state,undefined,new Set(),true)).not.toContain("zinin work accept");
});
test("remote malformed tables references and transport failures are rejected",async()=>{
 const {service}=fixture(),state=service.state();expect(()=>parseRemoteWorkState('{"seq":0}')).toThrow();
 const bad=structuredClone(state);bad.runs["run-task-one-1"].session_id="other";expect(()=>parseRemoteWorkState(JSON.stringify(bad))).toThrow();
 await expect(remoteWorkStatus(undefined,{command:["ssh","newa","zinin","ps"],run:async()=>{throw Error("timeout");}})).rejects.toThrow("Удалённый журнал");
});
