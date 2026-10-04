package hub

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func withGroups(groups string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if groups != "" {
		r.Header.Set(headerGroups, groups)
	}
	return r
}

func TestAccess(t *testing.T) {
	open := Access{}
	restricted := Access{
		adminGroups:    []string{"admin"},
		categoryGroups: map[string][]string{"admin": {"admin"}},
	}

	cases := []struct {
		name     string
		a        Access
		groups   string
		admin    bool
		category string
		sees     bool
	}{
		{"no admin groups means everyone is admin", open, "", true, "admin", true},
		{"admin group", restricted, "user, admin", true, "admin", true},
		{"user only", restricted, "user", false, "admin", false},
		{"no header", restricted, "", false, "admin", false},
		{"unrestricted category", restricted, "user", false, "apps", true},
		{"group names match exactly", restricted, "administrators", false, "admin", false},
	}
	for _, c := range cases {
		r := withGroups(c.groups)
		if got := c.a.isAdmin(r); got != c.admin {
			t.Errorf("%s: isAdmin = %t, want %t", c.name, got, c.admin)
		}
		if got := c.a.seesCategory(r, c.category); got != c.sees {
			t.Errorf("%s: seesCategory(%q) = %t, want %t", c.name, c.category, got, c.sees)
		}
	}
}

func TestAdminOnly(t *testing.T) {
	a := Access{adminGroups: []string{"admin"}}
	h := a.AdminOnly(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	for groups, want := range map[string]int{"admin": http.StatusOK, "user": http.StatusForbidden, "": http.StatusForbidden} {
		rec := httptest.NewRecorder()
		h(rec, withGroups(groups))
		if rec.Code != want {
			t.Errorf("groups %q: status %d, want %d", groups, rec.Code, want)
		}
	}
}
