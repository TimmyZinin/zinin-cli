# Renderer measurements 08 — budgets and decision evidence

Candidate source: cad907f. Bun 1.3.0, Go 1.24.2, Bubble Tea 1.3.4;
Go uses the opt-in FPS29 setting for this latency comparison, TS the existing
34ms dirty timer. No candidate implementation is changed in this slice.

## Latency target and measurement

TUI §3 supplies the <=30 redraw/sec goal. Separately, ACCEPTANCE Release gates
specifies p95 input <50ms and event lag <250ms at 3 runs, with recorded behavior
at 7 streams. The original TUI-only comparison protocol did not incorporate
this separate latency target; the earlier three-sample timings cannot establish
it. No historical result is relabeled as a complete performance PASS.

latency-01-30samples offered edits every 75ms. Some drafts were replaced before
being observed: TS/3 26/30, Go/3 28/30, TS/7 30/30, Go/7 25/30 visible samples.
Its partial-sample p95 is censored and cannot satisfy the target. Evidence stays.

latency-02-acknowledged sends the next edit only after the previous draft is
visible plus 40ms. All 30 samples are visible in every case. Nearest-rank p95
selects ordered sample 29. This changes offered load and does not erase the
open-loop observation.

| Candidate / runs | Samples | p95 input-to-visible | Peak redraw / sliding second |
|---|---:|---:|---:|
| TS / 3 | 30 | 35.44ms | 30 |
| Go FPS29 / 3 | 30 | 39.55ms | 30 |
| TS / 7 | 30 | 39.12ms | 30 |
| Go FPS29 / 7 | 30 | 67.36ms | 29 |

Both three-run visibility proxies are below 50ms in this run. This is local
PTY read visibility, not physical paint, a statistical confidence bound or a
complete release acceptance. The 7-run Go degradation is retained; it does not
establish a general speed ranking. Probes finish being sent around 2.30–2.57s
on the harness clock; candidate load completion is 3.06–3.37s on its own clock.
The origins differ. Existing bounded inputProgress samples confirm sampled
input during load, not a one-to-one timestamp for all 30 probe handlers.
Event-lag <250ms, approval dispatch, slow terminal and native platforms remain
unmeasured. Diagnostic stderr is written to files to avoid pipe backpressure.

## Budget and plain transcript probe

budget-01 generates 2101 selected-run events containing 2,183,168 bytes of text,
including one 32,768-byte event. Both candidates show 6 history rows in a
24-line screen; plain output contains all 2101 IDs, the middle event and the
full oversized text (2119 total lines). Generated fixture lives under runtime;
the committed generator, digest, summary and output digests permit reproduction.
These are logical input/output counts, not measured RSS.

Source audit: TS Model.events and Go model.f.Events retain the full input and
append stream events. No 2000-line logical window, 16KiB preview limit or 1MiB
per-run cache enforcement exists. Cell clipping limits displayed width, not
retained data. Plain full output is correct transcript behavior and does not
itself violate a preview limit; it also does not prove an archive implementation.
Archive paging/search/export and recovery are absent. Long help is clipped in
screen mode. These are shared implementation gaps, not reasons to prefer Go.

Reproduction from harness root, using fresh names:

```sh
python3 zinin-cli/spikes/renderer/latency-check.py NEW-LATENCY --fps=29
python3 zinin-cli/spikes/renderer/budget-check.py NEW-BUDGET
```

The accompanying ADR is a proposal for S0/Jev, not an accepted production
choice or an E1 completion claim. The packet explicitly lists remaining gates.
