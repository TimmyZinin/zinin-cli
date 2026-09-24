// Offline Bubble Tea Update/View candidate. No terminal event loop is started.
package main

import (
	"encoding/json"
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Run struct{ ID, Task, Owner, Engine, State, Context, Quota, Cost, Freshness string }
type Event struct {
	Seq                 int
	Run, ID, Tool, Text string
	Timestamp           int
}
type Action struct {
	Kind, Text                   string
	Index, Anchor, Width, Height int
	Event                        Event
}
type Fixture struct {
	Label, Service, Group string
	Runs                  []Run
	Events                []Event
	Actions               []Action
}
type model struct {
	f                                     Fixture
	selected, anchor, unseen, w, h, count int
	plain                                 bool
	drafts                                map[string]string
}

var osc = regexp.MustCompile("\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)")
var csi = regexp.MustCompile("\x1b\\[[0-?]*[ -/]*[@-~]")

func safe(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || (r >= 127 && r <= 159) {
			return -1
		}
		return r
	}, csi.ReplaceAllString(osc.ReplaceAllString(s, ""), ""))
}
func (m model) run() Run      { return m.f.Runs[m.selected] }
func (m model) key() string   { r := m.run(); return r.Task + "/" + r.ID }
func (m model) Init() tea.Cmd { return nil }
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch a := msg.(type) {
	case tea.WindowSizeMsg:
		m.w = a.Width
		m.h = a.Height
	case Action:
		switch a.Kind {
		case "select":
			m.selected = a.Index
		case "draft":
			m.drafts[m.key()] = a.Text
		case "scroll":
			m.anchor = a.Anchor
		case "append":
			m.f.Events = append(m.f.Events, a.Event)
			if m.anchor >= 0 {
				m.unseen++
			}
		case "live":
			m.anchor = -1
			m.unseen = 0
		}
	}
	return m, nil
}
func (m model) View() string {
	r := m.run()
	mode := "native"
	if m.w < 80 {
		mode = "compact"
	}
	if m.plain {
		mode = "plain"
	}
	lines := []string{m.f.Label + " ZININ [o..] " + mode, "TREE orchestrator waiting"}
	waiting := 0
	for _, run := range m.f.Runs[:m.count] {
		lines = append(lines, fmt.Sprintf(" %s %s %s %s", run.ID, run.Owner, run.Engine, run.State))
		if run.ID != r.ID && run.State == "waiting" {
			waiting++
		}
	}
	anchor := "live"
	if m.anchor >= 0 {
		anchor = strconv.Itoa(m.anchor)
	}
	lines = append(lines, fmt.Sprintf("A %s/%s/%s owner=%s result=res1", m.f.Service, m.f.Group, r.Task, r.Owner), fmt.Sprintf("B executor/%s/%s/%s %s waiting=%d", r.Engine, r.ID, r.Task, r.State, waiting), fmt.Sprintf("C history new=%d anchor=%s", m.unseen, anchor))
	tail := []string{fmt.Sprintf("D step=s1 owner=%s required working next=s2 done=0/2 /todo", r.Owner), "Result res1 rev=1 digest=synthetic evidence=fixture", fmt.Sprintf("Handoff %s->r2 phase=preview", r.ID), fmt.Sprintf("E %s/%s draft=%s queue=1 (steering unsupported)", r.Task, r.ID, m.drafts[m.key()]), fmt.Sprintf("F %s context=%s status=%s", r.ID, r.Context, r.State), fmt.Sprintf("quota=%s cost=%s fresh=%s", r.Quota, r.Cost, r.Freshness)}
	ev := []Event{}
	for _, e := range m.f.Events {
		if e.Run == r.ID {
			ev = append(ev, e)
		}
	}
	sort.SliceStable(ev, func(i, j int) bool { return ev[i].Seq < ev[j].Seq })
	slots := max(0, m.h-len(lines)-len(tail))
	start := 0
	end := len(ev)
	if !m.plain {
		if m.anchor < 0 {
			start = max(0, len(ev)-slots)
		} else {
			start = min(m.anchor, len(ev))
		}
		end = min(len(ev), start+slots)
	}
	for _, e := range ev[start:end] {
		lines = append(lines, fmt.Sprintf("%d %s>s1>%s>%s>res1 %s ts=%d", e.Seq, e.ID, e.Run, e.Tool, e.Text, e.Timestamp))
	}
	lines = append(lines, tail...)
	for i, s := range lines {
		s = safe(s)
		rr := []rune(s)
		if !m.plain && len(rr) > m.w {
			s = string(rr[:m.w])
		}
		lines[i] = s
	}
	return strings.Join(lines, "\n") + "\n"
}
func main() {
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var f Fixture
	if err = json.Unmarshal(data, &f); err != nil {
		panic(err)
	}
	w, _ := strconv.Atoi(os.Args[2])
	h, _ := strconv.Atoi(os.Args[3])
	count, _ := strconv.Atoi(os.Args[4])
	m := model{f: f, anchor: -1, w: w, h: h, count: count, plain: os.Args[5] == "plain", drafts: map[string]string{}}
	start := time.Now()
	initial := m.View()
	trace := []map[string]any{}
	for _, a := range f.Actions {
		var msg tea.Msg = a
		if a.Kind == "resize" {
			msg = tea.WindowSizeMsg{Width: a.Width, Height: a.Height}
		}
		next, _ := m.Update(msg)
		m = next.(model)
		trace = append(trace, map[string]any{"kind": a.Kind, "selected": m.run().ID, "draft": m.drafts[m.key()], "anchor": m.anchor, "unseen": m.unseen, "frame": m.View()})
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"initial": initial, "trace": trace, "elapsed_ms": float64(time.Since(start).Microseconds()) / 1000, "scope": "batch Update/View only"})
}
