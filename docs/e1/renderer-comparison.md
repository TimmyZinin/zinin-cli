# E1 renderer comparison: protocol, results pending

Normative input: `spec/TUI.md`, SHA256
`8c449a2da129adab29a579c589fe5926fd495bdae9988625030fa7227e84ca98`.
The spec is supplied separately in the harness workspace. Section references
below refer exclusively to that document. This protocol corrects E1-003 after
S0's REWORK_SIGNAL and explicit authorization for synthetic comparison.
It is not a renderer selection or a claim that either candidate passes.

Compare a TypeScript/Bun candidate and Go/Bubble Tea candidate on identical
synthetic inputs, per the already proposed E1-003 experiment. Three and seven
simulated streams are experimental inputs, not an additional TUI acceptance
threshold. No score is inferred from another specification.

## Geometry cases (TUI §1)

| Case | Required observation |
|---|---|
| 120x36 | One vertical hierarchy; no three permanent columns; live session tree above details; A through F in order |
| 100x30 | Same hierarchy with reflow; record visibility of each zone |
| 80x24 | Same hierarchy; selector reduces to visible part plus counter; full selector list available separately; footer keeps context and status |
| 79x24 | Width below 80 exercises compact/plain, horizontally accessible details, commands usable without reading a clipped label |
| --plain at all above sizes | Safe full transcript (§3), screen-reader behavior separately verified (§5); do not clip the transcript to viewport height |

The value 79 is a boundary test input, not a new normative minimum width.
No minimum FPS, latency, mandatory row count, or benchmark winner is added.
TUI §1 refers to SESSION-TREE for the full tree contract; this comparison only
scores what TUI itself states. Additional tree requirements are not silently
imported into its scores.

## Required contents of the projection (TUI §1)

| Zone/component | Visible information and behavior to inspect |
|---|---|
| Tree | General live session tree permanently above details, not hidden in /agents |
| A / C03 | Service / optional Group / Task, responsible owner, result |
| B / C04 | Role, engine, run, task, status; count of other sessions awaiting a decision remains visible |
| C / C05 | Event -> step -> run -> tool -> result, stable IDs, detail expansion preserves focus |
| C / C07 | Stable history and live tail; buffering is not described as agent work |
| D / C06 | Current required step with owner/state, next step, done/total; full plan via /todo |
| E / C08 | Task/run recipient, preserved draft, visible input queue when steering is unsupported |
| F / C09 | Selected run context, separately quota/cost and freshness; explicit unknown values |
| C10 | Result revision/digest/evidence, source->target preview and actual handoff phase in the applicable scenario |
| C11 | Keyboard operation, help with actual bindings, Esc back |
| C12 | All zones from one projection, atomic selection change |
| C01/C02 | Compact head in header; large companion in welcome/help; canonical assets required to verify the mascot (§4) |

Record each applicable field's presence per geometry. Unknown data must render
as unknown; synthetic values must be labelled synthetic. A screenshot alone
cannot prove stable identity, draft preservation, or atomic selection.

## Behavior and evidence matrix

`NOT RUN` means no evidence yet, not FAIL and not PASS. Each candidate must
ultimately have its own evidence file, exact invocation, version, fixture digest,
geometry/mode, observed result, and limitations. Do not combine two candidates'
results into one pass. No weighted aggregate or renderer choice is defined here.

| Criterion | TUI section | Evidence required | TS/Bun | Go/Bubble Tea |
|---|---|---|---|---|
| Geometry and required contents above | §1 | Captured frames for each geometry and mode, field checks | NOT RUN | NOT RUN |
| Selection and drafts | §1 C12; §2 | Distinct task/run drafts, selection round trip, coherent recipient/details/footer | NOT RUN | NOT RUN |
| Keyboard/slash routes | §2 | /todo, /agents, /scope, /context, /handoff, /help, /quit plus listed baseline bindings; actual conflicts documented in help | NOT RUN | NOT RUN |
| Editing and focus | §2 | Composer Ctrl+A edits; letters/digits do not select; copy unmodified; Enter, multiline paste, Esc, tool expansion | NOT RUN | NOT RUN |
| Ctrl+C states | §2 | Nonempty clear; active empty requests selected interrupt/stopping; idle explains exit; no premature cancelled; repeat termination requires explicit message/ownership | NOT RUN | NOT RUN |
| History ordering and access | §3 | workspace_seq order, tool/item grouping, delayed timestamp as metadata, held scroll anchor, new count, explicit live return; middle history reachable | NOT RUN | NOT RUN |
| Preview/cache budget | §3 | Exercise 2,000 logical lines, 16KiB tool preview, 1MiB live text cache/run as load parameters; archive paging without history loss | NOT RUN | NOT RUN |
| Coalescing and responsiveness | §3 | Measured redraws/sec against <=30 target; input/stop/approval during large output; no invented latency threshold | NOT RUN | NOT RUN |
| Resize and untrusted output | §3 | Focus/anchor preserved; OSC52, OSC8 and control sequences inert; explicit artifact actions; safe full plain transcript/export | NOT RUN | NOT RUN |
| Palette and status | §4 | Base colors, restrained accent, body contrast >=4.5:1, text status without color, borders/wordmark/light variant | NOT RUN | NOT RUN |
| Mascot and reduced motion | §4 | Canonical frames/states/timing; one animated indicator; fallback text state; assets not supplied, canonical verification pending | NOT RUN | NOT RUN |
| Native compositing | §5 | Real TTY: font artifacts, composer overlap, scrollback | NOT RUN | NOT RUN |
| Terminal compatibility | §5 | 16/256/truecolor/NO_COLOR, wcwidth/graphemes, Cyrillic/IME, bracketed paste, screen reader plain; mouse optional | NOT RUN | NOT RUN |

Synthetic coordinator/interrupt/receipt state transitions only prove display
behavior. They do not establish provider control, persistence, real process
ownership, or archive implementation. Automated PTY evidence cannot replace
human IME/screen-reader/compositing review. Geometry fixture success is expressly
insufficient under §5.

## Baseline and next measurement

Bun 1.3.0 (b0a6feca) restored from the predecessor; 19 existing offline contract
and broker tests pass. They provide no renderer acceptance evidence. No `go`
executable was found in PATH during transfer; no Go version or Bubble Tea version
is yet pinned. Neither candidate has been implemented or measured in this step.

Next: pin the local Go/dependency runtime and implement both isolated candidates
using one fixture, then fill the matrix with actual results. Canonical mascot
assets remain unavailable. Present a new Jev packet with threshold 0.8 and a
results table before selecting a renderer. The current document requests no
renderer decision and gives no acceptance verdict.
