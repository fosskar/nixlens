package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type Disk struct {
	Name       string `json:"name"`
	ID         string `json:"id"`
	Size       uint64 `json:"size"`
	Model      string `json:"model"`
	Serial     string `json:"serial"`
	Transport  string `json:"transport"`
	Rotational bool   `json:"rotational"`
	Pool       string `json:"pool,omitempty"`
	Group      string `json:"group,omitempty"`
}

type lsblkOutput struct {
	Blockdevices []struct {
		Name   string `json:"name"`
		Type   string `json:"type"`
		Size   uint64 `json:"size"`
		Model  string `json:"model"`
		Serial string `json:"serial"`
		Tran   string `json:"tran"`
		Rota   bool   `json:"rota"`
	} `json:"blockdevices"`
}

func readDisks() ([]Disk, error) {
	out, err := exec.Command("lsblk", "--json", "--bytes", "--nodeps",
		"--output", "NAME,TYPE,SIZE,MODEL,SERIAL,TRAN,ROTA").Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}
	var parsed lsblkOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("parse lsblk: %w", err)
	}
	ids, err := diskIDs()
	if err != nil {
		return nil, err
	}

	disks := []Disk{}
	for _, d := range parsed.Blockdevices {
		if d.Type != "disk" || strings.HasPrefix(d.Name, "zram") {
			continue
		}
		disks = append(disks, Disk{
			Name:       d.Name,
			ID:         ids[d.Name],
			Size:       d.Size,
			Model:      strings.TrimSpace(d.Model),
			Serial:     d.Serial,
			Transport:  d.Tran,
			Rotational: d.Rota,
		})
	}
	return disks, nil
}

// maps kernel name (sda, nvme0n1) to its /dev/disk/by-id name, skipping the
// wwn-/eui. aliases in favour of the readable model_serial form
func diskIDs() (map[string]string, error) {
	entries, err := os.ReadDir("/dev/disk/by-id")
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	ids := map[string]string{}
	for _, n := range names {
		if strings.Contains(n, "-part") || strings.HasPrefix(n, "wwn-") || strings.Contains(n, "eui.") {
			continue
		}
		target, err := os.Readlink(filepath.Join("/dev/disk/by-id", n))
		if err != nil {
			return nil, err
		}
		dev := filepath.Base(target)
		if _, ok := ids[dev]; !ok {
			ids[dev] = n
		}
	}
	return ids, nil
}
