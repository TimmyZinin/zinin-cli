# Renderer measurements 02 — selection still premature

Criteria remain from TUI.md §§1–5, SHA256
`8c449a2da129adab29a579c589fe5926fd495bdae9988625030fa7227e84ca98`.
This increment fixes cell clipping and adds finite real PTY input/resize probes.
It does not supersede historical raw evidence or claim complete acceptance.

| TUI criterion | TS/Bun | Go/Bubble Tea | Evidence under spikes/renderer/evidence |
|---|---|---|---|
| §1 geometry/fields; §2 draft model; §3 ordering/anchor/plain/sanitizer fixture | 152 narrow PASS / 16 cases | 152 narrow PASS / 16 cases | batch-02; same fixture as batch-01 |
| §1/5 wide scope width at 80 columns | PASS, 80 cells | PASS, 80 cells | edge-02; previous edge-01 was 158 cells |
| §5 ZWJ emoji / combining / CJK at clipping boundary | PASS fixture | PASS fixture | unicode-01; grapheme remains whole or omitted |
| §1 horizontal scope detail, fixed footer | PASS model subset | PASS model subset | unicode-01; other detail navigation still incomplete |
| §2/5 ordinary bracketed paste, Cyrillic/emoji/newline | PASS | PASS | pty-02: both preserve exact draft |
| §2/5 paste fragmented at each byte | PASS | FAIL | pty-03: Go draft becomes `[200~ second[201~` |
| §1/2 selected run after /agents 2 | PASS PTY subset | PASS PTY subset | pty-02/03; Go KeySpace omission fixed after pty-01 |
| §3 resize sequence, retained selected run/draft | PASS ordinary-paste probe | PASS ordinary-paste probe | 80x24 -> 100x30 -> 120x36 -> 79x24 -> 80x24; final model state verified |
| §3 <=30 redraw/sec | NOT LOAD-TESTED | NOT LOAD-TESTED | TS 34ms dirty timer, Go WithFPS(30); configuration is not measured streaming proof |
| §2 full slash routes, focus, Ctrl+A/Ctrl+C semantics | INCOMPLETE | INCOMPLETE | Minimal append/backspace and a few slash routes only |
| §3 cache budgets/archive and megabyte-output input responsiveness | NOT RUN | NOT RUN | No production archive/cache |
| §4 palette/canonical sprites; §5 physical terminal/IME/screen reader | NOT RUN | NOT RUN | PTY cannot establish font/compositing/human review |

Versions remain Bun 1.3.0, Go 1.24.2, Bubble Tea v1.3.4. Cell cropping uses Bun's
stringWidth with Intl.Segmenter and pinned uniseg v0.4.7 respectively. No claim
covers all terminal Unicode width conventions or ambiguous-width locale modes.

Both PTY children terminate themselves after five seconds; the harness has a
six-second guard on each exact owned child. No daemon, listener, new session or
provider process is created. Per-candidate raw ANSI, input bytes, resize steps,
output chunk times, exit status and final diagnostic model state are retained.
Frames are not reconstructed with a terminal emulator; no assertion establishes
absence of overlap or scrollback corruption. Final state alone is not evidence
of every intermediate rendered frame.

PTY pty-02: 5/5 checks per candidate. Fragmented pty-03: TS 5/5, Go 4/5. Initial
pty-01 failure retained: missing KeySpace handling broke Go selection; fixing
that adapter defect did not fix fragmented paste. The latter is specific to the
pinned candidate and its input path, not proof of a general Go limitation.

TS emits seven frames in each five-second smoke session. That lightly loaded
observation cannot establish coalescing under streaming pressure. Go View calls
are not counted as actual redraws. Batch-02 median model durations were 11.950ms
TS and 4.478ms Go, single sample per distinct case; not selection evidence.

Next: investigate/preserve split UTF-8 and escape sequences in the Go input path,
finish required routes/focus/interrupt display semantics, then collect comparable
load/input/redraw measurements. Neither candidate passes the full TUI matrix;
no selection Jev packet or renderer decision is warranted yet.
