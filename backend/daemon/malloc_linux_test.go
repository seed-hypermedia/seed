//go:build linux

package daemon

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMallocDebugHandler(t *testing.T) {
	t.Parallel()

	mallocTrim()

	rec := httptest.NewRecorder()
	mallocDebugHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/debug/malloc", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	body := rec.Body.String()
	require.Contains(t, body, "process resident set")
	require.Contains(t, body, "malloc_trim(0) every 1m0s")
	require.Contains(t, body, "<malloc", "glibc's per-arena report")
}
