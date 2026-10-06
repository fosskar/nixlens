package agent

import (
	"sync"
	"time"
)

// cached shares one result between requests for a while. requests that
// arrive during a collection wait for it instead of starting their own, so
// several viewers polling every machine run each tool once at a time
type cached[T any] struct {
	ttl  time.Duration
	read func() (T, error)

	mu    sync.Mutex
	at    time.Time
	value T
	err   error
}

func (c *cached[T]) get() (T, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < c.ttl {
		return c.value, c.err
	}
	c.value, c.err = c.read()
	c.at = time.Now()
	return c.value, c.err
}

// one cached value per key; read reports, through drop, results not worth
// keeping, so keys that name nothing do not pile up
type cachedBy[T any] struct {
	ttl  time.Duration
	read func(key string) (T, error)
	drop func(error) bool

	mu      sync.Mutex
	entries map[string]*cached[T]
}

func (c *cachedBy[T]) get(key string) (T, error) {
	c.mu.Lock()
	entry, ok := c.entries[key]
	if !ok {
		entry = &cached[T]{ttl: c.ttl, read: func() (T, error) { return c.read(key) }}
		c.entries[key] = entry
	}
	c.mu.Unlock()
	value, err := entry.get()
	if err != nil && c.drop(err) {
		c.mu.Lock()
		delete(c.entries, key)
		c.mu.Unlock()
	}
	return value, err
}
