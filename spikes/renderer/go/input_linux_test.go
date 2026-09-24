//go:build linux

package main

import "testing"

func TestInputBoundaries(t *testing.T) {
	for _, full := range []string{"界", "👩", "\x1b[200~Привет\n👩‍💻\x1b[201~", "\x1b[D"} {
		b := []byte(full)
		for i := 1; i < len(b); i++ {
			if got := unitLength(b[:i], false); got != 0 {
				t.Fatalf("partial %q gave %d", b[:i], got)
			}
		}
		if got := unitLength(b, false); got != len(b) {
			t.Fatalf("full %q gave %d", b, got)
		}
	}
	if unitLength([]byte{27}, false) != 0 || unitLength([]byte{27}, true) != 1 {
		t.Fatal("Esc timeout boundary")
	}
	if unitLength([]byte("\r"), false) != 1 {
		t.Fatal("Enter boundary")
	}
}
