package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
)

//go:embed all:web/dist
var webDist embed.FS

type App struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Machine   string `json:"machine,omitempty"`
	Frameable bool   `json:"frameable"`
}

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

func readApps(path string) ([]App, error) {
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

func readToken(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	token, err := readTrimmed(path)
	if err != nil {
		return "", err
	}
	if token == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return token, nil
}

func requireToken(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8090", "listen address")
	appsFile := flag.String("apps", "", "path to this machine's apps JSON file")
	tokenFile := flag.String("token-file", "", "bearer token required on /api/local/ and sent to peers")
	hub := flag.Bool("hub", false, "serve the web UI and aggregate this machine with its peers")
	peersFile := flag.String("peers", "", "hub: path to a JSON object mapping peer names to base URLs")
	memFile := flag.String("installed-memory-file", "", "file holding the installed memory in bytes")
	writeMem := flag.String("write-installed-memory", "", "write the installed memory from smbios to this file and exit; needs root")
	flag.Parse()

	if *writeMem != "" {
		if err := writeInstalledMemory(*writeMem); err != nil {
			log.Fatal(err)
		}
		return
	}

	token, err := readToken(*tokenFile)
	if err != nil {
		log.Fatal(err)
	}
	memInstalled, err := readInstalledMemory(*memFile)
	if err != nil {
		log.Fatal(err)
	}
	cpu := newCPUSampler()
	system := func() (System, error) { return readSystem(cpu, memInstalled) }

	local := http.NewServeMux()
	local.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		s, err := system()
		writeJSON(w, s, err)
	})
	local.HandleFunc("GET /api/local/disks", func(w http.ResponseWriter, r *http.Request) {
		d, err := readDisks()
		writeJSON(w, d, err)
	})
	local.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
		s, err := readStorage()
		writeJSON(w, s, err)
	})
	local.HandleFunc("GET /api/local/apps", func(w http.ResponseWriter, r *http.Request) {
		a, err := readApps(*appsFile)
		writeJSON(w, a, err)
	})

	mux := http.NewServeMux()
	mux.Handle("GET /api/local/", requireToken(token, local))

	if *hub {
		peers, err := readPeers(*peersFile)
		if err != nil {
			log.Fatal(err)
		}
		h, err := newHub(system, *appsFile, token, peers)
		if err != nil {
			log.Fatal(err)
		}
		h.register(mux)

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
	}

	log.Printf("listening on %s (hub: %t)", *listen, *hub)
	log.Fatal(http.ListenAndServe(*listen, mux))
}
