package hmnet

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestContentTypeFor(t *testing.T) {
	svg := []byte(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80"/></svg>`)
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00")
	html := []byte("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>")
	pdf := []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n")
	unknown := []byte{0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0x7f, 0x80, 0x81}

	tests := []struct {
		name     string
		filename string
		head     []byte
		want     string
	}{
		{name: "svg is detected from bytes", head: svg, want: "image/svg+xml"},
		{name: "png is detected from bytes", head: png, want: "image/png"},
		{name: "pdf is detected from bytes", head: pdf, want: "application/pdf"},
		{name: "html is downgraded to plain text", head: html, want: "text/plain; charset=utf-8"},
		{name: "unknown bytes fall back to octet-stream", head: unknown, want: DefaultContentType},
		{name: "empty content falls back to octet-stream", head: nil, want: DefaultContentType},
		{name: "filename extension wins over bytes", filename: "photo.jpg", head: png, want: "image/jpeg"},
		{name: "filename extension is used for unknown bytes", filename: "report.pdf", head: unknown, want: "application/pdf"},
		{name: "html extension is downgraded too", filename: "page.html", head: unknown, want: "text/plain; charset=utf-8"},
		{name: "unknown extension falls back to bytes", filename: "logo.whatever", head: svg, want: "image/svg+xml"},
		{name: "filename without extension falls back to bytes", filename: "logo", head: svg, want: "image/svg+xml"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, ContentTypeFor(tt.filename, tt.head))
		})
	}
}

func TestIsInertContentType(t *testing.T) {
	require.True(t, isInertContentType("image/png"))
	require.True(t, isInertContentType("image/jpeg"))
	require.True(t, isInertContentType("video/mp4"))
	require.True(t, isInertContentType("audio/mpeg"))
	require.True(t, isInertContentType("font/woff2"))
	require.True(t, isInertContentType("application/pdf"))
	require.False(t, isInertContentType("image/svg+xml"))
	require.False(t, isInertContentType("text/plain; charset=utf-8"))
	require.False(t, isInertContentType("application/octet-stream"))
	require.False(t, isInertContentType("text/xml"))
	require.False(t, isInertContentType("application/json"))
	require.False(t, isInertContentType(""))
}

func TestGetFileContentType(t *testing.T) {
	server := makeManager(t, akey)
	router := http.NewServeMux()
	router.HandleFunc("/ipfs/file-upload", server.UploadFile)
	router.HandleFunc("/ipfs/{cid}", server.GetFile)

	upload := func(t *testing.T, data []byte) string {
		res := makeRequest(t, "POST", "/ipfs/file-upload", data, router)
		require.Equal(t, http.StatusCreated, res.Code)
		return res.Body.String()
	}

	get := func(t *testing.T, url string, rangeHeader string) *httptest.ResponseRecorder {
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 800" width="80" height="80"><script>alert(1)</script><rect width="2400" height="800"/></svg>`)
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00")
	html := []byte("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>")
	unknown := []byte{0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0x7f, 0x80, 0x81}

	t.Run("svg is served as an image, sandboxed", func(t *testing.T) {
		cid := upload(t, svg)
		res := get(t, "/ipfs/"+cid, "")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "image/svg+xml", res.Header().Get("Content-Type"))
		require.Equal(t, "nosniff", res.Header().Get("X-Content-Type-Options"))
		require.Equal(t, SandboxContentSecurityPolicy, res.Header().Get("Content-Security-Policy"))
		require.Equal(t, svg, res.Body.Bytes())
	})

	t.Run("raster image is served without a sandbox", func(t *testing.T) {
		cid := upload(t, png)
		res := get(t, "/ipfs/"+cid, "")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "image/png", res.Header().Get("Content-Type"))
		require.Equal(t, "nosniff", res.Header().Get("X-Content-Type-Options"))
		require.Empty(t, res.Header().Get("Content-Security-Policy"))
		require.Equal(t, png, res.Body.Bytes())
	})

	t.Run("html never renders as a page", func(t *testing.T) {
		cid := upload(t, html)
		res := get(t, "/ipfs/"+cid, "")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "text/plain; charset=utf-8", res.Header().Get("Content-Type"))
		require.Equal(t, SandboxContentSecurityPolicy, res.Header().Get("Content-Security-Policy"))
		require.Equal(t, html, res.Body.Bytes())
	})

	t.Run("unknown bytes stay octet-stream", func(t *testing.T) {
		cid := upload(t, unknown)
		res := get(t, "/ipfs/"+cid, "")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, DefaultContentType, res.Header().Get("Content-Type"))
		require.Equal(t, unknown, res.Body.Bytes())
	})

	t.Run("download name decides the type", func(t *testing.T) {
		cid := upload(t, unknown)
		res := get(t, "/ipfs/"+cid+"?filename=report.pdf", "")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "application/pdf", res.Header().Get("Content-Type"))
		require.Equal(t, `attachment; filename="report.pdf"`, res.Header().Get("Content-Disposition"))
		require.Equal(t, unknown, res.Body.Bytes())
	})

	t.Run("range requests keep the type and the offsets", func(t *testing.T) {
		cid := upload(t, svg)
		res := get(t, "/ipfs/"+cid, "bytes=10-29")
		require.Equal(t, http.StatusPartialContent, res.Code)
		require.Equal(t, "image/svg+xml", res.Header().Get("Content-Type"))
		require.Equal(t, "bytes 10-29/"+strconv.Itoa(len(svg)), res.Header().Get("Content-Range"))
		require.Equal(t, svg[10:30], res.Body.Bytes())
	})
}
