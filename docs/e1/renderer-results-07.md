# Renderer measurements 07 — history and interrupt during streaming

TUI §3 requires a retained scroll anchor and new-event count while reading away
from live output. The earlier isolated navigation and streaming probes did not
exercise this combination. The new finite history-load-check.py runs the same
512 × 16KiB (8MiB) workload for 3/7 runs in both candidates, enters history,
opens e1, resizes to 100x30 and 79x24 while the tool is focused, returns to the
composer, requests synthetic interrupt, tests escalation guard, jumps to live
and restores 80x24. It waits for an initial history frame before sending keys.

Two implementation defects were exposed and corrected:

- Go loadMsg appended directly and never incremented unseen. It now uses the
  same appendEvent function as Action append.
- Both generic append paths counted events from other runs. The displayed
  history counter now counts only incoming events for the selected run.

The independent oracle derives expected r1 arrivals from round-robin ordinals:
ceil(checkpoint.loaded / runCount) minus ceil(home.loaded / runCount). It checks
both tool-focused resize snapshots and the subsequent return to history.
It does not infer correctness from TS/Go equality.

| history-load-03-verified | Predicates | Interrupt request to visible notice |
|---|---:|---:|
| TS / 3 runs | 15/15 | 11.05ms |
| Go / 3 runs | 15/15 | 22.05ms |
| TS / 7 runs | 15/15 | 10.29ms |
| Go / 7 runs | 15/15 | 32.19ms |

All cases complete 512 chunks, keep tool=e1 and anchor=0 at both resize
checkpoints, show positive selected-run new counts, emit sanitized tool text
`TOOL e1 tool1 safelink text`, handle interrupt at 0 < loaded < 512, show
stopping and disabled escalation, then reset anchor=-1/unseen=0 on End.
Final geometry is 80x24 and focus is history. A single latency sample per case
is descriptive only; no SLA, percentile, priority guarantee or ranking follows.

Historical evidence is retained:

- history-load-01-before: Go's missing count and TS's cross-run count fail.
  TS/3 additionally received input before raw mode was ready; CR became LF.
- history-load-02-fixed: counter, focus, resize and interrupt checks pass, but
  a newly added tool-text oracle incorrectly expected `line-1 synthetic`.
  The actual e1 is the sanitizer fixture. Only the oracle was corrected before
  history-load-03; the failed evidence was not edited.

The combined harness writes child stderr directly to evidence files, avoiding
pipe backpressure from diagnostic traces. It preserves sent bytes, readiness
and output timestamps, resize commands, raw ANSI, state and checkpoints. Each
child retains its five-second lifetime and a 6.5-second harness guard. No new
sessions, providers, listeners or processes outside the owned children.

Go regression tests cover selected/other-run arrivals through both append
paths and live reset. batch-06-history repeats 152/152 predicates across 16
cases per candidate. Existing geometry/plain model behavior is retained.

Scope: Ctrl+C is a synthetic state transition with no owned provider to kill;
load deliberately continues after the request. Approval dispatch, actual
provider cancellation, delayed committed insertion, archive/search/export,
cache limits, physical compositing and IME are not validated. Raw-byte presence
and diagnostic checkpoints do not reconstruct every frame. Dynamic-width Go
captures are not used for redraw counts: the existing flush counter targets
fixed 80-column output. Previous fixed-width redraw results remain historical.
Renderer selection still requires broader acceptance and S0's Jev receipt.

Reproduce after the README Go build command, from the harness root:

```sh
python3 zinin-cli/spikes/renderer/history-load-check.py NEW-EVIDENCE-NAME
```

pty-18-history-regression repeats the prior navigation scenario: 15/15 per
candidate, including draft roundtrip and final tool/anchor after resize.
