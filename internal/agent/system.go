package agent

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type System struct {
	Hostname     string     `json:"hostname"`
	NixosVersion string     `json:"nixosVersion"`
	Kernel       string     `json:"kernel"`
	UptimeSec    float64    `json:"uptimeSec"`
	Load         [3]float64 `json:"load"`
	CPUs         int        `json:"cpus"`
	Cores        int        `json:"cores"`
	CPUPercent   float64    `json:"cpuPercent"`
	MemInstalled uint64     `json:"memInstalled"`
	MemTotal     uint64     `json:"memTotal"`
	MemAvailable uint64     `json:"memAvailable"`
	Swaps        []Swap     `json:"swaps"`
}

type Swap struct {
	Device string `json:"device"`
	Kind   string `json:"kind"`
	Size   uint64 `json:"size"`
	Used   uint64 `json:"used"`
}

func readTrimmed(path string) (string, error) {
	b, err := os.ReadFile(path)
	return strings.TrimSpace(string(b)), err
}

func readSystem(cpu *cpuSampler, memInstalled uint64) (System, error) {
	s := System{MemInstalled: memInstalled}
	var err error
	if s.Hostname, err = os.Hostname(); err != nil {
		return s, err
	}
	if s.NixosVersion, err = readTrimmed("/run/current-system/nixos-version"); err != nil {
		return s, err
	}
	if s.Kernel, err = readTrimmed("/proc/sys/kernel/osrelease"); err != nil {
		return s, err
	}

	uptime, err := readTrimmed("/proc/uptime")
	if err != nil {
		return s, err
	}
	if _, err := fmt.Sscan(uptime, &s.UptimeSec); err != nil {
		return s, fmt.Errorf("parse /proc/uptime: %w", err)
	}

	load, err := readTrimmed("/proc/loadavg")
	if err != nil {
		return s, err
	}
	if _, err := fmt.Sscan(load, &s.Load[0], &s.Load[1], &s.Load[2]); err != nil {
		return s, fmt.Errorf("parse /proc/loadavg: %w", err)
	}

	mem, err := readMeminfo()
	if err != nil {
		return s, err
	}
	s.MemTotal = mem["MemTotal"]
	s.MemAvailable = mem["MemAvailable"]
	if s.Swaps, err = readSwaps(); err != nil {
		return s, err
	}
	if s.CPUs, s.CPUPercent, err = cpu.get(); err != nil {
		return s, err
	}
	if s.Cores, err = physicalCores(); err != nil {
		return s, err
	}
	return s, nil
}

// values in bytes; the kernel's "kB" unit is KiB
func readMeminfo() (map[string]uint64, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	mem := map[string]uint64{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse /proc/meminfo: %w", err)
		}
		if len(fields) == 3 && fields[2] == "kB" {
			v *= 1024
		}
		mem[strings.TrimSuffix(fields[0], ":")] = v
	}
	return mem, sc.Err()
}

// cpu usage is the delta between two /proc/stat samples. sampling on
// request instead of on a ticker keeps an unwatched agent idle; requests
// closer than minCPUInterval reuse the last value to avoid noisy deltas
const minCPUInterval = time.Second

type cpuSampler struct {
	mu      sync.Mutex
	idle    uint64
	total   uint64
	at      time.Time
	cpus    int
	percent float64
}

func newCPUSampler() *cpuSampler {
	return &cpuSampler{}
}

func (c *cpuSampler) get() (int, float64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < minCPUInterval {
		return c.cpus, c.percent, nil
	}
	idle, total, cpus, err := readProcStat()
	if err != nil {
		return 0, 0, err
	}
	if !c.at.IsZero() && total > c.total {
		c.percent = 100 * (1 - float64(idle-c.idle)/float64(total-c.total))
	}
	c.idle, c.total, c.at, c.cpus = idle, total, time.Now(), cpus
	return c.cpus, c.percent, nil
}

func readProcStat() (idle, total uint64, cpus int, err error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0, 0, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "cpu ") {
			for i, field := range strings.Fields(line)[1:] {
				v, err := strconv.ParseUint(field, 10, 64)
				if err != nil {
					return 0, 0, 0, fmt.Errorf("parse /proc/stat: %w", err)
				}
				total += v
				// idle and iowait
				if i == 3 || i == 4 {
					idle += v
				}
			}
		} else if strings.HasPrefix(line, "cpu") {
			cpus++
		}
	}
	return idle, total, cpus, sc.Err()
}

// threads sharing a core report the same package and core id
// the topology does not change at runtime
var physicalCores = sync.OnceValues(func() (int, error) {
	dirs, err := filepath.Glob("/sys/devices/system/cpu/cpu[0-9]*/topology")
	if err != nil {
		return 0, err
	}
	cores := map[[2]string]bool{}
	for _, d := range dirs {
		pkg, err := readTrimmed(filepath.Join(d, "physical_package_id"))
		if err != nil {
			return 0, err
		}
		core, err := readTrimmed(filepath.Join(d, "core_id"))
		if err != nil {
			return 0, err
		}
		cores[[2]string{pkg, core}] = true
	}
	return len(cores), nil
})

// /proc/swaps types are partition or file; zram devices report as partitions
func readSwaps() ([]Swap, error) {
	f, err := os.Open("/proc/swaps")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	swaps := []Swap{}
	sc := bufio.NewScanner(f)
	sc.Scan()
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 4 {
			return nil, fmt.Errorf("parse /proc/swaps: %q", sc.Text())
		}
		size, err := strconv.ParseUint(fields[2], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse /proc/swaps: %w", err)
		}
		used, err := strconv.ParseUint(fields[3], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse /proc/swaps: %w", err)
		}
		kind := fields[1]
		if strings.HasPrefix(fields[0], "/dev/zram") {
			kind = "zram"
		}
		swaps = append(swaps, Swap{Device: fields[0], Kind: kind, Size: size * 1024, Used: used * 1024})
	}
	return swaps, sc.Err()
}
