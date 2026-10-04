// Package agent reports the state of the machine it runs on.
package agent

import (
	"errors"
	"net/http"

	"github.com/fosskar/nos/internal/api"
	"github.com/fosskar/nos/internal/smart"
)

// Options are the files the agent reads besides the system itself
type Options struct {
	AppsFile        string
	SmartFile       string
	InstalledMemory uint64
}

// Handler serves /api/local/*
func Handler(o Options) http.Handler {
	cpu := newCPUSampler()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		s, err := readSystem(cpu, o.InstalledMemory)
		api.WriteJSON(w, s, err)
	})
	mux.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
		s, err := readStorage(o.SmartFile)
		api.WriteJSON(w, s, err)
	})
	mux.HandleFunc("GET /api/local/network", func(w http.ResponseWriter, r *http.Request) {
		n, err := readNetwork()
		api.WriteJSON(w, n, err)
	})
	mux.HandleFunc("GET /api/local/pool/{pool}", func(w http.ResponseWriter, r *http.Request) {
		d, err := poolDetail(r.PathValue("pool"))
		if errors.Is(err, errUnknownPool) {
			http.NotFound(w, r)
			return
		}
		api.WriteJSON(w, d, err)
	})
	mux.HandleFunc("GET /api/local/apps", func(w http.ResponseWriter, r *http.Request) {
		a, err := api.ReadApps(o.AppsFile)
		api.WriteJSON(w, a, err)
	})
	return mux
}

// SmartDevices lists the disks for the smart collector
func SmartDevices() ([]smart.Device, error) {
	devs, err := readBlockDevices()
	if err != nil {
		return nil, err
	}
	disks, err := readDisks(devs)
	if err != nil {
		return nil, err
	}
	out := make([]smart.Device, len(disks))
	for i, d := range disks {
		out[i] = smart.Device{Name: d.Name, Key: smartKey(d)}
	}
	return out, nil
}

// smart data is stored by stable disk id, as kernel names can change
func smartKey(d Disk) string {
	if d.ID != "" {
		return d.ID
	}
	return d.Name
}
