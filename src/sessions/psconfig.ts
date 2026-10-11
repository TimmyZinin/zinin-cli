/** E3 ps config: remote-newa command from ~/.zinin/ps.json (K3-3).
 * Precedence: ZININ_PS_NEWA_CMD env → ps.json newaCmd → built-in default
 * (the default points at the worker checkout and is documented as temporary).
 */
export interface PsConfig { newaCmd: string[] | null }
export function parsePsConfig(text: string | null): PsConfig {
  if (!text) return { newaCmd: null };
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null) {
      const cmd = (value as Record<string, unknown>).newaCmd;
      if (Array.isArray(cmd) && cmd.length > 0 && cmd.every(part => typeof part === "string" && part.trim())) {
        return { newaCmd: cmd as string[] };
      }
    }
  } catch { /* malformed config — fall back to default */ }
  return { newaCmd: null };
}
