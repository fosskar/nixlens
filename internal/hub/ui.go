package hub

import (
	"io/fs"
	"net/http"
	"strings"
)

// UI serves the built single-page app; unknown paths get index.html, so
// addresses like /m/<machine> load the app
func UI(dist fs.FS) http.HandlerFunc {
	files := http.FileServerFS(dist)
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(dist, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
			r.URL.Path = "/"
		}
		// vite names bundles by content hash; everything else (index.html,
		// favicon) keeps its name across builds and must be revalidated
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		// the ui runs only its own bundle; images come from icon cdns,
		// app windows frame the apps, and nothing may frame nOS itself
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		files.ServeHTTP(w, r)
	}
}
