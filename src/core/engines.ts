/** Engine adapter: run one prompt through a provider CLI and capture the
 * result plus the provider session id (R07 resume stays in the same engine).
 * The transport is injectable so tests never spawn a real CLI.
 */
export interface EngineResult {
  text: string;
  provider_session: string | null;
}
export interface EngineTransport {
  (args: string[], opts: { timeoutMs: number; cwd?: string; signal?:AbortSignal }): Promise<{ lines: string[]; code: number; stderr: string }>;
}
export class EngineError extends Error {
  constructor(public readonly code: "timeout" | "failed" | "malformed", message: string) {
    super(message);
  }
}
const defaultBin = process.env.ZININ_KIMI_BIN ?? "/usr/local/bin/kimi";
export function kimiTransport(bin: string = defaultBin): EngineTransport {
  return async (args, opts) => {
    if(opts.signal?.aborted) throw new EngineError("failed","Run cancelled");
    const proc=Bun.spawn([bin,...args],{cwd:opts.cwd??"/",stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    let failure:string|null=null, bytes=0, escalation:ReturnType<typeof setTimeout>|undefined;
    const stop=(reason:string)=>{if(failure)return;failure=reason;try{proc.kill("SIGTERM");}catch{} escalation=setTimeout(()=>{try{proc.kill("SIGKILL");}catch{}},500);};
    const abort=()=>stop("Run cancelled");opts.signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(()=>stop("Engine timeout"),opts.timeoutMs);
    if(opts.signal?.aborted) abort();
    const read=async(stream:ReadableStream<Uint8Array>,keep:boolean)=>{
      const reader=stream.getReader(),chunks:Uint8Array[]=[];
      try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>256*1024)stop("Engine output limit exceeded");if(keep&&!failure)chunks.push(value);}}
      finally {reader.releaseLock();}
      return Buffer.concat(chunks).toString("utf8");
    };
    try {
      const [stdout,,code]=await Promise.all([read(proc.stdout,true),read(proc.stderr,false),proc.exited]);
      if(failure)throw new EngineError(failure==="Engine timeout"?"timeout":"failed",failure);
      if(code!==0)throw new EngineError("failed",`Engine exited with code ${code}`);
      return {lines:stdout.split("\n").filter(line=>line.trim()),code,stderr:""};
    } finally {clearTimeout(timer);if(escalation)clearTimeout(escalation);opts.signal?.removeEventListener("abort",abort);if(proc.exitCode===null){try{proc.kill("SIGKILL");}catch{}}}
  };
}
export class KimiEngine {
  constructor(private transport: EngineTransport = kimiTransport(), private model?: string, private maxChars = 32_000) {}
  async run(prompt: string, opts: { timeoutMs?: number; cwd?: string; signal?:AbortSignal } = {}): Promise<EngineResult> {
    if (!prompt.trim()) throw new EngineError("malformed", "Empty prompt");
    const args = ["-p", prompt, "--output-format", "stream-json"];
    if (this.model) args.push("--model", this.model);
    const { lines, code, stderr } = await this.transport(args, { timeoutMs: opts.timeoutMs ?? 120_000, cwd: opts.cwd, signal:opts.signal });
    let text = "";
    let provider_session: string | null = null;
    for (const line of lines) {
      let msg: { role?: string; type?: string; content?: unknown; session_id?: unknown };
      try { msg = JSON.parse(line); }
      catch { throw new EngineError("malformed", `Undecodable engine line: ${line.slice(0, 80)}`); }
      if (msg.role === "assistant" && typeof msg.content === "string") text += msg.content;
      if (msg.role === "meta" && msg.type === "session.resume_hint" && typeof msg.session_id === "string") provider_session = msg.session_id;
      if (text.length > this.maxChars) throw new EngineError("malformed", `Engine output exceeds ${this.maxChars} chars`);
    }
    if (!text.trim()) throw new EngineError(code === 0 ? "malformed" : "failed", `Engine gave no answer (code ${code}): ${stderr.slice(0, 160)}`);
    return { text: text.trim(), provider_session };
  }
}
