package networking

import (
	"context"
	"errors"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

func TestNetworkingGetPeerInfo(t *testing.T) {
	alice := coretest.NewTester("alice")
	api := makeTestServer(t, alice)
	ctx := context.Background()

	pid := alice.Device.PeerID()

	pinfo, err := api.GetPeerInfo(ctx, &networking.GetPeerInfoRequest{
		DeviceId: pid.String(),
	})
	require.NoError(t, err)
	require.NotNil(t, pinfo)
}

func makeTestServer(t *testing.T, u coretest.Tester) *Server {
	db := storage.MakeTestDB(t)
	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/hyper", "debug"), nil))

	cfg := config.Default().P2P
	cfg.Port = 0
	cfg.NoRelay = true
	cfg.BootstrapPeers = nil
	cfg.NoMetrics = true

	ks := core.NewMemoryKeyStore()
	must.Do(ks.StoreKey(context.Background(), "main", u.Account))

	n, err := hmnet.New(cfg, u.Device, ks, db, idx, zap.NewNop())
	require.NoError(t, err)

	errc := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		errc <- n.Start(ctx)
	}()

	t.Cleanup(func() {
		err := <-errc
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Fatal(err)
		}
	})

	select {
	case <-n.Ready():
	case err := <-errc:
		require.NoError(t, err)
	}

	t.Cleanup(cancel)

	return NewServer(n, db, logging.New("test", "debug"))
}
