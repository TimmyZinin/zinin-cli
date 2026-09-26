/** E3 adapter: machine resources. Pure text-in from /proc/meminfo and `df -k /`. */

/** MemAvailable in kB → free MiB. */
export function parseMeminfo(text: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB/im.exec(text);
  return match ? Math.round(Number(match[1]) / 1024) : null;
}
/** Last data row of `df -k <path>`: avail kB → free MiB. */
export function parseDf(text: string): number | null {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const cols = lines[i].split(/\s+/);
    if (cols.length >= 4 && /^\d+$/.test(cols[3])) return Math.round(Number(cols[3]) / 1024);
  }
  return null;
}
/** N-6: "Pages free" alone reads as ~0 on macOS; usable free is
 * free + inactive + purgeable + speculative. */
export function parseVmStat(text: string): number | null {
  const pageSize = /page size of (\d+)/.exec(text);
  if (!pageSize) return null;
  let pages = 0;
  for (const kind of ["free", "inactive", "purgeable", "speculative"]) {
    const match = new RegExp(`Pages ${kind}:\\s+(\\d+)`).exec(text);
    if (match) pages += Number(match[1]);
  }
  return Math.round((pages * Number(pageSize[1])) / 1024 / 1024);
}
