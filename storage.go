package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Storage struct {
	Pools []Pool `json:"pools"`
	Disks []Disk `json:"disks"`
}

type Pool struct {
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	State     string  `json:"state"`
	Raw       uint64  `json:"raw"`
	Usable    uint64  `json:"usable"`
	Used      uint64  `json:"used"`
	Available uint64  `json:"available"`
	Mount     string  `json:"mount,omitempty"`
	Scan      *Scan   `json:"scan,omitempty"`
	Groups    []Group `json:"groups"`
}

type Scan struct {
	Function string `json:"function"`
	State    string `json:"state"`
	End      int64  `json:"end"`
	Errors   uint64 `json:"errors"`
}

// one redundancy group: a raidz/mirror vdev, a single-disk vdev, or an md array
type Group struct {
	Name    string   `json:"name"`
	Layout  string   `json:"layout"`
	Class   string   `json:"class"`
	State   string   `json:"state"`
	Members []Member `json:"members"`
}

type Member struct {
	Device string `json:"device"`
	Path   string `json:"path"`
	State  string `json:"state"`
	Errors uint64 `json:"errors"`
}

func readStorage() (Storage, error) {
	disks, err := readDisks()
	if err != nil {
		return Storage{}, err
	}
	pools, err := readZpools()
	if err != nil {
		return Storage{}, err
	}
	md, err := readMdArrays()
	if err != nil {
		return Storage{}, err
	}
	pools = append(pools, md...)
	volumes, err := readVolumes()
	if err != nil {
		return Storage{}, err
	}
	pools = append(pools, volumes...)

	byName := map[string]*Disk{}
	for i := range disks {
		byName[disks[i].Name] = &disks[i]
	}
	for _, p := range pools {
		for _, g := range p.Groups {
			for _, m := range g.Members {
				if d, ok := byName[m.Device]; ok && d.Pool == "" {
					d.Pool, d.Group = p.Name, g.Name
				}
			}
		}
	}
	return Storage{Pools: pools, Disks: disks}, nil
}

// resolves a member path (/dev/disk/by-id/...-part1, /dev/sda1) to the
// kernel name of the whole disk (sda)
func wholeDisk(path string) (string, error) {
	dev, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	name := filepath.Base(dev)
	sys, err := filepath.EvalSymlinks(filepath.Join("/sys/class/block", name))
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(sys, "partition")); err == nil {
		return filepath.Base(filepath.Dir(sys)), nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	return name, nil
}

type zVdev struct {
	Name           string           `json:"name"`
	VdevType       string           `json:"vdev_type"`
	State          string           `json:"state"`
	Path           string           `json:"path"`
	TotalSpace     uint64           `json:"total_space"`
	ReadErrors     uint64           `json:"read_errors"`
	WriteErrors    uint64           `json:"write_errors"`
	ChecksumErrors uint64           `json:"checksum_errors"`
	Vdevs          map[string]zVdev `json:"vdevs"`
}

type zPool struct {
	Name      string `json:"name"`
	State     string `json:"state"`
	ScanStats *struct {
		Function string `json:"function"`
		State    string `json:"state"`
		EndTime  int64  `json:"end_time"`
		Errors   uint64 `json:"errors"`
	} `json:"scan_stats"`
	Vdevs   map[string]zVdev `json:"vdevs"`
	Logs    map[string]zVdev `json:"logs"`
	L2cache map[string]zVdev `json:"l2cache"`
	Spares  map[string]zVdev `json:"spares"`
	Special map[string]zVdev `json:"special"`
	Dedup   map[string]zVdev `json:"dedup"`
}

func readZpools() ([]Pool, error) {
	if _, err := exec.LookPath("zpool"); err != nil {
		return nil, nil
	}
	out, err := exec.Command("zpool", "status", "-j", "--json-int", "-P").Output()
	if err != nil {
		return nil, fmt.Errorf("zpool status: %w", err)
	}
	var status struct {
		Pools map[string]zPool `json:"pools"`
	}
	if err := json.Unmarshal(out, &status); err != nil {
		return nil, fmt.Errorf("parse zpool status: %w", err)
	}
	space, err := readZfsSpace()
	if err != nil {
		return nil, err
	}

	pools := []Pool{}
	for _, zp := range status.Pools {
		p := Pool{Name: zp.Name, Kind: "zfs", State: zp.State, Groups: []Group{}}
		if s, ok := space[zp.Name]; ok {
			p.Used, p.Available = s[0], s[1]
			p.Usable = s[0] + s[1]
		}
		if zp.ScanStats != nil {
			p.Scan = &Scan{
				Function: zp.ScanStats.Function,
				State:    zp.ScanStats.State,
				End:      zp.ScanStats.EndTime,
				Errors:   zp.ScanStats.Errors,
			}
		}
		root := zp.Vdevs[zp.Name]
		p.Raw = root.TotalSpace
		classes := []struct {
			class string
			vdevs map[string]zVdev
		}{
			{"data", root.Vdevs},
			{"special", zp.Special},
			{"dedup", zp.Dedup},
			{"log", zp.Logs},
			{"cache", zp.L2cache},
			{"spare", zp.Spares},
		}
		for _, c := range classes {
			groups, err := zfsGroups(c.class, c.vdevs)
			if err != nil {
				return nil, fmt.Errorf("pool %s: %w", zp.Name, err)
			}
			p.Groups = append(p.Groups, groups...)
		}
		pools = append(pools, p)
	}
	sort.Slice(pools, func(i, j int) bool { return pools[i].Name < pools[j].Name })
	return pools, nil
}

func zfsGroups(class string, vdevs map[string]zVdev) ([]Group, error) {
	groups := []Group{}
	for _, v := range vdevs {
		g := Group{Name: v.Name, Class: class, State: v.State, Members: []Member{}}
		leaves := []zVdev{v}
		if v.VdevType == "disk" || v.VdevType == "file" {
			g.Name = filepath.Base(v.Name)
			g.Layout = "single"
		} else {
			// raidz2-0 -> raidz2, mirror-1 -> mirror
			g.Layout = v.Name[:max(strings.LastIndex(v.Name, "-"), 0)]
			if g.Layout == "" {
				g.Layout = v.VdevType
			}
			leaves = leaves[:0]
			for _, leaf := range v.Vdevs {
				leaves = append(leaves, leaf)
			}
		}
		for _, leaf := range leaves {
			m := Member{
				Path:   leaf.Path,
				State:  leaf.State,
				Errors: leaf.ReadErrors + leaf.WriteErrors + leaf.ChecksumErrors,
			}
			if leaf.Path != "" {
				dev, err := wholeDisk(leaf.Path)
				// a missing device is what a degraded pool reports; keep the member
				if err != nil && !errors.Is(err, fs.ErrNotExist) {
					return nil, err
				}
				m.Device = dev
			}
			g.Members = append(g.Members, m)
		}
		sort.Slice(g.Members, func(i, j int) bool { return g.Members[i].Path < g.Members[j].Path })
		groups = append(groups, g)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Name < groups[j].Name })
	return groups, nil
}

// used and available bytes of each pool's root dataset; unlike zpool's raw
// size these account for parity and reservations
func readZfsSpace() (map[string][2]uint64, error) {
	out, err := exec.Command("zfs", "list", "-H", "-p", "-d", "0", "-o", "name,used,avail").Output()
	if err != nil {
		return nil, fmt.Errorf("zfs list: %w", err)
	}
	space := map[string][2]uint64{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		if len(f) != 3 {
			return nil, fmt.Errorf("zfs list: unexpected line %q", sc.Text())
		}
		used, err := strconv.ParseUint(f[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("zfs list: %w", err)
		}
		avail, err := strconv.ParseUint(f[2], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("zfs list: %w", err)
		}
		space[f[0]] = [2]uint64{used, avail}
	}
	return space, sc.Err()
}

func readMdArrays() ([]Pool, error) {
	arrays, err := filepath.Glob("/sys/block/md*/md")
	if err != nil {
		return nil, err
	}
	pools := []Pool{}
	for _, mdDir := range arrays {
		blockDir := filepath.Dir(mdDir)
		name := filepath.Base(blockDir)
		level, err := readTrimmed(filepath.Join(mdDir, "level"))
		if err != nil {
			return nil, err
		}
		state, err := readTrimmed(filepath.Join(mdDir, "array_state"))
		if err != nil {
			return nil, err
		}
		degraded, err := readTrimmed(filepath.Join(mdDir, "degraded"))
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
		if degraded != "" && degraded != "0" {
			state = "degraded"
		}
		sectors, err := readTrimmed(filepath.Join(blockDir, "size"))
		if err != nil {
			return nil, err
		}
		size, err := strconv.ParseUint(sectors, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%s size: %w", name, err)
		}

		g := Group{Name: name, Layout: level, Class: "data", State: state, Members: []Member{}}
		devs, err := filepath.Glob(filepath.Join(mdDir, "dev-*"))
		if err != nil {
			return nil, err
		}
		for _, d := range devs {
			memberState, err := readTrimmed(filepath.Join(d, "state"))
			if err != nil {
				return nil, err
			}
			errs, err := readTrimmed(filepath.Join(d, "errors"))
			if err != nil {
				return nil, err
			}
			n, err := strconv.ParseUint(errs, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("%s errors: %w", d, err)
			}
			part := strings.TrimPrefix(filepath.Base(d), "dev-")
			dev, err := wholeDisk(filepath.Join("/dev", part))
			if err != nil {
				return nil, err
			}
			g.Members = append(g.Members, Member{Device: dev, Path: "/dev/" + part, State: memberState, Errors: n})
		}
		pools = append(pools, Pool{
			Name:   name,
			Kind:   "md",
			State:  state,
			Raw:    size * 512,
			Usable: size * 512,
			Groups: []Group{g},
		})
	}
	return pools, nil
}
