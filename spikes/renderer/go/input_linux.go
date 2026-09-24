//go:build linux

package main

import (
	"bytes"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"time"
	"unicode/utf8"
)

// Bubble Tea v1.3.4 treats short reads as event boundaries. Preserve complete
// UTF-8, CSI and bracketed paste units before handing them to that decoder.
// This bounded Linux spike reader is not a cross-platform input implementation.
type framedInput struct {
	file            *os.File
	pending, ready  []byte
	since, deadline time.Time
}

func newFramedInput(f *os.File) *framedInput {
	return &framedInput{file: f, deadline: time.Now().Add(6 * time.Second)}
}
func (r *framedInput) Write(b []byte) (int, error) { return r.file.Write(b) }
func (r *framedInput) Close() error                { return nil }
func (r *framedInput) Fd() uintptr                 { return r.file.Fd() }
func unitLength(b []byte, escapeExpired bool) int {
	if len(b) == 0 {
		return 0
	}
	if b[0] != 27 {
		if !utf8.FullRune(b) {
			return 0
		}
		_, n := utf8.DecodeRune(b)
		return n
	}
	if len(b) == 1 {
		if escapeExpired {
			return 1
		}
		return 0
	}
	start := []byte("\x1b[200~")
	if bytes.HasPrefix(b, start) {
		i := bytes.Index(b[len(start):], []byte("\x1b[201~"))
		if i < 0 {
			return 0
		}
		return len(start) + i + 6
	}
	if bytes.HasPrefix(start, b) {
		return 0
	}
	if b[1] == '[' {
		for i := 2; i < len(b); i++ {
			if b[i] >= 64 && b[i] <= 126 {
				return i + 1
			}
		}
		return 0
	}
	return 1
}
func (r *framedInput) Read(dst []byte) (int, error) {
	for len(r.ready) == 0 {
		if n := unitLength(r.pending, !r.since.IsZero() && time.Since(r.since) >= 40*time.Millisecond); n > 0 {
			r.ready = append([]byte(nil), r.pending[:n]...)
			r.pending = r.pending[n:]
			r.since = time.Now()
			break
		}
		if time.Now().After(r.deadline) {
			if len(r.pending) > 0 {
				return 0, fmt.Errorf("incomplete terminal input at spike deadline")
			}
			return 0, io.EOF
		}
		poll := []unix.PollFd{{Fd: int32(r.Fd()), Events: unix.POLLIN}}
		_, err := unix.Poll(poll, 10)
		if err == unix.EINTR {
			continue
		}
		if err != nil {
			return 0, err
		}
		if poll[0].Revents&unix.POLLIN == 0 {
			continue
		}
		var b [4096]byte
		n, err := r.file.Read(b[:])
		if err != nil {
			return 0, err
		}
		if n == 0 {
			return 0, io.EOF
		}
		if len(r.pending) == 0 {
			r.since = time.Now()
		}
		r.pending = append(r.pending, b[:n]...)
		if len(r.pending) > 1024*1024 {
			return 0, fmt.Errorf("synthetic input probe exceeds 1MiB bound")
		}
	}
	n := copy(dst, r.ready)
	r.ready = r.ready[n:]
	return n, nil
}
