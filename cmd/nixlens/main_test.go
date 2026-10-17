package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestLoopbackHostOnly(t *testing.T) {
	h := loopbackHostOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	for host, want := range map[string]int{
		"127.0.0.1:7480": http.StatusOK,
		"localhost:7480": http.StatusOK,
		"localhost":      http.StatusOK,
		"[::1]:7480":     http.StatusOK,
		// a page whose name was rebound to 127.0.0.1 keeps its own name
		"rebind.example:7480": http.StatusMisdirectedRequest,
		"10.0.0.5:7480":       http.StatusMisdirectedRequest,
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/local/system", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %s: %d, want %d", host, rec.Code, want)
		}
	}
}

func TestTrustedHubs(t *testing.T) {
	const fp = "SHA256:mE3VtPq1Zz8l1d7m4cX0nV2QHqzQd5a8V0b8m1f7n6Y"
	for _, tc := range []struct {
		value   string
		set     bool
		want    []string
		wantErr bool
	}{
		{value: "", set: false, want: nil},
		{value: fp, set: true, want: []string{fp}},
		{value: fp + ",," + fp, set: true, want: []string{fp, fp}},
		// an agent asked to trust hubs must not fall back to plain http
		{value: "", set: true, wantErr: true},
		{value: ",", set: true, wantErr: true},
	} {
		got, err := trustedHubs(tc.value, tc.set)
		if (err != nil) != tc.wantErr || !slices.Equal(got, tc.want) {
			t.Errorf("trustedHubs(%q, %t) = %q, %v", tc.value, tc.set, got, err)
		}
	}
}
