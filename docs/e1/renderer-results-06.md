# Renderer measurements 06 — keyboard focus and draft-preserving selection

Continues results-05 against TUI §1 C05/C08/C11/C12 and §2/3. Both finite
candidates now use the same keyboard focus transitions:

| Focus | Keys | Behavior |
|---|---|---|
| Composer | Tab | Agents focus, retaining draft |
| Composer | Ctrl+A/E, digits/letters | Edit draft; never select an agent |
| Agents | 1–7 within visible run count | Select run and restore its task/run draft |
| Agents | Tab | History focus |
| History | Up/Down | Move the first visible selected event by one |
| History | PgUp/PgDn | Move by available history rows |
| History | Home/End | First event / explicit jump to live |
| History | Enter | Open selected event's tool detail by stable event ID |
| Tool | Esc | Return to history and retain anchor |
| Other focus | Esc | Return to composer |
| Outside composer | Ctrl+A | Agents focus |

Tab from history/tool returns to composer. Unbound text outside composer is
ignored; slash dispatch and exit/Ctrl+C editing semantics remain composer-only.
Tool detail displays fixture tool ID/text using the existing sanitizer and
cell clipping. It is not full production tool expansion, archive or dispatch.
Help notices include the new focus/paging bindings; long help is still clipped
in this minimal viewport and not a complete accessible help interface.

New evidence under spikes/renderer/evidence:

- pty-13-navigation: initial focus/draft/paging/tool subset, 13/13 each.
- pty-14-navigation: expanded arrows, concrete tool text and composer Ctrl+A/E,
  15/15 each. Page size now follows the available history area.
- pty-16-navigation-anchor: repeats 15 predicates and explicitly verifies final
  anchor=1, focus=tool, tool=e9 after 100x30/120x36/79x24/80x24 resize sequence.
- pty-15-semantics: previous slash notices/edit/Ctrl+C subset, 10/10 each.
- pty-17-paste-regression: fragmented Cyrillic/ZWJ/newline paste, 6/6 each.
- batch-05-navigation: unchanged non-TTY model cases, 152/152 across 16 cases
  each; Go boundary unit tests pass.

The navigation scenario edits `raft1` into `draft1` with Ctrl+A/E, switches to
run 2 to enter `draft2`, returns to run 1 to append `!`, then restores run 2.
It checks the intermediate restored draft as well as final drafts. History
opens e2, returns with Esc, pages, jumps live, moves to e9 and opens its actual
`tool1 line-9 synthetic` text. Raw ANSI contains this detail. Diagnostic traces
record focus, selected run, anchor, tool ID and draft after navigation actions;
these are synthetic data, capped at 64 actions, not production logs.

These probes verify state and emitted bytes, not every reconstructed terminal
frame or physical compositing. Drafts persist only within the process. Selection
resets history to live; a separate per-run scroll-position store is not added.
Full tool-detail paging, search/export/archive, shortcut completeness, readable
help at all widths, approval/stop priority, color/IME/screen reader/canonical
sprites and real-terminal review remain open. Historical streaming results
remain measurements of their earlier commits; this slice does not rerun load
or claim a new streaming acceptance result. No renderer selection is made.

Reproduce after rebuilding Go with the README command:

```sh
python3 zinin-cli/spikes/renderer/pty-check.py NEW-NAV-NAME --navigation
python3 zinin-cli/spikes/renderer/pty-check.py NEW-SEMANTICS-NAME --semantics
python3 zinin-cli/spikes/renderer/pty-check.py NEW-PASTE-NAME
```

Use new evidence names; old captures and reports are never overwritten.
