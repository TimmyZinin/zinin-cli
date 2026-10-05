import {test,expect} from "bun:test";import {readFileSync} from "node:fs";import {join} from "node:path";import {parsePsConfig} from "../../src/sessions/psconfig";
const repo=join(import.meta.dir,"../..");
test("installation guide contains a valid stable SSH configuration matching implemented commands",()=>{
 const readme=readFileSync(join(repo,"README.md"),"utf8"),section=readme.split("## Установка на Мак и на newa\n")[1].split("## Команды")[0];
 const config=JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)![1]);const command=parsePsConfig(JSON.stringify(config)).newaCmd!;
 expect(command[0]).toBe("ssh");expect(command).toContain("/home/agents/.local/bin/zinin");expect(command.join(" ")).not.toContain("/work/");expect(command.slice(-5)).toEqual(["/home/agents/.local/bin/zinin","ps","--sources","newa","--json"]);
 expect(section).toContain("bun install --frozen-lockfile --ignore-scripts");expect(section).toContain("bun run build");expect(JSON.parse(readFileSync(join(repo,"package.json"),"utf8")).scripts.build).toBe("bun scripts/build.ts");expect(section).toContain("machines[].version");expect(section).toContain("даты независимых сборок");
});
