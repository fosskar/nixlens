package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNotice(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notice.json")
	n, err := NewNotices(path)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	n.Register(mux, NewAccess([]string{"admin"}, nil, ""))

	do := func(method, groups, contentType, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/notice", strings.NewReader(body))
		req.Header.Set(headerGroups, groups)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}
	get := func() Notice {
		var got Notice
		if err := json.Unmarshal(do(http.MethodGet, "user", "", "").Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}

	if got := get(); got.Message != "" {
		t.Errorf("initial notice: %+v", got)
	}
	if rec := do(http.MethodPut, "user", "application/json", `{"message":"x"}`); rec.Code != http.StatusForbidden {
		t.Errorf("user put: %d", rec.Code)
	}
	if rec := do(http.MethodPut, "admin", "text/plain", `{"message":"x"}`); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("form put: %d", rec.Code)
	}
	long, _ := json.Marshal(Notice{Message: strings.Repeat("ä", noticeMaxRunes+1)})
	if rec := do(http.MethodPut, "admin", "application/json", string(long)); rec.Code != http.StatusBadRequest {
		t.Errorf("long put: %d", rec.Code)
	}

	if rec := do(http.MethodPut, "admin", "application/json; charset=utf-8", `{"message":"  backups run tonight  "}`); rec.Code != http.StatusOK {
		t.Fatalf("admin put: %d %s", rec.Code, rec.Body)
	}
	set := get()
	if set.Message != "backups run tonight" || set.Updated == 0 {
		t.Errorf("notice: %+v", set)
	}
	reloaded, err := NewNotices(path)
	if err != nil || reloaded.cur != set {
		t.Errorf("after restart: %+v, %v", reloaded.cur, err)
	}

	if rec := do(http.MethodPut, "admin", "application/json", `{"message":""}`); rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body)
	}
	if got := get(); got != (Notice{}) {
		t.Errorf("cleared notice: %+v", got)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("notice file after clear: %v", err)
	}
}
