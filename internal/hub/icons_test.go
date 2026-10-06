package hub

import (
	"net/http"
	"net/http/httptest"
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
	c := newIconCache(cdn.URL)
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
