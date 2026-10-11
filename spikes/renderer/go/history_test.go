package main

import "testing"

func TestSelectedHistoryCounterAcrossAppendPaths(t *testing.T) {
	m := model{f: Fixture{Runs: []Run{{ID: "r1"}}}, count: 3, anchor: 0}
	next, _ := m.Update(loadMsg{})
	m = next.(model)
	if m.unseen != 1 {
		t.Fatal("selected load event must increment unseen", m.unseen)
	}
	next, _ = m.Update(loadMsg{})
	m = next.(model)
	if m.unseen != 1 {
		t.Fatal("other-run load event must not increment unseen", m.unseen)
	}
	next, _ = m.Update(Action{Kind: "append", Event: Event{Run: "r2"}})
	m = next.(model)
	if m.unseen != 1 {
		t.Fatal("other-run action must not increment unseen", m.unseen)
	}
	next, _ = m.Update(Action{Kind: "append", Event: Event{Run: "r1"}})
	m = next.(model)
	if m.unseen != 2 {
		t.Fatal("selected action must increment unseen", m.unseen)
	}
	next, _ = m.Update(Action{Kind: "live"})
	m = next.(model)
	next, _ = m.Update(Action{Kind: "append", Event: Event{Run: "r1"}})
	m = next.(model)
	if m.unseen != 0 || m.anchor != -1 {
		t.Fatal("live tail must reset and keep counter zero", m)
	}
}
