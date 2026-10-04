package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// many clients at once against a hub with two agents: exercises the parallel
// peer fetches, frame probes and the frame cache, so the race detector sees them
func TestHubConcurrentRequests(t *testing.T) {
	framed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer framed.Close()
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
	}))
	defer denied.Close()

	agent := func(apps []App) *httptest.Server {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, System{Hostname: "agent"}, nil)
		})
		mux.HandleFunc("GET /api/local/apps", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, apps, nil)
		})
		return httptest.NewServer(mux)
	}
	a1 := agent([]App{{Name: "Framed", URL: framed.URL, Category: "apps"}})
	defer a1.Close()
	a2 := agent([]App{{Name: "Denied", URL: denied.URL, Category: "apps"}})
	defer a2.Close()

	appsFile := filepath.Join(t.TempDir(), "apps.json")
	if err := os.WriteFile(appsFile, []byte(`[{"name":"Local","url":"`+framed.URL+`/local","category":"tools"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	local := http.NewServeMux()
	local.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, System{Hostname: "hub"}, nil)
	})

	h, err := newHub(local, appsFile, &http.Client{Timeout: 5 * time.Second},
		map[string]string{"one": a1.URL, "two": a2.URL}, []string{"apps"}, access{})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.register(mux)

	paths := []string{"/api/apps", "/api/machines", "/api/machines/one/system", "/api/machines/" + h.self + "/system"}
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			for _, p := range paths {
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
				if rec.Code != http.StatusOK {
					t.Errorf("%s: status %d: %s", p, rec.Code, rec.Body)
				}
			}
		})
	}
	wg.Wait()

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps", nil))
	var apps []App
	if err := json.Unmarshal(rec.Body.Bytes(), &apps); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, a := range apps {
		got[a.Name] = a.Frameable
	}
	if len(apps) != 3 || !got["Framed"] || got["Denied"] || !got["Local"] {
		t.Errorf("apps: %+v", apps)
	}
	if apps[0].Category != "apps" {
		t.Errorf("listed category first: %+v", apps)
	}
}
