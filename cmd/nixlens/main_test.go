package main

import (
	"slices"
	"testing"
)

func TestTrustedHubs(t *testing.T) {
	const fp = "SHA256:mE3VtPq1Zz8l1d7m4cX0nV2QHqzQd5a8V0b8m1f7n6Y"
	for _, tc := range []struct {
		value   string
		set     bool
		want    []string
		wantErr bool
	}{
		{value: "", set: false, want: nil},
		{value: fp, set: true, want: []string{fp}},
		{value: fp + ",," + fp, set: true, want: []string{fp, fp}},
		// an agent asked to trust hubs must not fall back to plain http
		{value: "", set: true, wantErr: true},
		{value: ",", set: true, wantErr: true},
	} {
		got, err := trustedHubs(tc.value, tc.set)
		if (err != nil) != tc.wantErr || !slices.Equal(got, tc.want) {
			t.Errorf("trustedHubs(%q, %t) = %q, %v", tc.value, tc.set, got, err)
		}
	}
}
