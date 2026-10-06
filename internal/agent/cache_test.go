package agent

import (
	"errors"
	"testing"
	"time"
)

func TestCachedBy(t *testing.T) {
	errMissing := errors.New("missing")
	reads := map[string]int{}
	c := &cachedBy[string]{
		ttl: time.Minute,
		read: func(key string) (string, error) {
			reads[key]++
			if key == "nope" {
				return "", errMissing
			}
			return "detail of " + key, nil
		},
		drop:    func(err error) bool { return errors.Is(err, errMissing) },
		entries: map[string]*cached[string]{},
	}
	for range 3 {
		if v, err := c.get("tank"); err != nil || v != "detail of tank" {
			t.Fatalf("tank: %q %v", v, err)
		}
		if _, err := c.get("nope"); !errors.Is(err, errMissing) {
			t.Fatalf("nope: %v", err)
		}
	}
	if reads["tank"] != 1 || reads["nope"] != 3 {
		t.Fatalf("reads %v", reads)
	}
	if len(c.entries) != 1 {
		t.Fatalf("entries kept for %d keys", len(c.entries))
	}
}
