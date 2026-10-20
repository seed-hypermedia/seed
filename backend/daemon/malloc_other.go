//go:build !linux

package daemon

import (
	"context"
	"net/http"
)

// runMallocTrim does nothing here: only glibc keeps freed memory per arena the
// way the Linux build works around.
func runMallocTrim(context.Context) {}

// mallocDebugHandler serves /debug/malloc. The allocator statistics exist only
// on Linux with glibc.
func mallocDebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "malloc statistics are only available on Linux with glibc", http.StatusNotImplemented)
	})
}
