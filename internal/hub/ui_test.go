package hub

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestUI(t *testing.T) {
	page := "<!doctype html>" + strings.Repeat("<div></div>", 100)
	ui, err := UI(fstest.MapFS{
		"index.html":           {Data: []byte(page)},
		"assets/index-abc.js":  {Data: []byte(strings.Repeat("console.log(1);", 100))},
		"assets/Inter-abc.ttf": {Data: []byte("font")},
	})
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string, header http.Header) *http.Response {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for k, v := range header {
			req.Header[k] = v
		}
		rec := httptest.NewRecorder()
		ui(rec, req)
		return rec.Result()
	}
	gzipped := http.Header{"Accept-Encoding": {"br, gzip"}}

	res := get("/m/vault", gzipped)
	if res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("unknown path: %v", res.Header)
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if body, _ := io.ReadAll(zr); string(body) != page {
		t.Fatalf("unknown path served %q", body)
	}

	res = get("/", gzipped)
	again := get("/", http.Header{"Accept-Encoding": {"gzip"}, "If-None-Match": {res.Header.Get("ETag")}})
	if again.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation: status %d", again.StatusCode)
	}

	if plain := get("/", nil); plain.Header.Get("Content-Encoding") != "" || plain.Header.Get("ETag") == res.Header.Get("ETag") {
		t.Fatalf("plain response: %v", plain.Header)
	}
	if res := get("/", http.Header{"Accept-Encoding": {"gzip;q=0"}}); res.Header.Get("Content-Encoding") != "" {
		t.Fatal("gzip;q=0 got gzip")
	}

	res = get("/assets/index-abc.js", gzipped)
	if !strings.Contains(res.Header.Get("Cache-Control"), "immutable") || res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("bundle: %v", res.Header)
	}
	if res := get("/assets/Inter-abc.ttf", gzipped); res.Header.Get("Content-Encoding") != "" {
		t.Fatal("font was compressed")
	}
}
