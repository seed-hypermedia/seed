package journeys

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	telemetry "seed/backend/api/telemetry/v1alpha"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestHandlerRendersWithoutTemplateError guards against template/view
// drift: if a field is removed from the view struct (or added to the
// template) without keeping the other side in sync, html/template will
// fail mid-stream and silently truncate the page. This test makes that
// loud by asserting both that the page renders end-to-end and that the
// "TEMPLATE ERROR" marker we emit on failure is absent.
func TestHandlerRendersWithoutTemplateError(t *testing.T) {
	srv := telemetry.NewServer(zap.NewNop())
	// Seed a couple of traces so the table branch of the template runs too,
	// not just the summary branch.
	now := time.Now()
	srv.RecordCheckpoint("hm://acc/path", telemetry.StageLinkClick, now)
	srv.RecordCheckpoint("hm://acc/path", telemetry.StageComponentRendered, now.Add(50*time.Millisecond))
	srv.RecordCheckpoint("hm://acc/feed", telemetry.StageFeedEmitted, now)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/debug/journeys", nil)
	Handler(srv).ServeHTTP(rec, req)

	body, err := io.ReadAll(rec.Result().Body)
	require.NoError(t, err)
	html := string(body)

	require.NotContains(t, html, "TEMPLATE ERROR", "template execution failed; check view/template drift")
	require.Contains(t, html, "</body></html>", "page truncated before closing tags; template likely errored")
	require.Contains(t, html, "Blob-to-render journeys", "page heading missing")
	require.Contains(t, html, "renderer.link_click", "expected stage label missing from rendered rows")

	// Sanity-check summary numbers are wired up: we have 2 keys, one of
	// which is frontend-touched and complete.
	require.True(t,
		strings.Contains(html, "<strong>2</strong> retained traces") ||
			strings.Contains(html, "<strong>2</strong>  retained traces"),
		"expected retained-traces count not found")
}
