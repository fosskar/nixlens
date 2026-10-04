package main

import (
	"bufio"
	"fmt"
	"os"
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
	CPUPercent   float64    `json:"cpuPercent"`
	MemInstalled uint64     `json:"memInstalled"`
	MemTotal     uint64     `json:"memTotal"`
	MemAvailable uint64     `json:"memAvailable"`
	SwapTotal    uint64     `json:"swapTotal"`
	SwapFree     uint64     `json:"swapFree"`
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
	s.SwapTotal = mem["SwapTotal"]
	s.SwapFree = mem["SwapFree"]
	s.CPUs, s.CPUPercent = cpu.get()
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

// cpu usage needs two /proc/stat samples, so a goroutine keeps the latest delta
type cpuSampler struct {
	mu      sync.Mutex
	cpus    int
	percent float64
}

func newCPUSampler() *cpuSampler {
	c := &cpuSampler{}
	go c.run()
	return c
}

func (c *cpuSampler) get() (int, float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cpus, c.percent
}

func (c *cpuSampler) run() {
	prevIdle, prevTotal, _, err := readProcStat()
	if err != nil {
		panic(err)
	}
	for range time.Tick(2 * time.Second) {
		idle, total, cpus, err := readProcStat()
		if err != nil {
			panic(err)
		}
		c.mu.Lock()
		c.cpus = cpus
		if total > prevTotal {
			c.percent = 100 * (1 - float64(idle-prevIdle)/float64(total-prevTotal))
		}
		c.mu.Unlock()
		prevIdle, prevTotal = idle, total
	}
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
