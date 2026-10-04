package main

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
type tlsFiles struct {
	cert, key, ca string
}

func (f tlsFiles) enabled() (bool, error) {
	set := 0
	for _, p := range []string{f.cert, f.key, f.ca} {
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

func (f tlsFiles) load() (tls.Certificate, *x509.CertPool, error) {
	cert, err := tls.LoadX509KeyPair(f.cert, f.key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	pem, err := os.ReadFile(f.ca)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return tls.Certificate{}, nil, fmt.Errorf("%s: no certificates", f.ca)
	}
	return cert, pool, nil
}

// agent side: only clients with a clientAuth certificate from the ca
func (f tlsFiles) server() (*tls.Config, error) {
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
func (f tlsFiles) client() (*tls.Config, error) {
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
