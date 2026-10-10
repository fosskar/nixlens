package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fosskar/nixlens/internal/api"
)

// many clients at once against a hub with two agents: exercises the parallel
// peer fetches, so the race detector sees them
func TestHubConcurrentRequests(t *testing.T) {

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
	a1 := agent([]api.App{{Name: "One", URL: "https://one.example", Category: "apps"}})
	defer a1.Close()
	a2 := agent([]api.App{{Name: "Two", URL: "https://two.example", Category: "apps"}})
	defer a2.Close()

	appsFile := filepath.Join(t.TempDir(), "apps.json")
	if err := os.WriteFile(appsFile, []byte(`[{"name":"Local","url":"https://local.example","category":"tools"}]`), 0o600); err != nil {
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
		func(Peer) *http.Client { return &http.Client{Timeout: 5 * time.Second} }, []string{"apps"}, Access{}, "")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.Register(mux)

	paths := []string{"/api/apps", "/api/apps/one", "/api/apps/two", "/api/apps/" + h.self, "/api/machines", "/api/machines/one/system", "/api/machines/" + h.self + "/system"}
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

	get := func(path string, v any) {
		t.Helper()
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}

	var index AppIndex
	get("/api/apps", &index)
	if len(index.Machines) != 3 || !index.Machines[0].Self || index.Machines[1].Name != "one" || len(index.Categories) != 1 || index.Categories[0] != "apps" {
		t.Errorf("index: %+v", index)
	}
	got := map[string]api.App{}
	for _, m := range index.Machines {
		var apps []api.App
		get("/api/apps/"+m.Name, &apps)
		for _, a := range apps {
			if a.Machine != m.Name {
				t.Errorf("%s: %+v", m.Name, a)
			}
			got[a.Name] = a
		}
	}
	if len(got) != 3 {
		t.Errorf("apps: %+v", got)
	}

	var machines []Machine
	get("/api/machines", &machines)
	if len(machines) != 3 || !machines[0].Self {
		t.Errorf("machines: %+v", machines)
	}
}

// an agent that does not answer must not hold up the others
func TestUnreachablePeerIsIndependent(t *testing.T) {
	stuck := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-stuck }))
	defer slow.Close()
	defer close(stuck)

	appsFile := filepath.Join(t.TempDir(), "apps.json")
	if err := os.WriteFile(appsFile, []byte(`[{"name":"Local","url":"http://127.0.0.1:1/"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := New(http.NewServeMux(), appsFile, map[string]Peer{"slow": {URL: slow.URL}},
		func(Peer) *http.Client { return &http.Client{Timeout: time.Minute} }, nil, Access{}, "")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.Register(mux)

	for _, p := range []string{"/api/apps", "/api/machines", "/api/apps/" + h.self} {
		done := make(chan int)
		go func() {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
			done <- rec.Code
		}()
		select {
		case code := <-done:
			if code != http.StatusOK {
				t.Errorf("%s: status %d", p, code)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("%s waits for the unreachable peer", p)
		}
	}
}

func TestAppsErrorHidesDetails(t *testing.T) {
	appsFile := filepath.Join(t.TempDir(), "apps.json")
	if err := os.WriteFile(appsFile, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := New(http.NewServeMux(), appsFile, nil, nil, nil, Access{}, "")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps/"+h.self, nil))
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), appsFile) {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}
