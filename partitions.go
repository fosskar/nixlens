package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
)

type Partition struct {
	Name   string `json:"name"`
	Size   uint64 `json:"size"`
	Fstype string `json:"fstype"`
	Label  string `json:"label"`
	Mount  string `json:"mount"`
	// pool or volume the partition belongs to, and its role there
	Pool string `json:"pool"`
	Role string `json:"role"`
}

// partitions of each whole disk, by disk kernel name
func readPartitions() (map[string][]Partition, error) {
	out, err := run("lsblk", "--json", "--bytes", "--output", "NAME,TYPE,SIZE,FSTYPE,LABEL,MOUNTPOINTS")
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Blockdevices []struct {
			Name     string `json:"name"`
			Type     string `json:"type"`
			Children []struct {
				Name        string   `json:"name"`
				Type        string   `json:"type"`
				Size        uint64   `json:"size"`
				Fstype      string   `json:"fstype"`
				Label       string   `json:"label"`
				Mountpoints []string `json:"mountpoints"`
			} `json:"children"`
		} `json:"blockdevices"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("parse lsblk: %w", err)
	}
	parts := map[string][]Partition{}
	for _, d := range parsed.Blockdevices {
		if d.Type != "disk" {
			continue
		}
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
			})
		}
	}
	return parts, nil
}

// kernel name of the block device a member path points at (sdd1, nvme0n1p2)
func memberBlock(path string) string {
	dev, err := filepath.EvalSymlinks(path)
	if err != nil {
		return ""
	}
	return filepath.Base(dev)
}
