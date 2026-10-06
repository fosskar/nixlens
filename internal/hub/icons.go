package hub

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
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
	cdn string
	// where fetched icons are kept across restarts; empty keeps them in memory only
	dir    string
	client *http.Client
	mu     sync.Mutex
	cache  map[string]iconEntry
}

func newIconCache(cdn, dir string) *iconCache {
	return &iconCache{cdn: cdn, dir: dir, client: &http.Client{Timeout: 5 * time.Second}, cache: map[string]iconEntry{}}
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
	case kind == "selfhst" && (ext == "svg" || ext == "png" || ext == "webp"):
		return c.cdn + "/gh/selfhst/icons/" + ext + "/" + name, true
	case kind == "mdi" && ext == "svg":
		return c.cdn + "/npm/@mdi/svg/svg/" + name, true
	}
	return "", false
}

func (c *iconCache) serve(w http.ResponseWriter, r *http.Request) {
	kind, name := r.PathValue("kind"), r.PathValue("name")
	// a name without extension takes the svg where the set has one and its
	// png otherwise, as not every icon comes as svg
	names := []string{name}
	if path.Ext(name) == "" && (kind == "dashboard" || kind == "selfhst") {
		names = []string{name + ".svg", name + ".png"}
	}
	var failed bool
	for _, name := range names {
		url, ok := c.upstream(kind, name)
		if !ok {
			http.NotFound(w, r)
			return
		}
		icon, err := c.get(r.Context(), kind+"/"+name, url)
		if err != nil {
			log.Printf("icon %s: %v", url, err)
			failed = true
			continue
		}
		if icon.found {
			c.write(w, name, icon.body)
			return
		}
	}
	if failed {
		http.Error(w, "icon unavailable", http.StatusBadGateway)
		return
	}
	http.NotFound(w, r)
}

func (c *iconCache) write(w http.ResponseWriter, name string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	h.Set("Cache-Control", "public, max-age=86400")
	// an svg opened on its own would run as a page of the hub's origin
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	if _, err := w.Write(body); err != nil {
		log.Printf("icon %s: write response: %v", name, err)
	}
}

// key is <kind>/<name>, both checked by upstream, and names the icon's file
func (c *iconCache) get(ctx context.Context, key, url string) (iconEntry, error) {
	c.mu.Lock()
	cached, ok := c.cache[key]
	c.mu.Unlock()
	if !ok {
		cached, ok = c.load(key)
	}
	if ok && time.Since(cached.at) < iconTTL {
		c.remember(key, cached)
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
	c.remember(key, icon)
	if icon.found {
		c.save(key, icon.body)
	}
	return icon, nil
}

func (c *iconCache) remember(key string, icon iconEntry) {
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
		c.cache[key] = icon
	}
}

// a fetched icon also goes to disk, so a restart does not need the cdn;
// its modification time is when it was fetched
func (c *iconCache) load(key string) (iconEntry, bool) {
	if c.dir == "" {
		return iconEntry{}, false
	}
	file := filepath.Join(c.dir, key)
	body, err := os.ReadFile(file)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("icon cache: %v", err)
		}
		return iconEntry{}, false
	}
	info, err := os.Stat(file)
	if err != nil {
		log.Printf("icon cache: %v", err)
		return iconEntry{}, false
	}
	return iconEntry{body: body, found: true, at: info.ModTime()}, true
}

func (c *iconCache) save(key string, body []byte) {
	if c.dir == "" {
		return
	}
	dir := filepath.Join(c.dir, path.Dir(key))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Printf("icon cache: %v", err)
		return
	}
	// names come from requests; the disk stays as bounded as the memory
	if entries, err := os.ReadDir(dir); err != nil || len(entries) >= iconMax {
		if err != nil {
			log.Printf("icon cache: %v", err)
		}
		return
	}
	tmp, err := os.CreateTemp(dir, ".icon-*")
	if err != nil {
		log.Printf("icon cache: %v", err)
		return
	}
	_, err = tmp.Write(body)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), filepath.Join(c.dir, key))
	}
	if err != nil {
		log.Printf("icon cache: %v", err)
		if removeErr := os.Remove(tmp.Name()); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			log.Printf("icon cache: %v", removeErr)
		}
	}
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
