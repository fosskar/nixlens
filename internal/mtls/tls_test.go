package mtls

import (
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func load(t *testing.T, name string) Identity {
	t.Helper()
	id, err := Load(filepath.Join(t.TempDir(), name+".key"))
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLoadKeepsKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key.pem")
	first, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if first.Fingerprint != second.Fingerprint || !strings.HasPrefix(first.Fingerprint, "SHA256:") {
		t.Fatalf("fingerprint changed or malformed: %s, %s", first.Fingerprint, second.Fingerprint)
	}
}

func TestPinnedMutualTLS(t *testing.T) {
	agent, hub, stranger := load(t, "agent"), load(t, "hub"), load(t, "stranger")

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	server.TLS = agent.Server([]string{hub.Fingerprint})
	server.StartTLS()
	defer server.Close()

	get := func(config *tls.Config) error {
		client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: config}}
		res, err := client.Get(server.URL)
		if err != nil {
			return err
		}
		return res.Body.Close()
	}

	if err := get(hub.Client(agent.Fingerprint)); err != nil {
		t.Errorf("trusted hub to pinned agent: %v", err)
	}
	if err := get(stranger.Client(agent.Fingerprint)); err == nil {
		t.Error("an untrusted hub must be rejected")
	}
	if err := get(hub.Client(stranger.Fingerprint)); err == nil {
		t.Error("an agent with another key must be rejected")
	}
	if err := get(&tls.Config{MinVersion: tls.VersionTLS13, InsecureSkipVerify: true}); err == nil {
		t.Error("a client without a certificate must be rejected")
	}
}
