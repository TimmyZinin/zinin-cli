# Isolated renderer candidates — synthetic experiments

These are independent TypeScript/Bun and Go/Bubble Tea projection models. The
Go model implements Bubble Tea's Model interface and handles WindowSizeMsg;
batch experiments call Update/View directly. The optional `--tty` mode starts
a finite five-second loop: Bubble Tea Program or a TS raw-input/coalesced-output
loop. Neither connects to a provider/core. PTY smoke checks are not a complete
terminal-renderer benchmark.

Run from the harness root, with the pinned local runtimes:

```sh
GOTOOLCHAIN=local GOPATH="$PWD/runtime/gopath" GOCACHE="$PWD/runtime/gocache" runtime/go-1.24.2/go/bin/go -C zinin-cli/spikes/renderer/go build -o ../../../../runtime/renderer-go .
python3 zinin-cli/spikes/renderer/measure.py batch-02
python3 zinin-cli/spikes/renderer/edge.py edge-02
```

Choose a fresh evidence directory name for each run; scripts refuse to overwrite
previous results. `make-fixture.py` reproduces the committed synthetic fixture.
`measure.py` verifies specified observations, including equality between both
implementations, but equality alone is not the correctness oracle. `edge.py`
records the width probe result without treating an observed failure as a harness crash.
The batch driver accepts only trusted generated input, not arbitrary UI clients.

Pinning: Bun 1.3.0; Go 1.24.2 linux/amd64 archive SHA256
`68097bd680839cbc9d464a0edce4f7c333975e27a90246890e9f1078c7e702ad`,
verified against [Go release metadata](https://go.dev/dl/?mode=json&include=all).
Bubble Tea v1.3.4 uses the [Model/Update/View interface](https://raw.githubusercontent.com/charmbracelet/bubbletea/v1.3.4/README.md).
Direct/transitive modules are pinned in go.mod/go.sum; `go mod verify` passes.
Go is pinned for this local historical experiment, not recommended as a current
production toolchain. No runtime binary is included in the patch series.

See [results](../../docs/e1/renderer-results-01.md) for the TUI matrix and limits.

## Finite PTY and Unicode probes

From the harness root, after rebuilding Go:

```sh
python3 zinin-cli/spikes/renderer/unicode-check.py unicode-02
python3 zinin-cli/spikes/renderer/pty-check.py pty-04 --whole
python3 zinin-cli/spikes/renderer/pty-check.py pty-05
```

The fragmented-paste probe now passes for both candidates; historical failures remain in evidence/pty-03 and pty-04.
Use fresh directory names. Raw ANSI and timed byte counts are evidence, not
a reconstructed terminal screenshot or a human compositing review.

Minimal terminal input: `/agents N`, `/left`, `/right`, `/live`, `/quit`,
bracketed paste, cursor editing/Ctrl+A/E, and synthetic `/todo`, `/agents`,
`/scope`, `/context`, `/handoff`, `/help` notices; automatic exit after five seconds.
Ctrl+C models clear/stopping/idle with escalation disabled because no provider
is owned. This is not production dispatch, complete focus navigation, or draft persistence. Horizontal offset currently applies to scope/history;
footer stays fixed. Plain batch output still retains complete selected text.

See [second results](../../docs/e1/renderer-results-02.md); original measurements
are retained unchanged, including failed probes.

See [third results](../../docs/e1/renderer-results-03.md) for transfer reproduction.
The Go input framer is Linux-only and bounded to six seconds/1MiB input; it is
spike code, not a portable production decoder. Run `pty-check.py` with a fresh
evidence name and `--semantics` to check synthetic routes/edit/interrupt notices.

## Finite streaming workload

After rebuilding Go, run `python3 zinin-cli/spikes/renderer/load-check.py load-N`
from the harness root with a fresh evidence name. The opt-in `--load` mode adds
512 synthetic 16KiB chunks round-robin across 3 or 7 runs, target interval 5ms,
inside the existing five-second PTY lifetime. No provider or archive is involved.
The probe retains raw ANSI, timestamps, input bytes, final state and predicates.
A failed predicate deliberately produces a nonzero exit after saving evidence.
See renderer-results-04.md for interpretation and measurement limits.

Streaming follow-up: `load-check.py NEW-NAME --fps=29` opts the Go candidate
into FPS29; the default remains FPS30. Both candidates now record load
completion time and up to 32 input-handling samples with the current loaded
chunk count. New predicates verify input handling while load is incomplete and
match flush timestamps to raw ANSI markers. This mode retains the same workload
and five-second child lifetime; it is an experiment, not a renderer selection.
