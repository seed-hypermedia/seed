package networking

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/storage"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
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
	idx := blob.NewIndex(db, logging.New("seed/hyper", "debug"), nil)

	cfg := config.Default().P2P
	cfg.Port = 0
	cfg.NoRelay = true
	cfg.BootstrapPeers = nil
	cfg.NoMetrics = true

	ks := core.NewMemoryKeyStore()
	must.Do(ks.StoreKey(context.Background(), "main", u.Account))

	n, err := mttnet.New(cfg, u.Device, ks, db, idx, zap.NewNop())
	require.NoError(t, err)

	errc := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		errc <- n.Start(ctx)
	}()

	t.Cleanup(func() {
		require.NoError(t, <-errc)
	})

	select {
	case <-n.Ready():
	case err := <-errc:
		require.NoError(t, err)
	}

	t.Cleanup(cancel)

	return NewServer(n, db, logging.New("test", "debug"))
}
