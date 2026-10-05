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
