// Command nos runs an agent, a hub, or one of the agent's privileged
// helpers, chosen by flags.
package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/fosskar/nos/internal/agent"
	"github.com/fosskar/nos/internal/hub"
	"github.com/fosskar/nos/internal/mtls"
	"github.com/fosskar/nos/internal/smart"
	"github.com/fosskar/nos/web"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:7480", "listen address")
	appsFile := flag.String("apps", "", "path to this machine's apps JSON file")
	tlsCert := flag.String("tls-cert", "", "an agent's server certificate, or the hub's client certificate for its peers")
	tlsKey := flag.String("tls-key", "", "key of -tls-cert")
	tlsCA := flag.String("tls-ca", "", "ca that an agent checks clients against, or the hub checks its peers against")
	isHub := flag.Bool("hub", false, "serve the web UI and aggregate this machine with its peers")
	peersFile := flag.String("peers", "", "hub: path to a JSON object mapping peer names to base URLs")
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

	certs := mtls.Files{Cert: *tlsCert, Key: *tlsKey, CA: *tlsCA}
	useTLS, err := certs.Enabled()
	if err != nil {
		log.Fatal(err)
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
		// the hub itself serves plain http behind its proxy; its certificate
		// is for reaching the agents
		client := &http.Client{Timeout: 5 * time.Second}
		if useTLS {
			config, err := certs.Client()
			if err != nil {
				log.Fatal(err)
			}
			client.Transport = &http.Transport{TLSClientConfig: config}
		}
		h, err := hub.New(local, *appsFile, client, peers, strings.Split(*categories, ","), acc)
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
		mux.HandleFunc("GET /", hub.UI(dist))
	}

	mux.Handle("GET /api/local/", localHandler)

	log.Printf("listening on %s (hub: %t, tls: %t)", *listen, *isHub, useTLS && !*isHub)
	if useTLS && !*isHub {
		config, err := certs.Server()
		if err != nil {
			log.Fatal(err)
		}
		server.TLSConfig = config
		log.Fatal(server.ListenAndServeTLS("", ""))
	}
	log.Fatal(server.ListenAndServe())
}
