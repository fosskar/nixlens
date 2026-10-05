// Package mtls sets up mutual tls between the hub and its agents.
//
// every machine has its own ed25519 key, created on first start, and is
// known to the others by the fingerprint of its public key, as with ssh or
// wireguard. there is no ca: the hub pins each agent's fingerprint, and an
// agent pins the hubs it answers
package mtls

import (
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"os"
	"slices"
	"time"
)

// Identity is a machine's key with a self-signed certificate around it; the
// certificate only carries the key, nothing in it is checked
type Identity struct {
	cert        tls.Certificate
	Fingerprint string
}

// Load reads the key at path, creating it first if it does not exist
func Load(path string) (Identity, error) {
	key, err := readKey(path)
	if errors.Is(err, fs.ErrNotExist) {
		key, err = createKey(path)
	}
	if err != nil {
		return Identity{}, err
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Unix(0, 0),
		NotAfter:     time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC),
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, key.Public(), key)
	if err != nil {
		return Identity{}, err
	}
	fp, err := Fingerprint(key.Public())
	if err != nil {
		return Identity{}, err
	}
	return Identity{
		cert:        tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key},
		Fingerprint: fp,
	}, nil
}

func readKey(path string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, fmt.Errorf("%s: no private key", path)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("%s: not an ed25519 key", path)
	}
	return key, nil
}

func createKey(path string) (ed25519.PrivateKey, error) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	// O_EXCL: never overwrite a key another process just wrote
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	if err := pem.Encode(f, &pem.Block{Type: "PRIVATE KEY", Bytes: der}); err != nil {
		f.Close()
		return nil, err
	}
	return key, f.Close()
}

// Fingerprint names a public key the way ssh-keygen -l does: SHA256: and
// the unpadded base64 of the hash, here of the key's der encoding
func Fingerprint(pub crypto.PublicKey) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(der)
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:]), nil
}

func pinned(state tls.ConnectionState, allowed []string) error {
	if len(state.PeerCertificates) == 0 {
		return errors.New("no certificate")
	}
	fp, err := Fingerprint(state.PeerCertificates[0].PublicKey)
	if err != nil {
		return err
	}
	if !slices.Contains(allowed, fp) {
		return fmt.Errorf("untrusted key %s", fp)
	}
	return nil
}

// Server is the agent side: only the given hubs may connect
func (id Identity) Server(trusted []string) *tls.Config {
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{id.cert},
		// the certificate is checked by its key below, not by a ca
		ClientAuth:       tls.RequireAnyClientCert,
		VerifyConnection: func(state tls.ConnectionState) error { return pinned(state, trusted) },
	}
}

// Client is the hub side towards one agent, which must hold the key with
// the given fingerprint
func (id Identity) Client(fingerprint string) *tls.Config {
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{id.cert},
		// no ca and no names: the agent is known by its key alone, which
		// VerifyConnection checks
		InsecureSkipVerify: true,
		VerifyConnection:   func(state tls.ConnectionState) error { return pinned(state, []string{fingerprint}) },
	}
}
