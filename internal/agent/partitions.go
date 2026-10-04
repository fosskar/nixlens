package agent

import (
	"path/filepath"
	"strings"
)

type Partition struct {
	Name   string `json:"name"`
	Size   uint64 `json:"size"`
	Fstype string `json:"fstype"`
	Label  string `json:"label"`
	Mount  string `json:"mount"`
	// pool or volume the partition belongs to, and its role there; a
	// partition in no pool can still have a role, like "zfs reserved"
	Pool string `json:"pool"`
	Role string `json:"role"`
}

// gpt type of the 8 MiB partition zfs adds behind a whole-disk member, as
// slack for a slightly smaller replacement disk
const zfsReservedType = "6a945a3b-1dd2-11b2-99a6-080020736631"

// partitions of each whole disk, by disk kernel name
func readPartitions(devs []blockDevice) map[string][]Partition {
	parts := map[string][]Partition{}
	for _, d := range devs {
		for _, c := range d.Children {
			if c.Type != "part" {
				continue
			}
			parts[d.Name] = append(parts[d.Name], Partition{
				Name:   c.Name,
				Size:   c.Size,
				Fstype: c.Fstype,
				Label:  c.Label,
				Mount:  mainMount(c.Mountpoints),
				Role:   partitionRole(c.Parttype),
			})
		}
		// a filesystem or array member on the whole disk, without a
		// partition table, is listed as the disk's only entry
		if len(parts[d.Name]) == 0 && d.Fstype != "" {
			parts[d.Name] = []Partition{{
				Name:   d.Name,
				Size:   d.Size,
				Fstype: d.Fstype,
				Label:  d.Label,
				Mount:  mainMount(d.Mountpoints),
			}}
		}
	}
	return parts
}

func partitionRole(parttype string) string {
	if strings.EqualFold(parttype, zfsReservedType) {
		return "zfs reserved"
	}
	return ""
}

// kernel name of the block device a member path points at (sdd1, nvme0n1p2)
func memberBlock(path string) string {
	dev, err := filepath.EvalSymlinks(path)
	if err != nil {
		return ""
	}
	return filepath.Base(dev)
}
