# Renderer measurements 05 — repeated streaming and FPS tuning

Continues results-04. Same 512 × 16KiB round-robin workload and finite PTY
lifetime; new completion timestamps and input-handling progress distinguish
input during load from a draft that appears only after load finishes.

| Evidence | Candidate / runs | Go FPS | Peak / sliding second | Complete, ms | Probe latency min–max, ms | Predicates |
|---|---|---:|---:|---:|---:|---|
| load-03-fps30 | ts / 3 | — | 30 | 3104.61 | 18.84–34.74 | 11/11 |
| load-03-fps30 | go / 3 | 30 | 31 | 3304.53 | 27.48–76.02 | 10/11 |
| load-03-fps30 | ts / 7 | — | 30 | 3720.78 | 3.86–19.02 | 11/11 |
| load-03-fps30 | go / 7 | 30 | 26 | 3241.03 | 28.62–35.45 | 11/11 |
| load-04-fps29 | ts / 3 | — | 30 | 3058.15 | 16.67–36.40 | 11/11 |
| load-04-fps29 | go / 3 | 29 | 30 | 3650.44 | 6.46–51.39 | 11/11 |
| load-04-fps29 | ts / 7 | — | 30 | 3354.30 | 8.59–36.09 | 11/11 |
| load-04-fps29 | go / 7 | 29 | 25 | 3184.99 | 12.51–35.65 | 11/11 |
| load-05-fps29-repeat | ts / 3 | — | 30 | 3207.64 | 31.97–98.10 | 11/11 |
| load-05-fps29-repeat | go / 3 | 29 | 30 | 3173.64 | 36.64–59.78 | 11/11 |
| load-05-fps29-repeat | ts / 7 | — | 29 | 3693.72 | 5.19–35.25 | 11/11 |
| load-05-fps29-repeat | go / 7 | 29 | 25 | 3453.44 | 27.17–39.55 | 11/11 |

The default Go FPS30 repeats the strict rolling-count miss at 31 in the
three-run case. The optional FPS29 experiment passes <=30 in both repeats,
but is not a hard-rate guarantee: its shortest observed Go flush spacing is
6.208ms. TS also has short gaps (down to 6.139ms in these runs) despite a 34ms
timer. Write timing includes scheduling and render work; periodic tick settings
are not minimum-spacing enforcement. No production defaults are changed.

All 12 cases finish 8MiB, preserve P2, show all three probes, and have recorded
input processing while 0 < loaded < 512. Every timestamped flush count agrees
with raw ANSI markers. Load completion is 3.06–3.72 seconds. Input probes are
ASCII composer edits/clear; no stop/approval priority or provider interrupt is
tested. TS records input chunks, Go decoded key events, so inputProgress entry
counts must not be compared as equivalent messages. The 32-entry cap comfortably
covers these three probes; it is not an unlimited diagnostic event log.

The harness samples visibility at PTY read time, not actual terminal paint.
Observed latency maxima reach 98.10ms (TS) and 76.02ms (Go) in this slice.
These are small-sample observations with no new acceptance latency threshold.
Same workload volume/distribution does not mean identical arrival schedules:
TS interval and Go Update-scheduled ticks differ, as documented in results-04.
No throughput winner or renderer choice is inferred.

load-03 intentionally exits 1 after preserving all results; its only failed
predicate is Go/3 strict redraw count. load-04 and load-05 exit 0. Prior failed
and successful evidence remains unchanged. Run from harness root after Go build:

```sh
python3 zinin-cli/spikes/renderer/load-check.py NEW-FPS30-NAME
python3 zinin-cli/spikes/renderer/load-check.py NEW-FPS29-NAME --fps=29
```

Go input-boundary unit tests pass. No change to provider/broker contracts,
cache/archive implementation, palette/sprites, complete focus/navigation, IME
or physical TTY acceptance. Those remain open per results-03/04; the comparison
still does not justify a renderer selection packet.

Non-load regression: pty-12-stream-followup passes all six fragmented-paste,
selection, resize and clean-output checks for each candidate.
