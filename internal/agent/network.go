package agent

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/fosskar/nos/internal/command"
)

type Interface struct {
	Name string `json:"name"`
	// ethernet, wifi or usb for hardware; bridge, bond, vlan, wireguard,
	// tun, tap or virtual otherwise
	Kind      string `json:"kind"`
	Up        bool   `json:"up"`
	State     string `json:"state"`
	SpeedMbps int    `json:"speedMbps,omitempty"`
	// the fastest link mode the port supports, also without a link
	MaxSpeedMbps int      `json:"maxSpeedMbps,omitempty"`
	MAC          string   `json:"mac,omitempty"`
	MTU          int      `json:"mtu"`
	Driver       string   `json:"driver,omitempty"`
	Master       string   `json:"master,omitempty"`
	Addresses    []string `json:"addresses"`
}

const sysNet = "/sys/class/net"

// iff_tap in tun_flags marks a tap device
const iffTap = 0x0002

func readNetwork() ([]Interface, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list interfaces: %w", err)
	}
	out := []Interface{}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		i, err := readInterface(iface)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Name < out[b].Name })
	return out, nil
}

func readInterface(iface net.Interface) (Interface, error) {
	dir := filepath.Join(sysNet, iface.Name)
	i := Interface{
		Name:      iface.Name,
		Kind:      interfaceKind(dir),
		Up:        iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagRunning != 0,
		MTU:       iface.MTU,
		MAC:       iface.HardwareAddr.String(),
		Addresses: []string{},
	}
	state, err := readTrimmed(filepath.Join(dir, "operstate"))
	if err != nil {
		return i, fmt.Errorf("%s: %w", iface.Name, err)
	}
	i.State = state
	// speed is unreadable (EINVAL) or -1 without a link, and made up for
	// virtual devices
	hardware := i.Kind == "ethernet" || i.Kind == "wifi" || i.Kind == "usb" || i.Kind == "bond"
	if speed, err := readTrimmed(filepath.Join(dir, "speed")); err == nil {
		if n, err := strconv.Atoi(speed); err == nil && n > 0 && hardware {
			i.SpeedMbps = n
		}
	}
	if i.Kind == "ethernet" {
		out, err := command.Run("ethtool", iface.Name)
		if err != nil {
			return i, err
		}
		i.MaxSpeedMbps = maxLinkSpeed(string(out))
	}
	if driver, err := os.Readlink(filepath.Join(dir, "device", "driver")); err == nil {
		i.Driver = filepath.Base(driver)
	}
	if master, err := os.Readlink(filepath.Join(dir, "master")); err == nil {
		i.Master = filepath.Base(master)
	}
	addrs, err := iface.Addrs()
	if err != nil {
		return i, fmt.Errorf("%s addresses: %w", iface.Name, err)
	}
	for _, a := range addrs {
		i.Addresses = append(i.Addresses, a.String())
	}
	return i, nil
}

func interfaceKind(dir string) string {
	exists := func(name string) bool {
		_, err := os.Stat(filepath.Join(dir, name))
		return err == nil
	}
	if flags, err := readTrimmed(filepath.Join(dir, "tun_flags")); err == nil {
		n, _ := strconv.ParseInt(strings.TrimPrefix(flags, "0x"), 16, 64)
		if n&iffTap != 0 {
			return "tap"
		}
		return "tun"
	}
	devtype := ""
	if uevent, err := os.ReadFile(filepath.Join(dir, "uevent")); err == nil {
		for line := range strings.SplitSeq(string(uevent), "\n") {
			if v, ok := strings.CutPrefix(line, "DEVTYPE="); ok {
				devtype = v
			}
		}
	}
	switch {
	case devtype == "wlan" || exists("wireless"):
		return "wifi"
	case devtype != "":
		return devtype
	case exists("bridge"):
		return "bridge"
	case exists("bonding"):
		return "bond"
	}
	device, err := filepath.EvalSymlinks(filepath.Join(dir, "device"))
	if errors.Is(err, os.ErrNotExist) {
		return "virtual"
	}
	if strings.Contains(device, "/usb") {
		return "usb"
	}
	return "ethernet"
}

// the highest speed among ethtool's "Supported link modes", which are
// listed like "1000baseT/Full 10000baseT/Full" over several lines
func maxLinkSpeed(ethtool string) int {
	fastest := 0
	inModes := false
	for line := range strings.SplitSeq(ethtool, "\n") {
		text := strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(text, "Supported link modes:"); ok {
			inModes = true
			text = rest
		} else if inModes && strings.Contains(text, ":") {
			break
		}
		if !inModes {
			continue
		}
		for _, mode := range strings.Fields(text) {
			digits := strings.IndexFunc(mode, func(r rune) bool { return r < '0' || r > '9' })
			if digits <= 0 {
				continue
			}
			if n, err := strconv.Atoi(mode[:digits]); err == nil && n > fastest {
				fastest = n
			}
		}
	}
	return fastest
}
