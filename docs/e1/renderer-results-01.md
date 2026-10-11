# Renderer measurements 01 — no selection

Normative input remains TUI.md SHA256
`8c449a2da129adab29a579c589fe5926fd495bdae9988625030fa7227e84ca98`.
This is the first batch-model slice of the approved E1-003 comparison, not
terminal acceptance. The [protocol](renderer-comparison.md) remains applicable.

Shared fixture: 7 synthetic sessions plus orchestrator, 2001 committed events,
reverse provider timestamps, OSC52/OSC8/CSI payload, Cyrillic/wide/emoji text,
and eight draft/selection/scroll/append/resize/live actions. Cases show 3 or 7
sessions; these are not concurrently executing streams. Both implementations
consume the same fixture bytes. No provider or external side effect is invoked.

Evidence: `spikes/renderer/evidence/batch-01/summary.json` contains the fixture
SHA256, exact commands, every predicate, case timings and per-candidate raw
initial/trace frames. `edge-01/summary.json` records a negative width probe.

| TUI criterion | TS/Bun | Go/Bubble Tea | Evidence scope |
|---|---|---|---|
| §1 80x24 / 100x30 / 120x36, text zones/fields/tree | PASS on short ASCII fixture | PASS on short ASCII fixture | 3/7 sessions at each geometry; all A–F fields checked, no real TTY |
| §1 <80 compact and horizontally accessible details | PARTIAL / incomplete | PARTIAL / incomplete | 79x24 compact frames fit codepoint bounds; horizontal navigation absent |
| §3 plain full selected transcript | PASS on fixture | PASS on fixture | Every selected event retained, sanitized; not a workspace export or screen-reader review |
| §1 C12, §2 selection/draft preservation | PASS model actions | PASS model actions | Separate task/run drafts and coherent selected recipient/footer; no keyboard parser |
| §2 keyboard, slash routes, Ctrl+C | NOT IMPLEMENTED | NOT IMPLEMENTED | No claim based on model actions |
| §3 committed order, held anchor, new count, resize/live | PASS model subset | PASS model subset | workspace_seq order and explicit return; paging/search/export UI absent |
| §3 preview/cache/archive budgets | NOT RUN | NOT RUN | 2001 events in memory; no 16KiB/1MiB/archive implementation |
| §3 <=30 redraw/sec and input/stop responsiveness | NOT RUN | NOT RUN | Batch calls have no redraw clock; render timings do not establish FPS |
| §3 escape sanitization | PASS fixture payloads | PASS fixture payloads | OSC52 clipboard data, OSC8 target and CSI removed; no exhaustive security claim |
| §4 palette, contrast, canonical mascot | NOT RUN | NOT RUN | Static ASCII text fallback; canonical assets unavailable |
| §5 wcwidth | FAIL | FAIL | Wide service name becomes 158 cells on 80 columns in both candidates |
| §5 graphemes/IME/paste/color/native compositing/screen reader | NOT RUN | NOT RUN | No real terminal loop or human review |

Per candidate: **16 cases, 152 passing narrow assertions**. All 16 pairs have
identical initial frames and model traces. The separate wide-character probe
fails in both: clipping counts codepoints rather than terminal cells. These
counts are not acceptance scores; both candidates are incomplete.

| Descriptive timing, milliseconds | TS/Bun | Go/Bubble Tea |
|---|---:|---:|
| Median model render/action duration | 13.582 | 4.399 |
| Median subprocess wall duration | 53.895 | 17.673 |

One sample per case, 16 distinct workloads, TS process starts Bun while Go uses
a precompiled binary; there is no warmed repeated benchmark, memory/RSS or
interactive latency measurement. The timings cannot justify choosing Go.

Remaining work inside the approved experiment: cell/grapheme-safe layout,
horizontal detail access, key/slash/paste/focus handling and finite terminal
loops, then actual PTY resize/input/coalescing evidence and remaining §1–5
criteria. External mascot assets and human terminal review remain separate.
No renderer is selected. A selection packet with threshold 0.8 is premature
until the relevant candidate evidence is sufficient.
