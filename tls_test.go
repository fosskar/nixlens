package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type testCert struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	der  []byte
}

func issue(t *testing.T, ca *testCert, name string, usage x509.ExtKeyUsage) *testCert {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		DNSNames:     []string{name},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	parent, signer := tmpl, key
	if ca == nil {
		tmpl.IsCA = true
		tmpl.BasicConstraintsValid = true
		tmpl.KeyUsage |= x509.KeyUsageCertSign
		tmpl.ExtKeyUsage = nil
	} else {
		parent, signer = ca.cert, ca.key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, &key.PublicKey, signer)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return &testCert{cert: cert, key: key, der: der}
}

func writeFiles(t *testing.T, dir string, c, ca *testCert) tlsFiles {
	t.Helper()
	keyDER, err := x509.MarshalECPrivateKey(c.key)
	if err != nil {
		t.Fatal(err)
	}
	f := tlsFiles{
		cert: filepath.Join(dir, c.cert.Subject.CommonName+".crt"),
		key:  filepath.Join(dir, c.cert.Subject.CommonName+".key"),
		ca:   filepath.Join(dir, "ca.crt"),
	}
	for path, block := range map[string]*pem.Block{
		f.cert: {Type: "CERTIFICATE", Bytes: c.der},
		f.key:  {Type: "EC PRIVATE KEY", Bytes: keyDER},
		f.ca:   {Type: "CERTIFICATE", Bytes: ca.der},
	} {
		if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func TestMutualTLS(t *testing.T) {
	dir := t.TempDir()
	ca := issue(t, nil, "nos test ca", 0)
	other := issue(t, nil, "other ca", 0)
	agentFiles := writeFiles(t, dir, issue(t, ca, "agent", x509.ExtKeyUsageServerAuth), ca)
	hubFiles := writeFiles(t, dir, issue(t, ca, "hub", x509.ExtKeyUsageClientAuth), ca)
	otherDir := t.TempDir()
	foreignFiles := writeFiles(t, otherDir, issue(t, other, "hub", x509.ExtKeyUsageClientAuth), ca)

	serverConfig, err := agentFiles.server()
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.TLS = serverConfig
	srv.StartTLS()
	defer srv.Close()

	get := func(files *tlsFiles) error {
		var config *tls.Config
		if files != nil {
			if config, err = files.client(); err != nil {
				t.Fatal(err)
			}
		} else {
			_, pool, err := hubFiles.load()
			if err != nil {
				t.Fatal(err)
			}
			config = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS13}
		}
		client := &http.Client{Transport: &http.Transport{TLSClientConfig: config}}
		res, err := client.Get(srv.URL)
		if err != nil {
			return err
		}
		res.Body.Close()
		return nil
	}

	if err := get(&hubFiles); err != nil {
		t.Errorf("hub certificate: %v", err)
	}
	if get(nil) == nil {
		t.Error("request without a client certificate was accepted")
	}
	if get(&agentFiles) == nil {
		t.Error("an agent's serverAuth certificate was accepted as a client certificate")
	}
	if get(&foreignFiles) == nil {
		t.Error("a client certificate from another ca was accepted")
	}
}
