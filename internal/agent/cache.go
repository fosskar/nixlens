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
