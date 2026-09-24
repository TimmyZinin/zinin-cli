# E1 renderer ADR v2 — ACCEPTED-CONDITIONAL

Status: **ACCEPTED-CONDITIONAL**, by explicit S0 decision on 2026-09-24.
TypeScript/Bun is the working E1 direction. Production is unchanged; the Go
spike and all evidence remain an archived fallback, not an automatic replacement.
The existing filename is retained to preserve review and evidence links.

Receipt history: v1 Jev REWORK_SIGNAL (facts 0.83, decision 0.71, risk 0.76);
v2 Jev REWORK_SIGNAL (facts 0.78, decision 0.74, risk 0.74), threshold 0.8.
S0 explicitly accepted the direction conditionally above the v2 signal. This
records S0's decision and does not relabel either Jev result as PASS.
The original proposal packets remain unchanged historical submissions.

Mandatory E2 condition: investigate and resolve the seven-window degradation
(TS maximum per-trial p95 102.91ms) before production acceptance. Preserve the
outlier, identify the cause and submit before/after repeated evidence for S0
review; do not invent a seven-run SLA or waive existing three-run targets.
The [E2 handoff](renderer-e2-handoff.md) defines the work and closure evidence.

Fact reconciliation: [audit result](renderer-fact-audit.json) verifies all
1200 latencies from raw ANSI/chunk timestamps, the 40 per-trial p95 values,
spread/rounded ADR tables and 60 parity rows against their logs. The audit
script is `spikes/renderer/audit-renderer-facts.py`.

## Ten-repeat same-stand results

40 sequential children: 10 trials per candidate at each of 3 and 7 streams,
30 acknowledged input samples per trial (1200 total). Same Linux host, pinned
runtime/binary/fixture hashes, 80x24 PTY, TERM and NO_COLOR, workload volume and
driver. Candidate order alternates by round. Go uses FPS29; TS keeps its 34ms
timer. No warmup trials or outliers were discarded. No benchmark children run
concurrently; shared-host contention/CPU affinity is not controlled. Actual
arrival cadence still differs between implementations.

| Candidate / streams | Complete trials | p95 min / median / max, ms | SD, ms | IQR, ms | Trials p95 <50ms |
|---|---:|---:|---:|---:|---:|
| ts / 3 | 10/10 | 30.55 / 33.40 / 43.25 | 4.48 | 32.48–36.00 | 10/10 |
| ts / 7 | 10/10 | 29.88 / 33.63 / 102.91 | 24.01 | 31.11–50.13 | 7/10 |
| go / 3 | 10/10 | 30.32 / 62.28 / 321.60 | 85.83 | 42.88–64.05 | 4/10 |
| go / 7 | 10/10 | 33.12 / 45.06 / 114.87 | 29.73 | 36.86–59.70 | 6/10 |

| Round | TS/3 p95 | Go/3 p95 | TS/7 p95 | Go/7 p95 | Logs |
|---|---:|---:|---:|---:|---|
| 1 | 33.96 | 321.60 | 29.88 | 53.50 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-01/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-01.log) |
| 2 | 42.76 | 30.32 | 102.91 | 33.12 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-02/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-02.log) |
| 3 | 32.83 | 64.10 | 69.02 | 106.58 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-03/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-03.log) |
| 4 | 43.25 | 63.92 | 30.57 | 45.34 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-04/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-04.log) |
| 5 | 36.19 | 60.76 | 55.07 | 114.87 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-05/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-05.log) |
| 6 | 30.55 | 85.63 | 33.91 | 61.76 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-06/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-06.log) |
| 7 | 32.54 | 37.38 | 32.12 | 38.14 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-07/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-07.log) |
| 8 | 35.44 | 63.81 | 33.36 | 44.78 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-08/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-08.log) |
| 9 | 31.40 | 49.06 | 35.31 | 35.09 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-09/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-09.log) |
| 10 | 32.45 | 40.83 | 30.77 | 36.43 | [summary](../../spikes/renderer/evidence/latency-v2-ten-round-10/summary.json), [runner log](../../spikes/renderer/evidence/latency-v2-ten/round-10.log) |

[Stand manifest and commands](../../spikes/renderer/evidence/latency-v2-ten/manifest.json); [all samples, predicates and aggregate](../../spikes/renderer/evidence/latency-v2-ten/aggregate.json).
Each round directory contains TS/Go raw ANSI, timed events and diagnostics for
both stream counts. p95 is nearest-rank sample 29 of 30; SD is sample standard
deviation of ten per-trial p95 values, IQR uses inclusive quartiles. This is not
a pooled p95 or statistical confidence interval.

All 40 cases pass 11 operational predicates (complete input, workload, final
draft, flush counts, observed <=30 rolling redraws). Separately, the three-run
<50ms visibility proxy passes 10/10 TS but only 4/10 Go trials. Go/3 reaches
321.60ms; the outlier is retained without attributing it to a specific cause.
Seven-run TS also degrades (max 102.91ms), as does Go (max 114.87ms).

This strengthens a conditional TS direction for this pinned Linux workload
beyond toolchain preference: it is the only tested candidate consistently below
the three-run proxy target across these trials. It does not prove native
input latency, event lag or general language superiority. An acknowledged
probe reduces offered input pressure; previous open-loop missed drafts remain
a risk. Go is a retained fallback candidate, not a currently performance-qualified
automatic replacement. Reproduce with a new name:

```sh
python3 zinin-cli/spikes/renderer/repeat-latency.py NEW-SERIES-NAME
```

## Complete measured parity table

PASS means the named predicate on its recorded fixture, not full TUI acceptance.
These are canonical latest behavior suites, with older failures retained below.
Implementation source remains cad907f; measurement-only changes do not rerun or
extend historical native/platform claims. Each linked summary contains diagnostic
state and/or links to raw frames; PTY folders also contain candidate ANSI captures.

| Suite / predicate | TS | Go | Evidence log |
|---|---|---|---|
| batch-06-history / TUI1_bounds_codepoints_only | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI1_fields | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI1_selection_coherence | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI1_zone_order | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI2_draft_roundtrip | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_OSC_payload_removed | 8/8 PASS | 8/8 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_anchor_resize | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_committed_order | 8/8 PASS | 8/8 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_explicit_live | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_full_selected_transcript | 8/8 PASS | 8/8 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| batch-06-history / TUI3_no_controls_in_frames | 16/16 PASS | 16/16 PASS | [summary](../../spikes/renderer/evidence/batch-06-history/summary.json) |
| unicode-01 / cluster_boundary | 4/4 PASS | 4/4 PASS | [summary](../../spikes/renderer/evidence/unicode-01/summary.json) |
| unicode-01 / detail_reachable | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/unicode-01/summary.json) |
| unicode-01 / footer_preserved | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/unicode-01/summary.json) |
| pty-17-paste-regression / exit_clean | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-17-paste-regression / no_stderr_errors | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-17-paste-regression / output_present | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-17-paste-regression / paste_preserved | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-17-paste-regression / resize | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-17-paste-regression / selected | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-17-paste-regression/summary.json) |
| pty-15-semantics / cursor_edit | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / escalation_guard | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / escape | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / exit_clean | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / idle | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / interrupt | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / no_stderr_errors | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / resize | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / routes | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-15-semantics / selected | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-15-semantics/summary.json) |
| pty-18-history-regression / arrow_down | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / arrow_up | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / draft_roundtrip | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / exit_clean | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / home | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / jump_live | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / no_stderr_errors | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / page_down | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / page_up | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / resize | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / restored_on_selection | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / selected | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / tool_back | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / tool_open | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| pty-18-history-regression / tool_visible | 1/1 PASS | 1/1 PASS | [summary](../../spikes/renderer/evidence/pty-18-history-regression/summary.json) |
| history-load-03-verified / escalation_guard | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / exit_clean | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / final_geometry | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / interrupt_during_load | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / interrupt_visible | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / jump_live | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / load_complete | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / new_count_visible | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / no_stderr_errors | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / resize_observed | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / scroll_before_complete | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / selected_new_count | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / stopping | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / tool_anchor_held | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |
| history-load-03-verified / tool_visible | 2/2 PASS | 2/2 PASS | [summary](../../spikes/renderer/evidence/history-load-03-verified/summary.json) |

Raw keyboard/focus logs: [TS](../../spikes/renderer/evidence/pty-18-history-regression/ts-events.json), [Go](../../spikes/renderer/evidence/pty-18-history-regression/go-events.json).
Raw history/streaming logs: [TS/3](../../spikes/renderer/evidence/history-load-03-verified/ts-3-events.json), [Go/3](../../spikes/renderer/evidence/history-load-03-verified/go-3-events.json), [TS/7](../../spikes/renderer/evidence/history-load-03-verified/ts-7-events.json), [Go/7](../../spikes/renderer/evidence/history-load-03-verified/go-7-events.json).

Additional observations: [edge-02](../../spikes/renderer/evidence/edge-02/summary.json) reports both at 80 cells/80 columns. [budget-01](../../spikes/renderer/evidence/budget-01/summary.json) shows both preserve 2101-event plain output while lacking cache/archive enforcement. Go has append-path and input-boundary unit tests; no equivalent standalone TS unit-test count is claimed.

Historical counterevidence (not silently superseded): [Go fragmented paste failure](../../spikes/renderer/evidence/pty-03/summary.json); [history counts before fixes](../../spikes/renderer/evidence/history-load-01-before/summary.json); [Go FPS30 rolling count 31](../../spikes/renderer/evidence/load-03-fps30/summary.json); [open-loop overwritten visible drafts](../../spikes/renderer/evidence/latency-01-30samples/summary.json). These failures motivate the corrected paths and probe limitations; they are not proof that another language is inherently better.

## Decision reasoning and tradeoffs

ARCHITECTURE §2 prefers the existing TypeScript/Bun toolchain when acceptance
permits. Behavior parity above gives no requirement that only Go satisfies.
Keeping the CLI/core language avoids a second frontend build/release boundary;
this is a maintenance tradeoff, not measured runtime superiority. Go provides
Bubble Tea event-loop/rendering infrastructure that the TS spike implements
itself. TS therefore trades integration simplicity for terminal-engineering risk.
Go also needs a custom, Linux-only input framer for the pinned decoder. Neither
custom input path has demonstrated a full cross-platform terminal contract.

Do not choose TS because of one 7-run latency sample, and do not choose Go
because an earlier isolated model render was faster. Use the ten-repeat table
and explicit acceptance blocks below. Shared missing features require work in
either stack, so switching languages alone does not resolve those gaps.

## Known TS gaps and risk controls

| TS gap / risk | Evidence / implication | Required control |
|---|---|---|
| Custom escape/paste/cursor parser; no full IME proof | Unicode/paste subset passes only; byte fragmentation and grapheme editing have broader edge cases | Expand adverse-input and native matrix before packaging acceptance |
| Paste buffer has no explicit production bound | Source accumulates pending paste; hostile or incomplete paste can retain data | Bounded-input policy and failure behavior require tests; do not expose as production interface |
| All events retained; repeated filtering/sorting | budget-01 input exceeds 1MiB/run; 2000-line/16KiB/1MiB policies absent | Archive/cache proposal and paging/no-history-loss tests before implementation gate |
| Long help clipped, shortcut/accessibility incomplete | renderer-results-06 documents gaps | Readable/paged help; focus and screen-reader acceptance |
| Full-screen writes, backpressure unmeasured | Acknowledged PTY probe is not a slow terminal; open-loop missed intermediate drafts | Slow-output and event-lag measurement; do not extrapolate p95 to production |
| Synthetic dispatch only | Ctrl+C changes state; no provider stop/approval traffic | Integration contracts and bounded real-provider evidence in authorized scope |
| Palette/sprite/motion/color/platform matrix missing | Canonical assets absent; Linux NO_COLOR probes only | Obtain assets and run physical terminal/IME/native review; do not claim A08/A17 complete |
| Drafts only in process; no restart recovery | PTY roundtrip does not test persistence | Explicit draft-recovery contract and tests |

## Explicit Go fallback conditions

The following review rules remain conditional safeguards, not additional specification targets:

1. Reopen TS selection if a repeated identical 3-run benchmark gives TS p95
   >=50ms in at least 2 of 10 complete trials after one bounded correction
   iteration, while Go meets <50ms in all 10 and retains behavioral parity.
   The <50ms target is from ACCEPTANCE; 2/10 is this ADR’s reopen rule.
2. Reopen immediately for reproducible TS draft/input loss, wrong recipient,
   unsafe terminal control emission or a required native/IME blocker when Go
   demonstrably passes the same failing case. Do not wait for timing statistics.
3. If both fail, neither is an accepted fallback: fix common workload/core/
   acceptance gaps and repeat. Go does not become production-ready by default.
4. Seven-run degradation triggers investigation and disclosure, not an invented
   seven-run <50ms release threshold. Event lag <250ms at three runs still needs
   its own evidence for both. Any actual Go switch requires a fresh S0/Jev receipt.

## Rollback plan

- Retain baseline de75ac1 (candidate implementation cad907f), both source trees,
  pinned runtimes and hashes in the stand manifest. This acceptance changes only
  decision documentation; there is no production deployment or data migration
  to roll back. A changed direction requires a new recorded S0 decision.
- Put future TS-only implementation changes in separate commits on a
  review branch. Keep the Go fixture frontend buildable; do not delete evidence
  or change the shared projection/command semantics to hide a mismatch.
- On a fallback trigger, stop further TS rollout and record the reproducer. Stop
  only the explicitly owned test CLI. Preserve drafts/logs; any future live-client
  transition must first provide an approved draft checkpoint/recovery mechanism
  (not implemented now). Do not terminate providers as a renderer rollback.
- Revert only the newly accepted TS-specific commits with additive git revert
  commits, not history reset/deletion. Rebuild the pinned baseline and rerun the
  linked parity suites and ten-repeat benchmark. No storage migration is part
  of this plan; any later schema change needs its own backup/restore approval.
- S0 reviews the reproduced trigger and Go parity evidence through Jev before
  selecting a Go build target. Keep the old reviewed artifact available until
  the replacement passes; no irreversible publication or automatic switch.

## Remaining acceptance boundaries

Neither current spike has archive/cache enforcement, event-lag proof, real
approval/cancellation control, readable full help or the native/color/IME/sprite
matrix. O01 production packaging and overall E1 provider compatibility remain
open. Conditional acceptance does not waive any of these gates.
