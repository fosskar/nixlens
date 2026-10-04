// Package api holds what agent and hub share on the wire.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

type App struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Icon        string `json:"icon"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Machine     string `json:"machine,omitempty"`
	Frameable   bool   `json:"frameable"`
}

func WriteJSON(w http.ResponseWriter, v any, err error) {
	if err != nil {
		log.Print(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Print(err)
	}
}

func ReadApps(path string) ([]App, error) {
	apps := []App{}
	if path == "" {
		return apps, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &apps); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return apps, nil
}
