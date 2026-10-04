package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type Smart struct {
	Passed          *bool  `json:"passed"`
	Temperature     int    `json:"temperature"`
	PowerOnHours    uint64 `json:"powerOnHours"`
	Reallocated     uint64 `json:"reallocated"`
	Pending         uint64 `json:"pending"`
	Uncorrectable   uint64 `json:"uncorrectable"`
	CriticalWarning uint64 `json:"criticalWarning"`
	PercentageUsed  uint64 `json:"percentageUsed"`
	MediaErrors     uint64 `json:"mediaErrors"`
	Standby         bool   `json:"standby"`
	Updated         int64  `json:"updated"`
}

type smartctlOutput struct {
	SerialNumber string `json:"serial_number"`
	SmartStatus  *struct {
		Passed bool `json:"passed"`
	} `json:"smart_status"`
	Temperature struct {
		Current int `json:"current"`
	} `json:"temperature"`
	PowerOnTime struct {
		Hours uint64 `json:"hours"`
	} `json:"power_on_time"`
	PowerMode struct {
		Name string `json:"name"`
	} `json:"power_mode"`
	AtaSmartAttributes struct {
		Table []struct {
			ID  int `json:"id"`
			Raw struct {
				Value uint64 `json:"value"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
	NvmeLog *struct {
		CriticalWarning uint64 `json:"critical_warning"`
		PercentageUsed  uint64 `json:"percentage_used"`
		MediaErrors     uint64 `json:"media_errors"`
	} `json:"nvme_smart_health_information_log"`
}

// parses `smartctl -a --json` output. ok is false when the device reports
// no smart data at all (virtual disks); standby means smartctl did not query
// a sleeping drive because of -n standby
func parseSmartctl(out []byte) (s Smart, standby, ok bool, err error) {
	var o smartctlOutput
	if err := json.Unmarshal(out, &o); err != nil {
		return s, false, false, err
	}
	if o.SerialNumber == "" {
		standby = o.PowerMode.Name == "STANDBY" || o.PowerMode.Name == "SLEEP"
		return s, standby, false, nil
	}
	if o.SmartStatus != nil {
		passed := o.SmartStatus.Passed
		s.Passed = &passed
	}
	s.Temperature = o.Temperature.Current
	s.PowerOnHours = o.PowerOnTime.Hours
	for _, a := range o.AtaSmartAttributes.Table {
		switch a.ID {
		case 5:
			s.Reallocated = a.Raw.Value
		case 197:
			s.Pending = a.Raw.Value
		case 198:
			s.Uncorrectable = a.Raw.Value
		}
	}
	if o.NvmeLog != nil {
		s.CriticalWarning = o.NvmeLog.CriticalWarning
		s.PercentageUsed = o.NvmeLog.PercentageUsed
		s.MediaErrors = o.NvmeLog.MediaErrors
	}
	return s, false, true, nil
}

func readSmartFile(path string) (map[string]Smart, error) {
	data := map[string]Smart{}
	if path == "" {
		return data, nil
	}
	raw, err := os.ReadFile(path)
	// not collected yet, e.g. right after boot
	if errors.Is(err, fs.ErrNotExist) {
		return data, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return data, nil
}

func smartKey(d Disk) string {
	if d.ID != "" {
		return d.ID
	}
	return d.Name
}

// runs as a separate privileged oneshot; the agent only reads the result.
// -n standby keeps sleeping drives asleep, which keep their last values
func collectSmart(path string) error {
	devs, err := readBlockDevices()
	if err != nil {
		return err
	}
	disks, err := readDisks(devs)
	if err != nil {
		return err
	}
	previous, err := readSmartFile(path)
	if err != nil {
		return err
	}
	result := map[string]Smart{}
	for _, d := range disks {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		out, runErr := exec.CommandContext(ctx, "smartctl", "-a", "--json=c", "-n", "standby", "/dev/"+d.Name).Output()
		cancel()
		// smartctl's exit status is a bit mask that is also set for drives
		// with logged errors, so the json decides, not the status
		var exitErr *exec.ExitError
		if runErr != nil && !errors.As(runErr, &exitErr) {
			return fmt.Errorf("smartctl %s: %w", d.Name, runErr)
		}
		s, standby, ok, err := parseSmartctl(out)
		if err != nil {
			return fmt.Errorf("smartctl %s: %w", d.Name, err)
		}
		key := smartKey(d)
		switch {
		case standby:
			prev := previous[key]
			prev.Standby = true
			result[key] = prev
		case ok:
			s.Updated = time.Now().Unix()
			result[key] = s
		}
	}

	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".smart-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
