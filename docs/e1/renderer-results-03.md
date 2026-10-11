# Renderer measurements 03 — recovered work and PTY reproduction

Continues results-02 against unchanged TUI.md §§1–5, SHA256
`8c449a2da129adab29a579c589fe5926fd495bdae9988625030fa7227e84ca98`.
The interrupted worker's tracked diff and untracked evidence were transferred
without replacing historical results. Local Go was rebuilt from the recovered
sources before the following runs; Bun 1.3.0, Go 1.24.2, Bubble Tea 1.3.4.

| Criterion | TS/Bun | Go/Bubble Tea | Evidence |
|---|---|---|---|
| §1 geometry, §2 draft model, §3 ordering/plain/anchor fixture subset | 152/152 PASS | 152/152 PASS | batch-04-transfer, 16 cases each |
| §2/5 byte-fragmented Cyrillic/ZWJ/newline bracketed paste | 6/6 PASS | 6/6 PASS | pty-09-transfer reproduces transferred pty-08 |
| §2 synthetic slash notices, ASCII cursor edit, Ctrl+C states, Esc notice | 10/10 PASS | 10/10 PASS | pty-10-semantics |
| §3 resize preserves tested draft/selection, returns to 80x24 | PASS | PASS | both new PTY probes |
| §2 complete focus/tool/history navigation and hotkey help | INCOMPLETE | INCOMPLETE | notices do not implement full navigation |
| §3 streaming redraw <=30/sec, input under megabyte load, archive/cache budgets | NOT RUN | NOT RUN | five-second smoke is not load evidence |
| §4 canonical sprites/palette; §5 color modes, IME, physical compositing/screen reader | NOT RUN | NOT RUN | canonical assets still unavailable |

Six paste predicates: exit_clean, selected, paste_preserved, resize,
output_present, no_stderr_errors. Ten semantic predicates: exit_clean, selected,
cursor_edit, routes, interrupt, escalation_guard, idle, escape, resize,
no_stderr_errors. Route tests establish notice generation only. Ctrl+C stopping
is synthetic; no real provider interrupt or process-group escalation is claimed.
Raw ANSI is retained; no terminal-emulator reconstruction or human review was
performed. Previous Unicode probes remain the evidence for width/grapheme
clipping; the new cursor test is ASCII and does not establish full IME editing.

Go now frames UTF-8/CSI/paste before Bubble Tea's decoder with a Linux-only,
six-second, 1MiB-bounded reader. Unit tests cover incomplete UTF-8, CSI,
bracketed paste and lone-Esc timeout boundaries. The reader preserves stdin's
terminal interface; prior pty-04 records the failure before that correction.
Transferred pty-04..08 and batch-03 remain unchanged, including failures.

Reproduction from harness root:

```sh
GOTOOLCHAIN=local GOPATH="$PWD/runtime/gopath" GOCACHE="$PWD/runtime/gocache" runtime/go-1.24.2/go/bin/go -C zinin-cli/spikes/renderer/go test ./...
GOTOOLCHAIN=local GOPATH="$PWD/runtime/gopath" GOCACHE="$PWD/runtime/gocache" runtime/go-1.24.2/go/bin/go -C zinin-cli/spikes/renderer/go build -o ../../../../runtime/renderer-go .
python3 zinin-cli/spikes/renderer/pty-check.py pty-09-transfer
python3 zinin-cli/spikes/renderer/pty-check.py pty-10-semantics --semantics
python3 zinin-cli/spikes/renderer/measure.py batch-04-transfer
```

Choose new output names for future runs. All evidence contains synthetic data.
Offline contracts/broker baseline: 19 tests, 117 assertions, zero failures.
The TUI matrix remains insufficient for renderer selection. No renderer ADR
or selection Jev packet is proposed on these smoke results. Next bounded slice:
measure streaming coalescing and input responsiveness on a common workload;
complete remaining focus/navigation evidence separately.
