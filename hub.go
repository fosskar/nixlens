package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

type Machine struct {
	Name   string `json:"name"`
	Self   bool   `json:"self"`
	Online bool   `json:"online"`
	Error  string `json:"error"`
}

type hub struct {
	self     string
	cpu      *cpuSampler
	appsFile string
	token    string
	peers    map[string]string
	client   *http.Client
	frames   *frameChecker
}

func readPeers(path string) (map[string]string, error) {
	peers := map[string]string{}
	if path == "" {
		return peers, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &peers); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return peers, nil
}

func newHub(cpu *cpuSampler, appsFile, token string, peers map[string]string) (*hub, error) {
	self, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	delete(peers, self)
	return &hub{
		self:     self,
		cpu:      cpu,
		appsFile: appsFile,
		token:    token,
		peers:    peers,
		client:   &http.Client{Timeout: 5 * time.Second},
		frames:   newFrameChecker(),
	}, nil
}

func (h *hub) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/machines", h.machines)
	mux.HandleFunc("GET /api/machines/{name}/{kind}", h.machineData)
	mux.HandleFunc("GET /api/apps", h.apps)
}

// names sorted, self first
func (h *hub) names() []string {
	names := make([]string, 0, len(h.peers))
	for n := range h.peers {
		names = append(names, n)
	}
	sort.Strings(names)
	return append([]string{h.self}, names...)
}

func (h *hub) fetchPeer(ctx context.Context, name, kind string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.peers[name]+"/api/local/"+kind, nil)
	if err != nil {
		return nil, err
	}
	if h.token != "" {
		req.Header.Set("Authorization", "Bearer "+h.token)
	}
	res, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", name, res.Status)
	}
	return body, nil
}

func (h *hub) machines(w http.ResponseWriter, r *http.Request) {
	names := h.names()
	out := make([]Machine, len(names))
	var wg sync.WaitGroup
	for i, n := range names {
		out[i] = Machine{Name: n, Self: n == h.self, Online: true}
		if n == h.self {
			continue
		}
		wg.Go(func() {
			if _, err := h.fetchPeer(r.Context(), n, "system"); err != nil {
				out[i].Online = false
				out[i].Error = err.Error()
			}
		})
	}
	wg.Wait()
	writeJSON(w, out, nil)
}

func (h *hub) machineData(w http.ResponseWriter, r *http.Request) {
	name, kind := r.PathValue("name"), r.PathValue("kind")
	if kind != "system" && kind != "disks" {
		http.NotFound(w, r)
		return
	}
	if name == h.self {
		if kind == "system" {
			s, err := readSystem(h.cpu)
			writeJSON(w, s, err)
		} else {
			d, err := readDisks()
			writeJSON(w, d, err)
		}
		return
	}
	if _, ok := h.peers[name]; !ok {
		http.NotFound(w, r)
		return
	}
	body, err := h.fetchPeer(r.Context(), name, kind)
	if err != nil {
		log.Print(err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *hub) apps(w http.ResponseWriter, r *http.Request) {
	all, err := readApps(h.appsFile)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	for i := range all {
		all[i].Machine = h.self
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	for name := range h.peers {
		wg.Go(func() {
			body, err := h.fetchPeer(r.Context(), name, "apps")
			if err != nil {
				log.Print(err)
				return
			}
			var apps []App
			if err := json.Unmarshal(body, &apps); err != nil {
				log.Printf("%s apps: %v", name, err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, a := range apps {
				a.Machine = name
				all = append(all, a)
			}
		})
	}
	wg.Wait()

	origin := requestOrigin(r)
	for i := range all {
		wg.Go(func() {
			all[i].Frameable = h.frames.check(r.Context(), all[i].URL, origin)
		})
	}
	wg.Wait()

	sort.Slice(all, func(i, j int) bool {
		if all[i].Name != all[j].Name {
			return all[i].Name < all[j].Name
		}
		return all[i].Machine < all[j].Machine
	})
	writeJSON(w, all, nil)
}
