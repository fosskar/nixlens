package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fosskar/nixlens/internal/api"
)

const noticeMaxRunes = 500

// Notice is a message admins show to everyone, e.g. about maintenance.
// Updated lets a browser tell a new notice from one it dismissed
type Notice struct {
	Message string `json:"message"`
	Updated int64  `json:"updated,omitempty"`
}

// Notices keeps the notice in a file, so it outlives restarts
type Notices struct {
	path string
	mu   sync.Mutex
	cur  Notice
}

func NewNotices(path string) (*Notices, error) {
	n := &Notices{path: path}
	if path == "" {
		return n, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return n, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &n.cur); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return n, nil
}

func (n *Notices) Register(mux *http.ServeMux, acc Access) {
	mux.HandleFunc("GET /api/notice", func(w http.ResponseWriter, r *http.Request) {
		n.mu.Lock()
		defer n.mu.Unlock()
		api.WriteJSON(w, n.cur, nil)
	})
	mux.HandleFunc("PUT /api/notice", acc.AdminOnly(n.put))
}

func (n *Notices) put(w http.ResponseWriter, r *http.Request) {
	// a cross-site form cannot send json without a preflight, which the hub
	// does not answer, so the proxy's cookie cannot be used against it
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		http.Error(w, "expected application/json", http.StatusUnsupportedMediaType)
		return
	}
	if n.path == "" {
		http.Error(w, "no notice file configured", http.StatusNotImplemented)
		return
	}
	var in Notice
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	msg := strings.TrimSpace(in.Message)
	if utf8.RuneCountInString(msg) > noticeMaxRunes {
		http.Error(w, fmt.Sprintf("longer than %d characters", noticeMaxRunes), http.StatusBadRequest)
		return
	}
	next := Notice{}
	if msg != "" {
		next = Notice{Message: msg, Updated: time.Now().Unix()}
	}

	n.mu.Lock()
	defer n.mu.Unlock()
	if err := n.write(next); err != nil {
		api.WriteJSON(w, nil, err)
		return
	}
	n.cur = next
	api.WriteJSON(w, n.cur, nil)
}

func (n *Notices) write(v Notice) error {
	if v.Message == "" {
		err := os.Remove(n.path)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(n.path), ".notice-*")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), n.path)
	}
	if err != nil {
		if removeErr := os.Remove(tmp.Name()); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			err = errors.Join(err, removeErr)
		}
	}
	return err
}
