package main

import (
	"os"
	"testing"
)

func TestParseSmartctl(t *testing.T) {
	cases := []struct {
		file    string
		ok      bool
		standby bool
		check   func(Smart) bool
	}{
		{"testdata/smart-sdd.json", true, false, func(s Smart) bool {
			return s.Passed != nil && *s.Passed && s.Temperature == 29 && s.PowerOnHours == 8183 && s.Reallocated == 0
		}},
		{"testdata/smart-sda.json", true, false, func(s Smart) bool {
			return s.Passed != nil && *s.Passed && s.Temperature == 30
		}},
		{"testdata/smart-nvme1n1.json", true, false, func(s Smart) bool {
			return s.Passed != nil && *s.Passed && s.Temperature == 37 && s.PercentageUsed == 0 && s.CriticalWarning == 0
		}},
		{"testdata/smart-standby.json", false, true, func(Smart) bool { return true }},
	}
	for _, c := range cases {
		out, err := os.ReadFile(c.file)
		if err != nil {
			t.Fatal(err)
		}
		s, standby, ok, err := parseSmartctl(out)
		if err != nil {
			t.Fatalf("%s: %v", c.file, err)
		}
		if ok != c.ok || standby != c.standby || !c.check(s) {
			t.Errorf("%s: ok=%t standby=%t %+v", c.file, ok, standby, s)
		}
	}
}

func FuzzParseSmartctl(f *testing.F) {
	for _, file := range []string{"testdata/smart-sdd.json", "testdata/smart-nvme1n1.json", "testdata/smart-standby.json"} {
		out, err := os.ReadFile(file)
		if err != nil {
			f.Fatal(err)
		}
		f.Add(out)
	}
	f.Fuzz(func(t *testing.T, out []byte) {
		_, _, _, _ = parseSmartctl(out)
	})
}
