package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
)

const (
	maxPeerResponse = 16 << 20
	maxFrameProbes  = 8
)

type Machine struct {
	Name   string `json:"name"`
	Self   bool   `json:"self"`
	Online bool   `json:"online"`
	Error  string `json:"error"`
}

type hub struct {
	self     string
	local    http.Handler
	appsFile string
	peers    map[string]string
	order    map[string]int
	access   access
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

func newHub(local http.Handler, appsFile string, client *http.Client, peers map[string]string, categories []string, acc access) (*hub, error) {
	self, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	delete(peers, self)
	order := map[string]int{}
	for i, c := range categories {
		if c != "" {
			order[c] = i
		}
	}
	return &hub{
		self:     self,
		local:    local,
		appsFile: appsFile,
		peers:    peers,
		order:    order,
		access:   acc,
		client:   client,
		frames:   newFrameChecker(),
	}, nil
}

func (h *hub) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/machines", h.access.adminOnly(h.machines))
	mux.HandleFunc("GET /api/overview", h.access.adminOnly(h.overview))
	mux.HandleFunc("GET /api/machines/{name}/{kind}", h.access.adminOnly(h.machineData))
	mux.HandleFunc("GET /api/machines/{name}/pool/{pool}", h.access.adminOnly(h.poolDetail))
	mux.HandleFunc("GET /api/apps", h.apps)
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, h.access.me(r), nil)
	})
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

// statusError keeps an upstream status, so a missing pool stays a 404
type statusError struct {
	status int
	msg    string
}

func (e statusError) Error() string { return e.msg }

// buffers a local handler's response
type capture struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *capture) Header() http.Header { return c.header }

func (c *capture) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
}

func (c *capture) Write(b []byte) (int, error) {
	c.WriteHeader(http.StatusOK)
	return c.body.Write(b)
}

// /api/local/<path> of a machine: the hub's own through its local handlers,
// peers through their agents
func (h *hub) fetch(ctx context.Context, name, path string) ([]byte, error) {
	if name == h.self {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "/api/local/"+path, nil)
		if err != nil {
			return nil, err
		}
		c := &capture{header: http.Header{}}
		h.local.ServeHTTP(c, req)
		if c.status != http.StatusOK {
			return nil, statusError{c.status, strings.TrimSpace(c.body.String())}
		}
		return c.body.Bytes(), nil
	}
	base, ok := h.peers[name]
	if !ok {
		return nil, statusError{http.StatusNotFound, "unknown machine " + name}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/local/"+path, nil)
	if err != nil {
		return nil, err
	}
	res, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, maxPeerResponse+1))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, statusError{res.StatusCode, fmt.Sprintf("%s: %s", name, res.Status)}
	}
	if len(body) > maxPeerResponse {
		return nil, fmt.Errorf("%s: response larger than %d bytes", name, maxPeerResponse)
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
			if _, err := h.fetch(r.Context(), n, "system"); err != nil {
				out[i].Online = false
				out[i].Error = err.Error()
			}
		})
	}
	wg.Wait()
	writeJSON(w, out, nil)
}

func (h *hub) machineData(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != "system" && kind != "storage" {
		http.NotFound(w, r)
		return
	}
	h.proxy(w, r, r.PathValue("name"), kind)
}

func (h *hub) poolDetail(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, r.PathValue("name"), "pool/"+url.PathEscape(r.PathValue("pool")))
}

func (h *hub) proxy(w http.ResponseWriter, r *http.Request, name, path string) {
	body, err := h.fetch(r.Context(), name, path)
	if err != nil {
		status := http.StatusBadGateway
		var se statusError
		if errors.As(err, &se) {
			status = se.status
		}
		log.Print(err)
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write(body); err != nil {
		log.Printf("%s: write response: %v", name, err)
	}
}

// MachineOverview is one machine's state in the all-machines view
type MachineOverview struct {
	Machine
	System  json.RawMessage `json:"system,omitempty"`
	Storage json.RawMessage `json:"storage,omitempty"`
}

// system and storage of every machine in one response, fetched in parallel
func (h *hub) overview(w http.ResponseWriter, r *http.Request) {
	names := h.names()
	out := make([]MachineOverview, len(names))
	var wg sync.WaitGroup
	for i, n := range names {
		out[i].Machine = Machine{Name: n, Self: n == h.self, Online: true}
		var sysErr, storErr error
		var inner sync.WaitGroup
		wg.Go(func() {
			inner.Go(func() { out[i].System, sysErr = h.fetch(r.Context(), n, "system") })
			inner.Go(func() { out[i].Storage, storErr = h.fetch(r.Context(), n, "storage") })
			inner.Wait()
			if err := errors.Join(sysErr, storErr); err != nil {
				out[i].Online = sysErr == nil
				out[i].Error = err.Error()
			}
		})
	}
	wg.Wait()
	writeJSON(w, out, nil)
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
			body, err := h.fetch(r.Context(), name, "apps")
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

	// self sorts first among equal urls, so dedup keeps the hub's own entry
	sort.SliceStable(all, func(i, j int) bool {
		if ci, cj := h.categoryRank(all[i].Category), h.categoryRank(all[j].Category); ci != cj {
			return ci < cj
		}
		if all[i].Category != all[j].Category {
			return all[i].Category < all[j].Category
		}
		if all[i].Name != all[j].Name {
			return all[i].Name < all[j].Name
		}
		if (all[i].Machine == h.self) != (all[j].Machine == h.self) {
			return all[i].Machine == h.self
		}
		return all[i].Machine < all[j].Machine
	})
	seen := map[string]bool{}
	apps := make([]App, 0, len(all))
	for _, a := range all {
		if !h.access.seesCategory(r, a.Category) {
			continue
		}
		if !seen[a.URL] {
			seen[a.URL] = true
			apps = append(apps, a)
		}
	}

	// probe only what this user sees, a few at a time
	origin := requestOrigin(r)
	slots := make(chan struct{}, maxFrameProbes)
	for i := range apps {
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			apps[i].Frameable = h.frames.check(r.Context(), apps[i].URL, origin)
		})
	}
	wg.Wait()
	writeJSON(w, apps, nil)
}

// listed categories first in their order, then the rest, uncategorized last
func (h *hub) categoryRank(category string) int {
	if rank, ok := h.order[category]; ok {
		return rank
	}
	if category == "" {
		return len(h.order) + 1
	}
	return len(h.order)
}
