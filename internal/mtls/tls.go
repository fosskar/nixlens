// Package mtls sets up mutual tls between the hub and its agents.
package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
)

// agents and the hub authenticate each other with certificates from one
// private ca. agent certificates carry serverAuth and the hub's clientAuth,
// so a certificate taken from one agent cannot be used to read another
type Files struct {
	Cert, Key, CA string
}

func (f Files) Enabled() (bool, error) {
	set := 0
	for _, p := range []string{f.Cert, f.Key, f.CA} {
		if p != "" {
			set++
		}
	}
	switch set {
	case 0:
		return false, nil
	case 3:
		return true, nil
	default:
		return false, errors.New("-tls-cert, -tls-key and -tls-ca must be set together")
	}
}

func (f Files) load() (tls.Certificate, *x509.CertPool, error) {
	cert, err := tls.LoadX509KeyPair(f.Cert, f.Key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	pem, err := os.ReadFile(f.CA)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return tls.Certificate{}, nil, fmt.Errorf("%s: no certificates", f.CA)
	}
	return cert, pool, nil
}

// agent side: only clients with a clientAuth certificate from the ca
func (f Files) Server() (*tls.Config, error) {
	cert, pool, err := f.load()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}, nil
}

// hub side: agents must present a serverAuth certificate from the ca that
// names the host in their peer url
func (f Files) Client() (*tls.Config, error) {
	cert, pool, err := f.load()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
	}, nil
}
