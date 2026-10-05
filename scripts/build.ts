/** Native standalone build. Only this build step reads git, never the installed CLI. */
import {spawnSync} from "node:child_process";
import {join,resolve} from "node:path";
const root=join(import.meta.dir,".."),args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==="--outfile"))throw Error("build: use --outfile FILE");
const version=Bun.version.split(".").map(Number);if(version[0]===1&&(version[1]<3||version[1]===3&&version[2]<11))throw Error("Standalone build requires Bun >= 1.3.11 (Bun 1.3.0 produces an invalid executable on newa)");
const git=(args:string[])=>{const p=spawnSync("git",["-C",root,...args],{encoding:"utf8",timeout:2000});if(p.status!==0)throw Error("Build requires an accessible git checkout");return p.stdout.trim();};
const sha=git(["rev-parse","HEAD"]);if(!/^[a-f0-9]{40,64}$/.test(sha))throw Error("Invalid git revision");
const dirty=!!git(["status","--porcelain"]),date=new Date().toISOString(),outfile=args[1]?resolve(args[1]):join(root,"dist/zinin");
const child=Bun.spawn([process.execPath,"build","--compile","src/repl.ts","--outfile",outfile,"--define",`ZININ_BUILD_GIT=${JSON.stringify(sha)}`,"--define",`ZININ_BUILD_DATE=${JSON.stringify(date)}`,"--define",`ZININ_BUILD_DIRTY=${JSON.stringify(dirty)}`],{cwd:root,stdin:"ignore",stdout:"inherit",stderr:"inherit"});
process.exitCode=await child.exited;
