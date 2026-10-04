package main

import (
	"fmt"
	"slices"
	"sort"
	"syscall"
)

// containers whose contents are reported elsewhere (zfs and md pools,
// swap) or by their child devices (luks, lvm)
var skipFstypes = []string{"", "zfs_member", "linux_raid_member", "swap", "crypto_LUKS", "LVM2_member"}

type volume struct {
	pool  Pool
	mount string
	disks []string
	parts []string
}

// reads plain filesystems (btrfs, ext4, xfs, vfat, ...) as volumes, one per
// filesystem uuid so multi-device btrfs groups its disks
func readVolumes(devs []blockDevice) ([]Pool, error) {
	byID := map[string]*volume{}
	var order []string
	var walk func(n blockDevice, disk string)
	walk = func(n blockDevice, disk string) {
		if !slices.Contains(skipFstypes, n.Fstype) {
			id := n.UUID
			if id == "" {
				id = n.Name
			}
			v, ok := byID[id]
			if !ok {
				v = &volume{pool: Pool{Name: n.Label, Kind: n.Fstype, State: "unmounted"}}
				byID[id] = v
				order = append(order, id)
			}
			if m := mainMount(n.Mountpoints); m != "" && v.mount == "" {
				v.mount = m
				v.pool.State = "mounted"
			}
			v.disks = append(v.disks, disk)
			v.parts = append(v.parts, n.Name)
		}
		for _, c := range n.Children {
			walk(c, disk)
		}
	}
	for _, d := range devs {
		walk(d, d.Name)
	}

	pools := []Pool{}
	for _, id := range order {
		v := byID[id]
		p := v.pool
		if p.Name == "" {
			p.Name = v.mount
		}
		if p.Name == "" {
			p.Name = "/dev/" + v.parts[0]
		}
		p.Mount = v.mount
		if v.mount != "" {
			var st syscall.Statfs_t
			if err := syscall.Statfs(v.mount, &st); err != nil {
				return nil, fmt.Errorf("statfs %s: %w", v.mount, err)
			}
			bsize := uint64(st.Bsize)
			p.Raw = st.Blocks * bsize
			p.Used = (st.Blocks - st.Bfree) * bsize
			p.Available = st.Bavail * bsize
			p.Usable = p.Used + p.Available
		}
		layout := "single"
		if len(v.disks) > 1 {
			layout = p.Kind
		}
		memberState := "ONLINE"
		if v.mount == "" {
			memberState = p.State
		}
		g := Group{Name: p.Name, Layout: layout, Class: "data", State: p.State, Members: []Member{}}
		for i, disk := range v.disks {
			g.Members = append(g.Members, Member{Device: disk, Path: "/dev/" + v.parts[i], State: memberState})
		}
		p.Groups = []Group{g}
		pools = append(pools, p)
	}
	// mounted volumes first, then by name
	sort.SliceStable(pools, func(i, j int) bool {
		if (pools[i].State == "mounted") != (pools[j].State == "mounted") {
			return pools[i].State == "mounted"
		}
		return pools[i].Name < pools[j].Name
	})
	return pools, nil
}

// a filesystem bind-mounted in several places reports all of them; / or the
// shortest path names it best
func mainMount(mounts []string) string {
	best := ""
	for _, m := range mounts {
		if m == "" {
			continue
		}
		if m == "/" {
			return m
		}
		if best == "" || len(m) < len(best) {
			best = m
		}
	}
	return best
}
