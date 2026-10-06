package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fosskar/nixlens/internal/api"
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

	agent := func(apps []api.App) *httptest.Server {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
			api.WriteJSON(w, map[string]string{"hostname": "agent"}, nil)
		})
		mux.HandleFunc("GET /api/local/apps", func(w http.ResponseWriter, r *http.Request) {
			api.WriteJSON(w, apps, nil)
		})
		mux.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
			api.WriteJSON(w, map[string][]any{"pools": {}, "disks": {}}, nil)
		})
		return httptest.NewServer(mux)
	}
	a1 := agent([]api.App{{Name: "Framed", URL: framed.URL, Category: "apps"}})
	defer a1.Close()
	a2 := agent([]api.App{{Name: "Denied", URL: denied.URL, Category: "apps"}})
	defer a2.Close()

	appsFile := filepath.Join(t.TempDir(), "apps.json")
	if err := os.WriteFile(appsFile, []byte(`[{"name":"Local","url":"`+framed.URL+`/local","category":"tools"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	local := http.NewServeMux()
	local.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		api.WriteJSON(w, map[string]string{"hostname": "hub"}, nil)
	})
	local.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
		api.WriteJSON(w, map[string][]any{"pools": {}, "disks": {}}, nil)
	})

	h, err := New(local, appsFile, map[string]Peer{"one": {URL: a1.URL}, "two": {URL: a2.URL}},
		func(Peer) *http.Client { return &http.Client{Timeout: 5 * time.Second} }, []string{"apps"}, Access{})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.Register(mux)

	paths := []string{"/api/apps", "/api/machines", "/api/overview", "/api/machines/one/system", "/api/machines/" + h.self + "/system"}
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
	var apps []api.App
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

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/overview", nil))
	var overview []MachineOverview
	if err := json.Unmarshal(rec.Body.Bytes(), &overview); err != nil {
		t.Fatal(err)
	}
	if len(overview) != 3 {
		t.Fatalf("overview: %+v", overview)
	}
	for _, m := range overview {
		if !m.Online || m.Error != "" || len(m.System) == 0 || len(m.Storage) == 0 {
			t.Errorf("overview %s: %+v", m.Name, m)
		}
	}
}
