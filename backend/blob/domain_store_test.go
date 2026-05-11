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

func TestDomainStoreSavesGatewayFlagFromConfig(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hm/api/config" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"peerId":"12D3KooWQj83ZdXN7WzdT6Th5uN7ggdYMTCh14uASZzfG4U3VwGa","addrs":[],"registeredAccountUid":"z6Mkgateway","isGateway":true}`))
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

	entry, err := ds.CheckDomain(context.Background(), "127.0.0.1")
	require.NoError(t, err)
	require.Equal(t, "success", entry.LastStatus)
	require.NotNil(t, entry.LastConfig)
	require.True(t, entry.LastConfig.IsGateway)

	cached, err := ds.GetDomain(context.Background(), "127.0.0.1")
	require.NoError(t, err)
	require.NotNil(t, cached.LastConfig)
	require.True(t, cached.LastConfig.IsGateway)
}

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
