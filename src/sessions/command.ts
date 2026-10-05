/** Finite foreground command; stdout and stderr are drained concurrently. */
export const COMMAND_TIMEOUT_MS = 6000;
export const MAX_COMMAND_BYTES = 4 * 1024 * 1024;
export interface CommandOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number }
export type CommandRunner = (args: string[], options?: CommandOptions) => Promise<string>;
export const runCommand: CommandRunner = async (args, options = {}) => {
  if (options.signal?.aborted) throw new Error("command cancelled");
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_COMMAND_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("invalid command limits");
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const readers = [proc.stdout.getReader(), proc.stderr.getReader()];
  let bytes = 0;
  let rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (message: string) => {
    try { proc.kill("SIGKILL"); } catch { /* already exited */ }
    rejectStop(new Error(message));
  };
  const onAbort = () => stop("command cancelled");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timer = setTimeout(() => stop("command timed out"), timeoutMs);
  const read = async (reader: typeof readers[number], keep: boolean) => {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) { stop("command output limit exceeded"); throw new Error("command output limit exceeded"); }
      if (keep) chunks.push(value);
    }
    return keep ? Buffer.concat(chunks).toString("utf8") : "";
  };
  try {
    const [stdout, , code] = await Promise.race([Promise.all([read(readers[0], true), read(readers[1], false), proc.exited]), stopped]);
    if (code !== 0) throw new Error(`command exited with code ${code}`);
    return stdout;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    for (const reader of readers) void reader.cancel().catch(() => {});
    if (proc.exitCode === null) { try { proc.kill("SIGKILL"); } catch { /* already exited */ } }
  }
};
