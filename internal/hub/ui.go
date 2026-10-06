package hub

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

type asset struct {
	name string
	raw  []byte
	// nil where compression does not pay off, as for fonts and images
	gz   []byte
	etag string
}

var compressible = map[string]bool{".html": true, ".js": true, ".css": true, ".svg": true, ".json": true, ".webmanifest": true}

func readAsset(dist fs.FS, name string) (*asset, error) {
	raw, err := fs.ReadFile(dist, name)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	a := &asset{name: name, raw: raw, etag: base64.RawURLEncoding.EncodeToString(sum[:12])}
	if !compressible[path.Ext(name)] {
		return a, nil
	}
	if a.gz, err = gzipped(raw); err != nil {
		return nil, err
	}
	return a, nil
}

// nil where gzip would not make it smaller
func gzipped(raw []byte) ([]byte, error) {
	var b bytes.Buffer
	zw, err := gzip.NewWriterLevel(&b, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	if b.Len() >= len(raw) {
		return nil, nil
	}
	return b.Bytes(), nil
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.TrimSpace(name) == "gzip" && strings.ReplaceAll(params, " ", "") != "q=0" {
			return true
		}
	}
	return false
}

// UI serves the built single-page app; unknown paths get index.html, so
// addresses like /m/<machine> load the app. the build is embedded, so every
// file is read and compressed once, at start
func UI(dist fs.FS) (http.HandlerFunc, error) {
	assets := map[string]*asset{}
	err := fs.WalkDir(dist, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		a, err := readAsset(dist, name)
		if err != nil {
			return err
		}
		assets["/"+name] = a
		return nil
	})
	if err != nil {
		return nil, err
	}
	index, ok := assets["/index.html"]
	if !ok {
		return nil, errors.New("ui build has no index.html")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		a, ok := assets[r.URL.Path]
		if !ok {
			a = index
		}
		h := w.Header()
		// vite names bundles by content hash; everything else (index.html,
		// favicon) keeps its name across builds and must be revalidated
		if strings.HasPrefix(a.name, "assets/") {
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			h.Set("Cache-Control", "no-cache")
		}
		// the ui runs only its own bundle; images come from icon cdns,
		// app windows frame the apps, and nothing may frame nixlens itself
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		if ctype := mime.TypeByExtension(path.Ext(a.name)); ctype != "" {
			h.Set("Content-Type", ctype)
		}
		body, etag := a.raw, a.etag
		if a.gz != nil {
			h.Add("Vary", "Accept-Encoding")
			// ranges would address the compressed bytes; serve those plain
			if acceptsGzip(r) && r.Header.Get("Range") == "" {
				body, etag = a.gz, etag+"-gz"
				h.Set("Content-Encoding", "gzip")
			}
		}
		h.Set("ETag", `"`+etag+`"`)
		http.ServeContent(w, r, a.name, time.Time{}, bytes.NewReader(body))
	}, nil
}
