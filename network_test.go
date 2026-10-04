package main

import "testing"

func TestMaxLinkSpeed(t *testing.T) {
	for _, c := range []struct {
		out  string
		want int
	}{
		{"Settings for enp4s0:\n\tSupported ports: [ TP ]\n\tSupported link modes:   10baseT/Half 10baseT/Full\n\t                        100baseT/Half 100baseT/Full\n\t                        1000baseT/Full\n\t                        2500baseT/Full\n\tSupported pause frame use: Symmetric\n\tAdvertised link modes:  40000baseCR4/Full\n", 2500},
		{"\tSupported link modes:   1000baseT/Full\n\t                        10000baseT/Full\n\tSupported pause frame use: Symmetric Receive-only\n", 10000},
		{"Settings for eth1:\n\tSupported ports: [  ]\n\tSupported link modes:   Not reported\n\tSupported pause frame use: No\n", 0},
	} {
		if got := maxLinkSpeed(c.out); got != c.want {
			t.Errorf("maxLinkSpeed(%q) = %d, want %d", c.out, got, c.want)
		}
	}
}
