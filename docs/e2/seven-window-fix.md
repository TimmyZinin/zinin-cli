# E2-R01 — seven-window degradation: cause, correction, before/after evidence

Status: submitted for S0 review. Direction TS/Bun unchanged; no seven-run numeric
SLA is invented; the accepted three-run target is retained.

## Cause

The degradation was event-loop stalls during the load phase, not per-frame
render volume. At seven streams the renderer does *less* work per frame than
at three (fewer events per selected run, fewer event slots), yet trials showed
400–470 ms freezes of the whole loop (load timer, render timer, input).

Contributing costs in the previous build, all paid inside the render tick
while events arrived every 5 ms:

- every frame filtered and re-sorted the selected run's event list;
- every frame ran three stripping-regex passes over each rendered event line
  (16 KiB of workload text per line) instead of once per event;
- the fixed 34 ms interval had no backpressure handling and no visibility
  into loop lag, so host contention and allocation churn turned into
  multi-hundred-ms input stalls (round 6 of the before series: p95 380 ms,
  worst probe 462 ms, output absent for 593 ms; the E1 series hid a 604 ms
  sample behind its p95).

## Correction (commits a9a5690, then the fixed-delay scheduler)

- event text is sanitized once when the event is added; a ready-made line
  string and per-run sorted indexes replace per-frame filter/sort/regex;
- render ticks chain at a fixed 34 ms delay: no burst catch-up after a stall,
  spacing identical in character to the previously accepted interval timer;
- stdout backpressure is honoured; frames coalesce while the terminal is slow;
- each run reports loop-lag (max/avg, >50/100/250 ms counts), max/avg frame
  build and write times, and skipped frames in its diagnostic line.

An earlier expected-time scheduler variant could pack 31 redraws into a
sliding second; it was replaced before the after series and its rounds are
retained under evidence/e2r2-after for the record.

## Before / after (same stand, same pinned runtime and fixture hashes)

Series: `evidence/e2r1-before` vs `evidence/e2r3-after`; ten sequential paired
rounds each, alternating candidate order, 30 acknowledged probes per case,
no discarded outliers, all operational checks green in both series.

| Case | p95 min/med/max before, ms | p95 min/med/max after, ms | Trials <50 ms | Worst single probe before/after, ms |
|---|---|---|---|---|
| ts / 3 | 30.5 / 34.3 / 46.7 | 31.9 / 35.5 / 75.0 | 10/10 → 9/10 | 87.0 → 86.1 |
| ts / 7 | 30.4 / 34.7 / 380.0 | 31.5 / 38.5 / 86.6 | 9/10 → 8/10 | 462.1 → 117.5 |
| go / 3 (control) | 55.5 / 63.9 / 95.5 | 30.3 / 59.3 / 104.1 | 0/10 → 3/10 | 201.8 → 229.1 |
| go / 7 (control) | 32.0 / 43.9 / 115.9 | 37.8 / 56.5 / 89.7 | 6/10 → 3/10 | 474.9 → 228.9 |

Reading:

- The seven-window deep-stall tail is gone: worst TS/7 trial p95 drops from
  380 ms to 86.6 ms, worst single probe from 462 ms to 117.5 ms. No after
  round shows the multi-hundred-millisecond freeze windows present before
  (before: 593 ms and longer output gaps; after: max tick lag 85 ms).
- Three-window behaviour is unchanged in median (~34–35 ms); one after trial
  reached p95 75 ms under visible host noise, with loop-lag counters showing
  the delay came from the environment (avg tick lag 2.2 ms in that round vs
  ~0.7 ms in quiet rounds), not from renderer work (frame build ≤5.4 ms,
  write ≤5.4 ms, zero skipped frames).
- In every elevated after round the Go control degraded in the same rounds,
  confirming shared-host contention during those windows.
- Frame cost is now bounded and visible: max build 7.8 ms, max write 9.3 ms
  across all after rounds.

Remaining known bounds: input visibility is a proxy, not native input latency;
event-lag under slow-terminal output (E2-R02) and the history/cache policy
(E2-R03) are still open and are not claimed here.
