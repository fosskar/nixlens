package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

type PoolDetail struct {
	Properties map[string]string `json:"properties"`
	Datasets   []Dataset         `json:"datasets"`
}

type Dataset struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	Used          uint64 `json:"used"`
	Available     uint64 `json:"available"`
	Referenced    uint64 `json:"referenced"`
	Quota         uint64 `json:"quota"`
	Reservation   uint64 `json:"reservation"`
	CompressRatio string `json:"compressRatio"`
	Mountpoint    string `json:"mountpoint"`
	Snapshots     int    `json:"snapshots"`
	SnapshotsUsed uint64 `json:"snapshotsUsed"`
	LastSnapshot  int64  `json:"lastSnapshot"`
}

// tab-separated, parseable (-Hp) zfs/zpool output as rows of fields
func zfsRows(args ...string) ([][]string, error) {
	out, err := exec.Command(args[0], args[1:]...).Output()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", strings.Join(args[:2], " "), err)
	}
	var rows [][]string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		rows = append(rows, strings.Split(sc.Text(), "\t"))
	}
	return rows, sc.Err()
}

func parseSize(s string) (uint64, error) {
	if s == "-" || s == "none" {
		return 0, nil
	}
	return strconv.ParseUint(s, 10, 64)
}

var errUnknownPool = errors.New("unknown pool")

// only names of imported pools reach zfs, so a request cannot pass options
func poolDetail(pool string) (PoolDetail, error) {
	pools, err := readZpools()
	if err != nil {
		return PoolDetail{}, err
	}
	for _, p := range pools {
		if p.Name == pool {
			return readPoolDetail(pool)
		}
	}
	return PoolDetail{}, errUnknownPool
}

func readPoolDetail(pool string) (PoolDetail, error) {
	d := PoolDetail{Properties: map[string]string{}}

	props, err := zfsRows("zpool", "get", "-Hp", "-o", "property,value", "ashift,autotrim,fragmentation,dedupratio", pool)
	if err != nil {
		return d, err
	}
	rootProps, err := zfsRows("zfs", "get", "-Hp", "-o", "property,value", "compression,encryption,recordsize,atime", pool)
	if err != nil {
		return d, err
	}
	for _, row := range append(props, rootProps...) {
		if len(row) == 2 {
			d.Properties[row[0]] = row[1]
		}
	}

	rows, err := zfsRows("zfs", "list", "-Hp", "-r", "-t", "filesystem,volume",
		"-o", "name,type,used,avail,refer,quota,reservation,compressratio,mountpoint", pool)
	if err != nil {
		return d, err
	}
	byName := map[string]*Dataset{}
	for _, f := range rows {
		if len(f) != 9 {
			return d, fmt.Errorf("zfs list: unexpected row %q", f)
		}
		ds := Dataset{Name: f[0], Type: f[1], CompressRatio: f[7], Mountpoint: f[8]}
		for i, dst := range []*uint64{&ds.Used, &ds.Available, &ds.Referenced, &ds.Quota, &ds.Reservation} {
			if *dst, err = parseSize(f[2+i]); err != nil {
				return d, fmt.Errorf("zfs list %s: %w", f[0], err)
			}
		}
		d.Datasets = append(d.Datasets, ds)
	}
	for i := range d.Datasets {
		byName[d.Datasets[i].Name] = &d.Datasets[i]
	}

	snaps, err := zfsRows("zfs", "list", "-Hp", "-r", "-t", "snapshot", "-o", "name,used,creation", pool)
	if err != nil {
		return d, err
	}
	for _, f := range snaps {
		if len(f) != 3 {
			return d, fmt.Errorf("zfs list snapshots: unexpected row %q", f)
		}
		ds, ok := byName[strings.SplitN(f[0], "@", 2)[0]]
		if !ok {
			continue
		}
		used, err := parseSize(f[1])
		if err != nil {
			return d, err
		}
		created, err := strconv.ParseInt(f[2], 10, 64)
		if err != nil {
			return d, err
		}
		ds.Snapshots++
		ds.SnapshotsUsed += used
		ds.LastSnapshot = max(ds.LastSnapshot, created)
	}
	sort.SliceStable(d.Datasets, func(i, j int) bool { return d.Datasets[i].Name < d.Datasets[j].Name })
	return d, nil
}
