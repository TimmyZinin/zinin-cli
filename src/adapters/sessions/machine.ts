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
