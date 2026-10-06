package hub

import (
	"context"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	iconTTL     = 24 * time.Hour
	iconMax     = 1000
	maxIconSize = 1 << 20
)

var iconName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type iconEntry struct {
	body  []byte
	found bool
	at    time.Time
}

// app icons from the icon sets on jsdelivr, fetched by the hub and kept, so
// browsers load them from the hub alone
type iconCache struct {
	cdn    string
	client *http.Client
	mu     sync.Mutex
	cache  map[string]iconEntry
}

func newIconCache(cdn string) *iconCache {
	return &iconCache{cdn: cdn, client: &http.Client{Timeout: 5 * time.Second}, cache: map[string]iconEntry{}}
}

// only these sets and plain names are fetched, so the hub cannot be made to
// request anything else
func (c *iconCache) upstream(kind, name string) (string, bool) {
	if !iconName.MatchString(name) {
		return "", false
	}
	ext := strings.TrimPrefix(path.Ext(name), ".")
	switch {
	case kind == "dashboard" && (ext == "svg" || ext == "png" || ext == "webp"):
		return c.cdn + "/gh/homarr-labs/dashboard-icons/" + ext + "/" + name, true
	case kind == "selfhst" && ext == "svg":
		return c.cdn + "/gh/selfhst/icons/svg/" + name, true
	case kind == "mdi" && ext == "svg":
		return c.cdn + "/npm/@mdi/svg/svg/" + name, true
	}
	return "", false
}

func (c *iconCache) serve(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	url, ok := c.upstream(r.PathValue("kind"), name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	icon, err := c.get(r.Context(), url)
	if err != nil {
		log.Printf("icon %s: %v", url, err)
		http.Error(w, "icon unavailable", http.StatusBadGateway)
		return
	}
	if !icon.found {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	h.Set("Cache-Control", "public, max-age=86400")
	// an svg opened on its own would run as a page of the hub's origin
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	if _, err := w.Write(icon.body); err != nil {
		log.Printf("icon %s: write response: %v", url, err)
	}
}

func (c *iconCache) get(ctx context.Context, url string) (iconEntry, error) {
	c.mu.Lock()
	cached, ok := c.cache[url]
	c.mu.Unlock()
	if ok && time.Since(cached.at) < iconTTL {
		return cached, nil
	}
	icon, err := c.fetch(ctx, url)
	if err != nil {
		if ok {
			// the last copy beats none while the cdn cannot be reached
			log.Printf("icon %s: %v; serving the copy from %s", url, err, cached.at.Format(time.DateTime))
			return cached, nil
		}
		return iconEntry{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cache) >= iconMax {
		for k, v := range c.cache {
			if time.Since(v.at) >= iconTTL {
				delete(c.cache, k)
			}
		}
	}
	if len(c.cache) < iconMax {
		c.cache[url] = icon
	}
	return icon, nil
}

func (c *iconCache) fetch(ctx context.Context, url string) (iconEntry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return iconEntry{}, err
	}
	res, err := c.client.Do(req)
	if err != nil {
		return iconEntry{}, err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return iconEntry{at: time.Now()}, nil
	default:
		return iconEntry{}, fmt.Errorf("status %s", res.Status)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxIconSize+1))
	if err != nil {
		return iconEntry{}, err
	}
	if len(body) > maxIconSize {
		return iconEntry{}, fmt.Errorf("larger than %d bytes", maxIconSize)
	}
	return iconEntry{body: body, found: true, at: time.Now()}, nil
}
