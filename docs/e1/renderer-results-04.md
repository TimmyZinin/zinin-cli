# Renderer measurements 04 — finite streaming/input probe

Continues results-03 using TUI §3's coalescing goal of <=30 redraw/sec.
Both optional `--load` loops append 512 synthetic events with 16KiB ASCII text
per event (8MiB total), round-robin over 3 or 7 runs. Target interarrival is 5ms;
TS uses an interval, Go schedules its next tick from Update. Actual arrival
cadence is not identical, so these are bounded workload observations, not a
throughput ranking. Both complete all 512 events before their five-second exit.
Only the selected run is rendered; the other runs receive model events.

| load-02 | Flushes | Peak sliding 1s | Input-to-visible draft, ms (3 probes) | Strict <=30 predicate |
|---|---:|---:|---|---|
| TS, 3 runs | 94 | 29 | 20.93 / 14.36 / 15.53 | PASS |
| Go, 3 runs | 96 | 31 | 12.75 / 18.26 / 81.55 | FAIL |
| TS, 7 runs | 97 | 29 | 34.16 / 17.71 / 19.40 | PASS |
| Go, 7 runs | 76 | 25 | 5.89 / 34.85 / 38.81 | PASS |

Peak counts use half-open [t,t+1000ms) windows starting at each recorded flush.
Go's WithFPS(30) does not guarantee this strict rolling-window predicate under
scheduler jitter. A count of 31 is an observed miss of this probe, not proof of
sustained overload or universal TUI failure. No latency threshold is invented.
Three samples per case do not establish tail latency or comparative superiority.

All four cases pass clean exit/stderr, complete byte count, final draft P2,
three visible probes before exit and nonzero sustained redraw observation.
The driver exits 1 because Go/3 fails the strict redraw predicate, after saving
all evidence. No failed results are removed. load-01 is retained as a failed
instrumentation attempt: Go output wrapper initially lacked term.File, causing
terminal width detection to fail and zero flushes to be recorded. load-02
preserves the terminal interface and checks that zero measurements cannot pass.

TS records timestamps after actual frame writes; Go wraps the pinned standard
renderer output, counting flush writes ending with CursorBackward(80). Setup
and cleanup control writes are excluded. For this fixed 80x24 non-alt-screen
probe, all four timestamp counts agree with raw ANSI markers (94/96/97/76).
This instrumentation is specific to the pinned renderer and fixed geometry;
it is not a general terminal emulator or an arbitrary-output frame counter.
Latency is measured on the harness monotonic clock from PTY write until the
first raw `draft=P0/P1/P2` bytes arrive. It includes scheduling and PTY reading;
it does not prove terminal paint time. The load script does not resize.

The probe deliberately retains all synthetic history in memory: it does not
implement the 2000-line, 16KiB-preview or 1MiB-per-run live cache/archive policy.
The aggregate per-run incoming text exceeds 1MiB even with seven runs. The
bounded run checks responsive input amid a multi-megabyte workload; it does not
measure memory ceilings, archive paging/search/export or slow-terminal
backpressure. Stop/approval priority, complete focus/navigation, physical TTY,
IME, color modes and canonical sprites remain open. No selection packet yet.

Reproduction: rebuild Go per spikes/renderer/README.md, then run
`python3 zinin-cli/spikes/renderer/load-check.py NEW-EVIDENCE-NAME` from the
harness root. Children self-terminate at five seconds; harness guard 6.5s.
No provider calls, new sessions, daemons or listeners. Fixture digest, sent
bytes, output chunks, final state, frame timestamps and raw ANSI are committed
under evidence/load-01 and load-02. Go unit tests pass; pty-11-load-regression
preserves the prior 6/6 paste/selection/resize predicates for both candidates.
