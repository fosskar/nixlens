package main

import (
	"net/http"
	"testing"
)

func TestAllowsFraming(t *testing.T) {
	const origin = "https://home.nx3.eu"
	cases := []struct {
		name string
		h    http.Header
		want bool
	}{
		{"no headers", http.Header{}, true},
		{"xfo deny", http.Header{"X-Frame-Options": {"deny"}}, false},
		{"xfo sameorigin", http.Header{"X-Frame-Options": {"SAMEORIGIN"}}, false},
		{"csp none", http.Header{"Content-Security-Policy": {"default-src 'self'; frame-ancestors 'none'"}}, false},
		{"csp self", http.Header{"Content-Security-Policy": {"frame-ancestors 'self'"}}, false},
		{"csp star", http.Header{"Content-Security-Policy": {"frame-ancestors *"}}, true},
		{"csp exact origin", http.Header{"Content-Security-Policy": {"frame-ancestors 'self' https://home.nx3.eu"}}, true},
		{"csp wildcard host", http.Header{"Content-Security-Policy": {"frame-ancestors https://*.nx3.eu"}}, true},
		{"csp wrong scheme", http.Header{"Content-Security-Policy": {"frame-ancestors http://home.nx3.eu"}}, false},
		{"csp scheme source", http.Header{"Content-Security-Policy": {"frame-ancestors https:"}}, true},
		{"csp overrides xfo", http.Header{
			"X-Frame-Options":         {"DENY"},
			"Content-Security-Policy": {"frame-ancestors https://home.nx3.eu"},
		}, true},
		{"csp without frame-ancestors falls back to xfo", http.Header{
			"X-Frame-Options":         {"DENY"},
			"Content-Security-Policy": {"default-src 'self'"},
		}, false},
	}
	for _, c := range cases {
		if got := allowsFraming(c.h, origin); got != c.want {
			t.Errorf("%s: got %t, want %t", c.name, got, c.want)
		}
	}
}
