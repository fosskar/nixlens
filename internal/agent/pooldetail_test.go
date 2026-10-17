package agent

import (
	"errors"
	"testing"
	"time"
)

// unknown names are checked against the shared storage reading, so they
// run neither zpool nor zfs, and only zfs pool names count
func TestPoolDetailUnknownName(t *testing.T) {
	reads := 0
	storage := &cached[Storage]{ttl: time.Minute, read: func() (Storage, error) {
		reads++
		return Storage{Pools: []Pool{{Name: "md0", Kind: "md"}, {Name: "data", Kind: "btrfs"}}}, nil
	}}
	pools := &cachedBy[PoolDetail]{
		ttl:     time.Minute,
		read:    func(name string) (PoolDetail, error) { return poolDetail(storage.get, name) },
		drop:    func(err error) bool { return errors.Is(err, errUnknownPool) },
		entries: map[string]*cached[PoolDetail]{},
	}
	for _, name := range []string{"nope", "nope", "md0", "data", "-o"} {
		if _, err := pools.get(name); !errors.Is(err, errUnknownPool) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if reads != 1 {
		t.Fatalf("storage read %d times", reads)
	}
}
