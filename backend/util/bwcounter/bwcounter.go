// Package bwcounter implements lightweight bandwidth counters for the daemon.
//
// A Counter aggregates byte totals by Scope (loopback vs remote) and by an
// arbitrary string Tag (e.g. URL prefix, target host, libp2p protocol). It is
// safe for concurrent use and designed for hot-path use: the increment path is
// just four atomic adds plus one map operation per call.
//
// Three Counters are typically constructed at daemon startup, one per layer:
// libp2p stream bytes, inbound HTTP server bytes, outbound HTTP client bytes.
// They are surfaced on the /debug/network page via Snapshot().
package bwcounter

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
)

// Scope categorizes a byte transfer by network reachability.
type Scope uint8

const (
	// ScopeLoopback means the remote address is on 127.0.0.0/8 or ::1.
	ScopeLoopback Scope = iota
	// ScopeRemote means anything that is not loopback (LAN counts as remote).
	ScopeRemote
)

// Direction is the direction of a byte transfer relative to the local process.
type Direction uint8

const (
	// DirIn is bytes entering the local process.
	DirIn Direction = iota
	// DirOut is bytes leaving the local process.
	DirOut
)

// Counter aggregates byte totals by scope and by tag.
//
// The zero value is ready to use.
type Counter struct {
	// totals[scope][direction]
	totals [2][2]atomic.Uint64

	tagsMu sync.Mutex
	tags   map[tagKey]*tagEntry
}

type tagKey struct {
	scope Scope
	tag   string
}

type tagEntry struct {
	in  atomic.Uint64
	out atomic.Uint64
}

// Add records n bytes for the given (scope, direction) and tag.
// An empty tag is allowed and falls into the bucket with empty key.
func (c *Counter) Add(scope Scope, dir Direction, tag string, n int64) {
	if n <= 0 {
		return
	}
	c.totals[scope][dir].Add(uint64(n))

	entry := c.tagEntry(scope, tag)
	if dir == DirIn {
		entry.in.Add(uint64(n))
	} else {
		entry.out.Add(uint64(n))
	}
}

func (c *Counter) tagEntry(scope Scope, tag string) *tagEntry {
	key := tagKey{scope: scope, tag: tag}
	c.tagsMu.Lock()
	defer c.tagsMu.Unlock()
	if c.tags == nil {
		c.tags = make(map[tagKey]*tagEntry)
	}
	e, ok := c.tags[key]
	if !ok {
		e = &tagEntry{}
		c.tags[key] = e
	}
	return e
}

// TagRow is a per-tag entry returned by Snapshot.
type TagRow struct {
	Scope Scope
	Tag   string
	In    uint64
	Out   uint64
}

// Total returns In+Out.
func (r TagRow) Total() uint64 { return r.In + r.Out }

// Snapshot is a point-in-time copy of a Counter's state.
type Snapshot struct {
	LoopbackIn  uint64
	LoopbackOut uint64
	RemoteIn    uint64
	RemoteOut   uint64
	Tags        []TagRow // sorted by Total() descending
}

// Snapshot returns the current totals and a sorted slice of per-tag rows.
func (c *Counter) Snapshot() Snapshot {
	s := Snapshot{
		LoopbackIn:  c.totals[ScopeLoopback][DirIn].Load(),
		LoopbackOut: c.totals[ScopeLoopback][DirOut].Load(),
		RemoteIn:    c.totals[ScopeRemote][DirIn].Load(),
		RemoteOut:   c.totals[ScopeRemote][DirOut].Load(),
	}
	c.tagsMu.Lock()
	rows := make([]TagRow, 0, len(c.tags))
	for k, e := range c.tags {
		rows = append(rows, TagRow{
			Scope: k.scope,
			Tag:   k.tag,
			In:    e.in.Load(),
			Out:   e.out.Load(),
		})
	}
	c.tagsMu.Unlock()
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Total() > rows[j].Total()
	})
	s.Tags = rows
	return s
}

// IsLoopbackHost reports whether host (host:port or just host) is on the
// loopback interface. We deliberately avoid DNS resolution on the hot path:
// literal IPs are checked directly, "localhost" is treated as loopback, and
// any other hostname is reported as non-loopback (DNS cost is not worth the
// edge case of users wiring custom /etc/hosts entries for loopback).
func IsLoopbackHost(host string) bool {
	if host == "" {
		return false
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return strings.EqualFold(host, "localhost")
}

// IsLoopbackAddr reports whether the TCP/UDP RemoteAddr (as returned by
// http.Request.RemoteAddr) is on the loopback interface.
func IsLoopbackAddr(remoteAddr string) bool {
	if remoteAddr == "" {
		return false
	}
	host := remoteAddr
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// Middleware wraps next with byte-counting based on the request's RemoteAddr
// scope. Tag is computed by tagFn from the request URL path; pass a function
// returning a small set of stable tags (e.g. "grpc-web", "gateway", "debug").
func (c *Counter) Middleware(tagFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope := ScopeRemote
			if IsLoopbackAddr(r.RemoteAddr) {
				scope = ScopeLoopback
			}
			tag := ""
			if tagFn != nil {
				tag = tagFn(r)
			}

			// Count request body bytes via a tee on r.Body. ContentLength is
			// often unknown for chunked uploads, so we count what we read.
			if r.Body != nil && r.Body != http.NoBody {
				r.Body = &countingReadCloser{ReadCloser: r.Body, c: c, scope: scope, dir: DirIn, tag: tag}
			}
			cw := &countingResponseWriter{ResponseWriter: w, c: c, scope: scope, tag: tag}
			next.ServeHTTP(cw, r)
		})
	}
}

// NewTransport wraps base with a RoundTripper that counts request and response
// bytes. The destination scope is derived from the request URL host. Tag is
// the destination host (without port).
func NewTransport(base http.RoundTripper, c *Counter) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &countingTransport{base: base, c: c}
}

type countingTransport struct {
	base http.RoundTripper
	c    *Counter
}

func (t *countingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Hostname()
	if host == "" && req.Host != "" {
		host, _, _ = net.SplitHostPort(req.Host)
		if host == "" {
			host = req.Host
		}
	}
	scope := ScopeRemote
	if IsLoopbackHost(host) {
		scope = ScopeLoopback
	}

	// Count outgoing request body if present and length-known.
	if req.Body != nil && req.Body != http.NoBody {
		req.Body = &countingReadCloser{ReadCloser: req.Body, c: t.c, scope: scope, dir: DirOut, tag: host}
	}

	resp, err := t.base.RoundTrip(req)
	if err != nil {
		return resp, err
	}
	if resp.Body != nil {
		resp.Body = &countingReadCloser{ReadCloser: resp.Body, c: t.c, scope: scope, dir: DirIn, tag: host}
	}
	return resp, nil
}

type countingReadCloser struct {
	io.ReadCloser
	c     *Counter
	scope Scope
	dir   Direction
	tag   string
}

func (r *countingReadCloser) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if n > 0 {
		r.c.Add(r.scope, r.dir, r.tag, int64(n))
	}
	return n, err
}

type countingResponseWriter struct {
	http.ResponseWriter
	c     *Counter
	scope Scope
	tag   string
}

func (w *countingResponseWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	if n > 0 {
		w.c.Add(w.scope, DirOut, w.tag, int64(n))
	}
	return n, err
}

// Flush implements http.Flusher when the underlying writer does.
func (w *countingResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack implements http.Hijacker when the underlying writer does.
// Note: bytes flowing through a hijacked connection are NOT counted.
func (w *countingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}
