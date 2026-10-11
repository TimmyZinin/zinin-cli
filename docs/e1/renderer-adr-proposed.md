# Proposed ADR: TypeScript/Bun renderer direction for E1

Status: PROPOSED — S0/Jev receipt required; not applied to the production entrypoint.

Recommend TypeScript/Bun for the next renderer implementation stage. Keep the
Go/Bubble Tea spike and its evidence as a comparison fallback. This is a
conditional engineering choice; neither current spike is a production renderer.

ARCHITECTURE §2 prefers TypeScript if acceptance permits the single toolchain.
The current measured subset supplies no reason to add a separate Go frontend:
both pass the same geometry, Unicode paste, keyboard/draft/history/resize and
synthetic interrupt probes. On the latest local 30-sample visibility proxy both
meet the separate <50ms p95 target at 3 runs (TS 35.44ms, Go FPS29 39.55ms).
At 7 runs TS is 39.12ms, Go 67.36ms in one run; no broad ranking follows.
Go default FPS30 previously hit 31 writes in a rolling second; FPS29 passed
the measured target in repeat probes but does not enforce a strict write gap.

TypeScript keeps the existing CLI/core language and Bun toolchain. Go adds
another runtime/build chain and currently needs a Linux-only input framer
before the pinned Bubble Tea decoder. TypeScript's custom parser is also spike
code requiring hardening; a passing finite probe does not establish portable
terminal correctness. No dependency upgrade or packaging choice is authorized
by this ADR.

| TUI area | TS | Go | Evidence / remaining boundary |
|---|---|---|---|
| §1 geometry/projection | 152 narrow checks PASS | same | batch-06-history; synthetic fields |
| §2 paste/drafts/focus/routes | tested subset PASS | same | pty-15/17/18; routes are synthetic |
| §3 history/resize/interrupt under 8MiB | 4-case suite subset PASS | same | history-load-03: 15 each for 3/7 runs |
| §3 redraw/input | measured PASS subset | FPS29 measured PASS subset | latency-02; earlier FAIL retained |
| §3 cache/archive/preview | NOT IMPLEMENTED | NOT IMPLEMENTED | budget-01 and source audit |
| §3 event lag/approval/real cancellation | NOT PROVEN | NOT PROVEN | no provider actions |
| §4 palette/canonical motion | NOT PROVEN | NOT PROVEN | canonical assets absent |
| §5 native platform/color/IME/screen reader | NOT PROVEN | NOT PROVEN | Linux PTY only; Unicode subset tested |

Acceptance is not waived: cache/archive policy, readable help, missing bindings,
event lag, approval responsiveness, actual cancellation integration and native
matrix must be completed at their required E1/E2/E3 gates. O01 remains open for
production packaging/native evidence. E1 overall also needs adapter compatibility
records beyond renderer work. Previous statements that selection was premature
refer to unconditional production approval; this proposal asks S0 explicitly
whether the documented conditional direction is acceptable now.

Alternatives: choose Go now (no demonstrated necessity justifying extra toolchain);
continue both through all production features (duplicates work without evidence
of a Go-specific benefit); defer selection until targeted missing E1 evidence
is supplied (valid REWORK outcome). If TS cannot meet input/event-lag or native
acceptance after targeted fixes, reopen this ADR and rerun the same fixtures.

No production files, external dispatch or storage architecture change is part
of this proposal. S0 executes jev_gate.py at threshold 0.8 and returns a receipt
via say before the proposed direction becomes accepted.
