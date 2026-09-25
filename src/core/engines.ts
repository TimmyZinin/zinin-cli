/** Engine adapter: run one prompt through a provider CLI and capture the
 * result plus the provider session id (R07 resume stays in the same engine).
 * The transport is injectable so tests never spawn a real CLI.
 */
export interface EngineResult {
  text: string;
  provider_session: string | null;
}
export interface EngineTransport {
  (args: string[], opts: { timeoutMs: number; cwd?: string }): Promise<{ lines: string[]; code: number; stderr: string }>;
}
export class EngineError extends Error {
  constructor(public readonly code: "timeout" | "failed" | "malformed", message: string) {
    super(message);
  }
}
const defaultBin = process.env.ZININ_KIMI_BIN ?? "/usr/local/bin/kimi";
export function kimiTransport(bin: string = defaultBin): EngineTransport {
  return (args, opts) => new Promise((resolve, reject) => {
    const proc = Bun.spawn([bin, ...args], { cwd: opts.cwd ?? "/", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new EngineError("timeout", `Engine call exceeded ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    const decode = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return "";
      return await new Response(stream).text();
    };
    void (async () => {
      const [stdout, stderr] = await Promise.all([decode(proc.stdout), decode(proc.stderr)]);
      const code = await proc.exited;
      clearTimeout(timer);
      resolve({ lines: stdout.split("\n").filter(l => l.trim()), code, stderr: stderr.trim() });
    })();
  });
}
export class KimiEngine {
  constructor(private transport: EngineTransport = kimiTransport(), private model?: string) {}
  async run(prompt: string, opts: { timeoutMs?: number; cwd?: string } = {}): Promise<EngineResult> {
    if (!prompt.trim()) throw new EngineError("malformed", "Empty prompt");
    const args = ["-p", prompt, "--output-format", "stream-json"];
    if (this.model) args.push("--model", this.model);
    const { lines, code, stderr } = await this.transport(args, { timeoutMs: opts.timeoutMs ?? 120_000, cwd: opts.cwd });
    let text = "";
    let provider_session: string | null = null;
    for (const line of lines) {
      let msg: { role?: string; type?: string; content?: unknown; session_id?: unknown };
      try { msg = JSON.parse(line); }
      catch { throw new EngineError("malformed", `Undecodable engine line: ${line.slice(0, 80)}`); }
      if (msg.role === "assistant" && typeof msg.content === "string") text += msg.content;
      if (msg.role === "meta" && msg.type === "session.resume_hint" && typeof msg.session_id === "string") provider_session = msg.session_id;
    }
    if (!text.trim()) throw new EngineError(code === 0 ? "malformed" : "failed", `Engine gave no answer (code ${code}): ${stderr.slice(0, 160)}`);
    return { text: text.trim(), provider_session };
  }
}
