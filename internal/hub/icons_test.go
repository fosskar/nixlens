package hub

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestIcons(t *testing.T) {
	var hits atomic.Int32
	var down atomic.Bool
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch {
		case down.Load():
			http.Error(w, "down", http.StatusServiceUnavailable)
		case r.URL.Path == "/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg":
			if _, err := w.Write([]byte("<svg/>")); err != nil {
				t.Error(err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer cdn.Close()
	c := newIconCache(cdn.URL, "")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/icons/{kind}/{name}", c.serve)
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	for range 2 {
		rec := get("/api/icons/dashboard/jellyfin.svg")
		if rec.Code != http.StatusOK || rec.Body.String() != "<svg/>" || rec.Header().Get("Content-Type") != "image/svg+xml" {
			t.Fatalf("icon: %d %v %q", rec.Code, rec.Header(), rec.Body)
		}
		if csp := rec.Header().Get("Content-Security-Policy"); csp == "" {
			t.Fatal("svg served without csp")
		}
	}
	for range 2 {
		if rec := get("/api/icons/mdi/missing.svg"); rec.Code != http.StatusNotFound {
			t.Fatalf("missing icon: %d", rec.Code)
		}
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("cdn asked %d times, want 2", n)
	}

	for _, path := range []string{"/api/icons/other/x.svg", "/api/icons/mdi/x.png", "/api/icons/dashboard/.hidden.svg", "/api/icons/dashboard/x.exe"} {
		if rec := get(path); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("rejected names reached the cdn: %d requests", n)
	}

	down.Store(true)
	c.mu.Lock()
	for k, v := range c.cache {
		v.at = time.Now().Add(-2 * iconTTL)
		c.cache[k] = v
	}
	c.mu.Unlock()
	if rec := get("/api/icons/dashboard/jellyfin.svg"); rec.Code != http.StatusOK {
		t.Fatalf("expired icon with the cdn down: %d", rec.Code)
	}
	if rec := get("/api/icons/selfhst/new.svg"); rec.Code != http.StatusBadGateway {
		t.Fatalf("uncached icon with the cdn down: %d", rec.Code)
	}
}

func TestIconsOnDisk(t *testing.T) {
	var hits atomic.Int32
	var down atomic.Bool
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if down.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		if _, err := w.Write([]byte("<svg/>")); err != nil {
			t.Error(err)
		}
	}))
	defer cdn.Close()
	dir := t.TempDir()
	get := func(c *iconCache) int {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/icons/{kind}/{name}", c.serve)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/icons/mdi/printer.svg", nil))
		return rec.Code
	}
	if code := get(newIconCache(cdn.URL, dir)); code != http.StatusOK {
		t.Fatalf("first fetch: %d", code)
	}
	file := filepath.Join(dir, "mdi", "printer.svg")
	if body, err := os.ReadFile(file); err != nil || string(body) != "<svg/>" {
		t.Fatalf("icon not on disk: %q %v", body, err)
	}

	// a restarted hub serves the icon from disk without the cdn
	down.Store(true)
	if code := get(newIconCache(cdn.URL, dir)); code != http.StatusOK || hits.Load() != 1 {
		t.Fatalf("after restart: %d, cdn asked %d times", code, hits.Load())
	}

	// an expired file is fetched again, and kept while the cdn is down
	old := time.Now().Add(-2 * iconTTL)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	if code := get(newIconCache(cdn.URL, dir)); code != http.StatusOK || hits.Load() != 2 {
		t.Fatalf("expired, cdn down: %d, cdn asked %d times", code, hits.Load())
	}
	down.Store(false)
	if code := get(newIconCache(cdn.URL, dir)); code != http.StatusOK {
		t.Fatalf("expired, cdn up: %d", code)
	}
	if info, err := os.Stat(file); err != nil || time.Since(info.ModTime()) > time.Minute {
		t.Fatalf("expired file not replaced: %v %v", info.ModTime(), err)
	}
}
