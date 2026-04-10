package blob

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"seed/backend/storage"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestDomainStoreCloseCancelsBackgroundChecks(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)

	requestStarted := make(chan struct{}, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hm/api/config" {
			http.NotFound(w, r)
			return
		}

		select {
		case requestStarted <- struct{}{}:
		default:
		}

		<-r.Context().Done()
	}))
	defer server.Close()

	resolver := newSitePeerResolver(1, time.Minute)
	client := server.Client()
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok)

	serverAddr := server.Listener.Addr().String()
	transport = transport.Clone()
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, network, serverAddr)
	}
	resolver.client = &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}

	ds := NewDomainStore(db, resolver, zap.NewNop())
	t.Cleanup(func() {
		require.NoError(t, ds.Close())
	})

	ds.TrackSiteURL(context.Background(), "https://127.0.0.1")

	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("background domain check did not start")
	}

	closed := make(chan error, 1)
	go func() {
		closed <- ds.Close()
	}()

	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("domain store close did not wait for the background check to stop")
	}
}
