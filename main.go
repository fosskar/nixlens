package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
)

//go:embed all:web/dist
var webDist embed.FS

func writeJSON(w http.ResponseWriter, v any, err error) {
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

func main() {
	listen := flag.String("listen", "127.0.0.1:8090", "listen address")
	appsFile := flag.String("apps", "", "path to the apps JSON file")
	flag.Parse()

	cpu := newCPUSampler()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/system", func(w http.ResponseWriter, r *http.Request) {
		s, err := readSystem(cpu)
		writeJSON(w, s, err)
	})
	mux.HandleFunc("GET /api/disks", func(w http.ResponseWriter, r *http.Request) {
		d, err := readDisks()
		writeJSON(w, d, err)
	})
	mux.HandleFunc("GET /api/apps", func(w http.ResponseWriter, r *http.Request) {
		if *appsFile == "" {
			writeJSON(w, []any{}, nil)
			return
		}
		data, err := os.ReadFile(*appsFile)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})

	dist, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	files := http.FileServerFS(dist)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(dist, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
			r.URL.Path = "/"
		}
		files.ServeHTTP(w, r)
	})

	log.Printf("listening on %s", *listen)
	log.Fatal(http.ListenAndServe(*listen, mux))
}
