// Package hub serves the ui and aggregates the agents of all machines.
package hub

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

	"github.com/fosskar/nixlens/internal/api"
)

const maxPeerResponse = 16 << 20

type Machine struct {
	Name string `json:"name"`
	Self bool   `json:"self"`
}

type Hub struct {
	self     string
	local    http.Handler
	appsFile string
	peers    map[string]peer
	order    map[string]int
	access   Access
	icons    *iconCache
}

// Peer is an agent: where it listens, and the fingerprint of its key, which
// an https url requires
type Peer struct {
	URL         string `json:"url"`
	Fingerprint string `json:"fingerprint"`
}

type peer struct {
	url    string
	client *http.Client
}

func ReadPeers(path string) (map[string]Peer, error) {
	peers := map[string]Peer{}
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
	// an agent is either reached over https and known by its key, or over
	// plain http, e.g. through a tunnel; a fingerprint over http would
	// suggest a check that never happens
	for name, p := range peers {
		https := strings.HasPrefix(p.URL, "https://")
		if https != (p.Fingerprint != "") {
			return nil, fmt.Errorf("peer %s: an https url needs a fingerprint, and a fingerprint an https url", name)
		}
	}
	return peers, nil
}

// New takes the peers with an http client for each, which checks the
// peer's fingerprint
func New(local http.Handler, appsFile string, peers map[string]Peer, clientFor func(Peer) *http.Client, categories []string, acc Access, iconDir string) (*Hub, error) {
	self, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	byName := map[string]peer{}
	for name, p := range peers {
		if name == self {
			continue
		}
		byName[name] = peer{url: p.URL, client: clientFor(p)}
	}
	order := map[string]int{}
	for i, c := range categories {
		if c != "" {
			order[c] = i
		}
	}
	return &Hub{
		self:     self,
		local:    local,
		appsFile: appsFile,
		peers:    byName,
		order:    order,
		access:   acc,
		icons:    newIconCache("https://cdn.jsdelivr.net", iconDir),
	}, nil
}

func (h *Hub) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/machines", h.access.AdminOnly(h.machines))
	mux.HandleFunc("GET /api/machines/{name}/{kind}", h.access.AdminOnly(h.machineData))
	mux.HandleFunc("GET /api/machines/{name}/pool/{pool}", h.access.AdminOnly(h.poolDetail))
	mux.HandleFunc("GET /api/apps", h.appIndex)
	mux.HandleFunc("GET /api/apps/{machine}", h.apps)
	mux.HandleFunc("GET /api/icons/{kind}/{name}", h.icons.serve)
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		api.WriteJSON(w, h.access.me(r), nil)
	})
}

// names sorted, self first
func (h *Hub) names() []string {
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
func (h *Hub) fetch(ctx context.Context, name, path string) ([]byte, error) {
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
	p, ok := h.peers[name]
	if !ok {
		return nil, statusError{http.StatusNotFound, "unknown machine " + name}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.url+"/api/local/"+path, nil)
	if err != nil {
		return nil, err
	}
	res, err := p.client.Do(req)
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

func (h *Hub) machineData(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != "system" && kind != "storage" && kind != "network" {
		http.NotFound(w, r)
		return
	}
	h.proxy(w, r, r.PathValue("name"), kind)
}

func (h *Hub) poolDetail(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, r.PathValue("name"), "pool/"+url.PathEscape(r.PathValue("pool")))
}

func (h *Hub) proxy(w http.ResponseWriter, r *http.Request, name, path string) {
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

// the machines without asking them, so each one's data loads on its own
func (h *Hub) machines(w http.ResponseWriter, r *http.Request) {
	api.WriteJSON(w, h.machineList(), nil)
}

func (h *Hub) machineList() []Machine {
	names := h.names()
	out := make([]Machine, len(names))
	for i, n := range names {
		out[i] = Machine{Name: n, Self: n == h.self}
	}
	return out
}

// AppIndex tells the ui whose apps to ask for and how to order categories
type AppIndex struct {
	Machines   []Machine `json:"machines"`
	Categories []string  `json:"categories"`
}

func (h *Hub) appIndex(w http.ResponseWriter, r *http.Request) {
	categories := make([]string, len(h.order))
	for c, rank := range h.order {
		categories[rank] = c
	}
	api.WriteJSON(w, AppIndex{Machines: h.machineList(), Categories: categories}, nil)
}

// the apps of one machine that this user sees, sorted
func (h *Hub) apps(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("machine")
	var all []api.App
	var err error
	if name == h.self {
		all, err = api.ReadApps(h.appsFile)
	} else {
		var body []byte
		if body, err = h.fetch(r.Context(), name, "apps"); err == nil {
			err = json.Unmarshal(body, &all)
		}
	}
	if err != nil {
		// every user may ask for apps; the details stay in the log
		log.Printf("%s apps: %v", name, err)
		status := http.StatusBadGateway
		var se statusError
		if errors.As(err, &se) {
			status = se.status
		} else if name == h.self {
			status = http.StatusInternalServerError
		}
		http.Error(w, "the app list could not be read", status)
		return
	}

	apps := make([]api.App, 0, len(all))
	for _, a := range all {
		if h.access.seesCategory(r, a.Category) {
			a.Machine = name
			apps = append(apps, a)
		}
	}
	sort.SliceStable(apps, func(i, j int) bool {
		if ci, cj := h.categoryRank(apps[i].Category), h.categoryRank(apps[j].Category); ci != cj {
			return ci < cj
		}
		if apps[i].Category != apps[j].Category {
			return apps[i].Category < apps[j].Category
		}
		return apps[i].Name < apps[j].Name
	})
	api.WriteJSON(w, apps, nil)
}

// listed categories first in their order, then the rest, uncategorized last
func (h *Hub) categoryRank(category string) int {
	if rank, ok := h.order[category]; ok {
		return rank
	}
	if category == "" {
		return len(h.order) + 1
	}
	return len(h.order)
}
