package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
)

// the hub sits behind an authenticating reverse proxy (forward auth) that
// sets these headers; it listens on loopback, so clients cannot set them
const (
	headerUser   = "Remote-User"
	headerName   = "Remote-Name"
	headerEmail  = "Remote-Email"
	headerGroups = "Remote-Groups"
)

type Me struct {
	User   string   `json:"user"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
	Admin  bool     `json:"admin"`
}

type access struct {
	adminGroups    []string
	categoryGroups map[string][]string
}

func readCategoryGroups(path string) (map[string][]string, error) {
	groups := map[string][]string{}
	if path == "" {
		return groups, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &groups); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return groups, nil
}

func requestGroups(r *http.Request) []string {
	groups := []string{}
	for _, g := range strings.Split(r.Header.Get(headerGroups), ",") {
		if g = strings.TrimSpace(g); g != "" {
			groups = append(groups, g)
		}
	}
	return groups
}

func anyOf(have, want []string) bool {
	for _, g := range have {
		if slices.Contains(want, g) {
			return true
		}
	}
	return false
}

// without admin groups configured every request is an admin
func (a access) isAdmin(r *http.Request) bool {
	return len(a.adminGroups) == 0 || anyOf(requestGroups(r), a.adminGroups)
}

func (a access) seesCategory(r *http.Request, category string) bool {
	want, ok := a.categoryGroups[category]
	return !ok || anyOf(requestGroups(r), want)
}

func (a access) me(r *http.Request) Me {
	return Me{
		User:   r.Header.Get(headerUser),
		Name:   r.Header.Get(headerName),
		Email:  r.Header.Get(headerEmail),
		Groups: requestGroups(r),
		Admin:  a.isAdmin(r),
	}
}

func (a access) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.isAdmin(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}
