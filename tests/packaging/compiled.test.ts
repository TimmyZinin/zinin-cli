import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
const repo=join(import.meta.dir,"../..");
export async function capture(args:string[],options:any={}){const p=Bun.spawn(args,{stdin:"ignore",stdout:"pipe",stderr:"pipe",...options});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,err,code};}
test("compiled CLI and embedded figlet run away from checkout with no PATH or node_modules",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"zinin-compiled-")),binary=join(dir,"zinin"),root=join(dir,"workers"),worker=join(root,"synthetic-worker"),home=join(dir,"home");mkdirSync(worker,{recursive:true});mkdirSync(home);
 writeFileSync(join(worker,"status.json"),JSON.stringify({state:"running"}));writeFileSync(join(worker,"TASK.md"),"Проверяет синтетическую таблицу");
 const build=await capture([process.execPath,"build","--compile","src/repl.ts","--outfile",binary],{cwd:repo});expect(build.code).toBe(0);expect(build.err).not.toContain("error:");expect(existsSync(join(dir,"node_modules"))).toBe(false);
 const env={PATH:"",HOME:home,ZININ_NO_TELEMETRY:"1",TERM:"xterm-256color"};
 for(const args of [["ps","--help"],["work","--help"],["--banner"]]){const run=await capture([binary,...args],{cwd:"/",env});expect(run.code).toBe(0);expect(run.err).not.toContain("ENOENT");expect(run.out.length).toBeGreaterThan(30);if(args[0]==="--banner")expect(run.out).toContain("██");}
 const run=await capture([binary,"ps","--sources","newa","--newa-root",root,"--json"],{cwd:"/",env});expect(run.code).toBe(0);expect(run.err).not.toContain("ENOENT");expect(JSON.parse(run.out).sessions[0].id).toBe("synthetic-worker");expect(existsSync(join(home,".zinin"))).toBe(false);
},120_000);

test("release build embeds git and build date independently of the user's cwd and PATH",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"zinin-versioned-")),binary=join(dir,"zinin"),root=join(dir,"workers");mkdirSync(root);
 const before=Date.now(),built=await capture([process.execPath,"scripts/build.ts","--outfile",binary],{cwd:repo});expect(built.code).toBe(0);
 const expected=(await capture(["git","-C",repo,"rev-parse","HEAD"])).out.trim(),env={PATH:"",HOME:dir,ZININ_NO_TELEMETRY:"1"};
 const version=await capture([binary,"--version"],{cwd:"/",env});expect(version.code).toBe(0);expect(version.err).toBe("");expect(version.out.trim().split("\n")).toHaveLength(1);expect(version.out).toContain(expected);
 const state=JSON.parse((await capture([binary,"ps","--sources","newa","--newa-root",root,"--json"],{cwd:"/",env})).out);expect(state.build.git).toBe(expected);expect(Date.parse(state.build.builtAt)).toBeGreaterThanOrEqual(before);expect(state.machines[0].version).toContain(expected);expect(state.machines[0].version).toContain(state.build.builtAt);expect(existsSync(join(dir,".zinin"))).toBe(false);
},120_000);
