package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// sums the sizes of all populated dimms from the smbios memory device table
// (type 17). /proc/meminfo's MemTotal excludes firmware and kernel
// reservations, so it reads a few GiB short of what is installed. the raw
// table is root-only, hence a separate privileged step writes the result
func installedMemory() (uint64, error) {
	entries, err := filepath.Glob("/sys/firmware/dmi/entries/17-*/raw")
	if err != nil {
		return 0, err
	}
	var total uint64
	for _, path := range entries {
		b, err := os.ReadFile(path)
		if err != nil {
			return 0, err
		}
		if len(b) < 0x0E {
			return 0, fmt.Errorf("%s: short entry", path)
		}
		size := binary.LittleEndian.Uint16(b[0x0C:])
		switch {
		case size == 0 || size == 0xFFFF:
			continue
		case size == 0x7FFF:
			if len(b) < 0x20 {
				return 0, fmt.Errorf("%s: missing extended size", path)
			}
			total += uint64(binary.LittleEndian.Uint32(b[0x1C:])) << 20
		case size&0x8000 != 0:
			total += uint64(size&0x7FFF) << 10
		default:
			total += uint64(size) << 20
		}
	}
	return total, nil
}

func writeInstalledMemory(path string) error {
	total, err := installedMemory()
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(strconv.FormatUint(total, 10)), 0o644); err != nil {
		return err
	}
	// the unit's UMask also applies to this privileged step
	return os.Chmod(path, 0o644)
}

func readInstalledMemory(path string) (uint64, error) {
	if path == "" {
		return 0, nil
	}
	s, err := readTrimmed(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(s, 10, 64)
}
