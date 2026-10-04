package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	frameCacheTTL = 10 * time.Minute
	frameCacheMax = 1000
)

type frameResult struct {
	frameable bool
	at        time.Time
}

// decides whether a browser will render an app inside an iframe on the hub's
// origin, from the X-Frame-Options and CSP frame-ancestors headers of the
// app's own responses
type frameChecker struct {
	client *http.Client
	mu     sync.Mutex
	cache  map[string]frameResult
}

func newFrameChecker() *frameChecker {
	return &frameChecker{
		client: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		cache: map[string]frameResult{},
	}
}

func requestOrigin(r *http.Request) string {
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		scheme = "http"
		if r.TLS != nil {
			scheme = "https"
		}
	}
	return scheme + "://" + r.Host
}

func (c *frameChecker) check(ctx context.Context, appURL, origin string) bool {
	key := appURL + " " + origin
	c.mu.Lock()
	cached, ok := c.cache[key]
	c.mu.Unlock()
	if ok && time.Since(cached.at) < frameCacheTTL {
		return cached.frameable
	}

	if u, err := url.Parse(appURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	frameable, err := c.probe(ctx, appURL, origin)
	if err != nil {
		// the hub may not reach an app the browser can (e.g. a .lan host),
		// so an unknown result lets the browser try
		log.Printf("frame check %s: %v", appURL, err)
		frameable = true
	}
	c.mu.Lock()
	// the origin comes from request headers, so keys are not fully under
	// our control; expired entries go and the cache stays bounded
	if len(c.cache) >= frameCacheMax {
		for k, v := range c.cache {
			if time.Since(v.at) >= frameCacheTTL {
				delete(c.cache, k)
			}
		}
	}
	if len(c.cache) < frameCacheMax {
		c.cache[key] = frameResult{frameable: frameable, at: time.Now()}
	}
	c.mu.Unlock()
	return frameable
}

// follows redirects while they stay on the app's host. a redirect to another
// host (an sso portal) ends the walk: the app's last own response decides,
// since the browser arrives there with a session and skips the portal
func (c *frameChecker) probe(ctx context.Context, appURL, origin string) (bool, error) {
	start, err := url.Parse(appURL)
	if err != nil {
		return false, err
	}
	next := start
	for range 10 {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, next.String(), nil)
		if err != nil {
			return false, err
		}
		res, err := c.client.Do(req)
		if err != nil {
			return false, err
		}
		res.Body.Close()
		if !allowsFraming(res.Header, origin) {
			return false, nil
		}
		loc, err := res.Location()
		if errors.Is(err, http.ErrNoLocation) || res.StatusCode < 300 || res.StatusCode >= 400 {
			return true, nil
		}
		if err != nil {
			return false, err
		}
		if loc.Host != start.Host {
			return true, nil
		}
		next = loc
	}
	return false, errors.New("too many redirects")
}

// csp frame-ancestors takes precedence over X-Frame-Options when present
func allowsFraming(h http.Header, origin string) bool {
	for _, policy := range h.Values("Content-Security-Policy") {
		for _, directive := range strings.Split(policy, ";") {
			fields := strings.Fields(directive)
			if len(fields) == 0 || !strings.EqualFold(fields[0], "frame-ancestors") {
				continue
			}
			for _, src := range fields[1:] {
				if sourceMatches(src, origin) {
					return true
				}
			}
			return false
		}
	}
	xfo := strings.ToLower(strings.TrimSpace(h.Get("X-Frame-Options")))
	return xfo == "" || xfo == "allowall"
}

func sourceMatches(src, origin string) bool {
	if src == "*" {
		return true
	}
	o, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if src == o.Scheme+":" {
		return true
	}
	s, err := url.Parse(src)
	if err != nil || s.Host == "" {
		return false
	}
	if s.Scheme != "" && s.Scheme != o.Scheme {
		return false
	}
	if host, ok := strings.CutPrefix(s.Host, "*."); ok {
		return strings.HasSuffix(o.Host, "."+host)
	}
	return s.Host == o.Host
}
