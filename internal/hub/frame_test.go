package hub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestAllowsFraming(t *testing.T) {
	const origin = "https://home.nx3.eu"
	cases := []struct {
		name string
		h    http.Header
		want bool
	}{
		{"no headers", http.Header{}, true},
		{"xfo deny", http.Header{"X-Frame-Options": {"deny"}}, false},
		{"xfo sameorigin", http.Header{"X-Frame-Options": {"SAMEORIGIN"}}, false},
		{"csp none", http.Header{"Content-Security-Policy": {"default-src 'self'; frame-ancestors 'none'"}}, false},
		{"csp self", http.Header{"Content-Security-Policy": {"frame-ancestors 'self'"}}, false},
		{"csp star", http.Header{"Content-Security-Policy": {"frame-ancestors *"}}, true},
		{"csp exact origin", http.Header{"Content-Security-Policy": {"frame-ancestors 'self' https://home.nx3.eu"}}, true},
		{"csp wildcard host", http.Header{"Content-Security-Policy": {"frame-ancestors https://*.nx3.eu"}}, true},
		{"csp wrong scheme", http.Header{"Content-Security-Policy": {"frame-ancestors http://home.nx3.eu"}}, false},
		{"csp scheme source", http.Header{"Content-Security-Policy": {"frame-ancestors https:"}}, true},
		{"csp overrides xfo", http.Header{
			"X-Frame-Options":         {"DENY"},
			"Content-Security-Policy": {"frame-ancestors https://home.nx3.eu"},
		}, true},
		{"csp without frame-ancestors falls back to xfo", http.Header{
			"X-Frame-Options":         {"DENY"},
			"Content-Security-Policy": {"default-src 'self'"},
		}, false},
	}
	for _, c := range cases {
		if got := allowsFraming(c.h, origin); got != c.want {
			t.Errorf("%s: got %t, want %t", c.name, got, c.want)
		}
	}
}

func FuzzAllowsFraming(f *testing.F) {
	f.Add("DENY", "frame-ancestors 'self' https://*.nx3.eu", "https://home.nx3.eu")
	f.Add("", "default-src 'none'; frame-ancestors *", "http://127.0.0.1:7480")
	f.Fuzz(func(t *testing.T, xfo, csp, origin string) {
		h := http.Header{}
		h.Set("X-Frame-Options", xfo)
		h.Set("Content-Security-Policy", csp)
		allowsFraming(h, origin)
	})
}

func TestFrameCheckRefreshesInBackground(t *testing.T) {
	var deny atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if deny.Load() {
			w.Header().Set("X-Frame-Options", "DENY")
		}
	}))
	defer srv.Close()
	c := newFrameChecker()
	const origin = "http://home.nx3.eu"
	if !c.check(context.Background(), srv.URL, origin) {
		t.Fatal("first check: not frameable")
	}

	deny.Store(true)
	key := srv.URL + " " + origin
	c.mu.Lock()
	c.cache[key] = frameResult{frameable: true, at: time.Now().Add(-2 * frameCacheTTL)}
	c.mu.Unlock()
	if !c.check(context.Background(), srv.URL, origin) {
		t.Fatal("expired result was not returned while refreshing")
	}
	for range 100 {
		c.mu.Lock()
		done := !c.refreshing[key]
		c.mu.Unlock()
		if done {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if c.check(context.Background(), srv.URL, origin) {
		t.Fatal("refreshed result not used")
	}
}

func TestFrameCheckMixedContent(t *testing.T) {
	var asked atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { asked.Store(true) }))
	defer srv.Close()
	c := newFrameChecker()
	if c.check(context.Background(), srv.URL, "https://home.nx3.eu") {
		t.Fatal("http app frameable in an https page")
	}
	if asked.Load() {
		t.Fatal("http app probed for an https page")
	}
	if !c.check(context.Background(), srv.URL, "http://127.0.0.1:7480") {
		t.Fatal("http app not frameable in an http page")
	}
}
