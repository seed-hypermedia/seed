package bwcounter

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCounter_Add_TotalsAndTags(t *testing.T) {
	var c Counter
	c.Add(ScopeLoopback, DirIn, "/seed/v1", 100)
	c.Add(ScopeLoopback, DirOut, "/seed/v1", 50)
	c.Add(ScopeRemote, DirIn, "/bitswap", 1000)
	c.Add(ScopeRemote, DirOut, "/bitswap", 200)
	c.Add(ScopeRemote, DirIn, "/bitswap", 500) // accumulate
	c.Add(ScopeRemote, DirIn, "", 10)          // unlabeled bucket

	s := c.Snapshot()
	require.EqualValues(t, 100, s.LoopbackIn)
	require.EqualValues(t, 50, s.LoopbackOut)
	require.EqualValues(t, 1510, s.RemoteIn)
	require.EqualValues(t, 200, s.RemoteOut)

	// Tags sorted by total desc.
	require.NotEmpty(t, s.Tags)
	require.Equal(t, "/bitswap", s.Tags[0].Tag)
	require.EqualValues(t, 1500, s.Tags[0].In)
	require.EqualValues(t, 200, s.Tags[0].Out)

	// Find /seed/v1 row.
	var seed *TagRow
	for i := range s.Tags {
		if s.Tags[i].Tag == "/seed/v1" {
			seed = &s.Tags[i]
		}
	}
	require.NotNil(t, seed)
	require.Equal(t, ScopeLoopback, seed.Scope)
	require.EqualValues(t, 100, seed.In)
	require.EqualValues(t, 50, seed.Out)
}

func TestCounter_Add_IgnoresZeroAndNegative(t *testing.T) {
	var c Counter
	c.Add(ScopeRemote, DirIn, "x", 0)
	c.Add(ScopeRemote, DirIn, "x", -10)
	s := c.Snapshot()
	require.EqualValues(t, 0, s.RemoteIn)
	require.Empty(t, s.Tags)
}

func TestIsLoopbackHost(t *testing.T) {
	require.True(t, IsLoopbackHost("127.0.0.1"))
	require.True(t, IsLoopbackHost("127.0.0.1:8080"))
	require.True(t, IsLoopbackHost("[::1]:8080"))
	require.True(t, IsLoopbackHost("::1"))
	require.True(t, IsLoopbackHost("localhost"))
	require.True(t, IsLoopbackHost("LocalHost"))
	require.False(t, IsLoopbackHost("1.2.3.4"))
	require.False(t, IsLoopbackHost("example.com"))
	require.False(t, IsLoopbackHost(""))
}

func TestIsLoopbackAddr(t *testing.T) {
	require.True(t, IsLoopbackAddr("127.0.0.1:1234"))
	require.True(t, IsLoopbackAddr("[::1]:443"))
	require.False(t, IsLoopbackAddr("8.8.8.8:443"))
	// bare hostnames are not loopback in this fast-path helper
	require.False(t, IsLoopbackAddr("localhost:80"))
	require.False(t, IsLoopbackAddr(""))
}

func TestMiddleware_CountsRequestAndResponseBytes(t *testing.T) {
	var c Counter
	mw := c.Middleware(func(r *http.Request) string {
		if strings.HasPrefix(r.URL.Path, "/debug") {
			return "debug"
		}
		return "other"
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		require.Equal(t, "hello", string(body))
		_, _ = w.Write([]byte("world!"))
	}))

	srv := httptest.NewServer(h)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/debug/x", "application/octet-stream", strings.NewReader("hello"))
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	s := c.Snapshot()
	// httptest's loopback listener sees the test client as 127.0.0.1.
	require.EqualValues(t, 5, s.LoopbackIn, "request body should be counted as loopback in")
	require.EqualValues(t, 6, s.LoopbackOut, "response body should be counted as loopback out")

	// Tag matches.
	found := false
	for _, tr := range s.Tags {
		if tr.Tag == "debug" && tr.Scope == ScopeLoopback {
			found = true
			require.EqualValues(t, 5, tr.In)
			require.EqualValues(t, 6, tr.Out)
		}
	}
	require.True(t, found, "expected debug tag in snapshot")
}

func TestNewTransport_CountsBytes(t *testing.T) {
	var c Counter

	// Echo server returning the request body.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	client := &http.Client{Transport: NewTransport(http.DefaultTransport, &c)}
	resp, err := client.Post(srv.URL+"/y", "application/octet-stream", strings.NewReader("abcdef"))
	require.NoError(t, err)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, "abcdef", string(body))

	s := c.Snapshot()
	// httptest server is on 127.0.0.1, so the destination is loopback.
	require.EqualValues(t, 6, s.LoopbackOut, "request body counted as outbound loopback")
	require.EqualValues(t, 6, s.LoopbackIn, "response body counted as inbound loopback")
	require.NotEmpty(t, s.Tags)
}

func TestCounter_ConcurrentAdd(t *testing.T) {
	var c Counter
	const goroutines = 16
	const iters = 200
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iters; j++ {
				c.Add(ScopeRemote, DirIn, "tag", 1)
				c.Add(ScopeLoopback, DirOut, "tag2", 2)
			}
		}()
	}
	wg.Wait()

	s := c.Snapshot()
	require.EqualValues(t, goroutines*iters, s.RemoteIn)
	require.EqualValues(t, goroutines*iters*2, s.LoopbackOut)
}
