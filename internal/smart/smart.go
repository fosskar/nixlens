// Package smart collects smart data of disks and reads it back.
package smart

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	Smartctl struct {
		ExitStatus int `json:"exit_status"`
		Messages   []struct {
			String string `json:"string"`
		} `json:"messages"`
	} `json:"smartctl"`
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

// bit 1 of smartctl's exit status: the device could not be opened, or with
// -n standby, it was asleep and not queried
const smartctlOpenFailed = 1 << 1

// parses `smartctl -a --json` output. ok is false when the device reports
// no smart data at all (virtual disks); standby means smartctl did not query
// a sleeping drive because of -n standby. a drive smartctl could not open
// is an error, not a drive without smart data
func parseSmartctl(out []byte) (s Smart, standby, ok bool, err error) {
	var o smartctlOutput
	if err := json.Unmarshal(out, &o); err != nil {
		return s, false, false, err
	}
	standby = o.PowerMode.Name == "STANDBY" || o.PowerMode.Name == "SLEEP"
	if o.Smartctl.ExitStatus&smartctlOpenFailed != 0 && !standby {
		msgs := make([]string, len(o.Smartctl.Messages))
		for i, m := range o.Smartctl.Messages {
			msgs[i] = m.String
		}
		return s, false, false, fmt.Errorf("device open failed: %s", strings.Join(msgs, "; "))
	}
	if o.SerialNumber == "" {
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

func ReadFile(path string) (map[string]Smart, error) {
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

// Device is a disk to query, with the key its data is stored under
type Device struct {
	Name string
	Key  string
}

// runs as a separate privileged oneshot; the agent only reads the result.
// -n standby keeps sleeping drives asleep, which keep their last values
func Collect(path string, disks []Device) error {
	previous, err := ReadFile(path)
	if err != nil {
		return err
	}
	result := map[string]Smart{}
	// one failing drive keeps its last values and fails the run at the end,
	// so the other drives still get updated
	var errs []error
	for _, d := range disks {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		out, runErr := exec.CommandContext(ctx, "smartctl", "-a", "--json=c", "-n", "standby", "/dev/"+d.Name).Output()
		cancel()
		// smartctl's exit status is a bit mask that is also set for drives
		// with logged errors, so the json decides, not the status
		var exitErr *exec.ExitError
		key := d.Key
		if runErr != nil && !errors.As(runErr, &exitErr) {
			errs = append(errs, fmt.Errorf("smartctl %s: %w", d.Name, runErr))
			keep(result, previous, key)
			continue
		}
		s, standby, ok, err := parseSmartctl(out)
		if err != nil {
			errs = append(errs, fmt.Errorf("smartctl %s: %w", d.Name, err))
			keep(result, previous, key)
			continue
		}
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
	// removes the temporary file if anything below fails; a no-op after the
	// rename
	defer os.Remove(tmp.Name())
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
	if err := os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	return errors.Join(errs...)
}

func keep(result, previous map[string]Smart, key string) {
	if prev, ok := previous[key]; ok {
		result[key] = prev
	}
}
