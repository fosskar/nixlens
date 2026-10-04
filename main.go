package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed all:web/dist
var webDist embed.FS

type App struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Icon        string `json:"icon"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Machine     string `json:"machine,omitempty"`
	Frameable   bool   `json:"frameable"`
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
	listen := flag.String("listen", "127.0.0.1:7480", "listen address")
	appsFile := flag.String("apps", "", "path to this machine's apps JSON file")
	tokenFile := flag.String("token-file", "", "bearer token required on /api/local/ and sent to peers")
	hub := flag.Bool("hub", false, "serve the web UI and aggregate this machine with its peers")
	peersFile := flag.String("peers", "", "hub: path to a JSON object mapping peer names to base URLs")
	categories := flag.String("categories", "", "hub: comma-separated categories listed first, in this order")
	adminGroups := flag.String("admin-groups", "", "hub: comma-separated groups that see machines; empty allows everyone")
	categoryGroupsFile := flag.String("category-groups", "", "hub: path to a JSON object mapping categories to the groups that see them")
	memFile := flag.String("installed-memory-file", "", "file holding the installed memory in bytes")
	writeMem := flag.String("write-installed-memory", "", "write the installed memory from smbios to this file and exit; needs root")
	collectSmartTo := flag.String("collect-smart", "", "query smart data of all disks into this file and exit; needs raw disk access")
	smartFile := flag.String("smart-file", "", "file with smart data written by -collect-smart")
	flag.Parse()

	if *collectSmartTo != "" {
		if err := collectSmart(*collectSmartTo); err != nil {
			log.Fatal(err)
		}
		return
	}
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
	storage := func() (Storage, error) { return readStorage(*smartFile) }

	local := http.NewServeMux()
	local.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		s, err := system()
		writeJSON(w, s, err)
	})
	local.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
		s, err := storage()
		writeJSON(w, s, err)
	})
	local.HandleFunc("GET /api/local/pool/{pool}", func(w http.ResponseWriter, r *http.Request) {
		d, err := poolDetail(r.PathValue("pool"))
		if errors.Is(err, errUnknownPool) {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, d, err)
	})
	local.HandleFunc("GET /api/local/apps", func(w http.ResponseWriter, r *http.Request) {
		a, err := readApps(*appsFile)
		writeJSON(w, a, err)
	})

	mux := http.NewServeMux()
	localHandler := requireToken(token, local)

	if *hub {
		peers, err := readPeers(*peersFile)
		if err != nil {
			log.Fatal(err)
		}
		categoryGroups, err := readCategoryGroups(*categoryGroupsFile)
		if err != nil {
			log.Fatal(err)
		}
		acc := access{categoryGroups: categoryGroups}
		for _, g := range strings.Split(*adminGroups, ",") {
			if g != "" {
				acc.adminGroups = append(acc.adminGroups, g)
			}
		}
		h, err := newHub(system, storage, *appsFile, token, peers, strings.Split(*categories, ","), acc)
		if err != nil {
			log.Fatal(err)
		}
		h.register(mux)
		// without a token the hub's own /api/local/ would bypass adminGroups
		localHandler = acc.adminOnly(localHandler.ServeHTTP)

		dist, err := fs.Sub(webDist, "web/dist")
		if err != nil {
			log.Fatal(err)
		}
		files := http.FileServerFS(dist)
		mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
			if _, err := fs.Stat(dist, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
				r.URL.Path = "/"
			}
			// vite names bundles by content hash; everything else (index.html,
			// favicon) keeps its name across builds and must be revalidated
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
		})
	}

	mux.Handle("GET /api/local/", localHandler)

	log.Printf("listening on %s (hub: %t)", *listen, *hub)
	server := &http.Server{
		Addr:    *listen,
		Handler: mux,
		// agents listen on the network; without these a client could hold
		// connections open indefinitely without ever sending a token
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}
	log.Fatal(server.ListenAndServe())
}
