# Isolated renderer candidates — batch experiment 01

These are independent TypeScript/Bun and Go/Bubble Tea projection models. The
Go model implements Bubble Tea's Model interface and handles WindowSizeMsg;
this experiment calls Update/View directly. Neither starts a terminal loop or
connects to a provider/core. This does **not** benchmark Bubble Tea's terminal
renderer against a TypeScript terminal renderer.

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
records a known FAIL without treating an observed failure as a harness crash.
The batch driver accepts only trusted generated input, not arbitrary UI clients.

Pinning: Bun 1.3.0; Go 1.24.2 linux/amd64 archive SHA256
`68097bd680839cbc9d464a0edce4f7c333975e27a90246890e9f1078c7e702ad`,
verified against [Go release metadata](https://go.dev/dl/?mode=json&include=all).
Bubble Tea v1.3.4 uses the [Model/Update/View interface](https://raw.githubusercontent.com/charmbracelet/bubbletea/v1.3.4/README.md).
Direct/transitive modules are pinned in go.mod/go.sum; `go mod verify` passes.
Go is pinned for this local historical experiment, not recommended as a current
production toolchain. No runtime binary is included in the patch series.

See [results](../../docs/e1/renderer-results-01.md) for the TUI matrix and limits.
