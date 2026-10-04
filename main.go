package main

import (
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

func main() {
	listen := flag.String("listen", "127.0.0.1:7480", "listen address")
	appsFile := flag.String("apps", "", "path to this machine's apps JSON file")
	tlsCert := flag.String("tls-cert", "", "an agent's server certificate, or the hub's client certificate for its peers")
	tlsKey := flag.String("tls-key", "", "key of -tls-cert")
	tlsCA := flag.String("tls-ca", "", "ca that an agent checks clients against, or the hub checks its peers against")
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

	certs := tlsFiles{cert: *tlsCert, key: *tlsKey, ca: *tlsCA}
	useTLS, err := certs.enabled()
	if err != nil {
		log.Fatal(err)
	}
	memInstalled, err := readInstalledMemory(*memFile)
	if err != nil {
		log.Fatal(err)
	}
	cpu := newCPUSampler()

	local := http.NewServeMux()
	local.HandleFunc("GET /api/local/system", func(w http.ResponseWriter, r *http.Request) {
		s, err := readSystem(cpu, memInstalled)
		writeJSON(w, s, err)
	})
	local.HandleFunc("GET /api/local/storage", func(w http.ResponseWriter, r *http.Request) {
		s, err := readStorage(*smartFile)
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
	var localHandler http.Handler = local
	server := &http.Server{
		Addr:    *listen,
		Handler: mux,
		// agents listen on the network; without these a client could hold
		// connections open indefinitely
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}

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
		// the hub itself serves plain http behind its proxy; its certificate
		// is for reaching the agents
		client := &http.Client{Timeout: 5 * time.Second}
		if useTLS {
			config, err := certs.client()
			if err != nil {
				log.Fatal(err)
			}
			client.Transport = &http.Transport{TLSClientConfig: config}
		}
		h, err := newHub(local, *appsFile, client, peers, strings.Split(*categories, ","), acc)
		if err != nil {
			log.Fatal(err)
		}
		h.register(mux)
		// behind the proxy, the hub's own /api/local/ would otherwise bypass
		// adminGroups
		localHandler = acc.adminOnly(local.ServeHTTP)

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
			// the ui runs only its own bundle; images come from icon cdns,
			// app windows frame the apps, and nothing may frame nOS itself
			w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "same-origin")
			files.ServeHTTP(w, r)
		})
	}

	mux.Handle("GET /api/local/", localHandler)

	log.Printf("listening on %s (hub: %t, tls: %t)", *listen, *hub, useTLS && !*hub)
	if useTLS && !*hub {
		config, err := certs.server()
		if err != nil {
			log.Fatal(err)
		}
		server.TLSConfig = config
		log.Fatal(server.ListenAndServeTLS("", ""))
	}
	log.Fatal(server.ListenAndServe())
}
