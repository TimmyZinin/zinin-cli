# E2 handoff — TypeScript/Bun renderer

E1 renderer direction is ACCEPTED-CONDITIONAL by S0. Go remains archived with
pinned build/source/evidence for fallback. No production changes are authorized
by this handoff. Original Jev v2 REWORK_SIGNAL remains in the decision record.

| Task | Evidence required to close |
|---|---|
| **E2-R01: seven-window degradation — mandatory production blocker** | Reproduce TS/7 per-trial p95 max 102.91ms, profile event-loop/render/sort/GC/output backpressure and separate host noise from renderer behavior. Preserve all outliers. Submit >=10 matched before/after trials per 3/7 workload with raw logs, spread and source hashes; retain 3-run p95<50ms and investigate event lag<250ms. S0 reviews the cause, correction and acceptable seven-window profile before closing; no invented 7-run numeric SLA. |
| E2-R02: event lag and pressure | Measure commit-to-visible event lag and input/stop/approval responsiveness under open-loop and slow-terminal output, not only acknowledged edits. |
| E2-R03: history/cache/archive | Review the storage proposal before implementing 2000 logical lines, 16KiB preview and 1MiB/run cache policy, paging/search/export and no-history-loss recovery. |
| E2-R04: input and usability | Bound incomplete paste input; adverse escape/grapheme editing tests, draft recovery, complete bindings and readable help. |
| E2-R05: integration | Replace synthetic dispatch with authorized command/approval/cancellation paths; validate selected-run routing, ownership and receipts. Real provider runs require their separate scope. |
| E2-R06: native acceptance preparation | Obtain canonical sprites; establish palette/color/motion, macOS/Linux, IME, screen-reader and physical TTY matrix for the applicable E2/E3 gates. PTY fixtures cannot replace human/native evidence. |
| E2-R07: continuous fact and fallback checks | Keep ADR figures tied to logs; preserve archived Go source/runtime. Reopen direction on the ADR triggers; rerun parity/performance and obtain S0 receipt before any Go switch. |

Suggested sequence: R01/R02 measurement and diagnosis first; then independently
review R03 and integrate R04/R05. Do not add features to conceal performance
regressions. R06 dependencies can be prepared concurrently without publishing.
Long measurements must run in a separately authorized background job and be
collected next turn; keep individual work turns below eight minutes.

Existing adapter compatibility and other project gates are not automatically
proven by renderer acceptance; carry their remaining work into the E2 plan.
