// Command nixlens runs an agent, a hub, or one of the agent's privileged
// helpers, chosen by flags.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/fosskar/nixlens/internal/agent"
	"github.com/fosskar/nixlens/internal/hub"
	"github.com/fosskar/nixlens/internal/mtls"
	"github.com/fosskar/nixlens/internal/smart"
	"github.com/fosskar/nixlens/web"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:7480", "listen address")
	appsFile := flag.String("apps", "", "path to this machine's apps JSON file")
	keyFile := flag.String("key", "", "this machine's key for mutual tls, created if missing")
	trust := flag.String("trust", "", "agent: comma-separated fingerprints of the hubs that may connect; serves https when set")
	printFingerprint := flag.Bool("fingerprint", false, "print the fingerprint of -key, creating the key if missing, and exit")
	isHub := flag.Bool("hub", false, "serve the web UI and aggregate this machine with its peers")
	peersFile := flag.String("peers", "", `hub: path to a JSON object mapping peer names to {"url", "fingerprint"}`)
	categories := flag.String("categories", "", "hub: comma-separated categories listed first, in this order")
	adminGroups := flag.String("admin-groups", "", "hub: comma-separated groups that see machines; empty allows everyone")
	accountURL := flag.String("account-url", "", "hub: page where users manage their account, linked from the user menu")
	categoryGroupsFile := flag.String("category-groups", "", "hub: path to a JSON object mapping categories to the groups that see them")
	memFile := flag.String("installed-memory-file", "", "file holding the installed memory in bytes")
	writeMem := flag.String("write-installed-memory", "", "write the installed memory from smbios to this file and exit; needs root")
	collectSmartTo := flag.String("collect-smart", "", "query smart data of all disks into this file and exit; needs raw disk access")
	smartFile := flag.String("smart-file", "", "file with smart data written by -collect-smart")
	flag.Parse()

	if *collectSmartTo != "" {
		devices, err := agent.SmartDevices()
		if err != nil {
			log.Fatal(err)
		}
		if err := smart.Collect(*collectSmartTo, devices); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *writeMem != "" {
		if err := agent.WriteInstalledMemory(*writeMem); err != nil {
			log.Fatal(err)
		}
		return
	}

	var id mtls.Identity
	if *keyFile != "" {
		var err error
		if id, err = mtls.Load(*keyFile); err != nil {
			log.Fatal(err)
		}
		if *printFingerprint {
			fmt.Println(id.Fingerprint)
			return
		}
		log.Printf("key fingerprint %s", id.Fingerprint)
	} else if *printFingerprint {
		log.Fatal("-fingerprint needs -key")
	}
	var trusted []string
	for _, fp := range strings.Split(*trust, ",") {
		if fp != "" {
			trusted = append(trusted, fp)
		}
	}
	useTLS := !*isHub && len(trusted) > 0
	if useTLS && *keyFile == "" {
		log.Fatal("-trust needs -key")
	}
	memInstalled, err := agent.ReadInstalledMemory(*memFile)
	if err != nil {
		log.Fatal(err)
	}
	local := agent.Handler(agent.Options{AppsFile: *appsFile, SmartFile: *smartFile, InstalledMemory: memInstalled})

	mux := http.NewServeMux()
	localHandler := local
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

	if *isHub {
		peers, err := hub.ReadPeers(*peersFile)
		if err != nil {
			log.Fatal(err)
		}
		categoryGroups, err := hub.ReadCategoryGroups(*categoryGroupsFile)
		if err != nil {
			log.Fatal(err)
		}
		var admins []string
		for _, g := range strings.Split(*adminGroups, ",") {
			if g != "" {
				admins = append(admins, g)
			}
		}
		acc := hub.NewAccess(admins, categoryGroups, *accountURL)
		// the hub itself serves plain http behind its proxy; its key is for
		// reaching the agents
		for name, p := range peers {
			if p.Fingerprint != "" && *keyFile == "" {
				log.Fatalf("peer %s has a fingerprint, so the hub needs -key", name)
			}
		}
		// the overview waits for every agent, so one that cannot be reached
		// should hold it up briefly; a connected but busy one gets longer
		clientFor := func(p hub.Peer) *http.Client {
			transport := http.DefaultTransport.(*http.Transport).Clone()
			transport.DialContext = (&net.Dialer{Timeout: 2 * time.Second}).DialContext
			transport.TLSHandshakeTimeout = 2 * time.Second
			if p.Fingerprint != "" {
				transport.TLSClientConfig = id.Client(p.Fingerprint)
			}
			return &http.Client{Timeout: 5 * time.Second, Transport: transport}
		}
		h, err := hub.New(local, *appsFile, peers, clientFor, strings.Split(*categories, ","), acc)
		if err != nil {
			log.Fatal(err)
		}
		h.Register(mux)
		// behind the proxy, the hub's own /api/local/ would otherwise bypass
		// adminGroups
		localHandler = acc.AdminOnly(local.ServeHTTP)

		dist, err := fs.Sub(web.Dist, "dist")
		if err != nil {
			log.Fatal(err)
		}
		ui, err := hub.UI(dist)
		if err != nil {
			log.Fatal(err)
		}
		mux.HandleFunc("GET /", ui)
	}

	mux.Handle("GET /api/local/", localHandler)

	log.Printf("listening on %s (hub: %t, tls: %t)", *listen, *isHub, useTLS)
	if useTLS {
		server.TLSConfig = id.Server(trusted)
		log.Fatal(server.ListenAndServeTLS("", ""))
	}
	log.Fatal(server.ListenAndServe())
}
